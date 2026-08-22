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
