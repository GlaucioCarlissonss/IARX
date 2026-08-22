/**
 * Comandos de centro de custo e conta bancária.
 *
 * O que estes testes protegem, em uma frase: **o saldo é o extrato**. Não há
 * campo de saldo em lugar nenhum do modelo, e é essa ausência que garante que
 * os dois não divergem — uma cópia guardada erra na primeira escrita que
 * esquecer de atualizá-la, e o erro aparece como dinheiro que não fecha, meses
 * depois, sem pista de onde começou.
 *
 * As mesmas regras existem como gatilho na migração 0017. As duas não são
 * redundância: aqui elas permitem a interface explicar antes de tentar, lá elas
 * valem para quem não passa pela interface.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarBase } from '../src/dados/gerar.ts'
import {
  conciliarMovimentacao,
  definirAtivoCentro,
  estornarMovimentacao,
  lancarMovimentacao,
  nivelDoCentro,
  saldoDaConta,
  salvarCentroCusto,
  salvarContaBancaria,
  transferirEntreContas,
} from '../src/dados/comandos.ts'
import type { BaseDados } from '../src/dados/tipos.ts'

function base(): BaseDados {
  return gerarBase()
}

/* --------------------------------------------------- centro de custo */

test('a árvore de centros nasce com três níveis e nenhum quarto', () => {
  const b = base()
  const niveis = b.centrosCusto.map((c) => nivelDoCentro(b, c.id))

  assert.ok(niveis.includes(1), 'nenhum centro de primeiro nível')
  assert.ok(niveis.includes(2), 'nenhum subcentro')
  assert.ok(niveis.includes(3), 'nenhum centro de terceiro nível — a tela não exercita o limite')
  assert.equal(Math.max(...niveis), 3)
})

test('a massa tem um centro inativo, que é o estado fácil de esquecer', () => {
  const b = base()
  assert.ok(b.centrosCusto.some((c) => !c.ativo), 'nenhum centro inativo na massa')
})

