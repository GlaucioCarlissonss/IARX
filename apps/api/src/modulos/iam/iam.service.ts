import { Injectable } from '@nestjs/common'
import type {
  AtualizarPerfil,
  AtualizarUsuario,
  ConvidarUsuario,
  CriarPerfil,
  ListarPerfis,
  ListarUsuarios,
  Perfil,
  RevogarSessoes,
  Usuario,
  VinculoPerfil,
} from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { exigirClaims } from '../../comum/contexto.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { gerarTokenRecuperacao } from '../../comum/senha.js'
import { NotificacaoService } from '../notificacao/notificacao.service.js'
import {
  IamRepositorio,
  cursorPerfil,
  cursorUsuario,
  mapearPerfil,
  mapearUsuario,
} from './iam.repositorio.js'

/** Validade do primeiro acesso. Mais longa que a recuperação: o convite espera a pessoa. */
const HORAS_CONVITE = 72

@Injectable()
export class IamService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: IamRepositorio,
    private readonly notificacao: NotificacaoService,
  ) {}

  /* ------------------------------------------------------------- usuários */

  async listarUsuarios(filtro: ListarUsuarios): Promise<Pagina<Usuario>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarUsuarios(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearUsuario), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorUsuario(ultimo)) : null,
      })
    })
  }

  async usuarioPorId(id: string): Promise<Usuario> {
    return this.banco.emTransacao(async (db) => {
      const u = await this.repo.usuarioPorId(db, id)
      if (!u) throw naoEncontrado('Usuário', id)
      return mapearUsuario(u)
    })
  }

  /**
   * Convida: cria a conta **sem senha** e emite o link de primeiro acesso.
   *
   * O token não volta na resposta — vai por e-mail, pela fila da migração 0018,
   * e por lugar nenhum mais (RN-L29). A conta nasce ATIVA e sem `senha_hash`, o
   * que é o próprio estado de "convite pendente": não há segunda coluna dizendo
   * a mesma coisa e podendo divergir.
   */
  async convidar(dados: ConvidarUsuario): Promise<Usuario> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      this.exigirCoerenciaDeCliente(dados)

      if (await this.repo.emailEmUso(db, dados.email)) {
        throw new ErroDominio('RECURSO_DUPLICADO', 'Já existe um usuário com este e-mail', {
          detail:
            'O e-mail identifica a pessoa dentro do locatário. Se ela perdeu o acesso, use a recuperação de senha em vez de convidar de novo.',
          errors: [{ field: 'email', code: 'DUPLICADO', message: dados.email }],
        })
      }

      const id = await this.repo.criarUsuario(db, claims.tenant_id, dados)
      for (const vinculo of dados.perfis) {
        await this.atribuirComTraducao(db, claims.tenant_id, id, vinculo)
      }

      const { token, hash } = gerarTokenRecuperacao()
      await db.consultar(`select app.auth_criar_token_recuperacao($1, $2, $3, $4, null::inet)`, [
        claims.tenant_id,
        id,
        hash,
        new Date(Date.now() + HORAS_CONVITE * 3_600_000),
      ])

      const autor = await this.repo.usuarioPorId(db, claims.usuario_id)
      await this.notificacao.convite(db, {
        usuarioId: id,
        nome: dados.nome,
        email: dados.email,
        token,
        convidadoPor: autor?.nome ?? 'a administração',
      })

      const criado = await this.repo.usuarioPorId(db, id)
      return mapearUsuario(criado as NonNullable<typeof criado>)
    })
  }

  async atualizarUsuario(id: string, versao: number, dados: AtualizarUsuario): Promise<Usuario> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.usuarioPorId(db, id)
      if (!atual) throw naoEncontrado('Usuário', id)

      const u = await this.repo.atualizarUsuario(db, id, versao, dados)
      if (!u) {
        throw new ErroDominio('CONFLITO_DE_VERSAO', 'O usuário mudou desde que você o abriu', {
          detail: `A versão em disco é ${atual.version}. Recarregue e reaplique a alteração.`,
        })
      }
      return mapearUsuario(u)
    })
  }

  async ativar(id: string): Promise<Usuario> {
    return this.banco.emTransacao(async (db) => {
      const u = await this.repo.definirStatus(db, id, 'ATIVO')
      if (!u) throw naoEncontrado('Usuário', id)
      return mapearUsuario(u)
    })
  }

  /**
   * Desativa e derruba as sessões, na mesma transação.
   *
   * As duas coisas juntas porque separá-las deixa uma janela em que a conta
   * está inativa e o token continua valendo — o `sessao_id` da claim é o que
   * permite encerrar antes da expiração, e desativar sem usá-lo torna a
   * desativação uma promessa para daqui a algumas horas.
   *
   * RN-L28 é do banco: o gatilho `usuario_protege_ultimo_admin` recusa se esta
   * for a última conta administrativa ativa. Aqui só se traduz a recusa.
   */
  async desativar(id: string, motivo: string): Promise<Usuario> {
    return this.banco.emTransacao(
      async (db) => {
        const atual = await this.repo.usuarioPorId(db, id)
        if (!atual) throw naoEncontrado('Usuário', id)

        try {
          const u = await this.repo.definirStatus(db, id, 'INATIVO')
          if (!u) throw naoEncontrado('Usuário', id)
          await this.repo.revogarSessoes(db, id, motivo)
          return mapearUsuario(u)
        } catch (e) {
          throw this.traduzirUltimoAdmin(e)
        }
      },
      { motivo },
    )
  }

  async revogarSessoes(id: string, dados: RevogarSessoes): Promise<{ revogadas: number }> {
    return this.banco.emTransacao(
      async (db) => {
        const u = await this.repo.usuarioPorId(db, id)
        if (!u) throw naoEncontrado('Usuário', id)
        return { revogadas: await this.repo.revogarSessoes(db, id, dados.motivo) }
      },
      { motivo: dados.motivo },
    )
  }

  async atribuirPerfil(id: string, vinculo: VinculoPerfil): Promise<Usuario> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const u = await this.repo.usuarioPorId(db, id)
      if (!u) throw naoEncontrado('Usuário', id)

      await this.atribuirComTraducao(db, claims.tenant_id, id, vinculo)
      const atualizado = await this.repo.usuarioPorId(db, id)
      return mapearUsuario(atualizado as NonNullable<typeof atualizado>)
    })
  }

  async revogarPerfil(id: string, perfilId: string): Promise<Usuario> {
    return this.banco.emTransacao(async (db) => {
      const u = await this.repo.usuarioPorId(db, id)
      if (!u) throw naoEncontrado('Usuário', id)

      try {
        const caiu = await this.repo.revogarPerfil(db, id, perfilId)
        if (caiu === 0) throw naoEncontrado('Vínculo de perfil', perfilId)
      } catch (e) {
        throw this.traduzirUltimoAdmin(e)
      }
      const atualizado = await this.repo.usuarioPorId(db, id)
      return mapearUsuario(atualizado as NonNullable<typeof atualizado>)
    })
  }

  /* --------------------------------------------------------------- perfis */

  async listarPerfis(filtro: ListarPerfis): Promise<Pagina<Perfil>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarPerfis(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearPerfil), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorPerfil(ultimo)) : null,
      })
    })
  }

  async perfilPorId(id: string): Promise<Perfil> {
    return this.banco.emTransacao(async (db) => {
      const p = await this.repo.perfilPorId(db, id)
      if (!p) throw naoEncontrado('Perfil', id)
      return mapearPerfil(p)
    })
  }

  async criarPerfil(dados: CriarPerfil): Promise<Perfil> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      try {
        return mapearPerfil(await this.repo.criarPerfil(db, claims.tenant_id, dados))
      } catch (e) {
        throw this.traduzirPerfil(e, dados.nome)
      }
    })
  }

  /**
   * Perfil de sistema é estrutural: atribuível, nunca editável.
   *
   * A recusa é aqui e não no banco porque `is_sistema` não é uma invariante de
   * integridade — é uma decisão de produto sobre o que o cadastro oferece. O que
   * o banco garante é o que não pode ser violado por caminho nenhum: catálogo de
   * permissões válido e perfil de cliente somente leitura.
   */
  async atualizarPerfil(id: string, dados: AtualizarPerfil): Promise<Perfil> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.perfilPorId(db, id)
      if (!atual) throw naoEncontrado('Perfil', id)
      if (atual.is_sistema) {
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'Perfil de sistema não é editável', {
          detail:
            'Perfis de sistema vêm do provisionamento e são iguais em todos os locatários. Para um acesso diferente, crie um perfil derivado.',
          acoes: [{ code: 'CRIAR_DERIVADO', descricao: 'Criar um perfil novo com estas permissões.' }],
        })
      }

      try {
        const p = await this.repo.atualizarPerfil(db, id, dados)
        if (!p) throw naoEncontrado('Perfil', id)
        return mapearPerfil(p)
      } catch (e) {
        throw this.traduzirPerfil(e, dados.nome ?? atual.nome)
      }
    })
  }

  /* ------------------------------------------------------------ auxiliares */

  /**
   * Usuário de cliente precisa de cliente; usuário interno não pode ter um.
   *
   * A segunda metade é a que importa: um usuário interno com `cliente_id`
   * preenchido faria `app.cliente_atual()` devolver um valor, e a política
   * restritiva da 0011 passaria a recortar a visão de quem opera a locadora —
   * uma pessoa da operação enxergando só um cliente, sem erro em lugar nenhum.
   */
  private exigirCoerenciaDeCliente(dados: ConvidarUsuario): void {
    if (dados.tipo === 'CLIENTE' && !dados.cliente_id) {
      throw new ErroDominio('PAYLOAD_INVALIDO', 'Usuário de cliente precisa de um cliente', {
        errors: [{ field: 'cliente_id', code: 'OBRIGATORIO' }],
      })
    }
    if (dados.tipo === 'INTERNO' && dados.cliente_id) {
      throw new ErroDominio('PAYLOAD_INVALIDO', 'Usuário interno não pertence a um cliente', {
        detail:
          'Vincular um usuário interno a um cliente faria a visão dele ser recortada pela política de cliente.',
        errors: [{ field: 'cliente_id', code: 'NAO_APLICAVEL' }],
      })
    }
  }

  private async atribuirComTraducao(
    db: Parameters<Parameters<BancoService['emTransacao']>[0]>[0],
    tenantId: string,
    usuarioId: string,
    vinculo: VinculoPerfil,
  ): Promise<void> {
    try {
      await this.repo.atribuirPerfil(db, tenantId, usuarioId, vinculo)
    } catch (e) {
      const codigo = (e as { code?: string }).code
      if (codigo === '23505') {
        throw new ErroDominio('RECURSO_DUPLICADO', 'Este perfil já está atribuído neste escopo', {
          errors: [{ field: 'perfil_id', code: 'DUPLICADO', message: vinculo.perfil_id }],
        })
      }
      if (codigo === '23514') {
        /*
         * `usuario_perfil_escopo_coerente`. A mensagem crua diz o nome da
         * restrição; quem chamou precisa saber **qual** combinação está errada,
         * e as duas metades da regra têm razões opostas.
         */
        throw new ErroDominio('PAYLOAD_INVALIDO', 'Escopo incoerente com o tipo', {
          detail:
            'TENANT, PROPRIO e CLIENTE não levam escopo_id — no caso de CLIENTE porque o cliente vem do token. EMPRESA, FILIAL, REGIAO e LOCAL_CLIENTE exigem um.',
          errors: [{ field: 'escopo_id', code: 'INCOERENTE', message: vinculo.escopo_tipo }],
        })
      }
      if (codigo === '23503') {
        throw naoEncontrado('Perfil', vinculo.perfil_id)
      }
      throw e
    }
  }

  /** `check_violation` vinda dos gatilhos de último administrador (RN-L28). */
  private traduzirUltimoAdmin(e: unknown): unknown {
    const mensagem = String((e as { message?: string }).message ?? '')
    if (!mensagem.includes('sem administrador')) return e
    return new ErroDominio('REGRA_DE_NEGOCIO', 'O locatário ficaria sem administrador', {
      detail:
        'Esta é a última conta ativa com usuario:gerenciar. Sem ela ninguém consegue conceder acesso a ninguém, e a saída é o suporte mexer direto no banco.',
      acoes: [
        {
          code: 'CONCEDER_A_OUTRO',
          descricao: 'Conceda o perfil administrativo a outro usuário ativo antes de repetir.',
        },
      ],
    })
  }

  private traduzirPerfil(e: unknown, nome: string): unknown {
    const codigo = (e as { code?: string }).code
    const mensagem = String((e as { message?: string }).message ?? '')

    if (codigo === '23505') {
      return new ErroDominio('RECURSO_DUPLICADO', 'Já existe um perfil com este nome', {
        errors: [{ field: 'nome', code: 'DUPLICADO', message: nome }],
      })
    }
    if (codigo === '23514' && mensagem.includes('perfil de cliente')) {
      /* RN-L25, gatilho `perfil_cliente_somente_leitura`. */
      return new ErroDominio('REGRA_DE_NEGOCIO', 'Perfil de cliente é somente leitura', {
        detail: `${mensagem} O portal do cliente lê e abre chamado; nada além disso.`,
        errors: [{ field: 'permissoes', code: 'NAO_PERMITIDA' }],
      })
    }
    if (codigo === '23514') {
      return new ErroDominio('PAYLOAD_INVALIDO', 'Permissão fora do catálogo', {
        detail: mensagem,
        errors: [{ field: 'permissoes', code: 'DESCONHECIDA' }],
      })
    }
    return e
  }
}
