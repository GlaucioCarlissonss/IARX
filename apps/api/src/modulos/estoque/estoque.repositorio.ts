import { Injectable } from '@nestjs/common'
import type {
  Deposito,
  ListarMovimentos,
  ListarPecas,
  MovimentoEstoque,
  Peca,
  RegistrarMovimento,
  SaldoEstoque,
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
}
