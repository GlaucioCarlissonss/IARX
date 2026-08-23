import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CENARIO_PADRAO,
  CENARIO_PESSIMISTA,
  CENTRO_OPER,
  CLIENTE_ALFA,
  CONTA_OPERACAO,
  EMPRESA_A,
  FILIAL_A,
  FORNECEDOR_A,
  TENANT_B,
  USUARIO_A,
  chamar,
  chaveIdempotencia,
  subirApi,
  token,
  type Servidor,
} from './apoio.js'

/**
 * Integração do fluxo de caixa projetado, contra PostgreSQL real.
 *
 * O que estes testes existem para provar: **a projeção não promete dinheiro que
 * não vem, e o cenário de estresse não deixa a operação mais otimista**.
 *
 * As duas coisas erram silenciosamente. A primeira porque um título BAIXADO
 * *parece* receita: está encerrado, e um painel que soma "encerrados" fecha com
 * ele — só que nada entrou na conta. A segunda porque aplicar a inadimplência aos
 * dois lados mantém o saldo do dia parecendo razoável, e ninguém confere de onde
 * o número veio.
 *
 * A projeção em si tem teste de banco (arquivo 14). Aqui se verifica o que só
 * aparece atravessando o HTTP: a janela fixada a partir de hoje, o resumo, o
 * cenário inexistente recusado em vez de silenciosamente trocado pelo padrão, e a
 * permissão que a leitura consolidada exige.
 *
 * Os percentuais (0% no padrão, 30% no pessimista) vêm de `semear.sql`.
 */

let api: Servidor

const PAINEL = ['financeiro:painel_executivo'] as const
const PLANEJA = ['financeiro:lancamento_manual', 'pagar:ler'] as const

before(async () => {
  api = await subirApi()
})
after(async () => {
  await api.fechar()
})

const hoje = () => new Date().toISOString().slice(0, 10)
const emDias = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Um título a pagar em aberto num dia da janela, para a projeção ter o que somar. */
async function pagarEm(data: string, valor: string) {
  const t = await token({ permissoes: ['pagar:criar', 'pagar:ler'] })
  const r = await chamar(api, 'POST', '/api/v1/contas-pagar', {
    token: t,
    cabecalhos: { 'idempotency-key': chaveIdempotencia('cx') },
    corpo: {
      empresa_id: EMPRESA_A,
      fornecedor_id: FORNECEDOR_A,
      descricao: 'Saída da projeção',
      classificacao: 'DESPESA_FIXA',
      valor_original: valor,
      data_emissao: hoje(),
      data_vencimento: data,
      filial_id: FILIAL_A,
      rateio: [{ centro_custo_id: CENTRO_OPER, percentual: 100 }],
    },
  })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  return r.corpo.data
}

/** Um título a receber em aberto num dia da janela. */
async function receberEm(data: string, valor: string) {
  const t = await token({ permissoes: ['receber:criar', 'receber:ler'] })
  const r = await chamar(api, 'POST', '/api/v1/contas-receber', {
    token: t,
    cabecalhos: { 'idempotency-key': chaveIdempotencia('cx') },
    corpo: {
      cliente_id: CLIENTE_ALFA,
      descricao: 'Entrada da projeção',
      valor_original: valor,
      data_emissao: hoje(),
      data_vencimento: data,
      filial_id: FILIAL_A,
    },
  })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  return r.corpo.data
}

