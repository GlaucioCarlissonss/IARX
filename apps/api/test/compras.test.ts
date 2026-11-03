import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  chamar,
  chaveIdempotencia,
  consultarBanco,
  DEPOSITO_A,
  FORNECEDOR_A,
  PECA_A,
  subirApi,
  TENANT_A,
  token,
  USUARIO_A,
  type Servidor,
} from './apoio.js'

/**
 * Ordem de compra e inventário.
 *
 * As duas máquinas e os efeitos de estoque são provados no banco, em
 * `28_est_compra_e_inventario.sql`. Aqui se prova o que só existe na API:
 *
 *  · as três permissões da compra são três rotas. Com um `PATCH status`, quem
 *    cria a ordem a aprova e a recebe sozinho — e a alçada de compra, único
 *    controle sobre quanto se gasta, seria exercida por quem gasta;
 *  · quem conta o inventário não aprova a própria contagem;
 *  · o recebimento manda quantidade **acumulada**, e reenviar o mesmo corpo
 *    não dobra o estoque;
 *  · o saldo do sistema é congelado pelo servidor, não declarado pelo cliente.
 */

let api: Servidor

const comprador = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['ordem_compra:criar'] })
const aprovador = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['ordem_compra:criar', 'ordem_compra:aprovar'] })
const recebedor = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['ordem_compra:criar', 'ordem_compra:receber'] })

const contador = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['inventario:executar'] })
const aprovadorInv = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['inventario:executar', 'inventario:aprovar'] })

async function novaOrdem(tk: string, quantidade = '10', preco = '40.0000'): Promise<string> {
  const r = await chamar(api, 'POST', '/api/v1/ordens-compra', {
    token: tk,
    cabecalhos: { 'Idempotency-Key': chaveIdempotencia('oc') },
    corpo: {
      fornecedor_id: FORNECEDOR_A,
      deposito_id: DEPOSITO_A,
      itens: [{ peca_id: PECA_A, quantidade_pedida: quantidade, preco_unitario: preco }],
    },
  })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  return r.corpo.data.id
}

async function saldoFisico(): Promise<number> {
  const l = await consultarBanco<{ q: string }>(
    TENANT_A,
    `select coalesce(quantidade_fisica, 0)::text as q from public.saldo_estoque
      where peca_id = $1 and deposito_id = $2`,
    [PECA_A, DEPOSITO_A],
  )
  return Number(l[0]?.q ?? '0')
}

before(async () => {
  api = await subirApi()
})
after(async () => {
  await api.fechar()
})

