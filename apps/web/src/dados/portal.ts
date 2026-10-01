import { nomeModelo, modeloPorId, fabricantePorId } from './catalogo'
import { ehAbertoReceber, saldoReceber, valorLiquidoReceber } from './receber'
import type {
  BaseDados,
  Cliente,
  Contrato,
  EscopoCliente,
  EquipamentoStatus,
  LocalOperacao,
  ModalidadeCobranca,
  Usuario,
} from './tipos'

/**
 * O portal do cliente, do lado do front.
 *
 * Módulo próprio, e não mais funções em `consultas.ts`, por uma razão que não é
 * de organização: **as consultas do operador devolvem margem, custo de
 * manutenção e valor de aquisição**, e nenhuma delas pode ser reusada aqui nem
 * com um filtro por cima. `linhasParque()` carrega `margem`; reaproveitá-la
 * com um `omit` faria o próximo campo acrescentado lá vazar aqui em silêncio.
 *
 * As formas espelham `@iarx/contracts` (`ResumoPortal`, `ContratoDoCliente`,
 * `EquipamentoDoCliente`, `ConsumoDoCliente`, `CustoDaCompetencia`), em idioma
 * do front — camelCase e números em vez das cadeias de `Dinheiro`. Espelhar
 * agora é o que faz a troca da base em memória por `fetch` ser uma troca de
 * origem, e não uma reescrita das telas.
 *
 * **O recorte mora aqui, não nas telas.** Toda função recebe o escopo e não
 * consulta a sessão: uma tela que esquecesse de recortar é um defeito que o
 * teste pega chamando a função, sem renderizar nada.
 */

/* ------------------------------------------------------------------ escopo */

export interface EscopoDoPortal {
  clienteId: string
  /**
   * Nulo significa **todas as unidades do cliente**, e não "nenhuma".
   *
   * A distinção é a decisão D-27 inteira: quem tem escopo de grupo não tem
   * vínculo nenhum e precisa ver tudo; quem tem escopo de unidade e nenhum
   * vínculo não vê nada. Um `string[]` vazio é exatamente esse segundo caso, e
   * por isso vazio nunca é tratado como ausência de filtro.
   */
  locaisIds: string[] | null
}

/**
 * O escopo de quem está na sessão — nulo para quem opera a locadora.
 *
 * É também o que decide qual aplicação a pessoa vê: com escopo, o portal; sem
 * escopo, a operação. O shell não pergunta "o perfil é de cliente?" em lugar
 * nenhum; pergunta se há recorte.
 */
export function escopoDoUsuario(usuario: Usuario): EscopoDoPortal | null {
  if (usuario.tipo !== 'CLIENTE' || !usuario.clienteId) return null
  const e: EscopoCliente = usuario.escopoCliente ?? { tipo: 'CLIENTE' }
  return {
    clienteId: usuario.clienteId,
    locaisIds: e.tipo === 'LOCAL_CLIENTE' ? e.locaisIds : null,
  }
}

/** Um local está no escopo? Sem recorte de unidade, todos do cliente estão. */
function localVisivel(escopo: EscopoDoPortal, localId: string | null): boolean {
  if (escopo.locaisIds === null) return true
  return localId !== null && escopo.locaisIds.includes(localId)
}

export function locaisDoEscopo(b: BaseDados, escopo: EscopoDoPortal): LocalOperacao[] {
  return b.locais.filter((l) => l.clienteId === escopo.clienteId && localVisivel(escopo, l.id))
}

/* ------------------------------------------------------------------ parque */

export interface EquipamentoDoCliente {
  id: string
  patrimonio: string
  numeroSerie: string
  modelo: string
  fabricante: string
  status: EquipamentoStatus
  localId: string | null
  localNome: string | null
}

/**
 * O parque como o cliente o vê.
 *
 * Sem valor de aquisição, sem custo de manutenção, sem margem e sem filial — a
 * filial é dimensão do locador. O que sobra responde "que máquina é essa e onde
 * ela está", que é a pergunta que o cliente faz.
 */
