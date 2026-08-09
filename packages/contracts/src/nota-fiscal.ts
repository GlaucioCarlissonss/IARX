import { z } from 'zod'
import { Data, DataHora, Dinheiro, Documento, Paginacao, Uuid } from './primitivos.js'

/**
 * Entrada fiscal de compra — Módulo 1 do Anexo L, sob as decisões do Anexo M.
 *
 * O contrato desta API carrega uma inversão de responsabilidade: o cliente não
 * informa o custo do ativo. Ele informa **a nota**, e o custo é derivado dela
 * pelo servidor. Um campo `valor_aquisicao` aceito na fronteira reabriria
 * exatamente o problema que o módulo elimina.
 */

export const NF_STATUS = ['PENDENTE_CONFERENCIA', 'CONFERIDA', 'INTEGRADA', 'CANCELADA'] as const
export const NfStatus = z.enum(NF_STATUS)
export type NfStatus = z.infer<typeof NfStatus>

/**
 * Chave de acesso da NF-e: 44 dígitos com dígito verificador módulo 11.
 *
 * A verificação do DV vive no esquema, e não só no banco, porque um `400` com
 * "a chave não passa na verificação do dígito" chega ao operador antes de a
 * requisição custar uma transação — e é o mesmo cálculo que
 * `app.chave_nfe_valida` faz do outro lado.
 */
export const ChaveAcesso = z
  .string()
  .regex(/^\d{44}$/, 'chave de acesso deve ter exatamente 44 dígitos')
  .refine((c) => dvChaveNfe(c.slice(0, 43)) === Number(c[43]), {
    message: 'dígito verificador da chave de acesso não confere',
  })

