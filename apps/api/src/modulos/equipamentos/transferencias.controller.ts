import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ListarTransferenciasPendentes } from '@iarx/contracts'
import { ExigePermissao } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { MovimentacaoService } from './movimentacao.service.js'

/**
 * `EQP` — transferências entre filiais (Anexo D §EQP, RN-005).
 *
 * Controlador próprio e não sub-recurso de `/equipamentos/{id}` porque o aceite
 * é feito **no destino**, por quem recebe. Quem aceita tem a lista de
 * pendências da sua filial na mão, não o identificador do ativo — e um caminho
 * `/equipamentos/{id}/aceitar` obrigaria a descobrir o ativo para aceitar a
 * transferência dele, que é a ordem inversa do que acontece na doca.
 *
 * O `{id}` aqui é o da movimentação. Não existe tabela `transferencia`: ela é
 * uma movimentação `TRANSFERENCIA` com `aceite_em`/`aceite_por` (Anexo A.5).
 */
@Controller('api/v1/transferencias')
export class TransferenciasController {
  constructor(private readonly servico: MovimentacaoService) {}

  @Get()
  @ExigePermissao('equipamento:ler')
  pendentes(@Query(validar(ListarTransferenciasPendentes)) filtro: ListarTransferenciasPendentes) {
    return this.servico.pendentes(filtro)
  }

  /**
   * Aceite no destino. É aqui que a filial do ativo muda e ele volta a ser
   * alocável — pela filial que o recebeu.
   */
  @Post(':id/aceitar')
  @HttpCode(200)
  @ExigePermissao('equipamento:transferencia_aceitar')
  aceitar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.aceitar(id)
  }
}
