import { Injectable } from '@nestjs/common'
import { SignJWT } from 'jose'
import type {
  Login,
  RedefinirSenha,
  RespostaLogin,
  SolicitarRecuperacao,
  TrocarSenha,
} from '@iarx/contracts'
import { ehPermissao } from '@iarx/contracts'
import { BancoService, type Executor } from '../../banco/banco.service.js'
import { ErroDominio } from '../../comum/erros.js'
import { exigirClaims } from '../../comum/contexto.js'
import {
  conferirSenha,
  gerarHashSenha,
  gerarTokenRecuperacao,
  hashTokenRecuperacao,
} from '../../comum/senha.js'
import { AuthRepositorio, type UsuarioAutenticavel } from './auth.repositorio.js'
import { NotificacaoService } from '../notificacao/notificacao.service.js'

/** Validade do access token. Curta o bastante para limitar dano, longa o bastante para um turno. */
const HORAS_SESSAO = 8

/** Validade do link de recuperação. Trinta minutos é o padrão de mercado, e é generoso. */
const MINUTOS_RECUPERACAO = 30

@Injectable()
export class AuthService {
  private readonly segredo = process.env['IARX_JWT_SEGREDO']
  private readonly emissor = process.env['IARX_JWT_ISSUER']
  private readonly audiencia = process.env['IARX_JWT_AUDIENCE']

  constructor(
    private readonly banco: BancoService,
    private readonly repo: AuthRepositorio,
    private readonly notificacao: NotificacaoService,
  ) {}

  /**
   * Login.
   *
   * A regra que organiza este método inteiro: **toda recusa devolve a mesma
   * resposta**. E-mail inexistente, senha errada, usuário inativo e conta
   * bloqueada são situações diferentes para nós e indistinguíveis para quem
   * chama. Distinguir qualquer uma transforma o endpoint em enumerador de
   * usuários — e as três primeiras são justamente as que dão vontade de
   * explicar melhor.
   *
   * A exceção deliberada é o bloqueio: ali o usuário legítimo precisa saber
   * que existe um bloqueio, senão fica tentando a senha certa sem entender. A
   * mensagem diz que a conta está temporariamente bloqueada **sem confirmar
   * que o e-mail existe** — a mesma frase é devolvida a quem digitou um e-mail
   * qualquer, porque a decisão de bloquear vem antes de sabermos se acertou a
   * senha.
   */
  async login(dados: Login, ip: string | null, userAgent: string | null): Promise<RespostaLogin> {
    const u = await this.banco.semContexto((db) => this.repo.porEmail(db, dados.email))

    if (!u) {
      // Sem usuário, ainda conferimos contra um hash descartável: responder na
      // hora entregaria, pelo relógio, quais e-mails existem.
      await conferirSenha(dados.senha, null)
      throw this.credencialInvalida()
    }

    if (u.bloqueado_ate && u.bloqueado_ate > new Date()) {
      await this.anotar(u, dados.email, false, 'conta bloqueada', ip, userAgent)
      throw new ErroDominio('NAO_AUTENTICADO', 'Conta temporariamente bloqueada', {
        status: 401,
        detail:
          'Muitas tentativas seguidas. Aguarde alguns minutos ou use "esqueci minha senha" para redefinir.',
      })
    }

    const senhaConfere = await conferirSenha(dados.senha, u.senha_hash)

    if (!senhaConfere || u.status !== 'ATIVO') {
      await this.anotar(
        u,
        dados.email,
        false,
        senhaConfere ? `usuário ${u.status}` : 'senha incorreta',
        ip,
        userAgent,
      )
      throw this.credencialInvalida()
    }

    await this.anotar(u, dados.email, true, null, ip, userAgent)

    return this.banco.semContexto(async (db) => {
      const expiraEm = new Date(Date.now() + HORAS_SESSAO * 3600_000)
      const sessaoId = await this.repo.abrirSessao(db, {
        tenantId: u.tenant_id,
        usuarioId: u.id,
        expiraEm,
        ip,
        userAgent,
      })

      const permissoes = (await this.repo.permissoesDe(db, u.id)).filter(ehPermissao)
      const escopos = await this.repo.escoposDe(db, u.id)

      const token = await this.assinar({
        sub: u.id,
        tenant_id: u.tenant_id,
        usuario_id: u.id,
        cliente_id: u.cliente_id,
        sessao_id: sessaoId,
        permissoes,
        escopos,
        expiraEm,
      })

      return {
        token,
        expira_em: expiraEm.toISOString(),
        deve_trocar_senha: u.deve_trocar_senha || this.senhaExpirou(u),
        usuario: {
          id: u.id,
          nome: u.nome,
          email: u.email,
          tipo: u.tipo,
          cliente_id: u.cliente_id,
        },
        permissoes,
      }
    })
  }

