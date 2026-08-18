import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, assinarMudancas } from '../dados/api'
import type { Permissao, Perfil } from './permissoes'

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
  usuario: { nome: string; email: string }
  perfil: Perfil
  filialId: string | 'todas'
}

interface ContextoSessao extends Sessao {
  perfis: Perfil[]
  trocarPerfil: (id: string) => void
  definirFilial: (id: string) => void
  pode: (p: Permissao) => boolean
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
function lerPerfis(): Perfil[] {
  return api.baseSincrona().perfis.map((p) => ({
    id: p.id,
    nome: p.nome,
    permissoes: p.permissoes as Permissao[],
  }))
}

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [perfilId, setPerfilId] = useState('perf-admin')
  const [filialId, setFilialId] = useState<string | 'todas'>('todas')
  const [perfis, setPerfis] = useState<Perfil[]>(lerPerfis)

  /*
   * Reusa a assinatura que as telas já usam. Sem ela, salvar um perfil só
   * apareceria no menu na próxima vez que o provedor renderizasse por outro
   * motivo — a interface exibiria o acesso antigo justamente enquanto quem
   * acabou de salvar está olhando para ela.
   */
  useEffect(() => assinarMudancas(() => setPerfis(lerPerfis())), [])

  const perfil = perfis.find((p) => p.id === perfilId) ?? perfis[0]

  const valor = useMemo<ContextoSessao>(
    () => ({
      usuario: { nome: 'Operação IARX', email: 'operacao@iarx.app' },
      perfil,
      filialId,
      perfis,
      trocarPerfil: setPerfilId,
      definirFilial: setFilialId,
      // O front esconde para reduzir ruído; a autorização real é do servidor.
      pode: (p) => perfil.permissoes.includes(p),
    }),
    [perfil, perfis, filialId],
  )

  return <SessaoCtx.Provider value={valor}>{children}</SessaoCtx.Provider>
}

export function useSessao() {
  const ctx = useContext(SessaoCtx)
  if (!ctx) throw new Error('useSessao precisa estar dentro de ProvedorSessao')
  return ctx
}

/* ---------------------------------------------------------------- avisos */

export interface Toast {
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
