/**
 * A árvore de permissões é uma projeção do catálogo, não um segundo catálogo.
 *
 * Importa de `dist/`, e não de `src/`: o pacote de contratos usa import com
 * extensão `.js` (NodeNext), que o executor de TypeScript do Node não resolve
 * para o `.ts` correspondente. Testar o artefato compilado também é mais
 * honesto — é exatamente o que a API e o front consomem em produção.
 *
 * O teste que importa é o de completude: uma permissão sem lugar na árvore é
 * uma permissão que a interface de configuração não mostra, e portanto que
 * ninguém consegue conceder. O sintoma no campo seria "o botão não aparece
 * para ninguém, nem para o administrador" — e o rastro levaria à API, à
 * guarda, ao perfil, e só por último a esta lista.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ARVORE_PERMISSOES,
  alternarNo,
  decompor,
  estadoDoNo,
  acoesSemRotulo,
  permissoesDaTela,
  permissoesDoModulo,
  recursosSemModulo,
  recursosSemNome,
} from '../../../packages/contracts/dist/arvore-permissoes.js'
import { PERMISSOES } from '../../../packages/contracts/dist/catalogo-permissoes.js'

const naArvore = ARVORE_PERMISSOES.flatMap((m) => m.telas.flatMap((t) => t.acoes.map((a) => a.permissao)))

test('toda permissão do catálogo tem lugar na árvore', () => {
  const conjunto = new Set(naArvore)
  const orfas = PERMISSOES.filter((p) => !conjunto.has(p))

  assert.deepEqual(
    orfas,
    [],
    `permissões sem lugar na árvore ficariam impossíveis de conceder: ${orfas.join(', ')}`,
  )
})

test('todo recurso tem módulo, tela e ações declarados explicitamente', () => {
  /*
   * Este é o teste que de fato pega o esquecimento, e o anterior não pegava.
   *
   * A construção da árvore tem rede de segurança: recurso sem módulo cai em
   * Administração, ação sem rótulo ganha o identificador legibilizado. A rede
   * é certa em produção — some nada — e é péssima como garantia, porque
   * garante que o teste de completude sempre passe. Um recurso financeiro
   * novo apareceria calado sob Administração, onde ninguém procuraria.
   */
  assert.deepEqual(recursosSemModulo(), [], 'recursos que cairiam em Administração sem ninguém decidir')
  assert.deepEqual(recursosSemNome(), [], 'telas que apareceriam com o identificador cru')
  assert.deepEqual(acoesSemRotulo(), [], 'ações que apareceriam com o identificador cru')
})

test('a árvore não inventa permissão que o catálogo não tem', () => {
  const conjunto = new Set<string>(PERMISSOES)
  const inventadas = naArvore.filter((p) => !conjunto.has(p))

  // O caminho inverso: uma caixa na tela que concede algo que a guarda não
  // reconhece produz um perfil com permissão morta, e a rota continua negando.
  assert.deepEqual(inventadas, [])
})

test('nenhuma permissão aparece duas vezes na árvore', () => {
  // O catálogo repete `fornecedor:gerenciar` em dois blocos. Duas caixas
  // idênticas na mesma tela se desmarcariam mutuamente.
  const vistas = new Set<string>()
  const repetidas: string[] = []
  for (const p of naArvore) {
    if (vistas.has(p)) repetidas.push(p)
    vistas.add(p)
  }
  assert.deepEqual(repetidas, [])
})

test('todo nó tem rótulo legível, nunca vazio nem o identificador cru', () => {
  for (const m of ARVORE_PERMISSOES) {
    assert.notEqual(m.nome.trim(), '', `módulo ${m.id} sem nome`)
    for (const t of m.telas) {
      assert.notEqual(t.nome.trim(), '', `tela ${t.recurso} sem nome`)
      for (const a of t.acoes) {
        assert.notEqual(a.rotulo.trim(), '', `ação ${a.permissao} sem rótulo`)
        // Rótulo igual ao identificador cru denuncia entrada faltando no mapa.
        assert.notEqual(a.rotulo, decompor(a.permissao).acao, `ação ${a.permissao} sem rótulo próprio`)
      }
    }
  }
})

test('marcar o módulo concede todas as permissões dele, e só elas', () => {
  const financeiro = permissoesDoModulo('financeiro')
  assert.ok(financeiro.includes('pagar:aprovar'))
  assert.ok(financeiro.includes('receber:baixar'))
  assert.ok(!financeiro.includes('contrato:criar'))

  const marcadas = alternarNo([], financeiro, true)
  assert.equal(marcadas.length, financeiro.length)
})

test('marcar preserva o que já estava concedido fora do nó', () => {
  // É o defeito que a interface de árvore convida: aplicar o nó substituindo a
  // lista inteira, e apagar em silêncio o acesso que o perfil tinha em outro
  // módulo.
  const antes = alternarNo([], ['contrato:ler', 'contrato:criar'], true)
  const depois = alternarNo(antes, permissoesDaTela('financeiro', 'pagar'), true)

  assert.ok(depois.includes('contrato:ler'))
  assert.ok(depois.includes('contrato:criar'))
  assert.ok(depois.includes('pagar:aprovar'))
})

test('desmarcar remove só o nó, e é reversível', () => {
  const doNo = permissoesDaTela('financeiro', 'pagar')
  const cheio = alternarNo(['contrato:ler'], doNo, true)
  const vazio = alternarNo(cheio, doNo, false)

  assert.deepEqual(vazio, ['contrato:ler'])
})

test('a lista sai ordenada e sem duplicata, para não sujar a auditoria', () => {
  // Salvar duas vezes sem mudar nada não pode produzir diff na trilha.
  const a = alternarNo(['pagar:ler', 'contrato:ler'], ['pagar:ler', 'pagar:aprovar'], true)
  const b = alternarNo(a, [], true)

  assert.deepEqual(a, b)
  assert.deepEqual(a, [...a].sort())
  assert.equal(new Set(a).size, a.length)
})

test('estado parcial existe, e é o que impede a árvore de mentir', () => {
  const doModulo = permissoesDoModulo('financeiro')
  assert.ok(doModulo.length > 2)

  assert.equal(estadoDoNo([], doModulo), 'vazio')
  assert.equal(estadoDoNo(doModulo, doModulo), 'marcado')

  // Sem o terceiro estado, um módulo com três de dez permissões apareceria
  // desmarcado — e quem configura concluiria que o perfil não tem acesso
  // nenhum ali, quando tem.
  assert.equal(estadoDoNo([doModulo[0]!], doModulo), 'parcial')
})

test('cada tela pertence a um módulo só', () => {
  // Um recurso em dois módulos apareceria duas vezes na árvore, e marcar num
  // lugar deixaria o outro parcial sem explicação visível.
  const onde = new Map<string, string>()
  for (const m of ARVORE_PERMISSOES) {
    for (const t of m.telas) {
      assert.equal(onde.has(t.recurso), false, `recurso ${t.recurso} em dois módulos`)
      onde.set(t.recurso, m.id)
    }
  }
})
