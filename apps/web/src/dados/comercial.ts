import { categoriaPorCodigo, modeloPorId } from './catalogo'
import type {
  Categoria,
  DescontoComercial,
  Equipamento,
  FranquiaItem,
  PrecoItem,
  TabelaFranquia,
  TabelaPreco,
} from './tipos'

/**
 * Resolução comercial: franquia, preço e desconto aplicáveis.
 *
 * Estas funções espelham `app.resolver_franquia`, `app.resolver_preco` e
 * `app.desconto_vigente` da migração 0012. A duplicação é deliberada e tem um
 * motivo único: **o simulador não pode prometer um número que o faturamento
 * depois não confirma**. Se a proposta calculasse por uma regra e a fatura por
 * outra, a divergência só apareceria no primeiro fechamento — na frente do
 * cliente, e sobre um valor que ele já assinou.
 *
 * Os dois lados têm teste sobre os mesmos casos.
 */

/* ---------------------------------------------------------------- franquia */

export interface FranquiaResolvida {
  tabela: TabelaFranquia
  item: FranquiaItem
  /** MODELO vence CATEGORIA — é a exceção comercial vencendo a regra geral. */
  origem: 'MODELO' | 'CATEGORIA'
}

/**
 * Franquia aplicável a um equipamento numa data.
 *
 * Devolve `null` quando não há política, e isso é a regra, não uma omissão:
 * assumir franquia zero cobraria **todo o volume** como excedente, em silêncio.
 * Quem chama precisa exigir preenchimento manual (RN-L15).
 */
export function resolverFranquia(
  tabelas: TabelaFranquia[],
  equipamento: Equipamento,
  data: string,
): FranquiaResolvida | null {
  const candidatas: FranquiaResolvida[] = []

  for (const tabela of tabelas) {
    if (!vigenteEm(tabela, data)) continue
    for (const item of tabela.itens) {
      if (item.modeloId === equipamento.modeloId) {
        candidatas.push({ tabela, item, origem: 'MODELO' })
      } else if (item.categoria === equipamento.categoria) {
        candidatas.push({ tabela, item, origem: 'CATEGORIA' })
      }
    }
  }

  if (candidatas.length === 0) return null

  // Modelo antes de categoria; empate resolvido pela tabela mais recente, para
  // o resultado nunca depender da ordem em que as tabelas foram cadastradas.
  candidatas.sort(
    (a, b) =>
      Number(b.origem === 'MODELO') - Number(a.origem === 'MODELO') ||
      b.tabela.vigenciaInicio.localeCompare(a.tabela.vigenciaInicio),
  )
  return candidatas[0]!
}

/* ------------------------------------------------------------------ preço */

export interface PrecoResolvido {
  tabela: TabelaPreco
  item: PrecoItem
  origem: 'MODELO' | 'CATEGORIA'
}

/**
 * Preço aplicável, com precedência **Contrato → Cliente → Geral** (RN-L21).
 *
 * Devolve a tabela junto com o valor porque a fatura precisa conseguir explicar
 * de onde veio o preço: "R$ 289,00" sem procedência vira discussão comercial
 * sem árbitro.
 */
export function resolverPreco(
  tabelas: TabelaPreco[],
  equipamento: Equipamento,
  data: string,
  contexto: { clienteId?: string | null; contratoId?: string | null } = {},
): PrecoResolvido | null {
  const ordem = { CONTRATO: 0, CLIENTE: 1, GERAL: 2 } as const
  const candidatos: PrecoResolvido[] = []

  for (const tabela of tabelas) {
    if (!vigenteEm(tabela, data)) continue
    if (tabela.abrangencia === 'CONTRATO' && tabela.contratoId !== contexto.contratoId) continue
    if (tabela.abrangencia === 'CLIENTE' && tabela.clienteId !== contexto.clienteId) continue

    for (const item of tabela.itens) {
      if (item.modeloId === equipamento.modeloId) candidatos.push({ tabela, item, origem: 'MODELO' })
      else if (item.categoria === equipamento.categoria) candidatos.push({ tabela, item, origem: 'CATEGORIA' })
    }
  }

  if (candidatos.length === 0) return null

  candidatos.sort(
    (a, b) =>
      ordem[a.tabela.abrangencia] - ordem[b.tabela.abrangencia] ||
      Number(b.origem === 'MODELO') - Number(a.origem === 'MODELO') ||
      b.tabela.vigenciaInicio.localeCompare(a.tabela.vigenciaInicio),
  )
  return candidatos[0]!
}

