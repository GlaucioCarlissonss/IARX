import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import {
  avancarPeriodicidade,
  elegivelParaConversao,
  naFilaDeExcecao,
  previaDeConversao,
  projetarCaixa,
  ROTULO_PERIODICIDADE,
  ROTULO_STATUS_LANCAMENTO,
  ROTULO_TIPO_LANCAMENTO,
  ladoDoTipo,
} from '../dados/comandos'
import { useConsulta } from '../lib/useConsulta'
import { useFormulario } from '../lib/useFormulario'
import { useSessao, useToast } from '../lib/contexto'
import { data, moeda } from '../lib/formato'
import { Aviso, Botao, Cartao, Chip, Entrada, Metrica, Selecao, Skeleton } from '../componentes/ui/primitivos'
import type { Severidade } from '../componentes/ui/primitivos'
import { Dialogo } from '../componentes/ui/Dialogo'
import { AreaTexto, CampoMoeda, CampoNumero, Combo, GrupoOpcoes, LinhaCampos, ResumoErros } from '../componentes/ui/formulario'
import { Tabela, type Coluna } from '../componentes/ui/Tabela'
import type { LancamentoFuturo, Lado, Periodicidade, StatusLancamento, TipoLancamento } from '../dados/tipos'

/**
 * Lançamentos futuros — Módulo 12.
 *
 * A tela da **intenção**: o compromisso programado que ainda não é título.
 *
 * Três decisões de interface que vale registrar:
 *
 *  1. **A fila de exceção é um filtro, não uma aba com estado próprio.** Um
 *     lançamento sai dela no instante em que o contrato volta a vigorar, sem que
 *     ninguém o toque; uma aba alimentada por um campo gravado mostraria
 *     lançamentos que já não pertencem a ela.
 *  2. **O diálogo de conversão mostra o que vai ser criado antes de criar** — e
 *     mostra também o impedimento, quando há. É o mesmo princípio da prévia de
 *     fechamento do Módulo 11, com razão mais forte: a conversão abre rodada de
 *     aprovação, e a recusa por vigência só apareceria depois.
 *  3. **A prévia não converte.** Nada no diálogo escreve: abrir e desistir não
 *     deixa rastro de tentativa. Se ela "simulasse" convertendo, o contador de
 *     tentativas subiria por curiosidade.
 *
 * O que a tela **não** mostra: nenhuma coluna de atraso e nenhum selo de "na fila
 * de exceção". Os dois são derivados de data e de `excecaoConversao`, e guardá-los
 * seria a mesma classe de defeito que guardar saldo.
 */

type Aberto =
  | null
  | { tipo: 'novo' }
  | { tipo: 'serie' }
  | { tipo: 'editar'; lancamento: LancamentoFuturo }
  | { tipo: 'cancelar'; lancamento: LancamentoFuturo }
  | { tipo: 'converter'; lancamento: LancamentoFuturo }

const SEVERIDADE: Record<StatusLancamento, Severidade> = {
  PROGRAMADO: 'uso',
  CONVERTIDO: 'disponivel',
  CANCELADO: 'inativo',
}

