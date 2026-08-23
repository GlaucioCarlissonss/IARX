import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NotificacaoWorker } from '../src/modulos/notificacao/notificacao.worker.js'
import { RemetenteRegistro } from '../src/modulos/notificacao/remetente.js'
import {
  APROVADOR_N1,
  APROVADOR_N2,
  APROVADOR_N3,
  CENTRO_ADM,
  CENTRO_OPER,
  CONTA_OPERACAO,
  EMPRESA_A,
  FORNECEDOR_A,
  USUARIO_A,
  USUARIO_COMPRADOR,
  chamar,
  drenarTudo,
  subirApi,
  token,
  type Servidor,
} from './apoio.js'

/**
 * Integração de contas a pagar, contra PostgreSQL real.
 *
 * O que estes testes existem para provar: **o fluxo de aprovação impede algo**.
 * Um fluxo que aparece na tela e não impede nada é pior que não ter fluxo — dá
 * a sensação de controle sem o controle. As nove invariantes já têm teste de
 * banco; aqui se verifica o que só aparece atravessando o HTTP: a fila do
 * aprovador não oferecer o que ele não pode decidir, a recusa do gatilho chegar
 * como 422 acionável em vez de 500, e o aviso entrar na fila de notificação na
 * mesma transação do fato.
 *
 * Os limites de alçada (10 mil / 50 mil / 250 mil) vêm de `semear.sql` e são
 * massa de teste, não regra de negócio: o que se prova é que a contagem de
 * níveis segue os limites cadastrados.
 */

let api: Servidor
let worker: NotificacaoWorker

const CRIADOR = ['pagar:ler', 'pagar:criar'] as const
const TUDO = [
  'pagar:ler',
  'pagar:criar',
  'pagar:aprovar',
  'pagar:baixar',
  'pagar:cancelar',
  'pagar:delegar_aprovacao',
] as const

let seq = 0
const chave = () => ({ 'idempotency-key': `cpg-${Date.now()}-${++seq}` })

before(async () => {
  api = await subirApi()
  worker = api.app.get(NotificacaoWorker)
})

after(async () => {
  await api.fechar()
})

interface CorpoTitulo {
  [k: string]: unknown
}

async function criar(t: string, extra: CorpoTitulo = {}) {
  return chamar(api, 'POST', '/api/v1/contas-pagar', {
    token: t,
    cabecalhos: chave(),
    corpo: {
      empresa_id: EMPRESA_A,
      fornecedor_id: FORNECEDOR_A,
      descricao: `Despesa de teste ${++seq}`,
      classificacao: 'DESPESA_VARIAVEL',
      valor_original: '5000.0000',
      data_emissao: '2026-08-01',
      data_vencimento: '2026-09-01',
      ...extra,
    },
  })
}

