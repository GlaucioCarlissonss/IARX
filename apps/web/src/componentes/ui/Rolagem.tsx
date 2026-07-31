import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * Contêiner de rolagem horizontal acessível.
 *
 * Recebe tabindex, role e rótulo APENAS quando o conteúdo de fato transborda —
 * do contrário viraria uma parada de Tab inútil. Reavaliado a redimensionar.
 *
 * Existe como componente porque a mesma necessidade apareceu em dois lugares
 * (tabelas e gráficos largos) e a segunda implementação foi esquecida, gerando
 * violação de WCAG 2.1.1 no painel de resultado.
 */
export function Rolagem({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ajustar = () => {
      if (el.scrollWidth > el.clientWidth + 1) {
        el.setAttribute('tabindex', '0')
        el.setAttribute('role', 'region')
        el.setAttribute('aria-label', `${rotulo} — role horizontalmente`)
      } else {
        el.removeAttribute('tabindex')
        el.removeAttribute('role')
        el.removeAttribute('aria-label')
      }
    }
    ajustar()
    const obs = new ResizeObserver(ajustar)
    obs.observe(el)
    return () => obs.disconnect()
  }, [rotulo, children])

  return (
    <div className="tabela-caixa" ref={ref}>
      {children}
    </div>
  )
}
