import { z } from 'zod'
import { DataHora, Paginacao, Uuid } from './primitivos.js'
import { EscopoSchema, PermissaoSchema } from './permissoes.js'

/**
 * Usuários e perfis — o cadastro que decide o que todo o resto autoriza.
 *
 * Duas coisas que este contrato deliberadamente **não** permite, e as duas são
 * do Anexo L §4.2.
 *
 * **Ninguém define a senha de outra pessoa.** Não existe campo `senha` em lugar
 * nenhum daqui. Convidar cria a conta e emite um token de uso único; quem entra
 * define a própria senha por `POST /auth/recuperacao/redefinir`, a mesma rota da
 * recuperação — porque é literalmente a mesma operação, e duas implementações da
 * mesma coisa divergem (RN-L29). Senha definida por terceiro é senha
 * compartilhada: quem a criou continua sabendo, e o dono não tem como provar que
 * não foi ele.
 *
 * **Permissão de perfil não é texto livre.** `permissoes` é validado contra o
 * catálogo (Anexo C.2) na fronteira e **de novo** por gatilho no banco, que
 * ainda recusa permissão de escrita em perfil de cliente (RN-L25). A fronteira
 * existe para dar mensagem melhor, não para ser a garantia.
 */

export const TIPO_USUARIO = ['INTERNO', 'CLIENTE'] as const
export const TipoUsuario = z.enum(TIPO_USUARIO)
export type TipoUsuario = z.infer<typeof TipoUsuario>

export const STATUS_USUARIO = ['ATIVO', 'INATIVO', 'SUSPENSO'] as const
export const StatusUsuario = z.enum(STATUS_USUARIO)
export type StatusUsuario = z.infer<typeof StatusUsuario>

/** Vínculo perfil × escopo. É a linha de `usuario_perfil`, não o perfil. */
export const PerfilAtribuido = z.object({
  perfil_id: Uuid,
  perfil_nome: z.string(),
  escopo_tipo: EscopoSchema,
  escopo_id: Uuid.nullable(),
})
export type PerfilAtribuido = z.infer<typeof PerfilAtribuido>

export const Usuario = z.object({
  id: Uuid,
  nome: z.string(),
  email: z.string().email(),
  telefone: z.string().nullable(),
  tipo: TipoUsuario,
  status: StatusUsuario,
  /** Preenchido só para usuário de cliente — e a ausência é significativa (D-01). */
  cliente_id: Uuid.nullable(),
  mfa_habilitado: z.boolean(),
  ultimo_acesso_em: DataHora.nullable(),
  /** Nunca definiu senha: o convite ainda não foi aceito. */
  convite_pendente: z.boolean(),
  perfis: z.array(PerfilAtribuido),
  version: z.number().int(),
})
export type Usuario = z.infer<typeof Usuario>

export const ListarUsuarios = Paginacao.extend({
  tipo: TipoUsuario.optional(),
  status: StatusUsuario.optional(),
  perfil_id: Uuid.optional(),
  cliente_id: Uuid.optional(),
  q: z.string().trim().min(2).max(120).optional(),
})
export type ListarUsuarios = z.infer<typeof ListarUsuarios>

/**
 * O vínculo pedido no convite e na atribuição.
 *
 * `escopo_id` acompanha o tipo, e a coerência entre os dois é do banco
 * (`usuario_perfil_escopo_coerente`): `TENANT`, `PROPRIO` e `CLIENTE` não levam
 * id — o cliente vem do token —, os demais exigem.
 */
export const VinculoPerfil = z.object({
  perfil_id: Uuid,
  escopo_tipo: EscopoSchema,
  escopo_id: Uuid.nullish(),
})
export type VinculoPerfil = z.infer<typeof VinculoPerfil>

export const ConvidarUsuario = z.object({
  nome: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(200),
  telefone: z.string().trim().max(40).nullish(),
  tipo: TipoUsuario.default('INTERNO'),
  /** Obrigatório quando `tipo` é CLIENTE, proibido quando é INTERNO. */
  cliente_id: Uuid.nullish(),
  perfis: z.array(VinculoPerfil).min(1, 'um usuário sem perfil não consegue fazer nada'),
})
export type ConvidarUsuario = z.infer<typeof ConvidarUsuario>

/*
 * O convite **não devolve o token**.
 *
 * Ele vai por e-mail, pela fila de notificação da migração 0018, e por lugar
 * nenhum mais. Devolvê-lo no corpo o colocaria no proxy, no devtools de quem
 * chamou e em qualquer log de cliente — e um token de primeiro acesso vazado é
 * a conta de outra pessoa. A resposta é o usuário criado, como em qualquer
 * `POST`; o que aconteceu com o convite se acompanha pela notificação.
 */

export const AtualizarUsuario = z
  .object({
    nome: z.string().trim().min(1).max(200),
    telefone: z.string().trim().max(40).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'informe ao menos um campo' })
export type AtualizarUsuario = z.infer<typeof AtualizarUsuario>

/**
 * Desativar exige motivo; ativar não.
 *
 * A assimetria é proposital: desativar tira o acesso de alguém e é o evento que
 * se investiga depois. RN-L30 — o usuário nunca é apagado, porque `audit_log`
 * referencia o autor.
 */
export const DesativarUsuario = z.object({
  motivo: z.string().trim().min(3).max(500),
})
export type DesativarUsuario = z.infer<typeof DesativarUsuario>

/*
 * Revogar sessões usa `RevogarSessoes` de `auth.ts`, que já tem exatamente esta
 * forma. Declarar uma segunda aqui daria dois esquemas para a mesma operação — a
 * duplicação que este pacote existe para não ter.
 */

/* -------------------------------------------------------------------- perfis */

export const TIPO_PERFIL = ['INTERNO', 'CLIENTE'] as const
export const TipoPerfil = z.enum(TIPO_PERFIL)
export type TipoPerfil = z.infer<typeof TipoPerfil>

export const Perfil = z.object({
  id: Uuid,
  nome: z.string(),
  descricao: z.string().nullable(),
  tipo: TipoPerfil,
  /** Perfil de sistema é estrutural: atribuível, nunca editável. */
  is_sistema: z.boolean(),
  permissoes: z.array(PermissaoSchema),
  /** Quantos usuários o têm — o número que decide se dá para mexer nele. */
  usuarios: z.number().int(),
})
export type Perfil = z.infer<typeof Perfil>

export const ListarPerfis = Paginacao.extend({
  tipo: TipoPerfil.optional(),
})
export type ListarPerfis = z.infer<typeof ListarPerfis>

export const CriarPerfil = z.object({
  nome: z.string().trim().min(1).max(120),
  descricao: z.string().trim().max(500).nullish(),
  tipo: TipoPerfil.default('INTERNO'),
  /*
   * Permissões desconhecidas **derrubam** a criação, ao contrário do que
   * acontece com o token (onde são descartadas).
   *
   * A assimetria é deliberada. Descartar num token é negar, que é o padrão
   * seguro; descartar aqui gravaria um perfil silenciosamente menor do que quem
   * o criou pediu, e a pessoa só descobriria quando alguém reclamasse de um
   * botão ausente.
   */
  permissoes: z.array(PermissaoSchema).default([]),
})
export type CriarPerfil = z.infer<typeof CriarPerfil>

export const AtualizarPerfil = z
  .object({
    nome: z.string().trim().min(1).max(120),
    descricao: z.string().trim().max(500).nullable(),
    permissoes: z.array(PermissaoSchema),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'informe ao menos um campo' })
export type AtualizarPerfil = z.infer<typeof AtualizarPerfil>
