#!/usr/bin/env node
/**
 * Guarda estrutural: toda rota HTTP declara autorização.
 *
 * A `PermissaoGuard` já nega em runtime rota sem `@ExigePermissao` — mas negar
 * em runtime significa descobrir o esquecimento quando alguém chamar a rota, o
 * que pode ser em produção. Esta verificação move a descoberta para o pull
 * request.
 *
 * A regra é simples e sem exceção implícita: cada `@Get/@Post/@Put/@Patch/
 * @Delete` precisa ter, no mesmo bloco de decoradores, `@ExigePermissao(...)`
 * ou `@Publico()`. Abrir uma rota passa a ser um ato explícito e revisável.
 *
 * Análise textual, não AST, deliberadamente: a checagem precisa ser óbvia de
 * ler e rodar sem toolchain. O custo é exigir que os decoradores fiquem
 * adjacentes ao método — que é como já se escreve.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = new URL('../src', import.meta.url).pathname
const METODOS = /^\s*@(Get|Post|Put|Patch|Delete|All)\s*\(/
const AUTORIZA = /^\s*@(ExigePermissao|Publico)\s*\(/
const FIM_DECORADORES = /^\s*(public |private |protected |async |[A-Za-z_$][\w$]*\s*\()/

function arquivos(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) return arquivos(caminho)
    return caminho.endsWith('.controller.ts') ? [caminho] : []
  })
}

const problemas = []
let rotas = 0

for (const caminho of arquivos(RAIZ)) {
  const linhas = readFileSync(caminho, 'utf8').split('\n')

  for (let i = 0; i < linhas.length; i += 1) {
    if (!METODOS.test(linhas[i])) continue
    rotas += 1

    // Varre o bloco contíguo de decoradores, para cima e para baixo, até
    // encontrar a assinatura do método.
    let autorizada = false
    for (let j = i; j >= 0 && (linhas[j].trim().startsWith('@') || linhas[j].trim() === ''); j -= 1) {
      if (AUTORIZA.test(linhas[j])) autorizada = true
    }
    for (let j = i + 1; j < linhas.length && !FIM_DECORADORES.test(linhas[j]); j += 1) {
      if (AUTORIZA.test(linhas[j])) autorizada = true
    }

    if (!autorizada) {
      const relativo = caminho.slice(caminho.indexOf('apps/api'))
      problemas.push(`${relativo}:${i + 1} — ${linhas[i].trim()} sem @ExigePermissao nem @Publico`)
    }
  }
}

if (problemas.length > 0) {
  console.error('Rotas sem autorização declarada (RN-026 — negado por padrão):\n')
  for (const p of problemas) console.error(`  ${p}`)
  console.error(`\n${problemas.length} de ${rotas} rotas reprovadas.`)
  process.exit(1)
}

console.log(`${rotas}/${rotas} rotas declaram autorização explícita`)
