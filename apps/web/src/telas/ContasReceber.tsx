import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import {
  ehPaiDeParcelasReceber,
  emAtraso,
  filaDeEmissao,
  limiteDesconto,
  limitesAlcada,
  niveisEmissao,
  nivelPendenteReceber,
  parcelasReceberDe,
  postoEmissao,
  previaFechamento,
  receitaRealizada,
  ROTULO_STATUS_RECEBER,
  saldoDoTituloReceber,
  totalBaixadoSemRecebimento,
  totalRecebido,
  valorLiquidoDe,
} from '../dados/comandos'
import { useConsulta } from '../lib/useConsulta'
import { useFormulario } from '../lib/useFormulario'
import { useSessao, useToast } from '../lib/contexto'
import { competenciaCurta, data, moeda, percentual } from '../lib/formato'
import {
  Aviso,
  Botao,
  Carregando,
  Cartao,
  Chip,
  Entrada,
  Metrica,
  Selecao,
  Skeleton,
} from '../componentes/ui/primitivos'
import type { Severidade } from '../componentes/ui/primitivos'
import { Dialogo } from '../componentes/ui/Dialogo'
import {
  AreaTexto,
  CampoMoeda,
  CampoNumero,
  Combo,
  GrupoOpcoes,
  LinhaCampos,
  ResumoErros,
} from '../componentes/ui/formulario'
import { Tabela, type Coluna } from '../componentes/ui/Tabela'
import type {
  FormaRecebimento,
  OrigemReceber,
  RateioReceber,
  RecebimentoTitulo,
  StatusReceber,
  TituloReceber,
} from '../dados/tipos'

/**
 * Contas a receber — Módulo 11.
 *
 * A decisão D-20 aparece aqui como **uma tela só**: "fatura" é um título com
 * `origem = 'CONTRATUAL'`, e o filtro de origem é o que separa a cobrança gerada
 * do contrato da lançada à mão. Uma segunda tela de faturas mostraria as mesmas
 * linhas por outro caminho, e a divergência entre as duas seria invisível.
 *
 * Três decisões de interface que valem registrar:
 *
 *  1. **`BAIXADO` nunca é somado a `RECEBIDO`.** São dois indicadores, e o da
 *     baixa diz "sem entrada de caixa". É o erro que um painel comete de graça:
 *     somar "encerrados" fecha consigo mesmo, então a receita aparece inflada
 *     exatamente onde ninguém confere.
 *  2. **O fechamento mostra o que vai acontecer antes de acontecer.** Cobrança
 *     errada, ao contrário de despesa errada, chega ao cliente.
 *  3. **O atraso é calculado**, nunca lido de um campo. É a data comparada com
 *     hoje, e por isso está certo em qualquer instante.
 */

type Aberto =
  | { tipo: 'novo' }
  | { tipo: 'detalhe'; titulo: TituloReceber }
  | { tipo: 'decidir'; titulo: TituloReceber; nivel: number }
  | { tipo: 'desconto'; titulo: TituloReceber }
  | { tipo: 'receber'; titulo: TituloReceber }
  | { tipo: 'estornar'; titulo: TituloReceber; recebimento: RecebimentoTitulo }
  | { tipo: 'baixar'; titulo: TituloReceber }
  | { tipo: 'cancelar'; titulo: TituloReceber }
  | { tipo: 'fechar' }
  | null

const SEVERIDADE: Record<StatusReceber, Severidade> = {
  PENDENTE_APROVACAO: 'atencao',
  PENDENTE: 'inativo',
  APROVADO: 'uso',
  RECEBIDO_PARCIAL: 'atencao',
  RECEBIDO: 'disponivel',
  CANCELADO: 'inativo',
  EM_DISPUTA: 'critico',
  BAIXADO: 'inativo',
}

const ROTULO_FORMA: Record<FormaRecebimento, string> = {
  TRANSFERENCIA: 'Transferência',
  BOLETO: 'Boleto',
  PIX: 'Pix',
  CHEQUE: 'Cheque',
}

const ROTULO_ORIGEM: Record<OrigemReceber, string> = {
  CONTRATUAL: 'Contratual',
  AVULSO: 'Avulso',
}

