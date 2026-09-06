import { api } from './api'
import { categoriaPorCodigo, modeloPorId, nomeModelo, regiaoPorId } from './catalogo'
import { HOJE, iso } from './gerar'
import { ehAbertoReceber, saldoReceber } from './receber'
import type {
  BaseDados,
  Cliente,
  Equipamento,
  LimiarExecucao,
  MedicaoCompetencia,
  Orcamento,
  OrdemServico,
  Peca,
  StatusPagar,
  TituloPagar,
  TituloReceber,
} from './tipos'

/**
 * Consultas derivadas.
 *
 * Cálculo de negócio fica aqui, não nas telas: a tela decide o que mostrar, esta
 * camada decide o que os números significam. Evita a mesma regra reimplementada
 * de forma ligeiramente diferente em três lugares.
 */

const base = () => api.baseSincrona()

/* ------------------------------------------------------------------ frota */

export interface LinhaParque {
  equipamento: Equipamento
  modelo: string
  categoriaNome: string
  familia: string
  clienteNome: string | null
  regiaoNome: string
  consumoMes: number
  margem: number
  margemPercentual: number
}

export function linhasParque(): LinhaParque[] {
  const b = base()
  const compAtual = b.indicadores.serieReceita[b.indicadores.serieReceita.length - 1].competencia

  return b.equipamentos.map((e) => {
    const cat = categoriaPorCodigo.get(e.categoria)!
    const cliente = e.clienteId ? b.clientes.find((c) => c.id === e.clienteId) : null
    const leitura = e.historicoConsumo.find((h) => h.competencia === compAtual)
    const margem = e.receita12m - e.custoManutencao12m
    return {
      equipamento: e,
      modelo: nomeModelo(e.modeloId),
      categoriaNome: cat.nome,
      familia: cat.familia,
      clienteNome: cliente?.nomeFantasia ?? null,
      regiaoNome: regiaoPorId.get(e.regiaoId)?.nome ?? '—',
      consumoMes: leitura ? leitura.mono + leitura.color : 0,
      margem,
      margemPercentual: e.receita12m > 0 ? margem / e.receita12m : 0,
    }
  })
}

/* --------------------------------------------------------------- chamados */

export interface LinhaChamado {
  ordem: OrdemServico
  patrimonio: string
  modelo: string
  clienteNome: string | null
  tecnicoNome: string | null
  restanteHoras: number
  emRisco: boolean
  estourado: boolean
}

export function linhasChamados(): LinhaChamado[] {
  const b = base()
  return b.ordens
    .filter((o) => !['VALIDADA', 'CANCELADA'].includes(o.status))
    .map((o) => {
      const eq = b.equipamentos.find((e) => e.id === o.equipamentoId)
      const cliente = o.clienteId ? b.clientes.find((c) => c.id === o.clienteId) : null
      const tecnico = o.tecnicoId ? b.tecnicos.find((t) => t.id === o.tecnicoId) : null
      const restante = (new Date(o.prazoSolucaoEm).getTime() - HOJE.getTime()) / 3600000
      return {
        ordem: o,
        patrimonio: eq?.patrimonio ?? '—',
        modelo: eq ? nomeModelo(eq.modeloId) : '—',
        clienteNome: cliente?.nomeFantasia ?? null,
        tecnicoNome: tecnico?.nome ?? null,
        restanteHoras: restante,
        emRisco: restante > 0 && restante < 4,
        estourado: restante <= 0,
      }
    })
    .sort((a, b2) => a.restanteHoras - b2.restanteHoras)
}

/* ---------------------------------------------------------------- estoque */

export interface LinhaPeca {
  peca: Peca
  disponivel: number
  cobertura: number
  situacao: 'ZERADO' | 'ABAIXO_MINIMO' | 'PONTO_PEDIDO' | 'NORMAL'
  osImpactadas: number
  sugestaoCompra: number
}

