import { Injectable } from '@nestjs/common'
import type {
  CentroCusto,
  ContaBancaria,
  CriarCentroCusto,
  CriarContaBancaria,
  EditarCentroCusto,
  EditarContaBancaria,
  LancarMovimentacao,
  ListarCentrosCusto,
  ListarContasBancarias,
  ListarExtrato,
  MovimentacaoBancaria,
  Transferir,
} from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import {
  FinanceiroRepositorio,
  cursorCentro,
  cursorConta,
  cursorMovimento,
  mapearCentro,
  mapearConta,
  mapearMovimento,
} from './financeiro.repositorio.js'

/**
 * Centro de custo, conta bancária e extrato.
 *
 * O serviço **não** revalida as invariantes que o banco impõe — profundidade da
 * árvore, ciclo, saldo, dupla entrada, imutabilidade da movimentação. Elas
 * moram na migração 0017 porque é lá que precisam valer mesmo para quem não
 * passa por aqui: uma importação em massa, um job futuro, um `psql` de
 * emergência.
 *
 * O que este serviço faz é traduzir a recusa em algo acionável. `check_violation`
 * cru não diz a ninguém o que corrigir, e um 500 numa regra de negócio prevista
 * é a diferença entre "o sistema recusou porque X" e "o sistema quebrou".
 */
