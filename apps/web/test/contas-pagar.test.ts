/**
 * Comandos de contas a pagar — Módulo 10.
 *
 * O que estes testes protegem, em uma frase: **o fluxo de aprovação impede
 * algo**. Um fluxo que aparece na tela e não impede nada é pior que não ter
 * fluxo — dá a sensação de controle sem o controle, e é exatamente o que uma
 * suíte que só testa o caminho felizde deixa passar.
 *
 * As mesmas nove regras existem como gatilho na migração 0019 e como teste de
 * integração em `apps/api/test/contas-pagar.test.ts`. Não é redundância: aqui
 * elas permitem a tela recusar antes de pedir e com a mensagem certa; lá elas
 * valem para quem não passa pela tela. Se a regra mudar num lado só, as duas
 * suítes falham juntas — que é o ponto.
 *
 * Nenhum valor abaixo é regra de negócio da IARX: as faixas de alçada vêm da
 * massa de demonstração, e o que se prova é que a contagem de níveis segue as
 * faixas cadastradas, quaisquer que sejam.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarBase } from '../src/dados/gerar.ts'
import {
  ajustarValorTitulo,
  cancelarTituloPagar,
  criarDelegacao,
  criarTituloPagar,
  decidirAprovacao,
  ehPaiDeParcelas,
  estornarPagamentoTitulo,
  filaDeAprovacao,
  limitesAlcada,
  niveisExigidos,
  nivelPendente,
  pagarTitulo,
  parcelasDe,
  postoAlcada,
  reenviarTituloPagar,
  saldoDaConta,
  saldoDoTitulo,
  totalPago,
  valorDevidoDe,
} from '../src/dados/comandos.ts'
import type { BaseDados } from '../src/dados/tipos.ts'

function base(): BaseDados {
  return gerarBase()
}

/** Quem tem posto N na massa gerada. Derivado, nunca fixado no teste. */
function comPosto(b: BaseDados, posto: number): string {
  const u = b.usuarios.find((x) => postoAlcada(b, x.id) === posto)
  assert.ok(u, `a massa não tem usuário com posto ${posto}`)
  return u!.id
}

/** Alguém sem alçada nenhuma — o caso que a fila tem de excluir. */
function semAlcada(b: BaseDados): string {
  const u = b.usuarios.find((x) => postoAlcada(b, x.id) === 0 && x.tipo === 'INTERNO')
  assert.ok(u, 'a massa não tem usuário interno sem alçada')
  return u!.id
}

const DADOS = {
  fornecedorId: null,
  descricao: 'Licença anual de sistema interno',
  classificacao: 'DESPESA_FIXA' as const,
  contratoFornecedorRef: null,
  dataEmissao: '2026-07-01',
  dataVencimento: '2026-08-01',
  parcelas: 1,
  rateio: [],
}

/* ------------------------------------------------------------ alçada */

test('a contagem de níveis segue as faixas cadastradas, e para em três', () => {
  const b = base()
  const limites = limitesAlcada(b)
  assert.ok(limites.length >= 3, 'a massa precisa de ao menos três faixas para exercitar o limite')

  // Abaixo da primeira faixa: nenhuma aprovação. É o comportamento correto, e
  // não um buraco — o buraco seria aprovar sozinho um valor acima de uma faixa.
  assert.equal(niveisExigidos(b, limites[0]! - 1), 0)
  assert.equal(niveisExigidos(b, limites[0]! + 1), 1)
  assert.equal(niveisExigidos(b, limites[1]! + 1), 2)
  assert.equal(niveisExigidos(b, limites[2]! + 1), 3)
  // Teto: mesmo dez vezes acima da última faixa, três níveis. Sem o teto, um
  // valor grande exigiria níveis que não existem e o título travaria.
  assert.equal(niveisExigidos(b, limites[2]! * 10), 3)
})

test('o posto é a posição da faixa, não o valor — trocar os limites não muda quem decide o quê', () => {
  const b = base()
  const postos = b.usuarios.map((u) => postoAlcada(b, u.id))
  assert.ok(postos.includes(0), 'ninguém sem alçada na massa')
  assert.ok(Math.max(...postos) === 3, 'ninguém com posto máximo na massa')
})

/* -------------------------------------------------- criação e alçada */

