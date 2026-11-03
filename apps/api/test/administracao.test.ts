import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  chamar,
  consultarBanco,
  subirApi,
  TENANT_A,
  token,
  USUARIO_A,
  type Servidor,
} from './apoio.js'

/**
 * Alçadas, trilha de auditoria e reabertura de competência.
 *
 * O que estes casos protegem:
 *
 *  · a alçada é configurável. Seis regras do sistema a consultam e todas
 *    seguem a convenção "só morde onde foi configurada" — sem rota, as seis
 *    ficam desligadas em qualquer locatário que não tenha quem escreva no
 *    banco, e o teste de cada uma prova apenas que a regra funcionaria;
 *  · o limite tem de ser do tipo que a regra lê. Teto percentual num tipo que
 *    mede reais não é lido por ninguém, e quem o cadastra acredita ter
 *    configurado a regra;
 *  · a trilha é só leitura, e a ausência de rota de escrita é parte de RN-018.
 */

let api: Servidor

const admin = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['alcada:definir'] })
const auditor = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['auditoria:consultar'] })

/**
 * Perfil de bancada, sem usuário vinculado.
 *
 * As seis regras que leem `alcada` chegam até ela por `usuario_perfil`, então
 * escrever alçada num perfil sem usuário não muda o comportamento de nenhum
 * outro teste. A primeira versão destes casos usava o perfil de administrador
 * e alterava o resultado dos testes de emissão de fatura e de aprovação de
 * pagamento, que leem os mesmos limites — a suíte semeia sem recriar o banco.
 */
const PERFIL_ADMIN = '11111111-1111-4111-8111-1111111150b1'

before(async () => {
  api = await subirApi()
})
after(async () => {
  /*
   * Limpa as alçadas que estes casos criaram.
   *
   * Um perfil sem usuário não basta: os testes de contas a receber e a pagar
   * rankeiam as **faixas distintas** de limite no locatário inteiro, não por
   * perfil. Toda linha nova aqui acrescenta uma faixa e muda o nível que
   * aqueles casos esperam — a suíte semeia sem recriar o banco, e o arquivo
   * que escreve no estado compartilhado é quem tem de desfazê-lo.
   */
  await consultarBanco(TENANT_A, `delete from public.alcada where perfil_id = $1`, [PERFIL_ADMIN])
  await api.fechar()
})

describe('configuração de alçada', () => {
  it('definir duas vezes o mesmo par (perfil, tipo) deixa uma', async () => {
    const tk = await admin()

    const um = await chamar(api, 'PUT', '/api/v1/alcadas', {
      token: tk,
      corpo: { perfil_id: PERFIL_ADMIN, tipo: 'LIBERACAO_BLOQUEIO', limite_valor: '1000.0000' },
    })
    assert.equal(um.status, 200, JSON.stringify(um.corpo))

    const dois = await chamar(api, 'PUT', '/api/v1/alcadas', {
      token: tk,
      corpo: { perfil_id: PERFIL_ADMIN, tipo: 'LIBERACAO_BLOQUEIO', limite_valor: '7500.0000' },
    })
    assert.equal(dois.status, 200, JSON.stringify(dois.corpo))

    const doTipo = dois.corpo.data.filter((a: { tipo: string }) => a.tipo === 'LIBERACAO_BLOQUEIO')
    assert.equal(doTipo.length, 1)
    assert.equal(doTipo[0].limite_valor, '7500.0000')
  })

  it('o limite tem de ser do tipo que a regra lê', async () => {
    const tk = await admin()

    const errado = await chamar(api, 'PUT', '/api/v1/alcadas', {
      token: tk,
      corpo: { perfil_id: PERFIL_ADMIN, tipo: 'CUSTO_OS', limite_percentual: '15.00' },
    })
    /*
     * Teto percentual num tipo que mede reais não é lido por ninguém. Alçada
     * que existe e não vale é pior que alçada ausente, porque ninguém procura
     * o que acha que já fez.
     */
    assert.equal(errado.status, 400, JSON.stringify(errado.corpo))

    const tambemErrado = await chamar(api, 'PUT', '/api/v1/alcadas', {
      token: tk,
      corpo: { perfil_id: PERFIL_ADMIN, tipo: 'DESCONTO', limite_valor: '500.0000' },
    })
    assert.equal(tambemErrado.status, 400, JSON.stringify(tambemErrado.corpo))
  })

  it('a alçada configurada pela rota é a que as regras passam a ler', async () => {
    const tk = await admin()
    await chamar(api, 'PUT', '/api/v1/alcadas', {
      token: tk,
      corpo: { perfil_id: PERFIL_ADMIN, tipo: 'LIBERACAO_CLIENTE', limite_valor: '2500.0000' },
    })

    /*
     * A ponte entre a rota e a regra: as funções `app.limite_*` leem esta
     * mesma tabela. Sem a conferência, a rota poderia gravar numa coluna que
     * nenhuma regra consulta e os dois lados pareceriam corretos.
     */
    const l = await consultarBanco<{ limite: string }>(
      TENANT_A,
      `select a.limite_valor::text as limite
         from public.alcada a
        where a.perfil_id = $1 and a.tipo = 'LIBERACAO_CLIENTE'`,
      [PERFIL_ADMIN],
    )
    assert.equal(l[0]?.limite, '2500.0000')
  })

  it('definir alçada é permissão própria', async () => {
    const semPermissao = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['perfil:gerenciar'],
    })
    const r = await chamar(api, 'PUT', '/api/v1/alcadas', {
      token: semPermissao,
      corpo: { perfil_id: PERFIL_ADMIN, tipo: 'CUSTO_OS', limite_valor: '100.0000' },
    })
    // Quem gerencia perfis não decide até quanto cada perfil aprova.
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
  })

  it('remover desliga a regra, e a lista reflete', async () => {
    const tk = await admin()
    const antes = await chamar(api, 'PUT', '/api/v1/alcadas', {
      token: tk,
      corpo: { perfil_id: PERFIL_ADMIN, tipo: 'CANCELAMENTO_FATURA', limite_valor: '900.0000' },
    })
    const alvo = antes.corpo.data.find((a: { tipo: string }) => a.tipo === 'CANCELAMENTO_FATURA')
    assert.ok(alvo)

    const r = await chamar(api, 'DELETE', `/api/v1/alcadas/${alvo.id}`, { token: tk })
    assert.equal(r.status, 204, JSON.stringify(r.corpo))

    const depois = await chamar(api, 'GET', `/api/v1/alcadas?perfil_id=${PERFIL_ADMIN}`, { token: tk })
    assert.ok(
      !depois.corpo.data.some((a: { tipo: string }) => a.tipo === 'CANCELAMENTO_FATURA'),
      'a alçada removida continuou na lista',
    )
  })
})

