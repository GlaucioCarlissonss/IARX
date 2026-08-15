import { Injectable } from '@nestjs/common'
import type { DefinirLocalizacao, ListarLocais, LocalOperacao } from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor } from '../../comum/pagina.js'

/**
 * Acesso a dados de local de operação.
 *
 * Como nos demais repositórios: nenhum `where tenant_id`. O isolamento é da
 * RLS, dentro do banco — escrevê-lo aqui daria a impressão de que depende do
 * SQL estar certo, e um filtro esquecido numa consulta nova passaria batido.
 *
 * A coordenada sai como duas colunas, `lat` e `lon`, e não como GeoJSON. É o
 * que o mapa consome e o que o contrato declara; converter para um formato
 * intermediário só criaria mais um lugar onde os eixos podem trocar de posição.
 */
const SELECT_BASE = `
  select l.id, l.cliente_id, l.nome,
         st_y(l.geo::geometry) as lat,
         st_x(l.geo::geometry) as lon,
         l.geo_precisao, l.geo_fonte, l.geo_atualizado_em,
         l.created_at
    from public.local_operacao l
`

interface LinhaLocal extends Record<string, unknown> {
  id: string
  cliente_id: string
  nome: string
  lat: number | null
  lon: number | null
  geo_precisao: LocalOperacao['geo_precisao']
  geo_fonte: string | null
  geo_atualizado_em: Date | null
  created_at: Date
}

function mapear(l: LinhaLocal): LocalOperacao {
  return {
    id: l.id,
    cliente_id: l.cliente_id,
    nome: l.nome,
    lat: l.lat,
    lon: l.lon,
    geo_precisao: l.geo_precisao,
    geo_fonte: l.geo_fonte,
    geo_atualizado_em: l.geo_atualizado_em ? l.geo_atualizado_em.toISOString() : null,
  }
}

export const cursorDe = (l: LinhaLocal) => ({ criadoEm: l.created_at.toISOString(), id: l.id })

@Injectable()
export class LocaisRepositorio {
  async listar(db: Executor, filtro: ListarLocais): Promise<{ linhas: LinhaLocal[]; temMais: boolean }> {
    const clausulas = ['l.deleted_at is null']
    const valores: unknown[] = []

    if (filtro.cliente_id) {
      valores.push(filtro.cliente_id)
      clausulas.push(`l.cliente_id = $${valores.length}`)
    }
    // A fila de trabalho do mapa: local sem coordenada não aparece no mapa, o
    // que na prática é o mesmo que não existir para quem planeja rota.
    if (filtro.sem_coordenada) clausulas.push('l.geo is null')

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      const a = `$${valores.length - 1}`
      const b = `$${valores.length}`
      clausulas.push(`(l.created_at, l.id) < (${a}::timestamptz, ${b}::uuid)`)
    }

    valores.push(filtro.limit + 1)
    const sql = `${SELECT_BASE} where ${clausulas.join(' and ')}
      order by l.created_at desc, l.id desc limit $${valores.length}`

    const linhas = await db.consultar<LinhaLocal>(sql, valores)
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async porId(db: Executor, id: string): Promise<LocalOperacao | null> {
    const l = await db.consultarUm<LinhaLocal>(`${SELECT_BASE} where l.id = $1 and l.deleted_at is null`, [id])
    return l ? mapear(l) : null
  }

  /**
   * Grava a coordenada pela função do banco.
   *
   * Chamar `app.definir_geo_local` em vez de montar o `update` aqui não é
   * cerimônia: é o que garante que a API, uma importação em massa e qualquer
   * job futuro passem pelas mesmas checagens — proveniência obrigatória, eixo
   * conferido e carimbo de atualização. Regra replicada em cada chamador é
   * regra que um dos chamadores vai esquecer.
   */
  async definirLocalizacao(db: Executor, id: string, dados: DefinirLocalizacao): Promise<LocalOperacao | null> {
    await db.consultarUm(`select app.definir_geo_local($1, $2, $3, $4, $5)`, [
      id,
      dados.lat,
      dados.lon,
      dados.precisao,
      dados.fonte,
    ])
    return this.porId(db, id)
  }
}

export { mapear as mapearLocal }
