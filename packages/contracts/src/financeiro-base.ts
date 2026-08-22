import { z } from 'zod'
import { Data, DataHora, Dinheiro, Paginacao, Uuid } from './primitivos.js'

/**
 * Centro de custo e conta bancária — a base do bloco financeiro.
 *
 * Duas entidades sem nenhuma regra de negócio própria interessante, e é
 * justamente por isso que elas vêm primeiro: todo título a pagar ou a receber
 * referencia um centro de custo, e toda baixa referencia uma conta. Sem as
 * duas, os módulos seguintes precisariam de um lugar temporário — e um lugar
 * temporário num banco relacional é uma FK que depois não se remove.
 */

/* ------------------------------------------------------- centro de custo */

export const CentroCusto = z.object({
  id: Uuid,
  /** Nulo = centro global do locatário, o caso comum de "Administrativo". */
  empresa_id: Uuid.nullable(),
  codigo: z.string(),
  nome: z.string(),
  descricao: z.string().nullable(),
  centro_pai_id: Uuid.nullable(),
  /**
   * Profundidade calculada, 1 a 3. Vem do servidor porque a árvore pode chegar
   * ao cliente paginada, e um nó sem os ancestrais na mesma página não tem como
   * saber em que nível está.
   */
  nivel: z.number().int().min(1).max(3),
  ativo: z.boolean(),
  version: z.number().int().positive(),
})
export type CentroCusto = z.infer<typeof CentroCusto>

export const ListarCentrosCusto = Paginacao.extend({
  /** Só os ativos — o padrão de quem está escolhendo um centro para lançar. */
  apenas_ativos: z.coerce.boolean().optional(),
  empresa_id: Uuid.optional(),
})
export type ListarCentrosCusto = z.infer<typeof ListarCentrosCusto>

export const CriarCentroCusto = z.object({
  codigo: z.string().trim().min(1).max(30),
  nome: z.string().trim().min(1).max(120),
  descricao: z.string().trim().max(500).optional(),
  empresa_id: Uuid.nullish(),
  centro_pai_id: Uuid.nullish(),
})
export type CriarCentroCusto = z.infer<typeof CriarCentroCusto>

/**
 * Editar não aceita `centro_pai_id`.
 *
 * Mover um nó move a subárvore inteira debaixo dele, e com isso pode empurrar
 * netos para um quarto nível que não existe. Enquanto não houver uma ação
 * própria de "mover" — que mostre o que vai acontecer antes de acontecer —,
 * o campo fica fora: a alternativa seria a recusa do gatilho chegando como
 * surpresa depois do clique em salvar.
 */
export const EditarCentroCusto = z.object({
  codigo: z.string().trim().min(1).max(30).optional(),
  nome: z.string().trim().min(1).max(120).optional(),
  descricao: z.string().trim().max(500).nullish(),
})
export type EditarCentroCusto = z.infer<typeof EditarCentroCusto>

/* ------------------------------------------------------- conta bancária */

export const CONTA_TIPO = ['CORRENTE', 'POUPANCA', 'PAGAMENTO'] as const
export const ContaTipo = z.enum(CONTA_TIPO)
export type ContaTipo = z.infer<typeof ContaTipo>

export const CONTA_STATUS = ['ATIVA', 'INATIVA', 'BLOQUEADA'] as const
export const ContaStatus = z.enum(CONTA_STATUS)
export type ContaStatus = z.infer<typeof ContaStatus>

/**
 * Código do banco como texto de três dígitos, não número.
 *
 * `001` é o Banco do Brasil, e `1` não é a mesma coisa. Guardado como número, o
 * zero à esquerda desaparece na primeira serialização e volta como banco
 * inexistente.
 */
export const BancoCodigo = z.string().regex(/^[0-9]{3}$/, 'código FEBRABAN de três dígitos')

export const ContaBancaria = z.object({
  id: Uuid,
  empresa_id: Uuid,
  banco_codigo: BancoCodigo,
  agencia: z.string(),
  numero: z.string(),
  tipo: ContaTipo,
  apelido: z.string(),
  saldo_inicial: Dinheiro,
  data_saldo_inicial: Data,
  limite_credito: Dinheiro.nullable(),
  status: ContaStatus,
  /**
   * Derivado das movimentações, nunca gravado. Não há coluna correspondente no
   * banco — é o que garante que saldo e extrato não divergem.
   */
  saldo_atual: Dinheiro,
  version: z.number().int().positive(),
})
export type ContaBancaria = z.infer<typeof ContaBancaria>

