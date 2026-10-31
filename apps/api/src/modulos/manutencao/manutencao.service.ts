import { Injectable } from '@nestjs/common'
import type {
  AbrirOs,
  AgendarOs,
  CancelarOs,
  ConcluirOs,
  ListarOs,
  OrdemServico,
  PausarOs,
  Tecnico,
  TriarOs,
} from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { naoEncontrado } from '../../comum/erros.js'
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

  async validar(id: string): Promise<OrdemServico> {
    return this.transicao((db, claims) => this.repo.validar(db, id, claims), 'validação')
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
