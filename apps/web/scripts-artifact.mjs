/**
 * Converte o build de documento completo em fragmento publicável.
 *
 * O artifact envolve o conteúdo em seu próprio <!doctype>/<head>/<body>, então
 * publicar o documento inteiro aninharia tags. Aqui extraímos <title>, <style>
 * e o conteúdo de <body> — o mesmo JS e CSS, sem o envelope.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const doc = readFileSync('apps/web/dist/index.html', 'utf8')

const pegar = (re, nome) => {
  const m = doc.match(re)
  if (!m) throw new Error(`não encontrei ${nome} no build`)
  return m
}

const titulo = pegar(/<title>([\s\S]*?)<\/title>/, '<title>')[1]
// O plugin de arquivo único move o <script> embutido para o <head>, então
// coletamos estilos e scripts do documento inteiro, não apenas do <body>.
const estilos = [...doc.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0])
const scripts = [...doc.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0])
const corpo = pegar(/<body[^>]*>([\s\S]*?)<\/body>/, '<body>')[1]

if (!estilos.length) throw new Error('nenhum <style> embutido: o plugin de arquivo único não rodou')
if (!scripts.length) throw new Error('nenhum <script> embutido: a aplicação não funcionaria')

const fragmento = [
  `<title>${titulo}</title>`,
  ...estilos,
  corpo.trim(),
  // Script depois do corpo: #raiz precisa existir quando o React monta.
  ...scripts,
].join('\n') + '\n'
writeFileSync('apps/web/dist/artifact.html', fragmento, 'utf8')

console.log(
  `artifact.html gerado — ${(fragmento.length / 1024).toFixed(0)} KB, ` +
    `${estilos.length} estilo(s) e ${scripts.length} script(s), título "${titulo}"`,
)
