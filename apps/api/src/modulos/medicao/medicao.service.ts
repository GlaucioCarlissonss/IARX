import { Injectable } from '@nestjs/common'
import type { EstornarLeitura, Leitura, ListarLeituras, Medidor, RegistrarLeituraMedidor } from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { naoEncontrado } from '../../comum/erros.js'
import { exigirClaims } from '../../comum/contexto.js'
import { MedicaoRepositorio } from './medicao.repositorio.js'

@Injectable()
export class MedicaoService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: MedicaoRepositorio,
  ) {}

  medidores(equipamentoId: string): Promise<Medidor[]> {
    return this.banco.emTransacao((db) => this.repo.medidoresDe(db, equipamentoId))
  }

  leituras(equipamentoId: string, filtro: ListarLeituras): Promise<Leitura[]> {
    return this.banco.emTransacao((db) => this.repo.leiturasDe(db, equipamentoId, filtro))
  }

  /**
   * Registra a leitura.
   *
   * Nenhuma checagem de monotonia aqui: RN-020 é gatilho, e o `23514` que ele
   * levanta vira erro de domínio na tradução de SQLSTATE. Conferir antes seria
   * conferir duas vezes a mesma coisa — e a verificação da aplicação ainda
   * perderia a corrida com duas leituras simultâneas, que o gatilho não perde.
   */
  async registrar(equipamentoId: string, dados: RegistrarLeituraMedidor): Promise<Leitura> {
    const claims = exigirClaims()
    const leitura = await this.banco.emTransacao(
      (db) => this.repo.registrar(db, equipamentoId, dados, claims.usuario_id),
      { motivo: `leitura ${dados.origem.toLowerCase()} em ${dados.data_leitura.slice(0, 10)}` },
    )
    if (!leitura) throw naoEncontrado('leitura')
    return leitura
  }

  async estornar(id: string, dados: EstornarLeitura): Promise<Leitura> {
    const claims = exigirClaims()
    const leitura = await this.banco.emTransacao(
      (db) => this.repo.estornar(db, id, dados, claims.usuario_id),
      { motivo: dados.motivo },
    )
    /*
     * Mesma resposta para "não existe" e "já estornada", e é a resposta certa
     * nos dois casos: não há o que estornar. Diferenciar entregaria, pela
     * mensagem, a existência de um id que o usuário não deveria conhecer.
     */
    if (!leitura) throw naoEncontrado('leitura')
    return leitura
  }
}
