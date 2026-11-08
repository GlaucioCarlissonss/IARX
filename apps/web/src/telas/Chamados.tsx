import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../dados/api'
import { linhasChamados } from '../dados/consultas'
import type { LinhaChamado } from '../dados/consultas'
import { HOJE } from '../dados/gerar'
import { useConsulta } from '../lib/useConsulta'
import { useSessao } from '../lib/contexto'
import { duracaoHoras, moeda, percentual, prazoRestante } from '../lib/formato'
import { Botao, Carregando, Cartao, Chip, ErroConsulta, Metrica, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { Busca, Filtros } from '../componentes/ui/filtros'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'
import { AcoesDaLinha, MenuAcoes } from '../componentes/ui/MenuAcoes'
import type { AcaoMenu } from '../componentes/ui/MenuAcoes'
import { BarraLote, ConfirmaLote, ResultadoDoLote } from '../componentes/ui/BarraLote'
import { useLote } from '../lib/useLote'
import { FormAbrirChamado } from '../componentes/formularios/FormAbrirChamado'
import { FormAtribuirTecnico } from '../componentes/formularios/FormAtribuirTecnico'
import { FormConcluirChamado } from '../componentes/formularios/FormConcluirChamado'
import type { OrdemServico } from '../dados/tipos'

/** Diálogo aberto na tela. Um por vez, por construção. */
type Aberto =
  | { tipo: 'abrir' }
  | { tipo: 'atribuir'; ordem: OrdemServico }
  | { tipo: 'concluir'; ordem: OrdemServico }
  | { tipo: 'atribuir-lote'; alvos: LinhaChamado[] }
  | null

const ENCERRADOS = ['CONCLUIDA', 'VALIDADA', 'CANCELADA']

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
  /*
   * O escritor da URL existe por causa de "limpar filtros": estas telas só
   * **liam** o parâmetro, para semear o estado local. Limpar sem limpar a
   * URL faria o filtro voltar no primeiro recarregamento — desfeito na tela
   * e intacto no endereço.
   */
  const [params, setParams] = useSearchParams()
  const { pode } = useSessao()
  const { situacao, dado, erro, recarregar } = useConsulta(() => api.ordens(), [])
  const [texto, setTexto] = useState(params.get('q') ?? '')
  const [prioridade, setPrioridade] = useState('')
  const [status, setStatus] = useState('')

  /*
   * Quantos filtros estão valendo, e como desfazê-los de uma vez.
   *
   * Sem a saída, quem estreita a lista e não acha nada desfaz um por um,
   * lembrando de cada um — e o que costuma acontecer é recarregar a página.
   */
  const filtrosAtivos = (texto.trim() ? 1 : 0) + (prioridade ? 1 : 0) + (status ? 1 : 0)

  function limparFiltros() {
    setTexto('')
    setPrioridade('')
    setStatus('')
    setParams(new URLSearchParams(), { replace: true })
  }
  const [aberto, setAberto] = useState<Aberto>(null)
  const lote = useLote(() => recarregar())
  const [tecnicoLote, setTecnicoLote] = useState('')

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

  const alvos = useMemo(
    () => filtradas.filter((l) => lote.selecionados.has(l.ordem.id)),
    [filtradas, lote.selecionados],
  )

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
    /*
     * A primária é "Concluir" — é o que fecha o chamado, e é o que a fila
     * existe para produzir. Atribuir técnico vai para o `⋯`: é frequente, mas
     * já tem a ação em lote, que é como a triagem de verdade acontece.
     */
    {
      chave: 'acoes',
      titulo: 'Ações',
      celula: (l) => {
        const encerrado = ENCERRADOS.includes(l.ordem.status)
        if (encerrado) return <span className="texto-atenuado">encerrado</span>

        const acoes: AcaoMenu[] = []
        if (pode('os:triar')) {
          acoes.push({
            rotulo: l.tecnicoNome ? 'Trocar técnico' : 'Atribuir técnico',
            glifo: '◑',
            aoEscolher: () => setAberto({ tipo: 'atribuir', ordem: l.ordem }),
          })
        }

        return (
          <AcoesDaLinha
            primaria={
              pode('os:executar') ? (
                <Botao
                  pequeno
                  variante="primario"
                  disabled={!l.ordem.tecnicoId}
                  motivoDesabilitado="Atribua um técnico antes de concluir"
                  onClick={() => setAberto({ tipo: 'concluir', ordem: l.ordem })}
                >
                  Concluir<span className="so-leitor"> chamado {l.ordem.numero}</span>
                </Botao>
              ) : undefined
            }
          >
            <MenuAcoes rotuloAlvo={`do chamado ${l.ordem.numero}`} titulo={`Chamado ${l.ordem.numero}`} acoes={acoes} />
          </AcoesDaLinha>
        )
      },
    },
  ]

  /*
   * Falha de carga é dita, e não disfarçada de lista vazia.
   *
   * Sem isto a tela renderizava `dado ?? []` e a tabela anunciava
   * "nenhum registro" — uma resposta errada apresentada como certa. Quem
   * lê conclui que não há o que ver e vai embora, em vez de tentar de novo.
   */
  if (situacao === 'erro') {
    return (
      <ErroConsulta titulo="Não foi possível carregar os chamados" erro={erro} aoTentarNovamente={recarregar} />
    )
  }

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Chamados técnicos</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Fila ordenada por risco de prazo. O SLA conta em calendário útil e desconta pausas justificadas.
          </p>
        </div>
        {pode('os:criar') && (
          <Botao variante="primario" glifo="＋" onClick={() => setAberto({ tipo: 'abrir' })}>
            Abrir chamado
          </Botao>
        )}
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
        {/* Com seleção, a barra de lote ocupa o lugar da de filtros (Anexo Y §Y.3.4). */}
        {alvos.length > 0 || lote.progresso ? (
          <BarraLote
            quantidade={alvos.length}
            substantivo={['chamado', 'chamados']}
            aoLimpar={lote.limpar}
            progresso={lote.progresso}
          >
            {pode('os:triar') && (
              <Botao pequeno onClick={() => setAberto({ tipo: 'atribuir-lote', alvos })}>
                Atribuir técnico
              </Botao>
            )}
          </BarraLote>
        ) : (
        <Filtros ativos={filtrosAtivos} aoLimpar={limparFiltros}>
          <div className="campo-busca">
            <Busca
              rotulo="Chamado, patrimônio, cliente ou sintoma"
              valor={texto}
              aoMudar={setTexto}
              exemplo="ex.: OS-4812 ou atolamento"
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
        </Filtros>
        )}

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
            selecao={
              pode('os:triar')
                ? {
                    selecionados: lote.selecionados,
                    aoMudar: lote.definirSelecao,
                    rotuloDe: (l) => `chamado ${l.ordem.numero}`,
                    /* Chamado encerrado não aceita atribuição — a regra é do
                       comando, e desabilitar aqui evita N recusas idênticas. */
                    impedimentoDe: (l) =>
                      ENCERRADOS.includes(l.ordem.status) ? 'chamado encerrado' : undefined,
                  }
                : undefined
            }
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

      {aberto?.tipo === 'abrir' && <FormAbrirChamado aoFechar={() => setAberto(null)} />}
      {aberto?.tipo === 'atribuir' && (
        <FormAtribuirTecnico ordem={aberto.ordem} aoFechar={() => setAberto(null)} />
      )}
      {aberto?.tipo === 'concluir' && (
        <FormConcluirChamado ordem={aberto.ordem} aoFechar={() => setAberto(null)} />
      )}

      {aberto?.tipo === 'atribuir-lote' && (
        <ConfirmaLote
          tom="normal"
          titulo={`Atribuir ${aberto.alvos.length} chamados a um técnico`}
          explicacao="O mesmo técnico recebe todos os selecionados. Quem não tiver a especialidade do equipamento é recusado pelo servidor, um a um — os recusados aparecem no relatório e os demais são atribuídos."
          alvos={aberto.alvos.map((l) => ({
            id: l.ordem.id,
            rotulo: `${l.ordem.numero} · ${l.patrimonio} · ${l.clienteNome ?? '—'}`,
          }))}
          rotuloConfirmar={`Atribuir ${aberto.alvos.length}`}
          impedidoDeConfirmar={tecnicoLote ? undefined : 'Escolha o técnico responsável.'}
          aoFechar={() => {
            setAberto(null)
            setTecnicoLote('')
          }}
          aoConfirmar={() => {
            const lista = aberto.alvos
            const tecnico = tecnicoLote
            setAberto(null)
            setTecnicoLote('')
            void lote.rodar(
              lista.map((l) => ({ id: l.ordem.id, rotulo: `chamado ${l.ordem.numero}` })),
              (id) => api.atribuirTecnico(id, tecnico),
              { titulo: 'Atribuição em lote', verbo: 'atribuídos' },
            )
          }}
        >
          {/*
            A lista traz todos os técnicos, com a carga ao lado — e **não**
            esconde os incompatíveis, porque a compatibilidade depende do
            equipamento de cada chamado e o lote tem vários. Quem é incompatível
            com parte da seleção é recusado só nesses, e o relatório diz quais.
          */}
          <Selecao
            rotulo="Técnico responsável"
            value={tecnicoLote}
            onChange={(e) => setTecnicoLote(e.target.value)}
            dica="A compatibilidade de especialidade é conferida chamado a chamado."
            opcoes={[
              { valor: '', texto: 'Escolha…' },
              ...api
                .baseSincrona()
                .tecnicos.slice()
                .sort((a, b) => a.cargaAtual - b.cargaAtual)
                .map((t) => ({
                  valor: t.id,
                  texto: `${t.nome} — ${t.cargaAtual} na fila · ${t.especialidades.join(', ').toLowerCase()}`,
                })),
            ]}
          />
        </ConfirmaLote>
      )}

      {lote.relatorio && (
        <ResultadoDoLote
          titulo={lote.relatorio.titulo}
          verbo={lote.relatorio.verbo}
          resultado={lote.relatorio.dados}
          aoFechar={lote.fecharRelatorio}
          aoSelecionarFalhas={lote.definirSelecao}
        />
      )}
    </>
  )
}
