import { Injectable } from '@nestjs/common'
import type {
  ConsumoDoCliente,
  ContratoDoCliente,
  CustoDaCompetencia,
  EquipamentoDoCliente,
  ItemDoContrato,
  ListarConsumo,
  ListarContratosDoCliente,
  ListarEquipamentosDoCliente,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor } from '../../comum/pagina.js'
import { EM_ABERTO } from '../contas-receber/contas-receber.repositorio.js'

/**
 * Acesso a dados do portal do cliente.
 *
 * **Nenhum `where cliente_id` e nenhum `where local_operacao_id in (...)`.**
 *
 * Os dois recortes são da RLS: a política de cliente da 0011 e a de unidade da
 * 0024. Repeti-los aqui daria a impressão de que o isolamento depende de o SQL
 * estar certo — e a consulta nova que esquecesse um filtro passaria batida, que
 * é exatamente o modo como esse tipo de defeito entra. O que se escreve aqui são
 * filtros de **conveniência** do usuário (`?local_id=`), nunca de segurança.
 *
 * A diferença é verificável: os testes trocam o usuário do token e contam
 * linhas, sem tocar nas consultas.
 */

const dinheiro = (v: string | null) => Number(v ?? 0).toFixed(4)

export interface LinhaContrato extends Record<string, unknown> {
  id: string
  numero: string
  status: ContratoDoCliente['status']
  data_inicio: string | null
  data_fim: string | null
  renovacao_automatica: boolean
  valor_mensal_estimado: string | null
  itens: string
  created_at: Date
}

export const mapearContrato = (l: LinhaContrato): ContratoDoCliente => ({
  id: l.id,
  numero: l.numero,
  status: l.status,
  data_inicio: l.data_inicio,
  data_fim: l.data_fim,
  renovacao_automatica: l.renovacao_automatica,
  valor_mensal_estimado:
    l.valor_mensal_estimado === null
      ? null
      : (dinheiro(l.valor_mensal_estimado) as ContratoDoCliente['valor_mensal_estimado']),
  itens: Number(l.itens),
})

export const cursorContrato = (l: LinhaContrato) => ({
  criadoEm: l.created_at.toISOString(),
  id: l.id,
})

export interface LinhaEquipamento extends Record<string, unknown> {
  id: string
  patrimonio: string
  numero_serie: string | null
  modelo: string | null
  fabricante: string | null
  status: EquipamentoDoCliente['status']
  local_operacao_id: string | null
  local_nome: string | null
  created_at: Date
}

export const mapearEquipamento = (l: LinhaEquipamento): EquipamentoDoCliente => ({
  id: l.id,
  patrimonio: l.patrimonio,
  numero_serie: l.numero_serie,
  modelo: l.modelo,
  fabricante: l.fabricante,
  status: l.status,
  local_operacao_id: l.local_operacao_id,
  local_nome: l.local_nome,
})

export const cursorEquipamento = (l: LinhaEquipamento) => ({
  criadoEm: l.created_at.toISOString(),
  id: l.id,
})

export interface LinhaConsumo extends Record<string, unknown> {
  competencia: string
  equipamento_id: string
  patrimonio: string | null
  local_operacao_id: string | null
  local_nome: string | null
  paginas_mono: string
  paginas_color: string
  franquia_mono: number | null
  franquia_color: number | null
  excedente_mono: string
  excedente_color: string
  valor_excedente: string | null
  fechado_em: Date | null
  ultima_leitura_em: Date | null
  created_at: Date
  id: string
}

export const mapearConsumo = (l: LinhaConsumo): ConsumoDoCliente => ({
  competencia: l.competencia.trim(),
  equipamento_id: l.equipamento_id,
  patrimonio: l.patrimonio,
  local_operacao_id: l.local_operacao_id,
  local_nome: l.local_nome,
  paginas_mono: Number(l.paginas_mono),
  paginas_color: Number(l.paginas_color),
  franquia_mono: l.franquia_mono,
  franquia_color: l.franquia_color,
  excedente_mono: Number(l.excedente_mono),
  excedente_color: Number(l.excedente_color),
  valor_excedente: dinheiro(l.valor_excedente) as ConsumoDoCliente['valor_excedente'],
  // RN-L33: derivado de `fechado_em`, nunca uma coluna própria.
  parcial: l.fechado_em === null,
  ultima_leitura_em: l.ultima_leitura_em ? l.ultima_leitura_em.toISOString() : null,
})

