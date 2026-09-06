import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CENTRO_ADM,
  CENTRO_OPER,
  EMPRESA_A,
  FILIAL_A,
  FORNECEDOR_A,
  TENANT_A,
  chamar,
  chaveIdempotencia,
  consultarBanco,
  subirApi,
  token,
  type Servidor,
} from './apoio.js'

/**
 * Integração do controle de despesas, contra PostgreSQL real.
 *
 * O que estes testes existem para provar, em uma frase: **o painel fecha com
 * contas a pagar**. É a consequência da decisão de mandar todo título sem
 * categoria para "Não categorizado", e o motivo de ela ter sido tomada — um
 * painel que não fecha não dá erro, dá um percentual ligeiramente errado que
 * ninguém confere.
 *
 * O segundo tema é o que **não** está aqui: nenhuma rota grava execução, e
 * nenhuma aprova replanejamento. A primeira ausência é a regra do bloco
 * financeiro inteiro (se não há caminho de escrita, não há divergência); a
 * segunda é uma lacuna registrada — não existe alçada de orçamento definida.
 */

let api: Servidor

const LER = ['despesa:ler'] as const
const GERIR = ['despesa:ler', 'despesa:orcamento_gerenciar'] as const

/** Ano fora da massa semeada: os outros arquivos da suíte não o alcançam. */
const ANO = 2029

const nome = (rotulo: string) => `${rotulo} ${Date.now()}${Math.floor(Math.random() * 1000)}`

before(async () => {
  api = await subirApi()
})

after(async () => {
  await api.fechar()
})

describe('categorias de despesa', () => {
  it('a residual existe, é única e vem marcada', async () => {
    const r = await chamar(api, 'GET', '/api/v1/categorias-despesa?limit=200', {
      token: await token({ permissoes: [...LER] }),
    })
    assert.equal(r.status, 200)

    const residuais = r.corpo.data.filter((c: { residual: boolean }) => c.residual)
    assert.equal(residuais.length, 1, 'a residual precisa ser única: é o destino do gatilho')
    assert.equal(residuais[0].nome, 'Não categorizado')
  })

  it('ler e gerenciar são permissões distintas', async () => {
    // Quem lança um título precisa ler as categorias para escolher uma, e não
    // precisa poder criar categoria nenhuma.
    const r = await chamar(api, 'POST', '/api/v1/categorias-despesa', {
      token: await token({ permissoes: [...LER] }),
      corpo: { nome: nome('Tentativa') },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('cat') },
    })
    assert.equal(r.status, 403)
  })

  it('cria em dois níveis, e recusa o terceiro dizendo por quê', async () => {
    const t = await token({ permissoes: [...GERIR] })

    const pai = await chamar(api, 'POST', '/api/v1/categorias-despesa', {
      token: t,
      corpo: { nome: nome('Software'), classificacao_sugerida: 'DESPESA_FIXA' },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('cat') },
    })
    assert.equal(pai.status, 201, JSON.stringify(pai.corpo))
    assert.equal(pai.corpo.data.nivel, 1)
    assert.equal(pai.corpo.data.residual, false)

    const filho = await chamar(api, 'POST', '/api/v1/categorias-despesa', {
      token: t,
      corpo: { nome: nome('Licenças'), categoria_pai_id: pai.corpo.data.id },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('cat') },
    })
    assert.equal(filho.status, 201)
    assert.equal(filho.corpo.data.nivel, 2)

    const neto = await chamar(api, 'POST', '/api/v1/categorias-despesa', {
      token: t,
      corpo: { nome: nome('Anuais'), categoria_pai_id: filho.corpo.data.id },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('cat') },
    })
    assert.equal(neto.status, 422)
    assert.equal(neto.corpo.errors[0].field, 'categoria_pai_id')
    // A mensagem crua do gatilho diz o nome da restrição; quem cadastra precisa
    // saber o que fazer.
    assert.match(neto.corpo.detail, /catálogo de fornecedor/)
  })

  it('a residual não pode ser inativada', async () => {
    const t = await token({ permissoes: [...GERIR] })
    const lista = await chamar(api, 'GET', '/api/v1/categorias-despesa?limit=200', { token: t })
    const residual = lista.corpo.data.find((c: { residual: boolean }) => c.residual)

    const r = await chamar(api, 'PATCH', `/api/v1/categorias-despesa/${residual.id}`, {
      token: t,
      corpo: { ativo: false },
      cabecalhos: { 'if-match': String(residual.version) },
    })
    assert.equal(r.status, 422)
    // Inativada, ela sumiria da tela e continuaria recebendo lançamentos: o
    // operador veria títulos caindo numa categoria que acredita ter desligado.
    assert.match(r.corpo.detail, /continuaria recebendo/)
  })
})

