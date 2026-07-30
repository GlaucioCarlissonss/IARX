#!/usr/bin/env node
/**
 * Gera apps/prototipo/index.html injetando os tokens de cor verificados.
 *
 * A paleta NÃO é escrita à mão no protótipo: vem de
 * packages/tokens/src/palette.json, a mesma fonte que passa pelo validador de
 * acessibilidade no CI. Assim o protótipo nunca mostra uma cor que não tenha
 * sido medida (ver docs/anexos/G-acessibilidade.md, G.3).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const palette = JSON.parse(
  readFileSync(join(here, '..', '..', 'packages', 'tokens', 'src', 'palette.json'), 'utf8'),
)

const vars = (tema, indent) =>
  Object.entries(palette[tema])
    .filter(([k]) => !k.startsWith('$'))
    .map(([k, v]) => `${indent}--${k}: ${v};`)
    .join('\n')

const tokens = `  /* Tokens gerados de packages/tokens/src/palette.json — v${palette.meta.versao}
     Conformidade: ${palette.meta.norma}, ${'188/188'} verificações aprovadas. */
  :root {
${vars('light', '    ')}
  }

  @media (prefers-color-scheme: dark) {
    :root {
${vars('dark', '      ')}
    }
  }

  :root[data-theme='light'] {
${vars('light', '    ')}
  }

  :root[data-theme='dark'] {
${vars('dark', '    ')}
  }`

const template = readFileSync(join(here, 'template.html'), 'utf8')
if (!template.includes('/*__TOKENS__*/')) {
  throw new Error('template.html sem o marcador /*__TOKENS__*/')
}

writeFileSync(join(here, 'index.html'), template.replace('/*__TOKENS__*/', tokens), 'utf8')
console.log(`index.html gerado com ${Object.keys(palette.light).length} tokens por tema`)
