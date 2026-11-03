import { Injectable } from '@nestjs/common'
import type {
  BaixarEquipamento,
  EditarEquipamento,
  EditarPatrimonial,
  Equipamento,
  EquipamentoStatus,
  ListarMovimentacoes,
  ListarTransferenciasPendentes,
  Movimentacao,
  MovimentacaoTipo,
  RegistrarMovimentacao,
  TransferirEquipamento,
} from '@iarx/contracts'
import { BancoService, type Executor } from '../../banco/banco.service.js'
import { exigirClaims } from '../../comum/contexto.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { EquipamentosRepositorio } from './equipamentos.repositorio.js'
import { MovimentacaoRepositorio, cursorDeMovimentacao } from './movimentacao.repositorio.js'

/**
 * Movimentação de equipamento — Anexo A.5, B.2 e D §EQP.
 *
 * ## O mapa abaixo é o ponto de autorização deste módulo
 *
 * `status_resultante` nunca vem do corpo da requisição: é derivado do par
 * (tipo da movimentação, estado atual do ativo). Aceitá-lo no corpo daria a
 * quem tem `equipamento:movimentar` — o perfil de campo, o mais distribuído do
 * sistema — o poder de pôr qualquer ativo em qualquer estado, `BAIXADO`
 * inclusive, que o Anexo C reserva a diretor e controller.
 *
 * ## Por que o estado atual entra na chave
 *
 * Os tipos de movimentação do Anexo A.5 são mais grossos que as transições do
 * Anexo B.2, e a diferença é real, não um detalhe de tradução:
 *
 *   B.2 distingue `RESERVADO → EM_TRÂNSITO_ENTREGA` ("expedição", romaneio
 *   emitido) de `EM_TRÂNSITO_ENTREGA → LOCADO` ("entrega confirmada",
 *   checklist e leitura inicial). São dois atos de campo, com responsáveis
 *   diferentes e horas diferentes — e A.5 tem um único tipo, `ENTREGA`, para
 *   os dois.
 *
 * A saída adotada é a que não inventa vocabulário: o estado atual desempata.
 * `ENTREGA` sobre um ativo reservado é a expedição; sobre um ativo em trânsito
 * é a chegada. As duas gravam linha no razão, então a timeline continua
 * mostrando "saiu" e "chegou" separadamente, que é o que a operação precisa.
 *
 * A alternativa seria acrescentar `EXPEDICAO` ao enum do A.5 — decisão de
 * modelagem que não é minha e está registrada como pendência no Anexo L.
 */

/** Destino de cada movimentação, por estado de origem. */
const DESTINO: Record<MovimentacaoTipo, Partial<Record<EquipamentoStatus, EquipamentoStatus>>> = {
  ENTREGA: {
    RESERVADO: 'EM_TRANSITO_ENTREGA',
    EM_TRANSITO_ENTREGA: 'LOCADO',
  },
  RETORNO: {
    LOCADO: 'EM_TRANSITO_RETORNO',
    EM_TRANSITO_RETORNO: 'EM_INSPECAO',
    // Inspeção aprovada: nenhuma divergência impeditiva (B.2, RN-006). A
    // divergência impeditiva é ENVIO_MANUTENCAO a partir do mesmo estado.
    EM_INSPECAO: 'DISPONIVEL',
  },
  ENVIO_MANUTENCAO: {
    DISPONIVEL: 'EM_MANUTENCAO',
    LOCADO: 'EM_MANUTENCAO',
    EM_INSPECAO: 'EM_MANUTENCAO',
    BLOQUEADO: 'EM_MANUTENCAO',
  },
  /*
   * Para onde o ativo volta é o contrato que diz, não quem digita: com item
   * vigente o destino é LOCADO, sem item é DISPONIVEL. Resolvido em
   * `destinoDoRetornoDeManutencao`, abaixo, porque depende de consulta.
   */
  RETORNO_MANUTENCAO: {},
  /*
   * Envio a terceiro não tem estado próprio no Anexo B.2. `EM_MANUTENCAO` é a
   * leitura honesta — o ativo está fora da base alocável e em conserto — e
   * `destino_tipo = 'TERCEIRO'` registra onde ele está. Um estado novo seria
   * decisão de modelagem, e não há uma para citar.
   */
  ENVIO_TERCEIRO: {
    DISPONIVEL: 'EM_MANUTENCAO',
    LOCADO: 'EM_MANUTENCAO',
    EM_INSPECAO: 'EM_MANUTENCAO',
  },
  TRANSFERENCIA: { DISPONIVEL: 'EM_TRANSITO_ENTREGA' },
  BAIXA: {},
}

