import { useEffect, useId, useMemo, useState } from 'react'
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
}

export function Tabela<T>({
  legenda,
  colunas,
  itens,
  chaveDe,
  ordemInicial,
  vazio,
  porPagina = 25,
  aoClicarLinha,
}: TabelaProps<T>) {
  const [ordem, setOrdem] = useState(ordemInicial ?? null)
  const [pagina, setPagina] = useState(0)
  const idContagem = useId()

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

  const totalPaginas = porPagina > 0 ? Math.max(1, Math.ceil(ordenados.length / porPagina)) : 1
  const paginaSegura = Math.min(pagina, totalPaginas - 1)
  const visiveis = porPagina > 0 ? ordenados.slice(paginaSegura * porPagina, (paginaSegura + 1) * porPagina) : ordenados

  // Filtro mudou: volta para a primeira página, senão o usuário vê lista vazia.
  useEffect(() => {
    setPagina(0)
  }, [itens])

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
        {porPagina > 0 && totalPaginas > 1 && ` · página ${paginaSegura + 1} de ${totalPaginas}`}
      </p>

      <Rolagem rotulo={legenda}>
        <table>
          <caption className="so-leitor">{legenda}</caption>
          <thead>
            <tr>
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
            {visiveis.map((item) => (
              <tr
                key={chaveDe(item)}
                onClick={aoClicarLinha ? () => aoClicarLinha(item) : undefined}
                style={aoClicarLinha ? { cursor: 'pointer' } : undefined}
              >
                {colunas.map((c) =>
                  c.identificadora ? (
                    <th
                      key={c.chave}
                      scope="row"
                      style={{ fontWeight: 620 }}
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
            ))}
          </tbody>
        </table>
      </Rolagem>

      {porPagina > 0 && totalPaginas > 1 && (
        <div className="paginacao">
          <span>
            Exibindo {paginaSegura * porPagina + 1}–{Math.min((paginaSegura + 1) * porPagina, ordenados.length)} de{' '}
            {ordenados.length.toLocaleString('pt-BR')}
          </span>
          <div className="linha g2">
            <button
              className="btn btn--pequeno"
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={paginaSegura === 0}
            >
              Anterior
            </button>
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
