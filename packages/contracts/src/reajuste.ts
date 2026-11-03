import { z } from 'zod'
import { Data, DataHora, Dinheiro, Paginacao, Uuid } from './primitivos.js'

/**
 * Reajuste contratual — RN-008.
 *
 * Três atos separados por desenho: propor, aprovar, aplicar. O anexo diz "a
 * aplicação exige aprovação com alçada", e isso só significa alguma coisa se
 * propor e aplicar não forem a mesma chamada.
 *
 * O quarto estado, `RENUNCIADO`, é o que sustenta o KPI-34 — receita renunciada
 * por reajuste não aplicado. Ele existe porque a alternativa, apagar a
 * proposta, faria o indicador medir zero por construção: o que não foi cobrado
 * desapareceria junto com o registro de que se decidiu não cobrar.
 */
export const REAJUSTE_STATUS = ['PROPOSTO', 'APROVADO', 'APLICADO', 'RENUNCIADO'] as const
export const ReajusteStatus = z.enum(REAJUSTE_STATUS)
export type ReajusteStatus = z.infer<typeof ReajusteStatus>

export const Reajuste = z.object({
  id: Uuid,
  contrato_id: Uuid,
  contrato_numero: z.string().nullable(),
  competencia: z.string(),
  indice: z.string(),
  percentual_indice: z.string(),
  percentual_aplicado: z.string(),
  valor_anterior: Dinheiro,
  valor_novo: Dinheiro,
  status: ReajusteStatus,
  proposto_em: DataHora,
  aprovado_por: Uuid.nullable(),
  aprovado_em: DataHora.nullable(),
  aplicado_em: DataHora.nullable(),
  motivo_renuncia: z.string().nullable(),
  version: z.number().int(),
})

export type Reajuste = z.infer<typeof Reajuste>

/**
 * Proposta de reajuste.
 *
 * Sem `valor_anterior` e `valor_novo`: os dois são derivados no banco a partir
 * dos itens vigentes, com a regra de arredondamento de RN-008. Aceitá-los no
 * corpo permitiria propor um reajuste cujo valor não é o que será cobrado — e
 * a proposta existe justamente para que alguém aprove **o valor**.
 *
 * `percentual_aplicado` separado de `percentual_indice` porque reajuste
 * negociado é normal. Guardar os dois é o que distingue o que se deixou de
 * cobrar por negociação do que se deixou por esquecimento.
 */
export const ProporReajuste = z.object({
  competencia: Data.describe('primeiro dia da competência de aniversário'),
  indice: z.string().trim().min(2).max(20),
  percentual_indice: z
    .string()
    .regex(/^-?\d+(\.\d{1,4})?$/, 'percentual com até 4 casas'),
  percentual_aplicado: z
    .string()
    .regex(/^-?\d+(\.\d{1,4})?$/, 'percentual com até 4 casas')
    .optional()
    .describe('quando omitido, aplica o percentual do índice'),
})

export type ProporReajuste = z.infer<typeof ProporReajuste>

export const RenunciarReajuste = z.object({
  motivo: z.string().trim().min(10, 'descreva por que o reajuste não será cobrado'),
})

export type RenunciarReajuste = z.infer<typeof RenunciarReajuste>

export const ListarReajustes = Paginacao.extend({
  status: ReajusteStatus.optional(),
  contrato_id: Uuid.optional(),
})

export type ListarReajustes = z.infer<typeof ListarReajustes>

/**
 * Substituição de ativo em item de contrato.
 *
 * Não é "editar o equipamento do item": a substituição encerra o item atual e
 * cria um sucessor vinculado a ele. A diferença aparece no fechamento — o item
 * antigo guarda o que foi cobrado pela máquina antiga, e o histórico de qual
 * máquina esteve no cliente em cada período continua reconstruível.
 */
export const SubstituirItem = z.object({
  equipamento_id: Uuid,
  motivo: z.string().trim().min(10, 'descreva o motivo da substituição'),
  efetivado_em: DataHora.optional().describe('quando omitido, agora'),
})

export type SubstituirItem = z.infer<typeof SubstituirItem>
