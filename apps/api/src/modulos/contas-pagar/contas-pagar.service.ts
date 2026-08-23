import { Injectable } from '@nestjs/common'
import type {
  AjustarValorTituloPagar,
  CancelarTituloPagar,
  CriarDelegacao,
  CriarTituloPagar,
  DecidirAprovacao,
  Delegacao,
  EditarTituloPagar,
  ListarDelegacoes,
  ListarTitulosPagar,
  NiveisExigidos,
  RegistrarPagamento,
  TituloPagar,
} from '@iarx/contracts'
import { BancoService, type Executor } from '../../banco/banco.service.js'
import { exigirClaims } from '../../comum/contexto.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { NotificacaoService } from '../notificacao/notificacao.service.js'
import {
  ContasPagarRepositorio,
  cursorTitulo,
  mapearTitulo,
} from './contas-pagar.repositorio.js'

/**
 * Contas a pagar.
 *
 * As nove invariantes moram na migração 0019 — este serviço não as duplica. O
 * que ele faz é três coisas que só existem aqui:
 *
 *  1. **orquestrar a transação**: criar o título, as parcelas, o rateio e abrir
 *     a rodada de aprovação num commit só;
 *  2. **enfileirar os avisos** na mesma transação do fato, para que um rollback
 *     não deixe um e-mail avisando de algo que não aconteceu;
 *  3. **traduzir a recusa do gatilho** em algo acionável — `check_violation`
 *     cru não diz a ninguém o que corrigir.
 */
