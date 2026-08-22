import { Injectable } from '@nestjs/common'
import type { Executor } from '../../banco/banco.service.js'

/**
 * Enfileiramento de notificação, com os modelos de mensagem.
 *
 * Os modelos vivem em código, e não no banco, por uma razão específica: cada um
 * é acompanhado de um teste que confere o que ele produz. Um modelo em tabela
 * pode ser editado sem passar por revisão nem por teste, e o primeiro sintoma
 * de um `{{nome}}` digitado errado é um e-mail com `{{nome}}` no assunto
 * chegando a um cliente.
 *
 * Todo método recebe o `Executor` da transação de negócio em curso, nunca abre
 * a sua. É a metade do padrão outbox que importa: se a escrita for desfeita, o
 * aviso não existe. Um `await enviar()` fora da transação avisaria sobre um
 * fato que o rollback apagou.
 */

/** Escapa para HTML. Um nome com `&` não deve virar entidade quebrada. */
function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const dinheiroBr = (v: string | number): string =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Moldura comum das mensagens.
 *
 * Sem CSS externo e sem imagem: cliente de e-mail corporativo bloqueia as duas
 * coisas por padrão, e uma mensagem que depende delas chega como texto solto
 * com um retângulo vazio no topo. Estilo inline, e o texto puro dizendo a mesma
 * coisa — é ele que muitos leitores mostram.
 */
