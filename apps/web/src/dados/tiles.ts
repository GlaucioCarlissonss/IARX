/**
 * Camada raster do mapa: registro de provedores e a aritmética dos tiles.
 *
 * Este módulo não importa nada — nem React, nem `geo.ts`. É aritmética pura, e
 * é assim que ele pode ser testado com `node --test` sem navegador e sem rede,
 * que é exatamente o que falta quando se depende de servidor de terceiro para
 * saber se o código está certo.
 *
 * O sistema de coordenadas é o mesmo de `geo.ts`: Web Mercator normalizada no
 * quadrado unitário. Não é coincidência — é a projeção dos tiles de qualquer
 * provedor slippy map desde 2005. Por isso a camada raster entra por baixo do
 * que já existe sem recalcular a posição de um marcador sequer.
 *
 * Vocabulário, para o resto do arquivo não precisar repetir:
 *
 *  · `escala` — pixels por unidade de mundo, ou seja, a largura que o planeta
 *    inteiro teria na tela. É o que `Mapa.tsx` já calcula.
 *  · nível `z` — o zoom inteiro do tile; o mundo tem 2^z × 2^z tiles.
 */

/** Lado nominal do tile, em pixels. Universal entre provedores raster. */
export const LADO_TILE = 256

/**
 * Teto de tiles desenhados de uma vez.
 *
 * Uma janela de 1360×900 pede cerca de 30 a 70 tiles. O teto é rede de
 * segurança contra uma escala absurda vinda de um `ResizeObserver` durante a
 * montagem — não expectativa de uso.
 */
const TETO_TILES = 400

export type IdProvedor = 'satelite' | 'ruas' | 'osm' | 'proprio' | 'vetor'

export interface Provedor {
  id: IdProvedor
  nome: string
  descricao: string
  /** Modelo com `{z}`, `{x}` e `{y}`. Vazio significa "sem tiles". */
  modelo: string
  /** Variante para o tema escuro, quando o provedor tem uma. */
  modeloEscuro?: string
  /** Crédito exigido pela licença. Não é enfeite: ODbL e os termos da Esri obrigam. */
  atribuicao: string
  atribuicaoHref: string
  zoomMax: number
  /**
   * Cor sob o tile enquanto ele não chega.
   *
   * Sem isto, um basemap escuro pisca branco a cada quadro de zoom, que é
   * desconfortável e, em tela grande, chega a ofuscar.
   */
  fundo: 'claro' | 'escuro'
  /** Falso para o vetor embutido — o único que funciona sem rede. */
  precisaRede: boolean
}

/* ------------------------------------------------------------- provedores */

/**
 * Ordem deliberada: o satélite é o padrão pedido pela operação, e o vetor é o
 * último porque é o piso, não uma alternativa de mesma natureza.
 *
 * O Esri inverte a ordem dos eixos na URL — `{z}/{y}/{x}`, e não `{z}/{x}/{y}`.
 * Isso mora no modelo, não numa bandeira booleana em `montarUrl`: assim o
 * provedor seguinte que inventar outra ordem é uma linha de dado, não um `if`.
 */
export const PROVEDORES: Provedor[] = [
  {
    id: 'satelite',
    nome: 'Satélite',
    descricao: 'Imagem aérea, com os contornos de estado por cima',
    modelo:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    atribuicao: 'Esri, Maxar, Earthstar Geographics',
    atribuicaoHref: 'https://www.esri.com/en-us/legal/copyright-trademarks',
    zoomMax: 19,
    fundo: 'escuro',
    precisaRede: true,
  },
  {
    id: 'ruas',
    nome: 'Ruas',
    descricao: 'Basemap discreto, que acompanha o tema claro ou escuro',
    modelo: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    modeloEscuro: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    atribuicao: '© OpenStreetMap contributors, © CARTO',
    atribuicaoHref: 'https://www.openstreetmap.org/copyright',
    zoomMax: 20,
    fundo: 'claro',
    precisaRede: true,
  },
  {
    id: 'osm',
    nome: 'OpenStreetMap',
    descricao: 'O tile clássico, colorido — sem variante escura',
    modelo: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    atribuicao: '© OpenStreetMap contributors',
    atribuicaoHref: 'https://www.openstreetmap.org/copyright',
    zoomMax: 19,
    fundo: 'claro',
    precisaRede: true,
  },
  {
    id: 'proprio',
    nome: 'Servidor próprio',
    descricao: 'MapTiler, Mapbox, Google ou um servidor de tiles da casa',
    modelo: '',
    atribuicao: 'Conforme o contrato do provedor',
    atribuicaoHref: '',
    zoomMax: 22,
    fundo: 'claro',
    precisaRede: true,
  },
  {
    id: 'vetor',
    nome: 'Vetor embutido',
    descricao: 'Contornos dos estados, sem imagem — funciona sem rede',
    modelo: '',
    atribuicao: 'Fronteiras: IBGE',
    atribuicaoHref: '',
    zoomMax: 22,
    fundo: 'claro',
    precisaRede: false,
  },
]

