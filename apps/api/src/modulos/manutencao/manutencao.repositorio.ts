import { Injectable } from '@nestjs/common'
import type {
  AbrirOs,
  AgendarOs,
  ConcluirOs,
  ListarOs,
  OrdemServico,
  PausarOs,
  Tecnico,
  TriarOs,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor } from '../../comum/pagina.js'

/**
 * Acesso a manutenção.
 *
 * Como nos demais repositórios: nenhum `where tenant_id`. O isolamento é da
 * RLS, dentro do banco.
 *
 * E nenhuma validação de transição: a máquina de estados é gatilho
 * (`os_transicao`, Anexo B.3). Repeti-la aqui criaria dois lugares para ela
 * divergir, e o segundo só valeria para quem passa por esta API.
 *
 * Os custos saem como texto porque são `numeric(15,4)` — ver `Dinheiro` nos
 * primitivos. `::text` explícito e não implícito: o driver já devolveria
 * string, mas deixar a conversão escrita impede que um `::float` apareça numa
 * consulta futura "para facilitar".
 */
const SELECT_OS = `
  select o.id, o.numero, o.equipamento_id, o.filial_id,
         o.tipo::text as tipo, o.origem::text as origem, o.status::text as status,
         o.prioridade::text as prioridade,
         o.contrato_id, o.cliente_id, o.local_operacao_id,
         o.descricao, o.causa_raiz, o.solucao, o.tecnico_responsavel_id,
         to_char(o.abertura_em,        'YYYY-MM-DD"T"HH24:MI:SSOF') as abertura_em,
         to_char(o.prazo_resposta_em,  'YYYY-MM-DD"T"HH24:MI:SSOF') as prazo_resposta_em,
         to_char(o.resposta_em,        'YYYY-MM-DD"T"HH24:MI:SSOF') as resposta_em,
         to_char(o.prazo_solucao_em,   'YYYY-MM-DD"T"HH24:MI:SSOF') as prazo_solucao_em,
         to_char(o.inicio_execucao_em, 'YYYY-MM-DD"T"HH24:MI:SSOF') as inicio_execucao_em,
         to_char(o.conclusao_em,       'YYYY-MM-DD"T"HH24:MI:SSOF') as conclusao_em,
         to_char(o.validacao_em,       'YYYY-MM-DD"T"HH24:MI:SSOF') as validacao_em,
         o.validado_por, o.tempo_pausado_minutos, o.impacta_disponibilidade,
         o.causa_responsabilidade::text as causa_responsabilidade,
         o.custo_mao_obra::text     as custo_mao_obra,
         o.custo_material::text     as custo_material,
         o.custo_terceiros::text    as custo_terceiros,
         o.custo_deslocamento::text as custo_deslocamento,
         o.custo_total::text        as custo_total,
         o.os_origem_id, o.created_at
    from public.ordem_servico o
`

interface LinhaOs extends Record<string, unknown> {
  id: string
  created_at: Date
}

export const cursorDeOs = (o: LinhaOs) => ({ criadoEm: o.created_at.toISOString(), id: o.id })

function semCursor(o: LinhaOs): OrdemServico {
  const { created_at: _descartado, ...resto } = o
  return resto as unknown as OrdemServico
}

@Injectable()
export class ManutencaoRepositorio {
  async tecnicos(db: Executor): Promise<Tecnico[]> {
    return db.consultar<Tecnico & Record<string, unknown>>(
      `select id, usuario_id, nome, matricula, filial_id, especialidades,
              custo_hora::text as custo_hora, ativo
         from public.tecnico
        where deleted_at is null
        order by ativo desc, nome`,
    )
  }

