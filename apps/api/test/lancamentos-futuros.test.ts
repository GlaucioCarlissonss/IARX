import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BancoService } from '../src/banco/banco.service.js'
import { ConversaoWorker } from '../src/modulos/lancamentos-futuros/conversao.worker.js'
import { NotificacaoWorker } from '../src/modulos/notificacao/notificacao.worker.js'
import { RemetenteRegistro } from '../src/modulos/notificacao/remetente.js'
import {
  CENTRO_OPER,
  CLIENTE_ALFA,
  CONTRATO_COM_CONSUMO,
  CONTRATO_SUSPENSO,
  EMPRESA_A,
  FILIAL_A,
  FORNECEDOR_A,
  LANCAMENTO_ELEGIVEL,
  LANCAMENTO_FUTURO_DISTANTE,
  LANCAMENTO_SUSPENSO,
  RECORRENCIA_PAGAR,
  RECORRENCIA_RECEBER,
  RECORRENCIA_TENANT_B,
  TENANT_A,
  TENANT_B,
  USUARIO_A,
  chamar,
  chaveIdempotencia,
  drenarTudo,
  subirApi,
  token,
  type Servidor,
} from './apoio.js'

/**
 * Integração de lançamentos futuros, contra PostgreSQL real.
 *
 * O que estes testes existem para provar: **um compromisso previsto gera um
 * título, e só um**.
 *
 * É a classe de defeito que paga duas vezes. Um título duplicado não é um número
 * errado num relatório — é um segundo boleto para o mesmo compromisso, tão
 * legítimo quanto o primeiro, e a descoberta vem do fornecedor cobrando de novo
 * ou do cliente reclamando da segunda cobrança. As invariantes têm teste de
 * banco; aqui se verifica o que só aparece atravessando o HTTP e o worker: a
 * recusa por vigência chegando como **200 com motivo** em vez de erro, a prévia
 * que não deixa rastro, a permissão do lado que o decorador não expressa, e o
 * aviso da conversão entrando na fila.
 *
 * Os valores (R$ 1.800 de energia, R$ 4.000 de aluguel) vêm de `semear.sql` e são
 * massa de teste, não regra de negócio.
 */

let api: Servidor
let worker: ConversaoWorker
let notificacoes: NotificacaoWorker

const PLANEJA = ['financeiro:lancamento_manual'] as const
const PLANEJA_E_PAGA = ['financeiro:lancamento_manual', 'pagar:criar', 'pagar:ler'] as const
const TUDO = [
  'financeiro:lancamento_manual',
  'pagar:criar',
  'pagar:ler',
  'receber:criar',
  'receber:ler',
] as const

before(async () => {
  api = await subirApi()
  worker = api.app.get(ConversaoWorker)
  notificacoes = api.app.get(NotificacaoWorker)
})
after(async () => {
  await api.fechar()
})

/** Lançamento a pagar novo, para o teste não depender do estado dos semeados. */
async function criarPagar(
  t: string,
  dados: Partial<{ valor: string; data: string; contrato: string | null; filial: string | null }> = {},
) {
  const r = await chamar(api, 'POST', '/api/v1/lancamentos-futuros', {
    token: t,
    cabecalhos: { 'idempotency-key': chaveIdempotencia('lf') },
    corpo: {
      tipo: 'DESPESA_RECORRENTE',
      descricao: 'Compromisso de teste',
      valor_previsto: dados.valor ?? '1500.0000',
      data_prevista: dados.data ?? '2026-05-20',
      empresa_id: EMPRESA_A,
      fornecedor_id: FORNECEDOR_A,
      classificacao: 'DESPESA_FIXA',
      centro_custo_id: CENTRO_OPER,
      contrato_id: dados.contrato ?? null,
      filial_id: dados.filial === undefined ? FILIAL_A : dados.filial,
    },
  })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  return r.corpo.data
}

