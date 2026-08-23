/**
 * Comandos de lançamentos futuros e fluxo de caixa — Módulos 12 e 13.
 *
 * O que estes testes protegem, em duas frases:
 *
 *  1. **Um compromisso previsto gera um título, e só um.** Um título duplicado
 *     não é um número errado num relatório: é um segundo boleto para o mesmo
 *     compromisso, tão legítimo quanto o primeiro.
 *  2. **A projeção não promete dinheiro que não vem, e o cenário de estresse não
 *     deixa a operação mais otimista.** As duas erram em silêncio — um título
 *     BAIXADO *parece* receita, e descontar a inadimplência dos dois lados mantém
 *     o saldo do dia parecendo razoável.
 *
 * As mesmas regras existem como gatilho na migração 0021 e como teste de
 * integração em `apps/api/test/`. Não é redundância: aqui elas permitem a tela
 * recusar antes de pedir; lá valem para quem não passa pela tela.
 *
 * Nenhum valor abaixo é regra de negócio da IARX: periodicidades, dias de
 * vencimento e percentuais de cenário vêm da massa de demonstração.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarBase } from '../src/dados/gerar.ts'
import {
  alertasDeCaixa,
  alternarRecorrencia,
  avancarPeriodicidade,
  cancelarLancamentoFuturo,
  cenarioPadrao,
  converterLancamentoFuturo,
  criarLancamentoFuturo,
  criarRecorrencia,
  editarLancamentoFuturo,
  elegivelParaConversao,
  gerarProximoLancamento,
  impedimentoDeConversao,
  ladoDoTipo,
  naFilaDeExcecao,
  previaDeConversao,
  projetarCaixa,
  saldoDoTituloReceber,
} from '../src/dados/comandos.ts'
import { HOJE } from '../src/dados/gerar.ts'

const hoje = () => HOJE.toISOString().slice(0, 10)
const emDias = (n: number) => {
  const d = new Date(HOJE)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const despesa = (extra: Record<string, unknown> = {}) => ({
  tipo: 'DESPESA_RECORRENTE' as const,
  descricao: 'Compromisso de teste',
  valorPrevisto: 1500,
  dataPrevista: emDias(10),
  classificacao: 'DESPESA_FIXA' as const,
  ...extra,
})

/* ------------------------------------------------- lado e discriminador */

test('o lado é consequência do tipo, nunca uma segunda escolha', () => {
  assert.equal(ladoDoTipo('DESPESA_RECORRENTE'), 'PAGAR')
  assert.equal(ladoDoTipo('DESPESA_PARCELADA'), 'PAGAR')
  // Provisão é sempre a pagar: marcá-la como receita geraria cobrança onde
  // deveria haver despesa.
  assert.equal(ladoDoTipo('PROVISAO'), 'PAGAR')
  assert.equal(ladoDoTipo('RECEITA_RECORRENTE'), 'RECEBER')
  assert.equal(ladoDoTipo('RECEITA_PARCELADA'), 'RECEBER')
})

test('uma despesa prevista não aceita cliente, e uma receita exige um', () => {
  const base = gerarBase()

  const comCliente = criarLancamentoFuturo(base, 'usr-admin', {
    ...despesa(),
    clienteId: base.clientes[0]!.id,
  })
  assert.equal(comCliente.ok, false)

  const semCliente = criarLancamentoFuturo(base, 'usr-admin', {
    tipo: 'RECEITA_RECORRENTE',
    descricao: 'Receita sem destinatário',
    valorPrevisto: 900,
    dataPrevista: emDias(10),
  })
  assert.equal(semCliente.ok, false)

  // E a receita não carrega classificação de despesa.
  const comClassificacao = criarLancamentoFuturo(base, 'usr-admin', {
    tipo: 'RECEITA_RECORRENTE',
    descricao: 'Receita classificada como despesa',
    valorPrevisto: 900,
    dataPrevista: emDias(10),
    clienteId: base.clientes[0]!.id,
    classificacao: 'DESPESA_FIXA',
  })
  assert.equal(comClassificacao.ok, false)
})

test('uma despesa prevista exige classificação', () => {
  const base = gerarBase()
  const r = criarLancamentoFuturo(base, 'usr-admin', {
    tipo: 'DESPESA_RECORRENTE',
    descricao: 'Despesa sem classificação',
    valorPrevisto: 400,
    dataPrevista: emDias(5),
  })
  assert.equal(r.ok, false)
})

