import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

/**
 * Configuração dos testes de acessibilidade e comportamento do protótipo.
 *
 * O ambiente traz o Chromium pré-instalado em PLAYWRIGHT_BROWSERS_PATH, cuja
 * revisão pode não coincidir com a esperada pela versão do @playwright/test.
 * Quando o binário conhecido existe, apontamos direto para ele em vez de
 * baixar outro — `playwright install` não deve ser executado aqui.
 */
const CHROMIUM_LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const usarLocal = existsSync(CHROMIUM_LOCAL)

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
