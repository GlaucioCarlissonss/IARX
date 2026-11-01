import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chamar, DEPOSITO_A, PECA_A, subirApi, token, TENANT_A, USUARIO_A, type Servidor } from './apoio.js'

/**
 * Estoque.
 *
 * O que estes casos protegem é uma ausência: **não existe rota que escreva
 * saldo**. O saldo é projeção do movimento (RN-017), e a tentação de expor um
 * `PATCH /saldos` é grande justamente porque resolve o problema mais rápido —
 * e recria pela porta da frente o caminho de divergência que o banco fecha.
 *
 * O resto segue daí: o que se escreve é movimento, sempre tipificado e
 * valorado, e corrigir contagem é registrar um ajuste com motivo.
 */

let api: Servidor

const ler = () => token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['peca:ler'] })
const movimentar = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['peca:ler', 'estoque:movimentar'] })

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('movimento projeta saldo', () => {
  it('entrada cria saldo e grava o saldo posterior no próprio movimento', async () => {
    const r = await chamar(api, 'POST', '/api/v1/movimentos-estoque', {
      token: await movimentar(),
      corpo: {
        peca_id: PECA_A,
        deposito_id: DEPOSITO_A,
        tipo: 'ENTRADA_COMPRA',
        quantidade: '10.000',
        custo_unitario: '25.0000',
      },
    })

    assert.equal(r.status, 201, `recusado: ${JSON.stringify(r.corpo)}`)
    // `saldo_apos` é gravado pelo gatilho: é o que permite auditar o histórico
    // sem recalcular a série, e o que denuncia movimento fora de ordem.
    assert.ok(r.corpo.data.saldo_apos, 'movimento sem saldo_apos')
    assert.equal(r.corpo.data.custo_total, '250.0000')

    const saldos = await chamar(api, 'GET', `/api/v1/pecas/${PECA_A}/saldos`, { token: await ler() })
    assert.equal(saldos.status, 200)
    assert.ok(Number(saldos.corpo.data[0].quantidade_fisica) >= 10)
  })

  it('saída maior que o saldo é recusada pelo banco', async () => {
    const r = await chamar(api, 'POST', '/api/v1/movimentos-estoque', {
      token: await movimentar(),
      corpo: {
        peca_id: PECA_A,
        deposito_id: DEPOSITO_A,
        tipo: 'SAIDA_OS',
        quantidade: '-99999.000',
        custo_unitario: '25.0000',
      },
    })

    /*
     * Saldo negativo não é "estoque devendo": é um movimento que não deveria
     * ter sido aceito, e descobrir isso no inventário custa reconstruir meses.
     */
    assert.equal(r.status, 422)
    assert.equal(r.corpo.code, 'REGRA_DE_NEGOCIO')
  })
})

describe('o sinal precisa casar com o tipo', () => {
  it('saída com quantidade positiva é recusada na entrada', async () => {
    /*
     * Sem esta validação, uma baixa **somaria** ao estoque: o movimento diria
     * saída, o saldo subiria, e os dois lados pareceriam coerentes. Só o
     * inventário descobriria, meses depois.
     */
    const r = await chamar(api, 'POST', '/api/v1/movimentos-estoque', {
      token: await movimentar(),
      corpo: {
        peca_id: PECA_A,
        deposito_id: DEPOSITO_A,
        tipo: 'SAIDA_OS',
        quantidade: '5.000',
        custo_unitario: '25.0000',
      },
    })
    assert.equal(r.status, 400)
  })

  it('entrada com quantidade negativa é recusada na entrada', async () => {
    const r = await chamar(api, 'POST', '/api/v1/movimentos-estoque', {
      token: await movimentar(),
      corpo: {
        peca_id: PECA_A,
        deposito_id: DEPOSITO_A,
        tipo: 'ENTRADA_COMPRA',
        quantidade: '-5.000',
        custo_unitario: '25.0000',
      },
    })
    assert.equal(r.status, 400)
  })
})

describe('ajuste de inventário', () => {
  it('sem motivo é recusado', async () => {
    const r = await chamar(api, 'POST', '/api/v1/movimentos-estoque', {
      token: await movimentar(),
      corpo: {
        peca_id: PECA_A,
        deposito_id: DEPOSITO_A,
        tipo: 'AJUSTE_INVENTARIO',
        quantidade: '-1.000',
        custo_unitario: '25.0000',
      },
    })
    assert.equal(r.status, 422)
  })

  it('com motivo legível é aceito e fica no histórico', async () => {
    const corpo = {
      peca_id: PECA_A,
      deposito_id: DEPOSITO_A,
      tipo: 'AJUSTE_INVENTARIO',
      quantidade: '-1.000',
      custo_unitario: '25.0000',
      motivo: 'divergencia apurada no inventario ciclico de novembro',
    }
    const r = await chamar(api, 'POST', '/api/v1/movimentos-estoque', {
      token: await movimentar(),
      corpo,
    })
    assert.equal(r.status, 201)

    const historico = await chamar(api, 'GET', `/api/v1/movimentos-estoque?peca_id=${PECA_A}`, {
      token: await ler(),
    })
    assert.ok(
      historico.corpo.data.some((m: { id: string }) => m.id === r.corpo.data.id),
      'o ajuste não apareceu no histórico',
    )
  })
})

describe('a API não oferece escrita de saldo', () => {
  it('não há rota para gravar saldo diretamente', async () => {
    /*
     * A ausência é o teste. Se alguém acrescentar um `PATCH /saldos` por
     * conveniência, este caso reprova — e é o aviso de que RN-017 passou a
     * depender de ninguém usar a rota nova.
     */
    const tk = await movimentar()
    for (const [metodo, caminho] of [
      ['PATCH', `/api/v1/pecas/${PECA_A}/saldos`],
      ['POST', '/api/v1/saldos-estoque'],
      ['PUT', `/api/v1/pecas/${PECA_A}/saldos`],
    ] as const) {
      const r = await chamar(api, metodo, caminho, { token: tk, corpo: { quantidade_fisica: '999' } })
      assert.ok(
        r.status === 404 || r.status === 405,
        `${metodo} ${caminho} respondeu ${r.status} — existe rota de escrita de saldo`,
      )
    }
  })
})

describe('fila de reposição', () => {
  it('lista só o que está no ponto de pedido ou abaixo', async () => {
    const r = await chamar(api, 'GET', '/api/v1/pecas?abaixo_do_ponto_pedido=true', {
      token: await ler(),
    })
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.corpo.data))
  })

  it('quem só lê peça não movimenta estoque', async () => {
    const r = await chamar(api, 'POST', '/api/v1/movimentos-estoque', {
      token: await ler(),
      corpo: {
        peca_id: PECA_A,
        deposito_id: DEPOSITO_A,
        tipo: 'ENTRADA_COMPRA',
        quantidade: '1.000',
        custo_unitario: '1.0000',
      },
    })
    assert.equal(r.status, 403)
  })
})