test('o lançamento nasce programado, sem título e sem data de conversão', () => {
  const base = gerarBase()
  const r = criarLancamentoFuturo(base, 'usr-admin', despesa())
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.valor.status, 'PROGRAMADO')
  // Não convertido não aponta para título: é o estado que faria a conversão
  // parecer feita sem ter sido.
  assert.equal(r.valor.tituloPagarId, null)
  assert.equal(r.valor.tituloReceberId, null)
  assert.equal(r.valor.convertidoEm, null)
  assert.equal(r.valor.excecaoConversao, null)
})

test('o lançamento não guarda atraso nem marca de fila — os dois são derivados', () => {
  const base = gerarBase()
  const r = criarLancamentoFuturo(base, 'usr-admin', despesa())
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.ok(!('emAtraso' in r.valor), 'não existe campo de atraso')
  assert.ok(!('diasAtraso' in r.valor), 'nem contador de dias')
  assert.ok(!('naFilaDeExcecao' in r.valor), 'nem booleano de fila')
})

/* ---------------------------------------------------------- RN-F17 */

test('programado se edita; convertido e cancelado, não', () => {
  const base = gerarBase()
  const criado = criarLancamentoFuturo(base, 'usr-admin', despesa({ dataPrevista: emDias(-1) }))
  assert.equal(criado.ok, true)
  if (!criado.ok) return

  const editado = editarLancamentoFuturo(base, criado.valor.id, { valorPrevisto: 1700 })
  assert.equal(editado.ok, true)
  assert.equal(base.lancamentosFuturos.find((l) => l.id === criado.valor.id)!.valorPrevisto, 1700)

  const convertido = converterLancamentoFuturo(base, criado.valor.id, 'usr-admin')
  assert.equal(convertido.ok, true)

  const depois = editarLancamentoFuturo(base, criado.valor.id, { valorPrevisto: 1 })
  assert.equal(depois.ok, false)
  if (!depois.ok) {
    assert.match(depois.erro.mensagem, /não se edita/)
    // A recusa diz onde a despesa realmente vive.
    assert.ok(depois.erro.acoes?.some((a) => /título gerado/.test(a)))
  }

  const cancelamento = cancelarLancamentoFuturo(base, criado.valor.id, 'desistimos do compromisso')
  assert.equal(cancelamento.ok, false)
  if (!cancelamento.ok) assert.match(cancelamento.erro.mensagem, /não se cancela/)
})

test('cancelar exige motivo, e cancelado não converte', () => {
  const base = gerarBase()
  const criado = criarLancamentoFuturo(base, 'usr-admin', despesa({ dataPrevista: emDias(-1) }))
  assert.equal(criado.ok, true)
  if (!criado.ok) return

  assert.equal(cancelarLancamentoFuturo(base, criado.valor.id, 'oi').ok, false)

  const c = cancelarLancamentoFuturo(base, criado.valor.id, 'contrato não foi assinado')
  assert.equal(c.ok, true)
  assert.equal(base.lancamentosFuturos.find((l) => l.id === criado.valor.id)!.status, 'CANCELADO')

  const conversao = converterLancamentoFuturo(base, criado.valor.id, 'usr-admin')
  assert.equal(conversao.ok, false)
})

/* ---------------------------------------------------------- RN-F15 */

test('RN-F15: a segunda conversão não acontece, e não há segundo título', () => {
  const base = gerarBase()
  const criado = criarLancamentoFuturo(base, 'usr-admin', despesa({ valorPrevisto: 7777, dataPrevista: emDias(-1) }))
  assert.equal(criado.ok, true)
  if (!criado.ok) return

  const primeira = converterLancamentoFuturo(base, criado.valor.id, 'usr-admin')
  assert.equal(primeira.ok, true)
  if (!primeira.ok) return
  assert.ok(primeira.valor.tituloPagar, 'a primeira conversão gerou título')

  const segunda = converterLancamentoFuturo(base, criado.valor.id, 'usr-admin')
  assert.equal(segunda.ok, false)
  if (!segunda.ok) assert.match(segunda.erro.mensagem, /não se converte/)

  const iguais = base.titulosPagar.filter((t) => t.valorOriginal === 7777)
  assert.equal(iguais.length, 1, 'um compromisso, um título')
})

