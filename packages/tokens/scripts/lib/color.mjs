/**
 * Utilitários de cor para os validadores de acessibilidade.
 *
 * Contém:
 *  - contraste WCAG 2.x (luminância relativa)
 *  - conversão sRGB → CIELAB
 *  - ΔE CIEDE2000
 *  - simulação de deficiência de visão de cores (Machado et al., 2009, severidade 1.0)
 *
 * Sem dependências externas: roda em CI com Node puro.
 */

/* ---------------- sRGB ---------------- */

export function parseHex(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`Cor inválida (esperado #rrggbb): ${hex}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function toHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

const srgbToLinear = (v) => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

const linearToSrgb = (v) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return Math.max(0, Math.min(1, c)) * 255
}

/* ---------------- contraste WCAG ---------------- */

/**
 * Luminância relativa conforme WCAG 2.x.
 * Nota: a norma usa o limiar 0.03928 (e não 0.04045) na definição de luminância;
 * a diferença é numericamente irrelevante, mas mantemos o valor da norma aqui
 * para que o resultado seja exatamente o de uma ferramenta de conformidade.
 */
export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Razão de contraste WCAG entre duas cores (1..21). */
export function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/* ---------------- CIELAB ---------------- */

// Matriz sRGB (D65) → XYZ
const M_RGB_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
]

// Branco de referência D65
const WHITE = [0.95047, 1.0, 1.08883]

export function labFromHex(hex) {
  const lin = parseHex(hex).map(srgbToLinear)
  const xyz = M_RGB_XYZ.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
  const [fx, fy, fz] = xyz.map((v, i) => f(v / WHITE[i]))
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/**
 * ΔE CIEDE2000 — diferença perceptual entre duas cores.
 * Referência: Sharma, Wu & Dalal (2005), implementação padrão.
 * Interpretação prática: <1 imperceptível · 1–2 perceptível a olho treinado ·
 * 2–10 perceptível · >10 cores claramente distintas.
 */
export function deltaE2000(hexA, hexB) {
  const [L1, a1, b1] = labFromHex(hexA)
  const [L2, a2, b2] = labFromHex(hexB)

  const kL = 1
  const kC = 1
  const kH = 1

  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = (C1 + C2) / 2

  const Cbar7 = Math.pow(Cbar, 7)
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))))

  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2

  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)

  const deg = (rad) => (rad * 180) / Math.PI
  const rad = (d) => (d * Math.PI) / 180
  const norm360 = (d) => ((d % 360) + 360) % 360

  const h1p = C1p === 0 ? 0 : norm360(deg(Math.atan2(b1, a1p)))
  const h2p = C2p === 0 ? 0 : norm360(deg(Math.atan2(b2, a2p)))

  const dLp = L2 - L1
  const dCp = C2p - C1p

  let dhp
  if (C1p * C2p === 0) dhp = 0
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360
  else dhp = h2p - h1p + 360

  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2)

  const Lbarp = (L1 + L2) / 2
  const Cbarp = (C1p + C2p) / 2

  let hbarp
  if (C1p * C2p === 0) hbarp = h1p + h2p
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2
  else hbarp = (h1p + h2p - 360) / 2

  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.2 * Math.cos(rad(4 * hbarp - 63))

  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2))
  const Cbarp7 = Math.pow(Cbarp, 7)
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)))
  const Rt = -Rc * Math.sin(rad(2 * dTheta))

  const Lbarp50 = Math.pow(Lbarp - 50, 2)
  const Sl = 1 + (0.015 * Lbarp50) / Math.sqrt(20 + Lbarp50)
  const Sc = 1 + 0.045 * Cbarp
  const Sh = 1 + 0.015 * Cbarp * T

  return Math.sqrt(
    Math.pow(dLp / (kL * Sl), 2) +
      Math.pow(dCp / (kC * Sc), 2) +
      Math.pow(dHp / (kH * Sh), 2) +
      Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh)),
  )
}

/* ---------------- simulação de daltonismo ---------------- */

/**
 * Matrizes de Machado, Oliveira & Fernandes (2009) para severidade 1.0,
 * aplicadas em RGB linear. São as usadas por ferramentas de referência
 * (incl. Chrome DevTools) por reproduzirem melhor a percepção real que as
 * matrizes clássicas de Viénot para severidades intermediárias.
 */
const CVD_MATRICES = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}

export const CVD_TIPOS = Object.keys(CVD_MATRICES)

/** Simula como uma cor é percebida sob a deficiência informada. */
export function simulateCVD(hex, tipo) {
  const M = CVD_MATRICES[tipo]
  if (!M) throw new Error(`Tipo de CVD desconhecido: ${tipo}`)
  const lin = parseHex(hex).map(srgbToLinear)
  const out = M.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])
  return toHex(out.map(linearToSrgb))
}

export const round = (n, casas = 2) => {
  const f = Math.pow(10, casas)
  return Math.round(n * f) / f
}
