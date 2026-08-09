import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CNPJ_FORNECEDOR_A,
  FORNECEDOR_A,
  NOTA_ITEM_1,
  NOTA_ITEM_2,
  NOTA_PENDENTE,
  NOTA_TENANT_B,
  TENANT_B,
  USUARIO_B,
  USUARIO_COMPRADOR,
  chamar,
  chaveIdempotencia,
  corpoNota,
  montarChaveAcesso,
  subirApi,
  token,
  unidades,
  type Servidor,
} from './apoio.js'

/**
 * Integração da entrada fiscal de compra, contra PostgreSQL real.
 *
 * O que estes testes existem para provar, em uma frase: o custo do ativo não é
 * digitado, e não há caminho pela API que o torne opinião de novo.
 */

let api: Servidor

const LEITOR = ['nota_fiscal:ler'] as const
const LANCADOR = ['nota_fiscal:ler', 'nota_fiscal:criar', 'nota_fiscal:editar'] as const
const CONFERENTE = ['nota_fiscal:ler', 'nota_fiscal:conferir'] as const
const INTEGRADOR = ['nota_fiscal:ler', 'nota_fiscal:integrar'] as const
const CANCELADOR = ['nota_fiscal:ler', 'nota_fiscal:cancelar'] as const

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

/** Lança uma nota já com todas as unidades identificadas. */
async function notaPronta(numero: string, opcoes: { quantidade?: number; frete?: string; ipi?: string } = {}) {
  const t = await token({ permissoes: [...LANCADOR] })
  const quantidade = opcoes.quantidade ?? 3

  const criada = await chamar(api, 'POST', '/api/v1/notas-fiscais', {
    token: t,
    corpo: corpoNota({ numero, quantidade, ...opcoes }),
    cabecalhos: { 'Idempotency-Key': chaveIdempotencia('nf') },
  })
  assert.equal(criada.status, 201, JSON.stringify(criada.corpo))

  const nota = criada.corpo.data
  const item = nota.itens[0]
  const series = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/itens/${item.id}/series`, {
    token: t,
    corpo: unidades(quantidade),
  })
  assert.equal(series.status, 200, JSON.stringify(series.corpo))
  return nota
}

/* ---------------------------------------------------------------- lançamento */

describe('lançamento da nota', () => {
  it('lança e devolve o custo de aquisição derivado, não informado', async () => {
    const r = await chamar(api, 'POST', '/api/v1/notas-fiscais', {
      token: await token({ permissoes: [...LANCADOR] }),
      corpo: corpoNota({ numero: '60001', frete: '300', ipi: '150', desconto: '50' }),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('nf') },
    })

    assert.equal(r.status, 201, JSON.stringify(r.corpo))
    // 2 × 1500 + 300 + 150 − 50 = 3400. ICMS não recuperável: custo = total.
    assert.equal(Number(r.corpo.data.valor_total), 3400)
    assert.equal(Number(r.corpo.data.custo_aquisicao), 3400)
    assert.equal(r.corpo.data.status, 'PENDENTE_CONFERENCIA')
    assert.equal(r.corpo.data.itens.length, 1)
  })

  it('tributo recuperável sai do custo, e só dele', async () => {
    const base = corpoNota({ numero: '60002', ipi: '200' })
    const r = await chamar(api, 'POST', '/api/v1/notas-fiscais', {
      token: await token({ permissoes: [...LANCADOR] }),
      corpo: { ...base, valor_icms: '540.0000', icms_recuperavel: true, ipi_recuperavel: true },
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('nf') },
    })

    assert.equal(r.status, 201, JSON.stringify(r.corpo))
    // O total da nota não muda com o regime — o custo do imobilizado, sim
    // (CPC 27 item 16). 3200 − 540 (ICMS) − 200 (IPI) = 2460.
    assert.equal(Number(r.corpo.data.valor_total), 3200)
    assert.equal(Number(r.corpo.data.custo_aquisicao), 2460)
  })

  it('total que não fecha com a composição é recusado apontando o campo', async () => {
    const r = await chamar(api, 'POST', '/api/v1/notas-fiscais', {
      token: await token({ permissoes: [...LANCADOR] }),
      corpo: corpoNota({ numero: '60003', frete: '500', totalForcado: '3000.0000' }),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('nf') },
    })

    assert.equal(r.status, 400)
    assert.equal(r.corpo.code, 'PAYLOAD_INVALIDO')
    assert.ok(r.corpo.errors.some((e: any) => e.field === 'valor_total'), JSON.stringify(r.corpo.errors))
  })

  it('chave com dígito verificador errado é recusada antes de tocar o banco', async () => {
    const valida = montarChaveAcesso({ numero: '60004' })
    const quebrada = valida.slice(0, 43) + String((Number(valida[43]) + 1) % 10)

    const r = await chamar(api, 'POST', '/api/v1/notas-fiscais', {
      token: await token({ permissoes: [...LANCADOR] }),
      corpo: corpoNota({ numero: '60004', chave: quebrada }),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('nf') },
    })

    assert.equal(r.status, 400)
    assert.ok(r.corpo.errors.some((e: any) => e.field === 'chave_acesso'), JSON.stringify(r.corpo.errors))
  })

  it('chave íntegra mas de outro emitente é recusada nomeando o CNPJ', async () => {
    // O DV confere; o que não confere é de quem a nota é. Nenhum cálculo de
    // dígito pega este caso — só a comparação com o cabeçalho (RN-L10).
    const r = await chamar(api, 'POST', '/api/v1/notas-fiscais', {
      token: await token({ permissoes: [...LANCADOR] }),
      corpo: corpoNota({ numero: '60005', chave: montarChaveAcesso({ cnpj: '99888777000166', numero: '60005' }) }),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('nf') },
    })

    assert.equal(r.status, 422)
    assert.equal(r.corpo.code, 'REGRA_DE_NEGOCIO')
    assert.match(r.corpo.detail, /99888777000166/)
    assert.ok(r.corpo.acoes_sugeridas.some((a: any) => a.code === 'CONFERIR_FORNECEDOR'))
  })

  it('chave de outro número é recusada mesmo com o emitente certo', async () => {
    const r = await chamar(api, 'POST', '/api/v1/notas-fiscais', {
      token: await token({ permissoes: [...LANCADOR] }),
      corpo: corpoNota({ numero: '60006', chave: montarChaveAcesso({ numero: '99999' }) }),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('nf') },
    })

    assert.equal(r.status, 422)
    assert.match(r.corpo.detail, /1\/99999/)
  })

  it('a mesma chave em duas notas é recusada pelo índice único', async () => {
    const chave = montarChaveAcesso({ numero: '60007' })
    const t = await token({ permissoes: [...LANCADOR] })

    const primeira = await chamar(api, 'POST', '/api/v1/notas-fiscais', {
      token: t,
      corpo: corpoNota({ numero: '60007', chave }),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('nf') },
    })
    assert.equal(primeira.status, 201, JSON.stringify(primeira.corpo))

    // Mesma chave, número diferente: o cabeçalho divergiria, então a recusa
    // vem antes. Reenviar o mesmo número com chave repetida é o caso real —
    // duas notas lançadas para o mesmo documento.
    const repetida = await chamar(api, 'POST', '/api/v1/notas-fiscais', {
      token: t,
      corpo: corpoNota({ numero: '60007', chave }),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('nf') },
    })
    assert.equal(repetida.status, 409)
    assert.equal(repetida.corpo.code, 'RECURSO_DUPLICADO')
  })

  it('nota sem item é recusada na fronteira', async () => {
    const r = await chamar(api, 'POST', '/api/v1/notas-fiscais', {
      token: await token({ permissoes: [...LANCADOR] }),
      corpo: { ...corpoNota({ numero: '60008' }), itens: [] },
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('nf') },
    })
    assert.equal(r.status, 400)
  })
})

/* --------------------------------------------------------------- séries */

describe('identificação das unidades', () => {
  it('quantidade divergente da do item é recusada com a contagem', async () => {
    const r = await chamar(api, 'POST', `/api/v1/notas-fiscais/${NOTA_PENDENTE}/itens/${NOTA_ITEM_2}/series`, {
      token: await token({ permissoes: [...LANCADOR] }),
      corpo: unidades(5),
    })

    assert.equal(r.status, 400)
    assert.match(r.corpo.detail, /2 unidade\(s\); foram informadas 5/)
  })

  it('série repetida no mesmo lote é recusada apontando as duas posições', async () => {
    const repetida = { numero_serie: 'REP-0001', patrimonio: 'REP-P1' }
    const r = await chamar(api, 'POST', `/api/v1/notas-fiscais/${NOTA_PENDENTE}/itens/${NOTA_ITEM_2}/series`, {
      token: await token({ permissoes: [...LANCADOR] }),
      corpo: { unidades: [repetida, { ...repetida, patrimonio: 'REP-P2' }] },
    })

    assert.equal(r.status, 409)
    assert.match(r.corpo.detail, /unidades 1 e 2/)
    assert.ok(r.corpo.acoes_sugeridas.some((a: any) => a.code === 'CONFERIR_LEITURA'))
  })

  it('série já usada no parque é recusada nomeando o ativo', async () => {
    const r = await chamar(api, 'POST', `/api/v1/notas-fiscais/${NOTA_PENDENTE}/itens/${NOTA_ITEM_2}/series`, {
      token: await token({ permissoes: [...LANCADOR] }),
      // KYO-A-0001 é a série do patrimônio 10422, semeado no parque.
      corpo: {
        unidades: [
          { numero_serie: 'kyo-a-0001', patrimonio: 'NOVO-1' },
          { numero_serie: 'NOVO-S2', patrimonio: 'NOVO-2' },
        ],
      },
    })

    assert.equal(r.status, 409)
    assert.match(r.corpo.detail, /10422/)
  })

  it('substituir o conjunto corrige uma leitura errada sem duplicar', async () => {
    const t = await token({ permissoes: [...LANCADOR] })
    const primeira = await chamar(api, 'POST', `/api/v1/notas-fiscais/${NOTA_PENDENTE}/itens/${NOTA_ITEM_2}/series`, {
      token: t,
      corpo: unidades(2, 'V1'),
    })
    assert.equal(primeira.status, 200, JSON.stringify(primeira.corpo))

    const segunda = await chamar(api, 'POST', `/api/v1/notas-fiscais/${NOTA_PENDENTE}/itens/${NOTA_ITEM_2}/series`, {
      token: t,
      corpo: unidades(2, 'V2'),
    })
    assert.equal(segunda.status, 200, JSON.stringify(segunda.corpo))
    // Duas, não quatro: o comando substitui, e é o que permite corrigir a
    // etiqueta lida errada sem apagar tudo à mão.
    assert.equal(segunda.corpo.data.series.length, 2)
    assert.ok(segunda.corpo.data.series.every((s: any) => s.numero_serie.startsWith('V2-')))
  })
})

/* ---------------------------------------------------------------- conferência */

describe('conferência', () => {
  it('recusa a nota com unidades por identificar, nomeando o item', async () => {
    // Nota própria com dois itens, e só o primeiro identificado. Usar a nota
    // semeada acoplaria este teste aos anteriores — eles completam as séries
    // dela, e a recusa deixaria de acontecer sem que nada estivesse errado.
    const t = await token({ permissoes: [...LANCADOR] })
    const base = corpoNota({ numero: '61001', quantidade: 2 })
    const criada = await chamar(api, 'POST', '/api/v1/notas-fiscais', {
      token: t,
      corpo: {
        ...base,
        valor_produtos: '6000.0000',
        valor_total: '6000.0000',
        itens: [base.itens[0]!, { ...base.itens[0]!, descricao_nf: 'SEGUNDO LOTE' }],
      },
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('nf') },
    })
    assert.equal(criada.status, 201, JSON.stringify(criada.corpo))

    const nota = criada.corpo.data
    const series = await chamar(
      api,
      'POST',
      `/api/v1/notas-fiscais/${nota.id}/itens/${nota.itens[0].id}/series`,
      { token: t, corpo: unidades(2, 'INC') },
    )
    assert.equal(series.status, 200, JSON.stringify(series.corpo))

    const r = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/conferir`, {
      token: await token({ permissoes: [...CONFERENTE], usuario: USUARIO_COMPRADOR }),
    })

    assert.equal(r.status, 422)
    assert.equal(r.corpo.code, 'REGRA_DE_NEGOCIO')
    assert.match(r.corpo.detail, /item 2/)
    assert.ok(r.corpo.acoes_sugeridas.some((a: any) => a.code === 'INFORMAR_SERIES'))
  })

  it('RN-027: quem lançou a nota não pode conferi-la', async () => {
    const nota = await notaPronta('61002', { quantidade: 2 })

    // Mesmo com a permissão de conferir, o autor do lançamento é recusado. A
    // permissão sozinha não bastaria: um administrador tem todas.
    const r = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/conferir`, {
      token: await token({ permissoes: [...LANCADOR, ...CONFERENTE] }),
    })

    assert.equal(r.status, 403)
    assert.equal(r.corpo.code, 'SEM_PERMISSAO')
    assert.match(r.corpo.detail, /segunda pessoa/i)
  })

  it('outra pessoa confere e a nota passa a CONFERIDA', async () => {
    const nota = await notaPronta('61003', { quantidade: 2 })
    const r = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/conferir`, {
      token: await token({ permissoes: [...CONFERENTE], usuario: USUARIO_COMPRADOR }),
    })

    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.status, 'CONFERIDA')
    assert.ok(r.corpo.data.conferida_em)
  })

  it('conferir duas vezes é recusado', async () => {
    const nota = await notaPronta('61004', { quantidade: 2 })
    const t = await token({ permissoes: [...CONFERENTE], usuario: USUARIO_COMPRADOR })
    await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/conferir`, { token: t })
    const r = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/conferir`, { token: t })
    assert.equal(r.status, 422)
    assert.equal(r.corpo.code, 'TRANSICAO_INVALIDA')
  })
})

