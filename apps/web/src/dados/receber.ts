import type { StatusReceber, TituloReceber } from './tipos'

/**
 * O saldo de um título a receber, e o que conta como "em aberto".
 *
 * Módulo próprio por uma razão de dependência: `gerar.ts` calcula os
 * indicadores da base e `comandos.ts` os recalcula depois de cada escrita, e
 * `comandos` importa `gerar` — então o que os dois precisam não pode morar em
 * nenhum dos dois sem ciclo. Duas cópias da mesma fórmula é o que se evita
 * aqui: o painel somaria de um jeito e a tela de outro, e as duas pareceriam
 * certas.
 */

/** Em aberto: o que ainda representa entrada de caixa esperada. */
export const EM_ABERTO_RECEBER: readonly StatusReceber[] = [
  'PENDENTE_APROVACAO',
  'PENDENTE',
  'APROVADO',
  'RECEBIDO_PARCIAL',
  'EM_DISPUTA',
]

export const ehAbertoReceber = (status: StatusReceber): boolean =>
  EM_ABERTO_RECEBER.includes(status)

const cent = (n: number) => Math.round(n * 100) / 100

/** Valor cobrável: o original menos o desconto concedido. */
export const valorLiquidoReceber = (t: TituloReceber): number => cent(t.valorOriginal - t.desconto)

/** Recebido de fato — estorno não conta, que é a razão de o campo existir. */
export const totalRecebidoDe = (t: TituloReceber): number =>
  cent(t.recebimentos.filter((r) => r.estornadoEm === null).reduce((a, r) => a + r.valorRecebido, 0))

/** Saldo em aberto. Derivado, nunca gravado — se não há escrita, não há divergência. */
export const saldoReceber = (t: TituloReceber): number =>
  cent(valorLiquidoReceber(t) - totalRecebidoDe(t))

/**
 * As datas da cobrança de uma competência.
 *
 * Emissão é o primeiro dia do mês **seguinte** ao da competência — não se cobra
 * um mês antes de ele terminar —, e o vencimento é o dia contratado desse mesmo
 * mês. `diaVencimento` vai até 28 justamente para esta conta não cair num dia
 * que fevereiro não tem.
 *
 * Vive aqui porque duas coisas precisam dela e precisam concordar: o gerador da
 * massa e o fechamento de competência em tempo de execução. Escrita duas vezes,
 * uma cobrança gerada pela tela venceria num dia diferente de uma cobrança da
 * mesma competência que veio da massa — e nada acusaria.
 */
export function datasDaCobranca(
  competencia: string,
  diaVencimento: number,
): { emissao: Date; vencimento: Date } {
  const [ano, mes] = competencia.split('-').map(Number)
  return {
    emissao: new Date(ano!, mes!, 1),
    vencimento: new Date(ano!, mes!, diaVencimento),
  }
}
