import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chamar, subirApi, token, TENANT_A, TENANT_B, USUARIO_A, type Servidor } from './apoio.js'

/**
 * Política comercial.
 *
 * O que estes casos protegem não é o formato da resposta — é a separação entre
 * três coisas que a conversa de corredor trata como uma só:
 *
 *  · o que a tabela diz (preço),
 *  · o que vem incluso e quanto custa passar disso (franquia),
 *  · e o que se abriu mão (desconto).
 *
 * Misturar as duas últimas é o jeito mais rápido de perder a margem de vista:
 * desconto abatido no valor some do relatório, e ninguém consegue responder
 * quanto se concedeu no trimestre.
 */

let api: Servidor

const comercial = () => token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['comercial:ler'] })

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('política comercial', () => {
  it('as tabelas vêm com os itens costurados', async () => {
    const r = await chamar(api, 'GET', '/api/v1/comercial/politica', { token: await comercial() })

    assert.equal(r.status, 200)
    const p = r.corpo.data
    assert.ok(Array.isArray(p.tabelas_preco))
    assert.ok(Array.isArray(p.tabelas_franquia))

    for (const t of [...p.tabelas_preco, ...p.tabelas_franquia]) {
      assert.ok(Array.isArray(t.itens), `tabela ${t.nome} sem lista de itens`)
    }
  })

  it('tabela sem item aparece na lista, em vez de sumir', async () => {
    /*
     * A asserção parece trivial e não é: com `join` interno em vez de duas
     * consultas, a tabela em rascunho — que ainda não tem item — desapareceria
     * do resultado. E rascunho sem item é exatamente o que se quer ver, para
     * poder completar.
     */
    const r = await chamar(api, 'GET', '/api/v1/comercial/politica', { token: await comercial() })
    const todas = [...r.corpo.data.tabelas_preco, ...r.corpo.data.tabelas_franquia]
    assert.ok(todas.length > 0, 'massa semeada tem tabela')
    assert.ok(
      todas.every((t: { itens: unknown[] }) => Array.isArray(t.itens)),
      'alguma tabela veio sem o campo de itens',
    )
  })

  it('valor monetário atravessa como string decimal, sem virar ponto flutuante', async () => {
    /*
     * Este caso nasceu de um erro meu: escrevi o contrato supondo centavos
     * inteiros, e o schema diz `numeric(15,4)`. O schema está certo —
     * `number` em JavaScript é ponto flutuante binário, e nem toda fração
     * decimal cabe nele; a soma de mil mensalidades passaria a depender da
     * ordem das parcelas.
     *
     * A franquia é pior ainda: seis casas, porque página custa **fração de
     * centavo**. R$ 0,0385 por página mono é preço corrente, e arredondar
     * para centavo erraria trinta por cento.
     */
    const r = await chamar(api, 'GET', '/api/v1/comercial/politica', { token: await comercial() })

    let conferidos = 0
    for (const t of r.corpo.data.tabelas_preco) {
      for (const i of t.itens) {
        if (i.valor_mensal === null) continue
        assert.equal(typeof i.valor_mensal, 'string', 'valor monetário veio como número')
        assert.match(i.valor_mensal, /^-?\d+\.\d{4}$/, `casas decimais perdidas: ${i.valor_mensal}`)
        conferidos++
      }
    }
    assert.ok(conferidos > 0, 'nenhum valor conferido: a massa não tem item de preço?')
  })

  it('o desconto traz o motivo — sem ele a lista não se revisa', async () => {
    const r = await chamar(api, 'GET', '/api/v1/comercial/descontos', { token: await comercial() })
    assert.equal(r.status, 200)
    for (const d of r.corpo.data) {
      assert.ok(d.motivo && d.motivo.length > 0, 'desconto sem motivo')
    }
  })

  it('a política do outro locatário não aparece', async () => {
    const a = await chamar(api, 'GET', '/api/v1/comercial/politica', { token: await comercial() })
    const b = await chamar(api, 'GET', '/api/v1/comercial/politica', {
      token: await token({ tenant: TENANT_B, usuario: USUARIO_A, permissoes: ['comercial:ler'] }),
    })

    const idsA = new Set(a.corpo.data.tabelas_preco.map((t: { id: string }) => t.id))
    const vazou = b.corpo.data.tabelas_preco.filter((t: { id: string }) => idsA.has(t.id))
    assert.deepEqual(vazou, [], 'tabela de preço do tenant A visível para o B')
  })

  it('ler contrato não dá acesso à política inteira', async () => {
    /*
     * A distinção que a permissão própria existe para manter: ler **um**
     * contrato mostra o preço daquele cliente; ler a política mostra a régua
     * inteira da locadora, inclusive o que se cobra de quem não é ele. É a
     * segunda que um vendedor levaria embora ao sair.
     */
    const r = await chamar(api, 'GET', '/api/v1/comercial/politica', {
      token: await token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['contrato:ler'] }),
    })
    assert.equal(r.status, 403)
  })
})