test('a conversão liga os dois lados e leva a filial e o centro de custo', () => {
  const base = gerarBase()
  const filial = base.filiais[1]!.id
  const centro = base.centrosCusto.find((c) => c.ativo)!.id

  const criado = criarLancamentoFuturo(base, 'usr-admin', despesa({
    dataPrevista: emDias(-1),
    filialId: filial,
    centroCustoId: centro,
  }))
  assert.equal(criado.ok, true)
  if (!criado.ok) return

  const r = converterLancamentoFuturo(base, criado.valor.id, 'usr-admin')
  assert.equal(r.ok, true)
  if (!r.ok) return

  const lf = base.lancamentosFuturos.find((l) => l.id === criado.valor.id)!
  assert.equal(lf.status, 'CONVERTIDO')
  assert.equal(lf.tituloPagarId, r.valor.tituloPagar!.id)
  assert.equal(lf.tituloReceberId, null, 'o lado errado fica vazio')
  assert.ok(lf.convertidoEm)

  const titulo = r.valor.tituloPagar!
  assert.equal(titulo.filialId, filial, 'a filial acompanha: é o recorte da projeção')
  assert.equal(titulo.dataVencimento, emDias(-1), 'o vencimento é a data planejada')
  assert.ok(titulo.dataEmissao <= titulo.dataVencimento, 'emissão nunca depois do vencimento')
  assert.equal(titulo.rateio[0]?.centroCustoId, centro)
  assert.equal(titulo.rateio[0]?.percentual, 100)
})

test('o título a receber convertido nasce AVULSO e mantém o contrato', () => {
  const base = gerarBase()
  const contrato = base.contratos.find((c) => c.status === 'ATIVO')!

  const criado = criarLancamentoFuturo(base, 'usr-admin', {
    tipo: 'RECEITA_RECORRENTE',
    descricao: 'Suporte previsto',
    valorPrevisto: 650,
    dataPrevista: emDias(-1),
    clienteId: contrato.clienteId,
    contratoId: contrato.id,
  })
  assert.equal(criado.ok, true)
  if (!criado.ok) return

  const r = converterLancamentoFuturo(base, criado.valor.id, 'usr-admin')
  assert.equal(r.ok, true)
  if (!r.ok) return

  const titulo = r.valor.tituloReceber!
  /*
   * CONTRATUAL exigiria competência, e um lançamento futuro não tem uma — ele não
   * veio de medição. Marcá-lo contratual faria uma cobrança de valor digitado
   * ficar indistinguível da calculada pelo motor de preço.
   */
  assert.equal(titulo.origem, 'AVULSO')
  assert.equal(titulo.competencia, null)
  assert.equal(titulo.contratoId, contrato.id, 'e o contrato sobrevive à conversão')
})

/* ---------------------------------------------------------- RN-F16 */

test('RN-F16: contrato fora de vigência não converte, e a recusa não é erro', () => {
  const base = gerarBase()
  const inativo = base.contratos.find((c) => c.status !== 'ATIVO')
  assert.ok(inativo, 'a massa tem um contrato fora de vigência')

  const criado = criarLancamentoFuturo(base, 'usr-admin', {
    tipo: 'RECEITA_RECORRENTE',
    descricao: 'Mensalidade de contrato parado',
    valorPrevisto: 2450,
    dataPrevista: emDias(-1),
    clienteId: inativo!.clienteId,
    contratoId: inativo!.id,
  })
  assert.equal(criado.ok, true)
  if (!criado.ok) return

  const r = converterLancamentoFuturo(base, criado.valor.id, 'usr-admin')
  // Sucesso, e não falha: devolver erro faria a tela tratar como problema o
  // comportamento correto.
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.valor.tituloReceber, null)
  assert.equal(r.valor.tituloPagar, null)
  assert.match(r.valor.excecao!, new RegExp(inativo!.status))

  const lf = base.lancamentosFuturos.find((l) => l.id === criado.valor.id)!
  assert.equal(lf.status, 'PROGRAMADO', 'continua programado')
  assert.ok(naFilaDeExcecao(lf), 'e entra na fila de exceção')
  assert.equal(lf.tentativasConversao, 1, 'a tentativa é contada')
})

test('a recusa por vigência não é definitiva: reativado o contrato, converte', () => {
  const base = gerarBase()
  const inativo = base.contratos.find((c) => c.status !== 'ATIVO')!

  const criado = criarLancamentoFuturo(base, 'usr-admin', {
    tipo: 'RECEITA_RECORRENTE',
    descricao: 'Mensalidade retomada',
    valorPrevisto: 700,
    dataPrevista: emDias(-1),
    clienteId: inativo.clienteId,
    contratoId: inativo.id,
  })
  if (!criado.ok) return

  converterLancamentoFuturo(base, criado.valor.id, 'usr-admin')
  assert.ok(naFilaDeExcecao(base.lancamentosFuturos.find((l) => l.id === criado.valor.id)!))

  // A vigência é checada **agora**, não quando o lançamento foi criado.
  inativo.status = 'ATIVO'
  const r = converterLancamentoFuturo(base, criado.valor.id, 'usr-admin')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.ok(r.valor.tituloReceber)

  const lf = base.lancamentosFuturos.find((l) => l.id === criado.valor.id)!
  assert.equal(lf.excecaoConversao, null, 'a exceção antiga não sobrevive ao sucesso')
})

