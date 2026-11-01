import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chamar, subirApi, token, TENANT_A, USUARIO_A, type Servidor } from './apoio.js'

/**
 * Memória de cálculo da cobrança.
 *
 * O caso que carrega o módulo é a **conferência entre a soma e o total**. A
 * resposta devolve os dois juntos de propósito: se um dia divergirem, quem lê
 * vê a divergência em vez de confiar num total que a composição não sustenta.
 *
 * Não é zelo. A memória existe para o cliente que contesta, e uma memória que
 * não fecha com a cobrança transforma a conversa sobre o valor numa conversa
 * sobre qual dos dois números do fornecedor está errado.
 */

let api: Servidor

const ler = () => token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['receber:ler'] })

async function algumTitulo(tk: string): Promise<string | null> {
  const r = await chamar(api, 'GET', '/api/v1/contas-receber?limit=5', { token: tk })
  assert.equal(r.status, 200)
  return r.corpo.data[0]?.id ?? null
}

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('memória', () => {
  it('a soma das linhas confere com o total do título', async () => {
    const tk = await ler()
    const id = await algumTitulo(tk)
    if (!id) return // massa sem título: nada a conferir

    const r = await chamar(api, 'GET', `/api/v1/contas-receber/${id}/memoria`, { token: tk })
    assert.equal(r.status, 200)

    const m = r.corpo.data
    assert.equal(m.titulo_id, id)
    assert.ok(Array.isArray(m.itens))

    /*
     * Quando há linhas, elas somam o total. Quando não há — título avulso,
     * criado à mão — a soma é zero e o total não, e isso **não** é erro: a
     * memória só existe para cobrança gerada por fechamento.
     */
    if (m.itens.length > 0) {
      assert.equal(
        Number(m.soma_itens).toFixed(2),
        Number(m.valor_titulo).toFixed(2),
        'a composição não soma o valor cobrado',
      )
    }
  })

  it('os valores atravessam como decimal em texto', async () => {
    const tk = await ler()
    const id = await algumTitulo(tk)
    if (!id) return

    const r = await chamar(api, 'GET', `/api/v1/contas-receber/${id}/memoria`, { token: tk })
    assert.equal(typeof r.corpo.data.soma_itens, 'string')
    assert.equal(typeof r.corpo.data.valor_titulo, 'string')
    for (const i of r.corpo.data.itens) {
      assert.equal(typeof i.valor_liquido, 'string')
      // Página não tem fração: contador é inteiro.
      assert.ok(Number.isInteger(i.paginas_mono))
      assert.ok(Number.isInteger(i.excedente_mono))
    }
  })

  it('título inexistente não encontra memória', async () => {
    const r = await chamar(
      api,
      'GET',
      '/api/v1/contas-receber/11111111-1111-4111-8111-999999999999/memoria',
      { token: await ler() },
    )
    assert.equal(r.status, 404)
  })

  it('sem permissão de ler cobrança, não há memória', async () => {
    const tk = await ler()
    const id = await algumTitulo(tk)
    if (!id) return

    const r = await chamar(api, 'GET', `/api/v1/contas-receber/${id}/memoria`, {
      token: await token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['contrato:ler'] }),
    })
    assert.equal(r.status, 403)
  })
})