export function LancamentosFuturos() {
  const { pode, usuario } = useSessao()
  const { avisar } = useToast()
  const { situacao, dado, recarregar } = useConsulta(() => api.lancamentosFuturos(), [])
  const [aberto, setAberto] = useState<Aberto>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<'todos' | StatusLancamento>('todos')
  const [filtroLado, setFiltroLado] = useState<'todos' | Lado>('todos')
  const [somenteExcecao, setSomenteExcecao] = useState(false)
  const [somenteElegivel, setSomenteElegivel] = useState(false)
  const [busca, setBusca] = useState('')

  const base = api.baseSincrona()
  const lancamentos = dado ?? []

  const programados = lancamentos.filter((l) => l.status === 'PROGRAMADO')
  const elegiveis = programados.filter((l) => elegivelParaConversao(l))
  const excecoes = lancamentos.filter(naFilaDeExcecao)

  const previstoSaida = programados
    .filter((l) => l.lado === 'PAGAR')
    .reduce((s, l) => s + l.valorPrevisto, 0)
  const previstoEntrada = programados
    .filter((l) => l.lado === 'RECEBER')
    .reduce((s, l) => s + l.valorPrevisto, 0)

  /*
   * A projeção de 30 dias vem da **mesma** função do painel de caixa.
   *
   * Recalcular aqui daria um segundo número para "quanto sai no mês", e a
   * divergência entre esta tela e o painel apareceria como um planejamento que
   * não fecha — que é exatamente o que a função única evita.
   */
  const projecao = useMemo(() => projetarCaixa(base, { dias: 30 }), [base, lancamentos])

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return lancamentos.filter((l) => {
      if (filtroStatus !== 'todos' && l.status !== filtroStatus) return false
      if (filtroLado !== 'todos' && l.lado !== filtroLado) return false
      if (somenteExcecao && !naFilaDeExcecao(l)) return false
      if (somenteElegivel && !elegivelParaConversao(l)) return false
      if (!t) return true
      const parte =
        base.clientes.find((c) => c.id === l.clienteId)?.nomeFantasia ??
        base.fornecedores.find((f) => f.id === l.fornecedorId)?.nomeFantasia ??
        ''
      return `${l.descricao} ${parte}`.toLowerCase().includes(t)
    })
  }, [lancamentos, filtroStatus, filtroLado, somenteExcecao, somenteElegivel, busca, base])

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

  const colunas: Coluna<LancamentoFuturo>[] = [
    {
      chave: 'descricao',
      titulo: 'Compromisso',
      identificadora: true,
      ordenarPor: (l) => l.descricao,
      celula: (l) => (
        <span className="pilha g0">
          <strong>{l.descricao}</strong>
          <span className="texto-atenuado">
            {ROTULO_TIPO_LANCAMENTO[l.tipo]}
            {l.recorrenciaId && ' · de uma série'}
          </span>
        </span>
      ),
    },
    {
      chave: 'lado',
      titulo: 'Lado',
      ocultarEmMobile: true,
      ordenarPor: (l) => l.lado,
      celula: (l) => (l.lado === 'PAGAR' ? 'a pagar' : 'a receber'),
    },
    {
      chave: 'valor',
      titulo: 'Previsto',
      numerico: true,
      ordenarPor: (l) => l.valorPrevisto,
      celula: (l) => moeda(l.valorPrevisto),
    },
    {
      chave: 'dataPrevista',
      titulo: 'Data prevista',
      ordenarPor: (l) => l.dataPrevista,
      celula: (l) => (
        <span className="pilha g0">
          {data(l.dataPrevista)}
          {elegivelParaConversao(l) && <span className="texto-atenuado">já venceu</span>}
        </span>
      ),
    },
    {
      chave: 'status',
      titulo: 'Situação',
      ordenarPor: (l) => l.status,
      celula: (l) => (
        <span className="pilha g1">
          <Chip severidade={SEVERIDADE[l.status]}>{ROTULO_STATUS_LANCAMENTO[l.status]}</Chip>
          {/*
            A exceção aparece como texto, não como status.
            Ela é o motivo pelo qual a conversão não aconteceu, e sai de cena sem
            que ninguém toque o lançamento — assim que o contrato volta a vigorar.
          */}
          {naFilaDeExcecao(l) && (
            <span className="texto-atenuado" style={{ maxWidth: '28ch' }}>
              {l.excecaoConversao}
              {l.tentativasConversao > 0 && ` (${l.tentativasConversao} tentativa(s))`}
            </span>
          )}
        </span>
      ),
    },
    {
      chave: 'acoes',
      titulo: 'Ações',
      celula: (l) => {
        if (l.status === 'CONVERTIDO') {
          return (
            <span className="texto-atenuado">
              virou título em {data(l.convertidoEm ?? l.dataPrevista)}
            </span>
          )
        }
        if (l.status === 'CANCELADO') return <span className="texto-atenuado">—</span>
        return (
          <span className="linha g1">
            {pode('financeiro:lancamento_manual') && (
              <>
                <Botao pequeno variante="sutil" onClick={() => setAberto({ tipo: 'editar', lancamento: l })}>
                  Editar<span className="so-leitor"> {l.descricao}</span>
                </Botao>
                <Botao pequeno variante="sutil" onClick={() => setAberto({ tipo: 'cancelar', lancamento: l })}>
                  Cancelar<span className="so-leitor"> {l.descricao}</span>
                </Botao>
              </>
            )}
            {podeConverter(l.lado) && (
              <Botao pequeno onClick={() => setAberto({ tipo: 'converter', lancamento: l })}>
                Converter<span className="so-leitor"> {l.descricao} em título</span>
              </Botao>
            )}
          </span>
        )
      },
    },
  ]

  function podeConverter(lado: Lado) {
    // A permissão é do lado, não da tela: quem pode lançar despesa não emite
    // cobrança. É a mesma regra que o serviço aplica no servidor.
    return lado === 'PAGAR' ? pode('pagar:criar') : pode('receber:criar')
  }

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Lançamentos futuros</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            O que está programado e ainda não é título. Um compromisso previsto se edita à vontade; o
            título gerado tem aprovação e rateio próprios — e é por isso que ele nasce só na conversão.
          </p>
        </div>
        <div className="linha g2">
          {pode('financeiro:lancamento_manual') && (
            <>
              <Botao onClick={() => setAberto({ tipo: 'serie' })}>Nova série</Botao>
              <Botao variante="primario" glifo="+" onClick={() => setAberto({ tipo: 'novo' })}>
                Novo lançamento
              </Botao>
            </>
          )}
        </div>
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica
            rotulo="Saída prevista"
            valor={moeda(previstoSaida)}
            contexto={`${programados.filter((l) => l.lado === 'PAGAR').length} compromisso(s)`}
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Entrada prevista"
            valor={moeda(previstoEntrada)}
            contexto={`${programados.filter((l) => l.lado === 'RECEBER').length} compromisso(s)`}
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Já venceu"
            valor={String(elegiveis.length)}
            contexto="pronto para converter em título"
            tendencia={elegiveis.length > 0 ? 'negativa' : 'neutra'}
          />
        </Cartao>
        {/*
          Métrica própria para a fila de exceção, e não uma linha na tabela.
          Um lançamento que falhou em silêncio não é revisto — e a razão de a fila
          existir é justamente que ninguém procura pelo que não avisou.
        */}
        <Cartao compacto>
          <Metrica
            rotulo="Na fila de exceção"
            valor={String(excecoes.length)}
            contexto="recusados por vigência de contrato"
            tendencia={excecoes.length > 0 ? 'negativa' : 'neutra'}
          />
        </Cartao>
      </div>

      {excecoes.length > 0 && (
        <Aviso
          tom="atencao"
          titulo={`${excecoes.length} lançamento(s) não converteram`}
          saidas={[
            'Filtre por "só a fila de exceção" para vê-los',
            'Reative ou renegocie o contrato: a conversão volta a passar sozinha',
          ]}
        >
          A conversão foi recusada porque o contrato vinculado não está vigente. Eles continuam
          programados: assim que o contrato voltar, convertem sem nova intervenção.
        </Aviso>
      )}

      {erro && (
        <Aviso tom="critico" titulo="A operação não foi concluída">
          {erro}
        </Aviso>
      )}

      <Cartao
        titulo="Efeito no caixa dos próximos 30 dias"
        comoRegiao
        acessorio={
          <span className="texto-atenuado">
            calculado agora, nunca guardado
          </span>
        }
      >
        <div className="grade grade--metricas">
          <Metrica rotulo="Saldo hoje" valor={moeda(projecao.saldoInicial)} />
          <Metrica
            rotulo="Saldo em 30 dias"
            valor={moeda(projecao.saldoFinal)}
            tendencia={projecao.saldoFinal < projecao.saldoInicial ? 'negativa' : 'positiva'}
          />
          <Metrica
            rotulo="Menor saldo da janela"
            valor={moeda(projecao.menorSaldo)}
            contexto={projecao.diaMenorSaldo ? `em ${data(projecao.diaMenorSaldo)}` : 'hoje'}
            tendencia={projecao.menorSaldo < 0 ? 'negativa' : 'neutra'}
          />
        </div>
        <p className="texto-atenuado" style={{ marginTop: 'var(--e2)' }}>
          O mesmo cálculo do painel de fluxo de caixa — uma função só, para as duas telas não darem
          respostas diferentes para "quanto entra em trinta dias".
        </p>
      </Cartao>

      <Cartao titulo="Compromissos programados" comoRegiao>
        <div className="filtros">
          <Entrada
            rotulo="Buscar por descrição, cliente ou fornecedor"
            rotuloOculto
            placeholder="Buscar compromisso…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <Selecao
            rotulo="Situação"
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value as 'todos' | StatusLancamento)}
            opcoes={[
              { valor: 'todos', texto: 'Todas as situações' },
              ...(['PROGRAMADO', 'CONVERTIDO', 'CANCELADO'] as StatusLancamento[]).map((s) => ({
                valor: s,
                texto: ROTULO_STATUS_LANCAMENTO[s],
              })),
            ]}
          />
          <Selecao
            rotulo="Lado"
            value={filtroLado}
            onChange={(e) => setFiltroLado(e.target.value as 'todos' | Lado)}
            opcoes={[
              { valor: 'todos', texto: 'Os dois lados' },
              { valor: 'PAGAR', texto: 'A pagar' },
              { valor: 'RECEBER', texto: 'A receber' },
            ]}
          />
          <label className="alternador">
            <input
              type="checkbox"
              checked={somenteElegivel}
              onChange={(e) => setSomenteElegivel(e.target.checked)}
            />
            Só o que já venceu
          </label>
          <label className="alternador">
            <input
              type="checkbox"
              checked={somenteExcecao}
              onChange={(e) => setSomenteExcecao(e.target.checked)}
            />
            Só a fila de exceção
          </label>
        </div>

        {situacao === 'carregando' ? (
          <Skeleton linhas={6} />
        ) : (
          <Tabela
            legenda={somenteExcecao ? 'Fila de exceção de conversão' : 'Compromissos programados'}
            colunas={colunas}
            itens={visiveis}
            chaveDe={(l) => l.id}
            vazio={
              somenteExcecao
                ? {
                    titulo: 'Nenhum lançamento na fila de exceção',
                    texto: 'Todas as conversões passaram — nenhum contrato barrou a geração.',
                  }
                : {
                    titulo: 'Nenhum compromisso com estes filtros',
                    texto: 'Ajuste a situação, o lado ou a busca.',
                  }
            }
          />
        )}
      </Cartao>

      <Cartao titulo="Séries recorrentes" comoRegiao>
        <p className="texto-secundario medida-leitura">
          A série é o molde; cada lançamento é uma instância. Gerar produz <strong>um</strong> período por
          vez — o lote inteiro criaria anos de compromissos que aparecem na projeção como firmes, quando o
          contrato pode nem existir mais.
        </p>
        <SeriesRecorrentes aoAgir={agir} podeEditar={pode('financeiro:lancamento_manual')} />
      </Cartao>

      {aberto?.tipo === 'novo' && (
        <DialogoLancamento
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({ tom: 'ok', titulo: 'Compromisso programado' })
          }}
        />
      )}

      {aberto?.tipo === 'serie' && (
        <DialogoSerie
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({ tom: 'ok', titulo: 'Série criada' })
          }}
        />
      )}

      {aberto?.tipo === 'editar' && (
        <DialogoEdicao
          lancamento={aberto.lancamento}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({ tom: 'ok', titulo: 'Compromisso atualizado' })
          }}
        />
      )}

      {aberto?.tipo === 'cancelar' && (
        <DialogoCancelamento
          lancamento={aberto.lancamento}
          aoFechar={() => setAberto(null)}
          aoConfirmar={async (motivo) => {
            await agir(() => api.cancelarLancamentoFuturo(aberto.lancamento.id, motivo), 'Compromisso cancelado')
            setAberto(null)
          }}
        />
      )}

      {aberto?.tipo === 'converter' && (
        <DialogoConversao
          lancamento={aberto.lancamento}
          aoFechar={() => setAberto(null)}
          aoConfirmar={async () => {
            setErro(null)
            const r = await api.converterLancamentoFuturo(aberto.lancamento.id, usuario.id)
            if (!r.ok) {
              setErro(r.erro!.mensagem)
              setAberto(null)
              return
            }
            recarregar()
            /*
             * Recusa por vigência não é erro, e o aviso diz isso.
             *
             * Um toast de falha aqui treinaria o operador a tratar como problema
             * o comportamento correto — e a esconder a mensagem que explica o
             * que fazer com o contrato.
             */
            if (r.valor.excecao) {
              avisar({
                tom: 'atencao',
                titulo: 'Não convertido, e continua programado',
                texto: r.valor.excecao,
              })
            } else {
              avisar({
                tom: 'ok',
                titulo: 'Título gerado',
                texto: r.valor.proximoLancamentoId
                  ? 'A série já programou o próximo período.'
                  : undefined,
              })
            }
            setAberto(null)
          }}
        />
      )}
    </>
  )
}

