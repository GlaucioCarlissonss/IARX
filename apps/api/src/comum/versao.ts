import { ErroDominio } from './erros.js'

/**
 * Concorrência otimista por `If-Match` (Anexo D.1).
 *
 * Exigido, não opcional: sem ele, dois operadores que abriram a mesma tela
 * gravam por cima um do outro e o último a clicar vence em silêncio. O ETag é a
 * versão da linha, e o cabeçalho aceita tanto `"3"` quanto `3`.
 *
 * Vive aqui, e não no controlador que precisou dela primeiro, porque o segundo
 * controlador que precisa é o momento em que uma função local vira duas cópias
 * — e duas cópias de uma regra de protocolo divergem na primeira correção que
 * só uma delas recebe.
 */
export function versaoDe(ifMatch: string | undefined): number {
  const bruto = ifMatch?.trim().replace(/^W\//, '').replace(/"/g, '')
  const n = bruto ? Number(bruto) : Number.NaN
  if (!Number.isInteger(n) || n < 1) {
    throw new ErroDominio('PAYLOAD_INVALIDO', 'Cabeçalho If-Match obrigatório', {
      detail: 'Envie If-Match com a versão do registro lida antes da alteração, ex.: If-Match: "3".',
      errors: [{ field: 'If-Match', code: 'VERSAO_AUSENTE' }],
    })
  }
  return n
}
