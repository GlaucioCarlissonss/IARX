import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, assinarMudancas } from '../dados/api'
import { escopoDoUsuario } from '../dados/portal'
import type { EscopoDoPortal } from '../dados/portal'
import type { Permissao, Perfil } from './permissoes'
import { sairDoGoogle, sessaoAtual, type SessaoRemota } from '../dados/google'
import { apiConfigurada, guardarToken, tokenAtual } from '../dados/http'

/**
 * Estado global mínimo.
 *
 * Deliberadamente pequeno: só o que é de fato global — sessão, escopo de filial
 * e avisos. Dado de tela vive na tela, buscado pelo hook de consulta. Não existe
 * store monolítica onde tudo é despejado, porque é isso que torna o estado
 * impossível de raciocinar depois de seis meses.
 */

/* --------------------------------------------------------------- sessão */

interface Sessao {
  usuario: { id: string; nome: string; email: string }
  perfil: Perfil
  filialId: string | 'todas'
}

interface ContextoSessao extends Sessao {
  perfis: Perfil[]
  /**
   * O recorte de cliente de quem está na sessão — nulo para quem opera a
   * locadora.
   *
   * É o que decide **qual aplicação** a pessoa vê: com escopo, o portal; sem
   * escopo, a operação. Vem da identidade, não do perfil: trocar de perfil
   * demonstra o efeito das permissões sobre o menu e as ações, e não muda de
   * audiência — da mesma forma que, no servidor, o que separa `/portal` das
   * rotas da operação é o `cliente_id` do token, e não as permissões dele.
   */
  escopo: EscopoDoPortal | null
  trocarPerfil: (id: string) => void
  definirFilial: (id: string) => void
  pode: (p: Permissao) => boolean
  /** Entrar assume a identidade e **o perfil dela** — não só o nome no cabeçalho. */
  /**
   * Abre a sessão.
   *
   * Dois formatos, porque há dois modos e eles não se parecem. Um `id` é a
   * demonstração trocando de conta dentro da base em memória; uma `SessaoRemota`
   * é alguém que entrou de verdade, e cujo usuário, perfil e escopo vieram da
   * API — não existem na base local e não há como procurá-los lá.
   */
  entrar: (quem: string | SessaoRemota) => void
  sair: () => void
}

const SessaoCtx = createContext<ContextoSessao | null>(null)

/**
 * Os perfis da sessão vêm de `BASE.perfis` — os mesmos que a tela de perfis
 * edita —, e não de uma lista fixa neste arquivo.
 *
 * Antes eram duas coleções: `PERFIS` aqui, consultada pelo `pode()` e pelo
 * seletor do cabeçalho, e `BASE.perfis` na base de demonstração, editada pela
 * árvore de permissões. Salvar um perfil gravava na segunda e **não mudava
 * nada** na interface: o botão continuava escondido, o menu continuava igual, e
 * nenhum erro aparecia em lugar nenhum.
 *
 * É a mesma divergência que havia entre os dois catálogos de permissão, um
 * nível acima: duas cópias do fato "o que este perfil pode fazer". Com uma
 * fonte só, trocar a permissão de um perfil muda o que a interface mostra — que
 * é o critério que fecha o módulo.
 *
 * `PERFIS` continua existindo em `lib/permissoes.ts`, agora no seu único papel
 * honesto: semente da massa de demonstração, lida por `dados/gerar.ts`.
 */
function lerPerfis(): (Perfil & { tipo: 'INTERNO' | 'CLIENTE' })[] {
  return api.baseSincrona().perfis.map((p) => ({
    id: p.id,
    nome: p.nome,
    tipo: p.tipo,
    permissoes: p.permissoes as Permissao[],
  }))
}

/**
 * A aplicação abre autenticada, e a tela de login é alcançada por "Sair".
 *
 * Um portão de login na entrada faria cada um dos 126 testes de ponta a ponta
 * bater no login antes de qualquer coisa, carregando um passo de autenticação
 * que não é o que eles testam. E um artefato de demonstração que pede senha
 * antes de mostrar qualquer coisa a quem o abriu para ver o produto troca
 * aparência por utilidade. O andaime é declarado, não escondido.
 */
