import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  chamar,
  subirApi,
  TENANT_A,
  token,
  USUARIO_A,
  USUARIO_B,
  USUARIO_SUPERVISORA,
  type Servidor,
} from './apoio.js'

/**
 * Visões salvas de lista — Anexo Y §Y.3.5.
 *
 * O que estes casos protegem:
 *
 *  · **a visão pessoal não exige permissão nenhuma**. Era a alternativa em
 *    discussão — só visões compartilhadas —, e ela deixaria de fora quem tem
 *    o problema: quem opera resolveria o próprio dia pedindo a alguém;
 *  · **publicar exige `visao:compartilhar`, e a conferência é do banco**, pelo
 *    perfil e não pelo token. Um token vale até expirar; a revogação, não;
 *  · **a visão pessoal de outra pessoa não vem na lista** — e isso é a
 *    política, não a tela. Uma tela que só esconde deixa a rota aberta;
 *  · **nenhuma rota exige a permissão**, porque ela governa o corpo e não o
 *    caminho: criar a sua e publicar para todos entram pelo mesmo POST.
 */

let api: Servidor

/** Quem só opera: sem `visao:compartilhar` no perfil. */
const operador = () => token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['equipamento:ler', 'visao:ler', 'visao:gerenciar'] })

/** Quem supervisiona: a permissão está no perfil, como estaria em produção. */
const supervisora = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_SUPERVISORA, permissoes: ['equipamento:ler', 'visao:ler', 'visao:gerenciar', 'visao:compartilhar'] })

/** Outro usuário do mesmo locatário, para provar que a pessoal não vaza. */
const outro = () => token({ tenant: TENANT_A, usuario: USUARIO_B, permissoes: ['equipamento:ler', 'visao:ler', 'visao:gerenciar'] })

let n = 0
const nome = (p: string) => `${p} ${(n += 1)}`

before(async () => {
  api = await subirApi()
})
after(async () => {
  await api.fechar()
})

describe('visões pessoais', () => {
  it('qualquer um salva a sua, sem permissão nenhuma', async () => {
    const tk = await operador()
    const meu = nome('Minha ronda')

    const r = await chamar(api, 'POST', '/api/v1/visoes', {
      token: tk,
      corpo: { tela: 'parque', nome: meu, consulta: { estado: 'EM_MANUTENCAO' } },
    })
    assert.equal(r.status, 201, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.compartilhada, false)
    assert.equal(r.corpo.data.minha, true)
    assert.deepEqual(r.corpo.data.consulta, { estado: 'EM_MANUTENCAO' })
  })

  it('a visão pessoal de outra pessoa não aparece na lista', async () => {
    const meu = nome('Secreta')
    await chamar(api, 'POST', '/api/v1/visoes', {
      token: await operador(),
      corpo: { tela: 'clientes', nome: meu, consulta: { q: 'alfa' } },
    })

    const r = await chamar(api, 'GET', '/api/v1/visoes?tela=clientes', { token: await outro() })
    assert.equal(r.status, 200)
    const nomes = (r.corpo.data as { nome: string }[]).map((v) => v.nome)
    assert.ok(!nomes.includes(meu), `a visão pessoal vazou: ${nomes.join(', ')}`)
  })

  it('o mesmo nome pessoal pode existir para duas pessoas', async () => {
    const igual = nome('Ronda compartilhável')
    const a = await chamar(api, 'POST', '/api/v1/visoes', {
      token: await operador(),
      corpo: { tela: 'contratos', nome: igual, consulta: {} },
    })
    const b = await chamar(api, 'POST', '/api/v1/visoes', {
      token: await outro(),
      corpo: { tela: 'contratos', nome: igual, consulta: {} },
    })
    assert.equal(a.status, 201)
    assert.equal(b.status, 201, 'o nome de outra pessoa é invisível, então não pode bloquear')
  })

  it('o próprio nome repetido na mesma tela é recusado', async () => {
    const igual = nome('Duplicada')
    await chamar(api, 'POST', '/api/v1/visoes', {
      token: await operador(),
      corpo: { tela: 'estoque', nome: igual, consulta: {} },
    })
    const r = await chamar(api, 'POST', '/api/v1/visoes', {
      token: await operador(),
      corpo: { tela: 'estoque', nome: igual, consulta: {} },
    })
    assert.equal(r.status, 409, JSON.stringify(r.corpo))
    assert.equal(r.corpo.code, 'RECURSO_DUPLICADO')
  })
})

