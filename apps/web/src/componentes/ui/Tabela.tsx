import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { EstadoVazio } from './primitivos'
import { Rolagem } from './Rolagem'

/**
 * Tabela operacional genérica.
 *
 * Concentra num só lugar tudo o que as listas do sistema precisam e que é fácil
 * errar tela a tela: ordenação anunciada por aria-sort, cabeçalho de linha
 * semântico, contagem em região aria-live, rolagem horizontal com acesso por
 * teclado apenas quando de fato transborda, e estado vazio com saída.
 *
 * Genérica em T para que cada tela mantenha seus próprios tipos, sem `any`.
 */

export interface Coluna<T> {
  chave: string
  titulo: string
  /** Conteúdo renderizado da célula. */
  celula: (item: T) => ReactNode
  /** Valor usado para ordenar. Ausente = coluna não ordenável. */
  ordenarPor?: (item: T) => string | number
  numerico?: boolean
  /** Marca a coluna que identifica o registro: vira <th scope="row">. */
  identificadora?: boolean
  /** Oculta em telas estreitas, preservando as colunas essenciais. */
  ocultarEmMobile?: boolean
}

/**
 * Seleção múltipla (Anexo Y §Y.3.4).
 *
 * A seleção é **da tela**, não da tabela: é a tela que sabe o que fazer com
 * ela, e manter o estado aqui dentro obrigaria a barra de lote a adivinhá-lo.
 *
 * O escopo é a página exibida. Ao paginar, a seleção é esvaziada — e o rodapé
 * diz quantos estão selecionados nela. A alternativa, "selecionar todos os
 * 438", faria uma ação em lote agir sobre registros que ninguém viu; quem
 * quer os 438 filtra e age página a página, vendo o que age.
 */
interface SelecaoTabela<T> {
  /** Ids selecionados. A tela é dona. */
  selecionados: ReadonlySet<string>
  aoMudar: (ids: string[]) => void
  /** Nome acessível da caixa da linha: "patrimônio 10001". */
  rotuloDe: (item: T) => string
  /**
   * Linhas que não podem ser selecionadas, com o motivo. Um chamado encerrado
   * não entra num lote de atribuição de técnico — e desabilitar dizendo por
   * quê é melhor que deixar marcar e recusar depois.
   */
  impedimentoDe?: (item: T) => string | undefined
}

interface TabelaProps<T> {
  legenda: string
  colunas: Coluna<T>[]
  itens: T[]
  chaveDe: (item: T) => string
  /** Ordenação inicial. */
  ordemInicial?: { chave: string; direcao: 'asc' | 'desc' }
  vazio?: { titulo: string; texto?: string; acao?: ReactNode }
  /** Página exibida por vez. Zero desativa a paginação. */
  porPagina?: number
  aoClicarLinha?: (item: T) => void
  selecao?: SelecaoTabela<T>
}

/** Opções do seletor de tamanho de página. */
const TAMANHOS = [25, 50, 100]