test('a prévia antecipa o impedimento sem contar tentativa', () => {
  const base = gerarBase()
  const inativo = base.contratos.find((c) => c.status !== 'ATIVO')!
  const criado = criarLancamentoFuturo(base, 'usr-admin', {
    tipo: 'RECEITA_RECORRENTE',
    descricao: 'Prévia sem rastro',
    valorPrevisto: 500,
    dataPrevista: emDias(-1),
    clienteId: inativo.clienteId,
    contratoId: inativo.id,
  })
  if (!criado.ok) return

  const antes = criado.valor.tentativasConversao
  const previa = previaDeConversao(base, criado.valor)
  assert.match(previa.impedimento!, new RegExp(inativo.status))
  assert.equal(previa.lado, 'RECEBER')
  assert.equal(previa.valorPrevisto, 500)
  /*
   * O ponto do caso: abrir o diálogo e desistir não deixa rastro. Se a prévia
   * "simulasse" convertendo, o contador subiria por curiosidade.
   */
  assert.equal(
    base.lancamentosFuturos.find((l) => l.id === criado.valor.id)!.tentativasConversao,
    antes,
  )
  assert.equal(base.lancamentosFuturos.find((l) => l.id === criado.valor.id)!.excecaoConversao, null)
})

test('a prévia diz quantas aprovações o título vai exigir', () => {
  const base = gerarBase()
  const baixo = criarLancamentoFuturo(base, 'usr-admin', despesa({ valorPrevisto: 400 }))
  const alto = criarLancamentoFuturo(base, 'usr-admin', despesa({ valorPrevisto: 400_000 }))
  if (!baixo.ok || !alto.ok) return

  assert.equal(previaDeConversao(base, baixo.valor).niveisAprovacao, 0)
  assert.ok(
    previaDeConversao(base, alto.valor).niveisAprovacao >= 2,
    'geração automática não dispensa a alçada',
  )
})

test('convertido não tem impedimento de vigência: tem o de já ter convertido', () => {
  const base = gerarBase()
  const criado = criarLancamentoFuturo(base, 'usr-admin', despesa({ dataPrevista: emDias(-1) }))
  if (!criado.ok) return
  converterLancamentoFuturo(base, criado.valor.id, 'usr-admin')
  const lf = base.lancamentosFuturos.find((l) => l.id === criado.valor.id)!
  assert.match(impedimentoDeConversao(base, lf)!, /uma vez só/)
})

/* ---------------------------------------------------------- RN-F18 */

test('RN-F18: a periodicidade soma meses, não dias', () => {
  assert.equal(avancarPeriodicidade('2026-01-10', 'MENSAL'), '2026-02-10')
  assert.equal(avancarPeriodicidade('2026-01-10', 'TRIMESTRAL'), '2026-04-10')
  assert.equal(avancarPeriodicidade('2026-01-10', 'SEMESTRAL'), '2026-07-10')
  assert.equal(avancarPeriodicidade('2026-01-10', 'ANUAL'), '2027-01-10')
  // Dia 31 em fevereiro cai no último dia, não vaza para março: é o que o dia
  // limitado a 28 evita ter de decidir na série.
  assert.equal(avancarPeriodicidade('2026-01-31', 'MENSAL'), '2026-02-28')
})

