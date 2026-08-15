import { Injectable } from '@nestjs/common'
import type { DefinirLocalizacao, ListarLocais, LocalOperacao } from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { LocaisRepositorio, cursorDe, mapearLocal } from './locais.repositorio.js'

@Injectable()
export class LocaisService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: LocaisRepositorio,
  ) {}

  async listar(filtro: ListarLocais): Promise<Pagina<LocalOperacao>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listar(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearLocal), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorDe(ultimo)) : null,
      })
    })
  }

  /**
   * Define a coordenada do local.
   *
   * O serviço não revalida a faixa geográfica nem a obrigatoriedade da fonte: o
   * banco recusa as duas coisas, por gatilho, e é lá que a regra tem de morar —
   * uma importação em massa ou um job futuro não passam por aqui. O que este
   * método faz é traduzir a recusa em algo acionável, porque `check_violation`
   * cru não diz a ninguém o que corrigir.
   */
  async definirLocalizacao(id: string, dados: DefinirLocalizacao): Promise<LocalOperacao> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Local de operação', id)

      try {
        const atualizado = await this.repo.definirLocalizacao(db, id, dados)
        if (!atualizado) throw naoEncontrado('Local de operação', id)
        return atualizado
      } catch (e) {
        const codigo = (e as { code?: string }).code
        if (codigo !== '23514') throw e

        const mensagem = String((e as { message?: string }).message ?? '')
        if (mensagem.includes('território brasileiro')) {
          throw new ErroDominio('REGRA_DE_NEGOCIO', 'Coordenada fora do território atendido', {
            detail:
              'O ponto informado cai fora do Brasil. O caso mais comum é latitude e longitude trocadas na origem.',
            errors: [{ field: 'lat', code: 'FORA_DA_AREA', message: 'Confira a ordem dos eixos.' }],
            acoes: [
              {
                code: 'CONFERIR_EIXOS',
                descricao: 'Confira se a latitude não foi enviada no lugar da longitude.',
              },
            ],
          })
        }
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'Coordenada sem proveniência', {
          detail: 'Toda coordenada precisa declarar como foi obtida e de onde veio.',
          errors: [{ field: 'precisao', code: 'OBRIGATORIO' }],
        })
      }
    })
  }
}
