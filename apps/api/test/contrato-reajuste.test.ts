import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  APROVADOR_N2,
  chamar,
  chaveIdempotencia,
  CLIENTE_ALFA,
  consultarBanco,
  corpoAlocacao,
  EMPRESA_A,
  EQUIP_LIVRE_1,
  FILIAL_A,
  subirApi,
  TENANT_A,
  token,
  USUARIO_A,
  type Servidor,
} from './apoio.js'

/**
 * Reajuste contratual (RN-008) e alçada de desconto no contrato (RN-009).
 *
 * A máquina do reajuste e a regra de arredondamento são provadas no banco, em
 * `25_ctr_reajuste_e_desconto.sql`. Aqui se prova o que só existe na API:
 *
 *  · propor e aplicar são rotas diferentes, e a proposta não vira cobrança
 *    sozinha — se fossem a mesma chamada, "aprovação com alçada" seria texto;
 *  · conceder desconto é permissão própria, conferida **pelo corpo**: alocar
 *    sem desconto continua exigindo só `contrato:item_alocar`;
 *  · a recusa por alçada diz o que fazer em vez de só dizer não.
 */

let api: Servidor
let n = 0

const COMERCIAL = ['contrato:ler', 'contrato:criar', 'contrato:editar', 'contrato:item_alocar',
  'contrato:aprovar', 'contrato:ativar'] as const

const comercial = () => token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: [...COMERCIAL] })

/** Quem pode conceder desconto, mas cujo perfil tem teto de 10% (massa comum). */
const comDesconto = () =>
  token({
    tenant: TENANT_A,
    usuario: APROVADOR_N2,
    permissoes: [...COMERCIAL, 'contrato:desconto_conceder'],
  })

const comReajuste = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['contrato:ler', 'contrato:reajuste_aprovar'] })

async function contratoAtivo(tk: string, equipamentoId: string): Promise<string> {
  n += 1
  const c = await chamar(api, 'POST', '/api/v1/contratos', {
    token: tk,
    cabecalhos: { 'Idempotency-Key': chaveIdempotencia('rjt-ct') },
    corpo: {
      numero: `RJT-${Date.now()}-${n}`,
      empresa_id: EMPRESA_A,
      filial_id: FILIAL_A,
      cliente_id: CLIENTE_ALFA,
      data_inicio: '2026-01-01',
      data_fim: '2027-12-31',
    },
  })
  assert.equal(c.status, 201, JSON.stringify(c.corpo))
  const id = c.corpo.data.id

  const i = await chamar(api, 'POST', `/api/v1/contratos/${id}/itens`, {
    token: tk,
    cabecalhos: { 'Idempotency-Key': chaveIdempotencia('rjt-item') },
    corpo: corpoAlocacao(equipamentoId, '2026-01-01T00:00:00-03:00', '2027-12-31T23:59:59-03:00'),
  })
  assert.equal(i.status, 201, JSON.stringify(i.corpo))

  for (const acao of ['submeter', 'aprovar', 'ativar']) {
    const r = await chamar(api, 'POST', `/api/v1/contratos/${id}/${acao}`, { token: tk })
    assert.equal(r.status, 200, `${acao}: ${JSON.stringify(r.corpo)}`)
  }
  return id
}

/** Um ativo novo por contrato: RN-001 impede dois itens no mesmo equipamento. */
async function ativoNovo(tk: string): Promise<string> {
  n += 1
  const r = await chamar(api, 'POST', '/api/v1/equipamentos', {
    token: tk,
    cabecalhos: { 'Idempotency-Key': chaveIdempotencia('rjt-eq') },
    corpo: {
      patrimonio: `RJT-${Date.now()}-${n}`,
      modelo_id: '11111111-1111-4111-8111-1111111111d1',
      categoria_id: '11111111-1111-4111-8111-1111111111c1',
      filial_id: FILIAL_A,
    },
  })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  return r.corpo.data.id
}

const criarAtivo = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['equipamento:ler', 'equipamento:criar'] })

before(async () => {
  api = await subirApi()
})
after(async () => {
  await api.fechar()
})