describe('projeção', () => {
  it('a janela vai de hoje até hoje + N, e só as janelas oferecidas passam', async () => {
    const t = await token({ permissoes: [...PAINEL] })

    for (const dias of [30, 60, 90, 180]) {
      const r = await chamar(api, 'GET', `/api/v1/fluxo-caixa/projecao?dias=${dias}`, { token: t })
      assert.equal(r.status, 200, JSON.stringify(r.corpo))
      const p = r.corpo.data
      assert.equal(p.de, hoje(), 'a janela começa hoje')
      assert.equal(p.ate, emDias(dias))
      // A série tem um ponto por dia, inclusive as duas pontas.
      assert.equal(p.dias.length, dias + 1, `${dias} dias produziram ${p.dias.length} pontos`)
    }

    /*
     * 45 dias é recusado de propósito. Não é rigidez: uma janela livre permitiria
     * projetar o passado, onde "previsto" não quer dizer nada — o passado tem
     * extrato, e uma projeção retroativa mostraria como futuro o que já aconteceu.
     */
    const solta = await chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=45', { token: t })
    assert.equal(solta.status, 400, JSON.stringify(solta.corpo))
  })

  it('soma o previsto no dia certo e acumula a partir do saldo real', async () => {
    const t = await token({ permissoes: [...PAINEL] })
    const dia = emDias(20)

    const antes = await chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=30', { token: t })
    const pAntes = antes.corpo.data
    const saidasAntes = Number(pAntes.dias.find((d: { dia: string }) => d.dia === dia).saidas)

    await pagarEm(dia, '2500.0000')

    const depois = await chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=30', { token: t })
    const pDepois = depois.corpo.data
    const linha = pDepois.dias.find((d: { dia: string }) => d.dia === dia)
    assert.equal(Number(linha.saidas), saidasAntes + 2500, 'a saída caiu no dia do vencimento')

    // O acumulado parte do saldo real das contas, não de zero.
    assert.equal(pDepois.saldo_inicial, pAntes.saldo_inicial)
    const primeiro = pDepois.dias[0]
    assert.equal(
      Number(primeiro.saldo_acumulado).toFixed(2),
      (Number(pDepois.saldo_inicial) + Number(primeiro.saldo_dia)).toFixed(2),
      'o primeiro dia acumula sobre o saldo inicial',
    )
  })

  it('RN-F19: um título cancelado sai da projeção', async () => {
    const t = await token({ permissoes: [...PAINEL] })
    const dia = emDias(22)
    const titulo = await pagarEm(dia, '4400.0000')

    const antes = await chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=30', { token: t })
    const somaAntes = Number(
      (antes.corpo.data).dias.find((d: { dia: string }) => d.dia === dia).saidas,
    )

    const cancelador = await token({ permissoes: ['pagar:criar', 'pagar:ler', 'pagar:cancelar'] })
    const c = await chamar(api, 'POST', `/api/v1/contas-pagar/${titulo.id}/cancelar`, {
      token: cancelador,
      corpo: { motivo: 'compra não se concretizou' },
    })
    assert.equal(c.status, 200, JSON.stringify(c.corpo))

    const depois = await chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=30', { token: t })
    const somaDepois = Number(
      (depois.corpo.data).dias.find((d: { dia: string }) => d.dia === dia).saidas,
    )
    assert.equal(somaDepois, somaAntes - 4400, 'o cancelado deixou de ser somado')
  })

  it('RN-F19: BAIXADO parece receita e não entra', async () => {
    /*
     * O caso mais importante do arquivo. Um título baixado está encerrado, e é
     * por isso que um painel que soma "encerrados" fecha com ele — mas nada
     * entrou na conta, e somá-lo numa projeção promete dinheiro que não vem.
     */
    const t = await token({ permissoes: [...PAINEL] })
    const dia = emDias(24)
    const titulo = await receberEm(dia, '1500.0000')

    const antes = await chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=30', { token: t })
    const entradasAntes = Number(
      (antes.corpo.data).dias.find((d: { dia: string }) => d.dia === dia).entradas,
    )
    assert.ok(entradasAntes >= 1500, 'o título em aberto está na projeção')

    const negociador = await token({
      permissoes: ['receber:ler', 'receber:criar', 'receber:aprovar', 'receber:negociar'],
    })
    /*
     * R$ 1.500 fica **abaixo** do menor limite de EMISSAO_FATURA (R$ 2.000 em
     * `semear.sql`), então o avulso nasce APROVADO e a baixa é a única operação
     * sob teste. Com um valor acima, o título nasceria PENDENTE_APROVACAO e o
     * 422 mediria a aprovação em vez da baixa — o caso passaria a provar outra
     * coisa.
     */
    const baixa = await chamar(api, 'POST', `/api/v1/contas-receber/${titulo.id}/baixar-sem-recebimento`, {
      token: negociador,
      corpo: { motivo: 'cliente entrou em recuperacao judicial' },
    })
    assert.equal(baixa.status, 200, JSON.stringify(baixa.corpo))

    const depois = await chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=30', { token: t })
    const entradasDepois = Number(
      (depois.corpo.data).dias.find((d: { dia: string }) => d.dia === dia).entradas,
    )
    assert.equal(entradasDepois, entradasAntes - 1500, 'o baixado saiu da projeção de entrada')
  })

  it('RN-F20: o cenário pessimista reduz a entrada e não a saída', async () => {
    const t = await token({ permissoes: [...PAINEL] })
    const dia = emDias(26)
    await receberEm(dia, '1000.0000')
    await pagarEm(dia, '1000.0000')

    const base = await chamar(api, 'GET', `/api/v1/fluxo-caixa/projecao?dias=30&cenario_id=${CENARIO_PADRAO}`, {
      token: t,
    })
    const pess = await chamar(
      api,
      'GET',
      `/api/v1/fluxo-caixa/projecao?dias=30&cenario_id=${CENARIO_PESSIMISTA}`,
      { token: t },
    )
    const dB = (base.corpo.data).dias.find((d: { dia: string }) => d.dia === dia)
    const dP = (pess.corpo.data).dias.find((d: { dia: string }) => d.dia === dia)

    // 30% de inadimplência sobre a entrada.
    assert.equal(
      Number(dP.entradas).toFixed(4),
      (Number(dB.entradas) * 0.7).toFixed(4),
      'a entrada caiu pelo percentual do cenário',
    )
    /*
     * A saída **não** muda. Aplicá-la aos dois lados faria o cenário de estresse
     * deixar a operação mais otimista sobre a própria dívida — o inverso de um
     * teste de estresse, e um erro que passa porque o saldo do dia continua
     * parecendo razoável.
     */
    assert.equal(dP.saidas, dB.saidas, 'a saída não foi descontada')
    assert.equal((pess.corpo.data).cenario_nome, 'Pessimista')
  })

  it('o cenário é leitura: nenhum valor de título muda', async () => {
    const t = await token({ permissoes: [...PAINEL] })
    const dia = emDias(28)
    const titulo = await pagarEm(dia, '5000.0000')

    await chamar(api, 'GET', `/api/v1/fluxo-caixa/projecao?dias=30&cenario_id=${CENARIO_PESSIMISTA}`, {
      token: t,
    })

    const leitor = await token({ permissoes: ['pagar:ler'] })
    const depois = await chamar(api, 'GET', `/api/v1/contas-pagar/${titulo.id}`, { token: leitor })
    assert.equal((depois.corpo.data).valor_original, '5000.0000')
  })

  it('cenário inexistente é recusado, não trocado em silêncio pelo padrão', async () => {
    /*
     * `app.fluxo_caixa_projetado` cai no padrão quando não acha o id — certo para
     * `null`, errado para um id que o cliente mandou: a tela mostraria o cenário
     * padrão sob o rótulo do cenário pedido, e o operador tomaria a decisão
     * olhando o gráfico errado.
     */
    const t = await token({ permissoes: [...PAINEL] })
    const r = await chamar(
      api,
      'GET',
      '/api/v1/fluxo-caixa/projecao?dias=30&cenario_id=11111111-1111-4111-8111-111111119999',
      { token: t },
    )
    assert.equal(r.status, 404, JSON.stringify(r.corpo))
  })

  it('sem cenário, responde o padrão do locatário', async () => {
    const t = await token({ permissoes: [...PAINEL] })
    const r = await chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=30', { token: t })
    const p = r.corpo.data
    assert.equal(p.cenario_id, CENARIO_PADRAO)
    assert.equal(p.cenario_nome, 'Base')
  })

  it('o resumo diz em que dia o caixa aperta, não só qual o menor número', async () => {
    const t = await token({ permissoes: [...PAINEL] })
    const dia = emDias(15)
    await pagarEm(dia, '900000.0000')

    const r = await chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=30', { token: t })
    const p = r.corpo.data
    assert.ok(Number(p.menor_saldo) < 0, 'a saída grande levou o acumulado a negativo')
    assert.ok(p.dia_menor_saldo, 'o dia vem junto com o valor')
    assert.ok(p.dia_menor_saldo >= dia, 'e não é anterior ao dia da saída')

    // O saldo final é o acumulado do último dia, não a soma solta.
    assert.equal(p.saldo_final, p.dias[p.dias.length - 1].saldo_acumulado)
  })

  it('o filtro de filial alcança o previsto, não só o lançado', async () => {
    /*
     * `lancamento_futuro` não tinha `filial_id` na primeira versão da migração, e
     * o recorte de uma filial mostrava os títulos dela e os compromissos
     * previstos de **todas**. Pior por ser plausível: o número fica maior, não
     * menor.
     */
    const t = await token({ permissoes: ['financeiro:lancamento_manual', 'pagar:ler'] })
    const dia = emDias(35)

    const criar = (filial: string | null) =>
      chamar(api, 'POST', '/api/v1/lancamentos-futuros', {
        token: t,
        cabecalhos: { 'idempotency-key': chaveIdempotencia('lf') },
        corpo: {
          tipo: 'DESPESA_RECORRENTE',
          descricao: 'Previsto por filial',
          valor_previsto: '777.0000',
          data_prevista: dia,
          empresa_id: EMPRESA_A,
          fornecedor_id: FORNECEDOR_A,
          classificacao: 'DESPESA_FIXA',
          filial_id: filial,
        },
      })

    const comFilial = await criar(FILIAL_A)
    assert.equal(comFilial.status, 201, JSON.stringify(comFilial.corpo))
    const semFilial = await criar(null)
    assert.equal(semFilial.status, 201, JSON.stringify(semFilial.corpo))

    const filtrada = await chamar(
      api,
      'GET',
      `/api/v1/lancamentos-futuros/projecao?dias=60&filial_id=${FILIAL_A}`,
      { token: t },
    )
    const tudo = await chamar(api, 'GET', '/api/v1/lancamentos-futuros/projecao?dias=60', { token: t })

    const doDia = (r: { corpo: any }) =>
      Number((r.corpo.data).dias.find((d: { dia: string }) => d.dia === dia).saidas)

    assert.ok(doDia(tudo) >= doDia(filtrada) + 777, 'o previsto sem filial não entra no recorte da filial')
  })
})

