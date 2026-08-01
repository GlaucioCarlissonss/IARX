/**
 * Catálogo de permissões — Anexo C.2.
 *
 * Este módulo é deliberadamente **sem dependência alguma**, nem Zod. O
 * front-end precisa da lista para decidir o que renderizar, e não deve carregar
 * uma biblioteca de validação de esquema no bundle do navegador só por isso.
 * Os esquemas Zod correspondentes ficam em `permissoes.ts`, que importa daqui.
 *
 * A lista é a fonte única: front e API leem o mesmo array. Sem isso reaparece a
 * divergência clássica — o botão some na tela mas a rota continua aberta, ou o
 * inverso, e ninguém percebe até alguém tentar.
 *
 * Formato `recurso:ação`, atômica, negada por padrão (RN-026).
 */
export const PERMISSOES = [
  // Contratos e clientes
  'cliente:ler',
  'cliente:criar',
  'cliente:editar',
  'cliente:inativar',
  'cliente:credito_definir',
  'local_operacao:gerenciar',
  'contrato:ler',
  'contrato:criar',
  'contrato:editar',
  'contrato:aprovar',
  'contrato:ativar',
  'contrato:suspender',
  'contrato:retomar',
  'contrato:renovar',
  'contrato:encerrar',
  'contrato:cancelar',
  'contrato:distratar',
  'contrato:item_alocar',
  'contrato:item_substituir',
  'contrato:item_encerrar',
  'contrato:desconto_conceder',
  'contrato:reajuste_aprovar',
  'contrato:anexo_gerenciar',

  // Equipamentos
  'equipamento:ler',
  'equipamento:criar',
  'equipamento:editar',
  'equipamento:importar',
  'equipamento:patrimonial_editar',
  'equipamento:movimentar',
  'equipamento:transferir',
  'equipamento:transferencia_aceitar',
  'equipamento:bloquear',
  'equipamento:desbloquear',
  'equipamento:baixar',
  'equipamento:leitura_registrar',
  'equipamento:leitura_estornar',
  'equipamento:etiqueta_gerar',
  'catalogo:gerenciar',

  // Manutenção
  'os:ler',
  'os:criar',
  'os:triar',
  'os:atribuir',
  'os:agendar',
  'os:executar',
  'os:concluir',
  'os:validar',
  'os:cancelar',
  'os:reabrir',
  'os:custo_aprovar',
  'os:sla_pausar',
  'plano_preventivo:gerenciar',
  'tecnico:gerenciar',

  // Peças e estoque
  'peca:ler',
  'peca:criar',
  'peca:editar',
  'estoque:movimentar',
  'estoque:reservar',
  'estoque:ajustar',
  'estoque:politica_definir',
  'inventario:executar',
  'inventario:aprovar',
  'fornecedor:gerenciar',
  'ordem_compra:criar',
  'ordem_compra:aprovar',
  'ordem_compra:receber',

  // Faturamento
  'medicao:ler',
  'medicao:consolidar',
  'medicao:estimar',
  'fatura:ler',
  'prefatura:gerar',
  'prefatura:editar',
  'prefatura:aprovar',
  'fatura:emitir',
  'fatura:cancelar',
  'fatura:nota_correcao',
  'fatura:desconto_aplicar',
  'competencia:fechar',
  'competencia:reabrir',
  'faturamento:exportar',

  // Financeiro
  'receber:ler',
  'receber:baixar',
  'receber:negociar',
  'pagar:ler',
  'pagar:criar',
  'pagar:aprovar',
  'pagar:baixar',
  'conciliacao:executar',
  'financeiro:lancamento_manual',
  'financeiro:centro_custo_gerenciar',
  'financeiro:painel_executivo',
  'financeiro:rentabilidade_ler',
  'financeiro:exportar',

  // Mapa, relatórios e administração
  'mapa:ler',
  'mapa:filtro_compartilhar',
  'relatorio:ler',
  'relatorio:criar',
  'relatorio:agendar',
  'usuario:gerenciar',
  'perfil:gerenciar',
  'alcada:definir',
  'parametro:gerenciar',
  'integracao:gerenciar',
  'apikey:gerenciar',
  'webhook:gerenciar',
  'auditoria:consultar',
  'dados_sensiveis:ver_completo',
] as const

export type Permissao = (typeof PERMISSOES)[number]

/**
 * Escopo organizacional. Ter a permissão não basta: o registro precisa estar
 * dentro do escopo do perfil (Anexo C.1).
 *
 *   Autorização = possui(permissão) AND registro ∈ escopo AND satisfaz(alçada)
 */
export const ESCOPOS = ['TENANT', 'EMPRESA', 'FILIAL', 'REGIAO', 'PROPRIO'] as const
export type Escopo = (typeof ESCOPOS)[number]

export interface EscopoConcedido {
  tipo: Escopo
  /** Nulo em escopo TENANT — não há id a delimitar. */
  id: string | null
}

/** Predicado puro, idêntico nos dois lados da fronteira. */
export function possuiPermissao(permissoes: readonly Permissao[], exigida: Permissao): boolean {
  return permissoes.includes(exigida)
}

const CONJUNTO = new Set<string>(PERMISSOES)

/** Guarda de tipo para valores vindos de token, banco ou configuração. */
export function ehPermissao(valor: string): valor is Permissao {
  return CONJUNTO.has(valor)
}
