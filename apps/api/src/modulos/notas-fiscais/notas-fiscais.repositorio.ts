import { Injectable } from '@nestjs/common'
import type {
  CriarNotaFiscal,
  DefinirSeries,
  Fornecedor,
  NotaFiscal,
  NotaFiscalItem,
  NotaFiscalSerie,
  ListarNotasFiscais,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor } from '../../comum/pagina.js'

/**
 * `custo_aquisicao` é coluna gerada — lida, nunca escrita. É a garantia de que
 * o relatório de imobilizado, o rateio e esta API leem o mesmo número.
 */
const SELECT_NOTA = `
  select n.id, n.fornecedor_id, f.razao_social as fornecedor_nome, n.filial_destino_id,
         n.numero, n.serie, n.chave_acesso, n.modelo_documento,
         to_char(n.data_emissao, 'YYYY-MM-DD') as data_emissao,
         to_char(n.data_entrada, 'YYYY-MM-DD') as data_entrada,
         n.valor_produtos::text, n.valor_frete::text, n.valor_seguro::text,
         n.valor_outras_despesas::text, n.valor_desconto::text, n.valor_ipi::text,
         n.valor_icms::text, n.valor_icms_st::text, n.valor_total::text,
         n.icms_recuperavel, n.ipi_recuperavel, n.custo_aquisicao::text,
         n.status, n.origem_dados, n.observacao,
         n.conferida_em, n.integrada_em, n.cancelada_em, n.motivo_cancelamento, n.version
    from public.nota_fiscal_compra n
    join public.fornecedor f on f.id = n.fornecedor_id
`

interface LinhaNota extends Record<string, unknown> {
  id: string
  fornecedor_id: string
  fornecedor_nome: string | null
  filial_destino_id: string
  numero: string
  serie: string
  chave_acesso: string | null
  modelo_documento: string
  data_emissao: string
  data_entrada: string
  valor_produtos: string
  valor_frete: string
  valor_seguro: string
  valor_outras_despesas: string
  valor_desconto: string
  valor_ipi: string
  valor_icms: string
  valor_icms_st: string
  valor_total: string
  icms_recuperavel: boolean
  ipi_recuperavel: boolean
  custo_aquisicao: string
  status: NotaFiscal['status']
  origem_dados: 'MANUAL' | 'XML'
  observacao: string | null
  conferida_em: Date | null
  integrada_em: Date | null
  cancelada_em: Date | null
  motivo_cancelamento: string | null
  version: number
}

