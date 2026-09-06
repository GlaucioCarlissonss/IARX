import { Injectable } from '@nestjs/common'
import type {
  CategoriaDespesa,
  CriarCategoriaDespesa,
  CriarOrcamento,
  CriarReplanejamento,
  EditarCategoriaDespesa,
  EditarOrcamento,
  LinhaExecucao,
  ListarCategoriasDespesa,
  ListarOrcamentos,
  Orcamento,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor } from '../../comum/pagina.js'

/**
 * Acesso a dados de categoria, orçamento e execução.
 *
 * Como nos demais repositórios: **nenhum `where tenant_id`**. O isolamento é da
 * RLS, dentro do banco.
 *
 * E nenhuma aritmética de execução aqui. Realizado, comprometido, percentual e
 * limiar saem de `app.execucao_orcamentaria` — uma segunda implementação em
 * TypeScript daria dois números para a mesma pergunta, e o da tela discordaria
 * do que o gatilho de replanejamento usa para recusar.
 */

/*
 * O nível vem de uma CTE recursiva, como no centro de custo: guardá-lo na tabela
 * criaria a possibilidade de ele discordar da cadeia de pais, e calculá-lo no
 * cliente não serve porque a árvore pode chegar paginada.
 */
const SELECT_CATEGORIA = `
  with recursive arvore as (
    select c.id, 1 as nivel
      from public.categoria_despesa c
     where c.categoria_pai_id is null and c.deleted_at is null
    union all
    select f.id, a.nivel + 1
      from public.categoria_despesa f
      join arvore a on f.categoria_pai_id = a.id
     where f.deleted_at is null
  )
  select c.id, c.nome, c.categoria_pai_id, c.classificacao_sugerida,
         c.ativo, c.residual, coalesce(a.nivel, 1) as nivel, c.version, c.created_at
    from public.categoria_despesa c
    left join arvore a on a.id = c.id
`

export interface LinhaCategoria extends Record<string, unknown> {
  id: string
  nome: string
  categoria_pai_id: string | null
  classificacao_sugerida: CategoriaDespesa['classificacao_sugerida']
  ativo: boolean
  residual: boolean
  nivel: string | number
  version: number
  created_at: Date
}

export function mapearCategoria(l: LinhaCategoria): CategoriaDespesa {
  return {
    id: l.id,
    nome: l.nome,
    categoria_pai_id: l.categoria_pai_id,
    classificacao_sugerida: l.classificacao_sugerida,
    ativo: l.ativo,
    residual: l.residual,
    // `bigint` do PostgreSQL chega como string no driver.
    nivel: Number(l.nivel),
    version: l.version,
  }
}

export const cursorCategoria = (l: LinhaCategoria) => ({
  criadoEm: l.created_at.toISOString(),
  id: l.id,
})

const SELECT_ORCAMENTO = `
  select o.id, o.ano, o.mes, o.categoria_id, c.nome as categoria_nome,
         o.centro_custo_id, o.filial_id, o.valor_orcado::text as valor_orcado,
         o.version, o.created_at
    from public.orcamento o
    left join public.categoria_despesa c on c.id = o.categoria_id
`

export interface LinhaOrcamento extends Record<string, unknown> {
  id: string
  ano: number
  mes: number | null
  categoria_id: string | null
  categoria_nome: string | null
  centro_custo_id: string | null
  filial_id: string | null
  valor_orcado: string
  version: number
  created_at: Date
}

export function mapearOrcamento(l: LinhaOrcamento): Orcamento {
  return {
    id: l.id,
    ano: l.ano,
    mes: l.mes,
    categoria_id: l.categoria_id,
    categoria_nome: l.categoria_nome,
    centro_custo_id: l.centro_custo_id,
    filial_id: l.filial_id,
    valor_orcado: l.valor_orcado as Orcamento['valor_orcado'],
    version: l.version,
  }
}

export const cursorOrcamento = (l: LinhaOrcamento) => ({
  criadoEm: l.created_at.toISOString(),
  id: l.id,
})

@Injectable()
export class DespesasRepositorio {
  /* ---------------------------------------------------------- categorias */

