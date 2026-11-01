import { z } from 'zod'
import { Dinheiro, Uuid } from './primitivos.js'

/**
 * Resultado operacional — receita contra custo, por competência e por cliente.
 *
 * ## O que entra como custo, e por que isso é uma decisão
 *
 * Entra o que a operação gasta para manter o parque rodando: mão de obra e
 * material das ordens de serviço validadas, mais o material baixado do estoque
 * naquela competência.
 *
 * **Não** entra depreciação. Ela existe, é relevante para o resultado contábil,
 * e é exatamente por isso que fica de fora daqui: depreciação depende de
 * critério e de vida útil por categoria, e misturá-la com custo medido
 * produziria um número que ninguém consegue reconciliar com nota fiscal nenhuma.
 * O que esta rota responde é **custo que aconteceu**, não resultado contábil —
 * e a diferença precisa estar escrita, senão alguém vai usar um no lugar do
 * outro numa reunião de conselho.
 *
 * ## Só OS validada
 *
 * Custo de OS concluída e ainda não validada não entra. A validação é o ponto
 * em que outra pessoa conferiu o apontamento (RN-027); contar antes faria o
 * resultado oscilar com apontamento que ainda pode ser corrigido, e o mês
 * fecharia diferente a cada releitura.
 */

export const LinhaResultado = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/),
  receita: Dinheiro,
  custo_mao_obra: Dinheiro,
  custo_material: Dinheiro,
  custo_total: Dinheiro,
  /** Receita menos custo. Negativo é informação, não erro. */
  margem: Dinheiro,
})
export type LinhaResultado = z.infer<typeof LinhaResultado>

export const ResultadoPorCliente = z.object({
  cliente_id: Uuid,
  cliente_nome: z.string(),
  receita: Dinheiro,
  custo_total: Dinheiro,
  margem: Dinheiro,
})
export type ResultadoPorCliente = z.infer<typeof ResultadoPorCliente>

export const Resultado = z.object({
  serie: z.array(LinhaResultado),
  por_cliente: z.array(ResultadoPorCliente),
})
export type Resultado = z.infer<typeof Resultado>

export const ConsultarResultado = z.object({
  /** Quantas competências para trás. Doze por omissão — o ciclo que se compara. */
  meses: z.coerce.number().int().min(1).max(36).default(12),
})
export type ConsultarResultado = z.infer<typeof ConsultarResultado>