describe('alçada e criação', () => {
  it('a prévia diz quantos níveis o valor vai exigir, antes de salvar', async () => {
    const t = await token({ permissoes: [...CRIADOR] })

    const previa = async (valor: string) =>
      (await chamar(api, 'POST', '/api/v1/contas-pagar/previa-alcada', { token: t, corpo: { valor } }))
        .corpo.data

    // Existe para remover uma surpresa concreta: lançar, confirmar, e só então
    // descobrir que aquele valor vai para a diretoria e vai demorar três dias.
    assert.equal((await previa('5000.0000')).niveis, 0)
    assert.equal((await previa('20000.0000')).niveis, 1)
    assert.equal((await previa('100000.0000')).niveis, 2)
    assert.equal((await previa('500000.0000')).niveis, 3)

    // E devolve os limites, para a tela poder explicar de onde vem o número em
    // vez de mostrar um "2" sem origem.
    assert.equal((await previa('20000.0000')).limites.length, 3)
  })

  it('abaixo do menor limite, o título nasce APROVADO e sem linha de aprovação', async () => {
    const t = await token({ permissoes: [...CRIADOR] })
    const r = await criar(t, { valor_original: '3000.0000' })

    assert.equal(r.status, 201)
    // Aprovação automática é literalmente não criar linha nenhuma — não um
    // estado especial que alguém tem de tratar.
    assert.equal(r.corpo.data.status, 'APROVADO')
    assert.equal(r.corpo.data.aprovacoes.length, 0)
  })

  it('acima do limite, nasce EM_APROVACAO com uma linha por nível', async () => {
    const t = await token({ permissoes: [...CRIADOR] })
    const r = await criar(t, { valor_original: '100000.0000' })

    assert.equal(r.corpo.data.status, 'EM_APROVACAO')
    assert.equal(r.corpo.data.aprovacoes.length, 2)
    assert.deepEqual(
      r.corpo.data.aprovacoes.map((a: { nivel: number; decisao: null }) => a.nivel),
      [1, 2],
    )
    assert.ok(r.corpo.data.aprovacoes.every((a: { decisao: null }) => a.decisao === null))
  })

  it('o rateio entra junto e soma 100%; fora disso é recusado na fronteira', async () => {
    const t = await token({ permissoes: [...CRIADOR] })

    const ok = await criar(t, {
      rateio: [
        { centro_custo_id: CENTRO_OPER, percentual: 60 },
        { centro_custo_id: CENTRO_ADM, percentual: 40 },
      ],
    })
    assert.equal(ok.status, 201)
    assert.equal(ok.corpo.data.rateio.length, 2)
    assert.equal(ok.corpo.data.rateio.reduce((s: number, r: { percentual: number }) => s + r.percentual, 0), 100)

    // Recusado no Zod, antes do banco: 30% da despesa ficaria sem centro de
    // custo, isto é, lançada em lugar nenhum.
    const quebrado = await criar(t, {
      rateio: [{ centro_custo_id: CENTRO_OPER, percentual: 70 }],
    })
    assert.equal(quebrado.status, 400)
  })

  it('parcelar cria o pai e as filhas, e os centavos fecham', async () => {
    const t = await token({ permissoes: [...CRIADOR] })
    const r = await criar(t, { valor_original: '1000.0000', parcelas: 3 })

    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.parcela_total, 3)

    const lista = await chamar(api, 'GET', '/api/v1/contas-pagar?limit=50', { token: t })
    const filhas = lista.corpo.data.filter(
      (x: { titulo_pai_id: string | null }) => x.titulo_pai_id === r.corpo.data.id,
    )
    assert.equal(filhas.length, 3)

    // 1000/3 dá 333,33 três vezes e sobra um centavo. Sem a correção na última,
    // o parcelamento fecha um centavo abaixo do título — e a diferença aparece
    // na conciliação como uma sobra que ninguém explica.
    const soma = filhas.reduce((s: number, f: { valor_devido: string }) => s + Number(f.valor_devido), 0)
    assert.equal(Math.round(soma * 100) / 100, 1000)
  })

  it('vencimento antes da emissão é recusado', async () => {
    const t = await token({ permissoes: [...CRIADOR] })
    const r = await criar(t, { data_emissao: '2026-09-01', data_vencimento: '2026-08-01' })
    assert.equal(r.status, 400)
  })

  it('criar exige a permissão própria, e ler não basta', async () => {
    const leitor = await token({ permissoes: ['pagar:ler'] })
    assert.equal((await criar(leitor)).status, 403)
  })
})