describe('trilha de auditoria', () => {
  it('a consulta devolve o que foi escrito, do mais recente para o mais antigo', async () => {
    // Gera uma escrita auditável agora.
    await chamar(api, 'PUT', '/api/v1/alcadas', {
      token: await admin(),
      corpo: { perfil_id: PERFIL_ADMIN, tipo: 'EMISSAO_FATURA', limite_valor: '12000.0000' },
    })

    const r = await chamar(api, 'GET', '/api/v1/auditoria?entidade_tipo=alcada', {
      token: await auditor(),
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    assert.ok(r.corpo.data.length > 0, 'a trilha não registrou a escrita na alçada')

    const datas = r.corpo.data.map((x: { criado_em: string }) => Date.parse(x.criado_em))
    for (let i = 1; i < datas.length; i += 1) {
      assert.ok(datas[i - 1] >= datas[i], 'a trilha não veio do mais recente para o mais antigo')
    }
  })

  it('não existe rota que escreva na trilha', async () => {
    /*
     * A ausência é o teste. RN-018 diz que o log é imutável "por qualquer
     * perfil, inclusive administrador" — se alguém acrescentar um `POST
     * /auditoria` por conveniência, este caso reprova, e é o aviso de que a
     * frase deixou de ser verdadeira.
     */
    const tk = await auditor()
    for (const [metodo, caminho] of [
      ['POST', '/api/v1/auditoria'],
      ['PUT', '/api/v1/auditoria'],
      ['DELETE', '/api/v1/auditoria'],
    ] as const) {
      const r = await chamar(api, metodo, caminho, { token: tk, corpo: { entidade_tipo: 'x' } })
      assert.ok(
        r.status === 404 || r.status === 405,
        `${metodo} ${caminho} respondeu ${r.status} — existe rota de escrita na trilha`,
      )
    }
  })

  it('consultar a trilha é permissão própria', async () => {
    const r = await chamar(api, 'GET', '/api/v1/auditoria', { token: await admin() })
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
  })
})

describe('reabertura de competência', () => {
  it('reabrir o que não está fechado devolve zero, não erro', async () => {
    const tk = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['competencia:reabrir'],
    })
    const r = await chamar(api, 'POST', '/api/v1/competencias/2029-11/reabrir', {
      token: tk,
      corpo: { motivo: 'competencia sem nada fechado, conferencia de rotina' },
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    // Zero é "não havia nada fechado" — diferente de falha.
    assert.equal(r.corpo.data.consumos_reabertos, 0)
  })

  it('fechar e reabrir são permissões diferentes', async () => {
    const soFecha = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['competencia:fechar'],
    })
    const r = await chamar(api, 'POST', '/api/v1/competencias/2029-11/reabrir', {
      token: soFecha,
      corpo: { motivo: 'tentativa de reabrir com permissao de fechar' },
    })
    /*
     * Reabrir desfaz um fechamento que alguém conferiu. Com a mesma permissão
     * das duas, quem fecha desfaz o próprio fechamento — e o Anexo B diz
     * "apenas por alçada" justamente porque não é a mesma decisão.
     */
    assert.equal(r.status, 403, JSON.stringify(r.corpo))
  })

  it('motivo curto é recusado apontando o campo', async () => {
    const tk = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['competencia:reabrir'],
    })
    const r = await chamar(api, 'POST', '/api/v1/competencias/2029-11/reabrir', {
      token: tk,
      corpo: { motivo: 'erro' },
    })
    assert.equal(r.status, 400, JSON.stringify(r.corpo))
    assert.equal(r.corpo.errors[0].field, 'motivo')
  })
})