@Injectable()
export class ContasPagarService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: ContasPagarRepositorio,
    private readonly notificacao: NotificacaoService,
  ) {}

  async listar(filtro: ListarTitulosPagar): Promise<Pagina<TituloPagar>> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listar(db, filtro, claims.usuario_id)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas.map(mapearTitulo), {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorTitulo(ultimo)) : null,
      })
    })
  }

  async porId(id: string): Promise<TituloPagar> {
    return this.banco.emTransacao(async (db) => {
      const t = await this.repo.porId(db, id)
      if (!t) throw naoEncontrado('Título a pagar', id)
      return t
    })
  }

  /**
   * Prévia da alçada: quantos níveis um valor vai exigir, **antes** de salvar.
   *
   * Existe para remover uma surpresa concreta: o operador lança uma despesa,
   * confirma, e só então descobre que aquele valor vai para a diretoria e vai
   * demorar três dias. Com a prévia, ele decide sabendo.
   */
  async previaAlcada(valor: string): Promise<NiveisExigidos> {
    return this.banco.emTransacao(async (db) => {
      const { niveis, limites } = await this.repo.niveisExigidos(db, valor)
      return {
        valor: Number(valor).toFixed(4) as NiveisExigidos['valor'],
        niveis,
        limites: limites.map((l) => Number(l).toFixed(4)) as NiveisExigidos['limites'],
      }
    })
  }

  /**
   * Criar: título, parcelas, rateio e rodada de aprovação, num commit.
   *
   * A rodada abre **na criação**, e não num "enviar para aprovação" separado.
   * A razão é que o número de níveis é função do valor, e o valor já é
   * conhecido: um passo intermediário só adiaria a mesma conta e criaria um
   * estado (criado mas não enviado) em que o título existe e ninguém sabe que
   * precisa olhá-lo.
   */
  async criar(dados: CriarTituloPagar): Promise<TituloPagar> {
    return this.banco.emTransacao(async (db) => {
      try {
        const id = await this.repo.criar(db, dados)

        if (dados.parcelas > 1) {
          await this.repo.criarParcelas(db, id, dados)
        }
        await this.repo.gravarRateio(db, id, dados.rateio)

        const { niveis } = await this.repo.niveisExigidos(db, dados.valor_original)
        /*
         * A aprovação é do **pai**, e as parcelas a herdam.
         *
         * É o pai que representa o compromisso inteiro, e é o valor dele que a
         * alçada avalia — aprovar parcela por parcela permitiria um
         * parcelamento de trezentos mil passar como doze títulos de vinte e
         * cinco mil, cada um abaixo do nível que a soma exige.
         */
        await this.definirStatusComParcelas(db, id, niveis === 0 ? 'APROVADO' : 'EM_APROVACAO')
        if (niveis > 0) {
          const rodada = await this.repo.abrirRodada(db, id, niveis)
          await this.avisarAprovadores(db, id, 1, rodada)
        }

        const criado = await this.repo.porId(db, id)
        return criado!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  async editar(id: string, versao: number, dados: EditarTituloPagar): Promise<TituloPagar> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Título a pagar', id)

      /*
       * Editar só em PENDENTE, e a recusa distingue os dois motivos.
       *
       * "Conflito de versão" e "estado não permite" são coisas diferentes para
       * quem recebe: a primeira pede recarregar, a segunda pede outra ação.
       * Devolver a mesma resposta para as duas manda o operador recarregar
       * indefinidamente um título que nunca vai aceitar a edição.
       */
      if (atual.status !== 'PENDENTE') {
        throw new ErroDominio('TRANSICAO_INVALIDA', `Título em ${atual.status} não é editável`, {
          detail:
            'Depois de enviado para aprovação, o que muda é o valor devido — por ajuste, com motivo.',
          acoes: [
            { code: 'AJUSTAR_VALOR', descricao: 'Use o ajuste de valor para registrar multa, juro ou desconto.' },
          ],
        })
      }

      try {
        const ok = await this.repo.editar(db, id, versao, dados)
        if (!ok) throw this.conflito(atual.version)
        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  async ajustarValor(
    id: string,
    versao: number,
    dados: AjustarValorTituloPagar,
  ): Promise<TituloPagar> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Título a pagar', id)

      /*
       * O ajuste não pode ficar abaixo do que já foi pago.
       *
       * Sem esta checagem, ajustar 1000 para 300 num título com 500 pagos
       * deixaria saldo negativo — e o gatilho de status marcaria PAGO com
       * dinheiro pago a mais, sem nenhum lugar registrando a diferença.
       */
      const jaPago = atual.pagamentos
        .filter((p) => p.estornado_em === null)
        .reduce((s, p) => s + Number(p.valor_pago), 0)
      if (Number(dados.valor_ajustado) < jaPago - 0.005) {
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'O ajuste ficaria abaixo do já pago', {
          detail: `Já foram pagos ${jaPago.toFixed(2)}. Um ajuste menor deixaria saldo negativo, sem onde registrar a diferença.`,
          errors: [{ field: 'valor_ajustado', code: 'ABAIXO_DO_PAGO' }],
          acoes: [
            { code: 'ESTORNAR_PRIMEIRO', descricao: 'Estorne o pagamento em excesso antes de reduzir o valor.' },
          ],
        })
      }

      try {
        const ok = await this.repo.ajustarValor(db, id, versao, dados.valor_ajustado)
        if (!ok) throw this.conflito(atual.version)
        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  /**
   * Decide um nível.
   *
   * A validação de quem pode decidir, da ordem e da justificativa está toda no
   * gatilho da 0019 — este método traduz a recusa e cuida do que o banco não
   * faz: mover o status do título e avisar quem precisa saber.
   */
  async decidir(id: string, nivel: number, dados: DecidirAprovacao): Promise<TituloPagar> {
    const claims = exigirClaims()

    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Título a pagar', id)

      if (atual.status !== 'EM_APROVACAO') {
        throw new ErroDominio('TRANSICAO_INVALIDA', `Título em ${atual.status} não está em aprovação`, {
          detail: 'Só título em aprovação recebe decisão.',
        })
      }

      const rodada = await this.repo.rodadaAtual(db, id)

      try {
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
          throw new ErroDominio('TRANSICAO_INVALIDA', `O nível ${nivel} não está aberto para decisão`, {
            detail: 'Ou ele já foi decidido, ou este título não tem esse nível nesta rodada.',
          })
        }

        if (dados.decisao === 'REJEITADO') {
          /*
           * Rejeição volta a PENDENTE, não a um estado "rejeitado" terminal.
           *
           * O título rejeitado tem um destino natural: o solicitante corrige e
           * reenvia. Um estado terminal obrigaria a criar um título novo,
           * perdendo o histórico da rejeição — que é justamente o que explica a
           * correção.
           */
          await this.definirStatusComParcelas(db, id, 'PENDENTE')
          await this.avisarDecisao(db, atual, false, dados.justificativa ?? null)
        } else {
          const pendentes = await this.repo.pendentesNaRodada(db, id, rodada)
          if (pendentes === 0) {
            await this.definirStatusComParcelas(db, id, 'APROVADO')
            await this.avisarDecisao(db, atual, true, null)
          } else {
            // Só agora o nível seguinte existe para quem o decide (RN-F02).
            await this.avisarAprovadores(db, id, nivel + 1, rodada)
          }
        }

        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  /** Reenviar depois de uma rejeição abre a rodada seguinte, não reusa a antiga. */
  async reenviar(id: string): Promise<TituloPagar> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Título a pagar', id)

      if (atual.status !== 'PENDENTE') {
        throw new ErroDominio('TRANSICAO_INVALIDA', `Título em ${atual.status} não se reenvia`, {
          detail: 'Só título pendente entra em aprovação.',
        })
      }

      const { niveis } = await this.repo.niveisExigidos(db, atual.valor_devido)
      await this.definirStatusComParcelas(db, id, niveis === 0 ? 'APROVADO' : 'EM_APROVACAO')
      if (niveis > 0) {
        const rodada = await this.repo.abrirRodada(db, id, niveis)
        await this.avisarAprovadores(db, id, 1, rodada)
      }
      return (await this.repo.porId(db, id))!
    })
  }

  async pagar(id: string, dados: RegistrarPagamento): Promise<TituloPagar> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Título a pagar', id)

      try {
        await this.repo.baixar(db, id, dados)
        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  async estornarPagamento(id: string, pagamentoId: string, motivo: string): Promise<TituloPagar> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Título a pagar', id)
      if (!atual.pagamentos.some((p) => p.id === pagamentoId)) {
        throw naoEncontrado('Pagamento', pagamentoId)
      }

      try {
        await this.repo.estornarPagamento(db, pagamentoId, motivo)
        return (await this.repo.porId(db, id))!
      } catch (e) {
        throw this.traduzir(e)
      }
    })
  }

  /**
   * Cancelar.
   *
   * O pai propõe cancelar as filhas pendentes e **exige confirmação** — sem
   * ela, a recusa lista o que seria afetado. Cancelar em cascata em silêncio é
   * uma ação destrutiva que o operador só descobre depois; e parcela já paga
   * não se cancela de jeito nenhum, porque o dinheiro saiu.
   */
  async cancelar(id: string, dados: CancelarTituloPagar): Promise<TituloPagar> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Título a pagar', id)

      if (atual.pagamentos.some((p) => p.estornado_em === null)) {
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'Título com pagamento não se cancela', {
          detail: 'O dinheiro saiu. Estorne o pagamento primeiro — o estorno fica registrado.',
          acoes: [{ code: 'ESTORNAR', descricao: 'Estorne os pagamentos e cancele depois.' }],
        })
      }

      const filhas = await this.repo.parcelasPendentes(db, id)
      const canceláveis = filhas.filter((f) => !['PAGO', 'PAGO_PARCIAL', 'CANCELADO'].includes(f.status))
      const pagas = filhas.filter((f) => ['PAGO', 'PAGO_PARCIAL'].includes(f.status))

      if (canceláveis.length > 0 && !dados.cancelar_parcelas_pendentes) {
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'Este título tem parcelas a cancelar', {
          detail:
            `${canceláveis.length} parcela(s) seriam canceladas` +
            (pagas.length > 0 ? `, e ${pagas.length} já paga(s) seriam preservadas.` : '.'),
          acoes: [
            {
              code: 'CONFIRMAR_CASCATA',
              descricao: 'Reenvie com cancelar_parcelas_pendentes=true para confirmar.',
            },
          ],
        })
      }

      for (const f of canceláveis) await this.repo.definirStatus(db, f.id, 'CANCELADO')
      await this.repo.definirStatus(db, id, 'CANCELADO')

      return (await this.repo.porId(db, id))!
    })
  }

  /* ------------------------------------------------------- delegação */

  async listarDelegacoes(filtro: ListarDelegacoes): Promise<Pagina<Delegacao>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarDelegacoes(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas, {
        limit: filtro.limit,
        // A delegação não expõe `created_at` no contrato; o cursor usa o id da
        // última linha com a data que o repositório já ordenou.
        next_cursor: temMais && ultimo ? codificarCursor({ criadoEm: ultimo.inicio, id: ultimo.id }) : null,
      })
    })
  }

  async criarDelegacao(dados: CriarDelegacao): Promise<{ id: string }> {
    const claims = exigirClaims()
    if (dados.delegado_id === claims.usuario_id) {
      throw new ErroDominio('REGRA_DE_NEGOCIO', 'Delegar para si mesmo não muda nada', {
        detail: 'E sugere que mudou, o que é pior que não fazer nada.',
        errors: [{ field: 'delegado_id', code: 'PROPRIO_USUARIO' }],
      })
    }

    return this.banco.emTransacao(async (db) => {
      try {
        return { id: await this.repo.criarDelegacao(db, dados) }
      } catch (e) {
        const codigo = (e as { code?: string }).code
        if (codigo === '23P01') {
          throw new ErroDominio('REGRA_DE_NEGOCIO', 'Já existe delegação deste nível no período', {
            detail:
              'Duas delegações sobrepostas fariam "quem aprova hoje?" ter duas respostas, decididas pela ordem da consulta.',
            errors: [{ field: 'inicio', code: 'PERIODO_SOBREPOSTO' }],
          })
        }
        throw this.traduzir(e)
      }
    })
  }

  /**
   * Move o status do título e leva as parcelas pendentes com ele.
   *
   * Um título sem parcelas passa pelo mesmo caminho: a propagação não encontra
   * filhas e não faz nada. Ter dois caminhos — um com e um sem — é ter um deles
   * que alguém vai esquecer de atualizar.
   */
  private async definirStatusComParcelas(db: Executor, id: string, status: string): Promise<void> {
    await this.repo.definirStatus(db, id, status)
    await this.repo.propagarStatusParaParcelas(db, id, status)
  }

  /* ------------------------------------------------------- avisos */

  /**
   * Avisa quem pode decidir o nível, e o solicitante fica de fora.
   *
   * O aviso vai para **todos** os que podem decidir, não para um escolhido. A
   * alternativa — sortear um responsável — cria a situação em que a pessoa
   * sorteada está de férias e o título espera sem que ninguém saiba, com três
   * outras pessoas habilitadas e sem aviso.
   */
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
        valor: titulo.valor_devido,
        vencimento: titulo.data_vencimento,
        nivel,
        solicitante: solicitante?.nome ?? 'operador',
      })
    }
  }

  private async avisarDecisao(
    db: Executor,
    titulo: TituloPagar,
    aprovado: boolean,
    justificativa: string | null,
  ): Promise<void> {
    const claims = exigirClaims()
    const decisor = await this.repo.usuarioPorId(db, claims.usuario_id)

    // O solicitante é `created_by`. Sem ele — título vindo de importação, por
    // exemplo — não há a quem avisar, e avisar o decisor da própria decisão
    // seria ruído.
    const linha = await db.consultarUm<{ created_by: string | null }>(
      `select created_by from public.titulo_pagar where id = $1`,
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
      valor: titulo.valor_devido,
      aprovado,
      decididoPor: decisor?.nome ?? 'aprovador',
      justificativa,
    })
  }

  /* ------------------------------------------------------- erros */

  private conflito(versaoAtual: number): ErroDominio {
    return new ErroDominio('CONFLITO_DE_VERSAO', 'O título mudou desde a leitura', {
      detail: `A versão atual é ${versaoAtual}. Recarregue e reenvie com ela.`,
      acoes: [{ code: 'RECARREGAR', descricao: 'Recarregue o título e reaplique a alteração.' }],
    })
  }

  private traduzir(e: unknown): unknown {
    if (e instanceof ErroDominio) return e
    const codigo = (e as { code?: string }).code
    const mensagem = String((e as { message?: string }).message ?? '')
    if (codigo !== '23514') return e

    const mapa: { marca: RegExp; titulo: string; campo?: string; acao?: [string, string] }[] = [
      {
        marca: /não aprova o próprio/,
        titulo: 'Quem lançou o título não aprova o próprio título',
        campo: 'aprovador_id',
        acao: ['OUTRO_APROVADOR', 'A aprovação tem de vir de outra pessoa — é o que faz o fluxo valer.'],
      },
      {
        marca: /delegação não pode devolver/,
        titulo: 'A delegação não devolve a aprovação a quem lançou',
        campo: 'delegado_de',
      },
      {
        marca: /não tem alçada/,
        titulo: 'Sem alçada para decidir este nível',
        campo: 'nivel',
        acao: ['CONFIGURAR_ALCADA', 'Configure a alçada do perfil, ou registre uma delegação vigente.'],
      },
      {
        marca: /sequencial|nível\(is\) anterior/,
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
        marca: /excede o saldo/,
        titulo: 'O pagamento excede o saldo em aberto',
        campo: 'valor_pago',
        acao: ['AJUSTAR_VALOR', 'Pagamento excedente não vira crédito: ajuste o valor devido, se for o caso.'],
      },
      {
        marca: /não recebe pagamento: pague as parcelas/,
        titulo: 'Título parcelado não recebe pagamento',
        campo: 'titulo_id',
        acao: ['PAGAR_PARCELA', 'Pague as parcelas — o pai existe para o relatório.'],
      },
      {
        marca: /não recebe pagamento/,
        titulo: 'O título não está em estado de receber pagamento',
        campo: 'titulo_id',
      },
      {
        marca: /tem de somar 100/,
        titulo: 'O rateio tem de somar 100%',
        campo: 'rateio',
        acao: ['AJUSTAR_RATEIO', 'Ajuste os percentuais, ou remova o rateio.'],
      },
      {
        marca: /já foi estornado/,
        titulo: 'Este pagamento já foi estornado',
        acao: ['CONFERIR_EXTRATO', 'Estornar duas vezes devolveria o valor duas vezes ao saldo.'],
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