/* --------------------------------------------------------------- desconto */

export interface DescontoVigente {
  desconto: DescontoComercial
  origem: 'ITEM' | 'CONTRATO'
}

/**
 * Desconto vigente, com a regra de não acúmulo (RN-L23).
 *
 * Havendo desconto de contrato **e** de item, vale o de item. Somar os dois é o
 * erro que produz mensalidade negativa — e ele só aparece na fatura.
 */
export function descontoVigente(
  descontos: DescontoComercial[],
  alvo: { contratoId: string | null; contratoItemId: string | null },
  data: string,
): DescontoVigente | null {
  const aplicaveis = descontos
    .filter((d) => d.vigenciaInicio <= data && (d.vigenciaFim === null || d.vigenciaFim >= data))
    .filter((d) =>
      d.contratoItemId !== null
        ? d.contratoItemId === alvo.contratoItemId
        : d.contratoId === alvo.contratoId,
    )
    .map((d): DescontoVigente => ({ desconto: d, origem: d.contratoItemId ? 'ITEM' : 'CONTRATO' }))

  if (aplicaveis.length === 0) return null
  aplicaveis.sort(
    (a, b) =>
      Number(b.origem === 'ITEM') - Number(a.origem === 'ITEM') ||
      b.desconto.vigenciaInicio.localeCompare(a.desconto.vigenciaInicio),
  )
  return aplicaveis[0]!
}

export function aplicarDesconto(valor: number, d: DescontoComercial | null): number {
  if (!d) return valor
  const bruto = d.tipo === 'PERCENTUAL' ? valor * (1 - (d.percentual ?? 0) / 100) : valor - (d.valor ?? 0)
  // Desconto maior que o valor não gera crédito: gera zero. Mensalidade
  // negativa é sempre erro de cadastro, e propagá-la contamina o MRR.
  return Math.max(0, arredondar(bruto))
}

/* ------------------------------------------------------------- simulador */

export interface LinhaSimulacao {
  chave: string
  modeloId: string
  quantidade: number
  /** Volume mensal estimado por unidade. */
  volumeMono: number
  volumeColor: number
}

export interface ResultadoLinha {
  linha: LinhaSimulacao
  modeloNome: string
  categoria: Categoria | undefined
  precoUnitario: number
  origemPreco: string | null
  franquiaMono: number
  franquiaColor: number
  excedenteMonoPaginas: number
  excedenteColorPaginas: number
  valorExcedente: number
  valorFixo: number
  totalMensal: number
  instalacao: number
  /** Faltando política, a linha não pode ser cotada — e diz por quê. */
  pendencias: string[]
}

export interface ResultadoSimulacao {
  linhas: ResultadoLinha[]
  mensalBruto: number
  desconto: number
  mensalLiquido: number
  /** Setup e retirada não compõem o MRR (RN-L26): são eventos. */
  instalacaoTotal: number
  totalPrimeiraFatura: number
  totalContrato: number
  pendencias: string[]
}

/**
 * Simula o valor de uma proposta.
 *
 * Não persiste nada: simulação é cálculo, não proposta (RN-L27). Virar
 * proposta é ação explícita, e cria um contrato em rascunho.
 *
 * A separação entre recorrente e evento é o ponto de atenção do resultado.
 * Somar instalação ao MRR infla o indicador de receita recorrente com um valor
 * que acontece uma vez — e o erro só é descoberto quando alguém compara o MRR
 * com o extrato do mês seguinte.
 */
