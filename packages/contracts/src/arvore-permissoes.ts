import { PERMISSOES, type Permissao } from './catalogo-permissoes.js'

/**
 * Árvore de permissões — módulo → tela → ação.
 *
 * O catálogo (`catalogo-permissoes.ts`) é uma lista plana de `recurso:ação`, e
 * é o formato certo para o que ele faz: a guarda da API compara strings, e
 * agrupar não ajudaria em nada ali. O que a lista plana não serve é **para
 * configurar um perfil**: ninguém escolhe entre 114 caixas soltas em ordem
 * alfabética sem errar.
 *
 * Este módulo é a mesma informação em forma de árvore. Não é um segundo
 * catálogo — é uma projeção do primeiro, e o teste garante que nenhuma
 * permissão exista sem lugar na árvore. O contrário seria pior que não ter
 * árvore nenhuma: uma permissão fora dela é uma permissão que a interface não
 * mostra, e portanto que ninguém consegue conceder.
 *
 * **Herança é regra de renderização, não de dado.** Marcar o nó "Financeiro"
 * marca os descendentes na lista enviada; o que chega ao banco continua sendo
 * `perfil.permissoes text[]` com as permissões atômicas. A RLS e a guarda nunca
 * souberam que existiu uma árvore, e é por isso que ela pôde ser acrescentada
 * sem tocar em nenhuma das duas.
 */

export interface NoAcao {
  permissao: Permissao
  /** Rótulo do botão na árvore de configuração. */
  rotulo: string
}

export interface NoTela {
  recurso: string
  nome: string
  acoes: NoAcao[]
}

export interface NoModulo {
  id: string
  nome: string
  telas: NoTela[]
}

/**
 * Módulo de cada recurso.
 *
 * Escrito à mão de propósito: a divisão em módulos é decisão de produto — em
 * que menu a tela aparece — e não decorre de nada presente no nome da
 * permissão. Derivá-la por heurística de prefixo daria um agrupamento que
 * mudaria sozinho ao renomear um recurso.
 */
const MODULO_DO_RECURSO: Record<string, string> = {
  cliente: 'comercial',
  local_operacao: 'comercial',
  contrato: 'comercial',
  comercial: 'comercial',
  fatura: 'faturamento',
  prefatura: 'faturamento',
  competencia: 'faturamento',
  faturamento: 'faturamento',
  medicao: 'faturamento',
  equipamento: 'parque',
  catalogo: 'parque',
  os: 'manutencao',
  plano_preventivo: 'manutencao',
  tecnico: 'manutencao',
  peca: 'estoque',
  estoque: 'estoque',
  inventario: 'estoque',
  fornecedor: 'suprimentos',
  ordem_compra: 'suprimentos',
  nota_fiscal: 'suprimentos',
  receber: 'financeiro',
  pagar: 'financeiro',
  conciliacao: 'financeiro',
  centro_custo: 'financeiro',
  conta_bancaria: 'financeiro',
  financeiro: 'financeiro',
  mapa: 'analise',
  relatorio: 'analise',
  usuario: 'administracao',
  perfil: 'administracao',
  alcada: 'administracao',
  parametro: 'administracao',
  integracao: 'administracao',
  apikey: 'administracao',
  webhook: 'administracao',
  auditoria: 'administracao',
  dados_sensiveis: 'administracao',
}

/** Ordem deliberada: a que o menu segue, do operacional ao administrativo. */
const NOME_MODULO: { id: string; nome: string }[] = [
  { id: 'comercial', nome: 'Comercial e contratos' },
  { id: 'parque', nome: 'Parque instalado' },
  { id: 'manutencao', nome: 'Manutenção' },
  { id: 'estoque', nome: 'Peças e estoque' },
  { id: 'suprimentos', nome: 'Compras e entrada fiscal' },
  { id: 'faturamento', nome: 'Faturamento' },
  { id: 'financeiro', nome: 'Financeiro' },
  { id: 'analise', nome: 'Mapa e relatórios' },
  { id: 'administracao', nome: 'Administração' },
]

