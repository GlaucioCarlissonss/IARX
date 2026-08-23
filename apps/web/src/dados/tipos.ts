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
  cidade: string
  uf: string
  /**
   * Coordenadas geográficas reais.
   *
   * Antes eram `x`/`y` em pixels de um mapa que nunca foi construído. Latitude
   * e longitude sobrevivem a qualquer projeção — é o que permite trocar o
   * desenho do mapa sem recalcular a posição de nenhum marcador.
   */
  lat: number
  lon: number
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
  /** Sede do cliente. Deriva da praça, com deslocamento próprio do endereço. */
  lat: number
  lon: number
  /**
   * Proveniência da coordenada.
   *
   * Sem ela, ninguém sabe se um ponto veio do cadastro à mão, da praça do
   * cliente ou de uma busca de endereço — e portanto ninguém sabe se pode
   * corrigi-lo. É a diferença entre uma coordenada que se confia para despachar
   * técnico e uma que se confere antes.
   */
  geoPrecisao?: PrecisaoGeo
  geoFonte?: string
  geoAtualizadoEm?: string
}

export type PrecisaoGeo = 'DECLARADA' | 'GEOCODIFICADO' | 'RASTREADA' | 'APROXIMADA'

export interface LocalOperacao {
  id: string
  clienteId: string
  nome: string
  endereco: string
  regiaoId: string
  lat: number
  lon: number
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
  /**
   * Procedência fiscal: a unidade da nota de compra que originou este ativo.
   *
   * Ausente no parque cadastrado antes do módulo de notas — e é justamente
   * essa ausência que a tela do parque precisa mostrar, porque ativo sem
   * procedência tem valor de aquisição sem origem verificável.
   */
  notaSerieId?: string
  /** Herdada do item da nota na integração e congelada ali (RN-L06). */
  garantiaAte?: string
}

/* ------------------------------------------------------- nota fiscal de compra */

export type NfStatus = 'PENDENTE_CONFERENCIA' | 'CONFERIDA' | 'INTEGRADA' | 'CANCELADA'

export interface Fornecedor {
  id: string
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  uf: string
  inscricaoEstadual: string
}

/** Uma unidade física da nota — vira exatamente um equipamento na integração. */
export interface NotaFiscalSerie {
  id: string
  numeroSerie: string
  patrimonio: string
  /** Preenchido na integração. Enquanto nulo, a unidade ainda não é ativo. */
  equipamentoId: string | null
}

export interface NotaFiscalItem {
  id: string
  numeroItem: number
  modeloId: string
  /** Descrição como veio na nota, sem normalizar — é o que o fisco lê. */
  descricaoNf: string
  codigoFornecedor: string
  ncm: string
  cfop: string
  unidade: string
  quantidade: number
  valorUnitario: number
  valorTotalItem: number
  garantiaMeses: number | null
  garantiaAte: string | null
  series: NotaFiscalSerie[]
}

export interface NotaFiscal {
  id: string
  fornecedorId: string
  filialDestinoId: string
  numero: string
  serie: string
  chaveAcesso: string | null
  modeloDocumento: string
  dataEmissao: string
  dataEntrada: string

  /** Composição do layout 4.00: vNF = vProd + vST + vFrete + vSeg + vOutro + vIPI − vDesc. */
  valorProdutos: number
  valorFrete: number
  valorSeguro: number
  valorOutrasDespesas: number
  valorDesconto: number
  valorIpi: number
  valorIcms: number
  valorIcmsSt: number
  valorTotal: number

  /**
   * Regime tributário gravado **na nota**, não só em parâmetro do tenant.
   * Mudança de regime não pode reprecificar aquisição já feita.
   */
  icmsRecuperavel: boolean
  ipiRecuperavel: boolean

  status: NfStatus
  origemDados: 'MANUAL' | 'XML'
  observacao?: string
  conferidaEm: string | null
  conferidaPor: string | null
  integradaEm: string | null
  integradaPor: string | null
  canceladaEm: string | null
  motivoCancelamento: string | null
  criadaPor: string
  itens: NotaFiscalItem[]
}

export interface Tecnico {
  id: string
  nome: string
  especialidades: FamiliaEquipamento[]
  regiaoId: string
  cargaAtual: number
}

/* ------------------------------------------------ usuários e acesso */

export type StatusUsuario = 'ATIVO' | 'INATIVO' | 'BLOQUEADO'

