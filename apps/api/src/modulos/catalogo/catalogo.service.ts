import { Injectable } from '@nestjs/common'
import type { Catalogo } from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { CatalogoRepositorio } from './catalogo.repositorio.js'

@Injectable()
export class CatalogoService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: CatalogoRepositorio,
  ) {}

  tudo(): Promise<Catalogo> {
    return this.banco.emTransacao((db) => this.repo.tudo(db))
  }
}
