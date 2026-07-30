/**
 * Tokens de design da IARX.
 *
 * Fonte da verdade: palette.json — validado por scripts/validate-contrast.mjs
 * no CI. Nunca definir cor literal em componente: sempre consumir daqui ou das
 * custom properties geradas (dist/tokens.css).
 */
import palette from './palette.json' with { type: 'json' }

export const meta = palette.meta
export const light = palette.light
export const dark = palette.dark

/** Séries categóricas de gráfico, na ordem de uso. Ver docs/anexos/G-acessibilidade.md (G.6). */
export const series = (tema = 'light') =>
  [1, 2, 3, 4, 5].map((i) => palette[tema][`serie-${i}`])

/**
 * Limite de categorias codificáveis por cor. Acima disso, a orientação é
 * agrupar em "outros", usar small multiples ou rotular diretamente — não
 * adicionar uma sexta cor.
 */
export const MAX_SERIES_POR_COR = 5

export default palette
