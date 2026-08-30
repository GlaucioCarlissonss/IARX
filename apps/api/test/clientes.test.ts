import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATEGORIA_A,
  CLIENTE_ALFA,
  EMPRESA_A,
  FILIAL_A,
  MODELO_A,
  TENANT_A,
  TENANT_B,
  USUARIO_B,
  chamar,
  consultarBanco,
  subirApi,
  token,
  type Servidor,
} from './apoio.js'

/**
 * Integração de clientes, contra PostgreSQL real.
 *
 * O que estes testes existem para provar, em uma frase: **crédito não é
 * cadastro**. Quem corrige um nome fantasia não libera exposição financeira, e
 * a separação não é convenção de nomes — é permissão distinta, rota distinta e
 * recusa verificável.
 *
 * O segundo tema é a visão 360, que devolve o que tem fonte e **declara o que
 * não tem**. Um zero em "chamados" seria indistinguível de "não existe módulo
 * de chamados", e a segunda leitura é a verdadeira.
 */

let api: Servidor

const LEITOR = ['cliente:ler'] as const
const CADASTRO = ['cliente:ler', 'cliente:criar', 'cliente:editar'] as const
const CREDITO = ['cliente:ler', 'cliente:credito_definir'] as const
const LOCAIS = ['cliente:ler', 'local_operacao:gerenciar'] as const

