import { z } from 'zod'
import { DataHora, Uuid } from './primitivos.js'

/**
 * Visões salvas de lista — Anexo Y §Y.3.5.
 *
 * Uma visão é um **nome** dado a uma consulta: filtros, ordenação e colunas.
 * Nunca os registros. Abrir a visão amanhã mostra o que estiver valendo
 * amanhã — é essa a diferença entre uma visão e um relatório tirado, e é por
 * isso que ela guarda parâmetros e não resultados.
 */

/**
 * As telas que têm visão. Espelha `app.tela_com_visao` da 0038.
 *
 * Lista fechada, e não o caminho da rota: a rota pode mudar de `/parque` para
 * `/equipamentos` sem que a visão deixe de ser daquela tela. Amarrar a visão à
 * URL faria a primeira renomeação órfã todas elas.
 */
export const TELAS_COM_VISAO = [
  'parque',
  'chamados',
  'contratos',
  'clientes',
  'estoque',
  'notas_fiscais',
  'contas_receber',
  'contas_pagar',
] as const
export const TelaComVisao = z.enum(TELAS_COM_VISAO)
export type TelaComVisao = z.infer<typeof TelaComVisao>

/**
 * A consulta guardada.
 *
 * Mapa de string para string, porque é o que cabe numa query de URL e é o que
 * a tela sabe reaplicar. Um esquema por tela seria mais estrito e envelheceria
 * a cada filtro novo — e o custo do erro aqui é pequeno: um parâmetro que a
 * tela não conhece é ignorado ao reaplicar, não quebra a lista.
 *
 * O limite de chaves não é zelo: uma consulta com centenas de parâmetros é
 * sinal de que alguém está guardando estado que não é filtro.
 */
export const ConsultaDaVisao = z.record(z.string().min(1).max(60), z.string().max(400)).refine(
  (c) => Object.keys(c).length <= 40,
  { message: 'A consulta de uma visão não guarda mais que 40 parâmetros.' },
)
export type ConsultaDaVisao = z.infer<typeof ConsultaDaVisao>

export const VisaoSalva = z.object({
  id: Uuid,
  tela: TelaComVisao,
  nome: z.string(),
  consulta: ConsultaDaVisao,
  compartilhada: z.boolean(),
  dono_id: Uuid,
  /** Nome de quem criou — é o que aparece ao lado da visão da equipe. */
  dono_nome: z.string().nullable(),
  /** Se o usuário da chamada é o dono. Poupa a tela de comparar ids. */
  minha: z.boolean(),
  ordem: z.number().int(),
  version: z.number().int(),
  created_at: DataHora,
  updated_at: DataHora,
})
export type VisaoSalva = z.infer<typeof VisaoSalva>

const nome = z
  .string()
  .trim()
  .min(1, 'A visão precisa de um nome.')
  .max(60, 'O nome da visão tem no máximo 60 caracteres.')

export const CriarVisao = z.object({
  tela: TelaComVisao,
  nome,
  consulta: ConsultaDaVisao,
  /**
   * Falso por omissão.
   *
   * Publicar é o ato com alcance, e ato com alcance não acontece por
   * esquecimento de campo.
   */
  compartilhada: z.boolean().default(false),
})
export type CriarVisao = z.infer<typeof CriarVisao>

export const EditarVisao = z
  .object({
    nome: nome.optional(),
    consulta: ConsultaDaVisao.optional(),
    compartilhada: z.boolean().optional(),
    ordem: z.number().int().min(0).max(999).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Informe ao menos um campo para alterar.',
  })
export type EditarVisao = z.infer<typeof EditarVisao>

export const ListarVisoes = z.object({
  tela: TelaComVisao,
})
export type ListarVisoes = z.infer<typeof ListarVisoes>

/**
 * Duplicar como minha.
 *
 * Existe para quem não pode editar a visão da equipe e quer ajustá-la. Sem
 * essa saída, a alternativa é pedir a alguém — e o recorte morre aí.
 */
export const DuplicarVisao = z.object({
  nome: nome.optional(),
})
export type DuplicarVisao = z.infer<typeof DuplicarVisao>
