#!/usr/bin/env node
/**
 * A matriz perfil × tela: quem abre o quê.
 *
 * Existe porque a correção dos perfis-semente não é verificável de outro jeito.
 * O array de permissões de um perfil tem dezenas de linhas e não diz nada a quem
 * lê; o que se quer saber é se o Analista Financeiro abre Contas a pagar.
 *
 * Cada tela declara uma permissão em `lib/navegacao.ts`; cada perfil declara as
 * suas em `lib/permissoes.ts` — que por sua vez é a transcrição do Anexo C,
 * verificada por `test/matriz-permissoes.test.ts`. Este script apenas cruza os
 * dois. Não tem asserção: é instrumento de leitura, e o portão é o teste.
 *
 *   node apps/web/scripts/matriz-perfil-tela.mjs
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('../test/resolver.mjs', pathToFileURL(import.meta.filename))
const { NAVEGACAO } = await import('../src/lib/navegacao.ts')
const { PERFIS } = await import('../src/lib/permissoes.ts')

const largura = Math.max(...NAVEGACAO.map((n) => n.rotulo.length))
const abrevia = (n) => n.split(' ').filter((w) => w[0] === w[0].toUpperCase()).map((w) => w[0]).join('')

console.log(''.padEnd(largura), PERFIS.map((p) => abrevia(p.nome).padStart(5)).join(''))
for (const tela of NAVEGACAO) {
  const marcas = PERFIS.map((p) => (p.permissoes.includes(tela.permissao) ? '    ✔' : '    ·'))
  console.log(tela.rotulo.padEnd(largura), marcas.join(''))
}
console.log()
for (const p of PERFIS) {
  const abertas = NAVEGACAO.filter((n) => p.permissoes.includes(n.permissao)).length
  console.log(`${abrevia(p.nome).padEnd(5)} ${p.nome.padEnd(30)} ${String(abertas).padStart(2)}/${NAVEGACAO.length} telas`)
}
