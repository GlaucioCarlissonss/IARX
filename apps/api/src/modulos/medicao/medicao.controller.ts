import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { EstornarLeitura, ListarLeituras, RegistrarLeituraMedidor } from '@iarx/contracts'
import { ExigePermissao } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { MedicaoService } from './medicao.service.js'

/**
 * `MED` — contadores e leituras.
 *
 * As leituras penduram no equipamento (`/equipamentos/:id/leituras`) porque é
 * assim que a pergunta aparece no campo: o técnico está diante de uma máquina,
 * não de um medidor. O medidor é detalhe interno de qual contador da máquina
 * ele está lendo, e vai no corpo.
 *
 * O estorno é rota de topo (`/leituras/:id/estornar`) pelo motivo inverso:
 * quem estorna está olhando uma leitura específica no histórico, e exigir o
 * equipamento na URL seria pedir um dado que ele já tem na mão por outro
 * caminho — e que, se vier errado, silenciosamente não encontra nada.
 */
@Controller('api/v1')
export class MedicaoController {
  constructor(private readonly servico: MedicaoService) {}

  @Get('equipamentos/:id/medidores')
  @ExigePermissao('medicao:ler')
  medidores(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.medidores(id)
  }

  @Get('equipamentos/:id/leituras')
  @ExigePermissao('medicao:ler')
  leituras(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query(validar(ListarLeituras)) filtro: ListarLeituras,
  ) {
    return this.servico.leituras(id, filtro)
  }

  @Post('equipamentos/:id/leituras')
  @ExigePermissao('equipamento:leitura_registrar')
  registrar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(RegistrarLeituraMedidor)) corpo: RegistrarLeituraMedidor,
  ) {
    return this.servico.registrar(id, corpo)
  }

  /**
   * Estorna.
   *
   * 200, e não 201: nada é criado. A leitura continua lá, marcada — e
   * deliberadamente não apagada, porque a fatura do mês passado saiu com
   * aquele número e apagá-lo removeria a única evidência de por que o valor
   * mudou. É a pergunta que alguém faz quando o cliente contesta.
   */
  @Post('leituras/:id/estornar')
  @HttpCode(200)
  @ExigePermissao('equipamento:leitura_estornar')
  estornar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EstornarLeitura)) corpo: EstornarLeitura,
  ) {
    return this.servico.estornar(id, corpo)
  }
}
