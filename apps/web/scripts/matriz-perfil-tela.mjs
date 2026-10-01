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
const { NAVEGACAO, NAVEGACAO_PORTAL } = await import('../src/lib/navegacao.ts')
const { PERFIS } = await import('../src/lib/permissoes.ts')
const { gerarBase } = await import('../src/dados/gerar.ts')

/*
 * Os perfis de cliente não estão em `lib/permissoes.ts`, e não por esquecimento:
 * quem os define é a migração 0011, e a lista branca que os limita é um gatilho
 * do banco. Vêm da massa, que os transcreve de lá.
 */
const PERFIS_CLIENTE = gerarBase().perfis.filter((p) => p.tipo === 'CLIENTE')

const abrevia = (n) => n.split(' ').filter((w) => w[0] === w[0].toUpperCase()).map((w) => w[0]).join('')

/*
 * Duas matrizes, porque são duas audiências e elas nunca se encontram: quem
 * opera a locadora não abre o portal, e quem é do cliente não abre a operação.
 * Uma matriz só somaria telas que nenhum perfil daquele lado pode abrir, e o
 * número perderia o sentido de "quanto do produto este perfil alcança".
 */
function matriz(titulo, telas, perfis) {
  const largura = Math.max(...telas.map((n) => n.rotulo.length))
  console.log(`\n${titulo}\n`)
  console.log(''.padEnd(largura), perfis.map((p) => abrevia(p.nome).padStart(5)).join(''))
  for (const tela of telas) {
    const marcas = perfis.map((p) => (p.permissoes.includes(tela.permissao) ? '    ✔' : '    ·'))
    console.log(tela.rotulo.padEnd(largura), marcas.join(''))
  }
  console.log()
  for (const p of perfis) {
    const abertas = telas.filter((n) => p.permissoes.includes(n.permissao)).length
    console.log(`${abrevia(p.nome).padEnd(5)} ${p.nome.padEnd(30)} ${String(abertas).padStart(2)}/${telas.length} telas`)
  }
}

matriz('Operação da locadora', NAVEGACAO, PERFIS)
matriz('Portal do cliente', NAVEGACAO_PORTAL, PERFIS_CLIENTE)