/* --------------------------------------------------------- séries */

function SeriesRecorrentes({
  aoAgir,
  podeEditar,
}: {
  aoAgir: (fn: () => Promise<{ ok: boolean; erro?: { mensagem: string } }>, ok: string) => Promise<void>
  podeEditar: boolean
}) {
  const { usuario } = useSessao()
  const { situacao, dado, recarregar } = useConsulta(() => api.recorrencias(), [])
  const series = dado ?? []
  const base = api.baseSincrona()

  if (situacao === 'carregando') return <Skeleton linhas={3} />
  if (series.length === 0) return <p className="texto-atenuado">Nenhuma série cadastrada.</p>

  return (
    <Tabela
      legenda="Séries recorrentes"
      colunas={[
        {
          chave: 'descricao',
          titulo: 'Série',
          identificadora: true,
          celula: (r) => (
            <span className="pilha g0">
              <strong>{r.descricao}</strong>
              <span className="texto-atenuado">
                {ROTULO_PERIODICIDADE[r.periodicidade]} · dia {r.diaVencimento} ·{' '}
                {r.lado === 'PAGAR' ? 'a pagar' : 'a receber'}
              </span>
            </span>
          ),
        },
        { chave: 'valor', titulo: 'Valor base', numerico: true, celula: (r) => moeda(r.valorBase) },
        {
          chave: 'proxima',
          titulo: 'Próxima geração',
          celula: (r) => (
            <span className="pilha g0">
              {data(r.proximaGeracao)}
              <span className="texto-atenuado">
                depois: {data(avancarPeriodicidade(r.proximaGeracao, r.periodicidade))}
              </span>
            </span>
          ),
        },
        {
          chave: 'geradas',
          titulo: 'Geradas',
          numerico: true,
          celula: (r) =>
            String(base.lancamentosFuturos.filter((l) => l.recorrenciaId === r.id).length),
        },
        {
          chave: 'situacao',
          titulo: 'Situação',
          celula: (r) => (
            <Chip severidade={r.ativo ? 'disponivel' : 'inativo'}>{r.ativo ? 'ativa' : 'desativada'}</Chip>
          ),
        },
        {
          chave: 'acoes',
          titulo: 'Ações',
          celula: (r) =>
            podeEditar ? (
              <span className="linha g1">
                <Botao
                  pequeno
                  onClick={async () => {
                    await aoAgir(
                      () => api.gerarProximoLancamento(r.id, usuario.id),
                      r.ativo ? 'Próximo período programado' : 'Série desativada: nada a gerar',
                    )
                    recarregar()
                  }}
                >
                  Gerar próximo<span className="so-leitor"> de {r.descricao}</span>
                </Botao>
                <Botao
                  pequeno
                  variante="sutil"
                  onClick={async () => {
                    await aoAgir(
                      () => api.alternarRecorrencia(r.id, !r.ativo),
                      r.ativo ? 'Série desativada' : 'Série reativada',
                    )
                    recarregar()
                  }}
                >
                  {r.ativo ? 'Desativar' : 'Reativar'}
                  <span className="so-leitor"> {r.descricao}</span>
                </Botao>
              </span>
            ) : (
              <span className="texto-atenuado">—</span>
            ),
        },
      ]}
      itens={series}
      chaveDe={(r) => r.id}
      vazio={{ titulo: 'Nenhuma série cadastrada' }}
    />
  )
}

