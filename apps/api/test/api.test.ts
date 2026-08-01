import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTRATO_CREDITO_BLOQUEADO,
  CONTRATO_DESTINO,
  CONTRATO_ENCERRADO,
  CONTRATO_TENANT_B,
  EQUIP_LIVRE_1,
  EQUIP_LIVRE_2,
  EQUIP_OCUPADO,
  EQUIP_TENANT_B,
  TENANT_B,
  USUARIO_B,
  chamar,
  chaveIdempotencia,
  corpoAlocacao,
  subirApi,
  token,
  type Servidor,
} from './apoio.js'

/**
 * Testes de integração da API contra PostgreSQL real.
 *
 * Sem mock de banco, e a razão é a mesma que justifica pôr as invariantes no
 * schema: RN-001 é uma exclusion constraint e RN-028 é RLS. Um mock provaria
 * apenas que o mock foi programado para concordar com o teste. O que precisa
 * ser demonstrado é que o **banco** recusa, e que a API traduz a recusa.
 */

let api: Servidor

const LEITOR = ['equipamento:ler', 'contrato:ler'] as const
const ALOCADOR = ['equipamento:ler', 'contrato:ler', 'contrato:item_alocar'] as const
const BLOQUEADOR = ['equipamento:ler', 'equipamento:bloquear', 'equipamento:desbloquear'] as const

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

/* ------------------------------------------------------------- autenticação */

describe('autenticação e autorização', () => {
  it('rota de vitalidade é pública', async () => {
    const r = await chamar(api, 'GET', '/vivo')
    assert.equal(r.status, 200)
    assert.equal(r.corpo.data.status, 'ok')
  })

  it('sem token devolve 401 em problem+json', async () => {
    const r = await chamar(api, 'GET', '/api/v1/equipamentos')
    assert.equal(r.status, 401)
    assert.match(r.cabecalhos.get('content-type') ?? '', /application\/problem\+json/)
    assert.equal(r.corpo.code, 'NAO_AUTENTICADO')
    assert.ok(r.corpo.request_id, 'a resposta precisa carregar o request_id para o suporte')
  })

  it('token expirado devolve TOKEN_INVALIDO sem revelar a causa exata', async () => {
    const t = await token({ permissoes: [...LEITOR], expirado: true })
    const r = await chamar(api, 'GET', '/api/v1/equipamentos', { token: t })
    assert.equal(r.status, 401)
    assert.equal(r.corpo.code, 'TOKEN_INVALIDO')
    // O título pode dizer "inválido ou expirado" — ambiguidade é intencional.
    // O que não pode vazar é a causa exata, que ajudaria quem está sondando a
    // ajustar o token até ser aceito.
    assert.equal(r.corpo.detail, undefined)
    assert.doesNotMatch(JSON.stringify(r.corpo), /signature|JWS|claim|timestamp check/i)
  })

  it('token válido sem a permissão da rota devolve 403', async () => {
    const t = await token({ permissoes: ['contrato:ler'] })
    const r = await chamar(api, 'GET', '/api/v1/equipamentos', { token: t })
    assert.equal(r.status, 403)
    assert.equal(r.corpo.code, 'SEM_PERMISSAO')
    assert.equal(r.corpo.errors?.[0]?.meta?.exigida, 'equipamento:ler')
  })

  it('permissão desconhecida no token é descartada, não aceita', async () => {
    // Emissor mais novo que a API: a permissão inexistente é ignorada e a
    // exigida continua ausente, então a rota é negada.
    const t = await token({ permissoes: ['equipamento:inventar_permissao' as never] })
    const r = await chamar(api, 'GET', '/api/v1/equipamentos', { token: t })
    assert.equal(r.status, 403)
  })
})

/* ------------------------------------------------------- RN-028 isolamento */

