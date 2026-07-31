/**
 * Tipos do domínio de locação de impressoras e computadores corporativos.
 *
 * A modelagem segue os anexos da proposta (docs/anexos/A-modelo-de-dados.md).
 * O que muda em relação ao exemplo genérico de equipamento pesado é o medidor:
 * aqui a medição é **contador de páginas**, com franquia mensal e excedente por
 * página — o modelo de receita real do setor. Computadores não têm medidor e
 * são cobrados por valor fixo mensal.
 */

export type EquipamentoStatus =
  | 'DISPONIVEL'
  | 'RESERVADO'
  | 'EM_TRANSITO_ENTREGA'
  | 'LOCADO'
  | 'EM_TRANSITO_RETORNO'
  | 'EM_INSPECAO'
  | 'EM_MANUTENCAO'
  | 'BLOQUEADO'
  | 'EXTRAVIADO'
  | 'BAIXADO'

export type ContratoStatus =
  | 'RASCUNHO'
  | 'EM_APROVACAO'
  | 'AGUARDANDO_ASSINATURA'
  | 'ATIVO'
  | 'SUSPENSO'
  | 'EM_RENOVACAO'
  | 'VENCIDO_EM_CAMPO'
  | 'ENCERRADO'
  | 'DISTRATADO'

export type OsStatus =
  | 'ABERTA'
  | 'TRIAGEM'
  | 'AGENDADA'
  | 'EM_EXECUCAO'
  | 'AGUARDANDO_PECA'
  | 'CONCLUIDA'
  | 'VALIDADA'
  | 'CANCELADA'

export type FaturaStatus = 'PREVISTA' | 'EM_FECHAMENTO' | 'EMITIDA' | 'PARCIAL' | 'PAGA' | 'EM_ATRASO' | 'CANCELADA'

export type SituacaoCredito = 'LIBERADO' | 'OBSERVACAO' | 'BLOQUEADO'

export type FamiliaEquipamento = 'IMPRESSAO' | 'COMPUTACAO' | 'CONTINGENCIA'

export type CategoriaCodigo =
  | 'MFP_MONO'
  | 'MFP_COLOR'
  | 'LASER_MONO'
  | 'LASER_COLOR'
  | 'TERMICA'
  | 'DESKTOP'
  | 'NOTEBOOK'
  | 'THIN_CLIENT'
  | 'NOBREAK'

export type ModalidadeCobranca = 'FIXO_MENSAL' | 'FRANQUIA_EXCEDENTE' | 'POR_PAGINA' | 'MISTO'

export interface Categoria {
  codigo: CategoriaCodigo
  nome: string
  familia: FamiliaEquipamento
  /** Impressão usa contador de páginas; computação não tem medidor. */
  temContador: boolean
  temContadorColor: boolean
  slaHorasResposta: number
  slaHorasSolucao: number
}

export interface Fabricante {
  id: string
  nome: string
}

export interface Modelo {
  id: string
  fabricanteId: string
  categoria: CategoriaCodigo
  nome: string
  /** Páginas por minuto (impressão) ou null para computação. */
  ppm: number | null
  especificacoes: string
  /** Valor de tabela mensal, em reais. */
  precoMensal: number
  /** Franquia sugerida de páginas mono; null quando não se aplica. */
  franquiaMono: number | null
  franquiaColor: number | null
  precoExcedenteMono: number | null
  precoExcedenteColor: number | null
  valorAquisicao: number
  vidaUtilMeses: number
}

export interface Regiao {
  id: string
  nome: string
  uf: string
  /** Coordenadas aproximadas, usadas apenas na visão geográfica. */
  x: number
  y: number
}

export interface Filial {
  id: string
  codigo: string
  nome: string
  regiaoId: string
}

export interface Cliente {
  id: string
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  segmento: string
  regiaoId: string
  filialId: string
  situacaoCredito: SituacaoCredito
  diasAtrasoMaximo: number
  desde: string
  contato: { nome: string; email: string; telefone: string }
}

export interface LocalOperacao {
  id: string
  clienteId: string
  nome: string
  endereco: string
  regiaoId: string
}

export interface ContratoItem {
  id: string
  equipamentoId: string
  modalidade: ModalidadeCobranca
  valorMensal: number
  franquiaMono: number | null
  franquiaColor: number | null
  precoExcedenteMono: number | null
  precoExcedenteColor: number | null
  vigenciaInicio: string
  vigenciaFim: string | null
  status: 'RESERVADO' | 'ATIVO' | 'SUSPENSO' | 'ENCERRADO' | 'SUBSTITUIDO'
}

