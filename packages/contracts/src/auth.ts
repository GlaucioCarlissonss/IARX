import { z } from 'zod'
import { DataHora, Uuid } from './primitivos.js'
import { PermissaoSchema } from './permissoes.js'

/**
 * Autenticação própria (D-07, revertida para implementação interna).
 *
 * O que estes esquemas deliberadamente **não** fazem: validar a força da senha
 * no cliente. A regra de tamanho mínimo é do locatário (`tenant.politica_senha`,
 * migração 0015) e só o servidor a conhece — validar aqui exigiria embutir a
 * política no contrato compartilhado, e ela deixaria de ser configuração.
 *
 * O mínimo absoluto de 12 caracteres aparece assim mesmo, como piso: é o mesmo
 * valor que o banco recusa configurar abaixo, e checá-lo antes de sair do
 * navegador poupa uma ida à rede para o erro mais comum.
 */

export const Login = z.object({
  email: z.string().trim().toLowerCase().email(),
  senha: z.string().min(1, 'informe a senha'),
})
export type Login = z.infer<typeof Login>

/**
 * Resposta do login.
 *
 * `deve_trocar_senha` vem junto do token, e não numa consulta seguinte, porque
 * a aplicação precisa desviar o usuário para a troca **antes** de mostrar
 * qualquer tela — uma segunda requisição abriria a janela em que ele já está
 * dentro com uma senha que deveria ter expirado.
 */
export const RespostaLogin = z.object({
  token: z.string(),
  expira_em: DataHora,
  deve_trocar_senha: z.boolean(),
  usuario: z.object({
    id: Uuid,
    nome: z.string(),
    email: z.string(),
    tipo: z.enum(['INTERNO', 'CLIENTE']),
    cliente_id: Uuid.nullable(),
  }),
  permissoes: z.array(PermissaoSchema),
})
export type RespostaLogin = z.infer<typeof RespostaLogin>

export const TrocarSenha = z.object({
  senha_atual: z.string().min(1),
  senha_nova: z.string().min(12, 'a senha precisa de ao menos 12 caracteres'),
})
export type TrocarSenha = z.infer<typeof TrocarSenha>

export const SolicitarRecuperacao = z.object({
  email: z.string().trim().toLowerCase().email(),
})
export type SolicitarRecuperacao = z.infer<typeof SolicitarRecuperacao>

export const RedefinirSenha = z.object({
  token: z.string().min(1),
  senha_nova: z.string().min(12, 'a senha precisa de ao menos 12 caracteres'),
})
export type RedefinirSenha = z.infer<typeof RedefinirSenha>

export const Sessao = z.object({
  id: Uuid,
  usuario_id: Uuid,
  criada_em: DataHora,
  expira_em: DataHora,
  ultima_atividade_em: DataHora,
  revogada_em: DataHora.nullable(),
  revogacao_motivo: z.string().nullable(),
  ip: z.string().nullable(),
  user_agent: z.string().nullable(),
})
export type Sessao = z.infer<typeof Sessao>

export const RevogarSessoes = z.object({
  motivo: z.string().trim().min(3, 'descreva o motivo da revogação'),
})
export type RevogarSessoes = z.infer<typeof RevogarSessoes>

/**
 * Política de senha do locatário.
 *
 * Os pisos repetem os do banco de propósito: a validação existe nos dois
 * lugares porque servem a propósitos diferentes. Aqui ela dá mensagem de campo
 * a quem preenche o formulário; lá ela impede que qualquer caminho de escrita
 * — inclusive um script de migração — configure uma política insegura.
 */
export const PoliticaSenha = z.object({
  tamanho_minimo: z.number().int().min(12),
  expira_em_dias: z.number().int().min(30).nullable(),
  tentativas_ate_bloquear: z.number().int().min(3),
  bloqueio_minutos: z.number().int().min(1),
  exige_troca_no_primeiro_acesso: z.boolean(),
})
export type PoliticaSenha = z.infer<typeof PoliticaSenha>
