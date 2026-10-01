/**
 * O portal do cliente, do lado do front.
 *
 * Três garantias, e as três falham em silêncio quando falham.
 *
 * **O gestor de unidade não alcança o grupo.** É a decisão D-27 aplicada aqui:
 * o escopo do perfil decide se o recorte vale, e o vínculo diz quais unidades.
 * A mesma regra existe como política de RLS na migração 0024 e tem teste de
 * invariante próprio; a duplicação é assumida e tem contrapartida — as duas
 * suítes falham juntas se a regra mudar num lado só.
 *
 * **Nenhuma consulta do portal devolve margem, custo ou valor de aquisição.** A
 * asserção é sobre o objeto serializado, e não sobre o tipo: é assim que se pega
 * o campo que entrou por um espalhamento esquecido numa função de mapeamento,
 * que é como esse defeito nasce na prática.
 *
 * **A competência aberta vem marcada como parcial** (RN-L33), com a data da
 * última leitura. O número parcial não é errado; errado seria apresentá-lo como
 * fechado.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarBase, HOJE, iso } from '../src/dados/gerar.ts'
import {
  consumoDoCliente,
  contratosDoCliente,
  custosDoCliente,
  equipamentosDoCliente,
  escopoDoUsuario,
  locaisDoEscopo,
  memoriaDaCompetencia,
  resumoDoPortal,
} from '../src/dados/portal.ts'
import type { BaseDados, Usuario } from '../src/dados/tipos.ts'

const b: BaseDados = gerarBase()
const hoje = iso(HOJE)

function usuario(id: string): Usuario {
  const u = b.usuarios.find((x) => x.id === id)
  assert.ok(u, `a massa não tem o usuário ${id}`)
  return u
}

const escopoDe = (id: string) => {
  const e = escopoDoUsuario(usuario(id))
  assert.ok(e, `${id} deveria ter escopo de cliente`)
  return e
}

test('quem opera a locadora não tem escopo de cliente — e é isso que escolhe a aplicação', () => {
  assert.equal(escopoDoUsuario(usuario('usr-admin')), null)

  /*
   * O shell não pergunta "o perfil é de cliente?" em lugar nenhum: pergunta se
   * há recorte. Um usuário interno com um perfil de cliente atribuído por engano
   * continuaria operando a locadora — e é o `tipo` do usuário, não o do perfil,
   * que o comando de convite já obriga a casar.
   */
  const cliente = escopoDoUsuario(usuario('usr-cliente'))
  assert.ok(cliente)
  assert.equal(cliente.locaisIds, null, 'o administrador do cliente não é recortado por unidade')
})

test('o gestor de unidade vê menos que o administrador do cliente', () => {
  const admin = escopoDe('usr-cliente')
  const gestor = escopoDe('usr-cliente-unidade')

  assert.equal(admin.clienteId, gestor.clienteId, 'os dois precisam ser do mesmo cliente')
  assert.ok(Array.isArray(gestor.locaisIds) && gestor.locaisIds.length === 1)

  const unidadesAdmin = locaisDoEscopo(b, admin).length
  const unidadesGestor = locaisDoEscopo(b, gestor).length
  assert.ok(unidadesAdmin >= 2, 'a massa precisa de duas unidades para o recorte ter o que recortar')
  assert.equal(unidadesGestor, 1)

  const parqueAdmin = equipamentosDoCliente(b, admin)
  const parqueGestor = equipamentosDoCliente(b, gestor)
  assert.ok(
    parqueGestor.length < parqueAdmin.length,
    'o gestor de unidade enxergou o parque do grupo inteiro',
  )
  assert.ok(
    parqueGestor.every((e) => e.localId === gestor.locaisIds![0]),
    'apareceu máquina de outra unidade',
  )
})

test('vínculo vazio não vê nada — negado por omissão (RN-L26)', () => {
  /*
   * O caso que separa esta implementação da leitura oposta — "quem tem vínculo é
   * recortado, quem não tem vê tudo". Sob aquela leitura, apagar o último
   * vínculo **promoveria** o gestor a administrador do grupo, sem erro nenhum.
   */
  const semVinculo = { clienteId: escopoDe('usr-cliente').clienteId, locaisIds: [] }

  assert.equal(locaisDoEscopo(b, semVinculo).length, 0)
  assert.equal(equipamentosDoCliente(b, semVinculo).length, 0)
  assert.equal(consumoDoCliente(b, semVinculo).length, 0)
})

test('o cliente não alcança nada de outro cliente', () => {
  const escopo = escopoDe('usr-cliente')
  const outros = b.clientes.filter((c) => c.id !== escopo.clienteId)
  assert.ok(outros.length > 0, 'a massa precisa de um segundo cliente')

  const idsVisiveis = new Set(equipamentosDoCliente(b, escopo).map((e) => e.id))
  const alheios = b.equipamentos.filter((e) => e.clienteId && e.clienteId !== escopo.clienteId)
  assert.ok(alheios.length > 0)
  assert.ok(
    alheios.every((e) => !idsVisiveis.has(e.id)),
    'equipamento de outro cliente apareceu no parque do portal',
  )

  const contratos = contratosDoCliente(b, escopo)
  const alheiosContrato = new Set(
    b.contratos.filter((c) => c.clienteId !== escopo.clienteId).map((c) => c.id),
  )
  assert.ok(contratos.every((c) => !alheiosContrato.has(c.id)))
})

