import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, SignJWT } from 'jose'
import { chamar, consultarBanco, subirApi, TENANT_A, type Servidor } from './apoio.js'
import { usarChavesDeTeste } from '../src/modulos/auth/google.js'

/**
 * Entrada pelo Google, contra PostgreSQL real e sem tocar a rede.
 *
 * A assinatura é conferida de verdade: o teste gera um par de chaves RSA,
 * assina o ID token com a privada e injeta a pública no lugar do conjunto de
 * chaves do Google. O que fica de fora é só se o servidor do Google está no
 * ar — que nenhum teste deveria afirmar. Todo o resto é exercitado: assinatura,
 * emissor, audiência, validade, `email_verified`, e a regra que sustenta o
 * fluxo inteiro.
 *
 * Essa regra, em uma frase: **o Google prova quem a pessoa é, nunca o que ela
 * pode fazer.** Um ID token válido é trivial de obter — qualquer pessoa com
 * conta Google tem um. Se a posse do token bastasse, a porta de acesso ao
 * sistema passaria a ser "ter e-mail", e é esse o defeito que a maior parte
 * destes casos existe para impedir.
 */

const CLIENT_ID = '000000000000-teste.apps.googleusercontent.com'
const EMISSOR = 'https://accounts.google.com'

/*
 * Usuário com perfil atribuído, de propósito.
 *
 * A primeira versão usava `compras@alfa.local`, que a massa semeia **sem
 * perfil** — e a asserção "o token emitido funciona" reprovava com 403. O
 * código estava certo: entrar e poder são coisas diferentes, e o 403 era
 * exatamente a separação funcionando. Mas o caso perdia o que queria provar,
 * que é o token servir para alguma coisa depois de emitido.
 */
const EMAIL_CONVIDADO = 'operador@alfa.local'
const USUARIO_CONVIDADO = '11111111-1111-4111-8111-111111110001'

let api: Servidor
type Chave = Awaited<ReturnType<typeof generateKeyPair>>['privateKey']

let publica: Chave
let privada: Chave

interface Claims {
  sub?: string
  email?: string | null
  email_verified?: boolean
  aud?: string
  iss?: string
  nome?: string
  expiraEm?: string
}

