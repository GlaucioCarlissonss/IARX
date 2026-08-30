import { Injectable } from '@nestjs/common'
import type { CriarEquipamento, Equipamento, ListarEquipamentos } from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor, type Cursor } from '../../comum/pagina.js'

/**
 * Acesso a dados de equipamento.
 *
 * Duas coisas que este arquivo **não** faz, e a ausência é intencional:
 *
 *  - não filtra por `tenant_id`. A cláusula existe, mas quem a aplica é a RLS,
 *    dentro do banco. Escrevê-la aqui daria a impressão de que o isolamento
 *    depende do SQL estar certo — e um `where` esquecido em uma consulta nova
 *    passaria despercebido. Com RLS, esquecer não vaza nada;
 *
 *  - não concatena valor nenhum no SQL. Todo filtro entra como parâmetro
 *    numerado, montado pelo acumulador abaixo.
 */

const SELECT_BASE = `
  select e.id, e.patrimonio, e.numero_serie, e.modelo_id, m.nome as modelo_nome,
         f.nome as fabricante_nome, e.categoria_id, e.filial_id, e.status,
         e.motivo_indisponibilidade, e.bloqueado, e.bloqueio_motivo, e.bloqueio_ate,
         e.valor_aquisicao::text as valor_aquisicao, e.created_at, e.version
    from public.equipamento e
    join public.modelo m     on m.id = e.modelo_id
    join public.fabricante f on f.id = m.fabricante_id
`

interface LinhaEquipamento {
  id: string
  patrimonio: string
  numero_serie: string | null
  modelo_id: string
  modelo_nome: string | null
  fabricante_nome: string | null
  categoria_id: string
  filial_id: string
  status: Equipamento['status']
  motivo_indisponibilidade: string | null
  bloqueado: boolean
  bloqueio_motivo: string | null
  bloqueio_ate: Date | null
  valor_aquisicao: string | null
  created_at: Date
  version: number
}

/** Acumulador de cláusulas com parâmetros numerados. */
class Filtros {
  private readonly clausulas: string[] = []
  readonly valores: unknown[] = []

  adicionar(molde: (p: string) => string, valor: unknown): void {
    this.valores.push(valor)
    this.clausulas.push(molde(`$${this.valores.length}`))
  }

  adicionarSemValor(clausula: string): void {
    this.clausulas.push(clausula)
  }

  get where(): string {
    return this.clausulas.length ? `where ${this.clausulas.join(' and ')}` : ''
  }
}

@Injectable()
export class EquipamentosRepositorio {
  async listar(db: Executor, filtro: ListarEquipamentos): Promise<{ linhas: Equipamento[]; temMais: boolean }> {
    const f = new Filtros()
    f.adicionarSemValor('e.deleted_at is null')

    if (filtro.status) f.adicionar((p) => `e.status = ${p}::app.equipamento_status`, filtro.status)
    if (filtro.filial_id) f.adicionar((p) => `e.filial_id = ${p}`, filtro.filial_id)
    if (filtro.categoria_id) f.adicionar((p) => `e.categoria_id = ${p}`, filtro.categoria_id)
    if (filtro.bloqueado !== undefined) f.adicionar((p) => `e.bloqueado = ${p}`, filtro.bloqueado)

    if (filtro.q) {
      // Prefixo em vez de `%termo%`: o operador digita o começo do patrimônio ou
      // da série, e prefixo usa índice. Busca infixa em coluna grande é varredura.
      f.adicionar(
        (p) => `(e.patrimonio like ${p} or upper(e.numero_serie) like upper(${p}))`,
        `${filtro.q}%`,
      )
    }

    if (filtro.livre_em) {
      // "Livre no instante X": nenhum item de contrato em estado ocupante cuja
      // vigência contenha X. O predicado espelha o da exclusion constraint —
      // perguntar "está livre?" e "posso alocar?" precisam ter a mesma resposta.
      f.adicionar(
        (p) => `not exists (
          select 1 from public.contrato_item ci
           where ci.equipamento_id = e.id
             and ci.deleted_at is null
             and ci.status in ('RESERVADO','EM_ENTREGA','ATIVO','SUSPENSO','EM_DEVOLUCAO')
             and ci.vigencia @> ${p}::timestamptz
        )`,
        filtro.livre_em,
      )
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      // Keyset por (created_at, id): o id desempata para a ordem ser total, sem
      // o que duas linhas do mesmo instante podem repetir ou sumir entre páginas.
      f.valores.push(cursor.criadoEm, cursor.id)
      const a = `$${f.valores.length - 1}`
      const b = `$${f.valores.length}`
      f.adicionarSemValor(`(e.created_at, e.id) < (${a}::timestamptz, ${b}::uuid)`)
    }

    // Busca limit+1 para saber se há próxima página sem um count() adicional.
    f.valores.push(filtro.limit + 1)
    const sql = `${SELECT_BASE} ${f.where} order by e.created_at desc, e.id desc limit $${f.valores.length}`

    const linhas = await db.consultar<LinhaEquipamento & Record<string, unknown>>(sql, f.valores)
    const temMais = linhas.length > filtro.limit
    return { linhas: linhas.slice(0, filtro.limit).map(mapear), temMais }
  }

