import { SetMetadata } from '@nestjs/common'
import type { Permissao } from '@iarx/contracts'

export const CHAVE_PUBLICO = 'iarx:publico'
export const CHAVE_PERMISSAO = 'iarx:permissao'
export const CHAVE_IDEMPOTENTE = 'iarx:idempotente'

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
 * Marca a rota como de efeito financeiro/operacional: exige `Idempotency-Key`
 * (RN-029) e passa a ter a resposta reproduzível.
 */
export const Idempotente = () => SetMetadata(CHAVE_IDEMPOTENTE, true)