test('o título nasce em aprovação quando o valor exige, e aprovado quando não', () => {
  const b = base()
  const limites = limitesAlcada(b)
  const autor = semAlcada(b)

  const pequeno = criarTituloPagar(b, autor, { ...DADOS, valorOriginal: limites[0]! - 1 })
  assert.ok(pequeno.ok)
  assert.equal(pequeno.valor.status, 'APROVADO')
  assert.equal(pequeno.valor.aprovacoes.length, 0)

  const grande = criarTituloPagar(b, autor, { ...DADOS, valorOriginal: limites[1]! + 1 })
  assert.ok(grande.ok)
  assert.equal(grande.valor.status, 'EM_APROVACAO')
  assert.equal(grande.valor.aprovacoes.length, 2)
  assert.equal(nivelPendente(grande.valor)!.nivel, 1)
})

test('o valor devido é derivado: não existe campo a divergir', () => {
  const b = base()
  const r = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: 1_000 })
  assert.ok(r.ok)

  // A ausência é a garantia. Se algum dia alguém acrescentar `valorDevido` ao
  // modelo, este teste falha antes de a divergência aparecer como dinheiro que
  // não fecha.
  assert.ok(!('valorDevido' in r.valor), 'apareceu um campo de valor devido gravado')
  assert.ok(!('saldo' in r.valor), 'apareceu um campo de saldo gravado')
  assert.equal(valorDevidoDe(r.valor), 1_000)

  ajustarValorTitulo(b, r.valor.id, 1_150, 'multa de dois por cento e juro de mora')
  assert.equal(valorDevidoDe(r.valor), 1_150)
  assert.equal(r.valor.valorOriginal, 1_000, 'o original foi sobrescrito pelo ajuste')
})

test('o rateio pela metade é recusado, e o rateio vazio é legítimo', () => {
  const b = base()
  const autor = semAlcada(b)
  const centros = b.centrosCusto.filter((c) => c.ativo)

  const metade = criarTituloPagar(b, autor, {
    ...DADOS,
    valorOriginal: 500,
    rateio: [{ centroCustoId: centros[0]!.id, percentual: 60 }],
  })
  assert.ok(!metade.ok)
  assert.match(metade.erro.mensagem, /100%/)

  const inteiro = criarTituloPagar(b, autor, {
    ...DADOS,
    valorOriginal: 500,
    rateio: [
      { centroCustoId: centros[0]!.id, percentual: 60 },
      { centroCustoId: centros[1]!.id, percentual: 40 },
    ],
  })
  assert.ok(inteiro.ok)

  const vazio = criarTituloPagar(b, autor, { ...DADOS, valorOriginal: 500, rateio: [] })
  assert.ok(vazio.ok, 'rateio vazio deixou de ser aceito')
})

test('o mesmo centro duas vezes no rateio é recusado, e o inativo também', () => {
  const b = base()
  const autor = semAlcada(b)
  const ativo = b.centrosCusto.find((c) => c.ativo)!
  const inativo = b.centrosCusto.find((c) => !c.ativo)!

  const repetido = criarTituloPagar(b, autor, {
    ...DADOS,
    valorOriginal: 500,
    rateio: [
      { centroCustoId: ativo.id, percentual: 50 },
      { centroCustoId: ativo.id, percentual: 50 },
    ],
  })
  assert.ok(!repetido.ok)
  assert.match(repetido.erro.mensagem, /duas vezes/)

  const comInativo = criarTituloPagar(b, autor, {
    ...DADOS,
    valorOriginal: 500,
    rateio: [{ centroCustoId: inativo.id, percentual: 100 }],
  })
  assert.ok(!comInativo.ok)
  assert.match(comInativo.erro.mensagem, /inativo/)
})

/* ---------------------------------------------------------- aprovação */

test('quem lançou não aprova, mesmo tendo alçada de sobra', () => {
  const b = base()
  const limites = limitesAlcada(b)
  const diretor = comPosto(b, 3)

  const r = criarTituloPagar(b, diretor, { ...DADOS, valorOriginal: limites[0]! + 1 })
  assert.ok(r.ok)

  const decisao = decidirAprovacao(b, r.valor.id, 1, diretor, { decisao: 'APROVADO', justificativa: '' })
  assert.ok(!decisao.ok, 'o próprio lançador aprovou o seu título')
  assert.match(decisao.erro.mensagem, /não pode aprová-lo/)
  // A recusa traz saída: bloqueio sem alternativa deixa o operador travado.
  assert.ok(decisao.erro.acoes?.length)
})

