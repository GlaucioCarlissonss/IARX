import { Injectable } from '@nestjs/common'
import type {
  CategoriaDespesa,
  ConsultarIndicadores,
  CopiarOrcamento,
  CriarCategoriaDespesa,
  CriarOrcamento,
  CriarReplanejamento,
  Dinheiro,
  EditarCategoriaDespesa,
  EditarOrcamento,
  IndicadoresDespesa,
  ListarCategoriasDespesa,
  ListarOrcamentos,
  Orcamento,
  ResultadoCopia,
} from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { exigirClaims } from '../../comum/contexto.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import {
  DespesasRepositorio,
  cursorCategoria,
  cursorOrcamento,
  mapearCategoria,
  mapearOrcamento,
} from './despesas.repositorio.js'

/** Primeiro e último dia do período. Mês ausente = o ano inteiro. */
function janela(ano: number, mes?: number): { de: string; ate: string } {
  if (mes === undefined) return { de: `${ano}-01-01`, ate: `${ano}-12-31` }
  const dois = String(mes).padStart(2, '0')
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return { de: `${ano}-${dois}-01`, ate: `${ano}-${dois}-${String(ultimo).padStart(2, '0')}` }
}

/** O período imediatamente anterior, na mesma granularidade. */
function anterior(ano: number, mes?: number): { de: string; ate: string } {
  if (mes === undefined) return janela(ano - 1)
  return mes === 1 ? janela(ano - 1, 12) : janela(ano, mes - 1)
}

const cent = (n: number) => (Math.round(n * 10_000) / 10_000).toFixed(4) as Dinheiro

/**
 * Controle de despesas.
 *
 * O serviço **não calcula execução**: ela sai de `app.execucao_orcamentaria`. O
 * que ele faz é traduzir as recusas dos gatilhos em algo acionável —
 * `check_violation` cru diz o nome da restrição, e quem está cadastrando precisa
 * saber o que corrigir.
 */
