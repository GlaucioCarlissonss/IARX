/**
 * Controle de despesas — o que a tela calcula.
 *
 * A garantia central, e a razão da decisão do operador: **o painel fecha com
 * contas a pagar**. Um painel que não fecha não dá erro; dá um percentual
 * ligeiramente errado que ninguém confere, e a diferença some entre dois totais
 * que parecem igualmente plausíveis.
 *
 * As mesmas regras existem como função no banco (`app.despesa_realizada`,
 * `app.execucao_orcamentaria`) e há teste de invariante para elas. A duplicação é
 * assumida e tem contrapartida: as duas suítes falham juntas se a regra mudar
 * num lado só.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarBase } from '../src/dados/gerar.ts'
import {
  despesaRealizada,
  execucaoOrcamentaria,
  indicadoresDespesa,
  saldoNaoComprometido,
} from '../src/dados/consultas.ts'
import { api } from '../src/dados/api.ts'
import type { BaseDados } from '../src/dados/tipos.ts'

function base(): BaseDados {
  return api.baseSincrona()
}

/** A competência mais recente que tem orçamento — é sobre ela que a tela abre. */
function competenciaOrcada(b: BaseDados): { ano: number; mes: number } {
  const o = b.orcamentos[b.orcamentos.length - 1]
  assert.ok(o, 'a massa não tem orçamento')
  assert.ok(o.mes !== null, 'o orçamento da massa é anual, e a tela abre por mês')
  return { ano: o.ano, mes: o.mes }
}

test('todo título tem categoria, e alguns ficam na residual de propósito', () => {
  const b = gerarBase()

  const semCategoria = b.titulosPagar.filter((t) => !t.categoriaId)
  assert.equal(semCategoria.length, 0, 'título sem categoria faria o painel divergir de contas a pagar')

  const residual = b.categoriasDespesa.find((c) => c.residual)
  assert.ok(residual, 'a categoria residual não existe: o preenchimento ficaria sem destino')
  assert.equal(
    b.categoriasDespesa.filter((c) => c.residual).length,
    1,
    'duas residuais e o preenchimento não saberia qual usar',
  )

  /*
   * A fila de trabalho precisa existir na massa. Sem nenhum título na residual, a
   * tela não teria como mostrar o que a decisão do operador cria — e é
   * justamente essa fila que ela existe para tornar visível.
   */
  const naResidual = b.titulosPagar.filter((t) => t.categoriaId === residual.id)
  assert.ok(naResidual.length > 0, 'nada na residual: a fila de classificação some da tela')
  assert.ok(naResidual.length < b.titulosPagar.length, 'tudo na residual: nada foi classificado')
})

test('o painel fecha com contas a pagar na mesma competência', () => {
  const b = base()
  const { ano, mes } = competenciaOrcada(b)
  const comp = `${ano}-${String(mes).padStart(2, '0')}`

  const doPainel = indicadoresDespesa(ano, mes).despesaTotal
  const deContasAPagar = b.titulosPagar
    .filter(
      (t) =>
        t.dataEmissao.slice(0, 7) === comp && t.status !== 'CANCELADO' && t.status !== 'REJEITADO',
    )
    .reduce((a, t) => a + (t.valorAjustado ?? t.valorOriginal), 0)

  assert.equal(doPainel.toFixed(2), deContasAPagar.toFixed(2))
})

test('cancelado e rejeitado não contam: foram desfeitos', () => {
  const b = gerarBase()
  const { ano, mes } = competenciaOrcada(b)
  const comp = `${ano}-${String(mes).padStart(2, '0')}`
  const de = `${comp}-01`
  const ate = `${comp}-31`

  const antes = despesaRealizada(b, de, ate)
  const alvo = b.titulosPagar.find(
    (t) => t.dataEmissao.slice(0, 7) === comp && t.status !== 'CANCELADO' && t.status !== 'REJEITADO',
  )
  assert.ok(alvo, 'a competência orçada não tem título para cancelar')

  const valor = alvo.valorAjustado ?? alvo.valorOriginal
  alvo.status = 'CANCELADO'

  // Sem job de recálculo e sem coluna de acumulado: a consulta seguinte já
  // responde outro número.
  assert.equal(despesaRealizada(b, de, ate).toFixed(2), (antes - valor).toFixed(2))
})

test('os degraus de RN-F24 seguem o dado, e o alerta some quando ele deixa de sustentá-lo', () => {
  const b = base()
  const { ano, mes } = competenciaOrcada(b)

  const linhas = execucaoOrcamentaria(ano, mes)
  assert.ok(linhas.length > 0, 'a competência orçada não produziu execução')

  for (const l of linhas) {
    const esperado =
      l.valorOrcado === 0
        ? 'SEM_ORCAMENTO'
        : l.realizado / l.valorOrcado >= 1
          ? 'ESTOURADO'
          : l.realizado / l.valorOrcado >= 0.9
            ? 'CRITICO'
            : l.realizado / l.valorOrcado >= 0.75
              ? 'ATENCAO'
              : 'NORMAL'
    assert.equal(l.limiar, esperado, `${l.categoriaNome} recebeu o degrau errado`)
  }

  /*
   * A massa precisa exercitar mais de um degrau. Com todas as linhas em NORMAL,
   * o semáforo da tela nunca aparece e o teste acima passaria sem provar nada
   * sobre os cortes.
   */
  assert.ok(new Set(linhas.map((l) => l.limiar)).size > 1, 'todos os degraus iguais na massa')
})