/**
 * Efeito sobre o item de contrato, por (tipo, estado resultante do ativo).
 *
 * Transcreve a coluna "Efeitos" do Anexo B.2. Só se aplica quando a
 * movimentação informa `contrato_item_id`: movimentação de ativo de base, sem
 * contrato por trás, não mexe em cobrança nenhuma.
 */
const ESTADO_DO_ITEM: Partial<
  Record<MovimentacaoTipo, Partial<Record<EquipamentoStatus, string>>>
> = {
  ENTREGA: {
    EM_TRANSITO_ENTREGA: 'EM_ENTREGA', // expedição: romaneio emitido
    LOCADO: 'ATIVO', // entrega confirmada: inicia o faturamento
  },
  RETORNO: {
    EM_TRANSITO_RETORNO: 'EM_DEVOLUCAO',
    EM_INSPECAO: 'ENCERRADO', // recebimento: encerra o período de faturamento
  },
}

/**
 * Estados do ativo que a guarda de alocação da 0005 recusa.
 *
 * Duplicar a lista aqui seria o erro que este projeto já cometeu com o recorte
 * de RLS: duas cópias divergem na primeira correção. A lista existe aqui apenas
 * para **ordenar duas escritas**, não para decidir se a operação é válida — a
 * decisão continua sendo da guarda, no banco. Se as duas divergirem, a guarda
 * recusa e a API devolve a recusa dela.
 */
const PROIBE_ALOCACAO = new Set<EquipamentoStatus>([
  'EM_MANUTENCAO',
  'EXTRAVIADO',
  'BAIXADO',
  'BLOQUEADO',
  'EM_TRANSITO_ENTREGA',
  'EM_TRANSITO_RETORNO',
])