export function simular(
  entrada: {
    linhas: LinhaSimulacao[]
    prazoMeses: number
    data: string
    clienteId?: string | null
    descontoPercentual?: number
  },
  base: { tabelasFranquia: TabelaFranquia[]; tabelasPreco: TabelaPreco[] },
): ResultadoSimulacao {
  const linhas: ResultadoLinha[] = []
  const pendenciasGerais: string[] = []

  for (const linha of entrada.linhas) {
    const modelo = modeloPorId.get(linha.modeloId)
    const categoria = modelo ? categoriaPorCodigo.get(modelo.categoria) : undefined
    const pendencias: string[] = []

    // Equipamento fictício, só para reaproveitar a mesma resolução que o
    // faturamento usa. Cotar por uma regra e faturar por outra é como as
    // divergências comerciais nascem.
    const fantasma = {
      modeloId: linha.modeloId,
      categoria: modelo?.categoria,
    } as Equipamento

    const preco = resolverPreco(base.tabelasPreco, fantasma, entrada.data, {
      clienteId: entrada.clienteId ?? null,
      contratoId: null,
    })
    if (!preco) pendencias.push('Sem preço de tabela para este modelo na data escolhida.')

    const temContador = categoria?.temContador ?? false
    const franquia = temContador ? resolverFranquia(base.tabelasFranquia, fantasma, entrada.data) : null
    if (temContador && !franquia) {
      // Sem franquia, todo o volume viraria excedente — ou, pior, zero.
      pendencias.push('Sem política de franquia: o volume não pode ser cotado.')
    }

    const precoUnitario = preco?.item.valorMensal ?? 0
    const franquiaMono = franquia?.item.franquiaMono ?? 0
    const franquiaColor = franquia?.item.franquiaColor ?? 0
    const excedenteMonoPaginas = Math.max(0, linha.volumeMono - franquiaMono)
    const excedenteColorPaginas = Math.max(0, linha.volumeColor - franquiaColor)

    const valorExcedente = arredondar(
      (excedenteMonoPaginas * (franquia?.item.excedenteMono ?? 0) +
        excedenteColorPaginas * (franquia?.item.excedenteColor ?? 0)) *
        linha.quantidade,
    )
    const valorFixo = arredondar(precoUnitario * linha.quantidade)

    linhas.push({
      linha,
      modeloNome: modelo?.nome ?? '—',
      categoria,
      precoUnitario,
      origemPreco: preco ? `${preco.tabela.nome} · ${preco.origem.toLowerCase()}` : null,
      franquiaMono,
      franquiaColor,
      excedenteMonoPaginas,
      excedenteColorPaginas,
      valorExcedente,
      valorFixo,
      totalMensal: arredondar(valorFixo + valorExcedente),
      instalacao: arredondar((preco?.item.valorInstalacao ?? 0) * linha.quantidade),
      pendencias,
    })
    pendenciasGerais.push(...pendencias.map((p) => `${modelo?.nome ?? 'Item'}: ${p}`))
  }

  const mensalBruto = arredondar(linhas.reduce((s, l) => s + l.totalMensal, 0))
  const pct = entrada.descontoPercentual ?? 0
  const desconto = arredondar(mensalBruto * (pct / 100))
  const mensalLiquido = arredondar(mensalBruto - desconto)
  const instalacaoTotal = arredondar(linhas.reduce((s, l) => s + l.instalacao, 0))

  return {
    linhas,
    mensalBruto,
    desconto,
    mensalLiquido,
    instalacaoTotal,
    totalPrimeiraFatura: arredondar(mensalLiquido + instalacaoTotal),
    // Instalação entra uma vez; o recorrente, `prazo` vezes.
    totalContrato: arredondar(mensalLiquido * entrada.prazoMeses + instalacaoTotal),
    pendencias: pendenciasGerais,
  }
}

/* ------------------------------------------------------------ utilidades */

function vigenteEm(t: { status: string; vigenciaInicio: string; vigenciaFim: string | null }, data: string): boolean {
  if (t.status !== 'ATIVA') return false
  // Intervalo semiaberto, como no banco: uma tabela que termina no dia em que a
  // seguinte começa não conflita com ela.
  return t.vigenciaInicio <= data && (t.vigenciaFim === null || t.vigenciaFim > data)
}

export const arredondar = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** Rótulo do alvo de uma linha de tabela, para exibição. */
export function rotuloAlvo(alvo: { categoria: string | null; modeloId: string | null }): string {
  if (alvo.modeloId) return modeloPorId.get(alvo.modeloId)?.nome ?? alvo.modeloId
  if (alvo.categoria) return categoriaPorCodigo.get(alvo.categoria as never)?.nome ?? alvo.categoria
  return '—'
}
