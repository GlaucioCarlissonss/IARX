import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chamar, subirApi, token, USUARIO_A, type Servidor } from './apoio.js'

/**
 * Autenticação própria, contra PostgreSQL real.
 *
 * O que estes testes existem para provar, em uma frase: **nenhuma resposta
 * revela se um e-mail existe**. É a propriedade que separa um endpoint de
 * login de um enumerador de base de clientes, e ela se perde por descuido —
 * uma mensagem mais prestativa, um código de status diferente, um caminho que
 * responde mais rápido.
 *
 * A senha semeada está em `semear.sql`; o hash é Argon2id de verdade, então o
 * caminho feliz exercita a verificação real e não um atalho de teste.
 */

let api: Servidor
const SENHA = 'senha-de-teste-12345'
const EMAIL = 'operador@alfa.local'

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('login', () => {
  it('entra com credencial correta e devolve token utilizável', async () => {
    const r = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: EMAIL, senha: SENHA },
    })

    assert.equal(r.status, 200)
    assert.ok(r.corpo.data.token)
    assert.equal(r.corpo.data.usuario.email, EMAIL)
    assert.equal(r.corpo.data.usuario.tipo, 'INTERNO')

    // As permissões vêm do perfil atribuído, não de uma lista fixa.
    assert.ok(r.corpo.data.permissoes.includes('usuario:gerenciar'))

    // O token emitido precisa funcionar de fato — emitir um token que a
    // própria guarda recusa seria um defeito invisível até o primeiro uso.
    const uso = await chamar(api, 'GET', '/api/v1/contratos', { token: r.corpo.data.token })
    assert.equal(uso.status, 200)
  })

  it('a senha nunca volta na resposta, em nenhum campo', async () => {
    const r = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: EMAIL, senha: SENHA },
    })

    const corpo = JSON.stringify(r.corpo)
    assert.equal(corpo.includes(SENHA), false, 'a senha apareceu na resposta')
    assert.equal(corpo.includes('argon2'), false, 'o hash apareceu na resposta')
  })

  it('e-mail inexistente e senha errada dão a MESMA resposta', async () => {
    // É o teste central deste arquivo. Qualquer diferença — mensagem, código,
    // campo extra — transforma o endpoint em enumerador da base de clientes.
    const inexistente = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: 'ninguem@lugar-nenhum.local', senha: 'qualquer-coisa-longa' },
    })
    const senhaErrada = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: EMAIL, senha: 'esta-nao-e-a-senha' },
    })

    assert.equal(inexistente.status, senhaErrada.status)
    assert.equal(inexistente.status, 401)
    assert.equal(inexistente.corpo.title, senhaErrada.corpo.title)
    assert.equal(inexistente.corpo.detail, senhaErrada.corpo.detail)
    assert.equal(inexistente.corpo.code, senhaErrada.corpo.code)
  })

  it('usuário sem senha definida recusa pelo mesmo caminho', async () => {
    // Convidado que ainda não aceitou. Se respondesse diferente, o endpoint
    // diria quais e-mails têm convite pendente.
    const r = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: 'compras@alfa.local', senha: SENHA },
    })
    const senhaErrada = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: EMAIL, senha: 'esta-nao-e-a-senha' },
    })

    assert.equal(r.status, 401)
    assert.equal(r.corpo.detail, senhaErrada.corpo.detail)
  })

  it('recusa corpo malformado antes de tocar no banco', async () => {
    const r = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: 'nao-e-email', senha: '' },
    })
    assert.equal(r.status, 400)
    assert.equal(r.corpo.code, 'PAYLOAD_INVALIDO')
  })

  it('o token carrega o eixo de cliente, nulo para usuário interno', async () => {
    const r = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: EMAIL, senha: SENHA },
    })

    const payload = JSON.parse(Buffer.from(r.corpo.data.token.split('.')[1]!, 'base64url').toString())
    // Ausente ou nulo, nunca "todos": um valor curinga aqui seria a porta para
    // um usuário de cliente pedir a visão do locador.
    assert.equal(payload.cliente_id ?? null, null)
    assert.ok(payload.sessao_id, 'sem sessao_id não há como revogar o acesso')
    assert.equal(payload.tenant_id, '11111111-1111-4111-8111-111111111111')
  })
})

describe('bloqueio por tentativa', () => {
  it('bloqueia após o limite e a mensagem não confirma que a conta existe', async () => {
    const alvo = 'operador@beta.local'
    let ultima
    // O tenant semeado usa a política padrão: 5 tentativas.
    for (let i = 0; i < 6; i += 1) {
      ultima = await chamar(api, 'POST', '/api/v1/auth/login', {
        corpo: { email: alvo, senha: 'senha-errada-de-proposito' },
      })
    }

    assert.equal(ultima!.status, 401)
    assert.match(ultima!.corpo.title, /bloqueada/i)
    // A frase fala de tentativas, não de conta encontrada — a mesma resposta
    // sairia para um e-mail que não existisse, porque o bloqueio é decidido
    // antes de sabermos se a senha estava certa.
    assert.equal(ultima!.corpo.detail.includes(alvo), false)

    // Bloqueado, nem a senha certa entra.
    const comSenhaCerta = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: alvo, senha: 'senha-de-teste-12345' },
    })
    assert.equal(comSenhaCerta.status, 401)
    assert.match(comSenhaCerta.corpo.title, /bloqueada/i)
  })
})

