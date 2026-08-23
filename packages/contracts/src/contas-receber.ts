import { z } from 'zod'
import { Competencia, Data, DataHora, Dinheiro, Paginacao, Uuid } from './primitivos.js'

/**
 * Contas a receber — Módulo 11, decisão D-20.
 *
 * **Uma forma só.** "Fatura" e "contas a receber" são a mesma linha vista de
 * dois ângulos: `origem = 'CONTRATUAL'` é a cobrança gerada do contrato e do
 * consumo, `'AVULSO'` é o lançamento manual. Dois contratos paralelos aqui
 * reintroduziriam no cliente HTTP a duplicação que a migração removeu do banco.
 *
 * Duas ausências deliberadas, e as duas são o ponto:
 *
 *  · **não existe `saldo`** — vem derivado do servidor, nunca enviado;
 *  · **não existe `em_atraso` nem `dias_atraso`** — atraso é
 *    `data_vencimento < hoje` com o título em aberto. Gravá-lo estaria errado no
 *    dia seguinte ao vencimento, e só um job noturno o corrigiria.
 */

export const ORIGEM_RECEBER = ['CONTRATUAL', 'AVULSO'] as const
export const OrigemReceber = z.enum(ORIGEM_RECEBER)
export type OrigemReceber = z.infer<typeof OrigemReceber>

export const STATUS_RECEBER = [
  'PENDENTE_APROVACAO',
  'PENDENTE',
  'APROVADO',
  'RECEBIDO_PARCIAL',
  'RECEBIDO',
  'CANCELADO',
  'EM_DISPUTA',
  /** Encerrado **sem** entrada de caixa. Nunca somado com RECEBIDO (RN-F14). */
  'BAIXADO',
] as const
export const StatusReceber = z.enum(STATUS_RECEBER)
export type StatusReceber = z.infer<typeof StatusReceber>

export const FORMA_RECEBIMENTO = ['TRANSFERENCIA', 'BOLETO', 'PIX', 'CHEQUE'] as const
export const FormaRecebimento = z.enum(FORMA_RECEBIMENTO)
export type FormaRecebimento = z.infer<typeof FormaRecebimento>

const DinheiroPositivo = Dinheiro.refine((v) => Number(v) > 0, 'o valor tem de ser positivo')

export const RateioReceberEntrada = z.object({
  centro_custo_id: Uuid,
  percentual: z.number().positive().max(100),
})
export type RateioReceberEntrada = z.infer<typeof RateioReceberEntrada>

export const RateioReceber = z.object({
  centro_custo_id: Uuid,
  centro_custo_codigo: z.string(),
  centro_custo_nome: z.string(),
  percentual: z.number(),
})
export type RateioReceber = z.infer<typeof RateioReceber>

export const AprovacaoReceber = z.object({
  nivel: z.number().int().min(1).max(3),
  rodada: z.number().int().positive(),
  aprovador_id: Uuid.nullable(),
  aprovador_nome: z.string().nullable(),
  decisao: z.enum(['APROVADO', 'REJEITADO']).nullable(),
  decidido_em: DataHora.nullable(),
  justificativa: z.string().nullable(),
  delegado_de: Uuid.nullable(),
  delegado_de_nome: z.string().nullable(),
})
export type AprovacaoReceber = z.infer<typeof AprovacaoReceber>

export const Recebimento = z.object({
  id: Uuid,
  valor_recebido: Dinheiro,
  data_recebimento: Data,
  conta_id: Uuid,
  conta_apelido: z.string(),
  forma: FormaRecebimento,
  movimentacao_id: Uuid.nullable(),
  estornado_em: DataHora.nullable(),
  estorno_motivo: z.string().nullable(),
})
export type Recebimento = z.infer<typeof Recebimento>

