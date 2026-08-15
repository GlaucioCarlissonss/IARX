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
  { hash: '#/mapa', nome: 'mapa', titulo: 'Mapa de distribuição' },
  { hash: '#/comercial', nome: 'política comercial', titulo: 'Política comercial' },
  { hash: '#/notas-fiscais', nome: 'notas fiscais', titulo: 'Notas fiscais de compra' },
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

/* ==================================================================== */
/* Formulários                                                          */
/* ==================================================================== */

/**
 * Estes testes cobrem duas classes distintas de falha, e as duas custam caro.
 *
 * A primeira é de acessibilidade estrutural do modal: foco que não entra, Tab
 * que escapa para o conteúdo de trás, Esc que não fecha, foco que não volta à
 * origem. Nada disso quebra visualmente — só quem navega por teclado descobre.
 *
 * A segunda é de regra de domínio na fronteira de escrita: RN-001, RN-020,
 * saldo negativo, CNPJ inválido. O formulário precisa recusar apontando o
 * campo, não com um alerta genérico.
 */

async function abrirDialogo(page, { hash = '', nomeBotao }) {
  await abrir(page, { hash })
  await page.getByRole('button', { name: nomeBotao }).first().click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeVisible()
  return dialogo
}

test('modal: foco entra, Esc fecha e o foco volta à origem', async ({ page }) => {
  await abrir(page, { hash: '#/chamados' })
  const gatilho = page.getByRole('button', { name: 'Abrir chamado' })
  await gatilho.click()

  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeVisible()
  await expect(dialogo).toHaveAttribute('aria-modal', 'true')

  // Foco vai para o primeiro campo, não para um botão: em formulário o usuário
  // quer digitar.
  const focadoDentro = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    return d?.contains(document.activeElement) ?? false
  })
  expect(focadoDentro, 'o foco precisa entrar no diálogo ao abrir').toBe(true)

  await page.keyboard.press('Escape')
  await expect(dialogo).toBeHidden()

  // Devolver o foco à origem é o que impede o usuário de teclado de ser jogado
  // de volta ao início do documento.
  await expect(gatilho).toBeFocused()
})

test('modal: Tab circula dentro do diálogo', async ({ page }) => {
  const dialogo = await abrirDialogo(page, { hash: '#/chamados', nomeBotao: 'Abrir chamado' })

  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab')
    const dentro = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]')
      return d?.contains(document.activeElement) ?? false
    })
    expect(dentro, `Tab ${i + 1} escapou do diálogo`).toBe(true)
  }
  await expect(dialogo).toBeVisible()
})

test('axe nos diálogos de cada domínio', async ({ page }) => {
  const casos = [
    { hash: '#/chamados', nomeBotao: 'Abrir chamado' },
    { hash: '#/contratos', nomeBotao: 'Novo contrato' },
    { hash: '#/clientes', nomeBotao: 'Novo cliente' },
    { hash: '#/parque', nomeBotao: 'Cadastrar equipamento' },
  ]
  for (const caso of casos) {
    await abrirDialogo(page, caso)
    const v = await violacoes(page)
    expect(v, `${caso.nomeBotao}:\n  ${descrever(v)}`).toEqual([])
  }
})

test('envio inválido leva o foco ao resumo, que conta os erros', async ({ page }) => {
  await abrirDialogo(page, { hash: '#/clientes', nomeBotao: 'Novo cliente' })
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click()

  const resumo = page.getByRole('alert')
  await expect(resumo).toBeVisible()
  await expect(resumo).toContainText(/campos precisam de atenção/)
  await expect(resumo).toBeFocused()

  // Cada erro leva ao campo correspondente: sem isso o usuário rola caçando
  // qual input ficou vermelho.
  const link = resumo.getByRole('link').first()
  await expect(link).toHaveAttribute('href', /^#campo-/)
})

test('CNPJ com dígito verificador errado é recusado no campo', async ({ page }) => {
  await abrirDialogo(page, { hash: '#/clientes', nomeBotao: 'Novo cliente' })

  // 11.222.333/0001-80 tem o último dígito trocado (o correto é 81).
  await page.locator('#campo-cnpj').fill('11222333000180')
  await page.locator('#campo-razaoSocial').fill('EMPRESA TESTE LTDA')
  await page.getByRole('dialog').getByRole('button', { name: 'Cadastrar cliente' }).click()

  const campo = page.locator('#campo-cnpj')
  await expect(campo).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('alert')).toContainText(/dígitos verificadores/i)
})

