import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../dados/api'
import { linhasParque } from '../dados/consultas'
import type { LinhaParque } from '../dados/consultas'
import { CATEGORIAS, filialPorId } from '../dados/catalogo'
import { useConsulta } from '../lib/useConsulta'
import { useSessao } from '../lib/contexto'
import { inteiro, percentual } from '../lib/formato'
import { Botao, Carregando, Cartao, Chip, Entrada, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'
import type { EquipamentoStatus } from '../dados/tipos'

/** Rótulo e severidade de cada estado — dicionário único, usado em toda a tela. */
const ESTADO: Record<EquipamentoStatus, { rotulo: string; sev: 'disponivel' | 'uso' | 'atencao' | 'critico' | 'inativo' }> = {
  DISPONIVEL: { rotulo: 'Disponível', sev: 'disponivel' },
  RESERVADO: { rotulo: 'Reservado', sev: 'uso' },
  EM_TRANSITO_ENTREGA: { rotulo: 'Em rota de instalação', sev: 'atencao' },
  LOCADO: { rotulo: 'Instalado no cliente', sev: 'uso' },
  EM_TRANSITO_RETORNO: { rotulo: 'Em rota de retirada', sev: 'atencao' },
  EM_INSPECAO: { rotulo: 'Em inspeção', sev: 'atencao' },
  EM_MANUTENCAO: { rotulo: 'Em manutenção', sev: 'atencao' },
  BLOQUEADO: { rotulo: 'Bloqueado', sev: 'critico' },
  EXTRAVIADO: { rotulo: 'Extraviado', sev: 'critico' },
  BAIXADO: { rotulo: 'Baixado', sev: 'inativo' },
}

/**
 * Parque instalado.
 *
 * O filtro vive na URL: a visão é compartilhável por link, e os cartões do
 * painel do dia chegam aqui já filtrados em vez de exigir refiltragem manual.
 */
export function Parque() {
  const [params, setParams] = useSearchParams()
  const { filialId } = useSessao()
  const { situacao, dado } = useConsulta(() => api.equipamentos(), [])
  const [texto, setTexto] = useState(params.get('q') ?? '')

  const estado = params.get('estado') ?? ''
  const categoria = params.get('categoria') ?? ''
  const familia = params.get('familia') ?? ''
  // Filtro pelo sinalizador de bloqueio, independente do estado operacional:
  // um ativo instalado no cliente pode estar bloqueado para nova alocação.
  const soBloqueados = params.get('bloqueado') === '1'

  function definir(chave: string, valor: string) {
    const p = new URLSearchParams(params)
    if (valor) p.set(chave, valor)
    else p.delete(chave)
    setParams(p, { replace: true })
  }

  const linhas = useMemo(() => (dado ? linhasParque() : []), [dado])

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return linhas.filter((l) => {
      const e = l.equipamento
      if (soBloqueados && !e.bloqueado) return false
      if (estado && e.status !== estado) return false
      if (categoria && e.categoria !== categoria) return false
      if (familia && l.familia !== familia) return false
      if (filialId !== 'todas' && e.filialId !== filialId) return false
      if (t) {
        const alvo = `${e.patrimonio} ${e.numeroSerie} ${l.modelo} ${l.clienteNome ?? ''}`.toLowerCase()
        if (!alvo.includes(t)) return false
      }
      return true
    })
  }, [linhas, estado, categoria, familia, texto, filialId, soBloqueados])

  const colunas: Coluna<LinhaParque>[] = [
    {
      chave: 'patrimonio',
      titulo: 'Patrimônio',
      identificadora: true,
      ordenarPor: (l) => l.equipamento.patrimonio,
      celula: (l) => (
        <>
          <span className="dado">{l.equipamento.patrimonio}</span>
          <br />
          <span className="texto-atenuado dado">{l.equipamento.numeroSerie}</span>
        </>
      ),
    },
    {
      chave: 'modelo',
      titulo: 'Modelo',
      ordenarPor: (l) => l.modelo,
      celula: (l) => (
        <>
          {l.modelo}
          <br />
          <span className="texto-atenuado">{l.categoriaNome}</span>
        </>
      ),
    },
    {
      chave: 'estado',
      titulo: 'Estado',
      ordenarPor: (l) => ESTADO[l.equipamento.status].rotulo,
      celula: (l) => (
        <Chip severidade={l.equipamento.bloqueado ? 'critico' : ESTADO[l.equipamento.status].sev}>
          {l.equipamento.bloqueado ? 'Bloqueado' : ESTADO[l.equipamento.status].rotulo}
        </Chip>
      ),
    },
    {
      chave: 'cliente',
      titulo: 'Cliente e local',
      ordenarPor: (l) => l.clienteNome ?? 'zzz',
      ocultarEmMobile: true,
      celula: (l) =>
        l.clienteNome ? (
          <>
            {l.clienteNome}
            <br />
            <span className="texto-atenuado">{l.regiaoNome}</span>
          </>
        ) : (
          <span className="texto-atenuado">{filialPorId.get(l.equipamento.filialId)?.nome ?? '—'}</span>
        ),
    },
    {
      chave: 'consumo',
      titulo: 'Páginas no mês',
      numerico: true,
      ordenarPor: (l) => l.consumoMes,
      ocultarEmMobile: true,
      celula: (l) =>
        l.consumoMes > 0 ? <span className="dado">{inteiro(l.consumoMes)}</span> : <span className="texto-atenuado">—</span>,
    },
    {
      chave: 'margem',
      titulo: 'Margem 12 m',
      numerico: true,
      ordenarPor: (l) => l.margemPercentual,
      celula: (l) => (
        <span className="dado" style={{ color: l.margem < 0 ? 'var(--cor-critico)' : undefined }}>
          {percentual(l.margemPercentual)}
        </span>
      ),
    },
  ]

  const fichas = [
    soBloqueados && { chave: 'bloqueado', texto: 'Bloqueados para alocação' },
    estado && { chave: 'estado', texto: `Estado: ${ESTADO[estado as EquipamentoStatus]?.rotulo ?? estado}` },
    categoria && { chave: 'categoria', texto: `Categoria: ${CATEGORIAS.find((c) => c.codigo === categoria)?.nome}` },
    familia && { chave: 'familia', texto: `Família: ${familia === 'IMPRESSAO' ? 'Impressão' : familia === 'COMPUTACAO' ? 'Computação' : 'Contingência'}` },
  ].filter(Boolean) as { chave: string; texto: string }[]

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Parque instalado</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            O estado do equipamento é a projeção da última movimentação registrada — não um campo editável.
          </p>
        </div>
      </div>

      <Cartao>
        <div className="filtros">
          <div style={{ minWidth: 220 }}>
            <Entrada
              rotulo="Patrimônio, série, modelo ou cliente"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="ex.: 10042 ou Farmax"
            />
          </div>
          <Selecao
            rotulo="Família"
            value={familia}
            onChange={(e) => definir('familia', e.target.value)}
            opcoes={[
              { valor: '', texto: 'Todas' },
              { valor: 'IMPRESSAO', texto: 'Impressão' },
              { valor: 'COMPUTACAO', texto: 'Computação' },
              { valor: 'CONTINGENCIA', texto: 'Contingência' },
            ]}
          />
          <Selecao
            rotulo="Categoria"
            value={categoria}
            onChange={(e) => definir('categoria', e.target.value)}
            opcoes={[{ valor: '', texto: 'Todas' }, ...CATEGORIAS.map((c) => ({ valor: c.codigo, texto: c.nome }))]}
          />
          <Selecao
            rotulo="Estado"
            value={estado}
            onChange={(e) => definir('estado', e.target.value)}
            opcoes={[
              { valor: '', texto: 'Todos' },
              ...(Object.keys(ESTADO) as EquipamentoStatus[]).map((k) => ({ valor: k, texto: ESTADO[k].rotulo })),
            ]}
          />
        </div>

        {fichas.length > 0 && (
          <div className="fichas">
            {fichas.map((f) => (
              <button key={f.chave} className="ficha" onClick={() => definir(f.chave, '')}>
                {f.texto}
                <span className="ficha__x" aria-hidden="true">
                  ×
                </span>
                <span className="so-leitor">remover filtro</span>
              </button>
            ))}
            <button className="btn btn--sutil btn--pequeno" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Limpar todos
            </button>
          </div>
        )}

        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando parque instalado">
            <Skeleton linhas={8} altura="22px" />
          </Carregando>
        ) : (
          <Tabela
            legenda="Equipamentos do parque com estado, cliente e rentabilidade"
            colunas={colunas}
            itens={filtradas}
            chaveDe={(l) => l.equipamento.id}
            ordemInicial={{ chave: 'patrimonio', direcao: 'asc' }}
            vazio={{
              titulo: 'Nenhum equipamento com esses filtros',
              texto: 'Ajuste os critérios ou limpe os filtros para ver o parque completo.',
              acao: (
                <Botao
                  onClick={() => {
                    setTexto('')
                    setParams(new URLSearchParams(), { replace: true })
                  }}
                >
                  Limpar filtros
                </Botao>
              ),
            }}
          />
        )}
      </Cartao>
    </>
  )
}
