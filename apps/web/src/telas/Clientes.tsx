import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../dados/api'
import { linhasClientes } from '../dados/consultas'
import type { LinhaCliente } from '../dados/consultas'
import { useConsulta } from '../lib/useConsulta'
import { inteiro, moeda, moedaCompacta, percentual } from '../lib/formato'
import { Botao, Carregando, Cartao, Chip, Entrada, Metrica, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'
import { BarrasHorizontais } from '../componentes/ui/graficos'
import { useSessao } from '../lib/contexto'
import { FormCliente } from '../componentes/formularios/FormCliente'
import { FormCredito } from '../componentes/formularios/FormCredito'
import { FormContrato } from '../componentes/formularios/FormContrato'
import type { Cliente } from '../dados/tipos'

type Aberto =
  | { tipo: 'novo' }
  | { tipo: 'credito'; cliente: Cliente; emAberto: number }
  | { tipo: 'contrato'; clienteId: string }
  | null

const CREDITO = {
  LIBERADO: { rotulo: 'Liberado', sev: 'disponivel' as const },
  OBSERVACAO: { rotulo: 'Em observação', sev: 'atencao' as const },
  BLOQUEADO: { rotulo: 'Bloqueado', sev: 'critico' as const },
}

/**
 * Clientes.
 *
 * Ordenado por receita recorrente, com margem e exposição vencida na mesma
 * linha. É a visão que responde "qual cliente vale, qual dá trabalho e qual
 * está devendo" sem precisar cruzar três telas.
 */
export function Clientes() {
  const [params] = useSearchParams()
  const { situacao, dado } = useConsulta(() => api.clientes(), [])
  const [texto, setTexto] = useState(params.get('q') ?? '')
  const [recorte, setRecorte] = useState('')
  const [aberto, setAberto] = useState<Aberto>(null)
  const { pode } = useSessao()

  const linhas = useMemo(() => (dado ? linhasClientes() : []), [dado])

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return linhas.filter((l) => {
      if (recorte === 'inadimplentes' && l.vencido <= 0) return false
      if (recorte === 'bloqueados' && l.cliente.situacaoCredito !== 'BLOQUEADO') return false
      if (recorte === 'margem_baixa' && l.margemPercentual >= 0.2) return false
      if (t) {
        const alvo = `${l.cliente.nomeFantasia} ${l.cliente.razaoSocial} ${l.cliente.cnpj} ${l.cliente.segmento}`.toLowerCase()
        if (!alvo.includes(t)) return false
      }
      return true
    })
  }, [linhas, recorte, texto])

  const mrrTotal = linhas.reduce((a, l) => a + l.mrr, 0)
  const vencidoTotal = linhas.reduce((a, l) => a + l.vencido, 0)
  const topSegmentos = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const l of linhas) mapa.set(l.cliente.segmento, (mapa.get(l.cliente.segmento) ?? 0) + l.mrr)
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [linhas])

  const colunas: Coluna<LinhaCliente>[] = [
    {
      chave: 'cliente',
      titulo: 'Cliente',
      identificadora: true,
      ordenarPor: (l) => l.cliente.nomeFantasia,
      celula: (l) => (
        <>
          {l.cliente.nomeFantasia}
          <br />
          <span className="texto-atenuado dado">{l.cliente.cnpj}</span>
        </>
      ),
    },
    {
      chave: 'segmento',
      titulo: 'Segmento e região',
      ordenarPor: (l) => l.cliente.segmento,
      ocultarEmMobile: true,
      celula: (l) => (
        <>
          {l.cliente.segmento}
          <br />
          <span className="texto-atenuado">{l.regiaoNome}</span>
        </>
      ),
    },
    {
      chave: 'parque',
      titulo: 'Parque',
      numerico: true,
      ordenarPor: (l) => l.equipamentos,
      celula: (l) => (
        <>
          <span className="dado">{l.equipamentos}</span>
          <br />
          <span className="texto-atenuado">{l.contratos} contrato(s)</span>
        </>
      ),
    },
    {
      chave: 'mrr',
      titulo: 'Recorrente',
      numerico: true,
      ordenarPor: (l) => l.mrr,
      celula: (l) => <span className="dado">{moeda(l.mrr)}</span>,
    },
    {
      chave: 'paginas',
      titulo: 'Páginas no mês',
      numerico: true,
      ordenarPor: (l) => l.paginasMes,
      ocultarEmMobile: true,
      celula: (l) =>
        l.paginasMes > 0 ? <span className="dado">{inteiro(l.paginasMes)}</span> : <span className="texto-atenuado">—</span>,
    },
    {
      chave: 'margem',
      titulo: 'Margem 12 m',
      numerico: true,
      ordenarPor: (l) => l.margemPercentual,
      celula: (l) => (
        <span className="dado" style={{ color: l.margemPercentual < 0.1 ? 'var(--cor-critico)' : undefined }}>
          {percentual(l.margemPercentual)}
        </span>
      ),
    },
    {
      chave: 'credito',
      titulo: 'Crédito',
      ordenarPor: (l) => l.vencido,
      celula: (l) => (
        <>
          <Chip severidade={CREDITO[l.cliente.situacaoCredito].sev}>{CREDITO[l.cliente.situacaoCredito].rotulo}</Chip>
          {l.vencido > 0 && (
            <>
              <br />
              <span className="texto-atenuado dado">{moeda(l.vencido)} vencido</span>
            </>
          )}
        </>
      ),
    },
    {
      chave: 'acoes',
      titulo: 'Ações',
      celula: (l) => (
        <div className="linha g2 envolver">
          {pode('cliente:criar') && (
            <Botao pequeno onClick={() => setAberto({ tipo: 'credito', cliente: l.cliente, emAberto: l.aberto })}>
              Crédito<span className="so-leitor"> de {l.cliente.nomeFantasia}</span>
            </Botao>
          )}
          {pode('contrato:criar') && (
            <Botao
              pequeno
              variante="primario"
              disabled={l.cliente.situacaoCredito === 'BLOQUEADO'}
              motivoDesabilitado="Cliente com crédito bloqueado não pode contratar"
              onClick={() => setAberto({ tipo: 'contrato', clienteId: l.cliente.id })}
            >
              Contratar<span className="so-leitor"> com {l.cliente.nomeFantasia}</span>
            </Botao>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Clientes</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Receita recorrente, consumo, margem e exposição vencida na mesma linha.
          </p>
        </div>
        {pode('cliente:criar') && (
          <Botao variante="primario" glifo="＋" onClick={() => setAberto({ tipo: 'novo' })}>
            Novo cliente
          </Botao>
        )}
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica rotulo="Clientes ativos" valor={String(linhas.length)} contexto="com parque instalado" />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Recorrente da carteira" valor={moedaCompacta(mrrTotal)} contexto={moeda(mrrTotal)} />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Ticket médio"
            valor={moeda(linhas.length ? mrrTotal / linhas.length : 0)}
            contexto="recorrente por cliente"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Exposição vencida" valor={moeda(vencidoTotal)} contexto="a recuperar" />
        </Cartao>
      </div>

      <div className="grade grade--2">
        <Cartao comoRegiao titulo="Recorrente por segmento">
          <BarrasHorizontais
            titulo="Receita recorrente por segmento de cliente"
            itens={topSegmentos.map(([nome, valor]) => ({ rotulo: nome, valor }))}
            formatarValor={moedaCompacta}
          />
        </Cartao>
        <Cartao comoRegiao titulo="Concentração de carteira">
          <BarrasHorizontais
            titulo="Cinco maiores clientes por receita recorrente"
            itens={[...linhas]
              .sort((a, b) => b.mrr - a.mrr)
              .slice(0, 5)
              .map((l) => ({ rotulo: l.cliente.nomeFantasia, valor: l.mrr }))}
            formatarValor={moedaCompacta}
          />
          <p className="texto-atenuado">
            Os cinco maiores respondem por{' '}
            {percentual(
              mrrTotal > 0
                ? [...linhas].sort((a, b) => b.mrr - a.mrr).slice(0, 5).reduce((a, l) => a + l.mrr, 0) / mrrTotal
                : 0,
            )}{' '}
            do recorrente. Concentração alta é risco comercial.
          </p>
        </Cartao>
      </div>

      <Cartao>
        <div className="filtros">
          <div style={{ minWidth: 220 }}>
            <Entrada
              rotulo="Cliente, CNPJ ou segmento"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="ex.: Farmax ou Saúde"
            />
          </div>
          <Selecao
            rotulo="Recorte"
            value={recorte}
            onChange={(e) => setRecorte(e.target.value)}
            opcoes={[
              { valor: '', texto: 'Todos' },
              { valor: 'inadimplentes', texto: 'Com valor vencido' },
              { valor: 'bloqueados', texto: 'Crédito bloqueado' },
              { valor: 'margem_baixa', texto: 'Margem abaixo de 20%' },
            ]}
          />
        </div>

        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando carteira de clientes">
            <Skeleton linhas={8} altura="22px" />
          </Carregando>
        ) : (
          <Tabela
            legenda="Clientes com parque, recorrente, consumo, margem e situação de crédito"
            colunas={colunas}
            itens={filtradas}
            chaveDe={(l) => l.cliente.id}
            ordemInicial={{ chave: 'mrr', direcao: 'desc' }}
            vazio={{
              titulo: 'Nenhum cliente com esses filtros',
              acao: (
                <Botao
                  onClick={() => {
                    setTexto('')
                    setRecorte('')
                  }}
                >
                  Limpar filtros
                </Botao>
              ),
            }}
          />
        )}
      </Cartao>

      {aberto?.tipo === 'novo' && <FormCliente aoFechar={() => setAberto(null)} />}
      {aberto?.tipo === 'credito' && (
        <FormCredito cliente={aberto.cliente} emAberto={aberto.emAberto} aoFechar={() => setAberto(null)} />
      )}
      {aberto?.tipo === 'contrato' && (
        <FormContrato clienteId={aberto.clienteId} aoFechar={() => setAberto(null)} />
      )}
    </>
  )
}
