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
  RegistrarMovimento,
  SaldoEstoque,
  SolicitarPeca,
  SugestaoReposicao,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor } from '../../comum/pagina.js'

/**
 * Acesso a peças e estoque.
 *
 * Como nos demais repositórios: nenhum `where tenant_id`. O isolamento é da
 * RLS, dentro do banco.
 *
 * E **nenhuma escrita em `saldo_estoque`**. O saldo é projeção do movimento,
 * aplicada por gatilho; um `update` aqui recriaria o caminho de divergência
 * que o desenho fecha — com o agravante de valer só para quem passa por esta
 * API, deixando importação e correção manual com outro saldo.
 */

const SELECT_PECA = `
  select p.id, p.codigo_interno, p.codigo_fabricante, p.descricao, p.unidade,
         p.fornecedor_preferencial_id,
         p.custo_medio::text  as custo_medio,
         p.ultimo_custo::text as ultimo_custo,
         p.criticidade::text  as criticidade,
         p.localizacao_fisica, p.ativo, p.created_at
    from public.peca p
`

interface LinhaPeca extends Peca, Record<string, unknown> {
  created_at: Date
}

@Injectable()
export class EstoqueRepositorio {
  async listarPecas(db: Executor, filtro: ListarPecas): Promise<{ linhas: Peca[]; temMais: boolean }> {
    const clausulas = ['p.deleted_at is null']
    const valores: unknown[] = []

    if (filtro.busca) {
      valores.push(`%${filtro.busca}%`)
      clausulas.push(`(p.descricao ilike $${valores.length} or p.codigo_interno ilike $${valores.length})`)
    }
    if (filtro.criticidade) {
      valores.push(filtro.criticidade)
      clausulas.push(`p.criticidade = $${valores.length}`)
    }

    /*
     * RN-016 — a lista que muda ação.
     *
     * A lista completa de peças serve para consultar; a do que vai faltar
     * serve para comprar. O disponível é somado por depósito de propósito: a
     * peça que está na van do técnico conta como estoque, e ignorá-la
     * dispararia reposição de algo que já foi comprado.
     */
    if (filtro.abaixo_do_ponto_pedido) {
      clausulas.push(`exists (
        select 1
          from public.politica_reposicao pr
          left join public.saldo_estoque s
            on s.peca_id = pr.peca_id and s.deposito_id = pr.deposito_id
         where pr.peca_id = p.id
           and coalesce(s.quantidade_disponivel, 0) <= pr.ponto_pedido
      )`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(p.created_at, p.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const linhas = await db.consultar<LinhaPeca>(
      `${SELECT_PECA} where ${clausulas.join(' and ')}
        order by p.created_at desc, p.id desc limit $${valores.length}`,
      valores,
    )

    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async depositos(db: Executor): Promise<Deposito[]> {
    return db.consultar<Deposito & Record<string, unknown>>(
      `select id, filial_id, codigo, nome, tipo::text as tipo, responsavel_id, ativo
         from public.deposito
        where deleted_at is null
        order by ativo desc, nome`,
    )
  }

  async saldos(db: Executor, pecaId?: string): Promise<SaldoEstoque[]> {
    const valores: unknown[] = []
    let onde = 'true'
    if (pecaId) {
      valores.push(pecaId)
      onde = `s.peca_id = $${valores.length}`
    }

    return db.consultar<SaldoEstoque & Record<string, unknown>>(
      `select s.peca_id, s.deposito_id,
              s.quantidade_fisica::text     as quantidade_fisica,
              s.quantidade_reservada::text  as quantidade_reservada,
              s.quantidade_disponivel::text as quantidade_disponivel,
              s.valor_total::text           as valor_total,
              to_char(s.atualizado_em, 'YYYY-MM-DD"T"HH24:MI:SSOF') as atualizado_em
         from public.saldo_estoque s
        where ${onde}
        order by s.peca_id, s.deposito_id`,
      valores,
    )
  }

  async movimentos(db: Executor, filtro: ListarMovimentos): Promise<MovimentoEstoque[]> {
    const clausulas = ['true']
    const valores: unknown[] = []

    for (const [coluna, valor] of [
      ['m.peca_id', filtro.peca_id],
      ['m.deposito_id', filtro.deposito_id],
      ['m.ordem_servico_id', filtro.ordem_servico_id],
    ] as const) {
      if (!valor) continue
      valores.push(valor)
      clausulas.push(`${coluna} = $${valores.length}`)
    }

    valores.push(filtro.limit)
    return db.consultar<MovimentoEstoque & Record<string, unknown>>(
      `select m.id, m.peca_id, m.deposito_id, m.tipo::text as tipo,
              m.quantidade::text     as quantidade,
              m.custo_unitario::text as custo_unitario,
              m.custo_total::text    as custo_total,
              m.ordem_servico_id, m.deposito_contraparte_id,
              m.saldo_apos::text     as saldo_apos,
              to_char(m.data_movimento, 'YYYY-MM-DD"T"HH24:MI:SSOF') as data_movimento,
              m.motivo
         from public.movimento_estoque m
        where ${clausulas.join(' and ')}
        order by m.data_movimento desc
        limit $${valores.length}`,
      valores,
    )
  }

  /**
   * Registra o movimento. O saldo é consequência, não parâmetro.
   *
   * O gatilho `movimento_aplica_saldo` projeta o saldo e grava `saldo_apos`
   * nesta mesma linha. Por isso o `returning` traz a linha já completa: ler de
   * novo depois mostraria o mesmo, e uma consulta a mais.
   */
  async registrarMovimento(
    db: Executor,
    dados: RegistrarMovimento,
    autorId: string,
  ): Promise<MovimentoEstoque | null> {
    return db.consultarUm<MovimentoEstoque & Record<string, unknown>>(
      `insert into public.movimento_estoque
         (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario,
          ordem_servico_id, deposito_contraparte_id, motivo, registrado_por, created_by)
       values (app.tenant_atual(), $1, $2, $3::app.movimento_tipo, $4::numeric, $5::numeric,
               $6, $7, $8, $9, $9)
       returning id, peca_id, deposito_id, tipo::text as tipo,
                 quantidade::text     as quantidade,
                 custo_unitario::text as custo_unitario,
                 custo_total::text    as custo_total,
                 ordem_servico_id, deposito_contraparte_id,
                 saldo_apos::text     as saldo_apos,
                 to_char(data_movimento, 'YYYY-MM-DD"T"HH24:MI:SSOF') as data_movimento,
                 motivo`,
      [
        dados.peca_id,
        dados.deposito_id,
        dados.tipo,
        dados.quantidade,
        dados.custo_unitario,
        dados.ordem_servico_id ?? null,
        dados.deposito_contraparte_id ?? null,
        dados.motivo ?? null,
        autorId,
      ],
    )
  }

  /* ------------------------------------------- política de reposição --- */

  /**
   * `on conflict do update` aqui é correto, ao contrário do caso do saldo: a
   * chave é (tenant, peça, depósito) e não há `check` sobre a linha candidata
   * que a colisão possa reprovar. É uma substituição de atributo, não um
   * evento acumulado.
   */
  async definirPolitica(db: Executor, dados: DefinirPolitica): Promise<void> {
    await db.consultar(
      `insert into public.politica_reposicao
         (tenant_id, peca_id, deposito_id, estoque_minimo, estoque_maximo,
          ponto_pedido, lote_economico, lead_time_dias, created_by, updated_by)
       values (app.tenant_atual(), $1, $2, $3::numeric, $4::numeric, $5::numeric,
               $6::numeric, $7, app.usuario_atual(), app.usuario_atual())
       on conflict (tenant_id, peca_id, deposito_id) do update
          set estoque_minimo = excluded.estoque_minimo,
              estoque_maximo = excluded.estoque_maximo,
              ponto_pedido   = excluded.ponto_pedido,
              lote_economico = excluded.lote_economico,
              lead_time_dias = excluded.lead_time_dias,
              updated_at = now(), updated_by = app.usuario_atual()`,
      [
        dados.peca_id,
        dados.deposito_id,
        dados.estoque_minimo,
        dados.estoque_maximo ?? null,
        dados.ponto_pedido,
        dados.lote_economico ?? null,
        dados.lead_time_dias,
      ],
    )
  }

  async politicas(db: Executor, pecaId?: string): Promise<PoliticaReposicao[]> {
    return db.consultar<PoliticaReposicao & Record<string, unknown>>(
      `select pr.peca_id, p.codigo_interno as peca_codigo, pr.deposito_id,
              d.nome as deposito_nome,
              pr.estoque_minimo::text as estoque_minimo,
              pr.estoque_maximo::text as estoque_maximo,
              pr.ponto_pedido::text   as ponto_pedido,
              pr.lote_economico::text as lote_economico,
              pr.lead_time_dias
         from public.politica_reposicao pr
         join public.peca p     on p.id = pr.peca_id
         join public.deposito d on d.id = pr.deposito_id
        where ($1::uuid is null or pr.peca_id = $1)
        order by p.codigo_interno, d.nome`,
      [pecaId ?? null],
    )
  }

  /**
   * Sugestões de reposição (RN-016), derivadas no instante da consulta.
   *
   * `left join` no saldo, e não `join`: peça com política e **sem nenhum
   * saldo** é o caso que mais precisa aparecer — disponível zero contra ponto
   * de pedido positivo é exatamente o que se quer comprar. Com `join` ela
   * sumiria da lista justamente por estar esgotada.
   */
  async sugestoesReposicao(db: Executor): Promise<SugestaoReposicao[]> {
    return db.consultar<SugestaoReposicao & Record<string, unknown>>(
      `select pr.peca_id, p.codigo_interno as peca_codigo, pr.deposito_id,
              d.nome as deposito_nome,
              coalesce(s.quantidade_disponivel, 0)::text as quantidade_disponivel,
              pr.ponto_pedido::text as ponto_pedido,
              greatest(
                coalesce(pr.lote_economico,
                         coalesce(pr.estoque_maximo, pr.ponto_pedido)
                           - coalesce(s.quantidade_disponivel, 0)),
                0
              )::text as sugerido,
              pr.lead_time_dias
         from public.politica_reposicao pr
         join public.peca p     on p.id = pr.peca_id
         join public.deposito d on d.id = pr.deposito_id
         left join public.saldo_estoque s
           on s.peca_id = pr.peca_id and s.deposito_id = pr.deposito_id
        where coalesce(s.quantidade_disponivel, 0) <= pr.ponto_pedido
          and pr.ponto_pedido > 0
        order by (pr.ponto_pedido - coalesce(s.quantidade_disponivel, 0)) desc`,
    )
  }

  /* --------------------------------------------- reserva de peça na OS --- */

  async solicitarPeca(db: Executor, osId: string, dados: SolicitarPeca): Promise<string | null> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.os_peca
         (tenant_id, ordem_servico_id, peca_id, deposito_id, quantidade_reservada, created_by)
       values (app.tenant_atual(), $1, $2, $3, $4::numeric, app.usuario_atual())
       returning id`,
      [osId, dados.peca_id, dados.deposito_id, dados.quantidade],
    )
    return l ? l.id : null
  }

  /**
   * Muda o estado da peça na OS. Os efeitos no saldo — reservar, baixar com
   * custo médio, liberar — são do gatilho da 0035, não daqui.
   *
   * `and ordem_servico_id = $2` porque a peça é endereçada pelo caminho da
   * ordem: sem a conferência, trocar o id na URL consumiria a reserva de outra
   * OS, e o custo iria para a ordem errada.
   */
  async mudarStatusPeca(
    db: Executor,
    itemId: string,
    osId: string,
    status: OsPeca['status'],
  ): Promise<boolean> {
    const r = await db.consultarUm<{ id: string }>(
      `update public.os_peca
          set status = $3::app.os_peca_status, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and ordem_servico_id = $2
        returning id`,
      [itemId, osId, status],
    )
    return r !== null
  }

  async pecasDaOs(db: Executor, osId: string): Promise<OsPeca[]> {
    return db.consultar<OsPeca & Record<string, unknown>>(
      `select op.id, op.ordem_servico_id, op.peca_id, p.codigo_interno as peca_codigo,
              op.deposito_id,
              op.quantidade_reservada::text as quantidade_reservada,
              op.quantidade_consumida::text as quantidade_consumida,
              op.custo_unitario_baixa::text as custo_unitario_baixa,
              op.status::text as status
         from public.os_peca op
         join public.peca p on p.id = op.peca_id
        where op.ordem_servico_id = $1
        order by op.created_at`,
      [osId],
    )
  }
}
