/**
 * Gate de acessibilidade do protótipo — roda no CI e bloqueia o merge.
 *
 * Complementa o validador de tokens: aquele mede cor no JSON, este mede o DOM
 * renderizado em navegador real. É a única forma de verificar contraste
 * efetivo, ordem de foco e semântica ARIA (docs/anexos/G-acessibilidade.md, G.8).
 *
 * Uso: npx playwright test apps/prototipo/a11y.spec.mjs
 */
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const PAGINA = pathToFileURL(join(process.cwd(), 'apps', 'prototipo', 'index.html')).href

/** O arquivo publicado é um fragmento; para testar precisa do envelope de documento. */
async function abrir(page, { tema = 'light', largura = 1280, altura = 900 } = {}) {
  await page.setViewportSize({ width: largura, height: altura })
  await page.emulateMedia({ colorScheme: tema })
  await page.goto(PAGINA)
  await page.waitForFunction(() => document.querySelectorAll('#excecoes button').length > 0)
}

const TELAS = ['inicio', 'frota', 'alocar', 'mapa', 'fatura']

/** Violações que o axe classifica como impeditivas para nós. */
const BLOQUEANTES = ['critical', 'serious']

async function analisar(page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return r.violations.filter((v) => BLOQUEANTES.includes(v.impact))
}

