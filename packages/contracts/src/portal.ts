import { z } from 'zod'
import { Competencia, Data, DataHora, Dinheiro, Paginacao, Uuid } from './primitivos.js'
import { ContratoStatus } from './contrato.js'
import { EquipamentoStatus } from './equipamento.js'

/**
 * Portal do cliente — Módulo 5 do [Anexo L](L-lacunas-funcionais.md).
 *
 * **Somente leitura**, e o prefixo `/portal` é deliberado: torna trivial
 * auditar que nenhuma rota de cliente alcança dado do locador. Duas
 * consequências guiam este arquivo inteiro.
 *
 * **Primeira: o que não está aqui.** Nenhum esquema de saída tem margem, custo
 * de manutenção ou valor de aquisição. O critério de aceite é literal — "nenhuma
 * rota `/portal` devolve" — e a forma de garanti-lo é o campo não existir, não o
 * serviço lembrar de removê-lo. `Equipamento` do catálogo geral tem
 * `valor_aquisicao`; por isso o portal tem o seu próprio `EquipamentoDoCliente`,
 * em vez de reusar aquele com um `omit`, que a próxima adição de campo
 * desfaria em silêncio.
 *
 * **Segunda: competência aberta é declarada parcial** (RN-L33). O número parcial
 * não é errado; o que seria errado é apresentá-lo como fechado, e o cliente
 * planejar caixa sobre uma medição que ainda vai crescer.
 *
 * As permissões são as que a lista branca da 0011 já autoriza a perfil de
 * cliente — `contrato:ler`, `equipamento:ler`, `fatura:ler`, `medicao:ler`.
 * Nenhuma nova: um perfil de cliente não pode conter permissão fora daquela
 * lista, por gatilho, e uma rota de portal que exigisse outra seria uma rota que
 * nenhum cliente pode chamar.
 */

/* ------------------------------------------------------------------ resumo */

export const ResumoPortal = z.object({
  cliente: z.object({ id: Uuid, razao_social: z.string(), nome_fantasia: z.string().nullable() }),
  /** Quantos CNPJ o usuário alcança: 1, ou os do grupo econômico. */
  clientes_no_escopo: z.number().int(),
  /**
   * Quantas unidades o usuário alcança.
   *
   * Para o gestor de unidade é o número de vínculos; para o administrador do
   * cliente, todas as do grupo. É o campo que torna o recorte **visível** a quem
   * usa o portal, em vez de silencioso — quem vê uma unidade precisa saber que
   * vê uma.
   */
  unidades_no_escopo: z.number().int(),
  contratos: z.object({
    ativos: z.number().int(),
    proximo_vencimento: Data.nullable(),
  }),
  parque: z.object({
    total: z.number().int(),
    por_status: z.record(z.number().int()),
  }),
  consumo_em_aberto: z.object({
    competencia: Competencia.nullable(),
    /** Nula quando não há leitura na competência: não há "última" a declarar. */
    ultima_leitura_em: DataHora.nullable(),
    /** Sempre `true` enquanto a competência não fecha (RN-L33). */
    parcial: z.boolean(),
    paginas: z.number(),
    excedente: Dinheiro,
  }),
  cobranca_em_aberto: z.object({ total: Dinheiro, vencido: Dinheiro }),
})
export type ResumoPortal = z.infer<typeof ResumoPortal>

/* --------------------------------------------------------------- contratos */

export const ContratoDoCliente = z.object({
  id: Uuid,
  numero: z.string(),
  status: ContratoStatus,
  data_inicio: Data.nullable(),
  data_fim: Data.nullable(),
  renovacao_automatica: z.boolean(),
  /** O que o cliente paga. **Não** é o custo do locador nem a margem. */
  valor_mensal_estimado: Dinheiro.nullable(),
  itens: z.number().int(),
})
export type ContratoDoCliente = z.infer<typeof ContratoDoCliente>

export const ListarContratosDoCliente = Paginacao.extend({
  status: ContratoStatus.optional(),
  local_id: Uuid.optional(),
})
export type ListarContratosDoCliente = z.infer<typeof ListarContratosDoCliente>

export const ItemDoContrato = z.object({
  id: Uuid,
  equipamento_id: Uuid.nullable(),
  patrimonio: z.string().nullable(),
  modelo: z.string().nullable(),
  local_operacao_id: Uuid.nullable(),
  local_nome: z.string().nullable(),
  modalidade_cobranca: z.string(),
  valor_unitario: Dinheiro,
  quantidade: z.number(),
  franquia_quantidade: z.number().nullable(),
  valor_excedente_unitario: Dinheiro.nullable(),
})
export type ItemDoContrato = z.infer<typeof ItemDoContrato>