/* --------------------------------------------------- diálogo: novo lançamento */

const TIPOS: TipoLancamento[] = [
  'DESPESA_RECORRENTE',
  'DESPESA_PARCELADA',
  'PROVISAO',
  'RECEITA_RECORRENTE',
  'RECEITA_PARCELADA',
]

function DialogoLancamento({ aoFechar, aoSalvar }: { aoFechar: () => void; aoSalvar: () => void }) {
  const { usuario } = useSessao()
  const base = api.baseSincrona()
  const hoje = new Date().toISOString().slice(0, 10)

  const form = useFormulario({
    inicial: {
      tipo: 'DESPESA_RECORRENTE' as TipoLancamento,
      descricao: '',
      valorPrevisto: 0,
      dataPrevista: hoje,
      fornecedorId: base.fornecedores[0]?.id ?? '',
      clienteId: base.clientes[0]?.id ?? '',
      classificacao: 'DESPESA_FIXA' as 'DESPESA_FIXA' | 'DESPESA_VARIAVEL' | 'INVESTIMENTO',
      centroCustoId: '',
      contratoId: '',
      filialId: '',
    },
    validar: (v) => ({
      descricao:
        v.descricao.trim().length < 3 ? 'Descreva o compromisso — alguém vai revisá-lo depois.' : undefined,
      valorPrevisto: v.valorPrevisto <= 0 ? 'Informe o valor previsto.' : undefined,
    }),
    aoEnviar: (v) => {
      const lado = ladoDoTipo(v.tipo)
      return api.criarLancamentoFuturo(usuario.id, {
        tipo: v.tipo,
        descricao: v.descricao,
        valorPrevisto: v.valorPrevisto,
        dataPrevista: v.dataPrevista,
        // Os campos do outro lado vão nulos, e não em branco: é o discriminador
        // que decide quais existem, não o formulário que os deixou vazios.
        fornecedorId: lado === 'PAGAR' ? v.fornecedorId || null : null,
        clienteId: lado === 'RECEBER' ? v.clienteId || null : null,
        classificacao: lado === 'PAGAR' ? v.classificacao : null,
        centroCustoId: v.centroCustoId || null,
        contratoId: v.contratoId || null,
        filialId: v.filialId || null,
      })
    },
    aoConcluir: aoSalvar,
  })

  const lado = ladoDoTipo(form.valores.tipo)

  return (
    <Dialogo
      titulo="Novo lançamento futuro"
      descricao="Um compromisso programado. Ele não é título ainda — e é por isso que se edita sem reabrir aprovação."
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={form.enviar} disabled={form.enviando}>
            Programar
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ descricao: 'Descrição', valorPrevisto: 'Valor previsto' }}
          refResumo={form.refResumo}
        />

        <div className="pilha g3">
          <Combo
            rotulo="Tipo"
            nome="tipo"
            dica="O tipo decide o lado: provisão e despesa saem, receita entra."
            opcoes={TIPOS.map((t) => ({
              valor: t,
              texto: ROTULO_TIPO_LANCAMENTO[t],
              detalhe: ladoDoTipo(t) === 'PAGAR' ? 'a pagar' : 'a receber',
            }))}
            valor={form.valores.tipo}
            aoMudar={(v) => form.definir('tipo', v as TipoLancamento)}
          />

          <Entrada
            rotulo="Descrição"
            nome="descricao"
            dica="Vai ser lida meses depois por quem revisa o planejamento."
            value={form.valores.descricao}
            onChange={(e) => form.definir('descricao', e.target.value)}
            {...form.campo('descricao')}
          />

          <LinhaCampos>
            <CampoMoeda
              rotulo="Valor previsto"
              nome="valorPrevisto"
              valor={form.valores.valorPrevisto}
              aoMudar={(v) => form.definir('valorPrevisto', v)}
              {...form.campo('valorPrevisto')}
            />
            <Entrada
              rotulo="Data prevista"
              nome="dataPrevista"
              type="date"
              dica="Vira o vencimento do título quando converter."
              value={form.valores.dataPrevista}
              onChange={(e) => form.definir('dataPrevista', e.target.value)}
            />
          </LinhaCampos>

          {/*
            Os campos do lado. Um só conjunto por vez, e não os dois com metade
            desabilitada: campo desabilitado ainda é campo, e sugere que o
            compromisso poderia ter fornecedor **e** cliente.
          */}
          {lado === 'PAGAR' ? (
            <>
              <Combo
                rotulo="Fornecedor"
                nome="fornecedorId"
                opcoes={base.fornecedores.map((f) => ({ valor: f.id, texto: f.nomeFantasia }))}
                valor={form.valores.fornecedorId}
                aoMudar={(v) => form.definir('fornecedorId', v)}
              />
              <GrupoOpcoes
                legenda="Classificação"
                opcoes={[
                  { valor: 'DESPESA_FIXA', texto: 'Despesa fixa' },
                  { valor: 'DESPESA_VARIAVEL', texto: 'Despesa variável' },
                  { valor: 'INVESTIMENTO', texto: 'Investimento' },
                ]}
                valor={form.valores.classificacao}
                aoMudar={(v) => form.definir('classificacao', v as 'DESPESA_FIXA')}
              />
            </>
          ) : (
            <Combo
              rotulo="Cliente"
              nome="clienteId"
              opcoes={base.clientes.map((c) => ({ valor: c.id, texto: c.nomeFantasia }))}
              valor={form.valores.clienteId}
              aoMudar={(v) => form.definir('clienteId', v)}
            />
          )}

          <LinhaCampos>
            <Combo
              rotulo="Centro de custo"
              nome="centroCustoId"
              opcoes={[
                { valor: '', texto: 'Sem centro de custo' },
                ...base.centrosCusto
                  .filter((c) => c.ativo)
                  .map((c) => ({ valor: c.id, texto: `${c.codigo} — ${c.nome}` })),
              ]}
              valor={form.valores.centroCustoId}
              aoMudar={(v) => form.definir('centroCustoId', v)}
            />
            <Combo
              rotulo="Filial"
              nome="filialId"
              dica="É o recorte em que a projeção de caixa filtra."
              opcoes={[
                { valor: '', texto: 'Sem filial' },
                ...base.filiais.map((f) => ({ valor: f.id, texto: f.nome })),
              ]}
              valor={form.valores.filialId}
              aoMudar={(v) => form.definir('filialId', v)}
            />
          </LinhaCampos>

          <Combo
            rotulo="Contrato"
            nome="contratoId"
            dica="Se houver contrato, a conversão confere a vigência dele no momento em que acontecer."
            opcoes={[
              { valor: '', texto: 'Sem contrato' },
              ...base.contratos.map((c) => ({ valor: c.id, texto: c.numero, detalhe: c.status })),
            ]}
            valor={form.valores.contratoId}
            aoMudar={(v) => form.definir('contratoId', v)}
          />
        </div>
      </form>
    </Dialogo>
  )
}

