import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { BancoService } from '../../banco/banco.service.js'

interface LinhaElegivel extends Record<string, unknown> {
  id: string
  tenant_id: string
  lado: 'PAGAR' | 'RECEBER'
  descricao: string
}

interface LinhaRecorrencia extends Record<string, unknown> {
  id: string
  tenant_id: string
}

export interface ResultadoConversaoLote {
  reservados: number
  convertidos: number
  recusados: number
  falhas: number
  gerados: number
}

/**
 * Worker de conversão de lançamentos futuros.
 *
 * Faz duas coisas por volta, e a ordem importa: primeiro **gera** o que as
 * recorrências devem produzir, depois **converte** o que já venceu. Invertida, um
 * lançamento gerado hoje com data de hoje só seria convertido na volta seguinte —
 * e num intervalo de quinze minutos isso é irrelevante, mas num agendador horário
 * atrasaria o título em uma hora sem razão nenhuma.
 *
 * **Como ele atravessa locatários sem uma conexão sem RLS.** A reserva do lote
 * passa pela superfície fechada de `security definer` da 0021
 * (`app.lancamentos_elegiveis`, `app.recorrencias_a_gerar`); a execução acontece
 * numa transação **por locatário**, com o papel `iarx_app` e a RLS valendo. Em vez
 * de um caminho que vê tudo, são N transações que veem um locatário cada.
 *
 * **Por que reservar e converter em transações diferentes não duplica título.** O
 * `for update skip locked` da reserva reduz o desperdício de dois processos
 * disputarem a mesma linha, mas a garantia não é dele: é do `for update` dentro
 * de `app.converter_lancamento_futuro`, que relê o estado antes de decidir. Se
 * dois workers reservarem o mesmo lançamento, o segundo recebe "Lançamento em
 * CONVERTIDO não se converte" — e é por isso que essa exceção é contada como
 * recusa, não como falha: ela é o mecanismo funcionando.
 */
