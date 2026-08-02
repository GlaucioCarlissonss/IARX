/**
 * Suíte da aplicação: acessibilidade, navegação, permissões e regras visíveis.
 *
 * Roda contra o build de arquivo único (dist/index.html) — o mesmo artefato que
 * é publicado. Testar o build, e não o servidor de desenvolvimento, evita a
 * classe de defeito que só aparece depois do bundle.
 */
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const APP = pathToFileURL(join(process.cwd(), 'apps', 'web', 'dist', 'index.html')).href

const ROTAS = [
  { hash: '', nome: 'painel do dia', titulo: 'O que exige ação hoje' },
  { hash: '#/parque', nome: 'parque instalado', titulo: 'Parque instalado' },
  { hash: '#/contratos', nome: 'contratos', titulo: 'Contratos' },
  { hash: '#/clientes', nome: 'clientes', titulo: 'Clientes' },
  { hash: '#/chamados', nome: 'chamados', titulo: 'Chamados técnicos' },
  { hash: '#/estoque', nome: 'estoque', titulo: 'Peças e suprimentos' },
  { hash: '#/faturamento', nome: 'faturamento', titulo: 'Faturamento' },
  { hash: '#/resultado', nome: 'resultado', titulo: 'Resultado operacional' },
]

const BLOQUEANTES = ['critical', 'serious']

async function abrir(page, { hash = '', tema = 'light', largura = 1360, altura = 900 } = {}) {
  await page.setViewportSize({ width: largura, height: altura })
  await page.emulateMedia({ colorScheme: tema })
  await page.goto(APP + hash)
  // Espera o fim do carregamento assíncrono: nenhuma região continua ocupada.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15000 })
}

async function violacoes(page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return r.violations.filter((v) => BLOQUEANTES.includes(v.impact))
}

const descrever = (vs) =>
  vs
    .map(
      (v) =>
        `${v.impact.toUpperCase()} · ${v.id}: ${v.help}\n    ` +
        v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    '),
    )
    .join('\n  ')

/* ------------------------------------------------------------ acessibilidade */

for (const tema of ['light', 'dark']) {
  for (const rota of ROTAS) {
    test(`axe · ${rota.nome} · tema ${tema}`, async ({ page }) => {
      await abrir(page, { hash: rota.hash, tema })
      await expect(page.getByRole('heading', { level: 1, name: rota.titulo })).toBeVisible()
      const v = await violacoes(page)
      expect(v, `violações bloqueantes:\n  ${descrever(v)}`).toEqual([])
    })
  }
}

test('reflow em 320 px sem rolagem lateral do corpo', async ({ page }) => {
  for (const rota of ROTAS) {
    await abrir(page, { hash: rota.hash, largura: 320, altura: 720 })
    const transbordo = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(transbordo, `${rota.nome} não deve rolar lateralmente em 320 px`).toBeLessThanOrEqual(1)
  }
})

/**
 * Estas duas verificações existem por causa de um defeito real e caro.
 *
 * `.rail` declarava `grid-row: 1 / -1` sem que `.app` tivesse
 * `grid-template-rows`. A linha -1 resolve contra o grid EXPLÍCITO; sem faixas
 * explícitas ela coincide com a linha 1, o rail ficava preso à primeira faixa
 * e — por ter `height: 100vh` — esticava essa faixa até uma viewport inteira.
 * Resultado: a barra com 900px de altura em 1440×900 e o conteúdo começando
 * abaixo da dobra, com a tela em branco.
 *
 * Nada disso é violação de WCAG, nenhuma consulta de axe reprova, e o layout
 * "funciona" no sentido de que rola. Só uma medida de posição pega.
 */
test('o conteúdo começa logo abaixo da barra, em qualquer largura', async ({ page }) => {
  for (const [largura, altura] of [
    [1993, 700],
    [1440, 900],
    [1280, 800],
    [1024, 768],
    [900, 700],
  ]) {
    await abrir(page, { largura, altura })
    const m = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect()
      return { barra: Math.round(r('.barra').height), topo: Math.round(r('.conteudo').y) }
    })
    expect(m.barra, `barra alta demais em ${largura}px — controles quebrando em várias linhas`)
      .toBeLessThanOrEqual(80)
    expect(m.topo, `conteúdo começa em y=${m.topo} em ${largura}×${altura}: há um vão antes dele`)
      .toBeLessThanOrEqual(80)
  }
})