/* ------------------------------------------------------- diálogo: nova série */

function DialogoSerie({ aoFechar, aoSalvar }: { aoFechar: () => void; aoSalvar: () => void }) {
  const base = api.baseSincrona()
  const hoje = new Date().toISOString().slice(0, 10)

  const form = useFormulario({
    inicial: {
      lado: 'PAGAR' as Lado,
      descricao: '',
      valorBase: 0,
      periodicidade: 'MENSAL' as Periodicidade,
      diaVencimento: 10,
      proximaGeracao: hoje,
      fornecedorId: base.fornecedores[0]?.id ?? '',
      clienteId: base.clientes[0]?.id ?? '',
      classificacao: 'DESPESA_FIXA' as 'DESPESA_FIXA' | 'DESPESA_VARIAVEL' | 'INVESTIMENTO',
    },
    validar: (v) => ({
      descricao: v.descricao.trim().length < 3 ? 'Descreva a série.' : undefined,
      valorBase: v.valorBase <= 0 ? 'Informe o valor base.' : undefined,
      diaVencimento:
        v.diaVencimento < 1 || v.diaVencimento > 28
          ? 'O dia do vencimento vai de 1 a 28 — 29, 30 e 31 não existem em todo mês.'
          : undefined,
    }),
    aoEnviar: (v) =>
      api.criarRecorrencia({
        lado: v.lado,
        descricao: v.descricao,
        valorBase: v.valorBase,
        periodicidade: v.periodicidade,
        diaVencimento: v.diaVencimento,
        proximaGeracao: v.proximaGeracao,
        fornecedorId: v.lado === 'PAGAR' ? v.fornecedorId || null : null,
        clienteId: v.lado === 'RECEBER' ? v.clienteId || null : null,
        classificacao: v.lado === 'PAGAR' ? v.classificacao : null,
      }),
    aoConcluir: aoSalvar,
  })

  return (
    <Dialogo
      titulo="Nova série recorrente"
      descricao="O molde do compromisso periódico. Cada geração produz um período — nunca o lote."
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={form.enviar} disabled={form.enviando}>
            Criar série
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
            valorBase: 'Valor base',
            diaVencimento: 'Dia do vencimento',
          }}
          refResumo={form.refResumo}
        />

        <div className="pilha g3">
          <GrupoOpcoes
            legenda="Lado"
            opcoes={[
              { valor: 'PAGAR', texto: 'A pagar' },
              { valor: 'RECEBER', texto: 'A receber' },
            ]}
            valor={form.valores.lado}
            aoMudar={(v) => form.definir('lado', v as Lado)}
          />

          <Entrada
            rotulo="Descrição"
            nome="descricao"
            value={form.valores.descricao}
            onChange={(e) => form.definir('descricao', e.target.value)}
            {...form.campo('descricao')}
          />

          <LinhaCampos>
            <CampoMoeda
              rotulo="Valor base"
              nome="valorBase"
              dica="Vale para o próximo período. Alterá-lo não muda o que já foi programado."
              valor={form.valores.valorBase}
              aoMudar={(v) => form.definir('valorBase', v)}
              {...form.campo('valorBase')}
            />
            <Combo
              rotulo="Periodicidade"
              nome="periodicidade"
              opcoes={(['MENSAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'] as Periodicidade[]).map((p) => ({
                valor: p,
                texto: ROTULO_PERIODICIDADE[p],
              }))}
              valor={form.valores.periodicidade}
              aoMudar={(v) => form.definir('periodicidade', v as Periodicidade)}
            />
          </LinhaCampos>

          <LinhaCampos>
            <CampoNumero
              rotulo="Dia do vencimento"
              nome="diaVencimento"
              min={1}
              max={28}
              dica="Até 28: 29, 30 e 31 não existem em todo mês, e o comportamento em fevereiro não está definido."
              valor={form.valores.diaVencimento}
              aoMudar={(v) => form.definir('diaVencimento', v)}
              {...form.campo('diaVencimento')}
            />
            <Entrada
              rotulo="Próxima geração"
              nome="proximaGeracao"
              type="date"
              value={form.valores.proximaGeracao}
              onChange={(e) => form.definir('proximaGeracao', e.target.value)}
            />
          </LinhaCampos>

          {form.valores.lado === 'PAGAR' ? (
            <>
              <Combo
                rotulo="Fornecedor"
                nome="fornecedorId"
                opcoes={base.fornecedores.map((f) => ({ valor: f.id, texto: f.nomeFantasia }))}
                valor={form.valores.fornecedorId}
                aoMudar={(v) => form.definir('fornecedorId', v)}
              />
              <GrupoOpcoes
                legenda="Classificação"
                opcoes={[
                  { valor: 'DESPESA_FIXA', texto: 'Despesa fixa' },
                  { valor: 'DESPESA_VARIAVEL', texto: 'Despesa variável' },
                  { valor: 'INVESTIMENTO', texto: 'Investimento' },
                ]}
                valor={form.valores.classificacao}
                aoMudar={(v) => form.definir('classificacao', v as 'DESPESA_FIXA')}
              />
            </>
          ) : (
            <Combo
              rotulo="Cliente"
              nome="clienteId"
              opcoes={base.clientes.map((c) => ({ valor: c.id, texto: c.nomeFantasia }))}
              valor={form.valores.clienteId}
              aoMudar={(v) => form.definir('clienteId', v)}
            />
          )}
        </div>
      </form>
    </Dialogo>
  )
}

