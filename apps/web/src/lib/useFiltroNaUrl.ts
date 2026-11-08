import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * O filtro de uma lista, na URL (Anexo Y §Y.3.5).
 *
 * ## Por que na URL, e não em `useState`
 *
 * Três coisas que o estado local não dá, e que custam o dia de quem opera:
 *
 *  1. **o recorte não sobrevive à navegação.** Abrir um equipamento e voltar
 *     devolvia a lista inteira, e o filtro era remontado à mão;
 *  2. **o recorte não é compartilhável.** Colar o endereço para um colega
 *     levava à lista sem filtro nenhum, e a conversa virava "filtra por estado
 *     em manutenção, depois por preventiva vencida, depois…";
 *  3. **não há o que salvar.** Uma visão salva é um nome dado a uma consulta —
 *     sem a consulta num lugar nomeável, não existe visão.
 *
 * O Parque já fazia isso à mão. Este hook é o mesmo raciocínio em um lugar só,
 * porque sete cópias do mesmo `definir` divergem na primeira tela que esquecer
 * o `replace: true` e encher o histórico de voltas que não voltam nada.
 *
 * ## `replace`, e não `push`
 *
 * Cada tecla digitada na busca criaria uma entrada no histórico. Com `replace`
 * o botão Voltar faz o que a pessoa espera — sai da lista — em vez de desfazer
 * letra por letra.
 */

export interface FiltroNaUrl<C extends Record<string, string>> {
  /** Valores correntes, já com os padrões aplicados. */
  valores: C
  definir: (chave: keyof C & string, valor: string) => void
  /** Substitui o recorte inteiro — é o que abrir uma visão faz. */
  aplicar: (consulta: Record<string, string>) => void
  limpar: () => void
  /** Quantos filtros estão valendo. Zero esconde o "limpar". */
  ativos: number
  /**
   * O recorte como objeto, pronto para virar visão salva.
   *
   * Só o que difere do padrão: guardar `{estado: ''}` faria a visão parecer
   * ter um filtro que ela não tem, e o `diff` contra a tela nunca bateria.
   */
  consulta: Record<string, string>
  /** Se o recorte atual é igual ao de uma visão — decide o "filtros alterados". */
  igualA: (consulta: Record<string, string>) => boolean
}

export function useFiltroNaUrl<C extends Record<string, string>>(padroes: C): FiltroNaUrl<C> {
  const [params, setParams] = useSearchParams()

  const chaves = useMemo(() => Object.keys(padroes) as (keyof C & string)[], [padroes])

  const valores = useMemo(() => {
    const v = {} as C
    for (const c of chaves) {
      v[c] = (params.get(c) ?? padroes[c]) as C[keyof C & string]
    }
    return v
    // `params` é recriado a cada navegação; comparar pela string evita
    // recalcular a cada render sem mudança de recorte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString(), chaves, padroes])

  const consulta = useMemo(() => {
    const c: Record<string, string> = {}
    for (const k of chaves) {
      if (valores[k] !== padroes[k]) c[k] = valores[k]
    }
    return c
  }, [valores, chaves, padroes])

  const definir = useCallback(
    (chave: keyof C & string, valor: string) => {
      const p = new URLSearchParams(params)
      /*
       * Valor igual ao padrão sai da URL em vez de virar `?estado=`.
       *
       * Sem isto o endereço acumula parâmetros vazios, e dois recortes iguais
       * produzem URLs diferentes — o que faria a comparação com a visão salva
       * acusar "filtros alterados" sem nada ter mudado.
       */
      if (valor && valor !== padroes[chave]) p.set(chave, valor)
      else p.delete(chave)
      setParams(p, { replace: true })
    },
    [params, setParams, padroes],
  )

  const aplicar = useCallback(
    (nova: Record<string, string>) => {
      const p = new URLSearchParams()
      for (const [k, v] of Object.entries(nova)) {
        if (v && v !== padroes[k as keyof C & string]) p.set(k, v)
      }
      /*
       * Parâmetros que não são filtro desta tela são descartados.
       *
       * Uma visão de outra tela, ou de uma versão anterior com um filtro que
       * já não existe, aplicaria lixo na URL — e a lista mostraria o recorte
       * certo com o endereço errado, que é o pior dos dois mundos.
       */
      setParams(p, { replace: true })
    },
    [setParams, padroes],
  )

  const limpar = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams])

  const igualA = useCallback(
    (outra: Record<string, string>) => {
      const limpa = Object.entries(outra).filter(([k, v]) => v && v !== padroes[k as keyof C & string])
      if (limpa.length !== Object.keys(consulta).length) return false
      return limpa.every(([k, v]) => consulta[k] === v)
    },
    [consulta, padroes],
  )

  return {
    valores,
    definir,
    aplicar,
    limpar,
    ativos: Object.keys(consulta).length,
    consulta,
    igualA,
  }
}
