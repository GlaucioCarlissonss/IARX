import { Injectable } from '@nestjs/common'
import type {
  CancelarLancamentoFuturo,
  CriarLancamentoFuturo,
  CriarRecorrencia,
  EditarLancamentoFuturo,
  EditarRecorrencia,
  LancamentoFuturo,
  ListarLancamentosFuturos,
  ListarRecorrencias,
  PreviaConversao,
  Recorrencia,
  ResultadoConversao,
} from '@iarx/contracts'
import { possuiPermissao } from '@iarx/contracts'
import { BancoService, type Executor } from '../../banco/banco.service.js'
import { exigirClaims } from '../../comum/contexto.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { NotificacaoService } from '../notificacao/notificacao.service.js'
import {
  LancamentosFuturosRepositorio,
  cursorLf,
  cursorRec,
  mapearLancamento,
  mapearRecorrencia,
} from './lancamentos-futuros.repositorio.js'

/**
 * Lançamentos futuros — Módulo 12.
 *
 * As quatro invariantes moram na migração 0021. Este serviço faz o que só existe
 * aqui: orquestrar a transação, avisar quem precisa decidir sobre o título que a
 * conversão criou (D-23), e traduzir a recusa do gatilho em algo que diga o que
 * corrigir.
 *
 * **Uma distinção que atravessa o módulo inteiro:** conversão recusada por
 * vigência (RN-F16) **não é erro**. Ela devolve 200 com `titulo_id` nulo e a
 * exceção escrita, e o lançamento continua programado na fila. Devolver 4xx faria
 * a tela tratar como falha o comportamento correto — e, pior, faria o worker
 * contar como erro o dia em que um contrato ficou suspenso.
 */
