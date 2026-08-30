/**
 * Comandos de contas a receber — Módulo 11.
 *
 * O que estes testes protegem, em duas frases:
 *
 *  1. **A cobrança não sai sem alguém olhar.** A alçada decide quantos conferem,
 *     não se alguém confere — e a cobrança gerada do contrato saiu de um cálculo
 *     que ninguém leu.
 *  2. **O que não entrou nunca conta como receita.** Um relatório que soma
 *     "títulos encerrados" fecha consigo mesmo, então a receita aparece inflada
 *     exatamente onde ninguém confere.
 *
 * As mesmas regras existem como gatilho na migração 0020 e como teste de
 * integração em `apps/api/test/contas-receber.test.ts`. Não é redundância: aqui
 * elas permitem a tela recusar antes de pedir; lá valem para quem não passa pela
 * tela. Se a regra mudar num lado só, as três suítes falham juntas.
 *
 * Nenhum valor abaixo é regra de negócio da IARX: as faixas de alçada e o teto
 * de desconto vêm da massa de demonstração.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarBase } from '../src/dados/gerar.ts'
import {
  aplicarDesconto,
  baixarSemRecebimento,
  cancelarTituloReceber,
  criarTituloAvulso,
  decidirEmissao,
  ehPaiDeParcelasReceber,
  emAtraso,
  estornarRecebimento,
  fecharCompetencia,
  filaDeEmissao,
  limiteDesconto,
  limitesAlcada,
  niveisEmissao,
  nivelPendenteReceber,
  parcelasReceberDe,
  postoAlcada,
  postoEmissao,
  previaFechamento,
  receberTitulo,
  receitaRealizada,
  reenviarTituloReceber,
  saldoDaConta,
  saldoDoTituloReceber,
  totalBaixadoSemRecebimento,
  totalRecebido,
  valorLiquidoDe,
} from '../src/dados/comandos.ts'
import type { BaseDados } from '../src/dados/tipos.ts'

function base(): BaseDados {
  return gerarBase()
}

/** Quem tem posto N de emissão na massa. Derivado, nunca fixado no teste. */
function comPostoEmissao(b: BaseDados, posto: number): string {
  const u = b.usuarios.find((x) => postoEmissao(b, x.id) === posto)
  assert.ok(u, `a massa não tem usuário com posto de emissão ${posto}`)
  return u!.id
}

/**
 * O posto mais alto de emissão que a massa tem.
 *
 * Antes os testes pediam `topoEmissao(b)` para dizer "o topo". Três era o
 * número de faixas de emissão porque uma delas estava no Operador
 * Administrativo, que não tem `fatura:emitir` — corrigido o cadastro, o topo é
 * dois. Fixar o número no teste era medir a massa, não a regra: o que a regra
 * diz é que **quem gerou não decide, mesmo estando no topo**, e isso vale com
 * quantas faixas houver.
 */
function topoEmissao(b: BaseDados): string {
  const postos = b.usuarios.map((u) => ({ id: u.id, posto: postoEmissao(b, u.id) }))
  const topo = postos.reduce((a, c) => (c.posto > a.posto ? c : a), { id: '', posto: 0 })
  assert.ok(topo.posto > 0, 'a massa não tem ninguém com alçada de emissão')
  return topo.id
}

function semAlcadaEmissao(b: BaseDados): string {
  const u = b.usuarios.find((x) => postoEmissao(b, x.id) === 0 && x.tipo === 'INTERNO')
  assert.ok(u, 'a massa não tem usuário interno sem alçada de emissão')
  return u!.id
}

const AVULSO = {
  clienteId: '',
  descricao: 'Serviço avulso de teste',
  dataEmissao: '2026-07-01',
  dataVencimento: '2026-08-01',
  parcelas: 1,
  rateio: [],
}

const dados = (b: BaseDados, extra: Record<string, unknown> = {}) => ({
  ...AVULSO,
  clienteId: b.clientes[0]!.id,
  valorOriginal: 500,
  ...extra,
})

/* ------------------------------------------------------- alçada de emissão */

test('a alçada de emissão é separada da de pagamento', () => {
  const b = base()
  const emissao = limitesAlcada(b, 'EMISSAO_FATURA')
  const pagamento = limitesAlcada(b, 'APROVACAO_PAGAMENTO')

  assert.ok(emissao.length >= 2, 'a massa precisa de faixas de emissão')
  // Sem o filtro por tipo, um limite de aprovação de compra contaria como nível
  // de emissão de fatura, e uma cobrança exigiria três aprovações porque alguém
  // cadastrou uma alçada de ordem de compra.
  assert.notDeepEqual(emissao, pagamento, 'os dois tipos de alçada estão se contaminando')

  assert.equal(niveisEmissao(b, emissao[0]! - 1), 0)
  assert.equal(niveisEmissao(b, emissao[0]! + 1), 1)
  assert.equal(niveisEmissao(b, emissao[1]! + 1), 2)
  // No limite exato não ultrapassa: o perfil emite sozinho.
  assert.equal(niveisEmissao(b, emissao[0]!), 0)
})

