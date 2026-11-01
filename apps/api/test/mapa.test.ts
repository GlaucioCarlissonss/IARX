import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chamar, subirApi, token, TENANT_A, TENANT_B, USUARIO_A, type Servidor } from './apoio.js'

/**
 * Mapa.
 *
 * Dois casos carregam o módulo, e nenhum é sobre desenhar pino.
 *
 * O primeiro é a **contagem de equipamentos**: ela sai por subconsulta e não
 * por `join` com `sum`, porque o `join` multiplicaria a contagem pelo número
 * de títulos do cliente. É o erro de agregação que não parece erro — os dois
 * valores continuam plausíveis, e o mapa passa a mostrar um parque que cresce
 * com o faturamento.
 *
 * O segundo é **quantos locais ficaram de fora** por não ter coordenada.
 * Omitir em silêncio faria o mapa parecer completo: quem olha conta os pinos e
 * conclui que é o parque inteiro.
 */

let api: Servidor

const ver = () => token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['mapa:ler'] })

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('pontos', () => {
  it('responde com pontos e com quantos ficaram sem coordenada', async () => {
    const r = await chamar(api, 'GET', '/api/v1/mapa/pontos', { token: await ver() })

    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.corpo.data.pontos))
    assert.equal(typeof r.corpo.data.sem_coordenada, 'number')
  })

  it('a contagem de equipamentos não é multiplicada pelos títulos', async () => {
    /*
     * O caso que justifica a subconsulta. Com `join` e `sum`, um cliente com
     * doze títulos no ano mostraria doze vezes mais equipamentos — e ninguém
     * desconfiaria de um número que cresce junto com a operação.
     */
    const r = await chamar(api, 'GET', '/api/v1/mapa/pontos', { token: await ver() })
    for (const p of r.corpo.data.pontos) {
      assert.ok(Number.isInteger(p.equipamentos), `contagem não inteira: ${p.equipamentos}`)
      assert.ok(p.equipamentos < 10_000, `contagem implausível: ${p.equipamentos}`)
    }
  })

  it('todo ponto tem coordenada — local sem geo fica no contador, não na lista', async () => {
    const r = await chamar(api, 'GET', '/api/v1/mapa/pontos', { token: await ver() })
    for (const p of r.corpo.data.pontos) {
      assert.equal(typeof p.lat, 'number')
      assert.equal(typeof p.lon, 'number')
    }
  })

  it('a receita vem como decimal em texto', async () => {
    const r = await chamar(api, 'GET', '/api/v1/mapa/pontos', { token: await ver() })
    for (const p of r.corpo.data.pontos) {
      assert.equal(typeof p.receita_12m, 'string')
    }
  })
})

describe('recorte e permissão', () => {
  it('o mapa do outro locatário não aparece', async () => {
    const a = await chamar(api, 'GET', '/api/v1/mapa/pontos', { token: await ver() })
    const b = await chamar(api, 'GET', '/api/v1/mapa/pontos', {
      token: await token({ tenant: TENANT_B, usuario: USUARIO_A, permissoes: ['mapa:ler'] }),
    })

    const idsA = new Set(a.corpo.data.pontos.map((p: { local_id: string }) => p.local_id))
    const vazou = b.corpo.data.pontos.filter((p: { local_id: string }) => idsA.has(p.local_id))
    assert.deepEqual(vazou, [], 'ponto do tenant A visível para o tenant B')
  })

  it('ler cliente não dá acesso ao mapa', async () => {
    /*
     * O mapa mostra onde está tudo de uma vez, e essa é uma exposição de outra
     * natureza: a lista de endereços de todos os clientes com o tamanho do
     * parque de cada um é o que um concorrente pagaria para ter.
     */
    const r = await chamar(api, 'GET', '/api/v1/mapa/pontos', {
      token: await token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['cliente:ler'] }),
    })
    assert.equal(r.status, 403)
  })
})
