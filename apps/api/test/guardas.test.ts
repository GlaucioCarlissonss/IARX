import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Reflector } from '@nestjs/core'
import type { ExecutionContext } from '@nestjs/common'
import type { Claims } from '@iarx/contracts'
import { PermissaoGuard } from '../src/comum/permissao.guard.js'
import { ErroDominio } from '../src/comum/erros.js'
import { executarComContexto, type ContextoRequisicao } from '../src/comum/contexto.js'
import { CHAVE_PERMISSAO, CHAVE_PUBLICO } from '../src/comum/decoradores.js'

/**
 * Testes diretos da guarda de permissão.
 *
 * Existem separados dos testes HTTP por um motivo específico: o comportamento
 * mais importante da guarda — negar rota **sem** permissão declarada — não pode
 * ser exercitado pela API, porque nenhuma rota real está nessa condição. É
 * justamente a condição que nunca deve chegar à produção, e por isso precisa de
 * um teste que a construa de propósito.
 */

function contextoFalso(metadados: Record<string, unknown>): ExecutionContext {
  const alvo = () => undefined
  Reflect.defineMetadata(CHAVE_PERMISSAO, metadados[CHAVE_PERMISSAO], alvo)
  Reflect.defineMetadata(CHAVE_PUBLICO, metadados[CHAVE_PUBLICO], alvo)
  return {
    getHandler: () => alvo,
    getClass: () => class {},
  } as unknown as ExecutionContext
}

function comClaims<T>(permissoes: string[], fn: () => T): T {
  const ctx: ContextoRequisicao = {
    requestId: 'req_teste',
    metodo: 'GET',
    rota: '/teste',
    claims: {
      sub: '11111111-1111-4111-8111-111111110001',
      tenant_id: '11111111-1111-4111-8111-111111111111',
      usuario_id: '11111111-1111-4111-8111-111111110001',
      permissoes,
      escopos: [],
    } as unknown as Claims,
    db: null,
    idempotencyKey: null,
  }
  return executarComContexto(ctx, fn)
}

describe('PermissaoGuard', () => {
  const guarda = new PermissaoGuard(new Reflector())

  it('nega rota autenticada que não declara permissão', () => {
    const ctx = contextoFalso({})
    const erro = comClaims(['equipamento:ler'], () => {
      try {
        guarda.canActivate(ctx)
        return null
      } catch (e) {
        return e
      }
    })
    assert.ok(erro instanceof ErroDominio)
    assert.equal(erro.code, 'SEM_PERMISSAO')
    assert.match(erro.detail ?? '', /não declara/)
  })

  it('permite quando a permissão exigida está presente', () => {
    const ctx = contextoFalso({ [CHAVE_PERMISSAO]: 'equipamento:ler' })
    const ok = comClaims(['equipamento:ler', 'contrato:ler'], () => guarda.canActivate(ctx))
    assert.equal(ok, true)
  })

  it('nega quando a permissão exigida está ausente', () => {
    const ctx = contextoFalso({ [CHAVE_PERMISSAO]: 'equipamento:bloquear' })
    const erro = comClaims(['equipamento:ler'], () => {
      try {
        guarda.canActivate(ctx)
        return null
      } catch (e) {
        return e
      }
    })
    assert.ok(erro instanceof ErroDominio)
    assert.equal(erro.code, 'SEM_PERMISSAO')
  })

  it('rota pública passa sem claims', () => {
    const ctx = contextoFalso({ [CHAVE_PUBLICO]: true })
    assert.equal(guarda.canActivate(ctx), true)
  })
})
