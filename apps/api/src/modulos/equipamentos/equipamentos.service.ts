import { Injectable } from '@nestjs/common'
import type { CriarEquipamento, Equipamento, ListarEquipamentos } from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { exigirClaims } from '../../comum/contexto.js'
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

  /**
   * Cadastra um ativo.
   *
   * Nasce DISPONIVEL e desbloqueado, pelo default do banco. O caminho normal de
   * entrada de parque continua sendo a integração da nota fiscal de compra
   * (Anexo N), que cria os ativos com valor rateado e garantia calculada — este
   * cadastro existe para o que não veio por nota: ativo de terceiro, permuta,
   * parque herdado de um sistema anterior.
   */
  async criar(dados: CriarEquipamento): Promise<Equipamento> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      let id: string
      try {
        id = await this.repo.criar(db, claims.tenant_id, dados)
      } catch (e) {
        const codigo = (e as { code?: string }).code
        if (codigo === '23505') {
          throw new ErroDominio('RECURSO_DUPLICADO', 'Já existe um ativo com este patrimônio', {
            detail: 'O patrimônio identifica o ativo dentro do locatário.',
            errors: [{ field: 'patrimonio', code: 'DUPLICADO', message: dados.patrimonio }],
          })
        }
        if (codigo === '23503') {
          throw new ErroDominio('PAYLOAD_INVALIDO', 'Modelo, categoria ou filial inexistente', {
            detail: 'Um dos identificadores informados não existe neste locatário.',
          })
        }
        throw e
      }

      const criado = await this.repo.porId(db, id)
      if (!criado) throw naoEncontrado('Equipamento', id)
      return criado
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
