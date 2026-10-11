import { pedir, guardarToken } from './http'
import type { EscopoCliente, Usuario } from './tipos'
import type { Perfil, Permissao } from '../lib/permissoes'

/**
 * Entrada pelo Google, do lado do navegador.
 *
 * O fluxo tem três passos e vale enumerá-los, porque a divisão de trabalho
 * entre eles é a parte que importa:
 *
 *  1. O Google autentica a pessoa e devolve um **ID token** assinado por ele.
 *  2. A API confere a assinatura, o emissor, a audiência e o `email_verified`,
 *     procura o e-mail entre os **convidados** e emite o token do IARX.
 *  3. A interface pergunta quem ela é — perfis, escopo, permissões.
 *
 * O passo 2 é o que decide. Aqui no navegador nada é verificado, e nem poderia
 * ser: todo código que roda nesta máquina está nas mãos de quem a opera. Este
 * módulo transporta o token, não confia nele.
 *
 * ## Por que o script vem de fora
 *
 * O resto da aplicação é um arquivo único, sem nenhuma dependência de rede. O
 * `gsi/client` é a exceção, e é inevitável: o fluxo do Google exige que a
 * página converse com o domínio dele, e embutir uma cópia congelaria uma
 * biblioteca de autenticação numa versão que ninguém atualiza.
 *
 * Por isso ele só é carregado quando há API configurada. Sem API não há o que
 * autenticar, e o arquivo de duplo clique continua sem tocar a rede.
 */

const SCRIPT_GOOGLE = 'https://accounts.google.com/gsi/client'

interface CredencialGoogle {
  credential: string
}

interface ContaGoogle {
  initialize(opcoes: {
    client_id: string
    callback: (r: CredencialGoogle) => void
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
    ux_mode?: 'popup' | 'redirect'
  }): void
  renderButton(
    elemento: HTMLElement,
    opcoes: {
      type?: 'standard' | 'icon'
      theme?: 'outline' | 'filled_blue' | 'filled_black'
      size?: 'small' | 'medium' | 'large'
      text?: 'signin_with' | 'signup_with' | 'continue_with'
      shape?: 'rectangular' | 'pill'
      locale?: string
      width?: number
    },
  ): void
  disableAutoSelect(): void
}

interface JanelaComGoogle {
  google?: { accounts: { id: ContaGoogle } }
  __IARX_GOOGLE_CLIENT_ID__?: string
}

function janela(): JanelaComGoogle {
  return window as unknown as JanelaComGoogle
}

/**
 * O ID do cliente OAuth. Vazio significa "sem Google nesta instalação".
 *
 * Mesma dupla de origens do endereço da API, pelo mesmo motivo: `VITE_` para
 * quem constrói, variável de janela para quem recebe o arquivo pronto e precisa
 * apontá-lo sem reconstruir.
 *
 * O ID **não é segredo** — ele aparece no HTML de qualquer página que use
 * entrada pelo Google, e é assim por desenho. O que protege a conta não é
 * escondê-lo: é a lista de origens autorizadas no console do Google, que
 * recusa o mesmo ID vindo de outro endereço.
 */
export function clientIdGoogle(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env
  if (typeof window !== 'undefined' && janela().__IARX_GOOGLE_CLIENT_ID__) {
    return janela().__IARX_GOOGLE_CLIENT_ID__!
  }
  return env?.VITE_GOOGLE_CLIENT_ID ?? ''
}

let carregando: Promise<ContaGoogle> | null = null

/** Carrega o script do Google uma vez e devolve a API dele. */
export function carregarGoogle(): Promise<ContaGoogle> {
  const pronto = janela().google?.accounts.id
  if (pronto) return Promise.resolve(pronto)

  carregando ??= new Promise<ContaGoogle>((resolver, recusar) => {
    const script = document.createElement('script')
    script.src = SCRIPT_GOOGLE
    script.async = true
    script.onload = () => {
      const api = janela().google?.accounts.id
      if (api) resolver(api)
      else recusar(new Error('o script do Google carregou sem expor accounts.id'))
    }
    script.onerror = () => {
      // Rede corporativa que bloqueia o domínio do Google é o caso comum, e
      // precisa chegar à tela como explicação, não como botão que não aparece.
      carregando = null
      recusar(new Error('não foi possível carregar o Google'))
    }
    document.head.appendChild(script)
  })

  return carregando
}

/* ------------------------------------------------------------ a sessão */

interface PerfilAtribuidoApi {
  perfil_id: string
  perfil_nome: string
  escopo_tipo: string
  escopo_id: string | null
}

