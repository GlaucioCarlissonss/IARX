import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import {
  ConsultarIndicadores,
  CopiarOrcamento,
  CriarCategoriaDespesa,
  CriarOrcamento,
  CriarReplanejamento,
  EditarCategoriaDespesa,
  EditarOrcamento,
  ListarCategoriasDespesa,
  ListarOrcamentos,
} from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { versaoDe } from '../../comum/versao.js'
import { validar } from '../../comum/zod.pipe.js'
import { DespesasService } from './despesas.service.js'

/**
 * `CAT` — Categorias de despesa (Anexo L §Módulo 14, Anexo V).
 *
 * Ler e gerenciar são permissões distintas pela mesma razão do centro de custo:
 * quem lança um título precisa **ler** a árvore para escolher uma categoria, e
 * não precisa poder criar categoria nenhuma.
 */
@Controller('api/v1/categorias-despesa')
export class CategoriasDespesaController {
  constructor(private readonly servico: DespesasService) {}

  @Get()
  @ExigePermissao('despesa:ler')
  listar(@Query(validar(ListarCategoriasDespesa)) filtro: ListarCategoriasDespesa) {
    return this.servico.listarCategorias(filtro)
  }

  @Post()
  @HttpCode(201)
  @ExigePermissao('despesa:orcamento_gerenciar')
  @Idempotente()
  criar(@Body(validar(CriarCategoriaDespesa)) corpo: CriarCategoriaDespesa) {
    return this.servico.criarCategoria(corpo)
  }

  @Patch(':id')
  @ExigePermissao('despesa:orcamento_gerenciar')
  editar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EditarCategoriaDespesa)) corpo: EditarCategoriaDespesa,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.editarCategoria(id, versaoDe(ifMatch), corpo)
  }
}

/**
 * `ORC` — Orçamento e replanejamento.
 *
 * `copiar-de` e `replanejamentos` são **sub-recursos de ação**, não PATCH de
 * campo (Anexo D.1). No replanejamento a diferença é o ponto inteiro: o valor
 * sai de uma linha e entra em outra na mesma transação, com motivo, e a
 * auditoria registra a intenção. Dois PATCH separados seriam duas metades que
 * alguém pode separar — e a metade que falha cria ou destrói verba.
 */
@Controller('api/v1/orcamentos')
export class OrcamentosController {
  constructor(private readonly servico: DespesasService) {}

  @Get()
  @ExigePermissao('despesa:ler')
  listar(@Query(validar(ListarOrcamentos)) filtro: ListarOrcamentos) {
    return this.servico.listarOrcamentos(filtro)
  }

  @Post()
  @HttpCode(201)
  @ExigePermissao('despesa:orcamento_gerenciar')
  @Idempotente()
  criar(@Body(validar(CriarOrcamento)) corpo: CriarOrcamento) {
    return this.servico.criarOrcamento(corpo)
  }

  /**
   * Cópia do ano anterior — ação explícita, e é o que o Anexo L exige: "nunca
   * herança automática silenciosa".
   *
   * 200 e não 201: nada ganha URL própria aqui. A resposta é a contagem do que
   * entrou e do que já existia, porque copiar **não sobrescreve** quem já orçou.
   */
  @Post('copiar-de')
  @HttpCode(200)
  @ExigePermissao('despesa:orcamento_gerenciar')
  @Idempotente()
  copiar(@Body(validar(CopiarOrcamento)) corpo: CopiarOrcamento) {
    return this.servico.copiarOrcamento(corpo)
  }

  @Post('replanejamentos')
  @HttpCode(201)
  @ExigePermissao('despesa:orcamento_gerenciar')
  @Idempotente()
  replanejar(@Body(validar(CriarReplanejamento)) corpo: CriarReplanejamento) {
    return this.servico.replanejar(corpo)
  }

  @Patch(':id')
  @ExigePermissao('despesa:orcamento_gerenciar')
  editar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EditarOrcamento)) corpo: EditarOrcamento,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.editarOrcamento(id, versaoDe(ifMatch), corpo)
  }
}

/**
 * `DSP` — Painel de despesas.
 *
 * `GET` porque não muda nada, e é exatamente por isso que a execução pode ser
 * recalculada a cada chamada: um título cancelado precisa mudar o percentual na
 * consulta seguinte, sem job de recálculo.
 */
@Controller('api/v1/despesas')
export class DespesasController {
  constructor(private readonly servico: DespesasService) {}

  @Get('indicadores')
  @ExigePermissao('despesa:ler')
  indicadores(@Query(validar(ConsultarIndicadores)) filtro: ConsultarIndicadores) {
    return this.servico.indicadores(filtro)
  }
}