export const cursorConsumo = (l: LinhaConsumo) => ({
  criadoEm: l.created_at.toISOString(),
  id: l.id,
})

@Injectable()
export class PortalRepositorio {
  /* ------------------------------------------------------------ contratos */

  async listarContratos(
    db: Executor,
    filtro: ListarContratosDoCliente,
  ): Promise<{ linhas: LinhaContrato[]; temMais: boolean }> {
    const clausulas = ['c.deleted_at is null']
    const valores: unknown[] = []

    if (filtro.status) {
      valores.push(filtro.status)
      clausulas.push(`c.status = $${valores.length}::app.contrato_status`)
    }
    if (filtro.local_id) {
      valores.push(filtro.local_id)
      clausulas.push(
        `exists (select 1 from public.contrato_item ci
                  where ci.contrato_id = c.id and ci.local_operacao_id = $${valores.length})`,
      )
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(c.created_at, c.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const linhas = await db.consultar<LinhaContrato>(
      `select c.id, c.numero, c.status,
              to_char(c.data_inicio, 'YYYY-MM-DD') as data_inicio,
              to_char(c.data_fim, 'YYYY-MM-DD') as data_fim,
              c.renovacao_automatica, c.valor_mensal_estimado::text, c.created_at,
              (select count(*) from public.contrato_item ci
                where ci.contrato_id = c.id and ci.deleted_at is null) as itens
         from public.contrato c
        where ${clausulas.join(' and ')}
        order by c.created_at desc, c.id desc limit $${valores.length}`,
      valores,
    )
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async contratoPorId(db: Executor, id: string): Promise<LinhaContrato | null> {
    return db.consultarUm<LinhaContrato>(
      `select c.id, c.numero, c.status,
              to_char(c.data_inicio, 'YYYY-MM-DD') as data_inicio,
              to_char(c.data_fim, 'YYYY-MM-DD') as data_fim,
              c.renovacao_automatica, c.valor_mensal_estimado::text, c.created_at,
              (select count(*) from public.contrato_item ci
                where ci.contrato_id = c.id and ci.deleted_at is null) as itens
         from public.contrato c
        where c.id = $1 and c.deleted_at is null`,
      [id],
    )
  }

  async itensDoContrato(db: Executor, contratoId: string): Promise<ItemDoContrato[]> {
    const linhas = await db.consultar<{
      id: string
      equipamento_id: string | null
      patrimonio: string | null
      modelo: string | null
      local_operacao_id: string | null
      local_nome: string | null
      modalidade_cobranca: string
      valor_unitario: string
      quantidade: string
      franquia_quantidade: string | null
      valor_excedente_unitario: string | null
    }>(
      `select ci.id, ci.equipamento_id, e.patrimonio, m.nome as modelo,
              ci.local_operacao_id, lo.nome as local_nome,
              ci.modalidade_cobranca::text, ci.valor_unitario::text, ci.quantidade::text,
              ci.franquia_quantidade::text, ci.valor_excedente_unitario::text
         from public.contrato_item ci
         left join public.equipamento e on e.id = ci.equipamento_id
         left join public.modelo m on m.id = e.modelo_id
         left join public.local_operacao lo on lo.id = ci.local_operacao_id
        where ci.contrato_id = $1 and ci.deleted_at is null
        order by lo.nome nulls last, e.patrimonio nulls last`,
      [contratoId],
    )
    return linhas.map((l) => ({
      id: l.id,
      equipamento_id: l.equipamento_id,
      patrimonio: l.patrimonio,
      modelo: l.modelo,
      local_operacao_id: l.local_operacao_id,
      local_nome: l.local_nome,
      modalidade_cobranca: l.modalidade_cobranca,
      valor_unitario: dinheiro(l.valor_unitario) as ItemDoContrato['valor_unitario'],
      quantidade: Number(l.quantidade),
      franquia_quantidade: l.franquia_quantidade === null ? null : Number(l.franquia_quantidade),
      valor_excedente_unitario:
        l.valor_excedente_unitario === null
          ? null
          : (dinheiro(l.valor_excedente_unitario) as ItemDoContrato['valor_excedente_unitario']),
    }))
  }

  /* -------------------------------------------------------------- parque */

  async listarEquipamentos(
    db: Executor,
    filtro: ListarEquipamentosDoCliente,
  ): Promise<{ linhas: LinhaEquipamento[]; temMais: boolean }> {
    const clausulas = ['e.deleted_at is null']
    const valores: unknown[] = []

    if (filtro.modelo_id) {
      valores.push(filtro.modelo_id)
      clausulas.push(`e.modelo_id = $${valores.length}`)
    }
    if (filtro.local_id) {
      valores.push(filtro.local_id)
      clausulas.push(
        `exists (select 1 from public.contrato_item ci
                  where ci.equipamento_id = e.id and ci.local_operacao_id = $${valores.length})`,
      )
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(e.created_at, e.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    /*
     * O local vem do `contrato_item` **ocupante**, e não de `local_atual_id`.
     *
     * `local_atual_tipo` é texto sem CHECK: o domínio não é garantido, e uma
     * coluna cujos valores ninguém garante não deve decidir o que o cliente lê.
     * É a mesma razão pela qual a política de unidade da 0024 usa este caminho.
     */
    const linhas = await db.consultar<LinhaEquipamento>(
      `select e.id, e.patrimonio, e.numero_serie, m.nome as modelo, f.nome as fabricante,
              e.status, e.created_at,
              alocacao.local_operacao_id, alocacao.local_nome
         from public.equipamento e
         left join public.modelo m on m.id = e.modelo_id
         left join public.fabricante f on f.id = m.fabricante_id
         left join lateral (
           select ci.local_operacao_id, lo.nome as local_nome
             from public.contrato_item ci
             left join public.local_operacao lo on lo.id = ci.local_operacao_id
            where ci.equipamento_id = e.id
              and ci.deleted_at is null
              and ci.status in ('RESERVADO','EM_ENTREGA','ATIVO','SUSPENSO','EM_DEVOLUCAO')
              and ci.vigencia @> now()
            order by ci.vigencia_inicio desc
            limit 1
         ) alocacao on true
        where ${clausulas.join(' and ')}
        order by e.created_at desc, e.id desc limit $${valores.length}`,
      valores,
    )
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  /* ------------------------------------------------------------- consumo */

  private readonly SELECT_CONSUMO = `
    select cc.id, cc.competencia, cc.equipamento_id, e.patrimonio,
           cc.local_operacao_id, lo.nome as local_nome,
           cc.paginas_mono::text, cc.paginas_color::text,
           cc.franquia_mono, cc.franquia_color,
           cc.excedente_mono::text, cc.excedente_color::text,
           cc.valor_excedente::text, cc.fechado_em, cc.updated_at as ultima_leitura_em,
           cc.created_at
      from public.consumo_competencia cc
      left join public.equipamento e on e.id = cc.equipamento_id
      left join public.local_operacao lo on lo.id = cc.local_operacao_id
  `

  async listarConsumo(
    db: Executor,
    filtro: ListarConsumo,
  ): Promise<{ linhas: LinhaConsumo[]; temMais: boolean }> {
    const clausulas: string[] = ['true']
    const valores: unknown[] = []

    if (filtro.competencia) {
      valores.push(filtro.competencia)
      clausulas.push(`cc.competencia = $${valores.length}`)
    }
    if (filtro.local_id) {
      valores.push(filtro.local_id)
      clausulas.push(`cc.local_operacao_id = $${valores.length}`)
    }
    if (filtro.equipamento_id) {
      valores.push(filtro.equipamento_id)
      clausulas.push(`cc.equipamento_id = $${valores.length}`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(cc.created_at, cc.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const linhas = await db.consultar<LinhaConsumo>(
      `${this.SELECT_CONSUMO} where ${clausulas.join(' and ')}
        order by cc.created_at desc, cc.id desc limit $${valores.length}`,
      valores,
    )
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async consumoDaCompetencia(db: Executor, competencia: string): Promise<LinhaConsumo[]> {
    return db.consultar<LinhaConsumo>(
      `${this.SELECT_CONSUMO} where cc.competencia = $1 order by lo.nome nulls last, e.patrimonio`,
      [competencia],
    )
  }

  /* -------------------------------------------------------------- custos */

  /**
   * Custo por competência, com a locação separada do excedente.
   *
   * O total sai de `titulo_receber` quando a cobrança existe — é critério de
   * aceite que ele seja **idêntico** ao da cobrança emitida. Uma soma paralela
   * daria dois números defensáveis para a mesma competência, e o cliente
   * confrontaria o portal com o boleto.
   */
  async custos(
    db: Executor,
    de?: string,
    ate?: string,
  ): Promise<CustoDaCompetencia[]> {
    const clausulas: string[] = ['true']
    const valores: unknown[] = []
    if (de) {
      valores.push(de)
      clausulas.push(`cc.competencia >= $${valores.length}`)
    }
    if (ate) {
      valores.push(ate)
      clausulas.push(`cc.competencia <= $${valores.length}`)
    }

    const linhas = await db.consultar<{
      competencia: string
      excedente: string
      fechada: boolean
      cobranca_id: string | null
      total_cobrado: string | null
      vencimento: string | null
      locacao: string
    }>(
      `with consumo as (
         select cc.competencia,
                sum(cc.valor_excedente) as excedente,
                bool_and(cc.fechado_em is not null) as fechada
           from public.consumo_competencia cc
          where ${clausulas.join(' and ')}
          group by cc.competencia
       ),
       cobranca as (
         select t.competencia,
                min(t.id::text) as cobranca_id,
                sum(t.valor_original - t.desconto) as total,
                min(t.data_vencimento) as vencimento
           from public.titulo_receber t
          where t.deleted_at is null
            and t.origem = 'CONTRATUAL'
            and t.competencia is not null
            and t.status not in ('CANCELADO')
          group by t.competencia
       )
       select c.competencia,
              coalesce(c.excedente, 0)::text as excedente,
              c.fechada,
              b.cobranca_id,
              b.total::text as total_cobrado,
              to_char(b.vencimento, 'YYYY-MM-DD') as vencimento,
              /*
               * Locação é o total cobrado menos o excedente medido. Não é uma
               * terceira fonte: é a decomposição do número que a cobrança já
               * fixou, e por isso os dois sempre fecham.
               */
              coalesce(b.total - coalesce(c.excedente, 0), 0)::text as locacao
         from consumo c
         left join cobranca b on b.competencia = c.competencia
        order by c.competencia desc`,
      valores,
    )

    return linhas.map((l) => {
      const excedente = Number(l.excedente)
      const total = l.total_cobrado === null ? excedente : Number(l.total_cobrado)
      const locacao = l.total_cobrado === null ? 0 : Number(l.locacao)
      return {
        competencia: l.competencia.trim(),
        locacao: locacao.toFixed(4) as CustoDaCompetencia['locacao'],
        excedente: excedente.toFixed(4) as CustoDaCompetencia['excedente'],
        total: total.toFixed(4) as CustoDaCompetencia['total'],
        cobranca_id: l.cobranca_id,
        vencimento: l.vencimento,
        parcial: !l.fechada,
      }
    })
  }

  /* --------------------------------------------------------------- resumo */

  async resumo(db: Executor): Promise<{
    cliente_id: string
    razao_social: string
    nome_fantasia: string | null
    clientes_no_escopo: string
    unidades_no_escopo: string
    contratos_ativos: string
    proximo_vencimento: string | null
    parque_total: string
    por_status: Record<string, number>
    competencia_aberta: string | null
    ultima_leitura_em: Date | null
    paginas_abertas: string
    excedente_aberto: string
    cobranca_total: string
    cobranca_vencida: string
  }> {
    const l = await db.consultarUm<{
      cliente_id: string
      razao_social: string
      nome_fantasia: string | null
      clientes_no_escopo: string
      unidades_no_escopo: string
      contratos_ativos: string
      proximo_vencimento: string | null
      parque_total: string
      por_status: Record<string, number>
      competencia_aberta: string | null
      ultima_leitura_em: Date | null
      paginas_abertas: string
      excedente_aberto: string
      cobranca_total: string
      cobranca_vencida: string
    }>(
      /*
       * Uma consulta só, e não oito. Os números aparecem juntos no painel e
       * precisam ser do mesmo instante: somas lidas em transações diferentes
       * podem não fechar entre si, e o cliente veria um consolidado que nenhum
       * estado do banco já teve.
       *
       * Toda subconsulta aqui já está recortada pela RLS — de cliente e de
       * unidade. Nenhuma delas filtra por `cliente_id` explicitamente, e é por
       * isso que a mesma consulta responde certo para o administrador do cliente
       * e para o gestor de uma unidade.
       */
      `select
         (select c.id from public.cliente c where c.id = app.cliente_atual()) as cliente_id,
         (select c.razao_social from public.cliente c where c.id = app.cliente_atual()) as razao_social,
         (select c.nome_fantasia from public.cliente c where c.id = app.cliente_atual()) as nome_fantasia,
         (select count(*) from public.cliente)::text as clientes_no_escopo,
         (select count(*) from public.local_operacao where deleted_at is null)::text as unidades_no_escopo,
         (select count(*) from public.contrato where status = 'ATIVO' and deleted_at is null)::text as contratos_ativos,
         (select to_char(min(data_fim), 'YYYY-MM-DD') from public.contrato
           where status = 'ATIVO' and deleted_at is null and data_fim >= current_date) as proximo_vencimento,
         (select count(*) from public.equipamento where deleted_at is null)::text as parque_total,
         coalesce((select jsonb_object_agg(x.status, x.n) from (
            select e.status::text as status, count(*)::int as n
              from public.equipamento e where e.deleted_at is null group by e.status) x), '{}'::jsonb) as por_status,
         aberta.competencia as competencia_aberta,
         aberta.ultima_leitura_em,
         coalesce(aberta.paginas, 0)::text as paginas_abertas,
         coalesce(aberta.excedente, 0)::text as excedente_aberto,
         coalesce((select sum(app.saldo_titulo_receber(t.id)) from public.titulo_receber t
           where t.status in ${EM_ABERTO} and t.deleted_at is null), 0)::text as cobranca_total,
         coalesce((select sum(app.saldo_titulo_receber(t.id)) from public.titulo_receber t
           where t.status in ${EM_ABERTO} and t.deleted_at is null
             and t.data_vencimento < current_date), 0)::text as cobranca_vencida
       /*
        * left join lateral ... on true, e nao a subconsulta direto no from.
        *
        * A primeira versao punha a competencia aberta no from, e sem competencia
        * aberta ela nao devolve linha nenhuma: a consulta inteira devolvia zero
        * linhas e o resumo virava 500. Cliente sem consumo em aberto e o caso
        * normal no comeco do mes, e o painel dele tem de responder.
        */
       from (select 1) as base
       left join lateral (
         select cc.competencia,
                max(cc.updated_at) as ultima_leitura_em,
                sum(cc.paginas_mono + cc.paginas_color) as paginas,
                sum(cc.valor_excedente) as excedente
           from public.consumo_competencia cc
          where cc.fechado_em is null
          group by cc.competencia
          order by cc.competencia desc
          limit 1
       ) aberta on true`,
    )
    return l as NonNullable<typeof l>
  }
}
