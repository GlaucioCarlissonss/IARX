import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../dados/api'
import { linhasParque } from '../dados/consultas'
import type { LinhaParque } from '../dados/consultas'
import { CATEGORIAS, filialPorId } from '../dados/catalogo'
import { useConsulta } from '../lib/useConsulta'
import { useSessao } from '../lib/contexto'
import { inteiro, percentual } from '../lib/formato'
import { Botao, Carregando, Cartao, Chip, Entrada, ErroConsulta, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { Busca, Filtros } from '../componentes/ui/filtros'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'
import { AcoesDaLinha, MenuAcoes } from '../componentes/ui/MenuAcoes'
import type { AcaoMenu } from '../componentes/ui/MenuAcoes'
import { BarraLote, ConfirmaLote, ResultadoDoLote } from '../componentes/ui/BarraLote'
import { useLote } from '../lib/useLote'
import type { Resultado } from '../dados/comandos'
import type { Equipamento, EquipamentoStatus } from '../dados/tipos'
import { FormEquipamento } from '../componentes/formularios/FormEquipamento'
import { FormBloqueio } from '../componentes/formularios/FormBloqueio'
import { FormLeitura } from '../componentes/formularios/FormLeitura'
import { FormAbrirChamado } from '../componentes/formularios/FormAbrirChamado'
import { categoriaPorCodigo } from '../dados/catalogo'

type Aberto =
  | { tipo: 'novo' }
  | { tipo: 'bloqueio'; equipamento: Equipamento }
  | { tipo: 'leitura'; equipamento: Equipamento }
  | { tipo: 'chamado'; equipamentoId: string }
  /** Baixa de um ou de muitos — o diálogo é o mesmo, e a contagem vem dos alvos. */
  | { tipo: 'baixa'; alvos: LinhaParque[] }
  | { tipo: 'bloqueio-lote'; alvos: LinhaParque[] }
  | null

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
  const { filialId, pode } = useSessao()
  const { situacao, dado, erro, recarregar } = useConsulta(() => api.equipamentos(), [])
  const [texto, setTexto] = useState(params.get('q') ?? '')
  const [aberto, setAberto] = useState<Aberto>(null)

  /*
   * A seleção mora na tela, não na tabela: é a tela que sabe o que fazer com
   * ela e quais permissões a limitam. Ids e não objetos porque a lista é
   * recalculada a cada recarga — guardar objetos manteria vivos registros já
   * substituídos pela resposta nova.
   */
  const lote = useLote(() => recarregar())
  const [motivo, setMotivo] = useState('')

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

  /*
   * Os filtros desta tela vivem na URL — o que torna um recorte compartilhável
   * por link — então limpar é esvaziar a consulta, e a contagem sai dela. A
   * busca por texto é estado local e entra na conta à parte.
   */
  const filtrosAtivos = ['estado', 'categoria', 'familia', 'bloqueado'].filter((c) =>
    params.get(c),
  ).length + (texto.trim() ? 1 : 0)

  function limparFiltros() {
    setTexto('')
    setParams(new URLSearchParams(), { replace: true })
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
    /*
     * Uma ação visível, o resto em `⋯` (Anexo Y §Y.3.3).
     *
     * A visível é "Chamado", e não "Leitura", porque leitura só existe para
     * categoria com contador: uma ação primária que desaparece em parte das
     * linhas deixa a coluna irregular e obriga o olho a procurar o botão em
     * cada linha. A que vale para toda linha é a que fica.
     */
    {
      chave: 'acoes',
      titulo: 'Ações',
      celula: (l) => {
        const eq = l.equipamento
        const temContador = categoriaPorCodigo.get(eq.categoria)?.temContador ?? false
        const baixado = eq.status === 'BAIXADO'
        const acoes: AcaoMenu[] = []

        if (pode('equipamento:movimentar') && temContador && !baixado) {
          acoes.push({
            rotulo: 'Registrar leitura',
            glifo: '◱',
            aoEscolher: () => setAberto({ tipo: 'leitura', equipamento: eq }),
          })
        }
        /*
         * Bloquear e desbloquear são permissões distintas no catálogo e rotas
         * distintas na API. A tela conferia só `equipamento:desbloquear` para
         * as duas: quem podia bloquear e não desbloquear não via botão nenhum,
         * e quem podia desbloquear via o botão de bloquear sem ter a permissão
         * — o servidor recusaria, depois de o formulário ter sido preenchido.
         */
        if (!baixado && pode(eq.bloqueado ? 'equipamento:desbloquear' : 'equipamento:bloquear')) {
          acoes.push({
            rotulo: eq.bloqueado ? 'Desbloquear' : 'Bloquear para alocação',
            glifo: eq.bloqueado ? '◯' : '⊘',
            separar: true,
            aoEscolher: () => setAberto({ tipo: 'bloqueio', equipamento: eq }),
          })
        }
        if (pode('equipamento:baixar')) {
          acoes.push({
            rotulo: 'Baixar ativo…',
            glifo: '⊗',
            perigo: true,
            separar: true,
            desabilitado: baixado,
            motivoDesabilitado: 'Ativo já baixado — a baixa é definitiva.',
            aoEscolher: () => setAberto({ tipo: 'baixa', alvos: [l] }),
          })
        }

        return (
          <AcoesDaLinha
            primaria={
              pode('os:criar') && !baixado ? (
                <Botao pequeno onClick={() => setAberto({ tipo: 'chamado', equipamentoId: eq.id })}>
                  Chamado<span className="so-leitor"> para o patrimônio {eq.patrimonio}</span>
                </Botao>
              ) : undefined
            }
          >
            <MenuAcoes rotuloAlvo={`do patrimônio ${eq.patrimonio}`} titulo={`Patrimônio ${eq.patrimonio}`} acoes={acoes} />
          </AcoesDaLinha>
        )
      },
    },
  ]

  /* --------------------------------------------------------------- lote */

  const alvos = useMemo(
    () => filtradas.filter((l) => lote.selecionados.has(l.equipamento.id)),
    [filtradas, lote.selecionados],
  )

  const rotuloDe = (l: LinhaParque) => `patrimônio ${l.equipamento.patrimonio}`

  /*
   * Sem nenhuma ação em lote autorizada, a coluna de caixas não aparece.
   *
   * Oferecer seleção a quem não pode agir sobre ela é oferecer um caminho que
   * termina em barra vazia — e ainda rouba uma coluna de largura do dado.
   */
  const podeAgirEmLote =
    pode('equipamento:bloquear') || pode('equipamento:desbloquear') || pode('equipamento:baixar')

  function rodar(
    lista: LinhaParque[],
    acao: (id: string) => Promise<Resultado<unknown>>,
    titulo: string,
    verbo: string,
  ) {
    setAberto(null)
    setMotivo('')
    void lote.rodar(
      lista.map((l) => ({ id: l.equipamento.id, rotulo: rotuloDe(l) })),
      acao,
      { titulo, verbo },
    )
  }

  const fichas = [
    soBloqueados && { chave: 'bloqueado', texto: 'Bloqueados para alocação' },
    estado && { chave: 'estado', texto: `Estado: ${ESTADO[estado as EquipamentoStatus]?.rotulo ?? estado}` },
    categoria && { chave: 'categoria', texto: `Categoria: ${CATEGORIAS.find((c) => c.codigo === categoria)?.nome}` },
    familia && { chave: 'familia', texto: `Família: ${familia === 'IMPRESSAO' ? 'Impressão' : familia === 'COMPUTACAO' ? 'Computação' : 'Contingência'}` },
  ].filter(Boolean) as { chave: string; texto: string }[]

  /*
   * Falha de carga é dita, e não disfarçada de lista vazia.
   *
   * Sem isto a tela renderizava `dado ?? []` e a tabela anunciava
   * "nenhum registro" — uma resposta errada apresentada como certa. Quem
   * lê conclui que não há o que ver e vai embora, em vez de tentar de novo.
   */
  if (situacao === 'erro') {
    return (
      <ErroConsulta titulo="Não foi possível carregar o parque" erro={erro} aoTentarNovamente={recarregar} />
    )
  }

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Parque instalado</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            O estado do equipamento é a projeção da última movimentação registrada — não um campo editável.
          </p>
        </div>
        {pode('equipamento:criar') && (
          <Botao variante="primario" glifo="＋" onClick={() => setAberto({ tipo: 'novo' })}>
            Cadastrar equipamento
          </Botao>
        )}
      </div>

      <Cartao>
        {/*
          Com seleção, a barra de lote **ocupa o lugar** da de filtros
          (Anexo Y §Y.3.4). Somar as duas cresceria a barra para duas linhas e
          empurraria a tabela para baixo a cada caixa marcada.

          O filtro não some do caminho: limpar a seleção devolve a barra, e a
          seleção pertence à página exibida, então nunca há filtro escondido
          agindo sobre registros fora da vista.
        */}
        {/* `alvos` e não `selecionados`: depois de uma recarga um id selecionado
            pode já não estar na lista filtrada, e a barra anunciaria "0". */}
        {alvos.length > 0 || lote.progresso ? (
          <BarraLote
            quantidade={alvos.length}
            substantivo={['equipamento', 'equipamentos']}
            aoLimpar={lote.limpar}
            progresso={lote.progresso}
          >
            {pode('equipamento:bloquear') && (
              <Botao pequeno onClick={() => setAberto({ tipo: 'bloqueio-lote', alvos })}>
                Bloquear
              </Botao>
            )}
            {pode('equipamento:desbloquear') && (
              <Botao
                pequeno
                onClick={() =>
                  rodar(alvos, (id) => api.desbloquearEquipamento(id), 'Desbloqueio em lote', 'desbloqueados')
                }
              >
                Desbloquear
              </Botao>
            )}
            {pode('equipamento:baixar') && (
              <Botao pequeno variante="perigo" onClick={() => setAberto({ tipo: 'baixa', alvos })}>
                Baixar ativo…
              </Botao>
            )}
          </BarraLote>
        ) : (
        <Filtros ativos={filtrosAtivos} aoLimpar={limparFiltros}>
          <div className="campo-busca">
            <Busca
              rotulo="Patrimônio, série, modelo ou cliente"
              valor={texto}
              aoMudar={setTexto}
              exemplo="ex.: 10042 ou Farmax"
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
        </Filtros>
        )}

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
            selecao={
              podeAgirEmLote
                ? {
                    selecionados: lote.selecionados,
                    aoMudar: lote.definirSelecao,
                    rotuloDe,
                    /*
                     * Ativo baixado não entra em lote: não há bloqueio nem
                     * baixa a aplicar sobre ele. Desabilitar com o motivo à
                     * vista é melhor que deixar marcar e devolver N recusas
                     * idênticas no relatório.
                     */
                    impedimentoDe: (l) =>
                      l.equipamento.status === 'BAIXADO' ? 'ativo baixado' : undefined,
                  }
                : undefined
            }
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

      {aberto?.tipo === 'novo' && <FormEquipamento aoFechar={() => setAberto(null)} />}
      {aberto?.tipo === 'bloqueio' && (
        <FormBloqueio equipamento={aberto.equipamento} aoFechar={() => setAberto(null)} />
      )}
      {aberto?.tipo === 'leitura' && (
        <FormLeitura equipamento={aberto.equipamento} aoFechar={() => setAberto(null)} />
      )}
      {aberto?.tipo === 'chamado' && (
        <FormAbrirChamado equipamentoId={aberto.equipamentoId} aoFechar={() => setAberto(null)} />
      )}

      {aberto?.tipo === 'baixa' && (
        <ConfirmaLote
          titulo={aberto.alvos.length === 1 ? 'Baixar este ativo?' : `Baixar ${aberto.alvos.length} ativos?`}
          explicacao="A baixa é definitiva: o equipamento sai do parque e não volta a ficar disponível. O servidor recusa a baixa de equipamento com item de contrato vigente ou ordem de serviço aberta — os recusados aparecem no relatório, e os demais são baixados."
          alvos={aberto.alvos.map((l) => ({
            id: l.equipamento.id,
            rotulo: `${l.equipamento.patrimonio} · ${l.modelo} · ${l.clienteNome ?? filialPorId.get(l.equipamento.filialId)?.nome ?? '—'}`,
          }))}
          rotuloConfirmar={
            aberto.alvos.length === 1 ? 'Baixar o ativo' : `Baixar ${aberto.alvos.length} ativos`
          }
          impedidoDeConfirmar={
            motivo.trim().length < 10 ? 'O motivo precisa de pelo menos 10 caracteres.' : undefined
          }
          aoFechar={() => {
            setAberto(null)
            setMotivo('')
          }}
          aoConfirmar={() => {
            const lista = aberto.alvos
            rodar(lista, (id) => api.baixarEquipamento(id, motivo), 'Baixa patrimonial', 'baixados')
          }}
        >
          <Entrada
            rotulo="Motivo da baixa"
            nome="motivo"
            dica="Fica no razão do ativo. Ex.: fim de vida útil — laudo 2026-114."
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </ConfirmaLote>
      )}

      {aberto?.tipo === 'bloqueio-lote' && (
        <ConfirmaLote
          tom="normal"
          titulo={`Bloquear ${aberto.alvos.length} equipamentos para alocação?`}
          explicacao="O bloqueio impede nova alocação e não muda o estado operacional: o que está instalado no cliente continua instalado. O motivo é o mesmo para todos os selecionados (RN-014)."
          alvos={aberto.alvos.map((l) => ({
            id: l.equipamento.id,
            rotulo: `${l.equipamento.patrimonio} · ${l.modelo}`,
          }))}
          rotuloConfirmar={`Bloquear ${aberto.alvos.length}`}
          impedidoDeConfirmar={
            motivo.trim().length < 10 ? 'O motivo precisa de pelo menos 10 caracteres.' : undefined
          }
          aoFechar={() => {
            setAberto(null)
            setMotivo('')
          }}
          aoConfirmar={() => {
            const lista = aberto.alvos
            rodar(lista, (id) => api.bloquearEquipamento(id, motivo), 'Bloqueio em lote', 'bloqueados')
          }}
        >
          <Entrada
            rotulo="Motivo do bloqueio"
            nome="motivo"
            dica="Ex.: preventiva vencida — aguardando peça."
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
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
