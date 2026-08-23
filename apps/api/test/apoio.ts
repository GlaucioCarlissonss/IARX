import { NestFactory } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { SignJWT } from 'jose'
import type { AddressInfo } from 'node:net'
import { dvChaveNfe, type Permissao } from '@iarx/contracts'
import { AppModule } from '../src/app.module.js'
import type { ResultadoDrenagem } from '../src/modulos/notificacao/notificacao.worker.js'
import type { Remetente } from '../src/modulos/notificacao/remetente.js'

export const TENANT_A = '11111111-1111-4111-8111-111111111111'
export const TENANT_B = '22222222-2222-4222-8222-222222222222'
export const USUARIO_A = '11111111-1111-4111-8111-111111110001'
export const USUARIO_B = '22222222-2222-4222-8222-222222220001'

export const EQUIP_OCUPADO = '11111111-1111-4111-8111-11111111a001' // patrimônio 10422
export const EQUIP_LIVRE_1 = '11111111-1111-4111-8111-11111111a002' // patrimônio 10423
export const EQUIP_LIVRE_2 = '11111111-1111-4111-8111-11111111a003' // patrimônio 10424
export const EQUIP_TENANT_B = '22222222-2222-4222-8222-22222222a001'

export const CONTRATO_DESTINO = '11111111-1111-4111-8111-1111111170a2' // SP-2026-0201
export const CONTRATO_CREDITO_BLOQUEADO = '11111111-1111-4111-8111-1111111170a3'
export const CONTRATO_ENCERRADO = '11111111-1111-4111-8111-1111111170a4'
export const CONTRATO_TENANT_B = '22222222-2222-4222-8222-2222222270a1'

export const FORNECEDOR_A = '11111111-1111-4111-8111-11111111f001' // CNPJ 11444777000161
export const CNPJ_FORNECEDOR_A = '11444777000161'
export const FILIAL_A = '11111111-1111-4111-8111-1111111111f1'
export const MODELO_A = '11111111-1111-4111-8111-1111111111d1'
export const NOTA_PENDENTE = '11111111-1111-4111-8111-11111111e001' // 1/12345, item 2 sem séries
export const NOTA_ITEM_1 = '11111111-1111-4111-8111-11111111e101' // 3 unidades, já identificadas
export const NOTA_ITEM_2 = '11111111-1111-4111-8111-11111111e102' // 2 unidades, nenhuma
export const NOTA_TENANT_B = '22222222-2222-4222-8222-22222222e001'
/** Quem lançou a nota semeada — a conferência precisa ser de outra pessoa. */
export const USUARIO_COMPRADOR = '11111111-1111-4111-8111-111111110002'

export const LOCAL_ALFA = '11111111-1111-4111-8111-11111111b101'
export const LOCAL_SEM_COORDENADA = '11111111-1111-4111-8111-11111111b102'
export const LOCAL_TENANT_B = '22222222-2222-4222-8222-22222222b101'

/**
 * Monta uma chave de acesso com dígito verificador correto.
 *
 * O teste precisa de chaves válidas para exercitar o que vem *depois* do DV —
 * a coerência com o cabeçalho (RN-L10). Uma chave de dígitos aleatórios seria
 * recusada antes de chegar lá, e o caso interessante nunca rodaria.
 */
export function montarChaveAcesso(opcoes: {
  cnpj?: string
  numero?: string
  serie?: string
  /** AAMM da emissão. */
  competencia?: string
}): string {
  const base43 =
    '35' +
    (opcoes.competencia ?? '2605') +
    (opcoes.cnpj ?? CNPJ_FORNECEDOR_A).padStart(14, '0') +
    '55' +
    (opcoes.serie ?? '1').padStart(3, '0') +
    (opcoes.numero ?? '12345').padStart(9, '0') +
    '1' +
    '00000042'
  return base43 + String(dvChaveNfe(base43) ?? 0)
}

const SEGREDO = process.env['IARX_JWT_SEGREDO'] ?? 'segredo-de-teste-nao-use-em-producao'

/**
 * Emite um token de teste.
 *
 * HS256 com segredo compartilhado só é aceito porque `NODE_ENV` não é
 * `production` — o bootstrap recusaria essa configuração lá. O teste não
 * contorna a regra; ele opera dentro dela.
 */