describe('RN-028 — isolamento entre tenants', () => {
  it('a listagem só devolve ativos do tenant do token', async () => {
    const tA = await token({ permissoes: [...LEITOR] })
    const rA = await chamar(api, 'GET', '/api/v1/equipamentos?limit=50', { token: tA })
    assert.equal(rA.status, 200)
    const patrimoniosA = rA.corpo.data.map((e: { patrimonio: string }) => e.patrimonio)
    assert.deepEqual([...patrimoniosA].sort(), ['10422', '10423', '10424'])

    const tB = await token({ tenant: TENANT_B, usuario: USUARIO_B, permissoes: [...LEITOR] })
    const rB = await chamar(api, 'GET', '/api/v1/equipamentos?limit=50', { token: tB })
    const patrimoniosB = rB.corpo.data.map((e: { patrimonio: string }) => e.patrimonio)
    assert.deepEqual(patrimoniosB, ['90001'])
  })

  it('buscar registro de outro tenant devolve 404, não 403', async () => {
    // Distinguir "não existe" de "existe mas não é seu" permitiria enumerar a
    // base alheia um id por vez.
    const t = await token({ permissoes: [...LEITOR] })
    const equipamento = await chamar(api, 'GET', `/api/v1/equipamentos/${EQUIP_TENANT_B}`, { token: t })
    assert.equal(equipamento.status, 404)
    assert.equal(equipamento.corpo.code, 'NAO_ENCONTRADO')

    const contrato = await chamar(api, 'GET', `/api/v1/contratos/${CONTRATO_TENANT_B}`, { token: t })
    assert.equal(contrato.status, 404)
  })

  it('não é possível alocar ativo de outro tenant', async () => {
    const t = await token({ permissoes: [...ALOCADOR] })
    const r = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      corpo: corpoAlocacao(EQUIP_TENANT_B),
      cabecalhos: { 'idempotency-key': chaveIdempotencia('cross-tenant') },
    })
    assert.equal(r.status, 404)
  })
})

/* --------------------------------------------------------- RN-001 alocação */

describe('RN-001 — sobreposição de vigência', () => {
  it('recusa alocação sobreposta e explica o conflito com alternativas', async () => {
    const t = await token({ permissoes: [...ALOCADOR] })
    const r = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      // 10422 está ocupado de 01/01/2026 a 31/12/2026 no contrato SP-2026-0148.
      corpo: corpoAlocacao(EQUIP_OCUPADO, '2026-06-01T00:00:00-03:00', '2026-11-30T23:59:59-03:00'),
      cabecalhos: { 'idempotency-key': chaveIdempotencia('rn001') },
    })

    assert.equal(r.status, 409)
    assert.equal(r.corpo.code, 'EQUIPAMENTO_JA_ALOCADO')
    assert.equal(r.corpo.type, 'https://api.iarx.app/errors/equipamento-ja-alocado')

    // A recusa precisa dizer QUAL contrato ocupa e ATÉ QUANDO — sem isso o
    // operador não tem como decidir nada.
    assert.match(r.corpo.detail, /10422/)
    assert.match(r.corpo.detail, /SP-2026-0148/)
    assert.match(r.corpo.detail, /2026-12-31/)
    assert.equal(r.corpo.errors[0].field, 'equipamento_id')
    assert.equal(r.corpo.errors[0].meta.contrato_conflitante, 'SP-2026-0148')

    // E precisa oferecer saída: equivalentes livres na mesma categoria/filial.
    const codigos = r.corpo.acoes_sugeridas.map((a: { code: string }) => a.code)
    assert.ok(codigos.includes('ALOCAR_EQUIVALENTE'), 'faltou sugerir ativo equivalente')
    assert.ok(codigos.includes('RESERVAR_FUTURO'), 'faltou sugerir reserva após a liberação')
    const equivalente = r.corpo.acoes_sugeridas.find((a: { code: string }) => a.code === 'ALOCAR_EQUIVALENTE')
    const patrimonios = equivalente.meta.candidatos.map((c: { patrimonio: string }) => c.patrimonio)
    assert.deepEqual([...patrimonios].sort(), ['10423', '10424'])
  })

  it('aceita alocação em período que não sobrepõe', async () => {
    const t = await token({ permissoes: [...ALOCADOR] })
    const r = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      // Começa depois de 31/12/2026, quando o ativo é liberado.
      corpo: corpoAlocacao(EQUIP_OCUPADO, '2027-01-01T00:00:00-03:00', '2027-06-30T23:59:59-03:00'),
      cabecalhos: { 'idempotency-key': chaveIdempotencia('sem-conflito') },
    })
    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.equipamento_id, EQUIP_OCUPADO)
    // Item com ativo nomeado nasce ocupante — é o que faz RN-001 valer para ele.
    assert.equal(r.corpo.data.status, 'RESERVADO')
  })

  it('duas alocações concorrentes do mesmo ativo: exatamente uma vence', async () => {
    // A prova de que a garantia é do banco, não da aplicação. Se a verificação
    // fosse um SELECT seguido de INSERT, as duas passariam pela checagem antes
    // de qualquer uma gravar.
    const t = await token({ permissoes: [...ALOCADOR] })
    const periodo = ['2028-03-01T00:00:00-03:00', '2028-09-30T23:59:59-03:00'] as const

    const [a, b] = await Promise.all([
      chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
        token: t,
        corpo: corpoAlocacao(EQUIP_LIVRE_2, periodo[0], periodo[1]),
        cabecalhos: { 'idempotency-key': chaveIdempotencia('corrida-a') },
      }),
      chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
        token: t,
        corpo: corpoAlocacao(EQUIP_LIVRE_2, periodo[0], periodo[1]),
        cabecalhos: { 'idempotency-key': chaveIdempotencia('corrida-b') },
      }),
    ])

    const status = [a.status, b.status].sort()
    assert.deepEqual(status, [201, 409], `esperava um 201 e um 409, veio ${status.join(' e ')}`)
    const perdedora = a.status === 409 ? a : b
    assert.equal(perdedora.corpo.code, 'EQUIPAMENTO_JA_ALOCADO')
  })
})