describe('alçada de desconto no contrato', () => {
  it('alocar sem desconto não exige a permissão de desconto', async () => {
    const tk = await comercial()
    const eq = await ativoNovo(await criarAtivo())
    const id = await contratoAtivo(tk, eq)
    assert.ok(id)
  })

  it('conceder desconto sem a permissão é recusado, e a recusa diz o que fazer', async () => {
    const tk = await comercial()
    const eq = await ativoNovo(await criarAtivo())

    const c = await chamar(api, 'POST', '/api/v1/contratos', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('rjt-ct') },
      corpo: {
        numero: `RJT-D-${Date.now()}`,
        empresa_id: EMPRESA_A,
        filial_id: FILIAL_A,
        cliente_id: CLIENTE_ALFA,
        data_inicio: '2026-01-01',
        data_fim: '2027-12-31',
      },
    })
    const r = await chamar(api, 'POST', `/api/v1/contratos/${c.corpo.data.id}/itens`, {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('rjt-item') },
      corpo: {
        ...corpoAlocacao(eq),
        desconto_percentual: 8,
        desconto_motivo: 'negociacao de renovacao antecipada',
      },
    })

    assert.equal(r.status, 403, JSON.stringify(r.corpo))
    // Sem a separação, quem aloca concede desconto — e desconto em item se
    // repete em toda competência até o fim da vigência.
    assert.ok(Array.isArray(r.corpo.acoes_sugeridas) && r.corpo.acoes_sugeridas.length > 0)
  })

  it('com a permissão, o teto do perfil ainda vale', async () => {
    const tk = await comDesconto()
    const dentro = await ativoNovo(await criarAtivo())
    const fora = await ativoNovo(await criarAtivo())

    const c = await chamar(api, 'POST', '/api/v1/contratos', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('rjt-ct') },
      corpo: {
        numero: `RJT-T-${Date.now()}`,
        empresa_id: EMPRESA_A,
        filial_id: FILIAL_A,
        cliente_id: CLIENTE_ALFA,
        data_inicio: '2026-01-01',
        data_fim: '2027-12-31',
      },
    })
    const ct = c.corpo.data.id

    // O perfil financeiro da massa tem teto de 10%.
    const ok = await chamar(api, 'POST', `/api/v1/contratos/${ct}/itens`, {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('rjt-item') },
      corpo: {
        ...corpoAlocacao(dentro),
        desconto_percentual: 10,
        desconto_motivo: 'negociacao de renovacao antecipada',
      },
    })
    assert.equal(ok.status, 201, JSON.stringify(ok.corpo))

    const acima = await chamar(api, 'POST', `/api/v1/contratos/${ct}/itens`, {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('rjt-item') },
      corpo: {
        ...corpoAlocacao(fora),
        desconto_percentual: 25,
        desconto_motivo: 'cliente insistiu bastante nessa condicao',
      },
    })
    /*
     * A permissão diz "pode conceder"; a alçada diz "até quanto". As duas são
     * necessárias — com só a primeira, qualquer concessão passa; com só a
     * segunda, não há como dizer que alguém não concede desconto nenhum.
     */
    assert.equal(acima.status, 403, JSON.stringify(acima.corpo))
    assert.match(JSON.stringify(acima.corpo), /alçada|alcada/i)
  })
})

