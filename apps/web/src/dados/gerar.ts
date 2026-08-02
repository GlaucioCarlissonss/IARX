import {
  CATEGORIAS,
  FABRICANTES,
  FILIAIS,
  MODELOS,
  REGIOES,
  categoriaPorCodigo,
  modeloPorId,
} from './catalogo'
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
  LocalOperacao,
  ModalidadeCobranca,
  OrdemServico,
  Peca,
  SerieMensal,
  Tecnico,
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

  /* ----------------------------------------------------------- indicadores */
  const indicadores = calcularIndicadores({ equipamentos, contratos, faturas, ordens, pecas, comps })

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
    equipamentos,
    tecnicos,
    ordens,
    pecas,
    faturas,
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
