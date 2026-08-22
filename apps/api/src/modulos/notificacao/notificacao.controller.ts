import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { Paginacao } from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { EscopoProprio } from '../../comum/decoradores.js'
import { Pagina, codificarCursor, decodificarCursor } from '../../comum/pagina.js'
import { exigirClaims } from '../../comum/contexto.js'
import { validar } from '../../comum/zod.pipe.js'

export const ListarCaixa = Paginacao.extend({
  /** Só o que ainda não foi lido — o padrão de quem abre a caixa. */
  nao_lidas: z.coerce.boolean().optional(),
})
export type ListarCaixa = z.infer<typeof ListarCaixa>

interface LinhaCaixa extends Record<string, unknown> {
  id: string
  assunto: string
  corpo_texto: string
  lida_em: Date | null
  created_at: Date
}

/**
 * `NOT` — caixa interna do usuário.
 *
 * `@EscopoProprio()` e não uma permissão de catálogo: a caixa é do dono, e
 * amarrá-la a uma permissão criaria a situação absurda de um perfil incapaz de
 * ler os próprios avisos. A consulta filtra por `app.usuario_atual()` dentro do
 * SQL, nunca por um id vindo da URL — o decorador dispensa a checagem de
 * catálogo, não a de identidade.
 *
 * Não existe rota para ler a caixa de outra pessoa. Se ela existisse, seria a
 * primeira coisa que um administrador curioso usaria para ler avisos de
 * aprovação alheios — que carregam valor, fornecedor e justificativa.
 */
@Controller('api/v1/notificacoes')
export class NotificacaoController {
  constructor(private readonly banco: BancoService) {}

  @Get()
  @EscopoProprio()
  async minhas(@Query(validar(ListarCaixa)) filtro: ListarCaixa): Promise<Pagina<unknown>> {
    const claims = exigirClaims()

    return this.banco.emTransacao(async (db) => {
      const valores: unknown[] = [claims.usuario_id]
      const clausulas = ["n.canal = 'IN_APP'", 'n.usuario_id = $1']

      if (filtro.nao_lidas) clausulas.push('n.lida_em is null')

      const cursor = decodificarCursor(filtro.cursor)
      if (cursor) {
        valores.push(cursor.criadoEm, cursor.id)
        clausulas.push(
          `(n.created_at, n.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
        )
      }

      valores.push(filtro.limit + 1)
      const linhas = await db.consultar<LinhaCaixa>(
        `select n.id, n.assunto, n.corpo_texto, n.lida_em, n.created_at
           from public.notificacao n
          where ${clausulas.join(' and ')}
          order by n.created_at desc, n.id desc
          limit $${valores.length}`,
        valores,
      )

      const pagina = linhas.slice(0, filtro.limit)
      const ultimo = pagina[pagina.length - 1]
      return new Pagina(
        pagina.map((n) => ({
          id: n.id,
          assunto: n.assunto,
          texto: n.corpo_texto,
          lida_em: n.lida_em ? n.lida_em.toISOString() : null,
          created_at: n.created_at.toISOString(),
        })),
        {
          limit: filtro.limit,
          next_cursor:
            linhas.length > filtro.limit && ultimo
              ? codificarCursor({ criadoEm: ultimo.created_at.toISOString(), id: ultimo.id })
              : null,
        },
      )
    })
  }

  /**
   * Marcar como lida é idempotente por construção.
   *
   * A função do banco usa `coalesce(lida_em, now())`: chamar duas vezes não
   * move a data. Sem isso, um duplo clique reescreveria o instante da leitura, e
   * "quando a pessoa viu" passaria a significar "quando ela clicou por último".
   */
  @Post(':id/lida')
  @HttpCode(200)
  @EscopoProprio()
  async marcarLida(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<{ ok: true }> {
    await this.banco.emTransacao((db) => db.consultar(`select app.notificacao_marcar_lida($1)`, [id]))
    return { ok: true }
  }
}