export interface Usuario {
  id: string
  nome: string
  email: string
  /**
   * Interno é gente da locadora; cliente é gente do locatário.
   *
   * A distinção não é cosmética: usuário de cliente nunca recebe permissão de
   * escrita de cadastro (RN-L25), e o eixo `clienteId` é o que a RLS usa para
   * recortar o que ele enxerga.
   */
  tipo: 'INTERNO' | 'CLIENTE'
  clienteId: string | null
  status: StatusUsuario
  perfilIds: string[]
  /** Vazio significa "todas" — o escopo do perfil é quem restringe de fato. */
  filiaisIds: string[]
  ultimoAcesso: string | null
  criadoEm: string
  /**
   * Convite aceito define a senha; até lá o usuário existe e não entra.
   *
   * É por isso que não há campo de senha aqui: o administrador **nunca** a
   * define. Senha definida por terceiro é senha compartilhada.
   */
  conviteAceito: boolean
}

/**
 * Perfil editável.
 *
 * Distinto de `Perfil` em `lib/permissoes.ts`, que é a lista fixa usada pelo
 * seletor de demonstração: este é o registro que a tela de perfis cria e
 * altera, espelhando `public.perfil` do banco.
 */
export interface PerfilGravado {
  id: string
  nome: string
  descricao: string
  tipo: 'INTERNO' | 'CLIENTE'
  /** Perfil de sistema é estrutural: atribuível, nunca editável (RN-L13). */
  isSistema: boolean
  permissoes: string[]
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

/* --------------------------------------------------------------- anexos --- */

export type EntidadeAnexo = 'CONTRATO' | 'CLIENTE' | 'NOTA_FISCAL'

/**
 * Classificação do documento.
 *
 * Existe para o anexo ser encontrável depois. Uma lista de doze arquivos com
 * nomes como "digitalizado_03.pdf" é indistinguível de nenhuma lista: quem
 * procura o contrato assinado abre um por um.
 */
export type CategoriaAnexo =
  | 'CONTRATO_ASSINADO'
  | 'PROPOSTA'
  | 'ADITIVO'
  | 'TERMO_ENTREGA'
  | 'CARTAO_CNPJ'
  | 'CONTRATO_SOCIAL'
  | 'CERTIDAO'
  | 'PROCURACAO'
  /**
   * Documento fiscal. Retenção mínima de 5 anos (CTN art. 173) — a remoção é
   * recusada dentro do prazo, e é por isso que a categoria é separada.
   */
  | 'XML_NFE'
  | 'DANFE'
  | 'BOLETO_COMPRA'
  | 'OUTRO'

export interface Anexo {
  id: string
  entidade: EntidadeAnexo
  entidadeId: string
  nome: string
  /** Tipo informado pelo navegador. Vazio quando ele não reconhece a extensão. */
  tipoMime: string
  tamanhoBytes: number
  categoria: CategoriaAnexo
  descricao?: string
  enviadoEm: string
  enviadoPor: string
  /**
   * Conteúdo do arquivo, mantido em memória nesta demonstração.
   *
   * Ausente nos anexos da massa gerada, que só têm metadados: fingir um
   * conteúdo que não existe faria o botão de baixar entregar um arquivo vazio,
   * e um arquivo vazio é pior que a ausência declarada dele.
   */
  conteudo?: Blob
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
  /** Últimas 12 competências (AAAA-MM), da mais antiga à mais recente. */
  competencias: string[]
  regioes: Regiao[]
  filiais: Filial[]
  fabricantes: Fabricante[]
  modelos: Modelo[]
  categorias: Categoria[]
  clientes: Cliente[]
  locais: LocalOperacao[]
  contratos: Contrato[]
  anexos: Anexo[]
  fornecedores: Fornecedor[]
  notasFiscais: NotaFiscal[]
  tabelasFranquia: TabelaFranquia[]
  tabelasPreco: TabelaPreco[]
  descontos: DescontoComercial[]
  equipamentos: Equipamento[]
  tecnicos: Tecnico[]
  usuarios: Usuario[]
  perfis: PerfilGravado[]
  ordens: OrdemServico[]
  pecas: Peca[]
  faturas: Fatura[]
  centrosCusto: CentroCusto[]
  contasBancarias: ContaBancaria[]
  movimentacoes: Movimentacao[]
  alcadas: FaixaAlcada[]
  titulosPagar: TituloPagar[]
  delegacoes: DelegacaoAprovacao[]
  titulosReceber: TituloReceber[]
  competencias_fechamento: CompetenciaFechamento[]
  recorrencias: Recorrencia[]
  lancamentosFuturos: LancamentoFuturo[]
  cenariosCaixa: CenarioCaixa[]
  indicadores: Indicadores
}

/* ----------------------------------------------- base do financeiro */

/**
 * Centro de custo — dimensão de análise hierárquica, até três níveis.
 *
 * Filial é uma dimensão só, e insuficiente: duas equipes na mesma filial não se
 * distinguem por ela. `empresaId` nulo é centro global do locatário, o caso
 * comum de "Administrativo" — ausência deliberada de vínculo, não dado faltando.
 */
export interface CentroCusto {
  id: string
  empresaId: string | null
  codigo: string
  nome: string
  descricao: string
  centroPaiId: string | null
  ativo: boolean
}

export type ContaTipo = 'CORRENTE' | 'POUPANCA' | 'PAGAMENTO'
export type ContaStatus = 'ATIVA' | 'INATIVA' | 'BLOQUEADA'

/**
 * Conta bancária. **Sem campo de saldo**, de propósito.
 *
 * O saldo é derivado das movimentações por `saldoDaConta()`, espelhando
 * `app.saldo_conta` do banco. Uma cópia guardada aqui divergiria na primeira
 * escrita que esquecesse de atualizá-la, e a divergência apareceria como
 * dinheiro que não fecha.
 */
export interface ContaBancaria {
  id: string
  empresaId: string
  bancoCodigo: string
  /** Nome do banco, para exibição. Derivado do código, não digitado. */
  bancoNome: string
  agencia: string
  numero: string
  tipo: ContaTipo
  apelido: string
  saldoInicial: number
  dataSaldoInicial: string
  limiteCredito: number | null
  status: ContaStatus
}

export type MovimentoTipo =
  | 'ENTRADA'
  | 'SAIDA'
  | 'TRANSFERENCIA_ENTRADA'
  | 'TRANSFERENCIA_SAIDA'
  | 'TAXA'

export interface Movimentacao {
  id: string
  contaId: string
  tipo: MovimentoTipo
  /** Sempre positivo. O sinal é o tipo — como na migração 0017. */
  valor: number
  dataMovimento: string
  descricao: string
  transferenciaParId: string | null
  estornaId: string | null
  motivo: string | null
  conciliado: boolean
  conciliadoEm: string | null
  criadoEm: string
}

/* ------------------------------------------------------ contas a pagar */

export type ClassificacaoPagar = 'DESPESA_FIXA' | 'DESPESA_VARIAVEL' | 'INVESTIMENTO'

export type StatusPagar =
  | 'PENDENTE'
  | 'EM_APROVACAO'
  | 'APROVADO'
  | 'AGENDADO'
  | 'PAGO_PARCIAL'
  | 'PAGO'
  | 'CANCELADO'
  | 'EM_DISPUTA'
  | 'REJEITADO'

export type FormaPagamento = 'TRANSFERENCIA' | 'BOLETO' | 'PIX' | 'CHEQUE'

/**
 * Faixa de alçada de aprovação de pagamento.
 *
 * O limite é **por perfil**, e é o cadastro que decide quantos níveis um valor
 * exige (RN-F01) e qual posto cada aprovador tem (RN-F03). Fixar os valores no
 * código seria inventar regra de negócio: cada operação tem os seus, e mudá-los
 * é ato de administração, não implantação.
 */
export type TipoAlcada = 'APROVACAO_PAGAMENTO' | 'EMISSAO_FATURA' | 'DESCONTO'

export interface FaixaAlcada {
  id: string
  perfilId: string
  /**
   * O tipo existe na tabela `alcada` desde a migração 0002, e passou a importar
   * aqui quando o segundo módulo começou a usá-la.
   *
   * Enquanto só contas a pagar consultava a alçada, o tipo era implícito e a
   * omissão não doía. Com contas a receber, uma faixa sem tipo faria o limite de
   * aprovação de pagamento contar como nível de emissão de fatura — os dois
   * fluxos passariam a se contaminar, e o sintoma seria uma cobrança exigindo
   * três aprovações porque alguém cadastrou uma alçada de compra.
   */
  tipo: TipoAlcada
  /** Faixa em reais. Nulo em alçada percentual. */
  limiteValor: number | null
  /** Teto percentual — usado por `DESCONTO`. Nulo em alçada de valor. */
  limitePercentual: number | null
}

/** Uma linha de rateio. Percentual, não valor fixo — decisão D-16. */
export interface RateioPagar {
  centroCustoId: string
  percentual: number
}

export interface AprovacaoPagar {
  nivel: number
  /**
   * A rodada existe por causa da rejeição: o título volta a PENDENTE, é
   * corrigido e reenviado, e a decisão antiga fica preservada. Sobrescrevê-la
   * apagaria justamente a explicação da correção.
   */
  rodada: number
  aprovadorId: string | null
  decisao: 'APROVADO' | 'REJEITADO' | null
  decididoEm: string | null
  justificativa: string | null
  /** Preenchido quando quem decidiu agiu por delegação vigente. */
  delegadoDe: string | null
}

export interface PagamentoPagar {
  id: string
  valorPago: number
  dataPagamento: string
  contaId: string
  forma: FormaPagamento
  /** A movimentação bancária gerada junto. Baixa e extrato nascem no mesmo ato. */
  movimentacaoId: string | null
  estornadoEm: string | null
  estornoMotivo: string | null
}

/**
 * Título a pagar.
 *
 * **Sem campo de valor devido e sem campo de saldo**, pelo mesmo motivo que
 * `ContaBancaria` não tem saldo: os dois são derivados — `valorDevidoDe()` e
 * `saldoDoTitulo()` — e espelham a coluna gerada e a função do banco. Se não há
 * caminho de escrita, não há caminho de divergência.
 *
 * `parcelaTotal` sem `parcelaNumero` é o estado legítimo do **pai** de um
 * parcelamento: ele sabe que são doze, e não é nenhuma delas.
 */
export interface TituloPagar {
  id: string
  fornecedorId: string | null
  descricao: string
  classificacao: ClassificacaoPagar
  /*
   * Filial, pelo mesmo motivo que `TituloReceber` tem a dela: é o recorte em que
   * a projeção de caixa filtra. Sem a coluna aqui, um recorte por filial somaria
   * as entradas daquela filial e as saídas de **todas** — e o erro é plausível,
   * porque o resultado fica mais pessimista, não mais otimista.
   */
  filialId: string | null
  contratoFornecedorRef: string | null
  valorOriginal: number
  /** Multa, juro ou desconto negociado. Nulo = nunca ajustado. */
  valorAjustado: number | null
  motivoAjuste: string | null
  dataEmissao: string
  dataVencimento: string
  status: StatusPagar
  tituloPaiId: string | null
  parcelaNumero: number | null
  parcelaTotal: number | null
  /** Quem lançou. É o que sustenta a segregação de funções da RN-F04. */
  criadoPor: string
  criadoEm: string
  rateio: RateioPagar[]
  aprovacoes: AprovacaoPagar[]
  pagamentos: PagamentoPagar[]
}

/**
 * Delegação temporária de alçada.
 *
 * Existe porque a alternativa real é emprestar credencial: sem um caminho
 * legítimo para as férias do gerente, alguém digita a senha de outra pessoa — e
 * aí a trilha de auditoria passa a mentir sobre quem aprovou.
 */
export interface DelegacaoAprovacao {
  id: string
  deleganteId: string
  delegadoId: string
  nivel: number
  inicio: string
  fim: string
  motivo: string
}

/* ---------------------------------------------------- contas a receber */

export type OrigemReceber = 'CONTRATUAL' | 'AVULSO'

export type StatusReceber =
  | 'PENDENTE_APROVACAO'
  | 'PENDENTE'
  | 'APROVADO'
  | 'RECEBIDO_PARCIAL'
  | 'RECEBIDO'
  | 'CANCELADO'
  | 'EM_DISPUTA'
  /** Encerrado **sem** entrada de caixa. Nunca somado com RECEBIDO (RN-F14). */
  | 'BAIXADO'

export type FormaRecebimento = 'TRANSFERENCIA' | 'BOLETO' | 'PIX' | 'CHEQUE'

export interface RateioReceber {
  centroCustoId: string
  percentual: number
}

export interface AprovacaoReceber {
  nivel: number
  rodada: number
  aprovadorId: string | null
  decisao: 'APROVADO' | 'REJEITADO' | null
  decididoEm: string | null
  justificativa: string | null
  delegadoDe: string | null
}

export interface RecebimentoTitulo {
  id: string
  valorRecebido: number
  dataRecebimento: string
  contaId: string
  forma: FormaRecebimento
  movimentacaoId: string | null
  estornadoEm: string | null
  estornoMotivo: string | null
}

/**
 * Título a receber — D-20: "fatura" e "contas a receber" são a mesma linha.
 *
 * `origem = 'CONTRATUAL'` é a cobrança gerada do contrato e do consumo;
 * `'AVULSO'` é o lançamento manual.
 *
 * **Sem campo de saldo e sem `emAtraso`.** Saldo é `saldoDoTituloReceber()`,
 * derivado dos recebimentos não estornados; atraso é `vencimento < hoje` com o
 * título em aberto. O modelo simulado de `Fatura` guarda `status: 'EM_ATRASO'` e
 * `diasAtraso` — no dia seguinte ao vencimento os dois estão errados, e só um
 * job noturno os corrigiria. É o mesmo defeito de classe que guardar saldo.
 */
export interface TituloReceber {
  id: string
  /** Sequencial por locatário. **Não** é número de NF-e/NFS-e. */
  numeroTitulo: number
  clienteId: string
  filialId: string | null
  contratoId: string | null
  competencia: string | null
  origem: OrigemReceber
  descricao: string
  valorOriginal: number
  desconto: number
  descontoMotivo: string | null
  descontoPor: string | null
  dataEmissao: string
  dataVencimento: string
  status: StatusReceber
  /** RN-F14: por que o título foi encerrado sem entrada de caixa. */
  baixaMotivo: string | null
  baixadoEm: string | null
  /** RN-F11: por que este título nasceu em disputa. */
  excecaoGeracao: string | null
  tituloPaiId: string | null
  parcelaNumero: number | null
  parcelaTotal: number | null
  criadoPor: string
  criadoEm: string
  rateio: RateioReceber[]
  aprovacoes: AprovacaoReceber[]
  recebimentos: RecebimentoTitulo[]
}

/* ------------------------------ Módulos 12 e 13: previsto e caixa */

export type Lado = 'PAGAR' | 'RECEBER'
export type Periodicidade = 'MENSAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL'
/*
 * A classificação de um lançamento é a **mesma** de um título a pagar.
 *
 * Não há `ClassificacaoLancamento` própria de propósito: a união seria idêntica,
 * e duas cópias do mesmo conjunto divergem no dia em que alguém acrescenta um
 * valor a uma delas. Ela só existe do lado a pagar — uma receita prevista não tem
 * classificação de despesa, e é por isso que o campo é nulável.
 */

export type TipoLancamento =
  | 'DESPESA_RECORRENTE'
  | 'RECEITA_RECORRENTE'
  | 'DESPESA_PARCELADA'
  | 'RECEITA_PARCELADA'
  /** Planejamento, não partida dobrada: sem contrapartida contábil. */
  | 'PROVISAO'

export type StatusLancamento = 'PROGRAMADO' | 'CONVERTIDO' | 'CANCELADO'

/**
 * Recorrência — o **molde** do compromisso periódico.
 *
 * Uma forma só, com discriminador `lado`, e não `RecorrenciaPagar` +
 * `RecorrenciaReceber`: duas formas paralelas para o mesmo conceito dariam duas
 * respostas para "o que está programado". É o raciocínio de D-20 um nível acima.
 *
 * `diaVencimento` vai de 1 a 28. Não é limite técnico: 29, 30 e 31 não existem em
 * todo mês, e o que fazer em fevereiro é regra que ninguém especificou.
 */
export interface Recorrencia {
  id: string
  lado: Lado
  descricao: string
  valorBase: number
  periodicidade: Periodicidade
  diaVencimento: number
  proximaGeracao: string
  ativo: boolean
  empresaId: string | null
  fornecedorId: string | null
  classificacao: ClassificacaoPagar | null
  clienteId: string | null
  centroCustoId: string | null
  contratoId: string | null
  filialId: string | null
}

/**
 * Lançamento futuro — a **instância**, e a camada de intenção.
 *
 * Existe separado do título porque um compromisso previsto se edita à vontade, e
 * um título já criado carrega rodada de aprovação e rateio. Criar o título antes
 * da hora põe em aprovação um compromisso que ainda não existe.
 *
 * **Duas referências, não um id polimórfico com um campo de tipo ao lado.**
 * Exatamente uma preenchida quando CONVERTIDO, nenhuma antes — e é o `nenhuma
 * antes` que impede o estado mais difícil de diagnosticar: a conversão parecendo
 * feita sem ter sido.
 *
 * **Sem campo de atraso e sem `naFilaDeExcecao`.** Atraso é `dataPrevista <=
 * hoje` com o lançamento programado; a fila é `excecaoConversao` preenchida. Um
 * lançamento sai da fila no instante em que o contrato volta a vigorar, sem que
 * ninguém o toque — um booleano gravado estaria errado a partir daí.
 */
export interface LancamentoFuturo {
  id: string
  tipo: TipoLancamento
  /** Consequência de `tipo`, nunca uma segunda escolha. Ver `ladoDoTipo()`. */
  lado: Lado
  descricao: string
  valorPrevisto: number
  dataPrevista: string
  empresaId: string | null
  fornecedorId: string | null
  classificacao: ClassificacaoPagar | null
  clienteId: string | null
  centroCustoId: string | null
  contratoId: string | null
  filialId: string | null
  recorrenciaId: string | null
  status: StatusLancamento
  tituloPagarId: string | null
  tituloReceberId: string | null
  convertidoEm: string | null
  /** RN-F16: por que a conversão foi recusada. Preenchido = fila de exceção. */
  excecaoConversao: string | null
  tentativasConversao: number
  criadoPor: string
  criadoEm: string
}

/**
 * Cenário de caixa.
 *
 * `inadimplencia` se aplica **só a entradas** (RN-F20). Aplicá-la às saídas faria
 * o cenário pessimista deixar a operação mais otimista sobre a própria dívida — o
 * inverso de um teste de estresse.
 */
export interface CenarioCaixa {
  id: string
  nome: string
  /** Percentual, de 0 a 100. */
  inadimplencia: number
  /** Limiar de concentração de saídas num único dia, em % da janela — RN-F22. */
  limiarConcentracao: number
  /** Um só por locatário: dois fariam o painel abrir diferente para duas pessoas. */
  padrao: boolean
}

/**
 * Um dia da projeção — **calculado, nunca guardado**.
 *
 * Não existe coleção de `DiaProjetado` em `BaseDados`, e a ausência é o ponto: a
 * posição de amanhã muda a cada baixa registrada hoje. Guardá-la seria a mesma
 * classe de defeito que guardar saldo de conta.
 */
export interface DiaProjetado {
  dia: string
  entradas: number
  saidas: number
  saldoDia: number
  saldoAcumulado: number
}

export type TipoAlertaCaixa = 'SALDO_NEGATIVO' | 'CONCENTRACAO_SAIDA'

/** Alerta derivado da projeção a cada leitura, nunca gravado. */
export interface AlertaCaixa {
  tipo: TipoAlertaCaixa
  dia: string
  valor: number
  detalhe: string
}

/** Uma competência de medição e o seu estado de fechamento. */
export interface CompetenciaFechamento {
  competencia: string
  /** Nulo enquanto o consumo não foi selado. */
  fechadoEm: string | null
}

/* ------------------------------------------------- tabelas comerciais */

export type TabelaStatus = 'RASCUNHO' | 'ATIVA' | 'INATIVA'

/** Alvo de uma linha de tabela: exatamente um dos dois. */
export interface AlvoTabela {
  categoria: CategoriaCodigo | null
  modeloId: string | null
}

export interface FranquiaItem extends AlvoTabela {
  id: string
  franquiaMono: number
  franquiaColor: number
  /** ITEM apura o excedente por ativo; CONTRATO, sobre a soma deles. */
  escopo: 'ITEM' | 'CONTRATO'
  excedenteMono: number
  excedenteColor: number
  permiteAcumulo: boolean
  mesesAcumulo: number | null
}

export interface TabelaFranquia {
  id: string
  nome: string
  descricao: string
  vigenciaInicio: string
  vigenciaFim: string | null
  status: TabelaStatus
  versao: number
  substituiId: string | null
  itens: FranquiaItem[]
}

export interface PrecoItem extends AlvoTabela {
  id: string
  valorMensal: number
  valorInstalacao: number
  valorRetirada: number
  prazoMinimoMeses: number | null
}

export interface TabelaPreco {
  id: string
  nome: string
  descricao: string
  vigenciaInicio: string
  vigenciaFim: string | null
  status: TabelaStatus
  versao: number
  /** Precedência: CONTRATO vence CLIENTE, que vence GERAL. */
  abrangencia: 'GERAL' | 'CLIENTE' | 'CONTRATO'
  clienteId: string | null
  contratoId: string | null
  indiceReajuste: 'IPCA' | 'IGPM' | 'INPC' | 'FIXO'
  mesesReajuste: number
  itens: PrecoItem[]
}

export interface DescontoComercial {
  id: string
  contratoId: string | null
  contratoItemId: string | null
  tipo: 'PERCENTUAL' | 'VALOR_FIXO'
  percentual: number | null
  valor: number | null
  vigenciaInicio: string
  vigenciaFim: string | null
  motivo: string
}
