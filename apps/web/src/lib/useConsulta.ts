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

  // `revisao` sobe a cada escrita e precisa reexecutar a busca sem voltar ao
  // estado de carregamento. Guardá-la em ref, em vez de na lista de
  // dependências, é o que separa "buscar de novo" de "mostrar skeleton".
  const revisaoRef = useRef(revisao)
  const silencioso = revisaoRef.current !== revisao
  revisaoRef.current = revisao

  useEffect(() => {
    let vivo = true
    // Recarga após escrita mantém o conteúdo na tela: trocar a lista por
    // skeleton depois de salvar faz o usuário perder o lugar em que estava, e
    // pisca a página inteira por causa de uma linha que mudou.
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