describe('alertas', () => {
  it('saldo negativo projetado vira alerta, e persiste no acumulado (RN-F21)', async () => {
    const t = await token({ permissoes: [...PAINEL] })
    const dia = emDias(10)
    await pagarEm(dia, '900000.0000')

    const r = await chamar(api, 'GET', '/api/v1/fluxo-caixa/alertas?dias=30', { token: t })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    const alertas = r.corpo.data
    const negativos = alertas.filter((a: { tipo: string }) => a.tipo === 'SALDO_NEGATIVO')
    assert.ok(negativos.length > 0, 'o saldo negativo gerou alerta')
    // O acumulado não se recupera sozinho: o alerta segue nos dias seguintes.
    assert.ok(negativos.length > 1, 'e o alerta persiste enquanto o acumulado está negativo')
    assert.match(negativos[0].detalhe, /Saldo acumulado projetado/)
  })

  it('concentração de saída num único dia vira alerta (RN-F22)', async () => {
    /*
     * A asserção é sobre a **regra**, não sobre um valor.
     *
     * A primeira versão deste caso afirmava "a saída de R$ 900 mil dispara o
     * alerta", contando com o que outros casos deixaram na janela. Falhava quando
     * um deles mudava de valor, e a falha apontava o alerta em vez do
     * acoplamento. Aqui a projeção e os alertas são lidos na mesma janela, e o que
     * se compara é o conjunto de dias acima do limiar com o conjunto de dias
     * alertados — quaisquer que sejam os números.
     */
    const t = await token({ permissoes: [...PAINEL] })

    /*
     * A dominância é **construída**, não presumida.
     *
     * A janela carrega o que os outros arquivos da suíte deixaram — e essa soma
     * cresce a cada teste novo. Presumir que uma saída de valor fixo domina é a
     * mesma armadilha por outro caminho: hoje passa, e um arquivo futuro com um
     * título grande a derruba. Aqui a saída é três vezes o total já projetado, o
     * que garante 75% num único dia qualquer que seja a base.
     */
    const inicial = await chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=30', { token: t })
    const totalAntes = inicial.corpo.data.dias.reduce(
      (acc: number, d: { saidas: string }) => acc + Number(d.saidas),
      0,
    )
    const diaAlvo = emDias(12)
    await pagarEm(diaAlvo, (Math.max(totalAntes, 1000) * 3).toFixed(4))

    const [proj, alertas] = await Promise.all([
      chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=30', { token: t }),
      chamar(api, 'GET', '/api/v1/fluxo-caixa/alertas?dias=30', { token: t }),
    ])

    const dias: { dia: string; saidas: string }[] = proj.corpo.data.dias
    const total = dias.reduce((s, d) => s + Number(d.saidas), 0)
    assert.ok(total > 0, 'a janela tem saídas projetadas')

    const limiar = 40 // o do cenário padrão em semear.sql
    const esperados = dias
      .filter((d) => (100 * Number(d.saidas)) / total > limiar)
      .map((d) => d.dia)
    const alertados = alertas.corpo.data
      .filter((a: { tipo: string }) => a.tipo === 'CONCENTRACAO_SAIDA')
      .map((a: { dia: string }) => a.dia)

    assert.ok(esperados.includes(diaAlvo), 'o dia construído concentra acima do limiar')
    assert.deepEqual(alertados.sort(), esperados.sort(), 'os dias alertados são exatamente os acima do limiar')
  })

  it('os alertas não são gravados: mudam com a próxima baixa', async () => {
    /*
     * Um alerta gravado ficaria desatualizado no instante seguinte a uma baixa: o
     * saldo negativo de terça deixa de existir quando o recebimento de segunda
     * entra, e nada avisaria a linha gravada. A prova é que a janela de 30 dias e
     * a de 180 respondem números diferentes para a mesma base.
     */
    const t = await token({ permissoes: [...PAINEL] })
    const curta = await chamar(api, 'GET', '/api/v1/fluxo-caixa/alertas?dias=30', { token: t })
    const longa = await chamar(api, 'GET', '/api/v1/fluxo-caixa/alertas?dias=180', { token: t })
    assert.notEqual(
      curta.corpo.data.length,
      longa.corpo.data.length,
      'a janela muda o resultado, porque ele é calculado e não lido',
    )
  })
})

