import { z } from 'zod'
import { DataHora, Dinheiro, Paginacao, Uuid } from './primitivos.js'

/**
 * `EST` — peças e estoque.
 *
 * A API deste módulo não tem rota que escreva saldo. Nenhuma. O saldo é
 * projeção do movimento (RN-017), e expor um `PATCH saldo` recriaria, pela
 * porta da frente, o caminho de divergência que o desenho do banco fecha.
 *
 * O que se escreve é **movimento**, sempre tipificado e valorado. Corrigir
 * saldo é registrar um `AJUSTE_INVENTARIO` com motivo — que é mais trabalhoso
 * de propósito, porque ajuste de estoque sem explicação é exatamente a linha
 * que alguém vai auditar.
 */

export const Quantidade = z
  .string()
  .regex(/^-?\d{1,11}(\.\d{1,3})?$/, 'quantidade deve ser decimal com até 3 casas')

export const PecaCriticidade = z.enum(['BAIXA', 'MEDIA', 'ALTA'])
export type PecaCriticidade = z.infer<typeof PecaCriticidade>

export const DepositoTipo = z.enum(['ALMOXARIFADO', 'OFICINA', 'VEICULO_TECNICO'])
export type DepositoTipo = z.infer<typeof DepositoTipo>

/*
 * `MovimentoEstoqueTipo`, e não `MovimentoTipo`.
 *
 * O nome curto já é do financeiro — movimentação bancária. Duas coisas
 * diferentes com o mesmo nome em pacotes que se importam é o começo de um
 * engano caro: um `import` automático traz o errado, o tipo casa por acaso em
 * algum ponto, e a entrada de caixa vira entrada de peça.
 */
export const MovimentoEstoqueTipo = z.enum([
  'ENTRADA_COMPRA',
  'ENTRADA_DEVOLUCAO',
  'SAIDA_OS',
  'SAIDA_PERDA',
  'TRANSFERENCIA_SAIDA',
  'TRANSFERENCIA_ENTRADA',
  'AJUSTE_INVENTARIO',
  'DEVOLUCAO_FORNECEDOR',
])
export type MovimentoEstoqueTipo = z.infer<typeof MovimentoEstoqueTipo>

export const Peca = z.object({
  id: Uuid,
  codigo_interno: z.string(),
  codigo_fabricante: z.string().nullable(),
  descricao: z.string(),
  unidade: z.string(),
  fornecedor_preferencial_id: Uuid.nullable(),
  custo_medio: Dinheiro,
  ultimo_custo: Dinheiro.nullable(),
  criticidade: PecaCriticidade,
  localizacao_fisica: z.string().nullable(),
  ativo: z.boolean(),
})
export type Peca = z.infer<typeof Peca>

export const Deposito = z.object({
  id: Uuid,
  filial_id: Uuid.nullable(),
  codigo: z.string(),
  nome: z.string(),
  tipo: DepositoTipo,
  responsavel_id: Uuid.nullable(),
  ativo: z.boolean(),
})
export type Deposito = z.infer<typeof Deposito>

export const SaldoEstoque = z.object({
  peca_id: Uuid,
  deposito_id: Uuid,
  quantidade_fisica: Quantidade,
  quantidade_reservada: Quantidade,
  /** Derivado no banco: físico menos reservado, sem caminho de escrita. */
  quantidade_disponivel: Quantidade,
  valor_total: Dinheiro,
  atualizado_em: DataHora,
})
export type SaldoEstoque = z.infer<typeof SaldoEstoque>

export const MovimentoEstoque = z.object({
  id: Uuid,
  peca_id: Uuid,
  deposito_id: Uuid,
  tipo: MovimentoEstoqueTipo,
  /** Sinalizada: entrada positiva, saída negativa. */
  quantidade: Quantidade,
  custo_unitario: Dinheiro,
  custo_total: Dinheiro,
  ordem_servico_id: Uuid.nullable(),
  deposito_contraparte_id: Uuid.nullable(),
  /** Saldo físico depois deste movimento, gravado pelo gatilho. */
  saldo_apos: Quantidade.nullable(),
  data_movimento: DataHora,
  motivo: z.string().nullable(),
})
export type MovimentoEstoque = z.infer<typeof MovimentoEstoque>

