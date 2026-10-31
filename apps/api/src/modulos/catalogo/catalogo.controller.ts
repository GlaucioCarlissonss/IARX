import { Controller, Get } from '@nestjs/common'
import { ExigePermissao } from '../../comum/decoradores.js'
import { CatalogoService } from './catalogo.service.js'

/**
 * `CAT` — o vocabulário do parque.
 *
 * Permissão: `equipamento:ler`, e não `catalogo:gerenciar`.
 *
 * A escolha merece justificativa porque a permissão de nome parecido existe.
 * `catalogo:gerenciar` é a de **editar** o catálogo — criar modelo, cadastrar
 * fabricante. Exigi-la para ler transformaria todo formulário que mostra um
 * modelo num formulário privativo de quem administra o cadastro: o técnico que
 * só consulta equipamento veria o `<select>` vazio, e concluiria que não há
 * modelos.
 *
 * Quem pode ler equipamento precisa poder ler o vocabulário com que o
 * equipamento é descrito. É a mesma leitura, uma camada acima.
 */
@Controller('api/v1/catalogo')
export class CatalogoController {
  constructor(private readonly servico: CatalogoService) {}

  @Get()
  @ExigePermissao('equipamento:ler')
  tudo() {
    return this.servico.tudo()
  }
}
