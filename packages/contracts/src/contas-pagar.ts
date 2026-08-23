import { z } from 'zod'
import { Data, DataHora, Dinheiro, Paginacao, Uuid } from './primitivos.js'

/**
 * Contas a pagar — Módulo 10.
 *
 * O contrato carrega uma coisa que nenhum outro carrega: **os níveis de
 * aprovação calculados antes de confirmar**. O operador vê o que vai acontecer
 * com o título que está lançando, em vez de descobrir depois de salvar que
 * aquele valor precisa passar pela diretoria.
 */

export const CLASSIFICACAO_PAGAR = ['DESPESA_FIXA', 'DESPESA_VARIAVEL', 'INVESTIMENTO'] as const
export const ClassificacaoPagar = z.enum(CLASSIFICACAO_PAGAR)
export type ClassificacaoPagar = z.infer<typeof ClassificacaoPagar>

export const STATUS_PAGAR = [
  'PENDENTE',
  'EM_APROVACAO',
  'APROVADO',
  'AGENDADO',
  'PAGO_PARCIAL',
  'PAGO',
  'CANCELADO',
  'EM_DISPUTA',
  'REJEITADO',
] as const
export const StatusPagar = z.enum(STATUS_PAGAR)
export type StatusPagar = z.infer<typeof StatusPagar>

export const FORMA_PAGAMENTO = ['TRANSFERENCIA', 'BOLETO', 'PIX', 'CHEQUE'] as const
export const FormaPagamento = z.enum(FORMA_PAGAMENTO)
export type FormaPagamento = z.infer<typeof FormaPagamento>

const DinheiroPositivo = Dinheiro.refine((v) => Number(v) > 0, 'o valor tem de ser positivo')

/** Uma linha de rateio, na entrada. */
export const RateioEntrada = z.object({
  centro_custo_id: Uuid,
  percentual: z.number().positive().max(100),
})
export type RateioEntrada = z.infer<typeof RateioEntrada>

export const Rateio = z.object({
  centro_custo_id: Uuid,
  centro_custo_codigo: z.string(),
  centro_custo_nome: z.string(),
  percentual: z.number(),
})
export type Rateio = z.infer<typeof Rateio>

export const Aprovacao = z.object({
  nivel: z.number().int().min(1).max(3),
  rodada: z.number().int().positive(),
  aprovador_id: Uuid.nullable(),
  aprovador_nome: z.string().nullable(),
  decisao: z.enum(['APROVADO', 'REJEITADO']).nullable(),
  decidido_em: DataHora.nullable(),
  justificativa: z.string().nullable(),
  /** Preenchido quando quem decidiu agiu por delegação. */
  delegado_de: Uuid.nullable(),
  delegado_de_nome: z.string().nullable(),
})
export type Aprovacao = z.infer<typeof Aprovacao>

export const Pagamento = z.object({
  id: Uuid,
  valor_pago: Dinheiro,
  data_pagamento: Data,
  conta_id: Uuid,
  conta_apelido: z.string(),
  forma: FormaPagamento,
  movimentacao_id: Uuid.nullable(),
  estornado_em: DataHora.nullable(),
  estorno_motivo: z.string().nullable(),
})
export type Pagamento = z.infer<typeof Pagamento>

export const TituloPagar = z.object({
  id: Uuid,
  empresa_id: Uuid,
  filial_id: Uuid.nullable(),
  fornecedor_id: Uuid.nullable(),
  fornecedor_nome: z.string().nullable(),
  descricao: z.string(),
  classificacao: ClassificacaoPagar,
  contrato_fornecedor_ref: z.string().nullable(),
  valor_original: Dinheiro,
  valor_ajustado: Dinheiro.nullable(),
  /** Derivado no banco: o ajuste quando existe, o original quando não. */
  valor_devido: Dinheiro,
  /** Derivado dos pagamentos não estornados. Zero = quitado. */
  saldo: Dinheiro,
  data_emissao: Data,
  data_vencimento: Data,
  status: StatusPagar,
  titulo_pai_id: Uuid.nullable(),
  parcela_numero: z.number().int().nullable(),
  parcela_total: z.number().int().nullable(),
  version: z.number().int().positive(),
  rateio: z.array(Rateio),
  aprovacoes: z.array(Aprovacao),
  pagamentos: z.array(Pagamento),
})
export type TituloPagar = z.infer<typeof TituloPagar>

export const ListarTitulosPagar = Paginacao.extend({
  status: StatusPagar.optional(),
  fornecedor_id: Uuid.optional(),
  vencimento_de: Data.optional(),
  vencimento_ate: Data.optional(),
  classificacao: ClassificacaoPagar.optional(),
  /**
   * A fila do aprovador: só o que espera **a decisão de quem está pedindo**.
   *
   * Não é um filtro de conveniência. Sem ele, cada aprovador teria de procurar
   * na lista geral quais títulos estão no seu nível e ainda não decididos — e a
   * regra de que o nível 2 não vê antes do nível 1 decidir viraria trabalho de
   * quem lê a tela em vez de propriedade da consulta.
   */
  minha_aprovacao: z.coerce.boolean().optional(),
  /** Vencidos e ainda em aberto: a fila de quem paga. */
  em_atraso: z.coerce.boolean().optional(),
})
export type ListarTitulosPagar = z.infer<typeof ListarTitulosPagar>

/**
 * Criação.
 *
 * `parcelas` cria o pai e as N filhas na mesma transação — nunca uma parcela
 * sem as demais. Um parcelamento pela metade é a pior das duas coisas: o total
 * não fecha e ninguém sabe quantas faltam.
 */