test('barra, conteúdo e rodapé compartilham a mesma margem esquerda', async ({ page }) => {
  // Se as três não usarem a mesma medida, a busca fica alinhada com uma borda e
  // o título da página com outra — desalinhamento que se lê como descuido antes
  // de se ler como erro.
  for (const [largura, altura] of [
    [2560, 1440],
    [1440, 900],
    [1024, 768],
    [390, 844],
  ]) {
    await abrir(page, { largura, altura })
    const xs = await page.evaluate(() => {
      const x = (s) => Math.round(document.querySelector(s).getBoundingClientRect().x)
      return { busca: x('.busca'), titulo: x('h1'), rodape: x('.rodape p'), cartao: x('.excecao') }
    })
    expect(new Set(Object.values(xs)).size, `bordas divergentes em ${largura}px: ${JSON.stringify(xs)}`).toBe(1)
  }
})

test('axe em 320 px e em 200% de zoom', async ({ page }) => {
  await abrir(page, { largura: 320, altura: 720 })
  let v = await violacoes(page)
  expect(v, `320 px:\n  ${descrever(v)}`).toEqual([])

  await abrir(page, { largura: 680, altura: 512 })
  v = await violacoes(page)
  expect(v, `200% de zoom:\n  ${descrever(v)}`).toEqual([])
})

test('primeiro Tab alcança "Pular para o conteúdo"', async ({ page }) => {
  await abrir(page)
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Pular para o conteúdo')
})

test('todo elemento focável tem indicador de foco visível', async ({ page }) => {
  await abrir(page)

  // Percorre com Tab de verdade: :focus-visible depende da rota pela qual o
  // foco chegou, e foco movido por script não aciona a heurística do navegador
  // de forma confiável.
  const semIndicador = []
  const vistos = new Set()

  for (let i = 0; i < 45; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const s = getComputedStyle(el)
      return {
        id: el.tagName + '|' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 34),
        temSombra: Boolean(s.boxShadow && s.boxShadow !== 'none'),
        temContorno: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0,
        ehSvg: el instanceof SVGElement,
      }
    })
    if (!info || vistos.has(info.id)) continue
    vistos.add(info.id)
    if (!info.ehSvg && !info.temSombra && !info.temContorno) semIndicador.push(info.id)
  }

  expect(vistos.size, 'a navegação por Tab deve alcançar vários controles').toBeGreaterThan(12)
  expect(semIndicador, 'elementos sem indicador de foco ao navegar por Tab').toEqual([])
})

test('estado nunca depende só de cor: todo chip tem rótulo textual', async ({ page }) => {
  for (const rota of ROTAS) {
    await abrir(page, { hash: rota.hash })
    const semTexto = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.chip'))
        .filter((el) => {
          const visivel = Array.from(el.childNodes)
            .filter((n) => !(n.nodeType === 1 && n.getAttribute('aria-hidden') === 'true'))
            .map((n) => n.textContent.trim())
            .join('')
          return visivel.length === 0
        })
        .map((el) => el.outerHTML.slice(0, 90)),
    )
    expect(semTexto, `${rota.nome}: chips sem rótulo textual`).toEqual([])
  }
})

/* ------------------------------------------------------------------ navegação */

test('paleta de comandos: atalho, setas, Enter e devolução de foco', async ({ page }) => {
  await abrir(page)

  await page.keyboard.press('Control+k')
  const dialogo = page.getByRole('dialog', { name: /busca global/i })
  await expect(dialogo).toBeVisible()

  // Combobox completo: activedescendant acompanha a navegação por setas.
  const campo = dialogo.getByRole('combobox')
  await expect(campo).toBeFocused()
  const primeiro = await campo.getAttribute('aria-activedescendant')
  await page.keyboard.press('ArrowDown')
  expect(await campo.getAttribute('aria-activedescendant')).not.toBe(primeiro)

  await page.keyboard.press('Escape')
  await expect(dialogo).toBeHidden()
  // Foco volta para a origem — sem isso o usuário de teclado se perde.
  expect(await page.evaluate(() => document.activeElement?.className)).toContain('busca')
})

