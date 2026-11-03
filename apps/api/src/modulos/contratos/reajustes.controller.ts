import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ListarReajustes, RenunciarReajuste } from '@iarx/contracts'
import { ExigePermissao } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { ReajustesService } from './reajustes.service.js'

/**
 * `CTR` — reajustes, vistos de fora do contrato.
 *
 * Existe além do sub-recurso `/contratos/{id}/reajustes` porque a operação que
 * esta tela serve é "o que está esperando decisão este mês", e essa pergunta
 * atravessa contratos. Obrigar a abrir contrato por contrato para encontrar as
 * propostas pendentes é o caminho mais curto para o indicador de receita
 * renunciada (KPI-34) crescer sem ninguém ver.
 */
@Controller('api/v1/reajustes')
export class ReajustesController {
  constructor(private readonly servico: ReajustesService) {}

  @Get()
  @ExigePermissao('contrato:ler')
  listar(@Query(validar(ListarReajustes)) filtro: ListarReajustes) {
    return this.servico.listar(filtro)
  }

  /**
   * Aprovação com alçada (RN-008). Separada de propor: proposta que já nasce
   * aprovada torna a alçada decorativa.
   */
  @Post(':id/aprovar')
  @HttpCode(200)
  @ExigePermissao('contrato:reajuste_aprovar')
  aprovar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.aprovar(id)
  }

  /**
   * Aplicação: reescreve o valor unitário dos itens vigentes, com o
   * arredondamento de RN-008. O efeito mora no gatilho da 0033.
   */
  @Post(':id/aplicar')
  @HttpCode(200)
  @ExigePermissao('contrato:reajuste_aprovar')
  aplicar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.aplicar(id)
  }

  /**
   * Renúncia: decisão explícita de não cobrar, com motivo.
   *
   * Não é cancelar a proposta — é registrar quanto se deixou de cobrar e por
   * quê. A linha permanece, porque é dela que sai o KPI-34.
   */
  @Post(':id/renunciar')
  @HttpCode(200)
  @ExigePermissao('contrato:reajuste_aprovar')
  renunciar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(RenunciarReajuste)) corpo: RenunciarReajuste,
  ) {
    return this.servico.renunciar(id, corpo)
  }
}
