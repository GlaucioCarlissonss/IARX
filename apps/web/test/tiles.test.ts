/**
 * Aritmética da camada raster.
 *
 * Estes testes existem porque o resto da camada de tiles depende de servidor de
 * terceiro, e servidor de terceiro não está disponível em integração contínua.
 * O que dá para provar sem rede — o nível escolhido, quais tiles cobrem a
 * moldura, que URL cada um recebe — é justamente onde mora o erro silencioso:
 * um eixo trocado devolve imagem de outro lugar do planeta sem nenhum erro de
 * carregamento.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LADO_TILE,
  PROVEDORES,
  PROVEDOR_PADRAO,
  TILE_SONDA,
  modeloDe,
  modeloValido,
  montarUrl,
  nivelDeTile,
  normalizarPreferencia,
  provedorPorId,
  tilesVisiveis,
} from '../src/dados/tiles.ts'

/* ------------------------------------------------------------------ nível */

test('o nível casa a escala com o lado nativo do tile', () => {
  // Mundo com 256 px: um tile só, nível 0. Cada dobra sobe um nível.
  assert.equal(nivelDeTile(LADO_TILE, 22), 0)
  assert.equal(nivelDeTile(LADO_TILE * 2, 22), 1)
  assert.equal(nivelDeTile(LADO_TILE * 1024, 22), 10)
})

test('o nível arredonda, e não trunca', () => {
  // 1,5 × 256 está mais perto de 2 tiles por mundo do que de 1. Truncar daria
  // 0, e o tile apareceria sempre ampliado — a diferença entre nítido e borrado
  // em todo zoom intermediário.
  assert.equal(nivelDeTile(LADO_TILE * 1.5, 22), 1)
  assert.equal(nivelDeTile(LADO_TILE * 1.3, 22), 0)
})

test('o nível respeita o teto do provedor e nunca fica negativo', () => {
  assert.equal(nivelDeTile(LADO_TILE * 2 ** 30, 19), 19)
  assert.equal(nivelDeTile(1, 19), 0)
  assert.equal(nivelDeTile(0, 19), 0)
  assert.equal(nivelDeTile(Number.NaN, 19), 0)
})

/* --------------------------------------------------------------- cobertura */

test('a moldura de um tile exato pede um tile', () => {
  const t = tilesVisiveis(0, LADO_TILE, { cx: 0.5, cy: 0.5 }, { largura: 256, altura: 256 })
  assert.equal(t.length, 1)
  assert.deepEqual(
    { z: t[0]!.z, x: t[0]!.colunaUrl, y: t[0]!.linha },
    { z: 0, x: 0, y: 0 },
  )
})

test('o tile é posicionado onde a projeção manda', () => {
  // Nível 1: quatro tiles. Centrada em (0,5 · 0,5), a moldura de 512×512 mostra
  // os quatro, e a divisa entre eles cai no centro exato da tela.
  const t = tilesVisiveis(1, 512, { cx: 0.5, cy: 0.5 }, { largura: 512, altura: 512 })
  assert.equal(t.length, 4)

  const superiorEsquerdo = t.find((x) => x.colunaUrl === 0 && x.linha === 0)!
  assert.equal(superiorEsquerdo.esquerda, 0)
  assert.equal(superiorEsquerdo.topo, 0)

  const inferiorDireito = t.find((x) => x.colunaUrl === 1 && x.linha === 1)!
  assert.equal(inferiorDireito.esquerda, 256)
  assert.equal(inferiorDireito.topo, 256)
})

test('o lado transborda um pixel, para não deixar costura entre os tiles', () => {
  // Escala que não divide em inteiro: sem o transbordo, as bordas arredondadas
  // deixariam um fio de fundo entre um tile e o seguinte.
  const t = tilesVisiveis(1, 700, { cx: 0.5, cy: 0.5 }, { largura: 700, altura: 700 })
  const lado = t[0]!.lado
  assert.equal(lado, Math.ceil(700 / 2) + 1)

  for (const tile of t) {
    assert.equal(Number.isInteger(tile.esquerda), true)
    assert.equal(Number.isInteger(tile.topo), true)
  }
})

test('a coluna dá a volta ao mundo; a linha, não', () => {
  // Centrada sobre o antimeridiano, a moldura pega tiles de leste e de oeste.
  // A coluna negativa vira a última coluna do mundo na URL, mas continua à
  // esquerda na tela — é assim que o mapa se repete ao arrastar.
  const t = tilesVisiveis(2, 1024, { cx: 0, cy: 0.5 }, { largura: 512, altura: 256 })
  const colunas = t.map((x) => x.coluna)
  assert.equal(colunas.includes(-1), true)

  const daVolta = t.find((x) => x.coluna === -1)!
  const primeira = t.find((x) => x.coluna === 0)!
  assert.equal(daVolta.colunaUrl, 3)
  assert.equal(daVolta.esquerda < primeira.esquerda, true)

  // Acima do polo não existe tile: nada de linha negativa, e nada de linha
  // além da última. Esticar o tile da borda seria inventar geografia.
  const polar = tilesVisiveis(2, 1024, { cx: 0.5, cy: 0 }, { largura: 256, altura: 512 })
  assert.equal(
    polar.every((x) => x.linha >= 0 && x.linha < 4),
    true,
  )
})