describe('fluxo de aprovação', () => {
  it('a fila do aprovador não devolve o título que ele mesmo lançou', async () => {
    // RN-F04 recusaria a decisão de qualquer forma; oferecer na fila é convidar
    // ao erro e ensinar a desconfiar da lista.
    const lancadorAprovador = await token({
      usuario: APROVADOR_N1,
      permissoes: [...TUDO],
    })
    const meu = await criar(lancadorAprovador, { valor_original: '20000.0000' })
    assert.equal(meu.corpo.data.status, 'EM_APROVACAO')

    const fila = await chamar(api, 'GET', '/api/v1/contas-pagar?minha_aprovacao=true&limit=50', {
      token: lancadorAprovador,
    })
    assert.equal(
      fila.corpo.data.filter((x: { id: string }) => x.id === meu.corpo.data.id).length,
      0,
      'o próprio título apareceu na fila de aprovação de quem o lançou',
    )
  })

  it('o nível 2 só decide depois do nível 1, e quem não tem alçada não vê a fila', async () => {
    const criador = await token({ permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '100000.0000' })
    const id = t.corpo.data.id

    // O que coloca um título na fila de alguém é **posto ≥ nível**, não posto
    // igual: um aprovador de posto superior decide um nível inferior de
    // propósito (RN-F03), senão as férias do gerente travariam o nível 1 com o
    // diretor sentado ao lado — e o contorno seria emprestar credencial. Logo o
    // nível 2 vê, sim, o nível 1 pendente. Quem não tem alçada nenhuma é que
    // não vê nada, mesmo carregando `pagar:aprovar`: a permissão abre a tela, a
    // alçada é que diz até quanto.
    const semPosto = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...TUDO] })
    const filaSemPosto = await chamar(
      api,
      'GET',
      '/api/v1/contas-pagar?minha_aprovacao=true&limit=50',
      { token: semPosto },
    )
    assert.equal(
      filaSemPosto.corpo.data.filter((x: { id: string }) => x.id === id).length,
      0,
      'quem não tem alçada viu o título na fila de aprovação',
    )

    // A garantia de sequência não está na fila, está na decisão: aprovar o
    // nível 2 antes permitiria o superior autorizar algo que o inferior vai
    // rejeitar — e a rejeição chegaria depois da autorização.
    const n2 = await token({ usuario: APROVADOR_N2, permissoes: [...TUDO] })
    const forcado = await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/aprovacoes/2/decidir`, {
      token: n2,
      corpo: { decisao: 'APROVADO' },
    })
    assert.equal(forcado.status, 422)
    assert.ok(
      forcado.corpo.acoes_sugeridas?.some(
        (a: { code: string }) => a.code === 'AGUARDAR_NIVEL_ANTERIOR',
      ),
      'a recusa de ordem não disse o que esperar',
    )

    const n1 = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })
    const passo1 = await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/aprovacoes/1/decidir`, {
      token: n1,
      corpo: { decisao: 'APROVADO' },
    })
    assert.equal(passo1.status, 200)
    assert.equal(passo1.corpo.data.status, 'EM_APROVACAO')

    const depois = await chamar(api, 'GET', '/api/v1/contas-pagar?minha_aprovacao=true&limit=50', {
      token: n2,
    })
    assert.equal(
      depois.corpo.data.filter((x: { id: string }) => x.id === id).length,
      1,
      'o nível 2 saiu da fila depois de o nível 1 aprovar',
    )

    const passo2 = await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/aprovacoes/2/decidir`, {
      token: n2,
      corpo: { decisao: 'APROVADO' },
    })
    assert.equal(passo2.corpo.data.status, 'APROVADO')
  })

  it('quem lançou não aprova, mesmo tendo alçada', async () => {
    const criador = await token({ usuario: APROVADOR_N3, permissoes: [...TUDO] })
    const t = await criar(criador, { valor_original: '20000.0000' })

    const r = await chamar(api, 'POST', `/api/v1/contas-pagar/${t.corpo.data.id}/aprovacoes/1/decidir`, {
      token: criador,
      corpo: { decisao: 'APROVADO' },
    })
    // A recusa vem do gatilho e chega acionável: um 500 aqui significaria que a
    // regra que sustenta o módulo inteiro está vazando como defeito.
    assert.equal(r.status, 422)
    assert.ok(r.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'OUTRO_APROVADOR'))
  })

  it('sem alçada não se decide, e a recusa diz o que configurar', async () => {
    const criador = await token({ permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '20000.0000' })

    // Permissão sem alçada: `pagar:aprovar` diz que a pessoa pode operar a
    // tela, `alcada` diz até quanto. Confundir as duas seria dar aprovação
    // ilimitada a quem recebeu acesso de leitura ampliado.
    // Precisa ser alguém que **não** lançou o título: se fosse o próprio
    // criador, a RN-F04 recusaria antes de a alçada ser consultada, e o teste
    // passaria pelo motivo errado.
    const semAlcada = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...TUDO] })
    const r = await chamar(api, 'POST', `/api/v1/contas-pagar/${t.corpo.data.id}/aprovacoes/1/decidir`, {
      token: semAlcada,
      corpo: { decisao: 'APROVADO' },
    })
    assert.equal(r.status, 422)
    assert.ok(r.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'CONFIGURAR_ALCADA'))
  })

  it('rejeição exige justificativa, volta a PENDENTE e o reenvio abre nova rodada', async () => {
    const criador = await token({ permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '20000.0000' })
    const id = t.corpo.data.id
    const n1 = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })

    const semJustificativa = await chamar(
      api,
      'POST',
      `/api/v1/contas-pagar/${id}/aprovacoes/1/decidir`,
      { token: n1, corpo: { decisao: 'REJEITADO' } },
    )
    assert.equal(semJustificativa.status, 400)

    const rejeitado = await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/aprovacoes/1/decidir`, {
      token: n1,
      corpo: { decisao: 'REJEITADO', justificativa: 'sem nota fiscal anexada; reenviar com o documento' },
    })
    // Volta a PENDENTE, e não a um estado terminal: o título rejeitado tem um
    // destino natural — o solicitante corrige e reenvia.
    assert.equal(rejeitado.corpo.data.status, 'PENDENTE')

    const reenviado = await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/reenviar`, {
      token: criador,
    })
    assert.equal(reenviado.corpo.data.status, 'EM_APROVACAO')

    // Rodada nova, e a antiga preservada: é a rejeição que explica a correção.
    const rodadas = new Set(
      reenviado.corpo.data.aprovacoes.map((a: { rodada: number }) => a.rodada),
    )
    assert.equal(rodadas.size, 2)
    assert.ok(
      reenviado.corpo.data.aprovacoes.some((a: { decisao: string | null }) => a.decisao === 'REJEITADO'),
      'a rejeição da rodada anterior foi apagada',
    )
  })

  it('a decisão registrada não se reescreve', async () => {
    const criador = await token({ permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '100000.0000' })
    const id = t.corpo.data.id
    const n1 = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })

    assert.equal(
      (
        await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/aprovacoes/1/decidir`, {
          token: n1,
          corpo: { decisao: 'APROVADO' },
        })
      ).status,
      200,
    )

    // O histórico de aprovação é a prova de quem autorizou o quê.
    const denovo = await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/aprovacoes/1/decidir`, {
      token: n1,
      corpo: { decisao: 'REJEITADO', justificativa: 'mudei de ideia depois de aprovar' },
    })
    assert.equal(denovo.status, 422)
  })

  it('um posto maior decide um nível menor', async () => {
    const criador = await token({ permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '20000.0000' })

    // Se a regra fosse "posto exatamente N", o gestor de férias travaria o
    // nível 1 com o diretor disponível — e a saída seria emprestar credencial.
    const n3 = await token({ usuario: APROVADOR_N3, permissoes: [...TUDO] })
    const r = await chamar(api, 'POST', `/api/v1/contas-pagar/${t.corpo.data.id}/aprovacoes/1/decidir`, {
      token: n3,
      corpo: { decisao: 'APROVADO' },
    })
    assert.equal(r.status, 200)
    assert.equal(r.corpo.data.status, 'APROVADO')
  })
})

describe('aviso de aprovação', () => {
  it('criar um título acima da alçada enfileira o aviso para os aprovadores', async () => {
    const remetente = new RemetenteRegistro(200, () => undefined)
    const criador = await token({ permissoes: [...CRIADOR] })

    const t = await criar(criador, { valor_original: '20000.0000', descricao: 'Licença anual do ERP' })
    assert.equal(t.corpo.data.status, 'EM_APROVACAO')

    // Enfileirado na mesma transação do fato: se a criação fosse desfeita, o
    // aviso não existiria.
    const lote = await drenarTudo(worker, remetente)
    assert.ok(lote.reservadas >= 1)

    const aviso = remetente.enviadas.find((m) => /Licença anual do ERP/.test(m.assunto))
    assert.ok(aviso, 'nenhum aviso de aprovação foi enviado')
    assert.match(aviso!.assunto, /Aprovação nível 1/)
    // O valor formatado em reais no corpo: quem decide precisa do número, não
    // de um link para descobri-lo.
    assert.match(aviso!.texto, /20\.000,00/)
    assert.match(aviso!.texto, /Solicitado por/)
  })

  it('a decisão avisa o solicitante, aprovada ou rejeitada', async () => {
    const remetente = new RemetenteRegistro(200, () => undefined)
    const criador = await token({ permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '20000.0000', descricao: 'Manutenção predial' })
    await drenarTudo(worker, remetente)

    const n1 = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })
    await chamar(api, 'POST', `/api/v1/contas-pagar/${t.corpo.data.id}/aprovacoes/1/decidir`, {
      token: n1,
      corpo: { decisao: 'REJEITADO', justificativa: 'orçamento do centro de custo já esgotado' },
    })

    await drenarTudo(worker, remetente)
    const aviso = remetente.enviadas.find((m) => /rejeitado.*Manutenção predial/.test(m.assunto))
    assert.ok(aviso, 'o solicitante não foi avisado da rejeição')
    // A justificativa vai na mensagem: sem ela, o aviso diz "foi rejeitado" e
    // o solicitante tem de abrir o sistema para saber o que corrigir.
    assert.match(aviso!.texto, /orçamento do centro de custo já esgotado/)
  })
})

describe('pagamento', () => {
  async function tituloAprovado(t: string, valor = '3000.0000') {
    const r = await criar(t, { valor_original: valor })
    assert.equal(r.corpo.data.status, 'APROVADO')
    return r.corpo.data.id as string
  }

  it('a baixa debita a conta e o parcial recalcula o saldo', async () => {
    const t = await token({ permissoes: [...TUDO] })
    const id = await tituloAprovado(t, '1000.0000')

    const antes = await chamar(api, 'GET', `/api/v1/contas-bancarias/${CONTA_OPERACAO}`, {
      token: await token({ permissoes: ['conta_bancaria:ler'] }),
    })

    const parcial = await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/pagamentos`, {
      token: t,
      cabecalhos: chave(),
      corpo: {
        valor_pago: '400.0000',
        data_pagamento: '2026-08-20',
        conta_id: CONTA_OPERACAO,
        forma: 'PIX',
      },
    })
    assert.equal(parcial.status, 201)
    assert.equal(parcial.corpo.data.status, 'PAGO_PARCIAL')
    assert.equal(parcial.corpo.data.saldo, '600.0000')

    // A baixa e a movimentação numa transação só: um pagamento sem movimentação
    // é um título quitado que não saiu de conta nenhuma.
    assert.ok(parcial.corpo.data.pagamentos[0].movimentacao_id)
    const depois = await chamar(api, 'GET', `/api/v1/contas-bancarias/${CONTA_OPERACAO}`, {
      token: await token({ permissoes: ['conta_bancaria:ler'] }),
    })
    assert.equal(
      Number(antes.corpo.data.saldo_atual) - Number(depois.corpo.data.saldo_atual),
      400,
    )

    const resto = await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/pagamentos`, {
      token: t,
      cabecalhos: chave(),
      corpo: {
        valor_pago: '600.0000',
        data_pagamento: '2026-08-21',
        conta_id: CONTA_OPERACAO,
        forma: 'PIX',
      },
    })
    assert.equal(resto.corpo.data.status, 'PAGO')
    assert.equal(resto.corpo.data.saldo, '0.0000')
  })

  it('pagamento acima do saldo é recusado, e não vira crédito', async () => {
    const t = await token({ permissoes: [...TUDO] })
    const id = await tituloAprovado(t, '500.0000')

    const r = await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/pagamentos`, {
      token: t,
      cabecalhos: chave(),
      corpo: {
        valor_pago: '900.0000',
        data_pagamento: '2026-08-20',
        conta_id: CONTA_OPERACAO,
        forma: 'PIX',
      },
    })
    // Um crédito que ninguém pediu aparece depois como saldo a favor sem
    // origem, e a conciliação ganha uma linha órfã.
    assert.equal(r.status, 422)
    assert.ok(r.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'AJUSTAR_VALOR'))
  })

  it('título ainda em aprovação não recebe pagamento', async () => {
    const t = await token({ permissoes: [...TUDO] })
    const criado = await criar(t, { valor_original: '20000.0000' })

    const r = await chamar(api, 'POST', `/api/v1/contas-pagar/${criado.corpo.data.id}/pagamentos`, {
      token: t,
      cabecalhos: chave(),
      corpo: {
        valor_pago: '100.0000',
        data_pagamento: '2026-08-20',
        conta_id: CONTA_OPERACAO,
        forma: 'PIX',
      },
    })
    assert.equal(r.status, 422)
  })

  it('o estorno devolve o valor e o título volta a dever', async () => {
    const t = await token({ permissoes: [...TUDO] })
    const id = await tituloAprovado(t, '800.0000')

    const pago = await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/pagamentos`, {
      token: t,
      cabecalhos: chave(),
      corpo: {
        valor_pago: '800.0000',
        data_pagamento: '2026-08-20',
        conta_id: CONTA_OPERACAO,
        forma: 'TRANSFERENCIA',
      },
    })
    assert.equal(pago.corpo.data.status, 'PAGO')
    const pagamentoId = pago.corpo.data.pagamentos[0].id

    const estornado = await chamar(
      api,
      'POST',
      `/api/v1/contas-pagar/${id}/pagamentos/${pagamentoId}/estornar`,
      { token: t, cabecalhos: chave(), corpo: { motivo: 'pagamento em duplicidade' } },
    )
    assert.equal(estornado.status, 200)
    // Um título "pago" com dinheiro em aberto sairia de toda fila de pagamento.
    assert.notEqual(estornado.corpo.data.status, 'PAGO')
    assert.equal(estornado.corpo.data.saldo, '800.0000')
    // E o pagamento original continua no histórico, marcado.
    assert.equal(estornado.corpo.data.pagamentos.length, 1)
    assert.ok(estornado.corpo.data.pagamentos[0].estornado_em)

    const denovo = await chamar(
      api,
      'POST',
      `/api/v1/contas-pagar/${id}/pagamentos/${pagamentoId}/estornar`,
      { token: t, cabecalhos: chave(), corpo: { motivo: 'tentando de novo' } },
    )
    assert.equal(denovo.status, 422)
  })

  it('baixar exige a permissão própria', async () => {
    const criador = await token({ permissoes: [...CRIADOR] })
    const id = await tituloAprovado(criador, '100.0000')

    const r = await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/pagamentos`, {
      token: criador,
      cabecalhos: chave(),
      corpo: {
        valor_pago: '100.0000',
        data_pagamento: '2026-08-20',
        conta_id: CONTA_OPERACAO,
        forma: 'PIX',
      },
    })
    assert.equal(r.status, 403)
  })
})

