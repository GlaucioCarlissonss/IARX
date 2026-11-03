import { Injectable } from '@nestjs/common'
import type {
  AbrirInventario,
  CriarOrdemCompra,
  Inventario,
  ListarInventarios,
  ListarOrdensCompra,
  OrdemCompra,
  RegistrarContagem,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor, type Cursor } from '../../comum/pagina.js'

/**
 * Acesso a ordem de compra e inventário.
 *
 * Como nos demais: nenhum `where tenant_id` — quem isola é a RLS — e nenhum
 * valor concatenado no SQL.
 *
 * E **nenhuma escrita em `movimento_estoque`** daqui. A entrada de compra nasce
 * do gatilho do recebimento e o ajuste de inventário do gatilho da aprovação:
 * escrever o movimento aqui criaria o estado em que a ordem diz que a
 * mercadoria chegou e o estoque diz que não.
 */

const OC_BASE = `
  select o.id, o.numero, o.fornecedor_id, f.razao_social as fornecedor_nome,
         o.deposito_id, d.nome as deposito_nome, o.status,
         to_char(o.previsao_entrega, 'YYYY-MM-DD') as previsao_entrega,
         o.observacao, o.aprovado_por, o.aprovado_em,
         app.valor_ordem_compra(o.id)::text as valor_total,
         o.version, o.created_at
    from public.ordem_compra o
    join public.fornecedor f on f.id = o.fornecedor_id
    join public.deposito   d on d.id = o.deposito_id
`

const INV_BASE = `
  select i.id, i.deposito_id, d.nome as deposito_nome, i.tipo::text as tipo,
         i.status, i.iniciado_em, i.finalizado_em, i.aprovado_por, i.aprovado_em,
         i.version
    from public.inventario i
    join public.deposito d on d.id = i.deposito_id
`

@Injectable()
export class ComprasRepositorio {
  /* --------------------------------------------------- ordem de compra --- */

  async criarOrdem(db: Executor, tenantId: string, dados: CriarOrdemCompra): Promise<string> {
    const oc = await db.consultarUm<{ id: string }>(
      `insert into public.ordem_compra
         (tenant_id, numero, fornecedor_id, deposito_id, previsao_entrega, observacao, created_by)
       values ($1, app.proximo_numero_oc($1), $2, $3, $4::date, $5, app.usuario_atual())
       returning id`,
      [tenantId, dados.fornecedor_id, dados.deposito_id, dados.previsao_entrega ?? null, dados.observacao ?? null],
    )
    const id = (oc as { id: string }).id

    for (const item of dados.itens) {
      await db.consultar(
        `insert into public.ordem_compra_item
           (tenant_id, ordem_compra_id, peca_id, quantidade_pedida, preco_unitario, created_by)
         values ($1, $2, $3, $4::numeric, $5::numeric, app.usuario_atual())`,
        [tenantId, id, item.peca_id, item.quantidade_pedida, item.preco_unitario],
      )
    }
    return id
  }

  async ordemPorId(db: Executor, id: string): Promise<OrdemCompra | null> {
    const linha = await db.consultarUm<Record<string, unknown>>(`${OC_BASE} where o.id = $1`, [id])
    if (!linha) return null
    const itens = await db.consultar<Record<string, unknown>>(
      `select i.id, i.peca_id, p.codigo_interno as peca_codigo,
              i.quantidade_pedida::text   as quantidade_pedida,
              i.quantidade_recebida::text as quantidade_recebida,
              i.preco_unitario::text      as preco_unitario,
              i.valor_total::text         as valor_total
         from public.ordem_compra_item i
         join public.peca p on p.id = i.peca_id
        where i.ordem_compra_id = $1
        order by p.codigo_interno`,
      [id],
    )
    return mapearOrdem(linha, itens)
  }