export const PROVEDOR_PADRAO: IdProvedor = 'satelite'

export function provedorPorId(id: string): Provedor {
  return PROVEDORES.find((p) => p.id === id) ?? PROVEDORES[PROVEDORES.length - 1]!
}

/** O modelo efetivo, já resolvido o tema e a configuração do provedor próprio. */
export function modeloDe(p: Provedor, escuro: boolean, modeloProprio = ''): string {
  if (p.id === 'proprio') return modeloProprio
  if (escuro && p.modeloEscuro) return p.modeloEscuro
  return p.modelo
}

/* ---------------------------------------------------------------- aritmética */

export interface Tile {
  z: number
  /** Coluna sem normalizar — pode ser negativa quando o mundo dá a volta. */
  coluna: number
  linha: number
  /** Coluna já trazida para `[0, 2^z)`, que é a que vai na URL. */
  colunaUrl: number
  /** Posição e tamanho em pixels da moldura, prontos para o `style`. */
  esquerda: number
  topo: number
  lado: number
}

/**
 * Nível de tile para a escala atual.
 *
 * `round`, e não `floor`: com arredondamento o tile aparece entre ~181 px e
 * ~362 px, metade das vezes reduzido (nítido) e metade ampliado; com `floor`
 * ele fica sempre entre 256 e 512, ou seja, **sempre ampliado**, e a imagem
 * borra em todo zoom intermediário.
 */
export function nivelDeTile(escala: number, zoomMax: number): number {
  if (!Number.isFinite(escala) || escala <= 0) return 0
  const bruto = Math.round(Math.log2(escala / LADO_TILE))
  return Math.max(0, Math.min(Math.max(0, Math.trunc(zoomMax)), bruto))
}

/**
 * Tiles que cobrem a moldura, já posicionados.
 *
 * Duas assimetrias que parecem descuido e não são:
 *
 *  · **coluna dá a volta, linha não**. A leste do antimeridiano o mundo se
 *    repete, e é isso que o usuário espera ao arrastar; acima do polo não
 *    existe mundo, e desenhar o tile da borda esticado seria inventar
 *    geografia. Por isso `colunaUrl` normaliza e `linha` é recortada.
 *  · **`lado` leva `+1` e as posições são arredondadas**. Em zoom fracionário
 *    o lado do tile é fracionário, e `<img>` adjacentes em posição fracionária
 *    deixam um fio de fundo de 1 px entre si — uma grade de linhas claras
 *    sobre o mapa. Arredondar a posição e transbordar um pixel cobre a costura.
 */
export function tilesVisiveis(
  z: number,
  escala: number,
  centro: { cx: number; cy: number },
  dim: { largura: number; altura: number },
): Tile[] {
  if (!Number.isFinite(escala) || escala <= 0) return []
  if (dim.largura <= 0 || dim.altura <= 0) return []

  const n = 2 ** z
  const lado = escala / n

  const meiaLargura = dim.largura / 2 / escala
  const meiaAltura = dim.altura / 2 / escala

  /*
   * A borda final usa `ceil(...) - 1`, e não `floor(...)`.
   *
   * O tile cobre o intervalo semiaberto `[i/n, (i+1)/n)`. Quando a moldura
   * termina exatamente na divisa — o caso comum de um mundo que cabe inteiro na
   * tela — `floor` inclui o tile seguinte, que começa no pixel de fora e não
   * mostra nada. Era uma coluna e uma linha de requisições inúteis em toda
   * abertura do mapa.
   */
  const colInicio = Math.floor((centro.cx - meiaLargura) * n)
  const colFim = Math.ceil((centro.cx + meiaLargura) * n) - 1
  const linInicio = Math.max(0, Math.floor((centro.cy - meiaAltura) * n))
  const linFim = Math.min(n - 1, Math.ceil((centro.cy + meiaAltura) * n) - 1)

  const colunas = colFim - colInicio + 1
  const linhas = linFim - linInicio + 1
  if (colunas <= 0 || linhas <= 0) return []
  if (colunas * linhas > TETO_TILES) return []

  const saida: Tile[] = []
  for (let linha = linInicio; linha <= linFim; linha++) {
    for (let coluna = colInicio; coluna <= colFim; coluna++) {
      saida.push({
        z,
        coluna,
        linha,
        colunaUrl: ((coluna % n) + n) % n,
        esquerda: Math.round((coluna / n - centro.cx) * escala + dim.largura / 2),
        topo: Math.round((linha / n - centro.cy) * escala + dim.altura / 2),
        lado: Math.ceil(lado) + 1,
      })
    }
  }
  return saida
}