test('RN-001: o seletor desabilita ativo já alocado e diz onde ele está', async ({ page }) => {
  // Um patrimônio comprovadamente locado, lido da própria tela de parque em vez
  // de fixado no teste: assim a massa pode mudar sem quebrar a verificação.
  await abrir(page, { hash: '#/parque?estado=LOCADO' })
  const patrimonio = (await page.getByRole('table').getByRole('rowheader').first().innerText())
    .split('\n')[0]
    .trim()
  expect(patrimonio).toMatch(/^\d+$/)

  await abrir(page, { hash: '#/contratos' })
  // Contratos encerrados têm o botão desabilitado; o teste precisa de um vivo.
  await page.locator('button:not([disabled])', { hasText: /^Alocar/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // Período que de fato colide com as alocações vigentes da massa.
  await page.locator('#campo-vigenciaInicio').fill('2026-07-01')
  await page.locator('#campo-vigenciaFim').fill('2026-09-30')

  const campo = page.locator('#campo-equipamentoId')
  await campo.click()
  await campo.fill(patrimonio)

  const lista = page.getByRole('listbox')
  await expect(lista).toBeVisible()

  // Ativo ocupado permanece visível, desabilitado e com o motivo — sumindo da
  // lista, quem procura o patrimônio conclui que digitou errado.
  const ocupado = lista.locator('li[data-desabilitada="true"]').first()
  await expect(ocupado).toBeVisible()
  await expect(ocupado).toHaveAttribute('aria-disabled', 'true')
  await expect(ocupado).toContainText(/contrato|Bloqueado/i)
})

test('RN-020: leitura menor que a anterior é recusada citando o valor', async ({ page }) => {
  await abrir(page, { hash: '#/parque' })
  await page.getByRole('button', { name: /^Leitura/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const mono = page.locator('#campo-mono')
  const anterior = Number(await mono.inputValue())
  expect(anterior, 'o campo precisa vir preenchido com a leitura anterior').toBeGreaterThan(0)

  await mono.fill(String(Math.max(0, anterior - 500)))
  await page.getByRole('dialog').getByRole('button', { name: 'Registrar leitura', exact: true }).click()

  await expect(page.getByRole('alert')).toContainText(/não retrocede|menor que a leitura anterior/i)
  await expect(mono).toHaveAttribute('aria-invalid', 'true')
})

test('abrir chamado cria o registro e a lista reflete sem recarregar', async ({ page }) => {
  await abrir(page, { hash: '#/chamados' })
  // A tabela pagina, então contar linhas visíveis não mede nada. A contagem
  // total fica na região viva acima da tabela — que é, aliás, o que o leitor
  // de tela anuncia quando o resultado muda.
  const contagem = page.getByRole('status').filter({ hasText: /registros?/ }).first()
  const totalAntes = Number((await contagem.innerText()).match(/^([\d.]+)/)?.[1]?.replace(/\./g, '') ?? '0')
  expect(totalAntes).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Abrir chamado' }).click()
  await page.locator('#campo-equipamentoId').click()
  await page.locator('li.combo__item:not([data-desabilitada])').first().click()
  await page.locator('#campo-sintoma').fill('Atolamento recorrente na bandeja 2, três vezes hoje')
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir chamado', exact: true }).click()

  await expect(page.getByRole('dialog')).toBeHidden()

  // A região viva anuncia o resultado e traz o número do chamado.
  const aviso = page.getByRole('region', { name: 'Avisos do sistema' })
  await expect(aviso).toContainText(/Chamado OS-\d+ aberto/)
  const numero = (await aviso.innerText()).match(/OS-\d+/)?.[0]
  expect(numero).toBeTruthy()

  // Recarga silenciosa: nenhuma região volta a "carregando" e o total cresce.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await expect(contagem).toContainText(String(totalAntes + 1))

  // E o registro é encontrável — prova de que foi persistido, não só contado.
  await page.getByLabel(/Chamado, patrimônio/).fill(numero)
  await expect(page.getByRole('table').getByText(numero, { exact: true })).toBeVisible()
})

test('saldo insuficiente é recusado no campo da quantidade', async ({ page }) => {
  await abrir(page, { hash: '#/estoque' })
  await page.getByRole('button', { name: /^Movimentar/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()

  await page.getByRole('radio', { name: /Saída/ }).check()
  await page.locator('#campo-quantidade').fill('99999')
  await page.locator('#campo-motivo').fill('Teste de saldo insuficiente')
  await page.getByRole('dialog').getByRole('button', { name: 'Registrar movimentação' }).click()

  await expect(page.getByRole('alert')).toContainText(/Saldo insuficiente/i)
})

test('botão de envio trava durante o processamento', async ({ page }) => {
  await abrirDialogo(page, { hash: '#/parque', nomeBotao: 'Cadastrar equipamento' })

  await page.locator('#campo-patrimonio').fill('99123')
  await page.locator('#campo-numeroSerie').fill('TESTE-0001')
  await page.locator('#campo-modeloId').click()
  await page.locator('li.combo__item').first().click()

  const enviar = page.getByRole('dialog').getByRole('button', { name: 'Cadastrar', exact: true })
  await enviar.click()
  // Sem a trava, um duplo clique cadastra dois ativos e o segundo só aparece
  // quando alguém estranha o patrimônio duplicado.
  await expect(page.getByRole('button', { name: 'Cadastrando…' })).toBeDisabled()
  await expect(page.getByRole('dialog')).toBeHidden()
})

/* ==================================================================== */
/* Anexos                                                               */
/* ==================================================================== */

/**
 * Aceitar qualquer tipo de arquivo é uma decisão de produto que só é
 * defensável se o download for sempre forçado — um `.html` anexado precisa
 * baixar, nunca abrir no contexto da aplicação. Estes testes verificam a
 * permissividade e a proteção que a torna segura.
 */

/** Anexa um arquivo pelo input real, sem depender de arrastar-e-soltar. */
async function escolherArquivos(page, arquivos) {
  await page.locator('#campo-arquivos').setInputFiles(arquivos)
}

/**
 * Abre o diálogo de anexos numa linha que já tenha documentos.
 *
 * A tabela é ordenada por receita, não pela ordem da massa, então a primeira
 * linha não é necessariamente uma das que receberam anexos de demonstração.
 * O distintivo de contagem no botão é o indicador confiável — e usá-lo também
 * verifica que ele reflete a realidade.
 */
async function abrirAnexosComDocumentos(page, hash) {
  await abrir(page, { hash })
  const comAnexos = page.locator('button', { has: page.locator('.distintivo') }).first()
  await expect(comAnexos).toBeVisible()
  await comAnexos.click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test('anexos: aceita qualquer tipo, inclusive extensão desconhecida', async ({ page }) => {
  await abrir(page, { hash: '#/contratos' })
  await page.getByRole('button', { name: /^Anexos/ }).first().click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeVisible()

  await escolherArquivos(page, [
    { name: 'aditivo-01.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 teste') },
    { name: 'planta-andar.dwg', buffer: Buffer.from('DWG binario') },
    { name: 'COMPROVANTE', buffer: Buffer.from('sem extensao') },
    { name: 'assinatura.p7s', mimeType: 'application/pkcs7-signature', buffer: Buffer.from('pkcs7') },
  ])

  // Nenhum é rejeitado por tipo — nem o CAD, nem o arquivo sem extensão, nem a
  // assinatura digital. E nenhum é marcado com problema.
  await expect(page.locator('.lista-arquivos .arquivo')).toHaveCount(4)
  await expect(page.locator('.arquivo[data-problema]')).toHaveCount(0)
  await expect(dialogo.getByText('planta-andar.dwg').first()).toBeVisible()
  await expect(dialogo.getByText('COMPROVANTE').first()).toBeVisible()

  await dialogo.getByRole('button', { name: /^Anexar 4 arquivos/ }).click()
  await expect(page.getByRole('region', { name: 'Avisos do sistema' })).toContainText(/4 arquivos anexados/)

  // O diálogo segue aberto — anexar documento é atividade em lote.
  await expect(dialogo).toBeVisible()
  await expect(dialogo.getByRole('table')).toContainText('planta-andar.dwg')
})

test('anexos: nome duplicado é recusado apontando o campo', async ({ page }) => {
  await abrirAnexosComDocumentos(page, '#/clientes')

  // A massa já traz documentos nos clientes com distintivo.
  const existente = await page.getByRole('dialog').getByRole('rowheader').first().innerText()
  await escolherArquivos(page, [
    { name: existente.split('\n')[0].trim(), mimeType: 'application/pdf', buffer: Buffer.from('outro') },
  ])

  // O aviso aparece antes mesmo do envio, na própria lista de selecionados.
  await expect(page.locator('.arquivo[data-problema]')).toBeVisible()
  await expect(page.getByText(/já anexado nesta ficha/)).toBeVisible()

  await page.getByRole('dialog').getByRole('button', { name: /^Anexar arquivo/ }).click()
  await expect(page.getByRole('alert')).toContainText(/Já existe um anexo/)
})

test('anexos: arquivo vazio é recusado', async ({ page }) => {
  await abrir(page, { hash: '#/contratos' })
  await page.getByRole('button', { name: /^Anexos/ }).first().click()
  await escolherArquivos(page, [{ name: 'exportacao-falhou.xlsx', mimeType: '', buffer: Buffer.from('') }])

  await page.getByRole('dialog').getByRole('button', { name: /^Anexar arquivo/ }).click()
  await expect(page.getByRole('alert')).toContainText(/está vazio/)
})

test('anexos: remoção exige motivo', async ({ page }) => {
  await abrirAnexosComDocumentos(page, '#/clientes')
  const dialogo = page.getByRole('dialog')

  const antes = await dialogo.getByRole('row').count()
  await dialogo.getByRole('button', { name: /^Remover/ }).first().click()

  const confirmacao = page.getByRole('alertdialog')
  await expect(confirmacao).toBeVisible()
  await confirmacao.getByRole('button', { name: 'Remover definitivamente' }).click()
  await expect(confirmacao).toContainText(/motivo/i)

  await page.locator('#campo-motivoRemocao').fill('Documento vencido, substituído por versão nova')
  await confirmacao.getByRole('button', { name: 'Remover definitivamente' }).click()

  await expect(page.getByRole('alertdialog')).toBeHidden()
  await expect(dialogo.getByRole('row')).toHaveCount(antes - 1)
})

test('anexos: download é forçado, nunca navegação para o arquivo', async ({ page }) => {
  await abrir(page, { hash: '#/contratos' })
  await page.getByRole('button', { name: /^Anexos/ }).first().click()

  // Um .html é o caso que importa: se abrisse no contexto da aplicação,
  // executaria script com acesso à sessão.
  await escolherArquivos(page, [
    { name: 'relatorio.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') },
  ])
  await page.getByRole('dialog').getByRole('button', { name: /^Anexar arquivo/ }).click()
  await expect(page.getByRole('region', { name: 'Avisos do sistema' })).toContainText(/anexado/)

  const linha = page.getByRole('row').filter({ hasText: 'relatorio.html' })
  const baixar = linha.getByRole('button', { name: /^Baixar/ })

  const paginasAntes = page.context().pages().length
  const download = page.waitForEvent('download')
  await baixar.click()
  const arquivo = await download

  expect(arquivo.suggestedFilename()).toBe('relatorio.html')
  // Nenhuma aba nova: o conteúdo não foi renderizado em lugar nenhum.
  expect(page.context().pages().length).toBe(paginasAntes)
})

test('anexos: documento da massa não finge ter conteúdo', async ({ page }) => {
  await abrirAnexosComDocumentos(page, '#/clientes')

  // Baixar um arquivo vazio é pior que a indisponibilidade declarada.
  const baixar = page.getByRole('dialog').getByRole('button', { name: /^Baixar/ }).first()
  await expect(baixar).toBeDisabled()
  await expect(baixar).toHaveAttribute('title', /demonstração/i)
})

test('anexos: o input de arquivo é alcançável e acionável por teclado', async ({ page }) => {
  await abrir(page, { hash: '#/contratos' })
  await page.getByRole('button', { name: /^Anexos/ }).first().click()

  // Arrastar-e-soltar não pode ser o único caminho. A área de soltar fica fora
  // da árvore de acessibilidade justamente por não ser operável por teclado.
  const entrada = page.locator('#campo-arquivos')
  await expect(entrada).toBeEnabled()
  await entrada.focus()
  await expect(entrada).toBeFocused()
  await expect(page.locator('.soltar')).toHaveAttribute('aria-hidden', 'true')
})

test('axe no diálogo de anexos, com arquivos selecionados', async ({ page }) => {
  await abrir(page, { hash: '#/contratos' })
  await page.getByRole('button', { name: /^Anexos/ }).first().click()
  await escolherArquivos(page, [
    { name: 'termo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') },
    { name: 'foto-instalacao.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('JPG') },
  ])
  const v = await violacoes(page)
  expect(v, `diálogo de anexos:\n  ${descrever(v)}`).toEqual([])
})

/* ==================================================================== */
/* Nota fiscal de compra — o ativo nasce da nota                        */
/* ==================================================================== */

/**
 * O que estes testes protegem: a procedência do valor de aquisição.
 *
 * Antes deste módulo, `valorAquisicao` era digitado no cadastro do
 * equipamento. Duas unidades da mesma compra podiam ficar com valores
 * diferentes sem que nada detectasse — e a depreciação e a margem por ativo
 * são calculadas em cima desse número. As regras abaixo são o que impede que
 * ele volte a ser opinião.
 */

/** Abre a primeira nota que satisfaz o recorte escolhido. */
async function abrirNota(page, recorte) {
  await abrir(page, { hash: '#/notas-fiscais' })
  await page.getByLabel('Recorte').selectOption(recorte)
  const linha = page.getByRole('row').filter({ has: page.getByRole('button', { name: /^Abrir nota/ }) }).first()
  await expect(linha).toBeVisible()
  await linha.getByRole('button', { name: /^Abrir nota/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  return page.getByRole('dialog')
}

const XML_BASE = ({
  chave,
  cnpj,
  numero = '12345',
  serie = '1',
  emissao = '2026-07-10',
  itens = [{ n: 1, desc: 'MULTIFUNC LASER MONO A4 40PPM', ncm: '84433221', cfop: '5551', q: 3, vu: '6000.00', vt: '18000.00' }],
  vProd = '18000.00',
  vFrete = '250.00',
  vNF = '18250.00',
}) => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe${chave}" versao="4.00">
    <ide><cUF>35</cUF><mod>55</mod><serie>${serie}</serie><nNF>${numero}</nNF><dhEmi>${emissao}T09:12:00-03:00</dhEmi></ide>
    <emit><CNPJ>${cnpj}</CNPJ><xNome>Distribuidora Teste LTDA</xNome><enderEmit><UF>SP</UF></enderEmit><IE>111222333</IE></emit>
    <dest><CNPJ>11222333000181</CNPJ></dest>
    ${itens
      .map(
        (i) => `<det nItem="${i.n}"><prod><cProd>P${i.n}</cProd><xProd>${i.desc}</xProd><NCM>${i.ncm}</NCM><CFOP>${i.cfop}</CFOP><uCom>UN</uCom><qCom>${i.q}.0000</qCom><vUnCom>${i.vu}</vUnCom><vProd>${i.vt}</vProd></prod></det>`,
      )
      .join('')}
    <total><ICMSTot><vProd>${vProd}</vProd><vST>0.00</vST><vFrete>${vFrete}</vFrete><vSeg>0.00</vSeg>
      <vOutro>0.00</vOutro><vDesc>0.00</vDesc><vIPI>0.00</vIPI><vICMS>3285.00</vICMS><vNF>${vNF}</vNF></ICMSTot></total>
  </infNFe></NFe>
</nfeProc>`

/** Módulo 11 com pesos 2–9 cíclicos — a mesma regra do banco e do front. */
function dvChave(base43) {
  let soma = 0
  let peso = 2
  for (let i = 42; i >= 0; i--) {
    soma += Number(base43[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

function montarChave(cnpj, { serie = '1', numero = '12345', aamm = '2607' } = {}) {
  const base = '35' + aamm + cnpj.padStart(14, '0') + '55' + serie.padStart(3, '0') + numero.padStart(9, '0') + '1' + '00000042'
  return base + String(dvChave(base))
}

test('a chave de acesso é conferida pelo dígito verificador antes do envio', async ({ page }) => {
  await abrir(page, { hash: '#/notas-fiscais' })
  await page.getByRole('button', { name: 'Registrar entrada' }).click()
  const dialogo = page.getByRole('dialog')

  // 44 dígitos, estrutura plausível, DV errado. É exatamente o resultado de
  // digitar um dígito trocado — e o que a conciliação fiscal só descobriria
  // meses depois.
  const valida = montarChave('11444777000161')
  const quebrada = valida.slice(0, 43) + String((Number(valida[43]) + 1) % 10)

  await dialogo.getByLabel('Chave de acesso').fill(quebrada)
  await dialogo.getByLabel('Número').click()
  await expect(dialogo.getByText(/não passa na verificação do dígito/i)).toBeVisible()

  await dialogo.getByLabel('Chave de acesso').fill(valida)
  await expect(dialogo.getByText(/não passa na verificação do dígito/i)).toHaveCount(0)
  // Com a chave íntegra, a dica passa a mostrar o que ela carrega.
  await expect(dialogo.getByText(/Emitente 11\.444\.777\/0001-61/)).toBeVisible()
})

test('XML da NF-e é fonte: preenche o cabeçalho e trava a digitação', async ({ page }) => {
  await abrir(page, { hash: '#/notas-fiscais' })

  // O CNPJ do fornecedor da massa é gerado; lê-lo da tela é o que torna o
  // teste independente da semente.
  const dialogoLista = await abrirNota(page, 'INTEGRADA')
  const cnpjTexto = await dialogoLista.getByText(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/).first().innerText()
  const cnpj = cnpjTexto.replace(/\D/g, '')
  await dialogoLista.getByRole('button', { name: 'Fechar', exact: true }).click()

  await page.getByRole('button', { name: 'Registrar entrada' }).click()
  const dialogo = page.getByRole('dialog')

  const chave = montarChave(cnpj, { numero: '90311' })
  await dialogo.locator('#campo-xml').setInputFiles({
    name: 'NFe.xml',
    mimeType: 'text/xml',
    buffer: Buffer.from(XML_BASE({ chave, cnpj, numero: '90311' })),
  })

  await expect(dialogo.getByText(/XML lido/)).toBeVisible()
  await expect(dialogo.getByLabel('Número')).toHaveValue('90311')

  // Somente leitura: digitar o que já está no documento é a origem mais comum
  // de divergência fiscal.
  await expect(dialogo.getByLabel('Número')).toHaveAttribute('readonly', '')
  await expect(dialogo.getByLabel('Chave de acesso')).toHaveAttribute('readonly', '')

  // A descrição fiscal veio do arquivo, mas o vínculo com o catálogo continua
  // humano — "MULTIFUNC LASER MONO A4 40PPM" não casa com nome comercial.
  await expect(dialogo.getByText('MULTIFUNC LASER MONO A4 40PPM')).toBeVisible()
  await expect(dialogo.getByLabel('Modelo do catálogo')).toHaveValue('')
})

test('XML que não é NF-e é recusado dizendo o que fazer', async ({ page }) => {
  await abrir(page, { hash: '#/notas-fiscais' })
  await page.getByRole('button', { name: 'Registrar entrada' }).click()
  const dialogo = page.getByRole('dialog')

  // O caso real: o operador renomeia o DANFE em PDF para .xml.
  await dialogo.locator('#campo-xml').setInputFiles({
    name: 'nota.xml',
    mimeType: 'text/xml',
    buffer: Buffer.from('%PDF-1.7 conteudo binario'),
  })

  const alerta = dialogo.getByRole('alert')
  await expect(alerta).toContainText(/não é um XML válido/i)
  await expect(alerta).toContainText(/DANFE em PDF renomeado/i)
})

test('RN-L02: a nota não é conferida com unidades por identificar', async ({ page }) => {
  await abrir(page, { hash: '#/notas-fiscais' })
  await page.getByLabel('Recorte').selectOption('PENDENTE_CONFERENCIA')

  const incompleta = page
    .getByRole('row')
    .filter({ hasText: /item\(ns\) sem todas as unidades/ })
    .first()
  await expect(incompleta).toBeVisible()

  const conferir = incompleta.getByRole('button', { name: /^Conferir/ })
  await expect(conferir).toBeDisabled()
  await expect(conferir).toHaveAttribute('title', /série e patrimônio/i)

  // A contagem parcial é mostrada, não escondida: quem confere precisa saber
  // quantas caixas faltam antes de ir ao almoxarifado.
  await expect(incompleta).toContainText(/\d+\/\d+/)
})

test('RN-L04: série já usada no parque é recusada apontando o ativo', async ({ page }) => {
  // A série de um ativo existente, lida da própria tela do parque.
  await abrir(page, { hash: '#/parque' })
  const serieExistente = await page
    .getByRole('table')
    .last()
    .locator('tbody tr')
    .first()
    .innerText()
    .then((t) => t.match(/[A-Z]{2,4}-\d{6}/)?.[0])
  expect(serieExistente).toBeTruthy()

  const dialogo = await abrirNota(page, 'PENDENTE_CONFERENCIA')
  await dialogo.getByRole('button', { name: /séries do item/ }).first().click()

  const series = page.getByRole('dialog')
  await expect(series).toContainText('Identificar unidades')
  await series.getByLabel('Série da unidade 1', { exact: true }).fill(serieExistente)
  await series.getByRole('button', { name: /^Salvar \d+ unidade/ }).click()

  // Não basta recusar: a mensagem diz de qual ativo é a etiqueta, que é o que
  // permite descobrir se a caixa errada foi bipada.
  await expect(series.getByRole('alert')).toContainText(/já pertence ao equipamento/i)
})

test('série repetida no mesmo item é acusada antes do envio', async ({ page }) => {
  const dialogo = await abrirNota(page, 'PENDENTE_CONFERENCIA')
  await dialogo.getByRole('button', { name: /séries do item/ }).first().click()
  const series = page.getByRole('dialog')

  await series.getByLabel('Série da unidade 1', { exact: true }).fill('DUPLICADA-001')
  await series.getByLabel('Série da unidade 2', { exact: true }).fill('DUPLICADA-001')
  await series.getByLabel('Série da unidade 2', { exact: true }).blur()

  // Ler a mesma etiqueta duas vezes significa uma caixa não conferida.
  await expect(series.getByText(/Repetida da unidade 1/)).toBeVisible()
})

test('RN-L05: a prévia de integração fecha exatamente com o custo da nota', async ({ page }) => {
  await abrir(page, { hash: '#/notas-fiscais' })
  await page.getByLabel('Recorte').selectOption('CONFERIDA')

  const linha = page.getByRole('row').filter({ hasText: 'Conferida' }).first()
  const custo = (await linha.innerText()).match(/R\$[\s\u00A0]*[\d.]+,\d{2}/)[0]

  await linha.getByRole('button', { name: /^Integrar/ }).click()
  const previa = page.getByRole('dialog')
  await expect(previa).toContainText('Integrar ao patrimônio')

  // A soma do rateio é exibida ao lado do custo, e o selo diz que fecha. É o
  // que torna a garantia verificável por quem confirma, não só por quem
  // programou — o resíduo de arredondamento vai inteiro para a primeira
  // unidade justamente para isto ser verdade.
  const soma = await previa.getByRole('row').filter({ hasText: 'Soma do rateio' }).innerText()
  expect(soma).toContain(custo)
  await expect(previa.getByText('Fecha com a nota')).toBeVisible()
})

test('RN-L03/RN-L07: integrar cria os ativos disponíveis e sela a nota', async ({ page }) => {
  await abrir(page, { hash: '#/notas-fiscais' })
  await page.getByLabel('Recorte').selectOption('CONFERIDA')

  const linha = page.getByRole('row').filter({ hasText: 'Conferida' }).first()
  const numero = (await linha.innerText()).match(/\d+\/\d+/)[0]

  await linha.getByRole('button', { name: /^Integrar/ }).click()
  const previa = page.getByRole('dialog')

  const patrimonios = await previa.locator('tbody tr th').allInnerTexts()
  expect(patrimonios.length).toBeGreaterThan(0)

  await previa.getByRole('button', { name: /^Criar \d+ ativo/ }).click()
  await expect(page.getByRole('region', { name: 'Avisos do sistema' })).toContainText(/ativo\(s\) criados no patrimônio/)

  // Navega para o parque, e os ativos estão lá — disponíveis, nunca alocados.
  await expect(page.getByRole('heading', { level: 1, name: 'Parque instalado' })).toBeVisible()
  await page.getByLabel(/Patrimônio, série/i).fill(patrimonios[0])
  const novo = page.getByRole('row').filter({ hasText: patrimonios[0] }).first()
  await expect(novo).toBeVisible()
  await expect(novo).toContainText('Disponível')

  // RN-L01: a nota está selada — nem editar séries, nem cancelar.
  await abrir(page, { hash: '#/notas-fiscais' })
  await page.getByLabel('Número, chave ou fornecedor').fill(numero.split('/')[1])
  await page.getByRole('button', { name: /^Abrir nota/ }).first().click()
  const detalhe = page.getByRole('dialog')
  await expect(detalhe.getByText(/A nota está selada/)).toBeVisible()
  await expect(detalhe.getByRole('button', { name: /séries do item/ })).toHaveCount(0)
  await expect(detalhe.getByRole('button', { name: 'Cancelar nota' })).toHaveCount(0)
})

test('RN-027: quem lança a nota não pode conferi-la', async ({ page }) => {
  await abrir(page, { hash: '#/notas-fiscais' })
  await page.getByRole('button', { name: 'Registrar entrada' }).click()
  const form = page.getByRole('dialog')

  // Lançamento manual completo — o caminho sem XML.
  await form.getByLabel('Fornecedor emitente').click()
  await form.getByRole('listbox', { name: 'Fornecedor emitente' }).getByRole('option').first().click()
  await form.getByLabel('Número').fill('77001')
  await form.getByLabel('Produtos (R$)').fill('9000')
  await form.getByLabel('Total da nota (R$)').fill('9000')

  await form.getByRole('button', { name: 'Acrescentar item' }).click()
  await form.getByLabel('Modelo do catálogo').click()
  await form.getByRole('listbox', { name: 'Modelo do catálogo' }).getByRole('option').first().click()
  await form.getByLabel('Descrição do item 1').fill('IMPRESSORA LASER MONO')
  await form.getByLabel('Quantidade').fill('3')
  await form.getByLabel('Valor unitário (R$)').fill('3000')

  await form.getByRole('button', { name: 'Lançar nota' }).click()
  await expect(page.getByRole('region', { name: 'Avisos do sistema' })).toContainText(/lançada/)

  // Identifica as unidades, para que a recusa seguinte seja pela segregação de
  // funções e não pela conferência incompleta.
  await page.getByLabel('Número, chave ou fornecedor').fill('77001')
  await page.getByRole('button', { name: /^Abrir nota/ }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: /séries do item/ }).click()
  const series = page.getByRole('dialog')
  for (let i = 1; i <= 3; i++) {
    await series.getByLabel(`Série da unidade ${i}`, { exact: true }).fill(`SEG-00${i}`)
  }
  await series.getByRole('button', { name: /^Salvar 3 unidade/ }).click()
  await expect(page.getByRole('region', { name: 'Avisos do sistema' })).toContainText(/3 unidade\(s\) identificada\(s\)/)
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click()

  // Agora a conferência é possível pelo estado — e recusada pela regra.
  await page.getByRole('row').filter({ hasText: '77001' }).getByRole('button', { name: /^Conferir/ }).click()
  const avisos = page.getByRole('region', { name: 'Avisos do sistema' })
  await expect(avisos).toContainText(/Conferência recusada/)
  await expect(avisos).toContainText(/é de outra pessoa/)
})

test('a segregação também está no perfil: operação lança, suporte confere', async ({ page }) => {
  await abrir(page, { hash: '#/notas-fiscais' })

  await page.getByLabel('Perfil de acesso').selectOption('operacao')
  await expect(page.getByRole('button', { name: 'Registrar entrada' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Conferir/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Integrar/ })).toHaveCount(0)

  await page.getByLabel('Perfil de acesso').selectOption('suporte')
  await expect(page.getByRole('button', { name: 'Registrar entrada' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Conferir/ }).first()).toBeVisible()

  // Patrimônio é lançamento contábil: integrar é do financeiro.
  await page.getByLabel('Perfil de acesso').selectOption('financeiro')
  await expect(page.getByRole('button', { name: /^Integrar/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^Conferir/ })).toHaveCount(0)
})

test('retenção fiscal: o XML da NF-e não pode ser removido dentro de 5 anos', async ({ page }) => {
  const detalhe = await abrirNota(page, 'INTEGRADA')
  await detalhe.getByRole('button', { name: 'Anexos' }).click()

  const anexos = page.getByRole('dialog')
  const linhaXml = anexos.getByRole('row').filter({ hasText: 'XML da NF-e' }).first()
  await expect(linhaXml).toBeVisible()

  await linhaXml.getByRole('button', { name: /^Remover/ }).click()
  await anexos.getByLabel('Motivo da remoção').fill('arquivo enviado por engano')
  await anexos.getByRole('button', { name: 'Remover definitivamente' }).click()

  // O XML é o documento original — o DANFE é só representação dele. Perdê-lo é
  // perder o documento, e a recusa precisa dizer quando a remoção passa a ser
  // possível, em vez de apenas negar.
  await expect(anexos.getByText(/retenção obrigatória de 5 anos/i)).toBeVisible()
  await expect(anexos.getByText(/Removível a partir de \d{2}\/\d{2}\/\d{4}/)).toBeVisible()
})

test('a procedência ausente do parque antigo é declarada, não escondida', async ({ page }) => {
  await abrir(page, { hash: '#/notas-fiscais' })

  // Fingir que todo ativo tem nota seria a mentira que este módulo elimina.
  await expect(page.getByText('Sem nota vinculada')).toBeVisible()
  await expect(page.getByText(/valor de aquisição sem origem verificável/)).toBeVisible()
})

test('axe nos diálogos da nota fiscal', async ({ page }) => {
  await abrir(page, { hash: '#/notas-fiscais' })
  await page.getByRole('button', { name: 'Registrar entrada' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  let v = await violacoes(page)
  expect(v, `diálogo de lançamento:\n  ${descrever(v)}`).toEqual([])

  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()
  const detalhe = await abrirNota(page, 'CONFERIDA')
  v = await violacoes(page)
  expect(v, `detalhe da nota:\n  ${descrever(v)}`).toEqual([])

  await detalhe.getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.getByRole('row').filter({ hasText: 'Conferida' }).first().getByRole('button', { name: /^Integrar/ }).click()
  await expect(page.getByRole('dialog')).toContainText('Integrar ao patrimônio')
  v = await violacoes(page)
  expect(v, `prévia de integração:\n  ${descrever(v)}`).toEqual([])
})

test('diálogo só de leitura que rola é alcançável pelo teclado', async ({ page }) => {
  await abrir(page, { hash: '#/notas-fiscais', altura: 620 })
  await page.getByLabel('Recorte').selectOption('CONFERIDA')
  await page.getByRole('row').filter({ hasText: 'Conferida' }).first().getByRole('button', { name: /^Integrar/ }).click()

  const corpo = page.locator('.dialogo__corpo')
  await expect(corpo).toBeVisible()

  // A prévia de integração é uma tabela sem nada clicável dentro. Sem o
  // tabindex, o conteúdo abaixo da dobra não teria como ser rolado por quem
  // não usa mouse — e as linhas invisíveis são justamente os ativos que serão
  // criados (WCAG 2.1.1).
  const rola = await corpo.evaluate((el) => el.scrollHeight > el.clientHeight + 1)
  expect(rola, 'o diálogo precisa transbordar para o teste fazer sentido').toBe(true)

  await expect(corpo).toHaveAttribute('tabindex', '0')
  await expect(corpo).toHaveAttribute('role', 'region')
  await corpo.focus()
  await expect(corpo).toBeFocused()

  // Já o diálogo de formulário não ganha parada extra: o Tab passa pelos campos.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Registrar entrada' }).click()
  await expect(page.locator('.dialogo__corpo')).not.toHaveAttribute('tabindex', '0')
})

/* ==================================================================== */
/* Mapa de distribuição                                                 */
/* ==================================================================== */

/**
 * O requisito que estes testes protegem: o mapa é um mapa, aqui dentro.
 *
 * Um quadro que abre o Google Maps em outra aba resolve o problema errado.
 * A aba que abre não conhece os filtros, não sabe quais clientes estão com
 * crédito bloqueado e não volta — e a pessoa que precisava decidir de onde
 * despachar um técnico perdeu o contexto no caminho.
 */

test('o mapa é desenhado na própria tela, não é um link para fora', async ({ page }) => {
  await abrir(page, { hash: '#/mapa' })

  // Geometria de verdade: um caminho SVG por unidade da federação.
  const contornos = page.locator('.mapa__uf')
  await expect(contornos.first()).toBeVisible()
  expect(await contornos.count()).toBe(27)

  // O caminho é um polígono fechado com muitos vértices — não um retângulo
  // decorativo nem um ícone de "abrir mapa".
  const d = await contornos.first().getAttribute('d')
  expect(d.startsWith('M')).toBe(true)
  expect(d.trim().endsWith('Z')).toBe(true)
  expect(d.split('L').length).toBeGreaterThan(10)

  // Nada de iframe, nada de link para provedor externo, nada de imagem remota:
  // o arquivo é único e abre por duplo clique — uma dependência de rede aqui
  // apareceria como um retângulo cinza.
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.locator('a[href*="google"], a[href*="openstreetmap"], a[href*="maps"]')).toHaveCount(0)
  await expect(page.locator('img[src^="http"], image[href^="http"]')).toHaveCount(0)
})

test('marcadores são botões reais, com nome que diz o que agrupam', async ({ page }) => {
  await abrir(page, { hash: '#/mapa' })

  const marcadores = page.locator('.mapa__marcador')
  await expect(marcadores.first()).toBeVisible()

  // Cada marcador é <button>: alcançável por Tab, acionável por Enter, com
  // nome acessível. Um <circle> no SVG não é nada disso.
  const nomes = await marcadores.evaluateAll((els) =>
    els.map((e) => ({ tag: e.tagName, rotulo: e.getAttribute('aria-label') })),
  )
  expect(nomes.every((n) => n.tag === 'BUTTON')).toBe(true)
  expect(nomes.some((n) => /agrupamento de \d+ locais/i.test(n.rotulo))).toBe(true)
  expect(nomes.some((n) => /ativo\(s\)/i.test(n.rotulo))).toBe(true)

  await marcadores.first().focus()
  await expect(marcadores.first()).toBeFocused()
})

test('o agrupamento se abre ao aproximar — o critério é o que o olho vê', async ({ page }) => {
  await abrir(page, { hash: '#/mapa' })

  const maiorGrupo = async () => {
    const contagens = await page
      .locator('.mapa__marcador[data-grupo]')
      .evaluateAll((els) => els.map((e) => Number(e.textContent)))
    return contagens.length === 0 ? 0 : Math.max(...contagens)
  }

  const antes = await maiorGrupo()
  expect(antes).toBeGreaterThan(1)

  // Clicar num agrupamento aproxima, e o que estava junto se separa. A prova
  // é o maior grupo encolher — a contagem total de marcadores visíveis cai
  // junto, porque aproximar também tira pontos da moldura.
  await page.locator('.mapa__marcador[data-grupo]').first().click()
  await page.waitForTimeout(250)
  await page.locator('.mapa__marcador[data-grupo]').first().click()
  await page.waitForTimeout(250)

  expect(await maiorGrupo()).toBeLessThan(antes)
})

test('o mapa é operável só pelo teclado', async ({ page }) => {
  await abrir(page, { hash: '#/mapa' })

  const tela = page.locator('.mapa__tela')
  await tela.focus()
  await expect(tela).toBeFocused()
  await expect(tela).toHaveAttribute('aria-label', /setas.*Home/is)

  // A escala muda ao aproximar: é o indicador de que a tecla fez efeito, e é
  // um dado do mapa, não um detalhe de implementação.
  const escalaInicial = await page.locator('.mapa__escala').innerText()
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await page.waitForTimeout(150)
  expect(await page.locator('.mapa__escala').innerText()).not.toBe(escalaInicial)

  // Home reenquadra o Brasil — sem isso, quem se perde navegando fica perdido.
  await page.keyboard.press('Home')
  await page.waitForTimeout(150)
  expect(await page.locator('.mapa__escala').innerText()).toBe(escalaInicial)
})

test('a barra de escala acompanha o zoom', async ({ page }) => {
  await abrir(page, { hash: '#/mapa' })

  // Mapa sem escala não permite julgar distância, e distância é o que decide
  // roteiro de técnico.
  const escala = page.locator('.mapa__escala')
  await expect(escala).toContainText(/^\d[\d.]*\s(km|m)$/m)

  await page.getByRole('button', { name: 'Aproximar o mapa' }).click()
  await page.getByRole('button', { name: 'Aproximar o mapa' }).click()
  await page.waitForTimeout(150)
  await expect(escala).toContainText(/(km|m)/)
})

test('crédito bloqueado é visível no mapa, não escondido no agrupamento', async ({ page }) => {
  await abrir(page, { hash: '#/mapa' })

  // A massa tem um cliente bloqueado e dois em observação. O tom do grupo é o
  // do pior membro: um bloqueado escondido dentro de um marcador verde é
  // exatamente o que não pode acontecer.
  await expect(page.locator('.mapa__marcador[data-tom="critico"]').first()).toBeVisible()

  // E não depende só de cor: o recorte lista os mesmos clientes por escrito.
  await page.getByLabel('Recorte').selectOption('inadimplente')
  await page.waitForTimeout(200)
  const lista = page.locator('.mapa-lista button')
  expect(await lista.count()).toBeGreaterThan(0)
  await expect(lista.first()).toContainText(/ativo\(s\)/)
})

test('filtrar reduz marcadores e lista juntos', async ({ page }) => {
  await abrir(page, { hash: '#/mapa' })

  const antes = await page.locator('.mapa-lista button').count()
  expect(antes).toBeGreaterThan(3)

  await page.getByLabel('Buscar cliente, cidade ou UF').fill('São Paulo')
  await page.waitForTimeout(250)

  const depois = await page.locator('.mapa-lista button').count()
  expect(depois).toBeGreaterThan(0)
  expect(depois).toBeLessThan(antes)

  // O mapa e a lista contam a mesma coisa — se divergissem, uma das duas
  // estaria mentindo, e não haveria como saber qual.
  await expect(page.locator('.mapa__contagem')).toContainText(String(depois))
})

test('o mapa de calor troca marcadores por densidade', async ({ page }) => {
  await abrir(page, { hash: '#/mapa' })
  await expect(page.locator('.mapa__marcador').first()).toBeVisible()

  const calor = page.getByRole('button', { name: 'Mapa de calor' })
  await calor.click()
  await expect(calor).toHaveAttribute('aria-pressed', 'true')

  await expect(page.locator('.mapa__marcador')).toHaveCount(0)
  expect(await page.locator('circle[fill="url(#mapa-calor)"]').count()).toBeGreaterThan(0)
})

test('nada do mapa existe só na forma visual: a aba de análises repete em tabela', async ({ page }) => {
  await abrir(page, { hash: '#/mapa' })

  const metricas = await page.locator('.grade--metricas').first().innerText()
  const totalCartao = Number(metricas.match(/Ativos mapeados\s+([\d.]+)/)[1].replace(/\D/g, ''))

  await page.getByRole('tab', { name: /Análises/ }).click()
  const tabela = page.getByRole('table', { name: /Clientes, ativos e receita por praça/i })
  await expect(tabela).toBeVisible()

  // A soma da coluna reproduz o KPI. É a asserção que impede a tabela de ser
  // um enfeite desatualizado ao lado do mapa.
  const somaLinhas = await tabela.locator('tbody tr').evaluateAll((linhas) =>
    linhas.reduce((s, l) => s + Number(l.children[2].textContent.replace(/\D/g, '')), 0),
  )
  expect(somaLinhas).toBe(totalCartao)
})

test('o painel do dia traz o mapa embutido, com atalho para a tela cheia', async ({ page }) => {
  await abrir(page)

  const cartao = page.getByRole('region', { name: 'Distribuição geográfica' })
  await expect(cartao).toBeVisible()
  // Mapa de verdade dentro do cartão, não uma miniatura que abre outra aba.
  await expect(cartao.locator('.mapa__uf').first()).toBeVisible()
  await expect(cartao.locator('.mapa__marcador').first()).toBeVisible()

  await cartao.getByRole('button', { name: 'Expandir' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Mapa de distribuição' })).toBeVisible()
})

test('exportar entrega o CSV das coordenadas', async ({ page }) => {
  await abrir(page, { hash: '#/mapa' })

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar CSV' }).click()
  const arquivo = await download

  expect(arquivo.suggestedFilename()).toBe('distribuicao-geografica.csv')
})

test('axe no mapa com marcadores, calor e análises', async ({ page }) => {
  await abrir(page, { hash: '#/mapa' })
  let v = await violacoes(page)
  expect(v, `mapa com marcadores:\n  ${descrever(v)}`).toEqual([])

  await page.getByRole('button', { name: 'Mapa de calor' }).click()
  v = await violacoes(page)
  expect(v, `mapa de calor:\n  ${descrever(v)}`).toEqual([])

  await page.getByRole('tab', { name: /Análises/ }).click()
  v = await violacoes(page)
  expect(v, `aba de análises:\n  ${descrever(v)}`).toEqual([])
})

/* -------------------------------------------------------------------- */
/* Camada raster                                                        */
/* -------------------------------------------------------------------- */

/**
 * O que estes testes resolvem: provar que os tiles funcionam **sem rede**.
 *
 * Os servidores de tile são de terceiros e não respondem em integração
 * contínua — este ambiente bloqueia todos eles. Testar contra a internet real
 * seria trocar um teste por uma aposta: passaria ou falharia por motivos que
 * nada têm a ver com o código.
 *
 * A saída é interceptar no navegador. `page.route` responde à requisição do
 * tile com um PNG local, e tudo o que é nosso — o nível escolhido, a ordem dos
 * eixos na URL, o posicionamento, a atribuição, a queda para o vetor — passa a
 * ser verificável de forma determinística. O que fica de fora é apenas se o
 * servidor público está no ar, que nenhum teste deveria afirmar.
 */

/** PNG 1×1 transparente — o conteúdo não importa, só que o `onload` dispare. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const HOSTS_TILE = ['**server.arcgisonline.com/**', '**basemaps.cartocdn.com/**', '**tile.openstreetmap.org/**']

/** Serve todo tile localmente. Precisa vir antes do `goto`. */
async function servirTiles(page, coletor) {
  for (const padrao of HOSTS_TILE) {
    await page.route(padrao, (rota) => {
      coletor?.push(rota.request().url())
      return rota.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
    })
  }
}

/** Recusa todo tile. Torna a queda determinística mesmo onde houver rede. */
async function recusarTiles(page) {
  for (const padrao of HOSTS_TILE) await page.route(padrao, (rota) => rota.abort())
}

test('com o servidor de imagens no ar, o mapa pinta tiles de verdade', async ({ page }) => {
  const pedidos = []
  await servirTiles(page, pedidos)
  await abrir(page, { hash: '#/mapa' })

  const tiles = page.locator('.mapa__camada img')
  await expect(tiles.first()).toBeVisible()
  expect(await tiles.count()).toBeGreaterThan(1)

  // A camada cobre a moldura: os tiles são posicionados, não empilhados no
  // canto. Dois deles têm de estar em colunas diferentes da tela.
  const esquerdas = await tiles.evaluateAll((n) => n.map((i) => i.getBoundingClientRect().left))
  expect(new Set(esquerdas.map(Math.round)).size).toBeGreaterThan(1)

  // Com imagem, o contorno de estado deixa de ser o mapa e vira divisa — mas
  // continua desenhado, que é o que o satélite não mostra.
  await expect(page.locator('.mapa__uf[data-sobre-imagem]').first()).toBeAttached()
  await expect(page.locator('.mapa__marcador').first()).toBeVisible()
})

test('o padrão é satélite, e a URL do Esri leva os eixos na ordem dele', async ({ page }) => {
  const pedidos = []
  await servirTiles(page, pedidos)
  await abrir(page, { hash: '#/mapa' })
  await expect(page.locator('.mapa__camada img').first()).toBeVisible()

  expect(pedidos.length).toBeGreaterThan(0)
  expect(pedidos.every((u) => u.includes('server.arcgisonline.com'))).toBe(true)

  for (const url of pedidos) {
    expect(url).toMatch(/\/MapServer\/tile\/\d+\/\d+\/\d+$/)
  }

  // `/tile/{z}/{y}/{x}` — trocar os dois últimos carregaria imagem de outro
  // lugar do planeta sem nenhum erro, que é o defeito mais caro desta camada.
  //
  // A asserção se ancora no tile de sondagem, cuja coordenada é constante
  // (z 4, x 5, y 8 — sobre o Centro-Oeste). Conferir só o formato `\d+/\d+`
  // não serviria: casa igual com os eixos trocados.
  expect(pedidos.some((u) => u.endsWith('/MapServer/tile/4/8/5'))).toBe(true)
  expect(pedidos.some((u) => u.endsWith('/MapServer/tile/4/5/8'))).toBe(false)
})

test('a licença dos tiles é creditada na tela', async ({ page }) => {
  await servirTiles(page)
  await abrir(page, { hash: '#/mapa' })
  await expect(page.locator('.mapa__camada img').first()).toBeVisible()

  // ODbL e os termos da Esri exigem crédito visível. Sem esta asserção, a
  // atribuição sumiria numa refatoração de layout sem ninguém perceber.
  await expect(page.locator('.mapa__credito')).toContainText(/Esri/)
})

test('sem acesso ao servidor de imagens, o mapa cai no vetor e avisa', async ({ page }) => {
  await recusarTiles(page)
  await abrir(page, { hash: '#/mapa' })

  // É o caminho que o artefato publicado percorre sempre: a política de
  // conteúdo bloqueia host externo. O resultado não pode ser retângulo cinza.
  await expect(page.getByRole('status').filter({ hasText: /vetorial embutido/ })).toBeVisible({
    timeout: 15000,
  })
  await expect(page.locator('.mapa__camada')).toHaveCount(0)
  await expect(page.locator('.mapa__uf').first()).toBeVisible()
  await expect(page.locator('.mapa__marcador').first()).toBeVisible()
})

test('a camada escolhida é lembrada e o seletor funciona só pelo teclado', async ({ page }) => {
  const pedidos = []
  await servirTiles(page, pedidos)
  await abrir(page, { hash: '#/mapa' })
  await expect(page.locator('.mapa__camada img').first()).toBeVisible()

  const seletor = page.locator('.mapa__camadas select').first()
  await seletor.focus()
  await seletor.selectOption('osm')

  await expect
    .poll(() => pedidos.some((u) => u.includes('tile.openstreetmap.org')))
    .toBe(true)

  // Recarregar mantém a escolha: preferência de camada é do usuário, não da
  // sessão.
  await page.reload()
  await expect(page.locator('.mapa__camadas select').first()).toHaveValue('osm')
})

test('axe no mapa com a camada de satélite carregada', async ({ page }) => {
  await servirTiles(page)
  await abrir(page, { hash: '#/mapa' })
  await expect(page.locator('.mapa__camada img').first()).toBeVisible()

  const v = await violacoes(page)
  expect(v, `mapa sobre imagem:\n  ${descrever(v)}`).toEqual([])
})

/* -------------------------------------------------------------------- */
/* Busca de endereço                                                    */
/* -------------------------------------------------------------------- */

/**
 * O que estes testes protegem: a busca local não pode regredir para depender
 * de rede, e o resultado do geocodificador não pode virar cadastro sem que
 * alguém diga de onde ele veio.
 *
 * O serviço é interceptado, pelo mesmo motivo dos tiles: testar contra o
 * Nominatim público seria trocar um teste por uma aposta — e ainda gastaria a
 * cota de um serviço mantido por doação.
 */

/** Recorte de uma resposta real do Nominatim, com lat/lon como texto. */
const ENDERECOS = [
  {
    place_id: 297876543,
    lat: '-23.5613',
    lon: '-46.6565',
    display_name: 'Avenida Paulista, Bela Vista, São Paulo, SP, Brasil',
    boundingbox: ['-23.5719', '-23.5551', '-46.6626', '-46.6404'],
  },
]

async function servirEnderecos(page, corpo = ENDERECOS) {
  await page.route('**nominatim.openstreetmap.org/**', (rota) =>
    rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) }),
  )
}

test('a busca por cliente continua local: nada sai do navegador ao digitar', async ({ page }) => {
  const chamadas = []
  await page.route('**nominatim.openstreetmap.org/**', (rota) => {
    chamadas.push(rota.request().url())
    return rota.abort()
  })
  await abrir(page, { hash: '#/mapa' })

  const antes = await page.locator('.mapa-lista button').count()
  await page.getByPlaceholder('Buscar cliente, cidade ou UF…').fill('Curitiba')
  await expect.poll(async () => page.locator('.mapa-lista button').count()).toBeLessThan(antes)

  // O filtro local é a operação mais frequente da tela. Se ele passasse a
  // depender de rede, quebraria justamente onde a conexão é pior.
  expect(chamadas).toEqual([])
})

test('endereço fora da base é buscado só quando se pede, e leva o mapa até lá', async ({ page }) => {
  await servirEnderecos(page)
  await abrir(page, { hash: '#/mapa' })

  await page.getByPlaceholder('Buscar cliente, cidade ou UF…').fill('Avenida Paulista 1000')
  await page.getByRole('button', { name: 'Buscar como endereço' }).click()

  await expect(page.getByText('Avenida Paulista, Bela Vista')).toBeVisible()
  await page.getByRole('button', { name: /Avenida Paulista, Bela Vista/ }).click()

  // O alfinete é a prova de que o enquadramento aconteceu no mapa, e não
  // apenas na lista de resultados.
  await expect(page.locator('.mapa__alfinete')).toBeVisible()

  // Enquadrar um endereço aproxima de verdade: a barra de escala tem de sair
  // da ordem de grandeza do país.
  await expect(page.locator('.mapa__escala')).not.toContainText('1.000 km')
})

test('a coordenada só vira cadastro com um cliente escolhido, e registra a origem', async ({ page }) => {
  await servirEnderecos(page)
  await abrir(page, { hash: '#/mapa' })

  await page.getByPlaceholder('Buscar cliente, cidade ou UF…').fill('Avenida Paulista 1000')
  await page.getByRole('button', { name: 'Buscar como endereço' }).click()
  await page.getByRole('button', { name: /Avenida Paulista, Bela Vista/ }).click()

  // Sem cliente selecionado não há o que gravar — e a tela diz o que falta em
  // vez de oferecer um botão que falha.
  await expect(page.getByText(/Selecione um cliente na lista/)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Usar como localização de/ })).toHaveCount(0)

  // A seleção de cliente sobrevive ao filtro de texto. Sem isso, escolher o
  // cliente e depois digitar o endereço para localizá-lo faria o cliente sumir
  // junto com a ação de gravar a coordenada nele.
  await page.getByPlaceholder('Buscar cliente, cidade ou UF…').fill('')
  await page.getByRole('list', { name: 'Clientes no mapa' }).getByRole('button').first().click()
  await page.getByPlaceholder('Buscar cliente, cidade ou UF…').fill('Avenida Paulista 1000')

  const gravar = page.getByRole('button', { name: /^Usar como localização de/ })
  await expect(gravar).toBeVisible()
  await gravar.click()

  await expect(page.getByText('Coordenada gravada')).toBeVisible()
  // Proveniência declarada na tela: coordenada sem origem é coordenada que
  // ninguém sabe se pode corrigir.
  await expect(page.getByText(/registrada como geocodificação/)).toBeVisible()
})

test('serviço de endereço fora do ar não derruba a tela nem a busca local', async ({ page }) => {
  await page.route('**nominatim.openstreetmap.org/**', (rota) => rota.abort())
  await abrir(page, { hash: '#/mapa' })

  await page.getByPlaceholder('Buscar cliente, cidade ou UF…').fill('Avenida Paulista 1000')
  await page.getByRole('button', { name: 'Buscar como endereço' }).click()

  await expect(page.getByText(/Não deu para consultar o serviço de endereços/)).toBeVisible()
  // A frase importa: quem lê precisa saber que o resto continua funcionando.
  await expect(page.getByText(/busca por cliente, cidade e UF continua funcionando/)).toBeVisible()
  await expect(page.locator('.mapa__uf').first()).toBeVisible()
})

test('axe com resultados de endereço na tela', async ({ page }) => {
  await servirEnderecos(page)
  await abrir(page, { hash: '#/mapa' })

  await page.getByPlaceholder('Buscar cliente, cidade ou UF…').fill('Avenida Paulista 1000')
  await page.getByRole('button', { name: 'Buscar como endereço' }).click()
  await page.getByRole('button', { name: /Avenida Paulista, Bela Vista/ }).click()

  const v = await violacoes(page)
  expect(v, `busca de endereço:\n  ${descrever(v)}`).toEqual([])
})

/* ==================================================================== */
/* Política comercial — franquia, preço e simulador                     */
/* ==================================================================== */

/**
 * O que estes testes protegem: a proposta e a fatura contando a mesma história.
 *
 * O simulador reusa a mesma resolução que o faturamento — precedência de
 * tabela, franquia por especificidade, desconto sem acúmulo. Se cotasse por uma
 * regra e faturasse por outra, a divergência só apareceria no primeiro
 * fechamento, na frente do cliente, sobre um valor que ele já assinou.
 */

/** Lê um KPI da faixa de métricas pelo rótulo. */
async function metrica(page, rotulo) {
  const texto = await page.locator('.grade--metricas').first().innerText()
  const m = texto.match(new RegExp(`${rotulo}\\s+([^\\n]+)`))
  return m ? m[1].trim() : null
}

const emReais = (t) => Number(String(t).replace(/[^\d,]/g, '').replace(',', '.'))

test('o simulador separa recorrente de evento', async ({ page }) => {
  await abrir(page, { hash: '#/comercial' })

  const mensal = emReais(await metrica(page, 'Mensal líquido'))
  const instalacao = emReais(await metrica(page, 'Instalação'))
  const primeira = emReais(await metrica(page, 'Primeira fatura'))

  expect(mensal).toBeGreaterThan(0)
  expect(instalacao).toBeGreaterThan(0)

  // Instalação entra na primeira fatura e **não** no MRR. Somá-la ao recorrente
  // infla o indicador com um valor que acontece uma vez, e o erro só aparece
  // quando alguém compara o MRR com o extrato do mês seguinte.
  expect(primeira).toBeCloseTo(mensal + instalacao, 1)
  await expect(page.getByText('evento — não compõe o MRR')).toBeVisible()
})

test('volume acima da franquia vira excedente, e a memória mostra a conta', async ({ page }) => {
  await abrir(page, { hash: '#/comercial' })

  await expect(page.getByRole('cell', { name: /dentro da franquia/ }).first()).toBeVisible()
  const antes = emReais(await metrica(page, 'Mensal líquido'))

  // O volume inicial é a própria franquia do modelo — cenário neutro. Dobrá-lo
  // é o caso que o cliente sempre pergunta: "e se eu imprimir mais?"
  const campo = page.getByLabel('Volume mono/mês')
  const atual = Number(await campo.inputValue())
  await campo.fill(String(atual * 2))
  await page.waitForTimeout(200)

  const depois = emReais(await metrica(page, 'Mensal líquido'))
  expect(depois).toBeGreaterThan(antes)
  await expect(page.getByText(/pág\. além/).first()).toBeVisible()
})

test('a condição do cliente vence a tabela geral', async ({ page }) => {
  await abrir(page, { hash: '#/comercial' })

  // O nome do cliente com condição negociada é lido da própria aba de preços,
  // e não fixado no teste: assim ele continua válido se a massa mudar, e de
  // quebra amarra as duas abas à mesma verdade.
  await page.getByRole('tab', { name: /Preços/ }).click()
  const chip = page.getByText(/Cliente · /).first()
  await expect(chip).toBeVisible()
  const nomeCliente = (await chip.innerText()).split('Cliente · ')[1].trim()

  await page.getByRole('tab', { name: /Simulador/ }).click()
  const geral = emReais(await metrica(page, 'Mensal líquido'))

  // `getByRole('combobox')`: o `aria-label` da lista repete o do campo, e um
  // getByLabel casaria com os dois.
  const combo = page.getByRole('combobox', { name: 'Cliente (opcional)' })
  await combo.click()
  await combo.fill(nomeCliente)
  await page.getByRole('listbox', { name: 'Cliente (opcional)' }).getByRole('option').first().click()
  await page.waitForTimeout(250)

  await expect(page.getByText(/^Aplicando/)).toBeVisible()
  const negociado = emReais(await metrica(page, 'Mensal líquido'))
  expect(negociado).toBeLessThan(geral)

  // E a memória de cálculo diz de onde veio o preço: valor sem procedência
  // vira discussão comercial sem árbitro.
  await expect(page.getByRole('table', { name: /Composição do valor mensal/ })).toContainText(/Condição/)
})

test('desconto reduz o recorrente e aparece na memória', async ({ page }) => {
  await abrir(page, { hash: '#/comercial' })
  const antes = emReais(await metrica(page, 'Mensal líquido'))

  await page.getByLabel('Desconto comercial (%)').fill('10')
  await page.waitForTimeout(200)

  const depois = emReais(await metrica(page, 'Mensal líquido'))
  expect(depois).toBeCloseTo(antes * 0.9, 0)
  await expect(page.getByRole('row', { name: /Desconto de 10%/ })).toBeVisible()
})

test('modelo sem política de franquia não é cotado em silêncio', async ({ page }) => {
  await abrir(page, { hash: '#/comercial' })

  // Nobreak não tem medidor: a linha é válida e cobrada por valor fixo. O que
  // não pode acontecer é uma multifuncional sem franquia sair com excedente
  // zero, que cobraria todo o volume como se estivesse incluso.
  await page.getByLabel('Modelo da linha 1').click()
  await page.getByRole('listbox', { name: 'Modelo da linha 1' }).getByRole('option', { name: /APC/ }).first().click()
  await page.waitForTimeout(200)

  await expect(page.getByText('Sem medidor: cobrança por valor fixo mensal.')).toBeVisible()
  expect(emReais(await metrica(page, 'Mensal líquido'))).toBeGreaterThan(0)
})

test('o total do contrato conta a instalação uma vez só', async ({ page }) => {
  await abrir(page, { hash: '#/comercial' })

  const mensal = emReais(await metrica(page, 'Mensal líquido'))
  const instalacao = emReais(await metrica(page, 'Instalação'))
  const total = emReais(await metrica(page, 'Total em 36 meses'))

  // 36 × recorrente + 1 × instalação. Multiplicar a instalação pelo prazo é o
  // erro que faz uma proposta de três anos parecer 35 instalações mais cara.
  expect(total).toBeCloseTo(mensal * 36 + instalacao, 0)

  await page.getByLabel('Prazo (meses)').fill('12')
  await page.waitForTimeout(200)
  const total12 = emReais(await metrica(page, 'Total em 12 meses'))
  expect(total12).toBeCloseTo(mensal * 12 + instalacao, 0)
})

test('tabela vigente diz por que não se edita', async ({ page }) => {
  await abrir(page, { hash: '#/comercial' })
  await page.getByRole('tab', { name: /Franquias/ }).click()

  await expect(page.getByRole('heading', { name: /Franquia padrão 2026/ })).toBeVisible()
  await expect(page.getByText('Tabela vigente não se edita')).toBeVisible()
  await expect(page.getByText(/reprecificaria, em silêncio/)).toBeVisible()

  // A versão encerrada continua visível: é o histórico que explica por que um
  // contrato antigo tem valores diferentes dos de hoje.
  await expect(page.getByRole('heading', { name: /Franquia padrão 2025/ })).toBeVisible()
  await expect(page.getByText('Encerrada').first()).toBeVisible()
})

test('a tabela de preço declara índice e periodicidade de reajuste', async ({ page }) => {
  await abrir(page, { hash: '#/comercial' })
  await page.getByRole('tab', { name: /Preços/ }).click()

  // Lei 10.192/01 art. 2º §1º: periodicidade inferior a um ano é nula.
  await expect(page.getByText(/reajuste por IPCA a cada 12 meses/).first()).toBeVisible()
  await expect(page.getByText(/nunca compõem o MRR/).first()).toBeVisible()
})

test('axe nas três abas da política comercial', async ({ page }) => {
  await abrir(page, { hash: '#/comercial' })
  let v = await violacoes(page)
  expect(v, `simulador:\n  ${descrever(v)}`).toEqual([])

  await page.getByRole('tab', { name: /Franquias/ }).click()
  v = await violacoes(page)
  expect(v, `franquias:\n  ${descrever(v)}`).toEqual([])

  await page.getByRole('tab', { name: /Preços/ }).click()
  v = await violacoes(page)
  expect(v, `preços:\n  ${descrever(v)}`).toEqual([])
})
