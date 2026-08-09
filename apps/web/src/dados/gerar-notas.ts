import { modeloPorId } from './catalogo'
import { dvChaveNfe } from './nfe'
import type { Equipamento, Fornecedor, NotaFiscal, NotaFiscalItem } from './tipos'

/**
 * Massa de notas fiscais de compra.
 *
 * Nenhum valor é inventado aqui. As notas **integradas** são reconstruídas a
 * partir dos ativos que já existem no parque: agrupam-se por modelo, filial e
 * mês de aquisição, e o valor dos produtos é a soma do `valorAquisicao` que os
 * ativos já carregavam. É o único jeito de a massa ser coerente — inventar
 * valores novos faria o custo da nota divergir do patrimônio que ela originou,
 * e a primeira conferência de reconciliação apontaria a plataforma como errada.
 *
 * As notas **em aberto** (pendente e conferida) são compras que ainda não
 * viraram patrimônio, com séries que não existem no parque. Existem para que
 * conferência e integração sejam operáveis na demonstração — e o rateio delas
 * traz frete e IPI justamente para exercitar o resíduo de arredondamento.
 */

interface Sorteador {
  int(min: number, max: number): number
  real(min: number, max: number): number
  um<T>(lista: readonly T[]): T
}

/** Fornecedores da operação, um por fabricante representado no catálogo. */
export function gerarFornecedores(gerarCnpj: () => string): Fornecedor[] {
  const distribuidores: { id: string; razao: string; fantasia: string; uf: string }[] = [
    { id: 'for-print', razao: 'Printech Distribuição de Equipamentos LTDA', fantasia: 'Printech', uf: 'SP' },
    { id: 'for-nortec', razao: 'Nortec Soluções Corporativas S.A.', fantasia: 'Nortec', uf: 'PR' },
    { id: 'for-alfainfo', razao: 'Alfa Informática Comércio e Importação LTDA', fantasia: 'Alfa Info', uf: 'SC' },
    { id: 'for-tecsul', razao: 'Tecsul Equipamentos Corporativos LTDA', fantasia: 'Tecsul', uf: 'RS' },
    { id: 'for-centrale', razao: 'Centrale Suprimentos e Energia LTDA', fantasia: 'Centrale', uf: 'MG' },
  ]

  return distribuidores.map((d) => {
    const cnpj = gerarCnpj().replace(/\D/g, '')
    return {
      id: d.id,
      cnpj,
      razaoSocial: d.razao,
      nomeFantasia: d.fantasia,
      uf: d.uf,
      inscricaoEstadual: String(Number(cnpj.slice(0, 9))).padStart(9, '0'),
    }
  })
}

/** Fabricante → fornecedor que o distribui. */
const CANAL: Record<string, string> = {
  'fab-kyocera': 'for-print',
  'fab-hp': 'for-print',
  'fab-lexmark': 'for-nortec',
  'fab-brother': 'for-nortec',
  'fab-zebra': 'for-tecsul',
  'fab-dell': 'for-alfainfo',
  'fab-lenovo': 'for-alfainfo',
  'fab-positivo': 'for-tecsul',
  'fab-apc': 'for-centrale',
}

/**
 * Monta uma chave de acesso válida.
 *
 * Os 43 primeiros dígitos são os campos reais da nota — UF, competência, CNPJ
 * do emitente, modelo, série e número — e o 44º é o DV calculado. Uma chave
 * com dígitos aleatórios seria recusada pela própria validação da plataforma,
 * e a massa de demonstração ficaria com todas as notas em erro.
 */
export function montarChave(opcoes: {
  uf: string
  dataEmissao: string
  cnpjEmitente: string
  modelo: string
  serie: string
  numero: string
  codigoNumerico: string
}): string {
  const [ano, mes] = opcoes.dataEmissao.split('-')
  const base43 =
    CODIGO_UF[opcoes.uf] +
    ano!.slice(2) +
    mes! +
    opcoes.cnpjEmitente.padStart(14, '0') +
    opcoes.modelo.padStart(2, '0') +
    opcoes.serie.padStart(3, '0') +
    opcoes.numero.padStart(9, '0') +
    '1' +
    opcoes.codigoNumerico.padStart(8, '0')

  return base43 + String(dvChaveNfe(base43) ?? 0)
}

const CODIGO_UF: Record<string, string> = {
  SP: '35', RJ: '33', MG: '31', PR: '41', SC: '42', RS: '43', BA: '29', PE: '26', DF: '53', GO: '52',
}

