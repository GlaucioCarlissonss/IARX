import { Injectable } from '@nestjs/common'
import type {
  ConsumoDoCliente,
  ContratoDetalhado,
  ContratoDoCliente,
  CustoDaCompetencia,
  EquipamentoDoCliente,
  ListarConsumo,
  ListarContratosDoCliente,
  ListarCustos,
  ListarEquipamentosDoCliente,
  MemoriaDaCompetencia,
  ResumoPortal,
} from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { exigirClaims } from '../../comum/contexto.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import {
  PortalRepositorio,
  cursorConsumo,
  cursorContrato,
  cursorEquipamento,
  mapearConsumo,
  mapearContrato,
  mapearEquipamento,
} from './portal.repositorio.js'

/**
 * Portal do cliente.
 *
 * O serviço não recorta nada: os dois recortes — cliente (0011) e unidade
 * (0024) — são da RLS, e é por isso que as mesmas consultas respondem certo para
 * o administrador do cliente e para o gestor de uma unidade. O que ele faz é
 * exigir contexto de cliente e traduzir a ausência de linha em 404.
 *
 * **404, nunca 403**, e é critério de aceite: distinguir "não é seu" de "não
 * existe" confirma a existência de um registro alheio — oráculo suficiente para
 * enumerar a base de outro cliente um id por vez. Com a RLS o SELECT já não
 * devolve a linha, e `naoEncontrado` garante que o tratamento acima também não
 * vaze a diferença.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: PortalRepositorio,
  ) {}

  /**
   * O portal exige contexto de cliente.
   *
   * Sem `cliente_id` no token quem chama é usuário da locadora, e para ele
   * `app.cliente_atual()` devolve nulo — as políticas de cliente deixam de
   * recortar e o portal responderia com a base inteira do locatário. A recusa é
   * explícita porque o silêncio aqui seria o oposto do que o prefixo `/portal`
   * promete: que nenhuma rota de cliente alcança dado do locador, e nenhuma rota
   * do locador se disfarça de cliente.
   */
  private exigirCliente(): void {
    if (!exigirClaims().cliente_id) {
      throw new ErroDominio('FORA_DE_ESCOPO', 'O portal responde a usuário de cliente', {
        detail:
          'Este token não carrega cliente. As rotas /portal existem para o locatário; a operação da locadora usa as rotas equivalentes sem o prefixo.',
      })
    }
  }

  async resumo(): Promise<ResumoPortal> {
    this.exigirCliente()
    return this.banco.emTransacao(async (db) => {
      const r = await this.repo.resumo(db)
      if (!r.cliente_id) throw naoEncontrado('Cliente')

      return {
        cliente: {
          id: r.cliente_id,
          razao_social: r.razao_social,
          nome_fantasia: r.nome_fantasia,
        },
        clientes_no_escopo: Number(r.clientes_no_escopo),
        unidades_no_escopo: Number(r.unidades_no_escopo),
        contratos: {
          ativos: Number(r.contratos_ativos),
          proximo_vencimento: r.proximo_vencimento,
        },
        parque: { total: Number(r.parque_total), por_status: r.por_status },
        consumo_em_aberto: {
          competencia: r.competencia_aberta ? r.competencia_aberta.trim() : null,
          ultima_leitura_em: r.ultima_leitura_em ? r.ultima_leitura_em.toISOString() : null,
          /*
           * RN-L33. Verdadeiro sempre que existe competência aberta — e é o que
           * impede o cliente de planejar caixa sobre uma medição que ainda vai
           * crescer. Sem competência aberta não há parcial a declarar.
           */
          parcial: r.competencia_aberta !== null,
          paginas: Number(r.paginas_abertas),
          excedente: Number(r.excedente_aberto).toFixed(4) as ResumoPortal['consumo_em_aberto']['excedente'],
        },
        cobranca_em_aberto: {
          total: Number(r.cobranca_total).toFixed(4) as ResumoPortal['cobranca_em_aberto']['total'],
          vencido: Number(r.cobranca_vencida).toFixed(4) as ResumoPortal['cobranca_em_aberto']['vencido'],
        },
      }
    })
  }

  async contratos(filtro: ListarContratosDoCliente): Promise<Pagina<ContratoDoCliente>> {
    this.exigirCliente()
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarContratos(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearContrato), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorContrato(ultimo)) : null,
      })
    })
  }

  async contrato(id: string): Promise<ContratoDetalhado> {
    this.exigirCliente()
    return this.banco.emTransacao(async (db) => {
      const l = await this.repo.contratoPorId(db, id)
      if (!l) throw naoEncontrado('Contrato', id)
      return {
        ...mapearContrato(l),
        itens_detalhados: await this.repo.itensDoContrato(db, id),
      }
    })
  }

  async equipamentos(
    filtro: ListarEquipamentosDoCliente,
  ): Promise<Pagina<EquipamentoDoCliente>> {
    this.exigirCliente()
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarEquipamentos(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearEquipamento), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorEquipamento(ultimo)) : null,
      })
    })
  }

  async consumo(filtro: ListarConsumo): Promise<Pagina<ConsumoDoCliente>> {
    this.exigirCliente()
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarConsumo(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearConsumo), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorConsumo(ultimo)) : null,
      })
    })
  }

  async custos(filtro: ListarCustos): Promise<CustoDaCompetencia[]> {
    this.exigirCliente()
    return this.banco.emTransacao((db) =>
      this.repo.custos(db, filtro.competencia_de, filtro.competencia_ate),
    )
  }

  /**
   * A memória de cálculo de uma competência.
   *
   * Endereçada pela **competência**, e não por um id de fatura. O Anexo L
   * escreveu `/portal/faturas/{id}/memoria`, e o id não serve aqui por duas
   * razões: a competência aberta não tem cobrança nenhuma e é justamente a que o
   * cliente mais quer conferir, e o que explica o valor é a medição, não o
   * título — a separação feita ao remover o modelo de fatura duplicado.
   */
  async memoria(competencia: string): Promise<MemoriaDaCompetencia> {
    this.exigirCliente()
    return this.banco.emTransacao(async (db) => {
      const linhas = await this.repo.consumoDaCompetencia(db, competencia)
      if (linhas.length === 0) throw naoEncontrado('Medição da competência', competencia)

      const itens = linhas.map(mapearConsumo)
      const excedente = itens.reduce((a, i) => a + Number(i.valor_excedente), 0)
      const [custo] = await this.repo.custos(db, competencia, competencia)

      return {
        competencia,
        parcial: itens.some((i) => i.parcial),
        itens,
        // A locação vem da mesma decomposição que `/custos` usa, e não de uma
        // segunda soma: dois números defensáveis para a mesma competência é o
        // que faria o cliente confrontar o portal com o boleto.
        locacao: (custo ? Number(custo.locacao) : 0).toFixed(4) as MemoriaDaCompetencia['locacao'],
        excedente: excedente.toFixed(4) as MemoriaDaCompetencia['excedente'],
        total: (custo ? Number(custo.total) : excedente).toFixed(4) as MemoriaDaCompetencia['total'],
      }
    })
  }
}
