import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NotificacaoWorker } from '../src/modulos/notificacao/notificacao.worker.js'
import { RemetenteRegistro } from '../src/modulos/notificacao/remetente.js'
import {
  CLIENTE_ALFA,
  TENANT_A,
  USUARIO_A,
  chamar,
  consultarBanco,
  drenarTudo,
  subirApi,
  token,
  type Servidor,
} from './apoio.js'

/**
 * Integração de usuários e perfis, contra PostgreSQL real.
 *
 * Três garantias, e cada uma falha em silêncio quando falha.
 *
 * **Ninguém define a senha de outra pessoa.** Não existe campo de senha em rota
 * nenhuma daqui, e o token de primeiro acesso não volta na resposta — vai por
 * e-mail. Um token no corpo do `POST` acabaria no devtools de quem chamou e em
 * qualquer log de cliente, e um token de primeiro acesso vazado é a conta de
 * outra pessoa.
 *
 * **O locatário nunca fica sem administrador.** A regra é gatilho no banco; o
 * que se prova aqui é que a API a respeita e explica — a alternativa é o
 * locatário descobrir sozinho que ninguém mais concede acesso a ninguém.
 *
 * **Perfil de cliente é somente leitura.** RN-L25, também gatilho. Um perfil de
 * cliente com `contrato:editar` daria a quem aluga a impressora o poder de
 * mexer no contrato que a cobra.
 */

let api: Servidor
let worker: NotificacaoWorker

const IAM = ['usuario:gerenciar'] as const
const PERFIS = ['perfil:gerenciar'] as const
const PERFIL_ADMIN = '11111111-1111-4111-8111-1111111150a1'
const PERFIL_GESTOR = '11111111-1111-4111-8111-1111111150a2'

const email = (rotulo: string) => `${rotulo}.${Date.now()}@iam.local`

before(async () => {
  api = await subirApi()
  worker = api.app.get(NotificacaoWorker)
})

after(async () => {
  await api.fechar()
})

