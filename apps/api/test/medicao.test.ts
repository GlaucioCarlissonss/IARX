import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  chamar,
  consultarBanco,
  EQUIP_LIVRE_1,
  subirApi,
  token,
  TENANT_A,
  USUARIO_A,
  type Servidor,
} from './apoio.js'

/**
 * Medição — e sobretudo RN-020.
 *
 * O caso central é o da leitura que anda para trás. Ele parece acadêmico e não
 * é: contador menor que o anterior é digitação errada, medidor trocado ou
 * leitura de outra máquina, e qualquer um dos três vira fatura errada se
 * passar. A regra é gatilho no banco, e estes testes existem para provar que a
 * rota **não a contorna** — nem com a aplicação achando que validou.
 */

let api: Servidor

const ler = () => token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['medicao:ler'] })
const registrar = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['equipamento:leitura_registrar'] })
const estornar = () =>
  token({ tenant: TENANT_A, usuario: USUARIO_A, permissoes: ['equipamento:leitura_estornar'] })

/**
 * Um medidor novo por caso.
 *
 * A primeira versão compartilhava o medidor semeado e numerava as datas num
 * contador de módulo. Reprovou, e a mensagem foi útil: RN-020 recusou a
 * primeira leitura porque **outro caso já havia registrado uma maior**. Dois
 * defeitos de teste no mesmo lugar — dependência da ordem de execução, e
 * dependência de estado deixado pela execução anterior, já que a suíte da API
 * semeia sem recriar o banco.
 *
 * Medidor próprio resolve os dois: cada caso parte de um histórico vazio que
 * só ele enxerga, e a ordem deixa de significar qualquer coisa.
 */
/*
 * Equipamento próprio também, e não só medidor.
 *
 * A segunda versão criava vários medidores no mesmo equipamento e esbarrou em
 * `medidor_ativo_uk`: índice único parcial sobre (tenant, equipamento, tipo)
 * `where ativo`. O banco está certo — duas máquinas de contar páginas ativas no
 * mesmo equipamento é estado sem sentido, e a leitura não saberia a qual
 * pertence.
 *
 * Criar o medidor inativo contornaria o índice e mentiria sobre o cenário.
 * Equipamento novo por caso custa uma linha a mais e mantém o teste descrevendo
 * algo que pode existir.
 */
let n = 0

async function equipamentoComMedidor(valorInicial = '0.00'): Promise<{ equipamento: string; medidor: string }> {
  n += 1
  const sufixo = String(n).padStart(3, '0')
  const equipamento = `11111111-1111-4111-8111-11111111d${sufixo}`
  const medidor = `11111111-1111-4111-8111-11111111c${sufixo}`

  await consultarBanco(
    TENANT_A,
    `insert into public.equipamento (id, tenant_id, patrimonio, modelo_id, categoria_id, filial_id)
     select $1, $2, 'MED-' || $3, e.modelo_id, e.categoria_id, e.filial_id
       from public.equipamento e where e.id = $4
     on conflict (id) do nothing`,
    [equipamento, TENANT_A, sufixo, EQUIP_LIVRE_1],
  )
  await consultarBanco(
    TENANT_A,
    `insert into public.medidor (id, tenant_id, equipamento_id, tipo, unidade,
                                 valor_inicial, valor_atual, acumulado_total, ativo)
     values ($1, $2, $3, 'CONTADOR', 'paginas', $4::numeric, $4::numeric, $4::numeric, true)
     on conflict (id) do nothing`,
    [medidor, TENANT_A, equipamento, valorInicial],
  )
  return { equipamento, medidor }
}

/**
 * Datas dentro de uma partição existente.
 *
 * `leitura_medidor` é particionada por mês, e as partições semeadas vão de
 * 2026-09 a 2027-01. A primeira versão usava 2029 e reprovava com
 * "Restrição de integridade violada / regra não identificada" — que era o
 * PostgreSQL dizendo "no partition of relation found for row" com SQLSTATE de
 * check_violation.
 *
 * O teste estava errado; a tradução do erro também. Agora a API responde
 * "Período não aberto para registro", com o que fazer a seguir — ver o caso
 * próprio, mais abaixo.
 */
