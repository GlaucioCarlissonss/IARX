import { Algorithm, hash, verify } from '@node-rs/argon2'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Hash de senha.
 *
 * Argon2id, por decisão D-07 (revertida para implementação própria). Os
 * parâmetros seguem o perfil interativo recomendado pela RFC 9106 — 19 MiB de
 * memória, 2 iterações, paralelismo 1 — e ficam **dentro do próprio hash**, no
 * formato PHC. É o que permite aumentar o custo no futuro sem invalidar nada:
 * `verify` lê os parâmetros do hash antigo, e só o rehash usa os novos.
 *
 * O banco recusa qualquer coisa que não seja Argon2id nesta coluna (RN-L37).
 * A checagem lá não substitui esta função — ela existe para o caso em que
 * alguém escreva na coluna sem passar por aqui, que é exatamente o caso que
 * acontece em script de correção às pressas.
 */

const PARAMETROS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

export function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha, PARAMETROS)
}

/**
 * Confere a senha.
 *
 * Nunca lança: hash malformado, algoritmo inesperado ou coluna corrompida
 * devolvem `false`. Propagar a exceção transformaria um dado ruim em erro 500,
 * e um 500 no login é um oráculo — distingue "usuário existe com hash
 * estranho" de "usuário não existe", que é justamente o que o fluxo de login
 * inteiro se esforça para não revelar.
 */
export async function conferirSenha(senha: string, hashArmazenado: string | null): Promise<boolean> {
  if (!hashArmazenado) {
    // Sem hash, ainda gastamos o tempo de uma verificação real. Responder na
    // hora entregaria, pelo relógio, quais e-mails existem sem senha definida.
    await gastarTempoEquivalente()
    return false
  }
  try {
    return await verify(hashArmazenado, senha)
  } catch {
    return false
  }
}

/**
 * Trabalho equivalente ao de uma verificação, para o caminho de usuário
 * inexistente.
 *
 * Sem isto, a diferença de tempo entre "e-mail não existe" (resposta imediata)
 * e "e-mail existe, senha errada" (uma verificação Argon2id inteira) enumera a
 * base de usuários com um cronômetro — e nenhuma mensagem neutra na resposta
 * resolve isso.
 */
const HASH_DESCARTAVEL = hash('descartavel-para-nivelar-o-tempo', PARAMETROS)

async function gastarTempoEquivalente(): Promise<void> {
  try {
    await verify(await HASH_DESCARTAVEL, 'senha-que-nunca-confere')
  } catch {
    /* o resultado não interessa; o tempo, sim */
  }
}

/* ------------------------------------------------------ token de recuperação */

/**
 * Token de recuperação: o valor em claro vai no e-mail, só o hash no banco.
 *
 * SHA-256 aqui, e não Argon2id, deliberadamente. O token é gerado por nós com
 * 256 bits de entropia — não tem o que adivinhar, e o custo de Argon2 existe
 * para senhas escolhidas por humanos. O que o hash impede é o mesmo nos dois
 * casos: quem lê o banco não consegue usar o que leu.
 */
export function gerarTokenRecuperacao(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashTokenRecuperacao(token) }
}

export function hashTokenRecuperacao(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Comparação em tempo constante, para o hash do token não vazar por relógio. */
export function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
