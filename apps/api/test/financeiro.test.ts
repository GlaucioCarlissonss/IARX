import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EMPRESA_A, chamar, subirApi, token, type Servidor } from './apoio.js'

/**
 * Integração de centro de custo e conta bancária, contra PostgreSQL real.
 *
 * O que estes testes existem para provar, em uma frase: **o dinheiro fecha**.
 * As invariantes moram no banco (migração 0017) e já têm teste de invariante
 * próprio; aqui o que se verifica é o que só aparece atravessando a API — que a
 * recusa do gatilho chega como 422 com uma saída, e não como 500; que o saldo
 * que a lista devolve é o derivado, não um número guardado; que a transferência
 * atravessa o HTTP como duas pernas ou nenhuma.
 */

let api: Servidor

const GESTOR_CENTRO = ['centro_custo:ler', 'centro_custo:gerenciar'] as const
const GESTOR_CONTA = [
  'conta_bancaria:ler',
  'conta_bancaria:gerenciar',
  'conta_bancaria:movimentar',
  'conta_bancaria:transferir',
  'conciliacao:executar',
] as const

let seq = 0
/** Chave nova a cada escrita: a rota é idempotente e reaproveitar replica. */
const chave = () => ({ 'idempotency-key': `fin-${Date.now()}-${++seq}` })

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

async function criarCentro(t: string, corpo: Record<string, unknown>) {
  return chamar(api, 'POST', '/api/v1/centros-custo', { token: t, corpo, cabecalhos: chave() })
}

async function criarConta(t: string, extra: Record<string, unknown> = {}) {
  return chamar(api, 'POST', '/api/v1/contas-bancarias', {
    token: t,
    cabecalhos: chave(),
    corpo: {
      empresa_id: EMPRESA_A,
      banco_codigo: '341',
      agencia: '1234',
      numero: `${900000 + ++seq}`,
      tipo: 'CORRENTE',
      apelido: 'Operação',
      saldo_inicial: '1000.0000',
      data_saldo_inicial: '2026-01-01',
      ...extra,
    },
  })
}