/* ---------------------------------------------------------- diálogo: editar */

function DialogoEdicao({
  lancamento,
  aoFechar,
  aoSalvar,
}: {
  lancamento: LancamentoFuturo
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const form = useFormulario({
    inicial: {
      descricao: lancamento.descricao,
      valorPrevisto: lancamento.valorPrevisto,
      dataPrevista: lancamento.dataPrevista,
    },
    validar: (v) => ({
      descricao: v.descricao.trim().length < 3 ? 'Descreva o compromisso.' : undefined,
      valorPrevisto: v.valorPrevisto <= 0 ? 'Informe o valor previsto.' : undefined,
    }),
    aoEnviar: (v) =>
      api.editarLancamentoFuturo(lancamento.id, {
        descricao: v.descricao,
        valorPrevisto: v.valorPrevisto,
        dataPrevista: v.dataPrevista,
      }),
    aoConcluir: aoSalvar,
  })

  return (
    <Dialogo
      titulo="Editar compromisso"
      descricao="Programado se edita livremente. Depois de convertido, o que muda é o título gerado."
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={form.enviar} disabled={form.enviando}>
            Salvar
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ descricao: 'Descrição', valorPrevisto: 'Valor previsto' }}
          refResumo={form.refResumo}
        />
        <div className="pilha g3">
          <Entrada
            rotulo="Descrição"
            nome="descricao"
            value={form.valores.descricao}
            onChange={(e) => form.definir('descricao', e.target.value)}
            {...form.campo('descricao')}
          />
          <LinhaCampos>
            <CampoMoeda
              rotulo="Valor previsto"
              nome="valorPrevisto"
              valor={form.valores.valorPrevisto}
              aoMudar={(v) => form.definir('valorPrevisto', v)}
              {...form.campo('valorPrevisto')}
            />
            <Entrada
              rotulo="Data prevista"
              nome="dataPrevista"
              type="date"
              value={form.valores.dataPrevista}
              onChange={(e) => form.definir('dataPrevista', e.target.value)}
            />
          </LinhaCampos>
        </div>
      </form>
    </Dialogo>
  )
}

