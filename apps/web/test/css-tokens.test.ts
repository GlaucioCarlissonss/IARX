/**
 * Toda `var(--x)` do CSS precisa existir — ou trazer alternativa.
 *
 * Este portão nasceu de um defeito real e invisível: oito declarações usavam
 * `--cor-text`, `--t-16` e `--cor-atencao-subtle-bg`, que **não existem**. Em
 * CSS, `color: var(--inexistente)` não é erro: a declaração inteira é
 * descartada e a propriedade cai para o valor herdado. O botão de zoom do mapa,
 * o aviso de precisão, a prévia de alçada, a lista de descrições e o alternador
 * ficaram meses com cor e tamanho herdados, e nada acusou.
 *
 * Nenhum dos portões existentes pegava: `a11y:tokens` valida a **paleta** —
 * contraste e distinção sob daltonismo entre os valores declarados — e não o
 * CSS que a consome; o axe aprovava porque a cor herdada, por acaso, tinha
 * contraste suficiente. Um defeito que só se vê comparando a tela com a
 * intenção.
 *
 * `var(--x, algo)` é aceito de propósito: com alternativa declarada, a ausência
 * é uma escolha e não um engano.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const APP = join(raiz, 'apps', 'web', 'src', 'estilos', 'global.css')
const TOKENS = join(raiz, 'packages', 'tokens', 'dist', 'tokens.css')

const css = readFileSync(APP, 'utf8')
const tokens = readFileSync(TOKENS, 'utf8')

/** Nomes declarados em qualquer um dos dois arquivos de token. */
function declarados(): Set<string> {
  const nomes = new Set<string>()
  for (const fonte of [css, tokens]) {
    for (const m of fonte.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gi)) nomes.add(m[2]!)
  }
  return nomes
}

test('nenhuma var(--x) do CSS da aplicação está sem declaração e sem alternativa', () => {
  const existe = declarados()
  const quebradas: string[] = []

  for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/gi)) {
    const nome = m[1]!
    const temAlternativa = Boolean(m[2])
    if (!existe.has(nome) && !temAlternativa) {
      const linha = css.slice(0, m.index).split('\n').length
      quebradas.push(`${nome} (linha ${linha})`)
    }
  }

  assert.deepEqual(
    quebradas,
    [],
    `declaração inválida: a propriedade cai para o valor herdado sem acusar nada —\n  ${quebradas.join('\n  ')}`,
  )
})

/**
 * As duas cores cruas que o sistema de tokens **não** deve governar.
 *
 * Exceção declarada, e não inferida: quem acrescentar uma terceira precisa
 * justificá-la aqui, e é esse o ponto do portão. Ambas existem porque o que
 * está embaixo delas não é interface — é mapa.
 */
const CORES_CRUAS_JUSTIFICADAS: Record<string, string> = {
  '#10131a':
    'fundo sob os tiles do basemap escuro: sem ele, um mapa escuro pisca branco a cada passo de zoom',
  '#ffffff':
    'divisa de estado sobre imagem de satélite: a fotografia não muda com o tema, e uma divisa que escurecesse junto sumiria sobre ela no tema escuro',
}

test('o CSS da aplicação não reintroduz cor crua fora dos tokens', () => {
  /*
   * A paleta é gerada e validada por contraste e por distinção sob daltonismo;
   * uma cor escrita à mão no CSS escapa dessa verificação inteira — e não
   * acompanha o tema.
   */
  const cruas = [...css.matchAll(/(^|[\s:(])(#[0-9a-f]{3,8})\b/gi)]
    .map((m) => ({ cor: m[2]!.toLowerCase(), linha: css.slice(0, m.index).split('\n').length }))
    .filter(({ cor, linha }) => {
      const texto = css.split('\n')[linha - 1] ?? ''
      // Declaração de token é onde a cor crua é legítima por definição.
      if (/^\s*--/.test(texto)) return false
      return !(cor in CORES_CRUAS_JUSTIFICADAS)
    })

  assert.deepEqual(
    cruas.map((c) => `${c.cor} (linha ${c.linha})`),
    [],
    'cor fora do sistema de tokens: não passa pela verificação de contraste nem muda no tema escuro.\n' +
      'Se for deliberada, declare a razão em CORES_CRUAS_JUSTIFICADAS.',
  )
})
