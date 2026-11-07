import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  chamar,
  chaveIdempotencia,
  CATEGORIA_A,
  CLIENTE_ALFA,
  consultarBanco,
  FABRICANTE_A,
  subirApi,
  TENANT_A,
  token,
  USUARIO_A,
  USUARIO_COMPRADOR,
  type Servidor,
} from './apoio.js'

/**
 * Cadastros de apoio: catálogo, peça, fornecedor, técnico e inativação de
 * cliente.
 *
 * O que estes casos protegem:
 *
 *  · **não existe `DELETE`**. As quatro entidades são apontadas por registros
 *    históricos — peça por movimento de estoque, fornecedor por nota lançada,
 *    técnico por ordem validada, modelo por equipamento em campo. A ausência é
 *    deliberada e tem teste, para que acrescentar um por conveniência reprove;
 *  · inativar exige motivo: o cadastro sai das listas e quem procurar depois
 *    precisa achar por que ele saiu de uso;
 *  · cliente com contrato vigente não é inativado — a cobrança continuaria
 *    sendo gerada todo mês para alguém que sumiu das telas.
 */

let api: Servidor
let n = 0

const catalogo = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['equipamento:ler', 'catalogo:gerenciar'] })
const pecas = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['peca:ler', 'peca:criar', 'peca:editar'] })
const fornecedores = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['fornecedor:ler', 'fornecedor:gerenciar'] })
const tecnicos = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['tecnico:gerenciar'] })

before(async () => {
  api = await subirApi()
})
after(async () => {
  await api.fechar()
})

describe('catálogo', () => {
  it('cria e edita modelo com o preço de tabela como decimal', async () => {
    const tk = await catalogo()
    n += 1

    const r = await chamar(api, 'POST', '/api/v1/catalogo/modelos', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('modelo') },
      corpo: {
        fabricante_id: FABRICANTE_A,
        categoria_id: CATEGORIA_A,
        codigo: `CAD-${Date.now()}-${n}`,
        nome: 'Modelo de cadastro',
        preco_tabela_mensal: '349.9000',
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.corpo))

    /*
     * O contrato dizia "inteiro em centavos" e a coluna é `numeric(15,4)`
     * desde a 0004 — o driver devolve string. Ninguém consumia o campo, então
     * a divergência era latente: o primeiro consumidor leria R$ 3,49 ou um
     * `NaN`, conforme o que fizesse com a string.
     */
    const l = await consultarBanco<{ preco: string }>(
      TENANT_A,
      `select preco_tabela_mensal::text as preco from public.modelo where id = $1`,
      [r.corpo.data.id],
    )
    assert.equal(l[0]!.preco, '349.9000')

    const e = await chamar(api, 'PATCH', `/api/v1/catalogo/modelos/${r.corpo.data.id}`, {
      token: tk,
      corpo: {
        fabricante_id: FABRICANTE_A,
        categoria_id: CATEGORIA_A,
        codigo: `CAD-${Date.now()}-${n}`,
        nome: 'Modelo de cadastro revisado',
        preco_tabela_mensal: '399.0000',
      },
    })
    assert.equal(e.status, 200, JSON.stringify(e.corpo))
  })

  it('gerenciar catálogo é permissão própria, separada de ler', async () => {
    const soLe = await token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['equipamento:ler'] })
    const r = await chamar(api, 'POST', '/api/v1/catalogo/fabricantes', {
      token: soLe,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('fab') },
      corpo: { nome: 'Fabricante sem permissão' },
    })
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
  })
})

describe('peça', () => {
  it('cria, edita e inativa — e inativar exige motivo', async () => {
    const tk = await pecas()
    n += 1

    const r = await chamar(api, 'POST', '/api/v1/pecas', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('peca') },
      corpo: {
        codigo_interno: `CAD-PECA-${Date.now()}-${n}`,
        descricao: 'Kit de manutencao preventiva',
        unidade: 'KIT',
        criticidade: 'ALTA',
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.corpo))
    const id = r.corpo.data.id

    const semMotivo = await chamar(api, 'POST', `/api/v1/pecas/${id}/inativar`, {
      token: tk,
      corpo: { motivo: 'nao usa' },
    })
    assert.equal(semMotivo.status, 400, JSON.stringify(semMotivo.corpo))
    assert.equal(semMotivo.corpo.errors[0].field, 'motivo')

    const ok = await chamar(api, 'POST', `/api/v1/pecas/${id}/inativar`, {
      token: tk,
      corpo: { motivo: 'peca descontinuada pelo fabricante' },
    })
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo))

    const l = await consultarBanco<{ ativo: boolean; motivo: string | null }>(
      TENANT_A,
      `select ativo, delete_reason as motivo from public.peca where id = $1`,
      [id],
    )
    /*
     * Inativar, nunca apagar: a peça sai das listas de escolha e continua
     * resolvendo os movimentos de estoque de meses atrás que a apontam.
     */
    assert.equal(l[0]!.ativo, false)
    assert.match(l[0]!.motivo ?? '', /descontinuada/)

    const volta = await chamar(api, 'POST', `/api/v1/pecas/${id}/reativar`, { token: tk })
    assert.equal(volta.status, 200, JSON.stringify(volta.corpo))
  })

  it('criar e editar peça são permissões diferentes', async () => {
    const soCria = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['peca:ler', 'peca:criar'],
    })
    n += 1
    const r = await chamar(api, 'POST', '/api/v1/pecas', {
      token: soCria,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('peca') },
      corpo: { codigo_interno: `CAD-P2-${Date.now()}-${n}`, descricao: 'Peca de teste de permissao' },
    })
    assert.equal(r.status, 201, JSON.stringify(r.corpo))

    const e = await chamar(api, 'PATCH', `/api/v1/pecas/${r.corpo.data.id}`, {
      token: soCria,
      corpo: { codigo_interno: 'OUTRO', descricao: 'tentativa de edicao sem permissao' },
    })
    assert.equal(e.status, 403, JSON.stringify(e.corpo))
  })
})

