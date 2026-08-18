import { useMemo, useRef, useState } from 'react'
import {
  ARVORE_PERMISSOES,
  alternarNo,
  estadoDoNo,
  permissoesDaTela,
  permissoesDoModulo,
} from '@iarx/contracts/arvore-permissoes'
import type { Permissao } from '../../lib/permissoes'

/**
 * Árvore de configuração de permissões — módulo → tela → ação.
 *
 * Toda a lógica vem de `@iarx/contracts/arvore-permissoes`, já testada: este
 * componente **não decide nada**, só desenha e devolve a lista resultante. É
 * por isso que ele pôde ser escrito depois: a parte difícil — o que marcar o
 * módulo concede, o que preservar fora do nó, quando o estado é parcial — já
 * estava resolvida e coberta.
 *
 * `role="tree"` de verdade, e não uma lista de caixas com indentação. A
 * diferença aparece no leitor de tela: numa árvore ele anuncia nível,
 * quantidade de irmãos e se o nó está expandido; numa lista indentada, nada
 * disso existe e a hierarquia some — quem não vê a tela fica sem saber a que
 * módulo aquela ação pertence.
 *
 * O estado `mixed` do `aria-checked` é o que impede a árvore de mentir. Sem
 * ele, um módulo com três de dez permissões concedidas seria anunciado como
 * "não marcado", e quem configura concluiria que o perfil não tem acesso
 * nenhum ali — quando tem.
 */

interface Props {
  concedidas: readonly Permissao[]
  aoMudar: (permissoes: Permissao[]) => void
  /** Somente leitura, para perfil de sistema. */
  bloqueada?: boolean
}

/** Todos os nós focáveis, em ordem visual — a ordem que as setas percorrem. */
interface NoFocavel {
  id: string
}

