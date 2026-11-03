import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import {
  AbrirOs,
  AgendarOs,
  AtribuirOs,
  CancelarOs,
  ConcluirOs,
  ListarOs,
  PausarOs,
  ReabrirOs,
  TriarOs,
} from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { ManutencaoService } from './manutencao.service.js'

/**
 * `MNT` — ordens de serviço.
 *
 * Cada transição é uma ação nomeada com permissão própria, e não um
 * `PATCH status`. O Anexo C já previa as doze permissões separadas —
 * `os:triar` não é `os:agendar`, que não é `os:validar` — e um único `PATCH`
 * tornaria todas elas a mesma coisa na prática: quem pudesse mudar o status
 * poderia levar a OS de ponta a ponta sozinho, o que é exatamente o que
 * RN-027 existe para impedir.
 *
 * Todas respondem 200 e não 201: a OS já existe e já tem URL. O que a ação faz
 * é mudar o estado dela, não criar recurso novo.
 */
@Controller('api/v1')
export class ManutencaoController {
  constructor(private readonly servico: ManutencaoService) {}

  @Get('tecnicos')
  @ExigePermissao('os:ler')
  tecnicos() {
    return this.servico.tecnicos()
  }

  @Get('ordens-servico')
  @ExigePermissao('os:ler')
  listar(@Query(validar(ListarOs)) filtro: ListarOs) {
    return this.servico.listar(filtro)
  }

  @Get('ordens-servico/:id')
  @ExigePermissao('os:ler')
  porId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.porId(id)
  }

  @Post('ordens-servico')
  @ExigePermissao('os:criar')
  abrir(@Body(validar(AbrirOs)) corpo: AbrirOs) {
    return this.servico.abrir(corpo)
  }

  @Post('ordens-servico/:id/triar')
  @HttpCode(200)
  @ExigePermissao('os:triar')
  triar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(TriarOs)) corpo: TriarOs,
  ) {
    return this.servico.triar(id, corpo)
  }

  @Post('ordens-servico/:id/agendar')
  @HttpCode(200)
  @ExigePermissao('os:agendar')
  agendar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(AgendarOs)) corpo: AgendarOs,
  ) {
    return this.servico.agendar(id, corpo)
  }

  /** Check-in: é ele que marca `resposta_em` e fecha o SLA de resposta. */
  @Post('ordens-servico/:id/iniciar')
  @HttpCode(200)
  @ExigePermissao('os:executar')
  iniciar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.iniciar(id)
  }

  @Post('ordens-servico/:id/pausar')
  @HttpCode(200)
  @ExigePermissao('os:sla_pausar')
  pausar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(PausarOs)) corpo: PausarOs,
  ) {
    return this.servico.pausar(id, corpo)
  }

  @Post('ordens-servico/:id/retomar')
  @HttpCode(200)
  @ExigePermissao('os:sla_pausar')
  retomar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.retomar(id)
  }

  @Post('ordens-servico/:id/concluir')
  @HttpCode(200)
  @ExigePermissao('os:concluir')
  concluir(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(ConcluirOs)) corpo: ConcluirOs,
  ) {
    return this.servico.concluir(id, corpo)
  }

  /**
   * Validação — permissão própria, e é a que sustenta RN-027.
   *
   * Sem corpo de propósito: quem validou vem das claims. Aceitar o id do
   * validador no corpo faria a segregação entre executor e validador ser
   * cumprida por quem quisesse, bastando informar outro nome.
   */
  @Post('ordens-servico/:id/validar')
  @HttpCode(200)
  @ExigePermissao('os:validar')
  validarOs(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.validar(id)
  }

  /**
   * Troca o técnico responsável sem mexer na janela de atendimento. Quem
   * despacha decide quem vai; a data se negocia com o cliente.
   */
  @Post('ordens-servico/:id/atribuir')
  @HttpCode(200)
  @ExigePermissao('os:atribuir')
  atribuir(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(AtribuirOs)) corpo: AtribuirOs,
  ) {
    return this.servico.atribuir(id, corpo)
  }

  /**
   * Reincidência: cria uma OS nova vinculada à validada (Anexo B.3). Devolve a
   * nova, que é onde quem reabriu vai trabalhar.
   */
  @Post('ordens-servico/:id/reabrir')
  @HttpCode(201)
  @ExigePermissao('os:reabrir')
  @Idempotente()
  reabrir(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(ReabrirOs)) corpo: ReabrirOs,
  ) {
    return this.servico.reabrir(id, corpo)
  }

  @Post('ordens-servico/:id/cancelar')
  @HttpCode(200)
  @ExigePermissao('os:cancelar')
  cancelar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(CancelarOs)) corpo: CancelarOs,
  ) {
    return this.servico.cancelar(id, corpo)
  }
}
