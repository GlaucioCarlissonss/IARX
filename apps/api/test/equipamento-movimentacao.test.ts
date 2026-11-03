import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATEGORIA_A,
  chamar,
  chaveIdempotencia,
  CLIENTE_ALFA,
  consultarBanco,
  corpoAlocacao,
  EMPRESA_A,
  FILIAL_A,
  FILIAL_A2,
  MODELO_A,
  subirApi,
  TENANT_A,
  token,
  USUARIO_A,
  type Servidor,
} from './apoio.js'

/**
 * Movimentação, transferência e baixa de equipamento.
 *
 * A máquina de estados em si é provada no banco (`23_eqp_ciclo_equipamento.sql`)
 * e o razão append-only em `24_eqp_movimentacao.sql`. O que se prova aqui é o
 * que só existe na API:
 *
 *  · o estado resultante é **derivado do tipo**, nunca enviado pelo cliente —
 *    é o ponto de autorização do módulo, porque `equipamento:movimentar` é a
 *    permissão mais distribuída do sistema e `equipamento:baixar` é das mais
 *    restritas;
 *  · as três permissões do parque são realmente três, e não uma;
 *  · o efeito da entrega e do recebimento sobre o item de contrato, que é o
 *    que faz a cobrança começar e terminar nas datas certas;
 *  · a recusa diz o que fazer, em vez de só dizer não.
 *
 * Cada caso cria o próprio ativo. A suíte da API semeia sem recriar o banco, e
 * um teste que move um equipamento da massa comum deixa os outros arquivos
 * dependendo da ordem de execução.
 */

let api: Servidor
let n = 0

const MOVER = () => token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['equipamento:ler', 'equipamento:criar', 'equipamento:movimentar'] })
const TRANSFERIR = () =>
  token({
    tenant: TENANT_A,
    usuario: USUARIO_A,
    permissoes: ['equipamento:ler', 'equipamento:criar', 'equipamento:transferir'],
  })
const ACEITAR = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['equipamento:ler', 'equipamento:transferencia_aceitar'] })
const BAIXAR = () =>
  token({
    tenant: TENANT_A,
    usuario: USUARIO_A,
    permissoes: ['equipamento:ler', 'equipamento:criar', 'equipamento:baixar'],
  })

async function novoAtivo(tk: string): Promise<{ id: string; version: number }> {
  n += 1
  const r = await chamar(api, 'POST', '/api/v1/equipamentos', {
    token: tk,
    cabecalhos: { 'Idempotency-Key': chaveIdempotencia('eqp-mov') },
    corpo: {
      patrimonio: `MOV-${Date.now()}-${n}`,
      modelo_id: MODELO_A,
      categoria_id: CATEGORIA_A,
      filial_id: FILIAL_A,
    },
  })
  assert.equal(r.status, 201, `cadastro recusado: ${JSON.stringify(r.corpo)}`)
  return { id: r.corpo.data.id, version: r.corpo.data.version }
}

async function mover(tk: string, id: string, corpo: unknown) {
  return chamar(api, 'POST', `/api/v1/equipamentos/${id}/movimentacoes`, {
    token: tk,
    cabecalhos: { 'Idempotency-Key': chaveIdempotencia('mov') },
    corpo,
  })
}

async function statusDe(id: string): Promise<string> {
  const linhas = await consultarBanco<{ status: string }>(
    TENANT_A,
    `select status from public.equipamento where id = $1`,
    [id],
  )
  return linhas[0]!.status
}

before(async () => {
  api = await subirApi()
})
after(async () => {
  await api.fechar()
})

