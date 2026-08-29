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
  'ordem_compra:criar',
  'ordem_compra:aprovar',
  'ordem_compra:receber',

  // Entrada fiscal de compra.
  //
  // Registrar, conferir e integrar são permissões distintas por exigência de
  // segregação de funções (RN-027): quem lança a nota não a confere, e quem
  // confere a mercadoria não é quem faz o lançamento contábil do imobilizado.
  'nota_fiscal:ler',
  'nota_fiscal:criar',
  'nota_fiscal:editar',
  'nota_fiscal:conferir',
  'nota_fiscal:integrar',
  'nota_fiscal:cancelar',
  /*
   * Fornecedor mora aqui, e não no bloco de estoque acima.
   *
   * Ele aparecia nos dois — a mesma permissão listada duas vezes, o que fazia o
   * catálogo declarar 126 entradas e conter 125. Ficou neste bloco porque é aqui
   * que o fornecedor é usado de fato: a nota fiscal de compra é o único caminho
   * que o cria e o consulta hoje. O bloco de estoque o citava por antecipação de
   * um módulo de ordem de compra que ainda não existe.
   */
  'fornecedor:ler',
  'fornecedor:gerenciar',

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
  // Novas do Módulo 11, cada uma por uma razão concreta.
  //
  // `criar` é lançar título avulso — operação, distinta de `ler`, que é
  // conferência. `aprovar` existe porque **quem gera a pré-cobrança não a
  // aprova**: no fechamento automático quem "gera" é quem disparou o
  // fechamento, e sem a separação essa pessoa liberaria a própria cobrança.
  // `cancelar` é separada de `criar` pela mesma razão de `pagar:cancelar`:
  // cancelar um título já aprovado desfaz o trabalho de quem aprovou.
  //
  // `receber:negociar` (que já existia) é a de desconto e de baixa sem
  // recebimento — as duas ações que reduzem o que se cobra sem cancelar.
  'receber:criar',
  'receber:aprovar',
  'receber:cancelar',
  'pagar:ler',
  'pagar:criar',
  'pagar:aprovar',
  'pagar:baixar',
  // Novas do Módulo 10. `cancelar` é separada de `criar` porque cancelar um
  // título já aprovado desfaz o trabalho de quem aprovou; `delegar_aprovacao`
  // é separada de `aprovar` porque quem aprova não precisa poder transferir a
  // própria autoridade — e transferir é o caminho mais curto para contornar a
  // segregação de funções.
  'pagar:cancelar',
  'pagar:delegar_aprovacao',
  'conciliacao:executar',
  'financeiro:lancamento_manual',
  'financeiro:painel_executivo',
  'financeiro:rentabilidade_ler',
  'financeiro:exportar',

  // Centro de custo e conta bancária — Módulos 8 e 9, migração 0017
  //
  // `centro_custo` era `financeiro:centro_custo_gerenciar`, uma ação do recurso
  // `financeiro`. Promovido a recurso próprio ao construir a tela, por duas
  // razões concretas:
  //
  //  · o segundo nível da árvore de permissões é a **tela**, e centro de custo
  //    é uma tela com cadastro próprio. Como ação de "Painéis financeiros", a
  //    árvore afirmaria que ela vive dentro de um painel;
  //  · não havia como conceder leitura sem gestão. Quem lança um título
  //    precisa **ler** a árvore de centros para escolher um, e não precisa
  //    poder criar centro nenhum.
  //
  // `conta_bancaria` é nova: não havia recurso porque não havia tabela.
  'centro_custo:ler',
  'centro_custo:gerenciar',
  'conta_bancaria:ler',
  'conta_bancaria:gerenciar',
  'conta_bancaria:movimentar',
  'conta_bancaria:transferir',

  // Política comercial — tabela de franquia, tabela de preço, simulador
  //
  // Acrescentadas ao reconciliar os vocabulários: o módulo comercial foi
  // construído (Anexo P) com permissões declaradas **apenas** no front-end, e
  // o catálogo compartilhado nunca soube que a tela existia. Enquanto os dois
  // vocabulários eram separados, isso não doía; ao unificá-los, a ausência
  // apagaria a tela do menu e do roteador.
  'comercial:ler',
  'comercial:gerenciar',

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