export function equipamentosDoCliente(
  b: BaseDados,
  escopo: EscopoDoPortal,
): EquipamentoDoCliente[] {
  const local = new Map(b.locais.map((l) => [l.id, l.nome]))
  return b.equipamentos
    .filter((e) => e.clienteId === escopo.clienteId && localVisivel(escopo, e.localId))
    .map((e) => ({
      id: e.id,
      patrimonio: e.patrimonio,
      numeroSerie: e.numeroSerie,
      modelo: nomeModelo(e.modeloId),
      fabricante: fabricantePorId.get(modeloPorId.get(e.modeloId)?.fabricanteId ?? '')?.nome ?? '—',
      status: e.status,
      localId: e.localId,
      localNome: e.localId ? (local.get(e.localId) ?? null) : null,
    }))
    .sort((a, z) => a.patrimonio.localeCompare(z.patrimonio))
}

/* --------------------------------------------------------------- contratos */

export interface ItemDoContrato {
  id: string
  equipamentoId: string
  patrimonio: string
  modelo: string
  localId: string | null
  localNome: string | null
  modalidade: ModalidadeCobranca
  valorMensal: number
  franquiaMono: number | null
  franquiaColor: number | null
  precoExcedenteMono: number | null
  status: string
}

export interface ContratoDoCliente {
  id: string
  numero: string
  status: Contrato['status']
  dataInicio: string
  dataFim: string
  diaVencimento: number
  /** O que o cliente paga. **Não** é o custo do locador nem a margem. */
  valorMensal: number
  itens: number
  itensDetalhados: ItemDoContrato[]
}

const ITEM_OCUPANTE = ['RESERVADO', 'ATIVO', 'SUSPENSO']

export function contratosDoCliente(b: BaseDados, escopo: EscopoDoPortal): ContratoDoCliente[] {
  const local = new Map(b.locais.map((l) => [l.id, l.nome]))
  const equipamento = new Map(b.equipamentos.map((e) => [e.id, e]))

  return b.contratos
    .filter((c) => c.clienteId === escopo.clienteId)
    .map((c) => {
      /*
       * O recorte do item é o do **equipamento**, e não do contrato.
       *
       * Um contrato do grupo pode ter máquinas em várias unidades; para o gestor
       * de uma delas, o contrato aparece com os itens que ele alcança e com o
       * valor desses itens. Recortar o contrato inteiro esconderia o documento
       * que ele assinou; não recortar o item mostraria o parque alheio.
       */
      const itens = c.itens
        .filter((i) => ITEM_OCUPANTE.includes(i.status))
        .map((i) => ({ item: i, eq: equipamento.get(i.equipamentoId) }))
        .filter(({ eq }) => eq && localVisivel(escopo, eq.localId))
        .map(({ item, eq }) => ({
          id: item.id,
          equipamentoId: item.equipamentoId,
          patrimonio: eq!.patrimonio,
          modelo: nomeModelo(eq!.modeloId),
          localId: eq!.localId,
          localNome: eq!.localId ? (local.get(eq!.localId) ?? null) : null,
          modalidade: item.modalidade,
          valorMensal: item.valorMensal,
          franquiaMono: item.franquiaMono,
          franquiaColor: item.franquiaColor,
          precoExcedenteMono: item.precoExcedenteMono,
          status: item.status,
        }))

      return {
        id: c.id,
        numero: c.numero,
        status: c.status,
        dataInicio: c.dataInicio,
        dataFim: c.dataFim,
        diaVencimento: c.diaVencimento,
        valorMensal: Math.round(itens.reduce((a, i) => a + i.valorMensal, 0) * 100) / 100,
        itens: itens.length,
        itensDetalhados: itens,
      }
    })
    .filter((c) => c.itens > 0 || escopo.locaisIds === null)
    .sort((a, z) => z.dataInicio.localeCompare(a.dataInicio))
}

/* ----------------------------------------------------------------- consumo */

export interface ConsumoDoCliente {
  competencia: string
  equipamentoId: string
  patrimonio: string
  localId: string | null
  localNome: string | null
  paginasMono: number
  paginasColor: number
  franquiaMono: number | null
  franquiaColor: number | null
  excedenteMono: number
  excedenteColor: number
  valorExcedente: number
  /** RN-L33 — derivado da medição não selada, nunca um campo próprio. */
  parcial: boolean
  ultimaLeituraEm: string | null
}

/**
 * O consumo por equipamento numa competência.
 *
 * A fonte é a **medição** (`medicoes`), e não a leitura solta do equipamento: é
 * a medição que diz qual franquia valia e quanto o excedente custou, e é ela
 * que o cliente confere contra a cobrança. A leitura entra só para a data —
 * "parcial desde quando" (RN-L33).
 */
