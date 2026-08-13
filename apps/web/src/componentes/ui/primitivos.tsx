import { forwardRef, useId } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

/**
 * Primitivos do design system.
 *
 * Cada um encapsula, além do visual, as obrigações de acessibilidade do
 * Anexo G.4 — associação de rótulo, vínculo de erro, rótulo textual de estado.
 * A regra é: se um componente pode errar em acessibilidade, o primitivo resolve
 * uma vez e as telas não precisam lembrar.
 */

/* -------------------------------------------------------------------- botão */

type VarianteBotao = 'primario' | 'secundario' | 'sutil' | 'perigo'

interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao
  pequeno?: boolean
  /** Glifo decorativo. Nunca substitui o rótulo textual. */
  glifo?: string
  /** Motivo da desabilitação — exibido como dica, para não deixar beco sem saída. */
  motivoDesabilitado?: string
}

const CLASSE_VARIANTE: Record<VarianteBotao, string> = {
  primario: 'btn btn--primario',
  secundario: 'btn',
  sutil: 'btn btn--sutil',
  perigo: 'btn btn--perigo',
}

export const Botao = forwardRef<HTMLButtonElement, BotaoProps>(function Botao(
  { variante = 'secundario', pequeno, glifo, motivoDesabilitado, children, className, ...resto },
  ref,
) {
  const classes = [CLASSE_VARIANTE[variante], pequeno ? 'btn--pequeno' : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      type={resto.type ?? 'button'}
      className={classes}
      title={resto.disabled ? motivoDesabilitado : resto.title}
      {...resto}
    >
      {glifo && <span aria-hidden="true">{glifo}</span>}
      {children}
    </button>
  )
})

/* -------------------------------------------------------------------- campo */

interface CampoBaseProps {
  rotulo: string
  dica?: string
  erro?: string
  /**
   * Nome do campo no formulário. Quando informado, o id do controle passa a ser
   * `campo-<nome>` em vez de gerado — é o que permite ao resumo de erros
   * apontar para ele com uma âncora e levar o foco ao input errado.
   */
  nome?: string
  /**
   * Esconde o rótulo visualmente, sem removê-lo da árvore de acessibilidade.
   *
   * Para o caso em que o contexto visual já diz o que é o campo — a busca
   * sobreposta ao mapa, com lupa e placeholder — mas o leitor de tela ainda
   * precisa do nome. Usar só `placeholder` como rótulo é o erro clássico: ele
   * some ao digitar, e alguns leitores nem o anunciam.
   */
  rotuloOculto?: boolean
  children: (props: { id: string; descricaoId?: string; invalido: boolean }) => ReactNode
}

/**
 * Envelope de campo: gera o id, associa rótulo, dica e erro.
 * Erro é vinculado por aria-describedby e marcado com aria-invalid — o leitor
 * de tela recebe os dois, sem a tela precisar cuidar disso.
 */
export function Campo({ rotulo, dica, erro, nome, rotuloOculto, children }: CampoBaseProps) {
  const gerado = useId()
  const id = nome ? `campo-${nome}` : gerado
  const dicaId = dica ? `${id}-dica` : undefined
  const erroId = erro ? `${id}-erro` : undefined
  const descricaoId = [erroId, dicaId].filter(Boolean).join(' ') || undefined

  return (
    <div className="campo">
      <label className={rotuloOculto ? 'so-leitor' : 'campo__rotulo'} htmlFor={id}>
        {rotulo}
      </label>
      {children({ id, descricaoId, invalido: Boolean(erro) })}
      {erro && (
        <p className="campo__erro" id={erroId}>
          {erro}
        </p>
      )}
      {dica && (
        <p className="campo__dica" id={dicaId}>
          {dica}
        </p>
      )}
    </div>
  )
}

interface EntradaProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  rotulo: string
  dica?: string
  erro?: string
  nome?: string
  rotuloOculto?: boolean
}

export function Entrada({ rotulo, dica, erro, nome, rotuloOculto, ...resto }: EntradaProps) {
  return (
    <Campo rotulo={rotulo} dica={dica} erro={erro} nome={nome} rotuloOculto={rotuloOculto}>
      {({ id, descricaoId, invalido }) => (
        <input id={id} aria-describedby={descricaoId} aria-invalid={invalido || undefined} {...resto} />
      )}
    </Campo>
  )
}

interface SelecaoProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  rotulo: string
  dica?: string
  erro?: string
  nome?: string
  rotuloOculto?: boolean
  opcoes: { valor: string; texto: string }[]
}

export function Selecao({ rotulo, dica, erro, nome, rotuloOculto, opcoes, ...resto }: SelecaoProps) {
  return (
    <Campo rotulo={rotulo} dica={dica} erro={erro} nome={nome} rotuloOculto={rotuloOculto}>
      {({ id, descricaoId, invalido }) => (
        <select id={id} aria-describedby={descricaoId} aria-invalid={invalido || undefined} {...resto}>
          {opcoes.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.texto}
            </option>
          ))}
        </select>
      )}
    </Campo>
  )
}

/* ------------------------------------------------------------------- estado */

export type Severidade = 'disponivel' | 'uso' | 'atencao' | 'critico' | 'inativo'

const GLIFO_SEVERIDADE: Record<Severidade, string> = {
  disponivel: '●',
  uso: '■',
  atencao: '▲',
  critico: '⛔',
  inativo: '✕',
}

interface ChipProps {
  severidade: Severidade
  children: ReactNode
  /** Detalhe curto acrescentado após o rótulo, ex.: motivo da indisponibilidade. */
  detalhe?: string
}

