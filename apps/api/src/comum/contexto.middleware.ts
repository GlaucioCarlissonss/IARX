import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { executarComContexto, type ContextoRequisicao } from './contexto.js'

/**
 * Estabelece o contexto da requisição antes de qualquer guarda.
 *
 * Middleware, e não interceptor, por ordem de execução: no Nest a cadeia é
 * middleware → guardas → interceptors → pipes → handler. A guarda de
 * autenticação precisa escrever as claims no contexto, então o contexto tem que
 * existir antes dela.
 */
@Injectable()
export class ContextoMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const ctx: ContextoRequisicao = {
      requestId: identificarRequisicao(req),
      metodo: req.method,
      rota: req.originalUrl.split('?')[0] ?? req.originalUrl,
      claims: null,
      db: null,
      idempotencyKey: cabecalho(req, 'idempotency-key'),
    }

    // Ecoar antes de seguir: se a requisição falhar mais adiante, o cliente
    // ainda tem o identificador para citar no suporte.
    res.setHeader('X-Request-Id', ctx.requestId)

    executarComContexto(ctx, () => next())
  }
}

/**
 * Aceita o `X-Request-Id` do cliente para permitir correlação ponta a ponta,
 * mas **sanitizado e truncado**: o valor vai para log estruturado e para
 * `app.request_id` no banco, e um cliente hostil não pode injetar quebra de
 * linha para forjar entradas de log.
 */
function identificarRequisicao(req: Request): string {
  const informado = cabecalho(req, 'x-request-id')
  if (!informado) return `req_${randomUUID()}`
  const limpo = informado.replace(/[^\w.:-]/g, '').slice(0, 64)
  return limpo.length >= 8 ? limpo : `req_${randomUUID()}`
}

function cabecalho(req: Request, nome: string): string | null {
  const v = req.headers[nome]
  if (Array.isArray(v)) return v[0] ?? null
  return typeof v === 'string' && v.length > 0 ? v : null
}