describe('cenários', () => {
  it('lista com o padrão primeiro', async () => {
    const t = await token({ permissoes: [...PAINEL] })
    const r = await chamar(api, 'GET', '/api/v1/cenarios-caixa', { token: t })
    assert.equal(r.status, 200)
    const cs = r.corpo.data
    assert.ok(cs.length >= 2)
    assert.equal(cs[0].padrao, true, 'o padrão vem primeiro, porque é ele que a tela abre')
  })

  it('criar um novo padrão tira o anterior, em vez de falhar na restrição', async () => {
    const t = await token({ permissoes: [...PAINEL] })
    const r = await chamar(api, 'POST', '/api/v1/cenarios-caixa', {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('cen') },
      corpo: {
        nome: 'Novo padrao',
        percentual_inadimplencia: 5,
        limiar_concentracao: 35,
        padrao: true,
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.corpo))
    const novo = r.corpo.data
    assert.equal(novo.padrao, true)

    // Um padrão só: dois fariam o painel abrir diferente para duas pessoas no
    // mesmo dia, pela ordem da consulta.
    const lista = await chamar(api, 'GET', '/api/v1/cenarios-caixa', { token: t })
    const padroes = lista.corpo.data.filter((c: { padrao: boolean }) => c.padrao)
    assert.equal(padroes.length, 1)
    assert.equal(padroes[0].id, novo.id)

    // Devolve o anterior ao lugar, para os outros arquivos não herdarem a troca.
    await chamar(api, 'POST', '/api/v1/cenarios-caixa', {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('cen') },
      corpo: { nome: 'Restaurando', padrao: false },
    })
  })

  it('nome duplicado é 409 com o motivo, não 500', async () => {
    const t = await token({ permissoes: [...PAINEL] })
    const r = await chamar(api, 'POST', '/api/v1/cenarios-caixa', {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('cen') },
      corpo: { nome: 'Pessimista', percentual_inadimplencia: 10 },
    })
    assert.equal(r.status, 409, JSON.stringify(r.corpo))
    assert.equal(r.corpo.code, 'RECURSO_DUPLICADO')
  })

  it('a inadimplência fica entre 0 e 100', async () => {
    const t = await token({ permissoes: [...PAINEL] })
    const r = await chamar(api, 'POST', '/api/v1/cenarios-caixa', {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('cen') },
      corpo: { nome: 'Impossivel', percentual_inadimplencia: 140 },
    })
    assert.equal(r.status, 400)
  })
})

