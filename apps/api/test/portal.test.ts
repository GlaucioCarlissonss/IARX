import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLIENTE_ALFA,
  CLIENTE_GAMA,
  CONTRATO_ALFA,
  CONTRATO_GAMA,
  LOCAL_MATRIZ_ALFA,
  LOCAL_NORTE_ALFA,
  USUARIO_CLIENTE_ADMIN,
  USUARIO_CLIENTE_GAMA,
  USUARIO_CLIENTE_UNIDADE,
  TENANT_A,
  chamar,
  consultarBanco,
  subirApi,
  token,
  type Servidor,
} from './apoio.js'

/**
 * Portal do cliente, contra PostgreSQL real.
 *
 * Três garantias, e todas falham em silêncio quando falham.
 *
 * **Nenhum cliente alcança dado de outro**, e a recusa é **404, não 403**:
 * distinguir "não é seu" de "não existe" confirma a existência de um registro
 * alheio, e é oráculo suficiente para enumerar a base de outro cliente um id por
 * vez.
 *
 * **O gestor de unidade não alcança o consolidado do grupo** (RN-L26/RN-L34).
 * Era o defeito que a 0024 corrigiu; aqui se prova que ele não volta pelo
 * caminho HTTP, inclusive com id montado à mão na URL.
 *
 * **Nenhuma resposta carrega margem, custo de manutenção ou valor de
 * aquisição.** A asserção é sobre o corpo serializado e não sobre o esquema: é
 * assim que se pega o campo que entrou por um `select *` esquecido.
 */

let api: Servidor

/** As permissões da lista branca da 0011 — as que um perfil de cliente pode ter. */
const CLIENTE = ['contrato:ler', 'equipamento:ler', 'medicao:ler', 'fatura:ler'] as const

const comoCliente = (usuario: string, clienteId: string) =>
  token({ usuario, permissoes: [...CLIENTE], extras: { cliente_id: clienteId } })

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('portal — isolamento entre clientes', () => {
  it('o resumo responde o escopo do usuário, e o do outro cliente é outro', async () => {
    const alfa = await chamar(api, 'GET', '/api/v1/portal/resumo', {
      token: await comoCliente(USUARIO_CLIENTE_ADMIN, CLIENTE_ALFA),
    })
    assert.equal(alfa.status, 200, JSON.stringify(alfa.corpo))
    assert.equal(alfa.corpo.data.cliente.id, CLIENTE_ALFA)
    assert.ok(alfa.corpo.data.contratos.ativos >= 2)

    const gama = await chamar(api, 'GET', '/api/v1/portal/resumo', {
      token: await comoCliente(USUARIO_CLIENTE_GAMA, CLIENTE_GAMA),
    })
    assert.equal(gama.status, 200)
    assert.equal(gama.corpo.data.cliente.id, CLIENTE_GAMA)
    assert.notEqual(gama.corpo.data.parque.total, alfa.corpo.data.parque.total)
  })

  it('contrato de outro cliente é 404, nunca 403', async () => {
    const r = await chamar(api, 'GET', `/api/v1/portal/contratos/${CONTRATO_ALFA}`, {
      token: await comoCliente(USUARIO_CLIENTE_GAMA, CLIENTE_GAMA),
    })
    // 403 diria "existe e não é seu". 404 não diz nada.
    assert.equal(r.status, 404, JSON.stringify(r.corpo))
    assert.equal(r.corpo.code, 'NAO_ENCONTRADO')
  })

  it('a listagem de contratos não vaza o do outro cliente', async () => {
    const r = await chamar(api, 'GET', '/api/v1/portal/contratos?limit=100', {
      token: await comoCliente(USUARIO_CLIENTE_ADMIN, CLIENTE_ALFA),
    })
    assert.equal(r.status, 200)
    const ids = r.corpo.data.map((c: { id: string }) => c.id)
    assert.ok(ids.includes(CONTRATO_ALFA))
    assert.ok(!ids.includes(CONTRATO_GAMA), 'o contrato do outro cliente apareceu na lista')
  })

  it('token sem cliente é recusado: o portal não é a visão do locador', async () => {
    /*
     * Sem `cliente_id`, `app.cliente_atual()` devolve nulo e as políticas de
     * cliente deixam de recortar — o portal responderia com a base inteira do
     * locatário. A recusa é explícita porque o silêncio aqui seria o oposto do
     * que o prefixo `/portal` promete.
     */
    const r = await chamar(api, 'GET', '/api/v1/portal/resumo', {
      token: await token({ permissoes: [...CLIENTE] }),
    })
    assert.equal(r.status, 403)
    assert.equal(r.corpo.code, 'FORA_DE_ESCOPO')
  })
})

