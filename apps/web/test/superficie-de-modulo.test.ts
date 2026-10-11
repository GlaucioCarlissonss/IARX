/**
 * Superfície de módulo: o que um arquivo exporta e ninguém importa.
 *
 * Não é código morto — o símbolo é usado, só que dentro do próprio arquivo. É
 * superfície pública maior que a necessária, e o custo dela aparece devagar:
 * quem lê um módulo não distingue o que é contrato do que é detalhe, e quem
 * refatora não sabe o que pode mexer sem avisar ninguém.
 *
 * Este portão existe porque o item **resistiu a quatro medições de passagem**,
 * cada uma com um número diferente, e cada erro parecia certo até a verificação
 * seguinte:
 *
 *   ~60 — listagem truncada em oitenta linhas; contei o que a tela mostrava
 *   112 — misturava `packages/contracts`, que exporta amplamente por desenho
 *   129 — `src/**` não casa com arquivo direto em `src/`, então `app.module.ts`
 *         ficou de fora e **todo controller do Nest apareceu como órfão**
 *    80 — os testes não entravam como consumidores, e é deles que vêm os usos
 *         de `resolverFranquia`, `lerRespostaNominatim`, `montarChave`
 *
 * Duas decisões de desenho saem direto desses erros.
 *
 * **Importação, e não busca textual.** Procurar o nome como palavra erra para
 * os dois lados: `Tile` numa variável local de outro arquivo conta como uso, e
 * um símbolo só alcançado por `import * as ns` não conta. Aqui o que vale é o
 * grafo de importação de verdade, com o especificador resolvido em disco — é a
 * mesma pergunta que o empacotador faz.
 *
 * **Dispensa derivada, lista curta.** Tipo que aparece na *assinatura* de algo
 * exportado precisa continuar exportado: sem isso quem consome a função não tem
 * como nomear o que ela recebe ou devolve. Isso é a regra, não a exceção, e
 * exigir justificativa escrita para cada caso encheria a lista de ruído até
 * ninguém mais ler. Então é **calculado**, pela árvore sintática — posição de
 * tipo, cláusula de herança, membro de interface — e não por semelhança de
 * texto. A lista escrita à mão fica só para o que sobra, que é pouco e é de
 * fato decisão de alguém.
 *
 * A precisão aqui não é preciosismo. A primeira versão olhava as doze primeiras
 * linhas de cada bloco exportado, e com isso dava por "superfície" toda
 * constante usada no **corpo** de uma função exportada — `SQLSTATE_EXCLUSAO`
 * entre elas. Dispensava justamente o que o portão existe para encontrar.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * Onde um export conta como excesso.
 *
 * `packages/contracts` fica de fora **como declarante**: um pacote de contratos
 * compartilhado exporta amplamente por desenho, e cobrar dele a mesma régua
 * confundiria propósito com descuido. Continua valendo como consumidor.
 */
const DECLARANTES = [
  join(raiz, 'apps', 'web', 'src'),
  join(raiz, 'apps', 'api', 'src'),
]

/**
 * Quem pode consumir. Mais largo que os declarantes de propósito: teste é
 * consumidor legítimo — exercitar uma função pura diretamente é exatamente o
 * que justifica exportá-la.
 */
const CONSUMIDORES = [
  join(raiz, 'apps', 'web', 'src'),
  join(raiz, 'apps', 'web', 'test'),
  join(raiz, 'apps', 'api', 'src'),
  join(raiz, 'apps', 'api', 'test'),
  join(raiz, 'packages', 'contracts', 'src'),
  join(raiz, 'apps', 'web'),
]

const EXTENSOES = ['.ts', '.tsx', '.mjs']

function arquivos(dir: string, recursivo = true): string[] {
  if (!existsSync(dir)) return []
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === 'dist') continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) {
      if (recursivo) saida.push(...arquivos(caminho))
    } else if (EXTENSOES.some((e) => nome.endsWith(e)) && !nome.endsWith('.d.ts')) {
      saida.push(caminho)
    }
  }
  return saida
}