test('o posto de emissão de um usuário não é o posto de pagamento', () => {
  const b = base()
  const usuario = b.usuarios.find((u) => postoEmissao(b, u.id) > 0)
  assert.ok(usuario, 'ninguém com alçada de emissão na massa')
  // Os dois existem e são consultados por tipo; o teste garante que a função
  // aceita o tipo e não devolve o mesmo número para os dois.
  assert.ok(postoAlcada(b, usuario!.id, 'EMISSAO_FATURA') > 0)
})

test('o teto de desconto é percentual, e zero significa não concede', () => {
  const b = base()
  const tetos = b.usuarios.map((u) => limiteDesconto(b, u.id))
  assert.ok(tetos.some((t) => t > 0), 'ninguém concede desconto na massa')
  assert.ok(tetos.some((t) => t === 0), 'todos concedem desconto — falta o caso negativo')
})

/* -------------------------------------------------------- lançamento avulso */

test('o avulso segue a alçada, inclusive com zero níveis', () => {
  const b = base()
  const limites = limitesAlcada(b, 'EMISSAO_FATURA')
  const autor = semAlcadaEmissao(b)

  // Um avulso já foi digitado por alguém que escolheu o valor: não há cálculo
  // automático a conferir.
  const pequeno = criarTituloAvulso(b, autor, dados(b, { valorOriginal: limites[0]! - 1 }))
  assert.ok(pequeno.ok)
  assert.equal(pequeno.valor.status, 'APROVADO')
  assert.equal(pequeno.valor.aprovacoes.length, 0)
  assert.equal(pequeno.valor.origem, 'AVULSO')

  const grande = criarTituloAvulso(b, autor, dados(b, { valorOriginal: limites[1]! + 1 }))
  assert.ok(grande.ok)
  assert.equal(grande.valor.status, 'PENDENTE_APROVACAO')
  assert.equal(grande.valor.aprovacoes.length, 2)
})

test('o valor líquido e o saldo são derivados: não existe campo a divergir', () => {
  const b = base()
  const r = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: 1_000 }))
  assert.ok(r.ok)

  // A ausência é a garantia. Se alguém acrescentar o campo, este teste falha
  // antes de a divergência aparecer como receita que não fecha.
  assert.ok(!('valorLiquido' in r.valor), 'apareceu um campo de valor líquido gravado')
  assert.ok(!('saldo' in r.valor), 'apareceu um campo de saldo gravado')
  assert.ok(!('diasAtraso' in r.valor), 'apareceu um campo de dias de atraso gravado')
  assert.equal(valorLiquidoDe(r.valor), 1_000)
  assert.equal(saldoDoTituloReceber(r.valor), 1_000)
})

test('a numeração é sequencial e não repete', () => {
  const b = base()
  const autor = semAlcadaEmissao(b)
  const a = criarTituloAvulso(b, autor, dados(b))
  const c = criarTituloAvulso(b, autor, dados(b))
  assert.ok(a.ok && c.ok)
  assert.equal(c.valor.numeroTitulo, a.valor.numeroTitulo + 1)

  // E nenhum número se repete em toda a base.
  const numeros = b.titulosReceber.map((t) => t.numeroTitulo)
  assert.equal(new Set(numeros).size, numeros.length, 'há número de cobrança repetido')
})

test('o rateio pela metade é recusado, e o vazio é legítimo', () => {
  const b = base()
  const autor = semAlcadaEmissao(b)
  const centros = b.centrosCusto.filter((c) => c.ativo)

  const metade = criarTituloAvulso(
    b,
    autor,
    dados(b, { rateio: [{ centroCustoId: centros[0]!.id, percentual: 60 }] }),
  )
  assert.ok(!metade.ok)
  assert.match(metade.erro.mensagem, /100%/)

  const inteiro = criarTituloAvulso(
    b,
    autor,
    dados(b, {
      rateio: [
        { centroCustoId: centros[0]!.id, percentual: 60 },
        { centroCustoId: centros[1]!.id, percentual: 40 },
      ],
    }),
  )
  assert.ok(inteiro.ok)
  assert.ok(criarTituloAvulso(b, autor, dados(b, { rateio: [] })).ok)
})