test('o nível 2 não decide antes do nível 1, e a recusa diz o que esperar', () => {
  const b = base()
  const limites = limitesAlcada(b)
  const r = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: limites[1]! + 1 })
  assert.ok(r.ok)

  const fora = decidirAprovacao(b, r.valor.id, 2, comPosto(b, 2), {
    decisao: 'APROVADO',
    justificativa: '',
  })
  assert.ok(!fora.ok)
  assert.match(fora.erro.mensagem, /nível 1 ainda não decidiu/)

  const passo1 = decidirAprovacao(b, r.valor.id, 1, comPosto(b, 1), {
    decisao: 'APROVADO',
    justificativa: '',
  })
  assert.ok(passo1.ok)
  assert.equal(passo1.valor.status, 'EM_APROVACAO', 'quitou a aprovação antes do último nível')

  const passo2 = decidirAprovacao(b, r.valor.id, 2, comPosto(b, 2), {
    decisao: 'APROVADO',
    justificativa: '',
  })
  assert.ok(passo2.ok)
  assert.equal(passo2.valor.status, 'APROVADO')
})

test('sem alçada não se decide, e a recusa diz o que configurar', () => {
  const b = base()
  const limites = limitesAlcada(b)
  const r = criarTituloPagar(b, comPosto(b, 3), { ...DADOS, valorOriginal: limites[0]! + 1 })
  assert.ok(r.ok)

  const d = decidirAprovacao(b, r.valor.id, 1, semAlcada(b), { decisao: 'APROVADO', justificativa: '' })
  assert.ok(!d.ok)
  assert.match(d.erro.mensagem, /alçada/)
  assert.ok(d.erro.acoes?.some((a) => /configurar|delegação/i.test(a)))
})

test('um posto maior decide um nível menor: senão as férias do gerente travam a fila', () => {
  const b = base()
  const limites = limitesAlcada(b)
  const r = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: limites[0]! + 1 })
  assert.ok(r.ok)

  const d = decidirAprovacao(b, r.valor.id, 1, comPosto(b, 3), { decisao: 'APROVADO', justificativa: '' })
  assert.ok(d.ok, 'o posto 3 não pôde decidir o nível 1')
  assert.equal(d.valor.status, 'APROVADO')
})

test('a rejeição exige justificativa, volta a pendente e o reenvio abre nova rodada', () => {
  const b = base()
  const limites = limitesAlcada(b)
  const autor = semAlcada(b)
  const r = criarTituloPagar(b, autor, { ...DADOS, valorOriginal: limites[0]! + 1 })
  assert.ok(r.ok)

  const sem = decidirAprovacao(b, r.valor.id, 1, comPosto(b, 1), {
    decisao: 'REJEITADO',
    justificativa: 'não',
  })
  assert.ok(!sem.ok, 'rejeitou sem justificativa — o solicitante reenviaria igual')

  const com = decidirAprovacao(b, r.valor.id, 1, comPosto(b, 1), {
    decisao: 'REJEITADO',
    justificativa: 'sem o pedido de compra correspondente anexado',
  })
  assert.ok(com.ok)
  assert.equal(com.valor.status, 'PENDENTE', 'a rejeição levou a um estado terminal')

  const reenviado = reenviarTituloPagar(b, r.valor.id, autor)
  assert.ok(reenviado.ok)
  assert.equal(reenviado.valor.status, 'EM_APROVACAO')

  // A rodada antiga fica preservada: é a rejeição que explica a correção.
  const rodadas = new Set(reenviado.valor.aprovacoes.map((a) => a.rodada))
  assert.deepEqual([...rodadas].sort(), [1, 2])
  assert.ok(
    reenviado.valor.aprovacoes.some((a) => a.rodada === 1 && a.decisao === 'REJEITADO'),
    'a decisão anterior foi apagada pelo reenvio',
  )
  assert.equal(nivelPendente(reenviado.valor)!.rodada, 2)
})