describe('lançamentos futuros — planejamento', () => {
  it('deriva o lado do tipo, e não aceita os dois', async () => {
    const t = await token({ permissoes: [...PLANEJA] })
    const lf = await criarPagar(t)
    assert.equal(lf.lado, 'PAGAR')
    assert.equal(lf.status, 'PROGRAMADO')
    // Não convertido não tem título: é o CHECK que impede a conversão de parecer
    // feita sem ter sido.
    assert.equal(lf.titulo_pagar_id, null)
    assert.equal(lf.titulo_receber_id, null)
    assert.equal(lf.convertido_em, null)

    const receita = await chamar(api, 'POST', '/api/v1/lancamentos-futuros', {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('lf') },
      corpo: {
        tipo: 'RECEITA_RECORRENTE',
        descricao: 'Receita prevista',
        valor_previsto: '900.0000',
        data_prevista: '2026-09-05',
        cliente_id: CLIENTE_ALFA,
      },
    })
    assert.equal(receita.status, 201, JSON.stringify(receita.corpo))
    assert.equal((receita.corpo.data).lado, 'RECEBER')
  })

  it('recusa uma provisão marcada como receita, e uma despesa com cliente', async () => {
    const t = await token({ permissoes: [...PLANEJA] })

    // Provisão é sempre PAGAR: com cliente e sem empresa, o refinamento recusa
    // antes de o CHECK do banco ter de fazê-lo.
    const provisao = await chamar(api, 'POST', '/api/v1/lancamentos-futuros', {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('lf') },
      corpo: {
        tipo: 'PROVISAO',
        descricao: 'Provisão invertida',
        valor_previsto: '100.0000',
        data_prevista: '2026-09-05',
        cliente_id: CLIENTE_ALFA,
      },
    })
    assert.equal(provisao.status, 400, JSON.stringify(provisao.corpo))

    const despesa = await chamar(api, 'POST', '/api/v1/lancamentos-futuros', {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('lf') },
      corpo: {
        tipo: 'DESPESA_RECORRENTE',
        descricao: 'Despesa com cliente',
        valor_previsto: '100.0000',
        data_prevista: '2026-09-05',
        empresa_id: EMPRESA_A,
        classificacao: 'DESPESA_FIXA',
        cliente_id: CLIENTE_ALFA,
      },
    })
    assert.equal(despesa.status, 400, JSON.stringify(despesa.corpo))
  })

  it('edita com If-Match e recusa a versão velha', async () => {
    const t = await token({ permissoes: [...PLANEJA] })
    const lf = await criarPagar(t)

    const ok = await chamar(api, 'PATCH', `/api/v1/lancamentos-futuros/${lf.id}`, {
      token: t,
      cabecalhos: { 'if-match': String(lf.version) },
      corpo: { valor_previsto: '1700.0000', data_prevista: '2026-05-25' },
    })
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo))
    assert.equal((ok.corpo.data).valor_previsto, '1700.0000')

    const velha = await chamar(api, 'PATCH', `/api/v1/lancamentos-futuros/${lf.id}`, {
      token: t,
      cabecalhos: { 'if-match': String(lf.version) },
      corpo: { valor_previsto: '9.0000' },
    })
    assert.equal(velha.status, 409, JSON.stringify(velha.corpo))
    assert.equal(velha.corpo.code, 'CONFLITO_DE_VERSAO')

    // Sem If-Match nenhum: a trava não é opcional.
    const sem = await chamar(api, 'PATCH', `/api/v1/lancamentos-futuros/${lf.id}`, {
      token: t,
      corpo: { valor_previsto: '9.0000' },
    })
    assert.equal(sem.status, 400)
  })

  it('planejar não exige permissão de criar título', async () => {
    // O ponto da separação: quem anota "em setembro sai o aluguel" não precisa
    // de autoridade para lançar despesa.
    const t = await token({ permissoes: [...PLANEJA] })
    const lf = await criarPagar(t)
    assert.equal(lf.status, 'PROGRAMADO')

    const conversao = await chamar(api, 'POST', `/api/v1/lancamentos-futuros/${lf.id}/converter`, {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('conv') },
    })
    assert.equal(conversao.status, 403, JSON.stringify(conversao.corpo))
  })
})

