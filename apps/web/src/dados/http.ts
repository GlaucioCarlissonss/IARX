/**
 * Transporte HTTP para a API do IARX.
 *
 * Este módulo é a **costura**: a fachada em `api.ts` continua sendo a única
 * coisa que as telas conhecem, e aqui mora a alternativa de ir à rede em vez de
 * consultar a base em memória.
 *
 * ## Por que a base em memória continua sendo o padrão
 *
 * O artefato publicado é **um arquivo HTML único que abre por duplo clique**.
 * Essa propriedade não é conveniência de demonstração: é o que permite entregar
 * o sistema a quem não tem servidor, avaliar telas sem provisionar nada, e
 * rodar a suíte do Playwright contra o mesmo artefato que vai ao ar. Trocar a
 * base por `fetch` incondicionalmente destruiria isso — o arquivo continuaria
 * abrindo e mostraria erro em todas as telas.
 *
 * Então a decisão é por configuração, e a ausência de configuração significa
 * memória. Quem tem API aponta para ela; quem não tem recebe o que sempre
 * recebeu.
 *
 * ## Como se aponta
 *
 * `VITE_API_URL` no build, ou `window.__IARX_API_URL__` antes do carregamento
 * do bundle — a segunda existe para quem recebe o arquivo pronto e precisa
 * apontá-lo sem reconstruir.
 *
 * **Não** há parâmetro de URL para isso, e a ausência é deliberada: um
 * `?api=` transformaria qualquer link em instrução de para onde mandar as
 * credenciais de quem clicar.
 */

/* --------------------------------------------------------------- erro */

/**
 * Erro vindo da API, ou do transporte até ela.
 *
 * Mora aqui e não em `api.ts` por uma razão prática — `api.ts` passa a importar
 * este módulo, e `ErroApi` definido lá fecharia o ciclo. A fachada reexporta,
 * então nenhuma tela precisa saber que o arquivo mudou.
 */
export class ErroApi extends Error {
  readonly codigo: string
  readonly acoes: string[]

  /*
   * Campos declarados e atribuídos, em vez de propriedades de parâmetro.
   *
   * `constructor(readonly codigo: string)` é açúcar do TypeScript que **emite
   * código** — e o modo de remoção de tipos do Node, que é como esta suíte roda
   * `.ts` sem compilar, recusa qualquer sintaxe assim. O efeito era que nenhum
   * teste conseguia importar este arquivo, e com ele toda a camada de consultas
   * derivadas ficava sem cobertura por causa de um detalhe de sintaxe.
   */
  constructor(codigo: string, mensagem: string, acoes: string[] = []) {
    super(mensagem)
    this.name = 'ErroApi'
    this.codigo = codigo
    this.acoes = acoes
  }
}

/* -------------------------------------------------------- configuração */

interface JanelaConfiguravel {
  __IARX_API_URL__?: string
}

function doAmbiente(): string {
  // `import.meta.env` só existe sob o Vite; a suíte roda este arquivo no Node.
  const env = (import.meta as unknown as { env?: Record<string, string> }).env
  return env?.VITE_API_URL ?? ''
}

function daJanela(): string {
  if (typeof window === 'undefined') return ''
  return (window as unknown as JanelaConfiguravel).__IARX_API_URL__ ?? ''
}

/** Endereço base da API, sem barra final. Vazio = não configurada. */
export function enderecoDaApi(): string {
  return (daJanela() || doAmbiente()).replace(/\/+$/, '')
}

/** Há API para onde ir? Quando não há, a fachada usa a base em memória. */
export function apiConfigurada(): boolean {
  return enderecoDaApi() !== ''
}

/* ------------------------------------------------------------- sessão */

/**
 * O token vive em `sessionStorage`, não em `localStorage`.
 *
 * Diferença que importa: `sessionStorage` morre com a aba. Um token de portador
 * esquecido em `localStorage` sobrevive ao fechamento do navegador e continua
 * valendo no computador compartilhado da recepção — que é exatamente onde
 * máquinas de locação costumam ficar.
 *
 * E em memória também, porque `sessionStorage` lança em janela privativa de
 * alguns navegadores e sob política de conteúdo restritiva. Falhar o acesso ao
 * armazenamento não pode derrubar a sessão em curso.
 */
const CHAVE_TOKEN = 'iarx.sessao.token'
let tokenEmMemoria: string | null = null