describe('orçamento', () => {
  it('duas linhas gerais na mesma dimensão colidem, e o erro explica o vazio', async () => {
    const t = await token({ permissoes: [...GERIR] })
    const corpo = { ano: ANO, mes: 3, centro_custo_id: CENTRO_ADM, valor_orcado: '50000.0000' }

    const primeiro = await chamar(api, 'POST', '/api/v1/orcamentos', {
      token: t,
      corpo,
      cabecalhos: { 'idempotency-key': chaveIdempotencia('orc') },
    })
    assert.equal(primeiro.status, 201, JSON.stringify(primeiro.corpo))

    /*
     * As duas têm `categoria_id` vazio, e no padrão do Postgres nulos são
     * distintos: sem `NULLS NOT DISTINCT` esta segunda linha entraria e a
     * execução passaria a contar o mesmo orçamento duas vezes.
     */
    const segundo = await chamar(api, 'POST', '/api/v1/orcamentos', {
      token: t,
      corpo: { ...corpo, valor_orcado: '30000.0000' },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('orc') },
    })
    assert.equal(segundo.status, 409)
    assert.match(segundo.corpo.detail, /"geral" é um recorte/)
    assert.equal(segundo.corpo.acoes_sugeridas[0].code, 'EDITAR_EXISTENTE')
  })

  it('copiar do ano anterior é ação explícita, e não sobrescreve quem já orçou', async () => {
    const t = await token({ permissoes: [...GERIR] })
    const origem = ANO + 10
    const destino = ANO + 11

    await chamar(api, 'POST', '/api/v1/orcamentos', {
      token: t,
      corpo: { ano: origem, mes: 1, centro_custo_id: CENTRO_ADM, valor_orcado: '10000.0000' },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('orc') },
    })
    await chamar(api, 'POST', '/api/v1/orcamentos', {
      token: t,
      corpo: { ano: origem, mes: 2, centro_custo_id: CENTRO_ADM, valor_orcado: '20000.0000' },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('orc') },
    })
    // Uma linha do destino já decidida: a cópia tem de preservá-la.
    await chamar(api, 'POST', '/api/v1/orcamentos', {
      token: t,
      corpo: { ano: destino, mes: 1, centro_custo_id: CENTRO_ADM, valor_orcado: '99000.0000' },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('orc') },
    })

    const r = await chamar(api, 'POST', '/api/v1/orcamentos/copiar-de', {
      token: t,
      corpo: { de_ano: origem, para_ano: destino, fator: 1.1 },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('cop') },
    })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    assert.equal(r.corpo.data.criados, 1)
    assert.equal(r.corpo.data.ignorados, 1, 'a linha já orçada foi preservada')

    const lista = await chamar(api, 'GET', `/api/v1/orcamentos?ano=${destino}&limit=100`, { token: t })
    const jan = lista.corpo.data.find((o: { mes: number }) => o.mes === 1)
    const fev = lista.corpo.data.find((o: { mes: number }) => o.mes === 2)
    assert.equal(jan.valor_orcado, '99000.0000', 'copiar sobrescreveu uma decisão')
    assert.equal(fev.valor_orcado, '22000.0000', 'o fator não foi aplicado')
  })

  it('copiar de um ano sem orçamento é recusado em vez de silencioso', async () => {
    const r = await chamar(api, 'POST', '/api/v1/orcamentos/copiar-de', {
      token: await token({ permissoes: [...GERIR] }),
      corpo: { de_ano: 2001, para_ano: 2002 },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('cop') },
    })
    assert.equal(r.status, 422)
  })
})