function descrever(violacoes) {
  return violacoes
    .map((v) => `${v.impact.toUpperCase()} · ${v.id}: ${v.help}\n    ` +
      v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    '))
    .join('\n  ')
}

for (const tema of ['light', 'dark']) {
  for (const tela of TELAS) {
    test(`axe · tela ${tela} · tema ${tema}`, async ({ page }) => {
      await abrir(page, { tema })
      if (tela !== 'inicio') {
        await page.click(`.nav button[data-tela="${tela}"]`)
        await expect(page.locator(`[data-painel="${tela}"]`)).toBeVisible()
      }
      const v = await analisar(page)
      expect(v, `violações bloqueantes:\n  ${descrever(v)}`).toEqual([])
    })
  }
}

test('axe · 320 px sem rolagem horizontal do corpo', async ({ page }) => {
  await abrir(page, { largura: 320, altura: 640 })
  const v = await analisar(page)
  expect(v, `violações bloqueantes:\n  ${descrever(v)}`).toEqual([])

  // WCAG 1.4.10: conteúdo largo rola no próprio contêiner, nunca no body.
  const transbordo = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(transbordo, 'o corpo da página não deve rolar lateralmente em 320 px').toBeLessThanOrEqual(1)
})

test('axe · 200% de zoom', async ({ page }) => {
  await abrir(page, { largura: 640, altura: 512 })
  const v = await analisar(page)
  expect(v, `violações bloqueantes:\n  ${descrever(v)}`).toEqual([])
})

test('primeiro Tab alcança "Pular para o conteúdo"', async ({ page }) => {
  await abrir(page)
  await page.keyboard.press('Tab')
  const texto = await page.evaluate(() => document.activeElement?.textContent?.trim())
  expect(texto).toBe('Pular para o conteúdo')
})

test('todo elemento focável tem indicador de foco visível', async ({ page }) => {
  await abrir(page)
  const semIndicador = await page.evaluate(() => {
    // Elementos SVG são verificados no teste seguinte: ali o indicador se
    // expressa no traço da forma, não em box-shadow ou outline do próprio nó.
    const focaveis = Array.from(
      document.querySelectorAll('a[href], button, input, select, [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => !(el instanceof SVGElement) && el.offsetParent !== null)

    const ruins = []
    for (const el of focaveis) {
      el.focus()
      const s = getComputedStyle(el)
      const temSombra = s.boxShadow && s.boxShadow !== 'none'
      const temContorno = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0
      if (!temSombra && !temContorno) {
        ruins.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
          ' "' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28) + '"')
      }
    }
    return ruins
  })
  expect(semIndicador, 'elementos sem indicador de foco').toEqual([])
})

test('marcador do mapa mostra foco pelo traço da forma', async ({ page }) => {
  await abrir(page)
  await page.click('.nav button[data-tela="mapa"]')

  const pino = page.locator('.mapa-pino').first()
  const antes = await pino.locator('circle').nth(1).evaluate((c) => getComputedStyle(c).strokeWidth)
  await pino.focus()
  const depois = await pino.locator('circle').nth(1).evaluate((c) => getComputedStyle(c).strokeWidth)

  expect(parseFloat(depois)).toBeGreaterThan(parseFloat(antes))

  // O marcador precisa ter nome acessível, já que é um controle.
  await expect(pino).toHaveAttribute('aria-label', /ativos/)
})

test('abas do mapa seguem o padrão ARIA e navegam por setas', async ({ page }) => {
  await abrir(page)
  await page.click('.nav button[data-tela="mapa"]')

  await page.click('#aba-mapa')
  await expect(page.locator('#aba-mapa')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#p-lista')).toBeHidden()

  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#aba-lista')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#p-lista')).toBeVisible()
  await expect(page.locator('#p-mapa')).toBeHidden()

  // G.4: a lista precisa trazer os MESMOS dados do mapa, não um resumo.
  const pinos = await page.locator('#mapa-pinos > g').count()
  const linhas = await page.locator('#mapa-lista tr').count()
  expect(linhas, 'a lista deve ter uma linha por marcador do mapa').toBe(pinos)
})

test('estado nunca depende só de cor: todo chip tem rótulo textual', async ({ page }) => {
  await abrir(page)
  const semTexto = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.estado'))
      .filter((el) => {
        const visivel = Array.from(el.childNodes)
          .filter((n) => !(n.nodeType === 1 && n.getAttribute('aria-hidden') === 'true'))
          .map((n) => n.textContent.trim())
          .join('')
        return visivel.length === 0
      })
      .map((el) => el.outerHTML.slice(0, 80)))
  expect(semTexto, 'chips de estado sem rótulo textual').toEqual([])
})

test('RN-001: a interface recusa alocação sobreposta com alternativas', async ({ page }) => {
  await abrir(page)
  await page.click('.nav button[data-tela="alocar"]')

  await page.selectOption('#a-equip', '10422')
  await page.fill('#a-inicio', '2026-09-01')
  await page.fill('#a-fim', '2027-06-30')
  await page.click('#form-alocar button[type="submit"]')

  const res = page.locator('#a-resultado')
  await expect(res).toContainText('já alocado no período')
  await expect(res).toContainText('SP-2026-0148')
  // Mensagem acionável: precisa dizer o que fazer, não só que falhou (§6.1).
  await expect(res.locator('li')).toHaveCount(3)
  await expect(res).toContainText('Reservar a partir de')

  // Período livre deve ser aceito — a regra não pode ser um bloqueio cego.
  await page.fill('#a-inicio', '2027-01-01')
  await page.fill('#a-fim', '2027-06-30')
  await page.click('#form-alocar button[type="submit"]')
  await expect(res).toContainText('Equipamento alocado')
})

test('RN-014: ativo bloqueado é recusado com caminho de saída', async ({ page }) => {
  await abrir(page)
  await page.click('.nav button[data-tela="alocar"]')
  await page.selectOption('#a-equip', '20114')
  await page.click('#form-alocar button[type="submit"]')

  const res = page.locator('#a-resultado')
  await expect(res).toContainText('ativo bloqueado')
  await expect(res).toContainText('preventiva vencida')
  await expect(res.locator('li')).toHaveCount(3)
})

test('filtro da frota anuncia a contagem e oferece saída no vazio', async ({ page }) => {
  await abrir(page)
  await page.click('.nav button[data-tela="frota"]')

  const contagem = page.locator('#frota-contagem')
  await expect(contagem).toHaveAttribute('aria-live', 'polite')
  await expect(contagem).toContainText('9 de 9 ativos')

  await page.fill('#f-texto', 'inexistente-zzz')
  await expect(contagem).toContainText('0 de 9 ativos')
  // Estado vazio nunca é beco sem saída (§9.3).
  await expect(page.locator('#limpar-filtros')).toBeVisible()
  await page.click('#limpar-filtros')
  await expect(contagem).toContainText('9 de 9 ativos')
})
