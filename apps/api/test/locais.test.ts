import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOCAL_ALFA,
  LOCAL_SEM_COORDENADA,
  LOCAL_TENANT_B,
  TENANT_B,
  USUARIO_B,
  chamar,
  subirApi,
  token,
  type Servidor,
} from './apoio.js'

/**
 * Integração dos locais de operação, contra PostgreSQL real.
 *
 * O que estes testes existem para provar, em uma frase: nenhuma coordenada
 * entra no sistema sem dizer de onde veio, e nenhuma entra com os eixos
 * trocados — que é o erro que não lança nada e faz um cliente sumir do mapa.
 */

let api: Servidor

const GESTOR = ['local_operacao:gerenciar'] as const

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('locais de operação', () => {
  it('lista e destaca os que ainda não têm coordenada', async () => {
    const t = await token({ permissoes: [...GESTOR] })

    const todos = await chamar(api, 'GET', '/api/v1/locais', { token: t })
    assert.equal(todos.status, 200)
    assert.ok(todos.corpo.data.length >= 2)

    // A fila de trabalho do mapa: local sem coordenada não aparece nele, o que
    // na prática é o mesmo que não existir para quem planeja rota de técnico.
    const pendentes = await chamar(api, 'GET', '/api/v1/locais?sem_coordenada=true', { token: t })
    assert.equal(pendentes.status, 200)
    assert.ok(pendentes.corpo.data.length >= 1)
    assert.ok(pendentes.corpo.data.every((l: { lat: number | null }) => l.lat === null))
  })

  it('grava a coordenada com proveniência e devolve 200, não 201', async () => {
    const t = await token({ permissoes: [...GESTOR] })

    const r = await chamar(api, 'POST', `/api/v1/locais/${LOCAL_SEM_COORDENADA}/localizacao`, {
      token: t,
      corpo: {
        lat: -23.5613,
        lon: -46.6565,
        precisao: 'GEOCODIFICADO',
        fonte: 'Nominatim · Avenida Paulista, São Paulo',
      },
    })

    // 200 porque o local já existe e já tem URL própria: a ação preenche um
    // atributo dele, não cria recurso.
    assert.equal(r.status, 200)
    assert.equal(r.corpo.data.geo_precisao, 'GEOCODIFICADO')
    assert.match(r.corpo.data.geo_fonte, /Nominatim/)
    assert.ok(r.corpo.data.geo_atualizado_em)

    // Ida e volta pelo banco sem trocar os eixos. É o teste que importa: o
    // contrato recebe lat/lon, o PostGIS guarda lon/lat, e a conversão acontece
    // num lugar só.
    assert.equal(Number(r.corpo.data.lat.toFixed(4)), -23.5613)
    assert.equal(Number(r.corpo.data.lon.toFixed(4)), -46.6565)
  })

  it('recusa coordenada fora do território e diz o que conferir', async () => {
    const t = await token({ permissoes: [...GESTOR] })

    // Avenida Paulista com os eixos invertidos cai no oceano Índico. Sem esta
    // recusa, o ponto entraria sem erro nenhum e o cliente sumiria do mapa.
    const r = await chamar(api, 'POST', `/api/v1/locais/${LOCAL_ALFA}/localizacao`, {
      token: t,
      corpo: { lat: -46.6565, lon: -23.5613, precisao: 'GEOCODIFICADO', fonte: 'importação' },
    })

    assert.equal(r.status, 422)
    assert.equal(r.corpo.code, 'REGRA_DE_NEGOCIO')
    assert.match(r.corpo.detail, /trocadas/)
    assert.ok(r.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'CONFERIR_EIXOS'))
  })

  it('recusa precisão fora do domínio antes de chegar ao banco', async () => {
    const t = await token({ permissoes: [...GESTOR] })

    const r = await chamar(api, 'POST', `/api/v1/locais/${LOCAL_ALFA}/localizacao`, {
      token: t,
      corpo: { lat: -23.5, lon: -46.6, precisao: 'MAIS OU MENOS', fonte: 'palpite' },
    })

    assert.equal(r.status, 400)
    assert.equal(r.corpo.code, 'PAYLOAD_INVALIDO')
  })

  it('recusa origem em branco', async () => {
    const t = await token({ permissoes: [...GESTOR] })

    const r = await chamar(api, 'POST', `/api/v1/locais/${LOCAL_ALFA}/localizacao`, {
      token: t,
      corpo: { lat: -23.5, lon: -46.6, precisao: 'DECLARADA', fonte: '   ' },
    })

    // Origem em branco não conta como origem: uma coordenada sem procedência é
    // uma que ninguém sabe se pode corrigir.
    assert.equal(r.status, 400)
  })

  it('exige a permissão de gerenciar local', async () => {
    const semPermissao = await token({ permissoes: ['cliente:ler'] })

    const r = await chamar(api, 'POST', `/api/v1/locais/${LOCAL_ALFA}/localizacao`, {
      token: semPermissao,
      corpo: { lat: -23.5, lon: -46.6, precisao: 'DECLARADA', fonte: 'cadastro' },
    })

    assert.equal(r.status, 403)
  })

  it('não enxerga nem altera o local de outro tenant', async () => {
    const t = await token({ permissoes: [...GESTOR] })

    // A RLS é quem barra, dentro do banco. O repositório não tem um único
    // `where tenant_id` — e é exatamente por isso que esquecer um não vaza.
    const leitura = await chamar(api, 'GET', '/api/v1/locais', { token: t })
    assert.ok(!leitura.corpo.data.some((l: { id: string }) => l.id === LOCAL_TENANT_B))

    const escrita = await chamar(api, 'POST', `/api/v1/locais/${LOCAL_TENANT_B}/localizacao`, {
      token: t,
      corpo: { lat: -23.5, lon: -46.6, precisao: 'DECLARADA', fonte: 'cadastro' },
    })
    assert.equal(escrita.status, 404)

    // E o dono continua enxergando o próprio.
    const dono = await token({ tenant: TENANT_B, usuario: USUARIO_B, permissoes: [...GESTOR] })
    const r = await chamar(api, 'GET', '/api/v1/locais', { token: dono })
    assert.ok(r.corpo.data.some((l: { id: string }) => l.id === LOCAL_TENANT_B))
  })
})
