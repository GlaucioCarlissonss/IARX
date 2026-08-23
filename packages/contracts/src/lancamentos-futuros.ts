import { z } from 'zod'
import { Data, DataHora, Dinheiro, Paginacao, Uuid } from './primitivos.js'

/**
 * Lançamentos futuros e recorrências — Módulo 12.
 *
 * A camada de **intenção**: um compromisso programado que ainda não é título.
 *
 * Ela existe separada porque um título já criado carrega rodada de aprovação e
 * rateio, e reabri-los a cada ajuste de planejamento faria a aprovação ser
 * refeita meses antes de o compromisso existir. O lançamento futuro se edita à
 * vontade; o título, não.
 *
 * **`recorrencia` é uma forma só, com discriminador `lado`.** O levantamento
 * especifica `recorrencia_pagar` e `recorrencia_receber`; duas formas paralelas
 * para o mesmo conceito dariam duas respostas para "o que está programado", e a
 * divergência apareceria como uma projeção que não fecha. É o raciocínio de D-20
 * um nível acima.
 */

export const LADO = ['PAGAR', 'RECEBER'] as const
export const Lado = z.enum(LADO)
export type Lado = z.infer<typeof Lado>

export const PERIODICIDADE = ['MENSAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'] as const
export const Periodicidade = z.enum(PERIODICIDADE)
export type Periodicidade = z.infer<typeof Periodicidade>

export const TIPO_LANCAMENTO = [
  'DESPESA_RECORRENTE',
  'RECEITA_RECORRENTE',
  'DESPESA_PARCELADA',
  'RECEITA_PARCELADA',
  /** Planejamento, não partida dobrada: não há contrapartida contábil. */
  'PROVISAO',
] as const
export const TipoLancamento = z.enum(TIPO_LANCAMENTO)
export type TipoLancamento = z.infer<typeof TipoLancamento>

export const STATUS_LANCAMENTO = ['PROGRAMADO', 'CONVERTIDO', 'CANCELADO'] as const
export const StatusLancamento = z.enum(STATUS_LANCAMENTO)
export type StatusLancamento = z.infer<typeof StatusLancamento>

export const CLASSIFICACAO_LANCAMENTO = ['DESPESA_FIXA', 'DESPESA_VARIAVEL', 'INVESTIMENTO'] as const
export const ClassificacaoLancamento = z.enum(CLASSIFICACAO_LANCAMENTO)
export type ClassificacaoLancamento = z.infer<typeof ClassificacaoLancamento>

const DinheiroPositivo = Dinheiro.refine((v) => Number(v) > 0, 'o valor tem de ser positivo')

/**
 * `lado` é consequência de `tipo`, não uma segunda escolha do cliente.
 *
 * A entrada manda o tipo e o servidor deriva o lado — pedir os dois permitiria
 * uma provisão marcada como RECEBER, que geraria cobrança onde deveria haver
 * despesa. O banco tem o mesmo CHECK; aqui a recusa só chega mais cedo.
 */
export const ladoDoTipo = (tipo: TipoLancamento): Lado =>
  tipo === 'RECEITA_RECORRENTE' || tipo === 'RECEITA_PARCELADA' ? 'RECEBER' : 'PAGAR'

export const LancamentoFuturo = z.object({
  id: Uuid,
  tipo: TipoLancamento,
  lado: Lado,
  descricao: z.string(),
  valor_previsto: Dinheiro,
  data_prevista: Data,
  empresa_id: Uuid.nullable(),
  fornecedor_id: Uuid.nullable(),
  fornecedor_nome: z.string().nullable(),
  classificacao: ClassificacaoLancamento.nullable(),
  cliente_id: Uuid.nullable(),
  cliente_nome: z.string().nullable(),
  centro_custo_id: Uuid.nullable(),
  centro_custo_nome: z.string().nullable(),
  contrato_id: Uuid.nullable(),
  contrato_numero: z.string().nullable(),
  filial_id: Uuid.nullable(),
  recorrencia_id: Uuid.nullable(),
  recorrencia_descricao: z.string().nullable(),
  status: StatusLancamento,
  /** Exatamente um dos dois quando CONVERTIDO; nenhum antes. */
  titulo_pagar_id: Uuid.nullable(),
  titulo_receber_id: Uuid.nullable(),
  convertido_em: DataHora.nullable(),
  /** RN-F16: por que a conversão foi recusada. Preenchido = está na fila de exceção. */
  excecao_conversao: z.string().nullable(),
  tentativas_conversao: z.number().int().min(0),
  version: z.number().int().positive(),
})
export type LancamentoFuturo = z.infer<typeof LancamentoFuturo>

