import { z } from 'zod'
import { Uuid } from './primitivos.js'

/**
 * Catálogo — o dado de referência do parque.
 *
 * Fabricante, categoria, modelo e filial não são um módulo de negócio: são o
 * vocabulário com que todos os outros falam. Um equipamento aponta para um
 * modelo, um modelo para um fabricante e uma categoria, um contrato para uma
 * filial. Nenhuma tela de cadastro funciona sem eles, e é por isso que o
 * catálogo sai inteiro numa resposta só.
 *
 * ## Por que uma resposta só, e não quatro rotas paginadas
 *
 * Porque a pergunta real nunca é "quais fabricantes existem" — é "o que posso
 * escolher neste formulário". Quatro chamadas para montar um `<select>`
 * transformam a abertura de uma tela em quatro oportunidades de falha parcial,
 * e a interface teria de decidir o que fazer quando duas respondem e duas não.
 *
 * A escala sustenta: catálogo de locadora é da ordem de centenas de linhas, não
 * de milhões. O dia em que não sustentar, a troca é para rotas próprias com
 * cursor — e aí será por medição, não por precaução.
 */

export const Fabricante = z.object({
  id: Uuid,
  nome: z.string(),
  pais: z.string().nullable(),
  contato_suporte: z.string().nullable(),
})
export type Fabricante = z.infer<typeof Fabricante>

export const CategoriaEquipamento = z.object({
  id: Uuid,
  codigo: z.string(),
  nome: z.string(),
  /** Que medidor a categoria espera: define o que a medição vai cobrar. */
  tipo_medidor_padrao: z.string().nullable(),
  vida_util_meses_padrao: z.number().int().nullable(),
})
export type CategoriaEquipamento = z.infer<typeof CategoriaEquipamento>

export const ModeloEquipamento = z.object({
  id: Uuid,
  fabricante_id: Uuid,
  categoria_id: Uuid,
  codigo: z.string(),
  nome: z.string(),
  /** Ficha técnica livre — varia por categoria e não cabe em colunas fixas. */
  especificacoes: z.record(z.unknown()).nullable(),
  /**
   * Preço de tabela do modelo, em centavos.
   *
   * É **referência**, não o preço cobrado: o que vale num contrato sai da
   * tabela de preço vigente, e a divergência entre os dois é informação — diz
   * quanto se concedeu. Confundir os dois faria a margem sumir do relatório.
   */
  preco_tabela_mensal: z.number().int().nullable(),
  preco_tabela_diaria: z.number().int().nullable(),
})
export type ModeloEquipamento = z.infer<typeof ModeloEquipamento>

export const FilialCatalogo = z.object({
  id: Uuid,
  empresa_id: Uuid,
  codigo: z.string(),
  nome: z.string(),
  regiao: z.string().nullable(),
  status: z.string(),
})
export type FilialCatalogo = z.infer<typeof FilialCatalogo>

export const Catalogo = z.object({
  fabricantes: z.array(Fabricante),
  categorias: z.array(CategoriaEquipamento),
  modelos: z.array(ModeloEquipamento),
  filiais: z.array(FilialCatalogo),
})
export type Catalogo = z.infer<typeof Catalogo>
