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
  CancelarLancamentoFuturo,
  CriarLancamentoFuturo,
  CriarRecorrencia,
  EditarLancamentoFuturo,
  EditarRecorrencia,
  ListarLancamentosFuturos,
  ListarRecorrencias,
} from '@iarx/contracts'
import { ConsultarProjecao } from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { versaoDe } from '../../comum/versao.js'
import { validar } from '../../comum/zod.pipe.js'
import { FluxoCaixaService } from '../fluxo-caixa/fluxo-caixa.service.js'
import { LancamentosFuturosService } from './lancamentos-futuros.service.js'

/**
 * `LFT` — Lançamentos futuros.
 *
 * Duas permissões, e a divisão segue o que cada ação **cria**:
 *
 *  · `financeiro:lancamento_manual` — planejar: listar, criar, editar, cancelar.
 *    O planejamento não move dinheiro nem abre aprovação, e travá-lo atrás da
 *    permissão de criar título faria o financeiro precisar de autoridade de
 *    lançamento para anotar que em setembro sai o aluguel.
 *  · `pagar:criar` / `receber:criar` — **converter**, porque a conversão cria um
 *    título de verdade, com rodada de aprovação e rateio. A permissão exigida é
 *    do lado do lançamento, checada no serviço: exigir uma só das duas daria a
 *    quem pode lançar despesa o poder de emitir cobrança.
 */
@Controller('api/v1/lancamentos-futuros')
export class LancamentosFuturosController {
  constructor(
    private readonly servico: LancamentosFuturosService,
    private readonly caixa: FluxoCaixaService,
  ) {}

  @Get()
  @ExigePermissao('financeiro:lancamento_manual')
  listar(@Query(validar(ListarLancamentosFuturos)) filtro: ListarLancamentosFuturos) {
    return this.servico.listar(filtro)
  }

  /*
   * `/excecoes` antes de `:id`, porque o roteador resolve por ordem: declarada
   * depois, a requisição cairia em `:id` e o ParseUUIDPipe recusaria a palavra
   * como UUID inválido — um 400 confuso no lugar da rota. Custou uma vez.
   */
  @Get('excecoes')
  @ExigePermissao('financeiro:lancamento_manual')
  excecoes(@Query(validar(ListarLancamentosFuturos)) filtro: ListarLancamentosFuturos) {
    return this.servico.listar({ ...filtro, com_excecao: true })
  }

  /**
   * A projeção vista pelo Módulo 12 — **a mesma função** do painel de caixa.
   *
   * Vive neste controlador, e não num próprio, por uma razão de roteamento: um
   * `@Controller('api/v1/lancamentos-futuros/projecao')` separado só funcionaria
   * se registrado antes deste no módulo, e a garantia passaria a depender da
   * ordem de uma lista em outro arquivo. Aqui a precedência sobre `:id` está à
   * vista, três linhas acima da rota que a exige.
   *
   * `pagar:ler` e não `financeiro:painel_executivo`: quem planeja precisa ver o
   * efeito do que programou sem receber a leitura consolidada da operação.
   */
  @Get('projecao')
  @ExigePermissao('pagar:ler')
  projecao(@Query(validar(ConsultarProjecao)) consulta: ConsultarProjecao) {
    return this.caixa.projetar(consulta)
  }

  @Post()
  @Idempotente()
  @ExigePermissao('financeiro:lancamento_manual')
  criar(@Body(validar(CriarLancamentoFuturo)) corpo: CriarLancamentoFuturo) {
    return this.servico.criar(corpo)
  }

  @Get(':id')
  @ExigePermissao('financeiro:lancamento_manual')
  porId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.porId(id)
  }

  @Patch(':id')
  @ExigePermissao('financeiro:lancamento_manual')
  editar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EditarLancamentoFuturo)) corpo: EditarLancamentoFuturo,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.editar(id, versaoDe(ifMatch), corpo)
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @ExigePermissao('financeiro:lancamento_manual')
  cancelar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(CancelarLancamentoFuturo)) corpo: CancelarLancamentoFuturo,
  ) {
    return this.servico.cancelar(id, corpo)
  }

  /**
   * Prévia da conversão: o que vai ser criado, antes de criar.
   *
   * `GET` porque não escreve nada, e é isso que permite abrir o diálogo quantas
   * vezes o operador quiser sem deixar rastro de tentativa.
   */
  @Get(':id/previa-conversao')
  @ExigePermissao('financeiro:lancamento_manual')
  previa(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.previaConversao(id)
  }

  /**
   * Converter.
   *
   * `pagar:criar` no decorador, e a permissão do lado a receber conferida no
   * serviço: o decorador é estático e a rota serve os dois lados. Declarar só
   * `pagar:criar` e parar aí daria a quem pode lançar despesa o poder de emitir
   * cobrança — a checagem do serviço é o que fecha isso.
   */
  @Post(':id/converter')
  @HttpCode(200)
  @Idempotente()
  @ExigePermissao('pagar:criar')
  converter(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.converter(id)
  }
}

/**
 * `REC` — Recorrências.
 *
 * Recurso próprio, e não sub-recurso de lançamentos futuros: a recorrência é o
 * **molde**, o lançamento é a **instância**. Pendurá-la sob `/lancamentos-futuros`
 * sugeriria que ela é um lançamento com repetição, quando é o que produz os
 * lançamentos — e a diferença importa na hora de editar: mudar o molde não muda
 * o que ele já produziu.
 */
@Controller('api/v1/recorrencias')
export class RecorrenciasController {
  constructor(private readonly servico: LancamentosFuturosService) {}

  @Get()
  @ExigePermissao('financeiro:lancamento_manual')
  listar(@Query(validar(ListarRecorrencias)) filtro: ListarRecorrencias) {
    return this.servico.listarRecorrencias(filtro)
  }

  @Post()
  @Idempotente()
  @ExigePermissao('financeiro:lancamento_manual')
  criar(@Body(validar(CriarRecorrencia)) corpo: CriarRecorrencia) {
    return this.servico.criarRecorrencia(corpo)
  }

  @Patch(':id')
  @ExigePermissao('financeiro:lancamento_manual')
  editar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EditarRecorrencia)) corpo: EditarRecorrencia,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.editarRecorrencia(id, versaoDe(ifMatch), corpo)
  }

  /**
   * Gerar o próximo da série — RN-F18.
   *
   * Idempotente pela chave `(recorrência, data prevista)` no banco, não pelo
   * cabeçalho: duas chamadas geram dois períodos, um cada, e é a chave que impede
   * a mesma data de nascer duas vezes. Marcá-la `@Idempotente` faria o reenvio
   * devolver o primeiro resultado, escondendo o segundo período que de fato
   * nasceu.
   */
  @Post(':id/gerar-proximo')
  @HttpCode(200)
  @ExigePermissao('financeiro:lancamento_manual')
  gerarProximo(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.gerarProximo(id)
  }
}
