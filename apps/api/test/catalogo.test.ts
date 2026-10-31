import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chamar, subirApi, token, TENANT_A, TENANT_B, USUARIO_A, type Servidor } from './apoio.js'

/**
 * Catálogo — o vocabulário do parque.
 *
 * Duas coisas a provar, e a segunda é a que importa de verdade.
 *
 * A primeira: a resposta é coerente consigo mesma. Todo modelo aponta para um
 * fabricante e uma categoria que estão na mesma resposta — senão a interface
 * desenha um `<select>` com rótulo vazio e ninguém entende por quê.
 *
 * A segunda: **o catálogo também é dado de locatário.** É fácil tratar
 * referência como se fosse global — "é só uma lista de fabricantes" — e abrir
 * um vazamento que não parece um vazamento. A lista de modelos de um
 * concorrente diz o que ele opera.
 */

let api: Servidor

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('catálogo', () => {
  it('devolve as quatro listas, coerentes entre si', async () => {
    const r = await chamar(api, 'GET', '/api/v1/catalogo', {
      token: await token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['equipamento:ler'] }),
    })

    assert.equal(r.status, 200)
    const c = r.corpo.data
    assert.ok(c.modelos.length > 0, 'massa semeada tem modelo')

    const fabricantes = new Set(c.fabricantes.map((f: { id: string }) => f.id))
    const categorias = new Set(c.categorias.map((x: { id: string }) => x.id))

    for (const m of c.modelos) {
      assert.ok(
        fabricantes.has(m.fabricante_id),
        `modelo ${m.nome} aponta para fabricante fora da resposta`,
      )
      assert.ok(
        categorias.has(m.categoria_id),
        `modelo ${m.nome} aponta para categoria fora da resposta`,
      )
    }
  })

  it('o catálogo do outro locatário não aparece', async () => {
    const a = await chamar(api, 'GET', '/api/v1/catalogo', {
      token: await token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['equipamento:ler'] }),
    })
    const b = await chamar(api, 'GET', '/api/v1/catalogo', {
      token: await token({ tenant: TENANT_B, usuario: USUARIO_A, permissoes: ['equipamento:ler'] }),
    })

    const idsA = new Set(a.corpo.data.modelos.map((m: { id: string }) => m.id))
    const vazou = b.corpo.data.modelos.filter((m: { id: string }) => idsA.has(m.id))

    assert.deepEqual(vazou, [], 'modelo do tenant A visível para o tenant B')
  })

  it('sem permissão de ler equipamento, não há catálogo', async () => {
    const r = await chamar(api, 'GET', '/api/v1/catalogo', {
      token: await token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['cliente:ler'] }),
    })
    assert.equal(r.status, 403)
  })
})
