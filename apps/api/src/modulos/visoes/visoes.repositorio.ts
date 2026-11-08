import { Injectable } from '@nestjs/common'
import type { ConsultaDaVisao, CriarVisao, EditarVisao, TelaComVisao, VisaoSalva } from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'

/**
 * Acesso às visões salvas.
 *
 * Sem `where tenant_id` e sem `where dono_id`: quem isola as duas coisas é a
 * política da 0038, que mostra a compartilhada a todos e a pessoal só a quem a
 * criou. Repetir o filtro aqui daria a impressão de que o isolamento é desta
 * camada — e no dia em que alguém escrevesse uma consulta nova sem lembrar
 * dele, a falha seria silenciosa.
 */

const SELECT_BASE = `
  select v.id, v.tela, v.nome, v.consulta, v.compartilhada,
         v.dono_id, u.nome as dono_nome,
         (v.dono_id = app.usuario_atual()) as minha,
         v.ordem, v.version, v.created_at, v.updated_at
    from public.visao_salva v
    left join public.usuario u on u.id = v.dono_id
`

interface LinhaVisao {
  id: string
  tela: TelaComVisao
  nome: string
  consulta: ConsultaDaVisao
  compartilhada: boolean
  dono_id: string
  dono_nome: string | null
  minha: boolean
  ordem: number
  version: number
  created_at: Date
  updated_at: Date
}

function montar(l: LinhaVisao): VisaoSalva {
  return {
    ...l,
    created_at: l.created_at.toISOString(),
    updated_at: l.updated_at.toISOString(),
  }
}

@Injectable()
export class VisoesRepositorio {
  /**
   * As visões de uma tela.
   *
   * Compartilhadas primeiro, e dentro de cada grupo pela ordem e pelo nome. A
   * faixa é lida da esquerda para a direita e o que a equipe combinou vem
   * antes do que cada um guardou para si.
   */
  async listar(db: Executor, tela: TelaComVisao): Promise<VisaoSalva[]> {
    const linhas = await db.consultar<LinhaVisao>(
      `${SELECT_BASE}
        where v.tela = $1::app.tela_com_visao
        order by v.compartilhada desc, v.ordem, lower(v.nome)`,
      [tela],
    )
    return linhas.map(montar)
  }

  async porId(db: Executor, id: string): Promise<VisaoSalva | null> {
    const l = await db.consultarUm<LinhaVisao>(`${SELECT_BASE} where v.id = $1`, [id])
    return l ? montar(l) : null
  }

  async criar(db: Executor, tenantId: string, dados: CriarVisao, donoId: string): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.visao_salva
         (tenant_id, tela, nome, consulta, compartilhada, dono_id, created_by)
       values ($1, $2::app.tela_com_visao, btrim($3), $4::jsonb, $5, $6, app.usuario_atual())
       returning id`,
      [tenantId, dados.tela, dados.nome, JSON.stringify(dados.consulta), dados.compartilhada, donoId],
    )
    return l!.id
  }

  /**
   * Alteração parcial, com `coalesce` por campo.
   *
   * Montar o `set` dinamicamente conforme o que veio no corpo seria mais
   * enxuto e abriria a porta para o nome de coluna vir de fora. Com
   * `coalesce($n, coluna)` o SQL é fixo e o que não veio simplesmente fica.
   */
  async editar(db: Executor, id: string, dados: EditarVisao): Promise<boolean> {
    const n = await db.consultar(
      `update public.visao_salva
          set nome          = coalesce(btrim($2), nome),
              consulta      = coalesce($3::jsonb, consulta),
              compartilhada = coalesce($4::boolean, compartilhada),
              ordem         = coalesce($5::integer, ordem),
              version       = version + 1,
              updated_by    = app.usuario_atual()
        where id = $1
        returning id`,
      [
        id,
        dados.nome ?? null,
        dados.consulta === undefined ? null : JSON.stringify(dados.consulta),
        dados.compartilhada ?? null,
        dados.ordem ?? null,
      ],
    )
    return n.length > 0
  }

  /**
   * Se o usuário da transação pode publicar.
   *
   * Lê a mesma fonte que o gatilho da 0038 — os perfis, não o token. São
   * coisas que podem divergir: um token vale até expirar, e uma permissão
   * revogada há cinco minutos ainda está dentro dele. Fazer a exclusão
   * consultar o token e a publicação consultar o banco criaria duas verdades
   * sobre a mesma permissão, e a diferença só apareceria no dia em que alguém
   * revogasse algo.
   */
  async podeCompartilhar(db: Executor): Promise<boolean> {
    const l = await db.consultarUm<{ pode: boolean }>(
      `select app.usuario_tem_permissao('visao:compartilhar') as pode`,
    )
    return l?.pode ?? false
  }

  /**
   * Exclusão de verdade, e não `deleted_at`.
   *
   * O resto da base usa exclusão lógica porque o registro é fato — uma
   * movimentação apagada é uma máquina que o sistema deixa de saber onde está.
   * Uma visão é preferência de quem a criou: guardar o recorte que alguém
   * apagou não serve a ninguém, e ainda ocuparia o nome no índice único,
   * impedindo que a visão nova use o mesmo rótulo.
   */
  async excluir(db: Executor, id: string): Promise<boolean> {
    const n = await db.consultar(`delete from public.visao_salva where id = $1 returning id`, [id])
    return n.length > 0
  }
}
