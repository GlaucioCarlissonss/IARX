import { createTransport, type Transporter } from 'nodemailer'

/**
 * Adaptador de envio.
 *
 * A escolha do provedor de e-mail (D-19) **não** está no código, e é
 * deliberado: o adaptador falado por todo provedor sério — SES, Resend,
 * SendGrid, Postmark, Mailgun, servidor próprio — é SMTP. Amarrar o código à
 * API HTTP de um deles trocaria uma configuração por uma reescrita no dia em
 * que o contrato mudasse.
 *
 * Duas implementações:
 *
 *  · `smtp`    produção e homologação, configurado por variável de ambiente;
 *  · `registro` desenvolvimento, CI e teste — registra o que enviaria.
 *
 * O `registro` não é um esboço: é o que permite a suíte de integração provar o
 * caminho completo do worker sem depender de rede, e é o que faz o
 * desenvolvedor ver o e-mail de recuperação de senha sem precisar de caixa
 * postal.
 */

export interface Mensagem {
  para: string
  assunto: string
  texto: string
  html?: string | null
}

export interface Remetente {
  readonly nome: string
  enviar(m: Mensagem): Promise<void>
}

/**
 * Remetente de registro.
 *
 * Guarda as mensagens em memória, limitado — um processo de desenvolvimento
 * rodando por dias não deve crescer sem teto por causa do log de e-mail.
 */
export class RemetenteRegistro implements Remetente {
  readonly nome = 'registro'
  readonly enviadas: Mensagem[] = []

  constructor(
    private readonly maximo = 200,
    private readonly registrar: (linha: string) => void = (l) => console.info(l),
  ) {}

  async enviar(m: Mensagem): Promise<void> {
    this.enviadas.push(m)
    if (this.enviadas.length > this.maximo) this.enviadas.shift()
    this.registrar(`[notificacao] para=${m.para} assunto=${JSON.stringify(m.assunto)}`)
  }
}

/**
 * Remetente SMTP.
 *
 * `pool: true` porque o worker envia em lote: sem reuso de conexão, cada
 * mensagem custaria um handshake TLS completo, e a maioria dos provedores
 * limita conexões por minuto muito antes de limitar mensagens.
 */
export class RemetenteSmtp implements Remetente {
  readonly nome = 'smtp'
  private readonly transporte: Transporter

  constructor(
    private readonly de: string,
    opcoes: { host: string; port: number; secure: boolean; user?: string; pass?: string },
  ) {
    this.transporte = createTransport({
      host: opcoes.host,
      port: opcoes.port,
      secure: opcoes.secure,
      pool: true,
      maxConnections: 3,
      auth: opcoes.user ? { user: opcoes.user, pass: opcoes.pass ?? '' } : undefined,
    })
  }

  async enviar(m: Mensagem): Promise<void> {
    await this.transporte.sendMail({
      from: this.de,
      to: m.para,
      subject: m.assunto,
      text: m.texto,
      html: m.html ?? undefined,
    })
  }

  async fechar(): Promise<void> {
    this.transporte.close()
  }
}

/**
 * Escolhe o remetente pela configuração do ambiente.
 *
 * O padrão é `registro`, e não `smtp`. A razão é a assimetria do erro: um
 * ambiente que deveria enviar e só registra aparece na primeira conferência —
 * alguém pergunta pelo e-mail que não chegou. Um ambiente que deveria só
 * registrar e envia manda e-mail de teste para endereço de gente real, e isso
 * não se desfaz.
 *
 * `NOTIFICACAO_ADAPTADOR=smtp` sem host é erro de configuração, não motivo para
 * cair silenciosamente no registro: cair em silêncio é como o ambiente de
 * produção passa semanas sem enviar nada.
 */
export function remetenteDoAmbiente(env: NodeJS.ProcessEnv = process.env): Remetente {
  const escolhido = (env.NOTIFICACAO_ADAPTADOR ?? 'registro').toLowerCase()

  if (escolhido === 'registro') return new RemetenteRegistro()

  if (escolhido !== 'smtp') {
    throw new Error(
      `NOTIFICACAO_ADAPTADOR="${escolhido}" desconhecido. Use "smtp" ou "registro".`,
    )
  }

  const host = env.SMTP_HOST
  const de = env.SMTP_DE
  if (!host || !de) {
    throw new Error(
      'NOTIFICACAO_ADAPTADOR=smtp exige SMTP_HOST e SMTP_DE. ' +
        'Defina-os ou use NOTIFICACAO_ADAPTADOR=registro.',
    )
  }

  const porta = Number(env.SMTP_PORTA ?? 587)
  return new RemetenteSmtp(de, {
    host,
    port: porta,
    // 465 é TLS implícito; 587 é STARTTLS, que o nodemailer negocia com
    // `secure: false`. Inverter isto dá "wrong version number" no handshake.
    secure: porta === 465,
    user: env.SMTP_USUARIO,
    pass: env.SMTP_SENHA,
  })
}
