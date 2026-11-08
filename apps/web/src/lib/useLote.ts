import { useCallback, useMemo, useState } from 'react'
import { executarLote } from './lote'
import type { AlvoDoLote, ResultadoLote } from './lote'
import type { Resultado } from '../dados/comandos'

/**
 * O estado de uma lista com seleção e ações em lote.
 *
 * Cinco telas precisam exatamente disto — seleção, progresso, relatório — e
 * escrever o mesmo `useState` cinco vezes é o caminho conhecido para que a
 * quinta esqueça de reselecionar quem falhou, ou limpe a seleção na hora
 * errada. Aqui a regra é escrita uma vez:
 *
 *  - **depois do lote, fica selecionado quem falhou.** Limpar tudo obrigaria a
 *    pessoa a remontar a seleção justamente para tratar a recusa que acabou de
 *    ler; e deixar tudo selecionado convidaria a repetir a ação sobre quem já
 *    a sofreu;
 *  - **o progresso é contado**, porque uma lista de cinquenta leva segundos e
 *    sem contagem parece travada;
 *  - **o relatório abre sempre**, mesmo quando tudo deu certo. Um lote que
 *    silenciosamente "funcionou" não diz quantos — e o parcial, que é o caso
 *    que interessa, passaria por sucesso.
 */
export interface Lote {
  selecionados: ReadonlySet<string>
  definirSelecao: (ids: string[]) => void
  limpar: () => void
  progresso: [number, number] | null
  relatorio: { titulo: string; verbo: string; dados: ResultadoLote } | null
  fecharRelatorio: () => void
  /** Executa a ação sobre os alvos e abre o relatório. */
  rodar: (
    alvos: AlvoDoLote[],
    acao: (id: string) => Promise<Resultado<unknown>>,
    rotulos: { titulo: string; verbo: string },
  ) => Promise<void>
  /** Verdadeiro enquanto um lote corre: a tela desabilita o que não cabe. */
  ocupado: boolean
}

export function useLote(aoTerminar?: () => void): Lote {
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(new Set())
  const [progresso, setProgresso] = useState<[number, number] | null>(null)
  const [relatorio, setRelatorio] = useState<Lote['relatorio']>(null)

  const definirSelecao = useCallback((ids: string[]) => setSelecionados(new Set(ids)), [])
  const limpar = useCallback(() => setSelecionados(new Set()), [])

  const rodar = useCallback(
    async (
      alvos: AlvoDoLote[],
      acao: (id: string) => Promise<Resultado<unknown>>,
      rotulos: { titulo: string; verbo: string },
    ) => {
      setProgresso([0, alvos.length])
      const dados = await executarLote(alvos, acao, (feitos, total) => setProgresso([feitos, total]))
      setProgresso(null)
      setSelecionados(new Set([...dados.recusados, ...dados.ignorados].map((f) => f.id)))
      setRelatorio({ ...rotulos, dados })
      aoTerminar?.()
    },
    [aoTerminar],
  )

  return useMemo(
    () => ({
      selecionados,
      definirSelecao,
      limpar,
      progresso,
      relatorio,
      fecharRelatorio: () => setRelatorio(null),
      rodar,
      ocupado: progresso !== null,
    }),
    [selecionados, definirSelecao, limpar, progresso, relatorio, rodar],
  )
}
