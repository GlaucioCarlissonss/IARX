import { z } from 'zod'
import { DataHora, Dinheiro, Paginacao, Uuid } from './primitivos.js'

/**
 * `MNT` — manutenção.
 *
 * A ordem de serviço é a única entidade desta base cujo **ciclo de vida** é o
 * produto: contrato tem estados, nota fiscal tem estados, mas a OS *é* a
 * sequência de estados. Por isso a API expõe transições como ações nomeadas —
 * `triar`, `agendar`, `concluir` — e não um `PATCH status`.
 *
 * A diferença é a de sempre nesta API, e aqui ela pesa mais: a ação obriga a
 * trazer o que aquela transição exige — técnico e data para agendar, causa raiz
 * e tempo para concluir —, a permissão fica granular (`os:agendar` não é
 * `os:concluir`), e a auditoria registra a intenção em vez de um diff de
 * coluna que ninguém consegue julgar depois.
 *
 * A máquina em si mora no banco (Anexo B.3, gatilho `os_transicao`). Esta
 * camada não a repete: quem tentar uma transição ilegal recebe a recusa do
 * gatilho, igual à importação e à correção manual.
 */

export const OsStatus = z.enum([
  'ABERTA',
  'TRIAGEM',
  'AGENDADA',
  'EM_EXECUCAO',
  'AGUARDANDO_PECA',
  'CONCLUIDA',
  'VALIDADA',
  'CANCELADA',
])
export type OsStatus = z.infer<typeof OsStatus>

export const OsTipo = z.enum(['CORRETIVA', 'PREVENTIVA', 'INSPECAO', 'MELHORIA', 'SINISTRO'])
export type OsTipo = z.infer<typeof OsTipo>

export const OsOrigem = z.enum(['INTERNA', 'CLIENTE', 'PREVENTIVA_AUTO', 'CHECKLIST', 'API', 'TELEMETRIA'])
export type OsOrigem = z.infer<typeof OsOrigem>

export const OsPrioridade = z.enum(['BAIXA', 'MEDIA', 'ALTA', 'CRITICA'])
export type OsPrioridade = z.infer<typeof OsPrioridade>

export const OsResponsabilidade = z.enum(['LOCADORA', 'CLIENTE', 'TERCEIRO', 'DESGASTE_NATURAL'])
export type OsResponsabilidade = z.infer<typeof OsResponsabilidade>

export const OsPausaMotivo = z.enum([
  'AGUARDANDO_PECA',
  'ACESSO_NEGADO',
  'APROVACAO_CLIENTE',
  'APROVACAO_INTERNA',
])
export type OsPausaMotivo = z.infer<typeof OsPausaMotivo>

export const Tecnico = z.object({
  id: Uuid,
  usuario_id: Uuid.nullable(),
  nome: z.string(),
  matricula: z.string().nullable(),
  filial_id: Uuid.nullable(),
  especialidades: z.array(z.string()),
  custo_hora: Dinheiro.nullable(),
  ativo: z.boolean(),
})
export type Tecnico = z.infer<typeof Tecnico>

export const OrdemServico = z.object({
  id: Uuid,
  numero: z.string(),
  equipamento_id: Uuid,
  filial_id: Uuid.nullable(),
  tipo: OsTipo,
  origem: OsOrigem,
  status: OsStatus,
  prioridade: OsPrioridade,
  contrato_id: Uuid.nullable(),
  cliente_id: Uuid.nullable(),
  local_operacao_id: Uuid.nullable(),
  descricao: z.string(),
  causa_raiz: z.string().nullable(),
  solucao: z.string().nullable(),
  tecnico_responsavel_id: Uuid.nullable(),
  abertura_em: DataHora,
  prazo_resposta_em: DataHora.nullable(),
  resposta_em: DataHora.nullable(),
  prazo_solucao_em: DataHora.nullable(),
  inicio_execucao_em: DataHora.nullable(),
  conclusao_em: DataHora.nullable(),
  validacao_em: DataHora.nullable(),
  validado_por: Uuid.nullable(),
  tempo_pausado_minutos: z.number().int(),
  impacta_disponibilidade: z.boolean(),
  causa_responsabilidade: OsResponsabilidade.nullable(),
  custo_mao_obra: Dinheiro,
  custo_material: Dinheiro,
  custo_terceiros: Dinheiro,
  custo_deslocamento: Dinheiro,
  /** Derivado no banco: soma das quatro parcelas, sem caminho de escrita. */
  custo_total: Dinheiro,
  os_origem_id: Uuid.nullable(),
})
export type OrdemServico = z.infer<typeof OrdemServico>

