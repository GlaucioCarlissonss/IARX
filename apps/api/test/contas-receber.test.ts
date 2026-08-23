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
  CLIENTE_ALFA,
  COMPETENCIA_ABERTA,
  CONTA_RECEBIMENTO,
  CONTRATO_COM_CONSUMO,
  CONTRATO_SUSPENSO,
  USUARIO_A,
  USUARIO_COMPRADOR,
  chamar,
  drenarTudo,
  subirApi,
  token,
  type Servidor,
} from './apoio.js'

/**
 * Integração de contas a receber, contra PostgreSQL real.
 *
 * O que estes testes existem para provar: **a cobrança não sai sem alguém
 * olhar, e o que não entrou nunca conta como receita**.
 *
 * As duas coisas são invisíveis num teste de caminho felizde. A primeira porque
 * o motor de preço acerta quase sempre — e é justamente por isso que a exceção
 * passa despercebida. A segunda porque um relatório que soma "títulos
 * encerrados" continua fechando consigo mesmo, então a receita aparece inflada
 * exatamente onde ninguém confere.
 *
 * As cinco invariantes já têm teste de banco; aqui se verifica o que só aparece
 * atravessando o HTTP: a fila do aprovador, a prévia do fechamento antes de
 * fechar, a recusa do gatilho chegando como 422 acionável, e o aviso entrando na
 * fila de notificação na mesma transação do fato.
 *
 * Os limites de alçada (2 mil / 20 mil de emissão, 10% de desconto) vêm de
 * `semear.sql` e são massa de teste, não regra de negócio.
 */

let api: Servidor
let worker: NotificacaoWorker

const LEITOR = ['receber:ler'] as const
const CRIADOR = ['receber:ler', 'receber:criar'] as const
const TUDO = [
  'receber:ler',
  'receber:criar',
  'receber:aprovar',
  'receber:baixar',
  'receber:negociar',
  'receber:cancelar',
  'competencia:fechar',
] as const

let seq = 0
const chave = () => ({ 'idempotency-key': `crb-${Date.now()}-${++seq}` })

const AVULSO = {
  cliente_id: CLIENTE_ALFA,
  descricao: 'Serviço de instalação avulso',
  data_emissao: '2026-06-01',
  data_vencimento: '2026-07-01',
}

before(async () => {
  api = await subirApi()
  worker = api.app.get(NotificacaoWorker)
})

after(async () => {
  await api.fechar()
})

/** Cria um título avulso e devolve a resposta. */
async function criar(t: string, extra: Record<string, unknown> = {}) {
  const r = await chamar(api, 'POST', '/api/v1/contas-receber', {
    token: t,
    cabecalhos: chave(),
    corpo: { ...AVULSO, valor_original: '500.0000', ...extra },
  })
  assert.equal(r.status, 201, `criação falhou: ${JSON.stringify(r.corpo)}`)
  return r
}

describe('prévia de alçada de emissão', () => {
  it('devolve os níveis, os limites e o piso do contratual', async () => {
    const t = await token({ permissoes: [...LEITOR] })

    const baixo = await chamar(api, 'POST', '/api/v1/contas-receber/previa-alcada', {
      token: t,
      corpo: { valor: '500.0000' },
    })
    assert.equal(baixo.status, 200)
    assert.equal(baixo.corpo.data.niveis, 0)
    // O piso vai na resposta porque a prévia responde para um **avulso**, onde
    // zero é legítimo. Sem o campo, a tela diria "nenhuma aprovação" e o
    // operador concluiria que a cobrança recorrente também sai sozinha.
    assert.equal(baixo.corpo.data.piso_contratual, 1)
    assert.ok(baixo.corpo.data.limites.length >= 2)

    const alto = await chamar(api, 'POST', '/api/v1/contas-receber/previa-alcada', {
      token: t,
      corpo: { valor: '50000.0000' },
    })
    assert.equal(alto.corpo.data.niveis, 2)
  })

  it('a rota não é engolida pelo :id', async () => {
    // Declarada depois de `:id`, qualquer chamada a /previa-alcada cairia no
    // ParseUUIDPipe e viraria 400 — um erro de rota disfarçado de erro de dado.
    const t = await token({ permissoes: [...LEITOR] })
    const r = await chamar(api, 'POST', '/api/v1/contas-receber/previa-alcada', {
      token: t,
      corpo: { valor: '1.0000' },
    })
    assert.equal(r.status, 200)
  })
})

