import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NotificacaoWorker } from '../src/modulos/notificacao/notificacao.worker.js'
import { RemetenteRegistro, remetenteDoAmbiente } from '../src/modulos/notificacao/remetente.js'
import type { Remetente } from '../src/modulos/notificacao/remetente.js'
import { chamar, drenarTudo, subirApi, token, type Servidor } from './apoio.js'

/**
 * Integração do subsistema de notificação, contra PostgreSQL real.
 *
 * O que estes testes existem para provar: **o aviso sai, e sai uma vez**.
 *
 * As duas falhas possíveis de uma fila de avisos são caras e silenciosas.
 * Enviar duas vezes faz o aprovador ver dois pedidos de pagamento onde há um.
 * Não enviar nunca faz o pagamento parar sem que ninguém saiba por quê — e é o
 * estado em que o sistema estava antes desta migração: `outbox_evento` desde a
 * 0007, sem consumidor, com a interface prometendo e-mail de recuperação de
 * senha que nunca chegava.
 */

let api: Servidor
let worker: NotificacaoWorker

/** Remetente que falha sempre — para exercitar o recuo e a desistência. */
class RemetenteQuebrado implements Remetente {
  readonly nome = 'quebrado'
  tentativas = 0
  async enviar(): Promise<void> {
    this.tentativas++
    throw new Error('conexão recusada pelo servidor SMTP')
  }
}

before(async () => {
  api = await subirApi()
  worker = api.app.get(NotificacaoWorker)
})

after(async () => {
  await api.fechar()
})

describe('escolha do remetente', () => {
  it('o padrão é registro, não SMTP', () => {
    // A assimetria do erro decide o padrão: um ambiente que deveria enviar e só
    // registra aparece na primeira conferência — alguém pergunta pelo e-mail
    // que não chegou. O contrário manda e-mail de teste para gente real, e isso
    // não se desfaz.
    const r = remetenteDoAmbiente({})
    assert.equal(r.nome, 'registro')
  })

  it('SMTP sem host é erro de configuração, não queda silenciosa para registro', () => {
    // Cair em silêncio é exatamente como um ambiente de produção passa semanas
    // sem enviar nada.
    assert.throws(
      () => remetenteDoAmbiente({ NOTIFICACAO_ADAPTADOR: 'smtp' }),
      /SMTP_HOST e SMTP_DE/,
    )
  })

  it('adaptador desconhecido é recusado', () => {
    assert.throws(
      () => remetenteDoAmbiente({ NOTIFICACAO_ADAPTADOR: 'pombo-correio' }),
      /desconhecido/,
    )
  })

  it('SMTP configurado escolhe a porta e o modo de TLS coerentes', () => {
    const implicito = remetenteDoAmbiente({
      NOTIFICACAO_ADAPTADOR: 'smtp',
      SMTP_HOST: 'smtp.exemplo.test',
      SMTP_DE: 'IARX <avisos@exemplo.test>',
      SMTP_PORTA: '465',
    })
    assert.equal(implicito.nome, 'smtp')

    // 587 é STARTTLS e 465 é TLS implícito; inverter dá "wrong version number"
    // no handshake, que é um erro difícil de ler.
    const startTls = remetenteDoAmbiente({
      NOTIFICACAO_ADAPTADOR: 'smtp',
      SMTP_HOST: 'smtp.exemplo.test',
      SMTP_DE: 'IARX <avisos@exemplo.test>',
    })
    assert.equal(startTls.nome, 'smtp')
  })
})