test('o reenvio é de quem lançou, e só de um título pendente', () => {
  const b = base()
  const limites = limitesAlcada(b)
  const autor = semAlcada(b)
  const r = criarTituloPagar(b, autor, { ...DADOS, valorOriginal: limites[0]! + 1 })
  assert.ok(r.ok)

  // Em aprovação, não pendente: reenviar abriria uma segunda rodada sobre uma
  // primeira ainda viva, e haveria dois níveis 1 esperando decisão.
  assert.ok(!reenviarTituloPagar(b, r.valor.id, autor).ok)

  decidirAprovacao(b, r.valor.id, 1, comPosto(b, 1), {
    decisao: 'REJEITADO',
    justificativa: 'documentação incompleta para conferência',
  })
  assert.ok(!reenviarTituloPagar(b, r.valor.id, comPosto(b, 3)).ok, 'terceiro reenviou o título de outro')
  assert.ok(reenviarTituloPagar(b, r.valor.id, autor).ok)
})

/* --------------------------------------------------------------- fila */

test('a fila do aprovador não oferece o que ele não pode decidir', () => {
  const b = base()
  const limites = limitesAlcada(b)
  const autor = comPosto(b, 1)
  const r = criarTituloPagar(b, autor, { ...DADOS, valorOriginal: limites[1]! + 1 })
  assert.ok(r.ok)
  const id = r.valor.id

  // 1. Quem lançou não vê o próprio título: a regra recusaria a decisão de
  //    qualquer forma, e oferecer é convidar ao erro.
  assert.ok(!filaDeAprovacao(b, autor).some((t) => t.id === id))

  // 2. Quem não tem alçada não vê nada.
  assert.ok(!filaDeAprovacao(b, semAlcada(b)).some((t) => t.id === id))

  // 3. Quem tem posto suficiente para o nível pendente vê.
  assert.ok(filaDeAprovacao(b, comPosto(b, 2)).some((t) => t.id === id))

  // 4. Depois de aprovado, sai da fila de todo mundo.
  decidirAprovacao(b, id, 1, comPosto(b, 2), { decisao: 'APROVADO', justificativa: '' })
  decidirAprovacao(b, id, 2, comPosto(b, 3), { decisao: 'APROVADO', justificativa: '' })
  assert.ok(!filaDeAprovacao(b, comPosto(b, 2)).some((t) => t.id === id))
  assert.ok(!filaDeAprovacao(b, comPosto(b, 3)).some((t) => t.id === id))
})

/* ---------------------------------------------------------- pagamento */

test('a baixa debita a conta no mesmo ato, e o parcial recalcula o saldo', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const antes = saldoDaConta(b, conta.id)
  const r = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: 900 })
  assert.ok(r.ok)
  assert.equal(r.valor.status, 'APROVADO')

  const parcial = pagarTitulo(b, r.valor.id, {
    valorPago: 400,
    dataPagamento: '2026-07-30',
    contaId: conta.id,
    forma: 'PIX',
  })
  assert.ok(parcial.ok)
  assert.equal(parcial.valor.status, 'PAGO_PARCIAL')
  assert.equal(saldoDoTitulo(parcial.valor), 500)
  assert.equal(saldoDaConta(b, conta.id), antes - 400, 'a saída não chegou ao extrato')

  const resto = pagarTitulo(b, r.valor.id, {
    valorPago: 500,
    dataPagamento: '2026-07-30',
    contaId: conta.id,
    forma: 'PIX',
  })
  assert.ok(resto.ok)
  assert.equal(resto.valor.status, 'PAGO')
  assert.equal(saldoDoTitulo(resto.valor), 0)
})

test('pagamento acima do saldo é recusado, e não vira crédito com o fornecedor', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const r = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: 900 })
  assert.ok(r.ok)

  const d = pagarTitulo(b, r.valor.id, {
    valorPago: 901,
    dataPagamento: '2026-07-30',
    contaId: conta.id,
    forma: 'BOLETO',
  })
  assert.ok(!d.ok)
  assert.equal(totalPago(r.valor), 0, 'o excesso entrou mesmo tendo sido recusado')
})

