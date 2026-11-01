import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ListarAnexos, RegistrarAnexo, RemoverAnexo } from '@iarx/contracts'
import { ExigePermissao } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { AnexoService } from './anexo.service.js'

/**
 * Anexos — metadado, nunca o byte.
 *
 * Nenhuma rota recebe arquivo. O cliente envia direto para o armazenamento e
 * registra aqui o que enviou. Fazer o upload passar pela API deixaria o
 * processo segurando megabytes em memória, transformaria o tempo limite de
 * requisição em limite de tamanho de arquivo, e um envio interrompido deixaria
 * a transação aberta.
 *
 * Permissão: `contrato:anexo_gerenciar`. É a única do catálogo para anexo, e
 * vale para todas as entidades — o que ela governa é a capacidade de juntar e
 * tirar documento, não o contrato em si. Quando houver necessidade de
 * granularidade por entidade, ela entra no catálogo antes de entrar aqui.
 */
@Controller('api/v1/anexos')
export class AnexoController {
  constructor(private readonly servico: AnexoService) {}

  @Get()
  @ExigePermissao('contrato:anexo_gerenciar')
  listar(@Query(validar(ListarAnexos)) filtro: ListarAnexos) {
    return this.servico.listar(filtro)
  }

  @Post()
  @ExigePermissao('contrato:anexo_gerenciar')
  registrar(@Body(validar(RegistrarAnexo)) corpo: RegistrarAnexo) {
    return this.servico.registrar(corpo)
  }

  /**
   * Remove o registro — e **não** o objeto no armazenamento.
   *
   * Apagar o byte junto tornaria a remoção irreversível no exato momento em
   * que ela costuma ser um engano, e a trilha guardaria a remoção de um
   * arquivo que ninguém mais consegue ver para julgar. A limpeza do
   * armazenamento é tarefa de retenção, com prazo próprio.
   *
   * `DELETE` com corpo porque o motivo é obrigatório: remoção de evidência sem
   * motivo é indistinguível de encobrimento.
   */
  @Delete(':id')
  @HttpCode(204)
  @ExigePermissao('contrato:anexo_gerenciar')
  async remover(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(RemoverAnexo)) corpo: RemoverAnexo,
  ) {
    await this.servico.remover(id, corpo.motivo)
  }
}