/* ---------------------------------------------------------- regras de estado */

describe('regras de estado e crédito', () => {
  it('contrato encerrado não aceita novos itens', async () => {
    const t = await token({ permissoes: [...ALOCADOR] })
    const r = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_ENCERRADO}/itens`, {
      token: t,
      corpo: corpoAlocacao(EQUIP_LIVRE_1),
      cabecalhos: { 'idempotency-key': chaveIdempotencia('encerrado') },
    })
    assert.equal(r.status, 422)
    assert.equal(r.corpo.code, 'TRANSICAO_INVALIDA')
    assert.match(r.corpo.detail, /ENCERRADO/)
  })

  it('cliente com crédito bloqueado impede alocação, mas oferece saída', async () => {
    const t = await token({ permissoes: [...ALOCADOR] })
    const r = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_CREDITO_BLOQUEADO}/itens`, {
      token: t,
      corpo: corpoAlocacao(EQUIP_LIVRE_1),
      cabecalhos: { 'idempotency-key': chaveIdempotencia('credito') },
    })
    assert.equal(r.status, 422)
    assert.equal(r.corpo.code, 'CREDITO_BLOQUEADO')
    assert.ok(r.corpo.acoes_sugeridas.length > 0, 'bloqueio sem saída deixa o operador sem ação')
  })
})

/* -------------------------------------------------------------- validação */

describe('validação de entrada pelo contrato compartilhado', () => {
  it('vigência invertida é recusada com o campo apontado', async () => {
    const t = await token({ permissoes: [...ALOCADOR] })
    const r = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      corpo: corpoAlocacao(EQUIP_LIVRE_1, '2026-06-01T00:00:00-03:00', '2026-05-01T00:00:00-03:00'),
      cabecalhos: { 'idempotency-key': chaveIdempotencia('vigencia') },
    })
    assert.equal(r.status, 400)
    assert.equal(r.corpo.code, 'PAYLOAD_INVALIDO')
    assert.ok(r.corpo.errors.some((e: { field: string }) => e.field === 'vigencia_fim'))
  })

  it('franquia sem parâmetros obrigatórios é recusada antes de tocar o banco', async () => {
    const t = await token({ permissoes: [...ALOCADOR] })
    const r = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      corpo: {
        equipamento_id: EQUIP_LIVRE_1,
        modalidade_cobranca: 'FRANQUIA_EXCEDENTE',
        valor_unitario: '289.0000',
        vigencia_inicio: '2029-01-01T00:00:00-03:00',
      },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('franquia') },
    })
    assert.equal(r.status, 400)
    assert.ok(r.corpo.errors.some((e: { field: string }) => e.field === 'franquia_quantidade'))
  })

  it('valor monetário como número, e não string decimal, é recusado', async () => {
    const t = await token({ permissoes: [...ALOCADOR] })
    const corpo = { ...corpoAlocacao(EQUIP_LIVRE_1), valor_unitario: 289.0 as unknown as string }
    const r = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      corpo,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('dinheiro') },
    })
    assert.equal(r.status, 400)
    assert.ok(r.corpo.errors.some((e: { field: string }) => e.field === 'valor_unitario'))
  })
})

/* ------------------------------------------------------------ idempotência */