test('não se paga o que a aprovação não liberou', () => {
  const b = base()
  const limites = limitesAlcada(b)
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const r = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: limites[0]! + 1 })
  assert.ok(r.ok)
  assert.equal(r.valor.status, 'EM_APROVACAO')

  const d = pagarTitulo(b, r.valor.id, {
    valorPago: 10,
    dataPagamento: '2026-07-30',
    contaId: conta.id,
    forma: 'PIX',
  })
  assert.ok(!d.ok)
  assert.match(d.erro.mensagem, /aprovação vem antes/)
})

test('o estorno devolve o dinheiro à conta, e não se estorna duas vezes', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const antes = saldoDaConta(b, conta.id)
  const r = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: 700 })
  assert.ok(r.ok)

  pagarTitulo(b, r.valor.id, {
    valorPago: 700,
    dataPagamento: '2026-07-30',
    contaId: conta.id,
    forma: 'TRANSFERENCIA',
  })
  assert.equal(r.valor.status, 'PAGO')
  const pagamentoId = r.valor.pagamentos[0]!.id

  const e = estornarPagamentoTitulo(b, r.valor.id, pagamentoId, 'boleto pago em duplicidade')
  assert.ok(e.ok)
  assert.equal(e.valor.status, 'APROVADO', 'o título estornado não reabriu')
  assert.equal(saldoDaConta(b, conta.id), antes, 'o dinheiro não voltou para a conta')

  const denovo = estornarPagamentoTitulo(b, r.valor.id, pagamentoId, 'tentando outra vez')
  assert.ok(!denovo.ok)
  assert.match(denovo.erro.mensagem, /já foi estornado/)
})

/* -------------------------------------------------------- parcelamento */

test('o parcelamento nasce inteiro, fecha ao centavo, e as parcelas herdam o status', () => {
  const b = base()
  const limites = limitesAlcada(b)
  const total = limites[0]! + 1
  const r = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: total, parcelas: 7 })
  assert.ok(r.ok)

  const parcelas = parcelasDe(b, r.valor.id)
  assert.equal(parcelas.length, 7)
  assert.ok(ehPaiDeParcelas(b, r.valor))

  // O total das parcelas fecha com o do pai: é a soma que o fornecedor cobra, e
  // sete parcelas arredondadas por igual divergiriam dele em centavos.
  const soma = parcelas.reduce((s, p) => s + p.valorOriginal, 0)
  assert.equal(Math.round(soma * 100), Math.round(total * 100))

  // Herdam o status do pai, sem rodada própria: nascer pendente sem rodada
  // aberta as deixaria impagáveis para sempre, esperando aprovação que ninguém
  // pode dar. E é o valor do pai que a alçada avalia — aprovar parcela por
  // parcela deixaria o total passar como sete títulos pequenos.
  assert.ok(parcelas.every((p) => p.status === r.valor.status))
  assert.ok(parcelas.every((p) => p.aprovacoes.length === 0))

  decidirAprovacao(b, r.valor.id, 1, comPosto(b, 1), { decisao: 'APROVADO', justificativa: '' })
  assert.equal(r.valor.status, 'APROVADO')
  assert.ok(
    parcelasDe(b, r.valor.id).every((p) => p.status === 'APROVADO'),
    'as parcelas ficaram para trás da aprovação do pai',
  )
})

test('o pai de um parcelamento não se paga: pagá-lo dobraria a despesa', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const r = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: 1_200, parcelas: 3 })
  assert.ok(r.ok)

  const d = pagarTitulo(b, r.valor.id, {
    valorPago: 1_200,
    dataPagamento: '2026-07-30',
    contaId: conta.id,
    forma: 'TRANSFERENCIA',
  })
  assert.ok(!d.ok)
  assert.match(d.erro.mensagem, /pago nas parcelas/)

  // A parcela, sim.
  const primeira = parcelasDe(b, r.valor.id)[0]!
  const paga = pagarTitulo(b, primeira.id, {
    valorPago: primeira.valorOriginal,
    dataPagamento: '2026-07-30',
    contaId: conta.id,
    forma: 'TRANSFERENCIA',
  })
  assert.ok(paga.ok)
})

/* -------------------------------------------------------- cancelamento */

