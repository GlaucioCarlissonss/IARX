/**
 * O transporte HTTP, exercitado sem rede.
 *
 * Tudo o que importa aqui é decisão local: o que vira `ErroApi` e com que
 * código, o que acontece quando não há API configurada, onde o token mora e o
 * que **nunca** é enviado. Nada disso precisa de servidor, e testar contra um
 * servidor de verdade trocaria o teste por uma aposta.
 *
 * `fetch` é substituído por uma função que registra o que recebeu. É o que
 * permite afirmar coisas que nenhum teste de integração afirmaria com a mesma
 * clareza — que a requisição sai sem cookie, por exemplo.
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  apiConfigurada,
  enderecoDaApi,
  ErroApi,
  guardarToken,
  pedir,
  tokenAtual,
} from '../src/dados/http.ts'

interface Chamada {
  url: string
  init: RequestInit
}

const chamadas: Chamada[] = []
const fetchOriginal = globalThis.fetch

function responder(estado: number, corpo: unknown, tipo = 'application/json') {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    chamadas.push({ url: String(url), init })
    return {
      ok: estado >= 200 && estado < 300,
      status: estado,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? tipo : null) },
      json: async () => corpo,
    } as unknown as Response
  }) as typeof fetch
}

function configurar(endereco: string | undefined) {
  const janela = globalThis as unknown as { window?: unknown; __IARX_API_URL__?: string }
  janela.window = janela
  if (endereco === undefined) delete janela.__IARX_API_URL__
  else janela.__IARX_API_URL__ = endereco
}

/** `sessionStorage` não existe no Node; o módulo precisa sobreviver a isso. */
function armazemQueFalha() {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() {
      throw new Error('sem armazenamento')
    },
  })
}

beforeEach(() => {
  chamadas.length = 0
  configurar('https://api.exemplo.test/')
  armazemQueFalha()
  guardarToken(null)
})

afterEach(() => {
  globalThis.fetch = fetchOriginal
})

/* ------------------------------------------------------------ endereço */

test('sem endereço configurado, a API é considerada ausente', () => {
  configurar(undefined)
  assert.equal(enderecoDaApi(), '')
  assert.equal(apiConfigurada(), false)
})

test('a barra final do endereço é descartada — senão a URL sai com barra dupla', () => {
  configurar('https://api.exemplo.test///')
  assert.equal(enderecoDaApi(), 'https://api.exemplo.test')
})

test('sem API configurada o pedido recusa em vez de montar URL relativa', async () => {
  configurar(undefined)
  await assert.rejects(
    () => pedir({ caminho: '/api/v1/clientes' }),
    (e: ErroApi) => e.codigo === 'INDISPONIVEL',
  )
  assert.equal(chamadas.length, 0, 'não deveria ter chegado a chamar fetch')
})

/* --------------------------------------------------------------- token */

test('o token sobrevive à ausência de sessionStorage', () => {
  guardarToken('abc123')
  assert.equal(tokenAtual(), 'abc123')
  guardarToken(null)
  assert.equal(tokenAtual(), null)
})

test('rota protegida sem token recusa antes de ir à rede', async () => {
  responder(200, {})
  await assert.rejects(
    () => pedir({ caminho: '/api/v1/clientes' }),
    (e: ErroApi) => e.codigo === 'NAO_AUTENTICADO',
  )
  assert.equal(chamadas.length, 0)
})

test('rota pública vai sem token e sem cabeçalho de autorização', async () => {
  responder(200, { ok: true })
  await pedir({ caminho: '/api/v1/auth/login', metodo: 'POST', corpo: {}, publica: true })

  const { init } = chamadas[0]!
  assert.equal((init.headers as Record<string, string>).Authorization, undefined)
})

