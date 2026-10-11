import { createRemoteJWKSet, jwtVerify } from 'jose'
import { ErroDominio } from '../../comum/erros.js'

/**
 * Verificação do ID token do Google.
 *
 * O que este módulo estabelece é **uma** coisa: que a pessoa do outro lado
 * controla uma conta Google cujo e-mail o Google diz ter verificado. Nada além.
 * Quem ela é no IARX, o que pode fazer e a que locatário pertence continuam
 * saindo do `usuario` convidado — o Google prova identidade, nunca autorização.
 *
 * A distinção não é filosófica. Um ID token válido é fácil de obter: qualquer
 * pessoa com uma conta Google tem um. Se a posse do token bastasse para entrar,
 * o sistema inteiro teria como porta de acesso "ter e-mail".
 *
 * ## Por que verificar, e não só decodificar
 *
 * JWT é assinado, não cifrado: qualquer um escreve um com as claims que
 * quiser. `JSON.parse(atob(partes[1]))` lê o conteúdo e **não verifica nada** —
 * é o erro que transforma autenticação em formulário de autodeclaração, e
 * aparece com frequência exatamente porque o resultado parece certo em todos os
 * testes feitos com tokens de verdade.
 *
 * Aqui a assinatura é conferida contra as chaves públicas do Google, buscadas
 * do endereço que o próprio Google publica e mantidas em cache por `jose` com o
 * respeito ao `Cache-Control` da resposta — rotação de chave funciona sozinha.
 */

/** Emissores aceitos. O Google usa as duas formas, e as duas são legítimas. */
const EMISSORES = ['https://accounts.google.com', 'accounts.google.com']

/** Emissor canônico — é o que vai para `usuario.emissor_oidc`. */
export const EMISSOR_GOOGLE = 'https://accounts.google.com'

const JWKS_GOOGLE = 'https://www.googleapis.com/oauth2/v3/certs'

export interface IdentidadeGoogle {
  /** Claim `sub` — string numérica, estável e imutável para a conta. */
  subject: string
  email: string
  nome: string | null
}

export interface ConfigGoogle {
  clientId: string
}

/**
 * Lê a configuração do provedor. Ausente significa "sem Google nesta
 * instalação" — não é erro, é uma instalação que ainda usa senha.
 */
export function configGoogle(): ConfigGoogle | null {
  const clientId = process.env.IARX_GOOGLE_CLIENT_ID?.trim()
  return clientId ? { clientId } : null
}

/*
 * Um conjunto de chaves por processo.
 *
 * `createRemoteJWKSet` traz cache e coalescência de requisições concorrentes:
 * criar um por login faria cada entrada buscar as chaves do Google de novo, o
 * que é lento, desnecessário e um jeito eficiente de ser limitado por taxa
 * justo no horário em que todo mundo entra.
 */
let chaves: ReturnType<typeof createRemoteJWKSet> | null = null

function jwksGoogle() {
  chaves ??= createRemoteJWKSet(new URL(JWKS_GOOGLE))
  return chaves
}

/** Só para teste: permite injetar o conjunto de chaves e não ir à rede. */
export function usarChavesDeTeste(fn: ReturnType<typeof createRemoteJWKSet> | null): void {
  chaves = fn
}

function recusar(detail: string): never {
  /*
   * Recusa uniforme, pelo mesmo motivo do login por senha: a mensagem não
   * diferencia "assinatura inválida" de "e-mail não verificado" de "expirado".
   * Diferenciar entregaria, de graça, um oráculo para calibrar tentativas.
   *
   * `detail` existe para o log do servidor, não para a resposta — quem o lê é
   * quem já tem acesso ao servidor.
   */
  throw new ErroDominio('NAO_AUTENTICADO', 'Não foi possível validar a conta Google', {
    status: 401,
    detail: 'Entre novamente pelo botão do Google.',
    acoes: [{ code: 'ENTRAR_GOOGLE', descricao: 'Entrar novamente com Google' }],
    causa: detail,
  })
}

/**
 * Verifica o ID token e devolve a identidade que ele sustenta.
 *
 * Levanta `NAO_AUTENTICADO` para qualquer falha — assinatura, emissor,
 * audiência, validade ou e-mail não verificado.
 */
export async function verificarIdToken(
  credential: string,
  config: ConfigGoogle,
): Promise<IdentidadeGoogle> {
  let claims: Record<string, unknown>

  try {
    const { payload } = await jwtVerify(credential, jwksGoogle(), {
      issuer: EMISSORES,
      /*
       * `audience` é a checagem que impede o ataque mais fácil contra este
       * fluxo: um ID token legítimo, emitido pelo Google para **outro**
       * aplicativo, assinado com a mesma chave e portanto válido na
       * assinatura. Sem conferir para quem o token foi emitido, qualquer site
       * com login Google passa a emitir credenciais para este aqui.
       */
      audience: config.clientId,
      algorithms: ['RS256'],
      clockTolerance: 30,
    })
    claims = payload as Record<string, unknown>
  } catch (e) {
    recusar(`verificação falhou: ${e instanceof Error ? e.message : String(e)}`)
  }

  const subject = typeof claims.sub === 'string' ? claims.sub : null
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null
  const nome = typeof claims.name === 'string' ? claims.name : null

  if (!subject) recusar('token sem `sub`')
  if (!email) recusar('token sem `email`')

  /*
   * `email_verified` é condição, não enfeite.
   *
   * Sem ela, uma conta Google criada com o e-mail corporativo de outra pessoa
   * — e não confirmado — casaria com o convite dessa pessoa. O vínculo entre
   * identidade e convite é o e-mail, então o e-mail precisa ser afirmado pelo
   * Google, não digitado por quem está entrando.
   */
  if (claims.email_verified !== true) recusar('e-mail não verificado pelo Google')

  return { subject, email, nome }
}
