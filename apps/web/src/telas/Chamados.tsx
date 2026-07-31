import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../dados/api'
import { linhasChamados } from '../dados/consultas'
import type { LinhaChamado } from '../dados/consultas'
import { HOJE } from '../dados/gerar'
import { useConsulta } from '../lib/useConsulta'
import { useToast } from '../lib/contexto'
import { useSessao } from '../lib/contexto'
import { duracaoHoras, moeda, percentual, prazoRestante } from '../lib/formato'
import { Botao, Carregando, Cartao, Chip, Entrada, Metrica, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'

const STATUS_ROTULO: Record<string, { rotulo: string; sev: 'disponivel' | 'uso' | 'atencao' | 'critico' | 'inativo' }> = {
  ABERTA: { rotulo: 'Aberta', sev: 'atencao' },
  TRIAGEM: { rotulo: 'Em triagem', sev: 'atencao' },
  AGENDADA: { rotulo: 'Agendada', sev: 'uso' },
  EM_EXECUCAO: { rotulo: 'Em execução', sev: 'uso' },
  AGUARDANDO_PECA: { rotulo: 'Aguardando peça', sev: 'critico' },
  CONCLUIDA: { rotulo: 'Concluída', sev: 'disponivel' },
  VALIDADA: { rotulo: 'Validada', sev: 'disponivel' },
  CANCELADA: { rotulo: 'Cancelada', sev: 'inativo' },
}

/**
 * Chamados técnicos.
 *
 * Ordenados por risco de prazo, não por data de abertura: a pergunta do
 * supervisor é "o que estoura primeiro", e a resposta precisa estar na primeira
 * linha sem ele ter que ordenar.
 */
export function Chamados() {
  const [params] = useSearchParams()
  const { pode } = useSessao()
  const { avisar } = useToast()
  const { situacao, dado } = useConsulta(() => api.ordens(), [])
  const [texto, setTexto] = useState(params.get('q') ?? '')
  const [prioridade, setPrioridade] = useState('')
  const [status, setStatus] = useState('')

  const linhas = useMemo(() => (dado ? linhasChamados() : []), [dado])

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return linhas.filter((l) => {
      if (prioridade && l.ordem.prioridade !== prioridade) return false
      if (status && l.ordem.status !== status) return false
      if (t) {
        const alvo = `${l.ordem.numero} ${l.patrimonio} ${l.clienteNome ?? ''} ${l.ordem.sintoma}`.toLowerCase()
        if (!alvo.includes(t)) return false
      }
      return true
    })
  }, [linhas, prioridade, status, texto])

  const indicadores = api.baseSincrona().indicadores
  const estourados = linhas.filter((l) => l.estourado).length
  const emRisco = linhas.filter((l) => l.emRisco).length
  const semTecnico = linhas.filter((l) => !l.tecnicoNome).length

  const colunas: Coluna<LinhaChamado>[] = [
    {
      chave: 'numero',
      titulo: 'Chamado',
      identificadora: true,
      ordenarPor: (l) => l.ordem.numero,
      celula: (l) => (
        <>
          <span className="dado">{l.ordem.numero}</span>
          <br />
          <span className="texto-atenuado">{l.ordem.tipo.toLowerCase()}</span>
        </>
      ),
    },
    {
      chave: 'prazo',
      titulo: 'Prazo restante',
      ordenarPor: (l) => l.restanteHoras,
      celula: (l) => {
        const p = prazoRestante(l.ordem.prazoSolucaoEm, HOJE)
        return (
          <Chip severidade={p.estourado ? 'critico' : l.emRisco ? 'atencao' : 'disponivel'}>{p.texto}</Chip>
        )
      },
    },
    {
      chave: 'sintoma',
      titulo: 'Sintoma relatado',
      ordenarPor: (l) => l.ordem.sintoma,
      celula: (l) => (
        <>
          {l.ordem.sintoma}
          <br />
          <span className="texto-atenuado dado">{l.patrimonio}</span>{' '}
          <span className="texto-atenuado">{l.modelo}</span>
        </>
      ),
    },
    {
      chave: 'cliente',
      titulo: 'Cliente',
      ordenarPor: (l) => l.clienteNome ?? 'zzz',
      ocultarEmMobile: true,
      celula: (l) => l.clienteNome ?? <span className="texto-atenuado">equipamento em pátio</span>,
    },
    {
      chave: 'status',
      titulo: 'Situação',
      ordenarPor: (l) => l.ordem.status,
      celula: (l) => (
        <Chip severidade={STATUS_ROTULO[l.ordem.status].sev}>{STATUS_ROTULO[l.ordem.status].rotulo}</Chip>
      ),
    },
    {
      chave: 'tecnico',
      titulo: 'Técnico',
      ordenarPor: (l) => l.tecnicoNome ?? 'zzz',
      ocultarEmMobile: true,
      celula: (l) =>
        l.tecnicoNome ?? (
          <span className="chip chip--atencao">
            <span className="chip__glifo" aria-hidden="true">▲</span>
            não atribuído
          </span>
        ),
    },
  ]

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Chamados técnicos</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Fila ordenada por risco de prazo. O SLA conta em calendário útil e desconta pausas justificadas.
          </p>
        </div>
        {pode('os:criar') && <Botao variante="primario" glifo="＋" onClick={() => avisar({ tom: 'ok', titulo: 'Abertura de chamado', texto: 'O formulário de abertura entra na próxima onda de implementação.' })}>Abrir chamado</Botao>}
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica rotulo="Prazo estourado" valor={String(estourados)} contexto="exigem tratativa imediata" />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Em risco (< 4 h)" valor={String(emRisco)} contexto="janela crítica" />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Sem técnico" valor={String(semTecnico)} contexto="aguardando despacho" />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Cumprimento de SLA"
            valor={percentual(indicadores.slaCumprimento)}
            variacao={`${indicadores.slaCumprimento >= indicadores.slaAnterior ? '+' : '−'}${Math.abs((indicadores.slaCumprimento - indicadores.slaAnterior) * 100).toFixed(1)} p.p.`}
            tendencia={indicadores.slaCumprimento >= indicadores.slaAnterior ? 'positiva' : 'negativa'}
            contexto="meta 95%"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Tempo médio de reparo" valor={duracaoHoras(indicadores.mttrHoras)} contexto="abertura até conclusão" />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Custo de manutenção no mês" valor={moeda(indicadores.custoManutencaoMes)} contexto="mão de obra e peças" />
        </Cartao>
      </div>

      <Cartao>
        <div className="filtros">
          <div style={{ minWidth: 220 }}>
            <Entrada
              rotulo="Chamado, patrimônio, cliente ou sintoma"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="ex.: OS-4812 ou atolamento"
            />
          </div>
          <Selecao
            rotulo="Prioridade"
            value={prioridade}
            onChange={(e) => setPrioridade(e.target.value)}
            opcoes={[
              { valor: '', texto: 'Todas' },
              { valor: 'CRITICA', texto: 'Crítica' },
              { valor: 'ALTA', texto: 'Alta' },
              { valor: 'MEDIA', texto: 'Média' },
              { valor: 'BAIXA', texto: 'Baixa' },
            ]}
          />
          <Selecao
            rotulo="Situação"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            opcoes={[
              { valor: '', texto: 'Todas as abertas' },
              ...['ABERTA', 'TRIAGEM', 'AGENDADA', 'EM_EXECUCAO', 'AGUARDANDO_PECA', 'CONCLUIDA'].map((s) => ({
                valor: s,
                texto: STATUS_ROTULO[s].rotulo,
              })),
            ]}
          />
        </div>

        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando fila de chamados">
            <Skeleton linhas={8} altura="22px" />
          </Carregando>
        ) : (
          <Tabela
            legenda="Chamados técnicos em aberto, ordenados por prazo restante"
            colunas={colunas}
            itens={filtradas}
            chaveDe={(l) => l.ordem.id}
            ordemInicial={{ chave: 'prazo', direcao: 'asc' }}
            vazio={{
              titulo: 'Nenhum chamado com esses filtros',
              texto: 'A fila pode estar realmente vazia — o que é uma boa notícia.',
              acao: (
                <Botao
                  onClick={() => {
                    setTexto('')
                    setPrioridade('')
                    setStatus('')
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
