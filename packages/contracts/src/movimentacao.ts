import { z } from 'zod'
import { DataHora, Paginacao, Uuid } from './primitivos.js'
import { EquipamentoStatus } from './equipamento.js'

/**
 * Movimentação de equipamento — Anexo A.5 e B.2.
 *
 * O razão append-only do ativo: cada linha é um fato, e `equipamento.status` é
 * o efeito do último. É o que transforma o status de campo digitado em
 * consequência de algo que alguém registrou, com data, responsável e romaneio.
 *
 * ## O cliente não escolhe o estado resultante
 *
 * O ponto de autorização deste módulo. `status_resultante` é **derivado do
 * tipo** no servidor, nunca enviado no corpo. Aceitá-lo daria a quem tem
 * `equipamento:movimentar` — que é o perfil de campo, o mais distribuído do
 * sistema — o poder de pôr qualquer ativo em qualquer estado, inclusive
 * `BAIXADO`, que tem permissão própria e muito mais restrita.
 *
 * O tipo descreve o que aconteceu no mundo; o estado é a leitura que o sistema
 * faz disso. Deixar o cliente mandar os dois permite que discordem.
 */
export const MOVIMENTACAO_TIPO = [
  'ENTREGA',
  'RETORNO',
  'TRANSFERENCIA',
  'ENVIO_MANUTENCAO',
  'RETORNO_MANUTENCAO',
  'ENVIO_TERCEIRO',
  'BAIXA',
] as const

export const MovimentacaoTipo = z.enum(MOVIMENTACAO_TIPO)
export type MovimentacaoTipo = z.infer<typeof MovimentacaoTipo>

export const LOCAL_MOVIMENTACAO_TIPO = ['FILIAL', 'LOCAL_OPERACAO', 'TERCEIRO'] as const
export const LocalMovimentacaoTipo = z.enum(LOCAL_MOVIMENTACAO_TIPO)
export type LocalMovimentacaoTipo = z.infer<typeof LocalMovimentacaoTipo>

/**
 * Os tipos que `POST /equipamentos/{id}/movimentacoes` aceita.
 *
 * `TRANSFERENCIA` e `BAIXA` ficam de fora porque têm rota e permissão próprias
 * (`equipamento:transferir`, `equipamento:baixar`). Se entrassem aqui,
 * `equipamento:movimentar` passaria a valer como as duas, e a matriz do Anexo C
 * — que dá movimentação ao técnico de campo e baixa só a diretor e controller —
 * deixaria de descrever o que o sistema faz.
 */
export const MOVIMENTACAO_TIPO_LIVRE = [
  'ENTREGA',
  'RETORNO',
  'ENVIO_MANUTENCAO',
  'RETORNO_MANUTENCAO',
  'ENVIO_TERCEIRO',
] as const

export const Movimentacao = z.object({
  id: Uuid,
  equipamento_id: Uuid,
  equipamento_patrimonio: z.string().nullable(),
  tipo: MovimentacaoTipo,
  origem_tipo: LocalMovimentacaoTipo.nullable(),
  origem_id: Uuid.nullable(),
  destino_tipo: LocalMovimentacaoTipo.nullable(),
  destino_id: Uuid.nullable(),
  contrato_item_id: Uuid.nullable(),
  ordem_servico_id: Uuid.nullable(),
  data_movimento: DataHora,
  responsavel_id: Uuid.nullable(),
  documento_ref: z.string().nullable(),
  observacao: z.string().nullable(),
  status_resultante: EquipamentoStatus,
  aceite_em: DataHora.nullable(),
  aceite_por: Uuid.nullable(),
})

export type Movimentacao = z.infer<typeof Movimentacao>

const Alvo = z.object({
  tipo: LocalMovimentacaoTipo,
  id: Uuid,
})

/**
 * Registro de movimentação.
 *
 * Sem `data_movimento`: o carimbo é do servidor. Aceitá-lo deixaria antedatar
 * uma entrega, e a data de entrega é o que inicia o faturamento (B.2,
 * `EM_TRÂNSITO_ENTREGA → LOCADO`). Quem precisa corrigir uma data registra
 * movimentação de correção — que é visível — em vez de reescrever a original.
 */