test('nenhuma consulta do portal carrega margem, custo ou valor de aquisição', () => {
  const escopo = escopoDe('usr-cliente')
  const proibidos = [
    'valorAquisicao',
    'custoManutencao',
    'margem',
    'receita12m',
    'depreciacao',
    'custoMedio',
  ]

  const saidas: Record<string, unknown> = {
    parque: equipamentosDoCliente(b, escopo),
    contratos: contratosDoCliente(b, escopo),
    consumo: consumoDoCliente(b, escopo),
    custos: custosDoCliente(b, escopo),
    resumo: resumoDoPortal(b, escopo, hoje),
  }

  for (const [nome, valor] of Object.entries(saidas)) {
    const texto = JSON.stringify(valor)
    for (const campo of proibidos) {
      assert.ok(!texto.includes(campo), `${nome} devolveu ${campo}`)
    }
  }
})

test('RN-L33: a competência aberta é declarada parcial, com a data da última leitura', () => {
  const escopo = escopoDe('usr-cliente')
  const resumo = resumoDoPortal(b, escopo, hoje)

  assert.ok(resumo.consumoEmAberto.competencia, 'a massa não tem competência aberta para este cliente')
  assert.equal(resumo.consumoEmAberto.parcial, true)
  assert.ok(
    resumo.consumoEmAberto.ultimaLeituraEm,
    'declara parcial e não diz de quando é a última leitura — metade da regra',
  )

  const aberta = consumoDoCliente(b, escopo, resumo.consumoEmAberto.competencia)
  assert.ok(aberta.length > 0)
  assert.ok(aberta.every((c) => c.parcial))

  /*
   * E o inverso: a competência selada **não** pode vir marcada. Sem este caso o
   * teste passaria com `parcial = true` constante, que é a implementação errada
   * mais fácil de escrever.
   */
  const selada = b.medicoes.find((m) => m.clienteId === escopo.clienteId && m.seladaEm !== null)
  assert.ok(selada, 'a massa precisa de uma medição selada')
  const fechada = consumoDoCliente(b, escopo, selada.competencia)
  assert.ok(fechada.length > 0)
  assert.ok(fechada.every((c) => !c.parcial), 'competência selada veio marcada como parcial')
})

test('a memória fecha: locação mais excedente é o total da cobrança', () => {
  const escopo = escopoDe('usr-cliente')
  const comCobranca = custosDoCliente(b, escopo).find((c) => c.cobrancaId !== null)
  assert.ok(comCobranca, 'a massa não tem competência com cobrança emitida para este cliente')

  const memoria = memoriaDaCompetencia(b, escopo, comCobranca.competencia)
  assert.ok(memoria)
  assert.equal(
    (memoria.locacao + memoria.excedente).toFixed(2),
    memoria.total.toFixed(2),
    'a memória não fecha: locação mais excedente teria de dar o total',
  )

  /*
   * O total vem da **cobrança**, não de uma soma paralela da medição: na
   * competência fechada ele tem de ser idêntico ao do boleto, e é essa
   * identidade que impede o cliente de confrontar o portal com o que recebeu.
   */
  const titulos = b.titulosReceber.filter(
    (t) =>
      t.clienteId === escopo.clienteId &&
      t.origem === 'CONTRATUAL' &&
      t.competencia === comCobranca.competencia,
  )
  const doTitulo = titulos.reduce((a, t) => a + (t.valorOriginal - t.desconto), 0)
  assert.equal(memoria.total.toFixed(2), doTitulo.toFixed(2))

  // Competência inexistente é ausência, e não uma memória vazia que parece boa.
  assert.equal(memoriaDaCompetencia(b, escopo, '1999-01'), null)
})

test('o resumo do gestor de unidade é menor, e diz quantas unidades ele vê', () => {
  const admin = resumoDoPortal(b, escopoDe('usr-cliente'), hoje)
  const gestor = resumoDoPortal(b, escopoDe('usr-cliente-unidade'), hoje)

  assert.ok(gestor.parque.total < admin.parque.total)
  assert.equal(gestor.unidadesNoEscopo, 1)
  assert.ok(admin.unidadesNoEscopo >= 2)

  /*
   * O campo existe para o recorte ser **visível** a quem usa o portal: quem
   * enxerga uma unidade precisa saber que enxerga uma, senão lê o número como se
   * fosse o do grupo — e a conclusão errada não tem como aparecer.
   */
  assert.equal(admin.cliente.id, gestor.cliente.id)
})