/* ---------------------------------------------------------------- integração */

describe('integração ao patrimônio', () => {
  async function conferida(numero: string, opcoes: Parameters<typeof notaPronta>[1] = {}) {
    const nota = await notaPronta(numero, opcoes)
    const r = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/conferir`, {
      token: await token({ permissoes: [...CONFERENTE], usuario: USUARIO_COMPRADOR }),
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    return nota
  }

  it('RN-L05: a prévia soma exatamente o custo da nota, com resíduo', async () => {
    // 3 unidades e frete de 100: 100/3 não fecha em centavos. É o caso em que
    // o rateio ingênuo perde um centavo.
    const nota = await conferida('62001', { quantidade: 3, frete: '100' })
    const r = await chamar(api, 'GET', `/api/v1/notas-fiscais/${nota.id}/previa-integracao`, {
      token: await token({ permissoes: [...LEITOR] }),
    })

    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.unidades.length, 3)
    assert.equal(r.corpo.data.fecha, true)
    assert.equal(Number(r.corpo.data.soma_rateio), Number(r.corpo.data.custo_aquisicao))

    // As unidades não são todas iguais: o resíduo está concentrado na primeira,
    // que é o que faz a soma fechar exatamente.
    const valores = r.corpo.data.unidades.map((u: any) => Number(u.valor_aquisicao))
    assert.equal(valores.reduce((a: number, b: number) => a + b, 0).toFixed(2),
      Number(r.corpo.data.custo_aquisicao).toFixed(2))
  })

  it('RN-L06: a garantia do item vira data no ativo', async () => {
    const nota = await conferida('62002', { quantidade: 2 })
    const r = await chamar(api, 'GET', `/api/v1/notas-fiscais/${nota.id}/previa-integracao`, {
      token: await token({ permissoes: [...LEITOR] }),
    })
    // 24 meses sobre a entrada 2026-05-12.
    assert.equal(r.corpo.data.unidades[0].garantia_ate, '2028-05-12')
  })

  it('RN-L03/RN-L07: cria os ativos disponíveis e sela a nota', async () => {
    const nota = await conferida('62003', { quantidade: 3, frete: '100' })

    const r = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/integrar`, {
      token: await token({ permissoes: [...INTEGRADOR] }),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('int') },
    })

    assert.equal(r.status, 201, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.equipamentos_criados.length, 3)
    assert.equal(r.corpo.data.nota.status, 'INTEGRADA')

    // Os ativos existem, disponíveis, com o valor rateado.
    const equip = await chamar(
      api,
      'GET',
      `/api/v1/equipamentos/${r.corpo.data.equipamentos_criados[0].id}`,
      { token: await token({ permissoes: ['equipamento:ler'] }) },
    )
    assert.equal(equip.status, 200, JSON.stringify(equip.corpo))
    assert.equal(equip.corpo.data.status, 'DISPONIVEL')
  })

  it('RN-L01: nota integrada recusa alteração de séries', async () => {
    const nota = await conferida('62004', { quantidade: 2 })
    await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/integrar`, {
      token: await token({ permissoes: [...INTEGRADOR] }),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('int') },
    })

    const r = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/itens/${nota.itens[0].id}/series`, {
      token: await token({ permissoes: [...LANCADOR] }),
      corpo: unidades(2, 'TARDE'),
    })

    assert.equal(r.status, 422)
    assert.equal(r.corpo.code, 'TRANSICAO_INVALIDA')
    assert.ok(r.corpo.acoes_sugeridas.some((a: any) => a.code === 'NOTA_DE_AJUSTE'))
  })

  it('RN-L09: nota integrada não pode ser cancelada', async () => {
    const nota = await conferida('62005', { quantidade: 2 })
    await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/integrar`, {
      token: await token({ permissoes: [...INTEGRADOR] }),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('int') },
    })

    const r = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/cancelar`, {
      token: await token({ permissoes: [...CANCELADOR] }),
      corpo: { motivo: 'lançamento em duplicidade' },
    })

    assert.equal(r.status, 422)
    assert.match(r.corpo.detail, /2 ativo\(s\)/)
    assert.ok(r.corpo.acoes_sugeridas.some((a: any) => a.code === 'BAIXA_PATRIMONIAL'))
  })

  it('integrar sem conferir é recusado', async () => {
    const nota = await notaPronta('62006', { quantidade: 2 })
    const r = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/integrar`, {
      token: await token({ permissoes: [...INTEGRADOR] }),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('int') },
    })

    assert.equal(r.status, 422)
    assert.equal(r.corpo.code, 'TRANSICAO_INVALIDA')
    assert.ok(r.corpo.acoes_sugeridas.some((a: any) => a.code === 'CONFERIR'))
  })

  it('RN-029: integrar duas vezes com a mesma chave não duplica patrimônio', async () => {
    const nota = await conferida('62007', { quantidade: 2 })
    const chave = chaveIdempotencia('int')
    const t = await token({ permissoes: [...INTEGRADOR] })

    const primeira = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/integrar`, {
      token: t,
      cabecalhos: { 'Idempotency-Key': chave },
    })
    const replay = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/integrar`, {
      token: t,
      cabecalhos: { 'Idempotency-Key': chave },
    })

    assert.equal(primeira.status, 201, JSON.stringify(primeira.corpo))
    assert.equal(replay.status, 201)
    // Byte por byte: o replay devolve a resposta guardada, não uma nova
    // integração que criaria dois ativos por unidade.
    assert.deepEqual(replay.corpo, primeira.corpo)
  })
})

/* -------------------------------------------------------- cancelamento e RLS */

describe('cancelamento, permissões e isolamento', () => {
  it('cancelar sem motivo suficiente é recusado', async () => {
    const nota = await notaPronta('63001', { quantidade: 2 })
    const r = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/cancelar`, {
      token: await token({ permissoes: [...CANCELADOR] }),
      corpo: { motivo: 'erro' },
    })
    assert.equal(r.status, 400)
  })

  it('cancela com motivo e a nota não reabre', async () => {
    const nota = await notaPronta('63002', { quantidade: 2 })
    const t = await token({ permissoes: [...CANCELADOR] })

    const cancelada = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/cancelar`, {
      token: t,
      corpo: { motivo: 'devolução ao fornecedor: modelo divergente do pedido' },
    })
    assert.equal(cancelada.status, 200, JSON.stringify(cancelada.corpo))
    assert.equal(cancelada.corpo.data.status, 'CANCELADA')

    const denovo = await chamar(api, 'POST', `/api/v1/notas-fiscais/${nota.id}/cancelar`, {
      token: t,
      corpo: { motivo: 'segunda tentativa de cancelamento' },
    })
    assert.equal(denovo.status, 422)
  })

  it('cada ação exige a sua permissão — negado por padrão', async () => {
    const t = await token({ permissoes: [...LEITOR] })

    const criar = await chamar(api, 'POST', '/api/v1/notas-fiscais', {
      token: t,
      corpo: corpoNota({ numero: '63003' }),
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('nf') },
    })
    const conferir = await chamar(api, 'POST', `/api/v1/notas-fiscais/${NOTA_PENDENTE}/conferir`, { token: t })
    const integrar = await chamar(api, 'POST', `/api/v1/notas-fiscais/${NOTA_PENDENTE}/integrar`, {
      token: t,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('int') },
    })

    assert.equal(criar.status, 403)
    assert.equal(conferir.status, 403)
    assert.equal(integrar.status, 403)
    assert.equal(criar.corpo.code, 'SEM_PERMISSAO')
  })

  it('RN-028: a nota de outro tenant não existe para este', async () => {
    const r = await chamar(api, 'GET', `/api/v1/notas-fiscais/${NOTA_TENANT_B}`, {
      token: await token({ permissoes: [...LEITOR] }),
    })
    // 404, não 403: revelar que o registro existe já é vazamento.
    assert.equal(r.status, 404)

    const doOutroLado = await chamar(api, 'GET', `/api/v1/notas-fiscais/${NOTA_TENANT_B}`, {
      token: await token({ tenant: TENANT_B, usuario: USUARIO_B, permissoes: [...LEITOR] }),
    })
    assert.equal(doOutroLado.status, 200, JSON.stringify(doOutroLado.corpo))
  })

  it('a listagem só traz notas do próprio tenant', async () => {
    const r = await chamar(api, 'GET', '/api/v1/notas-fiscais?limit=100', {
      token: await token({ permissoes: [...LEITOR] }),
    })
    assert.equal(r.status, 200)
    assert.ok(r.corpo.data.length > 0)
    assert.ok(!r.corpo.data.some((n: any) => n.id === NOTA_TENANT_B))
  })

  it('fornecedores listam com a permissão própria', async () => {
    const semPermissao = await chamar(api, 'GET', '/api/v1/fornecedores', {
      token: await token({ permissoes: [...LEITOR] }),
    })
    assert.equal(semPermissao.status, 403)

    const r = await chamar(api, 'GET', '/api/v1/fornecedores', {
      token: await token({ permissoes: ['fornecedor:ler'] }),
    })
    assert.equal(r.status, 200)
    assert.ok(r.corpo.data.some((f: any) => f.id === FORNECEDOR_A && f.documento === CNPJ_FORNECEDOR_A))
  })

  it('NOTA_ITEM_1 continua com as três unidades semeadas', async () => {
    const r = await chamar(api, 'GET', `/api/v1/notas-fiscais/${NOTA_PENDENTE}`, {
      token: await token({ permissoes: [...LEITOR] }),
    })
    const item = r.corpo.data.itens.find((i: any) => i.id === NOTA_ITEM_1)
    assert.equal(item.series.length, 3)
  })
})