describe('portal — recorte por unidade (RN-L26, RN-L34)', () => {
  it('o gestor de unidade vê menos unidades que o administrador do cliente', async () => {
    const admin = await chamar(api, 'GET', '/api/v1/portal/resumo', {
      token: await comoCliente(USUARIO_CLIENTE_ADMIN, CLIENTE_ALFA),
    })
    const gestor = await chamar(api, 'GET', '/api/v1/portal/resumo', {
      token: await comoCliente(USUARIO_CLIENTE_UNIDADE, CLIENTE_ALFA),
    })
    assert.equal(gestor.status, 200, JSON.stringify(gestor.corpo))

    assert.ok(admin.corpo.data.unidades_no_escopo >= 2, 'o cliente precisa de duas unidades')
    assert.equal(gestor.corpo.data.unidades_no_escopo, 1)
    /*
     * O campo existe para o recorte ser **visível** a quem usa o portal. Um
     * gestor que vê uma unidade precisa saber que vê uma — senão ele lê o número
     * como se fosse o do grupo.
     */
    assert.ok(gestor.corpo.data.parque.total < admin.corpo.data.parque.total)
  })

  it('a unidade irmã não chega por id montado à mão', async () => {
    const t = await comoCliente(USUARIO_CLIENTE_UNIDADE, CLIENTE_ALFA)

    const daMatriz = await chamar(api, 'GET', `/api/v1/portal/equipamentos?local_id=${LOCAL_MATRIZ_ALFA}`, {
      token: t,
    })
    assert.equal(daMatriz.status, 200)
    assert.ok(daMatriz.corpo.data.length >= 1, 'o gestor não vê o parque da própria unidade')

    // RN-L34: o filtro por conveniência aponta para a unidade irmã, e a RLS
    // responde vazio. O recorte não é o filtro — é a política.
    const daIrma = await chamar(api, 'GET', `/api/v1/portal/equipamentos?local_id=${LOCAL_NORTE_ALFA}`, {
      token: t,
    })
    assert.equal(daIrma.status, 200)
    assert.equal(daIrma.corpo.data.length, 0, 'o parque da unidade irmã vazou por URL montada à mão')
  })

  it('o consumo também respeita a unidade', async () => {
    const admin = await chamar(api, 'GET', '/api/v1/portal/consumo?limit=100', {
      token: await comoCliente(USUARIO_CLIENTE_ADMIN, CLIENTE_ALFA),
    })
    const gestor = await chamar(api, 'GET', '/api/v1/portal/consumo?limit=100', {
      token: await comoCliente(USUARIO_CLIENTE_UNIDADE, CLIENTE_ALFA),
    })
    assert.equal(admin.status, 200)
    assert.equal(gestor.status, 200)
    assert.ok(
      gestor.corpo.data.length < admin.corpo.data.length,
      'o gestor de unidade viu o consumo do grupo inteiro',
    )
    assert.ok(
      gestor.corpo.data.every(
        (c: { local_operacao_id: string }) => c.local_operacao_id === LOCAL_MATRIZ_ALFA,
      ),
    )
  })
})

