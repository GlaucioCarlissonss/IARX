import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

/**
 * Configuração dos testes de acessibilidade e comportamento do protótipo.
 *
 * O ambiente traz o Chromium pré-instalado em PLAYWRIGHT_BROWSERS_PATH, cuja
 * revisão pode não coincidir com a esperada pela versão do @playwright/test.
 * Quando um binário conhecido existe, apontamos direto para ele em vez de
 * baixar outro — `playwright install` não deve ser executado aqui.
 *
 * ## Por que o link estável vem primeiro
 *
 * A versão anterior fixava `chromium-1194`. O caminho sumiu numa atualização
 * da imagem — passou a ser `chromium-1243` — e as 231 verificações falharam de
 * uma vez, todas com "Executable doesn't exist". O número da revisão é
 * exatamente o que muda sem avisar; `/opt/pw-browsers/chromium` é o link que
 * a imagem mantém apontando para a revisão atual.
 *
 * O caminho versionado fica como alternativa para imagens que não tenham o
 * link, e `PLAYWRIGHT_CHROMIUM` permite apontar à mão quando nenhum dos dois
 * servir. Em integração contínua os três ficam vazios e o Playwright usa o
 * binário que ele mesmo instalou, que é o que se quer lá: o navegador testado
 * é o da versão fixada no `package.json`.
 */
const CANDIDATOS = [
  process.env.PLAYWRIGHT_CHROMIUM,
  '/opt/pw-browsers/chromium',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean)

const CHROMIUM_LOCAL = CANDIDATOS.find((c) => existsSync(c))
const usarLocal = Boolean(CHROMIUM_LOCAL) && !process.env.CI

export default defineConfig({
  testDir: './apps',
  testMatch: '**/*.spec.mjs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    launchOptions: usarLocal ? { executablePath: CHROMIUM_LOCAL } : {},
  },
})