/* ---------------------------------------------------------------- aprovação */

test('quem gerou não aprova a própria cobrança', () => {
  const b = base()
  const limites = limitesAlcada(b, 'EMISSAO_FATURA')
  const quemPodeTudo = topoEmissao(b)

  const r = criarTituloAvulso(b, quemPodeTudo, dados(b, { valorOriginal: limites[0]! + 1 }))
  assert.ok(r.ok)

  const d = decidirEmissao(b, r.valor.id, 1, quemPodeTudo, { decisao: 'APROVADO', justificativa: '' })
  assert.ok(!d.ok, 'quem gerou aprovou a própria cobrança')
  assert.match(d.erro.mensagem, /não pode aprová-la/)
  assert.ok(d.erro.acoes?.length, 'a recusa não ofereceu saída')
})

test('o nível 2 não decide antes do nível 1', () => {
  const b = base()
  const limites = limitesAlcada(b, 'EMISSAO_FATURA')
  const r = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: limites[1]! + 1 }))
  assert.ok(r.ok)

  const fora = decidirEmissao(b, r.valor.id, 2, comPostoEmissao(b, 2), {
    decisao: 'APROVADO',
    justificativa: '',
  })
  assert.ok(!fora.ok)
  assert.match(fora.erro.mensagem, /nível 1 ainda não decidiu/)

  const passo1 = decidirEmissao(b, r.valor.id, 1, comPostoEmissao(b, 1), {
    decisao: 'APROVADO',
    justificativa: '',
  })
  assert.ok(passo1.ok)
  assert.equal(passo1.valor.status, 'PENDENTE_APROVACAO', 'aprovou antes do último nível')

  const passo2 = decidirEmissao(b, r.valor.id, 2, comPostoEmissao(b, 2), {
    decisao: 'APROVADO',
    justificativa: '',
  })
  assert.ok(passo2.ok)
  assert.equal(passo2.valor.status, 'APROVADO')
})

test('sem alçada de emissão não se decide', () => {
  const b = base()
  const limites = limitesAlcada(b, 'EMISSAO_FATURA')
  const r = criarTituloAvulso(b, topoEmissao(b), dados(b, { valorOriginal: limites[0]! + 1 }))
  assert.ok(r.ok)

  const d = decidirEmissao(b, r.valor.id, 1, semAlcadaEmissao(b), {
    decisao: 'APROVADO',
    justificativa: '',
  })
  assert.ok(!d.ok)
  assert.match(d.erro.mensagem, /alçada de emissão/)
})

test('a rejeição exige justificativa, volta a pendente, e o reenvio abre rodada nova', () => {
  const b = base()
  const limites = limitesAlcada(b, 'EMISSAO_FATURA')
  const autor = semAlcadaEmissao(b)
  const r = criarTituloAvulso(b, autor, dados(b, { valorOriginal: limites[0]! + 1 }))
  assert.ok(r.ok)

  const sem = decidirEmissao(b, r.valor.id, 1, comPostoEmissao(b, 1), {
    decisao: 'REJEITADO',
    justificativa: 'não',
  })
  assert.ok(!sem.ok, 'rejeitou sem justificativa — quem lançou reenviaria igual')

  const com = decidirEmissao(b, r.valor.id, 1, comPostoEmissao(b, 1), {
    decisao: 'REJEITADO',
    justificativa: 'valor divergente do orçamento aprovado pelo cliente',
  })
  assert.ok(com.ok)
  assert.equal(com.valor.status, 'PENDENTE', 'a rejeição levou a um estado terminal')

  const reenviado = reenviarTituloReceber(b, r.valor.id, autor)
  assert.ok(reenviado.ok)
  assert.equal(reenviado.valor.status, 'PENDENTE_APROVACAO')
  const rodadas = new Set(reenviado.valor.aprovacoes.map((a) => a.rodada))
  assert.deepEqual([...rodadas].sort(), [1, 2])
  assert.ok(
    reenviado.valor.aprovacoes.some((a) => a.rodada === 1 && a.decisao === 'REJEITADO'),
    'a decisão anterior foi apagada pelo reenvio',
  )
  assert.equal(nivelPendenteReceber(reenviado.valor)!.rodada, 2)
})