test('criar no quarto nível é recusado, citando o limite', () => {
  const b = base()
  const terceiro = b.centrosCusto.find((c) => nivelDoCentro(b, c.id) === 3)!

  const r = salvarCentroCusto(b, null, {
    codigo: 'QUARTO',
    nome: 'Quarto nível',
    descricao: '',
    centroPaiId: terceiro.id,
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.erro.campo, 'centroPaiId')
  assert.match(r.erro.mensagem, /3 níveis/)
  // A recusa sem alternativa deixa o operador travado.
  assert.ok((r.erro.acoes ?? []).length > 0)
})

test('um centro não pode descender de si mesmo', () => {
  const b = base()
  const raiz = b.centrosCusto.find((c) => !c.centroPaiId && c.ativo)!
  const neto = b.centrosCusto.find((c) => nivelDoCentro(b, c.id) === 3)!

  const r = salvarCentroCusto(b, raiz.id, {
    codigo: raiz.codigo,
    nome: raiz.nome,
    descricao: raiz.descricao,
    centroPaiId: neto.id,
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.erro.mensagem, /si mesmo/)
})

test('código repetido é recusado, mesmo em caixa diferente', () => {
  const b = base()
  const existente = b.centrosCusto[0]!

  const r = salvarCentroCusto(b, null, {
    codigo: existente.codigo.toLowerCase(),
    nome: 'Outro nome',
    descricao: '',
    centroPaiId: null,
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.erro.campo, 'codigo')
})

test('inativar centro com filho ativo é recusado, e a folha primeiro funciona', () => {
  const b = base()
  const pai = b.centrosCusto.find(
    (c) => c.ativo && b.centrosCusto.some((f) => f.centroPaiId === c.id && f.ativo),
  )!
  const filhos = b.centrosCusto.filter((f) => f.centroPaiId === pai.id && f.ativo)

  const recusa = definirAtivoCentro(b, pai.id, false)
  assert.equal(recusa.ok, false)
  if (!recusa.ok) {
    // A mensagem cita os códigos: quem lê precisa saber quantos e quais são,
    // não só que existem.
    for (const f of filhos) assert.match(recusa.erro.mensagem, new RegExp(f.codigo))
  }

  // Da folha para a raiz funciona — e é o caminho que torna a extensão do
  // estrago visível antes de acontecer.
  for (const f of filhos) {
    const netos = b.centrosCusto.filter((n) => n.centroPaiId === f.id && n.ativo)
    for (const n of netos) assert.equal(definirAtivoCentro(b, n.id, false).ok, true)
    assert.equal(definirAtivoCentro(b, f.id, false).ok, true)
  }
  assert.equal(definirAtivoCentro(b, pai.id, false).ok, true)
})

/* --------------------------------------------------- conta bancária */

test('o saldo é a soma do extrato, e não um número guardado', () => {
  const b = base()
  const conta = b.contasBancarias[0]!

  const soma = b.movimentacoes
    .filter((m) => m.contaId === conta.id && m.dataMovimento >= conta.dataSaldoInicial)
    .reduce(
      (t, m) => t + (m.tipo === 'ENTRADA' || m.tipo === 'TRANSFERENCIA_ENTRADA' ? m.valor : -m.valor),
      0,
    )

  const esperado = Math.round((conta.saldoInicial + soma + Number.EPSILON) * 100) / 100
  assert.equal(saldoDaConta(b, conta.id), esperado)

  // A ausência da propriedade é o teste. Um campo `saldo` divergiria na
  // primeira escrita que esquecesse de atualizá-lo.
  assert.ok(!('saldo' in conta), 'ContaBancaria não deve ter campo de saldo')
  assert.ok(!('saldoAtual' in conta), 'ContaBancaria não deve ter campo de saldo atual')
})

test('movimentação anterior ao saldo inicial não é somada duas vezes', () => {
  const b = base()
  const conta = b.contasBancarias[0]!
  const antes = saldoDaConta(b, conta.id)

  // O saldo inicial daquela data já inclui tudo o que veio antes, por
  // definição de "saldo naquela data".
  b.movimentacoes.push({
    id: 'mov-antigo',
    contaId: conta.id,
    tipo: 'ENTRADA',
    valor: 9_999,
    dataMovimento: '2020-01-01',
    descricao: 'Anterior ao saldo inicial',
    transferenciaParId: null,
    estornaId: null,
    motivo: null,
    conciliado: false,
    conciliadoEm: null,
    criadoEm: '2020-01-01',
  })

  assert.equal(saldoDaConta(b, conta.id), antes)
})

test('o saldo aceita data de corte, que é o que a conciliação precisa', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!

  const r = lancarMovimentacao(b, conta.id, {
    tipo: 'ENTRADA',
    valor: 1_000,
    dataMovimento: '2026-12-31',
    descricao: 'Muito depois',
  })
  assert.equal(r.ok, true)

  // Comparar com o extrato do dia 30 exige o saldo do dia 30, não o de hoje.
  const ate = saldoDaConta(b, conta.id, '2026-12-30')
  const total = saldoDaConta(b, conta.id)
  assert.equal(total - ate, 1_000)
})

test('conta bloqueada recusa lançamento manual, com a saída à mão', () => {
  const b = base()
  const bloqueada = b.contasBancarias.find((c) => c.status === 'BLOQUEADA')!

  const r = lancarMovimentacao(b, bloqueada.id, {
    tipo: 'SAIDA',
    valor: 10,
    dataMovimento: '2026-08-01',
    descricao: 'Tentativa manual',
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.erro.mensagem, /bloqueada/i)
  assert.ok((r.erro.acoes ?? []).some((a) => /estorno/i.test(a)))
})

test('valor não positivo é recusado — o sinal é o tipo', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!

  for (const valor of [0, -10]) {
    const r = lancarMovimentacao(b, conta.id, {
      tipo: 'SAIDA',
      valor,
      dataMovimento: '2026-08-01',
      descricao: 'Inválido',
    })
    assert.equal(r.ok, false, `valor ${valor} deveria ser recusado`)
    if (!r.ok) assert.equal(r.erro.campo, 'valor')
  }
})

test('transferência gera as duas pernas, e cada uma aponta a outra', () => {
  const b = base()
  const [a, c] = b.contasBancarias.filter((x) => x.status === 'ATIVA')
  const saldoAntesA = saldoDaConta(b, a!.id)
  const saldoAntesC = saldoDaConta(b, c!.id)

  const r = transferirEntreContas(b, {
    contaOrigemId: a!.id,
    contaDestinoId: c!.id,
    valor: 5_000,
    dataMovimento: '2026-08-01',
    descricao: 'Provisão',
  })
  assert.equal(r.ok, true)
  if (!r.ok) return

  assert.equal(r.valor.saida.transferenciaParId, r.valor.entrada.id)
  assert.equal(r.valor.entrada.transferenciaParId, r.valor.saida.id)
  assert.equal(saldoDaConta(b, a!.id), saldoAntesA - 5_000)
  assert.equal(saldoDaConta(b, c!.id), saldoAntesC + 5_000)
})

test('transferir para a mesma conta é recusado', () => {
  const b = base()
  const a = b.contasBancarias.find((c) => c.status === 'ATIVA')!

  const r = transferirEntreContas(b, {
    contaOrigemId: a.id,
    contaDestinoId: a.id,
    valor: 10,
    dataMovimento: '2026-08-01',
    descricao: 'Círculo',
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.erro.campo, 'contaDestinoId')
})

test('transferir de conta bloqueada é recusado', () => {
  const b = base()
  const bloqueada = b.contasBancarias.find((c) => c.status === 'BLOQUEADA')!
  const ativa = b.contasBancarias.find((c) => c.status === 'ATIVA')!

  const r = transferirEntreContas(b, {
    contaOrigemId: bloqueada.id,
    contaDestinoId: ativa.id,
    valor: 10,
    dataMovimento: '2026-08-01',
    descricao: 'Não deveria',
  })
  assert.equal(r.ok, false)
})

test('o estorno inverte o tipo, e o saldo volta ao que era', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const antes = saldoDaConta(b, conta.id)

  const saida = lancarMovimentacao(b, conta.id, {
    tipo: 'SAIDA',
    valor: 250,
    dataMovimento: '2026-08-01',
    descricao: 'Pagamento errado',
  })
  assert.equal(saida.ok, true)
  if (!saida.ok) return
  assert.equal(saldoDaConta(b, conta.id), antes - 250)

  const estorno = estornarMovimentacao(b, saida.valor.id, 'pagamento em duplicidade')
  assert.equal(estorno.ok, true)
  if (!estorno.ok) return

  // O tipo invertido sai daqui, não do chamador: estornar uma saída com outra
  // saída dobraria a despesa em vez de anulá-la, e o extrato continuaria
  // fechando consigo mesmo.
  assert.equal(estorno.valor.tipo, 'ENTRADA')
  assert.equal(estorno.valor.estornaId, saida.valor.id)
  assert.equal(saldoDaConta(b, conta.id), antes)

  // A original continua no extrato: histórico não é reescrito.
  assert.ok(b.movimentacoes.some((m) => m.id === saida.valor.id))
})

test('estornar o estorno é recusado, e a saída é lançar de novo', () => {
  const b = base()
  const conta = b.contasBancarias.find((c) => c.status === 'ATIVA')!
  const saida = lancarMovimentacao(b, conta.id, {
    tipo: 'SAIDA',
    valor: 100,
    dataMovimento: '2026-08-01',
    descricao: 'Qualquer',
  })
  assert.equal(saida.ok, true)
  if (!saida.ok) return

  const primeiro = estornarMovimentacao(b, saida.valor.id, 'motivo suficiente')
  assert.equal(primeiro.ok, true)
  if (!primeiro.ok) return

  // Estornar o estorno reabriria o valor original pela terceira vez.
  assert.equal(estornarMovimentacao(b, primeiro.valor.id, 'tentando de novo').ok, false)
  assert.equal(estornarMovimentacao(b, saida.valor.id, 'de novo na original').ok, false)
})

test('estorno sem motivo é recusado', () => {
  const b = base()
  const alvo = b.movimentacoes.find((m) => !m.estornaId)!
  const r = estornarMovimentacao(b, alvo.id, 'oi')
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.erro.campo, 'motivo')
})

test('conciliar e desconciliar não mexem no saldo', () => {
  const b = base()
  const conta = b.contasBancarias[0]!
  const antes = saldoDaConta(b, conta.id)
  const m = b.movimentacoes.find((x) => x.contaId === conta.id && !x.conciliado)!

  assert.equal(conciliarMovimentacao(b, m.id, true).ok, true)
  assert.equal(m.conciliado, true)
  assert.notEqual(m.conciliadoEm, null)
  assert.equal(saldoDaConta(b, conta.id), antes)

  // Desconciliar existe porque conciliar errado acontece — dois lançamentos de
  // mesmo valor no mesmo dia é o caso comum.
  assert.equal(conciliarMovimentacao(b, m.id, false).ok, true)
  assert.equal(m.conciliado, false)
  assert.equal(m.conciliadoEm, null)
  assert.equal(saldoDaConta(b, conta.id), antes)
})

test('a massa tem movimentação pendente de conciliação e conta bloqueada', () => {
  const b = base()
  // Uma base toda conciliada esconderia a fila de trabalho, que é a razão de a
  // coluna de conciliação existir.
  assert.ok(b.movimentacoes.some((m) => !m.conciliado), 'nada pendente de conciliação')
  assert.ok(b.movimentacoes.some((m) => m.conciliado), 'nada conciliado')
  assert.ok(b.contasBancarias.some((c) => c.status === 'BLOQUEADA'), 'nenhuma conta bloqueada')
  assert.ok(
    b.movimentacoes.some((m) => m.transferenciaParId !== null),
    'nenhuma transferência com par na massa',
  )
})

test('a transferência semeada tem as duas pernas casadas', () => {
  const b = base()
  const pernas = b.movimentacoes.filter((m) => m.transferenciaParId !== null)
  assert.ok(pernas.length >= 2)

  for (const p of pernas) {
    const par = b.movimentacoes.find((m) => m.id === p.transferenciaParId)
    assert.ok(par, `perna ${p.id} aponta para um par que não existe`)
    assert.equal(par!.transferenciaParId, p.id, 'o par não aponta de volta')
    assert.equal(par!.valor, p.valor, 'as pernas têm valores diferentes')
    assert.notEqual(par!.contaId, p.contaId, 'as duas pernas na mesma conta')
  }
})

test('conta duplicada é recusada pela identificação bancária', () => {
  const b = base()
  const existente = b.contasBancarias[0]!

  const r = salvarContaBancaria(b, null, {
    bancoCodigo: existente.bancoCodigo,
    bancoNome: existente.bancoNome,
    agencia: existente.agencia,
    numero: existente.numero,
    tipo: 'CORRENTE',
    apelido: 'Outro apelido',
    saldoInicial: 0,
    dataSaldoInicial: '2026-01-01',
    limiteCredito: null,
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.erro.campo, 'numero')
  // A mensagem diz qual conta já ocupa a identificação: sem isso, quem cadastra
  // não sabe se procurou no lugar errado ou se digitou errado.
  assert.match(r.erro.mensagem, new RegExp(existente.apelido))
})
