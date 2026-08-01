import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { AlocarItem, ListarContratos } from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { ContratosService } from './contratos.service.js'

/** `CTR` — Contratos e alocação de itens (Anexo D.2). */
@Controller('api/v1/contratos')
export class ContratosController {
  constructor(private readonly servico: ContratosService) {}

  @Get()
  @ExigePermissao('contrato:ler')
  listar(@Query(validar(ListarContratos)) filtro: ListarContratos) {
    return this.servico.listar(filtro)
  }

  @Get(':id')
  @ExigePermissao('contrato:ler')
  porId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.porId(id)
  }

  @Get(':id/itens')
  @ExigePermissao('contrato:ler')
  itens(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.itens(id)
  }

  /**
   * Alocação de equipamento. Idempotente por exigência: criar item de contrato
   * duas vezes por causa de um timeout de rede vira cobrança duplicada no
   * fechamento (RN-029).
   */
  @Post(':id/itens')
  @HttpCode(201)
  @ExigePermissao('contrato:item_alocar')
  @Idempotente()
  alocar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(AlocarItem)) corpo: AlocarItem,
  ) {
    return this.servico.alocarItem(id, corpo)
  }
}