export function Tabela<T>({
  legenda,
  colunas,
  itens,
  chaveDe,
  ordemInicial,
  vazio,
  porPagina = 25,
  aoClicarLinha,
  selecao,
}: TabelaProps<T>) {
  const [ordem, setOrdem] = useState(ordemInicial ?? null)
  const [pagina, setPagina] = useState(0)
  const [tamanho, setTamanho] = useState(porPagina)
  const idContagem = useId()
  const cabecaRef = useRef<HTMLInputElement>(null)

  const ordenados = useMemo(() => {
    if (!ordem) return itens
    const col = colunas.find((c) => c.chave === ordem.chave)
    if (!col?.ordenarPor) return itens
    const fator = ordem.direcao === 'asc' ? 1 : -1
    return [...itens].sort((a, b) => {
      const va = col.ordenarPor!(a)
      const vb = col.ordenarPor!(b)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * fator
      return String(va).localeCompare(String(vb), 'pt-BR') * fator
    })
  }, [itens, ordem, colunas])

  const totalPaginas = tamanho > 0 ? Math.max(1, Math.ceil(ordenados.length / tamanho)) : 1
  const paginaSegura = Math.min(pagina, totalPaginas - 1)
  const visiveis = tamanho > 0 ? ordenados.slice(paginaSegura * tamanho, (paginaSegura + 1) * tamanho) : ordenados

  // Filtro mudou: volta para a primeira página, senão o usuário vê lista vazia.
  useEffect(() => {
    setPagina(0)
  }, [itens])

  /* ------------------------------------------------------------- seleção */

  const selecionaveis = useMemo(
    () => (selecao ? visiveis.filter((i) => !selecao.impedimentoDe?.(i)) : []),
    [visiveis, selecao],
  )
  const marcados = selecao ? selecionaveis.filter((i) => selecao.selecionados.has(chaveDe(i))).length : 0
  const todosMarcados = selecionaveis.length > 0 && marcados === selecionaveis.length
  const algunsMarcados = marcados > 0 && !todosMarcados

  /*
   * O estado "alguns" não existe em HTML: `indeterminate` é só propriedade do
   * elemento, não atributo. Sem este efeito a caixa do cabeçalho mostraria
   * "vazia" com metade das linhas marcadas — e um clique marcaria tudo quando
   * a pessoa esperava desmarcar.
   */
  useEffect(() => {
    if (cabecaRef.current) cabecaRef.current.indeterminate = algunsMarcados
  }, [algunsMarcados])

  /*
   * Paginar esvazia a seleção, e não a carrega entre páginas.
   *
   * Seleção que sobrevive à paginação é seleção invisível: a barra diria
   * "32 selecionados" com três marcados na tela, e a ação em lote atingiria
   * registros fora da vista. O rodapé diz que a seleção é desta página.
   */
  useEffect(() => {
    if (selecao && selecao.selecionados.size > 0) selecao.aoMudar([])
    // Só a troca de página e de tamanho dispara; incluir `selecao` faria o
    // efeito limpar a seleção que ele mesmo acabou de causar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paginaSegura, tamanho])

  function alternarTodos() {
    if (!selecao) return
    const restante = [...selecao.selecionados].filter(
      (id) => !selecionaveis.some((i) => chaveDe(i) === id),
    )
    selecao.aoMudar(todosMarcados ? restante : [...restante, ...selecionaveis.map(chaveDe)])
  }

  function alternarUm(id: string) {
    if (!selecao) return
    const atual = new Set(selecao.selecionados)
    if (atual.has(id)) atual.delete(id)
    else atual.add(id)
    selecao.aoMudar([...atual])
  }

  function alternarOrdem(chave: string) {
    setOrdem((atual) =>
      atual?.chave === chave
        ? { chave, direcao: atual.direcao === 'asc' ? 'desc' : 'asc' }
        : { chave, direcao: 'asc' },
    )
  }

  if (itens.length === 0 && vazio) {
    return (
      <>
        <p className="so-leitor" role="status" aria-live="polite">
          Nenhum resultado.
        </p>
        <EstadoVazio titulo={vazio.titulo} texto={vazio.texto} acao={vazio.acao} />
      </>
    )
  }

  return (
    <div className="pilha g3">
      <p className="texto-atenuado" id={idContagem} role="status" aria-live="polite">
        {itens.length === 1 ? '1 registro' : `${itens.length.toLocaleString('pt-BR')} registros`}
        {tamanho > 0 && totalPaginas > 1 && ` · página ${paginaSegura + 1} de ${totalPaginas}`}
      </p>

      <Rolagem rotulo={legenda}>
        <table>
          <caption className="so-leitor">{legenda}</caption>
          <thead>
            <tr>
              {selecao && (
                <th scope="col" className="col-selecao">
                  <input
                    ref={cabecaRef}
                    type="checkbox"
                    checked={todosMarcados}
                    disabled={selecionaveis.length === 0}
                    onChange={alternarTodos}
                    aria-label={
                      todosMarcados
                        ? `Desmarcar os ${selecionaveis.length} desta página`
                        : `Selecionar os ${selecionaveis.length} desta página`
                    }
                  />
                </th>
              )}
              {colunas.map((c) => {
                const ativa = ordem?.chave === c.chave
                const ariaSort = !c.ordenarPor
                  ? undefined
                  : ativa
                    ? ordem!.direcao === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                return (
                  <th
                    key={c.chave}
                    scope="col"
                    className={c.numerico ? 'numerico' : undefined}
                    aria-sort={ariaSort}
                    data-mobile={c.ocultarEmMobile ? 'oculto' : undefined}
                  >
                    {c.ordenarPor ? (
                      <button className="ordenar" onClick={() => alternarOrdem(c.chave)}>
                        {c.titulo}
                        <span className="ordenar__seta" aria-hidden="true">
                          {ativa ? (ordem!.direcao === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    ) : (
                      c.titulo
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visiveis.map((item) => {
              const id = chaveDe(item)
              const impedimento = selecao?.impedimentoDe?.(item)
              const marcado = selecao?.selecionados.has(id) ?? false
              return (
              <tr
                key={id}
                className={marcado ? 'linha--selecionada' : undefined}
                onClick={aoClicarLinha ? () => aoClicarLinha(item) : undefined}
                style={aoClicarLinha ? { cursor: 'pointer' } : undefined}
              >
                {selecao && (
                  <td className="col-selecao">
                    <input
                      type="checkbox"
                      checked={marcado}
                      disabled={!!impedimento}
                      title={impedimento}
                      onChange={() => alternarUm(id)}
                      /* O clique na caixa não deve disparar o clique da linha:
                         marcar para um lote e navegar para fora são opostos. */
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Selecionar ${selecao.rotuloDe(item)}${impedimento ? ` — ${impedimento}` : ''}`}
                    />
                  </td>
                )}
                {colunas.map((c) =>
                  c.identificadora ? (
                    <th
                      key={c.chave}
                      scope="row"
                      className="peso-dado"
                      data-mobile={c.ocultarEmMobile ? 'oculto' : undefined}
                    >
                      {c.celula(item)}
                    </th>
                  ) : (
                    <td
                      key={c.chave}
                      className={c.numerico ? 'numerico' : undefined}
                      data-mobile={c.ocultarEmMobile ? 'oculto' : undefined}
                    >
                      {c.celula(item)}
                    </td>
                  ),
                )}
              </tr>
              )
            })}
          </tbody>
        </table>
      </Rolagem>

      {/*
        O rodapé aparece sempre que há paginação, mesmo numa página só
        (Anexo Y §Y.3.9).

        Antes ele só existia com mais de uma página, e o cabeçalho anunciava
        "página 1 de 18" com os controles fora da área visível — a paginação
        era declarada e não oferecida. Com o rodapé constante, o lugar dos
        controles é o mesmo em toda lista, e "Exibindo 1–25 de 438" fica onde
        a leitura da tabela termina.
      */}
      {tamanho > 0 && (
        <div className="paginacao">
          <span>
            Exibindo{' '}
            <b className="dado">
              {paginaSegura * tamanho + 1}–{Math.min((paginaSegura + 1) * tamanho, ordenados.length)}
            </b>{' '}
            de <b className="dado">{ordenados.length.toLocaleString('pt-BR')}</b>
            {selecao && marcados > 0 && (
              <>
                {' · '}
                <b className="dado">{marcados}</b> selecionado{marcados === 1 ? '' : 's'} nesta página
              </>
            )}
          </span>
          <div className="linha g2 paginacao__controles">
            <label className="paginacao__tamanho">
              <span className="texto-atenuado">Por página</span>
              <select
                value={tamanho}
                onChange={(e) => {
                  setTamanho(Number(e.target.value))
                  setPagina(0)
                }}
              >
                {TAMANHOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn--pequeno"
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={paginaSegura === 0}
            >
              Anterior
            </button>
            <span className="paginacao__posicao">
              Página <b className="dado">{paginaSegura + 1}</b> de <b className="dado">{totalPaginas}</b>
            </span>
            <button
              className="btn btn--pequeno"
              onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))}
              disabled={paginaSegura >= totalPaginas - 1}
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