export const ContratoDetalhado = ContratoDoCliente.extend({
  itens_detalhados: z.array(ItemDoContrato),
})
export type ContratoDetalhado = z.infer<typeof ContratoDetalhado>

/* ------------------------------------------------------------- parque */

/**
 * O ativo como o cliente o vê.
 *
 * Sem `valor_aquisicao`, sem depreciação, sem custo de manutenção, sem
 * `filial_id` — a filial é dimensão do locador. O que sobra é o que responde
 * "que máquina é essa e onde ela está".
 */
export const EquipamentoDoCliente = z.object({
  id: Uuid,
  patrimonio: z.string(),
  numero_serie: z.string().nullable(),
  modelo: z.string().nullable(),
  fabricante: z.string().nullable(),
  status: EquipamentoStatus,
  local_operacao_id: Uuid.nullable(),
  local_nome: z.string().nullable(),
})
export type EquipamentoDoCliente = z.infer<typeof EquipamentoDoCliente>

export const ListarEquipamentosDoCliente = Paginacao.extend({
  local_id: Uuid.optional(),
  modelo_id: Uuid.optional(),
})
export type ListarEquipamentosDoCliente = z.infer<typeof ListarEquipamentosDoCliente>

/* -------------------------------------------------------------- consumo */

export const ConsumoDoCliente = z.object({
  competencia: Competencia,
  equipamento_id: Uuid,
  patrimonio: z.string().nullable(),
  local_operacao_id: Uuid.nullable(),
  local_nome: z.string().nullable(),
  paginas_mono: z.number(),
  paginas_color: z.number(),
  franquia_mono: z.number().int().nullable(),
  franquia_color: z.number().int().nullable(),
  excedente_mono: z.number(),
  excedente_color: z.number(),
  valor_excedente: Dinheiro,
  /**
   * RN-L33 — a competência aberta vem marcada, com a data da última leitura.
   *
   * `parcial` é derivado de `fechado_em is null`, e não uma coluna própria: duas
   * verdades sobre o mesmo fato divergem, e a pergunta "qual vale" não tem
   * resposta boa.
   */
  parcial: z.boolean(),
  ultima_leitura_em: DataHora.nullable(),
})
export type ConsumoDoCliente = z.infer<typeof ConsumoDoCliente>

export const ListarConsumo = Paginacao.extend({
  competencia: Competencia.optional(),
  local_id: Uuid.optional(),
  equipamento_id: Uuid.optional(),
})
export type ListarConsumo = z.infer<typeof ListarConsumo>

/* --------------------------------------------------------------- custos */

/**
 * O histórico de custo por competência, como o cliente o confere.
 *
 * `locacao` mais `excedente` é `total`, e o total tem de ser **idêntico ao da
 * cobrança emitida** na competência fechada — é critério de aceite. Por isso ele
 * sai de `titulo_receber`, e não de uma soma paralela: uma segunda aritmética
 * daria dois números defensáveis para a mesma competência.
 */
export const CustoDaCompetencia = z.object({
  competencia: Competencia,
  locacao: Dinheiro,
  excedente: Dinheiro,
  total: Dinheiro,
  /** Nulo enquanto a competência não gerou cobrança — a aberta, tipicamente. */
  cobranca_id: Uuid.nullable(),
  vencimento: Data.nullable(),
  parcial: z.boolean(),
})
export type CustoDaCompetencia = z.infer<typeof CustoDaCompetencia>

export const ListarCustos = z.object({
  competencia_de: Competencia.optional(),
  competencia_ate: Competencia.optional(),
})
export type ListarCustos = z.infer<typeof ListarCustos>

/**
 * A memória de cálculo de uma competência, **sem os custos do locador**.
 *
 * O Anexo L é explícito: "a mesma da fatura, sem os custos do locador". Aqui
 * isso não é um filtro no serviço — é o esquema não ter onde pôr um custo.
 */
export const MemoriaDaCompetencia = z.object({
  competencia: Competencia,
  parcial: z.boolean(),
  itens: z.array(ConsumoDoCliente),
  locacao: Dinheiro,
  excedente: Dinheiro,
  total: Dinheiro,
})
export type MemoriaDaCompetencia = z.infer<typeof MemoriaDaCompetencia>