export const RegistrarMovimento = z
  .object({
    peca_id: Uuid,
    deposito_id: Uuid,
    tipo: MovimentoEstoqueTipo,
    quantidade: Quantidade,
    custo_unitario: Dinheiro.default('0.0000'),
    ordem_servico_id: Uuid.nullish(),
    deposito_contraparte_id: Uuid.nullish(),
    motivo: z.string().trim().nullish(),
  })
  .superRefine((v, ctx) => {
    /*
     * O sinal precisa casar com o tipo.
     *
     * A quantidade é sinalizada no banco, e o tipo diz o que aconteceu. Aceitar
     * `SAIDA_OS` com quantidade positiva faria uma baixa **somar** ao estoque —
     * e o saldo ficaria certo nos dois lados da conta errada: o movimento diria
     * saída, o saldo subiria, e só o inventário descobriria.
     *
     * A validação está aqui e não no banco porque é sobre a **intenção
     * declarada**, não sobre o estado: o banco não tem como saber que quem
     * escreveu "saída" queria subtrair.
     */
    const n = Number(v.quantidade)
    const entrada = v.tipo.startsWith('ENTRADA') || v.tipo === 'TRANSFERENCIA_ENTRADA'
    const saida =
      v.tipo.startsWith('SAIDA') ||
      v.tipo === 'TRANSFERENCIA_SAIDA' ||
      v.tipo === 'DEVOLUCAO_FORNECEDOR'

    if (entrada && n <= 0) {
      ctx.addIssue({ code: 'custom', path: ['quantidade'], message: 'entrada exige quantidade positiva' })
    }
    if (saida && n >= 0) {
      ctx.addIssue({ code: 'custom', path: ['quantidade'], message: 'saída exige quantidade negativa' })
    }
    if (n === 0) {
      ctx.addIssue({ code: 'custom', path: ['quantidade'], message: 'movimento de quantidade zero não registra nada' })
    }
  })
export type RegistrarMovimento = z.infer<typeof RegistrarMovimento>

export const ListarPecas = Paginacao.extend({
  busca: z.string().trim().min(2).optional(),
  criticidade: PecaCriticidade.optional(),
  /**
   * Só o que está abaixo do ponto de pedido (RN-016).
   *
   * É a pergunta que muda ação: a lista completa de peças serve para consultar,
   * a lista do que vai faltar serve para comprar.
   */
  abaixo_do_ponto_pedido: z.coerce.boolean().optional(),
})
export type ListarPecas = z.infer<typeof ListarPecas>

