import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  APROVADOR_N2,
  chamar,
  chaveIdempotencia,
  consultarBanco,
  EQUIP_LIVRE_2,
  subirApi,
  TECNICO_COM_LOGIN,
  TECNICO_SEM_LOGIN,
  token,
  TENANT_A,
  USUARIO_A,
  type Servidor,
} from './apoio.js'

/**
 * As três ações de OS que faltavam: atribuir, reabrir e a alçada de custo.
 *
 * A alçada em si é provada no banco (`26_mnt_alcada_custo_os.sql`), inclusive a
 * ordem dos gatilhos. Aqui se prova o que só existe na API:
 *
 *  · atribuir troca o técnico sem mexer na janela de atendimento — se fosse
 *    `agendar`, trocar o técnico de uma ordem já marcada exigiria reenviar a
 *    data, e quem despacha não negocia a janela;
 *  · reabrir **cria** uma ordem nova vinculada em vez de reescrever a
 *    validada. Reescrever faria duas visitas virarem uma, e a comparação entre
 *    elas — que é o que diz se o conserto resolveu — deixaria de existir;
 *  · `os:custo_aprovar` é conferida pelo corpo, não pelo decorador: a maioria
 *    das ordens é barata, e exigi-la na rota obrigaria todo supervisor a
 *    tê-la para validar qualquer coisa.
 */

let api: Servidor

const BASE = ['os:ler', 'os:criar', 'os:triar', 'os:agendar', 'os:executar', 'os:concluir'] as const

const comTudo = () =>
  token({
    tenant: TENANT_A,
    usuario: USUARIO_A,
    permissoes: [...BASE, 'os:validar', 'os:cancelar', 'os:atribuir', 'os:reabrir'],
  })

const SINTOMA = 'ruido metalico no mecanismo de traccao ao imprimir duplex'

async function abrir(tk: string) {
  const r = await chamar(api, 'POST', '/api/v1/ordens-servico', {
    token: tk,
    corpo: { equipamento_id: EQUIP_LIVRE_2, descricao: SINTOMA },
  })
  assert.equal(r.status, 201, `abertura recusada: ${JSON.stringify(r.corpo)}`)
  return r.corpo.data
}