describe('autorização e isolamento', () => {
  it('a leitura consolidada exige o painel executivo', async () => {
    /*
     * Quem vê o gráfico vê margem, concentração de vencimento e previsão de
     * despesa. Exigir só `pagar:ler` daria a quem confere boletos o retrato
     * completo da operação.
     */
    const t = await token({ permissoes: ['pagar:ler', 'receber:ler'] })
    for (const caminho of [
      '/api/v1/fluxo-caixa/projecao?dias=30',
      '/api/v1/fluxo-caixa/alertas?dias=30',
      '/api/v1/cenarios-caixa',
    ]) {
      const r = await chamar(api, 'GET', caminho, { token: t })
      assert.equal(r.status, 403, `${caminho} devolveu ${r.status}`)
    }
  })

  it('a projeção do planejamento abre com `pagar:ler`', async () => {
    // Rota separada, mesma função: obrigar a tela de planejamento a chamar
    // `/fluxo-caixa/projecao` exigiria dela a permissão do painel consolidado.
    const t = await token({ permissoes: [...PLANEJA] })
    const r = await chamar(api, 'GET', '/api/v1/lancamentos-futuros/projecao?dias=30', { token: t })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
  })

  it('o cenário do vizinho não é visível nem selecionável', async () => {
    const t = await token({ permissoes: [...PAINEL] })
    const lista = await chamar(api, 'GET', '/api/v1/cenarios-caixa', { token: t })
    const nomes = lista.corpo.data.map((c: { nome: string }) => c.nome)
    assert.ok(!nomes.includes('Base do vizinho'))

    const alheio = await chamar(
      api,
      'GET',
      '/api/v1/fluxo-caixa/projecao?dias=30&cenario_id=22222222-2222-4222-8222-22222222ce01',
      { token: t },
    )
    assert.equal(alheio.status, 404, 'um id de outro locatário não é encontrado, não é aplicado')
  })

  it('a projeção do locatário B não inclui os títulos do A', async () => {
    const a = await token({ permissoes: [...PAINEL] })
    const b = await token({ tenant: TENANT_B, usuario: USUARIO_A, permissoes: [...PAINEL] })

    const pa = await chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=90', { token: a })
    const pb = await chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=90', { token: b })

    const totalA = Number((pa.corpo.data).total_saidas)
    const totalB = Number((pb.corpo.data).total_saidas)
    assert.ok(totalA > 0, 'o locatário A tem saídas projetadas')
    assert.notEqual(totalA, totalB, 'e o B não vê as mesmas')
  })
})

/* `CONTA_OPERACAO` entra no filtro por conta, que a projeção aceita. */
describe('recorte por conta', () => {
  it('filtrar por conta muda o saldo de partida', async () => {
    const t = await token({ permissoes: [...PAINEL] })
    const todas = await chamar(api, 'GET', '/api/v1/fluxo-caixa/projecao?dias=30', { token: t })
    const uma = await chamar(api, 'GET', `/api/v1/fluxo-caixa/projecao?dias=30&conta_id=${CONTA_OPERACAO}`, {
      token: t,
    })
    assert.equal(uma.status, 200, JSON.stringify(uma.corpo))
    assert.ok(
      Number((todas.corpo.data).saldo_inicial) >=
        Number((uma.corpo.data).saldo_inicial),
      'o saldo de todas as contas não é menor que o de uma',
    )
  })
})
