import type { Permissao } from './permissoes'

/**
 * Itens de navegação — a lista, em um lugar só.
 *
 * Existia duas vezes: no menu lateral (`AppShell`) e na paleta de comandos, com
 * a segunda escrita à mão e já desatualizada — faltavam Mapa, Política
 * comercial e Notas fiscais, construídas depois dela. E, pior que a
 * desatualização, a paleta **não filtrava por permissão**: oferecia navegar
 * para telas que o perfil não abre, e o usuário só descobria ao chegar na tela
 * de "esta área não faz parte do seu perfil".
 *
 * Com a lista única, acrescentar uma tela é uma linha e os dois consumidores a
 * recebem juntos. É o mesmo raciocínio do catálogo de permissões: duas cópias
 * do mesmo fato divergem, e a divergência aparece tarde.
 *
 * ## Áreas, e por que o menu deixou de ser uma lista só (Anexo Y §Y.3.2)
 *
 * Eram vinte itens sempre visíveis, nove deles em "Financeiro" — em 900 px de
 * altura a última área já ficava fora da dobra, e as rotas construídas depois
 * levariam o total a trinta.
 *
 * Agora são seis **áreas**, e só a aberta mostra os filhos. Dentro de uma área
 * grande há um subtítulo opcional: ele não é um terceiro nível de clique, é um
 * rótulo que divide a lista em blocos legíveis — "Cobrança", "Fiscal",
 * "Controladoria" dentro de Financeiro. Um nível a mais de clique esconderia
 * função; um rótulo não.
 */

/*
 * `curto` é o rótulo da barra inferior.
 *
 * Em 390px cada destino tem ~78px. "Painel do dia" quebra em duas linhas e
 * empurra a barra para 68px de altura; "Administração" não cabe de jeito
 * nenhum. Truncar com reticências devolveria o problema que a barra veio
 * resolver — rótulo que não se lê é glifo com ruído.
 */
export const AREAS = [
  { id: 'painel', rotulo: 'Painel do dia', curto: 'Painel', glifo: '◧' },
  { id: 'parque', rotulo: 'Parque', curto: 'Parque', glifo: '▤' },
  { id: 'comercial', rotulo: 'Comercial', curto: 'Comercial', glifo: '◰' },
  { id: 'servico', rotulo: 'Serviço', curto: 'Serviço', glifo: '◔' },
  { id: 'financeiro', rotulo: 'Financeiro', curto: 'Finanças', glifo: '◩' },
  { id: 'admin', rotulo: 'Administração', curto: 'Admin', glifo: '⊞' },
] as const

export type AreaId = (typeof AREAS)[number]['id']

/** As áreas do portal do cliente. A audiência é outra, e a lista também. */
export const AREAS_PORTAL = [
  { id: 'meu-painel', rotulo: 'Meu painel', curto: 'Painel', glifo: '◧' },
  { id: 'meu-contrato', rotulo: 'Meu contrato', curto: 'Contrato', glifo: '◰' },
  { id: 'consumo', rotulo: 'Consumo', curto: 'Consumo', glifo: '◱' },
] as const

export type AreaPortalId = (typeof AREAS_PORTAL)[number]['id']

export interface ItemNavegacao {
  para: string
  rotulo: string
  glifo: string
  permissao: Permissao
  area: AreaId | AreaPortalId
  /** Rótulo de bloco dentro da área. Só as áreas grandes usam. */
  subgrupo?: string
  /** Frase curta para a paleta de comandos — o menu não a exibe. */
  detalhe: string
}