test('busca global encontra equipamento por patrimônio e navega até ele', async ({ page }) => {
  await abrir(page)
  await page.keyboard.press('Control+k')
  const dialogo = page.getByRole('dialog', { name: /busca global/i })
  await dialogo.getByRole('combobox').fill('10001')

  const opcoes = dialogo.getByRole('option')
  await expect(opcoes.first()).toContainText('10001')
  await opcoes.first().click()

  await expect(page.getByRole('heading', { level: 1, name: 'Parque instalado' })).toBeVisible()
  // O filtro chegou pela URL: a lista já vem recortada.
  await expect(page.getByLabel(/Patrimônio, série, modelo ou cliente/)).toHaveValue('10001')
})

test('cartão de exceção leva à lista já filtrada', async ({ page }) => {
  await abrir(page)
  await page.getByRole('button', { name: /equipamentos bloqueados/i }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Parque instalado' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Bloqueados para alocação/ })).toBeVisible()

  // A ficha do filtro vem da URL e renderiza de imediato; a tabela espera o
  // carregamento. A asserção precisa reexecutar, senão mede antes de existir.
  const chips = page.locator('tbody .chip--critico')
  await expect(chips.first()).toBeVisible()
  expect(await chips.count()).toBe(3)

  // E nada além de bloqueados: toda linha da tabela é um deles.
  expect(await page.locator('tbody tr').count()).toBe(3)
})

test('migalhas aparecem fora da raiz e voltam ao painel', async ({ page }) => {
  await abrir(page, { hash: '#/estoque' })
  const trilha = page.getByRole('navigation', { name: 'Trilha de navegação' })
  await expect(trilha).toBeVisible()
  await trilha.getByRole('link', { name: 'Painel do dia' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'O que exige ação hoje' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Trilha de navegação' })).toHaveCount(0)
})

/* ---------------------------------------------------------------- permissões */

test('perfil sem permissão não vê o item no menu nem acessa a rota', async ({ page }) => {
  await abrir(page)
  await expect(page.getByRole('link', { name: /Resultado/ })).toBeVisible()

  await page.getByLabel('Perfil de acesso').selectOption('suporte')

  // Supervisor de suporte não tem painel executivo nem faturamento.
  await expect(page.getByRole('link', { name: /Resultado/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Faturamento/ })).toHaveCount(0)
  // Mas tem chamados e estoque.
  await expect(page.getByRole('link', { name: /Chamados/ })).toBeVisible()

  // Acesso direto pela URL também é barrado, com explicação e caminho de saída.
  await page.goto(APP + '#/resultado')
  await expect(page.getByText(/não faz parte do seu perfil/i)).toBeVisible()
  await expect(page.getByText(/financeiro:painel_executivo/)).toBeVisible()
})

test('ação restrita não é renderizada para perfil sem alçada', async ({ page }) => {
  await abrir(page, { hash: '#/faturamento' })
  await expect(page.getByRole('button', { name: /Aprovar .* itens sem exceção/ })).toBeVisible()

  await page.getByLabel('Perfil de acesso').selectOption('operacao')
  await page.goto(APP + '#/faturamento')
  await expect(page.getByRole('heading', { level: 1, name: 'Faturamento' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Aprovar .* itens sem exceção/ })).toHaveCount(0)
})

/* --------------------------------------------------------- tabelas e filtros */

test('ordenação anuncia direção por aria-sort e reordena de fato', async ({ page }) => {
  await abrir(page, { hash: '#/clientes' })

  // Escopo explícito na tabela de clientes: a página tem outras tabelas antes
  // dela (os gráficos de barras também são tabelas, por acessibilidade).
  const tabela = page.getByRole('table', { name: /Clientes com parque/i })
  const cabecalho = tabela.getByRole('columnheader', { name: /Recorrente/ })

  // A tela abre ordenada por recorrente decrescente.
  await expect(cabecalho).toHaveAttribute('aria-sort', 'descending')

  const primeiroAntes = await tabela.locator('tbody tr th').first().innerText()
  await cabecalho.getByRole('button').click()
  await expect(cabecalho).toHaveAttribute('aria-sort', 'ascending')
  const primeiroDepois = await tabela.locator('tbody tr th').first().innerText()
  expect(primeiroDepois).not.toBe(primeiroAntes)
})

test('estado vazio explica e oferece saída', async ({ page }) => {
  await abrir(page, { hash: '#/parque' })
  await page.getByLabel(/Patrimônio, série, modelo ou cliente/).fill('zzz-inexistente')

  await expect(page.getByText('Nenhum equipamento com esses filtros')).toBeVisible()
  const limpar = page.getByRole('button', { name: 'Limpar filtros' })
  await expect(limpar).toBeVisible()
  await limpar.click()
  await expect(page.getByText('Nenhum equipamento com esses filtros')).toHaveCount(0)
})

test('contagem de registros é anunciada em região viva', async ({ page }) => {
  await abrir(page, { hash: '#/estoque' })
  const contagem = page.locator('[role="status"]', { hasText: /registros?/ }).first()
  await expect(contagem).toBeVisible()
  const antes = await contagem.innerText()

  await page.getByLabel('Recorte').selectOption('reposicao')
  await expect(contagem).not.toHaveText(antes)
})

test('filtro sobrevive ao recarregamento por estar na URL', async ({ page }) => {
  await abrir(page, { hash: '#/parque?estado=EM_MANUTENCAO' })
  await expect(page.getByRole('button', { name: /Estado: Em manutenção/ })).toBeVisible()
  await page.reload()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Estado: Em manutenção/ })).toBeVisible()
})