export interface ResultadoNotas {
  notas: NotaFiscal[]
  /** Ativos que ganharam procedência — mutados no lugar, devolvidos para conferência. */
  comProcedencia: number
}

export function gerarNotas(
  s: Sorteador,
  equipamentos: Equipamento[],
  fornecedores: Fornecedor[],
  filialIds: string[],
  hoje: Date,
): ResultadoNotas {
  const notas: NotaFiscal[] = []
  let seq = 1
  let numeroNf = 41200
  const id = (p: string) => `${p}-${String(seq++).padStart(4, '0')}`

  /* ------------------------------------------------ notas já integradas --- */

  // Agrupa por (modelo, filial, mês de aquisição). É a granularidade real de
  // uma compra: o mesmo modelo, para a mesma base, chegando na mesma remessa.
  const lotes = new Map<string, Equipamento[]>()
  for (const e of equipamentos) {
    const chave = `${e.modeloId}|${e.filialId}|${e.dataAquisicao.slice(0, 7)}`
    const atual = lotes.get(chave)
    if (atual) atual.push(e)
    else lotes.set(chave, [e])
  }

  // Só os lotes com mais de uma unidade viram nota reconstruída. Um ativo
  // solto de sete anos atrás não teve nota lançada nesta plataforma, e fingir
  // que teve seria a mentira que este módulo existe para eliminar — a tela do
  // parque mostra "sem procedência" nesses, que é a informação verdadeira.
  const reconstruir = [...lotes.entries()]
    .filter(([, lote]) => lote.length >= 3)
    .sort((a, b) => b[1][0]!.dataAquisicao.localeCompare(a[1][0]!.dataAquisicao))
    .slice(0, 26)

  let comProcedencia = 0

  for (const [, lote] of reconstruir) {
    const primeiro = lote[0]!
    const modelo = modeloPorId.get(primeiro.modeloId)!
    const fornecedor =
      fornecedores.find((f) => f.id === CANAL[modelo.fabricanteId]) ?? fornecedores[0]!

    const valorProdutos = arred(lote.reduce((acc, e) => acc + e.valorAquisicao, 0))
    // ICMS destacado a 18%, imposto por dentro — está contido no valor dos
    // produtos e, como a locadora não se credita (Súmula 573 do STF), não sai
    // do custo. Por isso vNF = vProd nestas notas reconstruídas: o que se
    // conhece do histórico é o custo do ativo, não a decomposição de frete.
    const valorIcms = arred(valorProdutos * 0.18)

    const dataEntrada = primeiro.dataAquisicao
    const dataEmissao = recuarDias(dataEntrada, s.int(2, 9))
    const numero = String(numeroNf++)
    const serie = '1'

    const item: NotaFiscalItem = {
      id: id('nfi'),
      numeroItem: 1,
      modeloId: primeiro.modeloId,
      descricaoNf: descricaoFiscal(modelo.nome, modelo.categoria),
      codigoFornecedor: modelo.id.replace('mod-', '').toUpperCase(),
      ncm: NCM_POR_CATEGORIA[modelo.categoria] ?? '84433299',
      cfop: fornecedor.uf === 'SP' ? '5551' : '6551',
      unidade: 'UN',
      quantidade: lote.length,
      valorUnitario: arred(valorProdutos / lote.length),
      valorTotalItem: valorProdutos,
      garantiaMeses: 12,
      garantiaAte: somarMesesIso(dataEntrada, 12),
      series: lote.map((e) => ({
        id: id('nfs'),
        numeroSerie: e.numeroSerie,
        patrimonio: e.patrimonio,
        equipamentoId: e.id,
      })),
    }

    // Vínculo nos dois sentidos: o ativo ganha procedência e a garantia que a
    // nota lhe deu. É o que a tela do parque passa a exibir.
    item.series.forEach((sr, i) => {
      const e = lote[i]!
      e.notaSerieId = sr.id
      e.garantiaAte = item.garantiaAte ?? undefined
      comProcedencia++
    })

    notas.push({
      id: id('nf'),
      fornecedorId: fornecedor.id,
      filialDestinoId: primeiro.filialId,
      numero,
      serie,
      chaveAcesso: montarChave({
        uf: fornecedor.uf,
        dataEmissao,
        cnpjEmitente: fornecedor.cnpj,
        modelo: '55',
        serie,
        numero,
        codigoNumerico: String(s.int(10000000, 99999999)),
      }),
      modeloDocumento: '55',
      dataEmissao,
      dataEntrada,
      valorProdutos,
      valorFrete: 0,
      valorSeguro: 0,
      valorOutrasDespesas: 0,
      valorDesconto: 0,
      valorIpi: 0,
      valorIcms,
      valorIcmsSt: 0,
      valorTotal: valorProdutos,
      icmsRecuperavel: false,
      ipiRecuperavel: false,
      status: 'INTEGRADA',
      origemDados: 'XML',
      conferidaEm: dataEntrada,
      conferidaPor: 'Rita Camargo',
      integradaEm: dataEntrada,
      integradaPor: 'Operação IARX',
      canceladaEm: null,
      motivoCancelamento: null,
      criadaPor: 'Operação IARX',
      itens: [item],
    })
  }

  /* -------------------------------------------------- notas ainda abertas - */

  // Patrimônios acima de tudo que existe: estas unidades ainda não são ativos.
  let proximoPatrimonio =
    Math.max(...equipamentos.map((e) => Number(e.patrimonio) || 0), 10000) + 1

  const abrir = (opcoes: {
    modeloIds: string[]
    quantidades: number[]
    status: 'PENDENTE_CONFERENCIA' | 'CONFERIDA'
    /** Unidades identificadas por item. `null` = todas. */
    seriesInformadas?: (number | null)[]
    diasAtras: number
    comFrete: boolean
  }) => {
    const modelo0 = modeloPorId.get(opcoes.modeloIds[0]!)!
    const fornecedor = fornecedores.find((f) => f.id === CANAL[modelo0.fabricanteId]) ?? fornecedores[0]!
    const filialId = s.um(filialIds)
    const dataEntrada = recuarDias(iso(hoje), opcoes.diasAtras)
    const dataEmissao = recuarDias(dataEntrada, s.int(2, 6))
    const numero = String(numeroNf++)
    const serie = '1'

    const itens: NotaFiscalItem[] = opcoes.modeloIds.map((modeloId, indice) => {
      const modelo = modeloPorId.get(modeloId)!
      const quantidade = opcoes.quantidades[indice]!
      const valorUnitario = modelo.valorAquisicao
      const informadas = opcoes.seriesInformadas?.[indice] ?? quantidade

      const series = Array.from({ length: informadas }, () => {
        const patrimonio = String(proximoPatrimonio++)
        return {
          id: id('nfs'),
          numeroSerie: `${modelo.id.slice(4, 8).toUpperCase()}${s.int(100000, 999999)}`,
          patrimonio,
          equipamentoId: null,
        }
      })

      return {
        id: id('nfi'),
        numeroItem: indice + 1,
        modeloId,
        descricaoNf: descricaoFiscal(modelo.nome, modelo.categoria),
        codigoFornecedor: modelo.id.replace('mod-', '').toUpperCase(),
        ncm: NCM_POR_CATEGORIA[modelo.categoria] ?? '84433299',
        cfop: fornecedor.uf === 'SP' ? '5551' : '6551',
        unidade: 'UN',
        quantidade,
        valorUnitario,
        valorTotalItem: arred(valorUnitario * quantidade),
        garantiaMeses: modelo.categoria.startsWith('MFP') ? 24 : 12,
        garantiaAte: null,
        series,
      }
    })

    const valorProdutos = arred(itens.reduce((acc, i) => acc + i.valorTotalItem, 0))
    // Frete que não divide igualmente pelas unidades: é o caso em que o rateio
    // ingênuo perde um centavo, e é o que a prévia de integração precisa provar
    // que fecha.
    const valorFrete = opcoes.comFrete ? arred(valorProdutos * 0.0137) : 0
    const valorIpi = opcoes.comFrete ? arred(valorProdutos * 0.0325) : 0
    const valorDesconto = opcoes.comFrete ? arred(valorProdutos * 0.005) : 0
    const valorIcms = arred(valorProdutos * 0.18)
    const valorTotal = arred(valorProdutos + valorFrete + valorIpi - valorDesconto)

    notas.push({
      id: id('nf'),
      fornecedorId: fornecedor.id,
      filialDestinoId: filialId,
      numero,
      serie,
      chaveAcesso: montarChave({
        uf: fornecedor.uf,
        dataEmissao,
        cnpjEmitente: fornecedor.cnpj,
        modelo: '55',
        serie,
        numero,
        codigoNumerico: String(s.int(10000000, 99999999)),
      }),
      modeloDocumento: '55',
      dataEmissao,
      dataEntrada,
      valorProdutos,
      valorFrete,
      valorSeguro: 0,
      valorOutrasDespesas: 0,
      valorDesconto,
      valorIpi,
      valorIcms,
      valorIcmsSt: 0,
      valorTotal,
      icmsRecuperavel: false,
      ipiRecuperavel: false,
      status: opcoes.status,
      origemDados: 'XML',
      conferidaEm: opcoes.status === 'CONFERIDA' ? recuarDias(iso(hoje), 1) : null,
      conferidaPor: opcoes.status === 'CONFERIDA' ? 'Rita Camargo' : null,
      integradaEm: null,
      integradaPor: null,
      canceladaEm: null,
      motivoCancelamento: null,
      // Diferente do usuário da sessão de demonstração, para que a segregação
      // de funções (RN-027) não bloqueie a conferência na demonstração.
      criadaPor: 'Marcelo Prado',
      itens,
    })
  }

  // Pronta para integrar: exercita o rateio com frete, IPI e desconto.
  abrir({
    modeloIds: ['mod-kyo-4054', 'mod-hp-e52'],
    quantidades: [7, 3],
    status: 'CONFERIDA',
    diasAtras: 4,
    comFrete: true,
  })

  // Pronta para conferir: todas as unidades já identificadas.
  abrir({
    modeloIds: ['mod-len-m70q'],
    quantidades: [12],
    status: 'PENDENTE_CONFERENCIA',
    diasAtras: 2,
    comFrete: true,
  })

  // Incompleta: 4 de 9 unidades identificadas. É o caso que a conferência
  // recusa (RN-L02) — e o painel precisa ter o que apontar.
  abrir({
    modeloIds: ['mod-dell-3000', 'mod-apc-1500'],
    quantidades: [9, 4],
    status: 'PENDENTE_CONFERENCIA',
    seriesInformadas: [4, 0],
    diasAtras: 1,
    comFrete: false,
  })

  return { notas, comProcedencia }
}

