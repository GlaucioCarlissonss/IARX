import { Injectable } from '@nestjs/common'
import type {
  EditarEquipamento,
  EditarPatrimonial,
  EquipamentoStatus,
  ListarMovimentacoes,
  ListarTransferenciasPendentes,
  Movimentacao,
  MovimentacaoTipo,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor, type Cursor } from '../../comum/pagina.js'

/**
 * Acesso ao razão de movimentação.
 *
 * Como o resto do projeto: nenhum `where tenant_id` — quem isola é a RLS — e
 * nenhum valor concatenado no SQL.
 */

const SELECT_BASE = `
  select mv.id, mv.equipamento_id, e.patrimonio as equipamento_patrimonio, mv.tipo,
         mv.origem_tipo, mv.origem_id, mv.destino_tipo, mv.destino_id,
         mv.contrato_item_id, mv.ordem_servico_id, mv.data_movimento,
         mv.responsavel_id, mv.documento_ref, mv.observacao, mv.status_resultante,
         mv.aceite_em, mv.aceite_por
    from public.movimentacao mv
    join public.equipamento e on e.id = mv.equipamento_id
`

interface LinhaMovimentacao {
  id: string
  equipamento_id: string
  equipamento_patrimonio: string | null
  tipo: MovimentacaoTipo
  origem_tipo: Movimentacao['origem_tipo']
  origem_id: string | null
  destino_tipo: Movimentacao['destino_tipo']
  destino_id: string | null
  contrato_item_id: string | null
  ordem_servico_id: string | null
  data_movimento: Date
  responsavel_id: string | null
  documento_ref: string | null
  observacao: string | null
  status_resultante: EquipamentoStatus
  aceite_em: Date | null
  aceite_por: string | null
}

export interface DadosMovimentacao {
  equipamentoId: string
  tipo: MovimentacaoTipo
  origemTipo: string | null
  origemId: string | null
  destinoTipo: string | null
  destinoId: string | null
  contratoItemId: string | null
  ordemServicoId: string | null
  documentoRef: string | null
  observacao: string | null
  statusResultante: EquipamentoStatus
}