export interface Contrato {
  id: string
  numero: string
  clienteId: string
  filialId: string
  status: ContratoStatus
  dataInicio: string
  dataFim: string
  indiceReajuste: 'IPCA' | 'IGPM' | 'FIXO'
  diaVencimento: number
  responsavel: string
  itens: ContratoItem[]
  observacao?: string
}

export interface LeituraContador {
  competencia: string
  mono: number
  color: number
}

export interface Equipamento {
  id: string
  patrimonio: string
  numeroSerie: string
  modeloId: string
  categoria: CategoriaCodigo
  filialId: string
  status: EquipamentoStatus
  motivoIndisponibilidade: string | null
  bloqueado: boolean
  bloqueioMotivo: string | null
  clienteId: string | null
  localId: string | null
  contratoId: string | null
  regiaoId: string
  /** Contador acumulado. Zerado para categorias sem medidor. */
  contadorMono: number
  contadorColor: number
  /** Últimos 12 meses de consumo, do mais antigo ao mais recente. */
  historicoConsumo: LeituraContador[]
  dataAquisicao: string
  valorAquisicao: number
  receita12m: number
  custoManutencao12m: number
  diasParado: number
  ultimaPreventiva: string | null
  proximaPreventivaPaginas: number | null
}

export interface Tecnico {
  id: string
  nome: string
  especialidades: FamiliaEquipamento[]
  regiaoId: string
  cargaAtual: number
}

export interface OrdemServico {
  id: string
  numero: string
  equipamentoId: string
  clienteId: string | null
  tipo: 'CORRETIVA' | 'PREVENTIVA' | 'INSTALACAO' | 'RETIRADA' | 'INSPECAO'
  status: OsStatus
  prioridade: 'BAIXA' | 'MEDIA' | 'ALTA' | 'CRITICA'
  sintoma: string
  causaRaiz: string | null
  abertaEm: string
  prazoSolucaoEm: string
  concluidaEm: string | null
  tecnicoId: string | null
  minutosApontados: number
  custoMaoObra: number
  custoPecas: number
  pecasUsadas: { pecaId: string; quantidade: number }[]
}

export interface Peca {
  id: string
  codigo: string
  descricao: string
  categoria: 'CONSUMIVEL' | 'COMPONENTE' | 'ACESSORIO'
  aplicacao: CategoriaCodigo[]
  unidade: string
  custoMedio: number
  saldo: number
  reservado: number
  estoqueMinimo: number
  pontoPedido: number
  leadTimeDias: number
  fornecedor: string
  consumo12m: number
}

export interface FaturaItem {
  descricao: string
  equipamentoPatrimonio: string
  modalidade: ModalidadeCobranca
  valorFixo: number
  franquiaMono: number | null
  consumoMono: number
  excedenteMono: number
  valorExcedenteMono: number
  franquiaColor: number | null
  consumoColor: number
  excedenteColor: number
  valorExcedenteColor: number
  total: number
  observacao?: string
}

export interface Fatura {
  id: string
  numero: string
  clienteId: string
  contratoId: string
  competencia: string
  status: FaturaStatus
  emissao: string
  vencimento: string
  valorBruto: number
  desconto: number
  valorLiquido: number
  valorPago: number
  diasAtraso: number
  itens: FaturaItem[]
}

export interface SerieMensal {
  competencia: string
  valor: number
}

export interface Indicadores {
  receitaMes: number
  receitaMesAnterior: number
  mrr: number
  mrrAnterior: number
  ticketMedio: number
  equipamentosAtivos: number
  equipamentosLocados: number
  equipamentosDisponiveis: number
  equipamentosManutencao: number
  equipamentosBloqueados: number
  taxaOcupacao: number
  taxaOcupacaoAnterior: number
  margemOperacional: number
  margemOperacionalAnterior: number
  inadimplencia: number
  inadimplenciaAnterior: number
  slaCumprimento: number
  slaAnterior: number
  mttrHoras: number
  mttrAnterior: number
  disponibilidade: number
  custoManutencaoMes: number
  paginasMes: number
  contratosAtivos: number
  contratosVencendo: number
  chamadosAbertos: number
  chamadosEmRiscoSla: number
  pecasAbaixoMinimo: number
  pendenciasMedicao: number
  serieReceita: SerieMensal[]
  serieCusto: SerieMensal[]
  seriePaginas: SerieMensal[]
  serieSla: SerieMensal[]
}

export interface BaseDados {
  regioes: Regiao[]
  filiais: Filial[]
  fabricantes: Fabricante[]
  modelos: Modelo[]
  categorias: Categoria[]
  clientes: Cliente[]
  locais: LocalOperacao[]
  contratos: Contrato[]
  equipamentos: Equipamento[]
  tecnicos: Tecnico[]
  ordens: OrdemServico[]
  pecas: Peca[]
  faturas: Fatura[]
  indicadores: Indicadores
}
