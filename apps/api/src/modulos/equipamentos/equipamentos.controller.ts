import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { BloquearEquipamento, ListarEquipamentos } from '@iarx/contracts'
import { ExigePermissao } from '../../comum/decoradores.js'
import { versaoDe } from '../../comum/versao.js'
import { validar } from '../../comum/zod.pipe.js'
import { EquipamentosService } from './equipamentos.service.js'

/**
 * `EQP` — Equipamentos.
 *
 * Transições de estado são **sub-recursos de ação** (`/bloquear`), nunca PATCH
 * de campo `status` (Anexo D.1). A diferença é prática, não estética: com ação
 * explícita a permissão é granular (`equipamento:bloquear` ≠
 * `equipamento:editar`), a máquina de estados fica declarada no roteamento, e a
 * auditoria registra a intenção — "bloqueou por preventiva vencida" — em vez de
 * um diff de coluna.
 */
@Controller('api/v1/equipamentos')
export class EquipamentosController {
  constructor(private readonly servico: EquipamentosService) {}

  @Get()
  @ExigePermissao('equipamento:ler')
  listar(@Query(validar(ListarEquipamentos)) filtro: ListarEquipamentos) {
    return this.servico.listar(filtro)
  }

  @Get(':id')
  @ExigePermissao('equipamento:ler')
  porId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.porId(id)
  }

  @Post(':id/bloquear')
  @ExigePermissao('equipamento:bloquear')
  bloquear(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(BloquearEquipamento)) corpo: { motivo: string; ate: string | null },
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.bloquear(id, versaoDe(ifMatch), corpo.motivo, corpo.ate)
  }

  @Post(':id/desbloquear')
  @ExigePermissao('equipamento:desbloquear')
  desbloquear(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.desbloquear(id, versaoDe(ifMatch))
  }
}