describe('movimentação de equipamento', () => {
  it('deriva o estado do tipo e ignora o status que o cliente mandar', async () => {
    const tk = await MOVER()
    const { id } = await novoAtivo(tk)

    /*
     * O corpo tenta levar o ativo direto a BAIXADO, que é o estado com a
     * permissão mais restrita do módulo. Se `status` fosse aceito, quem tem
     * `equipamento:movimentar` — no Anexo C, o técnico de campo — baixaria
     * qualquer ativo do parque.
     */
    const r = await mover(tk, id, {
      tipo: 'ENVIO_MANUTENCAO',
      status: 'BAIXADO',
      status_resultante: 'BAIXADO',
    })

    assert.equal(r.status, 201, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.status_resultante, 'EM_MANUTENCAO')
    assert.equal(await statusDe(id), 'EM_MANUTENCAO')
  })

  it('recusa a movimentação que não cabe no estado, dizendo de onde ela parte', async () => {
    const tk = await MOVER()
    const { id } = await novoAtivo(tk)

    const r = await mover(tk, id, { tipo: 'RETORNO' })

    assert.equal(r.status, 422, JSON.stringify(r.corpo))
    // A recusa responde a pergunta que o operador tem de verdade — "então o
    // que eu faço antes?" — em vez de mandá-lo abrir o Anexo B.2.
    assert.match(r.corpo.detail, /LOCADO/)
    assert.match(r.corpo.detail, /DISPONIVEL/)
  })

  it('volta da manutenção para onde o contrato diz, não para onde o operador digita', async () => {
    const tkMover = await MOVER()
    const tkTudo = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['contrato:criar', 'contrato:editar', 'contrato:item_alocar', 'contrato:aprovar', 'contrato:ativar'],
    })
    const { id } = await novoAtivo(tkMover)

    // Ativo sem contrato: volta para DISPONIVEL.
    await mover(tkMover, id, { tipo: 'ENVIO_MANUTENCAO' })
    const semContrato = await mover(tkMover, id, { tipo: 'RETORNO_MANUTENCAO' })
    assert.equal(semContrato.status, 201, JSON.stringify(semContrato.corpo))
    assert.equal(semContrato.corpo.data.status_resultante, 'DISPONIVEL')

    // Agora com item de contrato vigente: volta para LOCADO.
    const item = await alocarEEntregar(tkTudo, tkMover, id)
    assert.ok(item, 'não foi possível preparar o ativo locado')
    assert.equal(await statusDe(id), 'LOCADO')

    await mover(tkMover, id, { tipo: 'ENVIO_MANUTENCAO' })
    const comContrato = await mover(tkMover, id, { tipo: 'RETORNO_MANUTENCAO' })
    assert.equal(comContrato.status, 201, JSON.stringify(comContrato.corpo))
    /*
     * O modo de falha que isto impede é o mais caro do eixo: a máquina volta do
     * conserto, alguém marca DISPONÍVEL por hábito, e ela entra na base
     * alocável enquanto está na mesa do cliente. O gatilho da 0031 recusaria —
     * derivar aqui faz com que ninguém chegue a produzir a incoerência.
     */
    assert.equal(comContrato.corpo.data.status_resultante, 'LOCADO')
  })

  it('a entrega inicia a cobrança e o recebimento a encerra', async () => {
    const tkMover = await MOVER()
    const tkTudo = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['contrato:criar', 'contrato:editar', 'contrato:item_alocar', 'contrato:aprovar', 'contrato:ativar'],
    })
    const { id } = await novoAtivo(tkMover)
    const itemId = await alocarEEntregar(tkTudo, tkMover, id)
    assert.ok(itemId)

    // Coluna "Efeitos" do Anexo B.2: EM_TRÂNSITO_ENTREGA → LOCADO inicia o
    // faturamento na data efetiva da entrega.
    let item = await consultarBanco<{ status: string }>(
      TENANT_A,
      `select status from public.contrato_item where id = $1`,
      [itemId],
    )
    assert.equal(item[0]!.status, 'ATIVO')

    await mover(tkMover, id, { tipo: 'RETORNO', contrato_item_id: itemId })
    await mover(tkMover, id, { tipo: 'RETORNO', contrato_item_id: itemId })

    item = await consultarBanco<{ status: string }>(
      TENANT_A,
      `select status from public.contrato_item where id = $1`,
      [itemId],
    )
    assert.equal(item[0]!.status, 'ENCERRADO')
    assert.equal(await statusDe(id), 'EM_INSPECAO')
  })

  it('recusa item de contrato que não é do equipamento movimentado', async () => {
    const tkMover = await MOVER()
    const tkTudo = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['contrato:criar', 'contrato:editar', 'contrato:item_alocar', 'contrato:aprovar', 'contrato:ativar'],
    })
    const alvo = await novoAtivo(tkMover)
    const outro = await novoAtivo(tkMover)
    const itemDoOutro = await alocarEEntregar(tkTudo, tkMover, outro.id)
    assert.ok(itemDoOutro)

    await mover(tkMover, alvo.id, { tipo: 'ENVIO_MANUTENCAO' })
    const r = await mover(tkMover, alvo.id, {
      tipo: 'RETORNO_MANUTENCAO',
      contrato_item_id: itemDoOutro,
    })

    // Sem esta conferência, movimentar um ativo encerraria a cobrança de outro.
    assert.ok(r.status >= 400, `aceitou item de outro ativo: ${JSON.stringify(r.corpo)}`)
  })

  it('a timeline do ativo vem do mais recente para o mais antigo', async () => {
    const tk = await MOVER()
    const { id } = await novoAtivo(tk)

    await mover(tk, id, { tipo: 'ENVIO_MANUTENCAO' })
    await mover(tk, id, { tipo: 'RETORNO_MANUTENCAO' })

    const r = await chamar(api, 'GET', `/api/v1/equipamentos/${id}/movimentacoes`, { token: tk })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.length, 2)
    assert.equal(r.corpo.data[0].tipo, 'RETORNO_MANUTENCAO')
    assert.equal(r.corpo.data[1].tipo, 'ENVIO_MANUTENCAO')
  })
})

