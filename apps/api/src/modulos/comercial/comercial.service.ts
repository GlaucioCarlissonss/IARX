import { Injectable } from '@nestjs/common'
import type { DescontoComercial, ListarDescontos, PoliticaComercial } from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { ComercialRepositorio } from './comercial.repositorio.js'

@Injectable()
export class ComercialService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: ComercialRepositorio,
  ) {}

  politica(): Promise<PoliticaComercial> {
    return this.banco.emTransacao((db) => this.repo.politica(db))
  }

  descontos(filtro: ListarDescontos): Promise<DescontoComercial[]> {
    return this.banco.emTransacao((db) => this.repo.descontos(db, filtro))
  }
}
