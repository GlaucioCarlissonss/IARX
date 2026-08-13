#!/usr/bin/env node
/**
 * Validador de acessibilidade dos tokens de cor da IARX.
 *
 * Verifica duas coisas distintas, com métricas distintas:
 *
 *  1. CONTRASTE (WCAG 2.2 AA) — pares texto/fundo e elementos gráficos/fundo.
 *     Métrica: razão de contraste por luminância relativa. Mínimos 4.5 e 3.0.
 *
 *  2. DISTINÇÃO ENTRE SÉRIES CATEGÓRICAS de gráfico.
 *     Métrica: ΔE CIEDE2000, inclusive sob simulação de protanopia,
 *     deuteranopia e tritanopia.
 *     Razão de contraste NÃO é a métrica correta aqui: ela mede legibilidade
 *     contra um fundo, não confusão entre duas marcas de dado. O problema real
 *     é colapso de matiz — sob protanopia/deuteranopia, azul e violeta tendem
 *     ao mesmo ponto, por exemplo.
 *     Constatação empírica da busca que gerou esta paleta (ver G.6): sob
 *     dicromacia sobram apenas o eixo azul↔amarelo e a LUMINOSIDADE. Por isso
 *     as séries formam deliberadamente uma escada de luminosidade — clarear
 *     todas as cores de forma uniforme no tema escuro destrói a distinção
 *     (medimos ΔE 1,5 entre azul e violeta ao fazer isso).
 *
 * Cor nunca é suficiente por si só (WCAG 1.4.1): G.6 exige também forma,
 * padrão ou rótulo direto. Este validador cobre a camada de cor.
 *
 * Uso:
 *   node scripts/validate-contrast.mjs            # tabela; exit 1 se reprovar
 *   node scripts/validate-contrast.mjs --quiet    # só as falhas e o resumo
 *   node scripts/validate-contrast.mjs --json     # relatório de conformidade
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { contrast, deltaE2000, simulateCVD, CVD_TIPOS, round } from './lib/color.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const palette = JSON.parse(readFileSync(join(here, '..', 'src', 'palette.json'), 'utf8'))

const { texto_normal, componente_ui } = palette.meta.minimos
const { delta_e_visao_normal, delta_e_sob_cvd } = palette.meta.minimos_series
const TEMAS = ['light', 'dark']
const SERIES = [1, 2, 3, 4, 5]

/* ------------------------------------------------------------------ */
/* 1. Regras de contraste                                              */
/* ------------------------------------------------------------------ */

function regrasContraste(tema) {
  const pares = []
  const t = (k) => {
    const v = tema[k]
    if (!v) throw new Error(`Token ausente: ${k}`)
    return v
  }
  const add = (rotulo, fg, bg, min, criterio) =>
    pares.push({ rotulo, fgHex: t(fg), bgHex: t(bg), min, criterio })

  // Texto sobre cada superfície
  for (const bg of ['bg', 'surface', 'surface-raised']) {
    add(`text-primary / ${bg}`, 'text-primary', bg, texto_normal, 'WCAG 1.4.3 texto normal')
    add(`text-secondary / ${bg}`, 'text-secondary', bg, texto_normal, 'WCAG 1.4.3 texto normal')
    add(`text-muted / ${bg}`, 'text-muted', bg, texto_normal, 'WCAG 1.4.3 texto normal')
  }

  // Ação primária
  add('text-on-accent / primary', 'text-on-accent', 'primary', texto_normal, 'WCAG 1.4.3 rótulo de botão')
  add('text-on-accent / primary-hover', 'text-on-accent', 'primary-hover', texto_normal, 'WCAG 1.4.3 rótulo de botão')
  add('primary / bg', 'primary', 'bg', texto_normal, 'WCAG 1.4.3 link em texto')
  add('primary-subtle-fg / primary-subtle-bg', 'primary-subtle-fg', 'primary-subtle-bg', texto_normal, 'WCAG 1.4.3 chip')

  // Estados semânticos (dicionário visual da seção 9.2.3)
  for (const s of ['disponivel', 'em-uso', 'atencao', 'critico', 'inativo']) {
    add(`${s} / bg`, s, 'bg', texto_normal, 'WCAG 1.4.3 rótulo de estado')
    add(`${s} / surface`, s, 'surface', texto_normal, 'WCAG 1.4.3 rótulo em tabela')
    add(`${s} / ${s}-bg`, s, `${s}-bg`, texto_normal, 'WCAG 1.4.3 rótulo sobre chip')
    add(`${s}-mark / bg`, `${s}-mark`, 'bg', componente_ui, 'WCAG 1.4.11 marcador de estado')
    add(`${s}-mark / surface`, `${s}-mark`, 'surface', componente_ui, 'WCAG 1.4.11 marcador de estado')
    // O marcador do mapa carrega a contagem dentro do disco colorido: ali o
    // `-mark` deixa de ser só uma marca e passa a ser fundo de texto, e o
    // limite sobe de 3:1 para 4,5:1. Este par foi acrescentado depois de um
    // defeito real — o número saía com a cor herdada sobre o âmbar.
    add(`text-on-accent / ${s}-mark`, 'text-on-accent', `${s}-mark`, texto_normal, 'WCAG 1.4.3 contagem no marcador do mapa')
  }

  // Limites de componente
  add('border-strong / bg', 'border-strong', 'bg', componente_ui, 'WCAG 1.4.11 limite de componente')
  add('border-strong / surface', 'border-strong', 'surface', componente_ui, 'WCAG 1.4.11 limite de componente')

  // Foco: técnica de anel duplo (externo escuro + interno claro), de modo que o
  // indicador permaneça visível sobre qualquer fundo, inclusive sobre o próprio
  // botão primário. WCAG 2.4.11/2.4.13.
  add('focus-ring / bg', 'focus-ring', 'bg', componente_ui, 'WCAG 2.4.11 anel externo sobre fundo')
  add('focus-ring / surface', 'focus-ring', 'surface', componente_ui, 'WCAG 2.4.11 anel externo sobre superfície')
  add('focus-ring-inset / primary', 'focus-ring-inset', 'primary', componente_ui, 'WCAG 2.4.13 anel interno sobre botão primário')
  add('focus-ring-inset / focus-ring', 'focus-ring-inset', 'focus-ring', componente_ui, 'WCAG 2.4.13 anel duplo distinguível')

  // Marcas de gráfico precisam ser legíveis contra o fundo do painel
  for (const i of SERIES) {
    add(`serie-${i} / bg`, `serie-${i}`, 'bg', componente_ui, 'WCAG 1.4.11 marca de gráfico')
    add(`serie-${i} / surface`, `serie-${i}`, 'surface', componente_ui, 'WCAG 1.4.11 marca de gráfico')
  }

  return pares.map((p) => {
    const ratio = round(contrast(p.fgHex, p.bgHex))
    return { tipo: 'contraste', ...p, valor: ratio, unidade: ':1', passou: ratio >= p.min }
  })
}

