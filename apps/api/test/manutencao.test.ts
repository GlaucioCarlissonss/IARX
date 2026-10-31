import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  chamar,
  EQUIP_LIVRE_1,
  subirApi,
  TECNICO_COM_LOGIN,
  TECNICO_SEM_LOGIN,
  token,
  TENANT_A,
  USUARIO_A,
  type Servidor,
} from './apoio.js'

/**
 * Ordens de serviço.
 *
 * O que estes casos protegem é a razão de cada transição ser uma ação nomeada
 * com permissão própria, em vez de um `PATCH status`: **com um `PATCH`, quem
 * pudesse mudar o status levaria a OS de ponta a ponta sozinho** — abriria,
 * executaria e validaria o próprio trabalho —, que é exatamente o que RN-027
 * existe para impedir.
 *
 * A máquina de estados em si é provada no banco, em `19_mnt_ordem_servico.sql`.
 * Aqui se prova que a API não a contorna e que as permissões a acompanham.
 */

let api: Servidor

const PERM_TODAS = [
  'os:ler',
  'os:criar',
  'os:triar',
  'os:agendar',
  'os:executar',
  'os:concluir',
  'os:validar',
  'os:cancelar',
  'os:sla_pausar',
] as const

const comTudo = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: [...PERM_TODAS] })

const SINTOMA = 'bandeja 2 não puxa papel e trava a fila de impressão'

async function abrir(tk: string) {
  const r = await chamar(api, 'POST', '/api/v1/ordens-servico', {
    token: tk,
    corpo: { equipamento_id: EQUIP_LIVRE_1, descricao: SINTOMA },
  })
  assert.equal(r.status, 201, `abertura recusada: ${JSON.stringify(r.corpo)}`)
  return r.corpo.data
}