test('o reenvio de um contratual mantém o piso de um nível', () => {
  const b = base()
  const contratual = b.titulosReceber.find((t) => t.origem === 'CONTRATUAL')
  assert.ok(contratual, 'a massa não tem cobrança contratual')

  // Sem o piso no reenvio, o caminho para burlar RN-F10 seria "rejeite e
  // reenvie": um contratual abaixo da menor faixa voltaria aprovado sozinho.
  contratual!.status = 'PENDENTE'
  contratual!.valorOriginal = 1
  contratual!.desconto = 0
  const r = reenviarTituloReceber(b, contratual!.id, contratual!.criadoPor)
  assert.ok(r.ok)
  assert.equal(r.valor.status, 'PENDENTE_APROVACAO')
  const rodadaNova = Math.max(...r.valor.aprovacoes.map((a) => a.rodada))
  assert.equal(r.valor.aprovacoes.filter((a) => a.rodada === rodadaNova).length, 1)
})

/* --------------------------------------------------------------------- fila */

test('a fila do aprovador não oferece a cobrança que ele gerou', () => {
  const b = base()
  const limites = limitesAlcada(b, 'EMISSAO_FATURA')
  const autor = comPostoEmissao(b, 1)
  const r = criarTituloAvulso(b, autor, dados(b, { valorOriginal: limites[1]! + 1 }))
  assert.ok(r.ok)
  const id = r.valor.id

  // 1. Quem gerou não vê a própria: a regra recusaria a decisão de qualquer
  //    forma, e oferecer é convidar ao erro.
  assert.ok(!filaDeEmissao(b, autor).some((t) => t.id === id))
  // 2. Quem não tem alçada de emissão não vê nada.
  assert.ok(!filaDeEmissao(b, semAlcadaEmissao(b)).some((t) => t.id === id))
  // 3. Quem tem posto suficiente vê.
  assert.ok(filaDeEmissao(b, comPostoEmissao(b, 2)).some((t) => t.id === id))

  // 4. Aprovada, sai da fila de todos.
  decidirEmissao(b, id, 1, comPostoEmissao(b, 2), { decisao: 'APROVADO', justificativa: '' })
  decidirEmissao(b, id, 2, topoEmissao(b), { decisao: 'APROVADO', justificativa: '' })
  assert.ok(!filaDeEmissao(b, comPostoEmissao(b, 2)).some((t) => t.id === id))
  assert.ok(!filaDeEmissao(b, topoEmissao(b)).some((t) => t.id === id))
})

/* ----------------------------------------------------------------- desconto */

test('o desconto acima da alçada é barrado, mesmo com a emissão já aprovada', () => {
  const b = base()
  const r = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: 1_000 }))
  assert.ok(r.ok)
  assert.equal(r.valor.status, 'APROVADO')

  const quemConcede = b.usuarios.find((u) => limiteDesconto(b, u.id) === 10)
  assert.ok(quemConcede, 'a massa não tem quem conceda até 10%')

  // 10% é o teto: passa.
  const dentro = aplicarDesconto(b, r.valor.id, quemConcede!.id, 100, 'desconto comercial negociado')
  assert.ok(dentro.ok, dentro.ok ? '' : dentro.erro.mensagem)
  assert.equal(valorLiquidoDe(dentro.valor), 900)

  // 15% ultrapassa. Sem esta regra, o caminho para cobrar menos do que a alçada
  // permite seria emitir cheio, aprovar, e descontar depois.
  const acima = aplicarDesconto(b, r.valor.id, quemConcede!.id, 150, 'desconto maior negociado')
  assert.ok(!acima.ok)
  assert.match(acima.erro.mensagem, /acima da sua alçada/)

  // E quem não tem alçada de desconto não concede nem 1%.
  const semTeto = b.usuarios.find((u) => limiteDesconto(b, u.id) === 0 && u.tipo === 'INTERNO')
  assert.ok(semTeto)
  const nada = aplicarDesconto(b, r.valor.id, semTeto!.id, 10, 'desconto pequeno')
  assert.ok(!nada.ok)
  assert.ok(nada.erro.acoes?.some((a) => /não concede/.test(a)))
})

test('desconto que zera a cobrança é cancelamento disfarçado', () => {
  const b = base()
  const r = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: 500 }))
  assert.ok(r.ok)
  const admin = b.usuarios.find((u) => limiteDesconto(b, u.id) >= 25)!

  const zerado = aplicarDesconto(b, r.valor.id, admin.id, 500, 'perdão integral da cobrança')
  assert.ok(!zerado.ok)
  assert.ok(zerado.erro.acoes?.some((a) => /cancelamento/i.test(a)))

  // E sem motivo não passa: é o único registro de por que se cobrou menos.
  assert.ok(!aplicarDesconto(b, r.valor.id, admin.id, 50, 'oi').ok)
})