describe('recuperação de senha', () => {
  it('responde igual para e-mail existente e inexistente', async () => {
    // RN-L28. Sem isto, o endpoint público mais fácil de achar do sistema vira
    // um verificador de e-mails cadastrados.
    const existe = await chamar(api, 'POST', '/api/v1/auth/recuperacao', {
      corpo: { email: EMAIL },
    })
    const naoExiste = await chamar(api, 'POST', '/api/v1/auth/recuperacao', {
      corpo: { email: 'ninguem@lugar-nenhum.local' },
    })

    assert.equal(existe.status, 202)
    assert.equal(naoExiste.status, 202)
    assert.deepEqual(existe.corpo.data, naoExiste.corpo.data)
  })

  it('token inválido não redefine nada', async () => {
    const r = await chamar(api, 'POST', '/api/v1/auth/recuperacao/redefinir', {
      corpo: { token: 'token-que-nunca-existiu', senha_nova: 'uma-senha-nova-longa' },
    })
    assert.equal(r.status, 401)

    // E a senha antiga continua valendo.
    const login = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: EMAIL, senha: SENHA },
    })
    assert.equal(login.status, 200)
  })
})

describe('sessão', () => {
  it('token sem sessão viva é recusado como token inválido', async () => {
    // O caminho que torna a revogação real. Um `sessao_id` que não existe
    // simula a sessão revogada; a resposta é a mesma de token inválido, de
    // propósito: dizer "sua sessão foi revogada" informa a quem roubou o token
    // que alguém percebeu.
    const forjado = await token({
      permissoes: ['contrato:ler'],
      extras: { sessao_id: '11111111-1111-4111-8111-1111111199a9' },
    })

    const r = await chamar(api, 'GET', '/api/v1/contratos', { token: forjado })
    assert.equal(r.status, 401)
    assert.equal(r.corpo.code, 'TOKEN_INVALIDO')
  })

  it('token sem sessao_id continua válido, para conta de serviço', async () => {
    // Integração (Anexo C.7) não tem sessão de usuário atrás; é revogada
    // girando a chave. Exigir sessão quebraria toda integração existente.
    const servico = await token({ permissoes: ['contrato:ler'] })
    const r = await chamar(api, 'GET', '/api/v1/contratos', { token: servico })
    assert.equal(r.status, 200)
  })
})

describe('troca da própria senha', () => {
  it('exige autenticação, mas não permissão de catálogo', async () => {
    // Um perfil sem `usuario:gerenciar` precisa conseguir trocar a própria
    // senha — o contrário seria um usuário incapaz de trocar a senha que usa
    // para entrar.
    const semPermissao = await token({ permissoes: [] })
    const r = await chamar(api, 'POST', '/api/v1/auth/senha', {
      token: semPermissao,
      corpo: { senha_atual: 'errada', senha_nova: 'uma-senha-nova-bem-longa' },
    })

    // 401 pela senha atual errada, não 403 por falta de permissão: chegou ao
    // serviço, que é o que este teste verifica.
    assert.equal(r.status, 401)
    assert.match(r.corpo.title, /[Ss]enha atual/)
  })

  it('sem token nenhum, recusa', async () => {
    const r = await chamar(api, 'POST', '/api/v1/auth/senha', {
      corpo: { senha_atual: 'x', senha_nova: 'uma-senha-nova-bem-longa' },
    })
    assert.equal(r.status, 401)
  })

  it('recusa senha nova abaixo do mínimo, sem chegar ao banco', async () => {
    const t = await token({ usuario: USUARIO_A, permissoes: [] })
    const r = await chamar(api, 'POST', '/api/v1/auth/senha', {
      token: t,
      corpo: { senha_atual: SENHA, senha_nova: 'curta' },
    })
    assert.equal(r.status, 400)
    assert.equal(r.corpo.code, 'PAYLOAD_INVALIDO')
  })

  it('troca a senha, revoga sessões e a senha antiga para de valer', async () => {
    const NOVA = 'senha-nova-do-teste-98765'

    const entrada = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: EMAIL, senha: SENHA },
    })
    assert.equal(entrada.status, 200)

    const troca = await chamar(api, 'POST', '/api/v1/auth/senha', {
      token: entrada.corpo.data.token,
      corpo: { senha_atual: SENHA, senha_nova: NOVA },
    })
    assert.equal(troca.status, 200)

    // A senha antiga morre.
    const antiga = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: EMAIL, senha: SENHA },
    })
    assert.equal(antiga.status, 401)

    // A nova funciona.
    const nova = await chamar(api, 'POST', '/api/v1/auth/login', {
      corpo: { email: EMAIL, senha: NOVA },
    })
    assert.equal(nova.status, 200)

    // E o token emitido antes da troca deixa de valer — é o ponto inteiro de
    // revogar sessões ao trocar a senha. Sem isso, quem trocou a senha porque
    // desconfia de acesso indevido continuaria com o intruso dentro.
    const tokenVelho = await chamar(api, 'GET', '/api/v1/contratos', {
      token: entrada.corpo.data.token,
    })
    assert.equal(tokenVelho.status, 401)

    // Restaura, para não deixar a massa em estado que confunda outra suíte.
    const restaurar = await chamar(api, 'POST', '/api/v1/auth/senha', {
      token: nova.corpo.data.token,
      corpo: { senha_atual: NOVA, senha_nova: SENHA },
    })
    assert.equal(restaurar.status, 200)
  })
})
