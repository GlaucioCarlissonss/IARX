import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ListarMovimentos, ListarPecas, RegistrarMovimento } from '@iarx/contracts'
import { ExigePermissao } from '../../comum/decoradores.js'
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

  @Post('movimentos-estoque')
  @ExigePermissao('estoque:movimentar')
  registrar(@Body(validar(RegistrarMovimento)) corpo: RegistrarMovimento) {
    return this.servico.registrarMovimento(corpo)
  }
}