function moldura(titulo: string, corpo: string, acao?: { rotulo: string; url: string }): string {
  const botao = acao
    ? `<p style="margin:24px 0"><a href="${esc(acao.url)}"
         style="background:#1f4ed8;color:#fff;padding:12px 20px;border-radius:6px;
                text-decoration:none;display:inline-block;font-weight:600"
         >${esc(acao.rotulo)}</a></p>
       <p style="font-size:13px;color:#555">Se o botão não funcionar, copie este endereço:<br>
         <span style="word-break:break-all">${esc(acao.url)}</span></p>`
    : ''

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                      max-width:560px;margin:0 auto;color:#16181d;line-height:1.55">
    <p style="font-weight:700;letter-spacing:.02em;margin:0 0 4px">IARX</p>
    <h1 style="font-size:20px;margin:0 0 12px">${esc(titulo)}</h1>
    ${corpo}
    ${botao}
    <hr style="border:none;border-top:1px solid #e3e5ea;margin:28px 0 12px">
    <p style="font-size:12px;color:#6b7280;margin:0">
      Locação de impressoras e computadores corporativos.
      Você recebeu este aviso porque tem uma conta neste ambiente.
    </p>
  </div>`
}

interface Enfileiramento {
  canal: 'EMAIL' | 'IN_APP'
  usuarioId: string | null
  destino?: string | null
  assunto: string
  texto: string
  html?: string | null
}

@Injectable()
export class NotificacaoService {
  private async enfileirar(db: Executor, n: Enfileiramento): Promise<string> {
    const r = await db.consultarUm<{ id: string }>(
      `select app.enfileirar_notificacao($1, $2, $3, $4, $5, $6) as id`,
      [n.canal, n.usuarioId, n.destino ?? null, n.assunto, n.texto, n.html ?? null],
    )
    return r!.id
  }

  /**
   * Recuperação de senha.
   *
   * O token vai **na mensagem**, e em nenhum log. Um token de recuperação em
   * log é um token vazado: quem lê o log da aplicação passa a poder redefinir a
   * senha de qualquer pessoa, e o rastro disso não aparece em lugar nenhum
   * porque a redefinição em si é legítima.
   */
  async recuperacaoDeSenha(
    db: Executor,
    dados: { usuarioId: string; nome: string; email: string; token: string; minutos: number },
  ): Promise<string> {
    const url = `${baseDaAplicacao()}/#/redefinir?token=${encodeURIComponent(dados.token)}`
    const primeiro = dados.nome.split(' ')[0] ?? dados.nome

    return this.enfileirar(db, {
      canal: 'EMAIL',
      usuarioId: dados.usuarioId,
      destino: dados.email,
      assunto: 'Redefinição de senha — IARX',
      texto:
        `${primeiro}, recebemos um pedido para redefinir a sua senha.\n\n` +
        `Abra este endereço para escolher uma nova:\n${url}\n\n` +
        `O link vale por ${dados.minutos} minutos e só pode ser usado uma vez.\n\n` +
        `Se não foi você que pediu, ignore esta mensagem — a senha atual continua valendo.`,
      html: moldura(
        'Redefinição de senha',
        `<p>${esc(primeiro)}, recebemos um pedido para redefinir a sua senha.</p>
         <p>O link vale por <strong>${dados.minutos} minutos</strong> e só pode ser usado uma vez.</p>
         <p style="color:#6b7280">Se não foi você que pediu, ignore esta mensagem — a senha atual
            continua valendo.</p>`,
        { rotulo: 'Escolher nova senha', url },
      ),
    })
  }

  /**
   * Convite de usuário.
   *
   * O convite não carrega senha, e a mensagem diz isso explicitamente. Senha
   * definida por terceiro é senha compartilhada: quem a criou continua sabendo,
   * e o dono não tem como provar que não foi ele.
   */
  async convite(
    db: Executor,
    dados: { usuarioId: string; nome: string; email: string; token: string; convidadoPor: string },
  ): Promise<string> {
    const url = `${baseDaAplicacao()}/#/primeiro-acesso?token=${encodeURIComponent(dados.token)}`
    const primeiro = dados.nome.split(' ')[0] ?? dados.nome

    return this.enfileirar(db, {
      canal: 'EMAIL',
      usuarioId: dados.usuarioId,
      destino: dados.email,
      assunto: 'Seu acesso à IARX está pronto',
      texto:
        `${primeiro}, ${dados.convidadoPor} criou um acesso para você.\n\n` +
        `Defina a sua senha aqui:\n${url}\n\n` +
        `Ninguém mais conhece esta senha: quem a escolhe é você.`,
      html: moldura(
        'Seu acesso está pronto',
        `<p>${esc(primeiro)}, ${esc(dados.convidadoPor)} criou um acesso para você.</p>
         <p>Ninguém mais conhece esta senha: quem a escolhe é você.</p>`,
        { rotulo: 'Definir minha senha', url },
      ),
    })
  }

  /**
   * Aprovação pendente — o aviso do Módulo 10.
   *
   * Vai pelos dois canais de propósito. O e-mail alcança quem não está com a
   * aplicação aberta, e é o que faz o pagamento não parar por ninguém ter
   * olhado; a caixa interna é o que sobrevive ao filtro de spam e dá a lista de
   * pendências quando a pessoa entra.
   */
  async aprovacaoPendente(
    db: Executor,
    dados: {
      aprovadorId: string
      aprovadorNome: string
      aprovadorEmail: string
      tituloId: string
      descricao: string
      valor: string
      vencimento: string
      nivel: number
      solicitante: string
    },
  ): Promise<{ email: string; caixa: string }> {
    const url = `${baseDaAplicacao()}/#/contas-pagar?titulo=${encodeURIComponent(dados.tituloId)}`
    const primeiro = dados.aprovadorNome.split(' ')[0] ?? dados.aprovadorNome
    const assunto = `Aprovação nível ${dados.nivel}: ${dinheiroBr(dados.valor)} — ${dados.descricao}`

    const texto =
      `${primeiro}, há um título esperando a sua aprovação.\n\n` +
      `Descrição: ${dados.descricao}\n` +
      `Valor: ${dinheiroBr(dados.valor)}\n` +
      `Vencimento: ${dados.vencimento}\n` +
      `Solicitado por: ${dados.solicitante}\n` +
      `Seu nível de aprovação: ${dados.nivel}\n\n` +
      `Abrir: ${url}`

    const email = await this.enfileirar(db, {
      canal: 'EMAIL',
      usuarioId: dados.aprovadorId,
      destino: dados.aprovadorEmail,
      assunto,
      texto,
      html: moldura(
        'Aprovação pendente',
        `<p>${esc(primeiro)}, há um título esperando a sua aprovação.</p>
         <table style="border-collapse:collapse;font-size:14px">
           <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Descrição</td><td>${esc(dados.descricao)}</td></tr>
           <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Valor</td><td><strong>${dinheiroBr(dados.valor)}</strong></td></tr>
           <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Vencimento</td><td>${esc(dados.vencimento)}</td></tr>
           <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Solicitado por</td><td>${esc(dados.solicitante)}</td></tr>
           <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Seu nível</td><td>${dados.nivel}</td></tr>
         </table>`,
        { rotulo: 'Abrir o título', url },
      ),
    })

    const caixa = await this.enfileirar(db, {
      canal: 'IN_APP',
      usuarioId: dados.aprovadorId,
      assunto,
      texto,
    })

    return { email, caixa }
  }

  /** Decisão tomada: o solicitante precisa saber, aprovado ou não. */
  async decisaoDeAprovacao(
    db: Executor,
    dados: {
      solicitanteId: string
      solicitanteNome: string
      solicitanteEmail: string
      tituloId: string
      descricao: string
      valor: string
      aprovado: boolean
      decididoPor: string
      /** Obrigatório na rejeição: recusa sem justificativa não é resposta. */
      justificativa?: string | null
    },
  ): Promise<{ email: string; caixa: string }> {
    const url = `${baseDaAplicacao()}/#/contas-pagar?titulo=${encodeURIComponent(dados.tituloId)}`
    const primeiro = dados.solicitanteNome.split(' ')[0] ?? dados.solicitanteNome
    const veredito = dados.aprovado ? 'aprovado' : 'rejeitado'
    const assunto = `Título ${veredito}: ${dinheiroBr(dados.valor)} — ${dados.descricao}`

    const razao = dados.justificativa ? `\n\nJustificativa: ${dados.justificativa}` : ''
    const texto =
      `${primeiro}, o título "${dados.descricao}" de ${dinheiroBr(dados.valor)} foi ${veredito} ` +
      `por ${dados.decididoPor}.${razao}\n\nAbrir: ${url}`

    const email = await this.enfileirar(db, {
      canal: 'EMAIL',
      usuarioId: dados.solicitanteId,
      destino: dados.solicitanteEmail,
      assunto,
      texto,
      html: moldura(
        `Título ${veredito}`,
        `<p>${esc(primeiro)}, o título <strong>${esc(dados.descricao)}</strong> de
            ${dinheiroBr(dados.valor)} foi <strong>${veredito}</strong> por
            ${esc(dados.decididoPor)}.</p>
         ${dados.justificativa ? `<p style="background:#f6f7f9;padding:12px;border-radius:6px">${esc(dados.justificativa)}</p>` : ''}`,
        { rotulo: 'Abrir o título', url },
      ),
    })

    const caixa = await this.enfileirar(db, {
      canal: 'IN_APP',
      usuarioId: dados.solicitanteId,
      assunto,
      texto,
    })

    return { email, caixa }
  }
}

/**
 * Endereço público da aplicação.
 *
 * Vem do ambiente, e o padrão é `localhost`. Deixar um domínio de produção
 * como padrão faria um ambiente mal configurado mandar links de redefinição de
 * senha apontando para a produção de outra instalação — um link que funciona no
 * lugar errado é pior que um link quebrado.
 */
function baseDaAplicacao(): string {
  return (process.env['APP_URL'] ?? 'http://localhost:5173').replace(/\/+$/, '')
}
