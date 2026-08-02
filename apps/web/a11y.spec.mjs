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