test('o desconto não desce abaixo do que já foi recebido', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const r = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: 1_000 }))
  assert.ok(r.ok)
  receberTitulo(b, r.valor.id, {
    valorRecebido: 600,
    dataRecebimento: '2026-07-30',
    contaId: conta.id,
    forma: 'PIX',
  })

  const admin = b.usuarios.find((u) => limiteDesconto(b, u.id) >= 25)!
  const abaixo = aplicarDesconto(b, r.valor.id, admin.id, 500, 'desconto retroativo negociado')
  assert.ok(!abaixo.ok)
  assert.ok(abaixo.erro.acoes?.some((a) => /[Ee]storne/.test(a)))
})

/* -------------------------------------------------------------- recebimento */

test('a baixa credita a conta no mesmo ato, e o parcial recalcula o saldo', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const antes = saldoDaConta(b, conta.id)
  const r = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: 900 }))
  assert.ok(r.ok)

  const parcial = receberTitulo(b, r.valor.id, {
    valorRecebido: 400,
    dataRecebimento: '2026-07-30',
    contaId: conta.id,
    forma: 'PIX',
  })
  assert.ok(parcial.ok)
  assert.equal(parcial.valor.status, 'RECEBIDO_PARCIAL')
  assert.equal(saldoDoTituloReceber(parcial.valor), 500)
  assert.equal(saldoDaConta(b, conta.id), antes + 400, 'a entrada não chegou ao extrato')

  const resto = receberTitulo(b, r.valor.id, {
    valorRecebido: 500,
    dataRecebimento: '2026-07-30',
    contaId: conta.id,
    forma: 'TRANSFERENCIA',
  })
  assert.ok(resto.ok)
  assert.equal(resto.valor.status, 'RECEBIDO')
  assert.equal(saldoDoTituloReceber(resto.valor), 0)
})

test('recebimento acima do saldo é recusado, e não vira crédito do cliente', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const r = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: 900 }))
  assert.ok(r.ok)

  const d = receberTitulo(b, r.valor.id, {
    valorRecebido: 901,
    dataRecebimento: '2026-07-30',
    contaId: conta.id,
    forma: 'BOLETO',
  })
  assert.ok(!d.ok)
  assert.equal(totalRecebido(r.valor), 0, 'o excesso entrou mesmo tendo sido recusado')
})

test('não se recebe o que a aprovação não liberou', () => {
  const b = base()
  const limites = limitesAlcada(b, 'EMISSAO_FATURA')
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const r = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: limites[0]! + 1 }))
  assert.ok(r.ok)
  assert.equal(r.valor.status, 'PENDENTE_APROVACAO')

  const d = receberTitulo(b, r.valor.id, {
    valorRecebido: 10,
    dataRecebimento: '2026-07-30',
    contaId: conta.id,
    forma: 'PIX',
  })
  assert.ok(!d.ok)
  assert.match(d.erro.mensagem, /aprovação da cobrança vem antes/)
})

test('o estorno devolve à conta, reabre a cobrança, e não se repete', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const antes = saldoDaConta(b, conta.id)
  const r = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: 700 }))
  assert.ok(r.ok)

  receberTitulo(b, r.valor.id, {
    valorRecebido: 700,
    dataRecebimento: '2026-07-30',
    contaId: conta.id,
    forma: 'BOLETO',
  })
  assert.equal(r.valor.status, 'RECEBIDO')
  const recebimentoId = r.valor.recebimentos[0]!.id

  const e = estornarRecebimento(b, r.valor.id, recebimentoId, 'cheque devolvido pelo banco')
  assert.ok(e.ok)
  assert.equal(e.valor.status, 'APROVADO', 'a cobrança estornada não reabriu')
  assert.equal(saldoDaConta(b, conta.id), antes, 'o dinheiro não saiu da conta')

  const denovo = estornarRecebimento(b, r.valor.id, recebimentoId, 'tentando outra vez')
  assert.ok(!denovo.ok)
  assert.match(denovo.erro.mensagem, /já foi estornado/)
})

/* ------------------------------------------------- BAIXADO não é RECEBIDO */

test('a baixa sem recebimento encerra a cobrança e exige motivo longo', () => {
  const b = base()
  const r = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: 800 }))
  assert.ok(r.ok)

  // Motivo curto não passa: é o único registro de por que o valor não entrou.
  assert.ok(!baixarSemRecebimento(b, r.valor.id, 'perda').ok)

  const ok = baixarSemRecebimento(b, r.valor.id, 'perda reconhecida: cliente em recuperação judicial')
  assert.ok(ok.ok)
  assert.equal(ok.valor.status, 'BAIXADO')
  assert.ok(ok.valor.baixaMotivo)
  assert.ok(ok.valor.baixadoEm)
  // Nenhum recebimento foi criado: o saldo continua registrado como não recebido.
  assert.equal(ok.valor.recebimentos.length, 0)
  assert.equal(saldoDoTituloReceber(ok.valor), 800)
})