export const ListarMovimentos = z.object({
  peca_id: Uuid.optional(),
  deposito_id: Uuid.optional(),
  ordem_servico_id: Uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type ListarMovimentos = z.infer<typeof ListarMovimentos>

/**
 * Ajuste de inventário — rota e permissão próprias (`estoque:ajustar`).
 *
 * Separado de `estoque:movimentar` porque é o único movimento que **cria ou
 * destrói quantidade sem contrapartida**: toda diferença entre o sistema e a
 * prateleira passa por ele. Enquanto coubesse na rota genérica de movimento,
 * `estoque:ajustar` existia no catálogo e não valia nada — quem podia
 * movimentar ajustava.
 *
 * `quantidade` sem a restrição de sinal dos demais tipos: o ajuste é o único
 * movimento em que os dois sentidos são legítimos e significam coisas
 * diferentes — sobra costuma ser compra não lançada, falta costuma ser perda.
 */
export const RegistrarAjuste = z.object({
  peca_id: Uuid,
  deposito_id: Uuid,
  quantidade: Quantidade.refine((q) => Number(q) !== 0, 'ajuste de zero não corrige nada'),
  custo_unitario: Dinheiro.default('0.0000'),
  motivo: z.string().trim().min(10, 'descreva a diferença apurada'),
})
export type RegistrarAjuste = z.infer<typeof RegistrarAjuste>

/**
 * Política de reposição — `estoque:politica_definir` (RN-016).
 *
 * `PUT` e não `POST`: a política é um atributo do par (peça, depósito), não um
 * evento. A chave primária da tabela é esse par, e definir duas vezes a mesma
 * política tem de deixar uma, não duas.
 */
export const DefinirPolitica = z
  .object({
    peca_id: Uuid,
    deposito_id: Uuid,
    estoque_minimo: Quantidade.default('0'),
    estoque_maximo: Quantidade.nullish(),
    ponto_pedido: Quantidade.default('0'),
    lote_economico: Quantidade.nullish(),
    lead_time_dias: z.number().int().min(0).max(365).default(0),
  })
  .refine(
    (v) => v.estoque_maximo === null || v.estoque_maximo === undefined
      || Number(v.estoque_maximo) >= Number(v.estoque_minimo),
    { message: 'o máximo não pode ser menor que o mínimo', path: ['estoque_maximo'] },
  )
export type DefinirPolitica = z.infer<typeof DefinirPolitica>

export const PoliticaReposicao = z.object({
  peca_id: Uuid,
  peca_codigo: z.string().nullable(),
  deposito_id: Uuid,
  deposito_nome: z.string().nullable(),
  estoque_minimo: Quantidade,
  estoque_maximo: Quantidade.nullable(),
  ponto_pedido: Quantidade,
  lote_economico: Quantidade.nullable(),
  lead_time_dias: z.number().int(),
})
export type PoliticaReposicao = z.infer<typeof PoliticaReposicao>

/**
 * Sugestão de reposição (RN-016).
 *
 * Derivada, nunca armazenada: é a comparação entre o disponível e o ponto de
 * pedido, no instante da consulta. Guardá-la criaria uma lista que envelhece —
 * e uma sugestão de compra desatualizada é pior que nenhuma, porque parece
 * decidida.
 */
export const SugestaoReposicao = z.object({
  peca_id: Uuid,
  peca_codigo: z.string().nullable(),
  deposito_id: Uuid,
  deposito_nome: z.string().nullable(),
  quantidade_disponivel: Quantidade,
  ponto_pedido: Quantidade,
  sugerido: Quantidade,
  lead_time_dias: z.number().int(),
})
export type SugestaoReposicao = z.infer<typeof SugestaoReposicao>

/* ---------------------------------------------- reserva de peça na OS --- */

export const OS_PECA_STATUS = [
  'SOLICITADA',
  'RESERVADA',
  'CONSUMIDA',
  'DEVOLVIDA',
  'EM_FALTA',
  'CANCELADA',
] as const
export const OsPecaStatus = z.enum(OS_PECA_STATUS)
export type OsPecaStatus = z.infer<typeof OsPecaStatus>

export const OsPeca = z.object({
  id: Uuid,
  ordem_servico_id: Uuid,
  peca_id: Uuid,
  peca_codigo: z.string().nullable(),
  deposito_id: Uuid.nullable(),
  quantidade_reservada: Quantidade,
  quantidade_consumida: Quantidade,
  custo_unitario_baixa: Dinheiro.nullable(),
  status: OsPecaStatus,
})
export type OsPeca = z.infer<typeof OsPeca>

/**
 * Pedido de peça para a OS — `estoque:reservar`.
 *
 * Nasce SOLICITADA e é atendida por quem tem o almoxarifado na mão. Os dois
 * passos são o Anexo B.5 e não cerimônia: entre pedir e reservar há a pergunta
 * "tem saldo?", e é a resposta dela que leva a OS para AGUARDANDO_PEÇA quando
 * é não.
 */
export const SolicitarPeca = z.object({
  peca_id: Uuid,
  deposito_id: Uuid,
  quantidade: Quantidade.refine((q) => Number(q) > 0, 'a quantidade precisa ser positiva'),
})
export type SolicitarPeca = z.infer<typeof SolicitarPeca>