  async listarOrdens(
    db: Executor,
    filtro: ListarOrdensCompra,
  ): Promise<{ linhas: OrdemCompra[]; temMais: boolean }> {
    const valores: unknown[] = []
    const clausulas: string[] = []

    if (filtro.status) {
      valores.push(filtro.status)
      clausulas.push(`o.status = $${valores.length}::app.ordem_compra_status`)
    }
    if (filtro.fornecedor_id) {
      valores.push(filtro.fornecedor_id)
      clausulas.push(`o.fornecedor_id = $${valores.length}`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(o.created_at, o.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const where = clausulas.length ? `where ${clausulas.join(' and ')}` : ''
    const linhas = await db.consultar<Record<string, unknown>>(
      `${OC_BASE} ${where} order by o.created_at desc, o.id desc limit $${valores.length}`,
      valores,
    )
    const temMais = linhas.length > filtro.limit
    return { linhas: linhas.slice(0, filtro.limit).map((l) => mapearOrdem(l, [])), temMais }
  }

  async mudarStatusOrdem(
    db: Executor,
    id: string,
    status: OrdemCompra['status'],
    motivo: string | null,
  ): Promise<boolean> {
    const r = await db.consultarUm<{ id: string }>(
      `update public.ordem_compra
          set status = $2::app.ordem_compra_status,
              motivo_cancelamento = coalesce($3, motivo_cancelamento),
              version = version + 1
        where id = $1
        returning id`,
      [id, status, motivo],
    )
    return r !== null
  }

  /**
   * Quantidade acumulada, não incremento.
   *
   * O gatilho da 0036 calcula o delta e gera a entrada de estoque só por ele.
   * Com incremento, um reenvio por timeout somaria duas vezes — e estoque
   * inflado por retry é a divergência que ninguém consegue explicar depois.
   *
   * `and ordem_compra_id = $2` porque o item é endereçado pelo caminho da
   * ordem: sem isso, trocar o id na URL daria entrada de mercadoria em outra
   * compra, de outro fornecedor.
   */
  async receberItem(
    db: Executor,
    itemId: string,
    ordemId: string,
    acumulado: string,
  ): Promise<boolean> {
    const r = await db.consultarUm<{ id: string }>(
      `update public.ordem_compra_item
          set quantidade_recebida = $3::numeric, updated_by = app.usuario_atual()
        where id = $1 and ordem_compra_id = $2
        returning id`,
      [itemId, ordemId, acumulado],
    )
    return r !== null
  }

  /* -------------------------------------------------------- inventário --- */

  async abrirInventario(db: Executor, tenantId: string, dados: AbrirInventario): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.inventario (tenant_id, deposito_id, tipo, created_by)
       values ($1, $2, $3::app.inventario_tipo, app.usuario_atual())
       returning id`,
      [tenantId, dados.deposito_id, dados.tipo],
    )
    return (l as { id: string }).id
  }

  async inventarioPorId(db: Executor, id: string): Promise<Inventario | null> {
    const linha = await db.consultarUm<Record<string, unknown>>(`${INV_BASE} where i.id = $1`, [id])
    if (!linha) return null
    const contagens = await db.consultar<Record<string, unknown>>(
      `select c.id, c.peca_id, p.codigo_interno as peca_codigo,
              c.saldo_sistema::text as saldo_sistema,
              c.saldo_contado::text as saldo_contado,
              c.divergencia::text   as divergencia,
              c.justificativa, c.movimento_ajuste_id
         from public.inventario_contagem c
         join public.peca p on p.id = c.peca_id
        where c.inventario_id = $1
        order by p.codigo_interno`,
      [id],
    )
    return mapearInventario(linha, contagens)
  }

  async listarInventarios(
    db: Executor,
    filtro: ListarInventarios,
  ): Promise<{ linhas: Inventario[]; temMais: boolean }> {
    const valores: unknown[] = []
    const clausulas: string[] = []

    if (filtro.status) {
      valores.push(filtro.status)
      clausulas.push(`i.status = $${valores.length}::app.inventario_status`)
    }
    if (filtro.deposito_id) {
      valores.push(filtro.deposito_id)
      clausulas.push(`i.deposito_id = $${valores.length}`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(i.iniciado_em, i.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const where = clausulas.length ? `where ${clausulas.join(' and ')}` : ''
    const linhas = await db.consultar<Record<string, unknown>>(
      `${INV_BASE} ${where} order by i.iniciado_em desc, i.id desc limit $${valores.length}`,
      valores,
    )
    const temMais = linhas.length > filtro.limit
    return { linhas: linhas.slice(0, filtro.limit).map((l) => mapearInventario(l, [])), temMais }
  }

  /**
   * Registra a contagem congelando o saldo do sistema **agora**.
   *
   * O `select` do saldo acontece dentro do mesmo `insert`, e não vem do corpo
   * da requisição: aceitá-lo do cliente permitiria declarar a divergência em
   * vez de medi-la. `coalesce(..., 0)` porque peça sem saldo registrado conta
   * como zero — e é justamente a contagem que descobre que ela existe.
   */
  async registrarContagem(
    db: Executor,
    tenantId: string,
    inventarioId: string,
    dados: RegistrarContagem,
  ): Promise<boolean> {
    const r = await db.consultarUm<{ id: string }>(
      `insert into public.inventario_contagem
         (tenant_id, inventario_id, peca_id, saldo_sistema, saldo_contado,
          contado_por, justificativa, created_by)
       select $1, $2, $3,
              coalesce((select s.quantidade_fisica
                          from public.saldo_estoque s
                         where s.peca_id = $3 and s.deposito_id = i.deposito_id), 0),
              $4::numeric, app.usuario_atual(), $5, app.usuario_atual()
         from public.inventario i
        where i.id = $2
       on conflict (inventario_id, peca_id) do update
          set saldo_contado = excluded.saldo_contado,
              justificativa = excluded.justificativa,
              contado_em    = now()
       returning id`,
      [tenantId, inventarioId, dados.peca_id, dados.saldo_contado, dados.justificativa ?? null],
    )
    return r !== null
  }

  async mudarStatusInventario(
    db: Executor,
    id: string,
    status: Inventario['status'],
    motivo: string | null,
  ): Promise<boolean> {
    const r = await db.consultarUm<{ id: string }>(
      `update public.inventario
          set status = $2::app.inventario_status,
              motivo_cancelamento = coalesce($3, motivo_cancelamento),
              version = version + 1
        where id = $1
        returning id`,
      [id, status, motivo],
    )
    return r !== null
  }
}

export function cursorDeOrdem(o: OrdemCompra): Cursor {
  return { criadoEm: o.created_at, id: o.id }
}

export function cursorDeInventario(i: Inventario): Cursor {
  return { criadoEm: i.iniciado_em, id: i.id }
}

function mapearOrdem(l: Record<string, unknown>, itens: Record<string, unknown>[]): OrdemCompra {
  return {
    ...(l as unknown as OrdemCompra),
    aprovado_em: l['aprovado_em'] ? (l['aprovado_em'] as Date).toISOString() : null,
    created_at: (l['created_at'] as Date).toISOString(),
    itens: itens as unknown as OrdemCompra['itens'],
  }
}

function mapearInventario(
  l: Record<string, unknown>,
  contagens: Record<string, unknown>[],
): Inventario {
  return {
    ...(l as unknown as Inventario),
    iniciado_em: (l['iniciado_em'] as Date).toISOString(),
    finalizado_em: l['finalizado_em'] ? (l['finalizado_em'] as Date).toISOString() : null,
    aprovado_em: l['aprovado_em'] ? (l['aprovado_em'] as Date).toISOString() : null,
    contagens: contagens as unknown as Inventario['contagens'],
  }
}
