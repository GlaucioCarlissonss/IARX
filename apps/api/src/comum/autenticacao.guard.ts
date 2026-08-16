import { Inject, Injectable, Logger, forwardRef, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Claims } from '@iarx/contracts'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { Request } from 'express'
import { CHAVE_PUBLICO } from './decoradores.js'
import { exigirContexto } from './contexto.js'
import { ErroDominio } from './erros.js'
import { BancoService } from '../banco/banco.service.js'

/**
 * Autenticação por access token (OIDC).
 *
 * Duas configurações possíveis, e a diferença entre elas importa:
 *
 * - `IARX_JWKS_URL` → verificação por chave pública, buscada e rotacionada pelo
 *   emissor. É a configuração de produção: a API **não** guarda material capaz
 *   de emitir token.
 *
 * - `IARX_JWT_SEGREDO` → HS256 com segredo compartilhado. Só para ambiente
 *   local e CI, onde não há emissor. Segredo compartilhado significa que quem
 *   verifica também consegue assinar; em produção isso transforma qualquer
 *   leitura de variável de ambiente em escalonamento total.
 *
 * O bootstrap recusa subir com HS256 quando `NODE_ENV=production` — a proteção
 * precisa ser estrutural, não uma linha em runbook.
 */
@Injectable()
export class AutenticacaoGuard implements CanActivate {
  private readonly log = new Logger(AutenticacaoGuard.name)
  private readonly jwks: JWTVerifyGetKey | null
  private readonly segredo: Uint8Array | null
  private readonly emissor = process.env['IARX_JWT_ISSUER']
  private readonly audiencia = process.env['IARX_JWT_AUDIENCE']

  constructor(
    private readonly reflector: Reflector,
    @Inject(forwardRef(() => BancoService)) private readonly banco: BancoService,
  ) {
    const urlJwks = process.env['IARX_JWKS_URL']
    const segredo = process.env['IARX_JWT_SEGREDO']

    this.jwks = urlJwks ? createRemoteJWKSet(new URL(urlJwks)) : null
    this.segredo = !urlJwks && segredo ? new TextEncoder().encode(segredo) : null

    if (!this.jwks && !this.segredo) {
      throw new Error('configure IARX_JWKS_URL (produção) ou IARX_JWT_SEGREDO (local/CI)')
    }
    if (this.segredo && process.env['NODE_ENV'] === 'production') {
      throw new Error('IARX_JWT_SEGREDO (HS256) não é aceito em produção: use IARX_JWKS_URL')
    }
  }

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(CHAVE_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ])
    if (publico) return true

    const req = contexto.switchToHttp().getRequest<Request>()
    const token = extrairToken(req)
    if (!token) {
      throw new ErroDominio('NAO_AUTENTICADO', 'Autenticação obrigatória', {
        detail: 'Envie o access token no cabeçalho Authorization: Bearer <token>.',
      })
    }

    let payload: unknown
    try {
      const opcoes = {
        ...(this.emissor ? { issuer: this.emissor } : {}),
        ...(this.audiencia ? { audience: this.audiencia } : {}),
        clockTolerance: 5,
      }
      const resultado = this.jwks
        ? await jwtVerify(token, this.jwks, opcoes)
        : await jwtVerify(token, this.segredo!, { ...opcoes, algorithms: ['HS256'] })
      payload = resultado.payload
    } catch (e) {
      // A causa exata (expirado, assinatura inválida, emissor errado) fica no
      // log; o cliente recebe apenas "token inválido". Detalhar ajuda quem está
      // sondando a montar um token aceitável.
      this.log.warn(`token recusado: ${e instanceof Error ? e.message : String(e)}`)
      throw new ErroDominio('TOKEN_INVALIDO', 'Token inválido ou expirado')
    }

    const analisado = Claims.safeParse(payload)
    if (!analisado.success) {
      this.log.warn(`claims fora do contrato: ${analisado.error.issues.map((i) => i.path.join('.')).join(', ')}`)
      throw new ErroDominio('TOKEN_INVALIDO', 'Token sem as claims exigidas', {
        detail: 'O token precisa conter tenant_id, usuario_id e permissoes.',
      })
    }

    /*
     * Sessão viva.
     *
     * Sem esta checagem, `revogada_em` seria uma coluna decorativa: o token
     * continuaria valendo até expirar, e desativar um usuário demitido às 9h
     * deixaria o acesso dele funcionando por horas. É uma consulta a mais por
     * requisição, e é o preço de poder encerrar acesso.
     *
     * Token sem `sessao_id` passa: é o caso da conta de serviço (Anexo C.7),
     * que não tem sessão de usuário atrás. Ela é revogada girando a chave, não
     * encerrando sessão.
     */
    const sessaoId = analisado.data.sessao_id
    if (sessaoId) {
      const viva = await this.banco.semContexto((db) =>
        db.consultarUm<{ auth_sessao_viva: string | null }>(`select app.auth_sessao_viva($1)`, [sessaoId]),
      )
      if (!viva?.auth_sessao_viva) {
        // Mesma resposta de token inválido, de propósito: dizer "sua sessão foi
        // revogada" informa a quem roubou o token que alguém percebeu.
        this.log.warn(`sessão ${sessaoId} não está viva`)
        throw new ErroDominio('TOKEN_INVALIDO', 'Token inválido ou expirado')
      }
    }

    exigirContexto().claims = analisado.data
    return true
  }
}

function extrairToken(req: Request): string | null {
  const cabecalho = req.headers.authorization
  if (!cabecalho) return null
  const [tipo, valor] = cabecalho.split(' ')
  if (!valor || tipo?.toLowerCase() !== 'bearer') return null
  return valor.trim() || null
}
