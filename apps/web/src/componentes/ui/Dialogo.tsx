import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * Diálogo modal.
 *
 * Implementado à mão em vez de `<dialog>` nativo por um motivo específico: o
 * `showModal()` nativo ainda diverge entre navegadores no tratamento de foco
 * inicial e no comportamento do backdrop com formulários longos. O padrão
 * abaixo é o do APG e é previsível em todos.
 *
 * As quatro obrigações de um modal, todas cumpridas aqui:
 *
 *  1. `aria-modal` + `role="dialog"` + nome acessível — sem o nome, o leitor de
 *     tela anuncia "diálogo" e o usuário não sabe onde entrou;
 *  2. foco entra no diálogo ao abrir e **volta à origem** ao fechar — sem isso o
 *     usuário de teclado é devolvido ao início do documento;
 *  3. Tab circula dentro do diálogo — sem a armadilha, o teclado sai para o
 *     conteúdo de trás, que está inerte visualmente mas não para o foco;
 *  4. Esc fecha.
 *
 * A rolagem do corpo é travada porque um modal aberto sobre uma página que rola
 * atrás é desorientador, especialmente com ampliação de tela.
 */

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface DialogoProps {
  titulo: string
  descricao?: string
  aoFechar: () => void
  children: ReactNode
  /** Ações do rodapé — normalmente confirmar e cancelar. */
  acoes?: ReactNode
  largura?: 'estreito' | 'medio' | 'largo'
}

export function Dialogo({ titulo, descricao, aoFechar, children, acoes, largura = 'medio' }: DialogoProps) {
  const caixaRef = useRef<HTMLDivElement>(null)
  const corpoRef = useRef<HTMLDivElement>(null)
  const origemRef = useRef<Element | null>(null)
  const idTitulo = useId()
  const idDescricao = useId()

  useEffect(() => {
    origemRef.current = document.activeElement

    const caixa = caixaRef.current
    // Primeiro campo, não o primeiro botão: em formulário o usuário quer
    // digitar, e mandar o foco para "Cancelar" convida ao erro.
    const primeiro = caixa?.querySelector<HTMLElement>('input, select, textarea') ?? caixa
    primeiro?.focus()

    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = overflowAnterior
      if (origemRef.current instanceof HTMLElement) origemRef.current.focus()
    }
  }, [])

  /**
   * Corpo que rola precisa ser alcançável pelo teclado.
   *
   * Só vira parada de Tab quando de fato transborda **e** não tem nada focável
   * dentro. Diálogo de formulário rola com os campos, e o Tab já passa por
   * eles; um diálogo só de leitura — a prévia de integração da nota, com dez
   * linhas de tabela — não tem nenhum, e sem isto o conteúdo abaixo da dobra
   * fica inacessível a quem não usa mouse (WCAG 2.1.1).
   */
  useEffect(() => {
    const el = corpoRef.current
    if (!el) return

    const ajustar = () => {
      const transborda = el.scrollHeight > el.clientHeight + 1
      const temFocavel = el.querySelector(FOCAVEIS) !== null
      if (transborda && !temFocavel) {
        el.setAttribute('tabindex', '0')
        el.setAttribute('role', 'region')
        el.setAttribute('aria-label', `${titulo} — role verticalmente`)
      } else {
        el.removeAttribute('tabindex')
        el.removeAttribute('role')
        el.removeAttribute('aria-label')
      }
    }

    ajustar()
    const obs = new ResizeObserver(ajustar)
    obs.observe(el)
    // O conteúdo pode crescer sem o contêiner mudar de tamanho — um resumo de
    // erros que aparece, uma linha nova na tabela.
    const mut = new MutationObserver(ajustar)
    mut.observe(el, { childList: true, subtree: true })
    return () => {
      obs.disconnect()
      mut.disconnect()
    }
  }, [titulo, children])

  function tecla(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      aoFechar()
      return
    }
    if (e.key !== 'Tab') return

    const alvos = Array.from(caixaRef.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? []).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    )
    if (alvos.length === 0) return
    const primeiro = alvos[0]!
    const ultimo = alvos[alvos.length - 1]!

    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault()
      primeiro.focus()
    }
  }

  return (
    <div
      className="dialogo-fundo"
      onMouseDown={(e) => {
        // Só fecha se o gesto começou e terminou no fundo. Sem esta checagem,
        // arrastar para selecionar texto e soltar fora fecharia o formulário
        // com tudo preenchido dentro.
        if (e.target === e.currentTarget) aoFechar()
      }}
    >
      <div
        className={`dialogo dialogo--${largura}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={descricao ? idDescricao : undefined}
        ref={caixaRef}
        onKeyDown={tecla}
        tabIndex={-1}
      >
        <div className="dialogo__cabeca">
          <div>
            <h2 className="dialogo__titulo" id={idTitulo}>
              {titulo}
            </h2>
            {descricao && (
              <p className="dialogo__descricao" id={idDescricao}>
                {descricao}
              </p>
            )}
          </div>
          <button className="btn btn--sutil btn--pequeno" onClick={aoFechar} aria-label={`Fechar ${titulo}`}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="dialogo__corpo" ref={corpoRef}>
          {children}
        </div>

        {acoes && <div className="dialogo__rodape">{acoes}</div>}
      </div>
    </div>
  )
}