test('com token, a autorização é Bearer e a requisição não leva cookie', async () => {
  guardarToken('t-42')
  responder(200, [])
  await pedir({ caminho: '/api/v1/clientes' })

  const { url, init } = chamadas[0]!
  assert.equal(url, 'https://api.exemplo.test/api/v1/clientes')
  assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer t-42')

  /*
   * `credentials: 'omit'` não é detalhe. A sessão viaja no cabeçalho; mandar
   * cookie junto só adicionaria a superfície de CSRF sem nenhum ganho — o
   * servidor passaria a aceitar requisição que o navegador autentica sozinho,
   * inclusive a disparada por outro site.
   */
  assert.equal(init.credentials, 'omit')
})

/* ---------------------------------------------------------------- erro */

test('problem+json vira ErroApi com o código estável e as ações', async () => {
  guardarToken('t')
  responder(422, {
    code: 'CREDITO_BLOQUEADO',
    title: 'Crédito bloqueado',
    detail: 'O cliente está com o crédito bloqueado desde 12/03.',
    /*
     * A forma é a do contrato: `acoes_sugeridas`, com objetos. Eu tinha
     * escrito `acoes: ['...']` de memória nos dois lados, e os dois
     * concordavam entre si e discordavam da API — o teste passava e a tela
     * teria recebido toda recusa sem saída.
     */
    acoes_sugeridas: [
      { code: 'LIBERAR_CREDITO', descricao: 'Liberar o crédito' },
      { code: 'REGISTRAR_EXCECAO', descricao: 'Registrar exceção' },
    ],
  })

  await assert.rejects(
    () => pedir({ caminho: '/api/v1/contratos', metodo: 'POST', corpo: {} }),
    (e: ErroApi) => {
      assert.equal(e.codigo, 'CREDITO_BLOQUEADO')
      assert.match(e.message, /crédito bloqueado desde/)
      assert.deepEqual(e.acoes, ['Liberar o crédito', 'Registrar exceção'])
      return true
    },
  )
})

test('401 sem corpo reconhecível vira sessão expirada, com saída', async () => {
  guardarToken('t')
  responder(401, null, 'text/html')

  await assert.rejects(
    () => pedir({ caminho: '/api/v1/clientes' }),
    (e: ErroApi) => e.codigo === 'NAO_AUTENTICADO' && e.acoes.includes('Entrar novamente'),
  )
})

test('resposta que não é problem+json não vaza o corpo para a tela', async () => {
  guardarToken('t')
  /*
   * O caso real: proxy corporativo devolvendo HTML de portal cativo, ou um 502
   * do balanceador. Esses corpos trazem caminho de arquivo, versão de servidor
   * e, em alguns proxies, a requisição inteira de volta — inclusive o
   * cabeçalho `Authorization`.
   */
  const htmlDoProxy = '<html><body>Blocked by proxy — /opt/squid/access.log</body></html>'
  responder(502, htmlDoProxy, 'text/html')

  await assert.rejects(
    () => pedir({ caminho: '/api/v1/clientes' }),
    (e: ErroApi) => {
      assert.equal(e.codigo, 'INDISPONIVEL')
      assert.doesNotMatch(e.message, /squid|html|proxy/i)
      return true
    },
  )
})

test('falha de rede vira INDISPONIVEL, e não um erro cru de fetch', async () => {
  guardarToken('t')
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch')
  }) as typeof fetch

  await assert.rejects(
    () => pedir({ caminho: '/api/v1/clientes' }),
    (e: ErroApi) => {
      assert.equal(e.codigo, 'INDISPONIVEL')
      assert.equal(e.name, 'ErroApi')
      assert.ok(e.acoes.length > 0, 'recusa sem saída obriga a abrir chamado')
      return true
    },
  )
})

test('204 devolve vazio em vez de tentar ler JSON de corpo inexistente', async () => {
  guardarToken('t')
  globalThis.fetch = (async () => ({
    ok: true,
    status: 204,
    headers: { get: () => null },
    json: async () => {
      throw new Error('não deveria ler o corpo de um 204')
    },
  })) as unknown as typeof fetch

  assert.equal(await pedir({ caminho: '/api/v1/anexos/x', metodo: 'DELETE' }), undefined)
})