export function linhasEstoque(): LinhaPeca[] {
  const b = base()
  const aguardandoPeca = b.ordens.filter((o) => o.status === 'AGUARDANDO_PECA')

  return b.pecas.map((p) => {
    const disponivel = p.saldo - p.reservado
    const consumoDiario = p.consumo12m / 365
    const cobertura = consumoDiario > 0 ? disponivel / consumoDiario : 999

    let situacao: LinhaPeca['situacao'] = 'NORMAL'
    if (p.saldo === 0) situacao = 'ZERADO'
    else if (p.saldo < p.estoqueMinimo) situacao = 'ABAIXO_MINIMO'
    else if (p.saldo <= p.pontoPedido) situacao = 'PONTO_PEDIDO'

    // Sugestão de compra: repõe até o dobro do ponto de pedido, cobrindo o
    // prazo do fornecedor — quem tem lead time longo pede mais.
    const alvo = p.pontoPedido * 2 + Math.ceil(consumoDiario * p.leadTimeDias)
    const sugestao = situacao === 'NORMAL' ? 0 : Math.max(0, alvo - p.saldo)

    const impactadas = aguardandoPeca.filter((o) => {
      const eq = b.equipamentos.find((e) => e.id === o.equipamentoId)
      return eq ? p.aplicacao.includes(eq.categoria) : false
    }).length

    return { peca: p, disponivel, cobertura, situacao, osImpactadas: situacao === 'NORMAL' ? 0 : impactadas, sugestaoCompra: sugestao }
  })
}

/* --------------------------------------------------------------- clientes */

export interface LinhaCliente {
  cliente: Cliente
  contratos: number
  equipamentos: number
  mrr: number
  paginasMes: number
  custoManutencao12m: number
  margemPercentual: number
  aberto: number
  vencido: number
  regiaoNome: string
}

export function linhasClientes(): LinhaCliente[] {
  const b = base()
  const compAtual = b.indicadores.serieReceita[b.indicadores.serieReceita.length - 1].competencia
  const hojeIso = iso(HOJE)

  return b.clientes
    .map((c) => {
      const contratos = b.contratos.filter(
        (ct) => ct.clienteId === c.id && ['ATIVO', 'EM_RENOVACAO', 'VENCIDO_EM_CAMPO'].includes(ct.status),
      )
      const equipamentos = b.equipamentos.filter((e) => e.clienteId === c.id)
      const mrr = contratos.flatMap((ct) => ct.itens).reduce((a, i) => a + i.valorMensal, 0)
      const paginasMes = equipamentos.reduce((a, e) => {
        const l = e.historicoConsumo.find((h) => h.competencia === compAtual)
        return a + (l ? l.mono + l.color : 0)
      }, 0)
      const custo = equipamentos.reduce((a, e) => a + e.custoManutencao12m, 0)
      const receita12m = equipamentos.reduce((a, e) => a + e.receita12m, 0)
      /*
       * A carteira do cliente sai do **título**, que é onde a cobrança vive, e
       * pelas mesmas funções que a tela de Contas a receber usa. Enquanto saía
       * do modelo de fatura, esta tela somava uma coleção e aquela somava outra.
       */
      const emAberto = b.titulosReceber.filter(
        (t) => t.clienteId === c.id && ehAbertoReceber(t.status),
      )
      const aberto = emAberto.reduce((a, t) => a + saldoReceber(t), 0)
      const vencido = emAberto
        .filter((t) => t.dataVencimento < hojeIso)
        .reduce((a, t) => a + saldoReceber(t), 0)

      return {
        cliente: c,
        contratos: contratos.length,
        equipamentos: equipamentos.length,
        mrr,
        paginasMes,
        custoManutencao12m: custo,
        margemPercentual: receita12m > 0 ? (receita12m - custo) / receita12m : 0,
        aberto,
        vencido,
        regiaoNome: regiaoPorId.get(c.regiaoId)?.nome ?? '—',
      }
    })
    .filter((l) => l.equipamentos > 0 || l.contratos > 0)
}

/* ------------------------------------------------------------ faturamento */

