import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { CriarVisao, DuplicarVisao, EditarVisao, ListarVisoes } from '@iarx/contracts'
import { ExigePermissao } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { VisoesService } from './visoes.service.js'

/**
 * `VIS` — visões salvas de lista (Anexo Y §Y.3.5).
 *
 * ## Por que `visao:compartilhar` não aparece em nenhuma rota
 *
 * Porque ela não governa o **caminho**, governa o **corpo**: criar uma visão
 * pessoal e publicar uma para a operação inteira entram pelo mesmo `POST`, e
 * só o valor de `compartilhada` distingue as duas. Declará-la aqui tiraria de
 * quem opera a capacidade de salvar o próprio recorte — que é exatamente o
 * problema que esta fase existe para resolver.
 *
 * Quem decide é o gatilho da 0038, que vê o corpo. É a mesma divisão das
 * alçadas: a permissão da rota responde "pode fazer isto?", o banco responde
 * "até onde?".
 *
 * ## E por que as rotas declaram permissão mesmo assim
 *
 * Porque RN-026 nega por omissão e o guarda recusa **rota sem permissão
 * declarada** antes de olhar o token. O primeiro desenho desta fase não
 * declarava nenhuma, e a suíte o reprovou com a mensagem certa: não existe
 * "rota sem permissão" nesta base. `visao:ler` e `visao:gerenciar` são largas
 * de propósito — vão junto de qualquer `:ler` de lista nos perfis —, e o que
 * de fato restringe continua sendo `visao:compartilhar`, no corpo.
 */
@Controller('api/v1/visoes')
export class VisoesController {
  constructor(private readonly servico: VisoesService) {}

  @Get()
  @ExigePermissao('visao:ler')
  listar(@Query(validar(ListarVisoes)) filtro: ListarVisoes) {
    return this.servico.listar(filtro.tela)
  }

  @Post()
  @HttpCode(201)
  @ExigePermissao('visao:gerenciar')
  criar(@Body(validar(CriarVisao)) corpo: CriarVisao) {
    return this.servico.criar(corpo)
  }

  @Patch(':id')
  @ExigePermissao('visao:gerenciar')
  editar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EditarVisao)) corpo: EditarVisao,
  ) {
    return this.servico.editar(id, corpo)
  }

  @Delete(':id')
  @HttpCode(204)
  @ExigePermissao('visao:gerenciar')
  excluir(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.excluir(id)
  }

  /**
   * Duplicar como minha.
   *
   * `POST` e não `PATCH`: cria um recurso novo. A visão de origem não muda — é
   * essa a razão de a rota existir para quem não pode mudá-la.
   */
  @Post(':id/duplicar')
  @HttpCode(201)
  @ExigePermissao('visao:gerenciar')
  duplicar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(DuplicarVisao)) corpo: DuplicarVisao,
  ) {
    return this.servico.duplicar(id, corpo)
  }
}