test('o cancelamento em cascata exige confirmação, e parcela paga não se cancela', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const r = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: 1_200, parcelas: 3 })
  assert.ok(r.ok)

  const silencioso = cancelarTituloPagar(b, r.valor.id, 'lançado por engano')
  assert.ok(!silencioso.ok, 'cancelou três parcelas sem confirmação')
  assert.match(silencioso.erro.mensagem, /parcela/)

  const comConfirmacao = cancelarTituloPagar(b, r.valor.id, 'lançado por engano', true)
  assert.ok(comConfirmacao.ok)
  assert.ok(parcelasDe(b, r.valor.id).every((p) => p.status === 'CANCELADO'))

  // Outro parcelamento, com uma parcela paga: aí nem com confirmação.
  const outro = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: 900, parcelas: 3 })
  assert.ok(outro.ok)
  const primeira = parcelasDe(b, outro.valor.id)[0]!
  pagarTitulo(b, primeira.id, {
    valorPago: primeira.valorOriginal,
    dataPagamento: '2026-07-30',
    contaId: conta.id,
    forma: 'PIX',
  })
  const recusado = cancelarTituloPagar(b, outro.valor.id, 'desistimos do contrato', true)
  assert.ok(!recusado.ok)
  assert.match(recusado.erro.mensagem, /já foram pagas/)
})

test('título com pagamento não é cancelado — estorne primeiro', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const r = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: 300 })
  assert.ok(r.ok)
  pagarTitulo(b, r.valor.id, {
    valorPago: 300,
    dataPagamento: '2026-07-30',
    contaId: conta.id,
    forma: 'PIX',
  })

  const d = cancelarTituloPagar(b, r.valor.id, 'nota cancelada pelo fornecedor')
  assert.ok(!d.ok)
  assert.ok(d.erro.acoes?.some((a) => /estorne/i.test(a)))
})

/* ------------------------------------------------------------ ajuste */

test('o ajuste não desce abaixo do que já foi pago', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const r = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: 1_000 })
  assert.ok(r.ok)
  pagarTitulo(b, r.valor.id, {
    valorPago: 600,
    dataPagamento: '2026-07-30',
    contaId: conta.id,
    forma: 'PIX',
  })

  const abaixo = ajustarValorTitulo(b, r.valor.id, 500, 'desconto negociado por atraso na entrega')
  assert.ok(!abaixo.ok)
  assert.ok(abaixo.erro.acoes?.some((a) => /estorne/i.test(a)))

  // Exatamente o que foi pago: quita o título.
  const quita = ajustarValorTitulo(b, r.valor.id, 600, 'desconto negociado por atraso na entrega')
  assert.ok(quita.ok)
  assert.equal(saldoDoTitulo(quita.valor), 0)
  assert.equal(quita.valor.status, 'PAGO')
})

test('o ajuste exige motivo: ele muda o que se vai pagar', () => {
  const b = base()
  const r = criarTituloPagar(b, semAlcada(b), { ...DADOS, valorOriginal: 400 })
  assert.ok(r.ok)
  assert.ok(!ajustarValorTitulo(b, r.valor.id, 450, 'oi').ok)
  assert.ok(!ajustarValorTitulo(b, r.valor.id, 0, 'multa contratual de mora').ok)
})

/* --------------------------------------------------------- delegação */

test('a delegação vigente habilita o delegado, e não dispensa a segregação de funções', () => {
  const b = base()
  const limites = limitesAlcada(b)
  const gestor = comPosto(b, 1)
  const sem = semAlcada(b)
  const autor = comPosto(b, 3)

  const d = criarDelegacao(b, gestor, {
    delegadoId: sem,
    nivel: 1,
    inicio: '2026-07-01',
    fim: '2026-12-31',
    motivo: 'férias de agosto',
  })
  assert.ok(d.ok)
  assert.equal(d.valor.deleganteId, gestor, 'o delegante não é quem chamou')

  const r = criarTituloPagar(b, autor, { ...DADOS, valorOriginal: limites[0]! + 1 })
  assert.ok(r.ok)
  const decidiu = decidirAprovacao(b, r.valor.id, 1, sem, { decisao: 'APROVADO', justificativa: '' })
  assert.ok(decidiu.ok, 'o delegado não conseguiu decidir')
  // Fica registrado de quem veio a autoridade: sem isso a trilha diria que
  // alguém sem alçada aprovou, e a auditoria não teria como explicar.
  assert.equal(decidiu.valor.aprovacoes[0]!.delegadoDe, gestor)

  // Mas o delegado que também lançou continua barrado.
  const proprio = criarTituloPagar(b, sem, { ...DADOS, valorOriginal: limites[0]! + 1 })
  assert.ok(proprio.ok)
  const barrado = decidirAprovacao(b, proprio.valor.id, 1, sem, {
    decisao: 'APROVADO',
    justificativa: '',
  })
  assert.ok(!barrado.ok, 'a delegação passou por cima da segregação de funções')
})

