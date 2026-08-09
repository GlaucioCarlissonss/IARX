import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { CancelarNota, CriarNotaFiscal, DefinirSeries, ListarNotasFiscais } from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { NotasFiscaisService } from './notas-fiscais.service.js'

/** `NFC` — Entrada fiscal de compra (Anexo L, Módulo 1; Anexo N). */
@Controller('api/v1/notas-fiscais')
export class NotasFiscaisController {
  constructor(private readonly servico: NotasFiscaisService) {}

  @Get()
  @ExigePermissao('nota_fiscal:ler')
  listar(@Query(validar(ListarNotasFiscais)) filtro: ListarNotasFiscais) {
    return this.servico.listar(filtro)
  }

  @Get(':id')
  @ExigePermissao('nota_fiscal:ler')
  porId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.porId(id)
  }

  /**
   * Lança a nota. Idempotente por exigência: relançar a mesma compra por causa
   * de um timeout duplicaria o patrimônio na integração seguinte (RN-029).
   */
  @Post()
  @HttpCode(201)
  @ExigePermissao('nota_fiscal:criar')
  @Idempotente()
  criar(@Body(validar(CriarNotaFiscal)) corpo: CriarNotaFiscal) {
    return this.servico.criar(corpo)
  }

  /** Identifica as unidades de um item — série e patrimônio de cada uma. */
  @Post(':id/itens/:itemId/series')
  // 200, não o 201 padrão do Nest: o comando substitui o conjunto de unidades
  // de um item que já existe, e devolve o item atualizado. Nada é criado no
  // sentido de ganhar uma URL própria.
  @HttpCode(200)
  @ExigePermissao('nota_fiscal:editar')
  definirSeries(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Body(validar(DefinirSeries)) corpo: DefinirSeries,
  ) {
    return this.servico.definirSeries(id, itemId, corpo)
  }

  /**
   * Conferência física. Permissão separada de `:criar` de propósito — quem
   * lança a nota não a confere (RN-027), e a regra é reforçada no serviço.
   */
  @Post(':id/conferir')
  @HttpCode(200)
  @ExigePermissao('nota_fiscal:conferir')
  conferir(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.conferir(id)
  }

  /**
   * Os ativos que serão criados, com valor rateado e garantia calculada.
   *
   * `GET` porque não muda nada — e é justamente por isso que existe: a
   * integração é irreversível, e conferir antes precisa ser barato.
   */
  @Get(':id/previa-integracao')
  @ExigePermissao('nota_fiscal:ler')
  previa(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.previa(id)
  }

  /** Cria os ativos e sela a nota. Idempotente: reenvio não duplica patrimônio. */
  @Post(':id/integrar')
  @HttpCode(201)
  @ExigePermissao('nota_fiscal:integrar')
  @Idempotente()
  integrar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.integrar(id)
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @ExigePermissao('nota_fiscal:cancelar')
  cancelar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(CancelarNota)) corpo: CancelarNota,
  ) {
    return this.servico.cancelar(id, corpo)
  }
}

/** `FOR` — Fornecedores, o cadastro de que a nota depende. */
@Controller('api/v1/fornecedores')
export class FornecedoresController {
  constructor(private readonly servico: NotasFiscaisService) {}

  @Get()
  @ExigePermissao('fornecedor:ler')
  listar() {
    return this.servico.fornecedores()
  }
}