/** Substitui os marcadores do modelo. `{chave}` e `{key}` para a credencial. */
export function montarUrl(
  modelo: string,
  t: { z: number; colunaUrl: number; linha: number },
  chave = '',
): string {
  return modelo
    .replace(/\{z\}/g, String(t.z))
    .replace(/\{x\}/g, String(t.colunaUrl))
    .replace(/\{y\}/g, String(t.linha))
    .replace(/\{chave\}/g, chave)
    .replace(/\{key\}/g, chave)
}

/**
 * Modelo aceitável para o provedor próprio.
 *
 * `https` obrigatório: a aplicação servida por HTTPS teria a requisição
 * bloqueada por conteúdo misto, e o sintoma — mapa cinza, sem erro visível —
 * é caro de diagnosticar depois.
 */
export function modeloValido(modelo: string): boolean {
  const m = modelo.trim()
  if (!/^https:\/\/\S+$/i.test(m)) return false
  return /\{z\}/.test(m) && /\{x\}/.test(m) && /\{y\}/.test(m)
}

/**
 * Tile de sondagem: z 4, sobre o Centro-Oeste.
 *
 * Fixo e de zoom baixo de propósito — é pequeno, tem grande chance de já estar
 * no cache do provedor, e a resposta diz em um `onload` se há caminho até o
 * servidor. Os números saem de `projetar(-55, -12)` × 2^4.
 */
export const TILE_SONDA = { z: 4, colunaUrl: 5, linha: 8 } as const

/* -------------------------------------------------------------- preferência */

export interface PreferenciaMapa {
  provedor: IdProvedor
  modeloProprio: string
  chavePropria: string
}

const CHAVE_ARMAZEM = 'iarx.mapa.tiles'

export const PREFERENCIA_PADRAO: PreferenciaMapa = {
  provedor: PROVEDOR_PADRAO,
  modeloProprio: '',
  chavePropria: '',
}

/**
 * `localStorage` dentro de `try`: em navegação privada do Safari o acesso
 * **lança**, e uma preferência de aparência não pode derrubar o mapa.
 */
export function lerPreferencia(): PreferenciaMapa {
  try {
    const bruto = globalThis.localStorage?.getItem(CHAVE_ARMAZEM)
    if (!bruto) return PREFERENCIA_PADRAO
    return normalizarPreferencia(JSON.parse(bruto))
  } catch {
    return PREFERENCIA_PADRAO
  }
}

export function gravarPreferencia(p: PreferenciaMapa): void {
  try {
    globalThis.localStorage?.setItem(CHAVE_ARMAZEM, JSON.stringify(p))
  } catch {
    /* preferência é conveniência; falhar em gravá-la não é erro do usuário */
  }
}

/** Preferência vinda do armazém é dado externo: nunca confiar no formato. */
export function normalizarPreferencia(bruto: unknown): PreferenciaMapa {
  if (typeof bruto !== 'object' || bruto === null) return PREFERENCIA_PADRAO
  const o = bruto as Record<string, unknown>
  const id = PROVEDORES.some((p) => p.id === o.provedor)
    ? (o.provedor as IdProvedor)
    : PROVEDOR_PADRAO
  return {
    provedor: id,
    modeloProprio: typeof o.modeloProprio === 'string' ? o.modeloProprio : '',
    chavePropria: typeof o.chavePropria === 'string' ? o.chavePropria : '',
  }
}