const declarantes = [...new Set(DECLARANTES.flatMap((d) => arquivos(d)))]
const consumidores = [...new Set(CONSUMIDORES.flatMap((d) => arquivos(d)))]

const fonte = new Map<string, string>()
for (const f of [...declarantes, ...consumidores]) {
  if (!fonte.has(f)) fonte.set(f, readFileSync(f, 'utf8'))
}

/* ------------------------------------------------------------ declarações */

function arvore(arq: string): ts.SourceFile {
  return ts.createSourceFile(arq, fonte.get(arq)!, ts.ScriptTarget.Latest, true)
}

function temExport(no: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(no as ts.Declaration) & ts.ModifierFlags.Export) !== 0
}

/**
 * Nomes exportados por arquivo.
 *
 * `Set` e não lista: `ListarCaixa` é declarado duas vezes no mesmo arquivo — um
 * DTO e um tipo de resposta — e contar duas vezes inflava o total sem
 * corresponder a dois símbolos para remover.
 */
function exportados(sf: ts.SourceFile): Set<string> {
  const nomes = new Set<string>()
  for (const no of sf.statements) {
    if (!temExport(no)) continue
    if (ts.isVariableStatement(no)) {
      for (const d of no.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) nomes.add(d.name.text)
      }
    } else if (
      (ts.isFunctionDeclaration(no) ||
        ts.isClassDeclaration(no) ||
        ts.isInterfaceDeclaration(no) ||
        ts.isTypeAliasDeclaration(no) ||
        ts.isEnumDeclaration(no)) &&
      no.name
    ) {
      nomes.add(no.name.text)
    }
  }
  return nomes
}

/**
 * Nomes que a **assinatura** de algo exportado menciona.
 *
 * Só posição de tipo: anotação de parâmetro, tipo de retorno, restrição de
 * genérico, cláusula de herança, membro de interface ou de alias. O corpo de
 * função fica de fora de propósito — é lá que mora o uso interno, que é
 * exatamente o que este portão procura.
 */
function superficie(sf: ts.SourceFile): Set<string> {
  const nomes = new Set<string>()

  const colherTipo = (no: ts.Node | undefined) => {
    if (!no) return
    const visitar = (n: ts.Node) => {
      if (ts.isTypeReferenceNode(n)) {
        const raizNome = ts.isQualifiedName(n.typeName) ? n.typeName.left : n.typeName
        if (ts.isIdentifier(raizNome)) nomes.add(raizNome.text)
      }
      if (ts.isExpressionWithTypeArguments(n) && ts.isIdentifier(n.expression)) {
        nomes.add(n.expression.text)
      }
      ts.forEachChild(n, visitar)
    }
    visitar(no)
  }

  const assinatura = (no: ts.SignatureDeclarationBase) => {
    no.typeParameters?.forEach(colherTipo)
    no.parameters.forEach((p) => colherTipo(p.type))
    colherTipo(no.type)
  }

  for (const no of sf.statements) {
    if (!temExport(no)) continue

    if (ts.isFunctionDeclaration(no)) {
      assinatura(no)
    } else if (ts.isVariableStatement(no)) {
      for (const d of no.declarationList.declarations) {
        colherTipo(d.type)
        // `export const f = (x: T): U => ...` — a seta tem assinatura própria.
        if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          assinatura(d.initializer)
        }
      }
    } else if (ts.isInterfaceDeclaration(no) || ts.isTypeAliasDeclaration(no)) {
      // Um tipo é assinatura por inteiro: todo membro dele é alcançável.
      colherTipo(no)
    } else if (ts.isClassDeclaration(no)) {
      no.heritageClauses?.forEach(colherTipo)
      for (const m of no.members) {
        if (ts.isPropertyDeclaration(m)) colherTipo(m.type)
        else if (ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m)) assinatura(m)
      }
    }
  }
  return nomes
}

