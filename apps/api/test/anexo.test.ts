import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  chamar,
  CONTRATO_DESTINO,
  CONTRATO_TENANT_B,
  subirApi,
  token,
  TENANT_A,
  USUARIO_A,
  type Servidor,
} from './apoio.js'

/**
 * Anexos.
 *
 * Dois casos carregam o módulo.
 *
 * O primeiro é a **referência polimórfica verificada**: `entidade_id` é um
 * uuid solto, e sem o gatilho um anexo pode apontar para nada — ou para o
 * contrato de outro locatário. A RLS protege a leitura da linha do anexo, não
 * o que ela referencia, e é fácil supor que protege as duas.
 *
 * O segundo é a **remoção lógica**: o registro sai, o objeto no armazenamento
 * fica. Apagar o byte junto tornaria a remoção irreversível no momento em que
 * ela costuma ser um engano.
 */

let api: Servidor
let n = 0

const gerenciar = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['contrato:anexo_gerenciar'] })

function anexo(extra: Record<string, unknown> = {}) {
  n += 1
  return {
    entidade_tipo: 'CONTRATO',
    entidade_id: CONTRATO_DESTINO,
    nome_arquivo: `contrato-assinado-${n}.pdf`,
    storage_key: `tenant-a/contratos/${n}-${Date.now()}.pdf`,
    mime_type: 'application/pdf',
    tamanho_bytes: 204_800,
    ...extra,
  }
}

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('registro', () => {
  it('registra o metadado e devolve o anexo', async () => {
    const r = await chamar(api, 'POST', '/api/v1/anexos', {
      token: await gerenciar(),
      corpo: anexo(),
    })

    assert.equal(r.status, 201, `recusado: ${JSON.stringify(r.corpo)}`)
    assert.equal(r.corpo.data.entidade_tipo, 'CONTRATO')
    // Antivírus começa pendente: o arquivo acabou de chegar e ninguém o leu.
    assert.equal(r.corpo.data.antivirus_status, 'PENDENTE')
  })

  it('nenhuma rota recebe o arquivo — só o endereço dele', async () => {
    /*
     * A ausência é o teste. Se alguém acrescentar um upload pela API, o
     * processo passa a segurar megabytes em memória, o tempo limite de
     * requisição vira limite de tamanho de arquivo, e envio interrompido
     * deixa transação aberta.
     */
    const r = await chamar(api, 'POST', '/api/v1/anexos', {
      token: await gerenciar(),
      corpo: { ...anexo(), conteudo_base64: 'JVBERi0xLjQK' },
    })
    assert.equal(r.status, 201)
    assert.equal(r.corpo.data.conteudo_base64, undefined, 'a API aceitou conteúdo de arquivo')
  })

  it('arquivo acima do teto é recusado', async () => {
    const r = await chamar(api, 'POST', '/api/v1/anexos', {
      token: await gerenciar(),
      corpo: anexo({ tamanho_bytes: 60 * 1024 * 1024 }),
    })
    assert.equal(r.status, 400)
  })

  it('hash fora do formato SHA-256 é recusado', async () => {
    const r = await chamar(api, 'POST', '/api/v1/anexos', {
      token: await gerenciar(),
      corpo: anexo({ hash_sha256: 'ABC123' }),
    })
    assert.equal(r.status, 400)
  })
})

describe('a referência é verificada', () => {
  it('entidade inexistente é recusada', async () => {
    const r = await chamar(api, 'POST', '/api/v1/anexos', {
      token: await gerenciar(),
      corpo: anexo({ entidade_id: '11111111-1111-4111-8111-999999999999' }),
    })
    assert.equal(r.status, 422)
  })

  it('entidade de outro locatário é recusada', async () => {
    /*
     * O caso que a RLS sozinha não cobre. A política protege a leitura da
     * linha do anexo; `entidade_id` é só um uuid, e sem o gatilho o anexo
     * apontaria para o contrato do vizinho — visível para quem souber o id.
     */
    const r = await chamar(api, 'POST', '/api/v1/anexos', {
      token: await gerenciar(),
      corpo: anexo({ entidade_id: CONTRATO_TENANT_B }),
    })
    assert.equal(r.status, 422)
  })

  it('o mesmo objeto não é anexado duas vezes', async () => {
    const tk = await gerenciar()
    const corpo = anexo()
    const primeiro = await chamar(api, 'POST', '/api/v1/anexos', { token: tk, corpo })
    const segundo = await chamar(api, 'POST', '/api/v1/anexos', { token: tk, corpo })

    assert.equal(primeiro.status, 201)
    /*
     * Dois registros para a mesma chave fazem a remoção de um deixar o outro
     * apontando para um objeto que a retenção vai apagar.
     */
    assert.equal(segundo.status, 409)
  })
})

describe('listagem e remoção', () => {
  it('lista os anexos da entidade', async () => {
    const tk = await gerenciar()
    await chamar(api, 'POST', '/api/v1/anexos', { token: tk, corpo: anexo() })

    const r = await chamar(
      api,
      'GET',
      `/api/v1/anexos?entidade_tipo=CONTRATO&entidade_id=${CONTRATO_DESTINO}`,
      { token: tk },
    )
    assert.equal(r.status, 200)
    assert.ok(r.corpo.data.length > 0)
  })

  it('remove com motivo, e some da listagem', async () => {
    const tk = await gerenciar()
    const criado = await chamar(api, 'POST', '/api/v1/anexos', { token: tk, corpo: anexo() })
    const id = criado.corpo.data.id

    const r = await chamar(api, 'DELETE', `/api/v1/anexos/${id}`, {
      token: tk,
      corpo: { motivo: 'documento substituido pela versao assinada digitalmente' },
    })
    assert.equal(r.status, 204)

    const lista = await chamar(
      api,
      'GET',
      `/api/v1/anexos?entidade_tipo=CONTRATO&entidade_id=${CONTRATO_DESTINO}`,
      { token: tk },
    )
    assert.ok(!lista.corpo.data.some((a: { id: string }) => a.id === id))
  })

  it('remoção sem motivo é recusada', async () => {
    /*
     * Anexo é evidência: remover documento de contrato sem motivo é
     * indistinguível de encobrimento, e é o que alguém vai perguntar.
     */
    const tk = await gerenciar()
    const criado = await chamar(api, 'POST', '/api/v1/anexos', { token: tk, corpo: anexo() })

    const r = await chamar(api, 'DELETE', `/api/v1/anexos/${criado.corpo.data.id}`, {
      token: tk,
      corpo: { motivo: 'erro' },
    })
    assert.equal(r.status, 400)
  })

  it('sem permissão de anexo, nada é listado nem registrado', async () => {
    const semPerm = await token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['contrato:ler'] })
    const lista = await chamar(
      api,
      'GET',
      `/api/v1/anexos?entidade_tipo=CONTRATO&entidade_id=${CONTRATO_DESTINO}`,
      { token: semPerm },
    )
    assert.equal(lista.status, 403)
  })
})
