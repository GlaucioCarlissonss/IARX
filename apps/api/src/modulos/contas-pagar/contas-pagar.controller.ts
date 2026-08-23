import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import {
  AjustarValorTituloPagar,
  CancelarTituloPagar,
  CriarDelegacao,
  CriarTituloPagar,
  DecidirAprovacao,
  EditarTituloPagar,
  EstornarPagamento,
  ListarDelegacoes,
  ListarTitulosPagar,
  PreviaAlcada,
  RegistrarPagamento,
} from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { versaoDe } from '../../comum/versao.js'
import { validar } from '../../comum/zod.pipe.js'
import { ContasPagarService } from './contas-pagar.service.js'

/**
 * `CPG` — Contas a pagar.
 *
 * Cada transição é um sub-recurso de ação, nunca um PATCH de `status`. Aqui
 * isso vale mais que no resto da API: `POST /decidir` com corpo
 * `{decisao, justificativa}` obriga a dizer **por que** rejeitou, enquanto
 * `PATCH {status: 'REJEITADO'}` aceitaria a recusa sem explicação — e a
 * justificativa é justamente o que o solicitante precisa para corrigir.
 *
 * Seis permissões, e a separação segue o que cada ação desfaz:
 *
 *  · `pagar:ler` — ver título e fila;
 *  · `pagar:criar` — lançar e editar em PENDENTE;
 *  · `pagar:aprovar` — decidir um nível;
 *  · `pagar:baixar` — pagar e estornar;
 *  · `pagar:cancelar` — cancelar, que **desfaz o trabalho de quem aprovou**;
 *  · `pagar:delegar_aprovacao` — transferir a própria autoridade, que é o
 *    caminho mais curto para contornar a segregação de funções e por isso não
 *    vem junto de `aprovar`.
 */
@Controller('api/v1/contas-pagar')
export class ContasPagarController {
  constructor(private readonly servico: ContasPagarService) {}

  @Get()
  @ExigePermissao('pagar:ler')
  listar(@Query(validar(ListarTitulosPagar)) filtro: ListarTitulosPagar) {
    return this.servico.listar(filtro)
  }

  /*
   * A prévia vem antes de `:id` porque o roteador resolve por ordem: declarada
   * depois, `POST /previa-alcada` continuaria certo, mas qualquer `GET
   * /previa-alcada` cairia em `GET /:id` e o ParseUUIDPipe recusaria a palavra
   * como UUID inválido — um 400 confuso no lugar da rota.
   */
  @Post('previa-alcada')
  @HttpCode(200)
  @ExigePermissao('pagar:ler')
  previaAlcada(@Body(validar(PreviaAlcada)) corpo: PreviaAlcada) {
    return this.servico.previaAlcada(corpo.valor)
  }

  @Post()
  @Idempotente()
  @ExigePermissao('pagar:criar')
  criar(@Body(validar(CriarTituloPagar)) corpo: CriarTituloPagar) {
    return this.servico.criar(corpo)
  }

  @Get(':id')
  @ExigePermissao('pagar:ler')
  porId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.porId(id)
  }

  @Patch(':id')
  @ExigePermissao('pagar:criar')
  editar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EditarTituloPagar)) corpo: EditarTituloPagar,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.editar(id, versaoDe(ifMatch), corpo)
  }

  /**
   * Ajuste de valor: multa, juro ou desconto negociado.
   *
   * Separado de `PATCH` porque muda **o que se vai pagar** e por isso exige
   * motivo. Deixá-lo no PATCH junto de descrição e fornecedor permitiria alterar
   * o valor devido sem registrar por quê — e o histórico de um título é o que
   * explica a diferença entre o que se contratou e o que se pagou.
   */
  @Post(':id/ajuste-valor')
  @HttpCode(200)
  @ExigePermissao('pagar:criar')
  ajustarValor(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(AjustarValorTituloPagar)) corpo: AjustarValorTituloPagar,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.ajustarValor(id, versaoDe(ifMatch), corpo)
  }

  @Post(':id/reenviar')
  @HttpCode(200)
  @ExigePermissao('pagar:criar')
  reenviar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.reenviar(id)
  }

  @Post(':id/aprovacoes/:nivel/decidir')
  @HttpCode(200)
  @ExigePermissao('pagar:aprovar')
  decidir(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('nivel', ParseIntPipe) nivel: number,
    @Body(validar(DecidirAprovacao)) corpo: DecidirAprovacao,
  ) {
    return this.servico.decidir(id, nivel, corpo)
  }

  @Post(':id/pagamentos')
  @Idempotente()
  @ExigePermissao('pagar:baixar')
  pagar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(RegistrarPagamento)) corpo: RegistrarPagamento,
  ) {
    return this.servico.pagar(id, corpo)
  }

  @Post(':id/pagamentos/:pagamentoId/estornar')
  @HttpCode(200)
  @Idempotente()
  @ExigePermissao('pagar:baixar')
  estornar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('pagamentoId', new ParseUUIDPipe({ version: '4' })) pagamentoId: string,
    @Body(validar(EstornarPagamento)) corpo: EstornarPagamento,
  ) {
    return this.servico.estornarPagamento(id, pagamentoId, corpo.motivo)
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @ExigePermissao('pagar:cancelar')
  cancelar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(CancelarTituloPagar)) corpo: CancelarTituloPagar,
  ) {
    return this.servico.cancelar(id, corpo)
  }
}

/**
 * `DEL` — Delegação de aprovação.
 *
 * Recurso próprio, e não sub-recurso de contas a pagar: uma delegação vale para
 * um nível de alçada, não para um título. Pendurá-la sob `/contas-pagar/{id}`
 * sugeriria que se delega a aprovação de um título específico, que é
 * exatamente o que ela não é.
 *
 * O delegante é sempre quem chama — nunca um id do corpo. Aceitá-lo
 * permitiria delegar a autoridade **de outra pessoa**, que é a forma mais
 * direta de contornar a segregação: eu delego a alçada do gestor para mim
 * mesmo e aprovo o que lancei.
 */
@Controller('api/v1/delegacoes-aprovacao')
export class DelegacoesController {
  constructor(private readonly servico: ContasPagarService) {}

  @Get()
  @ExigePermissao('pagar:ler')
  listar(@Query(validar(ListarDelegacoes)) filtro: ListarDelegacoes) {
    return this.servico.listarDelegacoes(filtro)
  }

  @Post()
  @Idempotente()
  @ExigePermissao('pagar:delegar_aprovacao')
  criar(@Body(validar(CriarDelegacao)) corpo: CriarDelegacao) {
    return this.servico.criarDelegacao(corpo)
  }
}
