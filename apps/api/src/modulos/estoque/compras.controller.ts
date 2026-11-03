import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import {
  AbrirInventario,
  CancelarInventario,
  CancelarOrdemCompra,
  CriarOrdemCompra,
  ListarInventarios,
  ListarOrdensCompra,
  ReceberOrdemCompra,
  RegistrarContagem,
} from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { ComprasService } from './compras.service.js'

/**
 * `EST` — ordem de compra e inventário (Anexo D.6).
 *
 * As três permissões da compra são três rotas, pela mesma razão de sempre:
 * `ordem_compra:criar`, `:aprovar` e `:receber` só significam coisas
 * diferentes se forem ações diferentes. Com um `PATCH status`, quem criasse a
 * ordem a aprovaria e a receberia sozinho — e a alçada de compra, que é o
 * único controle sobre quanto se gasta, seria exercida por quem gasta.
 *
 * O inventário segue o mesmo desenho: `inventario:executar` conta e
 * `inventario:aprovar` transforma a contagem em ajuste de saldo. É a
 * segregação que impede alguém de corrigir o estoque para o número que lhe
 * convém e aprovar a própria correção.
 */
@Controller('api/v1')
export class ComprasController {
  constructor(private readonly servico: ComprasService) {}

  /* --------------------------------------------------- ordem de compra --- */

  @Get('ordens-compra')
  @ExigePermissao('ordem_compra:criar')
  listarOrdens(@Query(validar(ListarOrdensCompra)) filtro: ListarOrdensCompra) {
    return this.servico.listarOrdens(filtro)
  }

  /**
   * Cria a ordem com os itens. Idempotente: a ordem é um compromisso de
   * compra, e duas iguais por um timeout de rede viram mercadoria em dobro.
   */
  @Post('ordens-compra')
  @HttpCode(201)
  @ExigePermissao('ordem_compra:criar')
  @Idempotente()
  criarOrdem(@Body(validar(CriarOrdemCompra)) corpo: CriarOrdemCompra) {
    return this.servico.criarOrdem(corpo)
  }

  @Get('ordens-compra/:id')
  @ExigePermissao('ordem_compra:criar')
  ordemPorId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.ordemPorId(id)
  }

  /** Alçada sobre o valor da ordem — conferida no gatilho da 0036. */
  @Post('ordens-compra/:id/aprovar')
  @HttpCode(200)
  @ExigePermissao('ordem_compra:aprovar')
  aprovarOrdem(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.aprovarOrdem(id)
  }

  /**
   * Recebimento total ou parcial. A quantidade é acumulada, e a entrada no
   * estoque é o mesmo fato — gerada pelo gatilho, não por uma segunda chamada.
   */
  @Post('ordens-compra/:id/receber')
  @HttpCode(200)
  @ExigePermissao('ordem_compra:receber')
  @Idempotente()
  receberOrdem(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(ReceberOrdemCompra)) corpo: ReceberOrdemCompra,
  ) {
    return this.servico.receberOrdem(id, corpo)
  }

  @Post('ordens-compra/:id/cancelar')
  @HttpCode(200)
  @ExigePermissao('ordem_compra:aprovar')
  cancelarOrdem(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(CancelarOrdemCompra)) corpo: CancelarOrdemCompra,
  ) {
    return this.servico.cancelarOrdem(id, corpo)
  }

  /* -------------------------------------------------------- inventário --- */

  @Get('inventarios')
  @ExigePermissao('inventario:executar')
  listarInventarios(@Query(validar(ListarInventarios)) filtro: ListarInventarios) {
    return this.servico.listarInventarios(filtro)
  }

  @Post('inventarios')
  @HttpCode(201)
  @ExigePermissao('inventario:executar')
  @Idempotente()
  abrirInventario(@Body(validar(AbrirInventario)) corpo: AbrirInventario) {
    return this.servico.abrirInventario(corpo)
  }

  @Get('inventarios/:id')
  @ExigePermissao('inventario:executar')
  inventarioPorId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.inventarioPorId(id)
  }

  /**
   * Registra a contagem de uma peça. O saldo do sistema é congelado aqui pelo
   * servidor: aceitá-lo do cliente permitiria declarar a divergência em vez de
   * medi-la.
   */
  @Post('inventarios/:id/contagens')
  @HttpCode(200)
  @ExigePermissao('inventario:executar')
  registrarContagem(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(RegistrarContagem)) corpo: RegistrarContagem,
  ) {
    return this.servico.registrarContagem(id, corpo)
  }

  @Post('inventarios/:id/fechar')
  @HttpCode(200)
  @ExigePermissao('inventario:executar')
  fecharContagem(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.fecharContagem(id)
  }

  /**
   * Aprovação: é aqui que a contagem vira ajuste de saldo. Permissão própria
   * porque quem conta não aprova a própria contagem — sem isso, corrigir o
   * estoque para o número conveniente seria uma operação de uma pessoa só.
   */
  @Post('inventarios/:id/aprovar')
  @HttpCode(200)
  @ExigePermissao('inventario:aprovar')
  aprovarInventario(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.aprovarInventario(id)
  }

  @Post('inventarios/:id/cancelar')
  @HttpCode(200)
  @ExigePermissao('inventario:aprovar')
  cancelarInventario(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(CancelarInventario)) corpo: CancelarInventario,
  ) {
    return this.servico.cancelarInventario(id, corpo)
  }
}