describe('lançamento avulso', () => {
  it('abaixo da menor faixa nasce aprovado; acima, em aprovação', async () => {
    const t = await token({ permissoes: [...CRIADOR] })

    const pequeno = await criar(t, { valor_original: '500.0000' })
    assert.equal(pequeno.corpo.data.status, 'APROVADO')
    assert.equal(pequeno.corpo.data.aprovacoes.length, 0)
    assert.equal(pequeno.corpo.data.origem, 'AVULSO')

    const grande = await criar(t, { valor_original: '50000.0000' })
    assert.equal(grande.corpo.data.status, 'PENDENTE_APROVACAO')
    assert.equal(grande.corpo.data.aprovacoes.length, 2)
  })

  it('o número é sequencial por locatário, e vem na resposta', async () => {
    const t = await token({ permissoes: [...CRIADOR] })
    const a = await criar(t)
    const b = await criar(t)

    assert.ok(Number.isInteger(a.corpo.data.numero_titulo))
    assert.equal(b.corpo.data.numero_titulo, a.corpo.data.numero_titulo + 1)
  })

  it('o valor líquido é derivado e chega como string', async () => {
    const t = await token({ permissoes: [...CRIADOR] })
    const r = await criar(t, { valor_original: '1234.5600' })

    // `Dinheiro` é string de propósito: um numeric(15,4) com treze dígitos
    // inteiros não cabe num double sem perder o último centavo.
    assert.equal(typeof r.corpo.data.valor_liquido, 'string')
    assert.equal(r.corpo.data.valor_liquido, '1234.5600')
    assert.equal(r.corpo.data.saldo, '1234.5600')
    // E não existe campo de saldo gravado no modelo: ele é sempre calculado.
    assert.ok(!('valor_recebido' in r.corpo.data))
    assert.ok(!('dias_atraso' in r.corpo.data))
  })

  it('o rateio pela metade é recusado antes de chegar ao banco', async () => {
    const t = await token({ permissoes: [...CRIADOR] })
    const r = await chamar(api, 'POST', '/api/v1/contas-receber', {
      token: t,
      cabecalhos: chave(),
      corpo: {
        ...AVULSO,
        valor_original: '500.0000',
        rateio: [{ centro_custo_id: CENTRO_OPER, percentual: 60 }],
      },
    })
    assert.equal(r.status, 400)
  })

  it('o rateio que fecha em 100% é gravado com código e nome do centro', async () => {
    const t = await token({ permissoes: [...CRIADOR] })
    const r = await criar(t, {
      rateio: [
        { centro_custo_id: CENTRO_OPER, percentual: 70 },
        { centro_custo_id: CENTRO_ADM, percentual: 30 },
      ],
    })
    assert.equal(r.corpo.data.rateio.length, 2)
    // Código e nome vêm da consulta: a tela não precisa de uma segunda chamada
    // para saber o que "cc-oper" quer dizer.
    assert.ok(r.corpo.data.rateio.every((x: { centro_custo_codigo: string }) => x.centro_custo_codigo))
  })

  it('não há caminho para criar um contratual à mão', async () => {
    const t = await token({ permissoes: [...TUDO] })
    // `origem`, `contrato_id` e `competencia` não estão no contrato de entrada.
    // Um contratual com valor digitado seria indistinguível do calculado.
    const r = await chamar(api, 'POST', '/api/v1/contas-receber', {
      token: t,
      cabecalhos: chave(),
      corpo: {
        ...AVULSO,
        valor_original: '500.0000',
        origem: 'CONTRATUAL',
        contrato_id: CONTRATO_COM_CONSUMO,
        competencia: '2026-05',
      },
    })
    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.origem, 'AVULSO', 'a origem veio do corpo em vez de ser imposta')
    assert.equal(r.corpo.data.contrato_id, null)
  })

  it('criar exige permissão própria', async () => {
    const t = await token({ permissoes: [...LEITOR] })
    const r = await chamar(api, 'POST', '/api/v1/contas-receber', {
      token: t,
      cabecalhos: chave(),
      corpo: { ...AVULSO, valor_original: '500.0000' },
    })
    assert.equal(r.status, 403)
  })
})