  async porId(db: Executor, id: string): Promise<Equipamento | null> {
    const linha = await db.consultarUm<LinhaEquipamento & Record<string, unknown>>(
      `${SELECT_BASE} where e.id = $1 and e.deleted_at is null`,
      [id],
    )
    return linha ? mapear(linha) : null
  }

  async criar(db: Executor, tenantId: string, dados: CriarEquipamento): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.equipamento
         (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id, ano_fabricacao)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        tenantId,
        dados.patrimonio,
        dados.numero_serie ?? null,
        dados.modelo_id,
        dados.categoria_id,
        dados.filial_id,
        dados.ano_fabricacao ?? null,
      ],
    )
    return (l as { id: string }).id
  }

  /**
   * Bloqueia o ativo. `version` no WHERE é bloqueio otimista: se outra
   * requisição alterou a linha entre a leitura e esta escrita, zero linhas são
   * afetadas e o serviço devolve 409 em vez de sobrescrever silenciosamente.
   */
  async bloquear(
    db: Executor,
    id: string,
    version: number,
    motivo: string,
    ate: string | null,
  ): Promise<Equipamento | null> {
    const r = await db.consultarUm<{ id: string }>(
      `update public.equipamento
          set bloqueado = true, bloqueio_motivo = $3, bloqueio_ate = $4,
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and version = $2 and deleted_at is null
        returning id`,
      [id, version, motivo, ate],
    )
    return r ? this.porId(db, id) : null
  }

  async desbloquear(db: Executor, id: string, version: number): Promise<Equipamento | null> {
    const r = await db.consultarUm<{ id: string }>(
      `update public.equipamento
          set bloqueado = false, bloqueio_motivo = null, bloqueio_ate = null,
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and version = $2 and deleted_at is null
        returning id`,
      [id, version],
    )
    return r ? this.porId(db, id) : null
  }

  async existe(db: Executor, id: string): Promise<boolean> {
    const r = await db.consultarUm<{ um: number }>(
      `select 1 as um from public.equipamento where id = $1 and deleted_at is null`,
      [id],
    )
    return r !== null
  }
}

export function cursorDe(e: Equipamento): Cursor {
  return { criadoEm: e.created_at, id: e.id }
}

function mapear(l: LinhaEquipamento): Equipamento {
  return {
    id: l.id,
    patrimonio: l.patrimonio,
    numero_serie: l.numero_serie,
    modelo_id: l.modelo_id,
    modelo_nome: l.modelo_nome,
    fabricante_nome: l.fabricante_nome,
    categoria_id: l.categoria_id,
    filial_id: l.filial_id,
    status: l.status,
    motivo_indisponibilidade: l.motivo_indisponibilidade,
    bloqueado: l.bloqueado,
    bloqueio_motivo: l.bloqueio_motivo,
    bloqueio_ate: l.bloqueio_ate ? l.bloqueio_ate.toISOString() : null,
    valor_aquisicao: l.valor_aquisicao as Equipamento['valor_aquisicao'],
    created_at: l.created_at.toISOString(),
    version: l.version,
  }
}
