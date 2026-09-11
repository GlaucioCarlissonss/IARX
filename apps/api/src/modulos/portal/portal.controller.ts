import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common'
import {
  Competencia,
  ListarConsumo,
  ListarContratosDoCliente,
  ListarCustos,
  ListarEquipamentosDoCliente,
} from '@iarx/contracts'
import { ExigePermissao } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { PortalService } from './portal.service.js'

/**
 * `PTL` — Portal do cliente (Anexo L §Módulo 5, Anexo W).
 *
 * **Somente leitura, e o prefixo é a garantia auditável.** Toda rota de cliente
 * mora sob `/portal`; nenhuma escrita mora aqui. O único ato de escrita que o
 * cliente tem — abrir chamado (D-10) — depende do módulo de manutenção, que não
 * existe, e por isso não há um `POST` neste controlador em vez de um `POST` que
 * finge.
 *
 * As permissões são as da lista branca da 0011, e nenhuma nova: um perfil de
 * cliente não pode conter permissão fora dela, por gatilho. Uma rota de portal
 * que exigisse outra seria uma rota que nenhum cliente pode chamar — e ninguém
 * descobriria antes de o primeiro cliente tentar.
 */
@Controller('api/v1/portal')
export class PortalController {
  constructor(private readonly servico: PortalService) {}

  @Get('resumo')
  @ExigePermissao('contrato:ler')
  resumo() {
    return this.servico.resumo()
  }

  @Get('contratos')
  @ExigePermissao('contrato:ler')
  contratos(@Query(validar(ListarContratosDoCliente)) filtro: ListarContratosDoCliente) {
    return this.servico.contratos(filtro)
  }

  @Get('contratos/:id')
  @ExigePermissao('contrato:ler')
  contrato(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.contrato(id)
  }

  @Get('equipamentos')
  @ExigePermissao('equipamento:ler')
  equipamentos(@Query(validar(ListarEquipamentosDoCliente)) filtro: ListarEquipamentosDoCliente) {
    return this.servico.equipamentos(filtro)
  }

  @Get('consumo')
  @ExigePermissao('medicao:ler')
  consumo(@Query(validar(ListarConsumo)) filtro: ListarConsumo) {
    return this.servico.consumo(filtro)
  }

  @Get('custos')
  @ExigePermissao('fatura:ler')
  custos(@Query(validar(ListarCustos)) filtro: ListarCustos) {
    return this.servico.custos(filtro)
  }

  /**
   * Endereçada pela **competência**, não por id de fatura.
   *
   * O Anexo L escreveu `/portal/faturas/{id}/memoria`. O id não serve: a
   * competência aberta não tem cobrança nenhuma e é a que o cliente mais quer
   * conferir, e o que explica o valor é a medição, não o título.
   */
  @Get('custos/:competencia/memoria')
  @ExigePermissao('fatura:ler')
  memoria(@Param('competencia', validar(Competencia)) competencia: string) {
    return this.servico.memoria(competencia)
  }
}