  async listarCategorias(
    db: Executor,
    filtro: ListarCategoriasDespesa,
  ): Promise<{ linhas: LinhaCategoria[]; temMais: boolean }> {
    const clausulas = ['c.deleted_at is null']
    const valores: unknown[] = []

    if (filtro.apenas_ativas) clausulas.push('c.ativo')

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(c.created_at, c.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const linhas = await db.consultar<LinhaCategoria>(
      `${SELECT_CATEGORIA} where ${clausulas.join(' and ')}
        order by c.created_at desc, c.id desc limit $${valores.length}`,
      valores,
    )
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async categoriaPorId(db: Executor, id: string): Promise<LinhaCategoria | null> {
    return db.consultarUm<LinhaCategoria>(
      `${SELECT_CATEGORIA} where c.id = $1 and c.deleted_at is null`,
      [id],
    )
  }

  async criarCategoria(
    db: Executor,
    tenantId: string,
    dados: CriarCategoriaDespesa,
  ): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.categoria_despesa
         (tenant_id, nome, categoria_pai_id, classificacao_sugerida)
       values ($1, $2, $3, $4) returning id`,
      [tenantId, dados.nome, dados.categoria_pai_id ?? null, dados.classificacao_sugerida ?? null],
    )
    return (l as { id: string }).id
  }

  async editarCategoria(
    db: Executor,
    id: string,
    versao: number,
    dados: EditarCategoriaDespesa,
  ): Promise<boolean> {
    const campos: string[] = []
    const valores: unknown[] = []
    for (const [coluna, valor] of Object.entries(dados)) {
      valores.push(valor)
      campos.push(`${coluna} = $${valores.length}`)
    }
    valores.push(id, versao)
    const l = await db.consultarUm<{ id: string }>(
      `update public.categoria_despesa set ${campos.join(', ')}, version = version + 1
        where id = $${valores.length - 1} and version = $${valores.length} and deleted_at is null
       returning id`,
      valores,
    )
    return l !== null
  }

  /* ----------------------------------------------------------- orçamentos */

  async listarOrcamentos(
    db: Executor,
    filtro: ListarOrcamentos,
  ): Promise<{ linhas: LinhaOrcamento[]; temMais: boolean }> {
    const clausulas: string[] = ['true']
    const valores: unknown[] = []

    if (filtro.ano !== undefined) {
      valores.push(filtro.ano)
      clausulas.push(`o.ano = $${valores.length}`)
    }
    if (filtro.mes !== undefined) {
      valores.push(filtro.mes)
      clausulas.push(`o.mes = $${valores.length}`)
    }
    if (filtro.categoria_id) {
      valores.push(filtro.categoria_id)
      clausulas.push(`o.categoria_id = $${valores.length}`)
    }
    if (filtro.centro_custo_id) {
      valores.push(filtro.centro_custo_id)
      clausulas.push(`o.centro_custo_id = $${valores.length}`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(o.created_at, o.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const linhas = await db.consultar<LinhaOrcamento>(
      `${SELECT_ORCAMENTO} where ${clausulas.join(' and ')}
        order by o.created_at desc, o.id desc limit $${valores.length}`,
      valores,
    )
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async orcamentoPorId(db: Executor, id: string): Promise<LinhaOrcamento | null> {
    return db.consultarUm<LinhaOrcamento>(`${SELECT_ORCAMENTO} where o.id = $1`, [id])
  }

  async criarOrcamento(db: Executor, tenantId: string, dados: CriarOrcamento): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.orcamento
         (tenant_id, ano, mes, categoria_id, centro_custo_id, filial_id, valor_orcado, created_by)
       values ($1, $2, $3, $4, $5, $6, $7::numeric, app.usuario_atual()) returning id`,
      [
        tenantId,
        dados.ano,
        dados.mes ?? null,
        dados.categoria_id ?? null,
        dados.centro_custo_id ?? null,
        dados.filial_id ?? null,
        dados.valor_orcado,
      ],
    )
    return (l as { id: string }).id
  }

  async editarOrcamento(
    db: Executor,
    id: string,
    versao: number,
    dados: EditarOrcamento,
  ): Promise<boolean> {
    const l = await db.consultarUm<{ id: string }>(
      `update public.orcamento set valor_orcado = $3::numeric, version = version + 1
        where id = $1 and version = $2 returning id`,
      [id, versao, dados.valor_orcado],
    )
    return l !== null
  }

  /**
   * Copia as linhas de um ano para outro.
   *
   * `on conflict do nothing` sobre `orcamento_dimensao_uk`: copiar **não
   * sobrescreve**. Quem já orçou uma linha do ano destino decidiu aquele número,
   * e a cópia do ano anterior não é motivo para desfazer a decisão — o retorno
   * diz quantas foram ignoradas, para a tela poder contar isso.
   */
  async copiarOrcamento(
    db: Executor,
    tenantId: string,
    deAno: number,
    paraAno: number,
    fator: number,
  ): Promise<{ criados: number; candidatos: number }> {
    const candidatos = await db.consultarUm<{ n: string }>(
      `select count(*) as n from public.orcamento where ano = $1`,
      [deAno],
    )
    const linhas = await db.consultar<{ id: string }>(
      `insert into public.orcamento
         (tenant_id, ano, mes, categoria_id, centro_custo_id, filial_id, valor_orcado, created_by)
       select $1, $3, o.mes, o.categoria_id, o.centro_custo_id, o.filial_id,
              round(o.valor_orcado * $4::numeric, 4), app.usuario_atual()
         from public.orcamento o
        where o.ano = $2
       on conflict do nothing
       returning id`,
      [tenantId, deAno, paraAno, fator],
    )
    return { criados: linhas.length, candidatos: Number(candidatos?.n ?? 0) }
  }

  /* ------------------------------------------------------- replanejamento */