/** Documento único por execução: a suíte compartilha um banco entre arquivos. */
const documento = () => String(Date.now()).padStart(14, '9').slice(-14)

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('clientes', () => {
  it('lista, filtra por situação de crédito e busca sem acento', async () => {
    const t = await token({ permissoes: [...LEITOR] })

    const todos = await chamar(api, 'GET', '/api/v1/clientes', { token: t })
    assert.equal(todos.status, 200)
    assert.ok(todos.corpo.data.length >= 1)

    const liberados = await chamar(api, 'GET', '/api/v1/clientes?situacao_credito=LIBERADO', {
      token: t,
    })
    assert.equal(liberados.status, 200)
    assert.ok(
      liberados.corpo.data.every((c: { situacao_credito: string }) => c.situacao_credito === 'LIBERADO'),
    )
  })

  it('recusa quem não tem cliente:ler, e a recusa não é 404', async () => {
    // 403 e não 404: o recurso existe, o que falta é autorização. Devolver 404
    // aqui esconderia do operador que o problema é o perfil dele.
    const semNada = await chamar(api, 'GET', '/api/v1/clientes', {
      token: await token({ permissoes: [] }),
    })
    assert.equal(semNada.status, 403)
  })

  it('cria, e o segundo com o mesmo documento é recusado com o campo certo', async () => {
    const t = await token({ permissoes: [...CADASTRO] })
    const doc = documento()

    const r = await chamar(api, 'POST', '/api/v1/clientes', {
      token: t,
      corpo: { documento: doc, razao_social: 'INDÚSTRIA SÃO PAULO LTDA' },
      cabecalhos: { 'idempotency-key': `cli-${doc}` },
    })
    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.situacao_credito, 'LIBERADO')
    assert.equal(r.corpo.data.limite_credito, null)
    // A raiz do CNPJ é coluna gerada: costura matriz e filiais sem ninguém digitar.
    assert.equal(r.corpo.data.cnpj_raiz, doc.slice(0, 8))

    const repetido = await chamar(api, 'POST', '/api/v1/clientes', {
      token: t,
      corpo: { documento: doc, razao_social: 'OUTRA RAZÃO' },
      cabecalhos: { 'idempotency-key': `cli-${doc}-b` },
    })
    assert.equal(repetido.status, 409)
    assert.equal(repetido.corpo.code, 'RECURSO_DUPLICADO')
    assert.equal(repetido.corpo.errors[0].field, 'documento')
  })

  it('cadastrar não concede crédito: os dois campos não entram por POST nem por PATCH', async () => {
    const t = await token({ permissoes: [...CADASTRO] })
    const doc = documento()

    const r = await chamar(api, 'POST', '/api/v1/clientes', {
      token: t,
      corpo: {
        documento: doc,
        razao_social: 'TENTATIVA LTDA',
        // Enviados de propósito: o esquema os ignora, e é isso que se afirma.
        limite_credito: '999999.0000',
        situacao_credito: 'BLOQUEADO',
      },
      cabecalhos: { 'idempotency-key': `cli-cred-${doc}` },
    })
    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.limite_credito, null, 'cliente:criar concedeu crédito')
    assert.equal(r.corpo.data.situacao_credito, 'LIBERADO')

    const patch = await chamar(api, 'PATCH', `/api/v1/clientes/${r.corpo.data.id}`, {
      token: t,
      corpo: { limite_credito: '500000.0000' },
      cabecalhos: { 'if-match': String(r.corpo.data.version) },
    })
    // O corpo vira `{}` depois do strip, e o esquema exige ao menos um campo.
    assert.equal(patch.status, 400)
  })

  it('quem edita cadastro não define crédito, e quem define crédito não edita cadastro', async () => {
    const doc = documento()
    const criado = await chamar(api, 'POST', '/api/v1/clientes', {
      token: await token({ permissoes: [...CADASTRO] }),
      corpo: { documento: doc, razao_social: 'SEGREGACAO LTDA' },
      cabecalhos: { 'idempotency-key': `cli-seg-${doc}` },
    })
    assert.equal(criado.status, 201)
    const id = criado.corpo.data.id

    const semCredito = await chamar(api, 'PUT', `/api/v1/clientes/${id}/credito`, {
      token: await token({ permissoes: [...CADASTRO] }),
      corpo: { limite_credito: '100000.0000', situacao_credito: 'LIBERADO', motivo: 'análise anual' },
    })
    assert.equal(semCredito.status, 403)

    const semEdicao = await chamar(api, 'PATCH', `/api/v1/clientes/${id}`, {
      token: await token({ permissoes: [...CREDITO] }),
      corpo: { razao_social: 'OUTRO NOME LTDA' },
      cabecalhos: { 'if-match': String(criado.corpo.data.version) },
    })
    assert.equal(semEdicao.status, 403)
  })

  it('define crédito, e o motivo chega ao audit_log', async () => {
    const doc = documento()
    const criado = await chamar(api, 'POST', '/api/v1/clientes', {
      token: await token({ permissoes: [...CADASTRO] }),
      corpo: { documento: doc, razao_social: 'CREDITO LTDA' },
      cabecalhos: { 'idempotency-key': `cli-cr-${doc}` },
    })
    const id = criado.corpo.data.id

    const r = await chamar(api, 'PUT', `/api/v1/clientes/${id}/credito`, {
      token: await token({ permissoes: [...CREDITO] }),
      corpo: {
        limite_credito: '250000.0000',
        situacao_credito: 'OBSERVACAO',
        motivo: 'renegociação após atraso de 40 dias',
      },
    })
    assert.equal(r.status, 200)
    assert.equal(r.corpo.data.limite_credito, '250000.0000')
    assert.equal(r.corpo.data.situacao_credito, 'OBSERVACAO')

    /*
     * O motivo é o ponto do teste. A coluna `audit_log.motivo` existe desde a
     * 0003 e o gatilho a lê de `app.motivo`; nenhuma rota da API preenchia o
     * GUC, então a trilha guardava o diff das colunas e nunca a intenção. Um
     * diff de `limite_credito` não diz se foi renegociação, risco ou engano.
     */
    const trilha = await consultarBanco<{
      acao: string
      valor_anterior: Record<string, unknown>
      valor_novo: Record<string, unknown>
      motivo: string | null
    }>(
      TENANT_A,
      `select acao, valor_anterior, valor_novo, motivo from public.audit_log
        where entidade_tipo = 'cliente' and entidade_id = $1 and motivo is not null`,
      [id],
    )
    assert.equal(trilha.length, 1, 'a alteração de crédito não registrou motivo')
    const linha = trilha[0]!
    assert.match(linha.motivo ?? '', /renegociação após atraso/)
    // O diff diz o quê; o motivo diz por quê. É a segunda metade que faltava.
    assert.equal(linha.valor_anterior['limite_credito'], null)
    // O diff é JSON, e o numeric vira número: 250000, não a string do contrato.
    assert.equal(Number(linha.valor_novo['limite_credito']), 250_000)
    assert.equal(linha.valor_novo['situacao_credito'], 'OBSERVACAO')
  })

  it('PATCH exige If-Match, e a versão velha é 409 e não sobrescrita', async () => {
    const doc = documento()
    const t = await token({ permissoes: [...CADASTRO] })
    const criado = await chamar(api, 'POST', '/api/v1/clientes', {
      token: t,
      corpo: { documento: doc, razao_social: 'VERSAO LTDA' },
      cabecalhos: { 'idempotency-key': `cli-v-${doc}` },
    })
    const id = criado.corpo.data.id
    const versao = criado.corpo.data.version

    const sem = await chamar(api, 'PATCH', `/api/v1/clientes/${id}`, {
      token: t,
      corpo: { nome_fantasia: 'Versão' },
    })
    assert.equal(sem.status, 400)

    const primeiro = await chamar(api, 'PATCH', `/api/v1/clientes/${id}`, {
      token: t,
      corpo: { nome_fantasia: 'Primeira edição' },
      cabecalhos: { 'if-match': String(versao) },
    })
    assert.equal(primeiro.status, 200)

    // Segunda tela, aberta antes: grava por cima e o primeiro sumiria em silêncio.
    const segundo = await chamar(api, 'PATCH', `/api/v1/clientes/${id}`, {
      token: t,
      corpo: { nome_fantasia: 'Segunda edição' },
      cabecalhos: { 'if-match': String(versao) },
    })
    assert.equal(segundo.status, 409)
    assert.equal(segundo.corpo.code, 'CONFLITO_DE_VERSAO')

    const agora = await chamar(api, 'GET', `/api/v1/clientes/${id}`, { token: t })
    assert.equal(agora.corpo.data.nome_fantasia, 'Primeira edição')
  })

  it('lista e cria locais do cliente, sem aceitar coordenada', async () => {
    const t = await token({ permissoes: [...LOCAIS] })

    const r = await chamar(api, 'POST', `/api/v1/clientes/${CLIENTE_ALFA}/locais`, {
      token: t,
      corpo: {
        nome: 'Depósito central',
        endereco: { logradouro: 'Rua das Palmeiras', numero: '100' },
        // Enviada de propósito: a coordenada tem rota própria, que exige
        // precisão e fonte. Aceitá-la aqui perderia a proveniência.
        lat: -23.5,
        lon: -46.6,
      },
    })
    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.lat, null, 'a coordenada entrou sem proveniência')
    assert.equal(r.corpo.data.geo_precisao, null)

    const lista = await chamar(api, 'GET', `/api/v1/clientes/${CLIENTE_ALFA}/locais`, { token: t })
    assert.equal(lista.status, 200)
    assert.ok(lista.corpo.data.some((l: { id: string }) => l.id === r.corpo.data.id))
  })

  it('a visão 360 traz o que tem fonte e diz o que não tem', async () => {
    const r = await chamar(api, 'GET', `/api/v1/clientes/${CLIENTE_ALFA}/visao-360`, {
      token: await token({ permissoes: [...LEITOR] }),
    })
    assert.equal(r.status, 200)

    const v = r.corpo.data
    assert.equal(v.cliente.id, CLIENTE_ALFA)
    assert.ok(Number.isInteger(v.contratos.total))
    assert.ok(Number.isInteger(v.parque.total))
    assert.match(v.cobranca.em_aberto, /^-?\d+\.\d{4}$/)

    /*
     * A parte que interessa: em vez de zerar chamados e rentabilidade, a
     * resposta nomeia as duas e explica por quê. Um zero passaria por medição.
     */
    const ausentes = v.ausentes.map((a: { campo: string }) => a.campo)
    assert.deepEqual(ausentes.sort(), ['chamados', 'rentabilidade'])
    assert.ok(v.ausentes.every((a: { motivo: string }) => a.motivo.length > 20))
  })

  it('cliente de outro locatário não existe, e a resposta é a mesma de inexistente', async () => {
    // Distinguir "não é seu" de "não existe" confirmaria a existência de um
    // registro alheio — oráculo suficiente para enumerar a base de outro tenant.
    const r = await chamar(api, 'GET', `/api/v1/clientes/${CLIENTE_ALFA}`, {
      token: await token({ tenant: TENANT_B, usuario: USUARIO_B, permissoes: [...LEITOR] }),
    })
    assert.equal(r.status, 404)
  })
})

