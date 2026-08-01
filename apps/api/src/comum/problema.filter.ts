import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common'
import { tipoDoErro, type Problema } from '@iarx/contracts'
import type { Response } from 'express'
import { contextoAtual } from './contexto.js'
import { ErroDominio } from './erros.js'
import { traduzirErroPg } from '../banco/sqlstate.js'

/**
 * Filtro global — toda saída de erro passa por aqui, em `problem+json`
 * (RFC 9457, Anexo D.1).
 *
 * A regra que governa o arquivo: **só sai detalhe de erro que foi escrito para
 * sair.** `ErroDominio` é resposta prevista e o corpo dele é publicável.
 * Qualquer outra exceção vira `ERRO_INTERNO` genérico, porque a mensagem pode
 * conter fragmento de SQL, caminho de arquivo, nome de coluna interna ou —
 * pior — dado de outro tenant que apareceu em um `detail` do PostgreSQL.
 *
 * O `request_id` é o que costura a resposta pobre com o log rico: o cliente
 * cita o identificador, e o suporte encontra o stack completo.
 */
@Catch()
export class ProblemaFilter implements ExceptionFilter {
  private readonly log = new Logger('Erro')

  catch(excecao: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const res = http.getResponse<Response>()
    const ctx = contextoAtual()

    const erro = this.normalizar(excecao)
    const problema: Problema = {
      type: tipoDoErro(erro.code),
      title: erro.message,
      status: erro.status,
      code: erro.code,
      ...(erro.detail ? { detail: erro.detail } : {}),
      ...(ctx ? { instance: ctx.rota, request_id: ctx.requestId } : {}),
      ...(erro.errors?.length ? { errors: erro.errors } : {}),
      ...(erro.acoes?.length ? { acoes_sugeridas: erro.acoes } : {}),
    }

    if (erro.status >= 500) {
      this.log.error(
        `${ctx?.requestId ?? 's/id'} ${ctx?.metodo ?? ''} ${ctx?.rota ?? ''} → ${erro.code}`,
        excecao instanceof Error ? excecao.stack : String(excecao),
      )
    } else {
      this.log.warn(`${ctx?.requestId ?? 's/id'} ${ctx?.metodo ?? ''} ${ctx?.rota ?? ''} → ${erro.code}`)
    }

    res
      .status(erro.status)
      .setHeader('Content-Type', 'application/problem+json')
      .json(problema)
  }

  private normalizar(e: unknown): ErroDominio {
    if (e instanceof ErroDominio) return e

    // Violação que escapou da camada de banco — por exemplo escrita feita fora
    // de `emTransacao`. Traduz do mesmo jeito, para o cliente não ver 500 por
    // uma regra de negócio legítima.
    const doPg = traduzirErroPg(e)
    if (doPg) return doPg

    if (e instanceof HttpException) {
      const status = e.getStatus()
      // 404 do roteador do Nest (rota inexistente) e afins.
      if (status === 404) return new ErroDominio('NAO_ENCONTRADO', 'Rota não encontrada')
      if (status === 400) return new ErroDominio('PAYLOAD_INVALIDO', 'Requisição malformada')
      if (status === 413) return new ErroDominio('PAYLOAD_INVALIDO', 'Corpo da requisição excede o limite')
      if (status === 429) return new ErroDominio('LIMITE_EXCEDIDO', 'Limite de requisições excedido')
      if (status < 500) return new ErroDominio('REGRA_DE_NEGOCIO', e.message, { status })
    }

    return new ErroDominio('ERRO_INTERNO', 'Erro interno', {
      detail: 'A falha foi registrada. Cite o request_id ao acionar o suporte.',
      causa: e,
    })
  }
}