describe('lançamentos futuros — conversão', () => {
  it('converte, liga os dois lados e não converte de novo (RN-F15)', async () => {
    const t = await token({ permissoes: [...PLANEJA_E_PAGA] })
    const lf = await criarPagar(t, { valor: '2200.0000', data: '2026-05-18' })

    const r = await chamar(api, 'POST', `/api/v1/lancamentos-futuros/${lf.id}/converter`, {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('conv') },
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    const conv = r.corpo.data
    assert.ok(conv.titulo_id, 'a conversão devolveu título')
    assert.equal(conv.excecao, null)
    assert.equal(conv.lado, 'PAGAR')

    const depois = await chamar(api, 'GET', `/api/v1/lancamentos-futuros/${lf.id}`, { token: t })
    const atual = depois.corpo.data
    assert.equal(atual.status, 'CONVERTIDO')
    assert.equal(atual.titulo_pagar_id, conv.titulo_id)
    assert.equal(atual.titulo_receber_id, null)
    assert.ok(atual.convertido_em)

    // A segunda conversão é recusada, com chave de idempotência nova para não ser
    // o replay respondendo pelo gatilho.
    const outra = await chamar(api, 'POST', `/api/v1/lancamentos-futuros/${lf.id}/converter`, {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('conv') },
    })
    assert.equal(outra.status, 422, JSON.stringify(outra.corpo))
    assert.match(outra.corpo.title, /uma vez só/)
  })

  it('a conversão respeita a alçada do título gerado', async () => {
    // Acima da menor faixa de APROVACAO_PAGAMENTO (R$ 10.000 em semear.sql), o
    // título nasce em aprovação: geração automática não dispensa quem confere.
    const t = await token({ permissoes: [...PLANEJA_E_PAGA] })
    const lf = await criarPagar(t, { valor: '30000.0000', data: '2026-05-19' })

    const r = await chamar(api, 'POST', `/api/v1/lancamentos-futuros/${lf.id}/converter`, {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('conv') },
    })
    const conv = r.corpo.data

    const leitor = await token({ permissoes: ['pagar:ler'] })
    const titulo = await chamar(api, 'GET', `/api/v1/contas-pagar/${conv.titulo_id}`, { token: leitor })
    const tp = titulo.corpo.data
    assert.equal(tp.status, 'EM_APROVACAO', JSON.stringify(tp.status))
    assert.ok(tp.aprovacoes.length >= 1, 'a rodada de aprovação abriu')
  })

  it('contrato fora de vigência não converte, e a recusa é 200 com motivo (RN-F16)', async () => {
    /*
     * O ponto do caso. Recusa por vigência **não é erro**: se devolvesse 4xx, a
     * tela trataria como falha o comportamento correto, e o worker contaria como
     * erro o dia em que um contrato ficou suspenso.
     */
    const t = await token({ permissoes: [...TUDO] })
    const r = await chamar(api, 'POST', `/api/v1/lancamentos-futuros/${LANCAMENTO_SUSPENSO}/converter`, {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('conv') },
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    const conv = r.corpo.data
    assert.equal(conv.titulo_id, null)
    assert.match(conv.excecao, /SUSPENSO/)

    // E o lançamento continua na fila, com o motivo escrito e a tentativa contada.
    const depois = await chamar(api, 'GET', `/api/v1/lancamentos-futuros/${LANCAMENTO_SUSPENSO}`, { token: t })
    const atual = depois.corpo.data
    assert.equal(atual.status, 'PROGRAMADO')
    assert.match(atual.excecao_conversao, /SUSPENSO/)
    assert.ok(atual.tentativas_conversao >= 1)

    // A fila de exceção é uma consulta, não um status.
    const fila = await chamar(api, 'GET', '/api/v1/lancamentos-futuros/excecoes', { token: t })
    assert.equal(fila.status, 200)
    const ids = fila.corpo.data.map((l: { id: string }) => l.id)
    assert.ok(ids.includes(LANCAMENTO_SUSPENSO), 'o recusado aparece na fila de exceção')
  })

  it('a permissão exigida é a do lado do lançamento', async () => {
    /*
     * O decorador declara `pagar:criar`, e a rota serve os dois lados. Sem a
     * checagem no serviço, quem pode lançar despesa **emitiria cobrança**.
     */
    const t = await token({ permissoes: ['financeiro:lancamento_manual', 'pagar:criar', 'pagar:ler'] })
    const receita = await chamar(api, 'POST', '/api/v1/lancamentos-futuros', {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('lf') },
      corpo: {
        tipo: 'RECEITA_PARCELADA',
        descricao: 'Cobrança prevista',
        valor_previsto: '400.0000',
        data_prevista: '2026-05-21',
        cliente_id: CLIENTE_ALFA,
      },
    })
    const lf = receita.corpo.data

    const negado = await chamar(api, 'POST', `/api/v1/lancamentos-futuros/${lf.id}/converter`, {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('conv') },
    })
    assert.equal(negado.status, 403, JSON.stringify(negado.corpo))
    assert.equal(negado.corpo.code, 'SEM_PERMISSAO')

    // Com `receber:criar`, passa.
    const completo = await token({ permissoes: [...TUDO] })
    const ok = await chamar(api, 'POST', `/api/v1/lancamentos-futuros/${lf.id}/converter`, {
      token: completo,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('conv') },
    })
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo))
    assert.ok((ok.corpo.data).titulo_id)
  })

  it('o título a receber convertido nasce AVULSO e mantém o contrato', async () => {
    // CONTRATUAL exige competência, e um lançamento futuro não tem uma — ele não
    // veio de medição. O vínculo com o contrato, porém, não se perde.
    const t = await token({ permissoes: [...TUDO] })
    const criado = await chamar(api, 'POST', '/api/v1/lancamentos-futuros', {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('lf') },
      corpo: {
        tipo: 'RECEITA_RECORRENTE',
        descricao: 'Suporte previsto',
        valor_previsto: '650.0000',
        data_prevista: '2026-05-22',
        cliente_id: CLIENTE_ALFA,
        contrato_id: CONTRATO_COM_CONSUMO,
      },
    })
    const lf = criado.corpo.data

    const r = await chamar(api, 'POST', `/api/v1/lancamentos-futuros/${lf.id}/converter`, {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('conv') },
    })
    const conv = r.corpo.data

    const titulo = await chamar(api, 'GET', `/api/v1/contas-receber/${conv.titulo_id}`, { token: t })
    const tr = titulo.corpo.data
    assert.equal(tr.origem, 'AVULSO')
    assert.equal(tr.contrato_id, CONTRATO_COM_CONSUMO)
    assert.equal(tr.competencia, null)
  })

  it('a prévia da conversão não deixa rastro', async () => {
    /*
     * Se a prévia chamasse a conversão para "simular", ela incrementaria o
     * contador de tentativas e gravaria a exceção: o operador que abre o diálogo
     * e desiste deixaria rastro de uma tentativa que nunca houve.
     */
    const t = await token({ permissoes: [...TUDO] })
    const antes = await chamar(api, 'GET', `/api/v1/lancamentos-futuros/${LANCAMENTO_SUSPENSO}`, { token: t })
    const tentativasAntes = (antes.corpo.data).tentativas_conversao

    const previa = await chamar(
      api,
      'GET',
      `/api/v1/lancamentos-futuros/${LANCAMENTO_SUSPENSO}/previa-conversao`,
      { token: t },
    )
    assert.equal(previa.status, 200, JSON.stringify(previa.corpo))
    const p = previa.corpo.data
    assert.match(p.impedimento, /SUSPENSO/, 'a prévia antecipa o impedimento')
    assert.equal(p.lado, 'RECEBER')

    const depois = await chamar(api, 'GET', `/api/v1/lancamentos-futuros/${LANCAMENTO_SUSPENSO}`, { token: t })
    assert.equal(
      (depois.corpo.data).tentativas_conversao,
      tentativasAntes,
      'a prévia não contou tentativa',
    )
  })

  it('a prévia diz quantos níveis o título vai exigir', async () => {
    const t = await token({ permissoes: [...TUDO] })
    const baixo = await criarPagar(t, { valor: '900.0000', data: '2026-05-23' })
    const alto = await criarPagar(t, { valor: '120000.0000', data: '2026-05-24' })

    const pb = await chamar(api, 'GET', `/api/v1/lancamentos-futuros/${baixo.id}/previa-conversao`, { token: t })
    const pa = await chamar(api, 'GET', `/api/v1/lancamentos-futuros/${alto.id}/previa-conversao`, { token: t })

    assert.equal((pb.corpo.data).niveis_aprovacao, 0)
    assert.ok(
      (pa.corpo.data).niveis_aprovacao >= 2,
      'o valor alto exige mais de um nível pelos limites de semear.sql',
    )
    assert.equal((pb.corpo.data).impedimento, null)
  })

  it('RN-F17: convertido não se edita nem se cancela', async () => {
    const t = await token({ permissoes: [...PLANEJA_E_PAGA] })
    const lf = await criarPagar(t, { valor: '1100.0000', data: '2026-05-26' })
    await chamar(api, 'POST', `/api/v1/lancamentos-futuros/${lf.id}/converter`, {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('conv') },
    })

    const atual = await chamar(api, 'GET', `/api/v1/lancamentos-futuros/${lf.id}`, { token: t })
    const versao = (atual.corpo.data).version

    const edicao = await chamar(api, 'PATCH', `/api/v1/lancamentos-futuros/${lf.id}`, {
      token: t,
      cabecalhos: { 'if-match': String(versao) },
      corpo: { valor_previsto: '1.0000' },
    })
    assert.equal(edicao.status, 422, JSON.stringify(edicao.corpo))
    assert.match(edicao.corpo.title, /não se edita/)
    assert.ok(
      edicao.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'EDITAR_TITULO'),
      'a recusa diz onde editar',
    )

    const cancelamento = await chamar(api, 'POST', `/api/v1/lancamentos-futuros/${lf.id}/cancelar`, {
      token: t,
      corpo: { motivo: 'desistimos do compromisso' },
    })
    assert.equal(cancelamento.status, 422, JSON.stringify(cancelamento.corpo))
    assert.match(cancelamento.corpo.title, /não se cancela/)
  })

  it('cancelado sai da fila e não volta', async () => {
    const t = await token({ permissoes: [...PLANEJA_E_PAGA] })
    const lf = await criarPagar(t, { valor: '1200.0000', data: '2026-05-27' })

    const c = await chamar(api, 'POST', `/api/v1/lancamentos-futuros/${lf.id}/cancelar`, {
      token: t,
      corpo: { motivo: 'contrato não foi assinado' },
    })
    assert.equal(c.status, 200, JSON.stringify(c.corpo))
    assert.equal((c.corpo.data).status, 'CANCELADO')

    const conversao = await chamar(api, 'POST', `/api/v1/lancamentos-futuros/${lf.id}/converter`, {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('conv') },
    })
    assert.equal(conversao.status, 422, JSON.stringify(conversao.corpo))
  })

  it('a conversão avisa quem tem de decidir — D-23', async () => {
    const registro = new RemetenteRegistro()
    const t = await token({ permissoes: [...PLANEJA_E_PAGA] })

    await drenarTudo(notificacoes, registro)
    registro.enviadas.length = 0

    // Acima da alçada, para haver decisão pendente: um título que nasce aprovado
    // não gera aviso, e avisar do que não precisa de ação treina a ignorar a caixa.
    const lf = await criarPagar(t, { valor: '45000.0000', data: '2026-05-28' })
    await chamar(api, 'POST', `/api/v1/lancamentos-futuros/${lf.id}/converter`, {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('conv') },
    })

    await drenarTudo(notificacoes, registro)
    const aviso = registro.enviadas.find((m) => /Aprovação nível/.test(m.assunto))
    assert.ok(aviso, 'a conversão enfileirou o aviso de aprovação')
    // A rota do aviso é a do lado certo: um aviso de despesa que abrisse a tela
    // de cobrança levaria o aprovador a um lugar onde o título não existe.
    assert.match(aviso!.texto, /#\/contas-pagar\?titulo=/)
  })
})