const USUARIO_INICIAL = 'usr-admin'

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [usuarioId, setUsuarioId] = useState(USUARIO_INICIAL)
  /*
   * Sessão vinda da API, quando houver — e ela manda sobre a base local.
   *
   * Estado separado, e não um id que se procura em `contas`: quem entrou pelo
   * provedor de identidade não está na base em memória, e procurá-lo ali
   * devolveria silenciosamente o primeiro usuário da demonstração. Uma sessão
   * que cai no usuário errado sem reclamar é pior que uma que falha.
   */
  const [remota, setRemota] = useState<SessaoRemota | null>(null)
  const [perfilId, setPerfilId] = useState<string | null>(null)
  const [filialId, setFilialId] = useState<string | 'todas'>('todas')
  const [perfis, setPerfis] = useState<ReturnType<typeof lerPerfis>>(lerPerfis)

  /*
   * Reusa a assinatura que as telas já usam. Sem ela, salvar um perfil só
   * apareceria no menu na próxima vez que o provedor renderizasse por outro
   * motivo — a interface exibiria o acesso antigo justamente enquanto quem
   * acabou de salvar está olhando para ela.
   */
  useEffect(() => assinarMudancas(() => setPerfis(lerPerfis())), [])

  /*
   * Recarregar a página não pode derrubar quem entrou.
   *
   * O token sobrevive em `sessionStorage`; o resto da sessão — perfil, escopo,
   * permissões — não é guardado ali de propósito. Guardar permissão no
   * navegador seria guardar uma decisão de autorização num lugar onde quem
   * opera a máquina pode editá-la; o servidor é quem responde, e a cada
   * abertura ele responde de novo.
   *
   * Falha silenciosa, e é o comportamento certo: token expirado ou revogado
   * significa sessão encerrada, e a tela de entrada é o destino — não um erro
   * sobre algo que a pessoa não pediu.
   */
  useEffect(() => {
    if (!apiConfigurada() || !tokenAtual()) return
    let vivo = true
    sessaoAtual()
      .then((s) => vivo && setRemota(s))
      .catch(() => guardarToken(null))
    return () => {
      vivo = false
    }
  }, [])

  const contas = api.baseSincrona().usuarios
  const local = contas.find((u) => u.id === usuarioId) ?? contas[0]!
  const conta = remota?.usuario ?? local

  /*
   * O seletor de perfil oferece só os perfis do **tipo da conta**.
   *
   * Atribuir perfil interno a usuário de cliente é o que `convidarUsuario`
   * recusa, e por boa razão: o perfil interno carrega permissões que a lista
   * branca da 0011 proíbe a cliente, e a conta passaria a enxergar a operação
   * da locadora. Oferecer a troca na barra reintroduziria pela demonstração
   * exatamente o que o comando impede.
   */
  const perfisDaConta = remota ? [remota.perfil] : perfis.filter((p) => p.tipo === conta.tipo)

  /*
   * `perfilId` nulo significa "o perfil de quem entrou", e não um padrão fixo.
   *
   * Guardar o id resolvido no lugar do nulo faria a troca de usuário manter o
   * perfil do anterior — entrar como técnico e continuar vendo o menu do
   * administrador. O seletor do cabeçalho grava um id e passa a mandar; entrar
   * de novo volta o nulo e a identidade retoma o controle.
   */
  const perfil =
    perfisDaConta.find((p) => p.id === (perfilId ?? conta.perfilIds[0])) ?? perfisDaConta[0] ?? perfis[0]!

  const valor = useMemo<ContextoSessao>(
    () => ({
      usuario: { id: conta.id, nome: conta.nome, email: conta.email },
      perfil,
      filialId,
      perfis: perfisDaConta,
      escopo: escopoDoUsuario(conta),
      trocarPerfil: setPerfilId,
      definirFilial: setFilialId,
      // O front esconde para reduzir ruído; a autorização real é do servidor.
      pode: (p) => perfil.permissoes.includes(p),
      entrar: (quem) => {
        if (typeof quem === 'string') {
          setRemota(null)
          setUsuarioId(quem)
        } else {
          setRemota(quem)
        }
        setPerfilId(null)
      },
      sair: () => {
        /*
         * Encerra nos dois lugares. Limpar só o estado local deixaria o token
         * guardado: a próxima abertura da aba reconstruiria a sessão sozinha,
         * e "sair" teria significado apenas "sumir da tela".
         */
        sairDoGoogle()
        setRemota(null)
        setUsuarioId(USUARIO_INICIAL)
        setPerfilId(null)
        setFilialId('todas')
      },
    }),
    [conta, perfil, perfis, perfisDaConta, filialId, remota],
  )

  return <SessaoCtx.Provider value={valor}>{children}</SessaoCtx.Provider>
}

export function useSessao() {
  const ctx = useContext(SessaoCtx)
  if (!ctx) throw new Error('useSessao precisa estar dentro de ProvedorSessao')
  return ctx
}

/* ---------------------------------------------------------------- avisos */

interface Toast {
  id: number
  tom: 'ok' | 'erro' | 'atencao'
  titulo: string
  texto?: string
}

interface ContextoToast {
  toasts: Toast[]
  avisar: (t: Omit<Toast, 'id'>) => void
  descartar: (id: number) => void
}

const ToastCtx = createContext<ContextoToast | null>(null)

let seq = 0

export function ProvedorToast({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const descartar = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const avisar = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq
      setToasts((atual) => [...atual, { ...t, id }])
      // Erro permanece até o usuário descartar: sumir sozinho esconde problema.
      if (t.tom !== 'erro') setTimeout(() => descartar(id), 5200)
    },
    [descartar],
  )

  const valor = useMemo(() => ({ toasts, avisar, descartar }), [toasts, avisar, descartar])

  return (
    <ToastCtx.Provider value={valor}>
      {children}
      {/* Região viva: o leitor de tela anuncia o resultado da ação. */}
      <div className="toasts" role="region" aria-label="Avisos do sistema" aria-live="polite">
        {toasts.map((t) => (
          <div className={`toast toast--${t.tom}`} key={t.id}>
            <span aria-hidden="true">{t.tom === 'ok' ? '✓' : t.tom === 'atencao' ? '▲' : '⛔'}</span>
            <div className="crescer">
              <p className="toast__titulo">{t.titulo}</p>
              {t.texto && <p className="toast__texto">{t.texto}</p>}
            </div>
            <button className="btn btn--sutil btn--pequeno" onClick={() => descartar(t.id)}>
              Fechar
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast precisa estar dentro de ProvedorToast')
  return ctx
}