export function ContasReceber() {
  const { pode, usuario } = useSessao()
  const { avisar } = useToast()
  const { situacao, dado, recarregar } = useConsulta(() => api.titulosReceber(), [])
  const [aberto, setAberto] = useState<Aberto>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<'todos' | StatusReceber>('todos')
  const [filtroOrigem, setFiltroOrigem] = useState<'todas' | OrigemReceber>('todas')
  const [somenteFila, setSomenteFila] = useState(false)
  const [somenteAtraso, setSomenteAtraso] = useState(false)
  const [busca, setBusca] = useState('')

  const base = api.baseSincrona()
  const titulos = dado ?? []

  /*
   * O pai de um parcelamento sai da lista de cobranças, como em contas a pagar:
   * ele é relatório, e somá-lo às parcelas dobraria a expectativa de entrada.
   */
  const cobrancas = useMemo(
    () => titulos.filter((t) => !ehPaiDeParcelasReceber(base, t)),
    [titulos, base],
  )

  const fila = useMemo(() => filaDeEmissao(base, usuario.id), [base, usuario.id, titulos])
  const idsFila = useMemo(() => new Set(fila.map((t) => t.id)), [fila])

  const atrasados = cobrancas.filter((t) => emAtraso(t))
  const aReceber = cobrancas.filter((t) => t.status === 'APROVADO' || t.status === 'RECEBIDO_PARCIAL')
  const emDisputa = cobrancas.filter((t) => t.status === 'EM_DISPUTA')

  const compAtual = base.indicadores.serieReceita[base.indicadores.serieReceita.length - 1]!.competencia
  const realizada = receitaRealizada(base, compAtual)
  const baixada = totalBaixadoSemRecebimento(base)

  const visiveis = useMemo(() => {
    const alvo = somenteFila ? fila : cobrancas
    const t = busca.trim().toLowerCase()
    return alvo.filter((x) => {
      if (filtroStatus !== 'todos' && x.status !== filtroStatus) return false
      if (filtroOrigem !== 'todas' && x.origem !== filtroOrigem) return false
      if (somenteAtraso && !emAtraso(x)) return false
      if (!t) return true
      const cliente = base.clientes.find((c) => c.id === x.clienteId)?.nomeFantasia ?? ''
      return `${x.numeroTitulo} ${x.descricao} ${cliente}`.toLowerCase().includes(t)
    })
  }, [cobrancas, fila, somenteFila, somenteAtraso, filtroStatus, filtroOrigem, busca, base])

  const meuPosto = postoEmissao(base, usuario.id)
  const meuTeto = limiteDesconto(base, usuario.id)

  async function agir(fn: () => Promise<{ ok: boolean; erro?: { mensagem: string } }>, ok: string) {
    setErro(null)
    const r = await fn()
    if (r.ok) {
      recarregar()
      avisar({ tom: 'ok', titulo: ok })
    } else {
      setErro(r.erro!.mensagem)
    }
  }

  const colunas: Coluna<TituloReceber>[] = [
    {
      chave: 'numero',
      titulo: 'Nº',
      identificadora: true,
      ordenarPor: (t) => t.numeroTitulo,
      celula: (t) => (
        <span className="pilha g1">
          <span>{String(t.numeroTitulo).padStart(5, '0')}</span>
          <span className="texto-atenuado">{ROTULO_ORIGEM[t.origem]}</span>
        </span>
      ),
    },
    {
      chave: 'vencimento',
      titulo: 'Vencimento',
      ordenarPor: (t) => t.dataVencimento,
      celula: (t) => (
        <span className="pilha g1">
          <span className={emAtraso(t) ? 'valor-saida' : undefined}>{data(t.dataVencimento)}</span>
          {/* O atraso é dito por texto, não só pela cor da data: WCAG 1.4.1, e é
              o dado que quem cobra está procurando. */}
          {emAtraso(t) && (
            <span className="texto-atenuado">{diasEntre(t.dataVencimento, hojeIso())} dia(s) em atraso</span>
          )}
        </span>
      ),
    },
    {
      chave: 'cliente',
      titulo: 'Cliente e cobrança',
      celula: (t) => (
        <span className="pilha g1">
          <span>{base.clientes.find((c) => c.id === t.clienteId)?.nomeFantasia ?? '—'}</span>
          <span className="texto-atenuado">
            {t.descricao}
            {t.parcelaNumero !== null && ` · parcela ${t.parcelaNumero}/${t.parcelaTotal}`}
          </span>
        </span>
      ),
    },
    {
      chave: 'valor',
      titulo: 'Líquido',
      numerico: true,
      ordenarPor: (t) => valorLiquidoDe(t),
      celula: (t) => (
        <span className="pilha g1">
          <span>{moeda(valorLiquidoDe(t))}</span>
          {t.desconto > 0 && (
            <span className="texto-atenuado">
              desconto de {moeda(t.desconto)} sobre {moeda(t.valorOriginal)}
            </span>
          )}
          {totalRecebido(t) > 0 && saldoDoTituloReceber(t) > 0 && (
            <span className="texto-atenuado">saldo {moeda(saldoDoTituloReceber(t))}</span>
          )}
        </span>
      ),
    },
    {
      chave: 'status',
      titulo: 'Situação',
      ordenarPor: (t) => t.status,
      celula: (t) => {
        const pendente = nivelPendenteReceber(t)
        return (
          <span className="pilha g1">
            <Chip severidade={SEVERIDADE[t.status]}>{maiuscula(ROTULO_STATUS_RECEBER[t.status])}</Chip>
            {pendente && (
              <span className="texto-atenuado">
                aguarda nível {pendente.nivel} de{' '}
                {t.aprovacoes.filter((a) => a.rodada === pendente.rodada).length}
              </span>
            )}
            {/* A exceção de geração aparece na lista, não só no detalhe: um
                título em disputa que parece normal é cobrado por engano. */}
            {t.status === 'EM_DISPUTA' && t.excecaoGeracao && (
              <span className="texto-atenuado">{t.excecaoGeracao}</span>
            )}
            {t.status === 'BAIXADO' && (
              <span className="texto-atenuado">sem entrada de caixa</span>
            )}
          </span>
        )
      },
    },
    {
      chave: 'acoes',
      titulo: 'Ações',
      celula: (t) => {
        const pendente = nivelPendenteReceber(t)
        return (
          <span className="linha g2 linha--acoes">
            <Botao pequeno variante="sutil" onClick={() => setAberto({ tipo: 'detalhe', titulo: t })}>
              Detalhes<span className="so-leitor"> da cobrança {t.numeroTitulo}</span>
            </Botao>
            {idsFila.has(t.id) && pendente && pode('receber:aprovar') && (
              <Botao
                pequeno
                variante="primario"
                onClick={() => setAberto({ tipo: 'decidir', titulo: t, nivel: pendente.nivel })}
              >
                Decidir
                <span className="so-leitor">
                  {' '}
                  nível {pendente.nivel} da cobrança {t.numeroTitulo}
                </span>
              </Botao>
            )}
            {t.status === 'PENDENTE' && t.criadoPor === usuario.id && pode('receber:criar') && (
              <Botao
                pequeno
                onClick={() =>
                  agir(() => api.reenviarTituloReceber(t.id, usuario.id), 'Reenviado para aprovação')
                }
              >
                Reenviar<span className="so-leitor"> a cobrança {t.numeroTitulo}</span>
              </Botao>
            )}
            {['APROVADO', 'RECEBIDO_PARCIAL'].includes(t.status) && pode('receber:baixar') && (
              <Botao pequeno onClick={() => setAberto({ tipo: 'receber', titulo: t })}>
                Receber<span className="so-leitor"> a cobrança {t.numeroTitulo}</span>
              </Botao>
            )}
          </span>
        )
      },
    },
  ]

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Contas a receber</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Cobrança contratual e avulsa na mesma lista — "fatura" é um título de origem contratual.
            Nenhuma cobrança gerada do contrato sai sem alguém conferir.
          </p>
        </div>
        <div className="linha g2">
          {pode('competencia:fechar') && (
            <Botao onClick={() => setAberto({ tipo: 'fechar' })}>Fechar competência</Botao>
          )}
          {pode('receber:criar') && (
            <Botao variante="primario" glifo="+" onClick={() => setAberto({ tipo: 'novo' })}>
              Cobrança avulsa
            </Botao>
          )}
        </div>
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica
            rotulo="Em atraso"
            valor={moeda(atrasados.reduce((s, t) => s + saldoDoTituloReceber(t), 0))}
            contexto={`${atrasados.length} cobrança(s) vencida(s)`}
            tendencia={atrasados.length > 0 ? 'negativa' : 'neutra'}
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="A receber"
            valor={moeda(aReceber.reduce((s, t) => s + saldoDoTituloReceber(t), 0))}
            contexto={`${aReceber.length} cobrança(s) aprovada(s)`}
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo={`Recebido em ${competenciaCurta(compAtual)}`}
            valor={moeda(realizada)}
            contexto="dinheiro que entrou"
          />
        </Cartao>
        {/*
          Métrica separada, e é o ponto de RN-F14.
          Somar o baixado ao recebido infla a receita realizada justamente onde
          ninguém confere: o total continua fechando com a soma dos "encerrados".
        */}
        <Cartao compacto>
          <Metrica
            rotulo="Baixado sem receber"
            valor={moeda(baixada)}
            contexto="não conta como receita"
            tendencia={baixada > 0 ? 'negativa' : 'neutra'}
          />
        </Cartao>
      </div>

      {emDisputa.length > 0 && (
        <Aviso tom="critico" titulo={`${emDisputa.length} cobrança(s) em disputa`}>
          <p>
            Geradas com o contrato fora de vigência ou com item sem política de preço. Elas existem, mas
            não são cobradas — corrija a origem e reemita.
          </p>
        </Aviso>
      )}

      {fila.length > 0 && !somenteFila && (
        <Aviso tom="atencao" titulo={`${fila.length} cobrança(s) esperam a sua aprovação`}>
          <p>
            A fila mostra só o que está no nível que você pode decidir e que não foi gerado por você.
          </p>
          <p style={{ marginTop: 'var(--e2)' }}>
            <Botao pequeno onClick={() => setSomenteFila(true)}>
              Ver a minha fila
            </Botao>
          </p>
        </Aviso>
      )}

      {erro && (
        <Aviso tom="critico" titulo="Não foi possível concluir">
          {erro}
        </Aviso>
      )}

      <Cartao
        titulo={somenteFila ? `Minha fila de aprovação (${visiveis.length})` : `Cobranças (${visiveis.length})`}
        acessorio={
          somenteFila ? (
            <Botao pequeno variante="sutil" onClick={() => setSomenteFila(false)}>
              Ver todas as cobranças
            </Botao>
          ) : null
        }
      >
        <div className="filtros">
          <Entrada
            rotulo="Buscar por número, cliente ou descrição"
            rotuloOculto
            placeholder="Buscar cobrança…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <Selecao
            rotulo="Situação"
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value as 'todos' | StatusReceber)}
            opcoes={[
              { valor: 'todos', texto: 'Todas as situações' },
              ...(Object.keys(ROTULO_STATUS_RECEBER) as StatusReceber[]).map((s) => ({
                valor: s,
                texto: maiuscula(ROTULO_STATUS_RECEBER[s]),
              })),
            ]}
          />
          <Selecao
            rotulo="Origem"
            value={filtroOrigem}
            onChange={(e) => setFiltroOrigem(e.target.value as 'todas' | OrigemReceber)}
            opcoes={[
              { valor: 'todas', texto: 'Contratual e avulso' },
              { valor: 'CONTRATUAL', texto: 'Contratual (gerada do contrato)' },
              { valor: 'AVULSO', texto: 'Avulso (lançada à mão)' },
            ]}
          />
          <label className="alternador">
            <input
              type="checkbox"
              checked={somenteAtraso}
              onChange={(e) => setSomenteAtraso(e.target.checked)}
            />
            Só as vencidas em aberto
          </label>
        </div>

        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando cobranças">
            <Skeleton linhas={8} altura="24px" />
          </Carregando>
        ) : (
          <Tabela
            legenda={somenteFila ? 'Minha fila de aprovação de cobrança' : 'Cobranças a receber'}
            colunas={colunas}
            itens={visiveis}
            chaveDe={(t) => t.id}
            ordemInicial={{ chave: 'vencimento', direcao: 'asc' }}
            vazio={{
              titulo: somenteFila ? 'Nada esperando a sua aprovação' : 'Nenhuma cobrança com estes filtros',
              texto: somenteFila
                ? 'A fila mostra apenas cobranças no nível que o seu posto de alçada decide, e que não foram geradas por você.'
                : 'Ajuste os filtros, feche uma competência ou lance uma cobrança avulsa.',
            }}
          />
        )}
      </Cartao>

      {aberto?.tipo === 'novo' && (
        <DialogoNovaCobranca
          aoFechar={() => setAberto(null)}
          aoSalvar={(t) => {
            setAberto(null)
            recarregar()
            avisar({
              tom: 'ok',
              titulo: `Cobrança ${String(t.numeroTitulo).padStart(5, '0')} lançada`,
              texto:
                t.status === 'PENDENTE_APROVACAO'
                  ? `Enviada para ${t.aprovacoes.length} nível(is) de aprovação.`
                  : 'Nenhuma faixa de alçada exige aprovação para este valor.',
            })
          }}
        />
      )}

      {aberto?.tipo === 'fechar' && (
        <DialogoFechamento
          aoFechar={() => setAberto(null)}
          aoConcluir={(r) => {
            setAberto(null)
            recarregar()
            avisar({
              tom: r.emDisputa > 0 ? 'atencao' : 'ok',
              titulo: `${r.titulosCriados} cobrança(s) geradas em ${competenciaCurta(r.competencia)}`,
              texto:
                r.emDisputa > 0
                  ? `${r.emDisputa} nasceram em disputa e não serão cobradas até a origem ser corrigida.`
                  : 'Todas seguiram para aprovação.',
            })
          }}
        />
      )}

      {aberto?.tipo === 'detalhe' && (
        <DialogoDetalhe
          titulo={cobrancas.find((t) => t.id === aberto.titulo.id) ?? aberto.titulo}
          aoFechar={() => setAberto(null)}
          aoDesconto={(t) => setAberto({ tipo: 'desconto', titulo: t })}
          aoBaixar={(t) => setAberto({ tipo: 'baixar', titulo: t })}
          aoCancelar={(t) => setAberto({ tipo: 'cancelar', titulo: t })}
          aoEstornar={(t, r) => setAberto({ tipo: 'estornar', titulo: t, recebimento: r })}
        />
      )}

      {aberto?.tipo === 'decidir' && (
        <DialogoDecisao
          titulo={aberto.titulo}
          nivel={aberto.nivel}
          aoFechar={() => setAberto(null)}
          aoDecidir={(decisao) => {
            setAberto(null)
            recarregar()
            avisar({
              tom: decisao === 'APROVADO' ? 'ok' : 'atencao',
              titulo: decisao === 'APROVADO' ? 'Nível aprovado' : 'Cobrança rejeitada',
              texto:
                decisao === 'APROVADO'
                  ? undefined
                  : 'Voltou para pendente. Quem lançou corrige e reenvia.',
            })
          }}
        />
      )}

      {aberto?.tipo === 'desconto' && (
        <DialogoDesconto
          titulo={aberto.titulo}
          teto={meuTeto}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({ tom: 'ok', titulo: 'Desconto aplicado' })
          }}
        />
      )}

      {aberto?.tipo === 'receber' && (
        <DialogoRecebimento
          titulo={aberto.titulo}
          aoFechar={() => setAberto(null)}
          aoSalvar={(t) => {
            setAberto(null)
            recarregar()
            avisar({
              tom: 'ok',
              titulo: t.status === 'RECEBIDO' ? 'Cobrança quitada' : 'Recebimento parcial registrado',
              texto: 'A entrada foi lançada na conta no mesmo ato.',
            })
          }}
        />
      )}

      {aberto?.tipo === 'estornar' && (
        <DialogoEstorno
          titulo={aberto.titulo}
          recebimento={aberto.recebimento}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({
              tom: 'ok',
              titulo: 'Recebimento estornado',
              texto: 'O valor saiu da conta e a cobrança reabriu.',
            })
          }}
        />
      )}

      {aberto?.tipo === 'baixar' && (
        <DialogoBaixa
          titulo={aberto.titulo}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({
              tom: 'atencao',
              titulo: 'Cobrança baixada sem recebimento',
              texto: 'Ela sai da fila de cobrança e não entra na receita realizada.',
            })
          }}
        />
      )}

      {aberto?.tipo === 'cancelar' && (
        <DialogoCancelamento
          titulo={aberto.titulo}
          parcelas={parcelasReceberDe(base, aberto.titulo.id).length}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({ tom: 'ok', titulo: 'Cobrança cancelada' })
          }}
        />
      )}

      {meuPosto === 0 && pode('receber:aprovar') && (
        <p className="texto-atenuado" role="status">
          O seu perfil tem permissão de aprovar cobrança, mas nenhuma faixa de alçada de emissão
          cadastrada — então nada aparece na sua fila. Alçada e permissão são coisas diferentes: uma diz
          que você pode operar a tela, a outra diz até quanto.
        </p>
      )}
    </>
  )
}

