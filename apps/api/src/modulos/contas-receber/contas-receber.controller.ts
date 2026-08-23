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
  AplicarDesconto,
  BaixarSemRecebimento,
  CancelarTituloReceber,
  Competencia,
  CriarTituloReceber,
  DecidirEmissao,
  EditarTituloReceber,
  EstornarRecebimento,
  ListarTitulosReceber,
  PreviaAlcadaReceber,
  RegistrarRecebimento,
} from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { versaoDe } from '../../comum/versao.js'
import { validar } from '../../comum/zod.pipe.js'
import { ContasReceberService } from './contas-receber.service.js'

/**
 * `CRB` — Contas a receber.
 *
 * D-20: não há recurso `/faturas`. "Fatura" é um título com
 * `origem = 'CONTRATUAL'`, e o filtro `?origem=` é o que separa os dois na
 * leitura. Uma rota paralela para faturas devolveria as mesmas linhas por outro
 * caminho, e a primeira divergência entre os dois seria invisível.
 *
 * Também **não há POST que crie um contratual**. Ele nasce do fechamento de
 * competência, com o valor vindo do motor de preço; um caminho manual permitiria
 * uma cobrança contratual com valor digitado, indistinguível da calculada.
 *
 * Seis permissões, e a separação segue o que cada ação desfaz:
 *
 *  · `receber:ler` — ver título e fila;
 *  · `receber:criar` — lançar avulso, editar antes da aprovação, reenviar;
 *  · `receber:aprovar` — decidir um nível de emissão;
 *  · `receber:baixar` — registrar recebimento e estornar;
 *  · `receber:negociar` — desconto e baixa sem recebimento, as duas ações que
 *    **reduzem o que se cobra** sem cancelar;
 *  · `receber:cancelar` — cancelar, que desfaz o trabalho de quem aprovou.
 */
@Controller('api/v1/contas-receber')
export class ContasReceberController {
  constructor(private readonly servico: ContasReceberService) {}

  @Get()
  @ExigePermissao('receber:ler')
  listar(@Query(validar(ListarTitulosReceber)) filtro: ListarTitulosReceber) {
    return this.servico.listar(filtro)
  }

  /*
   * Antes de `:id`, porque o roteador resolve por ordem: declarada depois,
   * qualquer requisição para `/previa-alcada` cairia em `:id` e o ParseUUIDPipe
   * recusaria a palavra como UUID inválido — um 400 confuso no lugar da rota.
   */
  @Post('previa-alcada')
  @HttpCode(200)
  @ExigePermissao('receber:ler')
  previaAlcada(@Body(validar(PreviaAlcadaReceber)) corpo: PreviaAlcadaReceber) {
    return this.servico.previaAlcada(corpo.valor)
  }

  @Post()
  @Idempotente()
  @ExigePermissao('receber:criar')
  criar(@Body(validar(CriarTituloReceber)) corpo: CriarTituloReceber) {
    return this.servico.criar(corpo)
  }

  @Get(':id')
  @ExigePermissao('receber:ler')
  porId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.porId(id)
  }

  @Patch(':id')
  @ExigePermissao('receber:criar')
  editar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EditarTituloReceber)) corpo: EditarTituloReceber,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.editar(id, versaoDe(ifMatch), corpo)
  }

  /**
   * Desconto: ação própria, com permissão própria.
   *
   * Não é `PATCH`. Reduzir o que se cobra é uma decisão comercial sujeita a
   * alçada (RN-F12), e deixá-la no PATCH junto de descrição e vencimento
   * permitiria conceder desconto sem registrar por quê — além de dar a quem tem
   * `receber:criar` uma autoridade que é de `receber:negociar`.
   */
  @Post(':id/desconto')
  @HttpCode(200)
  @ExigePermissao('receber:negociar')
  desconto(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(AplicarDesconto)) corpo: AplicarDesconto,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.aplicarDesconto(id, versaoDe(ifMatch), corpo)
  }

  @Post(':id/aprovacoes/:nivel/decidir')
  @HttpCode(200)
  @ExigePermissao('receber:aprovar')
  decidir(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('nivel', ParseIntPipe) nivel: number,
    @Body(validar(DecidirEmissao)) corpo: DecidirEmissao,
  ) {
    return this.servico.decidir(id, nivel, corpo)
  }

  @Post(':id/reenviar')
  @HttpCode(200)
  @ExigePermissao('receber:criar')
  reenviar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.reenviar(id)
  }

  @Post(':id/recebimentos')
  @Idempotente()
  @ExigePermissao('receber:baixar')
  receber(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(RegistrarRecebimento)) corpo: RegistrarRecebimento,
  ) {
    return this.servico.receber(id, corpo)
  }

  @Post(':id/recebimentos/:recebimentoId/estornar')
  @HttpCode(200)
  @Idempotente()
  @ExigePermissao('receber:baixar')
  estornar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('recebimentoId', new ParseUUIDPipe({ version: '4' })) recebimentoId: string,
    @Body(validar(EstornarRecebimento)) corpo: EstornarRecebimento,
  ) {
    return this.servico.estornarRecebimento(id, recebimentoId, corpo.motivo)
  }

  /**
   * Baixa sem recebimento — RN-F14.
   *
   * `receber:negociar`, não `receber:baixar`: quem registra a entrada de dinheiro
   * não decide que um valor **não** vai entrar. São as duas metades opostas da
   * mesma linha, e juntá-las numa permissão daria a quem confere o extrato o
   * poder de encerrar cobranças.
   */
  @Post(':id/baixar-sem-recebimento')
  @HttpCode(200)
  @ExigePermissao('receber:negociar')
  baixarSemRecebimento(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(BaixarSemRecebimento)) corpo: BaixarSemRecebimento,
  ) {
    return this.servico.baixarSemRecebimento(id, corpo)
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @ExigePermissao('receber:cancelar')
  cancelar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(CancelarTituloReceber)) corpo: CancelarTituloReceber,
  ) {
    return this.servico.cancelar(id, corpo)
  }
}

/**
 * `CMP` — Competências.
 *
 * Recurso próprio, e não sub-recurso de contas a receber: fechar uma competência
 * sela o **consumo** e, como consequência, gera as cobranças. Pendurá-lo sob
 * `/contas-receber` inverteria a causa — sugeriria que o fechamento é uma
 * operação de faturamento, quando ele é o encerramento da medição.
 *
 * A prévia é `GET` e não escreve nada: pode ser chamada quantas vezes a tela
 * quiser antes de o operador confirmar. É o que permite responder "isto vai
 * gerar 34 cobranças, 2 delas em disputa" **antes** de gerar.
 */
@Controller('api/v1/competencias')
export class CompetenciasController {
  constructor(private readonly servico: ContasReceberService) {}

  @Get(':competencia/previa-fechamento')
  @ExigePermissao('competencia:fechar')
  previa(@Param('competencia', validar(Competencia)) competencia: string) {
    return this.servico.previaFechamento(competencia)
  }

  @Post(':competencia/fechar')
  @HttpCode(200)
  @Idempotente()
  @ExigePermissao('competencia:fechar')
  fechar(@Param('competencia', validar(Competencia)) competencia: string) {
    return this.servico.fecharCompetencia(competencia)
  }
}
