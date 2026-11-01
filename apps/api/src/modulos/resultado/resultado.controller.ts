import { Controller, Get, Query } from '@nestjs/common'
import { ConsultarResultado } from '@iarx/contracts'
import { ExigePermissao } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { ResultadoService } from './resultado.service.js'

/**
 * `RES` — resultado operacional.
 *
 * `financeiro:rentabilidade_ler`, que estava no catálogo sem rota. Separada de
 * `financeiro:painel_executivo` de propósito: o painel mostra totais, a
 * rentabilidade mostra **margem por cliente** — e saber quais clientes dão
 * prejuízo é a informação mais sensível que esta base guarda, tanto para
 * negociar quanto para levar embora.
 *
 * A lista por cliente vem ordenada pela pior margem, que é a ordem em que ela
 * é útil: ninguém abre este relatório para ver quem está bem.
 */
@Controller('api/v1/resultado')
export class ResultadoController {
  constructor(private readonly servico: ResultadoService) {}

  @Get()
  @ExigePermissao('financeiro:rentabilidade_ler')
  consultar(@Query(validar(ConsultarResultado)) filtro: ConsultarResultado) {
    return this.servico.consultar(filtro)
  }
}