export const ListarContasBancarias = Paginacao.extend({
  status: ContaStatus.optional(),
  empresa_id: Uuid.optional(),
})
export type ListarContasBancarias = z.infer<typeof ListarContasBancarias>

export const CriarContaBancaria = z.object({
  empresa_id: Uuid,
  banco_codigo: BancoCodigo,
  agencia: z.string().trim().min(1).max(10),
  numero: z.string().trim().min(1).max(20),
  tipo: ContaTipo,
  apelido: z.string().trim().min(1).max(60),
  saldo_inicial: Dinheiro,
  data_saldo_inicial: Data,
  limite_credito: Dinheiro.nullish(),
})
export type CriarContaBancaria = z.infer<typeof CriarContaBancaria>

export const EditarContaBancaria = z.object({
  apelido: z.string().trim().min(1).max(60).optional(),
  limite_credito: Dinheiro.nullish(),
  status: ContaStatus.optional(),
})
export type EditarContaBancaria = z.infer<typeof EditarContaBancaria>

/* ---------------------------------------------------------- movimentação */

/**
 * Valor monetário estritamente positivo.
 *
 * `Dinheiro` é **string** de propósito: a fronteira carrega a representação
 * decimal exata, e a conversão para decimal acontece num lado só, no banco.
 * Comparar com zero, então, exige converter — e converter aqui é seguro porque
 * o que se decide é apenas o sinal, não o valor: nenhum arredondamento de
 * ponto flutuante muda o sinal de um decimal com quatro casas.
 */
const DinheiroPositivo = Dinheiro.refine((v) => Number(v) > 0, 'o valor tem de ser positivo')


export const MOVIMENTO_TIPO = [
  'ENTRADA',
  'SAIDA',
  'TRANSFERENCIA_ENTRADA',
  'TRANSFERENCIA_SAIDA',
  'TAXA',
] as const
export const MovimentoTipo = z.enum(MOVIMENTO_TIPO)
export type MovimentoTipo = z.infer<typeof MovimentoTipo>

export const MovimentacaoBancaria = z.object({
  id: Uuid,
  conta_id: Uuid,
  tipo: MovimentoTipo,
  /** Sempre positivo. O sinal é o tipo — ver a restrição na migração 0017. */
  valor: Dinheiro,
  data_movimento: Data,
  descricao: z.string(),
  transferencia_par_id: Uuid.nullable(),
  estorna_id: Uuid.nullable(),
  motivo: z.string().nullable(),
  conciliado: z.boolean(),
  conciliado_em: DataHora.nullable(),
  created_at: DataHora,
})
export type MovimentacaoBancaria = z.infer<typeof MovimentacaoBancaria>

export const ListarExtrato = Paginacao.extend({
  de: Data.optional(),
  ate: Data.optional(),
  tipo: MovimentoTipo.optional(),
  /** A fila de conciliação: só o que ainda não foi conferido com o extrato. */
  pendente_conciliacao: z.coerce.boolean().optional(),
})
export type ListarExtrato = z.infer<typeof ListarExtrato>

/**
 * Lançamento manual: só ENTRADA, SAIDA e TAXA.
 *
 * Os dois tipos de transferência ficam fora de propósito. Criá-los por aqui
 * produziria uma perna sem par — metade de uma transferência, saindo de uma
 * conta e não entrando em nenhuma. A transferência tem endpoint próprio, que
 * gera as duas pernas numa chamada.
 */
export const LancarMovimentacao = z.object({
  tipo: z.enum(['ENTRADA', 'SAIDA', 'TAXA']),
  valor: DinheiroPositivo,
  data_movimento: Data,
  descricao: z.string().trim().min(1).max(200),
})
export type LancarMovimentacao = z.infer<typeof LancarMovimentacao>

export const Transferir = z
  .object({
    conta_origem_id: Uuid,
    conta_destino_id: Uuid,
    valor: DinheiroPositivo,
    data_movimento: Data,
    descricao: z.string().trim().min(1).max(200),
  })
  .refine((d) => d.conta_origem_id !== d.conta_destino_id, {
    message: 'origem e destino têm de ser contas distintas',
    path: ['conta_destino_id'],
  })
export type Transferir = z.infer<typeof Transferir>

export const EstornarMovimentacao = z.object({
  /** Obrigatório: estorno sem motivo é um lançamento que ninguém explica depois. */
  motivo: z.string().trim().min(5).max(500),
})
export type EstornarMovimentacao = z.infer<typeof EstornarMovimentacao>
