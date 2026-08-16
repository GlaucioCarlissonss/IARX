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
  /**
   * Locatário, quando quem entra é usuário de cliente (D-01).
   *
   * Ausente para o usuário interno da locadora — e a ausência é significativa,
   * não um descuido: `app.cliente_atual()` devolve nulo, e a política
   * restritiva de cliente deixa de recortar. Um valor "todos" aqui seria a
   * porta para um usuário de cliente pedir a visão do locador.
   */
  cliente_id: z.string().uuid().nullish(),
  /**
   * Sessão que emitiu este token.
   *
   * Um JWT vale até expirar, por definição — é esta claim que permite encerrar
   * o acesso antes disso. Opcional porque token de integração (conta de
   * serviço, Anexo C.7) não tem sessão de usuário atrás.
   */
  sessao_id: z.string().uuid().nullish(),
  permissoes: z
    .array(z.string())
    .default([])
    .transform((lista) => lista.filter((p): p is z.infer<typeof PermissaoSchema> => PermissaoSchema.safeParse(p).success)),
  escopos: z.array(z.object({ tipo: EscopoSchema, id: z.string().uuid().nullable() })).default([]),
  exp: z.number().int().optional(),
  iat: z.number().int().optional(),
})

export type Claims = z.infer<typeof Claims>