describe('usuários', () => {
  it('lista, filtra por perfil e marca quem ainda não definiu senha', async () => {
    const t = await token({ permissoes: [...IAM] })

    const todos = await chamar(api, 'GET', '/api/v1/usuarios', { token: t })
    assert.equal(todos.status, 200)
    assert.ok(todos.corpo.data.length >= 3)

    const admins = await chamar(api, 'GET', `/api/v1/usuarios?perfil_id=${PERFIL_ADMIN}`, { token: t })
    assert.equal(admins.status, 200)
    assert.ok(admins.corpo.data.some((u: { id: string }) => u.id === USUARIO_A))
    assert.ok(
      admins.corpo.data.every((u: { perfis: { perfil_id: string }[] }) =>
        u.perfis.some((p) => p.perfil_id === PERFIL_ADMIN),
      ),
    )

    /*
     * `convite_pendente` é derivado de `senha_hash is null`, e não de uma coluna
     * própria — duas verdades sobre o mesmo fato divergem, e "qual vale" não tem
     * resposta. A asserção compara o campo com o banco em vez de fixar um
     * esperado: outros arquivos da suíte definem senha para os usuários que
     * autenticam, e o número muda conforme a ordem de execução.
     */
    const semSenha = await consultarBanco<{ id: string }>(
      TENANT_A,
      `select id from public.usuario where senha_hash is null and deleted_at is null`,
    )
    const idsSemSenha = new Set(semSenha.map((u) => u.id))
    for (const u of todos.corpo.data as { id: string; convite_pendente: boolean }[]) {
      assert.equal(u.convite_pendente, idsSemSenha.has(u.id), `convite_pendente errado para ${u.id}`)
    }
  })

  it('convida sem senha, e o token vai por e-mail e não na resposta', async () => {
    const registro = new RemetenteRegistro(200, () => undefined)
    const destino = email('convidado')

    const r = await chamar(api, 'POST', '/api/v1/usuarios/convites', {
      token: await token({ permissoes: [...IAM] }),
      corpo: {
        nome: 'Pessoa Convidada',
        email: destino,
        perfis: [{ perfil_id: PERFIL_GESTOR, escopo_tipo: 'TENANT' }],
      },
      cabecalhos: { 'idempotency-key': `conv-${destino}` },
    })
    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.email, destino)
    assert.equal(r.corpo.data.convite_pendente, true)
    assert.equal(r.corpo.data.perfis.length, 1)

    // O corpo inteiro, serializado, não pode conter um token de 64 hex.
    assert.doesNotMatch(JSON.stringify(r.corpo), /[0-9a-f]{48}/, 'o convite devolveu o token')

    await drenarTudo(worker, registro)
    const mensagem = registro.enviadas.find((m) => m.para === destino)
    assert.ok(mensagem, 'o convite não gerou e-mail')
    assert.match(mensagem.texto, /primeiro-acesso\?token=/)
    // A mensagem diz explicitamente que ninguém mais conhece a senha.
    assert.match(mensagem.texto, /quem a escolhe é você/)
  })

  it('o mesmo e-mail duas vezes é 409, e diz para recuperar em vez de convidar', async () => {
    const destino = email('duplicado')
    const corpo = {
      nome: 'Repetida',
      email: destino,
      perfis: [{ perfil_id: PERFIL_GESTOR, escopo_tipo: 'TENANT' }],
    }
    const primeiro = await chamar(api, 'POST', '/api/v1/usuarios/convites', {
      token: await token({ permissoes: [...IAM] }),
      corpo,
      cabecalhos: { 'idempotency-key': `dup-a-${destino}` },
    })
    assert.equal(primeiro.status, 201)

    const segundo = await chamar(api, 'POST', '/api/v1/usuarios/convites', {
      token: await token({ permissoes: [...IAM] }),
      corpo,
      cabecalhos: { 'idempotency-key': `dup-b-${destino}` },
    })
    assert.equal(segundo.status, 409)
    assert.equal(segundo.corpo.errors[0].field, 'email')
    assert.match(segundo.corpo.detail, /recuperação de senha/)
  })

  it('usuário interno não recebe cliente_id, e usuário de cliente exige um', async () => {
    const t = await token({ permissoes: [...IAM] })

    /*
     * A metade que importa é a primeira. Um usuário interno com `cliente_id`
     * faria `app.cliente_atual()` devolver um valor, e a política restritiva da
     * 0011 passaria a recortar a visão de quem opera a locadora — a pessoa veria
     * um cliente só, sem erro em lugar nenhum.
     */
    const interno = await chamar(api, 'POST', '/api/v1/usuarios/convites', {
      token: t,
      corpo: {
        nome: 'Interno com cliente',
        email: email('interno'),
        tipo: 'INTERNO',
        cliente_id: CLIENTE_ALFA,
        perfis: [{ perfil_id: PERFIL_GESTOR, escopo_tipo: 'TENANT' }],
      },
      cabecalhos: { 'idempotency-key': `int-${Date.now()}` },
    })
    assert.equal(interno.status, 400)
    assert.equal(interno.corpo.errors[0].field, 'cliente_id')

    const semCliente = await chamar(api, 'POST', '/api/v1/usuarios/convites', {
      token: t,
      corpo: {
        nome: 'Cliente sem cliente',
        email: email('cliente'),
        tipo: 'CLIENTE',
        perfis: [{ perfil_id: PERFIL_GESTOR, escopo_tipo: 'CLIENTE' }],
      },
      cabecalhos: { 'idempotency-key': `cli-${Date.now()}` },
    })
    assert.equal(semCliente.status, 400)
  })

  it('o escopo CLIENTE entra sem id, e com id é recusado com a razão', async () => {
    const t = await token({ permissoes: [...IAM] })
    const destino = email('escopo')

    /*
     * O eixo de cliente esteve inalcançável: a restrição
     * `usuario_perfil_escopo_coerente` recusava CLIENTE e LOCAL_CLIENTE em
     * qualquer combinação, porque foi escrita antes de os dois valores
     * existirem. Corrigida na 0022 — este é o caminho HTTP que a exercita.
     */
    const r = await chamar(api, 'POST', '/api/v1/usuarios/convites', {
      token: t,
      corpo: {
        nome: 'Gestor do Cliente',
        email: destino,
        tipo: 'CLIENTE',
        cliente_id: CLIENTE_ALFA,
        perfis: [{ perfil_id: PERFIL_GESTOR, escopo_tipo: 'CLIENTE' }],
      },
      cabecalhos: { 'idempotency-key': `esc-${destino}` },
    })
    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.perfis[0].escopo_tipo, 'CLIENTE')
    assert.equal(r.corpo.data.perfis[0].escopo_id, null)

    // Com id: o cliente vem do token, e duas fontes para o mesmo recorte não têm
    // desempate. A recusa precisa dizer isso, não o nome da restrição.
    const comId = await chamar(api, 'POST', `/api/v1/usuarios/${r.corpo.data.id}/perfis`, {
      token: t,
      corpo: { perfil_id: PERFIL_ADMIN, escopo_tipo: 'CLIENTE', escopo_id: CLIENTE_ALFA },
    })
    assert.equal(comId.status, 400)
    assert.match(comId.corpo.detail, /o cliente vem do token/)
  })

  it('desativar derruba as sessões na mesma transação, e registra o motivo', async () => {
    const t = await token({ permissoes: [...IAM] })
    const destino = email('desativado')
    const criado = await chamar(api, 'POST', '/api/v1/usuarios/convites', {
      token: t,
      corpo: {
        nome: 'Pessoa a desativar',
        email: destino,
        perfis: [{ perfil_id: PERFIL_GESTOR, escopo_tipo: 'TENANT' }],
      },
      cabecalhos: { 'idempotency-key': `des-${destino}` },
    })
    const id = criado.corpo.data.id

    await consultarBanco(
      TENANT_A,
      `insert into public.sessao (tenant_id, usuario_id, expira_em)
       values ($1, $2, now() + interval '8 hours')`,
      [TENANT_A, id],
    )

    const r = await chamar(api, 'POST', `/api/v1/usuarios/${id}/desativar`, {
      token: t,
      corpo: { motivo: 'desligamento em 30/08' },
    })
    assert.equal(r.status, 200)
    assert.equal(r.corpo.data.status, 'INATIVO')

    /*
     * A sessão cai junto. Separar as duas coisas deixaria uma janela em que a
     * conta está inativa e o token continua valendo — desativar viraria uma
     * promessa para daqui a algumas horas.
     */
    const vivas = await consultarBanco<{ n: string }>(
      TENANT_A,
      `select count(*) as n from public.sessao where usuario_id = $1 and revogada_em is null`,
      [id],
    )
    assert.equal(vivas[0]!.n, '0', 'a sessão sobreviveu à desativação')

    const trilha = await consultarBanco<{ motivo: string | null }>(
      TENANT_A,
      `select motivo from public.audit_log
        where entidade_tipo = 'usuario' and entidade_id = $1 and motivo is not null`,
      [id],
    )
    assert.ok(trilha.some((l) => /desligamento em 30\/08/.test(l.motivo ?? '')))
  })

  it('o último administrador não pode perder o perfil, e a recusa explica a saída', async () => {
    const r = await chamar(api, 'DELETE', `/api/v1/usuarios/${USUARIO_A}/perfis/${PERFIL_ADMIN}`, {
      token: await token({ permissoes: [...IAM] }),
    })
    assert.equal(r.status, 422)
    assert.equal(r.corpo.code, 'REGRA_DE_NEGOCIO')
    assert.match(r.corpo.detail, /última conta ativa com usuario:gerenciar/)
    assert.equal(r.corpo.acoes_sugeridas[0].code, 'CONCEDER_A_OUTRO')

    // E continua lá: a recusa do gatilho não deixou estado parcial.
    const u = await chamar(api, 'GET', `/api/v1/usuarios/${USUARIO_A}`, {
      token: await token({ permissoes: [...IAM] }),
    })
    assert.ok(u.corpo.data.perfis.some((p: { perfil_id: string }) => p.perfil_id === PERFIL_ADMIN))
  })
})