test('a série gera um período por chamada, e a data avança', () => {
  const base = gerarBase()
  const serie = base.recorrencias.find((r) => r.periodicidade === 'MENSAL' && r.ativo)!
  const dataInicial = serie.proximaGeracao
  const antes = base.lancamentosFuturos.filter((l) => l.recorrenciaId === serie.id).length

  const primeiro = gerarProximoLancamento(base, serie.id, 'usr-admin')
  assert.equal(primeiro.ok, true)
  if (!primeiro.ok) return
  assert.ok(primeiro.valor, 'nasceu um lançamento')
  assert.equal(primeiro.valor!.dataPrevista, dataInicial)
  assert.equal(serie.proximaGeracao, avancarPeriodicidade(dataInicial, 'MENSAL'))

  assert.equal(
    base.lancamentosFuturos.filter((l) => l.recorrenciaId === serie.id).length,
    antes + 1,
    'uma chamada, um período',
  )

  // A segunda gera o período seguinte, não um segundo do mesmo dia.
  gerarProximoLancamento(base, serie.id, 'usr-admin')
  const doMesmoDia = base.lancamentosFuturos.filter(
    (l) => l.recorrenciaId === serie.id && l.dataPrevista === dataInicial,
  )
  assert.equal(doMesmoDia.length, 1, 'a mesma data não nasce duas vezes')
})

test('o lançamento gerado espelha o molde inteiro', () => {
  const base = gerarBase()
  const serie = base.recorrencias.find((r) => r.ativo)!
  const r = gerarProximoLancamento(base, serie.id, 'usr-admin')
  if (!r.ok || !r.valor) return

  assert.equal(r.valor.valorPrevisto, serie.valorBase)
  assert.equal(r.valor.lado, serie.lado)
  assert.equal(r.valor.filialId, serie.filialId)
  assert.equal(r.valor.centroCustoId, serie.centroCustoId)
  assert.equal(r.valor.contratoId, serie.contratoId)
  assert.equal(r.valor.recorrenciaId, serie.id)
  assert.equal(r.valor.status, 'PROGRAMADO')
})

test('série desativada não gera, e o que ela já produziu fica', () => {
  const base = gerarBase()
  const serie = base.recorrencias.find((r) => r.ativo)!
  gerarProximoLancamento(base, serie.id, 'usr-admin')
  const produzidos = base.lancamentosFuturos.filter((l) => l.recorrenciaId === serie.id).length

  alternarRecorrencia(base, serie.id, false)
  const r = gerarProximoLancamento(base, serie.id, 'usr-admin')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.valor, null, 'inativa não gera')
  assert.equal(
    base.lancamentosFuturos.filter((l) => l.recorrenciaId === serie.id).length,
    produzidos,
    'e não apaga o que já existia',
  )
})

test('converter um lançamento de série programa o próximo', () => {
  const base = gerarBase()
  const serie = base.recorrencias.find((r) => r.lado === 'PAGAR' && r.ativo)!
  const gerado = gerarProximoLancamento(base, serie.id, 'usr-admin')
  if (!gerado.ok || !gerado.valor) return

  const antes = base.lancamentosFuturos.filter((l) => l.recorrenciaId === serie.id).length
  const r = converterLancamentoFuturo(base, gerado.valor.id, 'usr-admin')
  assert.equal(r.ok, true)
  if (!r.ok) return

  assert.ok(r.valor.proximoLancamentoId, 'a série andou ao converter')
  assert.equal(
    base.lancamentosFuturos.filter((l) => l.recorrenciaId === serie.id).length,
    antes + 1,
    'exatamente um novo — nunca o lote',
  )
})

test('a série recusa dia de vencimento acima de 28, e diz por quê', () => {
  const base = gerarBase()
  const r = criarRecorrencia(base, {
    lado: 'PAGAR',
    descricao: 'Série do dia 31',
    valorBase: 100,
    periodicidade: 'MENSAL',
    diaVencimento: 31,
    proximaGeracao: emDias(30),
    classificacao: 'DESPESA_FIXA',
  })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.match(r.erro.mensagem, /1 a 28/)
    assert.ok(r.erro.acoes?.some((a) => /fevereiro/.test(a)), 'a recusa explica a razão real')
  }
})

test('o lado da série amarra fornecedor e cliente', () => {
  const base = gerarBase()
  const comum = {
    descricao: 'Série de teste',
    valorBase: 100,
    periodicidade: 'MENSAL' as const,
    diaVencimento: 5,
    proximaGeracao: emDias(30),
  }
  assert.equal(
    criarRecorrencia(base, { ...comum, lado: 'PAGAR', classificacao: 'DESPESA_FIXA', clienteId: base.clientes[0]!.id }).ok,
    false,
  )
  assert.equal(criarRecorrencia(base, { ...comum, lado: 'PAGAR' }).ok, false, 'sem classificação')
  assert.equal(criarRecorrencia(base, { ...comum, lado: 'RECEBER' }).ok, false, 'sem cliente')
  assert.equal(
    criarRecorrencia(base, { ...comum, lado: 'RECEBER', clienteId: base.clientes[0]!.id }).ok,
    true,
  )
})

