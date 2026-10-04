/**
 * Toda tela que consulta precisa saber dizer que a consulta falhou.
 *
 * Este portão nasceu de uma medição da Entrega 5: **19 das 24 telas** com
 * consulta não tratavam erro. Elas renderizavam `dado ?? []`, e a tabela
 * anunciava "nenhum registro" — uma resposta errada apresentada como certa.
 * Quem lê conclui que não há o que ver e vai embora, sem nunca saber que
 * houve falha e sem ter o que tentar de novo.
 *
 * Uma delas era pior. `Resultado` guardava com
 * `if (situacao === 'carregando' || !dado)`: com a carga falhada `dado` é
 * nulo, a condição dá verdadeiro, e a tela ficava **no esqueleto para
 * sempre**. A espera infinita é pior que a lista vazia, porque não oferece
 * nem o caminho de volta.
 *
 * Verificação de fonte, e não de renderização, pelo mesmo motivo do portão da
 * matriz de permissões: o que se quer garantir é que **nenhuma tela nova
 * nasça sem isto**, e isso é uma propriedade do arquivo.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const telas = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'telas')

const arquivos = readdirSync(telas)
  .filter((n) => n.endsWith('.tsx'))
  .map((nome) => ({ nome, fonte: readFileSync(join(telas, nome), 'utf8') }))

const comConsulta = arquivos.filter((a) => a.fonte.includes('useConsulta('))

test('a massa de telas é a esperada — o portão não pode ficar vazio sem avisar', () => {
  assert.ok(arquivos.length >= 20, `só ${arquivos.length} telas encontradas: o caminho mudou?`)
  assert.ok(comConsulta.length >= 20, `só ${comConsulta.length} telas consultam dados`)
})

test('toda tela que consulta trata o estado de erro', () => {
  const sem = comConsulta.filter((a) => !a.fonte.includes('ErroConsulta')).map((a) => a.nome)

  assert.deepEqual(
    sem,
    [],
    'tela que consulta e não trata erro: quando a carga falha ela mostra lista vazia,\n' +
      'e "nenhum registro" é uma resposta errada apresentada como certa.',
  )
})

test('o estado de erro vem antes de qualquer guarda que teste a ausência de dado', () => {
  /*
   * A ordem importa e não é detalhe de estilo. `!dado` é verdadeiro tanto no
   * carregamento quanto na falha; uma guarda de carregamento escrita antes do
   * tratamento de erro captura os dois casos e devolve esqueleto para sempre.
   */
  const invertidas: string[] = []

  /*
   * Só guarda que **devolve tela**. `if (!dado) return []` dentro de um
   * `useMemo` é outra coisa: devolve coleção vazia para um cálculo, não
   * interrompe a renderização. Uma verificação que não distingue as duas
   * reprova três telas corretas — e um portão que acusa quem está certo é
   * abandonado antes de pegar quem está errado.
   */
  const GUARDA_DE_TELA = /if \([^)]*!dado[^)]*\)\s*\{\s*\n\s*return \(/

  for (const { nome, fonte } of comConsulta) {
    const guarda = fonte.search(GUARDA_DE_TELA)
    const erro = fonte.indexOf("situacao === 'erro'")
    if (guarda !== -1 && erro !== -1 && guarda < erro) invertidas.push(nome)
  }

  assert.deepEqual(
    invertidas,
    [],
    'guarda de ausência de dado antes do tratamento de erro: a tela fica no esqueleto para sempre.',
  )
})
