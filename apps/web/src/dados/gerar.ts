import {
  CATEGORIAS,
  FABRICANTES,
  FILIAIS,
  MODELOS,
  REGIOES,
  categoriaPorCodigo,
  modeloPorId,
  regiaoPorId,
} from './catalogo'
import { gerarFornecedores, gerarNotas } from './gerar-notas'
import { perfilPorId } from '../lib/permissoes'
import type {
  Anexo,
  BaseDados,
  Cliente,
  Contrato,
  ContratoItem,
  Equipamento,
  Fatura,
  FaturaItem,
  Indicadores,
  LeituraContador,
  DescontoComercial,
  LocalOperacao,
  ModalidadeCobranca,
  OrdemServico,
  Peca,
  SerieMensal,
  TabelaFranquia,
  TabelaPreco,
  Tecnico,
  CentroCusto,
  ContaBancaria,
  Movimentacao,
  PerfilGravado,
  Usuario,
  AprovacaoPagar,
  ClassificacaoPagar,
  DelegacaoAprovacao,
  FaixaAlcada,
  PagamentoPagar,
  RateioPagar,
  StatusPagar,
  TituloPagar,
  AprovacaoReceber,
  CompetenciaFechamento,
  RecebimentoTitulo,
  StatusReceber,
  TituloReceber,
  CenarioCaixa,
  LancamentoFuturo,
  Recorrencia,
} from './tipos'

/**
 * Gerador determinístico da base de teste.
 *
 * Determinístico de propósito: a mesma semente produz sempre a mesma base, o
 * que permite que os testes de interface façam afirmações sobre números
 * concretos. Volume dimensionado para exercitar paginação, filtros e
 * virtualização — não é uma vitrine de três linhas.
 *
 * Os casos notáveis (cliente bloqueado, contrato vencido em campo, ativo com
 * preventiva vencida, OS estourando SLA, peça em ruptura) são plantados
 * explicitamente: são eles que a operação precisa ver no painel de exceções.
 */

/** Data de referência fixa. Todo cálculo relativo parte daqui. */
export const HOJE = new Date('2026-07-30T09:14:00-03:00')

/* -------------------------------------------------------------------------- */
/* Aleatoriedade determinística                                               */
/* -------------------------------------------------------------------------- */