/* ---------------------------------------------------- cobrança avulsa */

function DialogoNovaCobranca({
  aoFechar,
  aoSalvar,
}: {
  aoFechar: () => void
  aoSalvar: (t: TituloReceber) => void
}) {
  const { usuario } = useSessao()
  const base = api.baseSincrona()
  const hoje = hojeIso()
  const [rateio, setRateio] = useState<RateioReceber[]>([])

  const form = useFormulario({
    inicial: {
      clienteId: base.clientes[0]?.id ?? '',
      descricao: '',
      valorOriginal: 0,
      dataEmissao: hoje,
      dataVencimento: hoje,
      parcelas: 1,
    },
    validar: (v) => ({
      clienteId: !v.clienteId ? 'Escolha o cliente.' : undefined,
      descricao: v.descricao.trim().length < 3 ? 'Descreva a cobrança — o cliente lê isto.' : undefined,
      valorOriginal: v.valorOriginal <= 0 ? 'Informe o valor.' : undefined,
      dataVencimento:
        v.dataVencimento < v.dataEmissao ? 'O vencimento não pode ser anterior à emissão.' : undefined,
    }),
    aoEnviar: (v) =>
      api.criarTituloAvulso(usuario.id, {
        clienteId: v.clienteId,
        descricao: v.descricao,
        valorOriginal: v.valorOriginal,
        dataEmissao: v.dataEmissao,
        dataVencimento: v.dataVencimento,
        parcelas: v.parcelas,
        rateio,
      }),
    aoConcluir: aoSalvar,
  })

  const valor = form.valores.valorOriginal
  const niveis = niveisEmissao(base, valor)
  const limites = limitesAlcada(base, 'EMISSAO_FATURA')
  const somaRateio = arredondar(rateio.reduce((s, r) => s + r.percentual, 0))
  const centrosAtivos = base.centrosCusto.filter((c) => c.ativo)

  function acrescentarLinha() {
    const usados = new Set(rateio.map((r) => r.centroCustoId))
    const livre = centrosAtivos.find((c) => !usados.has(c.id))
    if (!livre) return
    setRateio([...rateio, { centroCustoId: livre.id, percentual: Math.max(0, arredondar(100 - somaRateio)) }])
  }

  return (
    <Dialogo
      titulo="Nova cobrança avulsa"
      descricao="Fora de contrato: serviço, projeto, reposição. A cobrança contratual nasce do fechamento de competência."
      largura="largo"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Lançando…' : 'Lançar cobrança'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{
            clienteId: 'Cliente',
            descricao: 'Descrição',
            valorOriginal: 'Valor',
            dataVencimento: 'Vencimento',
          }}
          refResumo={form.refResumo}
        />

        <div className="pilha g3">
          <Combo
            rotulo="Cliente"
            nome="clienteId"
            opcoes={base.clientes.map((c) => ({
              valor: c.id,
              texto: c.nomeFantasia,
              detalhe: c.razaoSocial,
            }))}
            valor={form.valores.clienteId}
            aoMudar={(v) => form.definir('clienteId', v)}
            {...form.campo('clienteId')}
          />

          <Entrada
            rotulo="Descrição"
            nome="descricao"
            dica="Aparece na cobrança e na fila de quem aprova."
            value={form.valores.descricao}
            onChange={(e) => form.definir('descricao', e.target.value)}
            {...form.campo('descricao')}
          />

          <LinhaCampos>
            <CampoMoeda
              rotulo="Valor"
              nome="valorOriginal"
              valor={form.valores.valorOriginal}
              aoMudar={(v) => form.definir('valorOriginal', v)}
              {...form.campo('valorOriginal')}
            />
            <CampoNumero
              rotulo="Parcelas"
              nome="parcelas"
              min={1}
              max={120}
              sufixo="mensais"
              dica="Acima de 1, o valor é o total e as parcelas são geradas."
              valor={form.valores.parcelas}
              aoMudar={(v) => form.definir('parcelas', v)}
              {...form.campo('parcelas')}
            />
          </LinhaCampos>

          {/* Prévia da alçada de emissão. `role="status"` porque o número muda
              enquanto se digita, e quem usa leitor de tela precisa ser avisado
              sem o foco sair do campo de valor. */}
          <div className="previa-alcada" role="status">
            {valor <= 0 ? (
              <p className="texto-atenuado">Informe o valor para ver quantas aprovações ele exige.</p>
            ) : niveis === 0 ? (
              <p>
                <strong>Nenhuma aprovação necessária.</strong>{' '}
                {limites.length === 0
                  ? 'Não há faixa de alçada de emissão cadastrada.'
                  : `O valor está abaixo da primeira faixa (${moeda(limites[0]!)}).`}
              </p>
            ) : (
              <p>
                <strong>
                  {niveis} nível(is) de aprovação para {moeda(valor)}
                </strong>{' '}
                — faixas cadastradas: {limites.map((l) => moeda(l)).join(' · ')}.
              </p>
            )}
            {/* A distinção que a tela precisa dizer: zero níveis vale para o
                avulso. A cobrança contratual passa por alguém sempre. */}
            <p className="texto-atenuado">
              Isto vale para cobrança avulsa. A cobrança gerada do contrato passa por ao menos um nível
              sempre, qualquer que seja o valor — ela saiu de um cálculo que ninguém leu.
            </p>
          </div>

          <LinhaCampos>
            <Entrada
              rotulo="Emissão"
              nome="dataEmissao"
              type="date"
              value={form.valores.dataEmissao}
              onChange={(e) => form.definir('dataEmissao', e.target.value)}
            />
            <Entrada
              rotulo="Vencimento"
              nome="dataVencimento"
              type="date"
              dica={form.valores.parcelas > 1 ? 'Vencimento da primeira parcela.' : undefined}
              value={form.valores.dataVencimento}
              onChange={(e) => form.definir('dataVencimento', e.target.value)}
              {...form.campo('dataVencimento')}
            />
          </LinhaCampos>

          <fieldset className="grupo-opcoes">
            <legend>Rateio por centro de custo</legend>
            <p className="campo__dica">
              Opcional — responde "de qual área veio esta receita". Se houver rateio, ele tem de fechar
              em 100%: um rateio parcial deixaria receita sem área, e o relatório passaria a mentir sem
              avisar.
            </p>

            {rateio.length === 0 ? (
              <p className="texto-atenuado">Sem rateio: a cobrança fica sem dimensão de análise por área.</p>
            ) : (
              <ul className="lista-rateio">
                {rateio.map((r, i) => (
                  <li key={`${r.centroCustoId}-${i}`} className="lista-rateio__linha">
                    <Selecao
                      rotulo={`Centro de custo da linha ${i + 1}`}
                      rotuloOculto
                      value={r.centroCustoId}
                      onChange={(e) =>
                        setRateio(rateio.map((x, j) => (j === i ? { ...x, centroCustoId: e.target.value } : x)))
                      }
                      opcoes={centrosAtivos.map((c) => ({ valor: c.id, texto: `${c.codigo} — ${c.nome}` }))}
                    />
                    <CampoNumero
                      rotulo={`Percentual da linha ${i + 1}`}
                      valor={r.percentual}
                      min={0}
                      max={100}
                      sufixo="%"
                      aoMudar={(v) => setRateio(rateio.map((x, j) => (j === i ? { ...x, percentual: v } : x)))}
                    />
                    <Botao pequeno variante="sutil" onClick={() => setRateio(rateio.filter((_, j) => j !== i))}>
                      Remover<span className="so-leitor"> a linha {i + 1} do rateio</span>
                    </Botao>
                  </li>
                ))}
              </ul>
            )}

            <div className="linha entre g2" style={{ marginTop: 'var(--e2)' }}>
              <Botao
                pequeno
                onClick={acrescentarLinha}
                disabled={rateio.length >= centrosAtivos.length}
                motivoDesabilitado="Todos os centros ativos já estão no rateio"
              >
                Acrescentar centro
              </Botao>
              {rateio.length > 0 && (
                <span
                  className={Math.abs(somaRateio - 100) <= 0.005 ? 'texto-atenuado' : 'valor-saida'}
                  role="status"
                >
                  Soma: {percentual(somaRateio / 100)}
                  {Math.abs(somaRateio - 100) > 0.005 && ' — tem de fechar em 100%'}
                </span>
              )}
            </div>
          </fieldset>
        </div>
      </form>
    </Dialogo>
  )
}