describe('fechamento de competência', () => {
  it('a prévia responde antes de fechar, e não sela nada', async () => {
    const t = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...TUDO] })

    const p1 = await chamar(
      api,
      'GET',
      `/api/v1/competencias/${COMPETENCIA_ABERTA}/previa-fechamento`,
      { token: t },
    )
    assert.equal(p1.status, 200)
    assert.ok(p1.corpo.data.titulos_a_gerar >= 2, JSON.stringify(p1.corpo.data))

    // O contrato suspenso aparece como exceção **antes** de o operador
    // confirmar: descobrir depois que duas cobranças nasceram em disputa é a
    // surpresa que a prévia remove.
    assert.ok(
      p1.corpo.data.excecoes.some((e: { motivo: string }) => /SUSPENSO/.test(e.motivo)),
      `nenhuma exceção de contrato suspenso: ${JSON.stringify(p1.corpo.data.excecoes)}`,
    )

    // Chamar duas vezes não muda nada: a prévia é leitura.
    const p2 = await chamar(
      api,
      'GET',
      `/api/v1/competencias/${COMPETENCIA_ABERTA}/previa-fechamento`,
      { token: t },
    )
    assert.deepEqual(p2.corpo.data, p1.corpo.data)
  })

  it('fechar gera as cobranças, marca a disputa e é idempotente', async () => {
    // Quem fecha é USUARIO_COMPRADOR: assim os aprovadores semeados podem
    // decidir depois. Fechando com um deles, a segregação barraria a decisão.
    const t = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...TUDO] })

    const r = await chamar(api, 'POST', `/api/v1/competencias/${COMPETENCIA_ABERTA}/fechar`, {
      token: t,
      cabecalhos: chave(),
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    assert.ok(r.corpo.data.titulos_criados >= 2, JSON.stringify(r.corpo.data))
    assert.ok(r.corpo.data.em_disputa >= 1)
    assert.ok(r.corpo.data.consumos_selados >= 2)

    const lista = await chamar(
      api,
      'GET',
      `/api/v1/contas-receber?competencia=${COMPETENCIA_ABERTA}&origem=CONTRATUAL&limit=50`,
      { token: t },
    )
    const doAtivo = lista.corpo.data.find(
      (x: { contrato_id: string }) => x.contrato_id === CONTRATO_COM_CONSUMO,
    )
    assert.ok(doAtivo, 'o contrato ativo não gerou título')
    // RN-F10: nasce pendente, com piso de um nível. R$ 369 está abaixo da menor
    // faixa (2 mil), então a contagem crua daria zero.
    assert.equal(doAtivo.status, 'PENDENTE_APROVACAO')
    assert.equal(doAtivo.aprovacoes.length, 1)
    // Mensalidade 289 + excedente (1000 páginas × 0,08) = 369.
    assert.equal(doAtivo.valor_liquido, '369.0000')

    const doSuspenso = lista.corpo.data.find(
      (x: { contrato_id: string }) => x.contrato_id === CONTRATO_SUSPENSO,
    )
    assert.ok(doSuspenso, 'o contrato suspenso não gerou título')
    assert.equal(doSuspenso.status, 'EM_DISPUTA')
    assert.match(doSuspenso.excecao_geracao, /SUSPENSO/)
    // Em disputa não abre rodada: não se aprova a emissão de uma cobrança que
    // já se sabe estar errada.
    assert.equal(doSuspenso.aprovacoes.length, 0)

    // Refechar não duplica. Reprocessar um mês é rotina — alguém corrige uma
    // leitura e refecha —, e a cobrança em dobro chegaria ao cliente.
    const denovo = await chamar(api, 'POST', `/api/v1/competencias/${COMPETENCIA_ABERTA}/fechar`, {
      token: t,
      cabecalhos: chave(),
    })
    assert.equal(denovo.corpo.data.titulos_criados, 0)
    assert.ok(denovo.corpo.data.ja_existiam >= 2)
    assert.equal(denovo.corpo.data.consumos_selados, 0, 'relatou selar o que já estava selado')
  })

  it('o aviso de aprovação entra na fila com a rota certa', async () => {
    const remetente = new RemetenteRegistro(200, () => undefined)
    const lote = await drenarTudo(worker, remetente)
    assert.ok(lote.reservadas >= 1)

    const aviso = remetente.enviadas.find((m) => /competência 2026-06/.test(m.assunto))
    assert.ok(aviso, 'nenhum aviso de aprovação de cobrança foi enviado')
    // A URL tinha de apontar para contas a receber. Fixa em contas-pagar — como
    // era antes deste módulo — levaria o aprovador a uma tela onde o título não
    // existe.
    assert.match(aviso!.texto, /#\/contas-receber\?titulo=/)
    assert.match(aviso!.assunto, /Aprovação nível 1/)
    // O valor vai na mensagem: quem decide precisa do número, não de um link
    // para descobri-lo.
    // `\s` e não um espaço literal: o formatador do `Intl` usa espaço
    // inquebrável entre o símbolo e o número, e a diferença é invisível na
    // leitura do diff.
    assert.match(aviso!.texto, /R\$\s369,00/)
  })

  it('competência malformada é recusada como erro de campo', async () => {
    const t = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...TUDO] })
    const r = await chamar(api, 'POST', '/api/v1/competencias/2026-13/fechar', {
      token: t,
      cabecalhos: chave(),
    })
    assert.equal(r.status, 400)
  })

  it('fechar exige competencia:fechar', async () => {
    const t = await token({ permissoes: [...CRIADOR] })
    const r = await chamar(api, 'POST', '/api/v1/competencias/2026-07/fechar', {
      token: t,
      cabecalhos: chave(),
    })
    assert.equal(r.status, 403)
  })
})