/* ------------------------------------------------------- diálogo: cancelar */

function DialogoCancelamento({
  lancamento,
  aoFechar,
  aoConfirmar,
}: {
  lancamento: LancamentoFuturo
  aoFechar: () => void
  aoConfirmar: (motivo: string) => Promise<void>
}) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const curto = motivo.trim().length < 5

  return (
    <Dialogo
      titulo="Cancelar compromisso"
      descricao="Cancelar é definitivo: um compromisso cancelado não volta a programado nem gera título."
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao
            variante="perigo"
            disabled={curto || enviando}
            motivoDesabilitado={curto ? 'Explique por que o compromisso não vai acontecer.' : undefined}
            onClick={async () => {
              setEnviando(true)
              await aoConfirmar(motivo)
              setEnviando(false)
            }}
          >
            Cancelar compromisso
          </Botao>
        </>
      }
    >
      <div className="pilha g3">
        <p>
          <strong>{lancamento.descricao}</strong> — {moeda(lancamento.valorPrevisto)} previsto para{' '}
          {data(lancamento.dataPrevista)}.
        </p>
        <AreaTexto
          rotulo="Por que o compromisso não vai acontecer"
          nome="motivo"
          dica="Fica no histórico do planejamento; mínimo de 5 caracteres."
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
    </Dialogo>
  )
}

