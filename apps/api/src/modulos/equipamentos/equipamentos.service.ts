import { Injectable } from '@nestjs/common'
import type { Equipamento, ListarEquipamentos } from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { EquipamentosRepositorio, cursorDe } from './equipamentos.repositorio.js'

@Injectable()
export class EquipamentosService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: EquipamentosRepositorio,
  ) {}

  async listar(filtro: ListarEquipamentos): Promise<Pagina<Equipamento>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listar(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas, {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorDe(ultimo)) : null,
      })
    })
  }

  async porId(id: string): Promise<Equipamento> {
    const e = await this.banco.emTransacao((db) => this.repo.porId(db, id))
    if (!e) throw naoEncontrado('Equipamento', id)
    return e
  }

  /**
   * Bloqueio operacional (RN-014).
   *
   * Não muda `status`: um ativo instalado no cliente continua LOCADO enquanto
   * bloqueado para nova alocação. São eixos diferentes, e colapsá-los perderia
   * exatamente o caso que mais custa — ativo em campo que não deveria ser
   * realocado ao fim do contrato atual.
   */
  async bloquear(id: string, version: number, motivo: string, ate: string | null): Promise<Equipamento> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Equipamento', id)

      if (atual.status === 'BAIXADO') {
        throw new ErroDominio('TRANSICAO_INVALIDA', 'Ativo baixado não aceita bloqueio', {
          detail: 'O equipamento já foi baixado do patrimônio; bloquear não teria efeito operacional.',
        })
      }

      const atualizado = await this.repo.bloquear(db, id, version, motivo, ate)
      if (!atualizado) throw conflitoDeVersao(version, atual.version)
      return atualizado
    })
  }

  async desbloquear(id: string, version: number): Promise<Equipamento> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Equipamento', id)

      if (!atual.bloqueado) {
        // Desbloquear o que já está livre é sucesso, não erro: a operação é
        // idempotente por natureza e devolver 409 obrigaria o cliente a
        // consultar antes de agir.
        return atual
      }

      const atualizado = await this.repo.desbloquear(db, id, version)
      if (!atualizado) throw conflitoDeVersao(version, atual.version)
      return atualizado
    })
  }
}

function conflitoDeVersao(enviada: number, atual: number): ErroDominio {
  return new ErroDominio('CONFLITO_DE_VERSAO', 'Registro alterado por outra operação', {
    detail: `A versão enviada (${enviada}) não é mais a atual (${atual}). Recarregue e refaça a alteração.`,
    errors: [{ field: 'version', code: 'VERSAO_DESATUALIZADA', meta: { enviada, atual } }],
  })
}