@Injectable()
export class FinanceiroService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: FinanceiroRepositorio,
  ) {}

  /* --------------------------------------------------- centro de custo */

  async listarCentros(filtro: ListarCentrosCusto): Promise<Pagina<CentroCusto>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarCentros(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearCentro), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorCentro(ultimo)) : null,
      })
    })
  }

  async criarCentro(dados: CriarCentroCusto): Promise<CentroCusto> {
    return this.banco.emTransacao(async (db) => {
      try {
        const id = await this.repo.criarCentro(db, dados)
        const criado = await this.repo.centroPorId(db, id)
        if (!criado) throw naoEncontrado('Centro de custo', id)
        return criado
      } catch (e) {
        throw this.traduzirCentro(e)
      }
    })
  }

  async editarCentro(id: string, versao: number, dados: EditarCentroCusto): Promise<CentroCusto> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.centroPorId(db, id)
      if (!atual) throw naoEncontrado('Centro de custo', id)

      try {
        const ok = await this.repo.editarCentro(db, id, versao, dados)
        if (!ok) throw this.conflito(atual.version)
        const depois = await this.repo.centroPorId(db, id)
        return depois!
      } catch (e) {
        throw this.traduzirCentro(e)
      }
    })
  }

  /**
   * Inativar e reativar são a mesma rota com destino explícito.
   *
   * A recusa de inativar centro com filho ativo vem do banco (RN-L43) e é
   * traduzida aqui com a saída à mão: quem recebe "não pode" precisa saber o
   * que fazer em seguida, e a resposta é "inative os subcentros primeiro".
   */
  async definirAtivoCentro(id: string, versao: number, ativo: boolean): Promise<CentroCusto> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.centroPorId(db, id)
      if (!atual) throw naoEncontrado('Centro de custo', id)

      try {
        const ok = await this.repo.definirAtivoCentro(db, id, versao, ativo)
        if (!ok) throw this.conflito(atual.version)
        const depois = await this.repo.centroPorId(db, id)
        return depois!
      } catch (e) {
        throw this.traduzirCentro(e)
      }
    })
  }

  /* --------------------------------------------------- conta bancária */

  async listarContas(filtro: ListarContasBancarias): Promise<Pagina<ContaBancaria>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarContas(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearConta), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorConta(ultimo)) : null,
      })
    })
  }

  async contaPorId(id: string): Promise<ContaBancaria> {
    return this.banco.emTransacao(async (db) => {
      const conta = await this.repo.contaPorId(db, id)
      if (!conta) throw naoEncontrado('Conta bancária', id)
      return conta
    })
  }

  async criarConta(dados: CriarContaBancaria): Promise<ContaBancaria> {
    return this.banco.emTransacao(async (db) => {
      try {
        const id = await this.repo.criarConta(db, dados)
        const criada = await this.repo.contaPorId(db, id)
        return criada!
      } catch (e) {
        throw this.traduzirConta(e)
      }
    })
  }

  async editarConta(id: string, versao: number, dados: EditarContaBancaria): Promise<ContaBancaria> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.contaPorId(db, id)
      if (!atual) throw naoEncontrado('Conta bancária', id)

      try {
        const ok = await this.repo.editarConta(db, id, versao, dados)
        if (!ok) throw this.conflito(atual.version)
        const depois = await this.repo.contaPorId(db, id)
        return depois!
      } catch (e) {
        throw this.traduzirConta(e)
      }
    })
  }

  /* --------------------------------------------------- movimentação */

  async extrato(contaId: string, filtro: ListarExtrato): Promise<Pagina<MovimentacaoBancaria>> {
    return this.banco.emTransacao(async (db) => {
      const conta = await this.repo.contaPorId(db, contaId)
      if (!conta) throw naoEncontrado('Conta bancária', contaId)

      const { linhas, temMais } = await this.repo.listarExtrato(db, contaId, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearMovimento), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorMovimento(ultimo)) : null,
      })
    })
  }

  async lancar(contaId: string, dados: LancarMovimentacao): Promise<MovimentacaoBancaria> {
    return this.banco.emTransacao(async (db) => {
      const conta = await this.repo.contaPorId(db, contaId)
      if (!conta) throw naoEncontrado('Conta bancária', contaId)

      try {
        const id = await this.repo.lancar(db, contaId, dados)
        const criada = await this.repo.movimentoPorId(db, id)
        return criada!
      } catch (e) {
        throw this.traduzirMovimento(e)
      }
    })
  }

  async transferir(dados: Transferir): Promise<{ saida: MovimentacaoBancaria; entrada: MovimentacaoBancaria }> {
    return this.banco.emTransacao(async (db) => {
      // As duas contas são conferidas antes: sem isso, uma origem inexistente
      // viraria erro de FK — um 500 onde cabe um 404 que diz qual das duas
      // contas não existe.
      const origem = await this.repo.contaPorId(db, dados.conta_origem_id)
      if (!origem) throw naoEncontrado('Conta bancária de origem', dados.conta_origem_id)
      const destino = await this.repo.contaPorId(db, dados.conta_destino_id)
      if (!destino) throw naoEncontrado('Conta bancária de destino', dados.conta_destino_id)

      try {
        const { saida_id, entrada_id } = await this.repo.transferir(db, dados)
        const saida = await this.repo.movimentoPorId(db, saida_id)
        const entrada = await this.repo.movimentoPorId(db, entrada_id)
        return { saida: saida!, entrada: entrada! }
      } catch (e) {
        throw this.traduzirMovimento(e)
      }
    })
  }

  async estornar(movimentoId: string, motivo: string): Promise<MovimentacaoBancaria> {
    return this.banco.emTransacao(async (db) => {
      const original = await this.repo.movimentoPorId(db, movimentoId)
      if (!original) throw naoEncontrado('Movimentação bancária', movimentoId)

      const id = await this.repo.estornar(db, movimentoId, motivo)
      if (!id) {
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'Movimentação já estornada, ou é ela mesma um estorno', {
          detail:
            'Estornar um estorno reabriria o valor original pela terceira vez. Lance um novo movimento com descrição própria.',
          acoes: [
            {
              code: 'LANCAR_NOVO',
              descricao: 'Lance uma movimentação nova explicando o ajuste, em vez de estornar o estorno.',
            },
          ],
        })
      }

      const estorno = await this.repo.movimentoPorId(db, id)
      return estorno!
    })
  }

  async conciliar(movimentoId: string, conciliado: boolean): Promise<MovimentacaoBancaria> {
    return this.banco.emTransacao(async (db) => {
      const ok = await this.repo.conciliar(db, movimentoId, conciliado)
      if (!ok) throw naoEncontrado('Movimentação bancária', movimentoId)
      const depois = await this.repo.movimentoPorId(db, movimentoId)
      return depois!
    })
  }

  /* --------------------------------------------------- tradução de erro */

  private conflito(versaoAtual: number): ErroDominio {
    return new ErroDominio('CONFLITO_DE_VERSAO', 'O registro mudou desde a leitura', {
      detail: `A versão atual é ${versaoAtual}. Recarregue e reenvie com ela.`,
      acoes: [{ code: 'RECARREGAR', descricao: 'Recarregue o registro e reaplique a alteração.' }],
    })
  }

  private traduzirCentro(e: unknown): unknown {
    if (e instanceof ErroDominio) return e
    const codigo = (e as { code?: string }).code
    const mensagem = String((e as { message?: string }).message ?? '')

    if (codigo === '23505' || codigo === '23000' || codigo === '23514') {
      if (mensagem.includes('nível')) {
        return new ErroDominio('REGRA_DE_NEGOCIO', 'A árvore de centros de custo tem no máximo 3 níveis', {
          detail: mensagem,
          errors: [{ field: 'centro_pai_id', code: 'PROFUNDIDADE_EXCEDIDA' }],
          acoes: [
            {
              code: 'ESCOLHER_PAI_MAIS_ALTO',
              descricao: 'Escolha um centro pai de nível 1 ou 2, ou crie este centro na raiz.',
            },
          ],
        })
      }
      if (mensagem.includes('si mesmo')) {
        return new ErroDominio('REGRA_DE_NEGOCIO', 'Centro de custo não pode descender de si mesmo', {
          detail: mensagem,
          errors: [{ field: 'centro_pai_id', code: 'CICLO' }],
        })
      }
      if (mensagem.includes('subcentro')) {
        return new ErroDominio('REGRA_DE_NEGOCIO', 'Há subcentros ativos abaixo deste', {
          detail: mensagem,
          errors: [{ field: 'ativo', code: 'TEM_FILHO_ATIVO' }],
          acoes: [
            {
              code: 'INATIVAR_FILHOS',
              descricao:
                'Inative os subcentros primeiro. Inativar em cascata desligaria o que não está à vista.',
            },
          ],
        })
      }
    }

    // 23505 é violação de unicidade: o código do centro já existe no locatário.
    if (codigo === '23505') {
      return new ErroDominio('RECURSO_DUPLICADO', 'Já existe um centro de custo com este código', {
        errors: [{ field: 'codigo', code: 'DUPLICADO' }],
      })
    }

    return e
  }

  private traduzirConta(e: unknown): unknown {
    if (e instanceof ErroDominio) return e
    const codigo = (e as { code?: string }).code

    if (codigo === '23505') {
      return new ErroDominio('RECURSO_DUPLICADO', 'Esta conta bancária já está cadastrada', {
        detail: 'Banco, agência e número coincidem com uma conta existente desta empresa.',
        errors: [{ field: 'numero', code: 'DUPLICADO' }],
      })
    }
    return e
  }

  private traduzirMovimento(e: unknown): unknown {
    if (e instanceof ErroDominio) return e
    const codigo = (e as { code?: string }).code
    const mensagem = String((e as { message?: string }).message ?? '')
    if (codigo !== '23514') return e

    if (mensagem.includes('bloqueada')) {
      return new ErroDominio('REGRA_DE_NEGOCIO', 'Conta bloqueada não aceita lançamento manual', {
        detail: mensagem,
        errors: [{ field: 'conta_id', code: 'CONTA_BLOQUEADA' }],
        acoes: [
          {
            code: 'DESBLOQUEAR_OU_TROCAR',
            descricao: 'Desbloqueie a conta ou escolha outra. Importação de extrato e estorno seguem permitidos.',
          },
        ],
      })
    }
    if (mensagem.includes('inativa') || mensagem.includes('excluída')) {
      return new ErroDominio('REGRA_DE_NEGOCIO', 'Conta indisponível para movimentação', {
        detail: mensagem,
        errors: [{ field: 'conta_id', code: 'CONTA_INDISPONIVEL' }],
      })
    }
    if (mensagem.includes('não se edita') || mensagem.includes('não se apaga') || mensagem.includes('reaponta')) {
      return new ErroDominio('REGRA_DE_NEGOCIO', 'Movimentação bancária é imutável', {
        detail: mensagem,
        acoes: [{ code: 'ESTORNAR', descricao: 'Lance o estorno, com motivo, em vez de alterar o registro.' }],
      })
    }
    if (mensagem.includes('duas contas distintas')) {
      return new ErroDominio('REGRA_DE_NEGOCIO', 'Transferência precisa de duas contas distintas', {
        detail: mensagem,
        errors: [{ field: 'conta_destino_id', code: 'MESMA_CONTA' }],
      })
    }
    return e
  }
}
