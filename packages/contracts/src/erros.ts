import { z } from 'zod'

/**
 * Erros da API — RFC 9457 (`application/problem+json`), Anexo D.1.
 *
 * O ponto central: `code` é um identificador **estável** de causa, e é ele que o
 * cliente consome. `title` e `detail` são para humanos e podem mudar de redação
 * sem quebrar integração; `status` é grosso demais para decidir comportamento
 * (dois 409 muito diferentes pedem telas muito diferentes).
 */

/**
 * Catálogo fechado de causas.
 *
 * Fechado de propósito: um código novo exige uma linha aqui, o que força a
 * pergunta "o cliente sabe o que fazer com isso?" antes de o erro existir.
 */
export const CODIGOS_ERRO = [
  // 400/422 — entrada e regra de negócio
  'PAYLOAD_INVALIDO',
  'REGRA_DE_NEGOCIO',
  'VIGENCIA_INVALIDA',
  'CREDITO_BLOQUEADO',
  'TRANSICAO_INVALIDA',
  // 401/403
  'NAO_AUTENTICADO',
  'TOKEN_INVALIDO',
  'SEM_PERMISSAO',
  'FORA_DE_ESCOPO',
  // 404
  'NAO_ENCONTRADO',
  // 409
  'EQUIPAMENTO_JA_ALOCADO',
  'CONFLITO_DE_VERSAO',
  'RECURSO_DUPLICADO',
  'IDEMPOTENCIA_EM_ANDAMENTO',
  'IDEMPOTENCIA_DIVERGENTE',
  // 429/5xx
  'LIMITE_EXCEDIDO',
  'ERRO_INTERNO',
  'INDISPONIVEL',
] as const

export type CodigoErro = (typeof CODIGOS_ERRO)[number]

/**
 * Ação sugerida — a diferença entre "não pode" e "não pode, faça isto".
 *
 * Um bloqueio sem saída obriga o operador a abrir chamado. Toda recusa de regra
 * de negócio nesta API carrega pelo menos uma alternativa quando ela existe.
 */
export const AcaoSugerida = z.object({
  code: z.string(),
  descricao: z.string(),
  meta: z.record(z.unknown()).optional(),
})

export type AcaoSugerida = z.infer<typeof AcaoSugerida>

export const ErroDeCampo = z.object({
  field: z.string(),
  code: z.string(),
  message: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
})

export const Problema = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.enum(CODIGOS_ERRO),
  detail: z.string().optional(),
  instance: z.string().optional(),
  request_id: z.string().optional(),
  errors: z.array(ErroDeCampo).optional(),
  acoes_sugeridas: z.array(AcaoSugerida).optional(),
})

export type Problema = z.infer<typeof Problema>

export const BASE_TIPO_ERRO = 'https://api.iarx.app/errors/'

/** URI de `type` derivada do código: `RECURSO_DUPLICADO` → `.../recurso-duplicado`. */
export function tipoDoErro(code: CodigoErro): string {
  return BASE_TIPO_ERRO + code.toLowerCase().replace(/_/g, '-')
}