/* ------------------------------------------------------------------ */
/* 2. Distinção entre séries (ΔE2000, com e sem CVD)                   */
/* ------------------------------------------------------------------ */

function regrasSeries(tema) {
  const out = []
  for (let i = 0; i < SERIES.length; i++) {
    for (let j = i + 1; j < SERIES.length; j++) {
      const ka = `serie-${SERIES[i]}`
      const kb = `serie-${SERIES[j]}`
      const a = tema[ka]
      const b = tema[kb]

      const dNormal = round(deltaE2000(a, b), 1)
      out.push({
        tipo: 'serie',
        rotulo: `${ka} vs ${kb} (visão normal)`,
        fgHex: a,
        bgHex: b,
        min: delta_e_visao_normal,
        valor: dNormal,
        unidade: ' ΔE',
        criterio: 'interno: distinção categórica',
        passou: dNormal >= delta_e_visao_normal,
      })

      for (const cvd of CVD_TIPOS) {
        const d = round(deltaE2000(simulateCVD(a, cvd), simulateCVD(b, cvd)), 1)
        out.push({
          tipo: 'serie',
          rotulo: `${ka} vs ${kb} (${cvd})`,
          fgHex: a,
          bgHex: b,
          min: delta_e_sob_cvd,
          valor: d,
          unidade: ' ΔE',
          criterio: `interno: distinção sob ${cvd}`,
          passou: d >= delta_e_sob_cvd,
        })
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

const resultados = []
for (const nome of TEMAS) {
  const tema = palette[nome]
  for (const r of [...regrasContraste(tema), ...regrasSeries(tema)]) {
    resultados.push({ tema: nome, ...r })
  }
}

const falhas = resultados.filter((r) => !r.passou)
const quiet = process.argv.includes('--quiet')

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      {
        norma: palette.meta.norma,
        versao_tokens: palette.meta.versao,
        gerado_em: null,
        total: resultados.length,
        aprovados: resultados.length - falhas.length,
        falhas: falhas.length,
        resultados,
      },
      null,
      2,
    ),
  )
} else {
  for (const tema of TEMAS) {
    const doTema = resultados.filter((r) => r.tema === tema)
    const contrastes = doTema.filter((r) => r.tipo === 'contraste')
    const series = doTema.filter((r) => r.tipo === 'serie')
    console.log(`\n── tema ${tema} · ${contrastes.length} pares de contraste · ${series.length} pares de série`)
    for (const r of doTema) {
      if (r.passou && quiet) continue
      const marca = r.passou ? '✓' : '✗'
      const valor = `${r.valor}${r.unidade}`.padStart(8)
      console.log(
        `${marca} ${r.rotulo.padEnd(46)}${valor}  (mín ${r.min})${r.passou ? '' : `  ← ${r.criterio}`}`,
      )
    }
    const pior = doTema.filter((r) => r.tipo === 'serie').sort((a, b) => a.valor - b.valor)[0]
    if (pior) console.log(`   pior par de série: ${pior.rotulo} = ${pior.valor} ΔE`)
  }

  console.log(
    `\n${resultados.length - falhas.length}/${resultados.length} verificações aprovadas` +
      ` — ${palette.meta.norma} + distinção categórica sob CVD`,
  )
  if (falhas.length) {
    console.error(`\n${falhas.length} REPROVADA(S):`)
    for (const f of falhas) {
      console.error(
        `  ${f.tema}: ${f.rotulo} = ${f.valor}${f.unidade}, exigido ${f.min} (${f.fgHex} / ${f.bgHex})`,
      )
    }
  }
}

process.exit(falhas.length ? 1 : 0)
