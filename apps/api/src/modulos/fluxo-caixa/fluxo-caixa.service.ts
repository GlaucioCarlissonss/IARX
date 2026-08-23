import { Injectable } from '@nestjs/common'
import type {
  AlertaCaixa,
  CenarioCaixa,
  ConsultarAlertas,
  ConsultarProjecao,
  CriarCenarioCaixa,
  Dinheiro,
  Projecao,
} from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { ErroDominio } from '../../comum/erros.js'
import { FluxoCaixaRepositorio } from './fluxo-caixa.repositorio.js'

/**
 * Fluxo de caixa projetado — Módulo 13.
 *
 * O serviço não calcula: ele delimita a janela, chama a função do banco e resume.
 * O resumo é o único cálculo que existe aqui, e é sobre a série que o banco já
 * devolveu — somar o que já está somado não pode divergir do que foi somado.
 *
 * **A janela é sempre a partir de hoje.** Aceitar `de` e `ate` livres permitiria
 * projetar o passado, onde "previsto" não quer dizer nada: o passado tem extrato,
 * e uma projeção retroativa mostraria como futuro o que já aconteceu.
 */
@Injectable()
export class FluxoCaixaService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: FluxoCaixaRepositorio,
  ) {}

  async projetar(consulta: ConsultarProjecao): Promise<Projecao> {
    return this.banco.emTransacao(async (db) => {
      const { de, ate } = janela(consulta.dias)

      if (consulta.cenario_id) {
        const c = await this.repo.cenarioPorId(db, consulta.cenario_id)
        if (!c) {
          /*
           * Cenário inexistente é recusa explícita, não silêncio.
           *
           * `app.fluxo_caixa_projetado` cai no padrão quando não acha o id — o
           * que é certo para `null`, e errado para um id que o cliente mandou:
           * a tela mostraria o cenário padrão sob o rótulo do cenário pedido.
           */
          throw new ErroDominio('NAO_ENCONTRADO', 'Cenário de caixa não encontrado', {
            detail: 'O cenário informado não existe. Sem ele, a projeção usaria o padrão sob o rótulo errado.',
          })
        }
      }

      const [dias, saldoInicial, cenario] = await Promise.all([
        this.repo.projetar(db, de, ate, consulta),
        this.repo.saldoInicial(db, de, consulta.conta_id),
        consulta.cenario_id
          ? this.repo.cenarioPorId(db, consulta.cenario_id)
          : this.repo.listarCenarios(db).then((cs) => cs.find((c) => c.padrao) ?? null),
      ])

      const soma = (f: (d: (typeof dias)[number]) => string) =>
        dias.reduce((s, d) => s + Number(f(d)), 0)

      /*
       * O menor saldo e o dia em que ele acontece vêm juntos porque a pergunta do
       * painel é "em que dia isto aperta". O valor sozinho obrigaria a varrer a
       * série de novo na tela para achar onde ele cai.
       */
      let menor = Number(saldoInicial)
      let diaMenor: string | null = null
      for (const d of dias) {
        if (Number(d.saldo_acumulado) < menor) {
          menor = Number(d.saldo_acumulado)
          diaMenor = d.dia
        }
      }

      const ultimo = dias[dias.length - 1]
      return {
        de,
        ate,
        cenario_id: cenario?.id ?? null,
        cenario_nome: cenario?.nome ?? null,
        saldo_inicial: reais(saldoInicial),
        total_entradas: reais(soma((d) => d.entradas)),
        total_saidas: reais(soma((d) => d.saidas)),
        saldo_final: ultimo ? ultimo.saldo_acumulado : reais(saldoInicial),
        menor_saldo: reais(menor),
        dia_menor_saldo: diaMenor,
        dias,
      }
    })
  }

  async alertas(consulta: ConsultarAlertas): Promise<AlertaCaixa[]> {
    return this.banco.emTransacao(async (db) => {
      const { de, ate } = janela(consulta.dias)
      return this.repo.alertas(db, de, ate)
    })
  }

  async listarCenarios(): Promise<CenarioCaixa[]> {
    return this.banco.emTransacao((db) => this.repo.listarCenarios(db))
  }

  async criarCenario(dados: CriarCenarioCaixa): Promise<CenarioCaixa> {
    return this.banco.emTransacao(async (db) => {
      try {
        const id = await this.repo.criarCenario(db, dados)
        return (await this.repo.cenarioPorId(db, id))!
      } catch (e) {
        const mensagem = String((e as { message?: string }).message ?? '')
        if (/cenario_nome_uk/.test(mensagem)) {
          throw new ErroDominio('RECURSO_DUPLICADO', 'Já existe um cenário com este nome', {
            detail: 'Nomes de cenário são únicos por locatário — dois iguais tornariam o seletor ambíguo.',
            errors: [{ field: 'nome', code: 'DUPLICADO' }],
          })
        }
        throw e
      }
    })
  }
}

/** Hoje até hoje + N. O início é fixo por decisão, não por conveniência. */
function janela(dias: number): { de: string; ate: string } {
  const hoje = new Date()
  const de = hoje.toISOString().slice(0, 10)
  const fim = new Date(hoje)
  fim.setUTCDate(fim.getUTCDate() + dias)
  return { de, ate: fim.toISOString().slice(0, 10) }
}

const reais = (v: string | number): Dinheiro => Number(v).toFixed(4) as Dinheiro