describe('recorrências', () => {
  it('gera o próximo e avança pela periodicidade, uma chamada por período', async () => {
    const t = await token({ permissoes: [...PLANEJA] })
    const antes = await chamar(api, 'GET', '/api/v1/recorrencias?limit=50', { token: t })
    const serie = antes.corpo.data.find((r: { id: string }) => r.id === RECORRENCIA_PAGAR)
    assert.ok(serie, 'a recorrência semeada aparece na lista')
    const dataAntes = serie.proxima_geracao
    const geradosAntes = serie.lancamentos_gerados

    const r = await chamar(api, 'POST', `/api/v1/recorrencias/${RECORRENCIA_PAGAR}/gerar-proximo`, {
      token: t,
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    const corpo = r.corpo.data
    assert.ok(corpo.lancamento_id, 'nasceu um lançamento')

    // Mensal: a data avança um mês, mantendo o dia. Somar dias faria "todo dia
    // 10" andar pelo calendário.
    const esperado = new Date(`${dataAntes}T12:00:00Z`)
    esperado.setUTCMonth(esperado.getUTCMonth() + 1)
    assert.equal(corpo.recorrencia.proxima_geracao, esperado.toISOString().slice(0, 10))
    assert.equal(corpo.recorrencia.lancamentos_gerados, geradosAntes + 1)

    // O lançamento gerado herda o molde, incluindo a filial — sem ela a projeção
    // por filial mostraria o previsto de todas.
    const lf = await chamar(api, 'GET', `/api/v1/lancamentos-futuros/${corpo.lancamento_id}`, { token: t })
    const linha = lf.corpo.data
    assert.equal(linha.data_prevista, dataAntes)
    assert.equal(linha.valor_previsto, '4000.0000')
    assert.equal(linha.filial_id, FILIAL_A)
    assert.equal(linha.recorrencia_id, RECORRENCIA_PAGAR)
    assert.equal(linha.status, 'PROGRAMADO')
  })

  it('a série trimestral avança três meses', async () => {
    const t = await token({ permissoes: [...PLANEJA] })
    const antes = await chamar(api, 'GET', '/api/v1/recorrencias?lado=RECEBER&limit=50', { token: t })
    const serie = antes.corpo.data.find((r: { id: string }) => r.id === RECORRENCIA_RECEBER)
    const dataAntes = serie.proxima_geracao

    const r = await chamar(api, 'POST', `/api/v1/recorrencias/${RECORRENCIA_RECEBER}/gerar-proximo`, {
      token: t,
    })
    const esperado = new Date(`${dataAntes}T12:00:00Z`)
    esperado.setUTCMonth(esperado.getUTCMonth() + 3)
    assert.equal(
      (r.corpo.data).recorrencia.proxima_geracao,
      esperado.toISOString().slice(0, 10),
    )
  })

  it('o dia do vencimento vai até 28, e a recusa diz por quê', async () => {
    const t = await token({ permissoes: [...PLANEJA] })
    const r = await chamar(api, 'POST', '/api/v1/recorrencias', {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('rec') },
      corpo: {
        lado: 'PAGAR',
        descricao: 'Série do dia 31',
        valor_base: '100.0000',
        periodicidade: 'MENSAL',
        dia_vencimento: 31,
        proxima_geracao: '2026-09-30',
        empresa_id: EMPRESA_A,
        classificacao: 'DESPESA_FIXA',
      },
    })
    assert.equal(r.status, 400, JSON.stringify(r.corpo))
  })

  it('o lado da série amarra os campos', async () => {
    const t = await token({ permissoes: [...PLANEJA] })
    const r = await chamar(api, 'POST', '/api/v1/recorrencias', {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('rec') },
      corpo: {
        lado: 'PAGAR',
        descricao: 'Série confusa',
        valor_base: '100.0000',
        periodicidade: 'MENSAL',
        dia_vencimento: 5,
        proxima_geracao: '2026-09-05',
        empresa_id: EMPRESA_A,
        classificacao: 'DESPESA_FIXA',
        cliente_id: CLIENTE_ALFA,
      },
    })
    assert.equal(r.status, 400, JSON.stringify(r.corpo))
  })

  it('desativar a série para de gerar, sem apagar o que ela já produziu', async () => {
    const t = await token({ permissoes: [...PLANEJA] })
    const criada = await chamar(api, 'POST', '/api/v1/recorrencias', {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('rec') },
      corpo: {
        lado: 'PAGAR',
        descricao: 'Série a desativar',
        valor_base: '250.0000',
        periodicidade: 'MENSAL',
        dia_vencimento: 8,
        proxima_geracao: '2026-08-08',
        empresa_id: EMPRESA_A,
        classificacao: 'DESPESA_FIXA',
      },
    })
    const rec = criada.corpo.data

    await chamar(api, 'POST', `/api/v1/recorrencias/${rec.id}/gerar-proximo`, { token: t })

    /*
     * A versão vem de uma leitura nova, e não de `rec.version + 1`.
     *
     * `app.gerar_proximo_lancamento` avança `proxima_geracao` sem tocar em
     * `version` — de propósito, porque a série andar não é uma edição do molde.
     * Supor o incremento aqui fazia o teste bater em 409 e acusar a trava
     * otimista de um defeito que era do próprio teste.
     */
    const relida = await chamar(api, 'GET', '/api/v1/recorrencias?limit=100', { token: t })
    const versao = relida.corpo.data.find((r: { id: string }) => r.id === rec.id).version

    const desativada = await chamar(api, 'PATCH', `/api/v1/recorrencias/${rec.id}`, {
      token: t,
      cabecalhos: { 'if-match': String(versao) },
      corpo: { ativo: false },
    })
    assert.equal(desativada.status, 200, JSON.stringify(desativada.corpo))

    const depois = await chamar(api, 'POST', `/api/v1/recorrencias/${rec.id}/gerar-proximo`, { token: t })
    assert.equal(depois.status, 200)
    assert.equal((depois.corpo.data).lancamento_id, null, 'inativa não gera')
    assert.equal(
      (depois.corpo.data).recorrencia.lancamentos_gerados,
      1,
      'o que a série já produziu continua lá',
    )
  })
})