export const AbrirOs = z.object({
  equipamento_id: Uuid,
  tipo: OsTipo.default('CORRETIVA'),
  origem: OsOrigem.default('INTERNA'),
  prioridade: OsPrioridade.default('MEDIA'),
  /**
   * O sintoma, por extenso e com piso de tamanho.
   *
   * "não funciona" não é chamado: é um pedido para alguém ir descobrir o que
   * houve. O piso não garante qualidade, mas impede o campo de virar
   * formalidade de um caractere — e quem precisa escrever quinze costuma
   * escrever o que viu.
   */
  descricao: z.string().trim().min(15, 'descreva o sintoma observado'),
  contrato_id: Uuid.nullish(),
  cliente_id: Uuid.nullish(),
  local_operacao_id: Uuid.nullish(),
  impacta_disponibilidade: z.boolean().default(true),
})
export type AbrirOs = z.infer<typeof AbrirOs>

export const TriarOs = z.object({
  tipo: OsTipo,
  prioridade: OsPrioridade,
  /** Prazos calculados na triagem — é o que inicia o SLA de solução. */
  prazo_resposta_em: DataHora.nullish(),
  prazo_solucao_em: DataHora.nullish(),
})
export type TriarOs = z.infer<typeof TriarOs>

export const AgendarOs = z.object({
  tecnico_id: Uuid,
  prazo_solucao_em: DataHora.nullish(),
})
export type AgendarOs = z.infer<typeof AgendarOs>

export const ConcluirOs = z.object({
  /**
   * Causa raiz obrigatória.
   *
   * É o campo que separa manutenção de troca de peça: sem ele, a mesma máquina
   * volta com o mesmo defeito e ninguém consegue mostrar que já voltou. É
   * também o que alimenta a reincidência, que é o único indicador que
   * distingue um reparo de um remendo.
   */
  causa_raiz: z.string().trim().min(10, 'descreva a causa raiz'),
  solucao: z.string().trim().min(10, 'descreva o que foi feito'),
  causa_responsabilidade: OsResponsabilidade,
  custo_mao_obra: Dinheiro.optional(),
  custo_material: Dinheiro.optional(),
  custo_terceiros: Dinheiro.optional(),
  custo_deslocamento: Dinheiro.optional(),
})
export type ConcluirOs = z.infer<typeof ConcluirOs>

export const CancelarOs = z.object({
  motivo: z.string().trim().min(10, 'descreva o motivo do cancelamento'),
})
export type CancelarOs = z.infer<typeof CancelarOs>

export const PausarOs = z.object({
  motivo: OsPausaMotivo,
  justificativa: z.string().trim().min(10, 'justifique a pausa'),
})
export type PausarOs = z.infer<typeof PausarOs>

/**
 * Atribuição de técnico — `os:atribuir`.
 *
 * Separada de `agendar` porque o Anexo C as põe em mãos possivelmente
 * diferentes: quem despacha decide **quem vai**, e a janela de atendimento
 * pode ser negociada depois com o cliente. Colapsar as duas obrigaria a
 * escolher a data para trocar o técnico de uma ordem já agendada.
 */
export const AtribuirOs = z.object({
  tecnico_id: Uuid,
  observacao: z.string().trim().max(300).optional(),
})
export type AtribuirOs = z.infer<typeof AtribuirOs>

/**
 * Reabertura — `os:reabrir`.
 *
 * Não reabre a ordem validada: **cria uma nova**, vinculada à original por
 * `os_origem_id` (Anexo B.3, `VALIDADA → ABERTA (nova OS)`). A ordem original
 * guarda o custo e o tempo do primeiro atendimento; reescrevê-la faria duas
 * visitas virarem uma, e o indicador de reincidência — que é o que diz se o
 * conserto resolveu — deixaria de existir por construção.
 */
export const ReabrirOs = z.object({
  motivo: z.string().trim().min(10, 'descreva a reincidência'),
  descricao: z.string().trim().min(5).optional().describe('quando omitida, repete a da original'),
  prioridade: OsPrioridade.optional(),
})
export type ReabrirOs = z.infer<typeof ReabrirOs>

export const ListarOs = Paginacao.extend({
  status: OsStatus.optional(),
  tipo: OsTipo.optional(),
  equipamento_id: Uuid.optional(),
  cliente_id: Uuid.optional(),
  tecnico_id: Uuid.optional(),
  /**
   * A fila que importa: o que vence antes de agora mais a janela.
   *
   * Não é "atrasada" — é **em risco**, que é a pergunta que muda a ação. Uma
   * lista do que já estourou serve para explicar o mês passado; uma lista do
   * que vai estourar serve para impedir.
   */
  sla_em_risco_horas: z.coerce.number().int().min(1).max(720).optional(),
})
export type ListarOs = z.infer<typeof ListarOs>