describe('ajuste de valor e cancelamento', () => {
  it('o ajuste muda o devido e não pode ficar abaixo do já pago', async () => {
    const t = await token({ permissoes: [...TUDO] })
    const criado = await criar(t, { valor_original: '1000.0000' })
    const id = criado.corpo.data.id

    const ajustado = await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/ajuste-valor`, {
      token: t,
      cabecalhos: { 'if-match': `"${criado.corpo.data.version}"` },
      corpo: { valor_ajustado: '1150.0000', motivo: 'multa de 15% por atraso' },
    })
    assert.equal(ajustado.status, 200)
    assert.equal(ajustado.corpo.data.valor_devido, '1150.0000')
    assert.equal(ajustado.corpo.data.valor_original, '1000.0000')

    await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/pagamentos`, {
      token: t,
      cabecalhos: chave(),
      corpo: {
        valor_pago: '900.0000',
        data_pagamento: '2026-08-20',
        conta_id: CONTA_OPERACAO,
        forma: 'PIX',
      },
    })

    // Reduzir para 300 com 900 pagos deixaria saldo negativo — e o gatilho
    // marcaria PAGO com dinheiro pago a mais, sem onde registrar a diferença.
    const atual = await chamar(api, 'GET', `/api/v1/contas-pagar/${id}`, { token: t })
    const abaixo = await chamar(api, 'POST', `/api/v1/contas-pagar/${id}/ajuste-valor`, {
      token: t,
      cabecalhos: { 'if-match': `"${atual.corpo.data.version}"` },
      corpo: { valor_ajustado: '300.0000', motivo: 'desconto negociado grande' },
    })
    assert.equal(abaixo.status, 422)
    assert.ok(abaixo.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'ESTORNAR_PRIMEIRO'))
  })

  it('editar só em PENDENTE, e a recusa distingue estado de conflito', async () => {
    const t = await token({ permissoes: [...TUDO] })
    const emAprovacao = await criar(t, { valor_original: '20000.0000' })

    const r = await chamar(api, 'PATCH', `/api/v1/contas-pagar/${emAprovacao.corpo.data.id}`, {
      token: t,
      corpo: { descricao: 'Tentando editar depois de enviar' },
      cabecalhos: { 'if-match': `"${emAprovacao.corpo.data.version}"` },
    })
    // "Conflito de versão" e "estado não permite" são coisas diferentes: a
    // primeira pede recarregar, a segunda pede outra ação.
    assert.equal(r.status, 422)
    assert.equal(r.corpo.code, 'TRANSICAO_INVALIDA')
    assert.ok(r.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'AJUSTAR_VALOR'))
  })

  it('cancelar o pai propõe a cascata e exige confirmação; a paga é preservada', async () => {
    const t = await token({ permissoes: [...TUDO] })
    const pai = await criar(t, { valor_original: '900.0000', parcelas: 3 })
    const paiId = pai.corpo.data.id

    const lista = await chamar(api, 'GET', '/api/v1/contas-pagar?limit=100', { token: t })
    const filhas = lista.corpo.data.filter(
      (x: { titulo_pai_id: string | null }) => x.titulo_pai_id === paiId,
    )
    assert.equal(filhas.length, 3)

    // Paga a primeira: o dinheiro saiu, e ela não pode ser cancelada.
    await chamar(api, 'POST', `/api/v1/contas-pagar/${filhas[0].id}/pagamentos`, {
      token: t,
      cabecalhos: chave(),
      corpo: {
        valor_pago: filhas[0].valor_devido,
        data_pagamento: '2026-08-20',
        conta_id: CONTA_OPERACAO,
        forma: 'PIX',
      },
    })

    const semConfirmar = await chamar(api, 'POST', `/api/v1/contas-pagar/${paiId}/cancelar`, {
      token: t,
      corpo: { motivo: 'contrato do fornecedor encerrado' },
    })
    // Cascata silenciosa é destruição que o operador só descobre depois.
    assert.equal(semConfirmar.status, 422)
    assert.ok(
      semConfirmar.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'CONFIRMAR_CASCATA'),
    )
    assert.match(semConfirmar.corpo.detail, /preservada/)

    const confirmado = await chamar(api, 'POST', `/api/v1/contas-pagar/${paiId}/cancelar`, {
      token: t,
      corpo: { motivo: 'contrato do fornecedor encerrado', cancelar_parcelas_pendentes: true },
    })
    assert.equal(confirmado.corpo.data.status, 'CANCELADO')

    const depois = await chamar(api, 'GET', `/api/v1/contas-pagar/${filhas[0].id}`, { token: t })
    assert.notEqual(depois.corpo.data.status, 'CANCELADO')
  })

  it('título com pagamento em pé não se cancela', async () => {
    const t = await token({ permissoes: [...TUDO] })
    const criado = await criar(t, { valor_original: '200.0000' })
    await chamar(api, 'POST', `/api/v1/contas-pagar/${criado.corpo.data.id}/pagamentos`, {
      token: t,
      cabecalhos: chave(),
      corpo: {
        valor_pago: '200.0000',
        data_pagamento: '2026-08-20',
        conta_id: CONTA_OPERACAO,
        forma: 'PIX',
      },
    })

    const r = await chamar(api, 'POST', `/api/v1/contas-pagar/${criado.corpo.data.id}/cancelar`, {
      token: t,
      corpo: { motivo: 'lançado por engano' },
    })
    assert.equal(r.status, 422)
    assert.ok(r.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'ESTORNAR'))
  })

  it('cancelar exige permissão própria: desfaz o trabalho de quem aprovou', async () => {
    const criador = await token({ permissoes: [...CRIADOR] })
    const criado = await criar(criador, { valor_original: '100.0000' })

    const r = await chamar(api, 'POST', `/api/v1/contas-pagar/${criado.corpo.data.id}/cancelar`, {
      token: criador,
      corpo: { motivo: 'lançado por engano' },
    })
    assert.equal(r.status, 403)
  })
})