/* --------------------------------------------------------------- feedback */

test('ação de escrita dá retorno em região viva', async ({ page }) => {
  await abrir(page, { hash: '#/estoque' })
  await page.getByRole('button', { name: /Gerar sugestão de compra/ }).click()

  const avisos = page.getByRole('region', { name: 'Avisos do sistema' })
  await expect(avisos).toContainText('Sugestão de compra gerada')
  await expect(avisos).toHaveAttribute('aria-live', 'polite')

  await avisos.getByRole('button', { name: 'Fechar' }).click()
  await expect(avisos).not.toContainText('Sugestão de compra gerada')
})

test('gráfico traz alternativa em tabela com os mesmos valores', async ({ page }) => {
  await abrir(page, { hash: '#/resultado' })

  const detalhe = page.getByText('Ver os mesmos dados em tabela').first()
  await detalhe.click()

  const tabela = page.getByRole('table', { name: /valores por competência/i })
  await expect(tabela).toBeVisible()
  // 12 competências de histórico.
  expect(await tabela.locator('tbody tr').count()).toBe(12)
})

/* ------------------------------------------------------- dados de domínio */

test('base reflete locação de impressoras e computadores', async ({ page }) => {
  await abrir(page, { hash: '#/parque' })

  // Categorias do domínio correto.
  const familia = page.getByLabel('Família')
  await familia.selectOption('IMPRESSAO')
  await expect(page.locator('tbody')).toContainText(/Multifuncional|laser|térmica/i)

  await familia.selectOption('COMPUTACAO')
  await expect(page.locator('tbody')).toContainText(/desktop|Notebook|Thin client/i)

  // Fabricantes reais do setor aparecem nos modelos.
  await familia.selectOption('')
  const corpo = await page.locator('tbody').innerText()
  expect(corpo).toMatch(/Kyocera|HP|Lexmark|Brother|Dell|Lenovo|Zebra|Positivo/)
})

test('CNPJ dos clientes tem dígitos verificadores válidos', async ({ page }) => {
  await abrir(page, { hash: '#/clientes' })

  const cnpjs = await page.locator('tbody tr th .dado').allInnerTexts()
  expect(cnpjs.length).toBeGreaterThan(4)

  for (const bruto of cnpjs) {
    const n = bruto.replace(/\D/g, '')
    expect(n, `CNPJ com formato inesperado: ${bruto}`).toHaveLength(14)

    const dv = (nums, pesos) => {
      const soma = nums.reduce((acc, v, i) => acc + v * pesos[i], 0)
      const resto = soma % 11
      return resto < 2 ? 0 : 11 - resto
    }
    const d = n.split('').map(Number)
    const d1 = dv(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    const d2 = dv(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    expect(`${d1}${d2}`, `dígitos verificadores inválidos em ${bruto}`).toBe(`${d[12]}${d[13]}`)
  }
})

test('faturamento por franquia e excedente aparece na memória de cálculo', async ({ page }) => {
  await abrir(page, { hash: '#/faturamento' })
  await page.getByRole('button', { name: 'Ver cálculo' }).first().click()

  const memoria = page.getByRole('table', { name: /Composição do valor por equipamento/i })
  await expect(memoria).toBeVisible()
  await expect(memoria.getByRole('columnheader', { name: 'Franquia' })).toBeVisible()
  await expect(memoria.getByRole('columnheader', { name: 'Excedente' })).toBeVisible()
  await expect(memoria.getByRole('columnheader', { name: 'Consumo' })).toBeVisible()
})