export function ArvorePermissoes({ concedidas, aoMudar, bloqueada = false }: Props) {
  const [expandidos, setExpandidos] = useState<Set<string>>(() => new Set())
  const [focado, setFocado] = useState<string>(() => `mod:${ARVORE_PERMISSOES[0]?.id ?? ''}`)
  const arvoreRef = useRef<HTMLUListElement>(null)

  /*
   * Ordem de navegação, recalculada conforme o que está expandido.
   *
   * Uma árvore acessível tem **um só ponto de tabulação**: Tab entra e sai, e
   * as setas andam por dentro. Com um tabindex por caixa, chegar da primeira
   * permissão à última custaria 113 tabulações — e o padrão APG existe
   * justamente para isso não acontecer.
   */
  const ordem = useMemo<NoFocavel[]>(() => {
    const lista: NoFocavel[] = []
    for (const m of ARVORE_PERMISSOES) {
      lista.push({ id: `mod:${m.id}` })
      if (!expandidos.has(`mod:${m.id}`)) continue
      for (const t of m.telas) {
        lista.push({ id: `tela:${m.id}:${t.recurso}` })
        if (!expandidos.has(`tela:${m.id}:${t.recurso}`)) continue
        for (const a of t.acoes) lista.push({ id: `acao:${a.permissao}` })
      }
    }
    return lista
  }, [expandidos])

  function alternarExpansao(id: string, abrir?: boolean) {
    setExpandidos((atual) => {
      const proximo = new Set(atual)
      const deveAbrir = abrir ?? !proximo.has(id)
      if (deveAbrir) proximo.add(id)
      else proximo.delete(id)
      return proximo
    })
  }

  function irPara(id: string) {
    setFocado(id)
    // O foco precisa acompanhar: sem isto, as setas moveriam o destaque visual
    // e o leitor de tela continuaria anunciando o nó anterior.
    requestAnimationFrame(() => {
      arvoreRef.current?.querySelector<HTMLElement>(`[data-no="${CSS.escape(id)}"]`)?.focus()
    })
  }

  function tecla(e: React.KeyboardEvent, id: string, temFilhos: boolean) {
    const i = ordem.findIndex((n) => n.id === id)
    const acoes: Record<string, () => void> = {
      ArrowDown: () => ordem[i + 1] && irPara(ordem[i + 1]!.id),
      ArrowUp: () => ordem[i - 1] && irPara(ordem[i - 1]!.id),
      ArrowRight: () => {
        if (!temFilhos) return
        if (expandidos.has(id)) ordem[i + 1] && irPara(ordem[i + 1]!.id)
        else alternarExpansao(id, true)
      },
      ArrowLeft: () => {
        if (temFilhos && expandidos.has(id)) {
          alternarExpansao(id, false)
          return
        }
        // Sem filhos ou já fechado, sobe para o pai — é o que o APG define, e
        // é o que permite sair de uma ação sem passar por todas as irmãs.
        const pai = id.startsWith('acao:')
          ? ordem.slice(0, i).reverse().find((n) => n.id.startsWith('tela:'))
          : ordem.slice(0, i).reverse().find((n) => n.id.startsWith('mod:'))
        if (pai) irPara(pai.id)
      },
      Home: () => ordem[0] && irPara(ordem[0]!.id),
      End: () => ordem[ordem.length - 1] && irPara(ordem[ordem.length - 1]!.id),
    }
    const acao = acoes[e.key]
    if (acao) {
      e.preventDefault()
      acao()
    }
  }

  const marcar = (doNo: readonly Permissao[], marcado: boolean) => {
    if (bloqueada) return
    aoMudar(alternarNo(concedidas, doNo, !marcado))
  }

  return (
    <ul
      className="arvore"
      role="tree"
      aria-label="Permissões do perfil"
      aria-multiselectable="true"
      ref={arvoreRef}
    >
      {ARVORE_PERMISSOES.map((m) => {
        const idModulo = `mod:${m.id}`
        const doModulo = permissoesDoModulo(m.id) as Permissao[]
        const estado = estadoDoNo(concedidas, doModulo)
        const aberto = expandidos.has(idModulo)

        return (
          <li key={m.id} role="none">
            <div
              role="treeitem"
              data-no={idModulo}
              tabIndex={focado === idModulo ? 0 : -1}
              aria-expanded={aberto}
              aria-checked={estado === 'parcial' ? 'mixed' : estado === 'marcado'}
              aria-level={1}
              className="arvore__no arvore__no--modulo"
              onFocus={() => setFocado(idModulo)}
              onKeyDown={(e) => tecla(e, idModulo, true)}
            >
              <button
                type="button"
                className="arvore__seta"
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => alternarExpansao(idModulo)}
              >
                {aberto ? '▾' : '▸'}
              </button>
              <label className="arvore__rotulo">
                <input
                  type="checkbox"
                  checked={estado === 'marcado'}
                  ref={(el) => {
                    // `indeterminate` não existe em HTML, só em JavaScript — é
                    // a única forma de a caixa mostrar o terceiro estado.
                    if (el) el.indeterminate = estado === 'parcial'
                  }}
                  disabled={bloqueada}
                  onChange={() => marcar(doModulo, estado === 'marcado')}
                  tabIndex={-1}
                />
                <strong>{m.nome}</strong>
                <span className="arvore__contagem">
                  {doModulo.filter((p) => concedidas.includes(p)).length}/{doModulo.length}
                </span>
              </label>
            </div>

            {aberto && (
              <ul role="group">
                {m.telas.map((t) => {
                  const idTela = `tela:${m.id}:${t.recurso}`
                  const daTela = permissoesDaTela(m.id, t.recurso) as Permissao[]
                  const estadoTela = estadoDoNo(concedidas, daTela)
                  const abertoTela = expandidos.has(idTela)

                  return (
                    <li key={t.recurso} role="none">
                      <div
                        role="treeitem"
                        data-no={idTela}
                        tabIndex={focado === idTela ? 0 : -1}
                        aria-expanded={abertoTela}
                        aria-checked={estadoTela === 'parcial' ? 'mixed' : estadoTela === 'marcado'}
                        aria-level={2}
                        className="arvore__no arvore__no--tela"
                        onFocus={() => setFocado(idTela)}
                        onKeyDown={(e) => tecla(e, idTela, true)}
                      >
                        <button
                          type="button"
                          className="arvore__seta"
                          aria-hidden="true"
                          tabIndex={-1}
                          onClick={() => alternarExpansao(idTela)}
                        >
                          {abertoTela ? '▾' : '▸'}
                        </button>
                        <label className="arvore__rotulo">
                          <input
                            type="checkbox"
                            checked={estadoTela === 'marcado'}
                            ref={(el) => {
                              if (el) el.indeterminate = estadoTela === 'parcial'
                            }}
                            disabled={bloqueada}
                            onChange={() => marcar(daTela, estadoTela === 'marcado')}
                            tabIndex={-1}
                          />
                          {t.nome}
                          <span className="arvore__contagem">
                            {daTela.filter((p) => concedidas.includes(p)).length}/{daTela.length}
                          </span>
                        </label>
                      </div>

                      {abertoTela && (
                        <ul role="group">
                          {t.acoes.map((a) => {
                            const idAcao = `acao:${a.permissao}`
                            const marcada = concedidas.includes(a.permissao as Permissao)

                            return (
                              <li key={a.permissao} role="none">
                                <div
                                  role="treeitem"
                                  data-no={idAcao}
                                  tabIndex={focado === idAcao ? 0 : -1}
                                  aria-checked={marcada}
                                  aria-level={3}
                                  className="arvore__no arvore__no--acao"
                                  onFocus={() => setFocado(idAcao)}
                                  onKeyDown={(e) => tecla(e, idAcao, false)}
                                >
                                  <label className="arvore__rotulo">
                                    <input
                                      type="checkbox"
                                      checked={marcada}
                                      disabled={bloqueada}
                                      onChange={() => marcar([a.permissao as Permissao], marcada)}
                                      tabIndex={-1}
                                    />
                                    {a.rotulo}
                                    {/* O identificador aparece: quem configura
                                        permissão precisa poder cruzar com a
                                        documentação e com o log de auditoria,
                                        que registram `recurso:ação`. */}
                                    <code className="arvore__id">{a.permissao}</code>
                                  </label>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