describe('ordem de compra', () => {
  it('criar não aprova: são permissões diferentes', async () => {
    const tk = await comprador()
    const id = await novaOrdem(tk)

    const r = await chamar(api, 'POST', `/api/v1/ordens-compra/${id}/aprovar`, { token: tk })
    /*
     * A alçada de compra é o único controle sobre quanto se gasta. Com criar e
     * aprovar na mesma permissão, ela seria exercida por quem gasta.
     */
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
  })

  it('o número é gerado pelo servidor, com o ano', async () => {
    const r = await chamar(api, 'POST', '/api/v1/ordens-compra', {
      token: await comprador(),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('oc') },
      corpo: {
        fornecedor_id: FORNECEDOR_A,
        deposito_id: DEPOSITO_A,
        // `numero` vai no corpo de propósito: tem de ser ignorado.
        numero: 'ESCOLHIDO-PELO-CLIENTE',
        itens: [{ peca_id: PECA_A, quantidade_pedida: '1', preco_unitario: '10.0000' }],
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.corpo))
    assert.match(r.corpo.data.numero, /^\d{4}-\d{5}$/)
  })

  it('ordem não aprovada não recebe mercadoria', async () => {
    const tk = await recebedor()
    const id = await novaOrdem(tk)
    const ordem = await chamar(api, 'GET', `/api/v1/ordens-compra/${id}`, { token: tk })
    const item = ordem.corpo.data.itens[0]

    const r = await chamar(api, 'POST', `/api/v1/ordens-compra/${id}/receber`, {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('receber') },
      corpo: { itens: [{ item_id: item.id, quantidade_recebida: '5' }] },
    })
    // Receber antes de aprovar faria a mercadoria entrar sem que ninguém
    // tivesse autorizado a compra.
    assert.equal(r.status, 422, JSON.stringify(r.corpo))
  })

  it('receber dá entrada no estoque, e reenviar o mesmo corpo não dobra', async () => {
    const tkA = await aprovador()
    const tkR = await recebedor()
    const id = await novaOrdem(tkA)
    await chamar(api, 'POST', `/api/v1/ordens-compra/${id}/aprovar`, { token: tkA })

    const ordem = await chamar(api, 'GET', `/api/v1/ordens-compra/${id}`, { token: tkR })
    const item = ordem.corpo.data.itens[0]
    const antes = await saldoFisico()

    const corpo = { itens: [{ item_id: item.id, quantidade_recebida: '4' }] }
    const um = await chamar(api, 'POST', `/api/v1/ordens-compra/${id}/receber`, {
      token: tkR,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('receber') },
      corpo,
    })
    assert.equal(um.status, 200, JSON.stringify(um.corpo))
    assert.equal(um.corpo.data.status, 'PARCIALMENTE_RECEBIDA')
    assert.equal(await saldoFisico(), antes + 4)

    /*
     * A quantidade é acumulada, não incremento. Com incremento, um reenvio por
     * timeout somaria duas vezes — e estoque inflado por retry é a divergência
     * que ninguém consegue explicar depois.
     */
    const dois = await chamar(api, 'POST', `/api/v1/ordens-compra/${id}/receber`, {
      token: tkR,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('receber') },
      corpo,
    })
    assert.equal(dois.status, 200, JSON.stringify(dois.corpo))
    assert.equal(await saldoFisico(), antes + 4)

    // Completado o pedido, o status deriva dos itens.
    const fim = await chamar(api, 'POST', `/api/v1/ordens-compra/${id}/receber`, {
      token: tkR,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('receber') },
      corpo: { itens: [{ item_id: item.id, quantidade_recebida: '10' }] },
    })
    assert.equal(fim.corpo.data.status, 'RECEBIDA')
    assert.equal(await saldoFisico(), antes + 10)
  })

  it('item de outra ordem não é recebido trocando o id na URL', async () => {
    const tkA = await aprovador()
    const tkR = await recebedor()
    const a = await novaOrdem(tkA)
    const b = await novaOrdem(tkA)
    await chamar(api, 'POST', `/api/v1/ordens-compra/${b}/aprovar`, { token: tkA })

    const ordemA = await chamar(api, 'GET', `/api/v1/ordens-compra/${a}`, { token: tkR })
    const itemDeA = ordemA.corpo.data.itens[0]

    const r = await chamar(api, 'POST', `/api/v1/ordens-compra/${b}/receber`, {
      token: tkR,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('receber') },
      corpo: { itens: [{ item_id: itemDeA.id, quantidade_recebida: '1' }] },
    })
    // Sem a conferência, daria entrada de mercadoria em outra compra, de outro
    // fornecedor.
    assert.equal(r.status, 404, JSON.stringify(r.corpo))
  })
})