async function ate(tk: string, id: string, ...passos: [string, unknown?][]) {
  for (const [acao, corpo] of passos) {
    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${id}/${acao}`, { token: tk, corpo })
    assert.equal(r.status, 200, `${acao} recusado: ${JSON.stringify(r.corpo)}`)
  }
}

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('abertura', () => {
  it('abre com número gerado e status ABERTA', async () => {
    const os = await abrir(await comTudo())
    assert.match(os.numero, /^\d{4}-\d{5}$/)
    assert.equal(os.status, 'ABERTA')
    assert.equal(os.tipo, 'CORRETIVA')
    // Custo zero, e derivado: as quatro parcelas somam o total.
    assert.equal(os.custo_total, '0.0000')
  })

  it('sintoma de uma palavra é recusado', async () => {
    /*
     * "não funciona" não é chamado: é um pedido para alguém ir descobrir o que
     * houve. O piso não garante qualidade, mas impede o campo de virar
     * formalidade — e quem precisa escrever quinze caracteres costuma
     * escrever o que viu.
     */
    const r = await chamar(api, 'POST', '/api/v1/ordens-servico', {
      token: await comTudo(),
      corpo: { equipamento_id: EQUIP_LIVRE_1, descricao: 'quebrou' },
    })
    assert.equal(r.status, 400)
  })

  it('numeração não repete', async () => {
    const tk = await comTudo()
    const a = await abrir(tk)
    const b = await abrir(tk)
    assert.notEqual(a.numero, b.numero)
  })
})

describe('transições', () => {
  it('percorre triagem, agendamento, execução e conclusão', async () => {
    const tk = await comTudo()
    const os = await abrir(tk)

    await ate(
      tk,
      os.id,
      ['triar', { tipo: 'CORRETIVA', prioridade: 'ALTA' }],
      ['agendar', { tecnico_id: TECNICO_SEM_LOGIN }],
      ['iniciar'],
      [
        'concluir',
        {
          causa_raiz: 'rolete de tração desgastado além do limite',
          solucao: 'rolete substituído e tração testada em 50 páginas',
          causa_responsabilidade: 'DESGASTE_NATURAL',
          custo_mao_obra: '120.0000',
          custo_material: '80.0000',
        },
      ],
    )

    const final = await chamar(api, 'GET', `/api/v1/ordens-servico/${os.id}`, { token: tk })
    assert.equal(final.corpo.data.status, 'CONCLUIDA')
    // Derivado no banco: a soma não passa pela aplicação.
    assert.equal(final.corpo.data.custo_total, '200.0000')
    assert.ok(final.corpo.data.resposta_em, 'o check-in precisa marcar o SLA de resposta')
  })

  it('transição fora da máquina de estados é recusada pelo banco', async () => {
    const tk = await comTudo()
    const os = await abrir(tk)

    // ABERTA → EM_EXECUCAO não existe: falta agendar.
    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/iniciar`, { token: tk })
    assert.equal(r.status, 422)
    assert.equal(r.corpo.code, 'TRANSICAO_INVALIDA')
    assert.doesNotMatch(JSON.stringify(r.corpo), /não identificada/)
  })

  it('concluir sem causa raiz é recusado', async () => {
    /*
     * Causa raiz é o campo que separa manutenção de troca de peça: sem ele, a
     * mesma máquina volta com o mesmo defeito e ninguém consegue mostrar que
     * já voltou.
     */
    const tk = await comTudo()
    const os = await abrir(tk)
    await ate(tk, os.id, ['triar', { tipo: 'CORRETIVA', prioridade: 'MEDIA' }],
      ['agendar', { tecnico_id: TECNICO_SEM_LOGIN }], ['iniciar'])

    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/concluir`, {
      token: tk,
      corpo: { causa_raiz: 'x', solucao: 'y', causa_responsabilidade: 'LOCADORA' },
    })
    assert.equal(r.status, 400)
  })
})

describe('RN-027 — quem executa não valida', () => {
  it('o executor não valida a própria ordem', async () => {
    /*
     * `TECNICO_COM_LOGIN` é o próprio `USUARIO_A`, que é quem o token
     * representa. Validar aqui seria validar o próprio trabalho.
     */
    const tk = await comTudo()
    const os = await abrir(tk)
    await ate(tk, os.id,
      ['triar', { tipo: 'CORRETIVA', prioridade: 'MEDIA' }],
      ['agendar', { tecnico_id: TECNICO_COM_LOGIN }],
      ['iniciar'],
      ['concluir', {
        causa_raiz: 'fusor fora da faixa de temperatura',
        solucao: 'fusor substituído e temperatura conferida',
        causa_responsabilidade: 'DESGASTE_NATURAL',
      }])

    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/validar`, { token: tk })
    assert.equal(r.status, 422)
    /*
     * A mensagem importa tanto quanto a recusa. Na primeira versão o gatilho
     * levantava `23514` sem nome de constraint, e a API respondia
     * "A operação viola a regra 'não identificada'" — recusa correta,
     * inutilizável para quem a lê. Nomear a constraint liga o gatilho à
     * tabela de mensagens que a API já mantém.
     */
    assert.match(r.corpo.title, /quem executou não pode validar/i)
    assert.doesNotMatch(JSON.stringify(r.corpo), /não identificada/)
    assert.ok((r.corpo.acoes_sugeridas ?? []).length > 0, 'recusa sem saída vira chamado')
  })

  it('quem não executou valida', async () => {
    const tk = await comTudo()
    const os = await abrir(tk)
    await ate(tk, os.id,
      ['triar', { tipo: 'CORRETIVA', prioridade: 'MEDIA' }],
      ['agendar', { tecnico_id: TECNICO_SEM_LOGIN }],
      ['iniciar'],
      ['concluir', {
        causa_raiz: 'correia de transferência rompida',
        solucao: 'correia substituída',
        causa_responsabilidade: 'DESGASTE_NATURAL',
      }],
      ['validar'])

    const final = await chamar(api, 'GET', `/api/v1/ordens-servico/${os.id}`, { token: tk })
    assert.equal(final.corpo.data.status, 'VALIDADA')
    assert.equal(final.corpo.data.validado_por, USUARIO_A)
  })

  it('o validador vem do token, não do corpo', async () => {
    /*
     * A rota não aceita corpo. Se aceitasse um `validado_por`, RN-027 seria
     * cumprida por quem quisesse, bastando informar outro nome — e a
     * segregação viraria campo de formulário.
     */
    const tk = await comTudo()
    const os = await abrir(tk)
    await ate(tk, os.id,
      ['triar', { tipo: 'CORRETIVA', prioridade: 'MEDIA' }],
      ['agendar', { tecnico_id: TECNICO_COM_LOGIN }],
      ['iniciar'],
      ['concluir', {
        causa_raiz: 'placa formatadora com falha intermitente',
        solucao: 'placa substituída',
        causa_responsabilidade: 'DESGASTE_NATURAL',
      }])

    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/validar`, {
      token: tk,
      corpo: { validado_por: '11111111-1111-4111-8111-111111110011' },
    })
    assert.equal(r.status, 422, 'o corpo não pode trocar quem validou')
  })
})

describe('pausa de SLA', () => {
  it('pausa com motivo, retoma e acumula o tempo parado', async () => {
    const tk = await comTudo()
    const os = await abrir(tk)
    await ate(tk, os.id,
      ['triar', { tipo: 'CORRETIVA', prioridade: 'MEDIA' }],
      ['agendar', { tecnico_id: TECNICO_SEM_LOGIN }],
      ['iniciar'],
      ['pausar', { motivo: 'AGUARDANDO_PECA', justificativa: 'rolete sem saldo no depósito central' }])

    const pausada = await chamar(api, 'GET', `/api/v1/ordens-servico/${os.id}`, { token: tk })
    assert.equal(pausada.corpo.data.status, 'AGUARDANDO_PECA')

    await ate(tk, os.id, ['retomar'])
    const retomada = await chamar(api, 'GET', `/api/v1/ordens-servico/${os.id}`, { token: tk })
    assert.equal(retomada.corpo.data.status, 'EM_EXECUCAO')
    assert.ok(retomada.corpo.data.tempo_pausado_minutos >= 0)
  })

  it('retomar sem pausa aberta não encontra o que retomar', async () => {
    const tk = await comTudo()
    const os = await abrir(tk)
    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/retomar`, { token: tk })
    assert.equal(r.status, 404)
  })
})