describe('execução e replanejamento', () => {
  it('o realizado segue o título, e cancelar muda o percentual na consulta seguinte', async () => {
    const t = await token({ permissoes: [...GERIR] })
    const cat = await chamar(api, 'POST', '/api/v1/categorias-despesa', {
      token: t,
      corpo: { nome: nome('Telefonia') },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('cat') },
    })
    const categoriaId = cat.corpo.data.id

    await chamar(api, 'POST', '/api/v1/orcamentos', {
      token: t,
      corpo: {
        ano: ANO,
        mes: 6,
        categoria_id: categoriaId,
        centro_custo_id: CENTRO_OPER,
        valor_orcado: '10000.0000',
      },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('orc') },
    })

    const titulo = await chamar(api, 'POST', '/api/v1/contas-pagar', {
      token: await token({ permissoes: ['pagar:criar', 'pagar:ler'] }),
      cabecalhos: { 'idempotency-key': chaveIdempotencia('tp') },
      corpo: {
        empresa_id: EMPRESA_A,
        fornecedor_id: FORNECEDOR_A,
        filial_id: FILIAL_A,
        descricao: 'Telefonia do período',
        classificacao: 'DESPESA_VARIAVEL',
        categoria_id: categoriaId,
        valor_original: '9500.0000',
        data_emissao: `${ANO}-06-10`,
        data_vencimento: `${ANO}-07-10`,
        rateio: [{ centro_custo_id: CENTRO_OPER, percentual: 100 }],
      },
    })
    assert.equal(titulo.status, 201, JSON.stringify(titulo.corpo))

    const antes = await chamar(api, 'GET', `/api/v1/despesas/indicadores?ano=${ANO}&mes=6`, { token: t })
    assert.equal(antes.status, 200, JSON.stringify(antes.corpo))
    const linha = antes.corpo.data.execucao.find(
      (l: { categoria_id: string }) => l.categoria_id === categoriaId,
    )
    assert.ok(linha, 'a linha orçada não apareceu na execução')
    assert.equal(linha.realizado, '9500.0000')
    assert.equal(linha.limiar, 'CRITICO', '95% do orçado é o degrau de 90%')

    // Cancelar precisa fazer o alerta desaparecer, não persistir um estado que o
    // dado atual já não sustenta.
    const cancelado = await chamar(api, 'POST', `/api/v1/contas-pagar/${titulo.corpo.data.id}/cancelar`, {
      token: await token({ permissoes: ['pagar:ler', 'pagar:cancelar'] }),
      corpo: { motivo: 'contrato de telefonia renegociado' },
    })
    assert.equal(cancelado.status, 200, JSON.stringify(cancelado.corpo))

    const depois = await chamar(api, 'GET', `/api/v1/despesas/indicadores?ano=${ANO}&mes=6`, { token: t })
    const agora = depois.corpo.data.execucao.find(
      (l: { categoria_id: string }) => l.categoria_id === categoriaId,
    )
    assert.equal(agora.realizado, '0.0000', 'o cancelado continuou contando: há acumulado guardado')
    assert.equal(agora.limiar, 'NORMAL')
  })

  it('replanejar não passa do saldo não comprometido, e o comprometido inclui o aprovado', async () => {
    const t = await token({ permissoes: [...GERIR] })

    const origem = await chamar(api, 'POST', '/api/v1/orcamentos', {
      token: t,
      corpo: { ano: ANO, mes: 9, centro_custo_id: CENTRO_OPER, valor_orcado: '20000.0000' },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('orc') },
    })
    const destino = await chamar(api, 'POST', '/api/v1/orcamentos', {
      token: t,
      corpo: { ano: ANO, mes: 9, centro_custo_id: CENTRO_ADM, valor_orcado: '5000.0000' },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('orc') },
    })

    // Aprovado e ainda não pago: D-25 diz que já está comprometido.
    const titulo = await chamar(api, 'POST', '/api/v1/contas-pagar', {
      token: await token({ permissoes: ['pagar:criar', 'pagar:ler'] }),
      cabecalhos: { 'idempotency-key': chaveIdempotencia('tp') },
      corpo: {
        empresa_id: EMPRESA_A,
        fornecedor_id: FORNECEDOR_A,
        filial_id: FILIAL_A,
        descricao: 'Compromisso aprovado do período',
        classificacao: 'DESPESA_FIXA',
        valor_original: '18000.0000',
        data_emissao: `${ANO}-09-05`,
        data_vencimento: `${ANO}-10-05`,
        rateio: [{ centro_custo_id: CENTRO_OPER, percentual: 100 }],
      },
    })
    assert.equal(titulo.status, 201)

    const excessivo = await chamar(api, 'POST', '/api/v1/orcamentos/replanejamentos', {
      token: t,
      corpo: {
        orcamento_origem_id: origem.corpo.data.id,
        orcamento_destino_id: destino.corpo.data.id,
        valor_transferido: '5000.0000',
        motivo: 'sobra aparente',
      },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('rep') },
    })

    /*
     * O título nasce em aprovação quando o valor exige — e nesse estado ainda
     * **não** compromete, porque pode ser rejeitado. A asserção acompanha o
     * estado real do título em vez de presumir um: o que se prova é a regra,
     * não a alçada semeada.
     */
    const estado = titulo.corpo.data.status
    if (estado === 'APROVADO' || estado === 'AGENDADO') {
      assert.equal(excessivo.status, 422, JSON.stringify(excessivo.corpo))
      assert.match(excessivo.corpo.detail, /já tem destino/)
    } else {
      assert.equal(excessivo.status, 201, JSON.stringify(excessivo.corpo))
    }
  })

  it('replanejar move dos dois lados, e o motivo chega ao audit_log', async () => {
    const t = await token({ permissoes: [...GERIR] })
    const origem = await chamar(api, 'POST', '/api/v1/orcamentos', {
      token: t,
      corpo: { ano: ANO + 1, mes: 4, centro_custo_id: CENTRO_OPER, valor_orcado: '30000.0000' },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('orc') },
    })
    const destino = await chamar(api, 'POST', '/api/v1/orcamentos', {
      token: t,
      corpo: { ano: ANO + 1, mes: 4, centro_custo_id: CENTRO_ADM, valor_orcado: '1000.0000' },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('orc') },
    })

    const r = await chamar(api, 'POST', '/api/v1/orcamentos/replanejamentos', {
      token: t,
      corpo: {
        orcamento_origem_id: origem.corpo.data.id,
        orcamento_destino_id: destino.corpo.data.id,
        valor_transferido: '4000.0000',
        motivo: 'reforço do administrativo no trimestre',
      },
      cabecalhos: { 'idempotency-key': chaveIdempotencia('rep') },
    })
    assert.equal(r.status, 201, JSON.stringify(r.corpo))

    const lista = await chamar(api, 'GET', `/api/v1/orcamentos?ano=${ANO + 1}&mes=4&limit=100`, { token: t })
    const dep = lista.corpo.data.find((o: { id: string }) => o.id === origem.corpo.data.id)
    const par = lista.corpo.data.find((o: { id: string }) => o.id === destino.corpo.data.id)
    assert.equal(dep.valor_orcado, '26000.0000')
    assert.equal(par.valor_orcado, '5000.0000', 'replanejamento criou ou destruiu valor')

    /*
     * `aprovado_por` continua nulo, e o nulo é a informação: não existe
     * `alcada.tipo` de orçamento definido, então nenhum replanejamento passou
     * por aprovação. Está registrado no Anexo V.
     */
    const linhas = await consultarBanco<{ aprovado_por: string | null; criado_por: string | null }>(
      TENANT_A,
      `select aprovado_por, criado_por from public.replanejamento_orcamento where id = $1`,
      [r.corpo.data.id],
    )
    assert.equal(linhas.length, 1)
    assert.equal(linhas[0]!.aprovado_por, null)
    assert.ok(linhas[0]!.criado_por, 'quem replanejou não ficou registrado')
  })

  it('o painel fecha com contas a pagar no mesmo período', async () => {
    /*
     * É a consequência direta da decisão de mandar todo título sem categoria
     * para "Não categorizado", e o motivo de ela ter sido tomada. Se não fechar,
     * o backfill da 0023 ou o gatilho de preenchimento falhou — e a diferença
     * apareceria como um percentual ligeiramente errado, não como um erro.
     */
    const t = await token({ permissoes: [...LER] })
    const r = await chamar(api, 'GET', `/api/v1/despesas/indicadores?ano=${ANO}&mes=6`, { token: t })
    assert.equal(r.status, 200)

    const daApi = Number(r.corpo.data.despesa_total)
    const [doBanco] = await consultarBanco<{ total: string }>(
      TENANT_A,
      `select coalesce(sum(valor_devido), 0)::text as total
         from public.titulo_pagar
        where deleted_at is null
          and data_emissao between $1::date and $2::date
          and status not in ('CANCELADO', 'REJEITADO')`,
      [`${ANO}-06-01`, `${ANO}-06-30`],
    )
    assert.equal(daApi.toFixed(4), Number(doBanco!.total).toFixed(4))
  })

  it('D-26 vem com os dois denominadores, e nulo quando não há denominador', async () => {
    const r = await chamar(api, 'GET', `/api/v1/despesas/indicadores?ano=${ANO}&mes=6`, {
      token: await token({ permissoes: [...LER] }),
    })
    const d = r.corpo.data

    // Os dois lado a lado: escolher um obrigaria a decidir sem base, e a única
    // diferença entre eles é o denominador.
    assert.ok('custo_por_cliente_ativo' in d)
    assert.ok('custo_por_equipamento_locado' in d)

    const conferir = (valor: string | null, denominador: number) => {
      if (denominador === 0) {
        assert.equal(valor, null, 'sem denominador o custo é indefinido, não zero')
      } else {
        assert.equal(valor, (Number(d.despesa_total) / denominador).toFixed(4))
      }
    }
    conferir(d.custo_por_cliente_ativo, d.clientes_ativos)
    conferir(d.custo_por_equipamento_locado, d.equipamentos_locados)
  })
})
