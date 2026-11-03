import { z } from 'zod'
import { DataHora, Dinheiro, Paginacao, Uuid } from './primitivos.js'

/**
 * Administração: alçadas e trilha de auditoria.
 *
 * ## Por que a alçada precisa de rota
 *
 * Seis regras do sistema consultam `alcada` — desconto em contrato (RN-009),
 * custo de OS, ajuste de inventário, ordem de compra, reabertura de
 * competência e aprovação de pagamento. Todas seguem a mesma convenção: a
 * alçada **só morde onde foi configurada**.
 *
 * Isso torna a ausência de uma rota de configuração mais grave do que parece:
 * sem ela, as seis regras ficam permanentemente desligadas em qualquer
 * locatário que não tenha quem escreva `INSERT` no banco. A regra existe, o
 * teste prova que funciona, e na prática ela nunca é exercida.
 */
export const ALCADA_TIPO = [
  'DESCONTO',
  'EMISSAO_FATURA',
  'CANCELAMENTO_FATURA',
  'REABERTURA_COMPETENCIA',
  'CUSTO_OS',
  'AJUSTE_INVENTARIO',
  'LIBERACAO_BLOQUEIO',
  'LIBERACAO_CLIENTE',
  'APROVACAO_PAGAMENTO',
  'ORDEM_COMPRA',
] as const
export const AlcadaTipo = z.enum(ALCADA_TIPO)
export type AlcadaTipo = z.infer<typeof AlcadaTipo>

export const Alcada = z.object({
  id: Uuid,
  perfil_id: Uuid,
  perfil_nome: z.string().nullable(),
  tipo: AlcadaTipo,
  limite_valor: Dinheiro.nullable(),
  limite_percentual: z.string().nullable(),
})
export type Alcada = z.infer<typeof Alcada>

/**
 * Definição de alçada.
 *
 * `PUT` e não `POST`: a alçada é atributo do par (perfil, tipo) — é o índice
 * único da tabela desde a 0002. Definir duas vezes a mesma alçada tem de
 * deixar uma, e um `POST` que às vezes cria e às vezes falha por duplicidade
 * obrigaria a tela a saber de antemão qual dos dois é.
 *
 * Só `DESCONTO` usa percentual; as demais medem reais. O banco recusa a
 * combinação errada (0037), e a recusa é importante: teto percentual num tipo
 * que lê valor não é lido por ninguém, e quem o cadastra acredita ter
 * configurado a regra.
 */
export const DefinirAlcada = z
  .object({
    perfil_id: Uuid,
    tipo: AlcadaTipo,
    limite_valor: Dinheiro.nullish(),
    limite_percentual: z
      .string()
      .regex(/^\d{1,3}(\.\d{1,2})?$/, 'percentual com até 2 casas')
      .nullish(),
  })
  .refine(
    (v) => (v.tipo === 'DESCONTO' ? v.limite_percentual != null : v.limite_valor != null),
    {
      message: 'desconto é em percentual; as demais alçadas são em valor',
      path: ['limite_valor'],
    },
  )
export type DefinirAlcada = z.infer<typeof DefinirAlcada>

export const ListarAlcadas = z.object({
  perfil_id: Uuid.optional(),
  tipo: AlcadaTipo.optional(),
})
export type ListarAlcadas = z.infer<typeof ListarAlcadas>

/**
 * Trilha de auditoria — RN-018.
 *
 * Só leitura, e só isso. O log é *append-only* e imutável "por qualquer
 * perfil, inclusive administrador": uma rota de escrita aqui negaria a frase
 * que torna a trilha útil.
 *
 * O filtro por entidade e id é o que a tela de histórico usa; o filtro por
 * autor é o que uma investigação usa. Os dois existem porque são perguntas
 * diferentes, e quem investiga não sabe de antemão qual registro procurar.
 */
export const RegistroAuditoria = z.object({
  id: Uuid,
  entidade_tipo: z.string(),
  entidade_id: Uuid.nullable(),
  acao: z.string(),
  campo: z.string().nullable(),
  valor_anterior: z.string().nullable(),
  valor_novo: z.string().nullable(),
  usuario_id: Uuid.nullable(),
  perfil_efetivo: z.string().nullable(),
  motivo: z.string().nullable(),
  request_id: z.string().nullable(),
  origem: z.string().nullable(),
  criado_em: DataHora,
})
export type RegistroAuditoria = z.infer<typeof RegistroAuditoria>

export const ConsultarAuditoria = Paginacao.extend({
  entidade_tipo: z.string().trim().max(60).optional(),
  entidade_id: Uuid.optional(),
  usuario_id: Uuid.optional(),
  desde: DataHora.optional(),
  ate: DataHora.optional(),
})
export type ConsultarAuditoria = z.infer<typeof ConsultarAuditoria>

/**
 * Reabertura de competência — Anexo B §B.6.
 *
 * Motivo obrigatório e legível: reabrir desfaz um fechamento que alguém
 * conferiu, e é a linha que a próxima auditoria vai procurar.
 */
export const ReabrirCompetencia = z.object({
  motivo: z.string().trim().min(10, 'descreva por que a competência precisa ser reaberta'),
})
export type ReabrirCompetencia = z.infer<typeof ReabrirCompetencia>
