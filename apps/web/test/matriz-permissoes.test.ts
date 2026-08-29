/**
 * Os perfis-semente contra a matriz do Anexo C.
 *
 * O que este arquivo protege é uma divergência que **não dá erro**: o anexo diz
 * que o Analista Financeiro aprova pagamento, o array em `lib/permissoes.ts` não
 * traz `pagar:aprovar`, e o resultado é um botão que some sem que nada acuse. Foi
 * exatamente o que aconteceu: o código tinha cinco perfis inventados enquanto o
 * anexo especificava nove, e 94 das 125 permissões não chegavam a ninguém além do
 * Administrador.
 *
 * Em vez de comparar dois arrays escritos à mão, este teste **relê o anexo** e
 * refaz a derivação. O documento é normativo; o código é a transcrição. Se
 * alguém mudar um ✔ para — na tabela, a suíte falha aqui e diz qual permissão
 * saiu de qual perfil.
 *
 * As convenções de tradução estão em §C.4.1, e são as três que o parser aplica:
 * ◐ concede (o ◐ **é** o termo da alçada, avaliado em outra camada), ○ concede
 * só as leituras da linha, e o Administrador da Plataforma é ✔ em todas.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PERMISSOES, type Permissao } from '@iarx/contracts/catalogo-permissoes'
import { PERFIS } from '../src/lib/permissoes.ts'

const ANEXO = new URL('../../../docs/anexos/C-matriz-de-permissoes.md', import.meta.url)

/** Os nove de §C.3, e o id que cada um tem no código. */
const PERFIS_C3: Record<string, string> = {
  'Administrador da Plataforma': 'admin',
  Diretor: 'diretoria',
  'Gestor de Filial': 'gestor-filial',
  'Operador Administrativo': 'operacao',
  'Coordenador de Logística': 'logistica',
  'Supervisor de Manutenção': 'manutencao',
  'Técnico de Manutenção': 'tecnico',
  'Analista Financeiro': 'financeiro',
  Consulta: 'consulta',
}

/** Cabeçalho abreviado da matriz → nome de §C.3. */
const COLUNAS: Record<string, string> = {
  Admin: 'Administrador da Plataforma',
  Diretor: 'Diretor',
  'Gestor Filial': 'Gestor de Filial',
  'Oper. Admin': 'Operador Administrativo',
  Logística: 'Coordenador de Logística',
  'Superv. Mnt': 'Supervisor de Manutenção',
  Técnico: 'Técnico de Manutenção',
  Financeiro: 'Analista Financeiro',
  Consulta: 'Consulta',
}

/**
 * As ações que são leitura, e portanto as únicas que ○ concede.
 *
 * A lista é curta e explícita de propósito: "somente leitura" precisa ser
 * decidível por máquina, senão cada linha da matriz vira interpretação. Está
 * declarada em §C.4.1 com estas três.
 */
const LEITURAS = new Set(['ler', 'painel_executivo', 'rentabilidade_ler'])

const semNota = (celula: string) => celula.replace(/[¹²³⁴⁵⁶⁷⁸⁹]/g, '').trim()

/**
 * `contrato:item_alocar/substituir` são duas folhas do catálogo, e a segunda
 * está abreviada — a matriz escreve `substituir` onde o catálogo tem
 * `item_substituir`. A resolução exige **um** candidato: duas seriam ambiguidade
 * silenciosa, e a matriz passaria a conceder algo que ninguém escolheu.
 */
function expandir(codigo: string): Permissao[] {
  const [recurso, acoes] = codigo.split(':')
  return acoes.split('/').map((acao) => {
    const exato = `${recurso}:${acao}` as Permissao
    if ((PERMISSOES as readonly string[]).includes(exato)) return exato
    const candidatos = PERMISSOES.filter((p) => {
      const [r, a] = p.split(':')
      return r === recurso && (a.endsWith(`_${acao}`) || a.startsWith(`${acao}_`))
    })
    assert.equal(
      candidatos.length,
      1,
      `"${codigo}": a ação "${acao}" resolve para ${candidatos.length} permissões do catálogo`,
    )
    return candidatos[0]!
  })
}

const permsDaCelula = (celula: string): Permissao[] =>
  (celula.match(/`[a-z_]+:[a-z_/]+`/g) ?? []).flatMap((m) => expandir(m.slice(1, -1)))

