import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import {
  ehPaiDeParcelas,
  filaDeAprovacao,
  limitesAlcada,
  niveisExigidos,
  nivelPendente,
  parcelasDe,
  podeDecidirNivel,
  postoAlcada,
  ROTULO_STATUS,
  saldoDoTitulo,
  totalPago,
  valorDevidoDe,
} from '../dados/comandos'
import { useConsulta } from '../lib/useConsulta'
import { useFormulario } from '../lib/useFormulario'
import { useSessao, useToast } from '../lib/contexto'
import { data, moeda, percentual } from '../lib/formato'
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
  ClassificacaoPagar,
  FormaPagamento,
  PagamentoPagar,
  RateioPagar,
  StatusPagar,
  TituloPagar,
} from '../dados/tipos'

/**
 * Contas a pagar — Módulo 10.
 *
 * A tela tem um centro, e não é a lista: é **a fila de quem decide**. Um fluxo
 * de aprovação que obriga cada aprovador a procurar na lista geral o que está no
 * seu nível transfere a regra para quem lê a tela, e a regra se perde no
 * primeiro dia cheio. Aqui a fila é uma consulta, e ela nunca oferece o que a
 * segregação de funções vai recusar — o título de quem o lançou não aparece.
 *
 * Duas decisões que valem registrar, porque são o que separa esta tela de uma
 * lista de contas:
 *
 *  1. **A prévia de alçada aparece enquanto se digita o valor**, não depois de
 *     salvar. Descobrir que o título vai à diretoria depois de confirmar é a
 *     surpresa que o módulo existe para remover.
 *  2. **O pai de um parcelamento não entra nos totais.** Somar o total às
 *     parcelas dobraria a exposição de caixa — e é o número que alguém usa para
 *     decidir se paga hoje ou amanhã.
 */

type Aberto =
  | { tipo: 'novo' }
  | { tipo: 'detalhe'; titulo: TituloPagar }
  | { tipo: 'decidir'; titulo: TituloPagar; nivel: number }
  | { tipo: 'ajustar'; titulo: TituloPagar }
  | { tipo: 'pagar'; titulo: TituloPagar }
  | { tipo: 'cancelar'; titulo: TituloPagar }
  | { tipo: 'estornar'; titulo: TituloPagar; pagamento: PagamentoPagar }
  | { tipo: 'delegacoes' }
  | null

const SEVERIDADE: Record<StatusPagar, Severidade> = {
  PENDENTE: 'inativo',
  EM_APROVACAO: 'atencao',
  APROVADO: 'uso',
  AGENDADO: 'uso',
  PAGO_PARCIAL: 'atencao',
  PAGO: 'disponivel',
  CANCELADO: 'inativo',
  EM_DISPUTA: 'critico',
  REJEITADO: 'critico',
}

const ROTULO_CLASSIFICACAO: Record<ClassificacaoPagar, string> = {
  DESPESA_FIXA: 'Despesa fixa',
  DESPESA_VARIAVEL: 'Despesa variável',
  INVESTIMENTO: 'Investimento',
}

const ROTULO_FORMA: Record<FormaPagamento, string> = {
  TRANSFERENCIA: 'Transferência',
  BOLETO: 'Boleto',
  PIX: 'Pix',
  CHEQUE: 'Cheque',
}

/** Em aberto: o que ainda representa saída de caixa. */
const EM_ABERTO: StatusPagar[] = ['PENDENTE', 'EM_APROVACAO', 'APROVADO', 'AGENDADO', 'PAGO_PARCIAL', 'EM_DISPUTA']

