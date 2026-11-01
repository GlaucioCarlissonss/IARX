import { Injectable } from '@nestjs/common'
import type {
  Deposito,
  ListarMovimentos,
  ListarPecas,
  MovimentoEstoque,
  Peca,
  RegistrarMovimento,
  SaldoEstoque,
} from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { naoEncontrado } from '../../comum/erros.js'
import { exigirClaims } from '../../comum/contexto.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { EstoqueRepositorio } from './estoque.repositorio.js'

@Injectable()
export class EstoqueService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: EstoqueRepositorio,
  ) {}

  async pecas(filtro: ListarPecas): Promise<Pagina<Peca>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarPecas(db, filtro)
      const ultimo = linhas[linhas.length - 1] as (Peca & { created_at?: Date }) | undefined
      return new Pagina(linhas, {
        limit: filtro.limit,
        next_cursor:
          temMais && ultimo?.created_at
            ? codificarCursor({ criadoEm: ultimo.created_at.toISOString(), id: ultimo.id })
            : null,
      })
    })
  }

  depositos(): Promise<Deposito[]> {
    return this.banco.emTransacao((db) => this.repo.depositos(db))
  }

  saldos(pecaId?: string): Promise<SaldoEstoque[]> {
    return this.banco.emTransacao((db) => this.repo.saldos(db, pecaId))
  }

  movimentos(filtro: ListarMovimentos): Promise<MovimentoEstoque[]> {
    return this.banco.emTransacao((db) => this.repo.movimentos(db, filtro))
  }

  /**
   * Registra o movimento.
   *
   * Nenhuma conferência de saldo aqui: `saldo_nao_negativo` é `check` no banco,
   * e conferir antes criaria uma janela de corrida entre a leitura e a escrita
   * — duas saídas simultâneas passariam as duas pela conferência e uma delas
   * deixaria o saldo negativo.
   */
  async registrarMovimento(dados: RegistrarMovimento): Promise<MovimentoEstoque> {
    const claims = exigirClaims()
    const mov = await this.banco.emTransacao(
      (db) => this.repo.registrarMovimento(db, dados, claims.usuario_id),
      { motivo: dados.motivo ?? `movimento ${dados.tipo.toLowerCase()}` },
    )
    if (!mov) throw naoEncontrado('peça ou depósito')
    return mov
  }
}
