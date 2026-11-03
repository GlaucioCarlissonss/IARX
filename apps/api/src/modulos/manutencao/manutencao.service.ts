import { Injectable } from '@nestjs/common'
import type {
  AbrirOs,
  AgendarOs,
  AtribuirOs,
  CancelarOs,
  ConcluirOs,
  ListarOs,
  OrdemServico,
  PausarOs,
  ReabrirOs,
  Tecnico,
  TriarOs,
} from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { exigirClaims } from '../../comum/contexto.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { ManutencaoRepositorio } from './manutencao.repositorio.js'

@Injectable()
export class ManutencaoService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: ManutencaoRepositorio,
  ) {}

  tecnicos(): Promise<Tecnico[]> {
    return this.banco.emTransacao((db) => this.repo.tecnicos(db))
  }

  async listar(filtro: ListarOs): Promise<Pagina<OrdemServico>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listar(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      return new Pagina(linhas, {
        limit: filtro.limit,
        next_cursor: temMais && ultimo ? codificarCursor({ criadoEm: ultimo.abertura_em, id: ultimo.id }) : null,
      })
    })
  }

  async porId(id: string): Promise<OrdemServico> {
    const os = await this.banco.emTransacao((db) => this.repo.porId(db, id))
    if (!os) throw naoEncontrado('ordem de serviço')
    return os
  }

  async abrir(dados: AbrirOs): Promise<OrdemServico> {
    const claims = exigirClaims()
    const os = await this.banco.emTransacao(
      (db) => this.repo.abrir(db, dados, claims.usuario_id),
      { motivo: `abertura de OS ${dados.tipo.toLowerCase()}` },
    )
    // Nulo significa que o equipamento não existe: o `insert` seleciona dele.
    if (!os) throw naoEncontrado('equipamento')
    return os
  }

  /**
   * As transições.
   *
   * Nenhuma delas confere o status de partida: a máquina de estados é gatilho
   * no banco (Anexo B.3), e conferir aqui criaria dois lugares para a mesma
   * regra — com o segundo valendo só para quem passa por esta API, e ainda
   * perdendo a corrida com duas requisições simultâneas.
   */
  async triar(id: string, dados: TriarOs): Promise<OrdemServico> {
    return this.transicao((db, claims) => this.repo.triar(db, id, dados, claims), 'triagem')
  }

  async agendar(id: string, dados: AgendarOs): Promise<OrdemServico> {
    return this.transicao((db, claims) => this.repo.agendar(db, id, dados, claims), 'agendamento')
  }

  async iniciar(id: string): Promise<OrdemServico> {
    return this.transicao((db, claims) => this.repo.iniciar(db, id, claims), 'início de execução')
  }

  async concluir(id: string, dados: ConcluirOs): Promise<OrdemServico> {
    return this.transicao((db, claims) => this.repo.concluir(db, id, dados, claims), dados.causa_raiz)
  }

  /**
   * Validação (RN-027) — e a alçada de custo que ela dispara.
   *
   * O Anexo C descreve `os:custo_aprovar` como "aprovar OS acima do limite
   * (alçada)" e não lhe dá rota no Anexo D. Essa ausência é informação: não é
   * um passo a mais no fluxo, é uma condição sobre a validação — que é onde o
   * custo entra no resultado (Anexo B.3, "lança custo no resultado").
   *
   * A conferência é no corpo e não no decorador pela mesma razão do desconto
   * em contrato: a maioria das ordens é barata, e exigir a permissão na rota
   * inteira obrigaria todo supervisor a tê-la para validar qualquer coisa.
   *
   * O teto em si é do banco (gatilho `os_valida_custo`, 0034). Aqui se
   * responde a outra pergunta: se esta pessoa pode validar ordem cara.
   */
  async validar(id: string): Promise<OrdemServico> {
    const claims = exigirClaims()
    return this.banco.emTransacao(
      async (db) => {
        const aferido = await this.repo.custoEAlcada(db, id, claims.usuario_id)
        if (!aferido) throw naoEncontrado('ordem de serviço')

        const custo = Number(aferido.custo ?? '0')
        const limite = Number(aferido.limite ?? '0')
        if (aferido.configurada && custo > limite && !claims.permissoes.includes('os:custo_aprovar')) {
          throw new ErroDominio('SEM_PERMISSAO', 'Validação de OS acima da alçada', {
            detail:
              'Validar lança o custo da ordem no resultado. Este valor está acima do seu teto, e aprovar custo é permissão própria.',
            errors: [{ field: 'custo_total', code: 'ACIMA_DA_ALCADA', meta: { custo, limite } }],
            acoes: [{ code: 'PEDIR_VALIDACAO', descricao: 'Pedir a validação a quem tem alçada maior' }],
          })
        }

        const os = await this.repo.validar(db, id, claims.usuario_id)
        if (!os) throw naoEncontrado('ordem de serviço')
        return os
      },
      { motivo: 'validação' },
    )
  }

  async atribuir(id: string, dados: AtribuirOs): Promise<OrdemServico> {
    return this.transicao((db, autor) => this.repo.atribuir(db, id, dados, autor), 'atribuição de técnico')
  }

  /**
   * Reabre criando uma OS nova vinculada à original (Anexo B.3).
   *
   * Devolve a **nova** ordem, não a original: é nela que quem reabriu vai
   * trabalhar, e devolver a validada faria a interface precisar de um segundo
   * passo para encontrar o que acabou de ser criado.
   */
  async reabrir(id: string, dados: ReabrirOs): Promise<OrdemServico> {
    const claims = exigirClaims()
    const nova = await this.banco.emTransacao(
      (db) => this.repo.reabrir(db, id, dados, claims.usuario_id),
      { motivo: dados.motivo },
    )
    if (!nova) {
      throw new ErroDominio('TRANSICAO_INVALIDA', 'Só ordem validada é reaberta', {
        detail:
          'A reabertura registra reincidência do mesmo sintoma depois do atendimento conferido. Ordem em andamento se retoma; ordem cancelada não reabre.',
        errors: [{ field: 'status', code: 'STATUS_NAO_PERMITE' }],
      })
    }
    return nova
  }

  async cancelar(id: string, dados: CancelarOs): Promise<OrdemServico> {
    return this.transicao((db, claims) => this.repo.cancelar(db, id, dados.motivo, claims), dados.motivo)
  }

  async pausar(id: string, dados: PausarOs): Promise<OrdemServico> {
    return this.transicao((db, claims) => this.repo.pausar(db, id, dados, claims), dados.justificativa)
  }

  async retomar(id: string): Promise<OrdemServico> {
    const claims = exigirClaims()
    const os = await this.banco.emTransacao(
      (db) => this.repo.retomar(db, id, claims.usuario_id),
      { motivo: 'retomada após pausa' },
    )
    /*
     * Nulo aqui significa "não havia pausa aberta", e a resposta é a mesma de
     * "não existe". Diferenciar diria, pela mensagem, o estado interno de uma
     * OS que o usuário pode não ter o direito de enxergar.
     */
    if (!os) throw naoEncontrado('pausa aberta')
    return os
  }

  /*
   * O `id` não entra aqui: cada chamador já o capturou no próprio `acao`.
   * Recebê-lo de novo só para não usar seria um parâmetro que o compilador
   * acusa e que o leitor precisa conferir se está sendo usado.
   */
  private async transicao(
    acao: (db: Parameters<Parameters<BancoService['emTransacao']>[0]>[0], autor: string) => Promise<OrdemServico | null>,
    motivo: string,
  ): Promise<OrdemServico> {
    const claims = exigirClaims()
    const os = await this.banco.emTransacao((db) => acao(db, claims.usuario_id), { motivo })
    if (!os) throw naoEncontrado('ordem de serviço')
    return os
  }
}