  async listar(db: Executor, filtro: ListarOs): Promise<{ linhas: OrdemServico[]; temMais: boolean }> {
    const clausulas = ['o.deleted_at is null']
    const valores: unknown[] = []

    const igual = (coluna: string, valor: unknown) => {
      valores.push(valor)
      clausulas.push(`${coluna} = $${valores.length}`)
    }

    if (filtro.status) igual('o.status', filtro.status)
    if (filtro.tipo) igual('o.tipo', filtro.tipo)
    if (filtro.equipamento_id) igual('o.equipamento_id', filtro.equipamento_id)
    if (filtro.cliente_id) igual('o.cliente_id', filtro.cliente_id)
    if (filtro.tecnico_id) igual('o.tecnico_responsavel_id', filtro.tecnico_id)

    /*
     * Em risco, e não atrasada. Uma lista do que já estourou serve para
     * explicar o mês passado; uma lista do que vai estourar serve para
     * impedir. As encerradas ficam de fora — SLA de OS validada não corre.
     */
    if (filtro.sla_em_risco_horas) {
      valores.push(filtro.sla_em_risco_horas)
      clausulas.push(
        `o.prazo_solucao_em is not null
         and o.prazo_solucao_em <= now() + ($${valores.length} || ' hours')::interval
         and o.status not in ('VALIDADA','CANCELADA')`,
      )
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(o.created_at, o.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const linhas = await db.consultar<LinhaOs>(
      `${SELECT_OS} where ${clausulas.join(' and ')}
        order by o.created_at desc, o.id desc limit $${valores.length}`,
      valores,
    )

    return {
      linhas: linhas.slice(0, filtro.limit).map(semCursor),
      temMais: linhas.length > filtro.limit,
    }
  }

  async porId(db: Executor, id: string): Promise<OrdemServico | null> {
    const o = await db.consultarUm<LinhaOs>(`${SELECT_OS} where o.id = $1 and o.deleted_at is null`, [id])
    return o ? semCursor(o) : null
  }

  async abrir(db: Executor, dados: AbrirOs, autorId: string): Promise<OrdemServico | null> {
    const linha = await db.consultarUm<{ id: string }>(
      `insert into public.ordem_servico
         (tenant_id, numero, equipamento_id, filial_id, tipo, origem, prioridade,
          descricao, contrato_id, cliente_id, local_operacao_id,
          impacta_disponibilidade, created_by, updated_by)
       select app.tenant_atual(), app.proximo_numero_os(app.tenant_atual()),
              $1, e.filial_id, $2::app.os_tipo, $3::app.os_origem, $4::app.os_prioridade,
              $5, $6, $7, $8, $9, $10, $10
         from public.equipamento e
        where e.id = $1
       returning id`,
      [
        dados.equipamento_id,
        dados.tipo,
        dados.origem,
        dados.prioridade,
        dados.descricao,
        dados.contrato_id ?? null,
        dados.cliente_id ?? null,
        dados.local_operacao_id ?? null,
        dados.impacta_disponibilidade,
        autorId,
      ],
    )
    return linha ? this.porId(db, linha.id) : null
  }

  async triar(db: Executor, id: string, dados: TriarOs, autorId: string): Promise<OrdemServico | null> {
    const linha = await db.consultarUm<{ id: string }>(
      `update public.ordem_servico
          set status = 'TRIAGEM', tipo = $2::app.os_tipo, prioridade = $3::app.os_prioridade,
              prazo_resposta_em = coalesce($4::timestamptz, prazo_resposta_em),
              prazo_solucao_em  = coalesce($5::timestamptz, prazo_solucao_em),
              updated_by = $6
        where id = $1 and deleted_at is null
        returning id`,
      [id, dados.tipo, dados.prioridade, dados.prazo_resposta_em ?? null, dados.prazo_solucao_em ?? null, autorId],
    )
    return linha ? this.porId(db, linha.id) : null
  }

  async agendar(db: Executor, id: string, dados: AgendarOs, autorId: string): Promise<OrdemServico | null> {
    const linha = await db.consultarUm<{ id: string }>(
      `update public.ordem_servico
          set status = 'AGENDADA', tecnico_responsavel_id = $2,
              prazo_solucao_em = coalesce($3::timestamptz, prazo_solucao_em),
              updated_by = $4
        where id = $1 and deleted_at is null
        returning id`,
      [id, dados.tecnico_id, dados.prazo_solucao_em ?? null, autorId],
    )
    return linha ? this.porId(db, linha.id) : null
  }

  /**
   * Check-in do técnico.
   *
   * `resposta_em` só é marcado na primeira vez (`coalesce`): retomar depois de
   * uma pausa não pode reescrever o momento em que a locadora respondeu, senão
   * o SLA de resposta melhora sozinho a cada interrupção.
   */
  async iniciar(db: Executor, id: string, autorId: string): Promise<OrdemServico | null> {
    const linha = await db.consultarUm<{ id: string }>(
      `update public.ordem_servico
          set status = 'EM_EXECUCAO',
              resposta_em = coalesce(resposta_em, now()),
              inicio_execucao_em = coalesce(inicio_execucao_em, now()),
              updated_by = $2
        where id = $1 and deleted_at is null
        returning id`,
      [id, autorId],
    )
    return linha ? this.porId(db, linha.id) : null
  }

  async concluir(db: Executor, id: string, dados: ConcluirOs, autorId: string): Promise<OrdemServico | null> {
    const linha = await db.consultarUm<{ id: string }>(
      `update public.ordem_servico
          set status = 'CONCLUIDA', conclusao_em = now(),
              causa_raiz = $2, solucao = $3,
              causa_responsabilidade = $4::app.os_responsabilidade,
              custo_mao_obra     = coalesce($5::numeric, custo_mao_obra),
              custo_material     = coalesce($6::numeric, custo_material),
              custo_terceiros    = coalesce($7::numeric, custo_terceiros),
              custo_deslocamento = coalesce($8::numeric, custo_deslocamento),
              updated_by = $9
        where id = $1 and deleted_at is null
        returning id`,
      [
        id,
        dados.causa_raiz,
        dados.solucao,
        dados.causa_responsabilidade,
        dados.custo_mao_obra ?? null,
        dados.custo_material ?? null,
        dados.custo_terceiros ?? null,
        dados.custo_deslocamento ?? null,
        autorId,
      ],
    )
    return linha ? this.porId(db, linha.id) : null
  }

  /**
   * Validação.
   *
   * `validado_por` vem das claims, nunca do corpo. Aceitá-lo do cliente faria
   * RN-027 — segregação entre quem executa e quem valida — ser cumprida por
   * quem quisesse, bastando informar outro id.
   */
  async validar(db: Executor, id: string, validadorId: string): Promise<OrdemServico | null> {
    const linha = await db.consultarUm<{ id: string }>(
      `update public.ordem_servico
          set status = 'VALIDADA', validacao_em = now(), validado_por = $2, updated_by = $2
        where id = $1 and deleted_at is null
        returning id`,
      [id, validadorId],
    )
    return linha ? this.porId(db, linha.id) : null
  }

  async cancelar(db: Executor, id: string, motivo: string, autorId: string): Promise<OrdemServico | null> {
    const linha = await db.consultarUm<{ id: string }>(
      `update public.ordem_servico
          set status = 'CANCELADA', solucao = $2, updated_by = $3
        where id = $1 and deleted_at is null
        returning id`,
      [id, motivo, autorId],
    )
    return linha ? this.porId(db, linha.id) : null
  }

  /** Abre a pausa e leva a OS para AGUARDANDO_PECA quando o motivo é esse. */
  async pausar(db: Executor, id: string, dados: PausarOs, autorId: string): Promise<OrdemServico | null> {
    await db.consultarUm(
      `insert into public.os_pausa
         (tenant_id, ordem_servico_id, motivo, justificativa, registrado_por, created_by)
       values (app.tenant_atual(), $1, $2::app.os_pausa_motivo, $3, $4, $4)
       returning id`,
      [id, dados.motivo, dados.justificativa, autorId],
    )

    if (dados.motivo === 'AGUARDANDO_PECA') {
      await db.consultarUm(
        `update public.ordem_servico set status = 'AGUARDANDO_PECA', updated_by = $2
          where id = $1 returning id`,
        [id, autorId],
      )
    }
    return this.porId(db, id)
  }

  /**
   * Fecha a pausa aberta e acumula o tempo parado.
   *
   * O acumulado é somado aqui, e não derivado das pausas, por uma razão de
   * custo: a fila de SLA ordena por prazo menos tempo parado, e recalcular a
   * soma das pausas a cada linha da fila transformaria a consulta mais
   * frequente do módulo numa agregação por OS.
   */
  async retomar(db: Executor, id: string, autorId: string): Promise<OrdemServico | null> {
    const pausa = await db.consultarUm<{ minutos: number }>(
      `update public.os_pausa
          set fim = now()
        where ordem_servico_id = $1 and fim is null
        returning greatest(0, (extract(epoch from (now() - inicio)) / 60)::integer) as minutos`,
      [id],
    )
    if (!pausa) return null

    await db.consultarUm(
      `update public.ordem_servico
          set tempo_pausado_minutos = tempo_pausado_minutos + $2,
              status = case when status = 'AGUARDANDO_PECA' then 'EM_EXECUCAO' else status end,
              updated_by = $3
        where id = $1 returning id`,
      [id, pausa.minutos, autorId],
    )
    return this.porId(db, id)
  }
}