describe('paginação', () => {
  it('a segunda página continua de onde a primeira parou, sem pular nem repetir', async () => {
    /*
     * Este caso nasceu de um defeito que o portão de superfície de módulo
     * revelou de lado: a consulta ordenava por `created_at` e o cursor era
     * montado com `abertura_em`. São colunas diferentes — quando o chamado
     * entrou contra quando a linha foi gravada — e divergem sempre que uma OS
     * é digitada depois do fato, que é todo chamado aberto por telefone.
     *
     * Com as duas trocadas, a fila mente sem errar nada visível: a segunda
     * página pula linhas ou repete, e só quem conferir uma por uma percebe.
     */
    const tk = await comTudo()
    for (let i = 0; i < 3; i++) await abrir(tk)

    const p1 = await chamar(api, 'GET', '/api/v1/ordens-servico?limit=2', { token: tk })
    assert.equal(p1.status, 200)
    assert.equal(p1.corpo.data.length, 2)
    assert.ok(p1.corpo.meta.next_cursor, 'faltou cursor com mais páginas disponíveis')

    const p2 = await chamar(
      api,
      'GET',
      `/api/v1/ordens-servico?limit=2&cursor=${encodeURIComponent(p1.corpo.meta.next_cursor)}`,
      { token: tk },
    )
    assert.equal(p2.status, 200)

    const ids1 = p1.corpo.data.map((o: { id: string }) => o.id)
    const ids2 = p2.corpo.data.map((o: { id: string }) => o.id)
    const repetidos = ids2.filter((id: string) => ids1.includes(id))
    assert.deepEqual(repetidos, [], 'a segunda página repetiu linhas da primeira')
  })
})

describe('permissões', () => {
  it('cada transição exige a sua, e ler não basta para agir', async () => {
    const soLer = await token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['os:ler'] })
    const os = await abrir(await comTudo())

    for (const acao of ['triar', 'agendar', 'iniciar', 'concluir', 'validar', 'cancelar', 'pausar']) {
      const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/${acao}`, {
        token: soLer,
        corpo: {},
      })
      assert.equal(r.status, 403, `${acao} passou com permissão apenas de leitura`)
    }
  })

  it('quem pode concluir não pode validar', async () => {
    /*
     * A separação que o `PATCH status` apagaria. Com uma única permissão de
     * mudar status, o executor levaria a OS de ponta a ponta sozinho.
     */
    const executor = await token({
      tenant: TENANT_A,
      usuario: USUARIO_A,
      permissoes: ['os:ler', 'os:concluir'],
    })
    const os = await abrir(await comTudo())
    const r = await chamar(api, 'POST', `/api/v1/ordens-servico/${os.id}/validar`, { token: executor })
    assert.equal(r.status, 403)
  })
})

describe('fila por risco de SLA', () => {
  it('lista o que vence dentro da janela, e não o que já encerrou', async () => {
    const tk = await comTudo()
    const os = await abrir(tk)
    await ate(tk, os.id, [
      'triar',
      {
        tipo: 'CORRETIVA',
        prioridade: 'CRITICA',
        prazo_solucao_em: new Date(Date.now() + 3600_000).toISOString(),
      },
    ])

    const r = await chamar(api, 'GET', '/api/v1/ordens-servico?sla_em_risco_horas=24', { token: tk })
    assert.equal(r.status, 200)
    assert.ok(
      r.corpo.data.some((o: { id: string }) => o.id === os.id),
      'OS com prazo dentro da janela não apareceu na fila',
    )
    assert.ok(
      r.corpo.data.every((o: { status: string }) => !['VALIDADA', 'CANCELADA'].includes(o.status)),
      'OS encerrada apareceu na fila de risco — SLA de OS validada não corre',
    )
  })
})