export function ContasPagar() {
  const { pode, usuario } = useSessao()
  const { avisar } = useToast()
  const { situacao, dado, recarregar } = useConsulta(() => api.titulosPagar(), [])
  const [aberto, setAberto] = useState<Aberto>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<'todos' | StatusPagar>('todos')
  const [filtroClasse, setFiltroClasse] = useState<'todas' | ClassificacaoPagar>('todas')
  const [somenteFila, setSomenteFila] = useState(false)
  const [somenteAtraso, setSomenteAtraso] = useState(false)
  const [busca, setBusca] = useState('')

  const base = api.baseSincrona()
  const titulos = dado ?? []
  const hoje = api.hoje().toISOString().slice(0, 10)

  /*
   * O pai de um parcelamento sai da lista de obrigações.
   *
   * Ele é relatório (RN-F08): não se paga, e somá-lo às parcelas dobraria o
   * total. Ele reaparece no detalhe da parcela, que é onde a informação "esta é
   * a 3ª de 12, do contrato tal" de fato ajuda.
   */
  const obrigacoes = useMemo(
    () => titulos.filter((t) => !ehPaiDeParcelas(base, t)),
    [titulos, base],
  )

  const fila = useMemo(() => filaDeAprovacao(base, usuario.id), [base, usuario.id, titulos])
  const idsFila = useMemo(() => new Set(fila.map((t) => t.id)), [fila])

  const emAtraso = obrigacoes.filter((t) => EM_ABERTO.includes(t.status) && t.dataVencimento < hoje)
  const proximos = obrigacoes.filter(
    (t) => EM_ABERTO.includes(t.status) && t.dataVencimento >= hoje && t.dataVencimento <= somarDias(hoje, 7),
  )
  const aprovadoAPagar = obrigacoes.filter((t) => t.status === 'APROVADO' || t.status === 'AGENDADO')

  const visiveis = useMemo(() => {
    const alvo = somenteFila ? fila : obrigacoes
    const t = busca.trim().toLowerCase()
    return alvo.filter((x) => {
      if (filtroStatus !== 'todos' && x.status !== filtroStatus) return false
      if (filtroClasse !== 'todas' && x.classificacao !== filtroClasse) return false
      if (somenteAtraso && !(EM_ABERTO.includes(x.status) && x.dataVencimento < hoje)) return false
      if (!t) return true
      const fornecedor = base.fornecedores.find((f) => f.id === x.fornecedorId)?.razaoSocial ?? ''
      return `${x.descricao} ${fornecedor} ${x.contratoFornecedorRef ?? ''}`.toLowerCase().includes(t)
    })
  }, [obrigacoes, fila, somenteFila, somenteAtraso, filtroStatus, filtroClasse, busca, base, hoje])

  const meuPosto = postoAlcada(base, usuario.id)

  async function agir(fn: () => Promise<{ ok: boolean; erro?: { mensagem: string } }>, sucesso: string) {
    setErro(null)
    const r = await fn()
    if (r.ok) {
      recarregar()
      avisar({ tom: 'ok', titulo: sucesso })
    } else {
      setErro(r.erro!.mensagem)
    }
  }

  const colunas: Coluna<TituloPagar>[] = [
    {
      chave: 'vencimento',
      titulo: 'Vencimento',
      identificadora: true,
      ordenarPor: (t) => t.dataVencimento,
      celula: (t) => {
        const atrasado = EM_ABERTO.includes(t.status) && t.dataVencimento < hoje
        return (
          <span className="pilha g1">
            <span className={atrasado ? 'valor-saida' : undefined}>{data(t.dataVencimento)}</span>
            {/* O atraso é dito por texto, não só pela cor: WCAG 1.4.1, e é
                também o dado que quem lê a lista está procurando. */}
            {atrasado && (
              <span className="texto-atenuado">{diasEntre(t.dataVencimento, hoje)} dia(s) em atraso</span>
            )}
          </span>
        )
      },
    },
    {
      chave: 'descricao',
      titulo: 'Título',
      celula: (t) => (
        <span className="pilha g1">
          <span>{t.descricao}</span>
          <span className="texto-atenuado">
            {base.fornecedores.find((f) => f.id === t.fornecedorId)?.razaoSocial ?? 'Sem fornecedor'}
            {t.parcelaNumero !== null && ` · parcela ${t.parcelaNumero}/${t.parcelaTotal}`}
          </span>
        </span>
      ),
    },
    {
      chave: 'classificacao',
      titulo: 'Classificação',
      ocultarEmMobile: true,
      ordenarPor: (t) => t.classificacao,
      celula: (t) => <span className="texto-secundario">{ROTULO_CLASSIFICACAO[t.classificacao]}</span>,
    },
    {
      chave: 'valor',
      titulo: 'Devido',
      numerico: true,
      ordenarPor: (t) => valorDevidoDe(t),
      celula: (t) => (
        <span className="pilha g1">
          <span>{moeda(valorDevidoDe(t))}</span>
          {t.valorAjustado !== null && (
            <span className="texto-atenuado">original {moeda(t.valorOriginal)}</span>
          )}
          {totalPago(t) > 0 && saldoDoTitulo(t) > 0 && (
            <span className="texto-atenuado">saldo {moeda(saldoDoTitulo(t))}</span>
          )}
        </span>
      ),
    },
    {
      chave: 'status',
      titulo: 'Situação',
      ordenarPor: (t) => t.status,
      celula: (t) => {
        const pendente = nivelPendente(t)
        return (
          <span className="pilha g1">
            <Chip severidade={SEVERIDADE[t.status]}>{maiuscula(ROTULO_STATUS[t.status])}</Chip>
            {pendente && (
              <span className="texto-atenuado">
                aguarda nível {pendente.nivel} de {t.aprovacoes.filter((a) => a.rodada === pendente.rodada).length}
              </span>
            )}
          </span>
        )
      },
    },
    {
      chave: 'acoes',
      titulo: 'Ações',
      celula: (t) => {
        const pendente = nivelPendente(t)
        const naMinhaFila = idsFila.has(t.id)
        return (
          <span className="linha g2 linha--acoes">
            <Botao pequeno variante="sutil" onClick={() => setAberto({ tipo: 'detalhe', titulo: t })}>
              Detalhes<span className="so-leitor"> de {t.descricao}</span>
            </Botao>
            {naMinhaFila && pendente && pode('pagar:aprovar') && (
              <Botao
                pequeno
                variante="primario"
                onClick={() => setAberto({ tipo: 'decidir', titulo: t, nivel: pendente.nivel })}
              >
                Decidir<span className="so-leitor"> nível {pendente.nivel} de {t.descricao}</span>
              </Botao>
            )}
            {t.status === 'PENDENTE' && t.criadoPor === usuario.id && pode('pagar:criar') && (
              <Botao
                pequeno
                onClick={() => agir(() => api.reenviarTituloPagar(t.id, usuario.id), 'Reenviado para aprovação')}
              >
                Reenviar<span className="so-leitor"> {t.descricao}</span>
              </Botao>
            )}
            {['APROVADO', 'AGENDADO', 'PAGO_PARCIAL'].includes(t.status) && pode('pagar:baixar') && (
              <Botao pequeno onClick={() => setAberto({ tipo: 'pagar', titulo: t })}>
                Pagar<span className="so-leitor"> {t.descricao}</span>
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
          <h1>Contas a pagar</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            A aprovação vem antes do dinheiro, e quem lança não aprova. Os totais não incluem o total de
            um parcelamento — somá-lo às parcelas dobraria a exposição de caixa.
          </p>
        </div>
        <div className="linha g2">
          {pode('pagar:delegar_aprovacao') && (
            <Botao onClick={() => setAberto({ tipo: 'delegacoes' })}>Delegações</Botao>
          )}
          {pode('pagar:criar') && (
            <Botao variante="primario" glifo="+" onClick={() => setAberto({ tipo: 'novo' })}>
              Novo título
            </Botao>
          )}
        </div>
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica
            rotulo="Em atraso"
            valor={moeda(emAtraso.reduce((s, t) => s + saldoDoTitulo(t), 0))}
            contexto={`${emAtraso.length} título(s) vencido(s)`}
            tendencia={emAtraso.length > 0 ? 'negativa' : 'neutra'}
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Vence em 7 dias"
            valor={moeda(proximos.reduce((s, t) => s + saldoDoTitulo(t), 0))}
            contexto={`${proximos.length} título(s)`}
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Aguardam minha decisão"
            valor={String(fila.length)}
            contexto={meuPosto === 0 ? 'você não tem alçada configurada' : `alçada de nível ${meuPosto}`}
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Aprovado a pagar"
            valor={moeda(aprovadoAPagar.reduce((s, t) => s + saldoDoTitulo(t), 0))}
            contexto={`${aprovadoAPagar.length} título(s) liberado(s)`}
          />
        </Cartao>
      </div>

      {fila.length > 0 && !somenteFila && (
        <Aviso tom="atencao" titulo={`${fila.length} título(s) esperam a sua decisão`}>
          <p>
            A fila mostra só o que está no nível que você pode decidir e que não foi lançado por você.
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
        titulo={somenteFila ? `Minha fila de aprovação (${visiveis.length})` : `Títulos (${visiveis.length})`}
        acessorio={
          somenteFila ? (
            <Botao pequeno variante="sutil" onClick={() => setSomenteFila(false)}>
              Ver todos os títulos
            </Botao>
          ) : null
        }
      >
        <div className="filtros">
          <Entrada
            rotulo="Buscar por descrição, fornecedor ou contrato"
            rotuloOculto
            placeholder="Buscar título…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <Selecao
            rotulo="Situação"
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value as 'todos' | StatusPagar)}
            opcoes={[
              { valor: 'todos', texto: 'Todas as situações' },
              ...(Object.keys(ROTULO_STATUS) as StatusPagar[]).map((s) => ({
                valor: s,
                texto: maiuscula(ROTULO_STATUS[s]),
              })),
            ]}
          />
          <Selecao
            rotulo="Classificação"
            value={filtroClasse}
            onChange={(e) => setFiltroClasse(e.target.value as 'todas' | ClassificacaoPagar)}
            opcoes={[
              { valor: 'todas', texto: 'Todas as classificações' },
              ...(Object.keys(ROTULO_CLASSIFICACAO) as ClassificacaoPagar[]).map((c) => ({
                valor: c,
                texto: ROTULO_CLASSIFICACAO[c],
              })),
            ]}
          />
          <label className="alternador">
            <input
              type="checkbox"
              checked={somenteAtraso}
              onChange={(e) => setSomenteAtraso(e.target.checked)}
            />
            Só os vencidos em aberto
          </label>
        </div>

        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando títulos">
            <Skeleton linhas={8} altura="24px" />
          </Carregando>
        ) : (
          <Tabela
            legenda={somenteFila ? 'Minha fila de aprovação' : 'Títulos a pagar'}
            colunas={colunas}
            itens={visiveis}
            chaveDe={(t) => t.id}
            ordemInicial={{ chave: 'vencimento', direcao: 'asc' }}
            vazio={{
              titulo: somenteFila ? 'Nada esperando a sua decisão' : 'Nenhum título com estes filtros',
              texto: somenteFila
                ? 'A fila mostra apenas títulos no nível que o seu posto de alçada decide, e que não foram lançados por você.'
                : 'Ajuste os filtros ou lance um título novo.',
            }}
          />
        )}
      </Cartao>

      {aberto?.tipo === 'novo' && (
        <DialogoNovoTitulo
          aoFechar={() => setAberto(null)}
          aoSalvar={(t) => {
            setAberto(null)
            recarregar()
            avisar({
              tom: 'ok',
              titulo: 'Título lançado',
              texto:
                t.status === 'EM_APROVACAO'
                  ? `Enviado para ${t.aprovacoes.length} nível(is) de aprovação.`
                  : 'Nenhuma faixa de alçada exige aprovação para este valor.',
            })
          }}
        />
      )}

      {aberto?.tipo === 'detalhe' && (
        <DialogoDetalhe
          titulo={obrigacoes.find((t) => t.id === aberto.titulo.id) ?? aberto.titulo}
          aoFechar={() => setAberto(null)}
          aoAjustar={(t) => setAberto({ tipo: 'ajustar', titulo: t })}
          aoCancelar={(t) => setAberto({ tipo: 'cancelar', titulo: t })}
          aoEstornar={(t, pagamento) => setAberto({ tipo: 'estornar', titulo: t, pagamento })}
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
              titulo: decisao === 'APROVADO' ? 'Nível aprovado' : 'Título rejeitado',
              texto:
                decisao === 'APROVADO'
                  ? undefined
                  : 'Voltou para pendente. O solicitante corrige e reenvia.',
            })
          }}
        />
      )}

      {aberto?.tipo === 'ajustar' && (
        <DialogoAjuste
          titulo={aberto.titulo}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({ tom: 'ok', titulo: 'Valor ajustado' })
          }}
        />
      )}

      {aberto?.tipo === 'pagar' && (
        <DialogoPagamento
          titulo={aberto.titulo}
          aoFechar={() => setAberto(null)}
          aoSalvar={(t) => {
            setAberto(null)
            recarregar()
            avisar({
              tom: 'ok',
              titulo: t.status === 'PAGO' ? 'Título quitado' : 'Pagamento parcial registrado',
              texto: 'A saída foi lançada na conta no mesmo ato.',
            })
          }}
        />
      )}

      {aberto?.tipo === 'cancelar' && (
        <DialogoCancelamento
          titulo={aberto.titulo}
          parcelas={parcelasDe(base, aberto.titulo.id).length}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({ tom: 'ok', titulo: 'Título cancelado' })
          }}
        />
      )}

      {aberto?.tipo === 'estornar' && (
        <DialogoEstorno
          titulo={aberto.titulo}
          pagamento={aberto.pagamento}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({
              tom: 'ok',
              titulo: 'Pagamento estornado',
              texto: 'O valor voltou para a conta e o título reabriu.',
            })
          }}
        />
      )}

      {aberto?.tipo === 'delegacoes' && <DialogoDelegacoes aoFechar={() => setAberto(null)} />}
    </>
  )
}