export function consumoDoCliente(
  b: BaseDados,
  escopo: EscopoDoPortal,
  competencia?: string,
): ConsumoDoCliente[] {
  const porPatrimonio = new Map(b.equipamentos.map((e) => [e.patrimonio, e]))
  const local = new Map(b.locais.map((l) => [l.id, l.nome]))

  return b.medicoes
    .filter((m) => m.clienteId === escopo.clienteId)
    .filter((m) => !competencia || m.competencia === competencia)
    .flatMap((m) =>
      m.itens.map((i) => {
        const eq = porPatrimonio.get(i.equipamentoPatrimonio)
        const leitura = eq?.historicoConsumo.find((h) => h.competencia === m.competencia)
        return {
          competencia: m.competencia,
          equipamentoId: eq?.id ?? i.equipamentoPatrimonio,
          patrimonio: i.equipamentoPatrimonio,
          localId: eq?.localId ?? null,
          localNome: eq?.localId ? (local.get(eq.localId) ?? null) : null,
          paginasMono: i.consumoMono,
          paginasColor: i.consumoColor,
          franquiaMono: i.franquiaMono,
          franquiaColor: i.franquiaColor,
          excedenteMono: i.excedenteMono,
          excedenteColor: i.excedenteColor,
          valorExcedente: Math.round((i.valorExcedenteMono + i.valorExcedenteColor) * 100) / 100,
          parcial: m.seladaEm === null,
          ultimaLeituraEm: leitura?.lidaEm ?? null,
        }
      }),
    )
    .filter((c) => localVisivel(escopo, c.localId))
    .sort((a, z) => z.competencia.localeCompare(a.competencia) || a.patrimonio.localeCompare(z.patrimonio))
}

/* ------------------------------------------------------------------ custos */

export interface CustoDaCompetencia {
  competencia: string
  locacao: number
  excedente: number
  total: number
  cobrancaId: string | null
  vencimento: string | null
  parcial: boolean
}

/**
 * O histórico de custo por competência.
 *
 * O total sai da **cobrança** quando ela existe, e não de uma soma paralela: na
 * competência fechada ele tem de ser idêntico ao do boleto, e duas aritméticas
 * para o mesmo mês dariam dois números igualmente defensáveis. A locação é a
 * decomposição desse total — total menos excedente medido —, e não uma terceira
 * fonte.
 *
 * Sem cobrança emitida (a competência aberta, tipicamente) o que há é a
 * medição, e ela vem marcada como parcial.
 */
export function custosDoCliente(b: BaseDados, escopo: EscopoDoPortal): CustoDaCompetencia[] {
  const titulos = b.titulosReceber.filter(
    (t) => t.clienteId === escopo.clienteId && t.origem === 'CONTRATUAL' && t.competencia,
  )

  const porCompetencia = new Map<string, { excedente: number; bruto: number; parcial: boolean }>()
  for (const m of b.medicoes.filter((m) => m.clienteId === escopo.clienteId)) {
    const acc = porCompetencia.get(m.competencia) ?? { excedente: 0, bruto: 0, parcial: false }
    acc.excedente += m.itens.reduce((a, i) => a + i.valorExcedenteMono + i.valorExcedenteColor, 0)
    acc.bruto += m.valorLiquido
    acc.parcial = acc.parcial || m.seladaEm === null
    porCompetencia.set(m.competencia, acc)
  }

  return [...porCompetencia.entries()]
    .map(([competencia, acc]) => {
      const cobranca = titulos.filter((t) => t.competencia === competencia)
      const total = cobranca.length
        ? cobranca.reduce((a, t) => a + valorLiquidoReceber(t), 0)
        : acc.bruto
      const excedente = Math.round(acc.excedente * 100) / 100
      return {
        competencia,
        locacao: Math.round((total - excedente) * 100) / 100,
        excedente,
        total: Math.round(total * 100) / 100,
        cobrancaId: cobranca[0]?.id ?? null,
        vencimento: cobranca[0]?.dataVencimento ?? null,
        parcial: acc.parcial,
      }
    })
    .sort((a, z) => z.competencia.localeCompare(a.competencia))
}

export interface MemoriaDaCompetencia {
  competencia: string
  parcial: boolean
  itens: ConsumoDoCliente[]
  locacao: number
  excedente: number
  total: number
}