export const TituloReceber = z.object({
  id: Uuid,
  /** Sequencial por locatário. **Não** é número de NF-e/NFS-e. */
  numero_titulo: z.number().int().positive(),
  cliente_id: Uuid,
  cliente_nome: z.string(),
  filial_id: Uuid.nullable(),
  contrato_id: Uuid.nullable(),
  contrato_numero: z.string().nullable(),
  competencia: Competencia.nullable(),
  origem: OrigemReceber,
  descricao: z.string(),
  valor_original: Dinheiro,
  desconto: Dinheiro,
  /** Derivado no banco: original menos desconto. */
  valor_liquido: Dinheiro,
  desconto_motivo: z.string().nullable(),
  desconto_por: Uuid.nullable(),
  data_emissao: Data,
  data_vencimento: Data,
  status: StatusReceber,
  /** RN-F14: por que o título foi encerrado sem entrada de caixa. */
  baixa_motivo: z.string().nullable(),
  baixado_em: DataHora.nullable(),
  /** RN-F11: por que este título nasceu em disputa. */
  excecao_geracao: z.string().nullable(),
  /** Derivado dos recebimentos não estornados. Zero = quitado. */
  saldo: Dinheiro,
  titulo_pai_id: Uuid.nullable(),
  parcela_numero: z.number().int().nullable(),
  parcela_total: z.number().int().nullable(),
  version: z.number().int().positive(),
  rateio: z.array(RateioReceber),
  aprovacoes: z.array(AprovacaoReceber),
  recebimentos: z.array(Recebimento),
})
export type TituloReceber = z.infer<typeof TituloReceber>

export const ListarTitulosReceber = Paginacao.extend({
  status: StatusReceber.optional(),
  cliente_id: Uuid.optional(),
  contrato_id: Uuid.optional(),
  competencia: Competencia.optional(),
  origem: OrigemReceber.optional(),
  vencimento_de: Data.optional(),
  vencimento_ate: Data.optional(),
  /**
   * A fila do aprovador: só a pré-cobrança que espera **a decisão de quem está
   * pedindo**, e que não foi gerada por ele. A regra de que o nível 2 não decide
   * antes do nível 1 vira propriedade da consulta, em vez de trabalho de quem lê.
   */
  minha_aprovacao: z.coerce.boolean().optional(),
  /** Vencidos e em aberto: a fila da cobrança. Derivado, nunca um status. */
  em_atraso: z.coerce.boolean().optional(),
})
export type ListarTitulosReceber = z.infer<typeof ListarTitulosReceber>

/**
 * Lançamento avulso.
 *
 * Não há como criar um `CONTRATUAL` por aqui, e é deliberado: ele nasce do
 * fechamento de competência, com o valor vindo do motor de preço. Um caminho
 * manual para criá-lo permitiria uma cobrança contratual com valor digitado — e
 * ela seria indistinguível da calculada.
 */
export const CriarTituloReceber = z
  .object({
    cliente_id: Uuid,
    filial_id: Uuid.nullish(),
    descricao: z.string().trim().min(3).max(200),
    valor_original: DinheiroPositivo,
    data_emissao: Data,
    data_vencimento: Data,
    parcelas: z.number().int().min(1).max(120).default(1),
    rateio: z.array(RateioReceberEntrada).max(20).default([]),
  })
  .refine((d) => d.data_vencimento >= d.data_emissao, {
    message: 'o vencimento não pode ser anterior à emissão',
    path: ['data_vencimento'],
  })
  .refine(
    (d) => d.rateio.length === 0 || Math.abs(d.rateio.reduce((s, r) => s + r.percentual, 0) - 100) <= 0.005,
    { message: 'o rateio tem de somar 100%', path: ['rateio'] },
  )
export type CriarTituloReceber = z.infer<typeof CriarTituloReceber>

/** Editar só antes da aprovação — depois, o que muda é o desconto. */
export const EditarTituloReceber = z.object({
  descricao: z.string().trim().min(3).max(200).optional(),
  filial_id: Uuid.nullish(),
  valor_original: DinheiroPositivo.optional(),
  data_vencimento: Data.optional(),
})
export type EditarTituloReceber = z.infer<typeof EditarTituloReceber>

/**
 * Desconto — RN-F12.
 *
 * O valor é absoluto e a alçada é percentual, o que parece incoerente e não é:
 * o operador negocia "R$ 300 de abatimento", e é o servidor que converte para
 * percentual do título para comparar com o teto do perfil. Pedir o percentual na
 * entrada faria o operador fazer essa conta de cabeça.
 */
