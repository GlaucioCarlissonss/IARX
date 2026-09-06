import { z } from 'zod'
import { Dinheiro, Paginacao, Uuid } from './primitivos.js'

/**
 * Controle de despesas — categoria, orçamento e execução.
 *
 * Camada analítica sobre contas a pagar. **Não existe aqui nenhuma forma de
 * lançar despesa**: o módulo lê `titulo_pagar` e compara contra um orçamento.
 * Se este contrato tivesse um `POST /despesas`, seria uma segunda porta para o
 * mesmo fato, e as duas telas passariam a mostrar totais diferentes.
 *
 * O que o contrato **não** tem, e a ausência é a informação:
 *
 *  · nenhum campo de "gasto" ou "percentual de execução" gravável. Execução é
 *    calculada por `app.execucao_orcamentaria` a cada consulta — um título
 *    cancelado precisa mudar o número imediatamente, e um campo só mudaria
 *    quando algum job passasse;
 *  · nenhuma alçada de replanejamento. Não existe `alcada.tipo` de orçamento,
 *    nem faixas, nem definição de passo único ou fila (Anexo V). `aprovado_por`
 *    volta sempre nulo, e o nulo diz exatamente isso.
 */

export const CLASSIFICACAO_DESPESA = ['DESPESA_FIXA', 'DESPESA_VARIAVEL', 'INVESTIMENTO'] as const
export const ClassificacaoDespesa = z.enum(CLASSIFICACAO_DESPESA)
export type ClassificacaoDespesa = z.infer<typeof ClassificacaoDespesa>

/* --------------------------------------------------- categoria de despesa */

export const CategoriaDespesa = z.object({
  id: Uuid,
  nome: z.string(),
  categoria_pai_id: Uuid.nullable(),
  /** Pré-preenche a classificação do título; quem lança pode discordar. */
  classificacao_sugerida: ClassificacaoDespesa.nullable(),
  ativo: z.boolean(),
  /**
   * A categoria "Não categorizado" do locatário.
   *
   * Marcada por campo e não pelo nome: o nome é editável, e comparar por ele
   * deixaria o gatilho de preenchimento sem destino no dia de uma renomeação.
   */
  residual: z.boolean(),
  /** 1 ou 2 — a árvore para aí, por decisão do Anexo L. */
  nivel: z.number().int().min(1).max(2),
  version: z.number().int().positive(),
})
export type CategoriaDespesa = z.infer<typeof CategoriaDespesa>

export const ListarCategoriasDespesa = Paginacao.extend({
  apenas_ativas: z.coerce.boolean().optional(),
})
export type ListarCategoriasDespesa = z.infer<typeof ListarCategoriasDespesa>

export const CriarCategoriaDespesa = z.object({
  nome: z.string().trim().min(1).max(120),
  categoria_pai_id: Uuid.nullish(),
  classificacao_sugerida: ClassificacaoDespesa.nullish(),
})
export type CriarCategoriaDespesa = z.infer<typeof CriarCategoriaDespesa>

/**
 * Editar não aceita `categoria_pai_id` nem `residual`.
 *
 * O pai fica fora pela mesma razão do centro de custo: mover um nó move a
 * subárvore, e o gatilho recusaria depois do clique em salvar. `residual` fica
 * fora porque é estrutura — promover outra categoria a residual sem rebaixar a
 * atual quebraria o índice único, e rebaixar a atual deixaria o gatilho de
 * `titulo_pagar` sem destino entre uma coisa e outra.
 */
export const EditarCategoriaDespesa = z
  .object({
    nome: z.string().trim().min(1).max(120),
    classificacao_sugerida: ClassificacaoDespesa.nullable(),
    ativo: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'informe ao menos um campo' })
export type EditarCategoriaDespesa = z.infer<typeof EditarCategoriaDespesa>

/* ------------------------------------------------------------- orçamento */

export const Ano = z.coerce.number().int().min(2000).max(2100)
export const Mes = z.coerce.number().int().min(1).max(12)

export const Orcamento = z.object({
  id: Uuid,
  ano: z.number().int(),
  /** Nulo = orçamento anual, sem quebra mensal. Ausência deliberada de recorte. */
  mes: z.number().int().nullable(),
  categoria_id: Uuid.nullable(),
  categoria_nome: z.string().nullable(),
  centro_custo_id: Uuid.nullable(),
  filial_id: Uuid.nullable(),
  valor_orcado: Dinheiro,
  version: z.number().int().positive(),
})
export type Orcamento = z.infer<typeof Orcamento>

export const ListarOrcamentos = Paginacao.extend({
  ano: Ano.optional(),
  mes: Mes.optional(),
  categoria_id: Uuid.optional(),
  centro_custo_id: Uuid.optional(),
})
export type ListarOrcamentos = z.infer<typeof ListarOrcamentos>

export const CriarOrcamento = z.object({
  ano: Ano,
  mes: Mes.nullish(),
  categoria_id: Uuid.nullish(),
  centro_custo_id: Uuid.nullish(),
  filial_id: Uuid.nullish(),
  valor_orcado: Dinheiro,
})
export type CriarOrcamento = z.infer<typeof CriarOrcamento>

