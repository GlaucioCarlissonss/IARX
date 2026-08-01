import { Controller, Get } from '@nestjs/common'
import { BancoService } from '../../banco/banco.service.js'
import { Publico } from '../../comum/decoradores.js'

/**
 * Sondas de saúde.
 *
 * Separadas de propósito. `/vivo` responde enquanto o processo estiver de pé e
 * é o que o orquestrador usa para decidir **reiniciar**. `/pronto` verifica o
 * banco e é o que decide **mandar tráfego**. Se as duas fossem a mesma coisa,
 * uma indisponibilidade momentânea do banco derrubaria e reiniciaria todas as
 * instâncias ao mesmo tempo — trocando uma degradação por uma queda total.
 */
@Controller()
export class SaudeController {
  constructor(private readonly banco: BancoService) {}

  @Get('vivo')
  @Publico()
  vivo() {
    return { status: 'ok', uptime_s: Math.round(process.uptime()) }
  }

  @Get('pronto')
  @Publico()
  async pronto() {
    const banco = await this.banco.ping()
    return { status: banco ? 'ok' : 'degradado', banco }
  }
}