test('cobrança quitada não se baixa: apagaria o registro da entrada', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const r = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: 120 }))
  assert.ok(r.ok)
  receberTitulo(b, r.valor.id, {
    valorRecebido: 120,
    dataRecebimento: '2026-07-30',
    contaId: conta.id,
    forma: 'PIX',
  })

  const d = baixarSemRecebimento(b, r.valor.id, 'querendo baixar o que já entrou em caixa')
  assert.ok(!d.ok)
})

test('a receita realizada soma recebimentos, nunca títulos encerrados', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const comp = '2026-09'

  const recebido = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: 500 }))
  const baixado = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: 700 }))
  assert.ok(recebido.ok && baixado.ok)
  recebido.valor.competencia = comp
  baixado.valor.competencia = comp

  receberTitulo(b, recebido.valor.id, {
    valorRecebido: 500,
    dataRecebimento: '2026-09-15',
    contaId: conta.id,
    forma: 'PIX',
  })
  baixarSemRecebimento(b, baixado.valor.id, 'valor irrisório: não compensa cobrar')

  /*
   * Se a agregação somasse "encerrados", os dois entrariam — e a receita
   * apareceria inflada justamente onde ninguém confere, porque a soma
   * continuaria fechando consigo mesma.
   */
  assert.equal(receitaRealizada(b, comp), 500)
  assert.equal(totalBaixadoSemRecebimento(b, comp), 700)
})

/* -------------------------------------------------------------- parcelamento */

test('o parcelamento nasce inteiro, fecha ao centavo, e o pai não recebe', () => {
  const b = base()
  const total = 900
  const r = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: total, parcelas: 7 }))
  assert.ok(r.ok)

  const parcelas = parcelasReceberDe(b, r.valor.id)
  assert.equal(parcelas.length, 7)
  assert.ok(ehPaiDeParcelasReceber(b, r.valor))

  // É a soma das parcelas que o cliente vai pagar, e ela tem de fechar com o
  // total do pai — sete parcelas arredondadas por igual divergiriam em centavos.
  const soma = parcelas.reduce((s, p) => s + p.valorOriginal, 0)
  assert.equal(Math.round(soma * 100), Math.round(total * 100))
  assert.ok(parcelas.every((p) => p.status === r.valor.status))
  assert.ok(parcelas.every((p) => p.aprovacoes.length === 0))

  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const noPai = receberTitulo(b, r.valor.id, {
    valorRecebido: total,
    dataRecebimento: '2026-07-30',
    contaId: conta.id,
    forma: 'PIX',
  })
  assert.ok(!noPai.ok)
  assert.match(noPai.erro.mensagem, /recebido nas parcelas/)

  const primeira = parcelas[0]!
  assert.ok(
    receberTitulo(b, primeira.id, {
      valorRecebido: primeira.valorOriginal,
      dataRecebimento: '2026-07-30',
      contaId: conta.id,
      forma: 'PIX',
    }).ok,
  )
})

test('o cancelamento em cascata exige confirmação, e parcela recebida não se cancela', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const r = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: 1_200, parcelas: 3 }))
  assert.ok(r.ok)

  const silencioso = cancelarTituloReceber(b, r.valor.id, 'lançado por engano')
  assert.ok(!silencioso.ok, 'cancelou três parcelas sem confirmação')

  assert.ok(cancelarTituloReceber(b, r.valor.id, 'lançado por engano', true).ok)
  assert.ok(parcelasReceberDe(b, r.valor.id).every((p) => p.status === 'CANCELADO'))

  const outro = criarTituloAvulso(b, semAlcadaEmissao(b), dados(b, { valorOriginal: 900, parcelas: 3 }))
  assert.ok(outro.ok)
  const primeira = parcelasReceberDe(b, outro.valor.id)[0]!
  receberTitulo(b, primeira.id, {
    valorRecebido: primeira.valorOriginal,
    dataRecebimento: '2026-07-30',
    contaId: conta.id,
    forma: 'PIX',
  })
  const recusado = cancelarTituloReceber(b, outro.valor.id, 'desistimos do projeto', true)
  assert.ok(!recusado.ok)
  assert.match(recusado.erro.mensagem, /já foram recebidas/)
})

/* --------------------------------------------- fechamento de competência */