export const Recorrencia = z.object({
  id: Uuid,
  lado: Lado,
  descricao: z.string(),
  valor_base: Dinheiro,
  periodicidade: Periodicidade,
  dia_vencimento: z.number().int().min(1).max(28),
  proxima_geracao: Data,
  ativo: z.boolean(),
  empresa_id: Uuid.nullable(),
  fornecedor_id: Uuid.nullable(),
  fornecedor_nome: z.string().nullable(),
  classificacao: ClassificacaoLancamento.nullable(),
  cliente_id: Uuid.nullable(),
  cliente_nome: z.string().nullable(),
  centro_custo_id: Uuid.nullable(),
  contrato_id: Uuid.nullable(),
  contrato_numero: z.string().nullable(),
  filial_id: Uuid.nullable(),
  /** Quantos lançamentos a série já produziu. Leitura, nunca entrada. */
  lancamentos_gerados: z.number().int().min(0),
  version: z.number().int().positive(),
})
export type Recorrencia = z.infer<typeof Recorrencia>

export const ListarLancamentosFuturos = Paginacao.extend({
  status: StatusLancamento.optional(),
  lado: Lado.optional(),
  tipo: TipoLancamento.optional(),
  contrato_id: Uuid.optional(),
  recorrencia_id: Uuid.optional(),
  filial_id: Uuid.optional(),
  centro_custo_id: Uuid.optional(),
  previsto_de: Data.optional(),
  previsto_ate: Data.optional(),
  /**
   * A fila de exceção: programado, vencido e com motivo escrito.
   *
   * Filtro e não status, pela mesma razão de `em_atraso` no Módulo 11: o
   * lançamento sai da fila quando o contrato volta a vigorar, e um status
   * gravado ficaria errado no instante seguinte à reativação.
   */
  com_excecao: z.coerce.boolean().optional(),
  /** Já elegível à conversão: programado e com a data prevista alcançada. */
  elegivel: z.coerce.boolean().optional(),
})
export type ListarLancamentosFuturos = z.infer<typeof ListarLancamentosFuturos>

/**
 * Criar um lançamento futuro.
 *
 * `empresa_id` e `classificacao` só valem no lado a pagar, `cliente_id` só no
 * lado a receber; o refinamento devolve a recusa aqui em vez de deixá-la chegar
 * como violação de CHECK com mensagem de banco.
 */
export const CriarLancamentoFuturo = z
  .object({
    tipo: TipoLancamento,
    descricao: z.string().trim().min(3).max(200),
    valor_previsto: DinheiroPositivo,
    data_prevista: Data,
    empresa_id: Uuid.nullish(),
    fornecedor_id: Uuid.nullish(),
    classificacao: ClassificacaoLancamento.nullish(),
    cliente_id: Uuid.nullish(),
    centro_custo_id: Uuid.nullish(),
    contrato_id: Uuid.nullish(),
    filial_id: Uuid.nullish(),
  })
  .refine((d) => ladoDoTipo(d.tipo) !== 'PAGAR' || (!!d.empresa_id && !!d.classificacao), {
    message: 'o lado a pagar exige empresa e classificação',
    path: ['empresa_id'],
  })
  .refine((d) => ladoDoTipo(d.tipo) !== 'PAGAR' || !d.cliente_id, {
    message: 'um compromisso a pagar não tem cliente',
    path: ['cliente_id'],
  })
  .refine((d) => ladoDoTipo(d.tipo) !== 'RECEBER' || !!d.cliente_id, {
    message: 'o lado a receber exige cliente',
    path: ['cliente_id'],
  })
  .refine((d) => ladoDoTipo(d.tipo) !== 'RECEBER' || (!d.empresa_id && !d.classificacao), {
    message: 'uma receita prevista não tem empresa nem classificação de despesa',
    path: ['empresa_id'],
  })
export type CriarLancamentoFuturo = z.infer<typeof CriarLancamentoFuturo>

/**
 * Editar — RN-F17, só em PROGRAMADO.
 *
 * `tipo` não está aqui de propósito: mudá-lo mudaria o lado, e um lançamento que
 * troca de lado é um compromisso diferente. Cancele e crie outro.
 */
export const EditarLancamentoFuturo = z.object({
  descricao: z.string().trim().min(3).max(200).optional(),
  valor_previsto: DinheiroPositivo.optional(),
  data_prevista: Data.optional(),
  fornecedor_id: Uuid.nullish(),
  centro_custo_id: Uuid.nullish(),
  contrato_id: Uuid.nullish(),
  filial_id: Uuid.nullish(),
})
export type EditarLancamentoFuturo = z.infer<typeof EditarLancamentoFuturo>

