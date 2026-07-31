import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../dados/api'
import { nomeModelo } from '../../dados/catalogo'

/**
 * Busca global e navegação rápida.
 *
 * Um só campo resolve o que antes exigia escolher a tela certa primeiro:
 * patrimônio, série, cliente, contrato e chamado, além dos comandos de
 * navegação. É o principal redutor de cliques da operação diária.
 *
 * Implementa o padrão combobox: aria-activedescendant, setas para percorrer,
 * Enter para executar, Esc para sair devolvendo o foco à origem.
 */

interface Resultado {
  id: string
  grupo: string
  titulo: string
  detalhe: string
  destino: string
}

export function PaletaComandos({ aoFechar }: { aoFechar: () => void }) {
  const [termo, setTermo] = useState('')
  const [ativo, setAtivo] = useState(0)
  const campoRef = useRef<HTMLInputElement>(null)
  const origemRef = useRef<Element | null>(null)
  const navegar = useNavigate()

  useEffect(() => {
    const ativo = document.activeElement
    // Aberta por atalho de teclado não há origem útil (o foco estava no body):
    // nesse caso o destino de retorno é o próprio botão de busca, para o usuário
    // de teclado não ser devolvido ao início do documento.
    origemRef.current =
      ativo instanceof HTMLElement && ativo !== document.body ? ativo : document.querySelector('.busca')

    campoRef.current?.focus()
    return () => {
      if (origemRef.current instanceof HTMLElement) origemRef.current.focus()
    }
  }, [])

  const base = api.baseSincrona()

  const resultados = useMemo<Resultado[]>(() => {
    const t = termo.trim().toLowerCase()

    const comandos: Resultado[] = [
      { id: 'c-inicio', grupo: 'Ir para', titulo: 'Painel do dia', detalhe: 'exceções e agenda', destino: '/' },
      { id: 'c-parque', grupo: 'Ir para', titulo: 'Parque instalado', detalhe: 'equipamentos e disponibilidade', destino: '/parque' },
      { id: 'c-contratos', grupo: 'Ir para', titulo: 'Contratos', detalhe: 'vigência e renovação', destino: '/contratos' },
      { id: 'c-clientes', grupo: 'Ir para', titulo: 'Clientes', detalhe: 'carteira e rentabilidade', destino: '/clientes' },
      { id: 'c-chamados', grupo: 'Ir para', titulo: 'Chamados', detalhe: 'fila por risco de SLA', destino: '/chamados' },
      { id: 'c-estoque', grupo: 'Ir para', titulo: 'Peças e suprimentos', detalhe: 'saldos e reposição', destino: '/estoque' },
      { id: 'c-fat', grupo: 'Ir para', titulo: 'Faturamento', detalhe: 'fechamento e faturas', destino: '/faturamento' },
      { id: 'c-res', grupo: 'Ir para', titulo: 'Resultado', detalhe: 'receita, margem e indicadores', destino: '/resultado' },
    ]

    if (!t) return comandos

    const equipamentos: Resultado[] = base.equipamentos
      .filter((e) => e.patrimonio.includes(t) || e.numeroSerie.toLowerCase().includes(t))
      .slice(0, 6)
      .map((e) => ({
        id: e.id,
        grupo: 'Equipamentos',
        titulo: `${e.patrimonio} · ${nomeModelo(e.modeloId)}`,
        detalhe: e.status.toLowerCase().replace(/_/g, ' '),
        destino: `/parque?q=${e.patrimonio}`,
      }))

    const clientes: Resultado[] = base.clientes
      .filter(
        (c) =>
          c.nomeFantasia.toLowerCase().includes(t) ||
          c.razaoSocial.toLowerCase().includes(t) ||
          c.cnpj.replace(/\D/g, '').includes(t.replace(/\D/g, '')),
      )
      .slice(0, 6)
      .map((c) => ({
        id: c.id,
        grupo: 'Clientes',
        titulo: c.nomeFantasia,
        detalhe: `${c.segmento} · ${c.cnpj}`,
        destino: `/clientes?q=${encodeURIComponent(c.nomeFantasia)}`,
      }))

    const contratos: Resultado[] = base.contratos
      .filter((c) => c.numero.toLowerCase().includes(t))
      .slice(0, 5)
      .map((c) => ({
        id: c.id,
        grupo: 'Contratos',
        titulo: c.numero,
        detalhe: c.status.toLowerCase().replace(/_/g, ' '),
        destino: `/contratos?q=${c.numero}`,
      }))

    const ordens: Resultado[] = base.ordens
      .filter((o) => o.numero.toLowerCase().includes(t))
      .slice(0, 5)
      .map((o) => ({
        id: o.id,
        grupo: 'Chamados',
        titulo: o.numero,
        detalhe: o.sintoma,
        destino: `/chamados?q=${o.numero}`,
      }))

    const comandosFiltrados = comandos.filter((c) => c.titulo.toLowerCase().includes(t))

    return [...equipamentos, ...clientes, ...contratos, ...ordens, ...comandosFiltrados]
  }, [termo, base])

  useEffect(() => {
    setAtivo(0)
  }, [termo])

  function executar(r: Resultado | undefined) {
    if (!r) return
    navegar(r.destino)
    aoFechar()
  }

  function tecla(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      aoFechar()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAtivo((a) => Math.min(resultados.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAtivo((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      executar(resultados[ativo])
    }
  }

  // Agrupa preservando a ordem de relevância dos resultados.
  const grupos: { nome: string; itens: Resultado[] }[] = []
  for (const r of resultados) {
    const ultimo = grupos[grupos.length - 1]
    if (ultimo?.nome === r.grupo) ultimo.itens.push(r)
    else grupos.push({ nome: r.grupo, itens: [r] })
  }

  const idAtivo = resultados[ativo]?.id

  return (
    <div
      className="paleta-fundo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar()
      }}
    >
      <div className="paleta" role="dialog" aria-modal="true" aria-label="Busca global e navegação rápida">
        <div className="paleta__campo">
          <span aria-hidden="true">⌕</span>
          <input
            ref={campoRef}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={tecla}
            placeholder="Patrimônio, série, cliente, CNPJ, contrato, chamado…"
            aria-label="Termo de busca"
            role="combobox"
            aria-expanded="true"
            aria-controls="paleta-lista"
            aria-activedescendant={idAtivo}
            autoComplete="off"
          />
          <kbd aria-hidden="true">Esc</kbd>
        </div>

        <div className="paleta__lista" id="paleta-lista" role="listbox" aria-label="Resultados">
          <p className="so-leitor" role="status" aria-live="polite">
            {resultados.length === 0
              ? 'Nenhum resultado'
              : `${resultados.length} ${resultados.length === 1 ? 'resultado' : 'resultados'}`}
          </p>

          {resultados.length === 0 && (
            <p className="texto-atenuado" style={{ padding: 'var(--e4)' }}>
              Nada encontrado para “{termo}”. Tente um número de patrimônio, o nome de um cliente ou o número de um
              chamado.
            </p>
          )}

          {grupos.map((g) => (
            <div key={g.nome + g.itens[0].id}>
              <p className="paleta__grupo">{g.nome}</p>
              {g.itens.map((r) => {
                const indice = resultados.indexOf(r)
                return (
                  <button
                    key={r.id}
                    id={r.id}
                    role="option"
                    aria-selected={indice === ativo}
                    data-ativo={indice === ativo}
                    className="paleta__item"
                    onMouseEnter={() => setAtivo(indice)}
                    onClick={() => executar(r)}
                  >
                    <span>{r.titulo}</span>
                    <small>{r.detalhe}</small>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
