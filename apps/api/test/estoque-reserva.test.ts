import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  APROVADOR_N2,
  chamar,
  chaveIdempotencia,
  consultarBanco,
  DEPOSITO_A,
  EQUIP_LIVRE_2,
  PECA_A,
  subirApi,
  TECNICO_SEM_LOGIN,
  token,
  TENANT_A,
  USUARIO_A,
  type Servidor,
} from './apoio.js'

/**
 * Reserva de peça na OS (Anexo B.5), ajuste de inventário e política de
 * reposição.
 *
 * A máquina e os efeitos no saldo são provados no banco, em
 * `27_est_reserva_de_peca.sql`. Aqui se prova o que só existe na API:
 *
 *  · o ajuste de inventário tem rota e permissão próprias, e a rota genérica
 *    de movimento **recusa** o tipo. Sem essa recusa, `estoque:ajustar`
 *    existiria no catálogo sem significar nada — quem pudesse movimentar
 *    ajustaria, que é a distinção que o Anexo C faz;
 *  · a peça é endereçada pelo caminho da ordem: trocar o id na URL não
 *    consome a reserva de outra OS;
 *  · a política de reposição é `PUT`, e definir duas vezes deixa uma.
 */

let api: Servidor

const ALMOX = () =>
  token({
    tenant: TENANT_A,
    usuario: USUARIO_A,
    permissoes: ['peca:ler', 'os:ler', 'estoque:movimentar', 'estoque:reservar'],
  })

const comTudoDeOs = () =>
  token({
    tenant: TENANT_A,
    usuario: USUARIO_A,
    permissoes: [
      'os:ler', 'os:criar', 'os:triar', 'os:agendar', 'os:executar', 'os:concluir',
      'estoque:reservar', 'estoque:movimentar', 'peca:ler',
    ],
  })

async function abrirOs(tk: string): Promise<string> {
  const r = await chamar(api, 'POST', '/api/v1/ordens-servico', {
    token: tk,
    corpo: {
      equipamento_id: EQUIP_LIVRE_2,
      descricao: 'falha de fusao com marcas de toner na folha impressa',
    },
  })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  return r.corpo.data.id
}

/** Entrada para haver o que reservar; a massa nasce com saldo zero de propósito. */
async function abastecer(qtd: string, custo = '150.0000') {
  const r = await chamar(api, 'POST', '/api/v1/movimentos-estoque', {
    token: await ALMOX(),
    corpo: {
      peca_id: PECA_A,
      deposito_id: DEPOSITO_A,
      tipo: 'ENTRADA_COMPRA',
      quantidade: qtd,
      custo_unitario: custo,
    },
  })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
}

before(async () => {
  api = await subirApi()
})
after(async () => {
  await api.fechar()
})