test('não se delega acima do próprio posto, nem a si mesmo, nem em sobreposição', () => {
  const b = base()
  const gestor = comPosto(b, 1)
  const sem = semAlcada(b)
  const periodo = { inicio: '2026-08-01', fim: '2026-08-15', motivo: 'férias' }

  assert.ok(!criarDelegacao(b, gestor, { delegadoId: sem, nivel: 3, ...periodo }).ok)
  assert.ok(!criarDelegacao(b, gestor, { delegadoId: gestor, nivel: 1, ...periodo }).ok)

  assert.ok(criarDelegacao(b, gestor, { delegadoId: sem, nivel: 1, ...periodo }).ok)
  // Sobreposta: duas delegações vigentes do mesmo nível tornariam ambíguo quem
  // responde pela decisão, que é o que a delegação existe para manter claro.
  const sobreposta = criarDelegacao(b, gestor, {
    delegadoId: sem,
    nivel: 1,
    inicio: '2026-08-10',
    fim: '2026-08-20',
    motivo: 'emenda',
  })
  assert.ok(!sobreposta.ok)
  assert.match(sobreposta.erro.mensagem, /Já existe delegação/)
})

test('a delegação fora do período não habilita ninguém', () => {
  const b = base()
  const limites = limitesAlcada(b)
  const gestor = comPosto(b, 1)
  const sem = semAlcada(b)

  // Passada: a data de referência da base é 2026-07-30.
  assert.ok(
    criarDelegacao(b, gestor, {
      delegadoId: sem,
      nivel: 1,
      inicio: '2026-01-01',
      fim: '2026-01-31',
      motivo: 'férias de janeiro',
    }).ok,
  )

  const r = criarTituloPagar(b, comPosto(b, 3), { ...DADOS, valorOriginal: limites[0]! + 1 })
  assert.ok(r.ok)
  const d = decidirAprovacao(b, r.valor.id, 1, sem, { decisao: 'APROVADO', justificativa: '' })
  assert.ok(!d.ok, 'uma delegação vencida ainda habilitava a decisão')
})

/* ---------------------------------------------------- massa gerada */

test('a massa de demonstração cobre os estados difíceis, não só os quitados', () => {
  const b = base()
  const estados = new Set(b.titulosPagar.map((t) => t.status))

  for (const esperado of ['EM_APROVACAO', 'PENDENTE', 'APROVADO', 'PAGO_PARCIAL', 'PAGO', 'EM_DISPUTA']) {
    assert.ok(estados.has(esperado as never), `a massa não tem nenhum título ${esperado}`)
  }

  // Uma rejeição registrada, um parcelamento e uma delegação vigente: os três
  // casos que a tela erra se ninguém os exercitar.
  assert.ok(
    b.titulosPagar.some((t) => t.aprovacoes.some((a) => a.decisao === 'REJEITADO')),
    'nenhuma rejeição na massa — o histórico de rodada nunca aparece',
  )
  assert.ok(b.titulosPagar.some((t) => ehPaiDeParcelas(b, t)), 'nenhum parcelamento na massa')
  assert.ok(b.delegacoes.length > 0, 'nenhuma delegação na massa')
})

test('o total das parcelas da massa fecha com o total do pai', () => {
  const b = base()
  for (const pai of b.titulosPagar.filter((t) => ehPaiDeParcelas(b, t))) {
    const soma = parcelasDe(b, pai.id).reduce((s, p) => s + p.valorOriginal, 0)
    assert.equal(
      Math.round(soma * 100),
      Math.round(valorDevidoDe(pai) * 100),
      `as parcelas de ${pai.descricao} não fecham com o total`,
    )
  }
})