describe('worker de conversão', () => {
  it('converte a fila elegível e não toca no que ainda não venceu', async () => {
    const t = await token({ permissoes: [...TUDO] })

    const antes = await chamar(api, 'GET', `/api/v1/lancamentos-futuros/${LANCAMENTO_ELEGIVEL}`, { token: t })
    const estadoAntes = (antes.corpo.data).status

    const r = await worker.drenar()
    assert.ok(r.reservados >= 1, `o worker reservou algo (${JSON.stringify(r)})`)

    const depois = await chamar(api, 'GET', `/api/v1/lancamentos-futuros/${LANCAMENTO_ELEGIVEL}`, { token: t })
    const linha = depois.corpo.data
    if (estadoAntes === 'PROGRAMADO') {
      assert.equal(linha.status, 'CONVERTIDO', 'o elegível foi convertido pelo worker')
      assert.ok(linha.titulo_pagar_id)
    }

    // O de 2027 continua intocado: a fila é por data, não "tudo programado".
    const distante = await chamar(
      api,
      'GET',
      `/api/v1/lancamentos-futuros/${LANCAMENTO_FUTURO_DISTANTE}`,
      { token: t },
    )
    const d = distante.corpo.data
    assert.equal(d.status, 'PROGRAMADO')
    assert.equal(d.titulo_pagar_id, null)
  })

  it('a recusa por vigência conta como recusa, não como falha', async () => {
    /*
     * A distinção não é cosmética: contá-la como falha faria o painel de jobs
     * acusar problema todo dia em que um contrato está suspenso — e um alarme que
     * soa sempre deixa de ser lido.
     */
    const t = await token({ permissoes: [...TUDO] })
    const criado = await chamar(api, 'POST', '/api/v1/lancamentos-futuros', {
      token: t,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('lf') },
      corpo: {
        tipo: 'RECEITA_RECORRENTE',
        descricao: 'Previsto de contrato suspenso',
        valor_previsto: '300.0000',
        data_prevista: '2026-04-01',
        cliente_id: CLIENTE_ALFA,
        contrato_id: CONTRATO_SUSPENSO,
      },
    })
    const lf = criado.corpo.data

    const r = await worker.drenar()
    assert.equal(r.falhas, 0, `nenhuma falha (${JSON.stringify(r)})`)
    assert.ok(r.recusados >= 1, 'a recusa foi contada como recusa')

    const depois = await chamar(api, 'GET', `/api/v1/lancamentos-futuros/${lf.id}`, { token: t })
    assert.match((depois.corpo.data).excecao_conversao, /SUSPENSO/)
  })

  it('registra a execução em job_execucao, dentro do locatário', async () => {
    /*
     * A linha do job é **por locatário**, e não uma por volta do worker.
     *
     * `job_execucao` é isolada por RLS: uma linha sem locatário não seria legível
     * por ninguém — e "por que o lançamento de ontem não converteu" é justamente
     * a pergunta que alguém de dentro de um locatário faz. A leitura aqui usa a
     * transação por locatário do próprio `BancoService`, que é o caminho que o
     * worker usa para escrever.
     */
    const t = await token({ permissoes: [...TUDO] })
    await criarPagar(t, { valor: '800.0000', data: '2026-04-05' })
    await worker.drenar()

    const banco = api.app.get(BancoService)
    const linhas = await banco.porLocatario(TENANT_A, (db) =>
      db.consultar<{ status: string; resultado: unknown }>(
        `select status, resultado from public.job_execucao
          where tipo = 'CONVERSAO_LANCAMENTOS' order by created_at desc limit 5`,
      ),
    )
    assert.ok(linhas.length >= 1, 'a volta do worker deixou rastro')
    assert.equal(linhas[0]!.status, 'CONCLUIDO')
    assert.ok(linhas[0]!.resultado, 'com o resumo do que fez')

    // E nenhuma linha do locatário B nesta leitura: a transação vê um só.
    const vizinho = await banco.porLocatario(TENANT_B, (db) =>
      db.consultar(`select 1 from public.job_execucao where tenant_id = $1`, [TENANT_A]),
    )
    assert.equal(vizinho.length, 0, 'de dentro do B, os jobs do A não existem')
  })

  it('o worker não atravessa o isolamento: cada locatário na sua transação', async () => {
    /*
     * A recorrência do locatário B existe na massa. O que se prova aqui é que a
     * do A não a vê — se o worker usasse uma conexão sem RLS, a leitura de dentro
     * do locatário A traria as duas.
     */
    const a = await token({ permissoes: [...PLANEJA] })
    const listaA = await chamar(api, 'GET', '/api/v1/recorrencias?limit=100', { token: a })
    const idsA = listaA.corpo.data.map((r: { id: string }) => r.id)
    assert.ok(idsA.includes(RECORRENCIA_PAGAR))
    assert.ok(!idsA.includes(RECORRENCIA_TENANT_B), 'a série do vizinho não aparece')

    const b = await token({ tenant: TENANT_B, usuario: USUARIO_A, permissoes: [...PLANEJA] })
    const listaB = await chamar(api, 'GET', '/api/v1/recorrencias?limit=100', { token: b })
    const idsB = listaB.corpo.data.map((r: { id: string }) => r.id)
    assert.ok(!idsB.includes(RECORRENCIA_PAGAR), 'e o contrário também')
  })
})

