import { z } from 'zod'
import { Data, DataHora, Dinheiro, Paginacao, Uuid } from './primitivos.js'

/** Contrato — Anexo B.1. */
export const CONTRATO_STATUS = [
  'RASCUNHO',
  'EM_APROVACAO',
  'AGUARDANDO_ASSINATURA',
  'ATIVO',
  'SUSPENSO',
  'EM_RENOVACAO',
  'VENCIDO_EM_CAMPO',
  'ENCERRADO',
  'CANCELADO',
  'DISTRATADO',
] as const

export const ContratoStatus = z.enum(CONTRATO_STATUS)
export type ContratoStatus = z.infer<typeof ContratoStatus>

export const CONTRATO_ITEM_STATUS = [
  'PLANEJADO',
  'RESERVADO',
  'EM_ENTREGA',
  'ATIVO',
  'SUSPENSO',
  'EM_DEVOLUCAO',
  'ENCERRADO',
  'SUBSTITUIDO',
  'CANCELADO',
] as const

export const ContratoItemStatus = z.enum(CONTRATO_ITEM_STATUS)

/**
 * Estados em que o item **ocupa** o equipamento.
 *
 * Espelha o predicado da exclusion constraint `ci_sem_sobreposicao`. Duplicação
 * consciente e comentada nos dois lados: a lista aqui só serve para explicar o
 * conflito ao usuário; quem impede a escrita inválida é o banco.
 */
export const STATUS_OCUPANTES = ['RESERVADO', 'EM_ENTREGA', 'ATIVO', 'SUSPENSO', 'EM_DEVOLUCAO'] as const

export const MODALIDADE_COBRANCA = [
  'FIXO_MENSAL',
  'POR_MEDICAO',
  'FRANQUIA_EXCEDENTE',
  'DIARIA',
  'HORA_EFETIVA',
  'ESCALONADO_VOLUME',
  'MISTO',
] as const

export const ModalidadeCobranca = z.enum(MODALIDADE_COBRANCA)
export type ModalidadeCobranca = z.infer<typeof ModalidadeCobranca>

export const Contrato = z.object({
  id: Uuid,
  numero: z.string(),
  cliente_id: Uuid,
  cliente_nome: z.string().nullable(),
  filial_id: Uuid,
  tipo: z.string(),
  status: ContratoStatus,
  /** Vigência do contrato é data civil; a do item é instante. Ver `Data`. */
  data_inicio: Data.nullable(),
  data_fim: Data.nullable(),
  renovacao_automatica: z.boolean(),
  valor_mensal_estimado: Dinheiro.nullable(),
  version: z.number().int(),
})

export type Contrato = z.infer<typeof Contrato>

export const ContratoItem = z.object({
  id: Uuid,
  contrato_id: Uuid,
  equipamento_id: Uuid.nullable(),
  categoria_id: Uuid.nullable(),
  local_operacao_id: Uuid.nullable(),
  modalidade_cobranca: ModalidadeCobranca,
  valor_unitario: Dinheiro,
  quantidade: z.number().positive(),
  franquia_quantidade: z.number().nonnegative().nullable(),
  franquia_escopo: z.enum(['ITEM', 'CONTRATO']).nullable(),
  valor_excedente_unitario: Dinheiro.nullable(),
  valor_minimo_mensal: Dinheiro.nullable(),
  vigencia_inicio: DataHora,
  vigencia_fim: DataHora.nullable(),
  status: ContratoItemStatus,
  version: z.number().int(),
})

export type ContratoItem = z.infer<typeof ContratoItem>

export const ListarContratos = Paginacao.extend({
  status: ContratoStatus.optional(),
  cliente_id: Uuid.optional(),
  filial_id: Uuid.optional(),
  vence_ate: Data.optional().describe('contratos cuja data_fim é menor ou igual à informada'),
  q: z.string().min(1).max(60).optional().describe('número do contrato, busca parcial'),
})

export type ListarContratos = z.infer<typeof ListarContratos>

/**
 * Alocação de equipamento a contrato — o caminho que exercita RN-001.
 *
 * As três validações condicionais abaixo espelham checks do banco
 * (`ci_alvo_definido`, `ci_franquia_completa`, `ci_desconto_com_motivo`). A
 * duplicação é deliberada: aqui ela vira mensagem por campo, com `field`
 * apontando para o input errado; no banco ela é a garantia de que nenhum outro
 * caminho de escrita produz o estado inválido.
 */
export const AlocarItem = z
  .object({
    equipamento_id: Uuid.nullable().default(null),
    categoria_id: Uuid.nullable().default(null),
    local_operacao_id: Uuid.nullable().default(null),
    modalidade_cobranca: ModalidadeCobranca,
    valor_unitario: Dinheiro,
    quantidade: z.number().positive().default(1),
    franquia_quantidade: z.number().nonnegative().nullable().default(null),
    franquia_escopo: z.enum(['ITEM', 'CONTRATO']).nullable().default(null),
    valor_excedente_unitario: Dinheiro.nullable().default(null),
    valor_minimo_mensal: Dinheiro.nullable().default(null),
    desconto_percentual: z.number().min(0).max(100).nullable().default(null),
    desconto_motivo: z.string().min(5).nullable().default(null),
    vigencia_inicio: DataHora,
    vigencia_fim: DataHora.nullable().default(null),
    observacao: z.string().max(500).optional(),
  })
  .refine((v) => v.equipamento_id !== null || v.categoria_id !== null, {
    message: 'informe um equipamento específico ou uma categoria a definir na entrega',
    path: ['equipamento_id'],
  })
  .refine((v) => v.vigencia_fim === null || new Date(v.vigencia_fim) > new Date(v.vigencia_inicio), {
    message: 'o fim da vigência deve ser posterior ao início',
    path: ['vigencia_fim'],
  })
  .refine(
    (v) =>
      v.modalidade_cobranca !== 'FRANQUIA_EXCEDENTE' ||
      (v.franquia_quantidade !== null && v.valor_excedente_unitario !== null && v.franquia_escopo !== null),
    {
      message: 'franquia com excedente exige quantidade, escopo e preço do excedente',
      path: ['franquia_quantidade'],
    },
  )
  .refine((v) => !v.desconto_percentual || v.desconto_motivo !== null, {
    message: 'desconto exige justificativa registrada (RN-009)',
    path: ['desconto_motivo'],
  })

export type AlocarItem = z.infer<typeof AlocarItem>

export const EncerrarItem = z.object({
  encerrado_em: DataHora,
  motivo: z.string().min(5),
})