/* ---------------------------------------------- Módulo 13: projeção */

test('a fila de elegíveis é por data, não "tudo que está programado"', () => {
  const base = gerarBase()
  const passado = criarLancamentoFuturo(base, 'usr-admin', despesa({ dataPrevista: emDias(-3) }))
  const futuro = criarLancamentoFuturo(base, 'usr-admin', despesa({ dataPrevista: emDias(60) }))
  if (!passado.ok || !futuro.ok) return

  assert.equal(elegivelParaConversao(passado.valor, hoje()), true)
  assert.equal(elegivelParaConversao(futuro.valor, hoje()), false)
})

test('a projeção começa hoje e tem um ponto por dia, inclusive as pontas', () => {
  const base = gerarBase()
  for (const dias of [30, 60, 90, 180]) {
    const p = projetarCaixa(base, { dias }, hoje())
    assert.equal(p.de, hoje())
    assert.equal(p.ate, emDias(dias))
    assert.equal(p.dias.length, dias + 1)
  }
})

test('a projeção parte do saldo real e acumula dia a dia', () => {
  const base = gerarBase()
  const p = projetarCaixa(base, { dias: 30 }, hoje())

  const primeiro = p.dias[0]!
  assert.equal(
    Number((p.saldoInicial + primeiro.saldoDia).toFixed(2)),
    Number(primeiro.saldoAcumulado.toFixed(2)),
    'o primeiro dia acumula sobre o saldo inicial',
  )
  assert.equal(p.saldoFinal, p.dias[p.dias.length - 1]!.saldoAcumulado)

  // O acumulado de cada dia é o anterior mais o do dia.
  for (let i = 1; i < p.dias.length; i++) {
    assert.equal(
      Number((p.dias[i - 1]!.saldoAcumulado + p.dias[i]!.saldoDia).toFixed(2)),
      Number(p.dias[i]!.saldoAcumulado.toFixed(2)),
    )
  }
})

test('um lançamento programado entra na projeção; um convertido, não', () => {
  const base = gerarBase()
  const dia = emDias(14)
  const antes = projetarCaixa(base, { dias: 30 }, hoje()).dias.find((d) => d.dia === dia)!.saidas

  const criado = criarLancamentoFuturo(base, 'usr-admin', despesa({ valorPrevisto: 2500, dataPrevista: dia }))
  if (!criado.ok) return
  const comProgramado = projetarCaixa(base, { dias: 30 }, hoje()).dias.find((d) => d.dia === dia)!.saidas
  assert.equal(comProgramado, Number((antes + 2500).toFixed(4)))

  /*
   * Convertido sai da projeção **como lançamento** e entra **como título**: o
   * total do dia não pode mudar, senão a conversão faria a previsão pular.
   */
  converterLancamentoFuturo(base, criado.valor.id, 'usr-admin')
  const depois = projetarCaixa(base, { dias: 30 }, hoje()).dias.find((d) => d.dia === dia)!.saidas
  assert.equal(depois, comProgramado, 'converter não muda o total previsto do dia')
})

test('RN-F19: um título baixado sai da projeção — ele parece receita e não é', () => {
  const base = gerarBase()
  const baixado = base.titulosReceber.find((t) => t.status === 'BAIXADO')
  assert.ok(baixado, 'a massa tem um título baixado sem recebimento')

  // Posto num dia da janela, ele não é somado: se fosse, a projeção prometeria
  // dinheiro que ninguém vai receber.
  const dia = emDias(18)
  baixado!.dataVencimento = dia
  const p = projetarCaixa(base, { dias: 30 }, hoje())
  const linha = p.dias.find((d) => d.dia === dia)!

  baixado!.status = 'APROVADO'
  const comAberto = projetarCaixa(base, { dias: 30 }, hoje()).dias.find((d) => d.dia === dia)!
  assert.ok(
    comAberto.entradas > linha.entradas,
    'em aberto entra; baixado não — a diferença é o valor do título',
  )
  assert.equal(
    Number((comAberto.entradas - linha.entradas).toFixed(2)),
    Number(saldoDoTituloReceber(baixado!).toFixed(2)),
  )
})

test('RN-F19: um título cancelado não é somado', () => {
  const base = gerarBase()
  const dia = emDias(19)
  const titulo = base.titulosPagar.find((t) => t.status === 'APROVADO' && t.tituloPaiId === null)!
  titulo.dataVencimento = dia
  const comAberto = projetarCaixa(base, { dias: 30 }, hoje()).dias.find((d) => d.dia === dia)!.saidas

  titulo.status = 'CANCELADO'
  const cancelado = projetarCaixa(base, { dias: 30 }, hoje()).dias.find((d) => d.dia === dia)!.saidas
  assert.ok(cancelado < comAberto, 'cancelar tira da projeção')
})

