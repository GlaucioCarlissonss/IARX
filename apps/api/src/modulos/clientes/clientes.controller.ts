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
  Put,
  Query,
} from '@nestjs/common'
import {
  AtualizarCliente,
  CriarCliente,
  CriarLocalOperacao,
  DefinirCredito,
  ListarClientes,
} from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { versaoDe } from '../../comum/versao.js'
import { validar } from '../../comum/zod.pipe.js'
import { ClientesService } from './clientes.service.js'

/**
 * `CLI` — Clientes e seus locais de operação (Anexo D §D.2).
 *
 * A tabela existe desde a migração 0002 e ganhou RLS de cliente na 0011; até
 * aqui não tinha rota nenhuma. Era o buraco mais consequente do catálogo: sem
 * `/clientes`, nada do eixo de cliente pode ser exercido por HTTP, e as nove
 * políticas restritivas da 0011 protegiam um caminho que ninguém percorria.
 *
 * Duas permissões distintas sobre o mesmo recurso, e não uma: `cliente:editar`
 * corrige cadastro, `cliente:credito_definir` decide exposição financeira. É a
 * mesma separação que o Anexo C dá a `contrato:editar` e `contrato:aprovar`.
 */
@Controller('api/v1/clientes')
export class ClientesController {
  constructor(private readonly servico: ClientesService) {}

  @Get()
  @ExigePermissao('cliente:ler')
  listar(@Query(validar(ListarClientes)) filtro: ListarClientes) {
    return this.servico.listar(filtro)
  }

  /**
   * Cria o cliente. Idempotente: o cadastro é a porta de entrada de contrato e
   * cobrança, e um duplo clique com timeout no meio criaria dois CNPJs iguais —
   * que o índice único recusa, mas devolvendo um 409 a quem não errou nada.
   */
  @Post()
  @HttpCode(201)
  @ExigePermissao('cliente:criar')
  @Idempotente()
  criar(@Body(validar(CriarCliente)) corpo: CriarCliente) {
    return this.servico.criar(corpo)
  }

  @Get(':id')
  @ExigePermissao('cliente:ler')
  porId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.porId(id)
  }

  /**
   * `If-Match` obrigatório, como em todo PATCH desta API: dois operadores com a
   * mesma tela aberta gravam por cima um do outro, e o último a clicar vence em
   * silêncio.
   */
  @Patch(':id')
  @ExigePermissao('cliente:editar')
  atualizar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(AtualizarCliente)) corpo: AtualizarCliente,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.atualizar(id, versaoDe(ifMatch), corpo)
  }

  /** Contratos, parque e cobrança do cliente — e o que não tem fonte, dito. */
  @Get(':id/visao-360')
  @ExigePermissao('cliente:ler')
  visao360(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.visao360(id)
  }

  /**
   * `PUT`, não `PATCH`: limite e situação são uma decisão só. Subir o limite e
   * esquecer de desbloquear é o engano que a separação em dois campos
   * opcionais produziria.
   */
  @Put(':id/credito')
  @HttpCode(200)
  @ExigePermissao('cliente:credito_definir')
  definirCredito(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(DefinirCredito)) corpo: DefinirCredito,
  ) {
    return this.servico.definirCredito(id, corpo)
  }

  @Get(':id/locais')
  @ExigePermissao('local_operacao:gerenciar')
  locais(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.locais(id)
  }

  @Post(':id/locais')
  @HttpCode(201)
  @ExigePermissao('local_operacao:gerenciar')
  criarLocal(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(CriarLocalOperacao)) corpo: CriarLocalOperacao,
  ) {
    return this.servico.criarLocal(id, corpo)
  }
}