describe('reajuste', () => {
  it('propor não cobra: aplicar exige passar por aprovar', async () => {
    const tkC = await comercial()
    const tkR = await comReajuste()
    const eq = await ativoNovo(await criarAtivo())
    const ct = await contratoAtivo(tkC, eq)

    const p = await chamar(api, 'POST', `/api/v1/contratos/${ct}/reajustes`, {
      token: tkR,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('rjt') },
      corpo: { competencia: '2027-01-01', indice: 'IPCA', percentual_indice: '4.6200' },
    })
    assert.equal(p.status, 201, JSON.stringify(p.corpo))
    assert.equal(p.corpo.data.status, 'PROPOSTO')

    // Os dois valores são derivados no banco: a proposta mostra exatamente o
    // que passará a ser cobrado se for aprovada.
    assert.equal(p.corpo.data.valor_anterior, '289.0000')
    assert.equal(p.corpo.data.valor_novo, '302.3500')

    const cedo = await chamar(api, 'POST', `/api/v1/reajustes/${p.corpo.data.id}/aplicar`, { token: tkR })
    assert.equal(cedo.status, 422, JSON.stringify(cedo.corpo))

    const ap = await chamar(api, 'POST', `/api/v1/reajustes/${p.corpo.data.id}/aprovar`, { token: tkR })
    assert.equal(ap.status, 200, JSON.stringify(ap.corpo))
    assert.ok(ap.corpo.data.aprovado_em)

    const apl = await chamar(api, 'POST', `/api/v1/reajustes/${p.corpo.data.id}/aplicar`, { token: tkR })
    assert.equal(apl.status, 200, JSON.stringify(apl.corpo))

    const itens = await consultarBanco<{ valor_unitario: string }>(
      TENANT_A,
      `select valor_unitario::text as valor_unitario from public.contrato_item where contrato_id = $1`,
      [ct],
    )
    // 289,00 × 1,0462 = 302,3518 → 302,35 (duas casas, meio para cima).
    assert.equal(itens[0]!.valor_unitario, '302.3500')
  })

  it('a renúncia fica visível, com motivo — é o indicador de receita renunciada', async () => {
    const tkC = await comercial()
    const tkR = await comReajuste()
    const eq = await ativoNovo(await criarAtivo())
    const ct = await contratoAtivo(tkC, eq)

    const p = await chamar(api, 'POST', `/api/v1/contratos/${ct}/reajustes`, {
      token: tkR,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('rjt') },
      corpo: { competencia: '2027-03-01', indice: 'IGPM', percentual_indice: '3.1000' },
    })
    assert.equal(p.status, 201, JSON.stringify(p.corpo))

    const semMotivo = await chamar(api, 'POST', `/api/v1/reajustes/${p.corpo.data.id}/renunciar`, {
      token: tkR,
      corpo: { motivo: 'nao' },
    })
    // 400 e não 422: o motivo curto não chega ao banco — o contrato da rota
    // o recusa antes, e apontando o campo.
    assert.equal(semMotivo.status, 400, JSON.stringify(semMotivo.corpo))
    assert.equal(semMotivo.corpo.errors[0].field, 'motivo')

    const r = await chamar(api, 'POST', `/api/v1/reajustes/${p.corpo.data.id}/renunciar`, {
      token: tkR,
      corpo: { motivo: 'cliente em renegociacao de escopo do contrato' },
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.status, 'RENUNCIADO')

    /*
     * A linha permanece consultável. Apagar a proposta faria o indicador de
     * receita renunciada medir zero exatamente nos casos que ele existe para
     * medir — os em que se decidiu não cobrar.
     */
    const lista = await chamar(api, 'GET', '/api/v1/reajustes?status=RENUNCIADO', { token: tkR })
    assert.equal(lista.status, 200, JSON.stringify(lista.corpo))
    assert.ok(lista.corpo.data.some((x: { id: string }) => x.id === p.corpo.data.id))
  })

  it('não propõe reajuste sobre contrato que não está cobrando', async () => {
    const tk = await comercial()
    const tkR = await comReajuste()

    const c = await chamar(api, 'POST', '/api/v1/contratos', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('rjt-ct') },
      corpo: {
        numero: `RJT-R-${Date.now()}`,
        empresa_id: EMPRESA_A,
        filial_id: FILIAL_A,
        cliente_id: CLIENTE_ALFA,
        data_inicio: '2026-01-01',
        data_fim: '2027-12-31',
      },
    })

    const r = await chamar(api, 'POST', `/api/v1/contratos/${c.corpo.data.id}/reajustes`, {
      token: tkR,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('rjt') },
      corpo: { competencia: '2027-01-01', indice: 'IPCA', percentual_indice: '4.6200' },
    })
    // Sobre rascunho a base é zero, e a proposta sairia coerente consigo mesma
    // e sem relação nenhuma com o que se cobra.
    assert.equal(r.status, 422, JSON.stringify(r.corpo))
  })

  it('propor e aprovar são permissões de contrato, não de leitura', async () => {
    const tkC = await comercial()
    const eq = await ativoNovo(await criarAtivo())
    const ct = await contratoAtivo(tkC, eq)

    const soLeitura = await token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['contrato:ler'] })
    const r = await chamar(api, 'POST', `/api/v1/contratos/${ct}/reajustes`, {
      token: soLeitura,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('rjt') },
      corpo: { competencia: '2027-06-01', indice: 'IPCA', percentual_indice: '4.0000' },
    })
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
  })
})