@Injectable()
export class NotasFiscaisRepositorio {
  async listar(db: Executor, filtro: ListarNotasFiscais): Promise<{ linhas: NotaFiscal[]; temMais: boolean }> {
    const clausulas = ['n.deleted_at is null']
    const valores: unknown[] = []
    const p = () => `$${valores.length}`

    if (filtro.status) {
      valores.push(filtro.status)
      clausulas.push(`n.status = ${p()}::app.nf_status`)
    }
    if (filtro.fornecedor_id) {
      valores.push(filtro.fornecedor_id)
      clausulas.push(`n.fornecedor_id = ${p()}`)
    }
    if (filtro.filial_destino_id) {
      valores.push(filtro.filial_destino_id)
      clausulas.push(`n.filial_destino_id = ${p()}`)
    }
    if (filtro.entrada_de) {
      valores.push(filtro.entrada_de)
      clausulas.push(`n.data_entrada >= ${p()}::date`)
    }
    if (filtro.entrada_ate) {
      valores.push(filtro.entrada_ate)
      clausulas.push(`n.data_entrada <= ${p()}::date`)
    }
    if (filtro.q) {
      valores.push(`${filtro.q}%`)
      clausulas.push(`n.numero like ${p()}`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(`(n.created_at, n.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`)
    }

    valores.push(filtro.limit + 1)
    const linhas = await db.consultar<LinhaNota>(
      `${SELECT_NOTA} where ${clausulas.join(' and ')}
       order by n.created_at desc, n.id desc limit $${valores.length}`,
      valores,
    )
    const temMais = linhas.length > filtro.limit
    return { linhas: linhas.slice(0, filtro.limit).map(mapearNota), temMais }
  }

  async porId(db: Executor, id: string): Promise<NotaFiscal | null> {
    const l = await db.consultarUm<LinhaNota>(`${SELECT_NOTA} where n.id = $1 and n.deleted_at is null`, [id])
    return l ? mapearNota(l) : null
  }

  async criadoEm(db: Executor, id: string): Promise<string | null> {
    const l = await db.consultarUm<{ created_at: Date }>(
      `select created_at from public.nota_fiscal_compra where id = $1`,
      [id],
    )
    return l ? l.created_at.toISOString() : null
  }

  async itens(db: Executor, notaId: string): Promise<NotaFiscalItem[]> {
    const linhas = await db.consultar<Record<string, unknown>>(
      `select i.id, i.numero_item, i.modelo_id, i.descricao_nf, i.codigo_fornecedor,
              i.ncm, i.cfop, i.unidade, i.quantidade,
              i.valor_unitario::text, i.valor_total_item::text,
              i.garantia_meses, to_char(i.garantia_ate, 'YYYY-MM-DD') as garantia_ate,
              coalesce(
                (select json_agg(json_build_object(
                          'id', s.id, 'numero_serie', s.numero_serie,
                          'patrimonio', s.patrimonio, 'equipamento_id', s.equipamento_id)
                        order by s.patrimonio)
                   from public.nota_fiscal_item_serie s
                  where s.nota_fiscal_item_id = i.id),
                '[]'::json) as series
         from public.nota_fiscal_item i
        where i.nota_fiscal_id = $1
        order by i.numero_item`,
      [notaId],
    )
    return linhas.map((l) => ({
      id: l.id as string,
      numero_item: l.numero_item as number,
      modelo_id: l.modelo_id as string,
      descricao_nf: l.descricao_nf as string,
      codigo_fornecedor: (l.codigo_fornecedor as string | null) ?? null,
      ncm: (l.ncm as string | null) ?? null,
      cfop: (l.cfop as string | null) ?? null,
      unidade: l.unidade as string,
      quantidade: l.quantidade as number,
      valor_unitario: l.valor_unitario as NotaFiscalItem['valor_unitario'],
      valor_total_item: l.valor_total_item as NotaFiscalItem['valor_total_item'],
      garantia_meses: (l.garantia_meses as number | null) ?? null,
      garantia_ate: (l.garantia_ate as string | null) ?? null,
      series: l.series as NotaFiscalSerie[],
    }))
  }

  /**
   * Insere cabeçalho e itens.
   *
   * `numero_item` é atribuído pela ordem do payload, não recebido do cliente:
   * a numeração é do documento, e aceitá-la do corpo permitiria uma nota com
   * dois itens 1 — que o índice único recusaria depois, com mensagem pior.
   */
  async inserir(db: Executor, dto: CriarNotaFiscal): Promise<string> {
    const nota = await db.consultarUm<{ id: string }>(
      `insert into public.nota_fiscal_compra (
         tenant_id, fornecedor_id, filial_destino_id, numero, serie, chave_acesso,
         modelo_documento, data_emissao, data_entrada,
         valor_produtos, valor_frete, valor_seguro, valor_outras_despesas, valor_desconto,
         valor_ipi, valor_icms, valor_icms_st, valor_total,
         icms_recuperavel, ipi_recuperavel, origem_dados, observacao,
         created_by, updated_by
       ) values (
         app.exigir_tenant(), $1, $2, $3, $4, $5,
         $6, $7::date, $8::date,
         $9::numeric, $10::numeric, $11::numeric, $12::numeric, $13::numeric,
         $14::numeric, $15::numeric, $16::numeric, $17::numeric,
         $18, $19, $20, $21,
         app.usuario_atual(), app.usuario_atual()
       ) returning id`,
      [
        dto.fornecedor_id,
        dto.filial_destino_id,
        dto.numero,
        dto.serie,
        dto.chave_acesso,
        dto.modelo_documento,
        dto.data_emissao,
        dto.data_entrada,
        dto.valor_produtos,
        dto.valor_frete,
        dto.valor_seguro,
        dto.valor_outras_despesas,
        dto.valor_desconto,
        dto.valor_ipi,
        dto.valor_icms,
        dto.valor_icms_st,
        dto.valor_total,
        dto.icms_recuperavel,
        dto.ipi_recuperavel,
        dto.origem_dados,
        dto.observacao,
      ],
    )
    if (!nota) throw new Error('insert de nota_fiscal_compra não retornou linha')

    for (const [i, item] of dto.itens.entries()) {
      await db.consultar(
        `insert into public.nota_fiscal_item (
           tenant_id, nota_fiscal_id, numero_item, modelo_id, descricao_nf,
           codigo_fornecedor, ncm, cfop, unidade, quantidade,
           valor_unitario, valor_total_item, garantia_meses, created_by, updated_by
         ) values (
           app.exigir_tenant(), $1, $2, $3, $4,
           $5, $6, $7, $8, $9,
           $10::numeric, $11::numeric, $12, app.usuario_atual(), app.usuario_atual()
         )`,
        [
          nota.id,
          i + 1,
          item.modelo_id,
          item.descricao_nf,
          item.codigo_fornecedor,
          item.ncm,
          item.cfop,
          item.unidade,
          item.quantidade,
          item.valor_unitario,
          item.valor_total_item,
          item.garantia_meses,
        ],
      )
    }

    return nota.id
  }

  async itemPorId(
    db: Executor,
    notaId: string,
    itemId: string,
  ): Promise<{ id: string; numero_item: number; quantidade: number; descricao_nf: string } | null> {
    return db.consultarUm(
      `select id, numero_item, quantidade, descricao_nf
         from public.nota_fiscal_item
        where id = $1 and nota_fiscal_id = $2`,
      [itemId, notaId],
    )
  }

  /**
   * Substitui o conjunto de unidades do item.
   *
   * Substitui, e não acrescenta: a tela edita uma grade de `quantidade` linhas,
   * e um comando aditivo tornaria impossível corrigir uma leitura de código de
   * barras errada. O DELETE e os INSERTs ficam na mesma transação — em caso de
   * falha, o item volta ao conjunto anterior, e não fica vazio.
   */
  async substituirSeries(db: Executor, itemId: string, dto: DefinirSeries): Promise<void> {
    await db.consultar(`delete from public.nota_fiscal_item_serie where nota_fiscal_item_id = $1`, [itemId])
    for (const u of dto.unidades) {
      await db.consultar(
        `insert into public.nota_fiscal_item_serie (
           tenant_id, nota_fiscal_item_id, numero_serie, patrimonio, created_by, updated_by
         ) values (app.exigir_tenant(), $1, $2, $3, app.usuario_atual(), app.usuario_atual())`,
        [itemId, u.numero_serie.trim(), u.patrimonio.trim()],
      )
    }
  }

  /** Itens com contagem de unidades divergente da quantidade (RN-L02). */
  async itensIncompletos(
    db: Executor,
    notaId: string,
  ): Promise<{ numero_item: number; descricao_nf: string; quantidade: number; informadas: number }[]> {
    return db.consultar(
      `select i.numero_item, i.descricao_nf, i.quantidade,
              (select count(*)::int from public.nota_fiscal_item_serie s
                where s.nota_fiscal_item_id = i.id) as informadas
         from public.nota_fiscal_item i
        where i.nota_fiscal_id = $1
          and (select count(*) from public.nota_fiscal_item_serie s
                where s.nota_fiscal_item_id = i.id) <> i.quantidade
        order by i.numero_item`,
      [notaId],
    )
  }

  /** Quem lançou a nota — insumo da segregação de funções (RN-027). */
  async autorDoLancamento(db: Executor, notaId: string): Promise<string | null> {
    const l = await db.consultarUm<{ created_by: string | null }>(
      `select created_by from public.nota_fiscal_compra where id = $1`,
      [notaId],
    )
    return l?.created_by ?? null
  }

  async marcarConferida(db: Executor, notaId: string): Promise<void> {
    await db.consultar(
      `update public.nota_fiscal_compra
          set status = 'CONFERIDA', conferida_em = now(), conferida_por = app.usuario_atual(),
              updated_by = app.usuario_atual(), version = version + 1
        where id = $1`,
      [notaId],
    )
  }

  async marcarCancelada(db: Executor, notaId: string, motivo: string): Promise<void> {
    await db.consultar(
      `update public.nota_fiscal_compra
          set status = 'CANCELADA', cancelada_em = now(), cancelada_por = app.usuario_atual(),
              motivo_cancelamento = $2, updated_by = app.usuario_atual(), version = version + 1
        where id = $1`,
      [notaId, motivo],
    )
  }

  /**
   * Rateio, direto do banco.
   *
   * A função `app.ratear_custo_nota` é a fonte: o relatório de imobilizado lê o
   * mesmo número que a integração grava. Reimplementar aqui criaria duas
   * verdades sobre o custo do ativo, e a divergência só apareceria numa
   * conciliação.
   */
  async rateio(
    db: Executor,
    notaId: string,
  ): Promise<
    {
      nota_fiscal_item_serie_id: string
      numero_item: number
      patrimonio: string
      numero_serie: string
      modelo_id: string
      valor_aquisicao: string
      garantia_ate: string | null
    }[]
  > {
    return db.consultar(
      `select nota_fiscal_item_serie_id, numero_item, patrimonio, numero_serie, modelo_id,
              valor_aquisicao::text,
              to_char(garantia_ate, 'YYYY-MM-DD') as garantia_ate
         from app.ratear_custo_nota($1)`,
      [notaId],
    )
  }

  /**
   * Cria um ativo a partir de uma unidade da nota.
   *
   * O vínculo `equipamento_id` na série é gravado **antes** da transição a
   * `INTEGRADA` — depois dela o gatilho recusaria a escrita. A ordem não é
   * convenção: é imposta pelo banco.
   */
  async criarEquipamento(
    db: Executor,
    notaId: string,
    unidade: {
      nota_fiscal_item_serie_id: string
      patrimonio: string
      numero_serie: string
      modelo_id: string
      valor_aquisicao: string
      garantia_ate: string | null
    },
  ): Promise<{ id: string; patrimonio: string; numero_serie: string }> {
    const criado = await db.consultarUm<{ id: string }>(
      `insert into public.equipamento (
         tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id,
         status, data_aquisicao, valor_aquisicao, garantia_ate,
         nota_fiscal_item_serie_id, created_by, updated_by
       )
       select app.exigir_tenant(), $2, $3, m.id, m.categoria_id, n.filial_destino_id,
              -- RN-L07: nasce disponível, sem contrato. Alocar é decisão
              -- comercial, não consequência da compra.
              'DISPONIVEL', n.data_entrada, $4::numeric, $5::date,
              $6, app.usuario_atual(), app.usuario_atual()
         from public.nota_fiscal_compra n
         join public.modelo m on m.id = $7
        where n.id = $1
       returning id`,
      [
        notaId,
        unidade.patrimonio,
        unidade.numero_serie,
        unidade.valor_aquisicao,
        unidade.garantia_ate,
        unidade.nota_fiscal_item_serie_id,
        unidade.modelo_id,
      ],
    )
    if (!criado) throw new Error('insert de equipamento não retornou linha')

    await db.consultar(`update public.nota_fiscal_item_serie set equipamento_id = $2 where id = $1`, [
      unidade.nota_fiscal_item_serie_id,
      criado.id,
    ])

    return { id: criado.id, patrimonio: unidade.patrimonio, numero_serie: unidade.numero_serie }
  }

  async marcarIntegrada(db: Executor, notaId: string): Promise<void> {
    await db.consultar(
      `update public.nota_fiscal_compra
          set status = 'INTEGRADA', integrada_em = now(), integrada_por = app.usuario_atual(),
              updated_by = app.usuario_atual(), version = version + 1
        where id = $1`,
      [notaId],
    )
  }

  async fornecedores(db: Executor): Promise<Fornecedor[]> {
    return db.consultar<Fornecedor & Record<string, unknown>>(
      `select id, documento, razao_social, nome_fantasia, uf, inscricao_estadual, ativo
         from public.fornecedor
        where deleted_at is null
        order by razao_social`,
    )
  }

  async fornecedorPorId(db: Executor, id: string): Promise<Fornecedor | null> {
    return db.consultarUm<Fornecedor & Record<string, unknown>>(
      `select id, documento, razao_social, nome_fantasia, uf, inscricao_estadual, ativo
         from public.fornecedor where id = $1 and deleted_at is null`,
      [id],
    )
  }

  /** Conflito de série ou patrimônio contra o parque — para explicar a recusa. */
  async ativoComEtiqueta(
    db: Executor,
    numeroSerie: string,
    patrimonio: string,
  ): Promise<{ patrimonio: string; numero_serie: string | null; qual: string } | null> {
    return db.consultarUm(
      `select e.patrimonio, e.numero_serie,
              case when upper(e.patrimonio) = upper($2) then 'patrimonio' else 'numero_serie' end as qual
         from public.equipamento e
        where e.deleted_at is null
          and (upper(e.patrimonio) = upper($2)
               or (e.numero_serie is not null and upper(e.numero_serie) = upper($1)))
        limit 1`,
      [numeroSerie, patrimonio],
    )
  }
}

function mapearNota(l: LinhaNota): NotaFiscal {
  return {
    id: l.id,
    fornecedor_id: l.fornecedor_id,
    fornecedor_nome: l.fornecedor_nome,
    filial_destino_id: l.filial_destino_id,
    numero: l.numero,
    serie: l.serie,
    // char(44) volta com padding se a coluna estiver curta; aparar aqui evita
    // que o cliente compare a chave com espaços no fim.
    chave_acesso: l.chave_acesso ? l.chave_acesso.trim() : null,
    modelo_documento: l.modelo_documento,
    data_emissao: l.data_emissao,
    data_entrada: l.data_entrada,
    valor_produtos: l.valor_produtos as NotaFiscal['valor_produtos'],
    valor_frete: l.valor_frete as NotaFiscal['valor_frete'],
    valor_seguro: l.valor_seguro as NotaFiscal['valor_seguro'],
    valor_outras_despesas: l.valor_outras_despesas as NotaFiscal['valor_outras_despesas'],
    valor_desconto: l.valor_desconto as NotaFiscal['valor_desconto'],
    valor_ipi: l.valor_ipi as NotaFiscal['valor_ipi'],
    valor_icms: l.valor_icms as NotaFiscal['valor_icms'],
    valor_icms_st: l.valor_icms_st as NotaFiscal['valor_icms_st'],
    valor_total: l.valor_total as NotaFiscal['valor_total'],
    icms_recuperavel: l.icms_recuperavel,
    ipi_recuperavel: l.ipi_recuperavel,
    custo_aquisicao: l.custo_aquisicao as NotaFiscal['custo_aquisicao'],
    status: l.status,
    origem_dados: l.origem_dados,
    observacao: l.observacao,
    conferida_em: l.conferida_em ? l.conferida_em.toISOString() : null,
    integrada_em: l.integrada_em ? l.integrada_em.toISOString() : null,
    cancelada_em: l.cancelada_em ? l.cancelada_em.toISOString() : null,
    motivo_cancelamento: l.motivo_cancelamento,
    version: l.version,
  }
}
