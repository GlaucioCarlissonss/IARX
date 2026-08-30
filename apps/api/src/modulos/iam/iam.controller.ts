import {
  Body,
  Controller,
  Delete,
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
  ARVORE_PERMISSOES,
  AtualizarPerfil,
  AtualizarUsuario,
  ConvidarUsuario,
  CriarPerfil,
  DesativarUsuario,
  ListarPerfis,
  ListarUsuarios,
  RevogarSessoes,
  VinculoPerfil,
} from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { versaoDe } from '../../comum/versao.js'
import { validar } from '../../comum/zod.pipe.js'
import { IamService } from './iam.service.js'

/**
 * `IAM` — Usuários (Anexo L §4.2, Anexo D §D.9).
 *
 * O convite tem rota própria (`/convites`) em vez de ser um `POST /usuarios`
 * porque **não é a mesma coisa**: criar a conta é meio, e o que a operação faz é
 * convidar alguém. A diferença aparece na resposta — a conta nasce sem senha e o
 * link vai por e-mail — e num detalhe que um `POST /usuarios` genérico
 * convidaria a esquecer: não existe caminho aqui que aceite senha.
 */
@Controller('api/v1/usuarios')
export class UsuariosController {
  constructor(private readonly servico: IamService) {}

  @Get()
  @ExigePermissao('usuario:gerenciar')
  listar(@Query(validar(ListarUsuarios)) filtro: ListarUsuarios) {
    return this.servico.listarUsuarios(filtro)
  }

  /** Idempotente: um reenvio não deve criar duas contas nem dois convites. */
  @Post('convites')
  @HttpCode(201)
  @ExigePermissao('usuario:gerenciar')
  @Idempotente()
  convidar(@Body(validar(ConvidarUsuario)) corpo: ConvidarUsuario) {
    return this.servico.convidar(corpo)
  }

  @Get(':id')
  @ExigePermissao('usuario:gerenciar')
  porId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.usuarioPorId(id)
  }

  @Patch(':id')
  @ExigePermissao('usuario:gerenciar')
  atualizar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(AtualizarUsuario)) corpo: AtualizarUsuario,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.servico.atualizarUsuario(id, versaoDe(ifMatch), corpo)
  }

  @Post(':id/perfis')
  @HttpCode(201)
  @ExigePermissao('usuario:gerenciar')
  atribuirPerfil(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(VinculoPerfil)) corpo: VinculoPerfil,
  ) {
    return this.servico.atribuirPerfil(id, corpo)
  }

  @Delete(':id/perfis/:perfilId')
  @HttpCode(200)
  @ExigePermissao('usuario:gerenciar')
  revogarPerfil(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('perfilId', new ParseUUIDPipe({ version: '4' })) perfilId: string,
  ) {
    return this.servico.revogarPerfil(id, perfilId)
  }

  @Post(':id/ativar')
  @HttpCode(200)
  @ExigePermissao('usuario:gerenciar')
  ativar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.ativar(id)
  }

  /**
   * Desativar exige motivo; ativar não.
   *
   * A assimetria é proposital: desativar tira o acesso de alguém e é o evento
   * que se investiga depois. O motivo vai para `audit_log.motivo`, o campo que a
   * trilha tem desde a 0003 e que nenhuma rota preenchia.
   */
  @Post(':id/desativar')
  @HttpCode(200)
  @ExigePermissao('usuario:gerenciar')
  desativar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(DesativarUsuario)) corpo: DesativarUsuario,
  ) {
    return this.servico.desativar(id, corpo.motivo)
  }

  @Post(':id/revogar-sessoes')
  @HttpCode(200)
  @ExigePermissao('usuario:gerenciar')
  revogarSessoes(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(RevogarSessoes)) corpo: RevogarSessoes,
  ) {
    return this.servico.revogarSessoes(id, corpo)
  }
}

/**
 * `IAM` — Perfis.
 *
 * Permissão `perfil:gerenciar`, e não `usuario:gerenciar` como diz a linha do
 * Anexo D §D.9 — que agrupa `/usuarios` e `/perfis` numa célula só. As duas
 * permissões existem no catálogo desde sempre; usar a de usuário aqui deixaria
 * `perfil:gerenciar` sem nenhuma rota que a exija, e uma permissão que nenhuma
 * rota consulta é uma permissão que não protege nada. O Anexo D foi corrigido.
 */
@Controller('api/v1/perfis')
export class PerfisController {
  constructor(private readonly servico: IamService) {}

  @Get()
  @ExigePermissao('perfil:gerenciar')
  listar(@Query(validar(ListarPerfis)) filtro: ListarPerfis) {
    return this.servico.listarPerfis(filtro)
  }

  @Post()
  @HttpCode(201)
  @ExigePermissao('perfil:gerenciar')
  criar(@Body(validar(CriarPerfil)) corpo: CriarPerfil) {
    return this.servico.criarPerfil(corpo)
  }

  @Get(':id')
  @ExigePermissao('perfil:gerenciar')
  porId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.perfilPorId(id)
  }

  @Patch(':id')
  @ExigePermissao('perfil:gerenciar')
  atualizar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(AtualizarPerfil)) corpo: AtualizarPerfil,
  ) {
    return this.servico.atualizarPerfil(id, corpo)
  }
}

/**
 * O catálogo de permissões, agrupado por módulo → tela → ação.
 *
 * Estático: sai de `@iarx/contracts`, o mesmo array que a guarda compara e que o
 * gatilho do banco valida. Servi-lo por HTTP existe para que a tela de perfis
 * não precise embutir uma cópia — e uma cópia embutida é a divergência clássica,
 * o botão que some enquanto a rota continua aberta.
 */
@Controller('api/v1/permissoes')
export class PermissoesController {
  @Get()
  @ExigePermissao('perfil:gerenciar')
  arvore() {
    return ARVORE_PERMISSOES
  }
}
