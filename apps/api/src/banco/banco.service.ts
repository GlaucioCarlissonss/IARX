import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import pg from 'pg'
import type { PoolClient, QueryResultRow } from 'pg'
import { contextoAtual, exigirContexto } from '../comum/contexto.js'
import { ErroDominio } from '../comum/erros.js'
import { traduzirErroPg } from './sqlstate.js'

const { Pool } = pg

/**
 * Interface mínima de execução. Repositórios recebem isto, não o Pool: assim
 * não têm como abrir uma transação própria por engano nem escapar do contexto
 * de tenant já estabelecido.
 */
export interface Executor {
  consultar<T extends QueryResultRow = QueryResultRow>(sql: string, valores?: unknown[]): Promise<T[]>
  consultarUm<T extends QueryResultRow = QueryResultRow>(sql: string, valores?: unknown[]): Promise<T | null>
}

interface ConfigBanco {
  connectionString: string
  max: number
  statementTimeoutMs: number
  transacaoOciosaTimeoutMs: number
}

function lerConfig(): ConfigBanco {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL não definida')
  return {
    connectionString: url,
    max: Number(process.env['DB_POOL_MAX'] ?? 10),
    statementTimeoutMs: Number(process.env['DB_STATEMENT_TIMEOUT_MS'] ?? 8000),
    transacaoOciosaTimeoutMs: Number(process.env['DB_IDLE_TX_TIMEOUT_MS'] ?? 10000),
  }
}

@Injectable()
export class BancoService implements OnModuleDestroy {
  private readonly log = new Logger(BancoService.name)
  private readonly config = lerConfig()
  private readonly pool = new Pool({
    connectionString: this.config.connectionString,
    max: this.config.max,
    // Encerra conexão ociosa: com pooler em modo transação, segurar conexão é
    // custo puro.
    idleTimeoutMillis: 30_000,
    application_name: 'iarx-api',
  })

