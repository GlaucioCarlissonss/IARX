import { z } from 'zod'
import { Data, Dinheiro, Uuid } from './primitivos.js'

/**
 * Comercial — tabelas de preço, de franquia, e o desconto concedido.
 *
 * As três coisas respondem perguntas diferentes e são confundidas o tempo
 * todo, então vale separá-las antes dos tipos:
 *
 *  · **Tabela de preço** diz quanto custa ter o equipamento — a mensalidade,
 *    a instalação, a retirada.
 *  · **Tabela de franquia** diz quanto vem incluso de uso e quanto custa o que
 *    passar disso. É por página, e é onde mora a margem da locação de
 *    impressora.
 *  · **Desconto** é a diferença entre o que a tabela diz e o que foi cobrado.
 *    Guardado como concessão explícita, com motivo e quem aprovou, e não
 *    abatido no valor — abatido, a concessão some do relatório e ninguém
 *    consegue responder quanto se abriu mão no trimestre.
 *
 * ## Vigência, e por que ela não é um par de datas qualquer
 *
 * Toda tabela tem início e fim de vigência, e duas versões da mesma tabela não
 * podem valer ao mesmo tempo. Quem garante isso é o banco (`EXCLUDE USING
 * gist`), não esta validação: aqui a data só é conferida quanto à forma.
 * Repetir a regra nos dois lugares criaria dois lugares para ela divergir.
 */

export const StatusTabela = z.enum(['RASCUNHO', 'ATIVA', 'ENCERRADA'])
export type StatusTabela = z.infer<typeof StatusTabela>

export const ItemTabelaPreco = z.object({
  id: Uuid,
  categoria_id: Uuid.nullable(),
  modelo_id: Uuid.nullable(),
  /*
   * `Dinheiro` — string decimal, e não número.
   *
   * Eu tinha escrito `z.number().int()` aqui, supondo centavos. O schema diz
   * outra coisa, e o schema está certo: `numeric(15,4)`. Um teste pegou, com a
   * resposta `"289.0000"` na mão.
   *
   * A diferença não é de estilo. `number` em JavaScript é ponto flutuante
   * binário, e nem toda fração decimal cabe nele — a soma de mil mensalidades
   * passa a depender da ordem das parcelas. String atravessa a fronteira sem
   * perder nada, e quem for somar escolhe conscientemente como.
   */
  valor_mensal: Dinheiro.nullable(),
  valor_instalacao: Dinheiro.nullable(),
  valor_retirada: Dinheiro.nullable(),
  valor_manutencao: Dinheiro.nullable(),
  prazo_minimo_meses: z.number().int().nullable(),
})
export type ItemTabelaPreco = z.infer<typeof ItemTabelaPreco>

export const TabelaPreco = z.object({
  id: Uuid,
  nome: z.string(),
  descricao: z.string().nullable(),
  vigencia_inicio: Data,
  vigencia_fim: Data.nullable(),
  status: StatusTabela,
  versao: z.number().int(),
  moeda: z.string(),
  /**
   * De quem é a tabela: geral da locadora, de um cliente, ou de um contrato.
   *
   * A abrangência é o que decide qual tabela vence quando mais de uma serve —
   * a mais específica. Sem ela, "qual preço vale" não tem resposta única.
   */
  abrangencia: z.string(),
  cliente_id: Uuid.nullable(),
  contrato_id: Uuid.nullable(),
  indice_reajuste: z.string().nullable(),
  meses_reajuste: z.number().int().nullable(),
  itens: z.array(ItemTabelaPreco),
})
export type TabelaPreco = z.infer<typeof TabelaPreco>

export const ItemTabelaFranquia = z.object({
  id: Uuid,
  categoria_id: Uuid.nullable(),
  modelo_id: Uuid.nullable(),
  franquia_mono: z.number().int().nullable(),
  franquia_color: z.number().int().nullable(),
  /** Se a franquia é por equipamento ou somada no contrato. */
  franquia_escopo: z.string().nullable(),
  /*
   * Seis casas decimais no banco, e por um motivo concreto: página custa
   * **fração de centavo**. R$ 0,0385 por página mono é preço corrente de
   * mercado, e arredondar para centavo erraria 30% no valor da página.
   *
   * Por isso estes não são `Dinheiro` (quatro casas): são a string crua, com a
   * precisão que a coluna guarda.
   */
  valor_pagina_mono: z.string().nullable(),
  valor_pagina_color: z.string().nullable(),
  valor_excedente_mono: z.string().nullable(),
  valor_excedente_color: z.string().nullable(),
  /** Página não usada acumula para o mês seguinte, e por quantos meses. */
  permite_acumulo: z.boolean(),
  meses_acumulo: z.number().int().nullable(),
})
export type ItemTabelaFranquia = z.infer<typeof ItemTabelaFranquia>

export const TabelaFranquia = z.object({
  id: Uuid,
  nome: z.string(),
  descricao: z.string().nullable(),
  vigencia_inicio: Data,
  vigencia_fim: Data.nullable(),
  status: StatusTabela,
  versao: z.number().int(),
  itens: z.array(ItemTabelaFranquia),
})
export type TabelaFranquia = z.infer<typeof TabelaFranquia>

export const DescontoComercial = z.object({
  id: Uuid,
  contrato_id: Uuid,
  contrato_item_id: Uuid.nullable(),
  tipo: z.string(),
  percentual: z.string().nullable(),
  valor: Dinheiro.nullable(),
  vigencia_inicio: Data,
  vigencia_fim: Data.nullable(),
  /**
   * Por que se concedeu. Obrigatório no banco, e é o campo que transforma a
   * lista de descontos em algo que se consegue revisar — sem ele, sobra uma
   * coluna de percentuais sem nenhuma pergunta respondida.
   */
  motivo: z.string(),
  aprovado_por: Uuid.nullable(),
  aprovado_em: z.string().nullable(),
})
export type DescontoComercial = z.infer<typeof DescontoComercial>

export const ListarDescontos = z.object({
  contrato_id: Uuid.optional(),
})
export type ListarDescontos = z.infer<typeof ListarDescontos>

export const PoliticaComercial = z.object({
  tabelas_preco: z.array(TabelaPreco),
  tabelas_franquia: z.array(TabelaFranquia),
})
export type PoliticaComercial = z.infer<typeof PoliticaComercial>