/**
 * Uma linha do ciclo de faturamento: a medição, e a cobrança dela **quando já
 * existe**.
 *
 * A âncora é a medição, não o título, e é o que faz a competência aberta
 * aparecer na tela: ela foi medida e ainda não foi cobrada — que é exatamente o
 * que "aberta" significa. Uma lista de títulos não teria como mostrá-la, e o
 * fechamento é o que esta tela existe para operar.
 *
 * `titulo` nulo é informação, não ausência de dado.
 */
export interface LinhaCobranca {
  medicao: MedicaoCompetencia
  titulo: TituloReceber | null
  clienteNome: string
  contratoNumero: string
  /** Nulo enquanto não há cobrança: não se deve saldo do que não foi cobrado. */
  saldo: number | null
  atrasada: boolean
}

export function linhasCobranca(): LinhaCobranca[] {
  const b = base()
  const hojeIso = iso(HOJE)
  const contratuais = b.titulosReceber.filter((t) => t.origem === 'CONTRATUAL')

  return b.medicoes.map((m) => {
    const titulo =
      contratuais.find((t) => t.contratoId === m.contratoId && t.competencia === m.competencia) ??
      null
    return {
      medicao: m,
      titulo,
      clienteNome: b.clientes.find((c) => c.id === m.clienteId)?.nomeFantasia ?? '—',
      contratoNumero: b.contratos.find((c) => c.id === m.contratoId)?.numero ?? '—',
      saldo: titulo ? saldoReceber(titulo) : null,
      // Atraso é a data, nunca um estado guardado: no dia seguinte ao vencimento
      // um campo estaria errado, e só um job noturno o corrigiria.
      atrasada: titulo !== null && ehAbertoReceber(titulo.status) && titulo.dataVencimento < hojeIso,
    }
  })
}

/** Itens da competência corrente que fugiram do padrão e pedem conferência. */
export function excecoesFechamento() {
  const b = base()
  const comps = b.indicadores.serieReceita.map((s) => s.competencia)
  const atual = comps[comps.length - 1]
  const anterior = comps[comps.length - 2]

  const emFechamento = b.medicoes.filter((m) => m.competencia === atual)
  const resultado: {
    medicao: MedicaoCompetencia
    clienteNome: string
    contratoNumero: string
    motivo: string
    severidade: 'critico' | 'atencao'
  }[] = []
  const numeroDoContrato = (id: string) => b.contratos.find((c) => c.id === id)?.numero ?? '—'

  for (const f of emFechamento) {
    const cliente = b.clientes.find((c) => c.id === f.clienteId)!
    const anteriorDoContrato = b.medicoes.find(
      (x) => x.contratoId === f.contratoId && x.competencia === anterior,
    )

    if (anteriorDoContrato && anteriorDoContrato.valorLiquido > 0) {
      const var_ = (f.valorLiquido - anteriorDoContrato.valorLiquido) / anteriorDoContrato.valorLiquido
      if (Math.abs(var_) > 0.35) {
        resultado.push({
          medicao: f,
          clienteNome: cliente.nomeFantasia,
          contratoNumero: numeroDoContrato(f.contratoId),
          motivo: `variação de ${var_ > 0 ? '+' : '−'}${Math.abs(var_ * 100).toFixed(0)}% sobre a competência anterior`,
          severidade: Math.abs(var_) > 0.6 ? 'critico' : 'atencao',
        })
        continue
      }
    }
    if (!anteriorDoContrato) {
      resultado.push({
        medicao: f,
        clienteNome: cliente.nomeFantasia,
        contratoNumero: numeroDoContrato(f.contratoId),
        motivo: 'primeira competência do contrato — cobrança proporcional',
        severidade: 'atencao',
      })
      continue
    }
    if (cliente.situacaoCredito === 'BLOQUEADO') {
      resultado.push({
        medicao: f,
        clienteNome: cliente.nomeFantasia,
        contratoNumero: numeroDoContrato(f.contratoId),
        motivo: `cliente bloqueado com ${cliente.diasAtrasoMaximo} dias de atraso`,
        severidade: 'critico',
      })
    }
  }

  return resultado.slice(0, 12)
}

/* ------------------------------------------------------ visão por região */

