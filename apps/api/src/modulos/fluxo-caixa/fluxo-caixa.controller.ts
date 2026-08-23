import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common'
import { ConsultarAlertas, ConsultarProjecao, CriarCenarioCaixa } from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { FluxoCaixaService } from './fluxo-caixa.service.js'

/**
 * `FXC` — Fluxo de caixa projetado.
 *
 * `financeiro:painel_executivo` em todas: a projeção consolida a posição de caixa
 * da locadora inteira. Quem vê o gráfico vê a margem, a concentração de
 * vencimento e a previsão de despesa — é a leitura mais reveladora do sistema, e
 * exigir dela apenas `pagar:ler` daria a quem confere boletos o retrato completo
 * da operação.
 *
 * Nenhuma rota escreve posição diária, porque não existe onde: a projeção é
 * função, e recalculá-la a cada leitura é o que faz o número estar certo depois
 * da baixa registrada há um minuto.
 */
@Controller('api/v1/fluxo-caixa')
export class FluxoCaixaController {
  constructor(private readonly servico: FluxoCaixaService) {}

  @Get('projecao')
  @ExigePermissao('financeiro:painel_executivo')
  projecao(@Query(validar(ConsultarProjecao)) consulta: ConsultarProjecao) {
    return this.servico.projetar(consulta)
  }

  @Get('alertas')
  @ExigePermissao('financeiro:painel_executivo')
  alertas(@Query(validar(ConsultarAlertas)) consulta: ConsultarAlertas) {
    return this.servico.alertas(consulta)
  }
}

@Controller('api/v1/cenarios-caixa')
export class CenariosCaixaController {
  constructor(private readonly servico: FluxoCaixaService) {}

  @Get()
  @ExigePermissao('financeiro:painel_executivo')
  listar() {
    return this.servico.listarCenarios()
  }

  @Post()
  @HttpCode(201)
  @Idempotente()
  @ExigePermissao('financeiro:painel_executivo')
  criar(@Body(validar(CriarCenarioCaixa)) corpo: CriarCenarioCaixa) {
    return this.servico.criarCenario(corpo)
  }
}
