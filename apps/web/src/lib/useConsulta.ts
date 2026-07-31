import { useCallback, useEffect, useRef, useState } from 'react'
import { ErroApi } from '../dados/api'

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
  const buscarRef = useRef(buscar)
  buscarRef.current = buscar

  useEffect(() => {
    let vivo = true
    setEstado({ situacao: 'carregando', dado: null, erro: null })

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
  }, [...deps, tentativa])

  const recarregar = useCallback(() => setTentativa((t) => t + 1), [])

  return { ...estado, recarregar }
}