test('escala ou moldura inválida não produz tile nenhum', () => {
  assert.deepEqual(tilesVisiveis(2, 0, { cx: 0.5, cy: 0.5 }, { largura: 100, altura: 100 }), [])
  assert.deepEqual(tilesVisiveis(2, 512, { cx: 0.5, cy: 0.5 }, { largura: 0, altura: 100 }), [])
  // Nível muito acima do que a escala comporta pediria milhões de tiles; o teto
  // corta antes de o navegador tentar abrir todas as conexões.
  assert.deepEqual(
    tilesVisiveis(22, LADO_TILE, { cx: 0.5, cy: 0.5 }, { largura: 1360, altura: 900 }),
    [],
  )
})

/* --------------------------------------------------------------------- URL */

test('o modelo do Esri recebe os eixos na ordem invertida', () => {
  // É o defeito que não dá erro: com {x} e {y} trocados o tile carrega, só que
  // mostra outro lugar do planeta. Por isso a ordem mora no modelo e tem teste.
  const esri = provedorPorId('satelite')
  const url = montarUrl(esri.modelo, { z: 4, colunaUrl: 5, linha: 8 })
  assert.equal(url.endsWith('/MapServer/tile/4/8/5'), true)
})

test('o modelo XYZ comum recebe os eixos na ordem direta', () => {
  const osm = provedorPorId('osm')
  assert.equal(
    montarUrl(osm.modelo, { z: 4, colunaUrl: 5, linha: 8 }),
    'https://tile.openstreetmap.org/4/5/8.png',
  )
})

test('a credencial do provedor próprio entra no modelo', () => {
  const url = montarUrl('https://t.exemplo/{z}/{x}/{y}.png?key={chave}', {
    z: 3,
    colunaUrl: 2,
    linha: 1,
  }, 'abc123')
  assert.equal(url, 'https://t.exemplo/3/2/1.png?key=abc123')
})

test('sem credencial, o marcador some em vez de virar texto literal', () => {
  const url = montarUrl('https://t.exemplo/{z}/{x}/{y}.png?key={key}', {
    z: 3,
    colunaUrl: 2,
    linha: 1,
  })
  assert.equal(url, 'https://t.exemplo/3/2/1.png?key=')
})

/* ------------------------------------------------------------ provedores */

test('modelo de servidor próprio exige https e os três marcadores', () => {
  assert.equal(modeloValido('https://t.exemplo/{z}/{x}/{y}.png'), true)
  // http seria bloqueado por conteúdo misto quando a aplicação for servida por
  // https, e o sintoma — mapa cinza, sem erro visível — é caro de diagnosticar.
  assert.equal(modeloValido('http://t.exemplo/{z}/{x}/{y}.png'), false)
  assert.equal(modeloValido('https://t.exemplo/{z}/{x}.png'), false)
  assert.equal(modeloValido(''), false)
  assert.equal(modeloValido('  '), false)
})

test('o provedor de ruas troca de modelo com o tema', () => {
  const ruas = provedorPorId('ruas')
  assert.match(modeloDe(ruas, false), /light_all/)
  assert.match(modeloDe(ruas, true), /dark_all/)

  // O OSM clássico não tem variante escura: no tema escuro continua o mesmo.
  const osm = provedorPorId('osm')
  assert.equal(modeloDe(osm, true), modeloDe(osm, false))
})

test('o provedor próprio usa o modelo configurado, não o do registro', () => {
  const proprio = provedorPorId('proprio')
  assert.equal(modeloDe(proprio, false, 'https://t.casa/{z}/{x}/{y}.png'), 'https://t.casa/{z}/{x}/{y}.png')
})

test('id desconhecido cai no vetor, que é o único que funciona sem rede', () => {
  assert.equal(provedorPorId('inexistente').id, 'vetor')
  assert.equal(provedorPorId('').precisaRede, false)
})

test('todo provedor que pede rede declara a atribuição que a licença exige', () => {
  // ODbL para o OSM e os termos da Esri obrigam crédito visível. Um provedor
  // acrescentado sem atribuição é uma violação de licença silenciosa.
  for (const p of PROVEDORES) {
    if (!p.precisaRede) continue
    assert.notEqual(p.atribuicao.trim(), '', `provedor ${p.id} sem atribuição`)
  }
})

test('o tile de sondagem cai sobre o Brasil', () => {
  // Conferido contra projetar(-55, -12) × 2^4 — ver geo.ts. Se a sonda apontar
  // para o oceano, um provedor sem cobertura ali seria julgado indisponível.
  assert.deepEqual(TILE_SONDA, { z: 4, colunaUrl: 5, linha: 8 })
})

/* ------------------------------------------------------------- preferência */

test('preferência guardada em formato inesperado volta ao padrão', () => {
  assert.equal(normalizarPreferencia(null).provedor, PROVEDOR_PADRAO)
  assert.equal(normalizarPreferencia('satelite').provedor, PROVEDOR_PADRAO)
  assert.equal(normalizarPreferencia({ provedor: 'marte' }).provedor, PROVEDOR_PADRAO)
  assert.equal(normalizarPreferencia({ provedor: 'osm' }).provedor, 'osm')
  assert.equal(normalizarPreferencia({ provedor: 'osm', modeloProprio: 7 }).modeloProprio, '')
})
