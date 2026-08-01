import type { PipeTransform } from '@nestjs/common'
import { ZodError, type ZodTypeAny, type z } from 'zod'
import { ErroDominio } from './erros.js'

/**
 * Validação de entrada pelo esquema compartilhado de `@iarx/contracts`.
 *
 * O ganho não é validar — é validar **com o mesmo esquema que o cliente usa**.
 * Quando a forma diverge, a divergência aparece como erro de compilação no
 * commit, não como 400 inexplicável em produção.
 *
 * O pipe também é a fronteira de coerção: o que passa daqui já está no tipo
 * declarado, então nenhum serviço abaixo precisa desconfiar da entrada.
 */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly esquema: T) {}

  transform(valor: unknown): z.infer<T> {
    const r = this.esquema.safeParse(valor)
    if (r.success) return r.data
    throw erroDeValidacao(r.error)
  }
}

export function validar<T extends ZodTypeAny>(esquema: T): ZodPipe<T> {
  return new ZodPipe(esquema)
}

/**
 * Traduz o erro do Zod para o formato de erro por campo do Anexo D.1.
 *
 * `field` usa notação de caminho (`itens[0].equipamento_id`) para que o
 * formulário consiga destacar exatamente o input errado — mensagem de erro que
 * não diz onde está o problema obriga o operador a caçar campo a campo.
 */
function erroDeValidacao(erro: ZodError): ErroDominio {
  return new ErroDominio('PAYLOAD_INVALIDO', 'Dados inválidos', {
    detail: 'Um ou mais campos não atendem ao contrato desta rota.',
    errors: erro.issues.map((i) => ({
      field: caminho(i.path),
      code: i.code.toUpperCase(),
      message: i.message,
    })),
  })
}

function caminho(partes: readonly (string | number | symbol)[]): string {
  return partes.reduce<string>((acc, p) => {
    if (typeof p === 'number') return `${acc}[${p}]`
    return acc ? `${acc}.${String(p)}` : String(p)
  }, '')
}
