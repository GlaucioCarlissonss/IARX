import { z } from 'zod'
import { Data, DataHora, Dinheiro, Paginacao, Uuid } from './primitivos.js'
import { Quantidade } from './estoque.js'

/**
 * Ordem de compra e inventário — Anexo A.7 e D.6.
 *
 * ## Os status são derivados das operações, não transcritos
 *
 * O Anexo A.7 descreve as duas entidades e escreve "status" sem enumerar
 * valores; o Anexo B não traz máquina de estados para nenhuma das duas — ao
 * contrário do contrato, da OS, do equipamento e da reserva de peça.
 *
 * O que existe é o Anexo D.6, que nomeia as operações: `criar`, `aprovar` e
 * `receber` para a compra; `executar` e `aprovar` para o inventário. Os enums
 * são o conjunto mínimo que essas operações exigem, mais o cancelamento.
 * **É derivação, e está registrada como pendência de confirmação** — se o
 * negócio usa outras etapas (cotação, conferência fiscal, contagem cega com
 * segunda contagem), o lugar de corrigir é antes de haver dado.
 */
export const ORDEM_COMPRA_STATUS = [
  'RASCUNHO',
  'APROVADA',
  'PARCIALMENTE_RECEBIDA',
  'RECEBIDA',
  'CANCELADA',
] as const
export const OrdemCompraStatus = z.enum(ORDEM_COMPRA_STATUS)
export type OrdemCompraStatus = z.infer<typeof OrdemCompraStatus>

export const OrdemCompraItem = z.object({
  id: Uuid,
  peca_id: Uuid,
  peca_codigo: z.string().nullable(),
  quantidade_pedida: Quantidade,
  quantidade_recebida: Quantidade,
  preco_unitario: Dinheiro,
  valor_total: Dinheiro,
})
export type OrdemCompraItem = z.infer<typeof OrdemCompraItem>

export const OrdemCompra = z.object({
  id: Uuid,
  numero: z.string(),
  fornecedor_id: Uuid,
  fornecedor_nome: z.string().nullable(),
  deposito_id: Uuid,
  deposito_nome: z.string().nullable(),
  status: OrdemCompraStatus,
  previsao_entrega: Data.nullable(),
  observacao: z.string().nullable(),
  aprovado_por: Uuid.nullable(),
  aprovado_em: DataHora.nullable(),
  valor_total: Dinheiro,
  itens: z.array(OrdemCompraItem).default([]),
  version: z.number().int(),
  created_at: DataHora,
})
export type OrdemCompra = z.infer<typeof OrdemCompra>

/**
 * Criação da ordem, com os itens.
 *
 * Itens no mesmo corpo porque a ordem sem item não existe como fato: ela é a
 * decisão de comprar **isto**. Criar o cabeçalho e os itens em chamadas
 * separadas deixaria ordens vazias no sistema sempre que a segunda falhasse —
 * e a aprovação as recusaria uma por uma, para sempre.
 *
 * Sem `numero`: é gerado pelo banco, por ano. Aceitá-lo abriria a porta para
 * duas ordens com o mesmo número em locatários que conferem nota por número.
 */
export const CriarOrdemCompra = z.object({
  fornecedor_id: Uuid,
  /** O depósito é da ordem: uma compra chega num lugar, e quem confere está lá. */
  deposito_id: Uuid,
  previsao_entrega: Data.nullish(),
  observacao: z.string().trim().max(500).nullish(),
  itens: z
    .array(
      z.object({
        peca_id: Uuid,
        quantidade_pedida: Quantidade.refine((q) => Number(q) > 0, 'a quantidade precisa ser positiva'),
        preco_unitario: Dinheiro,
      }),
    )
    .min(1, 'informe ao menos um item'),
})
export type CriarOrdemCompra = z.infer<typeof CriarOrdemCompra>

/**
 * Recebimento, total ou parcial (Anexo D.6).
 *
 * As quantidades são **acumuladas**, não incrementos: o corpo diz quanto já
 * chegou no total daquele item. Enviar incrementos faria um reenvio por
 * timeout somar duas vezes — e a diferença entre "recebi mais 10" repetido e
 * "já recebi 10" é a diferença entre estoque certo e estoque inflado.
 */
export const ReceberOrdemCompra = z.object({
  itens: z
    .array(z.object({ item_id: Uuid, quantidade_recebida: Quantidade }))
    .min(1, 'informe ao menos um item recebido'),
})
export type ReceberOrdemCompra = z.infer<typeof ReceberOrdemCompra>

export const CancelarOrdemCompra = z.object({
  motivo: z.string().trim().min(10, 'descreva o motivo do cancelamento'),
})
export type CancelarOrdemCompra = z.infer<typeof CancelarOrdemCompra>

export const ListarOrdensCompra = Paginacao.extend({
  status: OrdemCompraStatus.optional(),
  fornecedor_id: Uuid.optional(),
})
export type ListarOrdensCompra = z.infer<typeof ListarOrdensCompra>

/* ------------------------------------------------------- inventário --- */

export const INVENTARIO_STATUS = ['ABERTO', 'CONTADO', 'APROVADO', 'CANCELADO'] as const
export const InventarioStatus = z.enum(INVENTARIO_STATUS)
export type InventarioStatus = z.infer<typeof InventarioStatus>

export const InventarioContagem = z.object({
  id: Uuid,
  peca_id: Uuid,
  peca_codigo: z.string().nullable(),
  saldo_sistema: Quantidade,
  saldo_contado: Quantidade,
  divergencia: Quantidade,
  justificativa: z.string().nullable(),
  movimento_ajuste_id: Uuid.nullable(),
})
export type InventarioContagem = z.infer<typeof InventarioContagem>

export const Inventario = z.object({
  id: Uuid,
  deposito_id: Uuid,
  deposito_nome: z.string().nullable(),
  tipo: z.enum(['GERAL', 'CICLICO']),
  status: InventarioStatus,
  iniciado_em: DataHora,
  finalizado_em: DataHora.nullable(),
  aprovado_por: Uuid.nullable(),
  aprovado_em: DataHora.nullable(),
  contagens: z.array(InventarioContagem).default([]),
  version: z.number().int(),
})
export type Inventario = z.infer<typeof Inventario>

export const AbrirInventario = z.object({
  deposito_id: Uuid,
  tipo: z.enum(['GERAL', 'CICLICO']).default('CICLICO'),
})
export type AbrirInventario = z.infer<typeof AbrirInventario>

/**
 * Registro de contagem.
 *
 * Sem `saldo_sistema`: ele é congelado pelo servidor no instante em que a
 * contagem entra. Aceitá-lo do cliente permitiria declarar a divergência em
 * vez de medi-la — e o ajuste gerado corrigiria o estoque para o número que
 * quem contou quis, não para o que estava na prateleira.
 */
export const RegistrarContagem = z.object({
  peca_id: Uuid,
  saldo_contado: Quantidade,
  justificativa: z.string().trim().max(300).nullish(),
})
export type RegistrarContagem = z.infer<typeof RegistrarContagem>

export const CancelarInventario = z.object({
  motivo: z.string().trim().min(10, 'descreva o motivo do cancelamento'),
})
export type CancelarInventario = z.infer<typeof CancelarInventario>

export const ListarInventarios = Paginacao.extend({
  status: InventarioStatus.optional(),
  deposito_id: Uuid.optional(),
})
export type ListarInventarios = z.infer<typeof ListarInventarios>
