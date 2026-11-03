import { Injectable } from '@nestjs/common'
import type { ListarReajustes, ProporReajuste, Reajuste } from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor, type Cursor } from '../../comum/pagina.js'

/**
 * Acesso a reajuste e às ações de item de contrato.
 *
 * Sem `where tenant_id` — quem isola é a RLS — e sem valor concatenado no SQL.
 */

const SELECT_BASE = `
  select r.id, r.contrato_id, c.numero as contrato_numero, r.competencia,
         r.indice, r.percentual_indice::text as percentual_indice,
         r.percentual_aplicado::text as percentual_aplicado,
         r.valor_anterior::text as valor_anterior, r.valor_novo::text as valor_novo,
         r.status, r.proposto_em, r.aprovado_por, r.aprovado_em, r.aplicado_em,
         r.motivo_renuncia, r.version
    from public.reajuste r
    join public.contrato c on c.id = r.contrato_id
`

interface LinhaReajuste {
  id: string
  contrato_id: string
  contrato_numero: string | null
  competencia: Date
  indice: string
  percentual_indice: string
  percentual_aplicado: string
  valor_anterior: string
  valor_novo: string
  status: Reajuste['status']
  proposto_em: Date
  aprovado_por: string | null
  aprovado_em: Date | null
  aplicado_em: Date | null
  motivo_renuncia: string | null
  version: number
}