@Injectable()
export class DespesasService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: DespesasRepositorio,
  ) {}

  /* ---------------------------------------------------------- categorias */

  async listarCategorias(filtro: ListarCategoriasDespesa): Promise<Pagina<CategoriaDespesa>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarCategorias(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearCategoria), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorCategoria(ultimo)) : null,
      })
    })
  }

  async criarCategoria(dados: CriarCategoriaDespesa): Promise<CategoriaDespesa> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      let id: string
      try {
        id = await this.repo.criarCategoria(db, claims.tenant_id, dados)
      } catch (e) {
        throw this.traduzirCategoria(e, dados.nome)
      }
      const criada = await this.repo.categoriaPorId(db, id)
      return mapearCategoria(criada as NonNullable<typeof criada>)
    })
  }

  /**
   * Edita nome, classificação sugerida e situação.
   *
   * A residual não é editável quanto ao que a torna residual, e nem é
   * inativável: ela é o destino do gatilho de `titulo_pagar`. Inativada, o
   * gatilho continuaria a encontrando — a consulta dele não filtra por `ativo` —,
   * mas a tela deixaria de oferecê-la, e o operador veria títulos caindo numa
   * categoria que ele acredita ter desligado.
   */
  async editarCategoria(
    id: string,
    versao: number,
    dados: EditarCategoriaDespesa,
  ): Promise<CategoriaDespesa> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.categoriaPorId(db, id)
      if (!atual) throw naoEncontrado('Categoria de despesa', id)

      if (atual.residual && dados.ativo === false) {
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'A categoria residual não pode ser inativada', {
          detail:
            'Ela é o destino de todo título que chega sem categoria. Inativá-la esconderia da tela uma categoria que continuaria recebendo lançamentos.',
        })
      }

      let ok: boolean
      try {
        ok = await this.repo.editarCategoria(db, id, versao, dados)
      } catch (e) {
        throw this.traduzirCategoria(e, dados.nome ?? atual.nome)
      }
      if (!ok) {
        throw new ErroDominio('CONFLITO_DE_VERSAO', 'A categoria mudou desde que você a abriu', {
          detail: `A versão em disco é ${atual.version}. Recarregue e reaplique a alteração.`,
        })
      }
      const nova = await this.repo.categoriaPorId(db, id)
      return mapearCategoria(nova as NonNullable<typeof nova>)
    })
  }

  /* ----------------------------------------------------------- orçamentos */

  async listarOrcamentos(filtro: ListarOrcamentos): Promise<Pagina<Orcamento>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarOrcamentos(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearOrcamento), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorOrcamento(ultimo)) : null,
      })
    })
  }

  async criarOrcamento(dados: CriarOrcamento): Promise<Orcamento> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      let id: string
      try {
        id = await this.repo.criarOrcamento(db, claims.tenant_id, dados)
      } catch (e) {
        throw this.traduzirOrcamento(e)
      }
      const criado = await this.repo.orcamentoPorId(db, id)
      return mapearOrcamento(criado as NonNullable<typeof criado>)
    })
  }

  async editarOrcamento(id: string, versao: number, dados: EditarOrcamento): Promise<Orcamento> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.orcamentoPorId(db, id)
      if (!atual) throw naoEncontrado('Orçamento', id)

      const ok = await this.repo.editarOrcamento(db, id, versao, dados)
      if (!ok) {
        throw new ErroDominio('CONFLITO_DE_VERSAO', 'O orçamento mudou desde que você o abriu', {
          detail: `A versão em disco é ${atual.version}. Um replanejamento também muda a versão — recarregue e confira o valor antes de reaplicar.`,
        })
      }
      const novo = await this.repo.orcamentoPorId(db, id)
      return mapearOrcamento(novo as NonNullable<typeof novo>)
    })
  }

  /**
   * Copia o orçamento de um ano para outro.
   *
   * Ação explícita, nunca herança automática: um orçamento que se propaga sozinho
   * vira número que ninguém decidiu, e no ano seguinte já não há quem lembre de
   * onde veio.
   */
  async copiarOrcamento(dados: CopiarOrcamento): Promise<ResultadoCopia> {
    const claims = exigirClaims()
    if (dados.de_ano === dados.para_ano) {
      throw new ErroDominio('PAYLOAD_INVALIDO', 'Origem e destino são o mesmo ano', {
        errors: [{ field: 'para_ano', code: 'IGUAL_A_ORIGEM' }],
      })
    }
    return this.banco.emTransacao(
      async (db) => {
        const { criados, candidatos } = await this.repo.copiarOrcamento(
          db,
          claims.tenant_id,
          dados.de_ano,
          dados.para_ano,
          dados.fator,
        )
        if (candidatos === 0) {
          throw new ErroDominio('REGRA_DE_NEGOCIO', `Não há orçamento em ${dados.de_ano} para copiar`, {
            detail: 'Escolha um ano que já tenha linhas orçadas.',
          })
        }
        // Ignorado é o que já existia no destino: copiar não sobrescreve decisão
        // de quem já orçou aquela linha.
        return { criados, ignorados: candidatos - criados }
      },
      { motivo: `Cópia do orçamento de ${dados.de_ano} para ${dados.para_ano}, fator ${dados.fator}` },
    )
  }

  /**
   * Replanejamento.
   *
   * O movimento e o limite são do gatilho `replanejamento_aplica` — as duas
   * atualizações na mesma transação, e a recusa acima do saldo não comprometido.
   * Uma rota que fizesse metade disso criaria verba do nada, e o erro só
   * apareceria no fechamento.
   */
  async replanejar(dados: CriarReplanejamento): Promise<{ id: string }> {
    const claims = exigirClaims()
    return this.banco.emTransacao(
      async (db) => {
        try {
          return { id: await this.repo.replanejar(db, claims.tenant_id, dados) }
        } catch (e) {
          throw this.traduzirReplanejamento(e)
        }
      },
      { motivo: dados.motivo },
    )
  }

  /* ------------------------------------------------------- indicadores */

  async indicadores(filtro: ConsultarIndicadores): Promise<IndicadoresDespesa> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const atual = janela(filtro.ano, filtro.mes)
      const passado = anterior(filtro.ano, filtro.mes)

      const execucao = await this.repo.execucao(
        db,
        filtro.ano,
        filtro.mes,
        filtro.centro_custo_id,
        filtro.filial_id,
      )
      const a = await this.repo.agregados(
        db,
        claims.tenant_id,
        atual.de,
        atual.ate,
        passado.de,
        passado.ate,
        filtro.filial_id,
      )

      const total = Number(a.despesa_total)
      const anteriorTotal = Number(a.despesa_mes_anterior)
      const orcado = execucao.reduce((s, l) => s + Number(l.valor_orcado), 0)
      const clientes = Number(a.clientes_ativos)
      const equipamentos = Number(a.equipamentos_locados)

      return {
        periodo: { ano: filtro.ano, mes: filtro.mes ?? null },
        despesa_total: cent(total),
        despesa_mes_anterior: cent(anteriorTotal),
        /*
         * Nulo, e não zero, quando o período anterior não teve despesa.
         *
         * Variação sobre zero é indefinida, e devolver 0% diria "não variou" —
         * exatamente o contrário do que aconteceu quando a despesa saiu de nada
         * para alguma coisa.
         */
        variacao_mes_anterior: anteriorTotal === 0 ? null : (total - anteriorTotal) / anteriorTotal,
        total_orcado: cent(orcado),
        execucao_percentual: orcado === 0 ? null : total / orcado,
        proporcao_investimento: total === 0 ? 0 : Number(a.investimento) / total,
        indice_recorrente: total === 0 ? 0 : Number(a.recorrente) / total,
        clientes_ativos: clientes,
        equipamentos_locados: equipamentos,
        // D-26, os dois lado a lado. Nulo sem denominador: dividir por zero
        // cliente não é custo zero, é pergunta sem resposta.
        custo_por_cliente_ativo: clientes === 0 ? null : cent(total / clientes),
        custo_por_equipamento_locado: equipamentos === 0 ? null : cent(total / equipamentos),
        execucao,
      }
    })
  }

  /* ------------------------------------------------------------ traduções */

  private traduzirCategoria(e: unknown, nome: string): unknown {
    const codigo = (e as { code?: string }).code
    const mensagem = String((e as { message?: string }).message ?? '')

    if (codigo === '23505') {
      return new ErroDominio('RECURSO_DUPLICADO', 'Já existe uma categoria com este nome', {
        errors: [{ field: 'nome', code: 'DUPLICADO', message: nome }],
      })
    }
    if (codigo === '23514' && mensagem.includes('nível')) {
      return new ErroDominio('REGRA_DE_NEGOCIO', 'A árvore de categorias vai até dois níveis', {
        detail: `${mensagem} Categoria e subcategoria bastam; abaixo disso vira catálogo de fornecedor.`,
        errors: [{ field: 'categoria_pai_id', code: 'PROFUNDIDADE' }],
      })
    }
    if (codigo === '23514' && mensagem.includes('descender')) {
      return new ErroDominio('REGRA_DE_NEGOCIO', 'A categoria não pode descender de si mesma', {
        detail: mensagem,
        errors: [{ field: 'categoria_pai_id', code: 'CICLO' }],
      })
    }
    if (codigo === '23503') {
      return naoEncontrado('Categoria de despesa')
    }
    return e
  }

  private traduzirOrcamento(e: unknown): unknown {
    const codigo = (e as { code?: string }).code
    if (codigo === '23505') {
      /*
       * `orcamento_dimensao_uk`, com `NULLS NOT DISTINCT`. A mensagem precisa
       * dizer que a dimensão já tem linha — e não que "o valor é duplicado" —,
       * porque a colisão acontece justamente entre duas linhas "geral" que a
       * pessoa não considerou iguais.
       */
      return new ErroDominio('RECURSO_DUPLICADO', 'Já existe orçamento para esta dimensão', {
        detail:
          'A combinação de ano, mês, categoria, centro de custo e filial já tem uma linha — inclusive quando algum deles está vazio, porque "geral" é um recorte, não a ausência de um.',
        acoes: [{ code: 'EDITAR_EXISTENTE', descricao: 'Edite o valor da linha que já existe.' }],
      })
    }
    if (codigo === '23503') {
      return new ErroDominio('PAYLOAD_INVALIDO', 'Categoria, centro de custo ou filial inexistente', {
        detail: 'Um dos identificadores informados não existe neste locatário.',
      })
    }
    return e
  }

  private traduzirReplanejamento(e: unknown): unknown {
    const codigo = (e as { code?: string }).code
    const mensagem = String((e as { message?: string }).message ?? '')

    if (codigo === '23514' && mensagem.includes('não comprometido')) {
      return new ErroDominio('REGRA_DE_NEGOCIO', 'A origem não tem esse saldo livre', {
        detail: `${mensagem} Comprometido é o gasto mais o aprovado e ainda não pago: essa verba já tem destino.`,
        errors: [{ field: 'valor_transferido', code: 'ACIMA_DO_DISPONIVEL' }],
      })
    }
    if (codigo === '23514' && mensagem.includes('altera')) {
      return new ErroDominio('REGRA_DE_NEGOCIO', 'Replanejamento não se altera nem se apaga', {
        detail: mensagem,
      })
    }
    if (codigo === '23503' || mensagem.includes('inexistente')) {
      return naoEncontrado('Orçamento')
    }
    return e
  }
}
