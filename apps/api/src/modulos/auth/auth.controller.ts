import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common'
import { Login, RedefinirSenha, SolicitarRecuperacao, TrocarSenha } from '@iarx/contracts'
import type { Request } from 'express'
import { EscopoProprio, Publico } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { AuthService } from './auth.service.js'

/**
 * `AUTH` — Entrada no sistema.
 *
 * Quatro rotas públicas, e "público" aqui é decisão explícita marcada com
 * `@Publico()` — o guarda global nega por omissão, então esquecer o decorador
 * fecharia a rota, não a abriria. É o lado certo do erro para um sistema de
 * autenticação.
 *
 * Nenhuma delas confirma se um e-mail existe. Login, recuperação e redefinição
 * respondem igual para conta existente e inexistente, porque a diferença é
 * exatamente o que transformaria estas rotas em enumerador da base de clientes.
 */
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly servico: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Publico()
  login(@Body(validar(Login)) corpo: Login, @Req() req: Request) {
    return this.servico.login(corpo, ipDe(req), req.headers['user-agent'] ?? null)
  }

  /**
   * Recuperação de senha.
   *
   * 202, e não 200: a resposta significa "recebemos o pedido", nunca
   * "encontramos a conta". A diferença de código é coerente com a mensagem
   * neutra — as duas dizem a mesma coisa, e nenhuma revela nada.
   */
  @Post('recuperacao')
  @HttpCode(202)
  @Publico()
  async solicitarRecuperacao(
    @Body(validar(SolicitarRecuperacao)) corpo: SolicitarRecuperacao,
    @Req() req: Request,
  ) {
    await this.servico.solicitarRecuperacao(corpo, ipDe(req))
    return {
      mensagem: 'Se houver uma conta com este e-mail, enviamos as instruções de recuperação.',
    }
  }

  @Post('recuperacao/redefinir')
  @HttpCode(200)
  @Publico()
  async redefinir(@Body(validar(RedefinirSenha)) corpo: RedefinirSenha) {
    await this.servico.redefinirSenha(corpo)
    return { mensagem: 'Senha redefinida. As sessões abertas foram encerradas.' }
  }

  /**
   * Troca de senha pelo próprio usuário.
   *
   * `@EscopoProprio()` em vez de `@ExigePermissao(...)`: trocar a **própria**
   * senha é direito de qualquer usuário, e amarrá-la a uma permissão criaria a
   * situação absurda de um perfil incapaz de trocar a senha que usa para
   * entrar. A guarda continua exigindo autenticação; o serviço opera sobre
   * `claims.usuario_id`, nunca sobre um id vindo do corpo.
   */
  @Post('senha')
  @HttpCode(200)
  @EscopoProprio()
  async trocarSenha(@Body(validar(TrocarSenha)) corpo: TrocarSenha) {
    await this.servico.trocarSenha(corpo)
    return { mensagem: 'Senha alterada. As demais sessões foram encerradas.' }
  }
}

/**
 * IP do solicitante.
 *
 * `x-forwarded-for` primeiro porque a API roda atrás de proxy; sem isso todo
 * registro de acesso apontaria para o balanceador, e o log de "quem tentou
 * entrar às 3h" perderia justamente o dado que importa.
 */
function ipDe(req: Request): string | null {
  const encaminhado = req.headers['x-forwarded-for']
  if (typeof encaminhado === 'string' && encaminhado.trim() !== '') {
    return encaminhado.split(',')[0]!.trim()
  }
  return req.ip ?? null
}
