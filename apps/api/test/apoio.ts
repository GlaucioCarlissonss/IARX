import { NestFactory } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { SignJWT } from 'jose'
import type { AddressInfo } from 'node:net'
import type { Permissao } from '@iarx/contracts'
import { AppModule } from '../src/app.module.js'

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
}): Promise<string> {
  const agora = Math.floor(Date.now() / 1000)
  return new SignJWT({
    tenant_id: opcoes.tenant ?? TENANT_A,
    usuario_id: opcoes.usuario ?? USUARIO_A,
    permissoes: opcoes.permissoes ?? [],
    escopos: [{ tipo: 'TENANT', id: null }],
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