export const CancelarLancamentoFuturo = z.object({
  motivo: z.string().trim().min(5).max(500),
})
export type CancelarLancamentoFuturo = z.infer<typeof CancelarLancamentoFuturo>

/**
 * O resultado de uma conversão.
 *
 * `titulo_id` nulo com `excecao` preenchida **não é erro**: é RN-F16 recusando
 * gerar título de contrato fora de vigência, e o lançamento continua programado
 * na fila de exceção. Devolver 4xx aqui faria a tela tratar como falha o que é o
 * comportamento correto.
 */
export const ResultadoConversao = z.object({
  lancamento_id: Uuid,
  lado: Lado,
  titulo_id: Uuid.nullable(),
  excecao: z.string().nullable(),
  /** Gerado pela série ao converter o atual (RN-F18), quando havia recorrência. */
  proximo_lancamento_id: Uuid.nullable(),
})
export type ResultadoConversao = z.infer<typeof ResultadoConversao>

/**
 * Prévia da conversão: o que vai ser criado, antes de criar.
 *
 * Mesmo princípio da prévia de fechamento do Módulo 11 — e aqui o motivo é mais
 * forte, porque a conversão abre rodada de aprovação e a recusa por vigência só
 * apareceria depois.
 */
export const PreviaConversao = z.object({
  lancamento_id: Uuid,
  lado: Lado,
  descricao: z.string(),
  valor_previsto: Dinheiro,
  data_vencimento: Data,
  /** Quantos níveis de alçada o título vai exigir ao nascer. */
  niveis_aprovacao: z.number().int().min(0).max(3),
  /** Preenchido quando a conversão vai ser recusada — RN-F16, antes de tentar. */
  impedimento: z.string().nullable(),
  /** A série vai gerar este próximo, se converter. */
  proxima_data_prevista: Data.nullable(),
})
export type PreviaConversao = z.infer<typeof PreviaConversao>

export const ListarRecorrencias = Paginacao.extend({
  lado: Lado.optional(),
  ativo: z.coerce.boolean().optional(),
  contrato_id: Uuid.optional(),
})
export type ListarRecorrencias = z.infer<typeof ListarRecorrencias>

export const CriarRecorrencia = z
  .object({
    lado: Lado,
    descricao: z.string().trim().min(3).max(200),
    valor_base: DinheiroPositivo,
    periodicidade: Periodicidade,
    /**
     * De 1 a 28.
     *
     * 29, 30 e 31 não existem em todo mês, e o que fazer em fevereiro é regra
     * que ninguém especificou — o teto é a recusa de inventá-la, não um limite
     * técnico.
     */
    dia_vencimento: z.number().int().min(1).max(28),
    proxima_geracao: Data,
    empresa_id: Uuid.nullish(),
    fornecedor_id: Uuid.nullish(),
    classificacao: ClassificacaoLancamento.nullish(),
    cliente_id: Uuid.nullish(),
    centro_custo_id: Uuid.nullish(),
    contrato_id: Uuid.nullish(),
    filial_id: Uuid.nullish(),
  })
  .refine((d) => d.lado !== 'PAGAR' || (!!d.empresa_id && !!d.classificacao && !d.cliente_id), {
    message: 'o lado a pagar exige empresa e classificação, e não tem cliente',
    path: ['empresa_id'],
  })
  .refine((d) => d.lado !== 'RECEBER' || (!!d.cliente_id && !d.empresa_id && !d.classificacao), {
    message: 'o lado a receber exige cliente, e não tem empresa nem classificação',
    path: ['cliente_id'],
  })
export type CriarRecorrencia = z.infer<typeof CriarRecorrencia>

/**
 * Editar a recorrência.
 *
 * `lado` fora: trocar o lado de uma série já em curso deixaria os lançamentos já
 * gerados apontando para o lado antigo. Desative e crie outra.
 *
 * Mudar `valor_base` **não** altera lançamento já gerado, e é deliberado: o que
 * foi programado com o valor anterior continua valendo até alguém editá-lo. O
 * molde vale para o próximo.
 */
export const EditarRecorrencia = z.object({
  descricao: z.string().trim().min(3).max(200).optional(),
  valor_base: DinheiroPositivo.optional(),
  periodicidade: Periodicidade.optional(),
  dia_vencimento: z.number().int().min(1).max(28).optional(),
  proxima_geracao: Data.optional(),
  ativo: z.boolean().optional(),
  fornecedor_id: Uuid.nullish(),
  centro_custo_id: Uuid.nullish(),
  filial_id: Uuid.nullish(),
})
export type EditarRecorrencia = z.infer<typeof EditarRecorrencia>