export async function token(opcoes: {
  tenant?: string
  usuario?: string
  permissoes?: Permissao[]
  expirado?: boolean
  /** Claims adicionais — `cliente_id`, `sessao_id`. */
  extras?: Record<string, unknown>
}): Promise<string> {
  const agora = Math.floor(Date.now() / 1000)
  return new SignJWT({
    tenant_id: opcoes.tenant ?? TENANT_A,
    usuario_id: opcoes.usuario ?? USUARIO_A,
    permissoes: opcoes.permissoes ?? [],
    escopos: [{ tipo: 'TENANT', id: null }],
    ...opcoes.extras,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(opcoes.usuario ?? USUARIO_A)
    .setIssuedAt(agora - 60)
    .setExpirationTime(opcoes.expirado ? agora - 30 : agora + 600)
    .sign(new TextEncoder().encode(SEGREDO))
}

export interface Servidor {
  base: string
  app: INestApplication
  fechar(): Promise<void>
}

export async function subirApi(): Promise<Servidor> {
  const app = await NestFactory.create(AppModule, { logger: false })
  await app.listen(0, '127.0.0.1')
  const endereco = app.getHttpServer().address() as AddressInfo
  return {
    base: `http://127.0.0.1:${endereco.port}`,
    app,
    fechar: () => app.close(),
  }
}

export interface Resposta {
  status: number
  corpo: any
  cabecalhos: Headers
}

export async function chamar(
  servidor: Servidor,
  metodo: string,
  caminho: string,
  opcoes: { token?: string; corpo?: unknown; cabecalhos?: Record<string, string> } = {},
): Promise<Resposta> {
  const r = await fetch(`${servidor.base}${caminho}`, {
    method: metodo,
    headers: {
      ...(opcoes.token ? { authorization: `Bearer ${opcoes.token}` } : {}),
      ...(opcoes.corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      ...opcoes.cabecalhos,
    },
    ...(opcoes.corpo !== undefined ? { body: JSON.stringify(opcoes.corpo) } : {}),
  })
  const texto = await r.text()
  return {
    status: r.status,
    corpo: texto ? JSON.parse(texto) : null,
    cabecalhos: r.headers,
  }
}

/** Corpo válido de alocação, com os campos que a modalidade exige. */
export function corpoAlocacao(equipamentoId: string, inicio = '2026-06-01T00:00:00-03:00', fim: string | null = '2026-11-30T23:59:59-03:00') {
  return {
    equipamento_id: equipamentoId,
    modalidade_cobranca: 'FRANQUIA_EXCEDENTE',
    valor_unitario: '289.0000',
    quantidade: 1,
    franquia_quantidade: 3000,
    franquia_escopo: 'ITEM',
    valor_excedente_unitario: '0.0800',
    vigencia_inicio: inicio,
    vigencia_fim: fim,
  }
}

let contador = 0
export function chaveIdempotencia(prefixo = 'teste'): string {
  contador += 1
  return `${prefixo}-${process.pid}-${contador}-aaaaaaaa`
}

/**
 * Corpo de lançamento de nota, já fechado.
 *
 * vNF = vProd + vST + vFrete + vSeg + vOutro + vIPI − vDesc. Manter isto num
 * helper evita que cada teste redescubra a composição — e que um teste passe
 * por acidente ao mudar dois valores que se cancelam.
 */
export function corpoNota(opcoes: {
  numero?: string
  chave?: string | null
  quantidade?: number
  valorUnitario?: string
  frete?: string
  ipi?: string
  desconto?: string
  /** Sobrescreve o total, para exercitar a recusa de incoerência. */
  totalForcado?: string
} = {}) {
  const quantidade = opcoes.quantidade ?? 2
  const unitario = Number(opcoes.valorUnitario ?? '1500.0000')
  const produtos = quantidade * unitario
  const frete = Number(opcoes.frete ?? '0')
  const ipi = Number(opcoes.ipi ?? '0')
  const desconto = Number(opcoes.desconto ?? '0')
  const total = produtos + frete + ipi - desconto

  return {
    fornecedor_id: FORNECEDOR_A,
    filial_destino_id: FILIAL_A,
    numero: opcoes.numero ?? '55001',
    serie: '1',
    chave_acesso: opcoes.chave === undefined ? null : opcoes.chave,
    modelo_documento: '55',
    data_emissao: '2026-05-10',
    data_entrada: '2026-05-12',
    valor_produtos: produtos.toFixed(4),
    valor_frete: frete.toFixed(4),
    valor_ipi: ipi.toFixed(4),
    valor_desconto: desconto.toFixed(4),
    valor_total: opcoes.totalForcado ?? total.toFixed(4),
    itens: [
      {
        modelo_id: MODELO_A,
        descricao_nf: 'MULTIFUNC LASER MONO A4 45PPM',
        ncm: '84433221',
        cfop: '5551',
        quantidade,
        valor_unitario: unitario.toFixed(4),
        valor_total_item: produtos.toFixed(4),
        garantia_meses: 24,
      },
    ],
  }
}

/** Sequência de séries e patrimônios que não colidem com o parque semeado. */
let seqUnidade = 0
export function unidades(n: number, prefixo = 'NF') {
  return {
    unidades: Array.from({ length: n }, () => {
      seqUnidade += 1
      return {
        numero_serie: `${prefixo}-S${process.pid}-${seqUnidade}`,
        patrimonio: `${prefixo}-P${process.pid}-${seqUnidade}`,
      }
    }),
  }
}

/** Empresa do tenant A na massa de teste — toda conta bancária pertence a uma PJ. */
export const EMPRESA_A = '11111111-1111-4111-8111-1111111111e1'

/* --------------------------------------------- Módulo 10: contas a pagar */

/** Aprovadores com posto 1, 2 e 3 — os limites vêm de `semear.sql`. */
export const APROVADOR_N1 = '11111111-1111-4111-8111-111111110011'
export const APROVADOR_N2 = '11111111-1111-4111-8111-111111110012'
export const APROVADOR_N3 = '11111111-1111-4111-8111-111111110013'

export const CENTRO_OPER = '11111111-1111-4111-8111-11111111cc01'
export const CENTRO_ADM = '11111111-1111-4111-8111-11111111cc02'
export const CONTA_OPERACAO = '11111111-1111-4111-8111-11111111cb01'
export const CONTA_RECEBIMENTO = '11111111-1111-4111-8111-11111111cb02'

/* --------------------------------------------------- contas a receber */

export const CLIENTE_ALFA = '11111111-1111-4111-8111-11111111c101'
export const CLIENTE_GAMA = '11111111-1111-4111-8111-11111111c102'
/** ATIVO, com consumo de 2026-06: gera título contratual sem exceção. */
export const CONTRATO_COM_CONSUMO = '11111111-1111-4111-8111-1111111170a1'
/** SUSPENSO, com consumo de 2026-06: gera título EM_DISPUTA (RN-F11). */
export const CONTRATO_SUSPENSO = '11111111-1111-4111-8111-1111111170a5'
/** A competência semeada com consumo aberto. */
export const COMPETENCIA_ABERTA = '2026-06'

/**
 * Drena a fila de notificação **até esvaziar**, somando os lotes.
 *
 * `drenar` reserva um lote limitado (20, por padrão) na ordem de
 * `proxima_tentativa_em`: quem entrou primeiro sai primeiro. É o comportamento
 * correto em produção — e uma armadilha no teste, porque a suíte compartilha um
 * banco. Um arquivo que enfileirou trinta avisos deixa o aviso do teste
 * seguinte fora do primeiro lote, e a asserção falha dizendo "não foi enviado"
 * quando o que houve foi "ainda está na fila". São defeitos diferentes, e o
 * teste que os confunde acusa o código errado.
 *
 * O limite de voltas não é decoração: uma notificação que voltasse para a fila
 * pronta a ser reservada de novo faria este laço girar para sempre, e o teste
 * penduraria em vez de falhar.
 */
export async function drenarTudo(
  worker: { drenar(r: Remetente): Promise<ResultadoDrenagem> },
  remetente: Remetente,
): Promise<ResultadoDrenagem> {
  const total: ResultadoDrenagem = { reservadas: 0, enviadas: 0, falhas: 0 }
  for (let volta = 0; volta < 50; volta++) {
    const lote = await worker.drenar(remetente)
    total.reservadas += lote.reservadas
    total.enviadas += lote.enviadas
    total.falhas += lote.falhas
    if (lote.reservadas === 0) return total
  }
  throw new Error('a fila de notificação não esvaziou em 50 lotes')
}