@Injectable()
export class MovimentacaoService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: MovimentacaoRepositorio,
    private readonly equipamentos: EquipamentosRepositorio,
  ) {}

  async registrar(equipamentoId: string, dados: RegistrarMovimentacao): Promise<Movimentacao> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const ativo = await this.equipamentos.porId(db, equipamentoId)
      if (!ativo) throw naoEncontrado('Equipamento', equipamentoId)

      const destino =
        dados.tipo === 'RETORNO_MANUTENCAO'
          ? await this.destinoDoRetornoDeManutencao(db, ativo)
          : DESTINO[dados.tipo][ativo.status]

      if (!destino) throw movimentacaoImpossivel(dados.tipo, ativo.status)

      const id = await this.repo.registrar(db, claims.tenant_id, {
        equipamentoId,
        tipo: dados.tipo,
        origemTipo: dados.origem?.tipo ?? null,
        origemId: dados.origem?.id ?? null,
        destinoTipo: dados.destino?.tipo ?? null,
        destinoId: dados.destino?.id ?? null,
        contratoItemId: dados.contrato_item_id ?? null,
        ordemServicoId: dados.ordem_servico_id ?? null,
        documentoRef: dados.documento_ref ?? null,
        observacao: dados.observacao ?? null,
        statusResultante: destino,
      })

      await this.aplicarEfeitos(db, equipamentoId, destino, dados, motivoDe(dados.tipo))

      const criada = await this.repo.porId(db, id)
      if (!criada) throw naoEncontrado('Movimentação', id)
      return criada
    })
  }

  /**
   * Aplica o novo estado do ativo e o efeito que o Anexo B.2 lhe atribui.
   *
   * A coluna "Efeitos" do B.2 não é prosa: `EM_TRÂNSITO_ENTREGA → LOCADO`
   * "inicia faturamento na data/hora efetiva", e `EM_TRÂNSITO_RETORNO →
   * EM_INSPEÇÃO` "encerra período de faturamento". Quem move a máquina é quem
   * sabe quando isso aconteceu — deixar o item de contrato para um segundo
   * passo manual é garantir que a data de início da cobrança seja a data em que
   * alguém lembrou de clicar, não a da entrega.
   *
   * ## A ordem das duas escritas não é indiferente
   *
   * A guarda `ci_valida_coerencia` (0005) recusa pôr um item em estado ocupante
   * — RESERVADO, EM_ENTREGA, ATIVO — quando o ativo está em trânsito, em
   * manutenção, extraviado, bloqueado ou baixado. Então:
   *
   *  · indo para um estado que a guarda proíbe (expedição, início de
   *    devolução), o item muda **primeiro**, enquanto o ativo ainda está no
   *    estado permitido de origem;
   *  · indo para um estado permitido (entrega confirmada, recebimento), o ativo
   *    muda primeiro, e só então o item alcança ATIVO.
   *
   * Inverter qualquer uma das duas faz a guarda recusar a operação inteira —
   * o que é o comportamento correto da guarda, e um bug aqui.
   */
  private async aplicarEfeitos(
    db: Executor,
    equipamentoId: string,
    destino: EquipamentoStatus,
    dados: RegistrarMovimentacao,
    motivo: string | null,
  ): Promise<void> {
    const itemId = dados.contrato_item_id ?? null
    const novoItem = itemId ? ESTADO_DO_ITEM[dados.tipo]?.[destino] ?? null : null
    const ativoPrimeiro = !PROIBE_ALOCACAO.has(destino)

    if (ativoPrimeiro) {
      await this.repo.aplicarStatus(db, equipamentoId, destino, motivo)
      if (novoItem) await this.moverItem(db, itemId as string, equipamentoId, novoItem)
      return
    }

    if (novoItem) await this.moverItem(db, itemId as string, equipamentoId, novoItem)
    await this.repo.aplicarStatus(db, equipamentoId, destino, motivo)
  }

  /**
   * `and equipamento_id = $3` não é redundância defensiva: sem ele, informar o
   * item de outro contrato faria esta movimentação encerrar a cobrança de uma
   * máquina que não se moveu.
   */
  private async moverItem(
    db: Executor,
    itemId: string,
    equipamentoId: string,
    status: string,
  ): Promise<void> {
    const r = await db.consultarUm<{ id: string }>(
      `update public.contrato_item
          set status = $2::app.contrato_item_status,
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and equipamento_id = $3 and deleted_at is null
        returning id`,
      [itemId, status, equipamentoId],
    )
    if (!r) {
      throw new ErroDominio('REGRA_DE_NEGOCIO', 'Item de contrato não é deste equipamento', {
        detail: 'O item informado não existe ou está alocado em outro ativo.',
        errors: [{ field: 'contrato_item_id', code: 'ITEM_DE_OUTRO_ATIVO' }],
      })
    }
  }

  /**
   * Retorno de manutenção: o destino é o contrato que decide.
   *
   * Perguntar ao operador para onde o ativo volta é pedir que ele adivinhe algo
   * que o sistema sabe — e errar aqui é o modo de falha mais caro do eixo: uma
   * máquina que está na mesa do cliente reaparece na base alocável. O gatilho
   * da 0031 recusaria a incoerência de qualquer forma; derivar aqui faz com que
   * ninguém chegue a produzi-la.
   */
  private async destinoDoRetornoDeManutencao(
    db: Executor,
    ativo: Equipamento,
  ): Promise<EquipamentoStatus | undefined> {
    if (ativo.status !== 'EM_MANUTENCAO') return undefined

    const r = await db.consultarUm<{ n: string }>(
      `select count(*)::text as n
         from public.contrato_item ci
        where ci.equipamento_id = $1
          and ci.status in ('ATIVO','EM_ENTREGA','SUSPENSO')
          and ci.deleted_at is null`,
      [ativo.id],
    )
    return Number(r?.n ?? '0') > 0 ? 'LOCADO' : 'DISPONIVEL'
  }

  async listar(equipamentoId: string, filtro: ListarMovimentacoes): Promise<Pagina<Movimentacao>> {
    return this.banco.emTransacao(async (db) => {
      if (!(await this.equipamentos.existe(db, equipamentoId))) {
        throw naoEncontrado('Equipamento', equipamentoId)
      }
      const { linhas, temMais } = await this.repo.listarDoEquipamento(db, equipamentoId, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas, {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorDeMovimentacao(ultimo)) : null,
      })
    })
  }

  /**
   * Transferência entre filiais (RN-005).
   *
   * Só de ativo disponível: transferir o que está locado moveria a máquina para
   * outra filial enquanto ela está no cliente, e a filial de origem continua
   * sendo quem responde pelo contrato.
   */
  async transferir(equipamentoId: string, dados: TransferirEquipamento): Promise<Movimentacao> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const ativo = await this.equipamentos.porId(db, equipamentoId)
      if (!ativo) throw naoEncontrado('Equipamento', equipamentoId)

      if (ativo.filial_id === dados.destino_filial_id) {
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'Origem e destino são a mesma filial', {
          detail: 'A transferência não teria efeito, e deixaria um aceite pendente que ninguém fecharia.',
          errors: [{ field: 'destino_filial_id', code: 'DESTINO_IGUAL_A_ORIGEM' }],
        })
      }

      const destino = DESTINO.TRANSFERENCIA[ativo.status]
      if (!destino) throw movimentacaoImpossivel('TRANSFERENCIA', ativo.status)

      const id = await this.repo.registrar(db, claims.tenant_id, {
        equipamentoId,
        tipo: 'TRANSFERENCIA',
        origemTipo: 'FILIAL',
        origemId: ativo.filial_id,
        destinoTipo: 'FILIAL',
        destinoId: dados.destino_filial_id,
        contratoItemId: null,
        ordemServicoId: null,
        documentoRef: dados.documento_ref ?? null,
        observacao: dados.observacao ?? null,
        statusResultante: destino,
      })

      await this.repo.aplicarStatus(db, equipamentoId, destino, 'transferencia entre filiais')

      const criada = await this.repo.porId(db, id)
      if (!criada) throw naoEncontrado('Movimentação', id)
      return criada
    })
  }

  async pendentes(filtro: ListarTransferenciasPendentes): Promise<Pagina<Movimentacao>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listarPendentes(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas, {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor(cursorDeMovimentacao(ultimo)) : null,
      })
    })
  }

  /**
   * Aceite no destino.
   *
   * É aqui que a filial do ativo muda. Antes do aceite ele está em trânsito e
   * não conta para ninguém: a origem já não pode alocá-lo e o destino ainda
   * não. É o que impede duas filiais contarem a mesma máquina.
   */
  async aceitar(movimentacaoId: string): Promise<Movimentacao> {
    return this.banco.emTransacao(async (db) => {
      const mv = await this.repo.porId(db, movimentacaoId)
      if (!mv) throw naoEncontrado('Transferência', movimentacaoId)

      if (mv.tipo !== 'TRANSFERENCIA') {
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'Esta movimentação não é uma transferência', {
          detail: 'Só transferência entre filiais tem aceite; nas demais o fato se consuma na entrega.',
          errors: [{ field: 'tipo', code: 'SEM_ACEITE' }],
        })
      }

      if (mv.aceite_em) {
        // Já aceita: devolver o estado atual é mais útil que um 409. A operação
        // é idempotente por natureza — quem aceitou foi quem aceitou primeiro.
        return mv
      }

      await this.repo.aceitar(db, movimentacaoId)

      await db.consultar(
        `update public.equipamento
            set filial_id = $2, version = version + 1,
                updated_at = now(), updated_by = app.usuario_atual()
          where id = $1 and deleted_at is null`,
        [mv.equipamento_id, mv.destino_id],
      )
      await this.repo.aplicarStatus(db, mv.equipamento_id, 'DISPONIVEL', null)

      const aceita = await this.repo.porId(db, movimentacaoId)
      if (!aceita) throw naoEncontrado('Transferência', movimentacaoId)
      return aceita
    })
  }

  /**
   * Baixa patrimonial (RN-007).
   *
   * As pré-condições — sem alocação vigente, sem OS aberta — estão no gatilho
   * da 0031 e não são reimplementadas aqui. O serviço grava o fato no razão e
   * deixa o banco recusar o que tem de recusar: duas cópias da mesma regra
   * divergem na primeira vez que uma das duas for corrigida.
   */
  async baixar(equipamentoId: string, dados: BaixarEquipamento): Promise<Movimentacao> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const ativo = await this.equipamentos.porId(db, equipamentoId)
      if (!ativo) throw naoEncontrado('Equipamento', equipamentoId)

      if (ativo.status === 'BAIXADO') {
        throw new ErroDominio('TRANSICAO_INVALIDA', 'Ativo já baixado', {
          detail: 'A baixa é definitiva; não há o que baixar duas vezes.',
          errors: [{ field: 'status', code: 'JA_BAIXADO' }],
        })
      }

      // A ordem importa: aplicar o status primeiro faz o gatilho recusar antes
      // de o razão ganhar uma linha de baixa que não aconteceu.
      await this.repo.aplicarStatus(db, equipamentoId, 'BAIXADO', dados.motivo)

      const id = await this.repo.registrar(db, claims.tenant_id, {
        equipamentoId,
        tipo: 'BAIXA',
        origemTipo: 'FILIAL',
        origemId: ativo.filial_id,
        destinoTipo: null,
        destinoId: null,
        contratoItemId: null,
        ordemServicoId: null,
        documentoRef: null,
        observacao: dados.motivo,
        statusResultante: 'BAIXADO',
      })

      const criada = await this.repo.porId(db, id)
      if (!criada) throw naoEncontrado('Movimentação', id)
      return criada
    })
  }

  async editar(equipamentoId: string, version: number, dados: EditarEquipamento): Promise<Equipamento> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.equipamentos.porId(db, equipamentoId)
      if (!atual) throw naoEncontrado('Equipamento', equipamentoId)

      const ok = await this.repo.editarCadastral(db, equipamentoId, version, dados)
      if (!ok) throw conflitoDeVersao(version, atual.version)

      const novo = await this.equipamentos.porId(db, equipamentoId)
      if (!novo) throw naoEncontrado('Equipamento', equipamentoId)
      return novo
    })
  }

  async editarPatrimonial(
    equipamentoId: string,
    version: number,
    dados: EditarPatrimonial,
  ): Promise<Equipamento> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.equipamentos.porId(db, equipamentoId)
      if (!atual) throw naoEncontrado('Equipamento', equipamentoId)

      const ok = await this.repo.editarPatrimonial(db, equipamentoId, version, dados)
      if (!ok) throw conflitoDeVersao(version, atual.version)

      const novo = await this.equipamentos.porId(db, equipamentoId)
      if (!novo) throw naoEncontrado('Equipamento', equipamentoId)
      return novo
    })
  }
}

