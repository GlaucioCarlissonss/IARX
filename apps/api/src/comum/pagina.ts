/**
 * Resultado paginado.
 *
 * Existe como classe, e não como objeto literal, para que o interceptor de
 * envelope distinga "coleção com meta" de "recurso único" por tipo em vez de
 * adivinhar pela forma. Heurística de forma (`tem campo data?`) quebra no dia
 * em que uma entidade de domínio legitimamente tiver um campo com esse nome.
 */
export class Pagina<T> {
  constructor(
    readonly itens: T[],
    readonly meta: { limit: number; next_cursor: string | null; total_aproximado?: number },
  ) {}
}

/**
 * Cursor opaco.
 *
 * Base64 de `criado_em|id`, o par que ordena de forma total e estável. Opaco
 * de propósito: se o cliente puder ler e construir o cursor, ele vira parte do
 * contrato público e o formato não pode mais mudar. `keyset` em vez de OFFSET
 * porque OFFSET faz o banco varrer e descartar as linhas puladas, e a página
 * escorrega quando alguém insere durante a navegação.
 */
export interface Cursor {
  criadoEm: string
  id: string
}

export function codificarCursor(c: Cursor): string {
  return Buffer.from(`${c.criadoEm}|${c.id}`, 'utf8').toString('base64url')
}

export function decodificarCursor(bruto: string | undefined): Cursor | null {
  if (!bruto) return null
  try {
    const [criadoEm, id] = Buffer.from(bruto, 'base64url').toString('utf8').split('|')
    if (!criadoEm || !id) return null
    // Cursor malformado é tratado como ausente pelo chamador, nunca como erro
    // 500: ele pode vir de um link antigo colado por um usuário.
    return { criadoEm, id }
  } catch {
    return null
  }
}
