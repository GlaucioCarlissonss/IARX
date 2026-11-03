import { Injectable } from '@nestjs/common'
import type {
  Alcada,
  ConsultarAuditoria,
  DefinirAlcada,
  ListarAlcadas,
  RegistroAuditoria,
} from '@iarx/contracts'
import { BancoService, type Executor } from '../../banco/banco.service.js'
import { Pagina, codificarCursor, decodificarCursor, type Cursor } from '../../comum/pagina.js'

/**
 * Administração: alçadas e trilha de auditoria.
 *
 * Repositório e serviço no mesmo arquivo porque não há regra entre eles: as
 * alçadas são atributo do par (perfil, tipo), e a trilha é só leitura. Separar
 * em dois arquivos criaria uma camada que apenas repassa.
 */
@Injectable()
export class AdministracaoService {
  constructor(private readonly banco: BancoService) {}

  /* ------------------------------------------------------------ alçadas --- */

  async listarAlcadas(filtro: ListarAlcadas): Promise<Alcada[]> {
    return this.banco.emTransacao((db) => this.consultarAlcadas(db, filtro))
  }

  private async consultarAlcadas(db: Executor, filtro: ListarAlcadas): Promise<Alcada[]> {
    const valores: unknown[] = []
    const clausulas: string[] = []

    if (filtro.perfil_id) {
      valores.push(filtro.perfil_id)
      clausulas.push(`a.perfil_id = $${valores.length}`)
    }
    if (filtro.tipo) {
      valores.push(filtro.tipo)
      clausulas.push(`a.tipo = $${valores.length}`)
    }

    const where = clausulas.length ? `where ${clausulas.join(' and ')}` : ''
    return db.consultar<Alcada & Record<string, unknown>>(
      `select a.id, a.perfil_id, p.nome as perfil_nome, a.tipo,
              a.limite_valor::text      as limite_valor,
              a.limite_percentual::text as limite_percentual
         from public.alcada a
         join public.perfil p on p.id = a.perfil_id
         ${where}
        order by p.nome, a.tipo`,
      valores,
    )
  }

  /**
   * Define a alçada do par (perfil, tipo).
   *
   * `on conflict do update` sobre o índice único da 0002. Os dois limites são
   * escritos sempre, e o não usado vai a nulo de propósito: trocar o tipo de
   * uma alçada deixando o limite antigo gravado produziria uma linha que
   * carrega os dois, e a próxima leitura escolheria o errado.
   */
  async definirAlcada(dados: DefinirAlcada): Promise<Alcada[]> {
    return this.banco.emTransacao(
      async (db) => {
        await db.consultar(
          `insert into public.alcada
             (tenant_id, perfil_id, tipo, limite_valor, limite_percentual, created_by, updated_by)
           values (app.tenant_atual(), $1, $2, $3::numeric, $4::numeric,
                   app.usuario_atual(), app.usuario_atual())
           on conflict (tenant_id, perfil_id, tipo) do update
              set limite_valor      = excluded.limite_valor,
                  limite_percentual = excluded.limite_percentual,
                  updated_at = now(), updated_by = app.usuario_atual()`,
          [dados.perfil_id, dados.tipo, dados.limite_valor ?? null, dados.limite_percentual ?? null],
        )
        return this.consultarAlcadas(db, { perfil_id: dados.perfil_id })
      },
      { motivo: `alçada ${dados.tipo}` },
    )
  }

  /**
   * Remove a alçada.
   *
   * Remover **desliga a regra** para aquele perfil, e a convenção de todas as
   * seis é que alçada ausente não morde. É o oposto do que a palavra "remover"
   * sugere numa tela de permissões, e por isso a operação tem rota própria em
   * vez de ser um `PUT` com limite nulo — ela precisa poder ser explicada.
   */
  async removerAlcada(id: string): Promise<void> {
    await this.banco.emTransacao(
      (db) => db.consultar(`delete from public.alcada where id = $1`, [id]),
      { motivo: 'remoção de alçada' },
    )
  }

  /* ---------------------------------------------------------- auditoria --- */

  /**
   * Consulta da trilha — RN-018.
   *
   * Só leitura. O log é *append-only* e imutável "por qualquer perfil,
   * inclusive administrador": uma rota de escrita aqui negaria a frase que
   * torna a trilha útil.
   */
  async consultarAuditoria(filtro: ConsultarAuditoria): Promise<Pagina<RegistroAuditoria>> {
    return this.banco.emTransacao(async (db) => {
      const valores: unknown[] = []
      const clausulas: string[] = []

      if (filtro.entidade_tipo) {
        valores.push(filtro.entidade_tipo)
        clausulas.push(`a.entidade_tipo = $${valores.length}`)
      }
      if (filtro.entidade_id) {
        valores.push(filtro.entidade_id)
        clausulas.push(`a.entidade_id = $${valores.length}`)
      }
      if (filtro.usuario_id) {
        valores.push(filtro.usuario_id)
        clausulas.push(`a.usuario_id = $${valores.length}`)
      }
      if (filtro.desde) {
        valores.push(filtro.desde)
        clausulas.push(`a.criado_em >= $${valores.length}::timestamptz`)
      }
      if (filtro.ate) {
        valores.push(filtro.ate)
        clausulas.push(`a.criado_em <= $${valores.length}::timestamptz`)
      }

      const cursor = decodificarCursor(filtro.cursor)
      if (cursor) {
        valores.push(cursor.criadoEm, cursor.id)
        clausulas.push(
          `(a.criado_em, a.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
        )
      }

      valores.push(filtro.limit + 1)
      const where = clausulas.length ? `where ${clausulas.join(' and ')}` : ''
      const linhas = await db.consultar<RegistroAuditoria & { criado_em: Date }>(
        `select a.id, a.entidade_tipo, a.entidade_id, a.acao, a.campo,
                a.valor_anterior, a.valor_novo, a.usuario_id, a.perfil_efetivo,
                a.motivo, a.request_id, a.origem, a.criado_em
           from public.audit_log a
           ${where}
          order by a.criado_em desc, a.id desc
          limit $${valores.length}`,
        valores,
      )

      const temMais = linhas.length > filtro.limit
      const pagina = linhas.slice(0, filtro.limit).map((l) => ({
        ...l,
        criado_em: l.criado_em.toISOString(),
      }))
      const ultimo = linhas[filtro.limit - 1]
      return new Pagina(pagina, {
        limit: filtro.limit,
        next_cursor:
          temMais && ultimo ? codificarCursor({ criadoEm: ultimo.criado_em, id: ultimo.id } as Cursor) : null,
      })
    })
  }

  /* ------------------------------------------------- reabrir competência --- */

  /**
   * Reabre a competência (Anexo B §B.6).
   *
   * As duas condições — alçada sobre o valor e nenhuma cobrança aprovada —
   * estão na função do banco, e não são reimplementadas aqui. Devolve quantos
   * consumos foram reabertos; zero significa que não havia nada fechado, que
   * não é erro.
   */
  async reabrirCompetencia(competencia: string, motivo: string): Promise<{ consumos_reabertos: number }> {
    const r = await this.banco.emTransacao(
      (db) =>
        db.consultarUm<{ n: number }>(`select app.reabrir_competencia($1::char(7)) as n`, [
          competencia,
        ]),
      { motivo },
    )
    return { consumos_reabertos: Number(r?.n ?? 0) }
  }
}
