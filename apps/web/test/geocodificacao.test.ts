/**
 * Leitura da resposta do Nominatim.
 *
 * O parser é a parte perigosa da geocodificação, e por isso é puro e separado
 * da chamada de rede. O serviço devolve coordenada **como texto** e a caixa
 * envolvente em uma ordem que não é a de nenhuma outra API de mapa. Um erro
 * aqui não lança exceção: enquadra o mapa em lugar nenhum, ou grava no cadastro
 * do cliente uma coordenada no meio do oceano.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerRespostaNominatim } from '../src/dados/geocodificacao.ts'

/** Recorte de uma resposta real, com os campos que importam. */
const RESPOSTA = [
  {
    place_id: 297876543,
    osm_type: 'way',
    lat: '-23.5613',
    lon: '-46.6565',
    display_name: 'Avenida Paulista, Bela Vista, São Paulo, SP, 01310-100, Brasil',
    boundingbox: ['-23.5719', '-23.5551', '-46.6626', '-46.6404'],
  },
  {
    place_id: 12345,
    lat: '-25.4284',
    lon: '-49.2733',
    display_name: 'Curitiba, Região Metropolitana de Curitiba, PR, Brasil',
    boundingbox: ['-25.6485', '-25.3453', '-49.3844', '-49.1846'],
  },
]

test('converte a resposta e traz a coordenada como número', () => {
  const r = lerRespostaNominatim(RESPOSTA)
  assert.equal(r.length, 2)
  assert.equal(r[0]!.lat, -23.5613)
  assert.equal(r[0]!.lon, -46.6565)
  assert.equal(typeof r[0]!.lat, 'number')
  assert.match(r[0]!.rotulo, /Avenida Paulista/)
  assert.equal(r[0]!.id, '297876543')
})

test('a caixa envolvente vem na ordem sul, norte, oeste, leste', () => {
  // Não é a ordem de nenhuma outra API de mapa — a maioria usa
  // [oeste, sul, leste, norte]. Ler na ordem errada enquadra o mapa girado.
  const r = lerRespostaNominatim(RESPOSTA)
  assert.deepEqual(r[1]!.caixa, {
    sul: -25.6485,
    norte: -25.3453,
    oeste: -49.3844,
    leste: -49.1846,
  })
  assert.equal(r[1]!.caixa!.sul < r[1]!.caixa!.norte, true)
  assert.equal(r[1]!.caixa!.oeste < r[1]!.caixa!.leste, true)
})

test('resposta vazia devolve lista vazia, não erro', () => {
  assert.deepEqual(lerRespostaNominatim([]), [])
})

test('resposta que não é lista devolve lista vazia', () => {
  // O serviço responde objeto de erro quando a consulta é recusada, e um
  // `.map` sobre isso derrubaria a tela inteira.
  assert.deepEqual(lerRespostaNominatim({ error: 'Unable to geocode' }), [])
  assert.deepEqual(lerRespostaNominatim(null), [])
  assert.deepEqual(lerRespostaNominatim(undefined), [])
  assert.deepEqual(lerRespostaNominatim('erro'), [])
})

test('item sem coordenada utilizável é descartado, não propagado', () => {
  const r = lerRespostaNominatim([
    { place_id: 1, lat: 'não é número', lon: '-46.6', display_name: 'A' },
    { place_id: 2, lon: '-46.6', display_name: 'B' },
    { place_id: 3, lat: '', lon: '', display_name: 'C' },
    null,
    'texto solto',
    { place_id: 6, lat: '-23.5', lon: '-46.6', display_name: 'válido' },
  ])
  // Um resultado a menos incomoda; uma coordenada NaN no mapa é um defeito
  // que não lança e só aparece quando alguém repara que o pino sumiu.
  assert.equal(r.length, 1)
  assert.equal(r[0]!.rotulo, 'válido')
})

test('coordenada fora da faixa terrestre é descartada', () => {
  const r = lerRespostaNominatim([
    { place_id: 1, lat: '-91', lon: '-46', display_name: 'polo impossível' },
    { place_id: 2, lat: '-23', lon: '-200', display_name: 'longitude impossível' },
  ])
  assert.deepEqual(r, [])
})

test('caixa malformada não impede o resultado — só perde o enquadramento', () => {
  const r = lerRespostaNominatim([
    { place_id: 1, lat: '-23.5', lon: '-46.6', display_name: 'sem caixa' },
    { place_id: 2, lat: '-23.5', lon: '-46.6', display_name: 'caixa curta', boundingbox: ['-23', '-24'] },
    { place_id: 3, lat: '-23.5', lon: '-46.6', display_name: 'caixa suja', boundingbox: ['a', 'b', 'c', 'd'] },
    {
      place_id: 4,
      lat: '-23.5',
      lon: '-46.6',
      display_name: 'caixa sem área',
      boundingbox: ['-23.5', '-23.5', '-46.6', '-46.6'],
    },
  ])
  assert.equal(r.length, 4)
  assert.equal(r.every((x) => x.caixa === null), true)
})

test('sem display_name, o rótulo cai no nome e depois na coordenada', () => {
  const r = lerRespostaNominatim([
    { place_id: 1, lat: '-23.5', lon: '-46.6', name: 'Praça da Sé' },
    { place_id: 2, lat: '-23.5', lon: '-46.6' },
  ])
  assert.equal(r[0]!.rotulo, 'Praça da Sé')
  // Resultado sem nenhum nome ainda é útil: mostra onde fica.
  assert.match(r[1]!.rotulo, /-23\.50000, -46\.60000/)
})

test('sem place_id, o item ainda ganha identidade estável', () => {
  // A lista de resultados é renderizada com chave; itens sem identidade
  // colidiriam e o React reaproveitaria a linha errada.
  const r = lerRespostaNominatim([
    { lat: '-23.5', lon: '-46.6', display_name: 'A' },
    { lat: '-23.5', lon: '-46.6', display_name: 'B' },
  ])
  assert.equal(r.length, 2)
  assert.notEqual(r[0]!.id, r[1]!.id)
})

test('latitude numérica também é aceita', () => {
  // O jsonv2 devolve texto, mas instalações próprias de Nominatim e outros
  // geocodificadores devolvem número — e a troca de provedor está prevista.
  const r = lerRespostaNominatim([{ place_id: 1, lat: -23.5, lon: -46.6, display_name: 'A' }])
  assert.equal(r[0]!.lat, -23.5)
})