/* -------------------------------------------- fechamento de competência */

/**
 * Fechar a competência.
 *
 * A prévia é o motivo de este diálogo existir em vez de um botão que age direto:
 * ela responde "isto vai gerar 12 cobranças, 2 delas em disputa" **antes** de
 * confirmar. Uma cobrança errada, ao contrário de uma despesa errada, chega ao
 * cliente — e o custo dela é a relação comercial.
 */
function DialogoFechamento({
  aoFechar,
  aoConcluir,
}: {
  aoFechar: () => void
  aoConcluir: (r: {
    competencia: string
    titulosCriados: number
    emDisputa: number
    jaExistiam: number
  }) => void
}) {
  const { usuario } = useSessao()
  const base = api.baseSincrona()
  const abertas = base.competencias_fechamento.filter((c) => c.fechadoEm === null)
  const [competencia, setCompetencia] = useState(abertas[0]?.competencia ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const previa = useMemo(
    () => (competencia ? previaFechamento(base, competencia) : null),
    [base, competencia],
  )

  async function confirmar() {
    setErro(null)
    setEnviando(true)
    try {
      const r = await api.fecharCompetencia(competencia, usuario.id)
      if (r.ok) aoConcluir(r.valor)
      else setErro(r.erro.mensagem)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo
      titulo="Fechar competência"
      descricao="Sela a medição do mês e gera as cobranças contratuais, num ato só."
      largura="largo"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="primario"
            onClick={confirmar}
            disabled={enviando || !competencia || (previa?.titulosAGerar ?? 0) === 0}
            motivoDesabilitado={
              !competencia
                ? 'Nenhuma competência aberta'
                : 'Nada a gerar nesta competência'
            }
          >
            {enviando ? 'Fechando…' : `Fechar e gerar ${previa?.titulosAGerar ?? 0} cobrança(s)`}
          </Botao>
        </>
      }
    >
      <div className="pilha g3">
        {abertas.length === 0 ? (
          <Aviso tom="ok" titulo="Nenhuma competência aberta">
            Todas as competências com medição já foram seladas. Um refechamento não duplicaria cobrança
            — a chave de contrato e competência impede —, mas também não mudaria nada.
          </Aviso>
        ) : (
          <>
            <Selecao
              rotulo="Competência"
              nome="competencia"
              dica="Só aparecem as que ainda não foram seladas."
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              opcoes={abertas.map((c) => ({
                valor: c.competencia,
                texto: competenciaCurta(c.competencia),
              }))}
            />

            <Aviso tom="atencao" titulo="Selar é definitivo para a base do cálculo">
              Depois de fechada, a medição da competência não muda — é o que garante que o valor cobrado
              não se altera depois da cobrança. Corrija leituras antes de fechar.
            </Aviso>

            {previa && (
              <div className="previa-alcada" role="status">
                <p>
                  <strong>{previa.titulosAGerar} cobrança(s)</strong> a gerar, somando{' '}
                  <strong>{moeda(previa.valorTotal)}</strong>, sobre {previa.contratos} contrato(s) com
                  medição.
                </p>
                {previa.jaExistentes > 0 && (
                  <p className="texto-atenuado">
                    {previa.jaExistentes} contrato(s) já têm cobrança nesta competência e serão
                    ignorados — reprocessar não duplica.
                  </p>
                )}
                {previa.excecoes.length > 0 && (
                  <>
                    <p className="valor-saida" style={{ marginTop: 'var(--e2)' }}>
                      {previa.excecoes.length} nascerão <strong>em disputa</strong> e não serão cobradas:
                    </p>
                    <ul className="lista-simples">
                      {previa.excecoes.map((e) => (
                        <li key={e.contratoId}>
                          {e.contratoNumero}: {e.motivo}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {erro && (
              <Aviso tom="critico" titulo="Não foi possível fechar">
                {erro}
              </Aviso>
            )}
          </>
        )}
      </div>
    </Dialogo>
  )
}

/* ---------------------------------------------------------------- detalhe */

function DialogoDetalhe({
  titulo,
  aoFechar,
  aoDesconto,
  aoBaixar,
  aoCancelar,
  aoEstornar,
}: {
  titulo: TituloReceber
  aoFechar: () => void
  aoDesconto: (t: TituloReceber) => void
  aoBaixar: (t: TituloReceber) => void
  aoCancelar: (t: TituloReceber) => void
  aoEstornar: (t: TituloReceber, r: RecebimentoTitulo) => void
}) {
  const { pode } = useSessao()
  const base = api.baseSincrona()
  const cliente = base.clientes.find((c) => c.id === titulo.clienteId)
  const contrato = base.contratos.find((c) => c.id === titulo.contratoId)
  const rodadas = [...new Set(titulo.aprovacoes.map((a) => a.rodada))].sort((a, b) => b - a)
  const nomeDe = (id: string | null) => base.usuarios.find((u) => u.id === id)?.nome ?? '—'
  const encerrado = ['RECEBIDO', 'CANCELADO', 'BAIXADO'].includes(titulo.status)

  return (
    <Dialogo
      titulo={`Cobrança ${String(titulo.numeroTitulo).padStart(5, '0')}`}
      descricao={`${ROTULO_ORIGEM[titulo.origem]} · vence em ${data(titulo.dataVencimento)}`}
      largura="largo"
      aoFechar={aoFechar}
      acoes={
        <>
          {pode('receber:cancelar') && titulo.status !== 'CANCELADO' && (
            <Botao variante="perigo" onClick={() => aoCancelar(titulo)}>
              Cancelar cobrança
            </Botao>
          )}
          {pode('receber:negociar') &&
            ['APROVADO', 'RECEBIDO_PARCIAL', 'EM_DISPUTA'].includes(titulo.status) && (
              <Botao onClick={() => aoBaixar(titulo)}>Baixar sem receber</Botao>
            )}
          {pode('receber:negociar') && !encerrado && (
            <Botao onClick={() => aoDesconto(titulo)}>Aplicar desconto</Botao>
          )}
          <Botao variante="sutil" onClick={aoFechar}>
            Fechar
          </Botao>
        </>
      }
    >
      <div className="pilha g3">
        {titulo.status === 'EM_DISPUTA' && titulo.excecaoGeracao && (
          <Aviso tom="critico" titulo="Gerada com exceção">
            {titulo.excecaoGeracao} Corrija a origem e reemita — esta cobrança não vai ao cliente.
          </Aviso>
        )}

        {titulo.status === 'BAIXADO' && (
          <Aviso tom="atencao" titulo="Encerrada sem entrada de caixa">
            <p>{titulo.baixaMotivo}</p>
            <p className="texto-atenuado" style={{ marginTop: 'var(--e1)' }}>
              Baixado em {data(titulo.baixadoEm!)}. Este valor <strong>não</strong> conta como receita
              realizada — a receita soma recebimentos, não títulos encerrados.
            </p>
          </Aviso>
        )}

        <dl className="descricoes">
          <div>
            <dt>Cliente</dt>
            <dd>{cliente?.razaoSocial ?? '—'}</dd>
          </div>
          <div>
            <dt>Valor líquido</dt>
            <dd>
              {moeda(valorLiquidoDe(titulo))}
              {titulo.desconto > 0 && (
                <span className="texto-atenuado"> (original {moeda(titulo.valorOriginal)})</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Saldo em aberto</dt>
            <dd>{moeda(saldoDoTituloReceber(titulo))}</dd>
          </div>
          {contrato && (
            <div>
              <dt>Contrato e competência</dt>
              <dd>
                {contrato.numero}
                {titulo.competencia && ` · ${competenciaCurta(titulo.competencia)}`}
              </dd>
            </div>
          )}
          <div>
            <dt>Gerada por</dt>
            <dd>
              {nomeDe(titulo.criadoPor)} em {data(titulo.criadoEm)}
            </dd>
          </div>
          {titulo.parcelaNumero !== null && (
            <div>
              <dt>Parcela</dt>
              <dd>
                {titulo.parcelaNumero} de {titulo.parcelaTotal}
              </dd>
            </div>
          )}
        </dl>

        {titulo.desconto > 0 && (
          <Aviso tom="atencao" titulo={`Desconto de ${moeda(titulo.desconto)}`}>
            {titulo.descontoMotivo} — concedido por {nomeDe(titulo.descontoPor)}.
          </Aviso>
        )}

        <section>
          <h3>Rateio</h3>
          {titulo.rateio.length === 0 ? (
            <p className="texto-atenuado">Sem rateio — a receita não tem dimensão de análise por área.</p>
          ) : (
            <ul className="lista-simples">
              {titulo.rateio.map((r) => {
                const centro = base.centrosCusto.find((c) => c.id === r.centroCustoId)
                return (
                  <li key={r.centroCustoId}>
                    {centro ? `${centro.codigo} — ${centro.nome}` : r.centroCustoId}:{' '}
                    {percentual(r.percentual / 100)} ({moeda((valorLiquidoDe(titulo) * r.percentual) / 100)})
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <h3>Aprovação da emissão</h3>
          {titulo.aprovacoes.length === 0 ? (
            <p className="texto-atenuado">
              {titulo.status === 'EM_DISPUTA'
                ? 'Cobrança em disputa não abre rodada: não se aprova a emissão do que já se sabe estar errado.'
                : titulo.tituloPaiId
                  ? 'A aprovação é do total do parcelamento, não da parcela.'
                  : 'Nenhuma faixa de alçada exigia aprovação para este valor.'}
            </p>
          ) : (
            rodadas.map((r) => (
              <div key={r} className="pilha g1" style={{ marginBottom: 'var(--e2)' }}>
                {rodadas.length > 1 && (
                  <p className="texto-atenuado">
                    Rodada {r}
                    {r === rodadas[0] ? ' (atual)' : ' — antes da correção'}
                  </p>
                )}
                <ol className="lista-simples">
                  {titulo.aprovacoes
                    .filter((a) => a.rodada === r)
                    .sort((a, b) => a.nivel - b.nivel)
                    .map((a) => (
                      <li key={`${a.rodada}-${a.nivel}`}>
                        <span className="linha g2">
                          <strong>Nível {a.nivel}</strong>
                          <Chip
                            severidade={
                              a.decisao === 'APROVADO'
                                ? 'disponivel'
                                : a.decisao === 'REJEITADO'
                                  ? 'critico'
                                  : 'atencao'
                            }
                          >
                            {a.decisao === 'APROVADO'
                              ? 'Aprovado'
                              : a.decisao === 'REJEITADO'
                                ? 'Rejeitado'
                                : 'Aguardando'}
                          </Chip>
                          {a.decisao && (
                            <span className="texto-atenuado">
                              {nomeDe(a.aprovadorId)} em {data(a.decididoEm!)}
                              {a.delegadoDe && ` · por delegação de ${nomeDe(a.delegadoDe)}`}
                            </span>
                          )}
                        </span>
                        {a.justificativa && <p className="texto-secundario">{a.justificativa}</p>}
                      </li>
                    ))}
                </ol>
              </div>
            ))
          )}
        </section>

        <section>
          <h3>Recebimentos</h3>
          {titulo.recebimentos.length === 0 ? (
            <p className="texto-atenuado">Nenhuma entrada registrada.</p>
          ) : (
            <ul className="lista-simples">
              {titulo.recebimentos.map((r) => {
                const conta = base.contasBancarias.find((c) => c.id === r.contaId)
                return (
                  <li key={r.id}>
                    <span className="linha entre g2">
                      <span>
                        {moeda(r.valorRecebido)} em {data(r.dataRecebimento)} · {ROTULO_FORMA[r.forma]} ·{' '}
                        {conta?.apelido ?? r.contaId}
                        {r.estornadoEm && (
                          <span className="valor-saida"> · estornado em {data(r.estornadoEm)}</span>
                        )}
                      </span>
                      {!r.estornadoEm && pode('receber:baixar') && (
                        <Botao pequeno variante="sutil" onClick={() => aoEstornar(titulo, r)}>
                          Estornar<span className="so-leitor"> o recebimento de {moeda(r.valorRecebido)}</span>
                        </Botao>
                      )}
                    </span>
                    {r.estornoMotivo && <p className="texto-atenuado">Motivo: {r.estornoMotivo}</p>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </Dialogo>
  )
}

/* ---------------------------------------------------------------- decisão */

function DialogoDecisao({
  titulo,
  nivel,
  aoFechar,
  aoDecidir,
}: {
  titulo: TituloReceber
  nivel: number
  aoFechar: () => void
  aoDecidir: (decisao: 'APROVADO' | 'REJEITADO') => void
}) {
  const { usuario } = useSessao()
  const base = api.baseSincrona()
  const [decisao, setDecisao] = useState<'APROVADO' | 'REJEITADO'>('APROVADO')
  const porDelegacao = postoEmissao(base, usuario.id) < nivel

  const form = useFormulario({
    inicial: { justificativa: '' },
    validar: (v) => ({
      justificativa:
        decisao === 'REJEITADO' && v.justificativa.trim().length < 10
          ? 'A rejeição exige justificativa de ao menos 10 caracteres.'
          : undefined,
    }),
    aoEnviar: (v) =>
      api.decidirEmissao(titulo.id, nivel, usuario.id, { decisao, justificativa: v.justificativa }),
    aoConcluir: () => aoDecidir(decisao),
  })

  const restantes = titulo.aprovacoes.filter(
    (a) => a.rodada === nivelPendenteReceber(titulo)?.rodada && a.nivel > nivel,
  ).length
  /*
   * A memória de cálculo vem da **medição** da competência, e não de um campo do
   * título: é ela que sabe quais equipamentos rodaram quanto. O título sabe
   * quanto se cobra; a medição sabe por quê.
   */
  const medicao = titulo.competencia
    ? base.medicoes.find(
        (m) => m.contratoId === titulo.contratoId && m.competencia === titulo.competencia,
      )
    : undefined

  return (
    <Dialogo
      titulo={`Aprovar emissão — nível ${nivel}`}
      descricao={`Cobrança ${String(titulo.numeroTitulo).padStart(5, '0')} — ${moeda(valorLiquidoDe(titulo))}`}
      largura="largo"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            variante={decisao === 'APROVADO' ? 'primario' : 'perigo'}
            onClick={form.enviar}
            disabled={form.enviando}
          >
            {form.enviando ? 'Registrando…' : decisao === 'APROVADO' ? 'Aprovar emissão' : 'Rejeitar'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ justificativa: 'Justificativa' }}
          refResumo={form.refResumo}
        />

        <div className="pilha g3">
          {porDelegacao && (
            <Aviso tom="atencao" titulo="Você decide por delegação">
              O seu posto de alçada de emissão é inferior a este nível. A decisão fica registrada com o
              nome de quem delegou, ao lado do seu — é o que mantém a trilha verdadeira.
            </Aviso>
          )}

          <dl className="descricoes">
            <div>
              <dt>Cliente</dt>
              <dd>{base.clientes.find((c) => c.id === titulo.clienteId)?.razaoSocial ?? '—'}</dd>
            </div>
            <div>
              <dt>Vencimento</dt>
              <dd>{data(titulo.dataVencimento)}</dd>
            </div>
            <div>
              <dt>Gerada por</dt>
              <dd>{base.usuarios.find((u) => u.id === titulo.criadoPor)?.nome ?? '—'}</dd>
            </div>
            <div>
              <dt>Depois deste nível</dt>
              <dd>
                {restantes === 0
                  ? 'a cobrança fica aprovada e liberada para envio'
                  : `faltam ${restantes} nível(is)`}
              </dd>
            </div>
          </dl>

          {/*
            De onde veio o número.

            É o que distingue este diálogo de uma confirmação: quem aprova uma
            cobrança contratual precisa ver a composição, não só o total. Aprovar
            um número sem a memória de cálculo é assinar em branco.
          */}
          {medicao ? (
            <section>
              <h3>Composição do valor</h3>
              <dl className="descricoes">
                <div>
                  <dt>Competência</dt>
                  <dd>{competenciaCurta(titulo.competencia!)}</dd>
                </div>
                <div>
                  <dt>Bruto medido</dt>
                  <dd>{moeda(titulo.valorOriginal)}</dd>
                </div>
                <div>
                  <dt>Desconto</dt>
                  <dd>{titulo.desconto > 0 ? moeda(titulo.desconto) : 'nenhum'}</dd>
                </div>
                <div>
                  <dt>Itens medidos</dt>
                  <dd>{medicao.itens.length}</dd>
                </div>
              </dl>
              <ul className="lista-simples">
                {medicao.itens.slice(0, 6).map((it, i) => (
                  <li key={`${it.equipamentoPatrimonio}-${i}`}>
                    {it.equipamentoPatrimonio}: {moeda(it.valorFixo)} fixo
                    {it.excedenteMono > 0 &&
                      ` + ${it.excedenteMono} páginas excedentes (${moeda(it.valorExcedenteMono)})`}
                  </li>
                ))}
                {medicao.itens.length > 6 && (
                  <li className="texto-atenuado">e mais {medicao.itens.length - 6} item(ns)…</li>
                )}
              </ul>
            </section>
          ) : (
            <p className="texto-atenuado">
              Cobrança avulsa: o valor foi digitado por quem a lançou, não calculado.
            </p>
          )}

          <GrupoOpcoes
            legenda="Decisão"
            opcoes={[
              {
                valor: 'APROVADO',
                texto: 'Aprovar emissão',
                detalhe: 'segue para o próximo nível ou fica liberada para cobrança',
              },
              {
                valor: 'REJEITADO',
                texto: 'Rejeitar',
                detalhe: 'volta a pendente para correção e reenvio',
              },
            ]}
            valor={decisao}
            aoMudar={(v) => setDecisao(v as 'APROVADO' | 'REJEITADO')}
          />

          <AreaTexto
            rotulo="Justificativa"
            nome="justificativa"
            limite={500}
            dica={
              decisao === 'REJEITADO'
                ? 'Obrigatória: sem ela quem lançou não sabe o que corrigir e reenvia igual.'
                : 'Opcional na aprovação.'
            }
            value={form.valores.justificativa}
            onChange={(e) => form.definir('justificativa', e.target.value)}
            {...form.campo('justificativa')}
          />
        </div>
      </form>
    </Dialogo>
  )
}

/* --------------------------------------------------------------- desconto */

function DialogoDesconto({
  titulo,
  teto,
  aoFechar,
  aoSalvar,
}: {
  titulo: TituloReceber
  teto: number
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const { usuario } = useSessao()
  const form = useFormulario({
    inicial: { desconto: titulo.desconto, motivo: '' },
    validar: (v) => ({
      desconto: v.desconto <= 0 ? 'Informe o valor do desconto.' : undefined,
      motivo: v.motivo.trim().length < 5 ? 'Informe o motivo — é o que explica cobrar menos.' : undefined,
    }),
    aoEnviar: (v) => api.aplicarDesconto(titulo.id, usuario.id, v.desconto, v.motivo),
    aoConcluir: aoSalvar,
  })

  const pct = titulo.valorOriginal > 0 ? (100 * form.valores.desconto) / titulo.valorOriginal : 0
  const acima = pct > teto

  return (
    <Dialogo
      titulo="Aplicar desconto"
      descricao={`Sobre ${moeda(titulo.valorOriginal)}. A alçada de desconto é percentual.`}
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Aplicando…' : 'Aplicar desconto'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ desconto: 'Desconto', motivo: 'Motivo' }}
          refResumo={form.refResumo}
        />
        <div className="pilha g3">
          {teto === 0 ? (
            <Aviso tom="critico" titulo="Seu perfil não concede desconto">
              Não há faixa de alçada de desconto cadastrada para o seu perfil. Zero significa "não
              concede", não "concede qualquer um" — peça a quem tem alçada.
            </Aviso>
          ) : (
            <p className="texto-secundario">
              Seu teto é <strong>{percentual(teto / 100, 0)}</strong> do valor da cobrança
              {titulo.status === 'APROVADO' && (
                <>
                  {' '}
                  — e vale <strong>mesmo com a emissão já aprovada</strong>: a aprovação validou um valor,
                  e o desconto muda esse valor.
                </>
              )}
              .
            </p>
          )}

          <CampoMoeda
            rotulo="Desconto"
            nome="desconto"
            valor={form.valores.desconto}
            aoMudar={(v) => form.definir('desconto', v)}
            {...form.campo('desconto')}
          />

          {/* O percentual aparece enquanto se digita o valor: é ele que a alçada
              compara, e fazer essa conta de cabeça é trabalho que a tela poupa. */}
          <p className={acima ? 'valor-saida' : 'texto-atenuado'} role="status">
            {percentual(pct / 100)} do valor original · líquido de{' '}
            {moeda(Math.max(0, titulo.valorOriginal - form.valores.desconto))}
            {acima && ` — acima do seu teto de ${percentual(teto / 100, 0)}`}
          </p>

          <AreaTexto
            rotulo="Motivo"
            nome="motivo"
            limite={300}
            dica="Fica no histórico da cobrança. Quem conferir a receita vai ler isto."
            value={form.valores.motivo}
            onChange={(e) => form.definir('motivo', e.target.value)}
            {...form.campo('motivo')}
          />
        </div>
      </form>
    </Dialogo>
  )
}

/* ------------------------------------------------------------ recebimento */

function DialogoRecebimento({
  titulo,
  aoFechar,
  aoSalvar,
}: {
  titulo: TituloReceber
  aoFechar: () => void
  aoSalvar: (t: TituloReceber) => void
}) {
  const base = api.baseSincrona()
  const saldo = saldoDoTituloReceber(titulo)
  const contas = base.contasBancarias.filter((c) => c.status === 'ATIVA')

  const form = useFormulario({
    inicial: {
      valorRecebido: saldo,
      dataRecebimento: hojeIso(),
      contaId: contas[0]?.id ?? '',
      forma: 'PIX' as FormaRecebimento,
    },
    validar: (v) => ({
      valorRecebido:
        v.valorRecebido <= 0
          ? 'Informe o valor recebido.'
          : v.valorRecebido > saldo + 0.005
            ? `O saldo em aberto é ${moeda(saldo)}.`
            : undefined,
      contaId: !v.contaId ? 'Escolha a conta de entrada.' : undefined,
    }),
    aoEnviar: (v) =>
      api.receberTitulo(titulo.id, {
        valorRecebido: v.valorRecebido,
        dataRecebimento: v.dataRecebimento,
        contaId: v.contaId,
        forma: v.forma,
      }),
    aoConcluir: aoSalvar,
  })

  const restaria = arredondar(saldo - form.valores.valorRecebido)

  return (
    <Dialogo
      titulo="Registrar recebimento"
      descricao={`Cobrança ${String(titulo.numeroTitulo).padStart(5, '0')} — saldo de ${moeda(saldo)}`}
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Registrando…' : 'Registrar entrada'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ valorRecebido: 'Valor recebido', contaId: 'Conta' }}
          refResumo={form.refResumo}
        />
        <div className="pilha g3">
          <Aviso tom="ok" titulo="A baixa e o extrato nascem juntos">
            A entrada é lançada na conta escolhida no mesmo ato. Não há caminho que faça um sem o outro —
            cobrança quitada que não entrou em conta nenhuma é o pior estado possível.
          </Aviso>

          <LinhaCampos>
            <CampoMoeda
              rotulo="Valor recebido"
              nome="valorRecebido"
              valor={form.valores.valorRecebido}
              aoMudar={(v) => form.definir('valorRecebido', v)}
              {...form.campo('valorRecebido')}
            />
            <Entrada
              rotulo="Data do recebimento"
              nome="dataRecebimento"
              type="date"
              value={form.valores.dataRecebimento}
              onChange={(e) => form.definir('dataRecebimento', e.target.value)}
            />
          </LinhaCampos>

          {restaria > 0 && (
            <p className="texto-atenuado" role="status">
              Recebimento parcial: restariam {moeda(restaria)} em aberto.
            </p>
          )}

          <Selecao
            rotulo="Conta de entrada"
            nome="contaId"
            value={form.valores.contaId}
            onChange={(e) => form.definir('contaId', e.target.value)}
            opcoes={contas.map((c) => ({ valor: c.id, texto: `${c.apelido} — ${c.bancoNome}` }))}
            {...form.campo('contaId')}
          />

          <GrupoOpcoes
            legenda="Forma"
            opcoes={(Object.keys(ROTULO_FORMA) as FormaRecebimento[]).map((f) => ({
              valor: f,
              texto: ROTULO_FORMA[f],
            }))}
            valor={form.valores.forma}
            aoMudar={(v) => form.definir('forma', v as FormaRecebimento)}
          />
        </div>
      </form>
    </Dialogo>
  )
}

/* ---------------------------------------------------------------- estorno */

function DialogoEstorno({
  titulo,
  recebimento,
  aoFechar,
  aoSalvar,
}: {
  titulo: TituloReceber
  recebimento: RecebimentoTitulo
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const base = api.baseSincrona()
  const conta = base.contasBancarias.find((c) => c.id === recebimento.contaId)

  const form = useFormulario({
    inicial: { motivo: '' },
    validar: (v) => ({
      motivo: v.motivo.trim().length < 5 ? 'Informe o motivo do estorno.' : undefined,
    }),
    aoEnviar: (v) => api.estornarRecebimento(titulo.id, recebimento.id, v.motivo),
    aoConcluir: aoSalvar,
  })

  return (
    <Dialogo
      titulo="Estornar recebimento"
      descricao={`${moeda(recebimento.valorRecebido)} recebidos em ${data(recebimento.dataRecebimento)}`}
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao variante="perigo" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Estornando…' : 'Estornar'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ motivo: 'Motivo' }}
          refResumo={form.refResumo}
        />
        <div className="pilha g3">
          <Aviso tom="atencao" titulo="O estorno não se estorna">
            O valor sai de {conta?.apelido ?? 'a conta de destino'} e o saldo da cobrança reabre. Cheque
            devolvido e estorno de Pix são os dois casos que tornam isto rotina, não exceção.
          </Aviso>
          <AreaTexto
            rotulo="Motivo"
            nome="motivo"
            limite={500}
            dica="Fica no histórico da cobrança e no extrato."
            value={form.valores.motivo}
            onChange={(e) => form.definir('motivo', e.target.value)}
            {...form.campo('motivo')}
          />
        </div>
      </form>
    </Dialogo>
  )
}

/* ----------------------------------------------- baixa sem recebimento */

/**
 * Baixa sem recebimento — RN-F14.
 *
 * A tela precisa dizer, sem rodeio, que isto **não** é receber. É a distinção que
 * um painel financeiro erra de graça, e o operador que a confunde encerra uma
 * cobrança acreditando ter registrado uma entrada.
 */
function DialogoBaixa({
  titulo,
  aoFechar,
  aoSalvar,
}: {
  titulo: TituloReceber
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const form = useFormulario({
    inicial: { motivo: '' },
    validar: (v) => ({
      motivo:
        v.motivo.trim().length < 10
          ? 'Motivo de ao menos 10 caracteres: é o único registro de por que o valor não entrou.'
          : undefined,
    }),
    aoEnviar: (v) => api.baixarSemRecebimento(titulo.id, v.motivo),
    aoConcluir: aoSalvar,
  })

  return (
    <Dialogo
      titulo="Baixar sem recebimento"
      descricao={`Encerra ${moeda(saldoDoTituloReceber(titulo))} em aberto — sem entrada de caixa`}
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao variante="perigo" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Baixando…' : 'Baixar sem receber'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ motivo: 'Motivo' }}
          refResumo={form.refResumo}
        />
        <div className="pilha g3">
          <Aviso tom="critico" titulo="Isto não é receber">
            <p>
              A cobrança sai da fila e <strong>não</strong> entra na receita realizada. Use para perda
              reconhecida, acordo que zerou o saldo por outro instrumento, ou valor que não compensa
              cobrar.
            </p>
            <p style={{ marginTop: 'var(--e1)' }}>
              Se o dinheiro entrou, o caminho é <strong>Receber</strong> — somar os dois infla a receita
              justamente onde ninguém confere.
            </p>
          </Aviso>
          <AreaTexto
            rotulo="Motivo"
            nome="motivo"
            limite={500}
            dica="Vai ser lido meses depois por quem tentar explicar uma diferença de receita."
            value={form.valores.motivo}
            onChange={(e) => form.definir('motivo', e.target.value)}
            {...form.campo('motivo')}
          />
        </div>
      </form>
    </Dialogo>
  )
}

/* ----------------------------------------------------------- cancelamento */

function DialogoCancelamento({
  titulo,
  parcelas,
  aoFechar,
  aoSalvar,
}: {
  titulo: TituloReceber
  parcelas: number
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const form = useFormulario({
    inicial: { motivo: '', cascata: false },
    validar: (v) => ({
      motivo: v.motivo.trim().length < 5 ? 'Informe o motivo do cancelamento.' : undefined,
    }),
    aoEnviar: (v) => api.cancelarTituloReceber(titulo.id, v.motivo, v.cascata),
    aoConcluir: aoSalvar,
  })

  return (
    <Dialogo
      titulo="Cancelar cobrança"
      descricao={`${String(titulo.numeroTitulo).padStart(5, '0')} — ${titulo.descricao}`}
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao variante="perigo" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Cancelando…' : 'Cancelar a cobrança'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ motivo: 'Motivo' }}
          refResumo={form.refResumo}
        />
        <div className="pilha g3">
          {parcelas > 0 && (
            <Aviso tom="atencao" titulo={`Esta cobrança tem ${parcelas} parcela(s)`}>
              O cancelamento em cascata precisa de confirmação explícita. Uma parcela já recebida não é
              cancelada de jeito nenhum — estorne o recebimento primeiro.
            </Aviso>
          )}
          <AreaTexto
            rotulo="Motivo"
            nome="motivo"
            limite={500}
            value={form.valores.motivo}
            onChange={(e) => form.definir('motivo', e.target.value)}
            {...form.campo('motivo')}
          />
          {parcelas > 0 && (
            <label className="alternador">
              <input
                type="checkbox"
                checked={form.valores.cascata}
                onChange={(e) => form.definir('cascata', e.target.checked)}
              />
              Cancelar também as {parcelas} parcelas pendentes
            </label>
          )}
        </div>
      </form>
    </Dialogo>
  )
}

/* ---------------------------------------------------------------- auxílio */

const arredondar = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const hojeIso = () => api.hoje().toISOString().slice(0, 10)

function diasEntre(de: string, ate: string): number {
  const a = new Date(`${de}T12:00:00Z`).getTime()
  const b = new Date(`${ate}T12:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}