/* ------------------------------------------------------------ importações */

/** Resolve um especificador relativo ao arquivo em disco, como o bundler faz. */
function resolver(deQual: string, especificador: string): string | null {
  if (!especificador.startsWith('.')) return null
  const base = resolve(dirname(deQual), especificador)
  const semExt = base.replace(/\.js$/, '')
  for (const tentativa of [
    base,
    `${semExt}.ts`,
    `${semExt}.tsx`,
    join(semExt, 'index.ts'),
    join(semExt, 'index.tsx'),
  ]) {
    if (existsSync(tentativa) && statSync(tentativa).isFile()) return tentativa
  }
  return null
}

const IMPORTACAO =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g
const SO_EFEITO = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

/** Mapa arquivo-declarante → nomes que alguém importa dele. */
const importados = new Map<string, Set<string>>()

function registrar(alvo: string, nome: string) {
  if (!importados.has(alvo)) importados.set(alvo, new Set())
  importados.get(alvo)!.add(nome)
}

for (const arq of consumidores) {
  const src = fonte.get(arq)!
  for (const m of src.matchAll(IMPORTACAO)) {
    const clausula = m[1]!
    const alvo = resolver(arq, m[2]!)
    if (!alvo || alvo === arq) continue

    // `import * as ns from './x'` — qualquer `ns.Nome` no arquivo é uso.
    const ns = clausula.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)
    if (ns) {
      for (const u of src.matchAll(new RegExp(`\\b${ns[1]}\\.([A-Za-z_$][\\w$]*)`, 'g'))) {
        registrar(alvo, u[1]!)
      }
      continue
    }

    // `import X, { a, b as c, type D } from './x'` e `export { a } from './x'`
    const chaves = clausula.match(/\{([\s\S]*)\}/)
    if (chaves) {
      for (const parte of chaves[1]!.split(',')) {
        const nome = parte.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim()
        if (nome) registrar(alvo, nome)
      }
    }
    const padrao = clausula.replace(/\{[\s\S]*\}/, '').replace(/,/g, '').trim()
    if (padrao && !padrao.startsWith('*')) registrar(alvo, 'default')
  }

  // `export * from './x'` reexporta tudo: o arquivo inteiro vira superfície.
  for (const m of src.matchAll(/(?:^|\n)\s*export\s+\*\s+from\s*['"]([^'"]+)['"]/g)) {
    const alvo = resolver(arq, m[1]!)
    if (alvo) registrar(alvo, '*')
  }
  void SO_EFEITO
}

/* ------------------------------------------------------------ justificados */

/**
 * Exports sem consumidor **que continuam exportados de propósito**.
 *
 * Cada entrada carrega a razão porque a razão é o conteúdo: sem ela a lista
 * vira depósito, e o portão deixa de significar qualquer coisa. Ela só encolhe
 * — uma entrada nova exige decidir, e decidir exige escrever.
 */