  async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }

  /**
   * Executa `fn` dentro de uma transação com o contexto de tenant aplicado.
   *
   * Três decisões estruturais, cada uma resolvendo um modo de falha concreto:
   *
   * 1. `set_config(..., true)` — o terceiro argumento é `is_local`, equivalente
   *    a SET LOCAL: o valor morre no COMMIT/ROLLBACK. Um SET de sessão vazaria
   *    o tenant para a próxima requisição de outro usuário na mesma conexão,
   *    porque o Supavisor em modo transação devolve a conexão ao pool entre
   *    requisições. Esse vazamento é silencioso e catastrófico (RN-028).
   *
   * 2. `set_config` em vez de `SET LOCAL app.tenant_id = '...'` — SET não aceita
   *    parâmetro vinculado, o que obrigaria a interpolar o valor no SQL.
   *    `set_config($1, $2, true)` é parametrizado e portanto imune a injeção.
   *
   * 3. `statement_timeout` e `idle_in_transaction_session_timeout` por
   *    transação: uma consulta patológica ou um await esquecido no meio de uma
   *    transação seguram uma conexão do pool indefinidamente e, pior, seguram
   *    o horizonte do autovacuum.
   */
  async emTransacao<T>(fn: (db: Executor) => Promise<T>): Promise<T> {
    const ctx = exigirContexto()
    const claims = ctx.claims
    if (!claims) throw new Error('emTransacao chamada sem claims: falta a guarda de autenticação')

    const cliente = await this.pool.connect()
    const anterior = ctx.db
    try {
      await cliente.query('begin')
      // set_config em vez de SET LOCAL também aqui: SET não aceita parâmetro
      // vinculado, e interpolar o valor no SQL seria abrir uma porta por
      // conveniência. set_config cobre qualquer GUC, inclusive os de timeout.
      await cliente.query(
        `select set_config('statement_timeout',                    $1, true),
                set_config('idle_in_transaction_session_timeout',  $2, true)`,
        [String(this.config.statementTimeoutMs), String(this.config.transacaoOciosaTimeoutMs)],
      )
      await cliente.query(
        `select set_config('app.tenant_id',  $1, true),
                set_config('app.usuario_id', $2, true),
                set_config('app.request_id', $3, true),
                set_config('app.origem',     $4, true)`,
        [claims.tenant_id, claims.usuario_id, ctx.requestId, 'API'],
      )

      ctx.db = cliente
      const resultado = await fn(envolver(cliente))
      await cliente.query('commit')
      return resultado
    } catch (e) {
      await cliente.query('rollback').catch((err) => this.log.error(`falha no rollback: ${String(err)}`))
      throw this.traduzir(e)
    } finally {
      ctx.db = anterior
      cliente.release()
    }
  }

  /**
   * Consulta curta fora da transação de negócio, em conexão própria.
   *
   * Existe por um motivo específico: depois de um erro, a transação está
   * abortada e **nenhuma** consulta roda nela até o ROLLBACK. Para enriquecer a
   * mensagem de RN-001 com o contrato conflitante é preciso perguntar ao banco
   * de novo — e isso só é possível em outra transação. É leitura, o custo é uma
   * conexão por conflito, e o conflito é raro.
   */
  async leituraAuxiliar<T>(fn: (db: Executor) => Promise<T>, aoFalhar: T): Promise<T> {
    const ctx = contextoAtual()
    const tenant = ctx?.claims?.tenant_id
    if (!tenant) return aoFalhar

    const cliente = await this.pool.connect()
    try {
      await cliente.query('begin read only')
      await cliente.query(`select set_config('statement_timeout', '2000', true)`)
      await cliente.query(`select set_config('app.tenant_id', $1, true)`, [tenant])
      const r = await fn(envolver(cliente))
      await cliente.query('commit')
      return r
    } catch (e) {
      await cliente.query('rollback').catch(() => undefined)
      // Enriquecer a mensagem é melhoria, não requisito: se a consulta auxiliar
      // falhar, o erro original ainda precisa chegar ao cliente. Engolir aqui
      // evita substituir um 409 explicável por um 500 sem sentido.
      this.log.warn(`consulta auxiliar falhou, seguindo sem enriquecer: ${String(e)}`)
      return aoFalhar
    } finally {
      cliente.release()
    }
  }

  /**
   * Escrita curta em transação própria, isolada da transação de negócio.
   *
   * Usada pelo controle de idempotência, e o isolamento é o ponto inteiro: se o
   * registro da chave vivesse na mesma transação da operação, um rollback do
   * negócio apagaria também a marca de "já processei isto" — e o reenvio do
   * cliente executaria de novo, que é exatamente o que a idempotência existe
   * para impedir.
   */
  async escritaAuxiliar<T>(fn: (db: Executor) => Promise<T>): Promise<T> {
    const ctx = exigirContexto()
    const claims = ctx.claims
    if (!claims) throw new Error('escritaAuxiliar chamada sem claims')

    const cliente = await this.pool.connect()
    try {
      await cliente.query('begin')
      await cliente.query(`select set_config('statement_timeout', '3000', true)`)
      await cliente.query(
        `select set_config('app.tenant_id',  $1, true),
                set_config('app.usuario_id', $2, true),
                set_config('app.request_id', $3, true),
                set_config('app.origem',     $4, true)`,
        [claims.tenant_id, claims.usuario_id, ctx.requestId, 'API'],
      )
      const r = await fn(envolver(cliente))
      await cliente.query('commit')
      return r
    } catch (e) {
      await cliente.query('rollback').catch(() => undefined)
      throw this.traduzir(e)
    } finally {
      cliente.release()
    }
  }

  /** Verificação de vitalidade — não usa contexto nem tenant. */
  async ping(): Promise<boolean> {
    try {
      const r = await this.pool.query('select 1 as ok')
      return r.rows[0]?.['ok'] === 1
    } catch {
      return false
    }
  }

  private traduzir(e: unknown): unknown {
    if (e instanceof ErroDominio) return e
    const traduzido = traduzirErroPg(e)
    if (traduzido) return traduzido
    return e
  }
}

function envolver(cliente: PoolClient): Executor {
  return {
    async consultar<T extends QueryResultRow>(sql: string, valores: unknown[] = []): Promise<T[]> {
      const r = await cliente.query<T>(sql, valores)
      return r.rows
    },
    async consultarUm<T extends QueryResultRow>(sql: string, valores: unknown[] = []): Promise<T | null> {
      const r = await cliente.query<T>(sql, valores)
      return r.rows[0] ?? null
    },
  }
}