describe('centros de custo', () => {
  it('cria a árvore até o terceiro nível e devolve o nível calculado', async () => {
    const t = await token({ permissoes: [...GESTOR_CENTRO] })

    const raiz = await criarCentro(t, { codigo: `R${++seq}`, nome: 'Administrativo' })
    assert.equal(raiz.status, 201)
    assert.equal(raiz.corpo.data.nivel, 1)

    const n2 = await criarCentro(t, {
      codigo: `R${seq}-TI`,
      nome: 'Tecnologia',
      centro_pai_id: raiz.corpo.data.id,
    })
    assert.equal(n2.corpo.data.nivel, 2)

    const n3 = await criarCentro(t, {
      codigo: `R${seq}-TI-INFRA`,
      nome: 'Infraestrutura',
      centro_pai_id: n2.corpo.data.id,
    })
    assert.equal(n3.corpo.data.nivel, 3)

    // O nível não é coluna: sai de uma CTE recursiva. Guardado na tabela,
    // poderia discordar da cadeia de pais.
    const quarto = await criarCentro(t, {
      codigo: `R${seq}-TI-INFRA-REDE`,
      nome: 'Rede',
      centro_pai_id: n3.corpo.data.id,
    })
    assert.equal(quarto.status, 422)
    assert.equal(quarto.corpo.code, 'REGRA_DE_NEGOCIO')
    // A recusa do gatilho tem de chegar acionável. Um 500 aqui significaria que
    // uma regra de negócio prevista está vazando como defeito.
    assert.ok(quarto.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'ESCOLHER_PAI_MAIS_ALTO'))
  })

  it('recusa inativar centro com subcentro ativo, e diz o que fazer', async () => {
    const t = await token({ permissoes: [...GESTOR_CENTRO] })

    const raiz = await criarCentro(t, { codigo: `I${++seq}`, nome: 'Comercial' })
    const filho = await criarCentro(t, {
      codigo: `I${seq}-SUL`,
      nome: 'Regional Sul',
      centro_pai_id: raiz.corpo.data.id,
    })

    const recusa = await chamar(api, 'POST', `/api/v1/centros-custo/${raiz.corpo.data.id}/inativar`, {
      token: t,
      cabecalhos: { 'if-match': `"${raiz.corpo.data.version}"` },
    })
    assert.equal(recusa.status, 422)
    assert.ok(recusa.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'INATIVAR_FILHOS'))

    // Da folha para a raiz funciona — e é o caminho que torna a extensão do
    // estrago visível antes de acontecer.
    const folha = await chamar(api, 'POST', `/api/v1/centros-custo/${filho.corpo.data.id}/inativar`, {
      token: t,
      cabecalhos: { 'if-match': `"${filho.corpo.data.version}"` },
    })
    assert.equal(folha.status, 200)
    assert.equal(folha.corpo.data.ativo, false)

    const agora = await chamar(api, 'POST', `/api/v1/centros-custo/${raiz.corpo.data.id}/inativar`, {
      token: t,
      cabecalhos: { 'if-match': `"${raiz.corpo.data.version}"` },
    })
    assert.equal(agora.status, 200)
  })

  it('recusa código repetido no mesmo locatário', async () => {
    const t = await token({ permissoes: [...GESTOR_CENTRO] })
    const codigo = `DUP${++seq}`

    assert.equal((await criarCentro(t, { codigo, nome: 'Primeiro' })).status, 201)
    const segundo = await criarCentro(t, { codigo, nome: 'Segundo' })
    assert.equal(segundo.status, 409)
    assert.equal(segundo.corpo.code, 'RECURSO_DUPLICADO')
  })

  it('exige If-Match para editar, e recusa versão velha', async () => {
    const t = await token({ permissoes: [...GESTOR_CENTRO] })
    const c = await criarCentro(t, { codigo: `V${++seq}`, nome: 'Original' })
    const id = c.corpo.data.id

    const semCabecalho = await chamar(api, 'PATCH', `/api/v1/centros-custo/${id}`, {
      token: t,
      corpo: { nome: 'Novo' },
    })
    assert.equal(semCabecalho.status, 400)

    const ok = await chamar(api, 'PATCH', `/api/v1/centros-custo/${id}`, {
      token: t,
      corpo: { nome: 'Renomeado' },
      cabecalhos: { 'if-match': '"1"' },
    })
    assert.equal(ok.status, 200)
    assert.equal(ok.corpo.data.nome, 'Renomeado')
    assert.equal(ok.corpo.data.version, 2)

    // Reenviar a versão 1 é o segundo operador gravando por cima do primeiro.
    const velha = await chamar(api, 'PATCH', `/api/v1/centros-custo/${id}`, {
      token: t,
      corpo: { nome: 'Terceiro nome' },
      cabecalhos: { 'if-match': '"1"' },
    })
    assert.equal(velha.status, 409)
    assert.equal(velha.corpo.code, 'CONFLITO_DE_VERSAO')
  })

  it('ler não dá direito de gerenciar', async () => {
    const leitor = await token({ permissoes: ['centro_custo:ler'] })

    assert.equal((await chamar(api, 'GET', '/api/v1/centros-custo', { token: leitor })).status, 200)

    // A separação existe para isto: quem lança um título precisa ler a árvore
    // para escolher um centro, e não precisa poder estruturar a contabilidade.
    const tentativa = await criarCentro(leitor, { codigo: `X${++seq}`, nome: 'Não deveria' })
    assert.equal(tentativa.status, 403)
    assert.equal(tentativa.corpo.code, 'SEM_PERMISSAO')
  })
})

