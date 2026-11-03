import { Injectable } from '@nestjs/common'
import type {
  DefinirPolitica,
  Deposito,
  ListarMovimentos,
  ListarPecas,
  MovimentoEstoque,
  OsPeca,
  Peca,
  PoliticaReposicao,
  RegistrarAjuste,
  RegistrarMovimento,
  SaldoEstoque,
  SolicitarPeca,
  SugestaoReposicao,
} from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
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

  /**
   * Ajuste de inventário — rota e permissão próprias.
   *
   * O corpo não traz `tipo`: ele é `AJUSTE_INVENTARIO` por construção. Aceitá-lo
   * faria esta rota, com a permissão restrita, registrar qualquer movimento — e
   * `estoque:ajustar` passaria a valer como `estoque:movimentar` mais alguma
   * coisa, em vez de ser a permissão estreita que o catálogo descreve.
   *
   * O teto por perfil é do gatilho da 0035. Aqui se responde a outra pergunta:
   * se esta pessoa ajusta inventário.
   */
  async registrarAjuste(dados: RegistrarAjuste): Promise<MovimentoEstoque> {
    const claims = exigirClaims()
    const mov = await this.banco.emTransacao(
      (db) =>
        this.repo.registrarMovimento(
          db,
          {
            peca_id: dados.peca_id,
            deposito_id: dados.deposito_id,
            tipo: 'AJUSTE_INVENTARIO',
            quantidade: dados.quantidade,
            custo_unitario: dados.custo_unitario,
            motivo: dados.motivo,
          } as RegistrarMovimento,
          claims.usuario_id,
        ),
      { motivo: dados.motivo },
    )
    if (!mov) throw naoEncontrado('peça ou depósito')
    return mov
  }

  /* ------------------------------------------- política de reposição --- */

  async definirPolitica(dados: DefinirPolitica): Promise<PoliticaReposicao[]> {
    return this.banco.emTransacao(async (db) => {
      await this.repo.definirPolitica(db, dados)
      return this.repo.politicas(db, dados.peca_id)
    })
  }

  async politicas(pecaId?: string): Promise<PoliticaReposicao[]> {
    return this.banco.emTransacao((db) => this.repo.politicas(db, pecaId))
  }

  async sugestoesReposicao(): Promise<SugestaoReposicao[]> {
    return this.banco.emTransacao((db) => this.repo.sugestoesReposicao(db))
  }

  /* --------------------------------------------- reserva de peça na OS --- */

  async pecasDaOs(osId: string): Promise<OsPeca[]> {
    return this.banco.emTransacao((db) => this.repo.pecasDaOs(db, osId))
  }

  async solicitarPeca(osId: string, dados: SolicitarPeca): Promise<OsPeca[]> {
    return this.banco.emTransacao(
      async (db) => {
        const id = await this.repo.solicitarPeca(db, osId, dados)
        if (!id) throw naoEncontrado('ordem de serviço, peça ou depósito')
        return this.repo.pecasDaOs(db, osId)
      },
      { motivo: 'solicitação de peça' },
    )
  }

  /**
   * Transições da peça na OS (Anexo B.5).
   *
   * A máquina e os efeitos no saldo são do gatilho da 0035. Aqui só se
   * endereça a peça dentro da ordem e se traduz a recusa — duas cópias da
   * mesma regra divergem na primeira correção, e a cópia da aplicação ainda
   * perderia a corrida com duas requisições simultâneas sobre o mesmo saldo.
   */
  async mudarStatusPeca(osId: string, itemId: string, status: OsPeca['status']): Promise<OsPeca[]> {
    return this.banco.emTransacao(
      async (db) => {
        const ok = await this.repo.mudarStatusPeca(db, itemId, osId, status)
        if (!ok) {
          throw new ErroDominio('NAO_ENCONTRADO', 'Peça não encontrada nesta ordem', {
            detail: 'O item informado não pertence a esta ordem de serviço.',
            errors: [{ field: 'itemId', code: 'ITEM_DE_OUTRA_OS' }],
          })
        }
        return this.repo.pecasDaOs(db, osId)
      },
      { motivo: `peça: ${status.toLowerCase()}` },
    )
  }
}
