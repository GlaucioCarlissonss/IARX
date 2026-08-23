import { Injectable } from '@nestjs/common'
import type {
  AplicarDesconto,
  BaixarSemRecebimento,
  CancelarTituloReceber,
  CriarTituloReceber,
  DecidirEmissao,
  EditarTituloReceber,
  ListarTitulosReceber,
  NiveisEmissao,
  PreviaFechamento,
  RegistrarRecebimento,
  ResultadoFechamento,
  TituloReceber,
} from '@iarx/contracts'
import { BancoService, type Executor } from '../../banco/banco.service.js'
import { exigirClaims } from '../../comum/contexto.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { NotificacaoService } from '../notificacao/notificacao.service.js'
import {
  ContasReceberRepositorio,
  cursorTitulo,
  mapearTituloReceber,
} from './contas-receber.repositorio.js'

/**
 * Contas a receber — Módulo 11.
 *
 * As cinco invariantes moram na migração 0020. Este serviço faz o que só existe
 * aqui: orquestrar a transação, enfileirar os avisos no mesmo commit do fato, e
 * traduzir a recusa do gatilho em algo que diga o que corrigir.
 *
 * O **piso de um nível** para o contratual mora nos dois lugares, e não é
 * duplicação por descuido: a função `app.fechar_competencia` o aplica porque é
 * ela que gera; este serviço o aplica no reenvio, porque o reenvio abre uma
 * rodada nova e passaria pelo mesmo buraco. A alçada decide **quantos**
 * conferem, não **se** alguém confere.
 */
