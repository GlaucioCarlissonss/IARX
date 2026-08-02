import { useId, useMemo, useState } from 'react'
import type { ReactNode, TextareaHTMLAttributes } from 'react'
import { Campo } from './primitivos'
import type { Erros } from '../../lib/useFormulario'
import type { FalhaComando } from '../../dados/comandos'

/**
 * Componentes específicos de formulário.
 *
 * Os primitivos genéricos (Campo, Entrada, Selecao) já existem; aqui ficam os
 * que só fazem sentido dentro de um formulário — resumo de erros, seletor com
 * busca, campo monetário e de contador.
 */

/* ------------------------------------------------------------ resumo de erros */

interface ResumoErrosProps<T> {
  erros: Erros<T>
  erroGeral: FalhaComando | null
  /** Rótulo legível de cada campo, para o resumo não citar nomes técnicos. */
  rotulos: Partial<Record<string, string>>
  refResumo: React.RefObject<HTMLDivElement>
}

/**
 * Resumo de erros no topo do formulário.
 *
 * Padrão exigido em formulário longo: sem ele, o usuário que envia e vê a
 * página "não fazer nada" precisa rolar caçando qual campo ficou vermelho. Com
 * ele, o foco vai para uma lista contável — "3 campos precisam de atenção" — e
 * cada item leva ao campo.
 *
 * `tabIndex={-1}` para poder receber foco por script sem entrar na ordem de
 * tabulação; `role="alert"` para o leitor anunciar assim que aparece.
 */
