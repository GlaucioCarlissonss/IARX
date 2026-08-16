import { SetMetadata } from '@nestjs/common'
import type { Permissao } from '@iarx/contracts'

export const CHAVE_PUBLICO = 'iarx:publico'
export const CHAVE_PERMISSAO = 'iarx:permissao'
export const CHAVE_IDEMPOTENTE = 'iarx:idempotente'
export const CHAVE_ESCOPO_PROPRIO = 'iarx:escopo-proprio'

/**
 * Rota sem autenticação. Explícita e rara — saúde e metadados públicos.
 *
 * A negação é o padrão: a guarda exige autenticação em tudo, e só este
 * decorador abre exceção. O inverso (marcar o que é protegido) esquece rotas
 * novas em silêncio.
 */
export const Publico = () => SetMetadata(CHAVE_PUBLICO, true)

/**
 * Permissão exigida pela rota (`recurso:ação`, Anexo C).
 *
 * Uma rota autenticada **sem** este decorador é recusada pela guarda. Não é
 * rigor decorativo: a falha mais comum em autorização não é a regra errada, é a
 * regra ausente — e ausência silenciosa vira rota aberta.
 */
export const ExigePermissao = (permissao: Permissao) => SetMetadata(CHAVE_PERMISSAO, permissao)

/**
 * Rota autenticada que age **sobre o próprio usuário**, sem permissão do
 * catálogo.
 *
 * Existe para um caso estreito e real: trocar a própria senha. Amarrá-lo a uma
 * permissão criaria a situação absurda de um perfil incapaz de trocar a senha
 * que usa para entrar — e a permissão mais próxima, `usuario:gerenciar`, é
 * justamente a de administrar **outros** usuários.
 *
 * Não é uma brecha: a guarda continua exigindo autenticação, e o serviço opera
 * sobre `claims.usuario_id`, nunca sobre um id vindo do corpo. O que este
 * decorador dispensa é a checagem de catálogo, não a de identidade.
 *
 * Deliberadamente sem parâmetro: qualquer argumento aqui viraria a porta para
 * "próprio, mas também aquilo ali".
 */
export const EscopoProprio = () => SetMetadata(CHAVE_ESCOPO_PROPRIO, true)

/**
 * Marca a rota como de efeito financeiro/operacional: exige `Idempotency-Key`
 * (RN-029) e passa a ter a resposta reproduzível.
 */
export const Idempotente = () => SetMetadata(CHAVE_IDEMPOTENTE, true)
