/**
 * Captura de telas do build, para revisão de usabilidade.
 *
 * Não é teste: é instrumento. Roda contra `apps/web/dist/index.html`, o mesmo
 * artefato que a suíte de acessibilidade exercita, porque revisar usabilidade
 * lendo código é revisar a intenção, não o resultado.
 */
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const APP = pathToFileURL(join(process.cwd(), 'apps', 'web', 'dist', 'index.html')).href
const SAIDA = process.argv[2] ?? '/tmp/telas'
mkdirSync(SAIDA, { recursive: true })

const ROTAS = [
  ['', 'inicio'],
  ['#/parque', 'parque'],
  ['#/contratos', 'contratos'],
  ['#/clientes', 'clientes'],
  ['#/chamados', 'chamados'],
  ['#/estoque', 'estoque'],
  ['#/contas-receber', 'contas-receber'],
  ['#/faturamento', 'faturamento'],
  ['#/resultado', 'resultado'],
  ['#/fluxo-caixa', 'fluxo-caixa'],
  ['#/comercial', 'comercial'],
  ['#/perfis', 'perfis'],
  ['#/entrar', 'entrar'],
]

const navegador = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--headless', '--no-sandbox'],
})
const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } })

// Sem rede: o mapa pede tiles e não vai tê-los. Uma tela de revisão não deve
// depender de um servidor de terceiro estar no ar.
await pagina.route('**://*.tile.openstreetmap.org/**', (r) => r.abort())
await pagina.route('**://*.basemaps.cartocdn.com/**', (r) => r.abort())

for (const [hash, nome] of ROTAS) {
  await pagina.goto(APP + hash)
  await pagina.waitForFunction(
    () => (document.querySelector('#raiz')?.childElementCount ?? 0) > 0,
    null,
    { timeout: 15000 },
  )
  await pagina.waitForTimeout(500)
  await pagina.screenshot({ path: join(SAIDA, `${nome}.png`), fullPage: false })
  console.log('capturado:', nome)
}

// E uma em largura de celular, que é onde o layout aperta.
await pagina.setViewportSize({ width: 390, height: 844 })
await pagina.goto(APP)
await pagina.waitForTimeout(600)
await pagina.screenshot({ path: join(SAIDA, 'inicio-390.png') })
console.log('capturado: inicio-390')

await navegador.close()