/**
 * A recusa diz o que o ativo é hoje e o que teria de ser.
 *
 * "Transição inválida" sozinha obriga o operador a abrir o Anexo B.2 para
 * descobrir o que fazer. Listar as origens aceitas responde a pergunta que ele
 * realmente tem: "então o que eu faço antes?".
 */
function movimentacaoImpossivel(tipo: MovimentacaoTipo, atual: EquipamentoStatus): ErroDominio {
  const aceitas = Object.keys(DESTINO[tipo])
  return new ErroDominio('TRANSICAO_INVALIDA', 'Movimentação não cabe no estado atual', {
    detail:
      aceitas.length > 0
        ? `O ativo está ${atual}. Uma movimentação ${tipo} parte de: ${aceitas.join(', ')}.`
        : `O ativo está ${atual}, e ${tipo} não se registra por esta rota.`,
    errors: [{ field: 'tipo', code: 'TRANSICAO_INVALIDA', meta: { status_atual: atual, origens: aceitas } }],
  })
}

/** Motivo tipificado para RN-010, quando o estado de destino o exige. */
function motivoDe(tipo: MovimentacaoTipo): string | null {
  switch (tipo) {
    case 'ENVIO_MANUTENCAO':
      return 'manutencao'
    case 'ENVIO_TERCEIRO':
      return 'envio a terceiro'
    case 'ENTREGA':
      return 'entrega ao cliente'
    case 'RETORNO':
      return 'retorno do cliente'
    default:
      return null
  }
}

function conflitoDeVersao(enviada: number, atual: number): ErroDominio {
  return new ErroDominio('CONFLITO_DE_VERSAO', 'Registro alterado por outra operação', {
    detail: `A versão enviada (${enviada}) não é mais a atual (${atual}). Recarregue e refaça a alteração.`,
    errors: [{ field: 'version', code: 'VERSAO_DESATUALIZADA', meta: { enviada, atual } }],
  })
}