describe('aprovação da emissão', () => {
  it('a fila não oferece a cobrança gerada por quem está pedindo', async () => {
    // O gerador dos contratuais foi USUARIO_COMPRADOR. Ele tem `receber:aprovar`
    // no token, e ainda assim não vê os títulos que gerou.
    const gerador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...TUDO] })
    const fila = await chamar(api, 'GET', '/api/v1/contas-receber?minha_aprovacao=true&limit=50', {
      token: gerador,
    })
    assert.equal(fila.status, 200)
    assert.equal(
      fila.corpo.data.filter((x: { origem: string; competencia: string }) =>
        x.origem === 'CONTRATUAL' && x.competencia === COMPETENCIA_ABERTA,
      ).length,
      0,
      'quem fechou a competência viu na própria fila as cobranças que gerou',
    )
  })

  it('quem não tem alçada de emissão não vê nada na fila', async () => {
    const semAlcada = await token({ usuario: USUARIO_A, permissoes: [...TUDO] })
    const fila = await chamar(api, 'GET', '/api/v1/contas-receber?minha_aprovacao=true&limit=50', {
      token: semAlcada,
    })
    assert.equal(fila.corpo.data.length, 0, 'quem não tem alçada viu a fila de aprovação')
  })

  it('o aprovador vê a cobrança, decide, e o título fica aprovado', async () => {
    const n1 = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })

    const fila = await chamar(api, 'GET', '/api/v1/contas-receber?minha_aprovacao=true&limit=50', {
      token: n1,
    })
    const alvo = fila.corpo.data.find(
      (x: { contrato_id: string }) => x.contrato_id === CONTRATO_COM_CONSUMO,
    )
    assert.ok(alvo, `a cobrança contratual não apareceu na fila: ${JSON.stringify(fila.corpo.data)}`)

    const d = await chamar(api, 'POST', `/api/v1/contas-receber/${alvo.id}/aprovacoes/1/decidir`, {
      token: n1,
      corpo: { decisao: 'APROVADO' },
    })
    assert.equal(d.status, 200, JSON.stringify(d.corpo))
    assert.equal(d.corpo.data.status, 'APROVADO')
    assert.equal(d.corpo.data.aprovacoes[0].decisao, 'APROVADO')
    assert.equal(d.corpo.data.aprovacoes[0].aprovador_id, APROVADOR_N1)
  })

  it('sem alçada de emissão a decisão é recusada, e a recusa diz o que configurar', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '50000.0000' })

    const semAlcada = await token({ usuario: USUARIO_A, permissoes: [...TUDO] })
    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/aprovacoes/1/decidir`, {
      token: semAlcada,
      corpo: { decisao: 'APROVADO' },
    })
    assert.equal(r.status, 422)
    assert.ok(r.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'CONFIGURAR_ALCADA'))
  })

  it('o nível 2 não decide antes do nível 1', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '50000.0000' })
    const id = t.corpo.data.id

    const n2 = await token({ usuario: APROVADOR_N2, permissoes: [...TUDO] })
    const fora = await chamar(api, 'POST', `/api/v1/contas-receber/${id}/aprovacoes/2/decidir`, {
      token: n2,
      corpo: { decisao: 'APROVADO' },
    })
    assert.equal(fora.status, 422)
    assert.ok(
      fora.corpo.acoes_sugeridas?.some(
        (a: { code: string }) => a.code === 'AGUARDAR_NIVEL_ANTERIOR',
      ),
    )

    const n1 = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })
    const passo1 = await chamar(api, 'POST', `/api/v1/contas-receber/${id}/aprovacoes/1/decidir`, {
      token: n1,
      corpo: { decisao: 'APROVADO' },
    })
    assert.equal(passo1.corpo.data.status, 'PENDENTE_APROVACAO')

    const passo2 = await chamar(api, 'POST', `/api/v1/contas-receber/${id}/aprovacoes/2/decidir`, {
      token: n2,
      corpo: { decisao: 'APROVADO' },
    })
    assert.equal(passo2.corpo.data.status, 'APROVADO')
  })

  it('quem gerou não aprova a própria cobrança', async () => {
    const gerador = await token({ usuario: APROVADOR_N3, permissoes: [...TUDO] })
    const t = await criar(gerador, { valor_original: '50000.0000' })

    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/aprovacoes/1/decidir`, {
      token: gerador,
      corpo: { decisao: 'APROVADO' },
    })
    assert.equal(r.status, 422)
    assert.ok(r.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'OUTRO_APROVADOR'))
  })

  it('a rejeição exige justificativa, volta a PENDENTE e o reenvio mantém o piso', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '50000.0000' })
    const id = t.corpo.data.id
    const n1 = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })

    const sem = await chamar(api, 'POST', `/api/v1/contas-receber/${id}/aprovacoes/1/decidir`, {
      token: n1,
      corpo: { decisao: 'REJEITADO' },
    })
    assert.equal(sem.status, 400)

    const rejeitado = await chamar(api, 'POST', `/api/v1/contas-receber/${id}/aprovacoes/1/decidir`, {
      token: n1,
      corpo: { decisao: 'REJEITADO', justificativa: 'valor divergente do pedido do cliente' },
    })
    assert.equal(rejeitado.corpo.data.status, 'PENDENTE')

    const reenviado = await chamar(api, 'POST', `/api/v1/contas-receber/${id}/reenviar`, {
      token: criador,
    })
    assert.equal(reenviado.corpo.data.status, 'PENDENTE_APROVACAO')
    // Rodada nova, e a antiga preservada: é a rejeição que explica a correção.
    const rodadas = new Set(reenviado.corpo.data.aprovacoes.map((a: { rodada: number }) => a.rodada))
    assert.deepEqual([...rodadas].sort(), [1, 2])
  })

  it('decidir exige receber:aprovar', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '50000.0000' })
    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/aprovacoes/1/decidir`, {
      token: await token({ usuario: APROVADOR_N1, permissoes: [...CRIADOR] }),
      corpo: { decisao: 'APROVADO' },
    })
    assert.equal(r.status, 403)
  })
})

describe('desconto', () => {
  it('dentro da alçada passa e o líquido acompanha', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '1000.0000' })

    // APROVADOR_N2 tem o perfil financeiro, que carrega DESCONTO de 10%.
    const negociador = await token({ usuario: APROVADOR_N2, permissoes: [...TUDO] })
    // `If-Match` é obrigatório: mudar o que se cobra exige ter lido a versão
    // atual. Sem ele, dois descontos concorrentes se sobrescreveriam e o último
    // a gravar decidiria o valor da cobrança.
    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/desconto`, {
      token: negociador,
      cabecalhos: { 'if-match': `"${t.corpo.data.version}"` },
      corpo: { desconto: '100.0000', motivo: 'desconto comercial negociado' },
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.valor_liquido, '900.0000')
    assert.equal(r.corpo.data.saldo, '900.0000')
    assert.equal(r.corpo.data.desconto_por, APROVADOR_N2)
  })

  it('acima da alçada é barrado, mesmo em título já aprovado', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '1000.0000' })
    assert.equal(t.corpo.data.status, 'APROVADO')

    const negociador = await token({ usuario: APROVADOR_N2, permissoes: [...TUDO] })
    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/desconto`, {
      token: negociador,
      cabecalhos: { 'if-match': `"${t.corpo.data.version}"` },
      corpo: { desconto: '150.0000', motivo: 'desconto acima do teto' },
    })
    // A aprovação da emissão validou um valor; descontar depois muda esse valor.
    // Sem esta regra, o caminho para cobrar menos seria emitir cheio, aprovar,
    // e descontar em seguida.
    assert.equal(r.status, 422)
    assert.ok(r.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'APROVAR_DESCONTO'))
    // A mensagem diz **qual** é o teto, não só que houve teto.
    assert.match(
      r.corpo.acoes_sugeridas.find((a: { code: string }) => a.code === 'APROVAR_DESCONTO').descricao,
      /10%/,
    )
  })

  it('quem não tem alçada de desconto não concede nem 1%', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '1000.0000' })

    // APROVADOR_N1 aprova emissão e **não** tem alçada de desconto. Zero
    // significa "não concede", não "concede qualquer um".
    const gestor = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })
    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/desconto`, {
      token: gestor,
      cabecalhos: { 'if-match': `"${t.corpo.data.version}"` },
      corpo: { desconto: '10.0000', motivo: 'desconto pequeno' },
    })
    assert.equal(r.status, 422)
  })

  it('desconto exige receber:negociar, não receber:criar', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '1000.0000' })
    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/desconto`, {
      token: criador,
      cabecalhos: { 'if-match': `"${t.corpo.data.version}"` },
      corpo: { desconto: '10.0000', motivo: 'tentando pelo caminho errado' },
    })
    assert.equal(r.status, 403)
  })
})

describe('recebimento', () => {
  it('a baixa credita a conta e o parcial recalcula o saldo', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '1000.0000' })
    const id = t.corpo.data.id
    const caixa = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })

    const parcial = await chamar(api, 'POST', `/api/v1/contas-receber/${id}/recebimentos`, {
      token: caixa,
      cabecalhos: chave(),
      corpo: {
        valor_recebido: '400.0000',
        data_recebimento: '2026-07-01',
        conta_id: CONTA_RECEBIMENTO,
        forma: 'PIX',
      },
    })
    assert.equal(parcial.status, 201, JSON.stringify(parcial.corpo))
    assert.equal(parcial.corpo.data.status, 'RECEBIDO_PARCIAL')
    assert.equal(parcial.corpo.data.saldo, '600.0000')
    // A entrada bancária nasceu junto: não há caminho que faça um sem o outro.
    assert.ok(parcial.corpo.data.recebimentos[0].movimentacao_id)

    const resto = await chamar(api, 'POST', `/api/v1/contas-receber/${id}/recebimentos`, {
      token: caixa,
      cabecalhos: chave(),
      corpo: {
        valor_recebido: '600.0000',
        data_recebimento: '2026-07-01',
        conta_id: CONTA_RECEBIMENTO,
        forma: 'TRANSFERENCIA',
      },
    })
    assert.equal(resto.corpo.data.status, 'RECEBIDO')
    assert.equal(resto.corpo.data.saldo, '0.0000')
  })

  it('recebimento acima do saldo é recusado, e não vira crédito do cliente', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '300.0000' })
    const caixa = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })

    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/recebimentos`, {
      token: caixa,
      cabecalhos: chave(),
      corpo: {
        valor_recebido: '301.0000',
        data_recebimento: '2026-07-01',
        conta_id: CONTA_RECEBIMENTO,
        forma: 'PIX',
      },
    })
    assert.equal(r.status, 422)
    assert.ok(r.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'AJUSTAR_VALOR'))
  })

  it('não se recebe o que a aprovação não liberou', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '50000.0000' })
    assert.equal(t.corpo.data.status, 'PENDENTE_APROVACAO')
    const caixa = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })

    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/recebimentos`, {
      token: caixa,
      cabecalhos: chave(),
      corpo: {
        valor_recebido: '10.0000',
        data_recebimento: '2026-07-01',
        conta_id: CONTA_RECEBIMENTO,
        forma: 'PIX',
      },
    })
    assert.equal(r.status, 422)
    assert.ok(r.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'APROVAR_EMISSAO'))
  })

  it('o estorno reabre o título e não se repete', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '250.0000' })
    const id = t.corpo.data.id
    const caixa = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })

    const pago = await chamar(api, 'POST', `/api/v1/contas-receber/${id}/recebimentos`, {
      token: caixa,
      cabecalhos: chave(),
      corpo: {
        valor_recebido: '250.0000',
        data_recebimento: '2026-07-01',
        conta_id: CONTA_RECEBIMENTO,
        forma: 'BOLETO',
      },
    })
    const recebimentoId = pago.corpo.data.recebimentos[0].id

    const estorno = await chamar(
      api,
      'POST',
      `/api/v1/contas-receber/${id}/recebimentos/${recebimentoId}/estornar`,
      { token: caixa, cabecalhos: chave(), corpo: { motivo: 'cheque devolvido pelo banco' } },
    )
    assert.equal(estorno.status, 200)
    assert.equal(estorno.corpo.data.status, 'APROVADO')
    assert.equal(estorno.corpo.data.saldo, '250.0000')

    const denovo = await chamar(
      api,
      'POST',
      `/api/v1/contas-receber/${id}/recebimentos/${recebimentoId}/estornar`,
      { token: caixa, cabecalhos: chave(), corpo: { motivo: 'tentando outra vez' } },
    )
    assert.equal(denovo.status, 422)
  })
})

describe('baixa sem recebimento', () => {
  it('encerra o título e diz por quê, sem contar como receita', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '800.0000' })
    const id = t.corpo.data.id
    const negociador = await token({ usuario: APROVADOR_N2, permissoes: [...TUDO] })

    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${id}/baixar-sem-recebimento`, {
      token: negociador,
      corpo: { motivo: 'perda reconhecida: cliente em recuperação judicial' },
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.status, 'BAIXADO')
    assert.match(r.corpo.data.baixa_motivo, /recuperação judicial/)
    assert.ok(r.corpo.data.baixado_em)

    // A distinção que o relatório erra: BAIXADO **não** é RECEBIDO. O saldo
    // continua registrado como não recebido, e nenhum recebimento foi criado.
    assert.equal(r.corpo.data.recebimentos.length, 0)
    assert.equal(r.corpo.data.saldo, '800.0000')
  })

  it('motivo curto é recusado: é o único registro de por que não entrou', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '100.0000' })
    const negociador = await token({ usuario: APROVADOR_N2, permissoes: [...TUDO] })

    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/baixar-sem-recebimento`, {
      token: negociador,
      corpo: { motivo: 'perda' },
    })
    assert.equal(r.status, 400)
  })

  it('título quitado não se baixa: apagaria o registro da entrada', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '120.0000' })
    const id = t.corpo.data.id
    const caixa = await token({ usuario: APROVADOR_N2, permissoes: [...TUDO] })

    await chamar(api, 'POST', `/api/v1/contas-receber/${id}/recebimentos`, {
      token: caixa,
      cabecalhos: chave(),
      corpo: {
        valor_recebido: '120.0000',
        data_recebimento: '2026-07-01',
        conta_id: CONTA_RECEBIMENTO,
        forma: 'PIX',
      },
    })

    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${id}/baixar-sem-recebimento`, {
      token: caixa,
      corpo: { motivo: 'querendo baixar o que já entrou em caixa' },
    })
    assert.equal(r.status, 422)
  })

  it('baixar exige receber:negociar, não receber:baixar', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '100.0000' })

    // Quem registra a entrada de dinheiro não decide que um valor não vai
    // entrar: são as duas metades opostas da mesma linha.
    const soBaixa = await token({
      usuario: APROVADOR_N1,
      permissoes: ['receber:ler', 'receber:baixar'],
    })
    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/baixar-sem-recebimento`, {
      token: soBaixa,
      corpo: { motivo: 'tentando pelo caminho do caixa' },
    })
    assert.equal(r.status, 403)
  })
})

describe('cancelamento e parcelamento', () => {
  it('o parcelamento nasce inteiro, e o pai não recebe baixa', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '900.0000', parcelas: 3 })
    const id = t.corpo.data.id

    const lista = await chamar(api, 'GET', '/api/v1/contas-receber?limit=50', { token: criador })
    const filhas = lista.corpo.data.filter((x: { titulo_pai_id: string }) => x.titulo_pai_id === id)
    assert.equal(filhas.length, 3)
    // O total das parcelas fecha com o do pai ao centavo: é a soma que o cliente
    // vai pagar.
    const soma = filhas.reduce((s: number, f: { valor_original: string }) => s + Number(f.valor_original), 0)
    assert.equal(Math.round(soma * 100), 90000)

    const caixa = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })
    const noPai = await chamar(api, 'POST', `/api/v1/contas-receber/${id}/recebimentos`, {
      token: caixa,
      cabecalhos: chave(),
      corpo: {
        valor_recebido: '900.0000',
        data_recebimento: '2026-07-01',
        conta_id: CONTA_RECEBIMENTO,
        forma: 'PIX',
      },
    })
    assert.equal(noPai.status, 422)
    assert.ok(noPai.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'RECEBER_PARCELA'))
  })

  it('o cancelamento em cascata exige confirmação', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '600.0000', parcelas: 2 })
    const cancelador = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })

    const silencioso = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/cancelar`, {
      token: cancelador,
      corpo: { motivo: 'lançado por engano' },
    })
    assert.equal(silencioso.status, 422)
    assert.ok(
      silencioso.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'CONFIRMAR_CASCATA'),
    )

    const confirmado = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/cancelar`, {
      token: cancelador,
      corpo: { motivo: 'lançado por engano', cancelar_parcelas_pendentes: true },
    })
    assert.equal(confirmado.corpo.data.status, 'CANCELADO')
  })

  it('título com recebimento não se cancela', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '200.0000' })
    const id = t.corpo.data.id
    const caixa = await token({ usuario: APROVADOR_N1, permissoes: [...TUDO] })

    await chamar(api, 'POST', `/api/v1/contas-receber/${id}/recebimentos`, {
      token: caixa,
      cabecalhos: chave(),
      corpo: {
        valor_recebido: '200.0000',
        data_recebimento: '2026-07-01',
        conta_id: CONTA_RECEBIMENTO,
        forma: 'PIX',
      },
    })

    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${id}/cancelar`, {
      token: caixa,
      corpo: { motivo: 'cancelando depois de receber' },
    })
    assert.equal(r.status, 422)
    assert.ok(r.corpo.acoes_sugeridas?.some((a: { code: string }) => a.code === 'ESTORNAR_PRIMEIRO'))
  })

  it('cancelar exige permissão própria', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    const t = await criar(criador, { valor_original: '100.0000' })
    const r = await chamar(api, 'POST', `/api/v1/contas-receber/${t.corpo.data.id}/cancelar`, {
      token: criador,
      corpo: { motivo: 'lançado por engano' },
    })
    assert.equal(r.status, 403)
  })
})

describe('em atraso é derivado, não gravado', () => {
  it('o filtro usa a data, e nenhum status se chama EM_ATRASO', async () => {
    const criador = await token({ usuario: USUARIO_COMPRADOR, permissoes: [...CRIADOR] })
    // Vencido em 2026-01, e a data de referência do banco é o dia de hoje real:
    // um título com vencimento no passado está em atraso por leitura da data.
    const vencido = await criar(criador, {
      valor_original: '150.0000',
      data_emissao: '2026-01-01',
      data_vencimento: '2026-01-10',
    })

    const fila = await chamar(api, 'GET', '/api/v1/contas-receber?em_atraso=true&limit=100', {
      token: criador,
    })
    assert.equal(fila.status, 200)
    assert.ok(
      fila.corpo.data.some((x: { id: string }) => x.id === vencido.corpo.data.id),
      'o título vencido não apareceu na fila de atraso',
    )
    // Nenhum título carrega o estado "em atraso": ele é a data comparada com
    // hoje, e por isso está certo em qualquer instante.
    assert.ok(fila.corpo.data.every((x: { status: string }) => x.status !== 'EM_ATRASO'))
  })
})
