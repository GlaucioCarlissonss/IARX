import type { AcaoSugerida, CodigoErro } from '@iarx/contracts'

interface OpcoesErro {
  status?: number
  detail?: string
  errors?: { field: string; code: string; message?: string; meta?: Record<string, unknown> }[]
  acoes?: AcaoSugerida[]
  /** Causa original, preservada para o log; nunca vai para a resposta. */
  causa?: unknown
}

/**
 * Erro de domínio.
 *
 * A distinção que este tipo carrega: um `ErroDominio` é uma resposta prevista
 * do sistema — o cliente pediu algo que as regras não permitem — e o corpo dele
 * é seguro para mostrar. Qualquer outra exceção é defeito, e o filtro devolve
 * `ERRO_INTERNO` sem detalhe, porque a mensagem pode conter SQL, caminho de
 * arquivo ou dado de outro tenant.
 *
 * Não estende HttpException do Nest de propósito: o domínio não deve conhecer
 * o transporte. O filtro é quem traduz para HTTP.
 */
export class ErroDominio extends Error {
  readonly code: CodigoErro
  readonly status: number
  readonly detail?: string
  readonly errors?: OpcoesErro['errors']
  readonly acoes?: AcaoSugerida[]

  constructor(code: CodigoErro, title: string, opcoes: OpcoesErro = {}) {
    super(title, opcoes.causa ? { cause: opcoes.causa } : undefined)
    this.name = 'ErroDominio'
    this.code = code
    this.status = opcoes.status ?? STATUS_PADRAO[code]
    this.detail = opcoes.detail
    this.errors = opcoes.errors
    this.acoes = opcoes.acoes
  }
}

/**
 * Status HTTP padrão por código.
 *
 * Centralizar aqui impede a incoerência de o mesmo código sair como 409 em uma
 * rota e 422 em outra — o cliente que trata por `code` acaba tendo que tratar
 * por status também, e o contrato deixa de valer.
 */
const STATUS_PADRAO: Record<CodigoErro, number> = {
  PAYLOAD_INVALIDO: 400,
  REGRA_DE_NEGOCIO: 422,
  VIGENCIA_INVALIDA: 422,
  CREDITO_BLOQUEADO: 422,
  TRANSICAO_INVALIDA: 422,
  NAO_AUTENTICADO: 401,
  TOKEN_INVALIDO: 401,
  SEM_PERMISSAO: 403,
  FORA_DE_ESCOPO: 403,
  NAO_ENCONTRADO: 404,
  EQUIPAMENTO_JA_ALOCADO: 409,
  CONFLITO_DE_VERSAO: 409,
  RECURSO_DUPLICADO: 409,
  IDEMPOTENCIA_EM_ANDAMENTO: 409,
  IDEMPOTENCIA_DIVERGENTE: 409,
  LIMITE_EXCEDIDO: 429,
  ERRO_INTERNO: 500,
  INDISPONIVEL: 503,
}

/**
 * Não encontrado e fora do escopo do tenant devolvem a mesma coisa, sempre.
 *
 * Distinguir "não existe" de "existe mas não é seu" confirma a existência de um
 * registro alheio — um oráculo suficiente para enumerar a base de outro tenant
 * um id por vez. Com RLS o SELECT já não retorna a linha, e esta função garante
 * que o tratamento acima também não vaze a diferença.
 */
export function naoEncontrado(recurso: string, id?: string): ErroDominio {
  return new ErroDominio('NAO_ENCONTRADO', `${recurso} não encontrado`, {
    detail: id ? `Nenhum ${recurso.toLowerCase()} com identificador ${id} no escopo desta requisição.` : undefined,
  })
}
