import { z } from 'zod'
import { Data, Dinheiro, Uuid } from './primitivos.js'

/**
 * Fluxo de caixa projetado — Módulo 13.
 *
 * A camada de **leitura**: consolida o saldo real das contas (Módulo 9) com o
 * previsto (10, 11 e 12) numa projeção diária.
 *
 * **Uma projeção só.** O levantamento a especifica duas vezes — em
 * `/lancamentos-futuros/projecao` e em `/fluxo-caixa/projecao` —, com o próprio
 * texto admitindo "calculado aqui e lá". As duas rotas existem, porque servem a
 * telas diferentes, mas chamam a mesma `app.fluxo_caixa_projetado`: duas contas
 * dariam duas respostas para "quanto entra em sessenta dias", e a divergência
 * apareceria como um planejamento que não fecha com o painel.
 *
 * **Nada aqui é gravado.** Não existe tabela de posição diária, e a ausência é o
 * ponto: a posição de amanhã muda a cada baixa registrada hoje. Gravá-la seria a
 * mesma classe de defeito que `valor_devido` e `app.saldo_conta` existem para
 * evitar, com a divergência aparecendo no painel e em lugar nenhum mais.
 */

/**
 * Um dia da projeção.
 *
 * Sem campo de atraso e sem marca de "previsto contra realizado": o dia é o dia,
 * e o que distingue passado de futuro é a data comparada a hoje. Um booleano
 * gravado aqui estaria errado amanhã.
 */
export const DiaProjetado = z.object({
  dia: Data,
  entradas: Dinheiro,
  saidas: Dinheiro,
  /** Entradas menos saídas do dia. */
  saldo_dia: Dinheiro,
  /** Parte do saldo real das contas na véspera e acumula dia a dia. */
  saldo_acumulado: Dinheiro,
})
export type DiaProjetado = z.infer<typeof DiaProjetado>

export const TIPO_ALERTA_CAIXA = ['SALDO_NEGATIVO', 'CONCENTRACAO_SAIDA'] as const
export const TipoAlertaCaixa = z.enum(TIPO_ALERTA_CAIXA)
export type TipoAlertaCaixa = z.infer<typeof TipoAlertaCaixa>

/**
 * Alerta — RN-F21 e RN-F22.
 *
 * Derivado da projeção a cada leitura, nunca gravado: o saldo negativo de terça
 * deixa de existir quando o recebimento de segunda entra, e nada avisaria a linha
 * gravada.
 */
export const AlertaCaixa = z.object({
  tipo: TipoAlertaCaixa,
  dia: Data,
  valor: Dinheiro,
  detalhe: z.string(),
})
export type AlertaCaixa = z.infer<typeof AlertaCaixa>

/**
 * Cenário de caixa.
 *
 * `percentual_inadimplencia` se aplica **só a entradas** (RN-F20). Aplicá-lo às
 * saídas faria o cenário pessimista deixar a operação mais otimista sobre a
 * própria dívida — o inverso de um teste de estresse, e um erro que passa porque
 * o saldo do dia continua parecendo razoável.
 */
export const CenarioCaixa = z.object({
  id: Uuid,
  nome: z.string(),
  percentual_inadimplencia: z.number().min(0).max(100),
  /** Limiar de concentração de saídas num único dia, em % da janela — RN-F22. */
  limiar_concentracao: z.number().positive().max(100),
  /** Um só por locatário: dois fariam o painel abrir diferente para duas pessoas. */
  padrao: z.boolean(),
  version: z.number().int().positive(),
})
export type CenarioCaixa = z.infer<typeof CenarioCaixa>

export const CriarCenarioCaixa = z.object({
  nome: z.string().trim().min(2).max(60),
  percentual_inadimplencia: z.number().min(0).max(100).default(0),
  limiar_concentracao: z.number().positive().max(100).default(40),
  padrao: z.boolean().default(false),
})
export type CriarCenarioCaixa = z.infer<typeof CriarCenarioCaixa>

/**
 * Janela da projeção.
 *
 * Dias, não datas soltas: a tela oferece 30/60/90/180, e a janela é sempre a
 * partir de hoje. Aceitar `de` e `ate` livres permitiria projetar o passado, onde
 * "previsto" não quer dizer nada — o passado tem extrato.
 */
export const JANELAS_CAIXA = [30, 60, 90, 180] as const

export const ConsultarProjecao = z.object({
  dias: z.coerce.number().int().refine((d) => (JANELAS_CAIXA as readonly number[]).includes(d), {
    message: `a janela deve ser uma de ${JANELAS_CAIXA.join(', ')} dias`,
  }),
  cenario_id: Uuid.optional(),
  conta_id: Uuid.optional(),
  filial_id: Uuid.optional(),
  centro_custo_id: Uuid.optional(),
})
export type ConsultarProjecao = z.infer<typeof ConsultarProjecao>

/**
 * A projeção com o resumo da janela.
 *
 * `menor_saldo` e `dia_menor_saldo` vêm juntos porque a pergunta que o painel
 * responde é "em que dia isto aperta", e não "qual o menor número" — o valor sem
 * o dia obrigaria a varrer a série para achar onde ele acontece.
 */
export const Projecao = z.object({
  de: Data,
  ate: Data,
  cenario_id: Uuid.nullable(),
  cenario_nome: z.string().nullable(),
  saldo_inicial: Dinheiro,
  total_entradas: Dinheiro,
  total_saidas: Dinheiro,
  saldo_final: Dinheiro,
  menor_saldo: Dinheiro,
  dia_menor_saldo: Data.nullable(),
  dias: z.array(DiaProjetado),
})
export type Projecao = z.infer<typeof Projecao>

export const ConsultarAlertas = z.object({
  dias: z.coerce.number().int().refine((d) => (JANELAS_CAIXA as readonly number[]).includes(d), {
    message: `a janela deve ser uma de ${JANELAS_CAIXA.join(', ')} dias`,
  }),
})
export type ConsultarAlertas = z.infer<typeof ConsultarAlertas>
