import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  chamar,
  chaveIdempotencia,
  CLIENTE_ALFA,
  EMPRESA_A,
  FILIAL_A,
  subirApi,
  token,
  TENANT_A,
  USUARIO_A,
  type Servidor,
} from './apoio.js'

/**
 * Ciclo de vida do contrato.
 *
 * O caso que carrega o módulo é o da **permissão por transição**. Com um
 * `PATCH status`, as onze permissões do Anexo C viram a mesma coisa na
 * prática: quem pudesse mudar o status levaria o contrato de rascunho a ativo
 * sozinho, sem aprovação de gestor e sem assinatura. Há um teste que prova a
 * separação de ponta a ponta.
 *
 * A máquina em si é provada no banco, em `21_ctr_ciclo_contrato.sql`. Aqui se
 * prova que a API não a contorna.
 */

let api: Servidor
let n = 0

const TODAS = [
  'contrato:ler',
  'contrato:criar',
  'contrato:editar',
  'contrato:aprovar',
  'contrato:ativar',
  'contrato:suspender',
  'contrato:retomar',
  'contrato:renovar',
  'contrato:encerrar',
  'contrato:distratar',
  'contrato:cancelar',
  'contrato:item_alocar',
] as const

const comTudo = () => token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: [...TODAS] })

async function rascunho(tk: string) {
  n += 1
  const r = await chamar(api, 'POST', '/api/v1/contratos', {
    token: tk,
    // RN-029: criação de contrato tem efeito financeiro e exige a chave.
    cabecalhos: { 'Idempotency-Key': chaveIdempotencia('ciclo') },
    corpo: {
      numero: `CICLO-${Date.now()}-${n}`,
      empresa_id: EMPRESA_A,
      filial_id: FILIAL_A,
      cliente_id: CLIENTE_ALFA,
      data_inicio: '2026-01-01',
      data_fim: '2026-12-31',
    },
  })
  assert.equal(r.status, 201, `criação recusada: ${JSON.stringify(r.corpo)}`)
  return r.corpo.data
}

async function acao(tk: string, id: string, nome: string, corpo?: unknown) {
  return chamar(api, 'POST', `/api/v1/contratos/${id}/${nome}`, { token: tk, corpo })
}

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('transições', () => {
  it('contrato sem item não é submetido', async () => {
    /*
     * Contrato sem item em aprovação é um pedido para o gestor aprovar nada:
     * ele aprova, o contrato ativa, e a primeira competência fecha em zero sem
     * ninguém saber por quê.
     */
    const tk = await comTudo()
    const c = await rascunho(tk)
    const r = await acao(tk, c.id, 'submeter')

    assert.equal(r.status, 422)
    /*
     * A recusa precisa ser legível. Nomear a constraint no gatilho tira o
     * "regra não identificada", e ligá-la à tabela de mensagens é o que
     * transforma o nome interno em frase que o operador usa.
     */
    assert.match(r.corpo.title, /contrato sem item/i)
    assert.ok((r.corpo.acoes_sugeridas ?? []).length > 0, 'recusa sem saída vira chamado')
  })

  it('transição fora do Anexo B.2 é recusada com código próprio', async () => {
    const tk = await comTudo()
    const c = await rascunho(tk)
    // RASCUNHO → ATIVO não existe: falta aprovação e assinatura.
    const r = await acao(tk, c.id, 'ativar')

    assert.equal(r.status, 422)
    assert.equal(r.corpo.code, 'TRANSICAO_INVALIDA')
  })

  it('suspender sem motivo é recusado na entrada', async () => {
    const tk = await comTudo()
    const c = await rascunho(tk)
    const r = await acao(tk, c.id, 'suspender', { motivo: 'x' })
    assert.equal(r.status, 400)
  })
})

describe('permissões por transição', () => {
  it('quem aprova não ativa, e quem ativa não aprova', async () => {
    /*
     * A separação que um `PATCH status` apagaria. Aprovar é decisão comercial
     * com alçada; ativar é o ato que coloca equipamento em campo e começa a
     * faturar. Uma única permissão de "mudar status" faria as duas serem a
     * mesma coisa.
     */
    const tk = await comTudo()
    const c = await rascunho(tk)

    const soAprova = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['contrato:ler', 'contrato:aprovar'],
    })
    const soAtiva = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['contrato:ler', 'contrato:ativar'],
    })

    assert.equal((await acao(soAprova, c.id, 'ativar')).status, 403)
    assert.equal((await acao(soAtiva, c.id, 'aprovar')).status, 403)
  })

  it('ler contrato não muda estado nenhum', async () => {
    const soLer = await token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['contrato:ler'] })
    const c = await rascunho(await comTudo())

    for (const nome of [
      'submeter',
      'aprovar',
      'reprovar',
      'ativar',
      'suspender',
      'retomar',
      'renovar',
      'encerrar',
      'distratar',
      'cancelar',
    ]) {
      const r = await acao(soLer, c.id, nome, { motivo: 'motivo suficientemente longo' })
      assert.equal(r.status, 403, `${nome} passou com permissão apenas de leitura`)
    }
  })
})

describe('cancelamento', () => {
  it('rascunho sem entrega cancela', async () => {
    const tk = await comTudo()
    const c = await rascunho(tk)
    const r = await acao(tk, c.id, 'cancelar', { motivo: 'cliente desistiu antes da assinatura' })

    assert.equal(r.status, 200, `recusado: ${JSON.stringify(r.corpo)}`)
    assert.equal(r.corpo.data.status, 'CANCELADO')
  })
})

describe('o estado de partida não é conferido na aplicação', () => {
  it('a recusa vem do banco, com o código traduzido', async () => {
    /*
     * A máquina é gatilho. Conferir também aqui criaria um segundo lugar para
     * a regra divergir — com o segundo valendo só para quem passa por esta
     * API, e ainda perdendo a corrida com duas requisições simultâneas.
     *
     * O que a API garante é que a recusa do banco chega legível: `23514` sem
     * nome de constraint viraria "regra não identificada", que é recusa certa
     * e inutilizável para quem a lê.
     */
    const tk = await comTudo()
    const c = await rascunho(tk)
    const r = await acao(tk, c.id, 'encerrar', { motivo: 'encerramento fora de ordem' })

    assert.equal(r.status, 422)
    assert.doesNotMatch(JSON.stringify(r.corpo), /não identificada/)
    assert.doesNotMatch(JSON.stringify(r.corpo), /contrato_/, 'nome interno de constraint vazou')
  })
})