export const NAVEGACAO: ItemNavegacao[] = [
  { para: '/', rotulo: 'Painel do dia', glifo: '◧', permissao: 'equipamento:ler', area: 'painel', detalhe: 'exceções e agenda' },

  { para: '/parque', rotulo: 'Parque instalado', glifo: '▤', permissao: 'equipamento:ler', area: 'parque', detalhe: 'equipamentos e disponibilidade' },
  { para: '/mapa', rotulo: 'Mapa', glifo: '◉', permissao: 'mapa:ler', area: 'parque', detalhe: 'distribuição geográfica do parque' },

  { para: '/contratos', rotulo: 'Contratos', glifo: '◰', permissao: 'contrato:ler', area: 'comercial', detalhe: 'vigência e renovação' },
  { para: '/clientes', rotulo: 'Clientes', glifo: '◍', permissao: 'cliente:ler', area: 'comercial', detalhe: 'carteira e rentabilidade' },
  { para: '/comercial', rotulo: 'Política comercial', glifo: '◫', permissao: 'comercial:ler', area: 'comercial', detalhe: 'franquia, preço e simulador' },

  { para: '/chamados', rotulo: 'Chamados', glifo: '◔', permissao: 'os:ler', area: 'servico', detalhe: 'fila por risco de SLA' },
  { para: '/estoque', rotulo: 'Peças e suprimentos', glifo: '◱', permissao: 'peca:ler', area: 'servico', detalhe: 'saldos e reposição' },

  /*
   * Financeiro em três blocos.
   *
   * Dez telas numa lista corrida é o que fazia a área precisar de rolagem
   * própria. Os blocos seguem a divisão que o mercado usa — a cobrança do dia,
   * o que vira documento fiscal, e o que se olha para decidir — e não a ordem
   * em que as telas foram construídas.
   */
  { para: '/contas-receber', rotulo: 'Contas a receber', glifo: '◩', permissao: 'receber:ler', area: 'financeiro', subgrupo: 'Cobrança', detalhe: 'cobrança, fechamento de competência e baixa' },
  { para: '/contas-pagar', rotulo: 'Contas a pagar', glifo: '◨', permissao: 'pagar:ler', area: 'financeiro', subgrupo: 'Cobrança', detalhe: 'fila de aprovação, alçada e baixa' },
  { para: '/contas-bancarias', rotulo: 'Contas bancárias', glifo: '◧', permissao: 'conta_bancaria:ler', area: 'financeiro', subgrupo: 'Cobrança', detalhe: 'saldo derivado, extrato e conciliação' },

  { para: '/faturamento', rotulo: 'Faturamento', glifo: '◲', permissao: 'fatura:ler', area: 'financeiro', subgrupo: 'Fiscal', detalhe: 'fechamento e faturas' },
  { para: '/notas-fiscais', rotulo: 'Notas fiscais', glifo: '▦', permissao: 'nota_fiscal:ler', area: 'financeiro', subgrupo: 'Fiscal', detalhe: 'entrada fiscal de compra' },

  { para: '/resultado', rotulo: 'Resultado', glifo: '◈', permissao: 'financeiro:painel_executivo', area: 'financeiro', subgrupo: 'Controladoria', detalhe: 'receita, margem e indicadores' },
  { para: '/fluxo-caixa', rotulo: 'Fluxo de caixa', glifo: '◭', permissao: 'financeiro:painel_executivo', area: 'financeiro', subgrupo: 'Controladoria', detalhe: 'projeção diária, cenários e alertas' },
  { para: '/lancamentos-futuros', rotulo: 'Lançamentos futuros', glifo: '◷', permissao: 'financeiro:lancamento_manual', area: 'financeiro', subgrupo: 'Controladoria', detalhe: 'compromissos programados, séries e conversão' },
  { para: '/despesas', rotulo: 'Despesas', glifo: '◩', permissao: 'despesa:ler', area: 'financeiro', subgrupo: 'Controladoria', detalhe: 'orçamento e execução' },
  { para: '/centros-custo', rotulo: 'Centros de custo', glifo: '◵', permissao: 'centro_custo:ler', area: 'financeiro', subgrupo: 'Controladoria', detalhe: 'árvore de áreas, até três níveis' },

  { para: '/usuarios', rotulo: 'Usuários', glifo: '◑', permissao: 'usuario:gerenciar', area: 'admin', detalhe: 'contas, convites e perfis' },
  { para: '/perfis', rotulo: 'Perfis de acesso', glifo: '⊞', permissao: 'perfil:gerenciar', area: 'admin', detalhe: 'permissões por módulo, tela e ação' },
]

/**
 * A navegação do portal — a segunda audiência.
 *
 * Lista separada, e não uma área a mais na primeira, porque as duas nunca
 * aparecem juntas: quem opera a locadora não abre o portal, e quem é do cliente
 * não abre a operação. Uma lista só obrigaria todo consumidor a filtrar por
 * audiência antes de usá-la, e o consumidor que esquecesse ofereceria à pessoa
 * errada o caminho para a tela errada.
 *
 * As permissões são as mesmas que a lista branca da 0011 autoriza a perfil de
 * cliente — nenhuma nova. É por isso que o rail do portal fica mais curto para
 * o Visualizador do que para o Administrador do cliente, sem nenhuma regra
 * escrita aqui.
 */
export const NAVEGACAO_PORTAL: ItemNavegacao[] = [
  { para: '/portal', rotulo: 'Meu painel', glifo: '◧', permissao: 'equipamento:ler', area: 'meu-painel', detalhe: 'o mês corrente e o que vence' },
  { para: '/portal/contratos', rotulo: 'Meus contratos', glifo: '◰', permissao: 'contrato:ler', area: 'meu-contrato', detalhe: 'vigência, equipamentos e franquia' },
  { para: '/portal/parque', rotulo: 'Meus equipamentos', glifo: '▤', permissao: 'equipamento:ler', area: 'meu-contrato', detalhe: 'onde está cada máquina' },
  { para: '/portal/consumo', rotulo: 'Consumo e custos', glifo: '◱', permissao: 'medicao:ler', area: 'consumo', detalhe: 'páginas, franquia e memória de cálculo' },
]

/**
 * Os destinos da barra inferior, em celular (Anexo Y §Y.3.1).
 *
 * Quatro áreas mais "Mais", que abre a lista inteira. Quatro e não seis porque
 * em 390 px um alvo de toque confortável com rótulo legível ocupa ~78 px — seis
 * caberiam espremidos, e o rótulo é justamente o que faltava.
 *
 * A escolha é por frequência de uso em campo, não por importância: quem abre o
 * sistema no celular é quem está na rua.
 */
export const ATALHOS_CELULAR: readonly AreaId[] = ['painel', 'parque', 'servico', 'financeiro']
export const ATALHOS_CELULAR_PORTAL: readonly AreaPortalId[] = ['meu-painel', 'meu-contrato', 'consumo']

/** Título da página, para a migalha de pão. Derivado, nunca uma segunda lista. */
export const TITULOS: Record<string, string> = Object.fromEntries(
  [...NAVEGACAO, ...NAVEGACAO_PORTAL].map((i) => [i.para, i.rotulo]),
)

/**
 * A área de um caminho. É o que decide qual acordeão abre ao chegar na tela.
 *
 * Derivada da lista, e não um segundo mapa: um mapa à parte seria mais rápido
 * de ler e divergiria na primeira tela nova — que é exatamente o defeito que a
 * lista única existe para impedir.
 */
export function areaDe(caminho: string): AreaId | AreaPortalId | null {
  const item = [...NAVEGACAO, ...NAVEGACAO_PORTAL].find((i) => i.para === caminho)
  return item ? item.area : null
}
