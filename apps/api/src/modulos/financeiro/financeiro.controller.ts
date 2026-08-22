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
  CriarCentroCusto,
  CriarContaBancaria,
  EditarCentroCusto,
  EditarContaBancaria,
  EstornarMovimentacao,
  LancarMovimentacao,
  ListarCentrosCusto,
  ListarContasBancarias,
  ListarExtrato,
  Transferir,
} from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { versaoDe } from '../../comum/versao.js'
import { validar } from '../../comum/zod.pipe.js'
import { FinanceiroService } from './financeiro.service.js'

/**
 * `CCU` — Centros de custo.
 *
 * Inativar é ação (`/inativar`), não `PATCH { ativo: false }`. Mesma razão do
 * resto da API: a ação tem permissão própria, a recusa tem lugar para explicar
 * o motivo — há subcentros ativos —, e a auditoria registra a intenção em vez
 * de um diff de booleano que ninguém julga depois.
 *
 * `centro_custo:ler` é separada de `centro_custo:gerenciar` porque quem lança um
 * título **precisa ler** a árvore para escolher um centro, e não precisa poder
 * criar nenhum. Sem a separação, todo operador financeiro receberia a permissão
 * de estruturar a contabilidade da empresa para conseguir digitar uma despesa.
 */
@Controller('api/v1/centros-custo')
export class CentrosCustoController {
  constructor(private readonly servico: FinanceiroService) {}

  @Get()
  @ExigePermissao('centro_custo:ler')
  listar(@Query(validar(ListarCentrosCusto)) filtro: ListarCentrosCusto) {
    return this.servico.listarCentros(filtro)
  }

  @Post()
  @Idempotente()
  @ExigePermissao('centro_custo:gerenciar')
  criar(@Body(validar(CriarCentroCusto)) corpo: CriarCentroCusto) {
    return this.servico.criarCentro(corpo)
  }

  @Patch(':id')
  @ExigePermissao('centro_custo:gerenciar')
  editar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EditarCentroCusto)) corpo: EditarCentroCusto,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.editarCentro(id, versaoDe(ifMatch), corpo)
  }

  /** 200: o centro já existe e já tem URL. A ação muda um atributo dele. */
  @Post(':id/inativar')
  @HttpCode(200)
  @ExigePermissao('centro_custo:gerenciar')
  inativar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.definirAtivoCentro(id, versaoDe(ifMatch), false)
  }

  @Post(':id/reativar')
  @HttpCode(200)
  @ExigePermissao('centro_custo:gerenciar')
  reativar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.definirAtivoCentro(id, versaoDe(ifMatch), true)
  }
}

/**
 * `CBA` — Contas bancárias, extrato e movimentação.
 *
 * Quatro permissões distintas, e a separação não é burocracia:
 *
 *  · `conta_bancaria:ler` — ver saldo e extrato. É o que a baixa de um título
 *    precisa para oferecer o seletor de conta.
 *  · `conta_bancaria:gerenciar` — cadastrar conta, mudar apelido, limite,
 *    status. Bloquear uma conta é ação de gestão, não de operação.
 *  · `conta_bancaria:movimentar` — lançar e estornar. Quem opera o dia a dia.
 *  · `conta_bancaria:transferir` — mover dinheiro entre contas da empresa.
 *    Separada de `movimentar` porque é a única que **move saldo** sem que haja
 *    um título por trás justificando o valor: é a ação com menos rastro
 *    documental e a que mais interessa segregar de quem lança despesa.
 */
@Controller('api/v1/contas-bancarias')
export class ContasBancariasController {
  constructor(private readonly servico: FinanceiroService) {}

  @Get()
  @ExigePermissao('conta_bancaria:ler')
  listar(@Query(validar(ListarContasBancarias)) filtro: ListarContasBancarias) {
    return this.servico.listarContas(filtro)
  }

  /*
   * A transferência vem antes de `:id` de propósito.
   *
   * O roteador do Nest resolve por ordem de declaração: `POST /transferencias`
   * declarado depois de `POST /:id/movimentacoes` continuaria certo, mas
   * `GET /transferencias` cairia em `GET /:id` e o ParseUUIDPipe recusaria
   * "transferencias" como UUID inválido — um 400 confuso no lugar da rota.
   * Manter as rotas literais no topo evita a classe inteira do problema.
   */
  @Post('transferencias')
  @Idempotente()
  @ExigePermissao('conta_bancaria:transferir')
  transferir(@Body(validar(Transferir)) corpo: Transferir) {
    return this.servico.transferir(corpo)
  }

  @Post()
  @Idempotente()
  @ExigePermissao('conta_bancaria:gerenciar')
  criar(@Body(validar(CriarContaBancaria)) corpo: CriarContaBancaria) {
    return this.servico.criarConta(corpo)
  }

  @Get(':id')
  @ExigePermissao('conta_bancaria:ler')
  porId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.contaPorId(id)
  }

  @Patch(':id')
  @ExigePermissao('conta_bancaria:gerenciar')
  editar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EditarContaBancaria)) corpo: EditarContaBancaria,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.editarConta(id, versaoDe(ifMatch), corpo)
  }

  @Get(':id/extrato')
  @ExigePermissao('conta_bancaria:ler')
  extrato(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query(validar(ListarExtrato)) filtro: ListarExtrato,
  ) {
    return this.servico.extrato(id, filtro)
  }

  @Post(':id/movimentacoes')
  @Idempotente()
  @ExigePermissao('conta_bancaria:movimentar')
  lancar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(LancarMovimentacao)) corpo: LancarMovimentacao,
  ) {
    return this.servico.lancar(id, corpo)
  }

  /*
   * O estorno é endereçado pela movimentação, não pela conta.
   *
   * `POST /movimentacoes/{id}/estornar` sob o recurso de conta pediria a conta
   * na URL e a movimentação também — dois identificadores para localizar uma
   * linha, e a possibilidade de eles discordarem. A movimentação já sabe de que
   * conta é.
   */
  @Post('movimentacoes/:id/estornar')
  @HttpCode(200)
  @Idempotente()
  @ExigePermissao('conta_bancaria:movimentar')
  estornar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EstornarMovimentacao)) corpo: EstornarMovimentacao,
  ) {
    return this.servico.estornar(id, corpo.motivo)
  }

  @Post('movimentacoes/:id/conciliar')
  @HttpCode(200)
  @ExigePermissao('conciliacao:executar')
  conciliar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.conciliar(id, true)
  }

  /**
   * Desfazer a conciliação existe, e é deliberado.
   *
   * Conciliar errado acontece — dois lançamentos de mesmo valor no mesmo dia é
   * o caso comum. Sem esta rota, a saída seria estornar uma movimentação
   * correta só para corrigir a conferência, o que sujaria o extrato para
   * consertar um metadado.
   */
  @Post('movimentacoes/:id/desconciliar')
  @HttpCode(200)
  @ExigePermissao('conciliacao:executar')
  desconciliar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.conciliar(id, false)
  }
}
