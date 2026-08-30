import { z } from 'zod'
import { Data, Dinheiro, Documento, Paginacao, Uuid } from './primitivos.js'

/**
 * Cliente — a contraparte do contrato de locação.
 *
 * Duas decisões de fronteira que o resto do arquivo pressupõe.
 *
 * **O crédito não entra por `PATCH`.** Limite e situação têm rota própria
 * (`PUT /clientes/{id}/credito`) e permissão própria (`cliente:credito_definir`),
 * separada de `cliente:editar`. Quem corrige um nome fantasia não é quem libera
 * cem mil reais de exposição, e um `PATCH` genérico tornaria as duas coisas a
 * mesma autorização. É a mesma razão pela qual bloquear equipamento é ação e
 * não campo (Anexo D.1).
 *
 * **O grupo econômico é derivado, não digitado.** `cnpj_raiz` é coluna gerada
 * pelo banco a partir dos oito primeiros dígitos do CNPJ, e é ela que costura
 * matriz e filiais em `app.clientes_visiveis()`. Aceitar a raiz por HTTP abriria
 * a porta para um cliente declarar-se do grupo de outro.
 */

export const SITUACAO_CREDITO = ['LIBERADO', 'OBSERVACAO', 'BLOQUEADO'] as const
export const SituacaoCredito = z.enum(SITUACAO_CREDITO)
export type SituacaoCredito = z.infer<typeof SituacaoCredito>

export const TIPO_PESSOA = ['PF', 'PJ'] as const
export const TipoPessoa = z.enum(TIPO_PESSOA)
export type TipoPessoa = z.infer<typeof TipoPessoa>

export const Cliente = z.object({
  id: Uuid,
  tipo_pessoa: TipoPessoa,
  documento: Documento,
  razao_social: z.string(),
  nome_fantasia: z.string().nullable(),
  inscricao_estadual: z.string().nullable(),
  inscricao_municipal: z.string().nullable(),
  limite_credito: Dinheiro.nullable(),
  situacao_credito: SituacaoCredito,
  filial_responsavel_id: Uuid.nullable(),
  grupo_economico_id: Uuid.nullable(),
  /** Oito primeiros dígitos do CNPJ, calculados pelo banco. Nulo para CPF. */
  cnpj_raiz: z.string().nullable(),
  version: z.number().int(),
})
export type Cliente = z.infer<typeof Cliente>

export const ListarClientes = Paginacao.extend({
  /** Prefixo do documento — o jeito como se procura um CNPJ que se lembra pela metade. */
  documento: z.string().regex(/^\d{1,14}$/).optional(),
  situacao_credito: SituacaoCredito.optional(),
  filial_id: Uuid.optional(),
  /** Busca por razão social ou nome fantasia, sem distinção de acento nem caixa. */
  q: z.string().trim().min(2).max(120).optional(),
})
export type ListarClientes = z.infer<typeof ListarClientes>

export const CriarCliente = z.object({
  tipo_pessoa: TipoPessoa.default('PJ'),
  documento: Documento,
  razao_social: z.string().trim().min(1).max(200),
  nome_fantasia: z.string().trim().max(200).nullish(),
  inscricao_estadual: z.string().trim().max(30).nullish(),
  inscricao_municipal: z.string().trim().max(30).nullish(),
  filial_responsavel_id: Uuid.nullish(),
  /*
   * Sem `limite_credito` nem `situacao_credito`.
   *
   * Um cliente nasce em LIBERADO sem limite, que é o default do banco. Aceitar
   * os dois aqui deixaria `cliente:criar` conceder crédito sem passar por
   * `cliente:credito_definir` — a permissão existiria e seria contornável pelo
   * cadastro.
   */
})
export type CriarCliente = z.infer<typeof CriarCliente>

/**
 * Atualização parcial. O documento não está aqui de propósito: trocar o CNPJ de
 * um cliente com contratos ativos não é edição, é outro cliente.
 */
export const AtualizarCliente = z
  .object({
    razao_social: z.string().trim().min(1).max(200),
    nome_fantasia: z.string().trim().max(200).nullable(),
    inscricao_estadual: z.string().trim().max(30).nullable(),
    inscricao_municipal: z.string().trim().max(30).nullable(),
    filial_responsavel_id: Uuid.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'informe ao menos um campo' })
export type AtualizarCliente = z.infer<typeof AtualizarCliente>

/**
 * Crédito: limite e situação juntos, e com motivo.
 *
 * `PUT` e não `PATCH` porque os dois campos são uma decisão só — subir o limite
 * e manter BLOQUEADO é quase sempre engano, e separá-los em duas chamadas
 * deixaria o cliente num estado intermediário que ninguém quis.
 *
 * O motivo é obrigatório: a trilha de auditoria guarda o diff das colunas, e um
 * diff de `limite_credito` não diz se foi renegociação, análise de risco ou
 * erro corrigido.
 */
export const DefinirCredito = z.object({
  limite_credito: Dinheiro.nullable(),
  situacao_credito: SituacaoCredito,
  motivo: z.string().trim().min(3).max(500),
})
export type DefinirCredito = z.infer<typeof DefinirCredito>

export const CriarLocalOperacao = z.object({
  nome: z.string().trim().min(1).max(200),
  codigo: z.string().trim().max(40).nullish(),
  endereco: z.record(z.unknown()).default({}),
  responsavel: z.string().trim().max(200).nullish(),
  janela_acesso: z.string().trim().max(200).nullish(),
  restricoes: z.string().trim().max(2000).nullish(),
  /*
   * Sem coordenada. Ela entra por `POST /locais/{id}/localizacao`, que exige
   * precisão e fonte — a proveniência que o Anexo O trata como parte do dado.
   */
})
export type CriarLocalOperacao = z.infer<typeof CriarLocalOperacao>

/**
 * Visão 360 — o que se sabe sobre um cliente, num lugar só.
 *
 * O Anexo D §D.2 pede "contratos, ativos, faturas, OS, rentabilidade". Este
 * esquema entrega os três primeiros e **declara a ausência dos outros dois**,
 * em vez de devolver zeros que passariam por resposta:
 *
 *  · **OS** não existe — não há tabela de ordem de serviço no banco (o módulo
 *    de manutenção não foi construído);
 *  · **rentabilidade** não é derivável — o custo é rateado por centro de custo
 *    em `titulo_pagar_rateio`, e não há caminho de um título de despesa até um
 *    cliente. Inventar um seria fabricar o número mais consequente da tela.
 *
 * Ambas estão registradas no Anexo L. Quando as fontes existirem, os campos
 * entram aqui — e até lá `ausentes` diz a quem consome por que o número não veio.
 */
export const Visao360 = z.object({
  cliente: Cliente,
  contratos: z.object({
    total: z.number().int(),
    ativos: z.number().int(),
    proximo_vencimento: Data.nullable(),
  }),
  parque: z.object({
    total: z.number().int(),
    /** Quantos equipamentos por status, só os status presentes. */
    por_status: z.record(z.number().int()),
  }),
  cobranca: z.object({
    em_aberto: Dinheiro,
    vencido: Dinheiro,
    /** Títulos vencidos há mais de 30 dias — o corte que muda a conversa. */
    vencido_mais_30: Dinheiro,
  }),
  ausentes: z.array(z.object({ campo: z.string(), motivo: z.string() })),
})
export type Visao360 = z.infer<typeof Visao360>