export const RegistrarMovimentacao = z.object({
  tipo: z.enum(MOVIMENTACAO_TIPO_LIVRE),
  origem: Alvo.nullish(),
  destino: Alvo.nullish(),
  contrato_item_id: Uuid.nullish(),
  ordem_servico_id: Uuid.nullish(),
  documento_ref: z.string().trim().max(60).nullish(),
  observacao: z.string().trim().max(500).nullish(),
})

export type RegistrarMovimentacao = z.infer<typeof RegistrarMovimentacao>

/**
 * Transferência entre filiais (RN-005).
 *
 * Nasce pendente: o ativo sai da origem e só conta no destino depois do aceite.
 * Enquanto pendente ele está `EM_TRANSITO_ENTREGA`, que a guarda de alocação da
 * 0005 recusa — é isso que impede dois lugares contarem o mesmo ativo enquanto
 * ele está na estrada.
 */
export const TransferirEquipamento = z.object({
  destino_filial_id: Uuid,
  documento_ref: z.string().trim().max(60).nullish(),
  observacao: z.string().trim().max(500).nullish(),
})

export type TransferirEquipamento = z.infer<typeof TransferirEquipamento>

/**
 * Baixa patrimonial (RN-007).
 *
 * Motivo obrigatório e legível pela mesma razão das saídas de contrato: a baixa
 * tira o ativo do balanço, é irreversível no fluxo normal, e é a linha que
 * alguém vai auditar. "ok" não explica nada seis meses depois.
 */
export const BaixarEquipamento = z.object({
  motivo: z.string().trim().min(10, 'descreva o motivo da baixa'),
})

export type BaixarEquipamento = z.infer<typeof BaixarEquipamento>

export const ListarMovimentacoes = Paginacao.extend({
  tipo: MovimentacaoTipo.optional(),
  desde: DataHora.optional(),
})

export type ListarMovimentacoes = z.infer<typeof ListarMovimentacoes>

export const ListarTransferenciasPendentes = Paginacao.extend({
  destino_filial_id: Uuid.optional(),
})

export type ListarTransferenciasPendentes = z.infer<typeof ListarTransferenciasPendentes>

/**
 * Edição patrimonial — `equipamento:patrimonial_editar` (Anexo C §C.4).
 *
 * Separada de `equipamento:editar` porque quem cadastra um ativo não é quem
 * decide quanto ele vale no imobilizado. Estes campos entram na depreciação, e
 * a depreciação entra no resultado.
 */
export const EditarPatrimonial = z.object({
  valor_aquisicao: z.string().regex(/^\d+(\.\d{1,4})?$/, 'valor com até 4 casas').nullish(),
  data_aquisicao: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'data no formato AAAA-MM-DD')
    .nullish(),
  nota_fiscal: z.string().trim().max(60).nullish(),
  vida_util_meses: z.number().int().min(1).max(600).nullish(),
  valor_residual: z.string().regex(/^\d+(\.\d{1,4})?$/, 'valor com até 4 casas').nullish(),
})

export type EditarPatrimonial = z.infer<typeof EditarPatrimonial>

/**
 * Edição cadastral — `equipamento:editar`.
 *
 * Sem `patrimonio`: ele identifica o ativo dentro do locatário e aparece na
 * etiqueta colada na máquina. Trocá-lo por API desvincularia o bem físico do
 * registro sem que ninguém percebesse; a correção de um patrimônio errado é
 * baixa e recadastro, que deixam rastro.
 */
export const EditarEquipamento = z.object({
  numero_serie: z.string().trim().max(80).nullish(),
  modelo_id: Uuid.optional(),
  categoria_id: Uuid.optional(),
  filial_id: Uuid.optional(),
  ano_fabricacao: z.number().int().min(1980).max(2100).nullish(),
})

export type EditarEquipamento = z.infer<typeof EditarEquipamento>
