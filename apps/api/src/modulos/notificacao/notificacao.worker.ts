import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { BancoService } from '../../banco/banco.service.js'
import { remetenteDoAmbiente, type Remetente } from './remetente.js'

interface LinhaFila extends Record<string, unknown> {
  id: string
  tenant_id: string
  canal: 'EMAIL' | 'IN_APP'
  usuario_id: string | null
  destino: string | null
  assunto: string
  corpo_texto: string
  corpo_html: string | null
  tentativas: number
}

export interface ResultadoDrenagem {
  reservadas: number
  enviadas: number
  falhas: number
}

/**
 * Worker da fila de notificação.
 *
 * Atravessa locatários — é um processo servindo todos —, e por isso opera pela
 * superfície fechada de `security definer` da migração 0018, não por consulta
 * direta. A alternativa seria uma conexão sem RLS na aplicação, disponível para
 * qualquer erro futuro reaproveitar.
 *
 * O laço é deliberadamente simples: reservar um lote, enviar um por um,
 * concluir ou falhar cada um. Nada de paralelismo por mensagem — o gargalo é o
 * provedor de e-mail, e mandar dez ao mesmo tempo para um provedor que limita
 * conexões troca lentidão por erro de limite.
 */
@Injectable()
export class NotificacaoWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('NotificacaoWorker')
  private readonly identidade = `${hostname()}/${process.pid}/${randomUUID().slice(0, 8)}`
  private temporizador: NodeJS.Timeout | null = null
  private drenando = false
  private remetente: Remetente | null = null

  constructor(private readonly banco: BancoService) {}

  /**
   * O worker não sobe em teste, e é por isso que a variável existe.
   *
   * A suíte de integração chama `drenar()` diretamente: um laço de fundo
   * disparando durante os testes tornaria cada asserção sobre a fila uma
   * corrida contra ele — o teste enfileira, o worker envia antes da asserção, e
   * a falha aparece de forma intermitente.
   */
  private get intervaloMs(): number {
    return Number(process.env['NOTIFICACAO_INTERVALO_MS'] ?? 15_000)
  }

  private get lote(): number {
    return Number(process.env['NOTIFICACAO_LOTE'] ?? 20)
  }

  onModuleInit(): void {
    if (process.env['NOTIFICACAO_WORKER'] === 'desligado') {
      this.log.log('worker desligado por NOTIFICACAO_WORKER=desligado')
      return
    }

    try {
      this.remetente = remetenteDoAmbiente()
    } catch (e) {
      /*
       * Configuração inválida derruba o worker, não a API.
       *
       * A API continua aceitando requisições e enfileirando avisos — que ficam
       * na fila até alguém corrigir a variável. O contrário (derrubar o
       * processo) tornaria uma configuração de e-mail errada em indisponibilidade
       * total do sistema, o que é uma troca ruim.
       */
      this.log.error(`worker não iniciou: ${(e as Error).message}`)
      return
    }

    this.log.log(`worker ativo (${this.remetente.nome}), a cada ${this.intervaloMs}ms`)
    this.temporizador = setInterval(() => void this.tick(), this.intervaloMs)
    // Sem `unref`, o temporizador segura o event loop e o processo não encerra
    // — nem em `Ctrl+C`, nem no encerramento gracioso do orquestrador.
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
      this.log.error(`falha ao drenar a fila: ${(e as Error).message}`)
    } finally {
      this.drenando = false
    }
  }

  /**
   * Reserva e processa um lote. Devolve o que aconteceu, para o teste poder
   * afirmar sobre o resultado em vez de esperar por um log.
   */
  async drenar(remetente: Remetente | null = this.remetente): Promise<ResultadoDrenagem> {
    if (!remetente) return { reservadas: 0, enviadas: 0, falhas: 0 }

    const fila = await this.banco.semContexto((db) =>
      db.consultar<LinhaFila>(`select * from app.notificacao_reservar_lote($1, $2)`, [
        this.lote,
        this.identidade,
      ]),
    )

    let enviadas = 0
    let falhas = 0

    for (const n of fila) {
      try {
        /*
         * Caixa interna não tem envio: a reserva e a conclusão existem para que
         * ela apareça no mesmo relatório de entrega que o e-mail, com a mesma
         * data. Sem passar pela fila, "avisado" significaria coisas diferentes
         * em cada canal.
         */
        if (n.canal === 'EMAIL') {
          if (!n.destino) throw new Error('notificação de e-mail sem destino')
          await remetente.enviar({
            para: n.destino,
            assunto: n.assunto,
            texto: n.corpo_texto,
            html: n.corpo_html,
          })
        }

        await this.banco.semContexto((db) =>
          db.consultar(`select app.notificacao_concluir($1)`, [n.id]),
        )
        enviadas++
      } catch (e) {
        falhas++
        const motivo = (e as Error).message ?? 'falha desconhecida'
        /*
         * A falha é registrada numa transação própria, pela mesma razão que o
         * registro de tentativa de login: dentro da transação do envio, o erro
         * desfaria o próprio registro do erro, e o contador de tentativas
         * nunca sairia de zero.
         */
        await this.banco
          .semContexto((db) => db.consultar(`select app.notificacao_falhar($1, $2)`, [n.id, motivo]))
          .catch((erroAoRegistrar) =>
            this.log.error(`não foi possível registrar a falha de ${n.id}: ${erroAoRegistrar}`),
          )
      }
    }

    if (fila.length > 0) {
      this.log.log(`lote: ${fila.length} reservada(s), ${enviadas} enviada(s), ${falhas} falha(s)`)
    }
    return { reservadas: fila.length, enviadas, falhas }
  }
}