async function idToken(c: Claims = {}): Promise<string> {
  const corpo: Record<string, unknown> = {
    email_verified: c.email_verified ?? true,
    name: c.nome ?? 'Operador Alfa',
  }
  if (c.email !== null) corpo.email = c.email ?? EMAIL_CONVIDADO

  return new SignJWT(corpo)
    .setProtectedHeader({ alg: 'RS256', kid: 'teste' })
    .setSubject(c.sub ?? '110169484474386276334')
    .setIssuer(c.iss ?? EMISSOR)
    .setAudience(c.aud ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(c.expiraEm ?? '10m')
    .sign(privada)
}

/** Desfaz o vínculo para o caso seguinte partir de um usuário recém-convidado. */
async function desvincular(): Promise<void> {
  await consultarBanco(
    TENANT_A,
    `update public.usuario
        set subject_oidc = null, emissor_oidc = null, email = $2
      where id = $1`,
    [USUARIO_CONVIDADO, EMAIL_CONVIDADO],
  )
}

before(async () => {
  process.env.IARX_GOOGLE_CLIENT_ID = CLIENT_ID
  const par = await generateKeyPair('RS256')
  publica = par.publicKey
  privada = par.privateKey
  // O resolvedor de `jose` recebe (cabeçalho, token) e devolve a chave; aqui
  // devolve sempre a mesma, que é o que torna o teste determinístico.
  usarChavesDeTeste((async () => publica) as never)
  api = await subirApi()
})

after(async () => {
  usarChavesDeTeste(null)
  delete process.env.IARX_GOOGLE_CLIENT_ID
  await api.fechar()
})

afterEach(desvincular)

describe('entrada pelo Google', () => {
  it('convidado entra, e o token emitido funciona de verdade', async () => {
    const r = await chamar(api, 'POST', '/api/v1/auth/google', {
      corpo: { credential: await idToken() },
    })

    assert.equal(r.status, 200)
    assert.equal(r.corpo.data.usuario.email, EMAIL_CONVIDADO)

    // Não existe senha neste caminho, então não há o que trocar.
    assert.equal(r.corpo.data.deve_trocar_senha, false)

    // Emitir um token que a própria guarda recusa seria defeito invisível até
    // o primeiro uso — a mesma verificação que o login por senha faz.
    const uso = await chamar(api, 'GET', '/api/v1/contratos', { token: r.corpo.data.token })
    assert.equal(uso.status, 200)
  })

  it('o vínculo se estabelece no primeiro acesso e reconhece pelo subject depois', async () => {
    const primeiro = await chamar(api, 'POST', '/api/v1/auth/google', {
      corpo: { credential: await idToken() },
    })
    assert.equal(primeiro.status, 200)

    /*
     * Segunda entrada com o mesmo `sub` e **outro e-mail**: tem de reconhecer.
     * É o caso real de renomeação de caixa ou troca de domínio do locatário —
     * sem o vínculo pelo subject, a equipe inteira viraria desconhecida no
     * mesmo dia.
     */
    const depois = await chamar(api, 'POST', '/api/v1/auth/google', {
      corpo: { credential: await idToken({ email: 'operador.novo@alfa.local' }) },
    })
    assert.equal(depois.status, 200)
    assert.equal(depois.corpo.data.usuario.id, primeiro.corpo.data.usuario.id)
  })

  it('conta Google não convidada é recusada', async () => {
    const r = await chamar(api, 'POST', '/api/v1/auth/google', {
      corpo: { credential: await idToken({ email: 'ninguem@exemplo.com', sub: '999' }) },
    })
    assert.equal(r.status, 401)
    assert.equal(r.corpo.code, 'NAO_AUTENTICADO')
  })

  it('e-mail convidado já vinculado a outra conta Google é recusado', async () => {
    await chamar(api, 'POST', '/api/v1/auth/google', { corpo: { credential: await idToken() } })

    /*
     * Endereço reaproveitado: a pessoa saiu e a caixa passou a outra. Deixar
     * entrar daria ao sucessor o histórico e o escopo do antecessor — o
     * caminho certo é um convite novo.
     */
    const outra = await chamar(api, 'POST', '/api/v1/auth/google', {
      corpo: { credential: await idToken({ sub: '777777777777777777777' }) },
    })
    assert.equal(outra.status, 401)
  })

  it('e-mail não verificado pelo Google é recusado', async () => {
    /*
     * Sem esta recusa, uma conta Google criada com o e-mail corporativo de
     * outra pessoa — e não confirmado — casaria com o convite dessa pessoa.
     */
    const r = await chamar(api, 'POST', '/api/v1/auth/google', {
      corpo: { credential: await idToken({ email_verified: false }) },
    })
    assert.equal(r.status, 401)
  })

  it('token emitido para outro aplicativo é recusado', async () => {
    /*
     * O ataque mais fácil contra este fluxo, e o que a conferência de
     * audiência existe para fechar: um ID token legítimo, assinado pelo Google
     * com a mesma chave, mas emitido para outro cliente. Sem conferir `aud`,
     * qualquer site com login Google passa a emitir credenciais para este.
     */
    const r = await chamar(api, 'POST', '/api/v1/auth/google', {
      corpo: { credential: await idToken({ aud: 'outro-app.apps.googleusercontent.com' }) },
    })
    assert.equal(r.status, 401)
  })

  it('token de outro emissor é recusado', async () => {
    const r = await chamar(api, 'POST', '/api/v1/auth/google', {
      corpo: { credential: await idToken({ iss: 'https://login.exemplo.com' }) },
    })
    assert.equal(r.status, 401)
  })

  it('token expirado é recusado', async () => {
    const r = await chamar(api, 'POST', '/api/v1/auth/google', {
      corpo: { credential: await idToken({ expiraEm: '-1m' }) },
    })
    assert.equal(r.status, 401)
  })

  it('token não assinado pela chave do provedor é recusado', async () => {
    /*
     * O caso que separa verificar de decodificar. Este token tem claims
     * perfeitas — e-mail convidado, audiência certa, emissor certo — e é
     * assinado por outra chave. Quem só decodifica o payload deixa entrar.
     */
    const outroPar = await generateKeyPair('RS256')
    const forjado = await new SignJWT({ email: EMAIL_CONVIDADO, email_verified: true })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('110169484474386276334')
      .setIssuer(EMISSOR)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(outroPar.privateKey)

    const r = await chamar(api, 'POST', '/api/v1/auth/google', { corpo: { credential: forjado } })
    assert.equal(r.status, 401)
  })

  it('a recusa não diferencia não convidado de inativo de vinculado a outro', async () => {
    /*
     * A propriedade que separa um endpoint de entrada de um enumerador de
     * base: as três recusas dizem exatamente a mesma coisa. Basta uma lista de
     * palpites e ler a diferença entre as respostas para descobrir quem
     * trabalha aqui.
     */
    const naoConvidado = await chamar(api, 'POST', '/api/v1/auth/google', {
      corpo: { credential: await idToken({ email: 'ninguem@exemplo.com', sub: '999' }) },
    })
    await chamar(api, 'POST', '/api/v1/auth/google', { corpo: { credential: await idToken() } })
    const jaVinculado = await chamar(api, 'POST', '/api/v1/auth/google', {
      corpo: { credential: await idToken({ sub: '888888888888888888888' }) },
    })

    assert.equal(naoConvidado.status, jaVinculado.status)
    assert.equal(naoConvidado.corpo.code, jaVinculado.corpo.code)
    assert.equal(naoConvidado.corpo.detail, jaVinculado.corpo.detail)
  })
})

describe('a senha fecha onde há provedor', () => {
  it('login por senha é recusado com caminho para o Google', async () => {
    /*
     * Senha que sobrevive ao lado do provedor é porta alternativa com fatores
     * mais fracos: quem adota o Google para eliminar a senha não ganha nada se
     * a senha continuar valendo, e quem ataca escolhe a porta que preferir.
     */
    const r = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: EMAIL_CONVIDADO, senha: 'senha-de-teste-12345' },
    })

    assert.equal(r.status, 401)
    assert.ok(
      JSON.stringify(r.corpo).includes('Google'),
      'a recusa precisa dizer por onde entrar — bloqueio sem saída vira chamado',
    )
  })

  it('recuperação de senha é recusada: quem recupera a conta é o Google', async () => {
    const r = await chamar(api, 'POST', '/api/v1/auth/recuperacao', {
      corpo: { email: EMAIL_CONVIDADO },
    })
    assert.equal(r.status, 401)
  })
})
