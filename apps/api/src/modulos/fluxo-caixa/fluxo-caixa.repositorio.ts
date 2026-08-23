import { Injectable } from '@nestjs/common'
import type { AlertaCaixa, CenarioCaixa, CriarCenarioCaixa, DiaProjetado, Dinheiro } from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'

/**
 * Acesso a dados do fluxo de caixa projetado.
 *
 * Três consultas, e nenhuma delas soma nada: `app.fluxo_caixa_projetado` e
 * `app.alertas_caixa` fazem o cálculo no banco, onde ele fica a uma chamada de
 * distância dos dados. Refazer a composição em TypeScript daria duas respostas
 * para "quanto entra em sessenta dias" e a divergência apareceria como um painel
 * que não fecha com o planejamento.
 *
 * Nenhum `insert` de posição diária: não existe onde inserir, e a ausência é o
 * ponto — a posição de amanhã muda a cada baixa registrada hoje.
 */

const dinheiro = (v: string | number | null): Dinheiro => Number(v ?? 0).toFixed(4) as Dinheiro
const dia = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)

interface LinhaDia extends Record<string, unknown> {
  dia: Date
  entradas: string
  saidas: string
  saldo_dia: string
  saldo_acumulado: string
}

interface LinhaCenario extends Record<string, unknown> {
  id: string
  nome: string
  percentual_inadimplencia: string
  limiar_concentracao: string
  padrao: boolean
  version: number
}

const mapearCenario = (l: LinhaCenario): CenarioCaixa => ({
  id: l.id,
  nome: l.nome,
  percentual_inadimplencia: Number(l.percentual_inadimplencia),
  limiar_concentracao: Number(l.limiar_concentracao),
  padrao: l.padrao,
  version: l.version,
})

@Injectable()
export class FluxoCaixaRepositorio {
  async projetar(
    db: Executor,
    de: string,
    ate: string,
    filtros: {
      cenario_id?: string | undefined
      conta_id?: string | undefined
      filial_id?: string | undefined
      centro_custo_id?: string | undefined
    },
  ): Promise<DiaProjetado[]> {
    const linhas = await db.consultar<LinhaDia>(
      `select * from app.fluxo_caixa_projetado($1::date, $2::date, $3::uuid, $4::uuid, $5::uuid, $6::uuid)`,
      [
        de,
        ate,
        filtros.cenario_id ?? null,
        filtros.conta_id ?? null,
        filtros.filial_id ?? null,
        filtros.centro_custo_id ?? null,
      ],
    )
    return linhas.map((l) => ({
      dia: dia(l.dia),
      entradas: dinheiro(l.entradas),
      saidas: dinheiro(l.saidas),
      saldo_dia: dinheiro(l.saldo_dia),
      saldo_acumulado: dinheiro(l.saldo_acumulado),
    }))
  }

  async alertas(db: Executor, de: string, ate: string): Promise<AlertaCaixa[]> {
    const linhas = await db.consultar<{
      tipo: AlertaCaixa['tipo']
      dia: Date
      valor: string
      detalhe: string
    }>(`select * from app.alertas_caixa($1::date, $2::date)`, [de, ate])
    return linhas.map((l) => ({
      tipo: l.tipo,
      dia: dia(l.dia),
      valor: dinheiro(l.valor),
      detalhe: l.detalhe,
    }))
  }

  /**
   * Saldo de partida da janela: o real das contas na véspera.
   *
   * Consulta própria, e não uma coluna da projeção, porque ela responde a outra
   * pergunta: a projeção diz o acumulado **de cada dia**, e o painel precisa
   * dizer de onde a série partiu. Derivá-lo do primeiro dia obrigaria a subtrair
   * o movimento daquele dia, e o resultado ficaria errado quando a janela começa
   * num dia com movimento.
   */
  async saldoInicial(db: Executor, de: string, contaId?: string): Promise<string> {
    const r = await db.consultarUm<{ saldo: string }>(
      `select coalesce(sum(app.saldo_conta(cb.id, ($1::date - 1))), 0) as saldo
         from public.conta_bancaria cb
        where cb.deleted_at is null and cb.status <> 'INATIVA'
          and ($2::uuid is null or cb.id = $2)`,
      [de, contaId ?? null],
    )
    return r!.saldo
  }

  async listarCenarios(db: Executor): Promise<CenarioCaixa[]> {
    const linhas = await db.consultar<LinhaCenario>(
      `select id, nome, percentual_inadimplencia, limiar_concentracao, padrao, version
         from public.parametro_cenario_caixa
        order by padrao desc, nome`,
    )
    return linhas.map(mapearCenario)
  }

  async cenarioPorId(db: Executor, id: string): Promise<CenarioCaixa | null> {
    const l = await db.consultarUm<LinhaCenario>(
      `select id, nome, percentual_inadimplencia, limiar_concentracao, padrao, version
         from public.parametro_cenario_caixa where id = $1`,
      [id],
    )
    return l ? mapearCenario(l) : null
  }

  /**
   * Criar um cenário.
   *
   * Quando o novo é padrão, o anterior deixa de ser **antes** do insert. O índice
   * único parcial recusaria dois padrões, e a ordem inversa transformaria uma
   * operação legítima ("este passa a ser o padrão") em erro de restrição.
   */
  async criarCenario(db: Executor, dados: CriarCenarioCaixa): Promise<string> {
    if (dados.padrao) {
      await db.consultar(
        `update public.parametro_cenario_caixa
            set padrao = false, version = version + 1,
                updated_at = now(), updated_by = app.usuario_atual()
          where padrao`,
      )
    }
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.parametro_cenario_caixa
         (tenant_id, nome, percentual_inadimplencia, limiar_concentracao, padrao,
          created_by, updated_by)
       values (app.tenant_atual(), $1, $2, $3, $4, app.usuario_atual(), app.usuario_atual())
       returning id`,
      [dados.nome, dados.percentual_inadimplencia, dados.limiar_concentracao, dados.padrao],
    )
    return l!.id
  }
}