/**
 * A memória de cálculo de uma competência, endereçada pela **competência**.
 *
 * Não por identificador de cobrança, e a razão é a competência aberta: ela não
 * tem cobrança nenhuma e é justamente a que o cliente mais quer conferir. O que
 * explica o valor é a medição, não o título.
 */
export function memoriaDaCompetencia(
  b: BaseDados,
  escopo: EscopoDoPortal,
  competencia: string,
): MemoriaDaCompetencia | null {
  const itens = consumoDoCliente(b, escopo, competencia)
  if (itens.length === 0) return null
  const custo = custosDoCliente(b, escopo).find((c) => c.competencia === competencia)
  const excedente = Math.round(itens.reduce((a, i) => a + i.valorExcedente, 0) * 100) / 100
  return {
    competencia,
    parcial: itens.some((i) => i.parcial),
    itens,
    locacao: custo ? custo.locacao : 0,
    excedente,
    total: custo ? custo.total : excedente,
  }
}

/* ------------------------------------------------------------------ resumo */

export interface ResumoDoPortal {
  cliente: Cliente
  unidadesNoEscopo: number
  contratos: { ativos: number; proximoVencimento: string | null }
  parque: { total: number; porStatus: Record<string, number> }
  consumoEmAberto: {
    competencia: string | null
    parcial: boolean
    ultimaLeituraEm: string | null
    paginas: number
    excedente: number
  }
  cobrancaEmAberto: { total: number; vencido: number }
}

const CONTRATO_VIGENTE: Contrato['status'][] = ['ATIVO', 'EM_RENOVACAO', 'VENCIDO_EM_CAMPO']

/**
 * O consolidado do escopo, numa passada só.
 *
 * `unidadesNoEscopo` existe para o recorte ser **visível** a quem usa o portal.
 * Um gestor que enxerga uma unidade precisa saber que enxerga uma — senão lê o
 * número como se fosse o do grupo, e a conclusão errada não tem como aparecer.
 */
export function resumoDoPortal(b: BaseDados, escopo: EscopoDoPortal, hoje: string): ResumoDoPortal {
  const cliente = b.clientes.find((c) => c.id === escopo.clienteId)!
  const parque = equipamentosDoCliente(b, escopo)
  const contratos = contratosDoCliente(b, escopo)
  const consumo = consumoDoCliente(b, escopo)

  const porStatus: Record<string, number> = {}
  for (const e of parque) porStatus[e.status] = (porStatus[e.status] ?? 0) + 1

  const vigentes = contratos.filter((c) => CONTRATO_VIGENTE.includes(c.status))
  const vencimentos = vigentes.map((c) => c.dataFim).filter((d) => d >= hoje).sort()

  const aberta = consumo.filter((c) => c.parcial)
  const competenciaAberta = aberta.length
    ? aberta.map((c) => c.competencia).sort().at(-1)!
    : null
  const daAberta = aberta.filter((c) => c.competencia === competenciaAberta)
  const leituras = daAberta.map((c) => c.ultimaLeituraEm).filter((d): d is string => d !== null).sort()

  const emAberto = b.titulosReceber.filter(
    (t) => t.clienteId === escopo.clienteId && ehAbertoReceber(t.status),
  )

  return {
    cliente,
    unidadesNoEscopo: locaisDoEscopo(b, escopo).length,
    contratos: { ativos: vigentes.length, proximoVencimento: vencimentos[0] ?? null },
    parque: { total: parque.length, porStatus },
    consumoEmAberto: {
      competencia: competenciaAberta,
      // RN-L33: parcial é a competência não selada existir, e nada mais.
      parcial: competenciaAberta !== null,
      ultimaLeituraEm: leituras.at(-1) ?? null,
      paginas: daAberta.reduce((a, c) => a + c.paginasMono + c.paginasColor, 0),
      excedente: Math.round(daAberta.reduce((a, c) => a + c.valorExcedente, 0) * 100) / 100,
    },
    cobrancaEmAberto: {
      total: Math.round(emAberto.reduce((a, t) => a + saldoReceber(t), 0) * 100) / 100,
      vencido: Math.round(
        emAberto
          .filter((t) => t.dataVencimento < hoje)
          .reduce((a, t) => a + saldoReceber(t), 0) * 100,
      ) / 100,
    },
  }
}