describe('RN-029 — idempotência', () => {
  it('POST de efeito financeiro exige Idempotency-Key', async () => {
    const t = await token({ permissoes: [...ALOCADOR] })
    const r = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      corpo: corpoAlocacao(EQUIP_LIVRE_1),
    })
    assert.equal(r.status, 400)
    assert.equal(r.corpo.code, 'PAYLOAD_INVALIDO')
    assert.match(r.corpo.detail, /Idempotency-Key/)
  })

  it('reenvio com a mesma chave e mesmo corpo devolve a resposta guardada', async () => {
    const t = await token({ permissoes: [...ALOCADOR] })
    const chave = chaveIdempotencia('replay')
    const corpo = corpoAlocacao(EQUIP_LIVRE_1, '2029-01-01T00:00:00-03:00', '2029-06-30T23:59:59-03:00')

    const primeira = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      corpo,
      cabecalhos: { 'idempotency-key': chave },
    })
    assert.equal(primeira.status, 201)

    const segunda = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      corpo,
      cabecalhos: { 'idempotency-key': chave },
    })
    assert.equal(segunda.status, 201)
    assert.equal(segunda.cabecalhos.get('idempotency-replayed'), 'true')
    // Mesmo item, não um segundo: é isto que impede a cobrança duplicada.
    assert.equal(segunda.corpo.data.id, primeira.corpo.data.id)
  })

  it('ordem diferente das chaves do JSON ainda é o mesmo corpo', async () => {
    const t = await token({ permissoes: [...ALOCADOR] })
    const chave = chaveIdempotencia('canonico')
    const base = corpoAlocacao(EQUIP_LIVRE_1, '2029-07-01T00:00:00-03:00', '2029-12-31T23:59:59-03:00')
    const invertido = Object.fromEntries(Object.entries(base).reverse())

    const a = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      corpo: base,
      cabecalhos: { 'idempotency-key': chave },
    })
    const b = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      corpo: invertido,
      cabecalhos: { 'idempotency-key': chave },
    })
    assert.equal(a.status, 201)
    assert.equal(b.status, 201, 'canonicalização deveria tornar a ordem das chaves irrelevante')
    assert.equal(b.corpo.data.id, a.corpo.data.id)
  })

  it('mesma chave com corpo diferente é recusada em vez de reproduzir a antiga', async () => {
    const t = await token({ permissoes: [...ALOCADOR] })
    const chave = chaveIdempotencia('divergente')

    const primeira = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      corpo: corpoAlocacao(EQUIP_LIVRE_1, '2030-01-01T00:00:00-03:00', '2030-06-30T23:59:59-03:00'),
      cabecalhos: { 'idempotency-key': chave },
    })
    assert.equal(primeira.status, 201)

    const segunda = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      corpo: corpoAlocacao(EQUIP_LIVRE_2, '2030-01-01T00:00:00-03:00', '2030-06-30T23:59:59-03:00'),
      cabecalhos: { 'idempotency-key': chave },
    })
    assert.equal(segunda.status, 409)
    assert.equal(segunda.corpo.code, 'IDEMPOTENCIA_DIVERGENTE')
  })

  it('falha libera a chave, permitindo corrigir e reenviar', async () => {
    const t = await token({ permissoes: [...ALOCADOR] })
    const chave = chaveIdempotencia('liberada')

    const invalida = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      corpo: corpoAlocacao(EQUIP_OCUPADO, '2026-07-01T00:00:00-03:00', '2026-08-31T23:59:59-03:00'),
      cabecalhos: { 'idempotency-key': chave },
    })
    assert.equal(invalida.status, 409)
    assert.equal(invalida.corpo.code, 'EQUIPAMENTO_JA_ALOCADO')

    // Mesma chave, corpo corrigido: se a chave tivesse ficado presa ao corpo
    // anterior, isto viria como IDEMPOTENCIA_DIVERGENTE e o cliente ficaria sem
    // saída a não ser gerar outra chave.
    const corrigida = await chamar(api, 'POST', `/api/v1/contratos/${CONTRATO_DESTINO}/itens`, {
      token: t,
      corpo: corpoAlocacao(EQUIP_LIVRE_1, '2031-01-01T00:00:00-03:00', '2031-06-30T23:59:59-03:00'),
      cabecalhos: { 'idempotency-key': chave },
    })
    assert.equal(corrigida.status, 201)
  })
})

/* ------------------------------------------------------ concorrência e ETag */