function derivarDaMatriz(): { conjuntos: Record<string, Set<Permissao>>; linhas: number } {
  const linhas = readFileSync(ANEXO, 'utf8').split('\n')
  const em = (prefixo: string) => linhas.findIndex((l) => l.startsWith(prefixo))
  const conjuntos: Record<string, Set<Permissao>> = Object.fromEntries(
    Object.keys(PERFIS_C3).map((p) => [p, new Set<Permissao>()]),
  )
  let total = 0

  // ---------------------------------------------------- §C.4, nove colunas
  const c4 = linhas.slice(em('## C.4 '), em('## C.4.1'))
  const cabecalho = c4.find((l) => l.startsWith('| Permissão (agrupada) |'))
  assert.ok(cabecalho, 'a tabela de C.4 mudou de cabeçalho')
  const ordem = cabecalho.split('|').slice(2, -1).map((c) => {
    const nome = COLUNAS[c.trim()]
    assert.ok(nome, `coluna desconhecida em C.4: "${c.trim()}"`)
    return nome
  })

  for (const l of c4) {
    if (!l.startsWith('| `')) continue
    total++
    const celulas = l.split('|').slice(1, -1)
    const perms = permsDaCelula(celulas[0]!)
    const leituras = perms.filter((p) => LEITURAS.has(p.split(':')[1]!))
    ordem.forEach((perfil, i) => {
      const v = semNota(celulas[i + 1]!)
      if (v === '✔' || v === '◐') perms.forEach((p) => conjuntos[perfil]!.add(p))
      else if (v === '○') leituras.forEach((p) => conjuntos[perfil]!.add(p))
      else assert.equal(v, '—', `símbolo desconhecido na matriz: "${v}"`)
    })
  }

  // -------------------------------------- §C.4.2, permissão | perfis | origem
  const c42 = linhas.slice(em('## C.4.2'), em('## C.5'))
  for (const l of c42) {
    if (!l.startsWith('| `')) continue
    total++
    const [colPerm, colPerfis] = l.split('|').slice(1, 3)
    const perms = permsDaCelula(colPerm!)
    for (const nome of colPerfis!.split(',').map((n) => n.trim())) {
      assert.ok(conjuntos[nome], `perfil desconhecido em C.4.2: "${nome}" — os nomes são os de §C.3`)
      perms.forEach((p) => conjuntos[nome]!.add(p))
    }
  }

  PERMISSOES.forEach((p) => conjuntos['Administrador da Plataforma']!.add(p))
  return { conjuntos, linhas: total }
}

test('o anexo ainda tem a forma que o parser lê', () => {
  const { conjuntos, linhas } = derivarDaMatriz()
  // Um anexo reescrito em outro formato faria todos os conjuntos virem vazios e
  // o teste passaria por vacuidade. Esta é a guarda contra isso.
  assert.ok(linhas > 90, `só ${linhas} linhas de matriz foram lidas — o formato mudou`)
  for (const [nome, conj] of Object.entries(conjuntos)) {
    assert.ok(conj.size > 0, `${nome} saiu da matriz sem permissão nenhuma`)
  }
})

test('os perfis do código são exatamente os nove de C.3', () => {
  assert.deepEqual(
    PERFIS.map((p) => p.nome).sort(),
    Object.keys(PERFIS_C3).sort(),
  )
})

test('cada perfil-semente tem exatamente o que a matriz lhe dá', () => {
  const { conjuntos } = derivarDaMatriz()
  for (const [nome, id] of Object.entries(PERFIS_C3)) {
    const perfil = PERFIS.find((p) => p.id === id)
    assert.ok(perfil, `perfil "${id}" não existe no código`)
    const esperado = PERMISSOES.filter((p) => conjuntos[nome]!.has(p))
    const obtido = [...perfil.permissoes].sort(
      (a, b) => PERMISSOES.indexOf(a) - PERMISSOES.indexOf(b),
    )
    const sobrando = obtido.filter((p) => !esperado.includes(p))
    const faltando = esperado.filter((p) => !obtido.includes(p))
    assert.deepEqual(
      { sobrando, faltando },
      { sobrando: [], faltando: [] },
      `${nome} diverge da matriz do Anexo C`,
    )
  }
})

test('a matriz não deixa permissão presa só no Administrador sem dizer', () => {
  const { conjuntos } = derivarDaMatriz()
  const outros = Object.keys(PERFIS_C3).filter((n) => n !== 'Administrador da Plataforma')
  const presas = PERMISSOES.filter((p) => !outros.some((n) => conjuntos[n]!.has(p)))
  /*
   * As seis são administração do locatário — IAM, parâmetros, integrações — e
   * C.4 as dá só ao Administrador em linha explícita. O número é asserido em vez
   * de tolerado: quando eram 94, ninguém percebeu; se voltar a crescer, é porque
   * alguém acrescentou permissão ao catálogo sem lhe dar linha no anexo.
   */
  assert.deepEqual(presas, [
    'usuario:gerenciar',
    'perfil:gerenciar',
    'parametro:gerenciar',
    'integracao:gerenciar',
    'apikey:gerenciar',
    'webhook:gerenciar',
  ])
})