async function ate(tk: string, id: string, ...passos: [string, unknown?][]) {
  for (const [acao, corpo] of passos) {
    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${id}/${acao}`, { token: tk, corpo })
    assert.equal(r.status, 200, `${acao} recusado: ${JSON.stringify(r.corpo)}`)
  }
}

const CONCLUSAO = {
  causa_raiz: 'desgaste natural da engrenagem de traccao',
  solucao: 'substituicao do conjunto de traccao',
  causa_responsabilidade: 'DESGASTE_NATURAL',
}

before(async () => {
  api = await subirApi()
})
after(async () => {
  await api.fechar()
})

describe('atribuição de técnico', () => {
  it('troca o responsável sem exigir a data de atendimento', async () => {
    const tk = await comTudo()
    const os = await abrir(tk)
    await ate(tk, os.id, ['triar', { tipo: 'CORRETIVA', prioridade: 'ALTA' }])

    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/atribuir`, {
      token: tk,
      corpo: { tecnico_id: TECNICO_COM_LOGIN },
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.tecnico_responsavel_id, TECNICO_COM_LOGIN)
    // Nenhuma data foi enviada, e a ordem não foi agendada por tabela.
    assert.equal(r.corpo.data.status, 'TRIAGEM')
  })

  it('atribuir é permissão própria, separada de agendar', async () => {
    const tk = await comTudo()
    const os = await abrir(tk)
    const soAgenda = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['os:ler', 'os:agendar'],
    })

    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/atribuir`, {
      token: soAgenda,
      corpo: { tecnico_id: TECNICO_COM_LOGIN },
    })
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
  })
})

describe('reabertura', () => {
  it('cria uma ordem nova vinculada, e a original fica como estava', async () => {
    const tk = await comTudo()
    const os = await abrir(tk)
    await ate(
      tk,
      os.id,
      ['triar', { tipo: 'CORRETIVA', prioridade: 'ALTA' }],
      ['agendar', { tecnico_id: TECNICO_SEM_LOGIN }],
      ['iniciar'],
      ['concluir', CONCLUSAO],
      ['validar'],
    )

    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/reabrir`, {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('reabrir') },
      corpo: { motivo: 'mesmo ruido voltou em menos de quinze dias' },
    })
    assert.equal(r.status, 201, JSON.stringify(r.corpo))

    const nova = r.corpo.data
    assert.notEqual(nova.id, os.id)
    assert.equal(nova.status, 'ABERTA')
    assert.match(nova.descricao, /Reabertura: mesmo ruido voltou/)

    const linhas = await consultarBanco<{ id: string; status: string; os_origem_id: string | null }>(
      TENANT_A,
      `select id, status::text as status, os_origem_id from public.ordem_servico where id in ($1, $2)`,
      [os.id, nova.id],
    )
    const original = linhas.find((l) => l.id === os.id)!
    const filha = linhas.find((l) => l.id === nova.id)!

    /*
     * A original guarda o custo e o tempo do primeiro atendimento. Reescrevê-la
     * faria duas visitas virarem uma, e a comparação entre as duas — que é o
     * que responde se o conserto resolveu — deixaria de existir por construção.
     */
    assert.equal(original.status, 'VALIDADA')
    assert.equal(filha.os_origem_id, os.id)
  })

  it('ordem que não foi validada não reabre', async () => {
    const tk = await comTudo()
    const os = await abrir(tk)
    await ate(tk, os.id, ['triar', { tipo: 'CORRETIVA', prioridade: 'MEDIA' }])

    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/reabrir`, {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('reabrir') },
      corpo: { motivo: 'tentativa de reabrir ordem em andamento' },
    })
    // Ordem em andamento se retoma; ordem cancelada não reabre.
    assert.equal(r.status, 422, JSON.stringify(r.corpo))
  })
})

describe('alçada de custo na validação', () => {
  it('ordem barata valida sem a permissão de aprovar custo', async () => {
    const tk = await comTudo()
    const os = await abrir(tk)
    await ate(
      tk,
      os.id,
      ['triar', { tipo: 'CORRETIVA', prioridade: 'MEDIA' }],
      ['agendar', { tecnico_id: TECNICO_SEM_LOGIN }],
      ['iniciar'],
      ['concluir', CONCLUSAO],
    )

    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/validar`, { token: tk })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
  })

  it('ordem cara sem a permissão é recusada, e a recusa diz o que fazer', async () => {
    const tk = await comTudo()
    const os = await abrir(tk)
    await ate(
      tk,
      os.id,
      ['triar', { tipo: 'CORRETIVA', prioridade: 'ALTA' }],
      ['agendar', { tecnico_id: TECNICO_SEM_LOGIN }],
      ['iniciar'],
      ['concluir', { ...CONCLUSAO, custo_terceiros: '40000.0000' }],
    )

    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/validar`, { token: tk })

    /*
     * A massa configura alçada CUSTO_OS, então a guarda morde. Sem configuração
     * nenhuma a validação passaria — é a convenção que a 0019 já usa para
     * pagamento, e travar por omissão faria as pessoas desligarem a regra em
     * vez de configurá-la.
     */
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
    assert.ok(Array.isArray(r.corpo.acoes_sugeridas) && r.corpo.acoes_sugeridas.length > 0)
    assert.match(JSON.stringify(r.corpo), /alçada|alcada/i)

    const antes = await consultarBanco<{ status: string }>(
      TENANT_A,
      `select status::text as status from public.ordem_servico where id = $1`,
      [os.id],
    )
    assert.equal(antes[0]!.status, 'CONCLUIDA')
  })

  it('com a permissão e alçada suficiente, valida', async () => {
    const tk = await comTudo()
    const os = await abrir(tk)
    await ate(
      tk,
      os.id,
      ['triar', { tipo: 'CORRETIVA', prioridade: 'ALTA' }],
      ['agendar', { tecnico_id: TECNICO_SEM_LOGIN }],
      ['iniciar'],
      ['concluir', { ...CONCLUSAO, custo_terceiros: '40000.0000' }],
    )

    const gerente = await token({
      tenant: TENANT_A,
      usuario: APROVADOR_N2,
      permissoes: ['os:ler', 'os:validar', 'os:custo_aprovar'],
    })
    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/validar`, { token: gerente })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.status, 'VALIDADA')
  })
})