  /**
   * Troca de senha pelo próprio usuário.
   *
   * Exige a senha atual mesmo estando autenticado: sem isso, um token roubado
   * ou uma sessão deixada aberta no computador alheio permitiria trocar a
   * senha e expulsar o dono da própria conta.
   */
  async trocarSenha(dados: TrocarSenha): Promise<void> {
    const claims = exigirClaims()

    await this.banco.semContexto(async (db) => {
      const u = await this.porId(db, claims.usuario_id)

      if (!(await conferirSenha(dados.senha_atual, u.senha_hash))) {
        throw new ErroDominio('NAO_AUTENTICADO', 'Senha atual incorreta', { status: 401 })
      }
      this.exigirSenhaAceitavel(dados.senha_nova, u)

      // A senha nova não pode ser a atual. Sem esta checagem, uma política de
      // expiração vira teatro: o usuário "troca" para a mesma e segue.
      if (await conferirSenha(dados.senha_nova, u.senha_hash)) {
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'A senha nova é igual à atual', {
          errors: [{ field: 'senha_nova', code: 'IGUAL_A_ATUAL' }],
        })
      }

      await this.repo.definirSenha(db, u.id, await gerarHashSenha(dados.senha_nova), false, 'troca de senha')
    })
  }

  /**
   * Solicitação de recuperação.
   *
   * **A resposta é sempre a mesma**, com ou sem usuário (RN-L28). Um endpoint
   * público que responde diferente para e-mail existente é um enumerador de
   * base de clientes, e o custo de descobrir isso é zero para quem tenta.
   *
   * O envio não acontece aqui: a mensagem é **enfileirada na mesma transação**
   * que grava o token, e o worker da migração 0018 entrega. Se a gravação do
   * token for desfeita, o aviso não existe — que é a metade do padrão outbox
   * que importa.
   *
   * O token vai na mensagem e em nenhum log. Um token de recuperação em log é
   * um token vazado: quem lê o log passa a poder redefinir a senha de qualquer
   * pessoa, e o rastro não aparece em lugar nenhum, porque a redefinição em si
   * é legítima.
   */
  async solicitarRecuperacao(dados: SolicitarRecuperacao, ip: string | null): Promise<void> {
    await this.banco.semContexto(async (db) => {
      const u = await this.repo.porEmail(db, dados.email)
      if (!u || u.status !== 'ATIVO') return

      const { token, hash } = gerarTokenRecuperacao()
      await this.repo.criarTokenRecuperacao(db, {
        tenantId: u.tenant_id,
        usuarioId: u.id,
        hash,
        expiraEm: new Date(Date.now() + MINUTOS_RECUPERACAO * 60_000),
        ip,
      })

      /*
       * `enfileirar_notificacao` usa `app.exigir_tenant()`, e esta transação
       * roda sem contexto — é o preço de a recuperação ser pública. O tenant
       * vem do usuário que a consulta fechada acabou de encontrar.
       */
      await db.consultar(`select set_config('app.tenant_id', $1, true)`, [u.tenant_id])
      await this.notificacao.recuperacaoDeSenha(db, {
        usuarioId: u.id,
        nome: u.nome,
        email: u.email,
        token,
        minutos: MINUTOS_RECUPERACAO,
      })
    })
  }

  async redefinirSenha(dados: RedefinirSenha): Promise<void> {
    await this.banco.semContexto(async (db) => {
      const alvo = await this.repo.consumirTokenRecuperacao(db, hashTokenRecuperacao(dados.token))
      if (!alvo) {
        throw new ErroDominio('NAO_AUTENTICADO', 'Link inválido ou expirado', {
          status: 401,
          detail: 'Solicite a recuperação novamente; cada link vale uma vez e por 30 minutos.',
        })
      }

      const u = await this.porId(db, alvo.usuario_id)
      this.exigirSenhaAceitavel(dados.senha_nova, u)

      // Redefinir revoga as sessões: quem redefine porque desconfia de acesso
      // indevido espera que o acesso indevido termine.
      await this.repo.definirSenha(db, u.id, await gerarHashSenha(dados.senha_nova), false, 'recuperação de senha')
    })
  }

  /* ------------------------------------------------------------- auxiliares */

  /**
   * Registra a tentativa em transação própria, e é por isso que ela existe.
   *
   * A primeira versão registrava e lançava dentro da mesma transação — e o
   * `throw` disparava o rollback, que desfazia o registro junto. O contador de
   * falhas nunca passava de zero e o bloqueio **nunca engatava**: um controle
   * de segurança silenciosamente inoperante, do tipo que nenhum teste de
   * caminho feliz encontra.
   *
   * É a mesma razão pela qual o controle de idempotência usa transação
   * separada: o registro de "isto aconteceu" não pode compartilhar destino com
   * a operação que fracassou.
   */
  private async anotar(
    u: UsuarioAutenticavel,
    identificador: string,
    sucesso: boolean,
    motivo: string | null,
    ip: string | null,
    userAgent: string | null,
  ): Promise<void> {
    await this.banco.semContexto((db) =>
      this.repo.registrarTentativa(db, {
        tenantId: u.tenant_id,
        usuarioId: u.id,
        identificador,
        sucesso,
        motivo,
        ip,
        userAgent,
      }),
    )
  }

  /** A recusa genérica. Uma única, porque distinguir é o que vaza. */
  private credencialInvalida(): ErroDominio {
    return new ErroDominio('NAO_AUTENTICADO', 'E-mail ou senha incorretos', {
      status: 401,
      detail: 'Confira os dados e tente novamente.',
    })
  }

  private async porId(db: Executor, id: string): Promise<UsuarioAutenticavel> {
    const linha = await this.repo.porId(db, id)
    if (!linha) throw new ErroDominio('NAO_ENCONTRADO', 'Usuário não encontrado', { status: 404 })
    return linha
  }

  /** A política é do locatário, nunca constante daqui (RN-L40). */
  private exigirSenhaAceitavel(senha: string, u: UsuarioAutenticavel): void {
    const minimo = u.politica_senha?.tamanho_minimo ?? 12
    if (senha.length < minimo) {
      throw new ErroDominio('REGRA_DE_NEGOCIO', 'Senha abaixo do mínimo da organização', {
        detail: `A política deste ambiente exige ao menos ${minimo} caracteres.`,
        errors: [{ field: 'senha_nova', code: 'CURTA', meta: { minimo } }],
      })
    }
  }

  private senhaExpirou(u: UsuarioAutenticavel): boolean {
    const dias = u.politica_senha?.expira_em_dias
    if (!dias || !u.senha_alterada_em) return false
    const limite = new Date(u.senha_alterada_em)
    limite.setDate(limite.getDate() + dias)
    return limite < new Date()
  }

  private async assinar(dados: {
    sub: string
    tenant_id: string
    usuario_id: string
    cliente_id: string | null
    sessao_id: string
    permissoes: string[]
    escopos: { tipo: string; id: string | null }[]
    expiraEm: Date
  }): Promise<string> {
    if (!this.segredo) {
      // Emitir token exige material de assinatura. Em produção com JWKS, quem
      // emite é o provedor externo — e esta rota não deveria existir ali.
      throw new ErroDominio('ERRO_INTERNO', 'Emissão de token não configurada', {
        status: 500,
        detail: 'Defina IARX_JWT_SEGREDO para a API emitir tokens própria.',
      })
    }

    const agora = Math.floor(Date.now() / 1000)
    let jwt = new SignJWT({
      tenant_id: dados.tenant_id,
      usuario_id: dados.usuario_id,
      cliente_id: dados.cliente_id,
      sessao_id: dados.sessao_id,
      permissoes: dados.permissoes,
      escopos: dados.escopos,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(dados.sub)
      .setIssuedAt(agora)
      .setExpirationTime(Math.floor(dados.expiraEm.getTime() / 1000))

    if (this.emissor) jwt = jwt.setIssuer(this.emissor)
    if (this.audiencia) jwt = jwt.setAudience(this.audiencia)

    return jwt.sign(new TextEncoder().encode(this.segredo))
  }
}
