import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { possuiPermissao, type Permissao } from '@iarx/contracts'
import { CHAVE_PERMISSAO, CHAVE_PUBLICO } from './decoradores.js'
import { contextoAtual } from './contexto.js'
import { ErroDominio } from './erros.js'

/**
 * Autorização por permissão declarada na rota.
 *
 * A regra que dá segurança a este arquivo: **rota autenticada sem `@Permissao`
 * é recusada**. Não é preciosismo — a falha mais comum em autorização não é a
 * regra errada, é a regra esquecida, e uma rota nova sem decorador ficaria
 * aberta a qualquer usuário autenticado, de qualquer perfil, sem nenhum sinal.
 * Aqui ela devolve 403 na primeira chamada e o defeito aparece no primeiro
 * teste em vez de em um incidente.
 *
 * Escopo organizacional (FILIAL, REGIAO, PROPRIO) não é decidido aqui: ele é
 * predicado de linha, e é imposto pelas políticas de RLS junto com o tenant.
 * Reimplementá-lo em memória criaria uma segunda verdade.
 */
@Injectable()
export class PermissaoGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const publico = this.reflector.getAllAndOverride<boolean>(CHAVE_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ])
    if (publico) return true

    const exigida = this.reflector.getAllAndOverride<Permissao | undefined>(CHAVE_PERMISSAO, [
      contexto.getHandler(),
      contexto.getClass(),
    ])

    if (!exigida) {
      throw new ErroDominio('SEM_PERMISSAO', 'Rota sem permissão declarada', {
        detail: 'Esta rota não declara a permissão exigida e por isso é negada (RN-026).',
      })
    }

    const claims = contextoAtual()?.claims
    if (!claims) {
      throw new ErroDominio('NAO_AUTENTICADO', 'Autenticação obrigatória')
    }

    if (!possuiPermissao(claims.permissoes, exigida)) {
      throw new ErroDominio('SEM_PERMISSAO', 'Permissão insuficiente', {
        detail: `Esta operação exige a permissão ${exigida}.`,
        errors: [{ field: 'permissoes', code: 'PERMISSAO_AUSENTE', meta: { exigida } }],
      })
    }

    return true
  }
}