export function guardarToken(token: string | null): void {
  tokenEmMemoria = token
  try {
    if (token === null) sessionStorage.removeItem(CHAVE_TOKEN)
    else sessionStorage.setItem(CHAVE_TOKEN, token)
  } catch {
    /* sem armazenamento: a sessão vale enquanto a página estiver aberta */
  }
}

export function tokenAtual(): string | null {
  if (tokenEmMemoria !== null) return tokenEmMemoria
  try {
    tokenEmMemoria = sessionStorage.getItem(CHAVE_TOKEN)
  } catch {
    tokenEmMemoria = null
  }
  return tokenEmMemoria
}

/* ---------------------------------------------------------- requisição */

interface ProblemaRfc9457 {
  code?: string
  title?: string
  detail?: string
  /**
   * `acoes_sugeridas`, com o nome que a API usa, e com objetos — não strings.
   *
   * Eu tinha escrito `acoes?: string[]` aqui de memória, e teria funcionado em
   * todos os testes que eu mesmo escrevesse: o campo simplesmente viria vazio,
   * e toda recusa chegaria à tela sem saída. É o tipo de engano que não falha,
   * só empobrece — e por isso o formato vem do contrato, conferido.
   */
  acoes_sugeridas?: { code: string; descricao: string }[]
}

/**
 * Traduz a resposta de erro para `ErroApi`.
 *
 * `code` é o que o cliente consome — identificador estável de causa, conforme
 * o Anexo D.1. `title` e `detail` são para humanos e podem mudar de redação sem
 * quebrar ninguém, e `status` é grosso demais para decidir comportamento: dois
 * 409 muito diferentes pedem telas muito diferentes.
 *
 * Resposta que não é `problem+json` — proxy no caminho, serviço fora, HTML de
 * portal cativo — vira `INDISPONIVEL` com texto de gente. O que **não** pode
 * acontecer é o corpo cru chegar à tela: ele costuma trazer caminho de arquivo,
 * versão de servidor e, em alguns proxies, o cabeçalho da requisição inteira.
 */
async function comoErro(resposta: Response): Promise<ErroApi> {
  const tipo = resposta.headers.get('content-type') ?? ''
  if (tipo.includes('json')) {
    try {
      const corpo = (await resposta.json()) as ProblemaRfc9457
      if (corpo.code) {
        return new ErroApi(
          corpo.code,
          corpo.detail || corpo.title || 'A operação não pôde ser concluída.',
          (corpo.acoes_sugeridas ?? []).map((a) => a.descricao),
        )
      }
    } catch {
      /* corpo ilegível: cai no genérico abaixo */
    }
  }

  if (resposta.status === 401) {
    return new ErroApi('NAO_AUTENTICADO', 'Sua sessão expirou.', ['Entrar novamente'])
  }
  return new ErroApi(
    'INDISPONIVEL',
    'Não conseguimos falar com o servidor agora.',
    ['Tentar novamente em alguns instantes'],
  )
}

export interface OpcoesPedido {
  /** Rota sem o endereço base, começando por barra. */
  caminho: string
  metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  corpo?: unknown
  /** Rota pública: não envia token nem exige sessão. */
  publica?: boolean
}

export async function pedir<T>({ caminho, metodo = 'GET', corpo, publica }: OpcoesPedido): Promise<T> {
  const base = enderecoDaApi()
  if (!base) throw new ErroApi('INDISPONIVEL', 'Nenhuma API configurada para esta instalação.')

  const cabecalhos: Record<string, string> = { Accept: 'application/json' }
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json'

  if (!publica) {
    const token = tokenAtual()
    if (!token) throw new ErroApi('NAO_AUTENTICADO', 'Entre para continuar.', ['Entrar'])
    cabecalhos.Authorization = `Bearer ${token}`
  }

  let resposta: Response
  try {
    resposta = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      // Sem cookie: a sessão viaja no cabeçalho, e mandar credencial de
      // navegador junto abriria a porta a CSRF sem nenhum ganho.
      credentials: 'omit',
    })
  } catch {
    // `fetch` só rejeita por falha de rede, DNS, CORS ou cancelamento — nunca
    // por status. Chegar aqui significa que não houve resposta nenhuma.
    throw new ErroApi('INDISPONIVEL', 'Sem conexão com o servidor.', [
      'Conferir a rede',
      'Tentar novamente',
    ])
  }

  if (!resposta.ok) throw await comoErro(resposta)
  if (resposta.status === 204) return undefined as T
  return (await resposta.json()) as T
}