describe('transferência entre filiais', () => {
  it('nasce pendente, e o aceite é que muda a filial do ativo', async () => {
    const tkT = await TRANSFERIR()
    const tkA = await ACEITAR()
    const { id } = await novoAtivo(tkT)

    const t = await chamar(api, 'POST', `/api/v1/equipamentos/${id}/transferir`, {
      token: tkT,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('transf') },
      corpo: { destino_filial_id: FILIAL_A2, documento_ref: 'ROM-TRANSF-1' },
    })
    assert.equal(t.status, 201, JSON.stringify(t.corpo))
    assert.equal(t.corpo.data.aceite_em, null)
    assert.equal(await statusDe(id), 'EM_TRANSITO_ENTREGA')

    /*
     * Em trânsito o ativo não conta para ninguém: a origem já não pode alocá-lo
     * e o destino ainda não. É o que impede duas filiais contarem a mesma
     * máquina enquanto ela está na estrada.
     */
    const filialAntes = await consultarBanco<{ filial_id: string }>(
      TENANT_A,
      `select filial_id from public.equipamento where id = $1`,
      [id],
    )
    assert.equal(filialAntes[0]!.filial_id, FILIAL_A)

    const a = await chamar(api, 'POST', `/api/v1/transferencias/${t.corpo.data.id}/aceitar`, {
      token: tkA,
    })
    assert.equal(a.status, 200, JSON.stringify(a.corpo))
    assert.ok(a.corpo.data.aceite_em)
    assert.equal(await statusDe(id), 'DISPONIVEL')

    const filialDepois = await consultarBanco<{ filial_id: string }>(
      TENANT_A,
      `select filial_id from public.equipamento where id = $1`,
      [id],
    )
    assert.equal(filialDepois[0]!.filial_id, FILIAL_A2)
  })

  it('transferir e aceitar são permissões diferentes', async () => {
    const tkT = await TRANSFERIR()
    const { id } = await novoAtivo(tkT)

    const t = await chamar(api, 'POST', `/api/v1/equipamentos/${id}/transferir`, {
      token: tkT,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('transf') },
      corpo: { destino_filial_id: FILIAL_A2 },
    })
    assert.equal(t.status, 201, JSON.stringify(t.corpo))

    /*
     * RN-005 só tem sentido se quem envia não puder dar o aceite por quem
     * recebe. Com as duas permissões colapsadas, a conferência na doca vira
     * formalidade que o remetente assina sozinho.
     */
    const a = await chamar(api, 'POST', `/api/v1/transferencias/${t.corpo.data.id}/aceitar`, {
      token: tkT,
    })
    assert.equal(a.status, 403, JSON.stringify(a.corpo))
  })

  it('recusa transferência para a própria filial', async () => {
    const tk = await TRANSFERIR()
    const { id } = await novoAtivo(tk)

    const r = await chamar(api, 'POST', `/api/v1/equipamentos/${id}/transferir`, {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('transf') },
      corpo: { destino_filial_id: FILIAL_A },
    })
    // Não teria efeito e deixaria um aceite pendente que ninguém fecharia.
    assert.equal(r.status, 422, JSON.stringify(r.corpo))
  })

  it('o aceite repetido devolve o estado, não um conflito', async () => {
    const tkT = await TRANSFERIR()
    const tkA = await ACEITAR()
    const { id } = await novoAtivo(tkT)

    const t = await chamar(api, 'POST', `/api/v1/equipamentos/${id}/transferir`, {
      token: tkT,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('transf') },
      corpo: { destino_filial_id: FILIAL_A2 },
    })
    const primeiro = await chamar(api, 'POST', `/api/v1/transferencias/${t.corpo.data.id}/aceitar`, { token: tkA })
    const segundo = await chamar(api, 'POST', `/api/v1/transferencias/${t.corpo.data.id}/aceitar`, { token: tkA })

    assert.equal(segundo.status, 200, JSON.stringify(segundo.corpo))
    // Quem aceitou foi quem aceitou primeiro: o segundo aceite não reescreve a data.
    assert.equal(segundo.corpo.data.aceite_em, primeiro.corpo.data.aceite_em)
  })
})