describe('visões da equipe', () => {
  it('publicar sem a permissão é recusado, e a recusa diz o que fazer', async () => {
    const r = await chamar(api, 'POST', '/api/v1/visoes', {
      token: await operador(),
      corpo: {
        tela: 'parque',
        nome: nome('Preventiva vencida'),
        consulta: { preventiva: 'VENCIDA' },
        compartilhada: true,
      },
    })
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
    assert.equal(r.corpo.code, 'SEM_PERMISSAO')
    // Recusa sem saída deixa o operador travado.
    assert.ok(
      JSON.stringify(r.corpo).includes('pessoal'),
      'a recusa precisa oferecer salvar como pessoal',
    )
  })

  it('promover a própria visão pessoal a compartilhada passa pela mesma tranca', async () => {
    const criada = await chamar(api, 'POST', '/api/v1/visoes', {
      token: await operador(),
      corpo: { tela: 'parque', nome: nome('Vai promover'), consulta: {} },
    })
    assert.equal(criada.status, 201)

    const r = await chamar(api, 'PATCH', `/api/v1/visoes/${criada.corpo.data.id}`, {
      token: await operador(),
      corpo: { compartilhada: true },
    })
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
    assert.equal(r.corpo.code, 'SEM_PERMISSAO')
  })

  it('quem tem a permissão publica, e todos passam a ver', async () => {
    const publica = nome('Da equipe')
    const criada = await chamar(api, 'POST', '/api/v1/visoes', {
      token: await supervisora(),
      corpo: { tela: 'chamados', nome: publica, consulta: { tipo: 'PREVENTIVA' }, compartilhada: true },
    })
    assert.equal(criada.status, 201, JSON.stringify(criada.corpo))
    assert.equal(criada.corpo.data.compartilhada, true)
    assert.equal(criada.corpo.data.dono_nome, 'Supervisora Alfa', 'a visão da equipe traz o nome de quem a criou')

    const lista = await chamar(api, 'GET', '/api/v1/visoes?tela=chamados', { token: await operador() })
    const achada = (lista.corpo.data as { nome: string; minha: boolean }[]).find((v) => v.nome === publica)
    assert.ok(achada, 'a visão da equipe precisa aparecer para quem não a criou')
    assert.equal(achada.minha, false)
  })

  it('mexer na visão da equipe de outra pessoa exige a mesma permissão', async () => {
    const criada = await chamar(api, 'POST', '/api/v1/visoes', {
      token: await supervisora(),
      corpo: { tela: 'contas_receber', nome: nome('Vencidos'), consulta: { status: 'APROVADO' }, compartilhada: true },
    })
    assert.equal(criada.status, 201)

    const r = await chamar(api, 'PATCH', `/api/v1/visoes/${criada.corpo.data.id}`, {
      token: await operador(),
      corpo: { consulta: { status: 'PENDENTE' } },
    })
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
    assert.ok(
      JSON.stringify(r.corpo).toLowerCase().includes('duplic'),
      'a recusa precisa apontar a saída: duplicar como minha',
    )
  })

  it('excluir a visão da equipe de outra pessoa exige a mesma permissão', async () => {
    const criada = await chamar(api, 'POST', '/api/v1/visoes', {
      token: await supervisora(),
      corpo: { tela: 'contas_pagar', nome: nome('A pagar hoje'), consulta: {}, compartilhada: true },
    })
    const negada = await chamar(api, 'DELETE', `/api/v1/visoes/${criada.corpo.data.id}`, {
      token: await operador(),
    })
    assert.equal(negada.status, 403, JSON.stringify(negada.corpo))

    const ok = await chamar(api, 'DELETE', `/api/v1/visoes/${criada.corpo.data.id}`, {
      token: await supervisora(),
    })
    assert.equal(ok.status, 204)
  })

  it('duas visões da equipe com o mesmo nome na mesma tela são recusadas', async () => {
    const igual = nome('Mesma faixa')
    await chamar(api, 'POST', '/api/v1/visoes', {
      token: await supervisora(),
      corpo: { tela: 'notas_fiscais', nome: igual, consulta: {}, compartilhada: true },
    })
    const r = await chamar(api, 'POST', '/api/v1/visoes', {
      token: await supervisora(),
      corpo: { tela: 'notas_fiscais', nome: ` ${igual.toUpperCase()} `, consulta: {}, compartilhada: true },
    })
    assert.equal(r.status, 409, JSON.stringify(r.corpo))
  })
})

