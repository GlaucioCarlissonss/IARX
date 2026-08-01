import { z } from 'zod'
import { ESCOPOS, PERMISSOES } from './catalogo-permissoes.js'

export * from './catalogo-permissoes.js'

export const PermissaoSchema = z.enum(PERMISSOES)
export const EscopoSchema = z.enum(ESCOPOS)

/**
 * Claims que a API espera no access token.
 *
 * No Supabase são produzidas pelo custom access-token hook (Anexo H.4); em
 * PostgreSQL puro, pelo emissor local. O ponto que não muda: **`tenant_id` vem
 * do token e de nenhum outro lugar** (RN-028). Aceitá-lo por query, header ou
 * corpo seria entregar ao cliente o parâmetro que atravessa o isolamento.
 *
 * Permissões desconhecidas são descartadas em vez de derrubarem o token: um
 * emissor mais novo que a API não deve tirar o sistema do ar, e o efeito de
 * descartar é negar — que é o padrão seguro (RN-026).
 */
export const Claims = z.object({
  sub: z.string().uuid(),
  tenant_id: z.string().uuid(),
  usuario_id: z.string().uuid(),
  permissoes: z
    .array(z.string())
    .default([])
    .transform((lista) => lista.filter((p): p is z.infer<typeof PermissaoSchema> => PermissaoSchema.safeParse(p).success)),
  escopos: z.array(z.object({ tipo: EscopoSchema, id: z.string().uuid().nullable() })).default([]),
  exp: z.number().int().optional(),
  iat: z.number().int().optional(),
})

export type Claims = z.infer<typeof Claims>
