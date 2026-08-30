import { Injectable } from '@nestjs/common'
import type {
  AtualizarPerfil,
  AtualizarUsuario,
  ConvidarUsuario,
  CriarPerfil,
  ListarPerfis,
  ListarUsuarios,
  Perfil,
  Permissao,
  Usuario,
  VinculoPerfil,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor } from '../../comum/pagina.js'

/**
 * Acesso a dados de usuário, perfil e vínculo.
 *
 * Como nos demais repositórios, nenhum `where tenant_id`: o isolamento é da RLS.
 *
 * E nenhuma regra de IAM aqui dentro. "O locatário nunca fica sem
 * administrador" e "perfil de cliente é somente leitura" são gatilhos
 * (`usuario_protege_ultimo_admin`, `perfil_cliente_somente_leitura`), e é lá que
 * têm de morar: uma correção pelo psql ou um script de migração de dados não
 * passam por esta classe.
 */

export interface LinhaUsuario extends Record<string, unknown> {
  id: string
  nome: string
  email: string
  telefone: string | null
  tipo: Usuario['tipo']
  status: Usuario['status']
  cliente_id: string | null
  mfa_habilitado: boolean
  ultimo_acesso_em: Date | null
  senha_hash: string | null
  version: number
  created_at: Date
  perfis: Usuario['perfis'] | null
}

const SELECT_USUARIO = `
  select u.id, u.nome, u.email, u.telefone, u.tipo, u.status, u.cliente_id,
         u.mfa_habilitado, u.ultimo_acesso_em, u.senha_hash, u.version, u.created_at,
         (select jsonb_agg(jsonb_build_object(
                   'perfil_id', up.perfil_id, 'perfil_nome', p.nome,
                   'escopo_tipo', up.escopo_tipo, 'escopo_id', up.escopo_id)
                 order by p.nome)
            from public.usuario_perfil up
            join public.perfil p on p.id = up.perfil_id
           where up.usuario_id = u.id) as perfis
    from public.usuario u
`

export function mapearUsuario(u: LinhaUsuario): Usuario {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    telefone: u.telefone,
    tipo: u.tipo,
    status: u.status,
    cliente_id: u.cliente_id,
    mfa_habilitado: u.mfa_habilitado,
    ultimo_acesso_em: u.ultimo_acesso_em ? u.ultimo_acesso_em.toISOString() : null,
    /*
     * Convite pendente é **não ter senha**, e não uma coluna `convite_aceito`.
     *
     * O estado já está no banco: `senha_hash` nulo significa que ninguém nunca
     * definiu a senha desta conta. Uma segunda coluna dizendo a mesma coisa
     * poderia divergir dela, e a pergunta "qual das duas vale" não tem resposta.
     */
    convite_pendente: u.senha_hash === null,
    perfis: u.perfis ?? [],
    version: u.version,
  }
}

export const cursorUsuario = (u: LinhaUsuario) => ({
  criadoEm: u.created_at.toISOString(),
  id: u.id,
})

export interface LinhaPerfil extends Record<string, unknown> {
  id: string
  nome: string
  descricao: string | null
  tipo: Perfil['tipo']
  is_sistema: boolean
  permissoes: string[]
  usuarios: string
  created_at: Date
}

export function mapearPerfil(p: LinhaPerfil): Perfil {
  return {
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    tipo: p.tipo,
    is_sistema: p.is_sistema,
    permissoes: p.permissoes as Permissao[],
    usuarios: Number(p.usuarios),
  }
}

export const cursorPerfil = (p: LinhaPerfil) => ({
  criadoEm: p.created_at.toISOString(),
  id: p.id,
})

@Injectable()
export class IamRepositorio {
  /* ------------------------------------------------------------- usuários */