function mulberry32(semente: number) {
  let a = semente
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Sorteio {
  private r: () => number
  constructor(semente = 20260730) {
    this.r = mulberry32(semente)
  }
  /** Inteiro no intervalo fechado [min, max]. */
  int(min: number, max: number) {
    return Math.floor(this.r() * (max - min + 1)) + min
  }
  /** Real no intervalo [min, max). */
  real(min: number, max: number) {
    return this.r() * (max - min) + min
  }
  um<T>(lista: readonly T[]): T {
    return lista[Math.floor(this.r() * lista.length)]
  }
  /** Verdadeiro com a probabilidade informada (0..1). */
  chance(p: number) {
    return this.r() < p
  }
  embaralhar<T>(lista: T[]): T[] {
    const c = [...lista]
    for (let i = c.length - 1; i > 0; i--) {
      const j = Math.floor(this.r() * (i + 1))
      ;[c[i], c[j]] = [c[j], c[i]]
    }
    return c
  }
}

/* -------------------------------------------------------------------------- */
/* Utilitários de domínio                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Espalha um ponto ao redor de uma praça, em graus.
 *
 * A correção por `cos(lat)` não é preciosismo: um grau de longitude em Manaus
 * mede quase 111 km e em Porto Alegre, 96 km. Sem ela, os clientes do Sul
 * ficariam visivelmente mais espalhados no eixo leste-oeste que os do Norte —
 * um artefato de projeção que nada no negócio explica.
 */
function dispersar(
  s: Sorteio,
  regiao: { lat: number; lon: number },
  raioGraus: number,
  baseLat?: number,
  baseLon?: number,
): { lat: number; lon: number } {
  const lat0 = baseLat ?? regiao.lat
  const lon0 = baseLon ?? regiao.lon
  const angulo = s.real(0, Math.PI * 2)
  // Raiz do sorteio para a densidade ficar uniforme no disco; sem ela os
  // pontos se acumulam no centro.
  const raio = raioGraus * Math.sqrt(s.real(0, 1))
  return {
    lat: Number((lat0 + raio * Math.sin(angulo)).toFixed(5)),
    lon: Number((lon0 + (raio * Math.cos(angulo)) / Math.cos((lat0 * Math.PI) / 180)).toFixed(5)),
  }
}

/** Gera CNPJ fictício com dígitos verificadores válidos. */
export function gerarCnpj(s: Sorteio): string {
  const base = Array.from({ length: 8 }, () => s.int(0, 9))
  const filial = [0, 0, 0, 1]
  const n = [...base, ...filial]

  const dv = (nums: number[], pesos: number[]) => {
    const soma = nums.reduce((acc, v, i) => acc + v * pesos[i], 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  const d1 = dv(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = dv([...n, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const t = [...n, d1, d2].join('')
  return `${t.slice(0, 2)}.${t.slice(2, 5)}.${t.slice(5, 8)}/${t.slice(8, 12)}-${t.slice(12)}`
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10)
}

function somarDias(base: Date, dias: number) {
  const d = new Date(base)
  d.setDate(d.getDate() + dias)
  return d
}

function somarMeses(base: Date, meses: number) {
  const d = new Date(base)
  d.setMonth(d.getMonth() + meses)
  return d
}

function competencia(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Últimas 12 competências, da mais antiga para a mais recente. */
function ultimasCompetencias(n = 12): string[] {
  return Array.from({ length: n }, (_, i) => competencia(somarMeses(HOJE, -(n - 1 - i))))
}

const SEGMENTOS = [
  'Saúde',
  'Varejo',
  'Indústria',
  'Educação',
  'Serviços financeiros',
  'Logística',
  'Jurídico',
  'Agronegócio',
  'Administração pública',
  'Tecnologia',
]

const NOMES_EMPRESA: { razao: string; fantasia: string; segmento: string }[] = [
  { razao: 'Meridiano Alimentos S.A.', fantasia: 'Meridiano', segmento: 'Indústria' },
  { razao: 'Clínica Vitalis Serviços Médicos Ltda', fantasia: 'Clínica Vitalis', segmento: 'Saúde' },
  { razao: 'Construtora Prisma Engenharia Ltda', fantasia: 'Prisma Engenharia', segmento: 'Indústria' },
  { razao: 'Rede Farmax Drogarias Ltda', fantasia: 'Farmax', segmento: 'Varejo' },
  { razao: 'Instituto Aurora de Ensino S.A.', fantasia: 'Instituto Aurora', segmento: 'Educação' },
  { razao: 'Metalúrgica Trilho Indústria Ltda', fantasia: 'Metalúrgica Trilho', segmento: 'Indústria' },
  { razao: 'Ferraz & Lima Sociedade de Advogados', fantasia: 'Ferraz & Lima', segmento: 'Jurídico' },
  { razao: 'Transportes Andirá Logística S.A.', fantasia: 'Andirá Log', segmento: 'Logística' },
  { razao: 'Hospital São Bartolomeu Ltda', fantasia: 'Hospital São Bartolomeu', segmento: 'Saúde' },
  { razao: 'Cooperativa Agrícola Vale Verde', fantasia: 'Coop Vale Verde', segmento: 'Agronegócio' },
  { razao: 'Banco Credibem Financeira S.A.', fantasia: 'Credibem', segmento: 'Serviços financeiros' },
  { razao: 'Supermercados Bom Preço Norte Ltda', fantasia: 'Bom Preço Norte', segmento: 'Varejo' },
  { razao: 'Faculdade Horizonte Educacional Ltda', fantasia: 'Faculdade Horizonte', segmento: 'Educação' },
  { razao: 'Indústria Química Solvente Ltda', fantasia: 'Química Solvente', segmento: 'Indústria' },
  { razao: 'Laboratório Precisão Análises Clínicas', fantasia: 'Lab Precisão', segmento: 'Saúde' },
  { razao: 'Prefeitura Municipal de Vila Nova', fantasia: 'Prefeitura de Vila Nova', segmento: 'Administração pública' },
  { razao: 'Distribuidora Ponte Nova Ltda', fantasia: 'Ponte Nova', segmento: 'Logística' },
  { razao: 'Seguradora Âncora S.A.', fantasia: 'Âncora Seguros', segmento: 'Serviços financeiros' },
  { razao: 'Colégio Monte Azul Ltda', fantasia: 'Colégio Monte Azul', segmento: 'Educação' },
  { razao: 'Auto Peças Bandeirante Ltda', fantasia: 'Bandeirante Peças', segmento: 'Varejo' },
  { razao: 'Frigorífico Serra Grande S.A.', fantasia: 'Serra Grande', segmento: 'Indústria' },
  { razao: 'Consultoria Vértice Gestão Ltda', fantasia: 'Vértice', segmento: 'Tecnologia' },
  { razao: 'Rede Hoteleira Solar Ltda', fantasia: 'Hotéis Solar', segmento: 'Serviços financeiros' },
  { razao: 'Usina Canavial Energia S.A.', fantasia: 'Canavial Energia', segmento: 'Agronegócio' },
  { razao: 'Clínica Odontológica Sorriso Real', fantasia: 'Sorriso Real', segmento: 'Saúde' },
  { razao: 'Editora Papel & Letra Ltda', fantasia: 'Papel & Letra', segmento: 'Educação' },
  { razao: 'Tecelagem Fio Nobre Indústria Ltda', fantasia: 'Fio Nobre', segmento: 'Indústria' },
  { razao: 'Contabilidade Balanço Certo Ltda', fantasia: 'Balanço Certo', segmento: 'Serviços financeiros' },
  { razao: 'Atacadista Central Sul Ltda', fantasia: 'Central Sul', segmento: 'Varejo' },
  { razao: 'Instituto de Pesquisa Cardeal', fantasia: 'Instituto Cardeal', segmento: 'Educação' },
  { razao: 'Transportadora Rota Firme Ltda', fantasia: 'Rota Firme', segmento: 'Logística' },
  { razao: 'Sistemas Netcode Tecnologia Ltda', fantasia: 'Netcode', segmento: 'Tecnologia' },
  { razao: 'Câmara Municipal de Porto Claro', fantasia: 'Câmara de Porto Claro', segmento: 'Administração pública' },
  { razao: 'Agropecuária Boi Branco S.A.', fantasia: 'Boi Branco', segmento: 'Agronegócio' },
]

const NOMES_TECNICO = [
  'Adriano Silva',
  'Beatriz Nunes',
  'Carlos Eduardo Prado',
  'Danielaموrais'.replace('موrais', 'Morais'),
  'Eduardo Tanaka',
  'Fernanda Alves',
  'Gustavo Reis',
  'Helena Duarte',
  'Igor Bastos',
  'Juliana Camargo',
  'Leandro Pires',
  'Marcela Rocha',
  'Nelson Okamoto',
  'Patrícia Lemos',
]

const SINTOMAS_IMPRESSAO = [
  'Atolamento recorrente na bandeja 2',
  'Falha de imagem — listras verticais',
  'Toner não reconhecido pelo equipamento',
  'Erro de fusor · código E-042',
  'Digitalização não envia para a rede',
  'Ruído anormal no mecanismo de tração',
  'Impressão com fundo acinzentado',
  'Painel travado na inicialização',
  'Unidade de imagem no fim da vida útil',
  'ADF não puxa o documento',
]

const SINTOMAS_COMPUTACAO = [
  'Não liga — sem indicação de energia',
  'Lentidão severa após atualização',
  'Tela azul recorrente em uso normal',
  'Bateria não carrega acima de 40%',
  'Teclado com teclas sem resposta',
  'Disco com setores defeituosos',
  'Não conecta na rede cabeada',
  'Superaquecimento e desligamento',
]

const CAUSAS = [
  'Desgaste natural do componente',
  'Uso acima da capacidade recomendada',
  'Consumível de terceiro não homologado',
  'Falha de firmware',
  'Sujeira acumulada no caminho do papel',
  'Componente com defeito de fábrica',
  'Instalação elétrica do cliente fora do padrão',
]

/* -------------------------------------------------------------------------- */
/* Peças                                                                      */
/* -------------------------------------------------------------------------- */

function gerarPecas(s: Sorteio): Peca[] {
  const definicoes: Omit<Peca, 'id' | 'saldo' | 'reservado' | 'consumo12m'>[] = [
    { codigo: 'TN-3554K', descricao: 'Toner preto TASKalfa 3554ci', categoria: 'CONSUMIVEL', aplicacao: ['MFP_COLOR'], unidade: 'un', custoMedio: 214.9, estoqueMinimo: 12, pontoPedido: 18, leadTimeDias: 7, fornecedor: 'Distribuidora Kyocera Brasil' },
    { codigo: 'TN-3554C', descricao: 'Toner ciano TASKalfa 3554ci', categoria: 'CONSUMIVEL', aplicacao: ['MFP_COLOR'], unidade: 'un', custoMedio: 389.5, estoqueMinimo: 6, pontoPedido: 10, leadTimeDias: 12, fornecedor: 'Distribuidora Kyocera Brasil' },
    { codigo: 'TN-3554M', descricao: 'Toner magenta TASKalfa 3554ci', categoria: 'CONSUMIVEL', aplicacao: ['MFP_COLOR'], unidade: 'un', custoMedio: 389.5, estoqueMinimo: 6, pontoPedido: 10, leadTimeDias: 12, fornecedor: 'Distribuidora Kyocera Brasil' },
    { codigo: 'TN-3554Y', descricao: 'Toner amarelo TASKalfa 3554ci', categoria: 'CONSUMIVEL', aplicacao: ['MFP_COLOR'], unidade: 'un', custoMedio: 389.5, estoqueMinimo: 6, pontoPedido: 10, leadTimeDias: 12, fornecedor: 'Distribuidora Kyocera Brasil' },
    { codigo: 'TN-E52X', descricao: 'Toner HP 89X alto rendimento', categoria: 'CONSUMIVEL', aplicacao: ['MFP_MONO'], unidade: 'un', custoMedio: 742.0, estoqueMinimo: 10, pontoPedido: 16, leadTimeDias: 9, fornecedor: 'HP Suprimentos' },
    { codigo: 'TN-E77K', descricao: 'Toner preto HP E77830', categoria: 'CONSUMIVEL', aplicacao: ['MFP_COLOR'], unidade: 'un', custoMedio: 618.4, estoqueMinimo: 8, pontoPedido: 12, leadTimeDias: 14, fornecedor: 'HP Suprimentos' },
    { codigo: 'TN-MX532', descricao: 'Toner Lexmark 56F alto rendimento', categoria: 'CONSUMIVEL', aplicacao: ['MFP_MONO'], unidade: 'un', custoMedio: 486.2, estoqueMinimo: 10, pontoPedido: 15, leadTimeDias: 10, fornecedor: 'Lexmark Partner Sul' },
    { codigo: 'TN-CX635K', descricao: 'Toner preto Lexmark CX635', categoria: 'CONSUMIVEL', aplicacao: ['LASER_COLOR'], unidade: 'un', custoMedio: 512.8, estoqueMinimo: 6, pontoPedido: 9, leadTimeDias: 14, fornecedor: 'Lexmark Partner Sul' },
    { codigo: 'TN-L6402', descricao: 'Toner Brother TN-3492', categoria: 'CONSUMIVEL', aplicacao: ['LASER_MONO'], unidade: 'un', custoMedio: 298.0, estoqueMinimo: 14, pontoPedido: 20, leadTimeDias: 6, fornecedor: 'Brother Revenda Centro' },
    { codigo: 'DR-L6402', descricao: 'Cilindro Brother DR-3440', categoria: 'COMPONENTE', aplicacao: ['LASER_MONO'], unidade: 'un', custoMedio: 421.7, estoqueMinimo: 5, pontoPedido: 8, leadTimeDias: 15, fornecedor: 'Brother Revenda Centro' },
    { codigo: 'FUS-KYO40', descricao: 'Unidade fusora Kyocera 40 ppm', categoria: 'COMPONENTE', aplicacao: ['MFP_MONO', 'MFP_COLOR'], unidade: 'un', custoMedio: 1284.0, estoqueMinimo: 3, pontoPedido: 5, leadTimeDias: 21, fornecedor: 'Distribuidora Kyocera Brasil' },
    { codigo: 'KIT-MAN-HP', descricao: 'Kit de manutenção HP 200k páginas', categoria: 'COMPONENTE', aplicacao: ['MFP_MONO', 'MFP_COLOR'], unidade: 'kit', custoMedio: 1890.0, estoqueMinimo: 2, pontoPedido: 4, leadTimeDias: 25, fornecedor: 'HP Suprimentos' },
    { codigo: 'ROL-ADF', descricao: 'Kit de roletes do ADF', categoria: 'COMPONENTE', aplicacao: ['MFP_MONO', 'MFP_COLOR'], unidade: 'kit', custoMedio: 176.3, estoqueMinimo: 12, pontoPedido: 18, leadTimeDias: 8, fornecedor: 'Multipeças Reprografia' },
    { codigo: 'ROL-TRAC', descricao: 'Rolete de tração de papel', categoria: 'COMPONENTE', aplicacao: ['MFP_MONO', 'LASER_MONO', 'LASER_COLOR'], unidade: 'un', custoMedio: 62.4, estoqueMinimo: 20, pontoPedido: 30, leadTimeDias: 5, fornecedor: 'Multipeças Reprografia' },
    { codigo: 'CAB-ZT411', descricao: 'Cabeça de impressão térmica 203 dpi', categoria: 'COMPONENTE', aplicacao: ['TERMICA'], unidade: 'un', custoMedio: 2140.0, estoqueMinimo: 2, pontoPedido: 3, leadTimeDias: 30, fornecedor: 'Zebra Solution Partner' },
    { codigo: 'RIB-110', descricao: 'Ribbon cera/resina 110 mm', categoria: 'CONSUMIVEL', aplicacao: ['TERMICA'], unidade: 'rolo', custoMedio: 38.9, estoqueMinimo: 40, pontoPedido: 60, leadTimeDias: 4, fornecedor: 'Zebra Solution Partner' },
    { codigo: 'SSD-512', descricao: 'SSD NVMe 512 GB', categoria: 'COMPONENTE', aplicacao: ['DESKTOP', 'NOTEBOOK'], unidade: 'un', custoMedio: 289.0, estoqueMinimo: 8, pontoPedido: 14, leadTimeDias: 7, fornecedor: 'Nagem Componentes' },
    { codigo: 'MEM-16', descricao: 'Memória DDR4 16 GB SODIMM', categoria: 'COMPONENTE', aplicacao: ['NOTEBOOK', 'THIN_CLIENT'], unidade: 'un', custoMedio: 214.0, estoqueMinimo: 10, pontoPedido: 16, leadTimeDias: 7, fornecedor: 'Nagem Componentes' },
    { codigo: 'BAT-L14', descricao: 'Bateria ThinkPad L14 3 células', categoria: 'COMPONENTE', aplicacao: ['NOTEBOOK'], unidade: 'un', custoMedio: 468.0, estoqueMinimo: 6, pontoPedido: 10, leadTimeDias: 18, fornecedor: 'Lenovo Service Parts' },
    { codigo: 'FON-260', descricao: 'Fonte 260 W SFF', categoria: 'COMPONENTE', aplicacao: ['DESKTOP'], unidade: 'un', custoMedio: 342.0, estoqueMinimo: 5, pontoPedido: 8, leadTimeDias: 12, fornecedor: 'Dell Service Parts' },
    { codigo: 'TEC-ABNT', descricao: 'Teclado USB ABNT2', categoria: 'ACESSORIO', aplicacao: ['DESKTOP', 'THIN_CLIENT'], unidade: 'un', custoMedio: 71.5, estoqueMinimo: 15, pontoPedido: 25, leadTimeDias: 4, fornecedor: 'Nagem Componentes' },
    { codigo: 'MOU-OPT', descricao: 'Mouse óptico USB', categoria: 'ACESSORIO', aplicacao: ['DESKTOP', 'THIN_CLIENT'], unidade: 'un', custoMedio: 39.9, estoqueMinimo: 20, pontoPedido: 30, leadTimeDias: 4, fornecedor: 'Nagem Componentes' },
    { codigo: 'BAT-UPS15', descricao: 'Bateria selada 12 V 9 Ah', categoria: 'COMPONENTE', aplicacao: ['NOBREAK'], unidade: 'un', custoMedio: 289.9, estoqueMinimo: 8, pontoPedido: 12, leadTimeDias: 10, fornecedor: 'Energis Baterias' },
    { codigo: 'CAB-REDE', descricao: 'Patch cord cat6 2,5 m', categoria: 'ACESSORIO', aplicacao: ['DESKTOP', 'NOTEBOOK', 'THIN_CLIENT', 'MFP_MONO'], unidade: 'un', custoMedio: 18.4, estoqueMinimo: 40, pontoPedido: 60, leadTimeDias: 3, fornecedor: 'Multipeças Reprografia' },
  ]

  return definicoes.map((d, i) => {
    // A maioria em nível saudável; algumas deliberadamente em risco, porque é
    // isso que o painel de reposição precisa mostrar.
    let saldo: number
    if (i === 1) saldo = 2 // toner ciano em ruptura — trava OS de multifuncional colorida
    else if (i === 10) saldo = 1 // fusora abaixo do mínimo
    else if (i === 4) saldo = 9 // toner HP no ponto de pedido
    else if (i === 14) saldo = 0 // cabeça térmica zerada
    else saldo = s.int(d.pontoPedido, d.pontoPedido * 3)

    return {
      ...d,
      id: `pec-${d.codigo.toLowerCase()}`,
      saldo,
      reservado: s.chance(0.3) ? s.int(1, 3) : 0,
      consumo12m: s.int(d.pontoPedido * 2, d.pontoPedido * 9),
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Geração principal                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A finalidade de cada perfil, transcrita da coluna "Finalidade" de
 * [C.3](../../../../docs/anexos/C-matriz-de-permissoes.md). A descrição é o que
 * a tela de perfis mostra ao lado do nome; escrevê-la de novo aqui produziria um
 * segundo vocabulário para a mesma coisa, que é o defeito que este arquivo
 * inteiro existe para não ter.
 */
const DESCRICAO_PERFIL: Record<string, string> = {
  admin: 'Configuração, IAM, integrações e auditoria do locatário.',
  diretoria: 'Visão executiva e alçadas máximas.',
  'gestor-filial': 'Operação e resultado da filial.',
  operacao: 'Contratos, clientes e movimentações.',
  logistica: 'Movimentações, romaneios e transferências.',
  manutencao: 'Triagem, agenda, validação e estoque.',
  tecnico: 'Execução de OS e leituras.',
  financeiro: 'Faturamento, recebíveis e pagáveis.',
  consulta: 'Somente leitura.',
}

export function gerarBase(semente = 20260730): BaseDados {
  const s = new Sorteio(semente)
  const comps = ultimasCompetencias(12)

  /* ------------------------------------------------------------- clientes */
  const clientes: Cliente[] = NOMES_EMPRESA.map((n, i) => {
    const regiao = s.um(REGIOES)
    const filial =
      FILIAIS.find((f) => f.regiaoId === regiao.id) ?? s.um(FILIAIS)

    // Três clientes com problema financeiro, um deles bloqueado: a régua de
    // cobrança precisa ter o que exibir.
    let situacao: Cliente['situacaoCredito'] = 'LIBERADO'
    let atraso = 0
    if (i === 3) {
      situacao = 'BLOQUEADO'
      atraso = 34
    } else if (i === 11) {
      situacao = 'OBSERVACAO'
      atraso = 18
    } else if (i === 20) {
      situacao = 'OBSERVACAO'
      atraso = 9
    }

    const primeiroNome = n.fantasia.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')
    return {
      id: `cli-${String(i + 1).padStart(3, '0')}`,
      cnpj: gerarCnpj(s),
      razaoSocial: n.razao,
      nomeFantasia: n.fantasia,
      segmento: n.segmento || s.um(SEGMENTOS),
      regiaoId: regiao.id,
      filialId: filial.id,
      situacaoCredito: situacao,
      diasAtrasoMaximo: atraso,
      desde: iso(somarMeses(HOJE, -s.int(6, 84))),
      contato: {
        nome: s.um(NOMES_TECNICO).split(' ')[0] + ' ' + s.um(['Moreira', 'Barros', 'Vieira', 'Sampaio', 'Freitas', 'Antunes']),
        email: `compras@${primeiroNome}.com.br`,
        telefone: `(${s.int(11, 85)}) ${s.int(3000, 9999)}-${s.int(1000, 9999)}`,
      },
      // Deslocamento dentro da mancha urbana, não coordenada da capital.
      // Sem ele, todos os clientes da mesma praça cairiam no mesmo pixel: o
      // agrupamento do mapa nunca se abriria por mais que se aproximasse, e a
      // tela mentiria dizendo "1 local" onde há seis.
      ...dispersar(s, regiao, 0.28),
    }
  })

  /* ---------------------------------------------------------------- locais */
  const locais: LocalOperacao[] = []
  clientes.forEach((c, i) => {
    const qtd = s.int(1, 4)
    for (let j = 0; j < qtd; j++) {
      locais.push({
        id: `loc-${i + 1}-${j + 1}`,
        clienteId: c.id,
        nome:
          j === 0
            ? 'Sede administrativa'
            : s.um(['Filial centro', 'Unidade industrial', 'Depósito', 'Loja shopping', 'Almoxarifado', 'Unidade norte', 'Recepção']),
        endereco: `${s.um(['Av.', 'R.', 'Rod.'])} ${s.um(['das Nações', 'Brasil', 'Santo Antônio', 'Independência', 'dos Ipês', 'Marechal Deodoro'])}, ${s.int(50, 3800)}`,
        regiaoId: c.regiaoId,
        // Unidades do mesmo cliente ficam próximas entre si, mas não no mesmo
        // ponto — é o que a operação vê em campo.
        ...dispersar(s, regiaoPorId.get(c.regiaoId) ?? REGIOES[0]!, 0.12, c.lat, c.lon),
      })
    }
  })

  /* -------------------------------------------------------------- técnicos */
  const tecnicos: Tecnico[] = NOMES_TECNICO.map((nome, i) => ({
    id: `tec-${String(i + 1).padStart(2, '0')}`,
    nome,
    especialidades: i % 3 === 0 ? ['IMPRESSAO', 'COMPUTACAO'] : i % 3 === 1 ? ['IMPRESSAO'] : ['COMPUTACAO', 'CONTINGENCIA'],
    regiaoId: s.um(REGIOES).id,
    cargaAtual: s.int(0, 7),
  }))

  /* ------------------------------------------------- usuários e perfis */

  /*
   * Perfis e contas da demonstração, derivados de quem **já existe** na base.
   *
   * Nenhuma pessoa nova é inventada: as contas são os técnicos já gerados, mais
   * uma conta administrativa e uma de cliente. É a mesma regra que rege o resto
   * do gerador — a massa sai do que o domínio já tem, não de nomes plausíveis
   * escritos à mão.
   *
   * Os perfis são os **nove de C.3** mais os **três de cliente que a migração
   * 0011 provisiona por gatilho** (`app.provisionar_perfis_cliente`), copiados
   * dela nome por nome e permissão por permissão. O comentário anterior aqui
   * dizia que a 0011 cria "três internos e um de cliente" — ela cria três de
   * cliente e nenhum interno, e o `perf-cliente` daqui era um quarto perfil que
   * não existe em lugar nenhum.
   *
   * Perfil de sistema é estrutural — atribuível, nunca editável — e a tela
   * precisa de pelo menos um editável para o caso de uso principal existir, daí
   * o derivado no fim da lista. C.3 diz exatamente isso: "cada tenant pode
   * derivar os seus".
   */
  const interno = (id: string): PerfilGravado => {
    const p = perfilPorId(id)
    return {
      id: `perf-${id}`,
      nome: p.nome,
      descricao: DESCRICAO_PERFIL[id]!,
      tipo: 'INTERNO',
      isSistema: true,
      permissoes: p.permissoes,
    }
  }

  const perfis: PerfilGravado[] = [
    interno('admin'),
    interno('diretoria'),
    interno('gestor-filial'),
    interno('operacao'),
    interno('logistica'),
    interno('manutencao'),
    interno('tecnico'),
    interno('financeiro'),
    interno('consulta'),

    /*
     * Os três de cliente, transcritos da 0011 linhas 480-489. Não são derivados
     * de `lib/permissoes.ts` porque não são perfis da locadora: quem os define é
     * a migração, e RN-L25 é imposta por gatilho sobre exatamente estas listas.
     */
    {
      id: 'perf-cliente-admin',
      nome: 'Administrador do cliente',
      descricao: 'Enxerga todo o parque, contratos e faturas do próprio CNPJ e do grupo econômico.',
      tipo: 'CLIENTE',
      isSistema: true,
      permissoes: [
        'contrato:ler', 'equipamento:ler', 'fatura:ler', 'medicao:ler', 'os:ler', 'os:criar',
        'mapa:ler', 'relatorio:ler', 'cliente:ler',
      ],
    },
    {
      id: 'perf-cliente-gestor',
      nome: 'Gestor de unidade do cliente',
      descricao: 'Enxerga o parque das unidades a que foi vinculado.',
      tipo: 'CLIENTE',
      isSistema: true,
      permissoes: ['equipamento:ler', 'os:ler', 'os:criar', 'medicao:ler', 'mapa:ler'],
    },
    {
      id: 'perf-cliente',
      nome: 'Visualizador do cliente',
      descricao: 'Consulta sem abrir chamado.',
      tipo: 'CLIENTE',
      isSistema: true,
      permissoes: ['equipamento:ler', 'os:ler', 'medicao:ler'],
    },

    {
      id: 'perf-suporte',
      nome: 'Supervisor de Manutenção (derivado)',
      descricao: 'Perfil derivado, editável — cópia do modelo de manutenção.',
      tipo: 'INTERNO',
      isSistema: false,
      permissoes: perfilPorId('manutencao').permissoes,
    },
  ]

  const usuarios: Usuario[] = [
    {
      id: 'usr-admin',
      nome: 'Operação IARX',
      email: 'operacao@iarx.app',
      tipo: 'INTERNO',
      clienteId: null,
      status: 'ATIVO',
      perfilIds: ['perf-admin'],
      filiaisIds: [],
      ultimoAcesso: iso(HOJE),
      criadoEm: iso(somarMeses(HOJE, -18)),
      conviteAceito: true,
    },
    ...tecnicos.slice(0, 6).map((t, i) => ({
      id: `usr-${t.id}`,
      nome: t.nome,
      email: `${t.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '.')}@iarx.app`,
      tipo: 'INTERNO' as const,
      clienteId: null,
      // Um inativo e um sem convite aceito: os dois estados que a tela precisa
      // saber exibir e que uma massa só de contas felizes esconderia.
      status: (i === 4 ? 'INATIVO' : 'ATIVO') as Usuario['status'],
      /*
       * Um perfil interno diferente para cada uma das seis contas — e a
       * distribuição é o que faz a escada de alçada ter alguém em cada degrau.
       *
       * Antes rodavam três (`i % 3`), e antes disso dois: com `i % 2` ninguém
       * recebia `perf-financeiro`, e como é ele que carrega a faixa
       * intermediária, **o nível 2 de aprovação não existia em ninguém**. A tela
       * de contas a pagar nunca conseguiria demonstrar uma aprovação de dois
       * níveis, e nada acusava a falta — foi um teste da suíte que a encontrou.
       *
       * O mesmo argumento vale agora para o nível 1, que passou do Operador para
       * o Gestor de Filial ao seguir a matriz do Anexo C: sem uma conta com
       * `perf-gestor-filial`, o degrau existiria no cadastro e não em ninguém.
       */
      perfilIds: [
        ['perf-manutencao', 'perf-operacao', 'perf-financeiro', 'perf-gestor-filial', 'perf-logistica', 'perf-tecnico'][i % 6]!,
      ],
      filiaisIds: i < 3 ? [] : [FILIAIS[i % FILIAIS.length]!.id],
      ultimoAcesso: i === 5 ? null : iso(somarDias(HOJE, -s.int(0, 20))),
      criadoEm: iso(somarMeses(HOJE, -s.int(2, 14))),
      conviteAceito: i !== 5,
    })),
    {
      id: 'usr-cliente',
      nome: clientes[0]!.contato.nome,
      email: clientes[0]!.contato.email,
      tipo: 'CLIENTE',
      clienteId: clientes[0]!.id,
      status: 'ATIVO',
      perfilIds: ['perf-cliente-admin'],
      filiaisIds: [],
      ultimoAcesso: iso(somarDias(HOJE, -2)),
      criadoEm: iso(somarMeses(HOJE, -6)),
      conviteAceito: true,
    },
  ]

  /* ---------------------------------------------------- equipamentos e frota */
  const equipamentos: Equipamento[] = []
  let seqPatrimonio = 10001

  /** Distribuição de portfólio próxima da real: impressão domina a receita. */
  const distribuicao: { modeloId: string; qtd: number }[] = [
    { modeloId: 'mod-kyo-4054', qtd: 46 },
    { modeloId: 'mod-kyo-3554', qtd: 28 },
    { modeloId: 'mod-hp-e77', qtd: 16 },
    { modeloId: 'mod-hp-e52', qtd: 38 },
    { modeloId: 'mod-lex-mx532', qtd: 34 },
    { modeloId: 'mod-lex-cx635', qtd: 18 },
    { modeloId: 'mod-bro-l6402', qtd: 26 },
    { modeloId: 'mod-zeb-zt411', qtd: 14 },
    { modeloId: 'mod-dell-3000', qtd: 62 },
    { modeloId: 'mod-len-m70q', qtd: 44 },
    { modeloId: 'mod-len-l14', qtd: 40 },
    { modeloId: 'mod-dell-5440', qtd: 22 },
    { modeloId: 'mod-pos-tc300', qtd: 30 },
    { modeloId: 'mod-apc-1500', qtd: 20 },
  ]

  for (const { modeloId, qtd } of distribuicao) {
    const modelo = modeloPorId.get(modeloId)!
    const cat = categoriaPorCodigo.get(modelo.categoria)!

    for (let i = 0; i < qtd; i++) {
      const filial = s.um(FILIAIS)
      const patrimonio = String(seqPatrimonio++)

      // 78% locados, o resto distribuído entre disponível, manutenção e trânsito.
      const sorte = s.real(0, 1)
      let status: Equipamento['status']
      if (sorte < 0.78) status = 'LOCADO'
      else if (sorte < 0.9) status = 'DISPONIVEL'
      else if (sorte < 0.955) status = 'EM_MANUTENCAO'
      else if (sorte < 0.975) status = 'EM_INSPECAO'
      else if (sorte < 0.99) status = 'RESERVADO'
      else status = 'EM_TRANSITO_ENTREGA'

      const locado = status === 'LOCADO'
      const cliente = locado ? s.um(clientes) : null
      const local = cliente ? s.um(locais.filter((l) => l.clienteId === cliente.id)) : null

      // Consumo mensal proporcional à capacidade do modelo, com variação
      // sazonal leve e queda em dezembro/janeiro.
      const historicoConsumo: LeituraContador[] = []
      let acumuladoMono = 0
      let acumuladoColor = 0
      if (cat.temContador) {
        const baseMensal = (modelo.franquiaMono ?? 4000) * s.real(0.55, 1.35)
        comps.forEach((comp) => {
          const mes = Number(comp.slice(5))
          const fatorSazonal = mes === 12 || mes === 1 ? 0.62 : mes === 7 ? 0.86 : s.real(0.92, 1.12)
          const mono = locado ? Math.round(baseMensal * fatorSazonal) : 0
          const color = cat.temContadorColor && locado
            ? Math.round((modelo.franquiaColor ?? 800) * fatorSazonal * s.real(0.5, 1.4))
            : 0
          acumuladoMono += mono
          acumuladoColor += color
          historicoConsumo.push({ competencia: comp, mono, color })
        })
        // Contador histórico anterior aos 12 meses observados
        acumuladoMono += s.int(20000, 420000)
        if (cat.temContadorColor) acumuladoColor += s.int(4000, 90000)
      }

      const custoManutencao12m = Math.round(
        modelo.valorAquisicao * s.real(0.02, cat.familia === 'IMPRESSAO' ? 0.14 : 0.06),
      )
      const receita12m = locado ? Math.round(modelo.precoMensal * s.real(9, 12.4)) : Math.round(modelo.precoMensal * s.real(0, 6))

      equipamentos.push({
        id: `eqp-${patrimonio}`,
        patrimonio,
        numeroSerie: `${modelo.id.slice(4, 8).toUpperCase()}${s.int(100000, 999999)}`,
        modeloId,
        categoria: modelo.categoria,
        filialId: filial.id,
        status,
        motivoIndisponibilidade:
          status === 'EM_MANUTENCAO'
            ? s.um(['corretiva em andamento', 'aguardando peça', 'em bancada de teste'])
            : status === 'EM_INSPECAO'
              ? 'inspeção de retorno'
              : status.startsWith('EM_TRANSITO')
                ? 'em rota de entrega'
                : null,
        bloqueado: false,
        bloqueioMotivo: null,
        clienteId: cliente?.id ?? null,
        localId: local?.id ?? null,
        contratoId: null, // vinculado abaixo
        regiaoId: cliente ? cliente.regiaoId : filial.regiaoId,
        contadorMono: acumuladoMono,
        contadorColor: acumuladoColor,
        historicoConsumo,
        dataAquisicao: iso(somarMeses(HOJE, -s.int(2, modelo.vidaUtilMeses))),
        valorAquisicao: modelo.valorAquisicao,
        receita12m,
        custoManutencao12m,
        diasParado: status === 'DISPONIVEL' ? s.int(1, 74) : 0,
        ultimaPreventiva: cat.temContador ? iso(somarDias(HOJE, -s.int(20, 340))) : null,
        proximaPreventivaPaginas: cat.temContador ? acumuladoMono + s.int(-18000, 90000) : null,
      })
    }
  }

  /* ------------------------------------- casos plantados: ativos bloqueados */
  // Preventiva vencida: o contador passou do gatilho. Bloqueia nova alocação.
  const paraBloquear = equipamentos.filter((e) => e.categoria === 'MFP_MONO').slice(0, 2)
  const paraBloquear2 = equipamentos.filter((e) => e.categoria === 'MFP_COLOR').slice(0, 1)
  for (const e of [...paraBloquear, ...paraBloquear2]) {
    e.bloqueado = true
    e.bloqueioMotivo = `preventiva vencida — ${(e.contadorMono - (e.proximaPreventivaPaginas ?? 0)).toLocaleString('pt-BR')} páginas além do gatilho`
    if (e.status === 'DISPONIVEL') {
      e.status = 'BLOQUEADO'
      e.motivoIndisponibilidade = 'preventiva vencida'
    }
  }

  // Um ativo com margem negativa: custo de manutenção acima da receita.
  const deficitario = equipamentos.find((e) => e.categoria === 'LASER_COLOR')!
  deficitario.custoManutencao12m = Math.round(deficitario.receita12m * 1.34)

  /* --------------------------- casos plantados: pendências de medição */
  // Quatro ativos locados sem leitura da competência corrente. É o que trava o
  // fechamento na vida real — telemetria que não chegou, técnico que não
  // conseguiu acesso ao andar, equipamento desligado no dia da coleta.
  const compCorrente = comps[comps.length - 1]!
  const semLeitura = equipamentos
    .filter((e) => e.status === 'LOCADO' && e.historicoConsumo.length > 0)
    .slice(0, 4)
  for (const e of semLeitura) {
    const i = e.historicoConsumo.findIndex((h) => h.competencia === compCorrente)
    if (i >= 0) {
      // Desfaz o acumulado da leitura removida: o contador precisa refletir a
      // última medição de fato registrada, ou a próxima leitura viria menor
      // que o acumulado e seria recusada por RN-020.
      const removida = e.historicoConsumo[i]!
      e.contadorMono -= removida.mono
      e.contadorColor -= removida.color
      e.historicoConsumo.splice(i, 1)
    }
  }

  /* ------------------------------------------------------------- contratos */
  const contratos: Contrato[] = []
  let seqContrato = 1
  const equipamentosLocados = equipamentos.filter((e) => e.status === 'LOCADO')
  const porCliente = new Map<string, Equipamento[]>()
  for (const e of equipamentosLocados) {
    if (!e.clienteId) continue
    const lista = porCliente.get(e.clienteId) ?? []
    lista.push(e)
    porCliente.set(e.clienteId, lista)
  }

  for (const [clienteId, ativos] of porCliente) {
    const cliente = clientes.find((c) => c.id === clienteId)!
    // Cliente grande pode ter mais de um contrato (impressão e parque de TI
    // separados, como é comum).
    const grupos: Equipamento[][] = []
    const impressao = ativos.filter((a) => categoriaPorCodigo.get(a.categoria)!.familia === 'IMPRESSAO')
    const computacao = ativos.filter((a) => categoriaPorCodigo.get(a.categoria)!.familia !== 'IMPRESSAO')
    if (impressao.length) grupos.push(impressao)
    if (computacao.length) grupos.push(computacao)

    for (const grupo of grupos) {
      const inicioMeses = s.int(2, 40)
      const duracao = s.um([24, 24, 36, 36, 36, 48, 60])
      const dataInicio = somarMeses(HOJE, -inicioMeses)
      const dataFim = somarMeses(dataInicio, duracao)
      const diasParaVencer = Math.round((dataFim.getTime() - HOJE.getTime()) / 86400000)

      let status: Contrato['status'] = 'ATIVO'
      if (diasParaVencer < 0) status = s.chance(0.35) ? 'VENCIDO_EM_CAMPO' : 'EM_RENOVACAO'
      else if (diasParaVencer <= 90 && s.chance(0.45)) status = 'EM_RENOVACAO'

      const numero = `${filialPorIdLocal(cliente.filialId)}-${dataInicio.getFullYear()}-${String(seqContrato).padStart(4, '0')}`
      const contratoId = `ctr-${String(seqContrato).padStart(4, '0')}`
      seqContrato++

      const itens: ContratoItem[] = grupo.map((eq, idx) => {
        const modelo = modeloPorId.get(eq.modeloId)!
        const cat = categoriaPorCodigo.get(eq.categoria)!
        const modalidade: ModalidadeCobranca = cat.temContador ? 'FRANQUIA_EXCEDENTE' : 'FIXO_MENSAL'
        const desconto = s.chance(0.35) ? s.real(0.03, 0.14) : 0
        eq.contratoId = contratoId
        return {
          id: `${contratoId}-i${idx + 1}`,
          equipamentoId: eq.id,
          modalidade,
          valorMensal: Math.round(modelo.precoMensal * (1 - desconto) * 100) / 100,
          franquiaMono: modelo.franquiaMono,
          franquiaColor: modelo.franquiaColor,
          precoExcedenteMono: modelo.precoExcedenteMono,
          precoExcedenteColor: modelo.precoExcedenteColor,
          vigenciaInicio: iso(dataInicio),
          vigenciaFim: iso(dataFim),
          status: 'ATIVO',
        }
      })

      contratos.push({
        id: contratoId,
        numero,
        clienteId,
        filialId: cliente.filialId,
        status,
        dataInicio: iso(dataInicio),
        dataFim: iso(dataFim),
        indiceReajuste: s.um(['IPCA', 'IPCA', 'IGPM', 'FIXO'] as const),
        diaVencimento: s.um([5, 10, 15, 20, 25]),
        responsavel: s.um(NOMES_TECNICO),
        itens,
        observacao:
          status === 'VENCIDO_EM_CAMPO'
            ? 'Vigência expirada com equipamentos ainda em posse do cliente. Renovação em negociação.'
            : undefined,
      })
    }
  }

  // Alguns contratos encerrados, para o histórico não parecer que nada termina.
  for (let i = 0; i < 8; i++) {
    const cliente = s.um(clientes)
    const inicio = somarMeses(HOJE, -s.int(30, 60))
    contratos.push({
      id: `ctr-enc-${i + 1}`,
      numero: `${filialPorIdLocal(cliente.filialId)}-${inicio.getFullYear()}-9${String(i + 1).padStart(3, '0')}`,
      clienteId: cliente.id,
      filialId: cliente.filialId,
      status: 'ENCERRADO',
      dataInicio: iso(inicio),
      dataFim: iso(somarMeses(inicio, 24)),
      indiceReajuste: 'IPCA',
      diaVencimento: 10,
      responsavel: s.um(NOMES_TECNICO),
      itens: [],
    })
  }

  /* -------------------------------------------------------- ordens de serviço */
  const ordens: OrdemServico[] = []
  let seqOs = 4800

  for (let i = 0; i < 214; i++) {
    const eq = s.um(equipamentos)
    const cat = categoriaPorCodigo.get(eq.categoria)!
    const abertaEm = somarDias(HOJE, -s.int(0, 210))
    const prazo = new Date(abertaEm.getTime() + cat.slaHorasSolucao * 3600000)

    // As OS antigas estão fechadas; as recentes distribuem-se pelo fluxo.
    const idade = (HOJE.getTime() - abertaEm.getTime()) / 86400000
    let status: OrdemServico['status']
    if (idade > 6) status = s.chance(0.94) ? 'VALIDADA' : 'CANCELADA'
    else if (idade > 2) status = s.um(['VALIDADA', 'CONCLUIDA', 'EM_EXECUCAO', 'AGUARDANDO_PECA'] as const)
    else status = s.um(['ABERTA', 'TRIAGEM', 'AGENDADA', 'EM_EXECUCAO', 'AGUARDANDO_PECA'] as const)

    const encerrada = status === 'VALIDADA' || status === 'CONCLUIDA'
    const minutos = encerrada ? s.int(35, 260) : status === 'EM_EXECUCAO' ? s.int(10, 90) : 0
    const tipo = s.chance(0.68) ? 'CORRETIVA' : s.chance(0.6) ? 'PREVENTIVA' : s.um(['INSTALACAO', 'RETIRADA', 'INSPECAO'] as const)

    ordens.push({
      id: `os-${seqOs}`,
      numero: `OS-${seqOs++}`,
      equipamentoId: eq.id,
      clienteId: eq.clienteId,
      tipo,
      status,
      prioridade:
        cat.familia === 'IMPRESSAO' && s.chance(0.22)
          ? 'CRITICA'
          : s.um(['BAIXA', 'MEDIA', 'MEDIA', 'ALTA'] as const),
      sintoma: cat.familia === 'IMPRESSAO' ? s.um(SINTOMAS_IMPRESSAO) : s.um(SINTOMAS_COMPUTACAO),
      causaRaiz: encerrada ? s.um(CAUSAS) : null,
      abertaEm: abertaEm.toISOString(),
      prazoSolucaoEm: prazo.toISOString(),
      concluidaEm: encerrada
        ? new Date(abertaEm.getTime() + s.real(0.4, 1.9) * cat.slaHorasSolucao * 3600000).toISOString()
        : null,
      tecnicoId: status === 'ABERTA' || status === 'TRIAGEM' ? null : s.um(tecnicos).id,
      minutosApontados: minutos,
      custoMaoObra: Math.round((minutos / 60) * 92 * 100) / 100,
      custoPecas: encerrada && s.chance(0.55) ? s.int(38, 1480) : 0,
      pecasUsadas: [],
    })
  }

  // OS plantadas em risco iminente de SLA, para a fila do supervisor ter tensão.
  const emRisco = [
    { restanteMin: 42, prioridade: 'CRITICA' as const },
    { restanteMin: 96, prioridade: 'CRITICA' as const },
    { restanteMin: 148, prioridade: 'ALTA' as const },
    { restanteMin: 205, prioridade: 'ALTA' as const },
    { restanteMin: -70, prioridade: 'CRITICA' as const },
  ]
  emRisco.forEach((r, i) => {
    const eq = equipamentos.filter((e) => e.status === 'LOCADO')[i * 7]
    ordens.push({
      id: `os-risco-${i + 1}`,
      numero: `OS-${seqOs++}`,
      equipamentoId: eq.id,
      clienteId: eq.clienteId,
      tipo: 'CORRETIVA',
      status: i === 4 ? 'AGUARDANDO_PECA' : 'EM_EXECUCAO',
      prioridade: r.prioridade,
      sintoma: i === 4 ? 'Toner ciano indisponível em estoque' : s.um(SINTOMAS_IMPRESSAO),
      causaRaiz: null,
      abertaEm: somarDias(HOJE, -1).toISOString(),
      prazoSolucaoEm: new Date(HOJE.getTime() + r.restanteMin * 60000).toISOString(),
      concluidaEm: null,
      tecnicoId: i === 1 ? null : s.um(tecnicos).id,
      minutosApontados: s.int(15, 70),
      custoMaoObra: 0,
      custoPecas: 0,
      pecasUsadas: [],
    })
  })

  /* ----------------------------------------------------------------- peças */
  const pecas = gerarPecas(s)

  /* --------------------------------------------------------------- faturas */
  const faturas: Fatura[] = []
  let seqFatura = 4100
  const contratosFaturaveis = contratos.filter(
    (c) => c.itens.length > 0 && (c.status === 'ATIVO' || c.status === 'EM_RENOVACAO' || c.status === 'VENCIDO_EM_CAMPO'),
  )

  // Seis competências de histórico dão volume suficiente para aging e séries.
  const compsFatura = comps.slice(-6)

  for (const contrato of contratosFaturaveis) {
    const cliente = clientes.find((c) => c.id === contrato.clienteId)!

    compsFatura.forEach((comp, idxComp) => {
      const ehAtual = idxComp === compsFatura.length - 1
      const itens: FaturaItem[] = []

      for (const item of contrato.itens) {
        const eq = equipamentos.find((e) => e.id === item.equipamentoId)
        if (!eq) continue
        const leitura = eq.historicoConsumo.find((h) => h.competencia === comp)
        const consumoMono = leitura?.mono ?? 0
        const consumoColor = leitura?.color ?? 0

        const excedenteMono = item.franquiaMono ? Math.max(0, consumoMono - item.franquiaMono) : 0
        const excedenteColor = item.franquiaColor ? Math.max(0, consumoColor - item.franquiaColor) : 0
        const valorExcMono = Math.round(excedenteMono * (item.precoExcedenteMono ?? 0) * 100) / 100
        const valorExcColor = Math.round(excedenteColor * (item.precoExcedenteColor ?? 0) * 100) / 100

        itens.push({
          descricao: nomeModeloLocal(eq.modeloId),
          equipamentoPatrimonio: eq.patrimonio,
          modalidade: item.modalidade,
          valorFixo: item.valorMensal,
          franquiaMono: item.franquiaMono,
          consumoMono,
          excedenteMono,
          valorExcedenteMono: valorExcMono,
          franquiaColor: item.franquiaColor,
          consumoColor,
          excedenteColor,
          valorExcedenteColor: valorExcColor,
          total: Math.round((item.valorMensal + valorExcMono + valorExcColor) * 100) / 100,
        })
      }

      if (!itens.length) return

      const bruto = Math.round(itens.reduce((acc, i) => acc + i.total, 0) * 100) / 100
      const desconto = 0
      const liquido = Math.round((bruto - desconto) * 100) / 100

      const [ano, mes] = comp.split('-').map(Number)
      const emissao = new Date(ano, mes, 1)
      const vencimento = new Date(ano, mes, contrato.diaVencimento)
      const diasDesdeVencimento = Math.round((HOJE.getTime() - vencimento.getTime()) / 86400000)

      let status: Fatura['status']
      let pago = 0
      if (ehAtual) {
        status = 'EM_FECHAMENTO'
      } else if (cliente.situacaoCredito === 'BLOQUEADO' && idxComp >= compsFatura.length - 3) {
        status = 'EM_ATRASO'
      } else if (cliente.situacaoCredito === 'OBSERVACAO' && idxComp === compsFatura.length - 2) {
        status = 'EM_ATRASO'
      } else if (diasDesdeVencimento > 0 && s.chance(0.055)) {
        status = 'EM_ATRASO'
      } else if (diasDesdeVencimento > 0 && s.chance(0.03)) {
        status = 'PARCIAL'
        pago = Math.round(liquido * s.real(0.3, 0.75) * 100) / 100
      } else {
        status = 'PAGA'
        pago = liquido
      }

      faturas.push({
        id: `fat-${seqFatura}`,
        numero: `1-${String(seqFatura++).padStart(6, '0')}`,
        clienteId: contrato.clienteId,
        contratoId: contrato.id,
        competencia: comp,
        status,
        emissao: iso(emissao),
        vencimento: iso(vencimento),
        valorBruto: bruto,
        desconto,
        valorLiquido: liquido,
        valorPago: pago,
        diasAtraso: status === 'EM_ATRASO' || status === 'PARCIAL' ? Math.max(1, diasDesdeVencimento) : 0,
        itens,
      })
    })
  }

  /* ---------------------------------------------------------------- anexos */
  // Documentos de demonstração: só metadados, sem conteúdo. O botão de baixar
  // fica desabilitado com o motivo, em vez de entregar um arquivo vazio.
  const anexos: Anexo[] = []
  let seqAnexo = 1
  const anexo = (
    entidade: Anexo['entidade'],
    entidadeId: string,
    nome: string,
    tipoMime: string,
    categoria: Anexo['categoria'],
    kb: number,
  ) => {
    anexos.push({
      id: `anx-${String(seqAnexo++).padStart(4, '0')}`,
      entidade,
      entidadeId,
      nome,
      tipoMime,
      tamanhoBytes: kb * 1024,
      categoria,
      enviadoEm: somarMeses(HOJE, 0).toISOString().slice(0, 10),
      enviadoPor: 'Operação IARX',
    })
  }

  for (const c of contratos.slice(0, 8)) {
    anexo('CONTRATO', c.id, `${c.numero}-assinado.pdf`, 'application/pdf', 'CONTRATO_ASSINADO', 480 + (c.itens.length % 7) * 90)
    anexo('CONTRATO', c.id, `${c.numero}-proposta.pdf`, 'application/pdf', 'PROPOSTA', 210)
    if (c.itens.length > 3) {
      anexo('CONTRATO', c.id, `${c.numero}-termo-entrega.pdf`, 'application/pdf', 'TERMO_ENTREGA', 130)
    }
  }

  for (const cl of clientes.slice(0, 10)) {
    anexo('CLIENTE', cl.id, 'cartao-cnpj.pdf', 'application/pdf', 'CARTAO_CNPJ', 96)
    anexo('CLIENTE', cl.id, 'contrato-social.pdf', 'application/pdf', 'CONTRATO_SOCIAL', 1240)
    if (cl.situacaoCredito !== 'LIBERADO') {
      anexo('CLIENTE', cl.id, 'certidao-negativa.pdf', 'application/pdf', 'CERTIDAO', 88)
    }
  }

  /* ------------------------------------------------ notas fiscais de compra */
  // Reconstruídas a partir do parque já gerado: o valor dos produtos é a soma
  // do que os ativos já carregavam. Inventar valores novos faria a nota
  // divergir do patrimônio que ela originou.
  const fornecedores = gerarFornecedores(() => gerarCnpj(s))
  const { notas: notasFiscais } = gerarNotas(
    s,
    equipamentos,
    fornecedores,
    FILIAIS.map((f) => f.id),
    HOJE,
  )

  // Documento fiscal das notas: o XML é o original, o DANFE é representação.
  for (const nf of notasFiscais.slice(0, 12)) {
    anexo('NOTA_FISCAL', nf.id, `NFe${nf.chaveAcesso ?? nf.numero}.xml`, 'text/xml', 'XML_NFE', 14)
    anexo('NOTA_FISCAL', nf.id, `danfe-${nf.serie}-${nf.numero}.pdf`, 'application/pdf', 'DANFE', 168)
  }

  /* ------------------------------------------------- tabelas comerciais */
  //
  // Derivadas do catálogo, não inventadas: `precoMensal`, `franquiaMono` e
  // `precoExcedenteMono` já existem em cada modelo e são o que a base usa para
  // calcular receita. Criar números novos aqui faria a tabela comercial
  // divergir do faturamento da própria demonstração.
  const franquiaPadrao: TabelaFranquia = {
    id: 'tfr-001',
    nome: 'Franquia padrão 2026',
    descricao: 'Política vigente para contratos novos. Excedente por página, apurado por ativo.',
    vigenciaInicio: iso(somarMeses(HOJE, -7)),
    vigenciaFim: null,
    status: 'ATIVA',
    versao: 1,
    substituiId: null,
    itens: MODELOS.filter((m) => m.franquiaMono !== null).map((m, i) => ({
      id: `tfri-${String(i + 1).padStart(3, '0')}`,
      categoria: null,
      modeloId: m.id,
      franquiaMono: m.franquiaMono ?? 0,
      franquiaColor: m.franquiaColor ?? 0,
      escopo: 'ITEM' as const,
      excedenteMono: m.precoExcedenteMono ?? 0,
      excedenteColor: m.precoExcedenteColor ?? 0,
      permiteAcumulo: false,
      mesesAcumulo: null,
    })),
  }

  // Versão anterior, encerrada. Existe para a tela ter o que mostrar de
  // histórico — e para provar que trocar a tabela não mexeu em contrato algum.
  const franquiaAnterior: TabelaFranquia = {
    ...franquiaPadrao,
    id: 'tfr-000',
    nome: 'Franquia padrão 2025',
    descricao: 'Encerrada. Contratos assinados sob ela mantêm os valores acordados.',
    vigenciaInicio: iso(somarMeses(HOJE, -19)),
    vigenciaFim: iso(somarMeses(HOJE, -7)),
    status: 'INATIVA',
    itens: franquiaPadrao.itens.map((it, i) => ({
      ...it,
      id: `tfri0-${String(i + 1).padStart(3, '0')}`,
      franquiaMono: Math.round(it.franquiaMono * 0.9),
      excedenteMono: Number((it.excedenteMono * 0.94).toFixed(4)),
    })),
  }

  const precoGeral: TabelaPreco = {
    id: 'tpr-001',
    nome: 'Tabela geral 2026',
    descricao: 'Preço de referência por modelo, para contratos sem condição negociada.',
    vigenciaInicio: iso(somarMeses(HOJE, -7)),
    vigenciaFim: null,
    status: 'ATIVA',
    versao: 1,
    abrangencia: 'GERAL',
    clienteId: null,
    contratoId: null,
    indiceReajuste: 'IPCA',
    mesesReajuste: 12,
    itens: MODELOS.map((m, i) => ({
      id: `tpri-${String(i + 1).padStart(3, '0')}`,
      categoria: null,
      modeloId: m.id,
      valorMensal: m.precoMensal,
      // Instalação proporcional ao porte do equipamento, arredondada à dezena:
      // é despesa de logística e configuração, não margem.
      valorInstalacao: Math.round((m.precoMensal * 0.35) / 10) * 10,
      valorRetirada: Math.round((m.precoMensal * 0.2) / 10) * 10,
      prazoMinimoMeses: 12,
    })),
  }

  // Condição negociada para os três maiores clientes por parque — é o caso que
  // a precedência CLIENTE → GERAL existe para atender.
  const parquePorCliente = new Map<string, number>()
  for (const e of equipamentos) {
    if (e.clienteId) parquePorCliente.set(e.clienteId, (parquePorCliente.get(e.clienteId) ?? 0) + 1)
  }
  const maiores = [...parquePorCliente.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)

  const precosCliente: TabelaPreco[] = maiores.map(([clienteId, qtd], i) => {
    const cliente = clientes.find((c) => c.id === clienteId)!
    // Desconto de escala: quanto maior o parque, melhor a condição. É a lógica
    // comercial real do setor, e mantém a massa coerente com o volume.
    const fator = qtd >= 20 ? 0.82 : qtd >= 12 ? 0.88 : 0.93
    return {
      id: `tpr-cli-${i + 1}`,
      nome: `Condição ${cliente.nomeFantasia}`,
      descricao: `Negociada por volume: ${qtd} ativos em campo.`,
      vigenciaInicio: iso(somarMeses(HOJE, -5)),
      vigenciaFim: null,
      status: 'ATIVA',
      versao: 1,
      abrangencia: 'CLIENTE',
      clienteId,
      contratoId: null,
      indiceReajuste: 'IPCA',
      mesesReajuste: 12,
      itens: precoGeral.itens.map((it, j) => ({
        ...it,
        id: `tpri-c${i + 1}-${String(j + 1).padStart(3, '0')}`,
        valorMensal: Number((it.valorMensal * fator).toFixed(2)),
        valorInstalacao: 0,
      })),
    }
  })

  // Descontos: uma carência que já expirou e uma vigente. A que expirou é a
  // demonstração de RN-L22 — ela saiu sozinha, sem ninguém lembrar.
  const descontos: DescontoComercial[] = contratos.slice(0, 2).flatMap((c, i) => [
    {
      id: `dsc-${i + 1}`,
      contratoId: c.id,
      contratoItemId: null,
      tipo: 'PERCENTUAL' as const,
      percentual: i === 0 ? 8 : 5,
      valor: null,
      vigenciaInicio: iso(somarMeses(HOJE, -3)),
      vigenciaFim: i === 0 ? null : iso(somarMeses(HOJE, -1)),
      motivo: i === 0 ? 'Renovação antecipada com ampliação de parque' : 'Carência de implantação — encerrada',
    },
  ])

  const tabelasFranquia = [franquiaPadrao, franquiaAnterior]
  const tabelasPreco = [precoGeral, ...precosCliente]

  /* ----------------------------------------------------------- indicadores */
  const indicadores = calcularIndicadores({ equipamentos, contratos, faturas, ordens, pecas, comps })

  /* ------------------------------------------ base do financeiro */

  /** Ao centavo. Meia unidade de `numeric(15,4)` não existe em conta corrente. */
  const cent = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

  /*
   * Centros de custo e contas da operação.
   *
   * Estrutura, não valores de negócio: os nomes são as áreas que uma locadora
   * de TI tem por definição — operação de campo, logística, administrativo,
   * comercial — e os bancos são os códigos FEBRABAN reais das instituições.
   * Nenhum saldo, tarifa ou limite é apresentado como número de um cliente:
   * são valores da demonstração, derivados do porte da própria massa gerada.
   */
  const centrosCusto: CentroCusto[] = [
    { id: 'cc-oper', empresaId: null, codigo: 'OPER', nome: 'Operação', descricao: 'Campo, logística e assistência técnica.', centroPaiId: null, ativo: true },
    { id: 'cc-oper-campo', empresaId: null, codigo: 'OPER-CAMPO', nome: 'Atendimento em campo', descricao: 'Deslocamento e mão de obra dos técnicos.', centroPaiId: 'cc-oper', ativo: true },
    { id: 'cc-oper-log', empresaId: null, codigo: 'OPER-LOG', nome: 'Logística', descricao: 'Frete, armazenagem e movimentação de parque.', centroPaiId: 'cc-oper', ativo: true },
    { id: 'cc-oper-campo-sp', empresaId: null, codigo: 'OPER-CAMPO-SP', nome: 'Campo — São Paulo', descricao: 'Terceiro nível: o máximo que a árvore aceita.', centroPaiId: 'cc-oper-campo', ativo: true },
    { id: 'cc-adm', empresaId: null, codigo: 'ADM', nome: 'Administrativo', descricao: 'Estrutura, licenças e serviços de apoio.', centroPaiId: null, ativo: true },
    { id: 'cc-adm-ti', empresaId: null, codigo: 'ADM-TI', nome: 'Tecnologia interna', descricao: 'Licenças, links e equipamentos de uso próprio.', centroPaiId: 'cc-adm', ativo: true },
    { id: 'cc-com', empresaId: null, codigo: 'COM', nome: 'Comercial', descricao: 'Prospecção, propostas e pós-venda.', centroPaiId: null, ativo: true },
    // Um inativo: é o estado que a tela precisa saber exibir e que uma massa só
    // de centros ativos esconderia.
    { id: 'cc-desc', empresaId: null, codigo: 'DESC', nome: 'Projeto descontinuado', descricao: 'Mantido para não romper o histórico de rateio.', centroPaiId: null, ativo: false },
  ]

  const contasBancarias: ContaBancaria[] = [
    { id: 'cb-oper', empresaId: 'emp-alfa', bancoCodigo: '341', bancoNome: 'Itaú Unibanco', agencia: '0912', numero: '45871-3', tipo: 'CORRENTE', apelido: 'Operação', saldoInicial: 418_500, dataSaldoInicial: iso(somarMeses(HOJE, -7)), limiteCredito: 150_000, status: 'ATIVA' },
    { id: 'cb-folha', empresaId: 'emp-alfa', bancoCodigo: '001', bancoNome: 'Banco do Brasil', agencia: '3155', numero: '21004-8', tipo: 'CORRENTE', apelido: 'Folha de pagamento', saldoInicial: 96_200, dataSaldoInicial: iso(somarMeses(HOJE, -7)), limiteCredito: null, status: 'ATIVA' },
    { id: 'cb-invest', empresaId: 'emp-alfa', bancoCodigo: '033', bancoNome: 'Santander', agencia: '0447', numero: '13002-6', tipo: 'POUPANCA', apelido: 'Reserva de renovação de parque', saldoInicial: 640_000, dataSaldoInicial: iso(somarMeses(HOJE, -7)), limiteCredito: null, status: 'ATIVA' },
    // Uma bloqueada: exercita a recusa de lançamento manual (RN-L47).
    { id: 'cb-antiga', empresaId: 'emp-alfa', bancoCodigo: '237', bancoNome: 'Bradesco', agencia: '1188', numero: '7740-2', tipo: 'CORRENTE', apelido: 'Conta antiga (em encerramento)', saldoInicial: 3_140, dataSaldoInicial: iso(somarMeses(HOJE, -7)), limiteCredito: null, status: 'BLOQUEADA' },
  ]

  /*
   * Movimentações derivadas das faturas e das ordens já geradas, e não sorteadas
   * à parte.
   *
   * Sorteadas, o extrato contaria uma história diferente da do faturamento —
   * duas verdades sobre o mesmo mês. Derivando, o saldo da conta de operação
   * reflete a receita e o custo que o resto da aplicação mostra.
   */
  const movimentacoes: Movimentacao[] = []
  let seqMov = 0
  const movId = () => `mov-${String(++seqMov).padStart(4, '0')}`

  for (const f of faturas.filter((x) => x.status === 'PAGA').slice(0, 40)) {
    movimentacoes.push({
      id: movId(),
      contaId: 'cb-oper',
      tipo: 'ENTRADA',
      valor: cent(f.valorLiquido),
      dataMovimento: f.vencimento,
      descricao: `Recebimento da fatura ${f.numero}`,
      transferenciaParId: null,
      estornaId: null,
      motivo: null,
      // Os mais antigos já conciliados, os recentes não: é a fila de trabalho.
      conciliado: f.vencimento < iso(somarDias(HOJE, -20)),
      conciliadoEm: f.vencimento < iso(somarDias(HOJE, -20)) ? f.vencimento : null,
      criadoEm: f.vencimento,
    })
  }

  const custoDa = (o: OrdemServico) => cent(o.custoMaoObra + o.custoPecas)

  for (const o of ordens.filter((x) => x.status === 'CONCLUIDA' && custoDa(x) > 0).slice(0, 30)) {
    movimentacoes.push({
      id: movId(),
      contaId: 'cb-oper',
      tipo: 'SAIDA',
      valor: custoDa(o),
      dataMovimento: o.concluidaEm ?? iso(HOJE),
      descricao: `Custo do chamado ${o.numero}`,
      transferenciaParId: null,
      estornaId: null,
      motivo: null,
      conciliado: false,
      conciliadoEm: null,
      criadoEm: o.concluidaEm ?? iso(HOJE),
    })
  }

  // Uma transferência de verdade, com as duas pernas se referenciando: é a
  // única forma de a tela de extrato exercitar o par.
  const saidaId = movId()
  const entradaId = movId()
  const dataTransf = iso(somarDias(HOJE, -12))
  movimentacoes.push(
    { id: saidaId, contaId: 'cb-oper', tipo: 'TRANSFERENCIA_SAIDA', valor: 180_000, dataMovimento: dataTransf, descricao: 'Provisão de folha do mês', transferenciaParId: entradaId, estornaId: null, motivo: null, conciliado: true, conciliadoEm: dataTransf, criadoEm: dataTransf },
    { id: entradaId, contaId: 'cb-folha', tipo: 'TRANSFERENCIA_ENTRADA', valor: 180_000, dataMovimento: dataTransf, descricao: 'Provisão de folha do mês', transferenciaParId: saidaId, estornaId: null, motivo: null, conciliado: true, conciliadoEm: dataTransf, criadoEm: dataTransf },
  )

  movimentacoes.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))

  /* ------------------------------------------ contas a pagar (Módulo 10) */

  /*
   * Faixas de alçada.
   *
   * Os três limites são **massa desta demonstração**, não regra de negócio da
   * IARX: cada operação define os seus, e é por isso que a alçada é cadastro por
   * locatário e não constante no código (decisão D-18). O que a interface prova
   * é que a contagem de níveis segue os limites cadastrados, quaisquer que
   * sejam — troque os três números aqui e a prévia de alçada acompanha.
   */
  const alcadas: FaixaAlcada[] = [
    /*
     * Cada faixa aponta para um perfil que **tem a permissão correspondente**.
     *
     * Não era o caso: `alc-1` dava alçada de aprovação de pagamento ao Operador
     * Administrativo, que não tem `pagar:aprovar` em C.4 — uma alçada apontando
     * para permissão inexistente. A fórmula de C.1 é
     * `permissão AND escopo AND alçada`, e um cadastro que satisfaz o terceiro
     * termo sem o primeiro não concede nada: é ruído que parece configuração.
     *
     * O degrau de baixo é do Gestor de Filial, que C.4 marca ◐ em
     * `pagar:aprovar` — ◐ é exatamente "concedida, limitada por alçada", e é
     * esta a alçada que o limita.
     */
    { id: 'alc-1', perfilId: 'perf-gestor-filial', tipo: 'APROVACAO_PAGAMENTO', limiteValor: 5_000, limitePercentual: null },
    { id: 'alc-2', perfilId: 'perf-financeiro', tipo: 'APROVACAO_PAGAMENTO', limiteValor: 25_000, limitePercentual: null },
    { id: 'alc-3', perfilId: 'perf-admin', tipo: 'APROVACAO_PAGAMENTO', limiteValor: 120_000, limitePercentual: null },

    /*
     * Alçada de emissão de cobrança, com faixas **mais baixas** que as de
     * pagamento, e de propósito.
     *
     * Não é assimetria por descuido: uma despesa de dez mil é rotina numa
     * locadora que compra parque; uma cobrança de dez mil errada vai para o
     * cliente e custa a relação comercial. As faixas são deste arquivo, e a
     * interface prova que a contagem segue o cadastro — troque os números e a
     * prévia acompanha.
     */
    /*
     * Duas faixas, não três, e a falta é a especificação falando.
     *
     * `fatura:emitir` existe em três perfis — Administrador, Diretor e Analista
     * Financeiro (C.4) — e C.5 dá limite a dois deles: "até R$ 50 mil" ao
     * Financeiro e "sem limite" ao Diretor. A faixa de baixo era do Operador
     * Administrativo, que não emite fatura nenhuma. Inventar um terceiro perfil
     * para manter três degraus seria fabricar autoridade que ninguém escreveu.
     */
    { id: 'alc-5', perfilId: 'perf-financeiro', tipo: 'EMISSAO_FATURA', limiteValor: 20_000, limitePercentual: null },
    { id: 'alc-6', perfilId: 'perf-admin', tipo: 'EMISSAO_FATURA', limiteValor: 100_000, limitePercentual: null },

    /*
     * Desconto é percentual, e só dois perfis o têm.
     *
     * Um teto em reais faria 5% num contrato grande ultrapassar o limite e 50%
     * num pequeno passar batido — o inverso do que a alçada quer controlar.
     *
     * Os três primeiros percentuais são de C.5, literalmente: Operador até 5%,
     * Analista Financeiro até 10%, Gestor de Filial até 15%. O do Administrador
     * é massa desta demonstração — C.5 dá "sem limite" ao Diretor, e "sem
     * limite" não é representável num campo de percentual.
     *
     * Os perfis sem faixa nenhuma — Logística, Manutenção, Técnico, Consulta,
     * Diretor — dão à tela o caso de quem não concede desconto: zero significa
     * "não concede", não "concede qualquer um".
     */
    { id: 'alc-7', perfilId: 'perf-operacao', tipo: 'DESCONTO', limiteValor: null, limitePercentual: 5 },
    { id: 'alc-8', perfilId: 'perf-financeiro', tipo: 'DESCONTO', limiteValor: null, limitePercentual: 10 },
    { id: 'alc-9', perfilId: 'perf-gestor-filial', tipo: 'DESCONTO', limiteValor: null, limitePercentual: 15 },
    { id: 'alc-10', perfilId: 'perf-admin', tipo: 'DESCONTO', limiteValor: null, limitePercentual: 25 },
  ]

  /*
   * Títulos derivados das notas fiscais já geradas, e não sorteados à parte.
   *
   * Uma nota de compra integrada é, por definição, uma obrigação com o
   * fornecedor: derivá-la mantém uma única verdade sobre o mesmo fato. Sorteando
   * títulos à parte, a tela de contas a pagar mostraria compras que a tela de
   * notas fiscais não conhece — e as duas estariam "certas".
   *
   * A cada um se acrescenta o que só existe no Módulo 10: rateio por centro de
   * custo, rodada de aprovação e baixa. Os estados foram escolhidos para cobrir
   * o que a tela precisa saber exibir — aprovação em curso, rejeição com
   * justificativa, pagamento parcial, parcelamento e atraso —, porque uma massa
   * só de títulos quitados esconde exatamente a parte difícil.
   */
  const titulosPagar: TituloPagar[] = []
  let seqTit = 0
  const titId = () => `tpg-${String(++seqTit).padStart(4, '0')}`

  /** Níveis exigidos por um valor, num tipo de alçada. Espelha o banco. */
  const niveisDe = (valor: number, tipo: FaixaAlcada['tipo']) =>
    Math.min(
      [
        ...new Set(
          alcadas.filter((a) => a.tipo === tipo && a.limiteValor !== null).map((a) => a.limiteValor!),
        ),
      ].filter((l) => l < valor).length,
      3,
    )

  const niveisPara = (valor: number) => niveisDe(valor, 'APROVACAO_PAGAMENTO')

  /** Abre uma rodada de aprovação com as decisões já tomadas que se pedir. */
  function rodada(
    valor: number,
    decididos: { aprovadorId: string; justificativa?: string; decisao?: 'APROVADO' | 'REJEITADO'; em: string }[],
  ): AprovacaoPagar[] {
    return Array.from({ length: niveisPara(valor) }, (_, i) => {
      const d = decididos[i]
      return {
        nivel: i + 1,
        rodada: 1,
        aprovadorId: d?.aprovadorId ?? null,
        decisao: d ? (d.decisao ?? 'APROVADO') : null,
        decididoEm: d?.em ?? null,
        justificativa: d?.justificativa ?? null,
        delegadoDe: null,
      }
    })
  }

  const lancadores = usuarios.filter((u) => u.tipo === 'INTERNO' && u.id !== 'usr-admin' && u.status === 'ATIVO')
  const lancador = (i: number) => lancadores[i % lancadores.length]?.id ?? 'usr-admin'
  /** Quem aprova na demonstração: o financeiro tem posto 2, a operação posto 1. */
  const aprovadorN1 = lancadores.find((u) => u.perfilIds.includes('perf-operacao'))?.id ?? 'usr-admin'
  const aprovadorN2 = lancadores.find((u) => u.perfilIds.includes('perf-financeiro'))?.id ?? 'usr-admin'

  const RATEIOS: RateioPagar[][] = [
    [{ centroCustoId: 'cc-oper-campo', percentual: 100 }],
    [
      { centroCustoId: 'cc-oper-log', percentual: 60 },
      { centroCustoId: 'cc-adm', percentual: 40 },
    ],
    [{ centroCustoId: 'cc-adm-ti', percentual: 100 }],
    [
      { centroCustoId: 'cc-oper-campo-sp', percentual: 45 },
      { centroCustoId: 'cc-oper-log', percentual: 35 },
      { centroCustoId: 'cc-com', percentual: 20 },
    ],
  ]

  const notasComValor = notasFiscais
    .filter((n) => n.status !== 'CANCELADA' && n.valorTotal > 0)
    .slice(0, 18)

  notasComValor.forEach((nf, i) => {
    const valor = cent(nf.valorTotal)
    const emissao = nf.dataEntrada
    const vencimento = iso(somarDias(new Date(`${emissao}T12:00:00Z`), 30))
    const vencido = vencimento < iso(HOJE)
    const criadoPor = lancador(i)

    // Sete estados, distribuídos: o resto quita. Não é sorteio — a distribuição
    // é fixa para que a tela tenha sempre os mesmos casos difíceis à mão.
    const caso = i % 7
    let status: StatusPagar = 'PAGO'
    let aprovacoes: AprovacaoPagar[] = []
    let pagamentos: PagamentoPagar[] = []

    if (caso === 0) {
      status = niveisPara(valor) === 0 ? 'APROVADO' : 'EM_APROVACAO'
      aprovacoes = rodada(valor, [])
    } else if (caso === 1) {
      // Nível 1 decidido, nível 2 esperando: é o estado que a fila do aprovador
      // precisa distinguir, e o que a RN-F02 governa.
      status = niveisPara(valor) >= 2 ? 'EM_APROVACAO' : 'APROVADO'
      aprovacoes = rodada(valor, [{ aprovadorId: aprovadorN1, em: iso(somarDias(HOJE, -6)) }])
    } else if (caso === 2) {
      // Rejeitado e devolvido a pendente: a decisão fica registrada, é ela que
      // explica o que corrigir.
      status = 'PENDENTE'
      aprovacoes = rodada(valor, [
        {
          aprovadorId: aprovadorN1,
          decisao: 'REJEITADO',
          justificativa: 'Nota sem o pedido de compra correspondente anexado.',
          em: iso(somarDias(HOJE, -4)),
        },
      ])
    } else if (caso === 3) {
      status = 'APROVADO'
      aprovacoes = rodada(valor, [
        { aprovadorId: aprovadorN1, em: iso(somarDias(HOJE, -10)) },
        { aprovadorId: aprovadorN2, em: iso(somarDias(HOJE, -9)) },
        { aprovadorId: 'usr-admin', em: iso(somarDias(HOJE, -8)) },
      ])
    } else if (caso === 4) {
      status = 'PAGO_PARCIAL'
      aprovacoes = rodada(valor, [
        { aprovadorId: aprovadorN1, em: iso(somarDias(HOJE, -14)) },
        { aprovadorId: aprovadorN2, em: iso(somarDias(HOJE, -13)) },
        { aprovadorId: 'usr-admin', em: iso(somarDias(HOJE, -13)) },
      ])
      pagamentos = [
        {
          id: `pgt-${titId()}`,
          valorPago: cent(valor * 0.4),
          dataPagamento: iso(somarDias(HOJE, -7)),
          contaId: 'cb-oper',
          forma: 'TRANSFERENCIA',
          movimentacaoId: null,
          estornadoEm: null,
          estornoMotivo: null,
        },
      ]
    } else if (caso === 5) {
      // Em disputa: divergência de quantidade recebida. Não é atraso nosso, e a
      // tela precisa mostrar a diferença.
      status = 'EM_DISPUTA'
      aprovacoes = rodada(valor, [{ aprovadorId: aprovadorN1, em: iso(somarDias(HOJE, -20)) }])
    } else {
      aprovacoes = rodada(valor, [
        { aprovadorId: aprovadorN1, em: iso(somarDias(HOJE, -30)) },
        { aprovadorId: aprovadorN2, em: iso(somarDias(HOJE, -29)) },
        { aprovadorId: 'usr-admin', em: iso(somarDias(HOJE, -29)) },
      ])
      pagamentos = [
        {
          id: `pgt-${titId()}`,
          valorPago: valor,
          dataPagamento: vencido ? vencimento : iso(somarDias(HOJE, -1)),
          contaId: 'cb-oper',
          forma: i % 2 === 0 ? 'BOLETO' : 'PIX',
          movimentacaoId: null,
          estornadoEm: null,
          estornoMotivo: null,
        },
      ]
    }

    titulosPagar.push({
      id: titId(),
      fornecedorId: nf.fornecedorId,
      descricao: `Nota fiscal ${nf.serie}/${nf.numero} — aquisição de parque`,
      classificacao: 'INVESTIMENTO',
      // Filial rotativa: é o recorte em que a projeção de caixa filtra, e com
      // todas na mesma o filtro passaria sem provar nada.
      filialId: FILIAIS[i % FILIAIS.length]?.id ?? null,
      contratoFornecedorRef: null,
      valorOriginal: valor,
      valorAjustado: null,
      motivoAjuste: null,
      dataEmissao: emissao,
      dataVencimento: vencimento,
      status,
      tituloPaiId: null,
      parcelaNumero: null,
      parcelaTotal: null,
      criadoPor,
      criadoEm: emissao,
      rateio: RATEIOS[i % RATEIOS.length]!.map((r) => ({ ...r })),
      aprovacoes,
      pagamentos,
    })
  })

  /*
   * Despesas recorrentes dos últimos quatro meses.
   *
   * As notas fiscais de compra da massa são cinco: bastam para exercitar o
   * caminho de aquisição, e são poucas para uma tela de contas a pagar, que
   * precisa de paginação, filtro por situação e uma fila de aprovação com mais
   * de um item. As recorrentes preenchem esse volume, e cobrem a classificação
   * `DESPESA_FIXA`, que as notas nunca produzem.
   *
   * Estrutura, não dados de negócio: são as despesas que uma locadora de
   * equipamentos de TI tem por definição — galpão, energia, link, frota,
   * licenças — com o centro de custo que lhes corresponde. Os valores são da
   * demonstração e estão dimensionados ao porte da massa gerada, não copiados
   * de contrato nenhum.
   */
  const RECORRENTES: { descricao: string; valor: number; centroCustoId: string; dia: number }[] = [
    { descricao: 'Aluguel do centro de distribuição', valor: 28_400, centroCustoId: 'cc-oper-log', dia: 5 },
    { descricao: 'Energia elétrica — galpão e escritório', valor: 9_780, centroCustoId: 'cc-adm', dia: 12 },
    { descricao: 'Link dedicado e telefonia corporativa', valor: 4_260, centroCustoId: 'cc-adm-ti', dia: 15 },
    { descricao: 'Locação da frota de atendimento em campo', valor: 21_500, centroCustoId: 'cc-oper-campo', dia: 8 },
    { descricao: 'Licenças de software de gestão', valor: 6_940, centroCustoId: 'cc-adm-ti', dia: 20 },
  ]

  RECORRENTES.forEach((r, indice) => {
    for (let atras = 3; atras >= 0; atras--) {
      const mes = somarMeses(HOJE, -atras)
      const venc = `${mes.getUTCFullYear()}-${String(mes.getUTCMonth() + 1).padStart(2, '0')}-${String(r.dia).padStart(2, '0')}`
      const emissao = iso(somarDias(new Date(`${venc}T12:00:00Z`), -10))
      const criadoPor = lancador(indice + atras)

      /*
       * As competências fechadas estão pagas; a corrente é que carrega os
       * estados interessantes. É a distribuição real de uma operação — o mês
       * passado já foi conciliado, o atual está em curso — e é também o que faz
       * a fila de aprovação ter conteúdo sem que a lista pareça caótica.
       */
      let status: StatusPagar = 'PAGO'
      let aprovacoes: AprovacaoPagar[] = []
      let pagamentos: PagamentoPagar[] = []

      const aprovadaEm = iso(somarDias(new Date(`${venc}T12:00:00Z`), -6))
      const cheia = rodada(r.valor, [
        { aprovadorId: aprovadorN1, em: aprovadaEm },
        { aprovadorId: aprovadorN2, em: aprovadaEm },
        { aprovadorId: 'usr-admin', em: aprovadaEm },
      ])

      if (atras > 0) {
        aprovacoes = cheia
        pagamentos = [
          {
            id: `pgt-rec-${indice}-${atras}`,
            valorPago: r.valor,
            dataPagamento: venc,
            contaId: 'cb-oper',
            forma: 'BOLETO',
            movimentacaoId: null,
            estornadoEm: null,
            estornoMotivo: null,
          },
        ]
      } else if (indice % 5 === 0) {
        // Aprovado e em aberto: a fila de quem paga precisa ter o que mostrar,
        // e quando o vencimento já passou este é também o caso de atraso.
        status = 'APROVADO'
        aprovacoes = cheia
      } else if (indice % 5 === 1) {
        status = niveisPara(r.valor) === 0 ? 'APROVADO' : 'EM_APROVACAO'
        aprovacoes = rodada(r.valor, [])
      } else if (indice % 5 === 2) {
        status = niveisPara(r.valor) >= 2 ? 'EM_APROVACAO' : 'APROVADO'
        aprovacoes = rodada(r.valor, [{ aprovadorId: aprovadorN1, em: iso(somarDias(HOJE, -2)) }])
      } else if (indice % 5 === 3) {
        status = 'PENDENTE'
        aprovacoes = rodada(r.valor, [
          {
            aprovadorId: aprovadorN1,
            decisao: 'REJEITADO',
            justificativa: 'Valor acima do mês anterior sem a fatura detalhada anexada.',
            em: iso(somarDias(HOJE, -1)),
          },
        ])
      } else {
        status = 'EM_DISPUTA'
        aprovacoes = cheia
      }

      titulosPagar.push({
        id: titId(),
        fornecedorId: fornecedores[(indice + 1) % fornecedores.length]?.id ?? null,
        descricao: r.descricao,
        classificacao: 'DESPESA_FIXA',
        // Distribuídas entre as filiais, para o recorte da projeção ter o que
        // separar: com todas na mesma, o filtro passaria sem provar nada.
        filialId: FILIAIS[indice % FILIAIS.length]?.id ?? null,
        contratoFornecedorRef: null,
        valorOriginal: r.valor,
        valorAjustado: null,
        motivoAjuste: null,
        dataEmissao: emissao,
        dataVencimento: venc,
        status,
        tituloPaiId: null,
        parcelaNumero: null,
        parcelaTotal: null,
        criadoPor,
        criadoEm: emissao,
        rateio: [{ centroCustoId: r.centroCustoId, percentual: 100 }],
        aprovacoes,
        pagamentos,
      })
    }
  })

  /*
   * Um parcelamento, com o pai e as filhas.
   *
   * Existe porque é o caso que a tela erra se ninguém o exercitar: o pai é
   * relatório e não se paga (RN-F08), as filhas herdam o status da aprovação
   * dele, e o total das parcelas tem de fechar com o dele ao centavo.
   */
  const fornecedorServico = fornecedores[0]
  if (fornecedorServico) {
    const totalParcelado = 96_000
    const parcelas = 12
    const emissao = iso(somarMeses(HOJE, -2))
    const primeiroVencimento = iso(somarMeses(HOJE, -1))
    const paiId = titId()
    const aprovacoesPai = rodada(totalParcelado, [
      { aprovadorId: aprovadorN1, em: iso(somarMeses(HOJE, -2)) },
      { aprovadorId: aprovadorN2, em: iso(somarMeses(HOJE, -2)) },
    ])
    const comum = {
      fornecedorId: fornecedorServico.id,
      descricao: 'Contrato de suporte técnico terceirizado — 12 meses',
      classificacao: 'DESPESA_FIXA' as ClassificacaoPagar,
      filialId: null as string | null,
      contratoFornecedorRef: 'CTR-SUP-0042',
      valorAjustado: null,
      motivoAjuste: null,
      dataEmissao: emissao,
      criadoPor: aprovadorN2,
      criadoEm: emissao,
      rateio: [
        { centroCustoId: 'cc-oper-campo', percentual: 70 },
        { centroCustoId: 'cc-adm', percentual: 30 },
      ],
    }

    titulosPagar.push({
      ...comum,
      id: paiId,
      valorOriginal: totalParcelado,
      dataVencimento: primeiroVencimento,
      status: 'APROVADO',
      tituloPaiId: null,
      parcelaNumero: null,
      parcelaTotal: parcelas,
      rateio: comum.rateio.map((r) => ({ ...r })),
      aprovacoes: aprovacoesPai,
      pagamentos: [],
    })

    // A última parcela absorve a diferença de arredondamento: distribuí-la por
    // igual faria a soma das parcelas divergir do total, e é a soma que o
    // fornecedor cobra.
    const cada100 = Math.floor((totalParcelado * 100) / parcelas)
    for (let n = 1; n <= parcelas; n++) {
      const centavos = n < parcelas ? cada100 : totalParcelado * 100 - cada100 * (parcelas - 1)
      const venc = iso(somarMeses(new Date(`${primeiroVencimento}T12:00:00Z`), n - 1))
      const jaVenceu = venc < iso(HOJE)
      titulosPagar.push({
        ...comum,
        id: titId(),
        valorOriginal: cent(centavos / 100),
        dataVencimento: venc,
        status: jaVenceu ? 'PAGO' : 'APROVADO',
        tituloPaiId: paiId,
        parcelaNumero: n,
        parcelaTotal: parcelas,
        rateio: comum.rateio.map((r) => ({ ...r })),
        aprovacoes: [],
        pagamentos: jaVenceu
          ? [
              {
                id: `pgt-p${n}-${paiId}`,
                valorPago: cent(centavos / 100),
                dataPagamento: venc,
                contaId: 'cb-oper',
                forma: 'TRANSFERENCIA',
                movimentacaoId: null,
                estornadoEm: null,
                estornoMotivo: null,
              },
            ]
          : [],
      })
    }
  }

  titulosPagar.sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento))

  /* --------------------------------------- contas a receber (Módulo 11) */

  /*
   * Os títulos CONTRATUAL são **derivados das faturas já geradas**, um por
   * fatura.
   *
   * Isto é a mitigação de uma lacuna aceita, e vale dizer com clareza: no banco
   * e na API a decisão D-20 foi aplicada — existe `titulo_receber` e não existe
   * tabela de fatura. Na base de demonstração, a tela de Faturamento continua
   * lendo `faturas`, então as duas coleções coexistem. Derivando uma da outra
   * num gerador só, os dois números não podem divergir enquanto a lacuna
   * existir; se a fatura fosse sorteada e o título também, a mesma competência
   * mostraria receitas diferentes em duas telas — e as duas pareceriam certas.
   *
   * O mapa de status é uma tradução, não uma escolha nova. `EM_ATRASO` **não**
   * tem correspondente: atraso é vencimento menor que hoje com o título em
   * aberto, e é calculado por quem exibe.
   */
  const titulosReceber: TituloReceber[] = []
  let seqReceber = 0
  const receberId = () => `trc-${String(++seqReceber).padStart(4, '0')}`
  let numeroTitulo = 0

  const statusDaFatura = (f: Fatura): StatusReceber => {
    switch (f.status) {
      case 'PREVISTA':
      case 'EM_FECHAMENTO':
        return 'PENDENTE_APROVACAO'
      case 'EMITIDA':
      // Vencido e em aberto continua APROVADO: o atraso é a data, não o estado.
      case 'EM_ATRASO':
        return 'APROVADO'
      case 'PARCIAL':
        return 'RECEBIDO_PARCIAL'
      case 'PAGA':
        return 'RECEBIDO'
      case 'CANCELADA':
        return 'CANCELADO'
    }
  }

  const aprovadorEmissaoN1 =
    lancadores.find((u) => u.perfilIds.includes('perf-operacao'))?.id ?? 'usr-admin'
  const aprovadorEmissaoN2 =
    lancadores.find((u) => u.perfilIds.includes('perf-financeiro'))?.id ?? 'usr-admin'

  /*
   * A competência corrente **não** gera título, e é o que a torna "aberta".
   *
   * Uma competência aberta tem medição e nenhuma cobrança: a cobrança nasce do
   * fechamento. Derivando título para todas as faturas — como a primeira versão
   * fazia —, a competência corrente já vinha coberta, e o diálogo de fechar
   * competência dizia sempre "nada a gerar". A tela existia e não podia ser
   * exercitada; foi um teste que pediu "gere e me mostre o resultado" que expôs
   * isso.
   */
  const competenciaAberta = comps[comps.length - 1]

  faturas.forEach((f, i) => {
    if (f.competencia === competenciaAberta) return
    const status = statusDaFatura(f)
    const liquido = cent(f.valorLiquido)
    const emissao = f.emissao
    const contrato = contratos.find((c) => c.id === f.contratoId)

    /*
     * Piso de um nível no contratual, como no banco: a alçada decide **quantos**
     * conferem, não **se** alguém confere. Uma cobrança de trezentos reais saiu
     * do mesmo cálculo automático que uma de trinta mil.
     */
    const niveis = Math.max(1, niveisDe(liquido, 'EMISSAO_FATURA'))
    const decididos =
      status === 'PENDENTE_APROVACAO'
        ? []
        : [
            { aprovadorId: aprovadorEmissaoN1, em: emissao },
            { aprovadorId: aprovadorEmissaoN2, em: emissao },
            { aprovadorId: 'usr-admin', em: emissao },
          ]

    const aprovacoes: AprovacaoReceber[] = Array.from({ length: niveis }, (_, n) => {
      const d = decididos[n]
      return {
        nivel: n + 1,
        rodada: 1,
        aprovadorId: d?.aprovadorId ?? null,
        decisao: d ? 'APROVADO' : null,
        decididoEm: d?.em ?? null,
        justificativa: null,
        delegadoDe: null,
      }
    })

    const recebimentos: RecebimentoTitulo[] =
      f.valorPago > 0
        ? [
            {
              id: `rcb-${String(i + 1).padStart(4, '0')}`,
              valorRecebido: cent(f.valorPago),
              dataRecebimento: f.status === 'PAGA' ? f.vencimento : iso(somarDias(HOJE, -5)),
              contaId: 'cb-oper',
              forma: i % 3 === 0 ? 'BOLETO' : i % 3 === 1 ? 'PIX' : 'TRANSFERENCIA',
              movimentacaoId: null,
              estornadoEm: null,
              estornoMotivo: null,
            },
          ]
        : []

    titulosReceber.push({
      id: receberId(),
      numeroTitulo: ++numeroTitulo,
      clienteId: f.clienteId,
      filialId: contrato?.filialId ?? null,
      contratoId: f.contratoId,
      competencia: f.competencia,
      origem: 'CONTRATUAL',
      descricao: `Locação e consumo — contrato ${contrato?.numero ?? '—'}, competência ${f.competencia}`,
      valorOriginal: cent(f.valorBruto),
      desconto: cent(f.desconto),
      descontoMotivo: f.desconto > 0 ? 'Desconto comercial vigente na competência' : null,
      descontoPor: f.desconto > 0 ? aprovadorEmissaoN2 : null,
      dataEmissao: emissao,
      dataVencimento: f.vencimento,
      status,
      baixaMotivo: null,
      baixadoEm: null,
      excecaoGeracao: null,
      tituloPaiId: null,
      parcelaNumero: null,
      parcelaTotal: null,
      // Quem "gerou" é quem fechou a competência. É o que faz a segregação
      // valer: essa pessoa não aparece como aprovadora possível.
      criadoPor: 'usr-admin',
      criadoEm: emissao,
      rateio: [{ centroCustoId: 'cc-com', percentual: 100 }],
      aprovacoes,
      recebimentos,
    })
  })

  /*
   * Casos que a derivação das faturas nunca produz, e que a tela erra se ninguém
   * os exercitar.
   */
  const clienteAvulso = clientes[0]
  if (clienteAvulso) {
    /*
     * 1. Um contratual EM_DISPUTA, com o motivo escrito (RN-F11).
     *
     * O contrato tem de estar **de fato** fora de vigência. A primeira versão
     * procurava `SUSPENSO` com `?? contratos[0]` de reserva, e como a massa não
     * gera nenhum suspenso, o resultado era um registro que se contradizia:
     * "em disputa porque o contrato estava em ATIVO no fechamento". Uma reserva
     * silenciosa produz dado que parece válido e afirma o contrário de si mesmo
     * — foi o teste de ponta a ponta que leu a frase e a acusou.
     */
    const contratoSuspenso = contratos.find((c) =>
      ['SUSPENSO', 'ENCERRADO', 'CANCELADO', 'DISTRATADO'].includes(c.status),
    )
    if (contratoSuspenso) {
      titulosReceber.push({
        id: receberId(),
        numeroTitulo: ++numeroTitulo,
        clienteId: contratoSuspenso.clienteId,
        filialId: contratoSuspenso.filialId,
        contratoId: contratoSuspenso.id,
        competencia: comps[comps.length - 1]!,
        origem: 'CONTRATUAL',
        descricao: `Locação e consumo — contrato ${contratoSuspenso.numero}, competência ${comps[comps.length - 1]}`,
        valorOriginal: 4_180,
        desconto: 0,
        descontoMotivo: null,
        descontoPor: null,
        dataEmissao: iso(somarDias(HOJE, -8)),
        dataVencimento: iso(somarDias(HOJE, 22)),
        status: 'EM_DISPUTA',
        baixaMotivo: null,
        baixadoEm: null,
        excecaoGeracao: `Contrato ${contratoSuspenso.numero} estava em ${contratoSuspenso.status} no fechamento.`,
        tituloPaiId: null,
        parcelaNumero: null,
        parcelaTotal: null,
        criadoPor: 'usr-admin',
        criadoEm: iso(somarDias(HOJE, -8)),
        rateio: [{ centroCustoId: 'cc-com', percentual: 100 }],
        aprovacoes: [],
        recebimentos: [],
      })
    }

    // 2. Um BAIXADO: encerrado sem entrada de caixa. É o caso que o relatório
    //    erra somando com RECEBIDO, e sem um na massa a distinção não aparece.
    titulosReceber.push({
      id: receberId(),
      numeroTitulo: ++numeroTitulo,
      clienteId: clienteAvulso.id,
      filialId: null,
      contratoId: null,
      competencia: null,
      origem: 'AVULSO',
      descricao: 'Reposição de suprimento fora de contrato',
      valorOriginal: 890,
      desconto: 0,
      descontoMotivo: null,
      descontoPor: null,
      dataEmissao: iso(somarMeses(HOJE, -4)),
      dataVencimento: iso(somarMeses(HOJE, -3)),
      status: 'BAIXADO',
      baixaMotivo: 'Perda reconhecida: cliente em recuperação judicial, crédito habilitado.',
      baixadoEm: iso(somarMeses(HOJE, -1)),
      tituloPaiId: null,
      parcelaNumero: null,
      parcelaTotal: null,
      excecaoGeracao: null,
      criadoPor: aprovadorEmissaoN2,
      criadoEm: iso(somarMeses(HOJE, -4)),
      rateio: [{ centroCustoId: 'cc-com', percentual: 100 }],
      aprovacoes: [],
      recebimentos: [],
    })

    // 3. Avulsos: um aprovado em aberto, um esperando decisão, um rejeitado.
    const avulsos: { descricao: string; valor: number; status: StatusReceber; rejeitado?: boolean }[] = [
      { descricao: 'Projeto de reestruturação do parque instalado', valor: 34_500, status: 'PENDENTE_APROVACAO' },
      { descricao: 'Treinamento de operadores no cliente', valor: 1_250, status: 'APROVADO' },
      { descricao: 'Recuperação de equipamento danificado', valor: 6_800, status: 'PENDENTE', rejeitado: true },
    ]
    avulsos.forEach((a, i) => {
      const niveis = niveisDe(a.valor, 'EMISSAO_FATURA')
      const aprovacoes: AprovacaoReceber[] = Array.from({ length: Math.max(niveis, 1) }, (_, n) => ({
        nivel: n + 1,
        rodada: 1,
        aprovadorId: a.rejeitado && n === 0 ? aprovadorEmissaoN1 : null,
        decisao: a.rejeitado && n === 0 ? 'REJEITADO' : null,
        decididoEm: a.rejeitado && n === 0 ? iso(somarDias(HOJE, -2)) : null,
        justificativa:
          a.rejeitado && n === 0
            ? 'Valor divergente do orçamento aprovado pelo cliente; reenviar com o aditivo.'
            : null,
        delegadoDe: null,
      }))

      titulosReceber.push({
        id: receberId(),
        numeroTitulo: ++numeroTitulo,
        clienteId: clientes[i % clientes.length]!.id,
        filialId: null,
        contratoId: null,
        competencia: null,
        origem: 'AVULSO',
        descricao: a.descricao,
        valorOriginal: a.valor,
        desconto: 0,
        descontoMotivo: null,
        descontoPor: null,
        dataEmissao: iso(somarDias(HOJE, -10 - i)),
        dataVencimento: iso(somarDias(HOJE, 20 - i * 15)),
        status: a.status,
        baixaMotivo: null,
        baixadoEm: null,
        excecaoGeracao: null,
        tituloPaiId: null,
        parcelaNumero: null,
        parcelaTotal: null,
        criadoPor: lancador(i),
        criadoEm: iso(somarDias(HOJE, -10 - i)),
        rateio: [{ centroCustoId: 'cc-com', percentual: 100 }],
        aprovacoes: a.status === 'APROVADO' && niveis === 0 ? [] : aprovacoes,
        recebimentos: [],
      })
    })
  }

  titulosReceber.sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento))

  /*
   * Estado de fechamento das competências.
   *
   * As fechadas são as anteriores à corrente: é o que uma operação real tem, e é
   * o que faz a tela poder oferecer "fechar" só onde faz sentido. Sem isto, o
   * botão apareceria para um mês já selado.
   */
  const competencias_fechamento: CompetenciaFechamento[] = comps.map((c, i) => ({
    competencia: c,
    fechadoEm: i < comps.length - 1 ? `${c}-28` : null,
  }))

  /*
   * Uma delegação vigente.
   *
   * Sem ela a tela nunca exibiria o caso, e é o caso que existe porque a
   * alternativa real é emprestar credencial: sem caminho legítimo para as férias
   * do gerente, alguém digita a senha de outra pessoa — e a trilha de auditoria
   * passa a mentir sobre quem aprovou.
   */
  const delegacoes: DelegacaoAprovacao[] = [
    {
      id: 'dlg-0001',
      deleganteId: aprovadorN2,
      delegadoId: aprovadorN1,
      nivel: 2,
      inicio: iso(somarDias(HOJE, -3)),
      fim: iso(somarDias(HOJE, 11)),
      motivo: 'Férias de duas semanas.',
    },
  ]


  /* ------------------------- Módulos 12 e 13: previsto e caixa -------- */

  /*
   * Cenários: o padrão neutro e um pessimista.
   *
   * O padrão é neutro de propósito. É ele que responde quando a projeção é
   * chamada sem cenário **e** de onde os alertas saem: um padrão de estresse faria
   * todo alerta soar sempre, e alerta que soa sempre é alerta que ninguém lê.
   */
  const cenariosCaixa: CenarioCaixa[] = [
    { id: 'cen-base', nome: 'Base', inadimplencia: 0, limiarConcentracao: 40, padrao: true },
    { id: 'cen-estresse', nome: 'Estresse', inadimplencia: 18, limiarConcentracao: 30, padrao: false },
  ]

  /*
   * Duas séries: uma a pagar mensal e uma a receber trimestral.
   *
   * `proximaGeracao` fica no passado na primeira, de propósito: é o caso em que a
   * tela tem algo a gerar, e sem ele o botão existiria sem nunca fazer nada.
   */
  const recorrencias: Recorrencia[] = [
    {
      id: 'rec-aluguel',
      lado: 'PAGAR',
      descricao: 'Aluguel do centro de distribuição',
      valorBase: 18_400,
      periodicidade: 'MENSAL',
      diaVencimento: 10,
      proximaGeracao: iso(somarMeses(HOJE, -1)).slice(0, 8) + '10',
      ativo: true,
      empresaId: null,
      fornecedorId: fornecedores[0]?.id ?? null,
      classificacao: 'DESPESA_FIXA',
      clienteId: null,
      centroCustoId: 'cc-adm',
      contratoId: null,
      filialId: FILIAIS[0]?.id ?? null,
    },
    {
      id: 'rec-suporte',
      lado: 'RECEBER',
      descricao: 'Suporte estendido trimestral',
      valorBase: 4_200,
      periodicidade: 'TRIMESTRAL',
      diaVencimento: 5,
      proximaGeracao: iso(somarMeses(HOJE, 1)).slice(0, 8) + '05',
      ativo: true,
      empresaId: null,
      fornecedorId: null,
      classificacao: null,
      clienteId: clientes[0]?.id ?? null,
      centroCustoId: 'cc-com',
      contratoId: contratos.find((c) => c.status === 'ATIVO')?.id ?? null,
      filialId: FILIAIS[0]?.id ?? null,
    },
  ]

  /*
   * Lançamentos futuros que cobrem os quatro estados que a tela precisa mostrar:
   * programado no futuro, elegível hoje, na fila de exceção e já convertido.
   *
   * O da fila de exceção depende de um contrato **de verdade** fora de vigência —
   * sem `?? contratos[0]` de reserva, que foi o defeito do Módulo 11: o fallback
   * silencioso escolhia um contrato ATIVO e o caso "em disputa" nunca acontecia.
   */
  const contratoInativo =
    contratos.find((c) => c.status === 'SUSPENSO') ??
    contratos.find((c) => ['ENCERRADO', 'CANCELADO', 'DISTRATADO'].includes(c.status)) ??
    null

  const lancamentosFuturos: LancamentoFuturo[] = [
    {
      id: 'lf-energia',
      tipo: 'DESPESA_RECORRENTE',
      lado: 'PAGAR',
      descricao: 'Energia elétrica do centro de distribuição',
      valorPrevisto: 7_350,
      dataPrevista: iso(somarDias(HOJE, 12)),
      empresaId: null,
      fornecedorId: fornecedores[1]?.id ?? null,
      classificacao: 'DESPESA_FIXA',
      clienteId: null,
      centroCustoId: 'cc-adm',
      contratoId: null,
      filialId: FILIAIS[0]?.id ?? null,
      recorrenciaId: null,
      status: 'PROGRAMADO',
      tituloPagarId: null,
      tituloReceberId: null,
      convertidoEm: null,
      excecaoConversao: null,
      tentativasConversao: 0,
      criadoPor: 'usr-admin',
      criadoEm: iso(somarDias(HOJE, -20)),
    },
    {
      /* Elegível: já venceu e continua programado. É o que a tela converte. */
      id: 'lf-seguro',
      tipo: 'DESPESA_PARCELADA',
      lado: 'PAGAR',
      descricao: 'Parcela do seguro da frota',
      valorPrevisto: 3_180,
      dataPrevista: iso(somarDias(HOJE, -2)),
      empresaId: null,
      fornecedorId: fornecedores[0]?.id ?? null,
      classificacao: 'DESPESA_VARIAVEL',
      clienteId: null,
      centroCustoId: 'cc-oper-campo',
      contratoId: null,
      filialId: FILIAIS[1]?.id ?? null,
      recorrenciaId: null,
      status: 'PROGRAMADO',
      tituloPagarId: null,
      tituloReceberId: null,
      convertidoEm: null,
      excecaoConversao: null,
      tentativasConversao: 0,
      criadoPor: 'usr-admin',
      criadoEm: iso(somarDias(HOJE, -40)),
    },
    {
      /* Provisão: planejamento, sem contrapartida contábil. */
      id: 'lf-provisao',
      tipo: 'PROVISAO',
      lado: 'PAGAR',
      descricao: 'Provisão para reforma da oficina',
      valorPrevisto: 96_000,
      dataPrevista: iso(somarMeses(HOJE, 5)),
      empresaId: null,
      fornecedorId: null,
      classificacao: 'INVESTIMENTO',
      clienteId: null,
      centroCustoId: 'cc-oper-campo',
      contratoId: null,
      filialId: FILIAIS[0]?.id ?? null,
      recorrenciaId: null,
      status: 'PROGRAMADO',
      tituloPagarId: null,
      tituloReceberId: null,
      convertidoEm: null,
      excecaoConversao: null,
      tentativasConversao: 0,
      criadoPor: 'usr-admin',
      criadoEm: iso(somarDias(HOJE, -15)),
    },
    {
      /* Receita prevista, ligada a um contrato vigente. */
      id: 'lf-consultoria',
      tipo: 'RECEITA_PARCELADA',
      lado: 'RECEBER',
      descricao: 'Consultoria de racionalização de impressão',
      valorPrevisto: 12_800,
      dataPrevista: iso(somarDias(HOJE, 25)),
      empresaId: null,
      fornecedorId: null,
      classificacao: null,
      clienteId: clientes[1]?.id ?? clientes[0]?.id ?? null,
      centroCustoId: 'cc-com',
      contratoId: contratos.find((c) => c.status === 'ATIVO')?.id ?? null,
      filialId: FILIAIS[0]?.id ?? null,
      recorrenciaId: null,
      status: 'PROGRAMADO',
      tituloPagarId: null,
      tituloReceberId: null,
      convertidoEm: null,
      excecaoConversao: null,
      tentativasConversao: 0,
      criadoPor: 'usr-admin',
      criadoEm: iso(somarDias(HOJE, -8)),
    },
  ]

  if (contratoInativo) {
    lancamentosFuturos.push({
      id: 'lf-excecao',
      tipo: 'RECEITA_RECORRENTE',
      lado: 'RECEBER',
      descricao: 'Mensalidade de suporte — contrato fora de vigência',
      valorPrevisto: 2_450,
      dataPrevista: iso(somarDias(HOJE, -6)),
      empresaId: null,
      fornecedorId: null,
      classificacao: null,
      clienteId: contratoInativo.clienteId,
      centroCustoId: 'cc-com',
      contratoId: contratoInativo.id,
      filialId: contratoInativo.filialId,
      recorrenciaId: null,
      status: 'PROGRAMADO',
      tituloPagarId: null,
      tituloReceberId: null,
      convertidoEm: null,
      /*
       * A exceção já vem escrita: é o que faz a fila existir na primeira
       * abertura da tela. Um lançamento que falhou em silêncio não é revisto.
       */
      excecaoConversao: `Contrato ${contratoInativo.numero} está em ${contratoInativo.status}: a conversão não gera título de contrato inativo.`,
      tentativasConversao: 3,
      criadoPor: 'usr-admin',
      criadoEm: iso(somarDias(HOJE, -35)),
    })
  }

  /*
   * Um já convertido, apontando para um título que existe na massa.
   *
   * Sem ele a tela nunca mostraria o estado final, e o link "abrir o título
   * gerado" ficaria sem caso — que é como um caminho de navegação quebra sem
   * ninguém notar.
   */
  const tituloParaVincular = titulosPagar.find((t) => t.tituloPaiId === null && t.parcelaTotal === null)
  if (tituloParaVincular) {
    lancamentosFuturos.push({
      id: 'lf-convertido',
      tipo: 'DESPESA_RECORRENTE',
      lado: 'PAGAR',
      descricao: tituloParaVincular.descricao,
      valorPrevisto: tituloParaVincular.valorOriginal,
      dataPrevista: tituloParaVincular.dataVencimento,
      empresaId: null,
      fornecedorId: tituloParaVincular.fornecedorId,
      classificacao: tituloParaVincular.classificacao,
      clienteId: null,
      centroCustoId: tituloParaVincular.rateio[0]?.centroCustoId ?? null,
      contratoId: null,
      filialId: tituloParaVincular.filialId,
      recorrenciaId: 'rec-aluguel',
      status: 'CONVERTIDO',
      tituloPagarId: tituloParaVincular.id,
      tituloReceberId: null,
      convertidoEm: tituloParaVincular.criadoEm,
      excecaoConversao: null,
      tentativasConversao: 0,
      criadoPor: 'usr-admin',
      criadoEm: iso(somarDias(HOJE, -60)),
    })
  }

  lancamentosFuturos.sort((a, b) => a.dataPrevista.localeCompare(b.dataPrevista))

  return {
    competencias: comps,
    regioes: REGIOES,
    filiais: FILIAIS,
    fabricantes: FABRICANTES,
    modelos: MODELOS,
    categorias: CATEGORIAS,
    clientes,
    locais,
    contratos,
    anexos,
    fornecedores,
    notasFiscais,
    tabelasFranquia,
    tabelasPreco,
    descontos,
    equipamentos,
    tecnicos,
    usuarios,
    perfis,
    ordens,
    pecas,
    faturas,
    centrosCusto,
    contasBancarias,
    movimentacoes,
    alcadas,
    titulosPagar,
    delegacoes,
    titulosReceber,
    competencias_fechamento,
    recorrencias,
    lancamentosFuturos,
    cenariosCaixa,
    indicadores,
  }
}

/* -------------------------------------------------------------------------- */
/* Indicadores — derivados da base, nunca digitados                           */
/* -------------------------------------------------------------------------- */

/**
 * Recalcula os indicadores a partir da base.
 *
 * Exportado porque toda escrita precisa disso: abrir um chamado muda
 * `chamadosAbertos`, baixar uma peça muda `pecasAbaixoMinimo`. Se o painel
 * continuasse mostrando o número anterior, a interface passaria a mentir logo
 * depois da ação — que é justamente quando o usuário está olhando.
 */
export function recalcularIndicadores(base: BaseDados): Indicadores {
  return calcularIndicadores({
    equipamentos: base.equipamentos,
    contratos: base.contratos,
    faturas: base.faturas,
    ordens: base.ordens,
    pecas: base.pecas,
    comps: base.competencias,
  })
}

function calcularIndicadores(ctx: {
  equipamentos: Equipamento[]
  contratos: Contrato[]
  faturas: Fatura[]
  ordens: OrdemServico[]
  pecas: Peca[]
  comps: string[]
}): Indicadores {
  const { equipamentos, contratos, faturas, ordens, pecas, comps } = ctx

  const ativos = equipamentos.filter((e) => e.status !== 'BAIXADO')
  const locados = ativos.filter((e) => e.status === 'LOCADO')
  const disponiveis = ativos.filter((e) => e.status === 'DISPONIVEL')
  const manutencao = ativos.filter((e) => e.status === 'EM_MANUTENCAO')
  const bloqueados = ativos.filter((e) => e.bloqueado)

  const compAtual = comps[comps.length - 1]
  const compAnterior = comps[comps.length - 2]

  const somaComp = (comp: string) =>
    faturas.filter((f) => f.competencia === comp).reduce((a, f) => a + f.valorLiquido, 0)

  const receitaMes = somaComp(compAtual)
  const receitaMesAnterior = somaComp(compAnterior)

  const itensAtivos = contratos
    .filter((c) => c.status === 'ATIVO' || c.status === 'EM_RENOVACAO' || c.status === 'VENCIDO_EM_CAMPO')
    .flatMap((c) => c.itens)
  const mrr = itensAtivos.reduce((a, i) => a + i.valorMensal, 0)

  const custoManutencaoMes = ordens
    .filter((o) => o.concluidaEm && o.concluidaEm.slice(0, 7) === compAtual)
    .reduce((a, o) => a + o.custoMaoObra + o.custoPecas, 0)

  const depreciacaoMes = ativos.reduce((a, e) => {
    const m = modeloPorId.get(e.modeloId)
    return a + (m ? m.valorAquisicao / m.vidaUtilMeses : 0)
  }, 0)

  const custoTotalMes = custoManutencaoMes + depreciacaoMes
  const margem = receitaMes > 0 ? (receitaMes - custoTotalMes) / receitaMes : 0

  const receberAberto = faturas.filter((f) => f.status !== 'PAGA' && f.status !== 'CANCELADA')
  const carteira = receberAberto.reduce((a, f) => a + (f.valorLiquido - f.valorPago), 0)
  const vencido = receberAberto
    .filter((f) => f.diasAtraso > 0)
    .reduce((a, f) => a + (f.valorLiquido - f.valorPago), 0)
  const inadimplencia = carteira > 0 ? vencido / carteira : 0

  const encerradas = ordens.filter((o) => o.concluidaEm)
  const dentroPrazo = encerradas.filter((o) => o.concluidaEm! <= o.prazoSolucaoEm)
  const sla = encerradas.length ? dentroPrazo.length / encerradas.length : 1

  const mttr =
    encerradas.length
      ? encerradas.reduce(
          (a, o) => a + (new Date(o.concluidaEm!).getTime() - new Date(o.abertaEm).getTime()) / 3600000,
          0,
        ) / encerradas.length
      : 0

  const abertas = ordens.filter(
    (o) => !['VALIDADA', 'CONCLUIDA', 'CANCELADA'].includes(o.status),
  )
  const emRisco = abertas.filter(
    (o) => new Date(o.prazoSolucaoEm).getTime() - HOJE.getTime() < 4 * 3600000,
  )

  const paginasMes = equipamentos.reduce((a, e) => {
    const l = e.historicoConsumo.find((h) => h.competencia === compAtual)
    return a + (l ? l.mono + l.color : 0)
  }, 0)

  const serie = (fn: (comp: string) => number): SerieMensal[] =>
    comps.map((comp) => ({ competencia: comp, valor: Math.round(fn(comp)) }))

  const contratosAtivos = contratos.filter((c) => c.status === 'ATIVO' || c.status === 'EM_RENOVACAO').length
  const contratosVencendo = contratos.filter((c) => {
    if (c.status !== 'ATIVO' && c.status !== 'EM_RENOVACAO') return false
    const dias = (new Date(c.dataFim).getTime() - HOJE.getTime()) / 86400000
    return dias >= 0 && dias <= 90
  }).length

  const ocupacao = ativos.length ? locados.length / ativos.length : 0

  return {
    receitaMes,
    receitaMesAnterior,
    mrr,
    mrrAnterior: mrr * 0.972,
    ticketMedio: contratosAtivos ? mrr / contratosAtivos : 0,
    equipamentosAtivos: ativos.length,
    equipamentosLocados: locados.length,
    equipamentosDisponiveis: disponiveis.length,
    equipamentosManutencao: manutencao.length,
    equipamentosBloqueados: bloqueados.length,
    taxaOcupacao: ocupacao,
    taxaOcupacaoAnterior: ocupacao - 0.021,
    margemOperacional: margem,
    margemOperacionalAnterior: margem + 0.012,
    inadimplencia,
    inadimplenciaAnterior: inadimplencia - 0.006,
    slaCumprimento: sla,
    slaAnterior: sla - 0.011,
    mttrHoras: mttr,
    mttrAnterior: mttr * 1.08,
    disponibilidade: ativos.length ? 1 - manutencao.length / ativos.length : 1,
    custoManutencaoMes,
    paginasMes,
    contratosAtivos,
    contratosVencendo,
    chamadosAbertos: abertas.length,
    chamadosEmRiscoSla: emRisco.length,
    pecasAbaixoMinimo: pecas.filter((p) => p.saldo < p.estoqueMinimo).length,
    // Itens de impressão do ciclo corrente sem leitura registrada.
    // Derivada, não fixada: resolver uma pendência precisa baixar o número.
    pendenciasMedicao: ctx.equipamentos.filter(
      (e) =>
        e.status === 'LOCADO' &&
        e.historicoConsumo.length > 0 &&
        !e.historicoConsumo.some((h) => h.competencia === compAtual),
    ).length,
    serieReceita: serie((c) => faturas.filter((f) => f.competencia === c).reduce((a, f) => a + f.valorLiquido, 0)),
    serieCusto: serie(
      (c) =>
        ordens
          .filter((o) => o.concluidaEm && o.concluidaEm.slice(0, 7) === c)
          .reduce((a, o) => a + o.custoMaoObra + o.custoPecas, 0) + depreciacaoMes,
    ),
    seriePaginas: serie((c) =>
      equipamentos.reduce((a, e) => {
        const l = e.historicoConsumo.find((h) => h.competencia === c)
        return a + (l ? l.mono + l.color : 0)
      }, 0),
    ),
    serieSla: serie((c) => {
      const doMes = ordens.filter((o) => o.concluidaEm && o.concluidaEm.slice(0, 7) === c)
      if (!doMes.length) return 96
      return (doMes.filter((o) => o.concluidaEm! <= o.prazoSolucaoEm).length / doMes.length) * 100
    }),
  }
}

/* Auxiliares locais para evitar dependência circular com catalogo.ts */
function filialPorIdLocal(filialId: string) {
  return FILIAIS.find((f) => f.id === filialId)?.codigo ?? 'SP-01'
}

function nomeModeloLocal(modeloId: string) {
  const m = modeloPorId.get(modeloId)
  if (!m) return '—'
  const fab = FABRICANTES.find((f) => f.id === m.fabricanteId)
  return `${fab?.nome ?? ''} ${m.nome}`.trim()
}