describe('reserva de peça na ordem de serviço', () => {
  it('pedir, reservar e consumir leva o custo para a ordem', async () => {
    const tk = await comTudoDeOs()
    await abastecer('10')
    const os = await abrirOs(tk)

    const pedido = await chamar(api, 'POST', `/api/v1/ordens-servico/${os}/pecas`, {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('peca') },
      corpo: { peca_id: PECA_A, deposito_id: DEPOSITO_A, quantidade: '2' },
    })
    assert.equal(pedido.status, 201, JSON.stringify(pedido.corpo))
    const item = pedido.corpo.data.find((p: { status: string }) => p.status === 'SOLICITADA')
    assert.ok(item, 'a peça não nasceu solicitada')

    const reservada = await chamar(
      api, 'POST', `/api/v1/ordens-servico/${os}/pecas/${item.id}/reservar`, { token: tk },
    )
    assert.equal(reservada.status, 200, JSON.stringify(reservada.corpo))

    /*
     * O custo médio é lido **antes** da baixa, e não fixado no teste.
     *
     * A suíte da API semeia sem recriar o banco, e outros arquivos dão entrada
     * na mesma peça a preços diferentes. Um valor constante aqui estaria
     * provando que nenhum outro teste mexeu no estoque — não que a baixa usa o
     * custo médio do instante, que é o que RN-017 exige.
     */
    const antes = await consultarBanco<{ medio: string }>(
      TENANT_A,
      `select round(valor_total / nullif(quantidade_fisica, 0), 4)::text as medio
         from public.saldo_estoque where peca_id = $1 and deposito_id = $2`,
      [PECA_A, DEPOSITO_A],
    )
    const medio = antes[0]!.medio

    const consumida = await chamar(
      api, 'POST', `/api/v1/ordens-servico/${os}/pecas/${item.id}/consumir`,
      { token: tk, cabecalhos: { 'Idempotency-Key': chaveIdempotencia('consumir') } },
    )
    assert.equal(consumida.status, 200, JSON.stringify(consumida.corpo))

    const baixada = consumida.corpo.data.find((p: { id: string }) => p.id === item.id)
    assert.equal(baixada.custo_unitario_baixa, medio)

    const linha = await consultarBanco<{ custo_material: string }>(
      TENANT_A,
      `select custo_material::text as custo_material from public.ordem_servico where id = $1`,
      [os],
    )
    /*
     * O elo que faltava: sem ele a peça sai do estoque e some. O custo de
     * material fica zero, a margem do ativo fica melhor do que é, e a
     * diferença só aparece no inventário.
     */
    assert.equal(Number(linha[0]!.custo_material), Number(medio) * 2)
  })

  it('RN-015: não conclui com peça sem destino', async () => {
    const tk = await comTudoDeOs()
    await abastecer('10')
    const os = await abrirOs(tk)

    const pedido = await chamar(api, 'POST', `/api/v1/ordens-servico/${os}/pecas`, {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('peca') },
      corpo: { peca_id: PECA_A, deposito_id: DEPOSITO_A, quantidade: '1' },
    })
    const item = pedido.corpo.data[pedido.corpo.data.length - 1]
    await chamar(api, 'POST', `/api/v1/ordens-servico/${os}/pecas/${item.id}/reservar`, { token: tk })

    for (const [acao, corpo] of [
      ['triar', { tipo: 'CORRETIVA', prioridade: 'MEDIA' }],
      ['agendar', { tecnico_id: TECNICO_SEM_LOGIN }],
      ['iniciar', undefined],
    ] as [string, unknown][]) {
      await chamar(api, 'POST', `/api/v1/ordens-servico/${os}/${acao}`, { token: tk, corpo })
    }

    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os}/concluir`, {
      token: tk,
      corpo: {
        causa_raiz: 'desgaste do conjunto de fusao apos fim de vida util',
        solucao: 'substituicao do conjunto de fusao',
        causa_responsabilidade: 'DESGASTE_NATURAL',
      },
    })
    assert.equal(r.status, 422, JSON.stringify(r.corpo))
    assert.ok(Array.isArray(r.corpo.acoes_sugeridas) && r.corpo.acoes_sugeridas.length > 0)

    // Devolvida a peça, a conclusão passa.
    await chamar(api, 'POST', `/api/v1/ordens-servico/${os}/pecas/${item.id}/devolver`, { token: tk })
    const ok = await chamar(api, 'POST', `/api/v1/ordens-servico/${os}/concluir`, {
      token: tk,
      corpo: {
        causa_raiz: 'desgaste do conjunto de fusao apos fim de vida util',
        solucao: 'limpeza e recalibragem, sem troca de peca',
        causa_responsabilidade: 'DESGASTE_NATURAL',
      },
    })
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo))
  })

  it('peça de outra ordem não é consumida trocando o id na URL', async () => {
    const tk = await comTudoDeOs()
    await abastecer('10')
    const osA = await abrirOs(tk)
    const osB = await abrirOs(tk)

    const pedido = await chamar(api, 'POST', `/api/v1/ordens-servico/${osA}/pecas`, {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('peca') },
      corpo: { peca_id: PECA_A, deposito_id: DEPOSITO_A, quantidade: '1' },
    })
    const item = pedido.corpo.data[pedido.corpo.data.length - 1]

    const r = await chamar(
      api, 'POST', `/api/v1/ordens-servico/${osB}/pecas/${item.id}/reservar`, { token: tk },
    )
    // Sem a conferência, o custo iria para a ordem errada e a reserva de uma
    // OS seria consumida por outra.
    assert.equal(r.status, 404, JSON.stringify(r.corpo))
  })
})

describe('ajuste de inventário', () => {
  it('a rota genérica de movimento recusa o ajuste e aponta a certa', async () => {
    const r = await chamar(api, 'POST', '/api/v1/movimentos-estoque', {
      token: await ALMOX(),
      corpo: {
        peca_id: PECA_A,
        deposito_id: DEPOSITO_A,
        tipo: 'AJUSTE_INVENTARIO',
        quantidade: '-1',
        custo_unitario: '150.0000',
        motivo: 'diferenca apurada na contagem de outubro',
      },
    })
    /*
     * É esta recusa que faz `estoque:ajustar` significar alguma coisa. Sem
     * ela, a permissão existiria no catálogo e qualquer um com
     * `estoque:movimentar` declararia que a contagem estava errada.
     */
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
    assert.ok(Array.isArray(r.corpo.acoes_sugeridas) && r.corpo.acoes_sugeridas.length > 0)
  })

  it('a rota própria exige a permissão própria', async () => {
    const r = await chamar(api, 'POST', '/api/v1/estoque/ajustes', {
      token: await ALMOX(),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('ajuste') },
      corpo: {
        peca_id: PECA_A,
        deposito_id: DEPOSITO_A,
        quantidade: '-1',
        custo_unitario: '150.0000',
        motivo: 'diferenca apurada na contagem de outubro',
      },
    })
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
  })

  it('com a permissão, ajusta e o movimento nasce como AJUSTE_INVENTARIO', async () => {
    await abastecer('5')
    const tk = await token({
      tenant: TENANT_A,
      usuario: APROVADOR_N2,
      permissoes: ['peca:ler', 'estoque:ajustar'],
    })

    const r = await chamar(api, 'POST', '/api/v1/estoque/ajustes', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('ajuste') },
      corpo: {
        peca_id: PECA_A,
        deposito_id: DEPOSITO_A,
        quantidade: '-1',
        custo_unitario: '150.0000',
        motivo: 'uma unidade avariada no transporte interno',
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.corpo))
    // O tipo não vem do corpo: é da rota. Aceitá-lo faria esta permissão
    // restrita registrar qualquer movimento.
    assert.equal(r.corpo.data.tipo, 'AJUSTE_INVENTARIO')
  })

  it('motivo curto é recusado apontando o campo', async () => {
    const tk = await token({
      tenant: TENANT_A,
      usuario: APROVADOR_N2,
      permissoes: ['peca:ler', 'estoque:ajustar'],
    })
    const r = await chamar(api, 'POST', '/api/v1/estoque/ajustes', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('ajuste') },
      corpo: {
        peca_id: PECA_A,
        deposito_id: DEPOSITO_A,
        quantidade: '-1',
        custo_unitario: '150.0000',
        motivo: 'sumiu',
      },
    })
    assert.equal(r.status, 400, JSON.stringify(r.corpo))
    assert.equal(r.corpo.errors[0].field, 'motivo')
  })
})

describe('política de reposição', () => {
  it('definir duas vezes deixa uma, e a segunda vence', async () => {
    const tk = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['peca:ler', 'estoque:politica_definir'],
    })

    const corpo = {
      peca_id: PECA_A,
      deposito_id: DEPOSITO_A,
      estoque_minimo: '2',
      ponto_pedido: '4',
      lead_time_dias: 7,
    }
    const um = await chamar(api, 'PUT', '/api/v1/estoque/politicas', { token: tk, corpo })
    assert.equal(um.status, 200, JSON.stringify(um.corpo))

    const dois = await chamar(api, 'PUT', '/api/v1/estoque/politicas', {
      token: tk,
      corpo: { ...corpo, ponto_pedido: '9', lead_time_dias: 14 },
    })
    assert.equal(dois.status, 200, JSON.stringify(dois.corpo))

    // A política é atributo do par (peça, depósito), não evento.
    const doPar = dois.corpo.data.filter(
      (p: { peca_id: string; deposito_id: string }) =>
        p.peca_id === PECA_A && p.deposito_id === DEPOSITO_A,
    )
    assert.equal(doPar.length, 1)
    assert.equal(doPar[0].ponto_pedido, '9.000')
    assert.equal(doPar[0].lead_time_dias, 14)
  })

  it('máximo abaixo do mínimo é recusado', async () => {
    const tk = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['peca:ler', 'estoque:politica_definir'],
    })
    const r = await chamar(api, 'PUT', '/api/v1/estoque/politicas', {
      token: tk,
      corpo: {
        peca_id: PECA_A,
        deposito_id: DEPOSITO_A,
        estoque_minimo: '10',
        estoque_maximo: '5',
        ponto_pedido: '12',
      },
    })
    assert.equal(r.status, 400, JSON.stringify(r.corpo))
  })

  it('definir política é permissão própria, separada de ler peça', async () => {
    const r = await chamar(api, 'PUT', '/api/v1/estoque/politicas', {
      token: await ALMOX(),
      corpo: { peca_id: PECA_A, deposito_id: DEPOSITO_A, ponto_pedido: '3' },
    })
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
  })

  it('a sugestão de reposição mostra a peça esgotada, não a esconde', async () => {
    const tk = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['peca:ler', 'estoque:politica_definir'],
    })
    await chamar(api, 'PUT', '/api/v1/estoque/politicas', {
      token: tk,
      corpo: {
        peca_id: PECA_A,
        deposito_id: DEPOSITO_A,
        estoque_minimo: '50',
        estoque_maximo: '200',
        ponto_pedido: '100',
        lead_time_dias: 10,
      },
    })

    const r = await chamar(api, 'GET', '/api/v1/estoque/reposicao', { token: tk })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    const item = r.corpo.data.find(
      (x: { peca_id: string; deposito_id: string }) =>
        x.peca_id === PECA_A && x.deposito_id === DEPOSITO_A,
    )
    /*
     * Peça abaixo do ponto de pedido precisa aparecer **mesmo com saldo zero**
     * — é o caso que mais precisa de compra. Um `join` no saldo a esconderia
     * justamente por estar esgotada.
     */
    assert.ok(item, 'a peça abaixo do ponto de pedido não apareceu na sugestão')
    assert.ok(Number(item.sugerido) > 0)
  })
})