describe('portal — o que não devolve, e o que declara', () => {
  it('nenhuma rota carrega margem, custo de manutenção ou valor de aquisição', async () => {
    const t = await comoCliente(USUARIO_CLIENTE_ADMIN, CLIENTE_ALFA)
    const rotas = [
      '/api/v1/portal/resumo',
      '/api/v1/portal/contratos?limit=100',
      `/api/v1/portal/contratos/${CONTRATO_ALFA}`,
      '/api/v1/portal/equipamentos?limit=100',
      '/api/v1/portal/consumo?limit=100',
      '/api/v1/portal/custos',
    ]
    /*
     * Asserção sobre o **corpo serializado**, e não sobre o esquema: é assim que
     * se pega o campo que entrou por um `select *` esquecido, ou por um `...l`
     * numa função de mapeamento.
     */
    const proibidos = [
      'valor_aquisicao',
      'custo_manutencao',
      'margem',
      'depreciacao',
      'valor_residual',
      'custo_medio',
    ]
    for (const rota of rotas) {
      const r = await chamar(api, 'GET', rota, { token: t })
      assert.equal(r.status, 200, `${rota}: ${JSON.stringify(r.corpo)}`)
      const corpo = JSON.stringify(r.corpo)
      for (const campo of proibidos) {
        assert.ok(!corpo.includes(campo), `${rota} devolveu ${campo}`)
      }
    }
  })

  it('RN-L33: a competência aberta vem marcada como parcial, com a última leitura', async () => {
    const t = await comoCliente(USUARIO_CLIENTE_ADMIN, CLIENTE_ALFA)

    /*
     * A competência aberta é **construída aqui**, numa competência que nenhum
     * outro arquivo alcança.
     *
     * A primeira versão contava com a que a massa semeia, e a suíte compartilha
     * um banco: `contas-receber.test.ts` roda antes e fecha aquela competência.
     * O teste falhava dizendo "não há competência aberta" quando o que houve foi
     * "outro arquivo a fechou" — são defeitos diferentes, e o teste que os
     * confunde acusa o código errado.
     *
     * A leitura inicial **é derivada** da final da competência anterior do
     * próprio equipamento. Uma constante ali quebra RN-L29 (`cc_serie_continua`),
     * e a exceção não é engolida pelo `on conflict`: o teste morreria antes da
     * primeira asserção, acusando o portal por uma série que ele mesmo fabricou
     * descontínua.
     */
    await consultarBanco(
      TENANT_A,
      `insert into public.consumo_competencia
         (tenant_id, competencia, equipamento_id, contrato_item_id, cliente_id,
          local_operacao_id, leitura_inicial_mono, leitura_final_mono, franquia_mono)
       select $1, '2029-03', ci.equipamento_id, ci.id, $2, ci.local_operacao_id,
              coalesce(ultima.leitura_final_mono, 0),
              coalesce(ultima.leitura_final_mono, 0) + 1500, 1000
         from public.contrato_item ci
         left join lateral (
           select cc.leitura_final_mono
             from public.consumo_competencia cc
            where cc.equipamento_id = ci.equipamento_id and cc.competencia < '2029-03'
            order by cc.competencia desc limit 1
         ) ultima on true
        where ci.local_operacao_id = $3 and ci.equipamento_id is not null
        limit 1
       on conflict do nothing`,
      [TENANT_A, CLIENTE_ALFA, LOCAL_MATRIZ_ALFA],
    )

    const consumo = await chamar(api, 'GET', '/api/v1/portal/consumo?competencia=2029-03', { token: t })
    const abertos = consumo.corpo.data.filter((c: { parcial: boolean }) => c.parcial)
    assert.ok(abertos.length > 0, 'a competência recém-criada não veio marcada como parcial')
    /*
     * `parcial` é derivado de `fechado_em`, nunca uma coluna própria. O número
     * parcial não é errado; o que seria errado é apresentá-lo como fechado, e o
     * cliente planejar caixa sobre uma medição que ainda vai crescer.
     */
    assert.ok(abertos.every((c: { ultima_leitura_em: string | null }) => c.ultima_leitura_em))

    const resumo = await chamar(api, 'GET', '/api/v1/portal/resumo', { token: t })
    assert.equal(resumo.corpo.data.consumo_em_aberto.parcial, true)
    assert.ok(resumo.corpo.data.consumo_em_aberto.competencia)
    assert.ok(
      resumo.corpo.data.consumo_em_aberto.ultima_leitura_em,
      'o resumo diz que é parcial e não diz de quando é a última leitura',
    )
  })

  it('a memória de cálculo explica o total, e é endereçada pela competência', async () => {
    const t = await comoCliente(USUARIO_CLIENTE_ADMIN, CLIENTE_ALFA)

    const consumo = await chamar(api, 'GET', '/api/v1/portal/consumo?limit=1', { token: t })
    const competencia = consumo.corpo.data[0].competencia

    const r = await chamar(api, 'GET', `/api/v1/portal/custos/${competencia}/memoria`, { token: t })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.competencia, competencia)
    assert.ok(r.corpo.data.itens.length > 0)

    // Locação mais excedente é o total: a decomposição fecha, porque as duas
    // partes saem do mesmo número que a cobrança fixou.
    const { locacao, excedente, total } = r.corpo.data
    assert.equal(
      (Number(locacao) + Number(excedente)).toFixed(4),
      Number(total).toFixed(4),
      'a memória não fecha: locação mais excedente teria de dar o total',
    )

    // Competência inexistente é 404, e não uma memória vazia que parece válida.
    const vazia = await chamar(api, 'GET', '/api/v1/portal/custos/1999-01/memoria', { token: t })
    assert.equal(vazia.status, 404)
  })

  it('o detalhe do contrato traz os itens com a unidade de cada um', async () => {
    const r = await chamar(api, 'GET', `/api/v1/portal/contratos/${CONTRATO_ALFA}`, {
      token: await comoCliente(USUARIO_CLIENTE_ADMIN, CLIENTE_ALFA),
    })
    assert.equal(r.status, 200)
    assert.ok(r.corpo.data.itens_detalhados.length > 0)
    const item = r.corpo.data.itens_detalhados[0]
    assert.ok(item.patrimonio, 'o item não diz qual máquina é')
    assert.ok(item.local_nome, 'o item não diz onde a máquina está')
  })
})
