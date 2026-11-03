import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { ConsultarAuditoria, DefinirAlcada, ListarAlcadas, ReabrirCompetencia } from '@iarx/contracts'
import { ExigePermissao } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { AdministracaoService } from './administracao.service.js'

/**
 * `ADM` — alçadas e trilha de auditoria (Anexo C §C.7, RN-018).
 *
 * Seis regras do sistema consultam `alcada`, e todas seguem a mesma convenção:
 * a alçada **só morde onde foi configurada**. Sem rota de configuração, as seis
 * ficam permanentemente desligadas em qualquer locatário que não tenha quem
 * escreva `INSERT` no banco — a regra existe, o teste prova que funciona, e na
 * prática ela nunca é exercida.
 */
@Controller('api/v1')
export class AdministracaoController {
  constructor(private readonly servico: AdministracaoService) {}

  @Get('alcadas')
  @ExigePermissao('alcada:definir')
  listarAlcadas(@Query(validar(ListarAlcadas)) filtro: ListarAlcadas) {
    return this.servico.listarAlcadas(filtro)
  }

  /** `PUT` porque a alçada é atributo do par (perfil, tipo), não evento. */
  @Put('alcadas')
  @HttpCode(200)
  @ExigePermissao('alcada:definir')
  definirAlcada(@Body(validar(DefinirAlcada)) corpo: DefinirAlcada) {
    return this.servico.definirAlcada(corpo)
  }

  /**
   * Remover **desliga a regra** para aquele perfil — alçada ausente não morde.
   * Rota própria, e não um `PUT` com limite nulo, porque é uma decisão que
   * precisa poder ser explicada depois.
   */
  @Delete('alcadas/:id')
  @HttpCode(204)
  @ExigePermissao('alcada:definir')
  removerAlcada(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.removerAlcada(id)
  }

  /**
   * Trilha de auditoria. Só leitura, e só isso: o log é imutável "por qualquer
   * perfil, inclusive administrador" (RN-018), e uma rota de escrita negaria a
   * frase que torna a trilha útil.
   */
  @Get('auditoria')
  @ExigePermissao('auditoria:consultar')
  consultarAuditoria(@Query(validar(ConsultarAuditoria)) filtro: ConsultarAuditoria) {
    return this.servico.consultarAuditoria(filtro)
  }

  /**
   * Reabre a competência (Anexo B §B.6: "apenas por alçada").
   *
   * Fica sob `/competencias` e não sob `/contas-receber` pela mesma razão que o
   * fechamento: a competência é da medição, e o faturamento é consequência.
   */
  @Post('competencias/:competencia/reabrir')
  @HttpCode(200)
  @ExigePermissao('competencia:reabrir')
  reabrirCompetencia(
    @Param('competencia') competencia: string,
    @Body(validar(ReabrirCompetencia)) corpo: ReabrirCompetencia,
  ) {
    return this.servico.reabrirCompetencia(competencia, corpo.motivo)
  }
}
