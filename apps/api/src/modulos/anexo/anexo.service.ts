import { Injectable } from '@nestjs/common'
import type { Anexo, ListarAnexos, RegistrarAnexo } from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { naoEncontrado } from '../../comum/erros.js'
import { exigirClaims } from '../../comum/contexto.js'
import { AnexoRepositorio } from './anexo.repositorio.js'

@Injectable()
export class AnexoService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: AnexoRepositorio,
  ) {}

  listar(filtro: ListarAnexos): Promise<Anexo[]> {
    return this.banco.emTransacao((db) => this.repo.listar(db, filtro))
  }

  async registrar(dados: RegistrarAnexo): Promise<Anexo> {
    const claims = exigirClaims()
    const anexo = await this.banco.emTransacao(
      (db) => this.repo.registrar(db, dados, claims.usuario_id),
      { motivo: `anexo ${dados.nome_arquivo}` },
    )
    if (!anexo) throw naoEncontrado('anexo')
    return anexo
  }

  async remover(id: string, motivo: string): Promise<void> {
    const claims = exigirClaims()
    const removeu = await this.banco.emTransacao(
      (db) => this.repo.remover(db, id, motivo, claims.usuario_id),
      { motivo },
    )
    if (!removeu) throw naoEncontrado('anexo')
  }
}