describe('contas bancárias', () => {
  it('o saldo devolvido é o derivado das movimentações', async () => {
    const t = await token({ permissoes: [...GESTOR_CONTA] })
    const conta = await criarConta(t)
    assert.equal(conta.status, 201)
    const id = conta.corpo.data.id
    assert.equal(conta.corpo.data.saldo_atual, '1000.0000')

    const lancar = (tipo: string, valor: string) =>
      chamar(api, 'POST', `/api/v1/contas-bancarias/${id}/movimentacoes`, {
        token: t,
        cabecalhos: chave(),
        corpo: { tipo, valor, data_movimento: '2026-02-10', descricao: `${tipo} de teste` },
      })

    assert.equal((await lancar('ENTRADA', '500.0000')).status, 201)
    assert.equal((await lancar('SAIDA', '200.0000')).status, 201)
    assert.equal((await lancar('TAXA', '15.5000')).status, 201)

    const depois = await chamar(api, 'GET', `/api/v1/contas-bancarias/${id}`, { token: t })
    // 1000 + 500 − 200 − 15,50. Como string: `numeric` não atravessa `double`,
    // porque treze dígitos inteiros não cabem lá sem perder o último centavo.
    assert.equal(depois.corpo.data.saldo_atual, '1284.5000')
    assert.equal(typeof depois.corpo.data.saldo_atual, 'string')
  })

  it('transferência gera as duas pernas, cada uma apontando a outra', async () => {
    const t = await token({ permissoes: [...GESTOR_CONTA] })
    const a = await criarConta(t, { apelido: 'Origem' })
    const b = await criarConta(t, { apelido: 'Destino', saldo_inicial: '0.0000' })

    const r = await chamar(api, 'POST', '/api/v1/contas-bancarias/transferencias', {
      token: t,
      cabecalhos: chave(),
      corpo: {
        conta_origem_id: a.corpo.data.id,
        conta_destino_id: b.corpo.data.id,
        valor: '300.0000',
        data_movimento: '2026-02-12',
        descricao: 'Provisão de folha',
      },
    })
    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.saida.transferencia_par_id, r.corpo.data.entrada.id)
    assert.equal(r.corpo.data.entrada.transferencia_par_id, r.corpo.data.saida.id)

    const contaA = await chamar(api, 'GET', `/api/v1/contas-bancarias/${a.corpo.data.id}`, { token: t })
    const contaB = await chamar(api, 'GET', `/api/v1/contas-bancarias/${b.corpo.data.id}`, { token: t })
    assert.equal(contaA.corpo.data.saldo_atual, '700.0000')
    assert.equal(contaB.corpo.data.saldo_atual, '300.0000')
  })

  it('transferir não sai de graça com quem só pode movimentar', async () => {
    const t = await token({ permissoes: ['conta_bancaria:ler', 'conta_bancaria:movimentar'] })
    const r = await chamar(api, 'POST', '/api/v1/contas-bancarias/transferencias', {
      token: t,
      cabecalhos: chave(),
      corpo: {
        conta_origem_id: '11111111-1111-4111-8111-111111119001',
        conta_destino_id: '11111111-1111-4111-8111-111111119002',
        valor: '10.0000',
        data_movimento: '2026-02-12',
        descricao: 'Não deveria',
      },
    })
    // Transferência é a única ação que move saldo sem um título por trás
    // justificando o valor — a de menos rastro documental, e a que mais
    // interessa segregar de quem lança despesa.
    assert.equal(r.status, 403)
  })

  it('origem inexistente é 404 nomeado, não erro de chave estrangeira', async () => {
    const t = await token({ permissoes: [...GESTOR_CONTA] })
    const destino = await criarConta(t)

    const r = await chamar(api, 'POST', '/api/v1/contas-bancarias/transferencias', {
      token: t,
      cabecalhos: chave(),
      corpo: {
        conta_origem_id: '11111111-1111-4111-8111-1111111199ff',
        conta_destino_id: destino.corpo.data.id,
        valor: '10.0000',
        data_movimento: '2026-02-12',
        descricao: 'Origem fantasma',
      },
    })
    assert.equal(r.status, 404)
    assert.match(r.corpo.title, /origem/i)
  })

  it('conta bloqueada recusa lançamento manual, com a saída à mão', async () => {
    const t = await token({ permissoes: [...GESTOR_CONTA] })
    const conta = await criarConta(t)
    const id = conta.corpo.data.id

    const bloqueio = await chamar(api, 'PATCH', `/api/v1/contas-bancarias/${id}`, {
      token: t,
      corpo: { status: 'BLOQUEADA' },
      cabecalhos: { 'if-match': `"${conta.corpo.data.version}"` },
    })
    assert.equal(bloqueio.status, 200)

    const r = await chamar(api, 'POST', `/api/v1/contas-bancarias/${id}/movimentacoes`, {
      token: t,
      cabecalhos: chave(),
      corpo: { tipo: 'SAIDA', valor: '10.0000', data_movimento: '2026-02-14', descricao: 'Manual' },
    })
    assert.equal(r.status, 422)
    assert.ok(r.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'DESBLOQUEAR_OU_TROCAR'))
  })

  it('estorno é lançamento contrário, e estornar o estorno é recusado', async () => {
    const t = await token({ permissoes: [...GESTOR_CONTA] })
    const conta = await criarConta(t)
    const id = conta.corpo.data.id

    const saida = await chamar(api, 'POST', `/api/v1/contas-bancarias/${id}/movimentacoes`, {
      token: t,
      cabecalhos: chave(),
      corpo: { tipo: 'SAIDA', valor: '250.0000', data_movimento: '2026-02-10', descricao: 'Pagamento errado' },
    })
    assert.equal(saida.status, 201)

    const estorno = await chamar(
      api,
      'POST',
      `/api/v1/contas-bancarias/movimentacoes/${saida.corpo.data.id}/estornar`,
      { token: t, cabecalhos: chave(), corpo: { motivo: 'pagamento em duplicidade' } },
    )
    assert.equal(estorno.status, 200)
    // O tipo invertido sai do servidor. Deixar o cliente escolher permitiria
    // estornar uma saída com outra saída, dobrando a despesa em vez de anulá-la.
    assert.equal(estorno.corpo.data.tipo, 'ENTRADA')
    assert.equal(estorno.corpo.data.estorna_id, saida.corpo.data.id)

    // Saldo volta ao inicial: a saída e o estorno se anulam.
    const depois = await chamar(api, 'GET', `/api/v1/contas-bancarias/${id}`, { token: t })
    assert.equal(depois.corpo.data.saldo_atual, '1000.0000')

    const segundo = await chamar(
      api,
      'POST',
      `/api/v1/contas-bancarias/movimentacoes/${saida.corpo.data.id}/estornar`,
      { token: t, cabecalhos: chave(), corpo: { motivo: 'tentando de novo' } },
    )
    assert.equal(segundo.status, 422)
    assert.ok(segundo.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'LANCAR_NOVO'))
  })

  it('estorno sem motivo é recusado na validação, antes do banco', async () => {
    const t = await token({ permissoes: [...GESTOR_CONTA] })
    const conta = await criarConta(t)
    const mov = await chamar(api, 'POST', `/api/v1/contas-bancarias/${conta.corpo.data.id}/movimentacoes`, {
      token: t,
      cabecalhos: chave(),
      corpo: { tipo: 'SAIDA', valor: '10.0000', data_movimento: '2026-02-10', descricao: 'Qualquer' },
    })

    const r = await chamar(
      api,
      'POST',
      `/api/v1/contas-bancarias/movimentacoes/${mov.corpo.data.id}/estornar`,
      { token: t, cabecalhos: chave(), corpo: { motivo: '' } },
    )
    assert.equal(r.status, 400)
    assert.equal(r.corpo.code, 'PAYLOAD_INVALIDO')
  })

  it('o extrato filtra por período, tipo e pendência de conciliação', async () => {
    const t = await token({ permissoes: [...GESTOR_CONTA] })
    const conta = await criarConta(t)
    const id = conta.corpo.data.id

    for (const [tipo, valor, data] of [
      ['ENTRADA', '100.0000', '2026-03-01'],
      ['SAIDA', '50.0000', '2026-03-15'],
      ['TAXA', '5.0000', '2026-04-02'],
    ] as const) {
      await chamar(api, 'POST', `/api/v1/contas-bancarias/${id}/movimentacoes`, {
        token: t,
        cabecalhos: chave(),
        corpo: { tipo, valor, data_movimento: data, descricao: `${tipo} ${data}` },
      })
    }

    const marco = await chamar(
      api,
      'GET',
      `/api/v1/contas-bancarias/${id}/extrato?de=2026-03-01&ate=2026-03-31`,
      { token: t },
    )
    assert.equal(marco.corpo.data.length, 2)

    const saidas = await chamar(api, 'GET', `/api/v1/contas-bancarias/${id}/extrato?tipo=SAIDA`, { token: t })
    assert.equal(saidas.corpo.data.length, 1)

    const pendentes = await chamar(
      api,
      'GET',
      `/api/v1/contas-bancarias/${id}/extrato?pendente_conciliacao=true`,
      { token: t },
    )
    assert.equal(pendentes.corpo.data.length, 3)

    // Conciliar é a única alteração permitida depois do lançamento: não muda o
    // fato financeiro, muda o que sabemos sobre ele.
    const alvo = pendentes.corpo.data[0].id
    const conciliar = await chamar(
      api,
      'POST',
      `/api/v1/contas-bancarias/movimentacoes/${alvo}/conciliar`,
      { token: t },
    )
    assert.equal(conciliar.status, 200)
    assert.equal(conciliar.corpo.data.conciliado, true)
    assert.ok(conciliar.corpo.data.conciliado_em)

    const restantes = await chamar(
      api,
      'GET',
      `/api/v1/contas-bancarias/${id}/extrato?pendente_conciliacao=true`,
      { token: t },
    )
    assert.equal(restantes.corpo.data.length, 2)

    // Desconciliar existe porque conciliar errado acontece — dois lançamentos
    // de mesmo valor no mesmo dia é o caso comum. Sem esta rota, a saída seria
    // estornar um lançamento correto para corrigir um metadado.
    const desfazer = await chamar(
      api,
      'POST',
      `/api/v1/contas-bancarias/movimentacoes/${alvo}/desconciliar`,
      { token: t },
    )
    assert.equal(desfazer.status, 200)
    assert.equal(desfazer.corpo.data.conciliado, false)
    assert.equal(desfazer.corpo.data.conciliado_em, null)
  })

  it('valor zero e negativo são recusados na fronteira', async () => {
    const t = await token({ permissoes: [...GESTOR_CONTA] })
    const conta = await criarConta(t)
    const id = conta.corpo.data.id

    for (const valor of ['0.0000', '-10.0000']) {
      const r = await chamar(api, 'POST', `/api/v1/contas-bancarias/${id}/movimentacoes`, {
        token: t,
        cabecalhos: chave(),
        corpo: { tipo: 'SAIDA', valor, data_movimento: '2026-02-10', descricao: 'Inválido' },
      })
      assert.equal(r.status, 400, `valor ${valor} deveria ser recusado`)
    }
  })

  it('lançar transferência pelo endpoint manual é recusado', async () => {
    const t = await token({ permissoes: [...GESTOR_CONTA] })
    const conta = await criarConta(t)

    // Criar TRANSFERENCIA_SAIDA por aqui produziria metade de uma
    // transferência: saindo de uma conta e não entrando em nenhuma.
    const r = await chamar(api, 'POST', `/api/v1/contas-bancarias/${conta.corpo.data.id}/movimentacoes`, {
      token: t,
      cabecalhos: chave(),
      corpo: {
        tipo: 'TRANSFERENCIA_SAIDA',
        valor: '10.0000',
        data_movimento: '2026-02-10',
        descricao: 'Perna órfã',
      },
    })
    assert.equal(r.status, 400)
  })

  it('conta duplicada é recusada com 409', async () => {
    const t = await token({ permissoes: [...GESTOR_CONTA] })
    const numero = `${800000 + ++seq}`

    assert.equal((await criarConta(t, { numero })).status, 201)
    const segunda = await criarConta(t, { numero })
    assert.equal(segunda.status, 409)
    assert.equal(segunda.corpo.code, 'RECURSO_DUPLICADO')
  })
})
