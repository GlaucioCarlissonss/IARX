import { Injectable } from '@nestjs/common'
import type { AcaoSugerida, AlocarItem, Contrato, ContratoItem, ListarContratos } from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { dataLocal } from '../../comum/datas.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { ContratosRepositorio, type Conflito } from './contratos.repositorio.js'
import { EquipamentosRepositorio } from '../equipamentos/equipamentos.repositorio.js'

/**
 * Status de contrato que aceitam alocação de item.
 *
 * `ATIVO` está na lista porque contrato vivo recebe ativo novo o tempo todo —
 * o cliente pediu mais uma impressora no meio da vigência. Os terminais e o
 * `CANCELADO` não aceitam: alocar em contrato encerrado geraria item que nunca
 * fatura e ativo que ninguém devolve.
 */
const ACEITAM_ALOCACAO = new Set<Contrato['status']>([
  'RASCUNHO',
  'EM_APROVACAO',
  'AGUARDANDO_ASSINATURA',
  'ATIVO',
  'EM_RENOVACAO',
])

@Injectable()
export class ContratosService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: ContratosRepositorio,
    private readonly equipamentos: EquipamentosRepositorio,
  ) {}

  async listar(filtro: ListarContratos): Promise<Pagina<Contrato>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listar(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      const criadoEm = temMais && ultimo ? await this.repo.criadoEm(db, ultimo.id) : null
      return new Pagina(linhas, {
        limit: filtro.limit,
        next_cursor: criadoEm && ultimo ? codificarCursor({ criadoEm, id: ultimo.id }) : null,
      })
    })
  }

  async porId(id: string): Promise<Contrato> {
    const c = await this.banco.emTransacao((db) => this.repo.porId(db, id))
    if (!c) throw naoEncontrado('Contrato', id)
    return c
  }

  async itens(contratoId: string): Promise<ContratoItem[]> {
    return this.banco.emTransacao(async (db) => {
      const c = await this.repo.porId(db, contratoId)
      if (!c) throw naoEncontrado('Contrato', contratoId)
      return this.repo.itensDoContrato(db, contratoId)
    })
  }

  /**
   * Aloca um equipamento a um contrato — o caminho que exercita RN-001.
   *
   * A ordem aqui é o ponto do método. As checagens de negócio (contrato existe,
   * status permite, crédito liberado, ativo existe) rodam antes porque produzem
   * mensagens melhores. Mas **a sobreposição de vigência não é checada em
   * código**: um `select ... where vigencia && ...` seguido de `insert` tem uma
   * janela entre a leitura e a escrita, e duas requisições simultâneas passariam
   * as duas pela verificação antes de qualquer uma gravar. Quem decide é a
   * exclusion constraint, que é atômica com o INSERT.
   *
   * O que sobra para a aplicação é traduzir a recusa em algo acionável — e é
   * isso que o bloco catch faz.
   */
  async alocarItem(contratoId: string, dto: AlocarItem): Promise<ContratoItem> {
    try {
      return await this.banco.emTransacao(async (db) => {
        const contrato = await this.repo.porId(db, contratoId)
        if (!contrato) throw naoEncontrado('Contrato', contratoId)

        if (!ACEITAM_ALOCACAO.has(contrato.status)) {
          throw new ErroDominio('TRANSICAO_INVALIDA', 'Contrato não aceita novos itens', {
            detail: `O contrato ${contrato.numero} está em ${contrato.status} e não recebe alocação.`,
            errors: [{ field: 'status', code: 'STATUS_NAO_PERMITE', meta: { status: contrato.status } }],
          })
        }

        const credito = await this.repo.situacaoCreditoDoContrato(db, contratoId)
        if (credito === 'BLOQUEADO') {
          throw new ErroDominio('CREDITO_BLOQUEADO', 'Cliente com crédito bloqueado', {
            detail: 'Não é possível alocar novos ativos enquanto a situação de crédito do cliente estiver bloqueada.',
            acoes: [
              { code: 'REGULARIZAR_CREDITO', descricao: 'Regularizar pendências financeiras do cliente' },
              { code: 'LIBERAR_POR_ALCADA', descricao: 'Solicitar liberação excepcional com alçada' },
            ],
          })
        }

        if (dto.equipamento_id && !(await this.equipamentos.existe(db, dto.equipamento_id))) {
          throw naoEncontrado('Equipamento', dto.equipamento_id)
        }

        return this.repo.inserirItem(db, contratoId, dto)
      })
    } catch (e) {
      if (e instanceof ErroDominio && e.code === 'EQUIPAMENTO_JA_ALOCADO' && dto.equipamento_id) {
        throw await this.explicarConflito(dto.equipamento_id, dto)
      }
      throw e
    }
  }

  /**
   * Transforma a violação de RN-001 em uma recusa acionável.
   *
   * Um 409 com "conflito de vigência" faz o operador abrir chamado. Um 409 que
   * diz qual contrato ocupa o ativo, até quando, e lista três equivalentes
   * livres no mesmo período faz o operador resolver sozinho em dez segundos —
   * e esse é o trabalho real de uma mensagem de erro.
   */
  private async explicarConflito(equipamentoId: string, dto: AlocarItem): Promise<ErroDominio> {
    const dados = await this.banco.leituraAuxiliar(
      async (db) => ({
        conflito: await this.repo.conflitoDeVigencia(db, equipamentoId, dto.vigencia_inicio, dto.vigencia_fim),
        equivalentes: await this.repo.equivalentesLivres(db, equipamentoId, dto.vigencia_inicio, dto.vigencia_fim),
        equipamento: await this.equipamentos.porId(db, equipamentoId),
      }),
      { conflito: null as Conflito | null, equivalentes: [] as { id: string; patrimonio: string }[], equipamento: null },
    )

    const patrimonio = dados.equipamento?.patrimonio ?? equipamentoId
    const acoes: AcaoSugerida[] = []

    if (dados.equivalentes.length > 0) {
      acoes.push({
        code: 'ALOCAR_EQUIVALENTE',
        descricao: `Alocar outro ativo da mesma categoria e filial (${dados.equivalentes
          .map((e) => e.patrimonio)
          .join(', ')})`,
        meta: { candidatos: dados.equivalentes },
      })
    }

    if (dados.conflito?.vigencia_fim) {
      const fim = dados.conflito.vigencia_fim
      acoes.push({
        code: 'RESERVAR_FUTURO',
        // Texto para humano no fuso da operação; `meta` em ISO completo, para
        // a máquina não depender de interpretação de fuso.
        descricao: `Reservar este ativo a partir de ${dataLocal(new Date(fim.getTime() + 1000))}`,
        meta: { disponivel_a_partir_de: fim.toISOString() },
      })
    }

    acoes.push({
      code: 'ALOCAR_POR_CATEGORIA',
      descricao: 'Registrar o item por categoria e definir o ativo na entrega',
    })

    const detalhe = dados.conflito
      ? `O patrimônio ${patrimonio} está alocado ao contrato ${dados.conflito.contrato_numero} ` +
        `(${dados.conflito.item_status.toLowerCase()}) ` +
        (dados.conflito.vigencia_fim
          ? `até ${dataLocal(dados.conflito.vigencia_fim)}.`
          : 'por prazo indeterminado.')
      : `O patrimônio ${patrimonio} já possui alocação vigente no período informado.`

    return new ErroDominio('EQUIPAMENTO_JA_ALOCADO', 'Equipamento já alocado no período', {
      detail: detalhe,
      errors: [
        {
          field: 'equipamento_id',
          code: 'CONFLITO_VIGENCIA',
          meta: dados.conflito
            ? {
                contrato_conflitante: dados.conflito.contrato_numero,
                contrato_conflitante_id: dados.conflito.contrato_id,
                vigencia_inicio: dados.conflito.vigencia_inicio.toISOString(),
                vigencia_fim: dados.conflito.vigencia_fim?.toISOString() ?? null,
              }
            : {},
        },
      ],
      acoes,
    })
  }
}