@Injectable()
export class MovimentacaoRepositorio {
  async registrar(db: Executor, tenantId: string, d: DadosMovimentacao): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.movimentacao
         (tenant_id, equipamento_id, tipo, origem_tipo, origem_id, destino_tipo, destino_id,
          contrato_item_id, ordem_servico_id, documento_ref, observacao, status_resultante,
          responsavel_id, created_by)
       values ($1, $2, $3::app.movimentacao_tipo, $4, $5, $6, $7, $8, $9, $10, $11,
               $12::app.equipamento_status, app.usuario_atual(), app.usuario_atual())
       returning id`,
      [
        tenantId,
        d.equipamentoId,
        d.tipo,
        d.origemTipo,
        d.origemId,
        d.destinoTipo,
        d.destinoId,
        d.contratoItemId,
        d.ordemServicoId,
        d.documentoRef,
        d.observacao,
        d.statusResultante,
      ],
    )
    return (l as { id: string }).id
  }

  /**
   * Aplica o novo estado ao ativo.
   *
   * O `update` passa pelo gatilho da 0031: transição fora do mapa, baixa com
   * alocação vigente ou retorno de manutenção incoerente são recusados aqui, no
   * banco. O serviço não reimplementa nenhuma dessas conferências — ele traduz
   * a recusa.
   */
  async aplicarStatus(
    db: Executor,
    id: string,
    status: EquipamentoStatus,
    motivo: string | null,
  ): Promise<void> {
    await db.consultar(
      `update public.equipamento
          set status = $2::app.equipamento_status,
              /* O cast para text não é decoração: o $2::app.equipamento_status
                 da linha acima fixa o tipo do parâmetro, e sem ele o coalesce
                 tenta casar text com o enum e o comando inteiro falha. */
              motivo_indisponibilidade = case
                when $2::text in ('DISPONIVEL','LOCADO','RESERVADO') then null
                else coalesce($3, motivo_indisponibilidade, $2::text)
              end,
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and deleted_at is null`,
      [id, status, motivo],
    )
  }

  async porId(db: Executor, id: string): Promise<Movimentacao | null> {
    const l = await db.consultarUm<LinhaMovimentacao & Record<string, unknown>>(
      `${SELECT_BASE} where mv.id = $1`,
      [id],
    )
    return l ? mapear(l) : null
  }

  async listarDoEquipamento(
    db: Executor,
    equipamentoId: string,
    filtro: ListarMovimentacoes,
  ): Promise<{ linhas: Movimentacao[]; temMais: boolean }> {
    const valores: unknown[] = [equipamentoId]
    const clausulas = ['mv.equipamento_id = $1']

    if (filtro.tipo) {
      valores.push(filtro.tipo)
      clausulas.push(`mv.tipo = $${valores.length}::app.movimentacao_tipo`)
    }
    if (filtro.desde) {
      valores.push(filtro.desde)
      clausulas.push(`mv.data_movimento >= $${valores.length}::timestamptz`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      const a = `$${valores.length - 1}`
      const b = `$${valores.length}`
      clausulas.push(`(mv.data_movimento, mv.id) < (${a}::timestamptz, ${b}::uuid)`)
    }

    valores.push(filtro.limit + 1)
    const sql = `${SELECT_BASE} where ${clausulas.join(' and ')}
                 order by mv.data_movimento desc, mv.id desc limit $${valores.length}`

    const linhas = await db.consultar<LinhaMovimentacao & Record<string, unknown>>(sql, valores)
    const temMais = linhas.length > filtro.limit
    return { linhas: linhas.slice(0, filtro.limit).map(mapear), temMais }
  }

  async listarPendentes(
    db: Executor,
    filtro: ListarTransferenciasPendentes,
  ): Promise<{ linhas: Movimentacao[]; temMais: boolean }> {
    const valores: unknown[] = []
    const clausulas = [`mv.tipo = 'TRANSFERENCIA'`, 'mv.aceite_em is null']

    if (filtro.destino_filial_id) {
      valores.push(filtro.destino_filial_id)
      clausulas.push(`mv.destino_id = $${valores.length}`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      const a = `$${valores.length - 1}`
      const b = `$${valores.length}`
      clausulas.push(`(mv.data_movimento, mv.id) < (${a}::timestamptz, ${b}::uuid)`)
    }

    valores.push(filtro.limit + 1)
    const sql = `${SELECT_BASE} where ${clausulas.join(' and ')}
                 order by mv.data_movimento desc, mv.id desc limit $${valores.length}`

    const linhas = await db.consultar<LinhaMovimentacao & Record<string, unknown>>(sql, valores)
    const temMais = linhas.length > filtro.limit
    return { linhas: linhas.slice(0, filtro.limit).map(mapear), temMais }
  }

  /**
   * Carimba o aceite. O gatilho da 0032 admite este UPDATE e só ele: qualquer
   * outra coluna que mude na mesma escrita derruba a operação inteira.
   *
   * O `where aceite_em is null` faz o segundo aceite não ter efeito em vez de
   * sobrescrever a data do primeiro — quem aceitou foi quem aceitou primeiro.
   */
  async aceitar(db: Executor, id: string): Promise<boolean> {
    const r = await db.consultarUm<{ id: string }>(
      `update public.movimentacao
          set aceite_em = now(), aceite_por = app.usuario_atual()
        where id = $1 and tipo = 'TRANSFERENCIA' and aceite_em is null
        returning id`,
      [id],
    )
    return r !== null
  }

  async editarCadastral(db: Executor, id: string, version: number, d: EditarEquipamento): Promise<boolean> {
    const r = await db.consultarUm<{ id: string }>(
      `update public.equipamento
          set numero_serie   = case when $3::boolean then $4 else numero_serie end,
              modelo_id      = coalesce($5, modelo_id),
              categoria_id   = coalesce($6, categoria_id),
              filial_id      = coalesce($7, filial_id),
              ano_fabricacao = case when $8::boolean then $9 else ano_fabricacao end,
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and version = $2 and deleted_at is null
        returning id`,
      [
        id,
        version,
        d.numero_serie !== undefined,
        d.numero_serie ?? null,
        d.modelo_id ?? null,
        d.categoria_id ?? null,
        d.filial_id ?? null,
        d.ano_fabricacao !== undefined,
        d.ano_fabricacao ?? null,
      ],
    )
    return r !== null
  }

  /**
   * Edição patrimonial.
   *
   * `case when $n::boolean` em vez de `coalesce`: aqui nulo é um valor que o
   * operador pode querer gravar — "este ativo não tem valor de aquisição
   * conhecido" é diferente de "não mexi neste campo". Com `coalesce` as duas
   * coisas viram a mesma, e limpar um campo deixaria de ser possível.
   */
  async editarPatrimonial(
    db: Executor,
    id: string,
    version: number,
    d: EditarPatrimonial,
  ): Promise<boolean> {
    const r = await db.consultarUm<{ id: string }>(
      `update public.equipamento
          set valor_aquisicao  = case when $3::boolean then $4::numeric else valor_aquisicao end,
              data_aquisicao   = case when $5::boolean then $6::date    else data_aquisicao end,
              nota_fiscal      = case when $7::boolean then $8          else nota_fiscal end,
              vida_util_meses  = case when $9::boolean then $10::integer else vida_util_meses end,
              valor_residual   = case when $11::boolean then $12::numeric else valor_residual end,
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and version = $2 and deleted_at is null
        returning id`,
      [
        id,
        version,
        d.valor_aquisicao !== undefined,
        d.valor_aquisicao ?? null,
        d.data_aquisicao !== undefined,
        d.data_aquisicao ?? null,
        d.nota_fiscal !== undefined,
        d.nota_fiscal ?? null,
        d.vida_util_meses !== undefined,
        d.vida_util_meses ?? null,
        d.valor_residual !== undefined,
        d.valor_residual ?? null,
      ],
    )
    return r !== null
  }

  async filialDoEquipamento(db: Executor, id: string): Promise<string | null> {
    const r = await db.consultarUm<{ filial_id: string }>(
      `select filial_id from public.equipamento where id = $1 and deleted_at is null`,
      [id],
    )
    return r ? r.filial_id : null
  }
}

export function cursorDeMovimentacao(m: Movimentacao): Cursor {
  return { criadoEm: m.data_movimento, id: m.id }
}

function mapear(l: LinhaMovimentacao): Movimentacao {
  return {
    id: l.id,
    equipamento_id: l.equipamento_id,
    equipamento_patrimonio: l.equipamento_patrimonio,
    tipo: l.tipo,
    origem_tipo: l.origem_tipo,
    origem_id: l.origem_id,
    destino_tipo: l.destino_tipo,
    destino_id: l.destino_id,
    contrato_item_id: l.contrato_item_id,
    ordem_servico_id: l.ordem_servico_id,
    data_movimento: l.data_movimento.toISOString(),
    responsavel_id: l.responsavel_id,
    documento_ref: l.documento_ref,
    observacao: l.observacao,
    status_resultante: l.status_resultante,
    aceite_em: l.aceite_em ? l.aceite_em.toISOString() : null,
    aceite_por: l.aceite_por,
  }
}
