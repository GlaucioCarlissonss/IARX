import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import {
  DefinirPolitica,
  ListarMovimentos,
  ListarPecas,
  RegistrarAjuste,
  RegistrarMovimento,
  SolicitarPeca,
} from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { ErroDominio } from '../../comum/erros.js'
import { validar } from '../../comum/zod.pipe.js'
import { EstoqueService } from './estoque.service.js'

/**
 * `EST` — peças, depósitos, saldo e movimento.
 *
 * **Não existe rota que escreva saldo.** O saldo é projeção do movimento
 * (RN-017); um `PATCH /saldos` recriaria pela porta da frente o caminho de
 * divergência que o banco fecha. Corrigir saldo é registrar um
 * `AJUSTE_INVENTARIO` com motivo — mais trabalhoso de propósito, porque ajuste
 * de estoque sem explicação é a linha que alguém vai auditar.
 *
 * O movimento usa `estoque:movimentar`, e o ajuste de inventário a sua própria
 * (`estoque:ajustar`) — a distinção já estava no Anexo C e é a que separa
 * "dar baixa do que saiu" de "declarar que a contagem estava errada".
 */
@Controller('api/v1')
export class EstoqueController {
  constructor(private readonly servico: EstoqueService) {}

  @Get('pecas')
  @ExigePermissao('peca:ler')
  pecas(@Query(validar(ListarPecas)) filtro: ListarPecas) {
    return this.servico.pecas(filtro)
  }

  @Get('depositos')
  @ExigePermissao('peca:ler')
  depositos() {
    return this.servico.depositos()
  }

  @Get('pecas/:id/saldos')
  @ExigePermissao('peca:ler')
  saldosDaPeca(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.saldos(id)
  }

  @Get('movimentos-estoque')
  @ExigePermissao('peca:ler')
  movimentos(@Query(validar(ListarMovimentos)) filtro: ListarMovimentos) {
    return this.servico.movimentos(filtro)
  }

  /**
   * Movimento de estoque, menos o ajuste.
   *
   * A recusa explícita é o que faz a separação valer. `RegistrarMovimento`
   * aceita o enum inteiro porque é o contrato da tabela; se esta rota o
   * aceitasse também, `estoque:ajustar` seguiria existindo no catálogo sem
   * significar nada — quem pudesse movimentar ajustaria, que é precisamente a
   * distinção que o Anexo C faz.
   */
  @Post('movimentos-estoque')
  @ExigePermissao('estoque:movimentar')
  registrar(@Body(validar(RegistrarMovimento)) corpo: RegistrarMovimento) {
    if (corpo.tipo === 'AJUSTE_INVENTARIO') {
      throw new ErroDominio('SEM_PERMISSAO', 'Ajuste de inventário tem rota própria', {
        detail:
          'Ajuste é o único movimento que cria ou destrói quantidade sem contrapartida, e exige `estoque:ajustar`.',
        errors: [{ field: 'tipo', code: 'ROTA_INCORRETA' }],
        acoes: [{ code: 'USAR_AJUSTES', descricao: 'Registrar por POST /estoque/ajustes' }],
      })
    }
    return this.servico.registrarMovimento(corpo)
  }

  @Post('estoque/ajustes')
  @HttpCode(201)
  @ExigePermissao('estoque:ajustar')
  @Idempotente()
  ajustar(@Body(validar(RegistrarAjuste)) corpo: RegistrarAjuste) {
    return this.servico.registrarAjuste(corpo)
  }

  /* ------------------------------------------- política de reposição --- */

  @Get('estoque/politicas')
  @ExigePermissao('peca:ler')
  politicas(@Query('peca_id') pecaId?: string) {
    return this.servico.politicas(pecaId)
  }

  /**
   * `PUT` porque a política é atributo do par (peça, depósito), não evento.
   * Definir duas vezes a mesma política tem de deixar uma.
   */
  @Put('estoque/politicas')
  @HttpCode(200)
  @ExigePermissao('estoque:politica_definir')
  definirPolitica(@Body(validar(DefinirPolitica)) corpo: DefinirPolitica) {
    return this.servico.definirPolitica(corpo)
  }

  /** Sugestões de compra (RN-016), derivadas no instante da consulta. */
  @Get('estoque/reposicao')
  @ExigePermissao('peca:ler')
  reposicao() {
    return this.servico.sugestoesReposicao()
  }

  /* --------------------------------------------- reserva de peça na OS --- */

  @Get('ordens-servico/:id/pecas')
  @ExigePermissao('os:ler')
  pecasDaOs(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.pecasDaOs(id)
  }

  /**
   * Pede a peça para a ordem. Nasce SOLICITADA (Anexo B.5) — quem pede é quem
   * executa, quem atende é quem tem o almoxarifado.
   */
  @Post('ordens-servico/:id/pecas')
  @HttpCode(201)
  @ExigePermissao('estoque:reservar')
  @Idempotente()
  solicitarPeca(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(SolicitarPeca)) corpo: SolicitarPeca,
  ) {
    return this.servico.solicitarPeca(id, corpo)
  }

  @Post('ordens-servico/:id/pecas/:itemId/reservar')
  @HttpCode(200)
  @ExigePermissao('estoque:reservar')
  reservarPeca(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ) {
    return this.servico.mudarStatusPeca(id, itemId, 'RESERVADA')
  }

  /** Sem saldo: a OS vai para AGUARDANDO_PEÇA e a reposição é alertada. */
  @Post('ordens-servico/:id/pecas/:itemId/em-falta')
  @HttpCode(200)
  @ExigePermissao('estoque:reservar')
  pecaEmFalta(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ) {
    return this.servico.mudarStatusPeca(id, itemId, 'EM_FALTA')
  }

  /**
   * Baixa: físico cai, o movimento `SAIDA_OS` nasce com o custo médio do
   * instante, e o custo entra na ordem. Os três efeitos são do gatilho.
   */
  @Post('ordens-servico/:id/pecas/:itemId/consumir')
  @HttpCode(200)
  @ExigePermissao('estoque:reservar')
  @Idempotente()
  consumirPeca(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ) {
    return this.servico.mudarStatusPeca(id, itemId, 'CONSUMIDA')
  }

  @Post('ordens-servico/:id/pecas/:itemId/devolver')
  @HttpCode(200)
  @ExigePermissao('estoque:reservar')
  devolverPeca(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ) {
    return this.servico.mudarStatusPeca(id, itemId, 'DEVOLVIDA')
  }

  @Post('ordens-servico/:id/pecas/:itemId/cancelar')
  @HttpCode(200)
  @ExigePermissao('estoque:reservar')
  cancelarPeca(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ) {
    return this.servico.mudarStatusPeca(id, itemId, 'CANCELADA')
  }
}
