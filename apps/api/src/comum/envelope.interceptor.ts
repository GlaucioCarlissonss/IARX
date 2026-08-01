import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common'
import { map, type Observable } from 'rxjs'
import { Pagina } from './pagina.js'

/**
 * Envelope de resposta do Anexo D.1: `{ data }` para recurso único,
 * `{ data, meta }` para coleção.
 *
 * O envelope não é enfeite: sem ele, acrescentar `meta` a uma resposta que hoje
 * é um array puro é mudança incompatível. Com ele, `meta` cresce sem quebrar
 * ninguém — e é por isso que a decisão precisa ser tomada na primeira versão.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_contexto: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    return proximo.handle().pipe(
      map((valor) => {
        if (valor === undefined || valor === null) return valor
        if (valor instanceof Pagina) return { data: valor.itens, meta: valor.meta }
        return { data: valor }
      }),
    )
  }
}