describe('delegação', () => {
  it('a delegação vigente habilita o delegado, e o delegante é quem chama', async () => {
    const gestor = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })
    const hoje = new Date().toISOString().slice(0, 10)
    const daqui = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)

    const criada = await chamar(api, 'POST', '/api/v1/delegacoes-aprovacao', {
      token: gestor,
      cabecalhos: chave(),
      corpo: {
        delegado_id: USUARIO_COMPRADOR,
        nivel: 1,
        inicio: hoje,
        fim: daqui,
        motivo: 'férias de agosto',
      },
    })
    assert.equal(criada.status, 201)

    const lista = await chamar(api, 'GET', '/api/v1/delegacoes-aprovacao?apenas_vigentes=true', {
      token: gestor,
    })
    const minha = lista.corpo.data.find((d: { id: string }) => d.id === criada.corpo.data.id)
    assert.ok(minha)
    // O delegante é sempre quem chama: aceitá-lo no corpo permitiria delegar a
    // autoridade de outra pessoa — o caminho mais curto para contornar a
    // segregação de funções.
    assert.equal(minha.delegante_id, APROVADOR_N1)
    assert.equal(minha.vigente, true)

    // E o delegado passa a poder decidir o nível, sem nenhuma outra ação.
    const criador = await token({ permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '20000.0000' })
    // O delegado não pode ser quem lançou: a delegação transfere autoridade,
    // não dispensa a segregação de funções.
    const delegado = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...TUDO] })
    const decidiu = await chamar(
      api,
      'POST',
      `/api/v1/contas-pagar/${t.corpo.data.id}/aprovacoes/1/decidir`,
      { token: delegado, corpo: { decisao: 'APROVADO' } },
    )
    assert.equal(decidiu.status, 200)
    // E fica registrado que a autoridade veio de uma delegação.
    const nivel1 = decidiu.corpo.data.aprovacoes.find((a: { nivel: number }) => a.nivel === 1)
    assert.equal(nivel1.delegado_de, APROVADOR_N1)
  })

  it('duas delegações sobrepostas do mesmo nível são recusadas', async () => {
    const diretor = await token({ usuario: APROVADOR_N3, permissoes: [...TUDO] })
    const hoje = new Date().toISOString().slice(0, 10)
    const daqui = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)

    const corpo = {
      delegado_id: APROVADOR_N2,
      nivel: 3,
      inicio: hoje,
      fim: daqui,
      motivo: 'viagem',
    }
    assert.equal(
      (await chamar(api, 'POST', '/api/v1/delegacoes-aprovacao', {
        token: diretor,
        cabecalhos: chave(),
        corpo,
      })).status,
      201,
    )

    // Duas delegações sobrepostas fariam "quem aprova hoje?" ter duas
    // respostas, decididas pela ordem da consulta.
    const segunda = await chamar(api, 'POST', '/api/v1/delegacoes-aprovacao', {
      token: diretor,
      cabecalhos: chave(),
      corpo: { ...corpo, delegado_id: APROVADOR_N1 },
    })
    assert.equal(segunda.status, 422)
    assert.match(segunda.corpo.detail, /duas respostas/)
  })

  it('delegar para si mesmo é recusado', async () => {
    const gestor = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })
    const hoje = new Date().toISOString().slice(0, 10)

    const r = await chamar(api, 'POST', '/api/v1/delegacoes-aprovacao', {
      token: gestor,
      cabecalhos: chave(),
      corpo: { delegado_id: APROVADOR_N1, nivel: 1, inicio: hoje, fim: hoje, motivo: 'nada' },
    })
    assert.equal(r.status, 422)
  })

  it('delegar exige permissão própria, separada de aprovar', async () => {
    const soAprovador = await token({
      usuario: APROVADOR_N1,
      permissoes: ['pagar:ler', 'pagar:aprovar'],
    })
    const hoje = new Date().toISOString().slice(0, 10)

    const r = await chamar(api, 'POST', '/api/v1/delegacoes-aprovacao', {
      token: soAprovador,
      cabecalhos: chave(),
      corpo: { delegado_id: USUARIO_A, nivel: 1, inicio: hoje, fim: hoje, motivo: 'teste' },
    })
    // Quem aprova não precisa poder transferir a própria autoridade.
    assert.equal(r.status, 403)
  })
})

describe('isolamento', () => {
  it('título de outro locatário não é visível nem endereçável', async () => {
    const alfa = await token({ permissoes: [...CRIADOR] })
    const criado = await criar(alfa)

    const beta = await token({
      tenant: '22222222-2222-4222-8222-222222222222',
      usuario: '22222222-2222-4222-8222-222222220001',
      permissoes: [...TUDO],
    })

    const lista = await chamar(api, 'GET', '/api/v1/contas-pagar?limit=100', { token: beta })
    assert.equal(
      lista.corpo.data.filter((x: { id: string }) => x.id === criado.corpo.data.id).length,
      0,
    )

    // "Não existe" e "existe mas não é seu" devolvem a mesma coisa: distinguir
    // confirma a existência de um registro alheio.
    const direto = await chamar(api, 'GET', `/api/v1/contas-pagar/${criado.corpo.data.id}`, {
      token: beta,
    })
    assert.equal(direto.status, 404)
  })
})