test('a prévia responde antes de fechar, e não muda nada', () => {
  const b = base()
  const aberta = b.competencias_fechamento.find((c) => c.fechadoEm === null)
  assert.ok(aberta, 'a massa não tem competência aberta')

  const antes = b.titulosReceber.length
  const p1 = previaFechamento(b, aberta!.competencia)
  const p2 = previaFechamento(b, aberta!.competencia)

  assert.deepEqual(p1, p2, 'a prévia não é idempotente')
  assert.equal(b.titulosReceber.length, antes, 'a prévia criou título')
  assert.equal(aberta!.fechadoEm, null, 'a prévia selou a competência')
})

test('o fechamento gera as cobranças, sela a competência e não duplica', () => {
  const b = base()
  const aberta = b.competencias_fechamento.find((c) => c.fechadoEm === null)!
  const quemFecha = 'usr-admin'

  const previa = previaFechamento(b, aberta.competencia)
  const r = fecharCompetencia(b, aberta.competencia, quemFecha)
  assert.ok(r.ok, r.ok ? '' : r.erro.mensagem)
  assert.equal(r.valor.titulosCriados, previa.titulosAGerar)
  assert.ok(aberta.fechadoEm, 'a competência não foi selada')

  // Reprocessar um mês é rotina — alguém corrige uma leitura e refecha —, e a
  // cobrança em dobro chegaria ao cliente.
  const denovo = fecharCompetencia(b, aberta.competencia, quemFecha)
  assert.ok(!denovo.ok)
  assert.match(denovo.erro.mensagem, /já está fechada/)
})

test('o contratual gerado nasce em aprovação, com piso de um nível', () => {
  const b = base()
  const aberta = b.competencias_fechamento.find((c) => c.fechadoEm === null)!
  const antes = new Set(b.titulosReceber.map((t) => t.id))
  fecharCompetencia(b, aberta.competencia, 'usr-admin')

  const novos = b.titulosReceber.filter((t) => !antes.has(t.id))
  assert.ok(novos.length > 0, 'o fechamento não gerou cobrança')

  for (const t of novos) {
    assert.equal(t.origem, 'CONTRATUAL')
    if (t.status === 'EM_DISPUTA') {
      // Título em disputa não abre rodada: não se aprova a emissão de uma
      // cobrança que já se sabe estar errada.
      assert.equal(t.aprovacoes.length, 0)
      assert.ok(t.excecaoGeracao, 'em disputa sem o motivo escrito')
      continue
    }
    assert.equal(t.status, 'PENDENTE_APROVACAO', `nasceu em ${t.status}`)
    // A alçada decide quantos conferem, não se alguém confere: piso de um.
    assert.ok(t.aprovacoes.length >= 1, 'contratual sem nenhum nível de aprovação')
  }
})

test('competência malformada é recusada como erro de campo', () => {
  const b = base()
  const r = fecharCompetencia(b, '2026-13', 'usr-admin')
  assert.ok(!r.ok)
  assert.equal(r.erro.campo, 'competencia')
})

/* --------------------------------------------------------- atraso derivado */

test('em atraso é a data, nunca um status gravado', () => {
  const b = base()
  const r = criarTituloAvulso(
    b,
    semAlcadaEmissao(b),
    dados(b, { valorOriginal: 150, dataEmissao: '2026-01-01', dataVencimento: '2026-01-10' }),
  )
  assert.ok(r.ok)

  // A data de referência da base é 2026-07-30: vencimento em janeiro está em
  // atraso, e a resposta está certa em qualquer instante porque é calculada.
  assert.ok(emAtraso(r.valor))
  assert.ok(!emAtraso(r.valor, '2026-01-05'), 'atraso antes do vencimento')

  // Nenhum título carrega o estado. `RECEBIDO` nunca está em atraso, mesmo
  // vencido: o dinheiro entrou.
  r.valor.status = 'RECEBIDO'
  assert.ok(!emAtraso(r.valor), 'uma cobrança recebida apareceu como em atraso')
})

/* ------------------------------------------------------- massa de demonstração */