export const CriarTituloPagar = z
  .object({
    empresa_id: Uuid,
    filial_id: Uuid.nullish(),
    fornecedor_id: Uuid.nullish(),
    descricao: z.string().trim().min(3).max(200),
    classificacao: ClassificacaoPagar,
    contrato_fornecedor_ref: z.string().trim().max(120).nullish(),
    valor_original: DinheiroPositivo,
    data_emissao: Data,
    data_vencimento: Data,
    /** 1 = título único. Acima de 1, gera o pai e as filhas mensais. */
    parcelas: z.number().int().min(1).max(120).default(1),
    rateio: z.array(RateioEntrada).max(20).default([]),
  })
  .refine((d) => d.data_vencimento >= d.data_emissao, {
    message: 'o vencimento não pode ser anterior à emissão',
    path: ['data_vencimento'],
  })
  .refine(
    (d) => d.rateio.length === 0 || Math.abs(d.rateio.reduce((s, r) => s + r.percentual, 0) - 100) <= 0.005,
    { message: 'o rateio tem de somar 100%', path: ['rateio'] },
  )
export type CriarTituloPagar = z.infer<typeof CriarTituloPagar>

/** Editar só em PENDENTE — depois de enviado, o que muda é o valor devido. */
export const EditarTituloPagar = z.object({
  descricao: z.string().trim().min(3).max(200).optional(),
  classificacao: ClassificacaoPagar.optional(),
  fornecedor_id: Uuid.nullish(),
  filial_id: Uuid.nullish(),
  contrato_fornecedor_ref: z.string().trim().max(120).nullish(),
  valor_original: DinheiroPositivo.optional(),
  data_vencimento: Data.optional(),
})
export type EditarTituloPagar = z.infer<typeof EditarTituloPagar>

/** Multa, juro ou desconto negociado. Exige motivo: muda o que se vai pagar. */
export const AjustarValorTituloPagar = z.object({
  valor_ajustado: DinheiroPositivo,
  motivo: z.string().trim().min(5).max(300),
})
export type AjustarValorTituloPagar = z.infer<typeof AjustarValorTituloPagar>

export const DecidirAprovacao = z
  .object({
    decisao: z.enum(['APROVADO', 'REJEITADO']),
    justificativa: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.decisao === 'APROVADO' || (d.justificativa ?? '').length >= 10, {
    // Recusa sem justificativa não é resposta: o solicitante não tem o que
    // corrigir, e reenvia igual.
    message: 'a rejeição exige justificativa de ao menos 10 caracteres',
    path: ['justificativa'],
  })
export type DecidirAprovacao = z.infer<typeof DecidirAprovacao>

export const RegistrarPagamento = z.object({
  valor_pago: DinheiroPositivo,
  data_pagamento: Data,
  conta_id: Uuid,
  forma: FormaPagamento,
})
export type RegistrarPagamento = z.infer<typeof RegistrarPagamento>

export const EstornarPagamento = z.object({
  motivo: z.string().trim().min(5).max(500),
})
export type EstornarPagamento = z.infer<typeof EstornarPagamento>

export const CancelarTituloPagar = z.object({
  motivo: z.string().trim().min(5).max(500),
  /**
   * Cancelar o pai propõe cancelar as filhas pendentes, e exige confirmação.
   *
   * Sem o campo, o cancelamento em cascata seria silencioso — e uma parcela já
   * paga não se cancela de jeito nenhum.
   */
  cancelar_parcelas_pendentes: z.boolean().default(false),
})
export type CancelarTituloPagar = z.infer<typeof CancelarTituloPagar>

/**
 * Prévia da alçada: quantos níveis um valor vai exigir.
 *
 * Existe como consulta própria porque a tela precisa dela **antes** de salvar.
 * Descobrir depois de confirmar que o título vai para a diretoria é a surpresa
 * que este endpoint remove.
 */
export const PreviaAlcada = z.object({
  valor: DinheiroPositivo,
})
export type PreviaAlcada = z.infer<typeof PreviaAlcada>

export const NiveisExigidos = z.object({
  valor: Dinheiro,
  niveis: z.number().int().min(0).max(3),
  /** Os limites cadastrados, para a tela poder explicar de onde vem o número. */
  limites: z.array(Dinheiro),
})
export type NiveisExigidos = z.infer<typeof NiveisExigidos>

/* --------------------------------------------------- delegação */

export const Delegacao = z.object({
  id: Uuid,
  delegante_id: Uuid,
  delegante_nome: z.string(),
  delegado_id: Uuid,
  delegado_nome: z.string(),
  nivel: z.number().int().min(1).max(3),
  inicio: Data,
  fim: Data,
  motivo: z.string(),
  /** Derivado da data de hoje, não gravado. */
  vigente: z.boolean(),
})
export type Delegacao = z.infer<typeof Delegacao>

export const ListarDelegacoes = Paginacao.extend({
  apenas_vigentes: z.coerce.boolean().optional(),
})
export type ListarDelegacoes = z.infer<typeof ListarDelegacoes>

export const CriarDelegacao = z
  .object({
    delegado_id: Uuid,
    nivel: z.number().int().min(1).max(3),
    inicio: Data,
    fim: Data,
    motivo: z.string().trim().min(3).max(300),
  })
  .refine((d) => d.fim >= d.inicio, {
    message: 'o fim não pode ser anterior ao início',
    path: ['fim'],
  })
export type CriarDelegacao = z.infer<typeof CriarDelegacao>