@Injectable()
export class LancamentosFuturosService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: LancamentosFuturosRepositorio,
    private readonly notificacao: NotificacaoService,
  ) {}

  async listar(filtro: ListarLancamentosFuturos): Promise<Pagina<LancamentoFuturo>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listar(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearLancamento), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorLf(ultimo)) : null,
      })
    })
  }

  async porId(id: string): Promise<LancamentoFuturo> {
    return this.banco.emTransacao(async (db) => {
      const l = await this.repo.porId(db, id)
      if (!l) throw naoEncontrado('Lançamento futuro', id)
      return l
    })
  }

  async criar(dados: CriarLancamentoFuturo): Promise<LancamentoFuturo> {
    return this.banco.emTransacao(async (db) => {
      try {
        const id = await this.repo.criar(db, dados)
        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  async editar(id: string, versao: number, dados: EditarLancamentoFuturo): Promise<LancamentoFuturo> {
    return this.banco.emTransacao(async (db) => {
      try {
        const atual = await this.repo.porId(db, id)
        if (!atual) throw naoEncontrado('Lançamento futuro', id)
        const ok = await this.repo.editar(db, id, versao, dados)
        if (!ok) {
          if (atual.version !== versao) throw this.conflito(atual.version)
          /*
           * Zero linhas com a versão certa só sobra um motivo: nada a mudar. O
           * gatilho de RN-F17 recusa com exceção, então um convertido nunca cai
           * aqui — ele cai no `catch`.
           */
          throw new ErroDominio('PAYLOAD_INVALIDO', 'Nenhum campo para alterar', {
            detail: 'Envie ao menos um campo diferente do atual.',
          })
        }
        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  async cancelar(id: string, dados: CancelarLancamentoFuturo): Promise<LancamentoFuturo> {
    return this.banco.emTransacao(async (db) => {
      try {
        const atual = await this.repo.porId(db, id)
        if (!atual) throw naoEncontrado('Lançamento futuro', id)
        await this.repo.cancelar(db, id, dados.motivo)
        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  /**
   * Prévia da conversão: o que vai ser criado, antes de criar.
   *
   * Leitura pura — não chama a conversão. Chamá-la para "simular" incrementaria o
   * contador de tentativas e gravaria a exceção, fazendo uma prévia ter efeito
   * colateral: o operador que abre o diálogo e desiste deixaria rastro de uma
   * tentativa que nunca houve.
   */
  async previaConversao(id: string): Promise<PreviaConversao> {
    return this.banco.emTransacao(async (db) => {
      const lf = await this.repo.porId(db, id)
      if (!lf) throw naoEncontrado('Lançamento futuro', id)

      const [impedimento, niveis] = await Promise.all([
        this.repo.impedimento(db, id),
        this.repo.niveisPrevistos(db, lf.lado, lf.valor_previsto),
      ])

      /*
       * A próxima data da série vem da recorrência, não de um cálculo local: é
       * `app.avancar_periodicidade` quem sabe somar meses, e repetir a soma aqui
       * daria duas respostas para "quando cai o próximo".
       */
      let proxima: string | null = null
      if (lf.recorrencia_id) {
        const r = await this.repo.recorrenciaPorId(db, lf.recorrencia_id)
        proxima = r?.ativo ? r.proxima_geracao : null
      }

      return {
        lancamento_id: lf.id,
        lado: lf.lado,
        descricao: lf.descricao,
        valor_previsto: lf.valor_previsto,
        data_vencimento: lf.data_prevista,
        niveis_aprovacao: niveis,
        impedimento,
        proxima_data_prevista: proxima,
      }
    })
  }

  /**
   * Converter — a rota manual do mesmo caminho que o worker usa.
   *
   * Chama `app.converter_lancamento_futuro`, e nada além disso: RN-F15, F16 e F18
   * vivem lá. Uma segunda implementação aqui daria duas conversões possíveis, e a
   * divergência apareceria como um título que a tela cria e o job não criaria.
   */
  async converter(id: string): Promise<ResultadoConversao> {
    return this.banco.emTransacao(async (db) => {
      try {
        const antes = await this.repo.porId(db, id)
        if (!antes) throw naoEncontrado('Lançamento futuro', id)

        this.exigirPermissaoDoLado(antes.lado)

        const r = await this.repo.converter(db, id)

        // RN-F16: recusa com motivo não é erro. O lançamento fica na fila.
        if (r.titulo_id === null) {
          return {
            lancamento_id: id,
            lado: r.lado,
            titulo_id: null,
            excecao: r.excecao,
            proximo_lancamento_id: null,
          }
        }

        const proximo = antes.recorrencia_id
          ? await this.repo.proximoDaSerie(db, antes.recorrencia_id, antes.data_prevista)
          : null

        await this.avisarConversao(db, r.lado, r.titulo_id)

        return {
          lancamento_id: id,
          lado: r.lado,
          titulo_id: r.titulo_id,
          excecao: null,
          proximo_lancamento_id: proximo,
        }
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  /* ------------------------------------------------------- recorrências */

  async listarRecorrencias(filtro: ListarRecorrencias): Promise<Pagina<Recorrencia>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarRecorrencias(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearRecorrencia), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorRec(ultimo)) : null,
      })
    })
  }

  async criarRecorrencia(dados: CriarRecorrencia): Promise<Recorrencia> {
    return this.banco.emTransacao(async (db) => {
      try {
        const id = await this.repo.criarRecorrencia(db, dados)
        return (await this.repo.recorrenciaPorId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  async editarRecorrencia(id: string, versao: number, dados: EditarRecorrencia): Promise<Recorrencia> {
    return this.banco.emTransacao(async (db) => {
      try {
        const atual = await this.repo.recorrenciaPorId(db, id)
        if (!atual) throw naoEncontrado('Recorrência', id)
        const ok = await this.repo.editarRecorrencia(db, id, versao, dados)
        if (!ok) {
          if (atual.version !== versao) throw this.conflito(atual.version)
          throw new ErroDominio('PAYLOAD_INVALIDO', 'Nenhum campo para alterar', {
            detail: 'Envie ao menos um campo diferente do atual.',
          })
        }
        return (await this.repo.recorrenciaPorId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  /**
   * Gerar o próximo da série sob demanda.
   *
   * Existe para o caso em que a série ficou atrás — a recorrência foi criada com
   * data retroativa, ou o job passou dias parado. Não gera o lote: chamá-la duas
   * vezes gera dois períodos, um por chamada, e é a chave `(recorrência, data)`
   * que impede a mesma data de nascer duas vezes.
   */
  async gerarProximo(recorrenciaId: string): Promise<{ recorrencia: Recorrencia; lancamento_id: string | null }> {
    return this.banco.emTransacao(async (db) => {
      try {
        const atual = await this.repo.recorrenciaPorId(db, recorrenciaId)
        if (!atual) throw naoEncontrado('Recorrência', recorrenciaId)
        const id = await this.repo.gerarProximo(db, recorrenciaId)
        return {
          recorrencia: (await this.repo.recorrenciaPorId(db, recorrenciaId))!,
          lancamento_id: id,
        }
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  /**
   * D-23, resolvida como **sim**: a conversão avisa.
   *
   * Geração automática de título sem aviso é o tipo de silêncio que só aparece no
   * fechamento do mês — o compromisso entrou em aprovação e ninguém soube. O
   * aviso vai para quem pode decidir o nível 1, na rota do lado certo, porque um
   * aviso de cobrança que abre a tela de contas a pagar leva o aprovador a um
   * lugar onde o título não existe.
   *
   * Um título que nasceu já aprovado (alçada zero) não gera aviso: não há decisão
   * pendente, e avisar sobre o que não precisa de ação treina a pessoa a ignorar
   * a caixa.
   */
  private async avisarConversao(db: Executor, lado: string, tituloId: string): Promise<void> {
    const pagar = lado === 'PAGAR'
    const titulo = await db.consultarUm<{
      descricao: string
      valor: string
      vencimento: Date
      status: string
    }>(
      pagar
        ? `select descricao, valor_original as valor, data_vencimento as vencimento, status
             from public.titulo_pagar where id = $1`
        : `select descricao, valor_liquido as valor, data_vencimento as vencimento, status
             from public.titulo_receber where id = $1`,
      [tituloId],
    )
    if (!titulo) return

    const pendente = await db.consultarUm<{ nivel: number }>(
      pagar
        ? `select min(nivel) as nivel from public.titulo_pagar_aprovacao
            where titulo_id = $1 and decisao is null`
        : `select min(nivel) as nivel from public.titulo_receber_aprovacao
            where titulo_id = $1 and decisao is null`,
      [tituloId],
    )
    const nivel = pendente?.nivel === null || pendente?.nivel === undefined ? null : Number(pendente.nivel)
    if (nivel === null) return

    /*
     * Sem `excluirUsuarioId`: quem "gerou" foi o relógio, e no caminho manual é
     * o gatilho de segregação que barra a mesma pessoa aprovando o que criou. Não
     * avisar quem criou faria o operador que converte à mão nunca ver a
     * pendência — e ele pode ser a única pessoa com alçada.
     */
    const aprovadores = await db.consultar<{ id: string; nome: string; email: string }>(
      `select distinct u.id, u.nome, u.email
         from public.usuario u
        where u.status = 'ATIVO'
          and ${pagar ? 'app.pode_decidir_nivel_pagar' : 'app.pode_decidir_nivel_receber'}(u.id, $1)
        order by u.nome`,
      [nivel],
    )

    for (const a of aprovadores) {
      await this.notificacao.aprovacaoPendente(db, {
        aprovadorId: a.id,
        aprovadorNome: a.nome,
        aprovadorEmail: a.email,
        tituloId,
        descricao: titulo.descricao,
        valor: Number(titulo.valor).toFixed(4),
        vencimento: titulo.vencimento.toISOString().slice(0, 10),
        nivel,
        solicitante: 'conversão automática de lançamento futuro',
        rota: pagar ? 'contas-pagar' : 'contas-receber',
      })
    }
  }

  /**
   * A permissão do lado, que o decorador não consegue expressar.
   *
   * A rota é uma e serve os dois lados; `@ExigePermissao` é estático. Sem esta
   * checagem, quem tem `pagar:criar` converteria um lançamento de
   * receita e **emitiria uma cobrança** — exatamente a autoridade que a separação
   * entre as duas permissões existe para manter apartada.
   *
   * Fica no serviço, não no controlador, porque é aqui que o lado é conhecido: o
   * lado vem da linha, e a linha só existe depois da leitura.
   */
  private exigirPermissaoDoLado(lado: 'PAGAR' | 'RECEBER'): void {
    const exigida = lado === 'PAGAR' ? 'pagar:criar' : 'receber:criar'
    const claims = exigirClaims()
    if (!possuiPermissao(claims.permissoes, exigida)) {
      throw new ErroDominio('SEM_PERMISSAO', 'Permissão insuficiente', {
        detail: `Converter um lançamento do lado ${lado} exige a permissão ${exigida}.`,
        errors: [{ field: 'permissoes', code: 'PERMISSAO_AUSENTE', meta: { exigida } }],
      })
    }
  }

  private conflito(versaoAtual: number): ErroDominio {
    return new ErroDominio('CONFLITO_DE_VERSAO', 'O registro mudou desde a leitura', {
      detail: `A versão atual é ${versaoAtual}. Recarregue e reenvie com ela.`,
      acoes: [{ code: 'RECARREGAR', descricao: 'Recarregue o registro e reaplique a alteração.' }],
    })
  }

  /**
   * Traduz a recusa do gatilho em algo acionável.
   *
   * Cada entrada existe porque a regra correspondente **vai** disparar no uso
   * normal: um convertido que alguém tenta editar, um cancelado que alguém tenta
   * reativar, uma recorrência com o lado trocado. Um `check_violation` cru chega
   * como 500 e não diz o que corrigir.
   */
  private traduzir(e: unknown): unknown {
    if (e instanceof ErroDominio) return e
    const codigo = (e as { code?: string }).code
    const mensagem = String((e as { message?: string }).message ?? '')
    if (codigo !== '23514' && codigo !== '23505' && codigo !== '22023' && codigo !== '02000') return e

    const mapa: { marca: RegExp; titulo: string; campo?: string; acao?: [string, string] }[] = [
      {
        marca: /não se edita/,
        titulo: 'Um lançamento já convertido não se edita',
        campo: 'status',
        acao: [
          'EDITAR_TITULO',
          'Convertido é registro histórico: edite o título gerado, que é onde a despesa vive.',
        ],
      },
      {
        marca: /não se cancela/,
        titulo: 'Um lançamento já convertido não se cancela',
        campo: 'status',
        acao: [
          'CANCELAR_TITULO',
          'Cancele o título gerado — cancelar a previsão deixaria o título órfão da intenção.',
        ],
      },
      {
        marca: /não muda de estado/,
        titulo: 'O estado não volta atrás',
        campo: 'status',
        acao: [
          'CRIAR_NOVO',
          'Convertido e cancelado são finais: crie um lançamento novo em vez de reabrir este.',
        ],
      },
      {
        marca: /vínculo com o título gerado/,
        titulo: 'O vínculo com o título gerado não se altera',
        campo: 'titulo_pagar_id',
      },
      {
        marca: /não se converte/,
        titulo: 'A conversão ocorre uma vez só',
        campo: 'status',
        acao: ['ABRIR_TITULO', 'O título já existe — abra-o em vez de converter de novo.'],
      },
      {
        marca: /lf_lado_coerente|lf_pagar_coerente|lf_receber_coerente/,
        titulo: 'O lado do lançamento não combina com os campos enviados',
        campo: 'tipo',
        acao: [
          'CONFERIR_LADO',
          'Despesa e provisão exigem empresa e classificação; receita exige cliente.',
        ],
      },
      {
        marca: /recorrencia_pagar_coerente|recorrencia_receber_coerente/,
        titulo: 'O lado da recorrência não combina com os campos enviados',
        campo: 'lado',
        acao: [
          'CONFERIR_LADO',
          'Uma série a pagar tem empresa e classificação; a receber, cliente.',
        ],
      },
      {
        marca: /recorrencia_dia_faixa/,
        titulo: 'O dia do vencimento vai de 1 a 28',
        campo: 'dia_vencimento',
        acao: [
          'ESCOLHER_ATE_28',
          '29, 30 e 31 não existem em todo mês, e o que fazer em fevereiro não está definido.',
        ],
      },
      {
        marca: /recorrencia_periodicidade_valida/,
        titulo: 'Periodicidade inválida',
        campo: 'periodicidade',
      },
      {
        marca: /lf_recorrencia_data_uk/,
        titulo: 'A série já tem um lançamento nesta data',
        campo: 'data_prevista',
        acao: [
          'CONFERIR_SERIE',
          'Cada período nasce uma vez: confira a próxima geração da recorrência.',
        ],
      },
      {
        marca: /lf_valor_positivo|recorrencia_valor_positivo/,
        titulo: 'O valor tem de ser positivo',
        campo: 'valor_previsto',
      },
      {
        marca: /Recorrência não encontrada/,
        titulo: 'Recorrência não encontrada',
      },
      {
        marca: /Lançamento futuro não encontrado/,
        titulo: 'Lançamento futuro não encontrado',
      },
    ]

    for (const m of mapa) {
      if (m.marca.test(mensagem)) {
        return new ErroDominio('REGRA_DE_NEGOCIO', m.titulo, {
          detail: mensagem,
          errors: m.campo ? [{ field: m.campo, code: 'REGRA' }] : undefined,
          acoes: m.acao ? [{ code: m.acao[0], descricao: m.acao[1] }] : undefined,
        })
      }
    }
    return e
  }
}
