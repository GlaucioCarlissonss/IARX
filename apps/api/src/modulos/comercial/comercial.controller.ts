import { Controller, Get, Query } from '@nestjs/common'
import { ListarDescontos } from '@iarx/contracts'
import { ExigePermissao } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { ComercialService } from './comercial.service.js'

/**
 * `COM` — política comercial: o que a tabela diz e o que se abriu mão.
 *
 * As duas rotas pedem `comercial:ler`, e não uma permissão de contrato. A
 * distinção é a que importa aqui: ler **um** contrato mostra o preço daquele
 * cliente; ler a política mostra a régua inteira da locadora, inclusive o que
 * se cobra de quem não é aquele cliente. São exposições de natureza diferente,
 * e a segunda é a que um vendedor levaria embora ao sair.
 */
@Controller('api/v1/comercial')
export class ComercialController {
  constructor(private readonly servico: ComercialService) {}

  @Get('politica')
  @ExigePermissao('comercial:ler')
  politica() {
    return this.servico.politica()
  }

  /**
   * Os descontos concedidos.
   *
   * Rota própria, e não um campo da política: desconto é **concessão**, não
   * tabela. Mistura-los faria "qual é o nosso preço" e "quanto abrimos mão"
   * parecerem a mesma pergunta — e é justamente a diferença entre as duas que
   * a revisão de margem procura.
   */
  @Get('descontos')
  @ExigePermissao('comercial:ler')
  descontos(@Query(validar(ListarDescontos)) filtro: ListarDescontos) {
    return this.servico.descontos(filtro)
  }
}
