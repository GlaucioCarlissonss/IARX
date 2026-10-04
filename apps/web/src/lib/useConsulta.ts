import { useCallback, useEffect, useRef, useState } from 'react'
import { assinarMudancas, ErroApi } from '../dados/api'

/**
 * Hook de consulta assíncrona.
 *
 * Substitui o padrão repetido de três useState (dado, carregando, erro) em cada
 * tela. Cobre cancelamento na desmontagem, nova tentativa e o caso de erro com
 * ações sugeridas — exatamente o que o tratamento de erro da interface precisa.
 *
 * Quando a API real entrar, este hook pode ser trocado por TanStack Query sem
 * que nenhuma tela mude: a superfície de retorno é a mesma.
 */

export type EstadoConsulta<T> =
  | { situacao: 'carregando'; dado: null; erro: null }
  | { situacao: 'pronto'; dado: T; erro: null }
  | { situacao: 'erro'; dado: null; erro: { mensagem: string; acoes: string[] } }

export function useConsulta<T>(
  buscar: () => Promise<T>,
  deps: unknown[] = [],
): EstadoConsulta<T> & { recarregar: () => void } {
  const [estado, setEstado] = useState<EstadoConsulta<T>>({ situacao: 'carregando', dado: null, erro: null })
  const [tentativa, setTentativa] = useState(0)
  const [revisao, setRevisao] = useState(0)
  const buscarRef = useRef(buscar)
  buscarRef.current = buscar

  /*
   * `revisao` sobe a cada escrita e precisa reexecutar a busca **sem** voltar
   * ao estado de carregamento: trocar a lista por skeleton depois de salvar faz
   * a pessoa perder o lugar em que estava, e pisca a página inteira por causa
   * de uma linha que mudou.
   *
   * A comparação acontece **dentro do efeito**, e a ref só avança quando o
   * efeito de fato roda. A versão anterior a atualizava durante a renderização,
   * e isso é a fonte de um defeito intermitente real: React pode renderizar sem
   * efetivar — uma atualização de estado concorrente, um `Suspense`, um
   * `StrictMode` — e a ref ficava adiantada para uma renderização descartada.
   * O efeito seguinte então lia `silencioso = false` e a tabela sumia por um
   * instante, substituída por skeleton, **de vez em quando**.
   *
   * Foi assim que apareceu: um teste de ponta a ponta que lia a primeira linha
   * da tabela antes e depois de abrir um diálogo falhava uma vez em três — e o
   * que ele lia depois era a primeira linha de **outra** tabela da mesma tela,
   * porque a primeira havia virado skeleton no intervalo.
   */
  const revisaoEfetivada = useRef(revisao)

  useEffect(() => {
    let vivo = true
    const silencioso = revisaoEfetivada.current !== revisao
    revisaoEfetivada.current = revisao

    if (!silencioso) setEstado({ situacao: 'carregando', dado: null, erro: null })

    buscarRef
      .current()
      .then((dado) => {
        if (vivo) setEstado({ situacao: 'pronto', dado, erro: null })
      })
      .catch((e: unknown) => {
        if (!vivo) return
        const erro =
          e instanceof ErroApi
            ? { mensagem: e.message, acoes: e.acoes }
            : { mensagem: 'Não conseguimos carregar os dados agora.', acoes: ['Tentar novamente'] }
        setEstado({ situacao: 'erro', dado: null, erro })
      })

    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tentativa, revisao])

  /** Nova tentativa explícita do usuário: volta ao carregamento. */
  const recarregar = useCallback(() => setTentativa((t) => t + 1), [])

  // Toda escrita bem-sucedida reexecuta a consulta. Sem isto a tela continuaria
  // mostrando o estado anterior à ação que o próprio usuário acabou de fazer.
  useEffect(() => assinarMudancas(() => setRevisao((r) => r + 1)), [])

  return { ...estado, recarregar }
}
