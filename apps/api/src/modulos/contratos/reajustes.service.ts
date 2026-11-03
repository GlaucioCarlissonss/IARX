import { Injectable } from '@nestjs/common'
import type {
  EncerrarItem,
  ListarReajustes,
  ProporReajuste,
  Reajuste,
  RenunciarReajuste,
  SubstituirItem,
} from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { exigirClaims } from '../../comum/contexto.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { ContratosRepositorio } from './contratos.repositorio.js'
import { ReajustesRepositorio, cursorDeReajuste } from './reajustes.repositorio.js'

/**
 * Reajuste contratual (RN-008) e as duas ações de item que faltavam.
 *
 * A máquina do reajuste mora no gatilho da 0033 — inclusive o efeito de
 * aplicar, que reescreve o valor unitário dos itens com a regra de
 * arredondamento do anexo. Este serviço é o que falta em volta: quem pode
 * fazer o quê, e a recusa legível quando não pode.
 */
@Injectable()
export class ReajustesService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: ReajustesRepositorio,
    private readonly contratos: ContratosRepositorio,
  ) {}

  async propor(contratoId: string, dados: ProporReajuste): Promise<Reajuste> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const contrato = await this.contratos.porId(db, contratoId)
      if (!contrato) throw naoEncontrado('Contrato', contratoId)

      /*
       * Reajuste é correção de valor em contrato que está cobrando. Propor
       * sobre rascunho ou sobre contrato encerrado produz uma proposta sobre
       * zero — e alguém a aprovaria sem perceber, porque a tela mostraria
       * números coerentes entre si.
       */
      if (!['ATIVO', 'SUSPENSO', 'EM_RENOVACAO'].includes(contrato.status)) {
        throw new ErroDominio('TRANSICAO_INVALIDA', 'Contrato não está em cobrança', {
          detail: `O contrato ${contrato.numero} está em ${contrato.status}. O reajuste corrige valores de contrato vigente.`,
          errors: [{ field: 'status', code: 'STATUS_NAO_PERMITE', meta: { status: contrato.status } }],
        })
      }

      const id = await this.repo.propor(db, claims.tenant_id, contratoId, dados)
      const criado = await this.repo.porId(db, id)
      if (!criado) throw naoEncontrado('Reajuste', id)
      return criado
    })
  }

  async listar(filtro: ListarReajustes): Promise<Pagina<Reajuste>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listar(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas, {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorDeReajuste(ultimo)) : null,
      })
    })
  }

  async aprovar(id: string): Promise<Reajuste> {
    return this.mudar(id, 'APROVADO', null)
  }

  async aplicar(id: string): Promise<Reajuste> {
    return this.mudar(id, 'APLICADO', null)
  }

  async renunciar(id: string, dados: RenunciarReajuste): Promise<Reajuste> {
    return this.mudar(id, 'RENUNCIADO', dados.motivo)
  }

  private async mudar(
    id: string,
    status: Reajuste['status'],
    motivo: string | null,
  ): Promise<Reajuste> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Reajuste', id)

      await this.repo.mudarStatus(db, id, status, motivo)

      const novo = await this.repo.porId(db, id)
      if (!novo) throw naoEncontrado('Reajuste', id)
      return novo
    })
  }

  /* ----------------------------------------------------- ações de item --- */

  async encerrarItem(contratoId: string, itemId: string, dados: EncerrarItem): Promise<void> {
    return this.banco.emTransacao(async (db) => {
      const contrato = await this.contratos.porId(db, contratoId)
      if (!contrato) throw naoEncontrado('Contrato', contratoId)

      const ok = await this.repo.encerrarItem(db, itemId, contratoId, dados.encerrado_em, dados.motivo)
      if (!ok) {
        throw new ErroDominio('NAO_ENCONTRADO', 'Item não encontrado ou já encerrado', {
          detail: 'O item não pertence a este contrato, já foi encerrado ou foi substituído.',
          errors: [{ field: 'itemId', code: 'ITEM_INDISPONIVEL' }],
        })
      }
    })
  }

  /**
   * Substituição de ativo.
   *
   * Encerra o item atual como SUBSTITUIDO e cria o sucessor com a mesma
   * precificação, apontado por `substituido_por_id`. Não é editar o
   * `equipamento_id` do item: trocá-lo no lugar apagaria qual máquina esteve no
   * cliente em cada período, que é o que se consulta quando o cliente contesta
   * uma leitura ou um chamado.
   */
  async substituirItem(contratoId: string, itemId: string, dados: SubstituirItem): Promise<void> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const contrato = await this.contratos.porId(db, contratoId)
      if (!contrato) throw naoEncontrado('Contrato', contratoId)

      const novo = await this.repo.substituirItem(
        db,
        claims.tenant_id,
        itemId,
        contratoId,
        dados.equipamento_id,
        dados.motivo,
        dados.efetivado_em ?? new Date().toISOString(),
      )
      if (!novo) {
        throw new ErroDominio('NAO_ENCONTRADO', 'Item não encontrado ou não substituível', {
          detail: 'O item não pertence a este contrato ou não está em estado que admita substituição.',
          errors: [{ field: 'itemId', code: 'ITEM_INDISPONIVEL' }],
        })
      }
    })
  }
}