interface UsuarioApi {
  id: string
  nome: string
  email: string
  tipo: 'INTERNO' | 'CLIENTE'
  status: string
  cliente_id: string | null
  ultimo_acesso_em: string | null
  convite_pendente: boolean
  perfis: PerfilAtribuidoApi[]
}

/**
 * Quem entrou, do jeito que a interface precisa.
 *
 * Tipo próprio, e não `Usuario` inteiro: a resposta da API não traz `criadoEm`,
 * e preencher com uma data inventada seria pior que não ter o campo — um dado
 * falso que nada distingue de um verdadeiro. O que está aqui é exatamente o
 * que o provedor de sessão consome.
 */
export interface SessaoRemota {
  usuario: Pick<Usuario, 'id' | 'nome' | 'email' | 'tipo' | 'clienteId' | 'escopoCliente' | 'perfilIds'>
  perfil: Perfil & { tipo: 'INTERNO' | 'CLIENTE' }
}

/**
 * Traduz o usuário da API para o que o provedor de sessão consome.
 *
 * O escopo merece atenção: `LOCAL_CLIENTE` nos vínculos de perfil é o recorte
 * por unidade (D-27), e é ele que decide o que o portal mostra. A regra que o
 * anexo fixa é que **o escopo do perfil decide se o recorte se aplica**, e a
 * lista de vínculos diz quais locais — ler ao contrário promoveria um gestor de
 * unidade a administrador do grupo no dia em que um vínculo fosse apagado.
 */
function comoSessao(u: UsuarioApi, permissoes: string[]): SessaoRemota {
  const locais = u.perfis
    .filter((p) => p.escopo_tipo === 'LOCAL_CLIENTE' && p.escopo_id)
    .map((p) => p.escopo_id!)

  const temRecorteDeUnidade = u.perfis.some((p) => p.escopo_tipo === 'LOCAL_CLIENTE')
  const escopoCliente: EscopoCliente | null =
    u.tipo !== 'CLIENTE' ? null : temRecorteDeUnidade ? { tipo: 'LOCAL_CLIENTE', locaisIds: locais } : { tipo: 'CLIENTE' }

  return {
    usuario: {
      id: u.id,
      nome: u.nome,
      email: u.email,
      tipo: u.tipo,
      clienteId: u.cliente_id,
      escopoCliente,
      perfilIds: u.perfis.map((p) => p.perfil_id),
    },
    /*
     * Um perfil sintético, montado com as permissões que a API devolveu.
     *
     * A interface usa o perfil para esconder o que não se pode fazer; a
     * autorização de verdade é do servidor, que decide por permissão e não por
     * perfil. Reconstruir a árvore de perfis aqui seria duplicar a decisão em
     * dois lugares — e o lugar errado é sempre o que fica desatualizado.
     */
    perfil: {
      id: u.perfis[0]?.perfil_id ?? 'remoto',
      nome: u.perfis[0]?.perfil_nome ?? 'Acesso',
      tipo: u.tipo,
      permissoes: permissoes as Permissao[],
    },
  }
}

/**
 * Troca o ID token do Google por uma sessão do IARX.
 *
 * Duas viagens, e a segunda não é desperdício: o login devolve quem a pessoa é
 * o bastante para emitir o token, e `sessao` devolve o que a interface precisa
 * para desenhar — perfis, escopo, permissões. Juntar as duas faria a rota
 * pública de entrada carregar o modelo inteiro de autorização.
 */
export async function entrarComGoogle(credential: string): Promise<SessaoRemota> {
  const login = await pedir<{ data: { token: string } }>({
    caminho: '/api/v1/auth/google',
    metodo: 'POST',
    corpo: { credential },
    publica: true,
  })

  guardarToken(login.data.token)

  try {
    return await sessaoAtual()
  } catch (e) {
    // Token emitido e sessão não lida: guardá-lo deixaria a interface num
    // estado que diz "entrou" e não sabe quem entrou.
    guardarToken(null)
    throw e
  }
}

/** Reconstrói a sessão a partir do token guardado — é o que sobrevive ao F5. */
export async function sessaoAtual(): Promise<SessaoRemota> {
  const r = await pedir<{ data: { usuario: UsuarioApi; permissoes: string[] } }>({
    caminho: '/api/v1/auth/sessao',
  })
  return comoSessao(r.data.usuario, r.data.permissoes)
}

/** Encerra a sessão local e impede o Google de reentrar sozinho. */
export function sairDoGoogle(): void {
  guardarToken(null)
  try {
    janela().google?.accounts.id.disableAutoSelect()
  } catch {
    /* script não carregado: não há seleção automática a desligar */
  }
}
