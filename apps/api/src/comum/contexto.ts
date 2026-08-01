import { AsyncLocalStorage } from 'node:async_hooks'
import type { Claims } from '@iarx/contracts'
import type { PoolClient } from 'pg'

/**
 * Contexto da requisição.
 *
 * Por que AsyncLocalStorage e não provider com escopo REQUEST do Nest:
 * um provider REQUEST-scoped contamina toda a cadeia de injeção acima dele —
 * qualquer serviço que o receba também vira REQUEST-scoped, e o Nest passa a
 * instanciar a árvore inteira por requisição. O custo aparece justamente sob
 * carga. Com ALS todos os providers continuam singleton e o contexto viaja
 * junto da continuação assíncrona.
 *
 * O que vive aqui é exatamente o que precisa atravessar camadas sem virar
 * parâmetro de toda função: identidade, correlação e a conexão da transação.
 */
export interface ContextoRequisicao {
  readonly requestId: string
  readonly metodo: string
  readonly rota: string
  claims: Claims | null
  /** Conexão dedicada da transação corrente. Nula fora de transação. */
  db: PoolClient | null
  /** Chave de idempotência declarada pelo cliente, se houver. */
  idempotencyKey: string | null
}

const armazenamento = new AsyncLocalStorage<ContextoRequisicao>()

export function executarComContexto<T>(ctx: ContextoRequisicao, fn: () => T): T {
  return armazenamento.run(ctx, fn)
}

/** Contexto corrente, ou nulo fora do ciclo de uma requisição (jobs, testes). */
export function contextoAtual(): ContextoRequisicao | null {
  return armazenamento.getStore() ?? null
}

/**
 * Contexto corrente, exigindo que exista.
 *
 * A ausência aqui é sempre defeito de programação — código de requisição
 * chamado fora do middleware — e não condição de runtime a tratar. Por isso
 * lança em vez de devolver nulo.
 */
export function exigirContexto(): ContextoRequisicao {
  const ctx = armazenamento.getStore()
  if (!ctx) throw new Error('contexto de requisição ausente: chamada fora do ciclo HTTP')
  return ctx
}

/** Claims autenticadas da requisição. Só é chamada após a guarda de autenticação. */
export function exigirClaims(): Claims {
  const { claims } = exigirContexto()
  if (!claims) throw new Error('claims ausentes: rota alcançada sem guarda de autenticação')
  return claims
}