@Injectable()
export class ReajustesRepositorio {
  async propor(
    db: Executor,
    tenantId: string,
    contratoId: string,
    dados: ProporReajuste,
  ): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.reajuste
         (tenant_id, contrato_id, competencia, indice, percentual_indice,
          percentual_aplicado, created_by)
       values ($1, $2, date_trunc('month', $3::date)::date, $4, $5::numeric,
               coalesce($6, $5)::numeric, app.usuario_atual())
       returning id`,
      [
        tenantId,
        contratoId,
        dados.competencia,
        dados.indice,
        dados.percentual_indice,
        dados.percentual_aplicado ?? null,
      ],
    )
    return (l as { id: string }).id
  }

  async porId(db: Executor, id: string): Promise<Reajuste | null> {
    const l = await db.consultarUm<LinhaReajuste & Record<string, unknown>>(
      `${SELECT_BASE} where r.id = $1`,
      [id],
    )
    return l ? mapear(l) : null
  }

  async listar(db: Executor, filtro: ListarReajustes): Promise<{ linhas: Reajuste[]; temMais: boolean }> {
    const valores: unknown[] = []
    const clausulas: string[] = []

    if (filtro.contrato_id) {
      valores.push(filtro.contrato_id)
      clausulas.push(`r.contrato_id = $${valores.length}`)
    }
    if (filtro.status) {
      valores.push(filtro.status)
      clausulas.push(`r.status = $${valores.length}::app.reajuste_status`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      const a = `$${valores.length - 1}`
      const b = `$${valores.length}`
      clausulas.push(`(r.proposto_em, r.id) < (${a}::timestamptz, ${b}::uuid)`)
    }

    valores.push(filtro.limit + 1)
    const where = clausulas.length ? `where ${clausulas.join(' and ')}` : ''
    const sql = `${SELECT_BASE} ${where}
                 order by r.proposto_em desc, r.id desc limit $${valores.length}`

    const linhas = await db.consultar<LinhaReajuste & Record<string, unknown>>(sql, valores)
    const temMais = linhas.length > filtro.limit
    return { linhas: linhas.slice(0, filtro.limit).map(mapear), temMais }
  }

  /**
   * Muda o estado do reajuste. O gatilho da 0033 recusa transição fora do mapa
   * e aplica o efeito — reescrever o unitário dos itens — quando o destino é
   * APLICADO. Aqui não há cópia dessa lógica, só a escrita que a dispara.
   */
  async mudarStatus(
    db: Executor,
    id: string,
    status: Reajuste['status'],
    motivo: string | null,
  ): Promise<boolean> {
    const r = await db.consultarUm<{ id: string }>(
      `update public.reajuste
          set status = $2::app.reajuste_status,
              motivo_renuncia = coalesce($3, motivo_renuncia),
              version = version + 1
        where id = $1
        returning id`,
      [id, status, motivo],
    )
    return r !== null
  }

  /* ----------------------------------------------------- ações de item --- */

  async encerrarItem(
    db: Executor,
    itemId: string,
    contratoId: string,
    encerradoEm: string,
    motivo: string,
  ): Promise<boolean> {
    /*
     * `vigencia_fim` recebe a data da devolução, e não do registro: a vigência
     * é o que o motor de faturamento usa para ratear a competência, então
     * fechá-la na data errada cobra dias em que a máquina já estava na base.
     *
     * `and contrato_id = $2` porque o item é endereçado pelo caminho do
     * contrato: sem a conferência, trocar o id na URL encerraria item de outro
     * contrato — e possivelmente de outro cliente.
     */
    const r = await db.consultarUm<{ id: string }>(
      `update public.contrato_item
          set status = 'ENCERRADO',
              vigencia_fim = $3::timestamptz,
              observacao = $4,
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and contrato_id = $2 and deleted_at is null
          and status in ('PLANEJADO','RESERVADO','EM_ENTREGA','ATIVO','SUSPENSO','EM_DEVOLUCAO')
        returning id`,
      [itemId, contratoId, encerradoEm, motivo],
    )
    return r !== null
  }

  async substituirItem(
    db: Executor,
    tenantId: string,
    itemId: string,
    contratoId: string,
    equipamentoId: string,
    motivo: string,
    efetivadoEm: string,
  ): Promise<string | null> {
    /*
     * O sucessor herda a precificação e assume a vigência restante; o
     * antecessor fecha em SUBSTITUIDO apontando para ele.
     *
     * Em uma transação só, e nesta ordem, porque o intervalo entre as duas
     * escritas é exatamente onde a exclusão de RN-001 veria dois itens
     * ocupantes sobre o mesmo período — e porque um corte entre elas deixaria o
     * contrato sem item nenhum para a máquina que está no cliente.
     */
    const antigo = await db.consultarUm<{
      id: string
      categoria_id: string | null
      local_operacao_id: string | null
      modalidade_cobranca: string
      valor_unitario: string
      quantidade: string
      franquia_quantidade: string | null
      franquia_escopo: string | null
      valor_excedente_unitario: string | null
      valor_minimo_mensal: string | null
      vigencia_fim: Date | null
    }>(
      `select id, categoria_id, local_operacao_id, modalidade_cobranca,
              valor_unitario::text as valor_unitario, quantidade::text as quantidade,
              franquia_quantidade::text as franquia_quantidade, franquia_escopo,
              valor_excedente_unitario::text as valor_excedente_unitario,
              valor_minimo_mensal::text as valor_minimo_mensal,
              upper(vigencia) as vigencia_fim
         from public.contrato_item
        where id = $1 and contrato_id = $2 and deleted_at is null
          and status in ('RESERVADO','EM_ENTREGA','ATIVO','SUSPENSO')`,
      [itemId, contratoId],
    )
    if (!antigo) return null

    await db.consultar(
      `update public.contrato_item
          set status = 'SUBSTITUIDO', vigencia_fim = $2::timestamptz,
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1`,
      [itemId, efetivadoEm],
    )

    const novo = await db.consultarUm<{ id: string }>(
      `insert into public.contrato_item
         (tenant_id, contrato_id, equipamento_id, categoria_id, local_operacao_id,
          modalidade_cobranca, valor_unitario, quantidade, franquia_quantidade,
          franquia_escopo, valor_excedente_unitario, valor_minimo_mensal,
          vigencia_inicio, vigencia_fim, status, observacao, created_by)
       values ($1, $2, $3, $4, $5, $6::app.modalidade_cobranca, $7::numeric, $8::numeric,
               $9::numeric, $10, $11::numeric, $12::numeric,
               $13::timestamptz, $14::timestamptz, 'ATIVO', $15, app.usuario_atual())
       returning id`,
      [
        tenantId,
        contratoId,
        equipamentoId,
        antigo.categoria_id,
        antigo.local_operacao_id,
        antigo.modalidade_cobranca,
        antigo.valor_unitario,
        antigo.quantidade,
        antigo.franquia_quantidade,
        antigo.franquia_escopo,
        antigo.valor_excedente_unitario,
        antigo.valor_minimo_mensal,
        efetivadoEm,
        antigo.vigencia_fim ? antigo.vigencia_fim.toISOString() : null,
        motivo,
      ],
    )
    if (!novo) return null

    await db.consultar(
      `update public.contrato_item set substituido_por_id = $2 where id = $1`,
      [itemId, novo.id],
    )
    return novo.id
  }
}

export function cursorDeReajuste(r: Reajuste): Cursor {
  return { criadoEm: r.proposto_em, id: r.id }
}

function mapear(l: LinhaReajuste): Reajuste {
  return {
    id: l.id,
    contrato_id: l.contrato_id,
    contrato_numero: l.contrato_numero,
    competencia: l.competencia.toISOString().slice(0, 10),
    indice: l.indice,
    percentual_indice: l.percentual_indice,
    percentual_aplicado: l.percentual_aplicado,
    valor_anterior: l.valor_anterior as Reajuste['valor_anterior'],
    valor_novo: l.valor_novo as Reajuste['valor_novo'],
    status: l.status,
    proposto_em: l.proposto_em.toISOString(),
    aprovado_por: l.aprovado_por,
    aprovado_em: l.aprovado_em ? l.aprovado_em.toISOString() : null,
    aplicado_em: l.aplicado_em ? l.aplicado_em.toISOString() : null,
    motivo_renuncia: l.motivo_renuncia,
    version: l.version,
  }
}