const NOME_RECURSO: Record<string, string> = {
  cliente: 'Clientes',
  local_operacao: 'Locais de operação',
  contrato: 'Contratos',
  comercial: 'Política comercial',
  equipamento: 'Equipamentos',
  catalogo: 'Catálogo de modelos',
  os: 'Ordens de serviço',
  plano_preventivo: 'Planos preventivos',
  tecnico: 'Técnicos',
  peca: 'Peças',
  estoque: 'Movimentação de estoque',
  inventario: 'Inventário',
  fornecedor: 'Fornecedores',
  ordem_compra: 'Ordens de compra',
  nota_fiscal: 'Notas fiscais de compra',
  medicao: 'Medição e consumo',
  fatura: 'Faturas',
  prefatura: 'Pré-faturas',
  competencia: 'Competências',
  faturamento: 'Exportação de faturamento',
  receber: 'Contas a receber',
  pagar: 'Contas a pagar',
  conciliacao: 'Conciliação bancária',
  centro_custo: 'Centros de custo',
  conta_bancaria: 'Contas bancárias',
  financeiro: 'Painéis financeiros',
  mapa: 'Mapa de distribuição',
  relatorio: 'Relatórios',
  usuario: 'Usuários',
  perfil: 'Perfis de acesso',
  alcada: 'Alçadas',
  parametro: 'Parâmetros',
  integracao: 'Integrações',
  apikey: 'Chaves de API',
  webhook: 'Webhooks',
  auditoria: 'Auditoria',
  dados_sensiveis: 'Dados sensíveis',
}

/**
 * Rótulo de cada ação.
 *
 * Sem entrada aqui, a ação aparece com o próprio identificador legibilizado —
 * feio, mas nunca invisível. Uma ação que sumisse da árvore por falta de
 * rótulo seria uma permissão impossível de conceder, e o defeito só apareceria
 * quando alguém precisasse dela.
 */
const ROTULO_ACAO: Record<string, string> = {
  ler: 'Visualizar',
  criar: 'Criar',
  editar: 'Editar',
  inativar: 'Inativar',
  gerenciar: 'Gerenciar',
  importar: 'Importar',
  exportar: 'Exportar',
  aprovar: 'Aprovar',
  cancelar: 'Cancelar',
  credito_definir: 'Definir crédito',
  ativar: 'Ativar',
  suspender: 'Suspender',
  retomar: 'Retomar',
  renovar: 'Renovar',
  encerrar: 'Encerrar',
  distratar: 'Distratar',
  item_alocar: 'Alocar item',
  item_substituir: 'Substituir item',
  item_encerrar: 'Encerrar item',
  desconto_conceder: 'Conceder desconto',
  reajuste_aprovar: 'Aprovar reajuste',
  anexo_gerenciar: 'Gerenciar anexos',
  patrimonial_editar: 'Editar dados patrimoniais',
  movimentar: 'Movimentar',
  transferir: 'Transferir',
  delegar_aprovacao: 'Delegar aprovação',
  transferencia_aceitar: 'Aceitar transferência',
  bloquear: 'Bloquear',
  desbloquear: 'Desbloquear',
  baixar: 'Baixar',
  leitura_registrar: 'Registrar leitura',
  leitura_estornar: 'Estornar leitura',
  etiqueta_gerar: 'Gerar etiqueta',
  triar: 'Triar',
  atribuir: 'Atribuir',
  agendar: 'Agendar',
  executar: 'Executar',
  concluir: 'Concluir',
  validar: 'Validar',
  reabrir: 'Reabrir',
  custo_aprovar: 'Aprovar custo',
  sla_pausar: 'Pausar SLA',
  reservar: 'Reservar',
  ajustar: 'Ajustar',
  politica_definir: 'Definir política',
  receber: 'Receber',
  conferir: 'Conferir',
  integrar: 'Integrar',
  consolidar: 'Consolidar',
  estimar: 'Estimar',
  gerar: 'Gerar',
  emitir: 'Emitir',
  nota_correcao: 'Emitir nota de correção',
  desconto_aplicar: 'Aplicar desconto',
  fechar: 'Fechar',
  negociar: 'Negociar',
  lancamento_manual: 'Lançar manualmente',
  painel_executivo: 'Ver painel executivo',
  rentabilidade_ler: 'Ver rentabilidade',
  filtro_compartilhar: 'Compartilhar filtro',
  definir: 'Definir',
  consultar: 'Consultar',
  ver_completo: 'Ver valor completo',
}