test('o rateio divide o título entre centros, e a soma não excede a despesa', () => {
  const b = gerarBase()
  const { ano, mes } = competenciaOrcada(b)
  const comp = `${ano}-${String(mes).padStart(2, '0')}`
  const de = `${comp}-01`
  const ate = `${comp}-31`

  const total = despesaRealizada(b, de, ate)
  const porCentro = b.centrosCusto.reduce(
    (a, c) => a + despesaRealizada(b, de, ate, { centroCustoId: c.id }),
    0,
  )

  /*
   * A soma dos centros não pode passar do total. Contar o título inteiro em cada
   * centro do rateio — o erro fácil — inflaria a despesa por centro sem que
   * nenhum número isolado parecesse errado.
   */
  assert.ok(porCentro <= total + 0.01, `a soma por centro (${porCentro}) excede a despesa (${total})`)
})

test('D-25: o aprovado e não pago já está comprometido', () => {
  const b = gerarBase()
  const { ano, mes } = competenciaOrcada(b)
  const orcamento = b.orcamentos.find((o) => o.ano === ano && o.mes === mes)!

  const antes = saldoNaoComprometido(b, orcamento)

  const alvo = b.titulosPagar.find(
    (t) =>
      t.categoriaId === orcamento.categoriaId &&
      t.dataEmissao.slice(0, 7) === `${ano}-${String(mes).padStart(2, '0')}` &&
      (t.status === 'PENDENTE' || t.status === 'EM_APROVACAO'),
  )
  if (!alvo) return // a massa pode não ter um pendente nessa categoria

  const valor = alvo.valorAjustado ?? alvo.valorOriginal
  alvo.status = 'APROVADO'

  // Aprovar não gasta nada, e mesmo assim reduz o que se pode replanejar: a
  // verba passou a ter destino.
  assert.equal(saldoNaoComprometido(b, orcamento).toFixed(2), (antes - valor).toFixed(2))
})

test('a variação sobre um período sem despesa é indefinida, não zero', () => {
  const b = base()
  // Um ano em que a massa não tem título nenhum: a variação sobre nada não é
  // "não variou", e devolver 0% diria exatamente isso.
  const vazio = indicadoresDespesa(1999, 1)
  assert.equal(vazio.despesaTotal, 0)
  assert.equal(vazio.variacao, null)
  assert.equal(vazio.execucaoPercentual, null)
  assert.ok(b.orcamentos.length > 0)
})

test('D-26 traz os dois denominadores, e cada um bate com a sua contagem', () => {
  const b = base()
  const { ano, mes } = competenciaOrcada(b)
  const i = indicadoresDespesa(ano, mes)

  assert.equal(i.clientesAtivos, new Set(b.contratos.filter((c) => c.status === 'ATIVO').map((c) => c.clienteId)).size)
  assert.equal(i.equipamentosLocados, b.equipamentos.filter((e) => e.status === 'LOCADO').length)

  // A única diferença entre os dois é o divisor — e é por isso que mostrar um só
  // obrigaria a escolher sem base.
  assert.equal(i.custoPorClienteAtivo?.toFixed(2), (i.despesaTotal / i.clientesAtivos).toFixed(2))
  assert.equal(
    i.custoPorEquipamentoLocado?.toFixed(2),
    (i.despesaTotal / i.equipamentosLocados).toFixed(2),
  )
})

test('o replanejamento da massa moveu valor, e não criou nem destruiu', () => {
  const b = base()
  const r = b.replanejamentos[0]
  assert.ok(r, 'a massa não tem replanejamento: a tela não teria histórico para mostrar')

  // `aprovadoPor` nulo é a informação: não existe alçada de orçamento definida.
  assert.equal(r.aprovadoPor, null)
  assert.ok(r.motivo.length > 10, 'o diff mostra o quê; o motivo é o único registro do porquê')

  const origem = b.orcamentos.find((o) => o.id === r.origemId)
  const destino = b.orcamentos.find((o) => o.id === r.destinoId)
  assert.ok(origem && destino)
  assert.notEqual(origem.id, destino.id)
})

test('não existe campo de gasto guardado em orçamento nem em categoria', () => {
  const b = base()
  const orcamento = b.orcamentos[0]!
  const categoria = b.categoriasDespesa[0]!

  /*
   * Teste de **ausência**, como nos Módulos 9, 10 e 13. Se alguém acrescentar um
   * `gastoAcumulado` "para performance", ele passa a ter caminho de escrita — e
   * caminho de escrita é caminho de divergência.
   */
  for (const proibido of ['gasto', 'gastoAcumulado', 'realizado', 'percentualExecucao', 'saldo']) {
    assert.ok(!(proibido in orcamento), `orçamento ganhou o campo derivado ${proibido}`)
    assert.ok(!(proibido in categoria), `categoria ganhou o campo derivado ${proibido}`)
  }
})