/** Módulo 11, pesos 2–9 cíclicos da direita para a esquerda. */
export function dvChaveNfe(chave43: string): number | null {
  if (!/^\d{43}$/.test(chave43)) return null
  let soma = 0
  let peso = 2
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave43[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

/** Campos que a chave carrega — usados para conferi-la contra o cabeçalho. */
export function decomporChave(chave: string) {
  if (!/^\d{44}$/.test(chave)) return null
  return {
    uf: chave.slice(0, 2),
    competencia: `20${chave.slice(2, 4)}-${chave.slice(4, 6)}`,
    cnpj_emitente: chave.slice(6, 20),
    modelo: chave.slice(20, 22),
    serie: String(Number(chave.slice(22, 25))),
    numero: String(Number(chave.slice(25, 34))),
  }
}

/* --------------------------------------------------------------- fornecedor */

export const Fornecedor = z.object({
  id: Uuid,
  documento: Documento,
  razao_social: z.string(),
  nome_fantasia: z.string().nullable(),
  uf: z.string().length(2).nullable(),
  inscricao_estadual: z.string().nullable(),
  ativo: z.boolean(),
})
export type Fornecedor = z.infer<typeof Fornecedor>

/* ------------------------------------------------------------------- itens */

export const NotaFiscalSerie = z.object({
  id: Uuid,
  numero_serie: z.string(),
  patrimonio: z.string(),
  /** Nulo enquanto a unidade não virou ativo. */
  equipamento_id: Uuid.nullable(),
})
export type NotaFiscalSerie = z.infer<typeof NotaFiscalSerie>

export const NotaFiscalItem = z.object({
  id: Uuid,
  numero_item: z.number().int().positive(),
  modelo_id: Uuid,
  descricao_nf: z.string(),
  codigo_fornecedor: z.string().nullable(),
  ncm: z.string().nullable(),
  cfop: z.string().nullable(),
  unidade: z.string(),
  quantidade: z.number().int().positive(),
  valor_unitario: Dinheiro,
  valor_total_item: Dinheiro,
  garantia_meses: z.number().int().positive().nullable(),
  garantia_ate: Data.nullable(),
  series: z.array(NotaFiscalSerie),
})
export type NotaFiscalItem = z.infer<typeof NotaFiscalItem>

/* -------------------------------------------------------------- cabeçalho */

export const NotaFiscal = z.object({
  id: Uuid,
  fornecedor_id: Uuid,
  fornecedor_nome: z.string().nullable(),
  filial_destino_id: Uuid,
  numero: z.string(),
  serie: z.string(),
  chave_acesso: z.string().nullable(),
  modelo_documento: z.string(),
  data_emissao: Data,
  data_entrada: Data,

  valor_produtos: Dinheiro,
  valor_frete: Dinheiro,
  valor_seguro: Dinheiro,
  valor_outras_despesas: Dinheiro,
  valor_desconto: Dinheiro,
  valor_ipi: Dinheiro,
  valor_icms: Dinheiro,
  valor_icms_st: Dinheiro,
  valor_total: Dinheiro,

  icms_recuperavel: z.boolean(),
  ipi_recuperavel: z.boolean(),
  /**
   * Derivado, nunca informado: total menos tributos recuperáveis
   * (CPC 27 item 16). É coluna gerada no banco.
   */
  custo_aquisicao: Dinheiro,

  status: NfStatus,
  origem_dados: z.enum(['MANUAL', 'XML']),
  observacao: z.string().nullable(),
  conferida_em: DataHora.nullable(),
  integrada_em: DataHora.nullable(),
  cancelada_em: DataHora.nullable(),
  motivo_cancelamento: z.string().nullable(),
  version: z.number().int(),
})
export type NotaFiscal = z.infer<typeof NotaFiscal>

export const NotaFiscalComItens = NotaFiscal.extend({ itens: z.array(NotaFiscalItem) })
export type NotaFiscalComItens = z.infer<typeof NotaFiscalComItens>

/* --------------------------------------------------------------- entradas */

export const CriarItemNota = z.object({
  modelo_id: Uuid,
  descricao_nf: z.string().min(1).max(500),
  codigo_fornecedor: z.string().max(60).nullable().default(null),
  ncm: z
    .string()
    .regex(/^\d{8}$/, 'NCM deve ter 8 dígitos')
    .nullable()
    .default(null),
  cfop: z
    .string()
    .regex(/^\d{4}$/, 'CFOP deve ter 4 dígitos')
    .nullable()
    .default(null),
  unidade: z.string().max(6).default('UN'),
  /**
   * Inteiro por exigência do domínio: cada unidade vira um patrimônio próprio.
   * Quantidade fracionária significa serviço ou insumo — outro fluxo.
   */
  quantidade: z.number().int().positive(),
  valor_unitario: Dinheiro,
  valor_total_item: Dinheiro,
  garantia_meses: z.number().int().positive().max(120).nullable().default(null),
})
export type CriarItemNota = z.infer<typeof CriarItemNota>

export const CriarNotaFiscal = z
  .object({
    fornecedor_id: Uuid,
    filial_destino_id: Uuid,
    numero: z.string().min(1).max(20),
    serie: z.string().min(1).max(5),
    chave_acesso: ChaveAcesso.nullable().default(null),
    modelo_documento: z.enum(['55', '65', '01', '1B', '04']).default('55'),
    data_emissao: Data,
    data_entrada: Data,

    valor_produtos: Dinheiro,
    valor_frete: Dinheiro.default('0' as never),
    valor_seguro: Dinheiro.default('0' as never),
    valor_outras_despesas: Dinheiro.default('0' as never),
    valor_desconto: Dinheiro.default('0' as never),
    valor_ipi: Dinheiro.default('0' as never),
    valor_icms: Dinheiro.default('0' as never),
    valor_icms_st: Dinheiro.default('0' as never),
    valor_total: Dinheiro,

    icms_recuperavel: z.boolean().default(false),
    ipi_recuperavel: z.boolean().default(false),
    origem_dados: z.enum(['MANUAL', 'XML']).default('MANUAL'),
    observacao: z.string().max(1000).nullable().default(null),
    itens: z.array(CriarItemNota).min(1, 'uma nota sem item não descreve compra alguma'),
  })
  .refine((n) => n.data_entrada >= n.data_emissao, {
    message: 'a entrada não pode ser anterior à emissão',
    path: ['data_entrada'],
  })
  .refine((n) => n.origem_dados !== 'XML' || n.chave_acesso !== null, {
    message: 'nota declarada como extraída de XML precisa da chave de acesso',
    path: ['chave_acesso'],
  })
  .refine((n) => fecha(n), {
    // vNF = vProd + vST + vFrete + vSeg + vOutro + vIPI − vDesc (layout 4.00).
    // Validar aqui devolve o erro com o campo certo; o CHECK do banco é a
    // garantia, e a mensagem dele seria bem menos útil.
    message: 'o total não fecha com a composição da nota (vProd + vST + vFrete + vSeg + vOutro + vIPI − vDesc)',
    path: ['valor_total'],
  })
export type CriarNotaFiscal = z.infer<typeof CriarNotaFiscal>

function fecha(n: {
  valor_produtos: string
  valor_icms_st: string
  valor_frete: string
  valor_seguro: string
  valor_outras_despesas: string
  valor_ipi: string
  valor_desconto: string
  valor_total: string
}): boolean {
  // Em centavos inteiros: comparar decimais em ponto flutuante é justamente o
  // que faz uma nota de R$ 18.250,00 "não fechar" por 0,0000000001.
  const c = (v: string) => Math.round(Number(v) * 10000)
  const esperado =
    c(n.valor_produtos) +
    c(n.valor_icms_st) +
    c(n.valor_frete) +
    c(n.valor_seguro) +
    c(n.valor_outras_despesas) +
    c(n.valor_ipi) -
    c(n.valor_desconto)
  return c(n.valor_total) === esperado
}

export const DefinirSeries = z.object({
  unidades: z
    .array(
      z.object({
        numero_serie: z.string().min(1).max(80),
        patrimonio: z.string().min(1).max(40),
      }),
    )
    .min(1),
})
export type DefinirSeries = z.infer<typeof DefinirSeries>

export const CancelarNota = z.object({
  motivo: z.string().min(5, 'informe o motivo do cancelamento — a operação é auditada').max(500),
})
export type CancelarNota = z.infer<typeof CancelarNota>

/* --------------------------------------------------------------- consultas */

export const ListarNotasFiscais = Paginacao.extend({
  status: NfStatus.optional(),
  fornecedor_id: Uuid.optional(),
  filial_destino_id: Uuid.optional(),
  entrada_de: Data.optional(),
  entrada_ate: Data.optional(),
  /** Prefixo do número da nota. */
  q: z.string().max(40).optional(),
})
export type ListarNotasFiscais = z.infer<typeof ListarNotasFiscais>

/** Uma unidade da prévia de integração: o ativo que será criado. */
export const UnidadePrevista = z.object({
  serie_id: Uuid,
  numero_item: z.number().int(),
  patrimonio: z.string(),
  numero_serie: z.string(),
  modelo_id: Uuid,
  valor_aquisicao: Dinheiro,
  garantia_ate: Data.nullable(),
})
export type UnidadePrevista = z.infer<typeof UnidadePrevista>

export const PreviaIntegracao = z.object({
  nota_id: Uuid,
  custo_aquisicao: Dinheiro,
  soma_rateio: Dinheiro,
  /** Falso significa que a integração será recusada — e a prévia diz por quê. */
  fecha: z.boolean(),
  unidades: z.array(UnidadePrevista),
})
export type PreviaIntegracao = z.infer<typeof PreviaIntegracao>

export const ResultadoIntegracao = z.object({
  nota: NotaFiscal,
  equipamentos_criados: z.array(z.object({ id: Uuid, patrimonio: z.string(), numero_serie: z.string() })),
})
export type ResultadoIntegracao = z.infer<typeof ResultadoIntegracao>