/** `nota_correcao` → `Nota correcao`. Último recurso, nunca vazio. */
function legibilizar(acao: string): string {
  const t = acao.replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function decompor(p: Permissao): { recurso: string; acao: string } {
  const i = p.indexOf(':')
  return { recurso: p.slice(0, i), acao: p.slice(i + 1) }
}

/**
 * A árvore, construída uma vez.
 *
 * Recurso sem módulo mapeado cai em `administracao` em vez de sumir. Sumir
 * seria o pior resultado possível: a permissão continuaria existindo e sendo
 * exigida pela API, mas ninguém conseguiria concedê-la pela interface, e o
 * sintoma seria "o botão não aparece para ninguém, nem para o administrador".
 */
export const ARVORE_PERMISSOES: NoModulo[] = (() => {
  const porModulo = new Map<string, Map<string, NoAcao[]>>()

  for (const permissao of PERMISSOES) {
    const { recurso, acao } = decompor(permissao)
    const modulo = MODULO_DO_RECURSO[recurso] ?? 'administracao'

    let telas = porModulo.get(modulo)
    if (!telas) {
      telas = new Map()
      porModulo.set(modulo, telas)
    }
    let acoes = telas.get(recurso)
    if (!acoes) {
      acoes = []
      telas.set(recurso, acoes)
    }
    // O catálogo tem `fornecedor:gerenciar` repetido em dois blocos de
    // comentário. Duplicata na árvore viraria duas caixas idênticas na mesma
    // tela — confuso, e a segunda desmarcaria a primeira.
    if (!acoes.some((a) => a.permissao === permissao)) {
      acoes.push({ permissao, rotulo: ROTULO_ACAO[acao] ?? legibilizar(acao) })
    }
  }

  return NOME_MODULO.filter((m) => porModulo.has(m.id)).map((m) => ({
    id: m.id,
    nome: m.nome,
    telas: [...porModulo.get(m.id)!.entries()]
      .map(([recurso, acoes]) => ({
        recurso,
        nome: NOME_RECURSO[recurso] ?? legibilizar(recurso),
        acoes,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  }))
})()

/**
 * Recursos do catálogo sem módulo declarado.
 *
 * Existe para o teste, e o teste existe porque a rede de segurança acima
 * (cair em `administracao`) é boa em produção e péssima como garantia: com ela,
 * nenhum recurso novo jamais "some", então nenhum teste de completude
 * falharia — e um recurso financeiro novo apareceria calado sob Administração,
 * onde ninguém procuraria. A rede continua; esta função é quem avisa.
 */
export function recursosSemModulo(): string[] {
  const vistos = new Set<string>()
  for (const p of PERMISSOES) {
    const { recurso } = decompor(p)
    if (!(recurso in MODULO_DO_RECURSO)) vistos.add(recurso)
  }
  return [...vistos].sort()
}

/** Recursos do catálogo sem nome de tela declarado. */
export function recursosSemNome(): string[] {
  const vistos = new Set<string>()
  for (const p of PERMISSOES) {
    const { recurso } = decompor(p)
    if (!(recurso in NOME_RECURSO)) vistos.add(recurso)
  }
  return [...vistos].sort()
}

/** Ações do catálogo sem rótulo declarado. */
export function acoesSemRotulo(): string[] {
  const vistos = new Set<string>()
  for (const p of PERMISSOES) {
    const { acao } = decompor(p)
    if (!(acao in ROTULO_ACAO)) vistos.add(acao)
  }
  return [...vistos].sort()
}

/** Todas as permissões de um módulo — o que marcar o nó do módulo concede. */
export function permissoesDoModulo(moduloId: string): Permissao[] {
  const m = ARVORE_PERMISSOES.find((x) => x.id === moduloId)
  return m ? m.telas.flatMap((t) => t.acoes.map((a) => a.permissao)) : []
}

/** Todas as permissões de uma tela — o que marcar o nó da tela concede. */
export function permissoesDaTela(moduloId: string, recurso: string): Permissao[] {
  const m = ARVORE_PERMISSOES.find((x) => x.id === moduloId)
  const t = m?.telas.find((x) => x.recurso === recurso)
  return t ? t.acoes.map((a) => a.permissao) : []
}

/**
 * Estado de um nó com filhos: marcado, vazio, ou parcial.
 *
 * O terceiro estado é o que impede a árvore de mentir. Sem ele, um módulo com
 * três de dez permissões concedidas apareceria desmarcado — e quem configura
 * concluiria que o perfil não tem acesso nenhum àquele módulo, quando tem.
 */
export type EstadoNo = 'marcado' | 'parcial' | 'vazio'

export function estadoDoNo(concedidas: readonly Permissao[], doNo: readonly Permissao[]): EstadoNo {
  if (doNo.length === 0) return 'vazio'
  const conjunto = new Set<string>(concedidas)
  const n = doNo.filter((p) => conjunto.has(p)).length
  if (n === 0) return 'vazio'
  return n === doNo.length ? 'marcado' : 'parcial'
}

/**
 * Aplica marcação em bloco, preservando o que está fora do nó.
 *
 * Devolve uma lista nova, ordenada e sem duplicata — é o que vai para
 * `perfil.permissoes`, e a ordem estável evita que salvar duas vezes sem mudar
 * nada produza um diff na auditoria.
 */
export function alternarNo(
  concedidas: readonly Permissao[],
  doNo: readonly Permissao[],
  marcar: boolean,
): Permissao[] {
  const conjunto = new Set<Permissao>(concedidas)
  for (const p of doNo) {
    if (marcar) conjunto.add(p)
    else conjunto.delete(p)
  }
  return [...conjunto].sort()
}
