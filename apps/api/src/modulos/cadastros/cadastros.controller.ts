import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import {
  Inativar,
  ListarTecnicos,
  SalvarCategoria,
  SalvarFabricante,
  SalvarModelo,
  SalvarPeca,
  SalvarTecnico,
} from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { CadastrosService } from './cadastros.service.js'

/**
 * Cadastros de apoio — catálogo, peça, fornecedor e técnico.
 *
 * ## Não existe `DELETE` em nenhum deles
 *
 * As quatro entidades são apontadas por registros históricos: peça por
 * movimento de estoque, fornecedor por nota lançada, técnico por ordem
 * validada, modelo por equipamento em campo. A operação que a tela chama de
 * "excluir" é `POST /{recurso}/{id}/inativar` com motivo — o cadastro sai das
 * listas de escolha e continua resolvendo as referências antigas (RN-019).
 *
 * A ausência é deliberada e tem teste: acrescentar um `DELETE` por
 * conveniência reprova.
 */
@Controller('api/v1')
export class CadastrosController {
  constructor(private readonly servico: CadastrosService) {}

  /* ----------------------------------------------------------- catálogo --- */

  @Post('catalogo/fabricantes')
  @HttpCode(201)
  @ExigePermissao('catalogo:gerenciar')
  @Idempotente()
  criarFabricante(@Body(validar(SalvarFabricante)) corpo: SalvarFabricante) {
    return this.servico.salvarFabricante(corpo)
  }

  @Patch('catalogo/fabricantes/:id')
  @ExigePermissao('catalogo:gerenciar')
  editarFabricante(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(SalvarFabricante)) corpo: SalvarFabricante,
  ) {
    return this.servico.salvarFabricante(corpo, id)
  }

  @Post('catalogo/categorias')
  @HttpCode(201)
  @ExigePermissao('catalogo:gerenciar')
  @Idempotente()
  criarCategoria(@Body(validar(SalvarCategoria)) corpo: SalvarCategoria) {
    return this.servico.salvarCategoria(corpo)
  }

  @Patch('catalogo/categorias/:id')
  @ExigePermissao('catalogo:gerenciar')
  editarCategoria(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(SalvarCategoria)) corpo: SalvarCategoria,
  ) {
    return this.servico.salvarCategoria(corpo, id)
  }

  @Post('catalogo/modelos')
  @HttpCode(201)
  @ExigePermissao('catalogo:gerenciar')
  @Idempotente()
  criarModelo(@Body(validar(SalvarModelo)) corpo: SalvarModelo) {
    return this.servico.salvarModelo(corpo)
  }

  @Patch('catalogo/modelos/:id')
  @ExigePermissao('catalogo:gerenciar')
  editarModelo(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(SalvarModelo)) corpo: SalvarModelo,
  ) {
    return this.servico.salvarModelo(corpo, id)
  }

  /* --------------------------------------------------------------- peça --- */

  @Post('pecas')
  @HttpCode(201)
  @ExigePermissao('peca:criar')
  @Idempotente()
  criarPeca(@Body(validar(SalvarPeca)) corpo: SalvarPeca) {
    return this.servico.salvarPeca(corpo)
  }

  @Patch('pecas/:id')
  @ExigePermissao('peca:editar')
  editarPeca(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(SalvarPeca)) corpo: SalvarPeca,
  ) {
    return this.servico.salvarPeca(corpo, id)
  }

  @Post('pecas/:id/inativar')
  @HttpCode(200)
  @ExigePermissao('peca:editar')
  inativarPeca(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(Inativar)) corpo: Inativar,
  ) {
    return this.servico.inativar('peca', id, corpo)
  }

  @Post('pecas/:id/reativar')
  @HttpCode(200)
  @ExigePermissao('peca:editar')
  reativarPeca(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.reativar('peca', id)
  }

  /*
   * As rotas de fornecedor vivem em `FornecedoresController`, que já existia.
   * Declará-las aqui também criaria duas rotas no mesmo caminho — e o Nest
   * resolve pelo primeiro registrado, deixando a segunda sem nenhum chamador.
   */

  /* ------------------------------------------------------------ técnico --- */

  /**
   * A leitura é `os:ler` e a escrita é `tecnico:gerenciar`.
   *
   * Quem despacha uma ordem precisa da lista para escolher o técnico, e não
   * precisa poder cadastrar ninguém. Era `GET /tecnicos` no controlador de
   * manutenção; mudou de lugar para que um recurso tenha um dono, não para
   * mudar quem o lê.
   */
  @Get('tecnicos')
  @ExigePermissao('os:ler')
  listarTecnicos(@Query(validar(ListarTecnicos)) filtro: ListarTecnicos) {
    return this.servico.listarTecnicos(filtro)
  }

  @Post('tecnicos')
  @HttpCode(201)
  @ExigePermissao('tecnico:gerenciar')
  @Idempotente()
  criarTecnico(@Body(validar(SalvarTecnico)) corpo: SalvarTecnico) {
    return this.servico.salvarTecnico(corpo)
  }

  @Patch('tecnicos/:id')
  @ExigePermissao('tecnico:gerenciar')
  editarTecnico(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(SalvarTecnico)) corpo: SalvarTecnico,
  ) {
    return this.servico.salvarTecnico(corpo, id)
  }

  @Post('tecnicos/:id/inativar')
  @HttpCode(200)
  @ExigePermissao('tecnico:gerenciar')
  inativarTecnico(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(Inativar)) corpo: Inativar,
  ) {
    return this.servico.inativar('tecnico', id, corpo)
  }

  /* ------------------------------------------------------------ cliente --- */

  /**
   * Inativação de cliente — permissão própria, e não `cliente:editar`.
   *
   * Editar um cliente corrige um endereço; inativar o tira das listas e dos
   * filtros padrão de todo o sistema. Com contrato vigente a operação é
   * recusada: a cobrança continuaria sendo gerada todo mês para alguém que
   * sumiu das telas.
   */
  @Post('clientes/:id/inativar')
  @HttpCode(200)
  @ExigePermissao('cliente:inativar')
  inativarCliente(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(Inativar)) corpo: Inativar,
  ) {
    return this.servico.inativarCliente(id, corpo)
  }
}
