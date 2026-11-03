import { Injectable } from '@nestjs/common'
import type {
  AbrirInventario,
  CancelarInventario,
  CancelarOrdemCompra,
  CriarOrdemCompra,
  Inventario,
  ListarInventarios,
  ListarOrdensCompra,
  OrdemCompra,
  ReceberOrdemCompra,
  RegistrarContagem,
} from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { exigirClaims } from '../../comum/contexto.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { ComprasRepositorio, cursorDeInventario, cursorDeOrdem } from './compras.repositorio.js'

/**
 * Ordem de compra e inventário.
 *
 * As duas máquinas e os dois efeitos de estoque — entrada no recebimento,
 * ajuste na aprovação do inventário — moram nos gatilhos da 0036 e da 0035.
 * Este serviço é o que falta em volta: quem pode fazer o quê, e a recusa
 * legível quando não pode.
 */
@Injectable()
export class ComprasService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: ComprasRepositorio,
  ) {}

  /* --------------------------------------------------- ordem de compra --- */

  async criarOrdem(dados: CriarOrdemCompra): Promise<OrdemCompra> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const id = await this.repo.criarOrdem(db, claims.tenant_id, dados)
      const criada = await this.repo.ordemPorId(db, id)
      if (!criada) throw naoEncontrado('Ordem de compra', id)
      return criada
    })
  }

  async ordemPorId(id: string): Promise<OrdemCompra> {
    const o = await this.banco.emTransacao((db) => this.repo.ordemPorId(db, id))
    if (!o) throw naoEncontrado('Ordem de compra', id)
    return o
  }

  async listarOrdens(filtro: ListarOrdensCompra): Promise<Pagina<OrdemCompra>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarOrdens(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas, {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorDeOrdem(ultimo)) : null,
      })
    })
  }

  async aprovarOrdem(id: string): Promise<OrdemCompra> {
    return this.mudarOrdem(id, 'APROVADA', null, 'aprovação de compra')
  }

  async cancelarOrdem(id: string, dados: CancelarOrdemCompra): Promise<OrdemCompra> {
    return this.mudarOrdem(id, 'CANCELADA', dados.motivo, dados.motivo)
  }

  private async mudarOrdem(
    id: string,
    status: OrdemCompra['status'],
    motivo: string | null,
    registro: string,
  ): Promise<OrdemCompra> {
    return this.banco.emTransacao(
      async (db) => {
        const atual = await this.repo.ordemPorId(db, id)
        if (!atual) throw naoEncontrado('Ordem de compra', id)
        await this.repo.mudarStatusOrdem(db, id, status, motivo)
        const nova = await this.repo.ordemPorId(db, id)
        if (!nova) throw naoEncontrado('Ordem de compra', id)
        return nova
      },
      { motivo: registro },
    )
  }

  /**
   * Recebimento, total ou parcial.
   *
   * O corpo traz a quantidade **acumulada** por item, e o gatilho da 0036
   * calcula o delta, gera a entrada de estoque e deriva o status da ordem. Não
   * há conta aqui: duas cópias da mesma aritmética divergem, e a desta ponta
   * seria a que fica fora da transação do saldo.
   */
  async receberOrdem(id: string, dados: ReceberOrdemCompra): Promise<OrdemCompra> {
    return this.banco.emTransacao(
      async (db) => {
        const atual = await this.repo.ordemPorId(db, id)
        if (!atual) throw naoEncontrado('Ordem de compra', id)

        for (const item of dados.itens) {
          const ok = await this.repo.receberItem(db, item.item_id, id, item.quantidade_recebida)
          if (!ok) {
            throw new ErroDominio('NAO_ENCONTRADO', 'Item não pertence a esta ordem', {
              detail: 'O item informado não existe nesta ordem de compra.',
              errors: [{ field: 'item_id', code: 'ITEM_DE_OUTRA_ORDEM' }],
            })
          }
        }

        const nova = await this.repo.ordemPorId(db, id)
        if (!nova) throw naoEncontrado('Ordem de compra', id)
        return nova
      },
      { motivo: 'recebimento de mercadoria' },
    )
  }

  /* -------------------------------------------------------- inventário --- */

  async abrirInventario(dados: AbrirInventario): Promise<Inventario> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const id = await this.repo.abrirInventario(db, claims.tenant_id, dados)
      const criado = await this.repo.inventarioPorId(db, id)
      if (!criado) throw naoEncontrado('Inventário', id)
      return criado
    })
  }

  async inventarioPorId(id: string): Promise<Inventario> {
    const i = await this.banco.emTransacao((db) => this.repo.inventarioPorId(db, id))
    if (!i) throw naoEncontrado('Inventário', id)
    return i
  }

  async listarInventarios(filtro: ListarInventarios): Promise<Pagina<Inventario>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarInventarios(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas, {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorDeInventario(ultimo)) : null,
      })
    })
  }

  async registrarContagem(id: string, dados: RegistrarContagem): Promise<Inventario> {
    const claims = exigirClaims()
    return this.banco.emTransacao(
      async (db) => {
        const ok = await this.repo.registrarContagem(db, claims.tenant_id, id, dados)
        if (!ok) throw naoEncontrado('Inventário', id)
        const i = await this.repo.inventarioPorId(db, id)
        if (!i) throw naoEncontrado('Inventário', id)
        return i
      },
      { motivo: 'contagem de inventário' },
    )
  }

  async fecharContagem(id: string): Promise<Inventario> {
    return this.mudarInventario(id, 'CONTADO', null, 'fechamento de contagem')
  }

  /**
   * Aprovação: gera os movimentos de ajuste (Anexo D.6).
   *
   * Em lote e no gatilho, porque o conjunto é que é a decisão — e porque cada
   * ajuste passa pela alçada de inventário. Se um exceder o teto, a aprovação
   * inteira recua: aprovar metade das divergências deixaria o saldo numa
   * combinação que ninguém contou.
   */
  async aprovarInventario(id: string): Promise<Inventario> {
    return this.mudarInventario(id, 'APROVADO', null, 'aprovação de inventário')
  }

  async cancelarInventario(id: string, dados: CancelarInventario): Promise<Inventario> {
    return this.mudarInventario(id, 'CANCELADO', dados.motivo, dados.motivo)
  }

  private async mudarInventario(
    id: string,
    status: Inventario['status'],
    motivo: string | null,
    registro: string,
  ): Promise<Inventario> {
    return this.banco.emTransacao(
      async (db) => {
        const atual = await this.repo.inventarioPorId(db, id)
        if (!atual) throw naoEncontrado('Inventário', id)
        await this.repo.mudarStatusInventario(db, id, status, motivo)
        const novo = await this.repo.inventarioPorId(db, id)
        if (!novo) throw naoEncontrado('Inventário', id)
        return novo
      },
      { motivo: registro },
    )
  }
}