test('RN-F20: o cenário reduz a entrada e **não** a saída', () => {
  const base = gerarBase()
  const estresse = base.cenariosCaixa.find((c) => !c.padrao)!
  assert.ok(estresse.inadimplencia > 0, 'a massa tem um cenário com inadimplência')

  const neutro = projetarCaixa(base, { dias: 90 }, hoje())
  const comCenario = projetarCaixa(base, { dias: 90, cenarioId: estresse.id }, hoje())

  const fator = 1 - estresse.inadimplencia / 100
  assert.equal(
    Number(comCenario.totalEntradas.toFixed(0)),
    Number((neutro.totalEntradas * fator).toFixed(0)),
    'a entrada cai pelo percentual do cenário',
  )
  /*
   * A saída não muda. Aplicar a inadimplência aos dois lados faria o cenário
   * pessimista deixar a operação mais otimista sobre a própria dívida — o inverso
   * de um teste de estresse, e um erro que passa porque o saldo do dia continua
   * parecendo razoável.
   */
  assert.equal(comCenario.totalSaidas, neutro.totalSaidas, 'a saída não é descontada')
})

test('o cenário é leitura: nenhum valor de título muda', () => {
  const base = gerarBase()
  const estresse = base.cenariosCaixa.find((c) => !c.padrao)!
  const antes = base.titulosPagar.map((t) => t.valorOriginal)
  const antesReceber = base.titulosReceber.map((t) => t.valorOriginal)

  projetarCaixa(base, { dias: 180, cenarioId: estresse.id }, hoje())

  assert.deepEqual(base.titulosPagar.map((t) => t.valorOriginal), antes)
  assert.deepEqual(base.titulosReceber.map((t) => t.valorOriginal), antesReceber)
})

test('sem cenário informado, responde o padrão do locatário', () => {
  const base = gerarBase()
  const p = projetarCaixa(base, { dias: 30 }, hoje())
  assert.equal(p.cenario?.id, cenarioPadrao(base)?.id)
  assert.equal(p.cenario?.padrao, true)
})

test('o menor saldo vem com o dia em que acontece', () => {
  const base = gerarBase()
  const dia = emDias(9)
  const criado = criarLancamentoFuturo(base, 'usr-admin', despesa({ valorPrevisto: 9_000_000, dataPrevista: dia }))
  if (!criado.ok) return

  const p = projetarCaixa(base, { dias: 30 }, hoje())
  assert.ok(p.menorSaldo < 0)
  // A pergunta do painel é "em que dia isto aperta" — o valor sozinho obrigaria a
  // varrer a série de novo para achar onde ele cai.
  assert.ok(p.diaMenorSaldo !== null)
  assert.ok(p.diaMenorSaldo! >= dia)
})

test('o recorte de filial alcança o previsto, não só o lançado', () => {
  const base = gerarBase()
  const dia = emDias(21)
  const a = base.filiais[0]!.id
  const b = base.filiais[1]!.id

  criarLancamentoFuturo(base, 'usr-admin', despesa({ valorPrevisto: 600, dataPrevista: dia, filialId: a }))
  criarLancamentoFuturo(base, 'usr-admin', despesa({ valorPrevisto: 900, dataPrevista: dia, filialId: b }))

  const soA = projetarCaixa(base, { dias: 30, filialId: a }, hoje()).dias.find((d) => d.dia === dia)!
  const soB = projetarCaixa(base, { dias: 30, filialId: b }, hoje()).dias.find((d) => d.dia === dia)!
  const tudo = projetarCaixa(base, { dias: 30 }, hoje()).dias.find((d) => d.dia === dia)!

  /*
   * Sem `filialId` no lançamento futuro, o recorte de uma filial somaria os
   * títulos dela e os compromissos previstos de **todas** — e o erro é plausível,
   * porque o número fica maior, não menor.
   */
  assert.ok(tudo.saidas >= soA.saidas + 900, 'o previsto de B não entra no recorte de A')
  assert.ok(soB.saidas >= 900)
  assert.ok(soA.saidas < tudo.saidas)
})