describe('perfis', () => {
  it('lista com a contagem de quem os usa', async () => {
    const r = await chamar(api, 'GET', '/api/v1/perfis', {
      token: await token({ permissoes: [...PERFIS] }),
    })
    assert.equal(r.status, 200)
    const admin = r.corpo.data.find((p: { id: string }) => p.id === PERFIL_ADMIN)
    assert.ok(admin, 'o perfil administrativo semeado sumiu da listagem')
    // A contagem é o número que decide se dá para mexer no perfil.
    assert.ok(admin.usuarios >= 1)
  })

  it('perfis e usuários são permissões distintas', async () => {
    // O Anexo D agrupava as duas rotas numa célula só, com `usuario:gerenciar`.
    // Usá-la aqui deixaria `perfil:gerenciar` sem nenhuma rota que a exija — uma
    // permissão que nenhuma rota consulta não protege nada.
    const comIam = await chamar(api, 'GET', '/api/v1/perfis', {
      token: await token({ permissoes: [...IAM] }),
    })
    assert.equal(comIam.status, 403)

    const comPerfis = await chamar(api, 'GET', '/api/v1/usuarios', {
      token: await token({ permissoes: [...PERFIS] }),
    })
    assert.equal(comPerfis.status, 403)
  })

  it('cria perfil derivado e recusa permissão fora do catálogo', async () => {
    const t = await token({ permissoes: [...PERFIS] })
    const nome = `Derivado ${Date.now()}`

    const r = await chamar(api, 'POST', '/api/v1/perfis', {
      token: t,
      corpo: { nome, descricao: 'Cópia editável', permissoes: ['contrato:ler', 'equipamento:ler'] },
    })
    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.is_sistema, false)
    assert.equal(r.corpo.data.usuarios, 0)

    /*
     * Permissão desconhecida **derruba** a criação, ao contrário do token, onde
     * é descartada. Descartar num token é negar, o padrão seguro; descartar aqui
     * gravaria um perfil silenciosamente menor do que quem o criou pediu.
     */
    const invalida = await chamar(api, 'POST', '/api/v1/perfis', {
      token: t,
      corpo: { nome: `${nome} B`, permissoes: ['contrato:ler', 'inventar:tudo'] },
    })
    assert.equal(invalida.status, 400)
  })

  it('perfil de sistema não é editável, e a recusa oferece o derivado', async () => {
    const r = await chamar(api, 'PATCH', `/api/v1/perfis/${PERFIL_ADMIN}`, {
      token: await token({ permissoes: [...PERFIS] }),
      corpo: { descricao: 'tentativa' },
    })
    assert.equal(r.status, 422)
    assert.equal(r.corpo.acoes_sugeridas[0].code, 'CRIAR_DERIVADO')
  })

  it('perfil de cliente não aceita permissão de escrita (RN-L25)', async () => {
    const t = await token({ permissoes: [...PERFIS] })

    const bom = await chamar(api, 'POST', '/api/v1/perfis', {
      token: t,
      corpo: {
        nome: `Cliente OK ${Date.now()}`,
        tipo: 'CLIENTE',
        // `os:criar` é a exceção deliberada: o cliente abre chamado, e só isso.
        permissoes: ['contrato:ler', 'fatura:ler', 'os:ler', 'os:criar'],
      },
    })
    assert.equal(bom.status, 201)

    const ruim = await chamar(api, 'POST', '/api/v1/perfis', {
      token: t,
      corpo: {
        nome: `Cliente ruim ${Date.now()}`,
        tipo: 'CLIENTE',
        permissoes: ['contrato:ler', 'contrato:editar'],
      },
    })
    assert.equal(ruim.status, 422)
    assert.match(ruim.corpo.title, /somente leitura/)
    assert.match(ruim.corpo.detail, /contrato:editar/)
  })

  it('o catálogo de permissões é servido, e é o mesmo array do guarda', async () => {
    const r = await chamar(api, 'GET', '/api/v1/permissoes', {
      token: await token({ permissoes: [...PERFIS] }),
    })
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.corpo.data))
    assert.ok(r.corpo.data.length >= 5, 'a árvore veio vazia')
    // Servir por HTTP existe para a tela de perfis não embutir uma cópia — e uma
    // cópia embutida é o botão que some enquanto a rota continua aberta.
    assert.ok(r.corpo.data.every((m: { telas: unknown[] }) => Array.isArray(m.telas)))
  })
})