describe('inventário', () => {
  it('quem conta não aprova a própria contagem', async () => {
    const tk = await contador()
    const inv = await chamar(api, 'POST', '/api/v1/inventarios', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('inv') },
      corpo: { deposito_id: DEPOSITO_A, tipo: 'CICLICO' },
    })
    assert.equal(inv.status, 201, JSON.stringify(inv.corpo))

    const r = await chamar(api, 'POST', `/api/v1/inventarios/${inv.corpo.data.id}/aprovar`, { token: tk })
    /*
     * Sem a segregação, corrigir o estoque para o número conveniente seria uma
     * operação de uma pessoa só — e o ajuste sairia com a justificativa que
     * ela mesma escreveu.
     */
    assert.equal(r.status, 403, JSON.stringify(r.corpo))

    await chamar(api, 'POST', `/api/v1/inventarios/${inv.corpo.data.id}/cancelar`, {
      token: await aprovadorInv(),
      corpo: { motivo: 'inventario de teste encerrado sem contagem' },
    })
  })

  it('o saldo do sistema é congelado pelo servidor, não declarado pelo cliente', async () => {
    const tk = await aprovadorInv()
    const fisico = await saldoFisico()

    const inv = await chamar(api, 'POST', '/api/v1/inventarios', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('inv') },
      corpo: { deposito_id: DEPOSITO_A, tipo: 'CICLICO' },
    })
    const id = inv.corpo.data.id

    const c = await chamar(api, 'POST', `/api/v1/inventarios/${id}/contagens`, {
      token: tk,
      corpo: {
        peca_id: PECA_A,
        // Vai no corpo de propósito: tem de ser ignorado.
        saldo_sistema: '999',
        saldo_contado: String(fisico),
        justificativa: 'contagem conferida com o saldo do sistema',
      },
    })
    assert.equal(c.status, 200, JSON.stringify(c.corpo))

    const contagem = c.corpo.data.contagens.find((x: { peca_id: string }) => x.peca_id === PECA_A)
    assert.ok(contagem)
    /*
     * Aceitar `saldo_sistema` do cliente permitiria declarar a divergência em
     * vez de medi-la — e o ajuste corrigiria o estoque para o número que quem
     * contou quis.
     */
    assert.equal(Number(contagem.saldo_sistema), fisico)
    assert.equal(Number(contagem.divergencia), 0)

    await chamar(api, 'POST', `/api/v1/inventarios/${id}/cancelar`, {
      token: tk,
      corpo: { motivo: 'inventario de teste encerrado apos conferencia' },
    })
  })

  it('divergência sem justificativa não fecha a contagem', async () => {
    const tk = await aprovadorInv()
    const fisico = await saldoFisico()

    const inv = await chamar(api, 'POST', '/api/v1/inventarios', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('inv') },
      corpo: { deposito_id: DEPOSITO_A, tipo: 'CICLICO' },
    })
    const id = inv.corpo.data.id

    await chamar(api, 'POST', `/api/v1/inventarios/${id}/contagens`, {
      token: tk,
      corpo: { peca_id: PECA_A, saldo_contado: String(Math.max(fisico - 1, 0)) },
    })

    const semMotivo = await chamar(api, 'POST', `/api/v1/inventarios/${id}/fechar`, { token: tk })
    assert.equal(semMotivo.status, 422, JSON.stringify(semMotivo.corpo))

    await chamar(api, 'POST', `/api/v1/inventarios/${id}/contagens`, {
      token: tk,
      corpo: {
        peca_id: PECA_A,
        saldo_contado: String(Math.max(fisico - 1, 0)),
        justificativa: 'uma unidade avariada e descartada no deposito',
      },
    })
    const comMotivo = await chamar(api, 'POST', `/api/v1/inventarios/${id}/fechar`, { token: tk })
    assert.equal(comMotivo.status, 200, JSON.stringify(comMotivo.corpo))

    const aprovado = await chamar(api, 'POST', `/api/v1/inventarios/${id}/aprovar`, { token: tk })
    assert.equal(aprovado.status, 200, JSON.stringify(aprovado.corpo))

    // A aprovação gerou o ajuste e o ligou à contagem.
    const contagem = aprovado.corpo.data.contagens.find((x: { peca_id: string }) => x.peca_id === PECA_A)
    assert.ok(contagem.movimento_ajuste_id, 'a contagem não aponta para o ajuste gerado')
    assert.equal(await saldoFisico(), Math.max(fisico - 1, 0))
  })

  it('dois inventários abertos no mesmo depósito são recusados', async () => {
    const tk = await aprovadorInv()
    const um = await chamar(api, 'POST', '/api/v1/inventarios', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('inv') },
      corpo: { deposito_id: DEPOSITO_A, tipo: 'GERAL' },
    })
    assert.equal(um.status, 201, JSON.stringify(um.corpo))

    const dois = await chamar(api, 'POST', '/api/v1/inventarios', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('inv') },
      corpo: { deposito_id: DEPOSITO_A, tipo: 'CICLICO' },
    })
    /*
     * Dois ao mesmo tempo contam a mesma prateleira e geram dois ajustes para a
     * mesma diferença — o segundo "corrigindo" o saldo que o primeiro corrigiu.
     */
    assert.equal(dois.status, 409, JSON.stringify(dois.corpo))

    await chamar(api, 'POST', `/api/v1/inventarios/${um.corpo.data.id}/cancelar`, {
      token: tk,
      corpo: { motivo: 'inventario de teste encerrado para liberar o deposito' },
    })
  })
})
