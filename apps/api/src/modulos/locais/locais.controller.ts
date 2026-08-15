import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { DefinirLocalizacao, ListarLocais } from '@iarx/contracts'
import { ExigePermissao } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { LocaisService } from './locais.service.js'

/**
 * `LOC` — Locais de operação e sua coordenada.
 *
 * Definir a coordenada é uma **ação** (`/localizacao`), e não um PATCH do campo
 * `lat`. A diferença é a mesma que rege o resto da API: a ação obriga a dizer de
 * onde o número veio, a permissão fica granular, e a auditoria registra a
 * intenção — "geocodificado a partir do endereço tal" — em vez de um diff de
 * duas colunas numéricas que ninguém consegue julgar depois.
 */
@Controller('api/v1/locais')
export class LocaisController {
  constructor(private readonly servico: LocaisService) {}

  @Get()
  @ExigePermissao('local_operacao:gerenciar')
  listar(@Query(validar(ListarLocais)) filtro: ListarLocais) {
    return this.servico.listar(filtro)
  }

  /**
   * Grava a coordenada.
   *
   * 200, e não o 201 padrão do Nest: o local já existe e já tem URL própria.
   * Nada é criado — a ação preenche um atributo dele.
   */
  @Post(':id/localizacao')
  @HttpCode(200)
  @ExigePermissao('local_operacao:gerenciar')
  definirLocalizacao(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(DefinirLocalizacao)) corpo: DefinirLocalizacao,
  ) {
    return this.servico.definirLocalizacao(id, corpo)
  }
}