describe('fornecedor', () => {
  it('documento duplicado é recusado apontando o campo', async () => {
    const tk = await fornecedores()
    const documento = String(Date.now()).padStart(14, '1').slice(0, 14)

    const um = await chamar(api, 'POST', '/api/v1/fornecedores', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('forn') },
      corpo: { documento, razao_social: 'Fornecedor de teste LTDA' },
    })
    assert.equal(um.status, 201, JSON.stringify(um.corpo))

    const dois = await chamar(api, 'POST', '/api/v1/fornecedores', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('forn') },
      corpo: { documento, razao_social: 'Outro nome, mesmo documento' },
    })
    assert.equal(dois.status, 409, JSON.stringify(dois.corpo))
    assert.equal(dois.corpo.errors[0].field, 'documento')
  })

  it('a listagem separa ativos de inativos', async () => {
    const tk = await fornecedores()
    const documento = String(Date.now() + 7).padStart(14, '2').slice(0, 14)

    const novo = await chamar(api, 'POST', '/api/v1/fornecedores', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('forn') },
      corpo: { documento, razao_social: 'Fornecedor a inativar LTDA' },
    })
    const id = novo.corpo.data.id

    const inat = await chamar(api, 'POST', `/api/v1/fornecedores/${id}/inativar`, {
      token: tk,
      corpo: { motivo: 'contrato de fornecimento encerrado' },
    })
    assert.equal(inat.status, 200, JSON.stringify(inat.corpo))

    const ativos = await chamar(api, 'GET', '/api/v1/fornecedores?ativo=1', { token: tk })
    assert.ok(!ativos.corpo.data.some((f: { id: string }) => f.id === id))

    const inativos = await chamar(api, 'GET', '/api/v1/fornecedores?ativo=0', { token: tk })
    assert.ok(inativos.corpo.data.some((f: { id: string }) => f.id === id))
  })
})

describe('técnico', () => {
  it('cria com vínculo de usuário opcional', async () => {
    const tk = await tecnicos()

    const semUsuario = await chamar(api, 'POST', '/api/v1/tecnicos', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('tec') },
      corpo: { nome: 'Prestador terceirizado', especialidades: ['impressao'] },
    })
    /*
     * Técnico sem usuário é legítimo — terceiro, prestador. O vínculo é o que
     * RN-027 usa para saber que executor e validador são a mesma pessoa; sem
     * ele a segregação se apoia só em quem registrou a validação.
     */
    assert.equal(semUsuario.status, 201, JSON.stringify(semUsuario.corpo))

    const comUsuario = await chamar(api, 'POST', '/api/v1/tecnicos', {
      token: tk,
      cabecalhos: { 'Idempotency-Key': chaveIdempotencia('tec') },
      // Um usuário só tem um técnico: `USUARIO_A` já tem o da massa, e é por
      // isso que RN-027 consegue dizer que executor e validador são a mesma
      // pessoa. O vínculo aqui usa outro usuário.
      corpo: { nome: 'Tecnico com login', usuario_id: USUARIO_COMPRADOR, custo_hora: '85.0000' },
    })
    assert.equal(comUsuario.status, 201, JSON.stringify(comUsuario.corpo))
  })
})

describe('inativação de cliente', () => {
  it('cliente com contrato vigente não é inativado, e a recusa diz o que falta', async () => {
    const tk = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['cliente:ler', 'cliente:inativar'],
    })
    const r = await chamar(api, 'POST', `/api/v1/clientes/${CLIENTE_ALFA}/inativar`, {
      token: tk,
      corpo: { motivo: 'cliente encerrou operacao na regiao' },
    })
    assert.equal(r.status, 422, JSON.stringify(r.corpo))
    assert.ok(Array.isArray(r.corpo.acoes_sugeridas) && r.corpo.acoes_sugeridas.length > 0)
  })

  it('inativar cliente é permissão própria, separada de editar', async () => {
    const soEdita = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['cliente:ler', 'cliente:editar'],
    })
    const r = await chamar(api, 'POST', `/api/v1/clientes/${CLIENTE_ALFA}/inativar`, {
      token: soEdita,
      corpo: { motivo: 'tentativa com permissao de edicao' },
    })
    /*
     * Editar corrige um endereço; inativar tira o cliente das listas e dos
     * filtros padrão de todo o sistema. Não é a mesma decisão.
     */
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
  })
})

describe('a API não oferece exclusão de cadastro', () => {
  it('não há DELETE em peça, fornecedor, técnico nem modelo', async () => {
    /*
     * A ausência é o teste. Se alguém acrescentar um `DELETE` por
     * conveniência, este caso reprova — e é o aviso de que o histórico passou
     * a depender de ninguém usar a rota nova.
     */
    const tk = await pecas()
    const alvo = '11111111-1111-4111-8111-11111111f201'
    for (const caminho of [
      `/api/v1/pecas/${alvo}`,
      `/api/v1/fornecedores/${alvo}`,
      `/api/v1/tecnicos/${alvo}`,
      `/api/v1/catalogo/modelos/${alvo}`,
    ]) {
      const r = await chamar(api, 'DELETE', caminho, { token: tk })
      assert.ok(
        r.status === 404 || r.status === 405,
        `DELETE ${caminho} respondeu ${r.status} — existe rota de exclusão de cadastro`,
      )
    }
  })
})