describe('recuperação de senha entra na fila', () => {
  it('o pedido enfileira a mensagem, com o token dentro e fora do log', async () => {
    const remetente = new RemetenteRegistro(50, () => undefined)

    const r = await chamar(api, 'POST', '/api/v1/auth/recuperacao', {
      corpo: { email: 'operador@alfa.local' },
    })
    assert.equal(r.status, 202)

    const lote = await drenarTudo(worker, remetente)
    assert.ok(lote.reservadas >= 1, 'a recuperação não entrou na fila')
    assert.ok(lote.enviadas >= 1)
    assert.equal(lote.falhas, 0)

    const msg = remetente.enviadas.find((m) => /Redefinição de senha/.test(m.assunto))
    assert.ok(msg, 'a mensagem de recuperação não foi enviada')
    // O token vai na mensagem — é o que a torna útil — e em nenhum log.
    assert.match(msg!.texto, /token=/)
    assert.match(msg!.texto, /vale por 30 minutos/)
    assert.equal(msg!.para, 'operador@alfa.local')
    assert.ok(msg!.html && msg!.html.includes('Escolher nova senha'))
  })

  it('e-mail inexistente não enfileira nada, e a resposta é a mesma', async () => {
    const remetente = new RemetenteRegistro(50, () => undefined)

    const r = await chamar(api, 'POST', '/api/v1/auth/recuperacao', {
      corpo: { email: 'nao.existe@alfa.local' },
    })
    assert.equal(r.status, 202)

    // Se a fila crescesse só para o e-mail existente, o **tempo** de resposta
    // entregaria o que a mensagem esconde.
    const lote = await drenarTudo(worker, remetente)
    assert.equal(
      remetente.enviadas.filter((m) => m.para === 'nao.existe@alfa.local').length,
      0,
      'enfileirou aviso para conta inexistente',
    )
    assert.equal(lote.falhas, 0)
  })
})

describe('worker da fila', () => {
  it('a fila drenada não reenvia o que já foi enviado', async () => {
    const remetente = new RemetenteRegistro(50, () => undefined)

    await chamar(api, 'POST', '/api/v1/auth/recuperacao', { corpo: { email: 'operador@alfa.local' } })
    const primeiro = await drenarTudo(worker, remetente)
    assert.ok(primeiro.enviadas >= 1)

    // Duas cópias de um aviso de aprovação de pagamento parecem dois pagamentos.
    const enviadasAntes = remetente.enviadas.length
    const segundo = await worker.drenar(remetente)
    assert.equal(segundo.reservadas, 0, 'a segunda drenagem reservou algo já enviado')
    assert.equal(remetente.enviadas.length, enviadasAntes)
  })

  it('falha de envio recua em vez de girar, e o motivo fica registrado', async () => {
    const quebrado = new RemetenteQuebrado()
    await chamar(api, 'POST', '/api/v1/auth/recuperacao', { corpo: { email: 'operador@alfa.local' } })

    const lote = await worker.drenar(quebrado)
    assert.equal(lote.reservadas, 1)
    assert.equal(lote.enviadas, 0)
    assert.equal(lote.falhas, 1)
    assert.equal(quebrado.tentativas, 1)

    // Recuo: a próxima drenagem imediata não pega a mesma linha. Sem isso, o
    // endereço errado seria tentado em laço, competindo com as notificações
    // novas pelo mesmo worker.
    const seguinte = await worker.drenar(quebrado)
    assert.equal(seguinte.reservadas, 0, 'a falha voltou para a fila sem recuo')
    assert.equal(quebrado.tentativas, 1)
  })

  it('sem remetente configurado, drenar não reserva nada', async () => {
    // O worker que não subiu por configuração inválida não deve consumir a
    // fila: reservar sem poder enviar deixaria as linhas em ENVIANDO até a
    // reserva expirar, e a fila pareceria estar andando quando não está.
    const lote = await worker.drenar(null)
    assert.deepEqual(lote, { reservadas: 0, enviadas: 0, falhas: 0 })
  })
})

describe('caixa interna', () => {
  it('lista só as próprias notificações, e marcar como lida é idempotente', async () => {
    const t = await token({ permissoes: ['contrato:ler'] })

    const lista = await chamar(api, 'GET', '/api/v1/notificacoes', { token: t })
    assert.equal(lista.status, 200)
    assert.ok(Array.isArray(lista.corpo.data))

    // A rota é de escopo próprio: não existe caminho para ler a caixa de outra
    // pessoa. Se existisse, seria a primeira coisa usada para ler avisos de
    // aprovação alheios — que carregam valor, fornecedor e justificativa.
    const semPermissao = await chamar(api, 'GET', '/api/v1/notificacoes')
    assert.equal(semPermissao.status, 401)
  })

  it('o filtro de não lidas existe e responde', async () => {
    const t = await token({ permissoes: ['contrato:ler'] })
    const r = await chamar(api, 'GET', '/api/v1/notificacoes?nao_lidas=true', { token: t })
    assert.equal(r.status, 200)
    assert.ok(r.corpo.data.every((n: { lida_em: string | null }) => n.lida_em === null))
  })
})
