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
  BaixarEquipamento,
  BloquearEquipamento,
  CriarEquipamento,
  EditarEquipamento,
  EditarPatrimonial,
  ListarEquipamentos,
  ListarMovimentacoes,
  RegistrarMovimentacao,
  TransferirEquipamento,
} from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { versaoDe } from '../../comum/versao.js'
import { validar } from '../../comum/zod.pipe.js'
import { EquipamentosService } from './equipamentos.service.js'
import { MovimentacaoService } from './movimentacao.service.js'

/**
 * `EQP` — Equipamentos.
 *
 * Transições de estado são **sub-recursos de ação** (`/bloquear`), nunca PATCH
 * de campo `status` (Anexo D.1). A diferença é prática, não estética: com ação
 * explícita a permissão é granular (`equipamento:bloquear` ≠
 * `equipamento:editar`), a máquina de estados fica declarada no roteamento, e a
 * auditoria registra a intenção — "bloqueou por preventiva vencida" — em vez de
 * um diff de coluna.
 */
@Controller('api/v1/equipamentos')
export class EquipamentosController {
  constructor(
    private readonly servico: EquipamentosService,
    private readonly movimentacao: MovimentacaoService,
  ) {}

  @Get()
  @ExigePermissao('equipamento:ler')
  listar(@Query(validar(ListarEquipamentos)) filtro: ListarEquipamentos) {
    return this.servico.listar(filtro)
  }

  /**
   * Cadastra um ativo avulso. Idempotente: um reenvio criaria um segundo
   * patrimônio para o mesmo bem, e a contagem do parque é o número que sustenta
   * a depreciação.
   */
  @Post()
  @HttpCode(201)
  @ExigePermissao('equipamento:criar')
  @Idempotente()
  criar(@Body(validar(CriarEquipamento)) corpo: CriarEquipamento) {
    return this.servico.criar(corpo)
  }

  @Get(':id')
  @ExigePermissao('equipamento:ler')
  porId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.porId(id)
  }

  @Post(':id/bloquear')
  @ExigePermissao('equipamento:bloquear')
  bloquear(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(BloquearEquipamento)) corpo: { motivo: string; ate: string | null },
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.bloquear(id, versaoDe(ifMatch), corpo.motivo, corpo.ate)
  }

  @Post(':id/desbloquear')
  @ExigePermissao('equipamento:desbloquear')
  desbloquear(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.desbloquear(id, versaoDe(ifMatch))
  }

  /**
   * Edição cadastral. `If-Match` obrigatório porque dois operadores editando o
   * mesmo ativo sem ele produzem a última escrita vencendo em silêncio.
   */
  @Patch(':id')
  @ExigePermissao('equipamento:editar')
  editar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EditarEquipamento)) corpo: EditarEquipamento,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.movimentacao.editar(id, versaoDe(ifMatch), corpo)
  }

  /**
   * Edição patrimonial — permissão própria (Anexo C §C.4).
   *
   * Separada de `equipamento:editar` porque estes campos entram na depreciação,
   * e a depreciação entra no resultado: quem cadastra um ativo não é quem
   * decide quanto ele vale no imobilizado.
   */
  @Patch(':id/patrimonial')
  @ExigePermissao('equipamento:patrimonial_editar')
  editarPatrimonial(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EditarPatrimonial)) corpo: EditarPatrimonial,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.movimentacao.editarPatrimonial(id, versaoDe(ifMatch), corpo)
  }

  @Get(':id/movimentacoes')
  @ExigePermissao('equipamento:ler')
  movimentacoes(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query(validar(ListarMovimentacoes)) filtro: ListarMovimentacoes,
  ) {
    return this.movimentacao.listar(id, filtro)
  }

  /**
   * Registra um fato no razão do ativo e aplica o estado que dele decorre.
   *
   * O corpo não traz `status`: ele é derivado do par (tipo, estado atual) no
   * serviço. Aceitá-lo daria a esta permissão — a mais distribuída do sistema,
   * que o Anexo C concede ao técnico de campo — o poder de pôr qualquer ativo
   * em qualquer estado, `BAIXADO` inclusive.
   */
  @Post(':id/movimentacoes')
  @HttpCode(201)
  @ExigePermissao('equipamento:movimentar')
  @Idempotente()
  registrarMovimentacao(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(RegistrarMovimentacao)) corpo: RegistrarMovimentacao,
  ) {
    return this.movimentacao.registrar(id, corpo)
  }

  /**
   * Transferência entre filiais (RN-005). Nasce pendente de aceite no destino;
   * enquanto isso o ativo está em trânsito e não é alocável por nenhuma das duas.
   */
  @Post(':id/transferir')
  @HttpCode(201)
  @ExigePermissao('equipamento:transferir')
  @Idempotente()
  transferir(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(TransferirEquipamento)) corpo: TransferirEquipamento,
  ) {
    return this.movimentacao.transferir(id, corpo)
  }

  /**
   * Baixa patrimonial (RN-007).
   *
   * Permissão própria e muito mais restrita que a de movimentação: o Anexo C a
   * concede a diretor e controller. É irreversível no fluxo normal e tira o
   * ativo do balanço.
   */
  @Post(':id/baixar')
  @HttpCode(201)
  @ExigePermissao('equipamento:baixar')
  @Idempotente()
  baixar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(BaixarEquipamento)) corpo: BaixarEquipamento,
  ) {
    return this.movimentacao.baixar(id, corpo)
  }
}