export function ResumoErros<T>({ erros, erroGeral, rotulos, refResumo }: ResumoErrosProps<T>) {
  const lista = Object.entries(erros).filter(([, m]) => Boolean(m)) as [string, string][]
  // Erro de campo já vem detalhado na lista; repeti-lo no cabeçalho faria a
  // mesma frase aparecer duas vezes na tela.
  const geralSemCampo = erroGeral && !erroGeral.campo ? erroGeral : null

  if (lista.length === 0 && !geralSemCampo) return null

  return (
    <div className="aviso aviso--critico" role="alert" tabIndex={-1} ref={refResumo}>
      <span aria-hidden="true">⛔</span>
      <div className="crescer">
        <p className="aviso__titulo">
          {geralSemCampo
            ? geralSemCampo.mensagem
            : lista.length === 1
              ? 'Um campo precisa de atenção'
              : `${lista.length} campos precisam de atenção`}
        </p>

        {lista.length > 0 && (
          <ul>
            {lista.map(([chave, mensagem]) => (
              <li key={chave}>
                <a href={`#campo-${chave}`}>{rotulos[chave] ?? chave}</a>: {mensagem}
              </li>
            ))}
          </ul>
        )}

        {geralSemCampo?.acoes && geralSemCampo.acoes.length > 0 && (
          <ul>
            {geralSemCampo.acoes.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- área de texto */

interface AreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  rotulo: string
  dica?: string
  erro?: string
  nome?: string
  /** Contagem regressiva de caracteres, quando há limite. */
  limite?: number
}

export function AreaTexto({ rotulo, dica, erro, nome, limite, value, ...resto }: AreaProps) {
  const texto = String(value ?? '')
  const restante = limite ? limite - texto.length : null

  return (
    <Campo rotulo={rotulo} dica={dica} erro={erro} nome={nome}>
      {({ id, descricaoId, invalido }) => (
        <>
          <textarea
            id={id}
            aria-describedby={descricaoId}
            aria-invalid={invalido || undefined}
            rows={3}
            maxLength={limite}
            value={texto}
            {...resto}
          />
          {restante !== null && (
            // aria-live off: anunciar cada caractere restante a cada tecla
            // torna o campo inutilizável com leitor de tela.
            <p className="campo__dica" aria-live="off">
              {restante} caracteres restantes
            </p>
          )}
        </>
      )}
    </Campo>
  )
}

/* ---------------------------------------------------------------- valor em reais */

interface MoedaProps {
  rotulo: string
  dica?: string
  erro?: string
  nome?: string
  valor: number
  aoMudar: (v: number) => void
  onBlur?: () => void
  disabled?: boolean
}

/**
 * Campo monetário.
 *
 * `inputMode="decimal"` abre o teclado numérico no celular sem perder a
 * possibilidade de digitar vírgula. O valor é mantido como texto enquanto o
 * campo está em edição — normalizar a cada tecla apagaria a vírgula que o
 * usuário acabou de digitar e o cursor pularia.
 */
export function CampoMoeda({ rotulo, dica, erro, nome, valor, aoMudar, onBlur, disabled }: MoedaProps) {
  const [texto, setTexto] = useState<string | null>(null)
  const exibido = texto ?? (valor ? valor.toFixed(2).replace('.', ',') : '')

  return (
    <Campo rotulo={rotulo} dica={dica} erro={erro} nome={nome}>
      {({ id, descricaoId, invalido }) => (
        <div className="campo-prefixado">
          <span aria-hidden="true">R$</span>
          <input
            id={id}
            inputMode="decimal"
            aria-describedby={descricaoId}
            aria-invalid={invalido || undefined}
            value={exibido}
            disabled={disabled}
            onChange={(e) => {
              const bruto = e.target.value.replace(/[^\d,.]/g, '')
              setTexto(bruto)
              const n = Number(bruto.replace(/\./g, '').replace(',', '.'))
              aoMudar(Number.isFinite(n) ? n : 0)
            }}
            onBlur={() => {
              setTexto(null)
              onBlur?.()
            }}
          />
        </div>
      )}
    </Campo>
  )
}

/* ------------------------------------------------------------------- contador */

interface NumeroProps {
  rotulo: string
  dica?: string
  erro?: string
  nome?: string
  valor: number
  aoMudar: (v: number) => void
  onBlur?: () => void
  min?: number
  max?: number
  sufixo?: string
  disabled?: boolean
}

export function CampoNumero({ rotulo, dica, erro, nome, valor, aoMudar, onBlur, min, max, sufixo, disabled }: NumeroProps) {
  return (
    <Campo rotulo={rotulo} dica={dica} erro={erro} nome={nome}>
      {({ id, descricaoId, invalido }) => (
        <div className="campo-prefixado">
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            disabled={disabled}
            aria-describedby={descricaoId}
            aria-invalid={invalido || undefined}
            value={Number.isFinite(valor) ? valor : ''}
            onChange={(e) => aoMudar(e.target.value === '' ? 0 : Number(e.target.value))}
            onBlur={onBlur}
          />
          {sufixo && <span aria-hidden="true">{sufixo}</span>}
        </div>
      )}
    </Campo>
  )
}

/* ------------------------------------------------------------------ combobox */

export interface OpcaoCombo {
  valor: string
  texto: string
  detalhe?: string
  desabilitada?: boolean
  motivoDesabilitada?: string
}

interface ComboProps {
  rotulo: string
  dica?: string
  erro?: string
  nome?: string
  opcoes: OpcaoCombo[]
  valor: string
  aoMudar: (v: string) => void
  onBlur?: () => void
  vazio?: string
}

/**
 * Seletor com busca.
 *
 * Um `<select>` com 420 equipamentos é inutilizável: não dá para digitar o
 * patrimônio, e rolar até "10422" leva mais tempo que abrir a outra tela. Este
 * componente filtra por texto e mantém o padrão combobox do APG — setas para
 * percorrer, Enter para escolher, Esc para fechar, `aria-activedescendant`
 * apontando a opção em foco visual sem mover o foco real do campo.
 *
 * Opções indisponíveis aparecem **desabilitadas com o motivo**, em vez de serem
 * omitidas: quem procura o patrimônio 10422 e não o encontra na lista conclui
 * que digitou errado. Vendo "10422 — já alocado até 31/12", resolve sozinho.
 */
export function Combo({ rotulo, dica, erro, nome, opcoes, valor, aoMudar, onBlur, vazio }: ComboProps) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [ativo, setAtivo] = useState(0)
  const idLista = useId()

  const selecionada = opcoes.find((o) => o.valor === valor)
  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return opcoes.slice(0, 50)
    return opcoes.filter((o) => `${o.texto} ${o.detalhe ?? ''}`.toLowerCase().includes(t)).slice(0, 50)
  }, [opcoes, busca])

  function escolher(o: OpcaoCombo) {
    if (o.desabilitada) return
    aoMudar(o.valor)
    setBusca('')
    setAberto(false)
  }

  function tecla(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAberto(true)
      setAtivo((a) => Math.min(filtradas.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAtivo((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter' && aberto) {
      e.preventDefault()
      const o = filtradas[ativo]
      if (o) escolher(o)
    } else if (e.key === 'Escape' && aberto) {
      // Só consome o Esc se a lista estiver aberta; senão o diálogo que contém
      // o campo nunca fecharia pelo teclado.
      e.stopPropagation()
      setAberto(false)
    }
  }

  return (
    <Campo rotulo={rotulo} dica={dica} erro={erro} nome={nome}>
      {({ id, descricaoId, invalido }) => (
        <div className="combo">
          <input
            id={id}
            role="combobox"
            aria-expanded={aberto}
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-activedescendant={aberto && filtradas[ativo] ? `${idLista}-${filtradas[ativo]!.valor}` : undefined}
            aria-describedby={descricaoId}
            aria-invalid={invalido || undefined}
            autoComplete="off"
            value={aberto ? busca : (selecionada?.texto ?? '')}
            placeholder={vazio ?? 'Digite para buscar…'}
            /* Abre por intenção — clique, digitação ou seta — e não ao receber
               foco. Abrir no foco faz a lista cobrir o formulário assim que o
               diálogo entra, e torna o primeiro Esc do usuário sempre um
               "fechar a lista" em vez de "fechar o diálogo". */
            onClick={() => setAberto(true)}
            onBlur={() => {
              // Atraso mínimo para o clique numa opção acontecer antes do
              // fechamento; sem ele o mousedown fecha a lista e o clique cai
              // no vazio.
              setTimeout(() => setAberto(false), 120)
              onBlur?.()
            }}
            onChange={(e) => {
              setBusca(e.target.value)
              setAtivo(0)
              setAberto(true)
            }}
            onKeyDown={tecla}
          />

          {aberto && (
            <ul className="combo__lista" id={idLista} role="listbox" aria-label={rotulo}>
              {filtradas.length === 0 && (
                <li className="combo__vazio" role="presentation">
                  Nada encontrado para “{busca}”.
                </li>
              )}
              {filtradas.map((o, i) => (
                <li
                  key={o.valor}
                  id={`${idLista}-${o.valor}`}
                  role="option"
                  aria-selected={o.valor === valor}
                  aria-disabled={o.desabilitada || undefined}
                  data-ativo={i === ativo}
                  data-desabilitada={o.desabilitada || undefined}
                  className="combo__item"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    escolher(o)
                  }}
                  onMouseEnter={() => setAtivo(i)}
                >
                  <span>{o.texto}</span>
                  {(o.detalhe || o.motivoDesabilitada) && <small>{o.motivoDesabilitada ?? o.detalhe}</small>}
                </li>
              ))}
            </ul>
          )}

          {/* Contagem anunciada a leitores de tela sem poluir a interface. */}
          <p className="so-leitor" role="status" aria-live="polite">
            {aberto ? `${filtradas.length} opções disponíveis` : ''}
          </p>
        </div>
      )}
    </Campo>
  )
}

/* ------------------------------------------------------------- grupo de opções */

interface GrupoProps {
  legenda: string
  dica?: string
  erro?: string
  opcoes: { valor: string; texto: string; detalhe?: string }[]
  valor: string
  aoMudar: (v: string) => void
}

/**
 * Escolha entre poucas opções mutuamente exclusivas.
 *
 * `<fieldset>` com `<legend>` em vez de um `<select>`: com três ou quatro
 * opções, ver todas de uma vez é mais rápido que abrir uma lista, e cada opção
 * pode trazer a consequência da escolha ao lado.
 */
export function GrupoOpcoes({ legenda, dica, erro, opcoes, valor, aoMudar }: GrupoProps) {
  const nome = useId()
  const idErro = useId()

  return (
    <fieldset className="grupo-opcoes" aria-describedby={erro ? idErro : undefined}>
      <legend>{legenda}</legend>
      {dica && <p className="campo__dica">{dica}</p>}
      {erro && (
        <p className="campo__erro" id={idErro}>
          {erro}
        </p>
      )}
      <div className="grupo-opcoes__itens">
        {opcoes.map((o) => (
          <label key={o.valor} className="opcao" data-marcada={o.valor === valor}>
            <input
              type="radio"
              name={nome}
              value={o.valor}
              checked={o.valor === valor}
              onChange={() => aoMudar(o.valor)}
            />
            <span className="pilha g1">
              <span className="opcao__texto">{o.texto}</span>
              {o.detalhe && <span className="opcao__detalhe">{o.detalhe}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/* --------------------------------------------------------------------- linhas */

/** Duas colunas em telas largas, empilhado em estreitas. */
export function LinhaCampos({ children }: { children: ReactNode }) {
  return <div className="linha-campos">{children}</div>
}
