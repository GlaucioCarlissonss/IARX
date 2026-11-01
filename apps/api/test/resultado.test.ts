import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chamar, subirApi, token, TENANT_A, TENANT_B, USUARIO_A, type Servidor } from './apoio.js'

/**
 * Resultado operacional.
 *
 * O caso que carrega o módulo é a **agregação por cliente**. Receita e custo
 * vêm de subconsultas laterais e não de um `join`: um cliente com doze títulos
 * e três ordens de serviço geraria trinta e seis linhas, e os dois números
 * sairiam multiplicados. É o mesmo erro do mapa, e é difícil de notar pela
 * mesma razão — receita e custo continuam plausíveis, só que ambos inflados.
 *
 * O segundo é a **série completa**: toda competência da janela aparece, mesmo
 * as sem movimento. Série com buraco faz o gráfico ligar março a maio numa
 * reta e sugerir uma tendência que não existe.
 */

let api: Servidor

const ver = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['financeiro:rentabilidade_ler'] })

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('série por competência', () => {
  it('traz uma linha por mês da janela, sem buraco', async () => {
    const r = await chamar(api, 'GET', '/api/v1/resultado?meses=6', { token: await ver() })

    assert.equal(r.status, 200, `recusado: ${JSON.stringify(r.corpo)}`)
    assert.equal(r.corpo.data.serie.length, 6, 'a janela precisa vir completa')

    /*
     * Série com buraco faz o gráfico ligar março a maio numa reta e sugerir
     * uma tendência que não existe. Competência sem movimento vale zero, e
     * zero é informação.
     */
    const meses = r.corpo.data.serie.map((l: { competencia: string }) => l.competencia)
    assert.deepEqual([...meses].sort(), meses, 'a série precisa vir ordenada')
    assert.equal(new Set(meses).size, meses.length, 'competência repetida na série')
  })

  it('margem é receita menos custo, conferido linha a linha', async () => {
    const r = await chamar(api, 'GET', '/api/v1/resultado?meses=12', { token: await ver() })

    for (const l of r.corpo.data.serie) {
      const esperado = Number(l.receita) - Number(l.custo_total)
      assert.ok(
        Math.abs(Number(l.margem) - esperado) < 0.01,
        `margem ${l.margem} não bate com ${l.receita} - ${l.custo_total} em ${l.competencia}`,
      )
    }
  })

  it('os valores atravessam como decimal em texto', async () => {
    const r = await chamar(api, 'GET', '/api/v1/resultado?meses=3', { token: await ver() })
    for (const l of r.corpo.data.serie) {
      for (const campo of ['receita', 'custo_mao_obra', 'custo_material', 'custo_total', 'margem']) {
        assert.equal(typeof l[campo], 'string', `${campo} veio como número`)
      }
    }
  })
})

describe('por cliente', () => {
  it('vem ordenado pela pior margem — é a ordem em que é útil', async () => {
    /*
     * Ninguém abre este relatório para ver quem está bem.
     */
    const r = await chamar(api, 'GET', '/api/v1/resultado', { token: await ver() })
    const margens = r.corpo.data.por_cliente.map((c: { margem: string }) => Number(c.margem))
    const ordenado = [...margens].sort((a, b) => a - b)
    assert.deepEqual(margens, ordenado, 'a lista por cliente não veio da pior para a melhor')
  })

  it('a agregação não multiplica receita por custo', async () => {
    const r = await chamar(api, 'GET', '/api/v1/resultado', { token: await ver() })
    for (const c of r.corpo.data.por_cliente) {
      const esperado = Number(c.receita) - Number(c.custo_total)
      assert.ok(
        Math.abs(Number(c.margem) - esperado) < 0.01,
        `margem de ${c.cliente_nome} não bate com receita menos custo`,
      )
    }
  })
})

describe('recorte e permissão', () => {
  it('o resultado do outro locatário não aparece', async () => {
    const a = await chamar(api, 'GET', '/api/v1/resultado', { token: await ver() })
    const b = await chamar(api, 'GET', '/api/v1/resultado', {
      token: await token({
        tenant: TENANT_B,
        usuario: USUARIO_A,
        permissoes: ['financeiro:rentabilidade_ler'],
      }),
    })

    const idsA = new Set(a.corpo.data.por_cliente.map((c: { cliente_id: string }) => c.cliente_id))
    const vazou = b.corpo.data.por_cliente.filter((c: { cliente_id: string }) => idsA.has(c.cliente_id))
    assert.deepEqual(vazou, [], 'cliente do tenant A apareceu no resultado do B')
  })

  it('o painel executivo não dá acesso à margem por cliente', async () => {
    /*
     * O painel mostra totais; a rentabilidade mostra **quais clientes dão
     * prejuízo**. É a informação mais sensível desta base, tanto para negociar
     * quanto para levar embora — e por isso tem permissão própria.
     */
    const r = await chamar(api, 'GET', '/api/v1/resultado', {
      token: await token({
        tenant: TENANT_A,
        usuario: USUARIO_A,
        permissoes: ['financeiro:painel_executivo'],
      }),
    })
    assert.equal(r.status, 403)
  })
})