  async listarUsuarios(
    db: Executor,
    filtro: ListarUsuarios,
  ): Promise<{ linhas: LinhaUsuario[]; temMais: boolean }> {
    const clausulas = ['u.deleted_at is null']
    const valores: unknown[] = []

    if (filtro.tipo) {
      valores.push(filtro.tipo)
      clausulas.push(`u.tipo = $${valores.length}`)
    }
    if (filtro.status) {
      valores.push(filtro.status)
      clausulas.push(`u.status = $${valores.length}::app.status_registro`)
    }
    if (filtro.cliente_id) {
      valores.push(filtro.cliente_id)
      clausulas.push(`u.cliente_id = $${valores.length}`)
    }
    if (filtro.perfil_id) {
      valores.push(filtro.perfil_id)
      clausulas.push(
        `exists (select 1 from public.usuario_perfil up
                  where up.usuario_id = u.id and up.perfil_id = $${valores.length})`,
      )
    }
    if (filtro.q) {
      valores.push(`%${filtro.q.toLowerCase()}%`)
      clausulas.push(`(lower(u.nome) like $${valores.length} or lower(u.email) like $${valores.length})`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(u.created_at, u.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const linhas = await db.consultar<LinhaUsuario>(
      `${SELECT_USUARIO} where ${clausulas.join(' and ')}
        order by u.created_at desc, u.id desc limit $${valores.length}`,
      valores,
    )
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async usuarioPorId(db: Executor, id: string): Promise<LinhaUsuario | null> {
    return db.consultarUm<LinhaUsuario>(
      `${SELECT_USUARIO} where u.id = $1 and u.deleted_at is null`,
      [id],
    )
  }

  async emailEmUso(db: Executor, email: string): Promise<boolean> {
    const l = await db.consultarUm<{ existe: boolean }>(
      `select true as existe from public.usuario
        where lower(email) = lower($1) and deleted_at is null limit 1`,
      [email],
    )
    return l !== null
  }

  async criarUsuario(db: Executor, tenantId: string, dados: ConvidarUsuario): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.usuario (tenant_id, nome, email, telefone, tipo, cliente_id, status)
       values ($1, $2, $3, $4, $5, $6, 'ATIVO')
       returning id`,
      [tenantId, dados.nome, dados.email, dados.telefone ?? null, dados.tipo, dados.cliente_id ?? null],
    )
    return (l as { id: string }).id
  }

  async atualizarUsuario(
    db: Executor,
    id: string,
    versao: number,
    dados: AtualizarUsuario,
  ): Promise<LinhaUsuario | null> {
    const campos: string[] = []
    const valores: unknown[] = []
    for (const [coluna, valor] of Object.entries(dados)) {
      valores.push(valor)
      campos.push(`${coluna} = $${valores.length}`)
    }
    valores.push(id, versao)
    const atualizado = await db.consultarUm<{ id: string }>(
      `update public.usuario set ${campos.join(', ')}, version = version + 1
        where id = $${valores.length - 1} and version = $${valores.length} and deleted_at is null
       returning id`,
      valores,
    )
    return atualizado ? this.usuarioPorId(db, id) : null
  }

  async definirStatus(
    db: Executor,
    id: string,
    status: Usuario['status'],
  ): Promise<LinhaUsuario | null> {
    const l = await db.consultarUm<{ id: string }>(
      `update public.usuario set status = $2::app.status_registro, version = version + 1
        where id = $1 and deleted_at is null returning id`,
      [id, status],
    )
    return l ? this.usuarioPorId(db, id) : null
  }

  /** Revoga todas as sessões vivas. Devolve quantas caíram. */
  async revogarSessoes(db: Executor, usuarioId: string, motivo: string): Promise<number> {
    const linhas = await db.consultar<{ id: string }>(
      `update public.sessao
          set revogada_em = now(), revogada_por = app.usuario_atual(), revogacao_motivo = $2
        where usuario_id = $1 and revogada_em is null
       returning id`,
      [usuarioId, motivo],
    )
    return linhas.length
  }

  /* ------------------------------------------------------------- vínculos */

  async atribuirPerfil(db: Executor, tenantId: string, usuarioId: string, v: VinculoPerfil): Promise<void> {
    await db.consultar(
      `insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo, escopo_id)
       values ($1, $2, $3, $4::app.escopo_tipo, $5)`,
      [tenantId, usuarioId, v.perfil_id, v.escopo_tipo, v.escopo_id ?? null],
    )
  }

  /** Devolve quantas linhas caíram — zero significa que o vínculo não existia. */
  async revogarPerfil(db: Executor, usuarioId: string, perfilId: string): Promise<number> {
    const linhas = await db.consultar<{ id: string }>(
      `delete from public.usuario_perfil
        where usuario_id = $1 and perfil_id = $2 returning id`,
      [usuarioId, perfilId],
    )
    return linhas.length
  }

  /* --------------------------------------------------------------- perfis */

  async listarPerfis(
    db: Executor,
    filtro: ListarPerfis,
  ): Promise<{ linhas: LinhaPerfil[]; temMais: boolean }> {
    const clausulas = ['p.deleted_at is null']
    const valores: unknown[] = []

    if (filtro.tipo) {
      valores.push(filtro.tipo)
      clausulas.push(`p.tipo = $${valores.length}`)
    }
    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(p.created_at, p.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const linhas = await db.consultar<LinhaPerfil>(
      `select p.id, p.nome, p.descricao, p.tipo, p.is_sistema, p.permissoes, p.created_at,
              (select count(*) from public.usuario_perfil up where up.perfil_id = p.id) as usuarios
         from public.perfil p
        where ${clausulas.join(' and ')}
        order by p.created_at desc, p.id desc limit $${valores.length}`,
      valores,
    )
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async perfilPorId(db: Executor, id: string): Promise<LinhaPerfil | null> {
    return db.consultarUm<LinhaPerfil>(
      `select p.id, p.nome, p.descricao, p.tipo, p.is_sistema, p.permissoes, p.created_at,
              (select count(*) from public.usuario_perfil up where up.perfil_id = p.id) as usuarios
         from public.perfil p
        where p.id = $1 and p.deleted_at is null`,
      [id],
    )
  }

  async criarPerfil(db: Executor, tenantId: string, dados: CriarPerfil): Promise<LinhaPerfil> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.perfil (tenant_id, nome, descricao, tipo, is_sistema, permissoes)
       values ($1, $2, $3, $4, false, $5::text[])
       returning id`,
      [tenantId, dados.nome, dados.descricao ?? null, dados.tipo, dados.permissoes],
    )
    return (await this.perfilPorId(db, (l as { id: string }).id)) as LinhaPerfil
  }

  async atualizarPerfil(
    db: Executor,
    id: string,
    dados: AtualizarPerfil,
  ): Promise<LinhaPerfil | null> {
    const campos: string[] = []
    const valores: unknown[] = []
    for (const [coluna, valor] of Object.entries(dados)) {
      valores.push(valor)
      campos.push(coluna === 'permissoes' ? `permissoes = $${valores.length}::text[]` : `${coluna} = $${valores.length}`)
    }
    valores.push(id)
    const l = await db.consultarUm<{ id: string }>(
      `update public.perfil set ${campos.join(', ')}
        where id = $${valores.length} and deleted_at is null returning id`,
      valores,
    )
    return l ? this.perfilPorId(db, id) : null
  }
}