/* ------------------------------------------------------------- novo título */

/**
 * Lançamento, com a prévia de alçada ao lado do valor.
 *
 * A prévia é o motivo de este diálogo não ser um formulário qualquer: ela
 * responde "quem vai ter de aprovar isto" **antes** do envio. Sem ela, a única
 * forma de saber é salvar e ver — e o operador que descobre que o título foi
 * para a diretoria depois de prometer o pagamento para hoje aprende a não
 * confiar na tela.
 */
function DialogoNovoTitulo({
  aoFechar,
  aoSalvar,
}: {
  aoFechar: () => void
  aoSalvar: (t: TituloPagar) => void
}) {
  const { usuario } = useSessao()
  const base = api.baseSincrona()
  const hoje = api.hoje().toISOString().slice(0, 10)
  const [rateio, setRateio] = useState<RateioPagar[]>([])

  const form = useFormulario({
    inicial: {
      fornecedorId: '',
      descricao: '',
      classificacao: 'DESPESA_VARIAVEL' as ClassificacaoPagar,
      contratoFornecedorRef: '',
      valorOriginal: 0,
      dataEmissao: hoje,
      dataVencimento: hoje,
      parcelas: 1,
    },
    validar: (v) => ({
      descricao: v.descricao.trim().length < 3 ? 'Descreva o título — quem aprova lê isto.' : undefined,
      valorOriginal: v.valorOriginal <= 0 ? 'Informe o valor.' : undefined,
      dataVencimento:
        v.dataVencimento < v.dataEmissao ? 'O vencimento não pode ser anterior à emissão.' : undefined,
    }),
    aoEnviar: (v) =>
      api.criarTituloPagar(usuario.id, {
        fornecedorId: v.fornecedorId || null,
        descricao: v.descricao,
        classificacao: v.classificacao,
        contratoFornecedorRef: v.contratoFornecedorRef || null,
        valorOriginal: v.valorOriginal,
        dataEmissao: v.dataEmissao,
        dataVencimento: v.dataVencimento,
        parcelas: v.parcelas,
        rateio,
      }),
    aoConcluir: aoSalvar,
  })

  const valor = form.valores.valorOriginal
  const niveis = niveisExigidos(base, valor)
  const limites = limitesAlcada(base)
  const somaRateio = arredondar(rateio.reduce((s, r) => s + r.percentual, 0))
  const centrosAtivos = base.centrosCusto.filter((c) => c.ativo)

  function acrescentarLinha() {
    const usados = new Set(rateio.map((r) => r.centroCustoId))
    const livre = centrosAtivos.find((c) => !usados.has(c.id))
    if (!livre) return
    // A linha nova recebe o que falta para 100, não zero: o caso comum é uma
    // linha só, e pedir para digitar "100" é trabalho que a tela pode poupar.
    setRateio([...rateio, { centroCustoId: livre.id, percentual: Math.max(0, arredondar(100 - somaRateio)) }])
  }

  return (
    <Dialogo
      titulo="Novo título a pagar"
      descricao="O valor decide quantos níveis de aprovação o título vai exigir. A prévia aparece ao lado."
      largura="largo"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Lançando…' : 'Lançar título'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{
            descricao: 'Descrição',
            valorOriginal: 'Valor',
            dataVencimento: 'Vencimento',
            parcelas: 'Parcelas',
          }}
          refResumo={form.refResumo}
        />

        <div className="pilha g3">
          <Entrada
            rotulo="Descrição"
            nome="descricao"
            dica="O que é esta despesa. Aparece na fila de quem aprova."
            value={form.valores.descricao}
            onChange={(e) => form.definir('descricao', e.target.value)}
            {...form.campo('descricao')}
          />

          <LinhaCampos>
            <Combo
              rotulo="Fornecedor"
              nome="fornecedorId"
              vazio="Sem fornecedor vinculado"
              opcoes={base.fornecedores.map((f) => ({
                valor: f.id,
                texto: f.razaoSocial,
                detalhe: f.nomeFantasia,
              }))}
              valor={form.valores.fornecedorId}
              aoMudar={(v) => form.definir('fornecedorId', v)}
            />
            <Entrada
              rotulo="Referência do contrato"
              nome="contratoFornecedorRef"
              dica="Opcional. O número que o fornecedor usa."
              value={form.valores.contratoFornecedorRef}
              onChange={(e) => form.definir('contratoFornecedorRef', e.target.value)}
            />
          </LinhaCampos>

          <GrupoOpcoes
            legenda="Classificação"
            dica="Separa o que é custo recorrente do que é aquisição de parque."
            opcoes={[
              { valor: 'DESPESA_FIXA', texto: 'Despesa fixa', detalhe: 'repete todo mês' },
              { valor: 'DESPESA_VARIAVEL', texto: 'Despesa variável', detalhe: 'varia com a operação' },
              { valor: 'INVESTIMENTO', texto: 'Investimento', detalhe: 'entra no parque' },
            ]}
            valor={form.valores.classificacao}
            aoMudar={(v) => form.definir('classificacao', v as ClassificacaoPagar)}
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

          {/* Prévia de alçada. `role="status"` porque o número muda enquanto se
              digita, e quem usa leitor de tela precisa ser avisado da mudança
              sem que o foco saia do campo de valor. */}
          <div className="previa-alcada" role="status">
            {valor <= 0 ? (
              <p className="texto-atenuado">Informe o valor para ver quantas aprovações ele exige.</p>
            ) : niveis === 0 ? (
              <p>
                <strong>Nenhuma aprovação necessária.</strong>{' '}
                {limites.length === 0
                  ? 'Não há faixa de alçada cadastrada neste ambiente.'
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
            {form.valores.parcelas > 1 && valor > 0 && (
              <p className="texto-atenuado">
                A aprovação é do total, não de cada parcela: {moeda(valor)} em {form.valores.parcelas}{' '}
                parcelas de aproximadamente {moeda(valor / form.valores.parcelas)}.
              </p>
            )}
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
              Opcional — mas, se houver rateio, ele tem de fechar em 100%. Um rateio parcial deixaria
              despesa sem centro, e o relatório por área passaria a mentir sem avisar.
            </p>

            {rateio.length === 0 ? (
              <p className="texto-atenuado">Sem rateio: o título fica sem dimensão de análise por área.</p>
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
                    <Botao
                      pequeno
                      variante="sutil"
                      onClick={() => setRateio(rateio.filter((_, j) => j !== i))}
                    >
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

/* ---------------------------------------------------------------- detalhe */

function DialogoDetalhe({
  titulo,
  aoFechar,
  aoAjustar,
  aoCancelar,
  aoEstornar,
}: {
  titulo: TituloPagar
  aoFechar: () => void
  aoAjustar: (t: TituloPagar) => void
  aoCancelar: (t: TituloPagar) => void
  aoEstornar: (t: TituloPagar, pagamento: PagamentoPagar) => void
}) {
  const { pode } = useSessao()
  const base = api.baseSincrona()
  const fornecedor = base.fornecedores.find((f) => f.id === titulo.fornecedorId)
  const pai = titulo.tituloPaiId ? base.titulosPagar.find((t) => t.id === titulo.tituloPaiId) : null
  const rodadas = [...new Set(titulo.aprovacoes.map((a) => a.rodada))].sort((a, b) => b - a)
  const nomeDe = (id: string | null) => base.usuarios.find((u) => u.id === id)?.nome ?? '—'

  return (
    <Dialogo
      titulo={titulo.descricao}
      descricao={`${ROTULO_CLASSIFICACAO[titulo.classificacao]} · vence em ${data(titulo.dataVencimento)}`}
      largura="largo"
      aoFechar={aoFechar}
      acoes={
        <>
          {pode('pagar:cancelar') && titulo.status !== 'CANCELADO' && (
            <Botao variante="perigo" onClick={() => aoCancelar(titulo)}>
              Cancelar título
            </Botao>
          )}
          {pode('pagar:criar') && !['PAGO', 'CANCELADO'].includes(titulo.status) && (
            <Botao onClick={() => aoAjustar(titulo)}>Ajustar valor</Botao>
          )}
          <Botao variante="sutil" onClick={aoFechar}>
            Fechar
          </Botao>
        </>
      }
    >
      <div className="pilha g3">
        <dl className="descricoes">
          <div>
            <dt>Fornecedor</dt>
            <dd>{fornecedor ? fornecedor.razaoSocial : 'Sem fornecedor vinculado'}</dd>
          </div>
          <div>
            <dt>Valor devido</dt>
            <dd>
              {moeda(valorDevidoDe(titulo))}
              {titulo.valorAjustado !== null && (
                <span className="texto-atenuado"> (original {moeda(titulo.valorOriginal)})</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Saldo em aberto</dt>
            <dd>{moeda(saldoDoTitulo(titulo))}</dd>
          </div>
          <div>
            <dt>Lançado por</dt>
            <dd>
              {nomeDe(titulo.criadoPor)} em {data(titulo.criadoEm)}
            </dd>
          </div>
          {titulo.contratoFornecedorRef && (
            <div>
              <dt>Contrato do fornecedor</dt>
              <dd>{titulo.contratoFornecedorRef}</dd>
            </div>
          )}
          {titulo.parcelaNumero !== null && (
            <div>
              <dt>Parcela</dt>
              <dd>
                {titulo.parcelaNumero} de {titulo.parcelaTotal}
                {pai && <span className="texto-atenuado"> · total de {moeda(valorDevidoDe(pai))}</span>}
              </dd>
            </div>
          )}
        </dl>

        {titulo.motivoAjuste && (
          <Aviso tom="atencao" titulo="Valor ajustado">
            {titulo.motivoAjuste}
          </Aviso>
        )}

        <section>
          <h3>Rateio</h3>
          {titulo.rateio.length === 0 ? (
            <p className="texto-atenuado">Sem rateio — o título não tem dimensão de análise por área.</p>
          ) : (
            <ul className="lista-simples">
              {titulo.rateio.map((r) => {
                const centro = base.centrosCusto.find((c) => c.id === r.centroCustoId)
                return (
                  <li key={r.centroCustoId}>
                    {centro ? `${centro.codigo} — ${centro.nome}` : r.centroCustoId}:{' '}
                    {percentual(r.percentual / 100)} ({moeda((valorDevidoDe(titulo) * r.percentual) / 100)})
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <h3>Aprovação</h3>
          {titulo.aprovacoes.length === 0 ? (
            <p className="texto-atenuado">
              {pai
                ? 'A aprovação é do total do parcelamento, não da parcela: é o valor do pai que a alçada avalia.'
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
          <h3>Pagamentos</h3>
          {titulo.pagamentos.length === 0 ? (
            <p className="texto-atenuado">Nenhuma baixa registrada.</p>
          ) : (
            <ul className="lista-simples">
              {titulo.pagamentos.map((p) => {
                const conta = base.contasBancarias.find((c) => c.id === p.contaId)
                return (
                  <li key={p.id}>
                    <span className="linha entre g2">
                      <span>
                        {moeda(p.valorPago)} em {data(p.dataPagamento)} · {ROTULO_FORMA[p.forma]} ·{' '}
                        {conta?.apelido ?? p.contaId}
                        {p.estornadoEm && (
                          <span className="valor-saida"> · estornado em {data(p.estornadoEm)}</span>
                        )}
                      </span>
                      {!p.estornadoEm && pode('pagar:baixar') && (
                        <Botao pequeno variante="sutil" onClick={() => aoEstornar(titulo, p)}>
                          Estornar<span className="so-leitor"> o pagamento de {moeda(p.valorPago)}</span>
                        </Botao>
                      )}
                    </span>
                    {p.estornoMotivo && <p className="texto-atenuado">Motivo: {p.estornoMotivo}</p>}
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
  titulo: TituloPagar
  nivel: number
  aoFechar: () => void
  aoDecidir: (decisao: 'APROVADO' | 'REJEITADO') => void
}) {
  const { usuario } = useSessao()
  const base = api.baseSincrona()
  const [decisao, setDecisao] = useState<'APROVADO' | 'REJEITADO'>('APROVADO')
  const porDelegacao = postoAlcada(base, usuario.id) < nivel

  const form = useFormulario({
    inicial: { justificativa: '' },
    validar: (v) => ({
      justificativa:
        decisao === 'REJEITADO' && v.justificativa.trim().length < 10
          ? 'A rejeição exige justificativa de ao menos 10 caracteres.'
          : undefined,
    }),
    aoEnviar: (v) =>
      api.decidirAprovacao(titulo.id, nivel, usuario.id, { decisao, justificativa: v.justificativa }),
    aoConcluir: () => aoDecidir(decisao),
  })

  const restantes = titulo.aprovacoes.filter(
    (a) => a.rodada === nivelPendente(titulo)?.rodada && a.nivel > nivel,
  ).length

  return (
    <Dialogo
      titulo={`Decidir nível ${nivel}`}
      descricao={`${titulo.descricao} — ${moeda(valorDevidoDe(titulo))}`}
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
            {form.enviando ? 'Registrando…' : decisao === 'APROVADO' ? 'Aprovar' : 'Rejeitar'}
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
              O seu posto de alçada é inferior a este nível. A decisão fica registrada com o nome de quem
              delegou, ao lado do seu — é o que mantém a trilha de auditoria verdadeira.
            </Aviso>
          )}

          <dl className="descricoes">
            <div>
              <dt>Fornecedor</dt>
              <dd>
                {base.fornecedores.find((f) => f.id === titulo.fornecedorId)?.razaoSocial ??
                  'Sem fornecedor'}
              </dd>
            </div>
            <div>
              <dt>Vencimento</dt>
              <dd>{data(titulo.dataVencimento)}</dd>
            </div>
            <div>
              <dt>Lançado por</dt>
              <dd>{base.usuarios.find((u) => u.id === titulo.criadoPor)?.nome ?? '—'}</dd>
            </div>
            <div>
              <dt>Depois deste nível</dt>
              <dd>
                {restantes === 0
                  ? 'o título fica aprovado e liberado para pagamento'
                  : `faltam ${restantes} nível(is)`}
              </dd>
            </div>
          </dl>

          <GrupoOpcoes
            legenda="Decisão"
            opcoes={[
              { valor: 'APROVADO', texto: 'Aprovar', detalhe: 'segue para o próximo nível ou para pagamento' },
              { valor: 'REJEITADO', texto: 'Rejeitar', detalhe: 'volta a pendente para correção e reenvio' },
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
                ? 'Obrigatória: sem ela o solicitante não sabe o que corrigir e reenvia igual.'
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

/* ----------------------------------------------------------------- ajuste */

function DialogoAjuste({
  titulo,
  aoFechar,
  aoSalvar,
}: {
  titulo: TituloPagar
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const form = useFormulario({
    inicial: { valorAjustado: valorDevidoDe(titulo), motivo: '' },
    validar: (v) => ({
      valorAjustado: v.valorAjustado <= 0 ? 'Informe o valor ajustado.' : undefined,
      motivo: v.motivo.trim().length < 5 ? 'Informe o motivo — multa, juro ou desconto.' : undefined,
    }),
    aoEnviar: (v) => api.ajustarValorTitulo(titulo.id, v.valorAjustado, v.motivo),
    aoConcluir: aoSalvar,
  })

  const diferenca = arredondar(form.valores.valorAjustado - titulo.valorOriginal)

  return (
    <Dialogo
      titulo="Ajustar o valor devido"
      descricao="Multa, juro ou desconto negociado. O valor original permanece registrado."
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Salvando…' : 'Ajustar'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ valorAjustado: 'Valor ajustado', motivo: 'Motivo' }}
          refResumo={form.refResumo}
        />
        <div className="pilha g3">
          <p className="texto-secundario">
            Original: {moeda(titulo.valorOriginal)} · já pago: {moeda(totalPago(titulo))}
          </p>
          <CampoMoeda
            rotulo="Valor ajustado"
            nome="valorAjustado"
            valor={form.valores.valorAjustado}
            aoMudar={(v) => form.definir('valorAjustado', v)}
            {...form.campo('valorAjustado')}
          />
          {diferenca !== 0 && (
            <p className={diferenca > 0 ? 'valor-saida' : 'valor-entrada'} role="status">
              {diferenca > 0 ? 'Acréscimo' : 'Redução'} de {moeda(Math.abs(diferenca))} sobre o original.
            </p>
          )}
          <AreaTexto
            rotulo="Motivo"
            nome="motivo"
            limite={300}
            dica="Fica no histórico do título. Quem conferir o pagamento vai ler isto."
            value={form.valores.motivo}
            onChange={(e) => form.definir('motivo', e.target.value)}
            {...form.campo('motivo')}
          />
        </div>
      </form>
    </Dialogo>
  )
}

/* -------------------------------------------------------------- pagamento */

function DialogoPagamento({
  titulo,
  aoFechar,
  aoSalvar,
}: {
  titulo: TituloPagar
  aoFechar: () => void
  aoSalvar: (t: TituloPagar) => void
}) {
  const base = api.baseSincrona()
  const saldo = saldoDoTitulo(titulo)
  const contas = base.contasBancarias.filter((c) => c.status === 'ATIVA')

  const form = useFormulario({
    inicial: {
      valorPago: saldo,
      dataPagamento: api.hoje().toISOString().slice(0, 10),
      contaId: contas[0]?.id ?? '',
      forma: 'TRANSFERENCIA' as FormaPagamento,
    },
    validar: (v) => ({
      valorPago:
        v.valorPago <= 0
          ? 'Informe o valor pago.'
          : v.valorPago > saldo + 0.005
            ? `O saldo em aberto é ${moeda(saldo)}.`
            : undefined,
      contaId: !v.contaId ? 'Escolha a conta de saída.' : undefined,
    }),
    aoEnviar: (v) =>
      api.pagarTitulo(titulo.id, {
        valorPago: v.valorPago,
        dataPagamento: v.dataPagamento,
        contaId: v.contaId,
        forma: v.forma,
      }),
    aoConcluir: aoSalvar,
  })

  const restaria = arredondar(saldo - form.valores.valorPago)

  return (
    <Dialogo
      titulo="Registrar pagamento"
      descricao={`${titulo.descricao} — saldo em aberto de ${moeda(saldo)}`}
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Registrando…' : 'Registrar baixa'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ valorPago: 'Valor pago', contaId: 'Conta' }}
          refResumo={form.refResumo}
        />
        <div className="pilha g3">
          <Aviso tom="ok" titulo="A baixa e o extrato nascem juntos">
            A saída é lançada na conta escolhida no mesmo ato. Não há caminho que faça um sem o outro —
            título quitado sem dinheiro saindo do extrato é o pior estado possível.
          </Aviso>

          <LinhaCampos>
            <CampoMoeda
              rotulo="Valor pago"
              nome="valorPago"
              valor={form.valores.valorPago}
              aoMudar={(v) => form.definir('valorPago', v)}
              {...form.campo('valorPago')}
            />
            <Entrada
              rotulo="Data do pagamento"
              nome="dataPagamento"
              type="date"
              value={form.valores.dataPagamento}
              onChange={(e) => form.definir('dataPagamento', e.target.value)}
            />
          </LinhaCampos>

          {restaria > 0 && (
            <p className="texto-atenuado" role="status">
              Pagamento parcial: restariam {moeda(restaria)} em aberto.
            </p>
          )}

          <Selecao
            rotulo="Conta de saída"
            nome="contaId"
            value={form.valores.contaId}
            onChange={(e) => form.definir('contaId', e.target.value)}
            opcoes={contas.map((c) => ({ valor: c.id, texto: `${c.apelido} — ${c.bancoNome}` }))}
            {...form.campo('contaId')}
          />

          <GrupoOpcoes
            legenda="Forma"
            opcoes={(Object.keys(ROTULO_FORMA) as FormaPagamento[]).map((f) => ({
              valor: f,
              texto: ROTULO_FORMA[f],
            }))}
            valor={form.valores.forma}
            aoMudar={(v) => form.definir('forma', v as FormaPagamento)}
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
  titulo: TituloPagar
  parcelas: number
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const form = useFormulario({
    inicial: { motivo: '', cascata: false },
    validar: (v) => ({
      motivo: v.motivo.trim().length < 5 ? 'Informe o motivo do cancelamento.' : undefined,
    }),
    aoEnviar: (v) => api.cancelarTituloPagar(titulo.id, v.motivo, v.cascata),
    aoConcluir: aoSalvar,
  })

  return (
    <Dialogo
      titulo="Cancelar título"
      descricao={titulo.descricao}
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao variante="perigo" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Cancelando…' : 'Cancelar o título'}
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
            <Aviso tom="atencao" titulo={`Este título tem ${parcelas} parcela(s)`}>
              O cancelamento em cascata precisa de confirmação explícita. Uma parcela já paga não é
              cancelada de jeito nenhum — estorne o pagamento primeiro.
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

/* ---------------------------------------------------------------- estorno */

/**
 * Estorno de uma baixa.
 *
 * Diálogo, e não uma janela de `prompt()`: o motivo entra no histórico do
 * título e é lido por quem confere o extrato depois. Um `prompt` do navegador
 * não tem rótulo associado, não é estilizável, não valida o tamanho mínimo, e
 * em alguns navegadores nem aparece — a confirmação sumiria sem erro nenhum.
 */
function DialogoEstorno({
  titulo,
  pagamento,
  aoFechar,
  aoSalvar,
}: {
  titulo: TituloPagar
  pagamento: PagamentoPagar
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const base = api.baseSincrona()
  const conta = base.contasBancarias.find((c) => c.id === pagamento.contaId)

  const form = useFormulario({
    inicial: { motivo: '' },
    validar: (v) => ({
      motivo: v.motivo.trim().length < 5 ? 'Informe o motivo do estorno.' : undefined,
    }),
    aoEnviar: (v) => api.estornarPagamentoTitulo(titulo.id, pagamento.id, v.motivo),
    aoConcluir: aoSalvar,
  })

  return (
    <Dialogo
      titulo="Estornar pagamento"
      descricao={`${moeda(pagamento.valorPago)} pagos em ${data(pagamento.dataPagamento)}`}
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
            O valor volta para {conta?.apelido ?? 'a conta de origem'} como entrada, e o saldo do título
            reabre. Se depois for preciso corrigir, o caminho é registrar um pagamento novo.
          </Aviso>
          <AreaTexto
            rotulo="Motivo"
            nome="motivo"
            limite={500}
            dica="Fica no histórico do título e do extrato."
            value={form.valores.motivo}
            onChange={(e) => form.definir('motivo', e.target.value)}
            {...form.campo('motivo')}
          />
        </div>
      </form>
    </Dialogo>
  )
}

/* ------------------------------------------------------------- delegações */

function DialogoDelegacoes({ aoFechar }: { aoFechar: () => void }) {
  const { usuario } = useSessao()
  const { avisar } = useToast()
  const base = api.baseSincrona()
  const hoje = api.hoje().toISOString().slice(0, 10)
  const [erro, setErro] = useState<string | null>(null)
  const [revisao, setRevisao] = useState(0)

  const minhas = base.delegacoes.filter((d) => d.deleganteId === usuario.id)
  const meuPosto = postoAlcada(base, usuario.id)
  const candidatos = base.usuarios.filter(
    (u) => u.id !== usuario.id && u.tipo === 'INTERNO' && u.status === 'ATIVO',
  )

  const form = useFormulario({
    inicial: {
      delegadoId: candidatos[0]?.id ?? '',
      nivel: Math.max(1, Math.min(meuPosto, 3)),
      inicio: hoje,
      fim: hoje,
      motivo: '',
    },
    validar: (v) => ({
      delegadoId: !v.delegadoId ? 'Escolha para quem delegar.' : undefined,
      fim: v.fim < v.inicio ? 'O fim não pode ser anterior ao início.' : undefined,
      motivo: v.motivo.trim().length < 3 ? 'Informe o motivo — férias, licença, viagem.' : undefined,
    }),
    aoEnviar: (v) =>
      api.criarDelegacao(usuario.id, {
        delegadoId: v.delegadoId,
        nivel: v.nivel,
        inicio: v.inicio,
        fim: v.fim,
        motivo: v.motivo,
      }),
    aoConcluir: () => {
      setRevisao((r) => r + 1)
      form.redefinir({ motivo: '' })
      avisar({ tom: 'ok', titulo: 'Delegação criada' })
    },
  })

  async function revogar(id: string) {
    setErro(null)
    const r = await api.revogarDelegacao(id, usuario.id)
    if (r.ok) setRevisao((x) => x + 1)
    else setErro(r.erro.mensagem)
  }

  return (
    <Dialogo
      titulo="Delegações de alçada"
      descricao="Quem delega é sempre você. A autoridade de outra pessoa não se transfere daqui."
      largura="largo"
      aoFechar={aoFechar}
      acoes={
        <Botao variante="sutil" onClick={aoFechar}>
          Fechar
        </Botao>
      }
    >
      <div className="pilha g3" key={revisao}>
        {meuPosto === 0 ? (
          <Aviso tom="atencao" titulo="Você não tem alçada para delegar">
            A delegação transfere um nível que você já tem. Sem faixa de alçada cadastrada para o seu
            perfil, não há nada a delegar.
          </Aviso>
        ) : (
          <form onSubmit={form.enviar} noValidate>
            <ResumoErros
              erros={form.errosResumo}
              erroGeral={form.erroGeral}
              rotulos={{ delegadoId: 'Delegado', fim: 'Fim', motivo: 'Motivo' }}
              refResumo={form.refResumo}
            />
            <div className="pilha g3">
              <LinhaCampos>
                <Selecao
                  rotulo="Delegar para"
                  nome="delegadoId"
                  value={form.valores.delegadoId}
                  onChange={(e) => form.definir('delegadoId', e.target.value)}
                  opcoes={candidatos.map((u) => ({ valor: u.id, texto: u.nome }))}
                  {...form.campo('delegadoId')}
                />
                <Selecao
                  rotulo="Nível"
                  nome="nivel"
                  dica={`Até o seu posto, que é ${meuPosto}.`}
                  value={String(form.valores.nivel)}
                  onChange={(e) => form.definir('nivel', Number(e.target.value))}
                  opcoes={Array.from({ length: Math.min(meuPosto, 3) }, (_, i) => ({
                    valor: String(i + 1),
                    texto: `Nível ${i + 1}`,
                  }))}
                />
              </LinhaCampos>
              <LinhaCampos>
                <Entrada
                  rotulo="Início"
                  nome="inicio"
                  type="date"
                  value={form.valores.inicio}
                  onChange={(e) => form.definir('inicio', e.target.value)}
                />
                <Entrada
                  rotulo="Fim"
                  nome="fim"
                  type="date"
                  value={form.valores.fim}
                  onChange={(e) => form.definir('fim', e.target.value)}
                  {...form.campo('fim')}
                />
              </LinhaCampos>
              <Entrada
                rotulo="Motivo"
                nome="motivo"
                value={form.valores.motivo}
                onChange={(e) => form.definir('motivo', e.target.value)}
                {...form.campo('motivo')}
              />
              <div className="linha">
                <Botao variante="primario" onClick={form.enviar} disabled={form.enviando}>
                  {form.enviando ? 'Criando…' : 'Criar delegação'}
                </Botao>
              </div>
            </div>
          </form>
        )}

        {erro && (
          <Aviso tom="critico" titulo="Não foi possível concluir">
            {erro}
          </Aviso>
        )}

        <section>
          <h3>Delegações que eu concedi</h3>
          {minhas.length === 0 ? (
            <p className="texto-atenuado">Nenhuma delegação concedida.</p>
          ) : (
            <ul className="lista-simples">
              {minhas.map((d) => {
                const vigente = d.inicio <= hoje && d.fim >= hoje
                return (
                  <li key={d.id}>
                    <span className="linha entre g2">
                      <span>
                        Nível {d.nivel} para{' '}
                        {base.usuarios.find((u) => u.id === d.delegadoId)?.nome ?? d.delegadoId} ·{' '}
                        {data(d.inicio)} a {data(d.fim)}
                        <Chip severidade={vigente ? 'disponivel' : 'inativo'}>
                          {vigente ? 'Vigente' : 'Fora do período'}
                        </Chip>
                      </span>
                      <Botao pequeno variante="sutil" onClick={() => revogar(d.id)}>
                        Revogar<span className="so-leitor"> a delegação de nível {d.nivel}</span>
                      </Botao>
                    </span>
                    <p className="texto-atenuado">{d.motivo}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <h3>Delegações que eu recebi</h3>
          {base.delegacoes.filter((d) => d.delegadoId === usuario.id).length === 0 ? (
            <p className="texto-atenuado">Nenhuma delegação recebida.</p>
          ) : (
            <ul className="lista-simples">
              {base.delegacoes
                .filter((d) => d.delegadoId === usuario.id)
                .map((d) => (
                  <li key={d.id}>
                    Nível {d.nivel} de{' '}
                    {base.usuarios.find((u) => u.id === d.deleganteId)?.nome ?? d.deleganteId} ·{' '}
                    {data(d.inicio)} a {data(d.fim)}
                    {podeDecidirNivel(base, usuario.id, d.nivel) && d.inicio <= hoje && d.fim >= hoje && (
                      <span className="texto-atenuado"> · em uso agora</span>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </Dialogo>
  )
}

/* ---------------------------------------------------------------- auxílio */

const arredondar = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function diasEntre(de: string, ate: string): number {
  const a = new Date(`${de}T12:00:00Z`).getTime()
  const b = new Date(`${ate}T12:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}
