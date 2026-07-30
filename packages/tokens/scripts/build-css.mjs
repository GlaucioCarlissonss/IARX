#!/usr/bin/env node
/**
 * Gera as custom properties CSS a partir de src/palette.json.
 *
 * O tema segue `prefers-color-scheme` por padrão e aceita sobreposição
 * explícita por `data-theme` no elemento raiz — necessário para o seletor de
 * tema da aplicação e para o modo alto contraste no PWA de campo.
 *
 * Nunca editar dist/tokens.css à mão: a fonte da verdade é o JSON, que passa
 * pelo validador de acessibilidade no CI.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const raiz = join(here, '..')
const palette = JSON.parse(readFileSync(join(raiz, 'src', 'palette.json'), 'utf8'))

const vars = (tema, indent = '    ') =>
  Object.entries(palette[tema])
    .filter(([k]) => !k.startsWith('$'))
    .map(([k, v]) => `${indent}--cor-${k}: ${v};`)
    .join('\n')

const css = `/* Gerado por packages/tokens/scripts/build-css.mjs — não editar à mão.
 * Fonte da verdade: packages/tokens/src/palette.json
 * Conformidade: ${palette.meta.norma} · tokens v${palette.meta.versao}
 * Verificação: pnpm a11y:tokens (bloqueia o merge em caso de reprovação)
 */

:root {
${vars('light')}

  /* Indicador de foco em anel duplo: permanece visível sobre qualquer fundo,
     inclusive sobre o botão primário (WCAG 2.4.11 / 2.4.13). */
  --foco-espessura: 2px;
  --foco-offset: 2px;
  --foco-sombra:
    0 0 0 var(--foco-offset) var(--cor-focus-ring-inset),
    0 0 0 calc(var(--foco-offset) + var(--foco-espessura)) var(--cor-focus-ring);

  /* Alvo mínimo de toque no PWA de campo (docs/09 §9.5). */
  --alvo-toque-min: 44px;
}

@media (prefers-color-scheme: dark) {
  :root {
${vars('dark', '      ')}
  }
}

/* Sobreposição explícita pelo seletor de tema da aplicação. */
:root[data-theme='light'] {
${vars('light')}
}

:root[data-theme='dark'] {
${vars('dark')}
}

/* Foco visível sempre, e nunca removido sem substituto equivalente. */
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: none;
  box-shadow: var(--foco-sombra);
}

/* WCAG 2.3.3 — respeita quem pediu menos movimento. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`

mkdirSync(join(raiz, 'dist'), { recursive: true })
writeFileSync(join(raiz, 'dist', 'tokens.css'), css, 'utf8')

const total = Object.keys(palette.light).filter((k) => !k.startsWith('$')).length
console.log(`dist/tokens.css gerado — ${total} tokens por tema, 2 temas`)