@Injectable()
export class ContasReceberService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: ContasReceberRepositorio,
    private readonly notificacao: NotificacaoService,
  ) {}

  async listar(filtro: ListarTitulosReceber): Promise<Pagina<TituloReceber>> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listar(db, filtro, claims.usuario_id)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearTituloReceber), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorTitulo(ultimo)) : null,
      })
    })
  }

  async porId(id: string): Promise<TituloReceber> {
    return this.banco.emTransacao(async (db) => {
      const t = await this.repo.porId(db, id)
      if (!t) throw naoEncontrado('Título a receber', id)
      return t
    })
  }

  /**
   * Prévia da alçada de emissão.
   *
   * `piso_contratual` vai na resposta porque a prévia responde para um **avulso**,
   * onde zero níveis é resultado legítimo. Sem o campo, a tela diria "nenhuma
   * aprovação necessária" e o operador concluiria que a cobrança recorrente
   * também sai sozinha — o que é justamente o contrário do que RN-F10 garante.
   */
  async previaAlcada(valor: string): Promise<NiveisEmissao> {
    return this.banco.emTransacao(async (db) => {
      const { niveis, limites } = await this.repo.niveisExigidos(db, valor)
      return {
        valor: Number(valor).toFixed(4) as NiveisEmissao['valor'],
        niveis,
        limites: limites.map((l) => Number(l).toFixed(4)) as NiveisEmissao['limites'],
        piso_contratual: 1,
      }
    })
  }

  /**
   * Lançamento avulso: título, parcelas, rateio e rodada, num commit.
   *
   * Segue a alçada à risca, inclusive com zero níveis — diferente do contratual.
   * Um avulso já foi digitado por uma pessoa que escolheu o valor; não há
   * cálculo automático a conferir, e exigir aprovação de um valor que ninguém
   * configurou como relevante é cerimônia.
   */
  async criar(dados: CriarTituloReceber): Promise<TituloReceber> {
    return this.banco.emTransacao(async (db) => {
      try {
        const id = await this.repo.criar(db, dados)

        if (dados.parcelas > 1) await this.repo.criarParcelas(db, id, dados)
        await this.repo.gravarRateio(db, id, dados.rateio)

        const { niveis } = await this.repo.niveisExigidos(db, dados.valor_original)
        if (niveis === 0) {
          await this.definirStatusComParcelas(db, id, 'APROVADO')
        } else {
          const rodada = await this.repo.abrirRodada(db, id, niveis)
          await this.definirStatusComParcelas(db, id, 'PENDENTE_APROVACAO')
          await this.avisarAprovadores(db, id, 1, rodada)
        }

        const t = await this.repo.porId(db, id)
        return t!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  async editar(id: string, versao: number, dados: EditarTituloReceber): Promise<TituloReceber> {
    return this.banco.emTransacao(async (db) => {
      try {
        const atual = await this.repo.porId(db, id)
        if (!atual) throw naoEncontrado('Título a receber', id)
        const ok = await this.repo.editar(db, id, versao, dados)
        if (!ok) {
          if (atual.version !== versao) throw this.conflito(atual.version)
          throw new ErroDominio(
            'REGRA_DE_NEGOCIO',
            'Só um título antes da aprovação se edita',
            {
              detail: `O título está em ${atual.status}. Depois da aprovação, o que muda é o desconto.`,
              acoes: [
                { code: 'APLICAR_DESCONTO', descricao: 'Use o desconto para reduzir o que se cobra.' },
              ],
            },
          )
        }
        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  /**
   * Desconto — RN-F12.
   *
   * A alçada é conferida no gatilho, e o serviço só antecipa a leitura do teto
   * para a mensagem poder dizer **qual** é o limite. Conferir aqui e não no
   * banco seria o erro: a checagem sumiria para qualquer caminho que não passe
   * por este método.
   */
  async aplicarDesconto(id: string, versao: number, dados: AplicarDesconto): Promise<TituloReceber> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      try {
        const atual = await this.repo.porId(db, id)
        if (!atual) throw naoEncontrado('Título a receber', id)

        const ok = await this.repo.aplicarDesconto(db, id, versao, dados.desconto, dados.motivo)
        if (!ok) throw this.conflito(atual.version)

        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e, { limite: await this.limiteDoUsuario(claims.usuario_id) })
      }
    })
  }

  private async limiteDoUsuario(usuarioId: string): Promise<number | null> {
    try {
      return await this.banco.emTransacao((db) => this.repo.limiteDesconto(db, usuarioId))
    } catch {
      // A mensagem é melhor com o número, e não pode falhar por causa dele.
      return null
    }
  }

  async decidir(id: string, nivel: number, dados: DecidirEmissao): Promise<TituloReceber> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      try {
        const titulo = await this.repo.porId(db, id)
        if (!titulo) throw naoEncontrado('Título a receber', id)
        if (titulo.status !== 'PENDENTE_APROVACAO') {
          throw new ErroDominio('REGRA_DE_NEGOCIO', 'O título não está em aprovação', {
            detail: `O título está em ${titulo.status}.`,
          })
        }

        const rodada = await this.repo.rodadaAtual(db, id)
        const ok = await this.repo.decidir(
          db,
          id,
          nivel,
          rodada,
          claims.usuario_id,
          dados.decisao,
          dados.justificativa ?? null,
        )
        if (!ok) {
          throw new ErroDominio('REGRA_DE_NEGOCIO', 'Este nível não está pendente', {
            detail: `O nível ${nivel} da rodada ${rodada} não existe ou já foi decidido.`,
            acoes: [{ code: 'RECARREGAR', descricao: 'Recarregue o título e confira a rodada atual.' }],
          })
        }

        if (dados.decisao === 'REJEITADO') {
          // Volta a PENDENTE, não a um estado terminal: a pré-cobrança rejeitada
          // tem destino natural — corrigir e reenviar.
          await this.definirStatusComParcelas(db, id, 'PENDENTE')
        } else if ((await this.repo.pendentesNaRodada(db, id, rodada)) === 0) {
          await this.definirStatusComParcelas(db, id, 'APROVADO')
        } else {
          await this.avisarAprovadores(db, id, nivel + 1, rodada)
        }

        const atualizado = (await this.repo.porId(db, id))!
        await this.avisarDecisao(db, atualizado, dados.decisao === 'APROVADO', dados.justificativa ?? null)
        return atualizado
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  /** Reenvia depois da rejeição: rodada nova, a antiga preservada. */
  async reenviar(id: string): Promise<TituloReceber> {
    return this.banco.emTransacao(async (db) => {
      try {
        const titulo = await this.repo.porId(db, id)
        if (!titulo) throw naoEncontrado('Título a receber', id)
        if (titulo.status !== 'PENDENTE') {
          throw new ErroDominio('REGRA_DE_NEGOCIO', 'Só um título pendente se reenvia', {
            detail: `O título está em ${titulo.status}.`,
          })
        }

        const { niveis } = await this.repo.niveisExigidos(db, titulo.valor_liquido)
        /*
         * Piso de um nível quando o título é contratual, aqui como no
         * fechamento. Sem ele, um contratual rejeitado e reenviado com valor
         * abaixo da menor faixa voltaria APROVADO sem ninguém olhar — e o
         * caminho para burlar RN-F10 seria "rejeite e reenvie".
         */
        const exigidos = titulo.origem === 'CONTRATUAL' ? Math.max(1, niveis) : niveis
        if (exigidos === 0) {
          await this.definirStatusComParcelas(db, id, 'APROVADO')
        } else {
          const rodada = await this.repo.abrirRodada(db, id, exigidos)
          await this.definirStatusComParcelas(db, id, 'PENDENTE_APROVACAO')
          await this.avisarAprovadores(db, id, 1, rodada)
        }
        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  async receber(id: string, dados: RegistrarRecebimento): Promise<TituloReceber> {
    return this.banco.emTransacao(async (db) => {
      try {
        const titulo = await this.repo.porId(db, id)
        if (!titulo) throw naoEncontrado('Título a receber', id)
        await this.repo.receber(db, id, dados)
        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  async estornarRecebimento(id: string, recebimentoId: string, motivo: string): Promise<TituloReceber> {
    return this.banco.emTransacao(async (db) => {
      try {
        const titulo = await this.repo.porId(db, id)
        if (!titulo) throw naoEncontrado('Título a receber', id)
        if (!titulo.recebimentos.some((r) => r.id === recebimentoId)) {
          throw naoEncontrado('Recebimento', recebimentoId)
        }
        await this.repo.estornarRecebimento(db, recebimentoId, motivo)
        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  /**
   * Baixa sem recebimento — RN-F14.
   *
   * Não é sinônimo de "recebido". O título sai da fila de cobrança e **não**
   * entra na receita realizada, porque `app.receita_realizada` soma
   * recebimentos, não títulos encerrados.
   */
  async baixarSemRecebimento(id: string, dados: BaixarSemRecebimento): Promise<TituloReceber> {
    return this.banco.emTransacao(async (db) => {
      try {
        const titulo = await this.repo.porId(db, id)
        if (!titulo) throw naoEncontrado('Título a receber', id)
        await this.repo.baixarSemRecebimento(db, id, dados.motivo)
        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  async cancelar(id: string, dados: CancelarTituloReceber): Promise<TituloReceber> {
    return this.banco.emTransacao(async (db) => {
      try {
        const titulo = await this.repo.porId(db, id)
        if (!titulo) throw naoEncontrado('Título a receber', id)
        if (titulo.status === 'CANCELADO') {
          throw new ErroDominio('REGRA_DE_NEGOCIO', 'Este título já está cancelado', {})
        }
        if (titulo.recebimentos.some((r) => r.estornado_em === null)) {
          throw new ErroDominio('REGRA_DE_NEGOCIO', 'Um título com recebimento não se cancela', {
            detail: 'Cancelar apagaria a cobrança de um valor que já entrou em caixa.',
            acoes: [{ code: 'ESTORNAR_PRIMEIRO', descricao: 'Estorne o recebimento antes de cancelar.' }],
          })
        }

        const parcelas = await this.repo.parcelas(db, id)
        if (parcelas.length > 0 && !dados.cancelar_parcelas_pendentes) {
          throw new ErroDominio('REGRA_DE_NEGOCIO', 'Este título tem parcelas', {
            detail: `${parcelas.length} parcela(s) seriam canceladas em cascata.`,
            acoes: [
              {
                code: 'CONFIRMAR_CASCATA',
                descricao: 'Marque cancelar_parcelas_pendentes para confirmar o cancelamento em cascata.',
              },
            ],
          })
        }

        for (const p of parcelas) {
          const detalhe = await this.repo.porId(db, p.id)
          if (detalhe?.recebimentos.some((r) => r.estornado_em === null)) {
            throw new ErroDominio('REGRA_DE_NEGOCIO', 'Uma das parcelas já foi recebida', {
              detail: 'Parcela com recebimento não se cancela.',
              acoes: [
                { code: 'ESTORNAR_PRIMEIRO', descricao: 'Estorne os recebimentos antes de cancelar.' },
              ],
            })
          }
        }
        for (const p of parcelas) await this.repo.definirStatus(db, p.id, 'CANCELADO')
        await this.repo.definirStatus(db, id, 'CANCELADO')

        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  /* ------------------------------------------- fechamento de competência */

  async previaFechamento(competencia: string): Promise<PreviaFechamento> {
    return this.banco.emTransacao(async (db) => {
      const p = await this.repo.previaFechamento(db, competencia)
      return {
        competencia,
        contratos: p.contratos,
        titulos_a_gerar: p.titulos_a_gerar,
        ja_existentes: p.ja_existentes,
        excecoes: p.excecoes,
        valor_total: p.valor_total as PreviaFechamento['valor_total'],
      }
    })
  }

  /**
   * Fecha a competência: sela o consumo e gera as cobranças.
   *
   * O aviso vai depois da geração e na mesma transação, para os aprovadores
   * receberem uma mensagem por título gerado — e nenhuma se a transação for
   * desfeita. Um "aviso resumo" com a contagem pareceria mais gentil e seria
   * pior: quem aprova precisa do link do título, não do número deles.
   */
  async fecharCompetencia(competencia: string): Promise<ResultadoFechamento> {
    return this.banco.emTransacao(async (db) => {
      try {
        const r = await this.repo.fecharCompetencia(db, competencia)

        if (r.titulos_criados > 0) {
          const pendentes = await this.repo.contratuaisPendentes(db, competencia)
          for (const t of pendentes) {
            await this.avisarAprovadores(db, t.id, 1, 1)
          }
        }

        return { competencia, ...r }
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  /* ------------------------------------------------------- auxiliares */

  /**
   * Muda o status do título e propaga para as parcelas abertas.
   *
   * As quatro transições passam por aqui de propósito. Mudar o pai sem propagar
   * deixa as filhas presas num estado que nenhuma ação alcança — o defeito que
   * o Módulo 10 teve e que o teste de integração pegou lá.
   */
  private async definirStatusComParcelas(db: Executor, id: string, status: string): Promise<void> {
    await this.repo.definirStatus(db, id, status)
    await this.repo.propagarStatusParaParcelas(db, id, status)
  }

  private async avisarAprovadores(
    db: Executor,
    tituloId: string,
    nivel: number,
    rodada: number,
  ): Promise<void> {
    if (nivel > 3) return

    const titulo = await this.repo.porId(db, tituloId)
    if (!titulo) return
    const abertoNesteNivel = titulo.aprovacoes.some(
      (a) => a.rodada === rodada && a.nivel === nivel && a.decisao === null,
    )
    if (!abertoNesteNivel) return

    const claims = exigirClaims()
    const solicitante = await this.repo.usuarioPorId(db, claims.usuario_id)
    const aprovadores = await this.repo.aprovadoresDoNivel(db, nivel, claims.usuario_id)

    for (const a of aprovadores) {
      await this.notificacao.aprovacaoPendente(db, {
        aprovadorId: a.id,
        aprovadorNome: a.nome,
        aprovadorEmail: a.email,
        tituloId,
        descricao: titulo.descricao,
        valor: titulo.valor_liquido,
        vencimento: titulo.data_vencimento,
        nivel,
        solicitante: solicitante?.nome ?? 'operador',
        rota: 'contas-receber',
      })
    }
  }

  private async avisarDecisao(
    db: Executor,
    titulo: TituloReceber,
    aprovado: boolean,
    justificativa: string | null,
  ): Promise<void> {
    const claims = exigirClaims()
    const decisor = await this.repo.usuarioPorId(db, claims.usuario_id)

    const linha = await db.consultarUm<{ created_by: string | null }>(
      `select created_by from public.titulo_receber where id = $1`,
      [titulo.id],
    )
    if (!linha?.created_by) return
    const solicitante = await this.repo.usuarioPorId(db, linha.created_by)
    if (!solicitante) return

    await this.notificacao.decisaoDeAprovacao(db, {
      solicitanteId: solicitante.id,
      solicitanteNome: solicitante.nome,
      solicitanteEmail: solicitante.email,
      tituloId: titulo.id,
      descricao: titulo.descricao,
      valor: titulo.valor_liquido,
      aprovado,
      decididoPor: decisor?.nome ?? 'aprovador',
      justificativa,
      rota: 'contas-receber',
    })
  }

  /* ------------------------------------------------------------ erros */

  private conflito(versaoAtual: number): ErroDominio {
    return new ErroDominio('CONFLITO_DE_VERSAO', 'O título mudou desde a leitura', {
      detail: `A versão atual é ${versaoAtual}. Recarregue e reenvie com ela.`,
      acoes: [{ code: 'RECARREGAR', descricao: 'Recarregue o título e reaplique a alteração.' }],
    })
  }

  /**
   * Traduz a recusa do gatilho em algo acionável.
   *
   * Um `check_violation` cru chega ao operador como 500 e não diz o que
   * corrigir. Cada entrada aqui existe porque a regra correspondente **vai**
   * disparar no uso normal — e quando disparar, a resposta tem de ser uma
   * instrução, não um defeito.
   */
  private traduzir(e: unknown, contexto?: { limite: number | null }): unknown {
    if (e instanceof ErroDominio) return e
    const codigo = (e as { code?: string }).code
    const mensagem = String((e as { message?: string }).message ?? '')
    if (codigo !== '23514' && codigo !== '22023') return e

    const tetoDesconto =
      contexto?.limite !== null && contexto?.limite !== undefined
        ? `O seu teto de desconto é ${contexto.limite}%.`
        : 'Peça a concessão a quem tem alçada de desconto maior.'

    const mapa: { marca: RegExp; titulo: string; campo?: string; acao?: [string, string] }[] = [
      {
        marca: /não aprova a própria cobrança/,
        titulo: 'Quem gerou o título não aprova a própria cobrança',
        campo: 'aprovador_id',
        acao: ['OUTRO_APROVADOR', 'A aprovação tem de vir de outra pessoa — é o que faz o fluxo valer.'],
      },
      {
        marca: /delegação não pode devolver/,
        titulo: 'A delegação não devolve a aprovação a quem gerou',
        campo: 'delegado_de',
      },
      {
        marca: /não tem alçada para decidir/,
        titulo: 'Sem alçada para decidir este nível',
        campo: 'nivel',
        acao: [
          'CONFIGURAR_ALCADA',
          'Configure a alçada EMISSAO_FATURA do perfil, ou registre uma delegação vigente.',
        ],
      },
      {
        marca: /nível\(is\) anterior/,
        titulo: 'A aprovação é sequencial',
        campo: 'nivel',
        acao: ['AGUARDAR_NIVEL_ANTERIOR', 'O nível anterior decide primeiro.'],
      },
      {
        marca: /já foi registrada/,
        titulo: 'Esta decisão já foi registrada',
        acao: ['REENVIAR', 'Reenvie o título para uma nova rodada de aprovação.'],
      },
      {
        marca: /acima da alçada/,
        titulo: 'Desconto acima da sua alçada',
        campo: 'desconto',
        acao: ['APROVAR_DESCONTO', tetoDesconto],
      },
      {
        marca: /abaixo do que já foi recebido/,
        titulo: 'O desconto ficaria abaixo do que já entrou',
        campo: 'desconto',
        acao: ['ESTORNAR_PRIMEIRO', 'Estorne o recebimento antes de reduzir o valor.'],
      },
      {
        marca: /não recebe desconto/,
        titulo: 'O título não está em estado de receber desconto',
        campo: 'desconto',
      },
      {
        marca: /excede o saldo em aberto/,
        titulo: 'O recebimento excede o saldo em aberto',
        campo: 'valor_recebido',
        acao: [
          'AJUSTAR_VALOR',
          'Recebimento a mais não vira crédito do cliente: registre a diferença como título próprio, ou devolva.',
        ],
      },
      {
        marca: /não recebe baixa: receba as parcelas/,
        titulo: 'Título parcelado não recebe baixa',
        campo: 'titulo_id',
        acao: ['RECEBER_PARCELA', 'Receba as parcelas — o pai existe para o relatório.'],
      },
      {
        marca: /não recebe baixa/,
        titulo: 'O título não está em estado de receber baixa',
        campo: 'titulo_id',
        acao: ['APROVAR_EMISSAO', 'A aprovação da cobrança vem antes do dinheiro.'],
      },
      {
        marca: /exige motivo de ao menos/,
        titulo: 'A baixa sem recebimento exige motivo',
        campo: 'motivo',
        acao: [
          'INFORMAR_MOTIVO',
          'É o único registro de por que este valor não entrou — sem ele, some da receita sem explicação.',
        ],
      },
      {
        marca: /Não há saldo em aberto para baixar/,
        titulo: 'Não há saldo em aberto para baixar',
        acao: ['CONFERIR_RECEBIMENTOS', 'O título já está quitado: baixá-lo apagaria o registro da entrada.'],
      },
      {
        marca: /não se baixa sem recebimento/,
        titulo: 'O título não está em estado de baixa',
        campo: 'status',
      },
      {
        marca: /tem de fechar em 100/,
        titulo: 'O rateio tem de somar 100%',
        campo: 'rateio',
        acao: ['AJUSTAR_RATEIO', 'Ajuste os percentuais, ou remova o rateio.'],
      },
      {
        marca: /já foi estornado/,
        titulo: 'Este recebimento já foi estornado',
        acao: ['CONFERIR_EXTRATO', 'Estornar duas vezes tiraria o valor duas vezes do saldo.'],
      },
      {
        marca: /Competência inválida/,
        titulo: 'Competência inválida',
        campo: 'competencia',
        acao: ['USAR_FORMATO', 'Use o formato AAAA-MM.'],
      },
      {
        marca: /número do título .* não se altera/,
        titulo: 'O número do título não se altera',
        campo: 'numero_titulo',
      },
      {
        marca: /desconto_menor_que_valor|desconto_justificado/,
        titulo: 'Desconto inválido',
        campo: 'desconto',
        acao: [
          'CANCELAR_EM_VEZ',
          'Desconto não zera a cobrança nem entra sem motivo — para não cobrar, cancele.',
        ],
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
