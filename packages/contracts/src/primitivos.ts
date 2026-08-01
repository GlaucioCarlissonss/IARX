import { z } from 'zod'

/**
 * Tipos primitivos do contrato de API.
 *
 * A regra que governa este arquivo: se um valor tem forma canônica na fronteira
 * HTTP (Anexo D.1), ela é definida aqui uma única vez. API e cliente importam o
 * mesmo esquema, então uma divergência de formato vira erro de compilação em vez
 * de bug de integração.
 */

export const Uuid = z.string().uuid()

/**
 * Dinheiro trafega como string decimal, nunca como number.
 *
 * `0.1 + 0.2 !== 0.3` em ponto flutuante binário, e uma fatura não pode fechar
 * com centavo de diferença. O banco usa numeric(15,4); a fronteira usa a
 * representação textual exata, e a conversão para decimal acontece de um lado
 * só — no banco.
 */
export const Dinheiro = z
  .string()
  .regex(/^-?\d{1,13}(\.\d{1,4})?$/, 'valor monetário deve ser decimal com até 4 casas, como "1234.5600"')
  .brand<'Dinheiro'>()

export type Dinheiro = z.infer<typeof Dinheiro>

/** Quantidade de páginas, ciclos ou horas — inteiro não negativo. */
export const Contador = z.number().int().min(0)

/**
 * Data e hora com fuso obrigatório.
 *
 * Sem o deslocamento não existe resposta certa para "que dia é 2026-08-01T00:00"
 * — e a diferença de um dia muda o cálculo de proporcionalidade de uma fatura.
 */
export const DataHora = z
  .string()
  .datetime({ offset: true })
  .describe('ISO 8601 com fuso, ex.: 2026-08-01T00:00:00-03:00')

/**
 * Data civil sem hora (AAAA-MM-DD).
 *
 * Vigência de contrato é data civil, não instante: "vale até 31/07" não muda de
 * significado com o fuso do servidor. Já a vigência de um *item* é instante,
 * porque a entrega acontece em uma hora do dia e o cálculo proporcional conta
 * dias a partir dela.
 */
export const Data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'data no formato AAAA-MM-DD')

/** Competência de faturamento no formato AAAA-MM. */
export const Competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'competência no formato AAAA-MM')

/**
 * Intervalo de vigência. `fim` nulo significa vigência aberta.
 *
 * O refinamento vale como validação de entrada, não como garantia: a garantia é
 * a exclusion constraint do PostgreSQL (RN-001). Validar aqui apenas devolve o
 * erro mais cedo e com mensagem melhor.
 */
export const Vigencia = z
  .object({
    vigencia_inicio: DataHora,
    vigencia_fim: DataHora.nullable().default(null),
  })
  .refine((v) => v.vigencia_fim === null || new Date(v.vigencia_fim) > new Date(v.vigencia_inicio), {
    message: 'o fim da vigência deve ser posterior ao início',
    path: ['vigencia_fim'],
  })

/** Documento fiscal: CPF (11) ou CNPJ (14), apenas dígitos. */
export const Documento = z
  .string()
  .regex(/^\d{11}$|^\d{14}$/, 'documento deve conter 11 dígitos (CPF) ou 14 (CNPJ)')

/* ------------------------------------------------------------------ paginação */

/**
 * Paginação por cursor, não por offset.
 *
 * `OFFSET 40000` faz o PostgreSQL varrer e descartar 40 mil linhas, e a página
 * escorrega quando alguém insere durante a navegação. O cursor é opaco de
 * propósito: quem consome não deve depender do que há dentro.
 */
export const Paginacao = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
})

export type Paginacao = z.infer<typeof Paginacao>

export const MetaColecao = z.object({
  limit: z.number().int(),
  next_cursor: z.string().nullable(),
  total_aproximado: z.number().int().optional(),
})

/** Envelope de coleção: `{ data: [...], meta: {...} }` (Anexo D.1). */
export function colecao<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), meta: MetaColecao })
}

/** Envelope de recurso único: `{ data: {...} }`. */
export function recurso<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: item })
}