describe('concorrência otimista', () => {
  it('bloquear sem If-Match é recusado', async () => {
    const t = await token({ permissoes: [...BLOQUEADOR] })
    const r = await chamar(api, 'POST', `/api/v1/equipamentos/${EQUIP_LIVRE_1}/bloquear`, {
      token: t,
      corpo: { motivo: 'preventiva vencida além da tolerância' },
    })
    assert.equal(r.status, 400)
    assert.equal(r.corpo.errors[0].field, 'If-Match')
  })

  it('If-Match desatualizado devolve 409 em vez de sobrescrever', async () => {
    const t = await token({ permissoes: [...BLOQUEADOR] })
    const r = await chamar(api, 'POST', `/api/v1/equipamentos/${EQUIP_LIVRE_1}/bloquear`, {
      token: t,
      corpo: { motivo: 'preventiva vencida além da tolerância' },
      cabecalhos: { 'if-match': '"99"' },
    })
    assert.equal(r.status, 409)
    assert.equal(r.corpo.code, 'CONFLITO_DE_VERSAO')
    assert.equal(r.corpo.errors[0].meta.enviada, 99)
  })

  it('bloqueio com a versão correta funciona e não altera o status do ativo', async () => {
    const t = await token({ permissoes: [...BLOQUEADOR] })
    const antes = await chamar(api, 'GET', `/api/v1/equipamentos/${EQUIP_LIVRE_1}`, { token: t })
    assert.equal(antes.corpo.data.bloqueado, false)

    const r = await chamar(api, 'POST', `/api/v1/equipamentos/${EQUIP_LIVRE_1}/bloquear`, {
      token: t,
      corpo: { motivo: 'preventiva vencida além da tolerância', ate: null },
      cabecalhos: { 'if-match': `"${antes.corpo.data.version}"` },
    })
    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.bloqueado, true)
    // Bloqueio e status são eixos independentes: o ativo continua onde estava.
    assert.equal(r.corpo.data.status, antes.corpo.data.status)
    assert.equal(r.corpo.data.version, antes.corpo.data.version + 1)

    const desbloqueio = await chamar(api, 'POST', `/api/v1/equipamentos/${EQUIP_LIVRE_1}/desbloquear`, {
      token: t,
      cabecalhos: { 'if-match': `"${r.corpo.data.version}"` },
    })
    assert.equal(desbloqueio.status, 201)
    assert.equal(desbloqueio.corpo.data.bloqueado, false)
  })
})

/* ------------------------------------------------------------- paginação */

describe('paginação por cursor', () => {
  it('percorre todas as páginas sem repetir nem perder registros', async () => {
    const t = await token({ permissoes: [...LEITOR] })
    const vistos: string[] = []
    let cursor: string | null = null

    for (let pagina = 0; pagina < 5; pagina += 1) {
      const url: string = `/api/v1/equipamentos?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const r = await chamar(api, 'GET', url, { token: t })
      assert.equal(r.status, 200)
      vistos.push(...r.corpo.data.map((e: { patrimonio: string }) => e.patrimonio))
      cursor = r.corpo.meta.next_cursor
      if (!cursor) break
    }

    assert.deepEqual([...vistos].sort(), ['10422', '10423', '10424'])
    assert.equal(new Set(vistos).size, vistos.length, 'nenhum registro pode aparecer em duas páginas')
    assert.equal(cursor, null, 'a última página não deve oferecer próximo cursor')
  })

  it('cursor corrompido é tratado como ausente, não como erro', async () => {
    const t = await token({ permissoes: [...LEITOR] })
    const r = await chamar(api, 'GET', '/api/v1/equipamentos?limit=2&cursor=lixo!!!', { token: t })
    assert.equal(r.status, 200)
  })
})

/* ---------------------------------------------------------------- filtros */

describe('filtros de listagem', () => {
  it('livre_em exclui ativos com alocação ocupante no instante informado', async () => {
    const t = await token({ permissoes: [...LEITOR] })
    const r = await chamar(api, 'GET', '/api/v1/equipamentos?limit=50&livre_em=2026-06-15T12:00:00-03:00', {
      token: t,
    })
    const patrimonios = r.corpo.data.map((e: { patrimonio: string }) => e.patrimonio)
    assert.ok(!patrimonios.includes('10422'), '10422 está alocado nessa data e não deveria aparecer')
    assert.ok(patrimonios.includes('10423'))
  })

  it('tenant_id não é aceito como parâmetro de consulta', async () => {
    // Se fosse aceito, seria o parâmetro exato que atravessa o isolamento.
    const t = await token({ permissoes: [...LEITOR] })
    const r = await chamar(api, `GET`, `/api/v1/equipamentos?limit=50&tenant_id=${TENANT_B}`, { token: t })
    assert.equal(r.status, 200)
    const patrimonios = r.corpo.data.map((e: { patrimonio: string }) => e.patrimonio)
    assert.ok(!patrimonios.includes('90001'), 'o filtro de tenant por query não pode ter efeito algum')
  })
})