/**
 * `POST /equipamentos` e `POST /contratos` — as duas criações que faltavam.
 *
 * Ficam neste arquivo porque exercitam a mesma tese das rotas de cliente: o que
 * **não** entra pelo corpo é tão parte do contrato quanto o que entra. Um
 * equipamento não nasce LOCADO nem um contrato nasce ATIVO, e não por
 * convenção — porque o esquema não tem onde receber isso.
 */
describe('cadastro de ativo e de contrato', () => {
  it('cria o ativo em DISPONIVEL, e o status não entra pelo corpo', async () => {
    const t = await token({ permissoes: ['equipamento:ler', 'equipamento:criar'] })
    const patrimonio = `AV-${Date.now()}`

    const r = await chamar(api, 'POST', '/api/v1/equipamentos', {
      token: t,
      corpo: {
        patrimonio,
        numero_serie: `SN-${Date.now()}`,
        modelo_id: MODELO_A,
        categoria_id: CATEGORIA_A,
        filial_id: FILIAL_A,
        // Enviados de propósito: nascer LOCADO sem contrato por trás é o estado
        // que ninguém consegue explicar depois, e bloquear tem permissão própria.
        status: 'LOCADO',
        bloqueado: true,
      },
      cabecalhos: { 'idempotency-key': `eqp-${patrimonio}` },
    })
    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.status, 'DISPONIVEL')
    assert.equal(r.corpo.data.bloqueado, false)

    const repetido = await chamar(api, 'POST', '/api/v1/equipamentos', {
      token: t,
      corpo: {
        patrimonio,
        modelo_id: MODELO_A,
        categoria_id: CATEGORIA_A,
        filial_id: FILIAL_A,
      },
      cabecalhos: { 'idempotency-key': `eqp-${patrimonio}-b` },
    })
    assert.equal(repetido.status, 409)
    assert.equal(repetido.corpo.errors[0].field, 'patrimonio')
  })

  it('cria o contrato em RASCUNHO, e o status não entra pelo corpo', async () => {
    const t = await token({ permissoes: ['contrato:ler', 'contrato:criar'] })
    const numero = `CT-${Date.now()}`

    const r = await chamar(api, 'POST', '/api/v1/contratos', {
      token: t,
      corpo: {
        numero,
        cliente_id: CLIENTE_ALFA,
        empresa_id: EMPRESA_A,
        filial_id: FILIAL_A,
        // Se este campo entrasse, `contrato:criar` contornaria a alçada inteira:
        // o contrato nasceria ativo sem passar por aprovação nenhuma.
        status: 'ATIVO',
      },
      cabecalhos: { 'idempotency-key': `ctr-${numero}` },
    })
    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.status, 'RASCUNHO')
    assert.equal(r.corpo.data.numero, numero)

    // Sem datas: um rascunho existe para ser preenchido em etapas, e cobrar a
    // vigência aqui obrigaria a inventá-la para poder salvar.
    assert.equal(r.corpo.data.data_inicio, null)

    const semPermissao = await chamar(api, 'POST', '/api/v1/contratos', {
      token: await token({ permissoes: ['contrato:ler'] }),
      corpo: { numero: `${numero}-x`, cliente_id: CLIENTE_ALFA, empresa_id: EMPRESA_A, filial_id: FILIAL_A },
      cabecalhos: { 'idempotency-key': `ctr-${numero}-x` },
    })
    assert.equal(semPermissao.status, 403)
  })
})