describe('duplicar como minha', () => {
  it('é a saída de quem não pode editar a da equipe', async () => {
    const origem = nome('Para duplicar')
    const criada = await chamar(api, 'POST', '/api/v1/visoes', {
      token: await supervisora(),
      corpo: { tela: 'parque', nome: origem, consulta: { estado: 'BLOQUEADO' }, compartilhada: true },
    })
    assert.equal(criada.status, 201)

    const copia = await chamar(api, 'POST', `/api/v1/visoes/${criada.corpo.data.id}/duplicar`, {
      token: await operador(),
      corpo: {},
    })
    assert.equal(copia.status, 201, JSON.stringify(copia.corpo))
    // Nasce pessoal, sempre: duplicar é querer uma variação própria.
    assert.equal(copia.corpo.data.compartilhada, false)
    assert.equal(copia.corpo.data.minha, true)
    assert.deepEqual(copia.corpo.data.consulta, { estado: 'BLOQUEADO' })
    assert.ok(
      copia.corpo.data.nome.endsWith(' (minha)'),
      `o nome precisa dizer por que há duas: ${copia.corpo.data.nome}`,
    )

    // E a de origem não mudou — é essa a razão de a rota existir.
    const lista = await chamar(api, 'GET', '/api/v1/visoes?tela=parque', { token: await operador() })
    const intacta = (lista.corpo.data as { nome: string; compartilhada: boolean }[]).find(
      (v) => v.nome === origem,
    )
    assert.ok(intacta && intacta.compartilhada, 'duplicar não pode tocar na visão de origem')
  })

  it('aceita um nome escolhido por quem duplica', async () => {
    const criada = await chamar(api, 'POST', '/api/v1/visoes', {
      token: await supervisora(),
      corpo: { tela: 'clientes', nome: nome('Carteira'), consulta: {}, compartilhada: true },
    })
    const meu = nome('Do meu jeito')
    const copia = await chamar(api, 'POST', `/api/v1/visoes/${criada.corpo.data.id}/duplicar`, {
      token: await operador(),
      corpo: { nome: meu },
    })
    assert.equal(copia.status, 201)
    assert.equal(copia.corpo.data.nome, meu)
  })
})

describe('contrato da consulta', () => {
  it('a consulta precisa ser um objeto de parâmetros', async () => {
    const r = await chamar(api, 'POST', '/api/v1/visoes', {
      token: await operador(),
      corpo: { tela: 'parque', nome: nome('Lista solta'), consulta: ['estado'] },
    })
    assert.equal(r.status, 400, JSON.stringify(r.corpo))
  })

  it('tela fora do vocabulário é recusada antes de chegar ao banco', async () => {
    const r = await chamar(api, 'POST', '/api/v1/visoes', {
      token: await operador(),
      corpo: { tela: 'inventado', nome: nome('X'), consulta: {} },
    })
    assert.equal(r.status, 400, JSON.stringify(r.corpo))
  })

  it('a listagem exige a tela — uma faixa sem tela não é faixa de nada', async () => {
    const r = await chamar(api, 'GET', '/api/v1/visoes', { token: await operador() })
    assert.equal(r.status, 400, JSON.stringify(r.corpo))
  })
})
