import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { createHash } from 'node:crypto'
import { firstValueFrom, of, type Observable } from 'rxjs'
import type { Request, Response } from 'express'
import { BancoService } from '../banco/banco.service.js'
import { CHAVE_IDEMPOTENTE } from './decoradores.js'
import { exigirContexto } from './contexto.js'
import { ErroDominio } from './erros.js'
import { SQLSTATE_UNICO, ehErroPg } from '../banco/sqlstate.js'

interface LinhaIdempotencia {
  hash_payload: string
  status: 'EM_ANDAMENTO' | 'CONCLUIDA'
  status_http: number | null
  resposta: unknown
}

/**
 * Idempotência de POST com efeito financeiro/operacional (RN-029, Anexo D.1).
 *
 * O cenário concreto: a alocação é criada, a resposta se perde no caminho, o
 * cliente vê timeout e reenvia. Sem controle, nasce um segundo item de contrato
 * — e, no fechamento, uma segunda cobrança.
 *
 * O mecanismo é o índice único `(tenant_id, chave)`: duas requisições
 * simultâneas com a mesma chave disputam o INSERT e exatamente uma vence. Não é
 * preciso lock explícito nem coordenação entre instâncias da API; o banco já é
 * o ponto de serialização.
 *
 * Três desfechos, todos deliberados:
 *
 *  - mesma chave, mesmo payload, já concluída → devolve a resposta guardada,
 *    com `Idempotency-Replayed: true`;
 *  - mesma chave, payload diferente → 409 `IDEMPOTENCIA_DIVERGENTE`. Reusar a
 *    chave para outro conteúdo é defeito do cliente, e devolver a resposta
 *    antiga em silêncio esconderia o defeito;
 *  - mesma chave, ainda em andamento → 409 `IDEMPOTENCIA_EM_ANDAMENTO`, com
 *    `Retry-After`.
 *
 * Falha **libera** a chave em vez de guardar o erro. A alternativa envenenaria
 * a chave: o cliente corrigiria o payload, reenviaria com a mesma chave e
 * receberia `IDEMPOTENCIA_DIVERGENTE` em vez do resultado. Como nada foi
 * commitado no caminho de erro, reexecutar é seguro.
 */
@Injectable()
export class IdempotenciaInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly banco: BancoService,
  ) {}

  async intercept(contexto: ExecutionContext, proximo: CallHandler): Promise<Observable<unknown>> {
    const exigido = this.reflector.getAllAndOverride<boolean>(CHAVE_IDEMPOTENTE, [
      contexto.getHandler(),
      contexto.getClass(),
    ])
    if (!exigido) return proximo.handle()

    const ctx = exigirContexto()
    const chave = ctx.idempotencyKey
    if (!chave || chave.length < 8 || chave.length > 200) {
      throw new ErroDominio('PAYLOAD_INVALIDO', 'Idempotency-Key obrigatória', {
        detail:
          'Esta operação tem efeito financeiro/operacional e exige o cabeçalho Idempotency-Key com 8 a 200 caracteres (RN-029).',
      })
    }

    const http = contexto.switchToHttp()
    const req = http.getRequest<Request>()
    const res = http.getResponse<Response>()
    const hash = hashPayload(req.body)

    const existente = await this.reservar(chave, hash, ctx.rota, ctx.metodo)
    if (existente) return of(this.resolverExistente(existente, hash, res))

    try {
      const resultado = await firstValueFrom(proximo.handle())
      await this.concluir(chave, res.statusCode, resultado)
      return of(resultado)
    } catch (e) {
      await this.liberar(chave)
      throw e
    }
  }

  /** Devolve a linha existente quando a chave já estava reservada; nulo se venceu a disputa. */
  private async reservar(
    chave: string,
    hash: string,
    rota: string,
    metodo: string,
  ): Promise<LinhaIdempotencia | null> {
    try {
      await this.banco.escritaAuxiliar((db) =>
        db.consultar(
          `insert into public.requisicao_idempotente
             (tenant_id, chave, metodo, rota, hash_payload, usuario_id, request_id)
           values (app.exigir_tenant(), $1, $2, $3, $4, app.usuario_atual(), app.request_id_atual())`,
          [chave, metodo, rota, hash],
        ),
      )
      return null
    } catch (e) {
      const conflito =
        (e instanceof ErroDominio && e.code === 'IDEMPOTENCIA_EM_ANDAMENTO') ||
        (ehErroPg(e) && e.code === SQLSTATE_UNICO)
      if (!conflito) throw e

      const linha = await this.banco.escritaAuxiliar((db) =>
        db.consultarUm<LinhaIdempotencia & Record<string, unknown>>(
          `select hash_payload, status, status_http, resposta
             from public.requisicao_idempotente
            where chave = $1 and tenant_id = app.exigir_tenant()`,
          [chave],
        ),
      )
      // A linha pode ter expirado e sido removida entre o INSERT e o SELECT.
      // Nesse caso não há o que reproduzir: seguir para o handler é correto.
      return linha ?? null
    }
  }

  private resolverExistente(linha: LinhaIdempotencia, hash: string, res: Response): unknown {
    if (linha.hash_payload !== hash) {
      throw new ErroDominio('IDEMPOTENCIA_DIVERGENTE', 'Idempotency-Key reutilizada com outro conteúdo', {
        detail: 'A mesma chave já foi usada para uma requisição com corpo diferente. Gere uma nova chave.',
      })
    }

    if (linha.status === 'EM_ANDAMENTO') {
      res.setHeader('Retry-After', '2')
      throw new ErroDominio('IDEMPOTENCIA_EM_ANDAMENTO', 'Requisição idêntica em processamento', {
        detail: 'Outra requisição com esta chave ainda está sendo processada. Tente novamente em instantes.',
      })
    }

    res.status(linha.status_http ?? 200)
    res.setHeader('Idempotency-Replayed', 'true')
    return linha.resposta
  }

  private async concluir(chave: string, statusHttp: number, resposta: unknown): Promise<void> {
    await this.banco.escritaAuxiliar((db) =>
      db.consultar(
        `update public.requisicao_idempotente
            set status = 'CONCLUIDA', status_http = $2, resposta = $3::jsonb, concluida_em = now()
          where chave = $1 and tenant_id = app.exigir_tenant()`,
        [chave, statusHttp, JSON.stringify(resposta ?? null)],
      ),
    )
  }

  private async liberar(chave: string): Promise<void> {
    await this.banco
      .escritaAuxiliar((db) =>
        db.consultar(
          `delete from public.requisicao_idempotente
            where chave = $1 and tenant_id = app.exigir_tenant() and status = 'EM_ANDAMENTO'`,
          [chave],
        ),
      )
      .catch(() => undefined)
  }
}

/**
 * Hash do corpo com chaves ordenadas.
 *
 * A ordenação importa: dois clientes que serializam o mesmo objeto em ordens
 * diferentes enviam bytes diferentes, e sem canonicalização o reenvio legítimo
 * seria acusado de divergência.
 */
function hashPayload(corpo: unknown): string {
  return createHash('sha256').update(canonicalizar(corpo)).digest('hex')
}

function canonicalizar(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(canonicalizar).join(',')}]`
  const entradas = Object.entries(v as Record<string, unknown>)
    .filter(([, valor]) => valor !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entradas.map(([k, valor]) => `${JSON.stringify(k)}:${canonicalizar(valor)}`).join(',')}}`
}
