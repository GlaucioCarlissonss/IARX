import { z } from 'zod'
import { Dinheiro, Documento, Paginacao, Uuid } from './primitivos.js'

/**
 * Cadastros de apoio: peça, fornecedor e técnico.
 *
 * As três têm a mesma forma — criar, editar, inativar — e a mesma razão para
 * **inativar em vez de apagar**: todas são apontadas por registros históricos.
 * Peça aparece em movimento de estoque de meses atrás, fornecedor em nota
 * fiscal lançada, técnico em ordem de serviço validada. Apagar qualquer uma
 * deixaria o histórico apontando para o nada — ou, pior, forçaria apagar o
 * histórico junto.
 */

export const SalvarPeca = z.object({
  codigo_interno: z.string().trim().min(1).max(60),
  codigo_fabricante: z.string().trim().max(60).nullish(),
  descricao: z.string().trim().min(3).max(200),
  unidade: z.string().trim().max(10).default('UN'),
  fornecedor_preferencial_id: Uuid.nullish(),
  /**
   * Sem `custo_medio`: ele é projeção do movimento de estoque (RN-017).
   * Aceitá-lo aqui seria a mesma porta que a ausência de `PATCH /saldos`
   * fecha — corrigir custo médio por cadastro faria a valoração do estoque
   * divergir dos movimentos que a produziram.
   */
  criticidade: z.enum(['BAIXA', 'MEDIA', 'ALTA']).default('MEDIA'),
  localizacao_fisica: z.string().trim().max(60).nullish(),
})
export type SalvarPeca = z.infer<typeof SalvarPeca>

export const SalvarFornecedor = z.object({
  tipo_pessoa: z.enum(['PJ', 'PF']).default('PJ'),
  documento: Documento,
  razao_social: z.string().trim().min(2).max(200),
  nome_fantasia: z.string().trim().max(200).nullish(),
  inscricao_estadual: z.string().trim().max(30).nullish(),
  uf: z.string().trim().length(2).nullish(),
  /*
   * `contato` é jsonb desde a 0010, não texto: telefone, e-mail e responsável
   * são campos distintos que a entrada fiscal e a ordem de compra leem
   * separadamente. Declará-lo como string aceitaria "João — 11 99999-0000" e
   * nenhum dos dois conseguiria extrair o e-mail de volta.
   */
  contato: z.record(z.unknown()).nullish(),
})
export type SalvarFornecedor = z.infer<typeof SalvarFornecedor>

export const SalvarTecnico = z.object({
  nome: z.string().trim().min(3).max(160),
  matricula: z.string().trim().max(30).nullish(),
  filial_id: Uuid.nullish(),
  /**
   * O vínculo com usuário é o que RN-027 usa para saber que o executor e o
   * validador são a mesma pessoa. Técnico sem usuário é legítimo — terceiro,
   * prestador — e nesse caso a segregação se apoia só em quem registrou a
   * validação.
   */
  usuario_id: Uuid.nullish(),
  especialidades: z.array(z.string().trim().max(40)).max(20).nullish(),
  custo_hora: Dinheiro.nullish(),
})
export type SalvarTecnico = z.infer<typeof SalvarTecnico>

/**
 * Inativação.
 *
 * Motivo obrigatório porque inativar tira o registro das listas de escolha sem
 * tirá-lo do histórico: quem procurar depois vai encontrar o cadastro e não
 * vai encontrar por que ele saiu de uso.
 */
export const Inativar = z.object({
  motivo: z.string().trim().min(10, 'descreva por que o cadastro sai de uso'),
})
export type Inativar = z.infer<typeof Inativar>

/*
 * `FornecedorCadastro`, e não `Fornecedor`: `nota-fiscal.ts` já exporta esse
 * nome para a visão que a entrada fiscal usa — documento, razão social e o
 * mínimo para conferir uma nota. Esta é a visão de cadastro, com o que se
 * edita. Unificar as duas é uma das decisões do plano de usabilidade, e
 * forçá-la agora para economizar um nome mudaria o contrato de um módulo
 * pronto sem ninguém ter decidido isso.
 */
export const FornecedorCadastro = z.object({
  id: Uuid,
  tipo_pessoa: z.string(),
  documento: z.string(),
  razao_social: z.string(),
  nome_fantasia: z.string().nullable(),
  inscricao_estadual: z.string().nullable(),
  uf: z.string().nullable(),
  contato: z.record(z.unknown()).nullable(),
  ativo: z.boolean(),
})
export type FornecedorCadastro = z.infer<typeof FornecedorCadastro>

/*
 * Não há `TecnicoCadastro`: `manutencao.ts` já exporta `Tecnico` com
 * exatamente estes campos. A primeira versão deste arquivo o duplicou com
 * outro nome porque o import colidia — duplicar um contrato para resolver
 * colisão de nome é trocar um erro de compilação por duas formas que
 * divergem na primeira vez que uma delas mudar.
 */

export const ListarFornecedores = Paginacao.extend({
  q: z.string().trim().min(1).max(60).optional(),
  ativo: z.enum(['0', '1']).transform((v) => v === '1').optional(),
})
export type ListarFornecedores = z.infer<typeof ListarFornecedores>

export const ListarTecnicos = Paginacao.extend({
  filial_id: Uuid.optional(),
  ativo: z.enum(['0', '1']).transform((v) => v === '1').optional(),
})
export type ListarTecnicos = z.infer<typeof ListarTecnicos>
