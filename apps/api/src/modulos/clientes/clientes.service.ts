import { Injectable } from '@nestjs/common'
import type {
  AtualizarCliente,
  Cliente,
  CriarCliente,
  CriarLocalOperacao,
  DefinirCredito,
  ListarClientes,
  LocalOperacao,
  Visao360,
} from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { exigirClaims } from '../../comum/contexto.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { ClientesRepositorio, cursorDe, mapearCliente } from './clientes.repositorio.js'

/**
 * Regras de cliente que a fronteira precisa traduzir.
 *
 * O serviço não reimplementa o que o banco já garante — unicidade do documento
 * por locatário, limite não negativo, isolamento por RLS. O que ele faz é
 * converter a recusa do banco em algo acionável: `23505` cru não diz a ninguém
 * que **já existe um cliente com aquele CNPJ**, e quem está cadastrando precisa
 * saber disso, não do nome do índice.
 */
@Injectable()
export class ClientesService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: ClientesRepositorio,
  ) {}

  async listar(filtro: ListarClientes): Promise<Pagina<Cliente>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listar(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearCliente), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorDe(ultimo)) : null,
      })
    })
  }

  async porId(id: string): Promise<Cliente> {
    return this.banco.emTransacao(async (db) => {
      const l = await this.repo.porId(db, id)
      if (!l) throw naoEncontrado('Cliente', id)
      return mapearCliente(l)
    })
  }

  async criar(dados: CriarCliente): Promise<Cliente> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      try {
        return mapearCliente(await this.repo.criar(db, dados, claims.tenant_id))
      } catch (e) {
        if ((e as { code?: string }).code !== '23505') throw e
        throw new ErroDominio('RECURSO_DUPLICADO', 'Já existe um cliente com este documento', {
          detail:
            'O documento identifica o cliente dentro do locatário. Se a empresa mudou de razão social, edite o cadastro existente em vez de criar outro.',
          errors: [{ field: 'documento', code: 'DUPLICADO', message: dados.documento }],
        })
      }
    })
  }

  async atualizar(id: string, versao: number, dados: AtualizarCliente): Promise<Cliente> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Cliente', id)

      const l = await this.repo.atualizar(db, id, versao, dados)
      /*
       * A linha existe (acabamos de lê-la) e o update não devolveu nada: só o
       * `version` do `where` pode ter falhado. Distinguir isto de "sumiu" é o
       * que permite dizer a quem edita que **outra pessoa salvou antes** — a
       * mensagem que evita a segunda tentativa idêntica.
       */
      if (!l) {
        throw new ErroDominio('CONFLITO_DE_VERSAO', 'O cliente mudou desde que você o abriu', {
          detail: `A versão em disco é ${atual.version}. Recarregue e reaplique a alteração.`,
        })
      }
      return mapearCliente(l)
    })
  }

  /**
   * Limite e situação de crédito.
   *
   * Sem `If-Match`: a decisão de crédito é sobre o cliente inteiro e substitui
   * o que havia, não emenda um texto que outra pessoa pode estar editando. Exigir
   * a versão aqui faria uma correção de nome fantasia bloquear um desbloqueio de
   * crédito, o que inverte a importância das duas coisas.
   *
   * O motivo vai para o `audit_log` pelo contexto da transação — é o mesmo
   * caminho por onde passam autor e origem, e não um campo a mais na tabela.
   */
  async definirCredito(id: string, dados: DefinirCredito): Promise<Cliente> {
    return this.banco.emTransacao(async (db) => {
      const l = await this.repo.definirCredito(db, id, dados)
      if (!l) throw naoEncontrado('Cliente', id)
      return mapearCliente(l)
    }, { motivo: dados.motivo })
  }

  async locais(clienteId: string): Promise<LocalOperacao[]> {
    return this.banco.emTransacao(async (db) => {
      const cliente = await this.repo.porId(db, clienteId)
      if (!cliente) throw naoEncontrado('Cliente', clienteId)
      return this.repo.locais(db, clienteId)
    })
  }

  async criarLocal(clienteId: string, dados: CriarLocalOperacao): Promise<LocalOperacao> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const cliente = await this.repo.porId(db, clienteId)
      if (!cliente) throw naoEncontrado('Cliente', clienteId)

      const id = await this.repo.criarLocal(db, claims.tenant_id, clienteId, dados)
      const locais = await this.repo.locais(db, clienteId)
      const criado = locais.find((l) => l.id === id)
      if (!criado) throw naoEncontrado('Local de operação', id)
      return criado
    })
  }

  /**
   * Visão 360.
   *
   * Devolve o que tem fonte e **declara o que não tem**, em vez de completar com
   * zeros. Um zero em "chamados abertos" é indistinguível de "não há módulo de
   * chamados", e a segunda leitura é a verdadeira: quem vê o painel decidiria
   * com base num número que nunca foi medido.
   */
  async visao360(id: string): Promise<Visao360> {
    return this.banco.emTransacao(async (db) => {
      const l = await this.repo.porId(db, id)
      if (!l) throw naoEncontrado('Cliente', id)

      return {
        cliente: mapearCliente(l),
        ...(await this.repo.visao360(db, id)),
        ausentes: [
          {
            campo: 'chamados',
            motivo:
              'Não há tabela de ordem de serviço no banco: o módulo de manutenção não foi construído (Anexo L, Módulos 15/16).',
          },
          {
            campo: 'rentabilidade',
            motivo:
              'O custo é rateado por centro de custo em titulo_pagar_rateio, e não há caminho de um título de despesa até um cliente. Depende de titulo_pagar.categoria_id e do Módulo 14.',
          },
        ],
      }
    })
  }
}