/* -------------------------------------------------------------- auxiliares */

/**
 * Descrição como o fornecedor a emite: caixa alta, sem acento, abreviada.
 *
 * Não é enfeite. É por causa dela que o passo de vincular item da nota a
 * modelo do catálogo é humano: "MULTIFUNC LASER MONO A4 40PPM" não casa
 * automaticamente com "TASKalfa 4054ci", e um casamento automático errado é
 * pior que a digitação, porque ninguém o revisa.
 */
function descricaoFiscal(nome: string, categoria: string): string {
  const prefixo: Record<string, string> = {
    MFP_MONO: 'MULTIFUNC LASER MONOCROMATICA',
    MFP_COLOR: 'MULTIFUNC LASER COLORIDA',
    LASER_MONO: 'IMPRESSORA LASER MONOCROMATICA',
    LASER_COLOR: 'IMPRESSORA LASER COLORIDA',
    TERMICA: 'IMPRESSORA TERMICA TRANSF DIRETA',
    DESKTOP: 'MICROCOMPUTADOR DESKTOP',
    NOTEBOOK: 'MICROCOMPUTADOR PORTATIL',
    THIN_CLIENT: 'TERMINAL LEVE THIN CLIENT',
    NOBREAK: 'FONTE DE ALIMENTACAO ININTERRUPTA UPS',
  }
  const semAcento = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  return `${prefixo[categoria] ?? 'EQUIPAMENTO'} ${semAcento}`
}

/** NCM por categoria — posição fiscal usual do bem. */
const NCM_POR_CATEGORIA: Record<string, string> = {
  MFP_MONO: '84433221',
  MFP_COLOR: '84433221',
  LASER_MONO: '84433211',
  LASER_COLOR: '84433211',
  TERMICA: '84433239',
  DESKTOP: '84714110',
  NOTEBOOK: '84713012',
  THIN_CLIENT: '84714900',
  NOBREAK: '85044010',
}

const arred = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

const iso = (d: Date) => d.toISOString().slice(0, 10)

function recuarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

function somarMesesIso(data: string, meses: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number]
  const total = a * 12 + (m - 1) + meses
  const ano = Math.floor(total / 12)
  const mes = (total % 12) + 1
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimoDia)).padStart(2, '0')}`
}