/* ------------------------------------------------------ diálogo: converter */

/**
 * O diálogo que mostra o que vai ser criado, antes de criar.
 *
 * Ele **não** converte para simular: a prévia é leitura pura. Se ela chamasse a
 * conversão, abrir e desistir subiria o contador de tentativas e gravaria uma
 * exceção que nunca houve.
 */
function DialogoConversao({
  lancamento,
  aoFechar,
  aoConfirmar,
}: {
  lancamento: LancamentoFuturo
  aoFechar: () => void
  aoConfirmar: () => Promise<void>
}) {
  const base = api.baseSincrona()
  const [enviando, setEnviando] = useState(false)
  const previa = previaDeConversao(base, lancamento)

  return (
    <Dialogo
      titulo="Converter em título"
      descricao="A conversão ocorre uma vez. Confira o que vai ser criado antes de confirmar."
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao
            variante="primario"
            disabled={previa.impedimento !== null || enviando}
            motivoDesabilitado={previa.impedimento ?? undefined}
            onClick={async () => {
              setEnviando(true)
              await aoConfirmar()
              setEnviando(false)
            }}
          >
            Gerar o título
          </Botao>
        </>
      }
    >
      <div className="pilha g3">
        {previa.impedimento && (
          <Aviso tom="atencao" titulo="A conversão vai ser recusada">
            {previa.impedimento} O compromisso continua programado e converte sozinho quando a situação
            se resolver — não é preciso recriá-lo.
          </Aviso>
        )}

        <dl className="descricoes">
          <div>
            <dt>Vai gerar</dt>
            <dd>{previa.lado === 'PAGAR' ? 'um título a pagar' : 'uma cobrança a receber'}</dd>
          </div>
          <div>
            <dt>Descrição</dt>
            <dd>{previa.descricao}</dd>
          </div>
          <div>
            <dt>Valor</dt>
            <dd>{moeda(previa.valorPrevisto)}</dd>
          </div>
          <div>
            <dt>Vencimento</dt>
            <dd>{data(previa.dataVencimento)}</dd>
          </div>
          <div>
            <dt>Aprovações necessárias</dt>
            {/*
              A conversão automática não dispensa a alçada. Dizer o número aqui é
              o que evita a surpresa de o título nascer travado em aprovação.
            */}
            <dd>
              {previa.niveisAprovacao === 0
                ? 'nenhuma — o valor está abaixo da primeira faixa'
                : `${previa.niveisAprovacao} nível(is) — geração automática não dispensa quem confere`}
            </dd>
          </div>
          {previa.proximaDataPrevista && (
            <div>
              <dt>A série programa em seguida</dt>
              <dd>{data(previa.proximaDataPrevista)}</dd>
            </div>
          )}
        </dl>

        <p className="texto-atenuado">
          Depois de convertido, este compromisso passa a ser registro histórico: o que se edita é o
          título gerado, que é onde a despesa vive.
        </p>
      </div>
    </Dialogo>
  )
}