export function agregadoPorRegiao() {
  const b = base()
  return b.regioes
    .map((r) => {
      const equipamentos = b.equipamentos.filter((e) => e.regiaoId === r.id)
      const locados = equipamentos.filter((e) => e.status === 'LOCADO')
      const manutencao = equipamentos.filter((e) => e.status === 'EM_MANUTENCAO')
      const criticos = equipamentos.filter((e) => e.bloqueado).length
      const mrr = locados.reduce((a, e) => a + (modeloPorId.get(e.modeloId)?.precoMensal ?? 0), 0)
      const clientes = new Set(locados.map((e) => e.clienteId).filter(Boolean)).size
      return {
        regiao: r,
        total: equipamentos.length,
        locados: locados.length,
        manutencao: manutencao.length,
        criticos,
        clientes,
        mrr,
        ocupacao: equipamentos.length ? locados.length / equipamentos.length : 0,
      }
    })
    .filter((a) => a.total > 0)
    .sort((a, b2) => b2.total - a.total)
}

export interface PendenciaMedicao {
  equipamento: Equipamento
  clienteNome: string
  competencia: string
  /** Média histórica, base da estimativa quando a leitura não vier. */
  mediaMono: number
  /** Meses desde a última leitura registrada. */
  mesesSemLeitura: number
}

/**
 * Ativos locados sem leitura da competência corrente.
 *
 * É o que trava o fechamento: sem medição não há como calcular excedente, e um
 * item de franquia + excedente não pode ser faturado por estimativa silenciosa.
 * A lista existe para que cada pendência seja tratada individualmente — em
 * lote, a estimativa vira o caminho fácil e a coleta de leitura acaba.
 */
export function pendenciasDeMedicao(): PendenciaMedicao[] {
  const b = base()
  const comps = b.indicadores.serieReceita.map((s) => s.competencia)
  const atual = comps[comps.length - 1]!

  return b.equipamentos
    .filter(
      (e) =>
        e.status === 'LOCADO' &&
        e.historicoConsumo.length > 0 &&
        !e.historicoConsumo.some((h) => h.competencia === atual),
    )
    .map((e) => {
      const ultima = e.historicoConsumo[e.historicoConsumo.length - 1]
      const indiceUltima = ultima ? comps.indexOf(ultima.competencia) : -1
      return {
        equipamento: e,
        clienteNome: b.clientes.find((c) => c.id === e.clienteId)?.nomeFantasia ?? '—',
        competencia: atual,
        mediaMono: Math.round(e.historicoConsumo.reduce((s, h) => s + h.mono, 0) / e.historicoConsumo.length),
        mesesSemLeitura: indiceUltima >= 0 ? comps.length - 1 - indiceUltima : e.historicoConsumo.length,
      }
    })
    .sort((a, b2) => b2.mesesSemLeitura - a.mesesSemLeitura)
}

/* --------------------------------------------------------------- despesas */

/**
 * Execução orçamentária — **derivada, nunca guardada**.
 *
 * Espelha `app.execucao_orcamentaria` do banco. As duas existem porque a tela
 * precisa responder sem ida ao servidor e o banco precisa responder para quem
 * não passa pela tela; a duplicação é assumida e tem contrapartida, como no
 * resto do bloco financeiro: os testes desta suíte e os de invariante falham
 * juntos se a regra mudar num lado só.
 *
 * O limiar de RN-F24 sai daqui e não de um campo: um título cancelado depois de
 * disparar o alerta de 90% precisa fazer o alerta **desaparecer**, não persistir
 * um estado que o dado atual já não sustenta.
 */
export interface LinhaExecucao {
  orcamento: Orcamento
  categoriaNome: string
  valorOrcado: number
  realizado: number
  comprometido: number
  /** Nulo quando o orçado é zero: dividir por zero não é 0%, é indefinido. */
  percentual: number | null
  limiar: LimiarExecucao
}

/** Estados que **não** contam como despesa: foram desfeitos. */
const FORA_DA_DESPESA: StatusPagar[] = ['CANCELADO', 'REJEITADO']

