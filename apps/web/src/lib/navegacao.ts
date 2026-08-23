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
 */

export interface ItemNavegacao {
  para: string
  rotulo: string
  glifo: string
  permissao: Permissao
  grupo: 'Operação' | 'Serviço' | 'Financeiro' | 'Administração'
  /** Frase curta para a paleta de comandos — o menu não a exibe. */
  detalhe: string
}

export const GRUPOS = ['Operação', 'Serviço', 'Financeiro', 'Administração'] as const

export const NAVEGACAO: ItemNavegacao[] = [
  { para: '/', rotulo: 'Painel do dia', glifo: '◧', permissao: 'equipamento:ler', grupo: 'Operação', detalhe: 'exceções e agenda' },
  { para: '/parque', rotulo: 'Parque instalado', glifo: '▤', permissao: 'equipamento:ler', grupo: 'Operação', detalhe: 'equipamentos e disponibilidade' },
  { para: '/contratos', rotulo: 'Contratos', glifo: '◰', permissao: 'contrato:ler', grupo: 'Operação', detalhe: 'vigência e renovação' },
  { para: '/clientes', rotulo: 'Clientes', glifo: '◍', permissao: 'cliente:ler', grupo: 'Operação', detalhe: 'carteira e rentabilidade' },
  { para: '/mapa', rotulo: 'Mapa', glifo: '◉', permissao: 'mapa:ler', grupo: 'Operação', detalhe: 'distribuição geográfica do parque' },
  { para: '/chamados', rotulo: 'Chamados', glifo: '◔', permissao: 'os:ler', grupo: 'Serviço', detalhe: 'fila por risco de SLA' },
  { para: '/estoque', rotulo: 'Peças e suprimentos', glifo: '◱', permissao: 'peca:ler', grupo: 'Serviço', detalhe: 'saldos e reposição' },
  { para: '/notas-fiscais', rotulo: 'Notas fiscais', glifo: '▦', permissao: 'nota_fiscal:ler', grupo: 'Financeiro', detalhe: 'entrada fiscal de compra' },
  { para: '/faturamento', rotulo: 'Faturamento', glifo: '◲', permissao: 'fatura:ler', grupo: 'Financeiro', detalhe: 'fechamento e faturas' },
  { para: '/comercial', rotulo: 'Política comercial', glifo: '◫', permissao: 'comercial:ler', grupo: 'Financeiro', detalhe: 'franquia, preço e simulador' },
  { para: '/resultado', rotulo: 'Resultado', glifo: '◈', permissao: 'financeiro:painel_executivo', grupo: 'Financeiro', detalhe: 'receita, margem e indicadores' },
  { para: '/centros-custo', rotulo: 'Centros de custo', glifo: '◵', permissao: 'centro_custo:ler', grupo: 'Financeiro', detalhe: 'árvore de áreas, até três níveis' },
  { para: '/contas-bancarias', rotulo: 'Contas bancárias', glifo: '◧', permissao: 'conta_bancaria:ler', grupo: 'Financeiro', detalhe: 'saldo derivado, extrato e conciliação' },
  { para: '/contas-pagar', rotulo: 'Contas a pagar', glifo: '◨', permissao: 'pagar:ler', grupo: 'Financeiro', detalhe: 'fila de aprovação, alçada e baixa' },
  { para: '/contas-receber', rotulo: 'Contas a receber', glifo: '◩', permissao: 'receber:ler', grupo: 'Financeiro', detalhe: 'cobrança, fechamento de competência e baixa' },
  { para: '/lancamentos-futuros', rotulo: 'Lançamentos futuros', glifo: '◷', permissao: 'financeiro:lancamento_manual', grupo: 'Financeiro', detalhe: 'compromissos programados, séries e conversão' },
  { para: '/fluxo-caixa', rotulo: 'Fluxo de caixa', glifo: '◭', permissao: 'financeiro:painel_executivo', grupo: 'Financeiro', detalhe: 'projeção diária, cenários e alertas' },
  { para: '/usuarios', rotulo: 'Usuários', glifo: '◑', permissao: 'usuario:gerenciar', grupo: 'Administração', detalhe: 'contas, convites e perfis' },
  { para: '/perfis', rotulo: 'Perfis de acesso', glifo: '⊞', permissao: 'perfil:gerenciar', grupo: 'Administração', detalhe: 'permissões por módulo, tela e ação' },
]

/** Título da página, para a migalha de pão. Derivado, nunca uma segunda lista. */
export const TITULOS: Record<string, string> = Object.fromEntries(
  NAVEGACAO.map((i) => [i.para, i.rotulo]),
)
