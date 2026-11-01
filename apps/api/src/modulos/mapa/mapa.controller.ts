import { Controller, Get, Query } from '@nestjs/common'
import { ConsultarMapa } from '@iarx/contracts'
import { ExigePermissao } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { MapaService } from './mapa.service.js'

/**
 * `MAP` — distribuição geográfica do parque.
 *
 * Permissão `mapa:ler`, que já estava no catálogo e não tinha rota. Não é
 * `cliente:ler` nem `equipamento:ler`: o mapa mostra **onde está tudo de uma
 * vez**, e essa é uma exposição de outra natureza — a lista de endereços de
 * todos os clientes com o tamanho do parque de cada um é o que um concorrente
 * pagaria para ter.
 */
@Controller('api/v1/mapa')
export class MapaController {
  constructor(private readonly servico: MapaService) {}

  @Get('pontos')
  @ExigePermissao('mapa:ler')
  pontos(@Query(validar(ConsultarMapa)) filtro: ConsultarMapa) {
    return this.servico.consultar(filtro)
  }
}