@Injectable()
export class ConversaoWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ConversaoWorker')
  private temporizador: NodeJS.Timeout | null = null
  private drenando = false

  constructor(private readonly banco: BancoService) {}

  /**
   * O worker não sobe em teste, e é por isso que a variável existe.
   *
   * A suíte chama `drenar()` diretamente. Um laço de fundo disparando durante os
   * testes tornaria cada asserção sobre lançamento e título uma corrida contra
   * ele: o teste cria o lançamento, o worker converte antes da asserção, e a
   * falha aparece de forma intermitente — a pior classe de teste, porque parece
   * defeito do código. Foi a lição do worker de notificação.
   */
  private get intervaloMs(): number {
    return Number(process.env['CONVERSAO_INTERVALO_MS'] ?? 60_000)
  }

  private get lote(): number {
    return Number(process.env['CONVERSAO_LOTE'] ?? 50)
  }

  /** Antecedência da geração: a série produz o próximo antes de a data chegar. */
  private get antecedenciaDias(): number {
    return Number(process.env['CONVERSAO_ANTECEDENCIA_DIAS'] ?? 30)
  }

  onModuleInit(): void {
    if (process.env['CONVERSAO_WORKER'] === 'desligado') {
      this.log.log('worker desligado por CONVERSAO_WORKER=desligado')
      return
    }
    this.log.log(`worker ativo, a cada ${this.intervaloMs}ms`)
    this.temporizador = setInterval(() => void this.tick(), this.intervaloMs)
    // Sem `unref`, o temporizador segura o event loop e o processo não encerra —
    // nem em Ctrl+C, nem no encerramento gracioso do orquestrador.
    this.temporizador.unref()
  }

  onModuleDestroy(): void {
    if (this.temporizador) clearInterval(this.temporizador)
    this.temporizador = null
  }

  private async tick(): Promise<void> {
    // Reentrância: um lote lento não deve ter dois ticks sobrepostos disputando
    // a mesma fila. `skip locked` protege o banco, mas não evita o desperdício.
    if (this.drenando) return
    this.drenando = true
    try {
      await this.drenar()
    } catch (e) {
      this.log.error(`falha na volta de conversão: ${(e as Error).message}`)
    } finally {
      this.drenando = false
    }
  }

  /**
   * Uma volta completa. Devolve o que aconteceu, para o teste poder afirmar
   * sobre o resultado em vez de esperar por um log.
   */
  async drenar(): Promise<ResultadoConversaoLote> {
    const total: ResultadoConversaoLote = {
      reservados: 0,
      convertidos: 0,
      recusados: 0,
      falhas: 0,
      gerados: 0,
    }

    total.gerados = await this.gerarSeries()

    const elegiveis = await this.banco.semContexto((db) =>
      db.consultar<LinhaElegivel>(`select * from app.lancamentos_elegiveis($1)`, [this.lote]),
    )
    total.reservados = elegiveis.length
    if (elegiveis.length === 0) return total

    for (const [tenantId, lote] of agruparPorLocatario(elegiveis)) {
      /*
       * Um registro em `job_execucao` **por locatário**, e não um por volta.
       *
       * A tabela é isolada por RLS: uma linha sem locatário não seria legível por
       * ninguém, e "por que o lançamento de ontem não converteu" é justamente a
       * pergunta que alguém de dentro de um locatário faz.
       */
      const parcial = { convertidos: 0, recusados: 0, falhas: 0, motivos: [] as string[] }

      try {
        await this.banco.porLocatario(tenantId, async (db) => {
          const inicio = await db.consultarUm<{ id: string }>(
            `insert into public.job_execucao (tenant_id, tipo, parametros, status, inicio)
             values (app.tenant_atual(), 'CONVERSAO_LANCAMENTOS', $1::jsonb, 'EXECUTANDO', now())
             returning id`,
            [JSON.stringify({ lote: lote.length })],
          )

          for (const lf of lote) {
            /*
             * Um savepoint por lançamento, e ele é o que torna o laço possível.
             *
             * Em PostgreSQL, um erro aborta a transação **inteira**: sem o
             * savepoint, o primeiro lançamento com problema levaria consigo os
             * convertidos antes dele e o próprio registro em `job_execucao` —
             * apagando exatamente o rastro que responde por que não converteu.
             * Com ele, o `rollback to` desfaz só o lançamento que falhou.
             */
            await db.consultar('savepoint conversao_lf')
            try {
              const r = await db.consultarUm<{ titulo_id: string | null; excecao: string | null }>(
                `select titulo_id, excecao from app.converter_lancamento_futuro($1)`,
                [lf.id],
              )
              await db.consultar('release savepoint conversao_lf')
              if (r?.titulo_id) parcial.convertidos++
              else {
                parcial.recusados++
                if (r?.excecao) parcial.motivos.push(`${lf.id}: ${r.excecao}`)
              }
            } catch (e) {
              await db.consultar('rollback to savepoint conversao_lf')
              const mensagem = (e as Error).message ?? 'falha desconhecida'
              /*
               * "não se converte" é o outro worker tendo chegado primeiro — o
               * mecanismo de RN-F15 funcionando, não um erro. Contá-lo como falha
               * faria o painel de jobs acusar problema justamente quando a
               * proteção contra duplicidade agiu.
               */
              if (/não se converte/.test(mensagem)) {
                parcial.recusados++
              } else {
                parcial.falhas++
                parcial.motivos.push(`${lf.id}: ${mensagem}`)
              }
            }
          }

          await db.consultar(
            `update public.job_execucao
                set status = $2, fim = now(), resultado = $3::jsonb, erro = $4
              where id = $1`,
            [
              inicio!.id,
              parcial.falhas > 0 ? 'FALHOU' : 'CONCLUIDO',
              JSON.stringify({
                convertidos: parcial.convertidos,
                recusados: parcial.recusados,
                falhas: parcial.falhas,
              }),
              parcial.motivos.length > 0 ? parcial.motivos.join('\n') : null,
            ],
          )
        })
      } catch (e) {
        // A transação do locatário caiu inteira: os outros locatários seguem. É a
        // razão de a volta ser por locatário e não uma transação só.
        parcial.falhas = Math.max(parcial.falhas, 1)
        this.log.error(`locatário ${tenantId}: ${(e as Error).message}`)
      }

      total.convertidos += parcial.convertidos
      total.recusados += parcial.recusados
      total.falhas += parcial.falhas
    }

    this.log.log(
      `volta: ${total.gerados} gerado(s), ${total.reservados} reservado(s), ` +
        `${total.convertidos} convertido(s), ${total.recusados} recusado(s), ${total.falhas} falha(s)`,
    )
    return total
  }

  /**
   * Gera o que as séries devem produzir, uma chamada por recorrência.
   *
   * `app.gerar_proximo_lancamento` avança **um** período por chamada, e é
   * deliberado: gerar o lote inteiro criaria anos de lançamentos, cada um
   * aparecendo na projeção como compromisso firme quando o contrato pode nem
   * existir mais em dezembro do ano que vem (RN-F18).
   *
   * O laço interno tem teto: uma recorrência criada com data muito retroativa
   * precisa de várias chamadas para alcançar hoje, e sem teto uma data de 1970
   * geraria milhares de linhas numa volta.
   */
  private async gerarSeries(): Promise<number> {
    const pendentes = await this.banco.semContexto((db) =>
      db.consultar<LinhaRecorrencia>(`select * from app.recorrencias_a_gerar($1)`, [
        this.antecedenciaDias,
      ]),
    )
    if (pendentes.length === 0) return 0

    let gerados = 0
    for (const [tenantId, lote] of agruparPorLocatario(pendentes)) {
      try {
        await this.banco.porLocatario(tenantId, async (db) => {
          for (const r of lote) {
            await db.consultar('savepoint geracao_rec')
            try {
              gerados += await avancarSerie(db, r.id, this.antecedenciaDias)
              await db.consultar('release savepoint geracao_rec')
            } catch (e) {
              // Mesmo raciocínio do laço de conversão: uma série com cadastro
              // inconsistente não impede as outras de gerar.
              await db.consultar('rollback to savepoint geracao_rec')
              this.log.error(`série ${r.id}: ${(e as Error).message}`)
            }
          }
        })
      } catch (e) {
        this.log.error(`geração no locatário ${tenantId}: ${(e as Error).message}`)
      }
    }
    return gerados
  }
}