const EXPORTS_JUSTIFICADOS: Record<string, string> = {
  /*
   * Vocabulário completo, e é o completo que tem valor.
   *
   * `sqlstate.ts` se declara "a única ponte" entre a violação que o PostgreSQL
   * levanta e o erro que o operador lê, e "curto e exaustivo". Dois dos nove
   * códigos têm consumidor hoje; exportar só esses dois faria a tabela parecer
   * uma escolha, quando ela é o conjunto fechado dos SQLSTATE que esta base
   * reconhece. Quem for mapear o décimo precisa ver os nove.
   */
  'apps/api/src/banco/sqlstate.ts:SQLSTATE_EXCLUSAO': 'vocabulário fechado de SQLSTATE (ver cabeçalho do arquivo)',
  'apps/api/src/banco/sqlstate.ts:SQLSTATE_CHECK': 'idem',
  'apps/api/src/banco/sqlstate.ts:SQLSTATE_FK': 'idem',
  'apps/api/src/banco/sqlstate.ts:SQLSTATE_NOT_NULL': 'idem',
  'apps/api/src/banco/sqlstate.ts:SQLSTATE_PRIVILEGIO': 'idem',
  'apps/api/src/banco/sqlstate.ts:SQLSTATE_SERIALIZACAO': 'idem',
  'apps/api/src/banco/sqlstate.ts:SQLSTATE_DEADLOCK': 'idem',

  /*
   * Mesmo argumento, outro vocabulário: `moeda`, `moedaCompacta`, `inteiro`,
   * `percentual` e `decimal` são a formatação pt-BR desta base. Um módulo de
   * formatação de número que não formata uma casa decimal é armadilha para
   * quem chegar depois — escreve o `Intl.NumberFormat` de novo, com outra
   * configuração, e a tela fica inconsistente sem ninguém perceber.
   */
  'apps/web/src/lib/formato.ts:decimal': 'vocabulário de formatação pt-BR; o conjunto é que informa',

  /*
   * Vestígio deliberado de um requisito não cumprido. O Anexo C prevê
   * `dados_sensiveis:ver_completo`, nenhuma tela chama, e apagar não removeria
   * código morto: removeria a única evidência de que a interface deve isso.
   * Ligar é decisão de produto. Ver o comentário na própria declaração.
   */
  'apps/web/src/lib/formato.ts:mascararCnpj': 'requisito do Anexo C que a interface ainda não cumpre',
}

/* ------------------------------------------------------------- verificação */

interface Excesso {
  arquivo: string
  nome: string
}

function levantar(): Excesso[] {
  const achados: Excesso[] = []
  for (const arq of declarantes) {
    const usados = importados.get(arq)
    if (usados?.has('*')) continue // reexportado em bloco: tudo é superfície
    const sf = arvore(arq)
    const nomeavel = superficie(sf)
    for (const nome of exportados(sf)) {
      if (usados?.has(nome)) continue
      // Nomeável pela assinatura de outro export: tirar o `export` daqui
      // deixaria quem consome sem como escrever o tipo que recebe de volta.
      if (nomeavel.has(nome)) continue
      achados.push({ arquivo: arq.slice(raiz.length + 1), nome })
    }
  }
  return achados.sort((a, b) => a.arquivo.localeCompare(b.arquivo) || a.nome.localeCompare(b.nome))
}

const excessos = levantar()

test('a massa de arquivos é a esperada — o portão não pode passar vazio', () => {
  assert.ok(
    declarantes.length >= 100,
    `só ${declarantes.length} arquivos declarantes: o caminho mudou?`,
  )
  assert.ok(
    importados.size >= 50,
    `só ${importados.size} arquivos importados: o resolvedor parou de resolver?`,
  )
})

test('nenhum export sem consumidor fora da lista de justificados', () => {
  const novos = excessos
    .filter((e) => !(`${e.arquivo}:${e.nome}` in EXPORTS_JUSTIFICADOS))
    .map((e) => `${e.arquivo}:${e.nome}`)

  assert.deepEqual(
    novos,
    [],
    'export sem consumidor e sem justificativa.\n' +
      'Ou tire o `export` — o símbolo continua funcionando dentro do arquivo —\n' +
      'ou acrescente a entrada em EXPORTS_JUSTIFICADOS dizendo por que ela fica.\n' +
      'Tipo que aparece na assinatura de função exportada é o caso típico de ficar:\n' +
      'sem o `export` ninguém consegue nomear o que a função devolve.',
  )
})

test('a lista de justificados não guarda entrada que já não se aplica', () => {
  const vivos = new Set(excessos.map((e) => `${e.arquivo}:${e.nome}`))
  const obsoletos = Object.keys(EXPORTS_JUSTIFICADOS).filter((k) => !vivos.has(k))

  assert.deepEqual(
    obsoletos,
    [],
    'justificativa para export que ganhou consumidor, foi removido ou mudou de nome.\n' +
      'Entrada que não se aplica mais faz a lista crescer sozinha e esconder o que importa.',
  )
})