/** Estado sempre com glifo + rótulo + cor. Cor nunca é o único canal. */
export function Chip({ severidade, children, detalhe }: ChipProps) {
  return (
    <span className={`chip chip--${severidade}`}>
      <span className="chip__glifo" aria-hidden="true">
        {GLIFO_SEVERIDADE[severidade]}
      </span>
      {children}
      {detalhe && <span className="texto-atenuado"> · {detalhe}</span>}
    </span>
  )
}

/* ------------------------------------------------------------------ cartão */

interface CartaoProps {
  titulo?: string
  acessorio?: ReactNode
  children: ReactNode
  compacto?: boolean
  /** Torna o cartão uma região nomeada para navegação por leitor de tela. */
  comoRegiao?: boolean
}

export function Cartao({ titulo, acessorio, children, compacto, comoRegiao }: CartaoProps) {
  const id = useId()
  const Tag = comoRegiao ? 'section' : 'div'
  return (
    <Tag
      className={`cartao${compacto ? ' cartao--compacto' : ''}`}
      aria-labelledby={comoRegiao && titulo ? id : undefined}
    >
      {(titulo || acessorio) && (
        <div className="cartao__cabeca">
          {titulo && (
            <h2 className="cartao__titulo" id={id}>
              {titulo}
            </h2>
          )}
          {acessorio}
        </div>
      )}
      {children}
    </Tag>
  )
}

/* ----------------------------------------------------------------- métrica */

interface MetricaProps {
  rotulo: string
  valor: string
  unidade?: string
  /** Variação já formatada com sinal explícito. */
  variacao?: string
  /** Direção do que é bom: uma queda de inadimplência é positiva. */
  tendencia?: 'positiva' | 'negativa' | 'neutra'
  contexto?: string
  children?: ReactNode
}

export function Metrica({ rotulo, valor, unidade, variacao, tendencia = 'neutra', contexto, children }: MetricaProps) {
  return (
    <div className="metrica">
      <span className="metrica__rotulo">{rotulo}</span>
      <span className="metrica__valor">
        {valor}
        {unidade && <span className="metrica__unidade">{unidade}</span>}
      </span>
      {variacao && (
        <span className={`metrica__variacao metrica__variacao--${tendencia}`}>
          {/* Seta é decorativa: o sinal já vem no texto da variação. */}
          <span aria-hidden="true">{tendencia === 'positiva' ? '▲' : tendencia === 'negativa' ? '▼' : '■'}</span>
          {variacao}
        </span>
      )}
      {contexto && <span className="metrica__contexto">{contexto}</span>}
      {children}
    </div>
  )
}

/* ---------------------------------------------------------------- skeleton */

interface SkeletonProps {
  largura?: string
  altura?: string
  /** Repetições, para simular linhas de lista. */
  linhas?: number
}

export function Skeleton({ largura = '100%', altura = '14px', linhas = 1 }: SkeletonProps) {
  return (
    <div className="pilha g2" aria-hidden="true">
      {Array.from({ length: linhas }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ width: i === linhas - 1 && linhas > 1 ? '72%' : largura, height: altura }}
        />
      ))}
    </div>
  )
}

/**
 * Região que anuncia carregamento a leitores de tela e mostra skeleton
 * visualmente. Sem isso, o usuário de leitor de tela fica sem retorno algum.
 */
export function Carregando({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="so-leitor">{rotulo}</span>
      {children}
    </div>
  )
}

/* -------------------------------------------------------------- estado vazio */

interface VazioProps {
  glifo?: string
  titulo: string
  texto?: string
  acao?: ReactNode
}

export function EstadoVazio({ glifo = '◍', titulo, texto, acao }: VazioProps) {
  return (
    <div className="vazio">
      <span className="vazio__glifo" aria-hidden="true">
        {glifo}
      </span>
      <p className="vazio__titulo">{titulo}</p>
      {texto && <p className="vazio__texto">{texto}</p>}
      {acao}
    </div>
  )
}

/* ------------------------------------------------------------------- aviso */

interface AvisoProps {
  tom: 'critico' | 'atencao' | 'ok'
  titulo: string
  children?: ReactNode
  saidas?: string[]
}

/**
 * Bloqueio nunca aparece sozinho: sempre com o que impede e como resolver.
 * As saídas são renderizadas como lista, para o leitor anunciar a contagem.
 */
export function Aviso({ tom, titulo, children, saidas }: AvisoProps) {
  const glifo = tom === 'ok' ? '✓' : tom === 'atencao' ? '▲' : '⛔'
  return (
    <div className={`aviso aviso--${tom}`}>
      <span aria-hidden="true">{glifo}</span>
      <div className="crescer">
        <p className="aviso__titulo">{titulo}</p>
        <div className="aviso__corpo">{children}</div>
        {saidas && saidas.length > 0 && (
          <ul>
            {saidas.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- barra medida */

export function BarraMedida({
  valor,
  meta,
  rotuloAcessivel,
  cor = 'var(--cor-primary)',
}: {
  valor: number
  meta?: number
  rotuloAcessivel: string
  cor?: string
}) {
  const pct = Math.max(0, Math.min(1, valor))
  return (
    <div
      className="barra-medida"
      role="img"
      aria-label={rotuloAcessivel}
      style={meta ? { position: 'relative' } : undefined}
    >
      <i style={{ width: `${pct * 100}%`, background: cor }} />
    </div>
  )
}