/**
 * Avança uma série até alcançar a antecedência, devolvendo quantos nasceram.
 *
 * O teto de 24 voltas existe porque uma recorrência cadastrada com data muito
 * retroativa precisa de várias chamadas para alcançar hoje — e sem teto uma data
 * de 1970 geraria milhares de linhas numa volta só do worker. Vinte e quatro é
 * dois anos de série mensal: o suficiente para recuperar um atraso real, e pouco
 * o bastante para um cadastro errado não virar carga.
 *
 * Duas execuções concorrentes não pulam período: `app.gerar_proximo_lancamento`
 * trava a recorrência e lê `proxima_geracao` **depois** do bloqueio, então a
 * segunda gera o período seguinte em vez de repetir ou saltar o mesmo. O efeito
 * de uma corrida é um período gerado mais cedo do que precisava, não um buraco na
 * série.
 */
async function avancarSerie(
  db: { consultarUm: <T extends Record<string, unknown>>(sql: string, v?: unknown[]) => Promise<T | null> },
  recorrenciaId: string,
  antecedenciaDias: number,
): Promise<number> {
  let gerados = 0
  for (let volta = 0; volta < 24; volta++) {
    const linha = await db.consultarUm<{ id: string | null; alcancou: boolean | null }>(
      `select app.gerar_proximo_lancamento($1) as id,
              (select proxima_geracao > current_date + make_interval(days => $2)
                 from public.recorrencia where id = $1) as alcancou`,
      [recorrenciaId, antecedenciaDias],
    )
    if (linha?.id) gerados++
    // `alcancou` nulo é recorrência que sumiu no meio da volta: parar é o certo.
    if (linha?.alcancou !== false) break
  }
  return gerados
}

/** Agrupa por locatário preservando a ordem em que o banco devolveu. */
function agruparPorLocatario<T extends { tenant_id: string }>(linhas: T[]): Map<string, T[]> {
  const grupos = new Map<string, T[]>()
  for (const l of linhas) {
    const atual = grupos.get(l.tenant_id)
    if (atual) atual.push(l)
    else grupos.set(l.tenant_id, [l])
  }
  return grupos
}