  async replanejar(db: Executor, tenantId: string, dados: CriarReplanejamento): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.replanejamento_orcamento
         (tenant_id, orcamento_origem_id, orcamento_destino_id, valor_transferido, motivo, criado_por)
       values ($1, $2, $3, $4::numeric, $5, app.usuario_atual()) returning id`,
      [
        tenantId,
        dados.orcamento_origem_id,
        dados.orcamento_destino_id,
        dados.valor_transferido,
        dados.motivo,
      ],
    )
    return (l as { id: string }).id
  }

  /* ------------------------------------------------------------- execução */

  async execucao(
    db: Executor,
    ano: number,
    mes?: number,
    centro?: string,
    filial?: string,
  ): Promise<LinhaExecucao[]> {
    const linhas = await db.consultar<{
      orcamento_id: string
      ano: number
      mes: number | null
      categoria_id: string | null
      categoria_nome: string | null
      centro_custo_id: string | null
      filial_id: string | null
      valor_orcado: string
      realizado: string
      comprometido: string
      percentual: string | null
      limiar: LinhaExecucao['limiar']
    }>(
      /*
       * `to_char` com quatro casas fixas, e não `::text`.
       *
       * `numeric` sem escala imprime o que tiver: um orçado de 50000 sai
       * "50000.0000" porque a coluna tem escala, mas um realizado somado de
       * zero sai "0". O contrato declara dinheiro como decimal de até quatro
       * casas, e um consumidor que compare strings veria "0" e "0.0000" como
       * valores diferentes para o mesmo nada.
       */
      `select orcamento_id, ano, mes, categoria_id, categoria_nome, centro_custo_id, filial_id,
              to_char(valor_orcado, 'FM9999999999990.0000') as valor_orcado,
              to_char(realizado, 'FM9999999999990.0000') as realizado,
              to_char(comprometido, 'FM9999999999990.0000') as comprometido,
              percentual::text, limiar
         from app.execucao_orcamentaria($1, $2, $3, $4)`,
      [ano, mes ?? null, centro ?? null, filial ?? null],
    )
    return linhas.map((l) => ({
      orcamento_id: l.orcamento_id,
      ano: l.ano,
      mes: l.mes,
      categoria_id: l.categoria_id,
      categoria_nome: l.categoria_nome,
      centro_custo_id: l.centro_custo_id,
      filial_id: l.filial_id,
      valor_orcado: l.valor_orcado as LinhaExecucao['valor_orcado'],
      realizado: l.realizado as LinhaExecucao['realizado'],
      comprometido: l.comprometido as LinhaExecucao['comprometido'],
      percentual: l.percentual === null ? null : Number(l.percentual),
      limiar: l.limiar,
    }))
  }

  /**
   * Os números que não vêm de `execucao_orcamentaria`: totais do período,
   * proporção de investimento, índice de recorrência e os dois denominadores de
   * D-26.
   *
   * Uma consulta só, e não seis: os números aparecem juntos na tela e precisam
   * ser do mesmo instante. Somas lidas em transações diferentes podem não fechar
   * entre si, e o painel mostraria um total que nenhum estado do banco já teve.
   */
  async agregados(
    db: Executor,
    tenantId: string,
    de: string,
    ate: string,
    deAnterior: string,
    ateAnterior: string,
    filial?: string,
  ): Promise<{
    despesa_total: string
    despesa_mes_anterior: string
    investimento: string
    recorrente: string
    clientes_ativos: string
    equipamentos_locados: string
  }> {
    const l = await db.consultarUm<{
      despesa_total: string
      despesa_mes_anterior: string
      investimento: string
      recorrente: string
      clientes_ativos: string
      equipamentos_locados: string
    }>(
      `select
         app.despesa_realizada($1, $2::date, $3::date, null, null, $6, null)::text as despesa_total,
         app.despesa_realizada($1, $4::date, $5::date, null, null, $6, null)::text as despesa_mes_anterior,
         coalesce((select sum(t.valor_devido) from public.titulo_pagar t
                    where t.deleted_at is null
                      and t.data_emissao between $2::date and $3::date
                      and t.status not in ('CANCELADO', 'REJEITADO')
                      and t.classificacao = 'INVESTIMENTO'
                      and ($6::uuid is null or t.filial_id = $6)), 0)::text as investimento,
         coalesce((select sum(t.valor_devido) from public.titulo_pagar t
                    where t.deleted_at is null
                      and t.data_emissao between $2::date and $3::date
                      and t.status not in ('CANCELADO', 'REJEITADO')
                      and t.recorrencia_id is not null
                      and ($6::uuid is null or t.filial_id = $6)), 0)::text as recorrente,
         (select count(distinct c.cliente_id) from public.contrato c
           where c.deleted_at is null and c.status = 'ATIVO')::text as clientes_ativos,
         (select count(*) from public.equipamento e
           where e.deleted_at is null and e.status = 'LOCADO')::text as equipamentos_locados`,
      [tenantId, de, ate, deAnterior, ateAnterior, filial ?? null],
    )
    return l as NonNullable<typeof l>
  }
}
