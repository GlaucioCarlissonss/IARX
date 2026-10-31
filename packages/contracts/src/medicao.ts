import { z } from 'zod'
import { DataHora, Uuid } from './primitivos.js'
import { MedidorTipo } from './equipamento.js'

/**
 * Medição — o contador do equipamento, e o que se lê dele.
 *
 * É a base do faturamento por página: o que o cliente paga sai da diferença
 * entre duas leituras, não de uma tabela.
 *
 * ## RN-020: leitura não decresce
 *
 * Contador não anda para trás. Uma leitura menor que a anterior é sempre uma
 * de três coisas — digitação errada, medidor trocado, ou leitura de outro
 * equipamento — e nenhuma delas deve virar fatura. A regra é imposta por
 * gatilho no banco, porque depende do **histórico** e não da linha isolada:
 * validá-la na aplicação deixaria a importação em massa e qualquer correção
 * manual passarem por fora. Esta API não revalida; insere, e o banco recusa.
 *
 * ## Estorno em vez de correção
 *
 * Leitura errada não é editada: é **estornada**, e uma nova é registrada. A
 * fatura do mês passado já saiu com a leitura antiga, e um `update` apagaria a
 * única evidência de por que o valor mudou — exatamente a pergunta que alguém
 * faz quando o cliente contesta.
 *
 * ## Sobre o esboço que havia em `equipamento.ts`
 *
 * Existia ali um `RegistrarLeitura` marcado como "rota especificada e não
 * construída". Ao construir, ele divergia do banco em cinco pontos: `medido_em`
 * como `DataHora` contra uma coluna `timestamptz` chamada `data_leitura`; uma
 * lista de origens sem `CAMPO` nem `API` e com um `OS` que o `check` não
 * aceita; dois status onde há três; `valor` inteiro onde a coluna é
 * `numeric(14,2)`; e nenhum `medidor_id`, sem o qual não há como saber qual
 * contador da máquina foi lido.
 *
 * O esboço não foi corrigido no lugar — foi substituído por este, escrito
 * contra o esquema medido. Especificação que nunca encostou num banco envelhece
 * sem avisar, e a forma de descobrir é construí-la.
 */

export const StatusLeitura = z.enum(['VALIDA', 'REVISADA', 'ESTORNADA'])
export type StatusLeitura = z.infer<typeof StatusLeitura>

export const OrigemLeitura = z.enum(['MANUAL', 'CAMPO', 'IMPORTACAO', 'TELEMETRIA', 'API'])
export type OrigemLeitura = z.infer<typeof OrigemLeitura>

/**
 * Valor de contador.
 *
 * String decimal, como `Dinheiro` e pelo mesmo motivo: a coluna é
 * `numeric(14,2)` e `number` do JavaScript é ponto flutuante binário. Duas
 * casas porque horímetro mede fração de hora — 1.247,50 h é leitura comum, e
 * arredondar para hora inteira perderia meia hora por leitura.
 */
export const ValorContador = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'valor de contador deve ser decimal com até 2 casas')

export const Medidor = z.object({
  id: Uuid,
  equipamento_id: Uuid,
  tipo: MedidorTipo,
  unidade: z.string(),
  valor_inicial: ValorContador,
  /** Último valor válido conhecido. É contra ele que a próxima leitura é comparada. */
  valor_atual: ValorContador,
  /**
   * Total acumulado ao longo da vida do equipamento.
   *
   * Separado de `valor_atual` por causa da troca de medidor: o contador novo
   * começa do zero, e sem o acumulado o equipamento pareceria ter rodado menos
   * do que rodou — justamente no relatório de vida útil, que é onde a
   * informação serve para alguma coisa.
   */
  acumulado_total: ValorContador,
  ativo: z.boolean(),
})
export type Medidor = z.infer<typeof Medidor>

export const Leitura = z.object({
  id: Uuid,
  medidor_id: Uuid,
  equipamento_id: Uuid,
  /** Quando foi lido — `timestamptz`, não data: telemetria lê com hora. */
  data_leitura: DataHora,
  valor: ValorContador,
  origem: OrigemLeitura,
  status: StatusLeitura,
  contrato_item_id: Uuid.nullable(),
  registrado_por: Uuid.nullable(),
  motivo_estorno: z.string().nullable(),
  created_at: DataHora,
})
export type Leitura = z.infer<typeof Leitura>

export const RegistrarLeituraMedidor = z.object({
  /**
   * Qual contador da máquina. Obrigatório, e sem padrão.
   *
   * Um equipamento pode ter mais de um medidor — mono e color na mesma
   * impressora. Escolher "o primeiro" por omissão faria a leitura de cor cair
   * no contador de preto e branco sem nenhum erro, e a fatura sairia com o
   * número trocado.
   */
  medidor_id: Uuid,
  valor: ValorContador,
  data_leitura: DataHora,
  origem: OrigemLeitura.default('MANUAL'),
  contrato_item_id: Uuid.nullish(),
})
export type RegistrarLeituraMedidor = z.infer<typeof RegistrarLeituraMedidor>

export const EstornarLeitura = z.object({
  /**
   * Obrigatório, e com piso de tamanho — o `check` do banco também exige.
   *
   * Estorno sem motivo é a linha que ninguém consegue julgar seis meses
   * depois, e estorno é exatamente o evento que alguém vai auditar.
   */
  motivo: z.string().trim().min(10, 'descreva o motivo do estorno'),
})
export type EstornarLeitura = z.infer<typeof EstornarLeitura>

export const ListarLeituras = z.object({
  medidor_id: Uuid.optional(),
  /** Inclui estornadas e revisadas. Por omissão só as válidas. */
  incluir_invalidas: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type ListarLeituras = z.infer<typeof ListarLeituras>