function leitura(medidorId: string, valor: string, dia = 1) {
  return {
    medidor_id: medidorId,
    valor,
    data_leitura: `2026-12-0${dia}T12:00:00-03:00`,
    origem: 'MANUAL' as const,
  }
}

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('medidores', () => {
  it('o equipamento lista seus medidores, com os valores como decimal', async () => {
    const r = await chamar(api, 'GET', `/api/v1/equipamentos/${EQUIP_LIVRE_1}/medidores`, {
      token: await ler(),
    })

    assert.equal(r.status, 200)
    assert.ok(r.corpo.data.length > 0)

    const m = r.corpo.data[0]
    assert.equal(m.tipo, 'CONTADOR')
    /*
     * String, e não número: a coluna é `numeric(14,2)` porque horímetro mede
     * fração de hora. `number` do JavaScript é ponto flutuante binário, e
     * 1247.50 somado mil vezes deixa de fechar.
     */
    assert.equal(typeof m.valor_atual, 'string')
    assert.match(m.valor_atual, /^\d+\.\d{2}$/)
  })
})

describe('registro de leitura', () => {
  it('registra uma leitura maior que a anterior', async () => {
    const { equipamento, medidor } = await equipamentoComMedidor()
    const r = await chamar(api, 'POST', `/api/v1/equipamentos/${equipamento}/leituras`, {
      token: await registrar(),
      corpo: leitura(medidor, '5000.00'),
    })

    assert.equal(r.status, 201, `recusou: ${JSON.stringify(r.corpo)}`)
    assert.equal(r.corpo.data.valor, '5000.00')
    assert.equal(r.corpo.data.status, 'VALIDA')
  })

  it('RN-020: leitura menor que a anterior é recusada pelo banco', async () => {
    const { equipamento, medidor } = await equipamentoComMedidor()
    await chamar(api, 'POST', `/api/v1/equipamentos/${equipamento}/leituras`, {
      token: await registrar(),
      corpo: leitura(medidor, '9000.00', 1),
    })

    const menor = await chamar(api, 'POST', `/api/v1/equipamentos/${equipamento}/leituras`, {
      token: await registrar(),
      corpo: leitura(medidor, '8000.00', 2),
    })

    /*
     * Recusa de regra de negócio, não erro interno. O gatilho levanta `23514`
     * e a tradução de SQLSTATE o transforma em algo que o operador entende —
     * se chegasse como 500, quem digitou errado veria "erro no servidor" e
     * abriria chamado em vez de conferir o número.
     */
    assert.equal(menor.status, 422)
    assert.ok(
      menor.corpo.code === 'REGRA_DE_NEGOCIO',
      `esperado REGRA_DE_NEGOCIO, veio ${menor.corpo.code}`,
    )
  })

  it('origem fora do catálogo é recusada na entrada', async () => {
    const r = await chamar(api, 'POST', `/api/v1/equipamentos/${EQUIP_LIVRE_1}/leituras`, {
      token: await registrar(),
      corpo: { ...leitura((await equipamentoComMedidor()).medidor, '9500.00'), origem: 'OS' },
    })
    // `OS` constava do esboço antigo e o `check` do banco nunca a aceitou.
    assert.equal(r.status, 400)
  })

  it('quem só lê não registra', async () => {
    const r = await chamar(api, 'POST', `/api/v1/equipamentos/${EQUIP_LIVRE_1}/leituras`, {
      token: await ler(),
      corpo: leitura((await equipamentoComMedidor()).medidor, '9600.00'),
    })
    assert.equal(r.status, 403)
  })
})

describe('período sem partição', () => {
  it('data fora dos períodos abertos explica o que houve, em vez de "regra não identificada"', async () => {
    /*
     * `leitura_medidor` é particionada por mês. Linha cujo período não tem
     * partição levanta check_violation sem nome de constraint, e o tratamento
     * genérico virava `A operação viola a regra "não identificada"`.
     *
     * Não é hipótese de laboratório: é o que o operador vê no dia em que a
     * criação de partições atrasa, ou quando alguém digita o ano errado.
     * "Regra não identificada" manda procurar defeito no dado — que está
     * certo — e esconde a única informação acionável.
     */
    const { equipamento, medidor } = await equipamentoComMedidor()
    const r = await chamar(api, 'POST', `/api/v1/equipamentos/${equipamento}/leituras`, {
      token: await registrar(),
      corpo: {
        medidor_id: medidor,
        valor: '100.00',
        data_leitura: '2031-07-15T12:00:00-03:00',
        origem: 'MANUAL' as const,
      },
    })

    assert.equal(r.status, 422)
    assert.match(r.corpo.title, /período não aberto/i)
    assert.doesNotMatch(JSON.stringify(r.corpo), /não identificada/)
    assert.ok(
      (r.corpo.acoes_sugeridas ?? []).length > 0,
      'recusa sem saída obriga o operador a abrir chamado',
    )
  })
})