/**
 * D-25 — o que já tem destino certo.
 *
 * O gasto **e** o aprovado-não-pago. `PENDENTE` e `EM_APROVACAO` ficam de fora:
 * ainda podem ser rejeitados, e travar verba em cima de pedido não aprovado
 * congelaria dinheiro por um lançamento que ninguém aceitou.
 */
const COMPROMETIDO: StatusPagar[] = ['APROVADO', 'AGENDADO', 'PAGO_PARCIAL', 'PAGO']

const valorDevido = (t: TituloPagar) => t.valorAjustado ?? t.valorOriginal

/** A fatia de um título que pertence a um centro. Sem centro, o título inteiro. */
function parteDoCentro(t: TituloPagar, centroId: string | null): number {
  if (!centroId) return valorDevido(t)
  const r = t.rateio.find((x) => x.centroCustoId === centroId)
  // Sem rateio para aquele centro, o título não é dele: contar inteiro faria a
  // soma dos centros exceder a despesa real.
  return r ? Math.round(valorDevido(t) * (r.percentual / 100) * 100) / 100 : 0
}

export function despesaRealizada(
  base: BaseDados,
  de: string,
  ate: string,
  opcoes: {
    categoriaId?: string | null
    centroCustoId?: string | null
    filialId?: string | null
    status?: StatusPagar[]
  } = {},
): number {
  const permitidos = opcoes.status
  const total = base.titulosPagar
    .filter((t) => {
      if (t.dataEmissao < de || t.dataEmissao > ate) return false
      if (permitidos ? !permitidos.includes(t.status) : FORA_DA_DESPESA.includes(t.status)) return false
      if (opcoes.categoriaId && t.categoriaId !== opcoes.categoriaId) return false
      if (opcoes.filialId && t.filialId !== opcoes.filialId) return false
      if (opcoes.centroCustoId && !t.rateio.some((r) => r.centroCustoId === opcoes.centroCustoId))
        return false
      return true
    })
    .reduce((a, t) => a + parteDoCentro(t, opcoes.centroCustoId ?? null), 0)
  return Math.round(total * 100) / 100
}

/** Primeiro e último dia do período de um orçamento. Mês nulo = o ano inteiro. */
function janelaDoOrcamento(o: Orcamento): { de: string; ate: string } {
  if (o.mes === null) return { de: `${o.ano}-01-01`, ate: `${o.ano}-12-31` }
  const mm = String(o.mes).padStart(2, '0')
  const ultimo = new Date(Date.UTC(o.ano, o.mes, 0)).getUTCDate()
  return { de: `${o.ano}-${mm}-01`, ate: `${o.ano}-${mm}-${String(ultimo).padStart(2, '0')}` }
}

/** Os degraus de RN-F24: 75, 90 e 100 por cento. */
function limiarDe(orcado: number, realizado: number): LimiarExecucao {
  if (orcado === 0) return 'SEM_ORCAMENTO'
  const p = realizado / orcado
  if (p >= 1) return 'ESTOURADO'
  if (p >= 0.9) return 'CRITICO'
  if (p >= 0.75) return 'ATENCAO'
  return 'NORMAL'
}

export function execucaoOrcamentaria(
  ano: number,
  mes?: number,
  centroCustoId?: string,
): LinhaExecucao[] {
  const b = base()
  return b.orcamentos
    .filter((o) => o.ano === ano)
    .filter((o) => mes === undefined || o.mes === null || o.mes === mes)
    .filter((o) => !centroCustoId || o.centroCustoId === centroCustoId)
    .map((o) => {
      const { de, ate } = janelaDoOrcamento(o)
      const comum = {
        categoriaId: o.categoriaId,
        centroCustoId: o.centroCustoId,
        filialId: o.filialId,
      }
      const realizado = despesaRealizada(b, de, ate, comum)
      return {
        orcamento: o,
        categoriaNome:
          b.categoriasDespesa.find((c) => c.id === o.categoriaId)?.nome ?? 'Geral do centro',
        valorOrcado: o.valorOrcado,
        realizado,
        comprometido: despesaRealizada(b, de, ate, { ...comum, status: COMPROMETIDO }),
        percentual: o.valorOrcado === 0 ? null : realizado / o.valorOrcado,
        limiar: limiarDe(o.valorOrcado, realizado),
      }
    })
    .sort((a, b2) => a.categoriaNome.localeCompare(b2.categoriaNome))
}

