import { Injectable } from '@nestjs/common'
import type {
  DescontoComercial,
  ItemTabelaFranquia,
  ItemTabelaPreco,
  ListarDescontos,
  PoliticaComercial,
  TabelaFranquia,
  TabelaPreco,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'

/**
 * Leitura da política comercial.
 *
 * Como nos demais repositórios: nenhum `where tenant_id`. O isolamento é da
 * RLS, dentro do banco.
 *
 * ## Itens vêm em consulta própria, e são costurados aqui
 *
 * A alternativa seria um `join` e um `json_agg` no banco. Dois motivos para
 * não: uma tabela sem item sumiria do resultado com `join` interno — e tabela
 * em rascunho sem item é exatamente o que se quer ver, para completar —, e o
 * `json_agg` devolveria os números como JSON, onde centavo vira `number` do
 * JavaScript sem passar pelo tipo do Postgres.
 *
 * Duas consultas na mesma transação não correm risco de desencontro: o
 * instantâneo é o mesmo.
 */

interface LinhaItemPreco extends ItemTabelaPreco, Record<string, unknown> {
  tabela_preco_id: string
}

interface LinhaItemFranquia extends ItemTabelaFranquia, Record<string, unknown> {
  tabela_franquia_id: string
}

type LinhaTabelaPreco = Omit<TabelaPreco, 'itens'> & Record<string, unknown>
type LinhaTabelaFranquia = Omit<TabelaFranquia, 'itens'> & Record<string, unknown>

/** Agrupa os itens pela tabela a que pertencem, numa passada só. */
function porTabela<T extends Record<string, unknown>>(itens: T[], chave: string): Map<string, T[]> {
  const mapa = new Map<string, T[]>()
  for (const i of itens) {
    const id = i[chave] as string
    const lista = mapa.get(id)
    if (lista) lista.push(i)
    else mapa.set(id, [i])
  }
  return mapa
}

@Injectable()
export class ComercialRepositorio {
  async politica(db: Executor): Promise<PoliticaComercial> {
    const [precos, itensPreco, franquias, itensFranquia] = await Promise.all([
      db.consultar<LinhaTabelaPreco>(
        `select id, nome, descricao,
                to_char(vigencia_inicio, 'YYYY-MM-DD') as vigencia_inicio,
                to_char(vigencia_fim, 'YYYY-MM-DD')    as vigencia_fim,
                status::text as status, versao, moeda, abrangencia::text as abrangencia,
                cliente_id, contrato_id, indice_reajuste::text as indice_reajuste, meses_reajuste
           from public.tabela_preco
          where deleted_at is null
          order by vigencia_inicio desc, nome`,
      ),
      db.consultar<LinhaItemPreco>(
        `select id, tabela_preco_id, categoria_id, modelo_id, valor_mensal,
                valor_instalacao, valor_retirada, valor_manutencao, prazo_minimo_meses
           from public.tabela_preco_item`,
      ),
      db.consultar<LinhaTabelaFranquia>(
        `select id, nome, descricao,
                to_char(vigencia_inicio, 'YYYY-MM-DD') as vigencia_inicio,
                to_char(vigencia_fim, 'YYYY-MM-DD')    as vigencia_fim,
                status::text as status, versao
           from public.tabela_franquia
          where deleted_at is null
          order by vigencia_inicio desc, nome`,
      ),
      db.consultar<LinhaItemFranquia>(
        `select id, tabela_franquia_id, categoria_id, modelo_id,
                franquia_mono, franquia_color, franquia_escopo::text as franquia_escopo,
                valor_pagina_mono, valor_pagina_color,
                valor_excedente_mono, valor_excedente_color,
                permite_acumulo, meses_acumulo
           from public.tabela_franquia_item
          where ativa`,
      ),
    ])

    const ip = porTabela(itensPreco, 'tabela_preco_id')
    const if_ = porTabela(itensFranquia, 'tabela_franquia_id')

    return {
      tabelas_preco: precos.map((t) => ({ ...t, itens: ip.get(t.id) ?? [] })) as TabelaPreco[],
      tabelas_franquia: franquias.map((t) => ({ ...t, itens: if_.get(t.id) ?? [] })) as TabelaFranquia[],
    }
  }

  async descontos(db: Executor, filtro: ListarDescontos): Promise<DescontoComercial[]> {
    const valores: unknown[] = []
    let onde = 'deleted_at is null'
    if (filtro.contrato_id) {
      valores.push(filtro.contrato_id)
      onde += ` and contrato_id = $${valores.length}`
    }

    return db.consultar<DescontoComercial & Record<string, unknown>>(
      `select id, contrato_id, contrato_item_id, tipo::text as tipo, percentual, valor,
              to_char(vigencia_inicio, 'YYYY-MM-DD') as vigencia_inicio,
              to_char(vigencia_fim, 'YYYY-MM-DD')    as vigencia_fim,
              motivo, aprovado_por,
              to_char(aprovado_em, 'YYYY-MM-DD"T"HH24:MI:SSOF') as aprovado_em
         from public.desconto_comercial
        where ${onde}
        order by vigencia_inicio desc`,
      valores,
    )
  }
}
