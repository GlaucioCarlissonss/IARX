import { api } from './api'
import { categoriaPorCodigo, modeloPorId, nomeModelo, regiaoPorId } from './catalogo'
import { HOJE } from './gerar'
import type { Cliente, Equipamento, Fatura, OrdemServico, Peca } from './tipos'

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
      const faturas = b.faturas.filter((f) => f.clienteId === c.id)
      const aberto = faturas
        .filter((f) => f.status !== 'PAGA' && f.status !== 'CANCELADA')
        .reduce((a, f) => a + (f.valorLiquido - f.valorPago), 0)
      const vencido = faturas.filter((f) => f.diasAtraso > 0).reduce((a, f) => a + (f.valorLiquido - f.valorPago), 0)

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

export interface LinhaFatura {
  fatura: Fatura
  clienteNome: string
  contratoNumero: string
  saldo: number
}

export function linhasFaturas(): LinhaFatura[] {
  const b = base()
  return b.faturas.map((f) => ({
    fatura: f,
    clienteNome: b.clientes.find((c) => c.id === f.clienteId)?.nomeFantasia ?? '—',
    contratoNumero: b.contratos.find((c) => c.id === f.contratoId)?.numero ?? '—',
    saldo: f.valorLiquido - f.valorPago,
  }))
}

/** Itens da competência corrente que fugiram do padrão e pedem conferência. */
export function excecoesFechamento() {
  const b = base()
  const comps = b.indicadores.serieReceita.map((s) => s.competencia)
  const atual = comps[comps.length - 1]
  const anterior = comps[comps.length - 2]

  const emFechamento = b.faturas.filter((f) => f.competencia === atual)
  const resultado: { fatura: Fatura; clienteNome: string; motivo: string; severidade: 'critico' | 'atencao' }[] = []

  for (const f of emFechamento) {
    const cliente = b.clientes.find((c) => c.id === f.clienteId)!
    const anteriorDoContrato = b.faturas.find((x) => x.contratoId === f.contratoId && x.competencia === anterior)

    if (anteriorDoContrato && anteriorDoContrato.valorLiquido > 0) {
      const var_ = (f.valorLiquido - anteriorDoContrato.valorLiquido) / anteriorDoContrato.valorLiquido
      if (Math.abs(var_) > 0.35) {
        resultado.push({
          fatura: f,
          clienteNome: cliente.nomeFantasia,
          motivo: `variação de ${var_ > 0 ? '+' : '−'}${Math.abs(var_ * 100).toFixed(0)}% sobre a competência anterior`,
          severidade: Math.abs(var_) > 0.6 ? 'critico' : 'atencao',
        })
        continue
      }
    }
    if (!anteriorDoContrato) {
      resultado.push({
        fatura: f,
        clienteNome: cliente.nomeFantasia,
        motivo: 'primeira competência do contrato — cobrança proporcional',
        severidade: 'atencao',
      })
      continue
    }
    if (cliente.situacaoCredito === 'BLOQUEADO') {
      resultado.push({
        fatura: f,
        clienteNome: cliente.nomeFantasia,
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