/** Saldo que ainda pode ser replanejado: orçado menos comprometido (RN-F23). */
export function saldoNaoComprometido(base_: BaseDados, o: Orcamento): number {
  const { de, ate } = janelaDoOrcamento(o)
  const comprometido = despesaRealizada(base_, de, ate, {
    categoriaId: o.categoriaId,
    centroCustoId: o.centroCustoId,
    filialId: o.filialId,
    status: COMPROMETIDO,
  })
  return Math.round((o.valorOrcado - comprometido) * 100) / 100
}

export interface IndicadoresDespesa {
  despesaTotal: number
  despesaAnterior: number
  /** Nulo quando o período anterior não teve despesa: variação sobre zero é indefinida. */
  variacao: number | null
  totalOrcado: number
  execucaoPercentual: number | null
  proporcaoInvestimento: number
  clientesAtivos: number
  equipamentosLocados: number
  /** D-26, os dois lado a lado. Nulo sem denominador. */
  custoPorClienteAtivo: number | null
  custoPorEquipamentoLocado: number | null
  execucao: LinhaExecucao[]
}

export function indicadoresDespesa(ano: number, mes?: number): IndicadoresDespesa {
  const b = base()
  const mm = mes === undefined ? null : String(mes).padStart(2, '0')
  const de = mm ? `${ano}-${mm}-01` : `${ano}-01-01`
  const ate = mm
    ? `${ano}-${mm}-${String(new Date(Date.UTC(ano, mes!, 0)).getUTCDate()).padStart(2, '0')}`
    : `${ano}-12-31`

  const anteriorMes = mes === undefined ? undefined : mes === 1 ? 12 : mes - 1
  const anteriorAno = mes === undefined ? ano - 1 : mes === 1 ? ano - 1 : ano
  const am = anteriorMes === undefined ? null : String(anteriorMes).padStart(2, '0')
  const deAnt = am ? `${anteriorAno}-${am}-01` : `${anteriorAno}-01-01`
  const ateAnt = am
    ? `${anteriorAno}-${am}-${String(new Date(Date.UTC(anteriorAno, anteriorMes!, 0)).getUTCDate()).padStart(2, '0')}`
    : `${anteriorAno}-12-31`

  const total = despesaRealizada(b, de, ate)
  const anterior_ = despesaRealizada(b, deAnt, ateAnt)
  const execucao = execucaoOrcamentaria(ano, mes)
  const orcado = execucao.reduce((a, l) => a + l.valorOrcado, 0)

  const investimento = b.titulosPagar
    .filter(
      (t) =>
        t.dataEmissao >= de &&
        t.dataEmissao <= ate &&
        !FORA_DA_DESPESA.includes(t.status) &&
        t.classificacao === 'INVESTIMENTO',
    )
    .reduce((a, t) => a + valorDevido(t), 0)

  const clientesAtivos = new Set(
    b.contratos.filter((c) => c.status === 'ATIVO').map((c) => c.clienteId),
  ).size
  const equipamentosLocados = b.equipamentos.filter((e) => e.status === 'LOCADO').length

  return {
    despesaTotal: total,
    despesaAnterior: anterior_,
    variacao: anterior_ === 0 ? null : (total - anterior_) / anterior_,
    totalOrcado: orcado,
    execucaoPercentual: orcado === 0 ? null : total / orcado,
    proporcaoInvestimento: total === 0 ? 0 : investimento / total,
    clientesAtivos,
    equipamentosLocados,
    // Dividir por zero cliente não é custo zero, é pergunta sem resposta.
    custoPorClienteAtivo: clientesAtivos === 0 ? null : Math.round((total / clientesAtivos) * 100) / 100,
    custoPorEquipamentoLocado:
      equipamentosLocados === 0 ? null : Math.round((total / equipamentosLocados) * 100) / 100,
    execucao,
  }
}