describe('baixa patrimonial', () => {
  it('movimentar não baixa', async () => {
    const tkMover = await MOVER()
    const { id } = await novoAtivo(tkMover)

    const r = await chamar(api, 'POST', `/api/v1/equipamentos/${id}/baixar`, {
      token: tkMover,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('baixa') },
      corpo: { motivo: 'fim de vida util do equipamento' },
    })
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
  })

  it('baixa o ativo limpo e grava a linha no razão', async () => {
    const tk = await BAIXAR()
    const { id } = await novoAtivo(tk)

    const r = await chamar(api, 'POST', `/api/v1/equipamentos/${id}/baixar`, {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('baixa') },
      corpo: { motivo: 'fim de vida util do equipamento' },
    })
    assert.equal(r.status, 201, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.tipo, 'BAIXA')
    assert.equal(await statusDe(id), 'BAIXADO')
  })

  it('não baixa ativo com alocação vigente, e explica o que falta', async () => {
    const tkMover = await MOVER()
    const tkBaixar = await BAIXAR()
    const tkTudo = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['contrato:criar', 'contrato:editar', 'contrato:item_alocar', 'contrato:aprovar', 'contrato:ativar'],
    })
    const { id } = await novoAtivo(tkMover)
    assert.ok(await alocarEEntregar(tkTudo, tkMover, id))

    const r = await chamar(api, 'POST', `/api/v1/equipamentos/${id}/baixar`, {
      token: tkBaixar,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('baixa') },
      corpo: { motivo: 'engano do operador que confundiu o patrimonio' },
    })

    assert.ok(r.status >= 400, `baixou ativo locado: ${JSON.stringify(r.corpo)}`)
    /*
     * A recusa chega nomeada porque o gatilho da 0031 levanta com
     * `constraint = 'equipamento_alocado_nao_baixa'`. Sem o nome, o operador
     * leria "a operação viola a regra não identificada" — que é a forma mais
     * rápida de ensinar alguém a ignorar as mensagens do sistema.
     */
    assert.match(JSON.stringify(r.corpo), /contrato|alocad/i)
    assert.equal(await statusDe(id), 'LOCADO')
  })
})

/**
 * Leva um ativo de DISPONIVEL a LOCADO pelo caminho real: contrato, item,
 * ativação, expedição e entrega. Devolve o id do item.
 *
 * Existe porque metade dos casos acima precisa de um ativo locado **de
 * verdade** — com item vigente por trás. Forjar o status direto no banco
 * passaria por cima exatamente das guardas que esses casos existem para provar.
 */
async function alocarEEntregar(tkContrato: string, tkMover: string, equipamentoId: string): Promise<string | null> {
  n += 1
  const c = await chamar(api, 'POST', '/api/v1/contratos', {
    token: tkContrato,
    cabecalhos: { 'Idempotency-Key': chaveIdempotencia('mov-ct') },
    corpo: {
      numero: `MOV-CT-${Date.now()}-${n}`,
      empresa_id: EMPRESA_A,
      filial_id: FILIAL_A,
      cliente_id: CLIENTE_ALFA,
      data_inicio: '2026-01-01',
      data_fim: '2026-12-31',
    },
  })
  if (c.status !== 201) return null

  const i = await chamar(api, 'POST', `/api/v1/contratos/${c.corpo.data.id}/itens`, {
    token: tkContrato,
    cabecalhos: { 'Idempotency-Key': chaveIdempotencia('mov-item') },
    corpo: corpoAlocacao(equipamentoId),
  })
  if (i.status !== 201) return null
  const itemId = i.corpo.data.id

  await chamar(api, 'POST', `/api/v1/contratos/${c.corpo.data.id}/submeter`, { token: tkContrato })
  await chamar(api, 'POST', `/api/v1/contratos/${c.corpo.data.id}/aprovar`, { token: tkContrato })
  await chamar(api, 'POST', `/api/v1/contratos/${c.corpo.data.id}/ativar`, { token: tkContrato })

  // Expedição e entrega: as duas gravam linha no razão, e a segunda é a que
  // inicia a cobrança.
  await mover(tkMover, equipamentoId, { tipo: 'ENTREGA', contrato_item_id: itemId })
  await mover(tkMover, equipamentoId, { tipo: 'ENTREGA', contrato_item_id: itemId })
  return itemId
}