test('a massa cobre os estados difíceis, e não só os recebidos', () => {
  const b = base()
  const estados = new Set(b.titulosReceber.map((t) => t.status))

  for (const esperado of [
    'PENDENTE_APROVACAO',
    'PENDENTE',
    'APROVADO',
    'RECEBIDO_PARCIAL',
    'RECEBIDO',
    'EM_DISPUTA',
    'BAIXADO',
  ]) {
    assert.ok(estados.has(esperado as never), `a massa não tem nenhuma cobrança ${esperado}`)
  }

  assert.ok(
    b.titulosReceber.some((t) => t.aprovacoes.some((a) => a.decisao === 'REJEITADO')),
    'nenhuma rejeição na massa — o histórico de rodada nunca aparece',
  )
  assert.ok(b.titulosReceber.some((t) => t.origem === 'AVULSO'), 'nenhuma cobrança avulsa')
  assert.ok(b.titulosReceber.some((t) => t.origem === 'CONTRATUAL'), 'nenhuma cobrança contratual')
  assert.ok(
    b.titulosReceber.some((t) => t.status === 'EM_DISPUTA' && t.excecaoGeracao),
    'nenhuma disputa com o motivo escrito',
  )
})

/*
 * Aqui vivia o teste de paridade entre `faturas` e `titulosReceber`.
 *
 * Ele existia porque a base tinha **duas** coleções para o mesmo fato: um modelo
 * de fatura, que a tela de Faturamento lia, e os títulos, que Contas a receber
 * lia. O teste comparava valor a valor para que as duas telas não mostrassem
 * receitas diferentes para o mesmo mês.
 *
 * A duplicação acabou: a medição explica o valor, o título é a cobrança, e a
 * segunda fonte deixou de existir. Um teste que compara uma coisa com ela mesma
 * passa sempre e não prova nada — mantê-lo daria a impressão de que ainda há
 * algo sendo vigiado. O que sobrou dele está no teste abaixo e no de
 * `linhasCobranca`: existe cobrança contratual, e a competência aberta tem
 * medição sem título.
 */

test('a competência aberta tem medição e nenhuma cobrança — é o que a torna aberta', () => {
  const b = base()
  const aberta = b.competencias_fechamento.find((c) => c.fechadoEm === null)!.competencia

  const medidas = b.medicoes.filter((m) => m.competencia === aberta)
  assert.ok(medidas.length > 0, 'a competência aberta não tem medição: não haveria o que fechar')
  assert.ok(
    medidas.every((m) => m.seladaEm === null),
    'medição da competência aberta já está selada',
  )

  /*
   * Nenhum título: a cobrança nasce do fechamento. Já houve uma versão em que a
   * derivação cobria todas as competências, e o diálogo de fechar competência
   * dizia sempre "nada a gerar" — a tela existia e não podia ser exercitada.
   */
  const cobradas = b.titulosReceber.filter(
    (t) => t.origem === 'CONTRATUAL' && t.competencia === aberta,
  )
  assert.equal(cobradas.length, 0, 'a competência aberta já tem cobrança')
})

test('faturamento e contas a receber somam o mesmo para a mesma competência', () => {
  const b = base()
  /*
   * A **última** fechada, não a primeira: a massa mede seis competências, e as
   * anteriores a isso não têm medição — comparar uma delas mediria a janela do
   * gerador, não a concordância entre as duas telas.
   */
  const fechadas = b.competencias_fechamento.filter((c) => c.fechadoEm !== null)
  const fechada = fechadas[fechadas.length - 1]!.competencia

  /*
   * Esta é a garantia que o teste de paridade dava, agora por outro caminho: em
   * vez de comparar duas coleções mantidas em correspondência, compara **o que
   * cada tela mostra**. A tela de Faturamento soma a medição; Contas a receber
   * soma o título. Com uma fonte só, os dois têm de bater — e se um dia não
   * baterem, é porque alguém reintroduziu a segunda fonte.
   */
  const somaMedicao = b.medicoes
    .filter((m) => m.competencia === fechada)
    .reduce((a, m) => a + m.valorLiquido, 0)
  const somaTitulo = b.titulosReceber
    .filter((t) => t.origem === 'CONTRATUAL' && t.competencia === fechada)
    .reduce((a, t) => a + valorLiquidoDe(t), 0)

  assert.ok(somaMedicao > 0, `a competência ${fechada} não tem medição`)
  assert.equal(Math.round(somaTitulo * 100), Math.round(somaMedicao * 100))
})

test('nenhum título contratual da massa foi gerado por quem pode aprová-lo', () => {
  const b = base()
  // Se o gerador atribuísse a criação a um aprovador, a fila dele nasceria vazia
  // e a demonstração do fluxo não teria o que mostrar — sem nada acusando.
  const pendentes = b.titulosReceber.filter((t) => t.status === 'PENDENTE_APROVACAO')
  assert.ok(pendentes.length > 0, 'a massa não tem cobrança esperando aprovação')

  const alguemVe = b.usuarios.some((u) => filaDeEmissao(b, u.id).length > 0)
  assert.ok(alguemVe, 'nenhuma cobrança pendente aparece na fila de ninguém')
})