test('nenhuma posição diária é guardada na base', () => {
  const base = gerarBase()
  // Gravá-la seria a mesma classe de defeito que guardar saldo de conta: a
  // posição de amanhã muda a cada baixa de hoje.
  assert.ok(!('diasProjetados' in base), 'não existe coleção de dias projetados')
  assert.ok(!('projecao' in base), 'nem de projeção')
  assert.ok(!('alertasCaixa' in base), 'nem de alertas')
})

/* ---------------------------------------------- RN-F21 e RN-F22 */

test('RN-F21: saldo negativo projetado vira alerta, e persiste no acumulado', () => {
  const base = gerarBase()
  criarLancamentoFuturo(base, 'usr-admin', despesa({ valorPrevisto: 9_000_000, dataPrevista: emDias(5) }))

  const alertas = alertasDeCaixa(base, 30, hoje())
  const negativos = alertas.filter((a) => a.tipo === 'SALDO_NEGATIVO')
  assert.ok(negativos.length > 1, 'o acumulado não se recupera sozinho')
  assert.match(negativos[0]!.detalhe, /Saldo acumulado projetado/)
})

test('RN-F22: concentração acima do limiar cadastrado vira alerta', () => {
  const base = gerarBase()
  const dia = emDias(7)
  const projecaoBase = projetarCaixa(base, { dias: 30 }, hoje())
  // A dominância é construída, e não presumida: uma saída fixa passaria a não
  // dominar no dia em que a massa crescesse.
  criarLancamentoFuturo(base, 'usr-admin', despesa({
    valorPrevisto: Math.max(projecaoBase.totalSaidas, 1000) * 3,
    dataPrevista: dia,
  }))

  const concentracao = alertasDeCaixa(base, 30, hoje()).filter((a) => a.tipo === 'CONCENTRACAO_SAIDA')
  assert.ok(concentracao.some((a) => a.dia === dia), 'o dia construído concentra a janela')
})

test('o limiar de concentração vem do cadastro, não de uma constante', () => {
  const base = gerarBase()
  const dia = emDias(8)
  const projecaoBase = projetarCaixa(base, { dias: 30 }, hoje())
  criarLancamentoFuturo(base, 'usr-admin', despesa({
    valorPrevisto: Math.max(projecaoBase.totalSaidas, 1000) * 3,
    dataPrevista: dia,
  }))
  assert.ok(alertasDeCaixa(base, 30, hoje()).some((a) => a.tipo === 'CONCENTRACAO_SAIDA'))

  cenarioPadrao(base)!.limiarConcentracao = 100
  assert.equal(
    alertasDeCaixa(base, 30, hoje()).filter((a) => a.tipo === 'CONCENTRACAO_SAIDA').length,
    0,
    'acima de 100% nada concentra',
  )
})

test('os alertas mudam com a janela, porque são calculados', () => {
  const base = gerarBase()
  const curta = alertasDeCaixa(base, 30, hoje())
  const longa = alertasDeCaixa(base, 180, hoje())
  // Um alerta gravado seria o mesmo nas duas: o resultado depender da janela é a
  // prova de que ele é derivado.
  assert.notEqual(curta.length, longa.length)
})

test('a massa de demonstração tem um lançamento em cada estado que a tela mostra', () => {
  const base = gerarBase()
  const estados = new Set(base.lancamentosFuturos.map((l) => l.status))
  assert.ok(estados.has('PROGRAMADO'), 'programado')
  assert.ok(estados.has('CONVERTIDO'), 'convertido, para o estado final ter caso')
  assert.ok(base.lancamentosFuturos.some(naFilaDeExcecao), 'e um na fila de exceção')
  assert.ok(
    base.lancamentosFuturos.some((l) => elegivelParaConversao(l, hoje())),
    'e um elegível, senão o botão de converter existiria sem nunca fazer nada',
  )
})

test('o lançamento em exceção aponta um contrato realmente fora de vigência', () => {
  /*
   * Foi o defeito do Módulo 11: um `?? contratos[0]` de reserva escolhia um
   * contrato ATIVO em silêncio, e o caso "em disputa" nunca acontecia. A tela
   * existia e não podia ser exercitada.
   */
  const base = gerarBase()
  const naFila = base.lancamentosFuturos.filter(naFilaDeExcecao)
  assert.ok(naFila.length > 0)
  for (const l of naFila) {
    const contrato = base.contratos.find((c) => c.id === l.contratoId)
    assert.ok(contrato, 'o lançamento em exceção tem contrato')
    assert.notEqual(contrato!.status, 'ATIVO', 'e o contrato não está vigente')
  }
})
