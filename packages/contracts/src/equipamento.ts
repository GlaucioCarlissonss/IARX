import { z } from 'zod'
import { Contador, DataHora, Dinheiro, Paginacao, Uuid } from './primitivos.js'

/**
 * Equipamento — Anexo A.3 e B.2.
 *
 * O status não é um campo que se edita: é a projeção da última movimentação
 * válida (Anexo B.2). Por isso não existe `PATCH /equipamentos/{id}` com
 * `status` no corpo; existem ações (`/bloquear`, `/movimentar`) que a máquina
 * de estados aceita ou recusa.
 */
export const EQUIPAMENTO_STATUS = [
  'DISPONIVEL',
  'RESERVADO',
  'EM_TRANSITO_ENTREGA',
  'LOCADO',
  'EM_TRANSITO_RETORNO',
  'EM_INSPECAO',
  'EM_MANUTENCAO',
  'BLOQUEADO',
  'EXTRAVIADO',
  'BAIXADO',
] as const

export const EquipamentoStatus = z.enum(EQUIPAMENTO_STATUS)
export type EquipamentoStatus = z.infer<typeof EquipamentoStatus>

export const MEDIDOR_TIPO = ['HORIMETRO', 'CONTADOR', 'ODOMETRO', 'DIAS'] as const
export const MedidorTipo = z.enum(MEDIDOR_TIPO)

export const Equipamento = z.object({
  id: Uuid,
  patrimonio: z.string(),
  numero_serie: z.string().nullable(),
  modelo_id: Uuid,
  modelo_nome: z.string().nullable(),
  fabricante_nome: z.string().nullable(),
  categoria_id: Uuid,
  filial_id: Uuid,
  status: EquipamentoStatus,
  motivo_indisponibilidade: z.string().nullable(),
  /**
   * Bloqueio é campo próprio, e não um `status`, porque é ortogonal: um ativo
   * instalado no cliente pode estar bloqueado para nova alocação e continuar
   * LOCADO. Colapsar os dois em um enum perderia justamente esse caso — que é o
   * que mais custa dinheiro quando passa despercebido.
   */
  bloqueado: z.boolean(),
  bloqueio_motivo: z.string().nullable(),
  bloqueio_ate: DataHora.nullable(),
  valor_aquisicao: Dinheiro.nullable(),
  created_at: DataHora,
  version: z.number().int(),
})

export type Equipamento = z.infer<typeof Equipamento>

/**
 * Filtros de listagem. `tenant_id` **não** aparece aqui, e não é acidente:
 * RN-028 exige que o tenant venha do token. Aceitá-lo por query seria oferecer
 * ao cliente o parâmetro exato que permite ler dados de outra empresa.
 */
export const ListarEquipamentos = Paginacao.extend({
  status: EquipamentoStatus.optional(),
  filial_id: Uuid.optional(),
  categoria_id: Uuid.optional(),
  bloqueado: z
    .enum(['0', '1'])
    .transform((v) => v === '1')
    .optional(),
  q: z.string().min(1).max(60).optional().describe('patrimônio ou número de série, busca parcial'),
  livre_em: DataHora.optional().describe('exclui ativos com alocação ocupante vigente no instante informado'),
})

export type ListarEquipamentos = z.infer<typeof ListarEquipamentos>

/**
 * Cadastro de um ativo.
 *
 * Sem `status`: o equipamento nasce `DISPONIVEL`, que é o default do banco. O
 * status muda por ação — `/bloquear`, alocação em contrato, movimentação — e
 * aceitá-lo aqui daria a `equipamento:criar` o poder de pôr um ativo em LOCADO
 * sem contrato nenhum por trás, que é o estado que ninguém consegue explicar
 * depois.
 *
 * Sem `bloqueado` pela mesma razão, e sem os campos patrimoniais (valor de
 * aquisição, vida útil, depreciação): eles têm permissão própria,
 * `equipamento:patrimonial_editar`, porque quem cadastra um ativo não é quem
 * decide quanto ele vale no imobilizado (Anexo C §C.4).
 */
export const CriarEquipamento = z.object({
  patrimonio: z.string().trim().min(1).max(60),
  numero_serie: z.string().trim().max(80).nullish(),
  modelo_id: Uuid,
  categoria_id: Uuid,
  filial_id: Uuid,
  ano_fabricacao: z.number().int().min(1980).max(2100).nullish(),
})
export type CriarEquipamento = z.infer<typeof CriarEquipamento>

export const BloquearEquipamento = z.object({
  motivo: z.string().min(5, 'o motivo do bloqueio é obrigatório e precisa ser legível'),
  ate: DataHora.nullable().default(null),
})

export const RegistrarLeitura = z.object({
  valor: Contador,
  medido_em: DataHora,
  origem: z.enum(['MANUAL', 'TELEMETRIA', 'OS', 'IMPORTACAO']).default('MANUAL'),
  evidencia_url: z.string().url().optional(),
})