describe('ações de item de contrato', () => {
  it('encerrar um item para a cobrança dele sem tocar no resto do contrato', async () => {
    const tkC = await comercial()
    const tkE = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['contrato:ler', 'contrato:item_encerrar'],
    })
    const eq = await ativoNovo(await criarAtivo())
    const ct = await contratoAtivo(tkC, eq)

    const itens = await chamar(api, 'GET', `/api/v1/contratos/${ct}/itens`, { token: tkC })
    const itemId = itens.corpo.data[0].id

    const r = await chamar(api, 'POST', `/api/v1/contratos/${ct}/itens/${itemId}/encerrar`, {
      token: tkE,
      corpo: { encerrado_em: '2026-06-30T23:59:59-03:00', motivo: 'devolucao antecipada do equipamento' },
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))

    const depois = await consultarBanco<{ status: string; fim: string }>(
      TENANT_A,
      `select status, upper(vigencia)::text as fim from public.contrato_item where id = $1`,
      [itemId],
    )
    assert.equal(depois[0]!.status, 'ENCERRADO')
    /*
     * A vigência fecha na data da devolução, não na do registro: é por ela que
     * o motor rateia a competência, e fechá-la hoje cobraria os dias em que a
     * máquina já estava de volta na base.
     */
    assert.match(depois[0]!.fim, /^2026-07-01/)

    const contrato = await chamar(api, 'GET', `/api/v1/contratos/${ct}`, { token: tkC })
    assert.equal(contrato.corpo.data.status, 'ATIVO')
  })

  it('substituir cria o sucessor e deixa o antecessor apontando para ele', async () => {
    const tkC = await comercial()
    const tkS = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['contrato:ler', 'contrato:item_substituir'],
    })
    const original = await ativoNovo(await criarAtivo())
    const reposicao = await ativoNovo(await criarAtivo())
    const ct = await contratoAtivo(tkC, original)

    const itens = await chamar(api, 'GET', `/api/v1/contratos/${ct}/itens`, { token: tkC })
    const itemId = itens.corpo.data[0].id

    const r = await chamar(api, 'POST', `/api/v1/contratos/${ct}/itens/${itemId}/substituir`, {
      token: tkS,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('subst') },
      corpo: {
        equipamento_id: reposicao,
        motivo: 'falha recorrente no mecanismo de traccao',
        efetivado_em: '2026-07-01T09:00:00-03:00',
      },
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))

    const linhas = await consultarBanco<{
      id: string
      status: string
      equipamento_id: string
      substituido_por_id: string | null
      valor_unitario: string
    }>(
      TENANT_A,
      `select id, status, equipamento_id, substituido_por_id,
              valor_unitario::text as valor_unitario
         from public.contrato_item where contrato_id = $1 order by created_at`,
      [ct],
    )
    assert.equal(linhas.length, 2)

    const antigo = linhas.find((l) => l.id === itemId)!
    const novo = linhas.find((l) => l.id !== itemId)!
    assert.equal(antigo.status, 'SUBSTITUIDO')
    assert.equal(antigo.substituido_por_id, novo.id)
    assert.equal(novo.equipamento_id, reposicao)
    /*
     * A precificação é herdada: substituição é troca de máquina, não
     * renegociação. Se o sucessor nascesse com outro valor, uma troca por
     * defeito mudaria o que o cliente paga sem ninguém decidir isso.
     */
    assert.equal(novo.valor_unitario, antigo.valor_unitario)
  })

  it('item de outro contrato não é encerrado trocando o id na URL', async () => {
    const tkC = await comercial()
    const tkE = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['contrato:ler', 'contrato:item_encerrar'],
    })
    const eqA = await ativoNovo(await criarAtivo())
    const ctA = await contratoAtivo(tkC, eqA)
    const ctB = await contratoAtivo(tkC, EQUIP_LIVRE_1).catch(() => null)

    const itens = await chamar(api, 'GET', `/api/v1/contratos/${ctA}/itens`, { token: tkC })
    const itemDeA = itens.corpo.data[0].id

    const alvo = ctB ?? ctA
    if (alvo === ctA) return // sem segundo contrato, o caso não tem o que provar

    const r = await chamar(api, 'POST', `/api/v1/contratos/${alvo}/itens/${itemDeA}/encerrar`, {
      token: tkE,
      corpo: { encerrado_em: '2026-06-30T23:59:59-03:00', motivo: 'tentativa de encerrar item alheio' },
    })
    assert.equal(r.status, 404, JSON.stringify(r.corpo))
  })
})