export const AplicarDesconto = z.object({
  desconto: Dinheiro,
  motivo: z.string().trim().min(5).max(300),
})
export type AplicarDesconto = z.infer<typeof AplicarDesconto>

export const DecidirEmissao = z
  .object({
    decisao: z.enum(['APROVADO', 'REJEITADO']),
    justificativa: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.decisao === 'APROVADO' || (d.justificativa ?? '').length >= 10, {
    message: 'a rejeição exige justificativa de ao menos 10 caracteres',
    path: ['justificativa'],
  })
export type DecidirEmissao = z.infer<typeof DecidirEmissao>

export const RegistrarRecebimento = z.object({
  valor_recebido: DinheiroPositivo,
  data_recebimento: Data,
  conta_id: Uuid,
  forma: FormaRecebimento,
})
export type RegistrarRecebimento = z.infer<typeof RegistrarRecebimento>

export const EstornarRecebimento = z.object({
  motivo: z.string().trim().min(5).max(500),
})
export type EstornarRecebimento = z.infer<typeof EstornarRecebimento>

/**
 * Baixa sem recebimento — RN-F14.
 *
 * O motivo mínimo é maior que o dos outros (10 contra 5) de propósito: é o único
 * registro de por que um valor **não** entrou, e ele vai ser lido meses depois
 * por alguém tentando explicar uma diferença de receita.
 */
export const BaixarSemRecebimento = z.object({
  motivo: z.string().trim().min(10).max(500),
})
export type BaixarSemRecebimento = z.infer<typeof BaixarSemRecebimento>

export const CancelarTituloReceber = z.object({
  motivo: z.string().trim().min(5).max(500),
  cancelar_parcelas_pendentes: z.boolean().default(false),
})
export type CancelarTituloReceber = z.infer<typeof CancelarTituloReceber>

/** Prévia da alçada de emissão: quantos níveis um valor vai exigir. */
export const PreviaAlcadaReceber = z.object({ valor: DinheiroPositivo })
export type PreviaAlcadaReceber = z.infer<typeof PreviaAlcadaReceber>

export const NiveisEmissao = z.object({
  valor: Dinheiro,
  niveis: z.number().int().min(0).max(3),
  limites: z.array(Dinheiro),
  /**
   * O piso de um nível do contratual (RN-F10).
   *
   * A prévia responde para um avulso, onde zero é um resultado legítimo. A tela
   * precisa dizer que a cobrança gerada do contrato sempre passa por alguém,
   * senão o operador conclui que abaixo da menor faixa nada é conferido.
   */
  piso_contratual: z.literal(1),
})
export type NiveisEmissao = z.infer<typeof NiveisEmissao>

/* ------------------------------------------- fechamento de competência */

/**
 * Fechar a competência: selar o consumo e gerar as cobranças, numa chamada.
 *
 * A prévia existe pela mesma razão da prévia de alçada: "quantos títulos isto
 * vai gerar, e quantos vão nascer em disputa" é uma pergunta que se responde
 * **antes** de confirmar, não depois de o cliente receber a fatura.
 */
export const PreviaFechamento = z.object({
  competencia: Competencia,
  contratos: z.number().int().min(0),
  titulos_a_gerar: z.number().int().min(0),
  ja_existentes: z.number().int().min(0),
  /** Contratos sem vigência ou com item sem preço — nascerão EM_DISPUTA. */
  excecoes: z.array(
    z.object({
      contrato_id: Uuid,
      contrato_numero: z.string(),
      motivo: z.string(),
    }),
  ),
  valor_total: Dinheiro,
})
export type PreviaFechamento = z.infer<typeof PreviaFechamento>

export const ResultadoFechamento = z.object({
  competencia: Competencia,
  titulos_criados: z.number().int().min(0),
  em_disputa: z.number().int().min(0),
  consumos_selados: z.number().int().min(0),
  ja_existiam: z.number().int().min(0),
})
export type ResultadoFechamento = z.infer<typeof ResultadoFechamento>