describe('estorno', () => {
  it('estorna com motivo, e a leitura continua existindo', async () => {
    const { equipamento, medidor } = await equipamentoComMedidor()
    const criada = await chamar(api, 'POST', `/api/v1/equipamentos/${equipamento}/leituras`, {
      token: await registrar(),
      corpo: leitura(medidor, '12000.00'),
    })
    const id = criada.corpo.data.id

    const r = await chamar(api, 'POST', `/api/v1/leituras/${id}/estornar`, {
      token: await estornar(),
      corpo: { motivo: 'contador lido na máquina errada pelo técnico' },
    })

    assert.equal(r.status, 200)
    assert.equal(r.corpo.data.status, 'ESTORNADA')
    assert.match(r.corpo.data.motivo_estorno, /máquina errada/)

    /*
     * Continua existindo, e é o ponto: a fatura do mês passado saiu com este
     * número. Apagar removeria a única evidência de por que o valor mudou —
     * exatamente a pergunta de quando o cliente contesta.
     */
    const historico = await chamar(
      api,
      'GET',
      `/api/v1/equipamentos/${equipamento}/leituras?incluir_invalidas=true`,
      { token: await ler() },
    )
    assert.ok(historico.corpo.data.some((l: { id: string }) => l.id === id))
  })

  it('estorno sem motivo legível é recusado', async () => {
    const { equipamento, medidor } = await equipamentoComMedidor()
    const criada = await chamar(api, 'POST', `/api/v1/equipamentos/${equipamento}/leituras`, {
      token: await registrar(),
      corpo: leitura(medidor, '13000.00'),
    })

    const r = await chamar(api, 'POST', `/api/v1/leituras/${criada.corpo.data.id}/estornar`, {
      token: await estornar(),
      corpo: { motivo: 'errado' },
    })
    assert.equal(r.status, 400)
  })

  it('estornar duas vezes não encontra o que estornar', async () => {
    const { equipamento, medidor } = await equipamentoComMedidor()
    const criada = await chamar(api, 'POST', `/api/v1/equipamentos/${equipamento}/leituras`, {
      token: await registrar(),
      corpo: leitura(medidor, '14000.00'),
    })
    const id = criada.corpo.data.id
    const corpo = { motivo: 'leitura duplicada na importação da manhã' }

    const primeiro = await chamar(api, 'POST', `/api/v1/leituras/${id}/estornar`, {
      token: await estornar(),
      corpo,
    })
    const segundo = await chamar(api, 'POST', `/api/v1/leituras/${id}/estornar`, {
      token: await estornar(),
      corpo,
    })

    assert.equal(primeiro.status, 200)
    assert.equal(segundo.status, 404)
  })

  it('a leitura estornada sai do histórico padrão e aparece quando se pede', async () => {
    const { equipamento, medidor } = await equipamentoComMedidor()
    const criada = await chamar(api, 'POST', `/api/v1/equipamentos/${equipamento}/leituras`, {
      token: await registrar(),
      corpo: leitura(medidor, '15000.00'),
    })
    const id = criada.corpo.data.id
    await chamar(api, 'POST', `/api/v1/leituras/${id}/estornar`, {
      token: await estornar(),
      corpo: { motivo: 'equipamento trocado sem registro de substituição' },
    })

    const padrao = await chamar(
      api,
      'GET',
      `/api/v1/equipamentos/${equipamento}/leituras?medidor_id=${medidor}`,
      { token: await ler() },
    )
    assert.ok(
      !padrao.corpo.data.some((l: { id: string }) => l.id === id),
      'estornada apareceu no histórico padrão',
    )

    const completo = await chamar(
      api,
      'GET',
      `/api/v1/equipamentos/${equipamento}/leituras?medidor_id=${medidor}&incluir_invalidas=true`,
      { token: await ler() },
    )
    assert.ok(completo.corpo.data.some((l: { id: string }) => l.id === id))
  })
})