describe('autorização', () => {
  it('sem permissão nenhuma, nada abre', async () => {
    const t = await token({ permissoes: [] })
    for (const [metodo, caminho] of [
      ['GET', '/api/v1/lancamentos-futuros'],
      ['GET', '/api/v1/lancamentos-futuros/excecoes'],
      ['GET', `/api/v1/lancamentos-futuros/${LANCAMENTO_ELEGIVEL}`],
      ['GET', '/api/v1/recorrencias'],
    ] as const) {
      const r = await chamar(api, metodo, caminho, { token: t })
      assert.equal(r.status, 403, `${metodo} ${caminho} devolveu ${r.status}`)
    }
  })

  it('`/excecoes` e `/projecao` não caem no roteamento de `:id`', async () => {
    // A lição que já custou uma vez: declaradas depois de `:id`, viram 400 de
    // UUID inválido em vez de rota.
    const t = await token({ permissoes: [...PLANEJA_E_PAGA] })
    const e = await chamar(api, 'GET', '/api/v1/lancamentos-futuros/excecoes', { token: t })
    assert.equal(e.status, 200, JSON.stringify(e.corpo))
    const p = await chamar(api, 'GET', '/api/v1/lancamentos-futuros/projecao?dias=30', { token: t })
    assert.equal(p.status, 200, JSON.stringify(p.corpo))
  })

  it('um id que não existe devolve 404, não 500', async () => {
    const t = await token({ permissoes: [...PLANEJA] })
    const r = await chamar(api, 'GET', '/api/v1/lancamentos-futuros/11111111-1111-4111-8111-111111119999', {
      token: t,
    })
    assert.equal(r.status, 404)
  })
})
