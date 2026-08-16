import { Injectable } from '@nestjs/common'
import type { Executor } from '../../banco/banco.service.js'

/**
 * Acesso a dados da autenticação.
 *
 * Toda consulta aqui passa por uma função `app.auth_*` do banco, e nenhuma
 * escreve SQL sobre as tabelas direto. Não é preferência de estilo: essas são
 * as únicas operações do sistema que acontecem **antes** de existir contexto de
 * tenant, e portanto as únicas que precisam atravessar a RLS. A migração 0016
 * as declara como `security definer`, com superfície fechada e enumerável
 * (RN-L41) — este arquivo é o outro lado dessa fronteira.
 *
 * A consequência prática: acrescentar uma consulta de autenticação exige uma
 * função nova no banco, visível no diff de migração. Não dá para "só fazer um
 * select aqui" — a RLS negaria, e é isso que se quer.
 */

export interface UsuarioAutenticavel {
  id: string
  tenant_id: string
  nome: string
  email: string
  tipo: 'INTERNO' | 'CLIENTE'
  cliente_id: string | null
  status: string
  senha_hash: string | null
  senha_alterada_em: Date | null
  deve_trocar_senha: boolean
  bloqueado_ate: Date | null
  politica_senha: {
    tamanho_minimo: number
    expira_em_dias: number | null
    tentativas_ate_bloquear: number
    bloqueio_minutos: number
    exige_troca_no_primeiro_acesso: boolean
  }
}

@Injectable()
export class AuthRepositorio {
  async porEmail(db: Executor, email: string): Promise<UsuarioAutenticavel | null> {
    return db.consultarUm<UsuarioAutenticavel & Record<string, unknown>>(
      `select * from app.auth_usuario_por_email($1)`,
      [email],
    )
  }

  async porId(db: Executor, id: string): Promise<UsuarioAutenticavel | null> {
    return db.consultarUm<UsuarioAutenticavel & Record<string, unknown>>(
      `select * from app.auth_usuario_por_id($1)`,
      [id],
    )
  }

  async permissoesDe(db: Executor, usuarioId: string): Promise<string[]> {
    const linhas = await db.consultar<{ auth_permissoes: string }>(
      `select * from app.auth_permissoes($1)`,
      [usuarioId],
    )
    return linhas.map((l) => l.auth_permissoes)
  }

  async escoposDe(db: Executor, usuarioId: string): Promise<{ tipo: string; id: string | null }[]> {
    return db.consultar<{ tipo: string; id: string | null }>(`select * from app.auth_escopos($1)`, [
      usuarioId,
    ])
  }

  async registrarTentativa(
    db: Executor,
    dados: {
      tenantId: string | null
      usuarioId: string | null
      identificador: string
      sucesso: boolean
      motivo?: string | null
      ip?: string | null
      userAgent?: string | null
    },
  ): Promise<void> {
    // Sem tenant não há onde registrar — acontece quando o e-mail tentado não
    // existe em locatário nenhum. Uma tabela de log global sem dono seria pior
    // que a lacuna: acumularia identificadores de terceiros sem retenção nem
    // responsável.
    if (!dados.tenantId) return
    await db.consultar(`select app.registrar_tentativa_login($1, $2, $3, $4, $5, $6::inet, $7)`, [
      dados.tenantId,
      dados.usuarioId,
      dados.identificador,
      dados.sucesso,
      dados.motivo ?? null,
      dados.ip ?? null,
      dados.userAgent ?? null,
    ])
  }

  async abrirSessao(
    db: Executor,
    dados: { tenantId: string; usuarioId: string; expiraEm: Date; ip?: string | null; userAgent?: string | null },
  ): Promise<string> {
    const linha = await db.consultarUm<{ auth_abrir_sessao: string }>(
      `select app.auth_abrir_sessao($1, $2, $3, $4::inet, $5)`,
      [dados.tenantId, dados.usuarioId, dados.expiraEm, dados.ip ?? null, dados.userAgent ?? null],
    )
    return linha!.auth_abrir_sessao
  }

  /** Id do usuário dono da sessão, ou nulo se ela não está viva. */
  async sessaoViva(db: Executor, sessaoId: string): Promise<string | null> {
    const linha = await db.consultarUm<{ auth_sessao_viva: string | null }>(
      `select app.auth_sessao_viva($1)`,
      [sessaoId],
    )
    return linha?.auth_sessao_viva ?? null
  }

  async tocarSessao(db: Executor, sessaoId: string): Promise<void> {
    await db.consultar(`select app.auth_tocar_sessao($1)`, [sessaoId])
  }

  async definirSenha(
    db: Executor,
    usuarioId: string,
    hash: string,
    deveTrocar: boolean,
    motivo: string,
  ): Promise<void> {
    await db.consultar(`select app.auth_definir_senha($1, $2, $3, $4)`, [
      usuarioId,
      hash,
      deveTrocar,
      motivo,
    ])
  }

  async criarTokenRecuperacao(
    db: Executor,
    dados: { tenantId: string; usuarioId: string; hash: string; expiraEm: Date; ip?: string | null },
  ): Promise<void> {
    await db.consultar(`select app.auth_criar_token_recuperacao($1, $2, $3, $4, $5::inet)`, [
      dados.tenantId,
      dados.usuarioId,
      dados.hash,
      dados.expiraEm,
      dados.ip ?? null,
    ])
  }

  async consumirTokenRecuperacao(
    db: Executor,
    hash: string,
  ): Promise<{ usuario_id: string; tenant_id: string } | null> {
    return db.consultarUm<{ usuario_id: string; tenant_id: string }>(
      `select * from app.auth_consumir_token_recuperacao($1)`,
      [hash],
    )
  }
}