/**
 * Editar muda o valor, nunca a dimensão.
 *
 * Trocar ano, mês, categoria ou centro não é editar o orçamento — é outro
 * orçamento. Permitir isso faria a execução já apurada trocar de dono, e o
 * histórico de replanejamento apontaria para uma linha que mudou de significado
 * depois de ter movido valor.
 */
export const EditarOrcamento = z.object({
  valor_orcado: Dinheiro,
})
export type EditarOrcamento = z.infer<typeof EditarOrcamento>

/**
 * Cópia do ano anterior — **ação explícita**, nunca herança automática.
 *
 * O Anexo L é literal nisso, e a razão é boa: um orçamento que se propaga
 * sozinho vira número que ninguém decidiu, e no ano seguinte já não há quem
 * lembre de onde ele veio. `fator` permite o reajuste linear que quase sempre
 * acompanha a cópia, e o padrão é 1 — copiar é copiar.
 */
export const CopiarOrcamento = z.object({
  de_ano: Ano,
  para_ano: Ano,
  fator: z.number().min(0).max(10).default(1),
})
export type CopiarOrcamento = z.infer<typeof CopiarOrcamento>

export const ResultadoCopia = z.object({
  criados: z.number().int(),
  /** Já existiam no destino e foram preservados: copiar não sobrescreve. */
  ignorados: z.number().int(),
})
export type ResultadoCopia = z.infer<typeof ResultadoCopia>

/* -------------------------------------------------------- replanejamento */

export const CriarReplanejamento = z.object({
  orcamento_origem_id: Uuid,
  orcamento_destino_id: Uuid,
  valor_transferido: Dinheiro,
  /** Obrigatório: o diff dos dois orçamentos mostra o quê, nunca o porquê. */
  motivo: z.string().trim().min(3).max(500),
})
export type CriarReplanejamento = z.infer<typeof CriarReplanejamento>

export const Replanejamento = z.object({
  id: Uuid,
  orcamento_origem_id: Uuid,
  orcamento_destino_id: Uuid,
  valor_transferido: Dinheiro,
  motivo: z.string(),
  criado_por: Uuid.nullable(),
  /** Sempre nulo hoje: não há alçada de orçamento definida (Anexo V). */
  aprovado_por: Uuid.nullable(),
})
export type Replanejamento = z.infer<typeof Replanejamento>

/* ------------------------------------------------ execução e indicadores */

export const LIMIAR_EXECUCAO = ['NORMAL', 'ATENCAO', 'CRITICO', 'ESTOURADO', 'SEM_ORCAMENTO'] as const
export const LimiarExecucao = z.enum(LIMIAR_EXECUCAO)
export type LimiarExecucao = z.infer<typeof LimiarExecucao>

export const LinhaExecucao = z.object({
  orcamento_id: Uuid,
  ano: z.number().int(),
  mes: z.number().int().nullable(),
  categoria_id: Uuid.nullable(),
  categoria_nome: z.string().nullable(),
  centro_custo_id: Uuid.nullable(),
  filial_id: Uuid.nullable(),
  valor_orcado: Dinheiro,
  realizado: Dinheiro,
  /** D-25: o gasto e o aprovado-não-pago. É o que limita o replanejamento. */
  comprometido: Dinheiro,
  /** Nulo quando o orçado é zero — dividir por zero não é 0%, é indefinido. */
  percentual: z.number().nullable(),
  limiar: LimiarExecucao,
})
export type LinhaExecucao = z.infer<typeof LinhaExecucao>

export const ConsultarIndicadores = z.object({
  ano: Ano,
  mes: Mes.optional(),
  centro_custo_id: Uuid.optional(),
  filial_id: Uuid.optional(),
})
export type ConsultarIndicadores = z.infer<typeof ConsultarIndicadores>

/**
 * Os indicadores do Módulo 14. Todos calculados, nenhum armazenado.
 *
 * `custo_por_cliente_ativo` e `custo_por_equipamento_locado` são a resolução de
 * **D-26**. O pedido original falava em "custo de TI por paciente", que não se
 * aplica a uma locadora; o Anexo L listou dois análogos e não escolheu. Os dois
 * vão lado a lado: escolher um obrigaria a decidir sem base, e o denominador é a
 * única diferença entre eles.
 */
export const IndicadoresDespesa = z.object({
  periodo: z.object({ ano: z.number().int(), mes: z.number().int().nullable() }),
  despesa_total: Dinheiro,
  despesa_mes_anterior: Dinheiro,
  /** Nulo quando o mês anterior não teve despesa — variação sobre zero é indefinida. */
  variacao_mes_anterior: z.number().nullable(),
  total_orcado: Dinheiro,
  /** Nulo quando não há orçamento no período. */
  execucao_percentual: z.number().nullable(),
  proporcao_investimento: z.number(),
  indice_recorrente: z.number(),
  clientes_ativos: z.number().int(),
  equipamentos_locados: z.number().int(),
  custo_por_cliente_ativo: Dinheiro.nullable(),
  custo_por_equipamento_locado: Dinheiro.nullable(),
  execucao: z.array(LinhaExecucao),
})
export type IndicadoresDespesa = z.infer<typeof IndicadoresDespesa>
