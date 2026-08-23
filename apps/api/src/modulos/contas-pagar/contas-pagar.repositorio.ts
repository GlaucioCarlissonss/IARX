import { Injectable } from '@nestjs/common'
import type {
  Aprovacao,
  CriarDelegacao,
  CriarTituloPagar,
  Delegacao,
  Dinheiro,
  EditarTituloPagar,
  ListarDelegacoes,
  ListarTitulosPagar,
  Pagamento,
  RateioEntrada,
  Rateio,
  RegistrarPagamento,
  TituloPagar,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor } from '../../comum/pagina.js'

/**
 * Acesso a dados de contas a pagar.
 *
 * Nenhum `where tenant_id`: o isolamento é da RLS. E nenhuma regra de negócio —
 * as nove invariantes do Módulo 10 são gatilhos na migração 0019, porque é lá
 * que precisam valer para quem não passa por aqui.
 *
 * O que este arquivo faz de específico é montar o título **inteiro** numa
 * consulta: rateio, aprovações e pagamentos vêm agregados em JSON. Buscá-los em
 * três consultas separadas por título transformaria a lista de vinte títulos em
 * sessenta e uma consultas.
 */

const dinheiro = (v: string | number | null): Dinheiro => Number(v ?? 0).toFixed(4) as Dinheiro
const dia = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)

const SELECT_TITULO = `
  select t.id, t.empresa_id, t.filial_id, t.fornecedor_id,
         f.razao_social as fornecedor_nome,
         t.descricao, t.classificacao, t.contrato_fornecedor_ref,
         t.valor_original, t.valor_ajustado, t.valor_devido,
         app.saldo_titulo_pagar(t.id) as saldo,
         t.data_emissao, t.data_vencimento, t.status,
         t.titulo_pai_id, t.parcela_numero, t.parcela_total,
         t.version, t.created_at, t.created_by,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'centro_custo_id', r.centro_custo_id,
                    'centro_custo_codigo', c.codigo,
                    'centro_custo_nome', c.nome,
                    'percentual', r.percentual
                  ) order by c.codigo)
             from public.titulo_pagar_rateio r
             join public.centro_custo c on c.id = r.centro_custo_id
            where r.titulo_id = t.id
         ), '[]'::jsonb) as rateio,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'nivel', a.nivel, 'rodada', a.rodada,
                    'aprovador_id', a.aprovador_id, 'aprovador_nome', ua.nome,
                    'decisao', a.decisao, 'decidido_em', a.decidido_em,
                    'justificativa', a.justificativa,
                    'delegado_de', a.delegado_de, 'delegado_de_nome', ud.nome
                  ) order by a.rodada, a.nivel)
             from public.titulo_pagar_aprovacao a
             left join public.usuario ua on ua.id = a.aprovador_id
             left join public.usuario ud on ud.id = a.delegado_de
            where a.titulo_id = t.id
         ), '[]'::jsonb) as aprovacoes,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', p.id, 'valor_pago', p.valor_pago,
                    'data_pagamento', p.data_pagamento,
                    'conta_id', p.conta_id, 'conta_apelido', cb.apelido,
                    'forma', p.forma, 'movimentacao_id', p.movimentacao_id,
                    'estornado_em', p.estornado_em, 'estorno_motivo', p.estorno_motivo
                  ) order by p.data_pagamento, p.created_at)
             from public.titulo_pagar_pagamento p
             join public.conta_bancaria cb on cb.id = p.conta_id
            where p.titulo_id = t.id
         ), '[]'::jsonb) as pagamentos
    from public.titulo_pagar t
    left join public.fornecedor f on f.id = t.fornecedor_id
`

interface LinhaTitulo extends Record<string, unknown> {
  id: string
  empresa_id: string
  filial_id: string | null
  fornecedor_id: string | null
  fornecedor_nome: string | null
  descricao: string
  classificacao: TituloPagar['classificacao']
  contrato_fornecedor_ref: string | null
  valor_original: string
  valor_ajustado: string | null
  valor_devido: string
  saldo: string
  data_emissao: Date
  data_vencimento: Date
  status: TituloPagar['status']
  titulo_pai_id: string | null
  parcela_numero: number | null
  parcela_total: number | null
  version: number
  created_at: Date
  created_by: string | null
  rateio: unknown
  aprovacoes: unknown
  pagamentos: unknown
}

function mapear(l: LinhaTitulo): TituloPagar {
  const rateio = (l.rateio as Rateio[]).map((r) => ({ ...r, percentual: Number(r.percentual) }))
  const aprovacoes = (l.aprovacoes as (Aprovacao & { decidido_em: string | null })[]).map((a) => ({
    ...a,
    nivel: Number(a.nivel),
    rodada: Number(a.rodada),
  }))
  const pagamentos = (l.pagamentos as (Pagamento & { data_pagamento: string })[]).map((p) => ({
    ...p,
    valor_pago: dinheiro(p.valor_pago),
    data_pagamento: dia(p.data_pagamento),
  }))

  return {
    id: l.id,
    empresa_id: l.empresa_id,
    filial_id: l.filial_id,
    fornecedor_id: l.fornecedor_id,
    fornecedor_nome: l.fornecedor_nome,
    descricao: l.descricao,
    classificacao: l.classificacao,
    contrato_fornecedor_ref: l.contrato_fornecedor_ref,
    valor_original: dinheiro(l.valor_original),
    valor_ajustado: l.valor_ajustado === null ? null : dinheiro(l.valor_ajustado),
    valor_devido: dinheiro(l.valor_devido),
    saldo: dinheiro(l.saldo),
    data_emissao: dia(l.data_emissao),
    data_vencimento: dia(l.data_vencimento),
    status: l.status,
    titulo_pai_id: l.titulo_pai_id,
    parcela_numero: l.parcela_numero,
    parcela_total: l.parcela_total,
    version: l.version,
    rateio,
    aprovacoes,
    pagamentos,
  }
}

export const cursorTitulo = (l: LinhaTitulo) => ({ criadoEm: l.created_at.toISOString(), id: l.id })

@Injectable()
export class ContasPagarRepositorio {
  async listar(
    db: Executor,
    filtro: ListarTitulosPagar,
    usuarioId: string,
  ): Promise<{ linhas: LinhaTitulo[]; temMais: boolean }> {
    const clausulas = ['t.deleted_at is null']
    const valores: unknown[] = []

    if (filtro.status) {
      valores.push(filtro.status)
      clausulas.push(`t.status = $${valores.length}`)
    }
    if (filtro.fornecedor_id) {
      valores.push(filtro.fornecedor_id)
      clausulas.push(`t.fornecedor_id = $${valores.length}`)
    }
    if (filtro.classificacao) {
      valores.push(filtro.classificacao)
      clausulas.push(`t.classificacao = $${valores.length}`)
    }
    if (filtro.vencimento_de) {
      valores.push(filtro.vencimento_de)
      clausulas.push(`t.data_vencimento >= $${valores.length}`)
    }
    if (filtro.vencimento_ate) {
      valores.push(filtro.vencimento_ate)
      clausulas.push(`t.data_vencimento <= $${valores.length}`)
    }
    if (filtro.em_atraso) {
      clausulas.push(
        `t.data_vencimento < current_date and t.status in ('APROVADO','AGENDADO','PAGO_PARCIAL')`,
      )
    }

    /*
     * A fila do aprovador, na consulta e não na tela.
     *
     * O `not exists` é o que faz RN-F02 valer aqui também: um título com o
     * nível 1 pendente não aparece para o aprovador do nível 2, porque existe um
     * nível anterior não aprovado. Filtrar isso no cliente devolveria títulos
     * que o aprovador não pode decidir — e "aparece mas recusa" é pior que não
     * aparecer.
     */
    if (filtro.minha_aprovacao) {
      valores.push(usuarioId)
      const u = `$${valores.length}`
      clausulas.push(`exists (
        select 1 from public.titulo_pagar_aprovacao a
         where a.titulo_id = t.id
           and a.decisao is null
           and app.pode_decidir_nivel_pagar(${u}, a.nivel)
           and not exists (
             select 1 from public.titulo_pagar_aprovacao anterior
              where anterior.titulo_id = a.titulo_id
                and anterior.rodada = a.rodada
                and anterior.nivel < a.nivel
                and anterior.decisao is distinct from 'APROVADO'
           )
      )`)
      // E quem lançou não vê o próprio título na fila de aprovação: RN-F04
      // recusaria a decisão de qualquer forma, e oferecer é convidar ao erro.
      clausulas.push(`t.created_by is distinct from ${u}`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(t.created_at, t.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const sql = `${SELECT_TITULO} where ${clausulas.join(' and ')}
      order by t.created_at desc, t.id desc limit $${valores.length}`

    const linhas = await db.consultar<LinhaTitulo>(sql, valores)
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async porId(db: Executor, id: string): Promise<TituloPagar | null> {
    const l = await db.consultarUm<LinhaTitulo>(
      `${SELECT_TITULO} where t.id = $1 and t.deleted_at is null`,
      [id],
    )
    return l ? mapear(l) : null
  }

  async niveisExigidos(db: Executor, valor: string): Promise<{ niveis: number; limites: string[] }> {
    const r = await db.consultarUm<{ niveis: number; limites: string[] | null }>(
      `select app.niveis_aprovacao_pagar($1::numeric) as niveis,
              (select array_agg(distinct a.limite_valor::text order by a.limite_valor::text)
                 from public.alcada a
                where a.tipo = 'APROVACAO_PAGAMENTO' and a.limite_valor is not null) as limites`,
      [valor],
    )
    return { niveis: Number(r!.niveis), limites: r!.limites ?? [] }
  }

  async criar(db: Executor, dados: CriarTituloPagar): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.titulo_pagar
         (tenant_id, empresa_id, filial_id, fornecedor_id, descricao, classificacao,
          contrato_fornecedor_ref, valor_original, data_emissao, data_vencimento,
          parcela_total, created_by, updated_by)
       values (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               app.usuario_atual(), app.usuario_atual())
       returning id`,
      [
        dados.empresa_id,
        dados.filial_id ?? null,
        dados.fornecedor_id ?? null,
        dados.descricao,
        dados.classificacao,
        dados.contrato_fornecedor_ref ?? null,
        dados.valor_original,
        dados.data_emissao,
        dados.data_vencimento,
        dados.parcelas > 1 ? dados.parcelas : null,
      ],
    )
    return l!.id
  }

  /**
   * As parcelas nascem todas ou nenhuma, na transação de quem chamou.
   *
   * O valor da última absorve a diferença de arredondamento. Dividir 1000 em 3
   * dá 333,33 três vezes e sobra um centavo — sem a correção, o parcelamento
   * fecha um centavo abaixo do título, e a diferença aparece na conciliação como
   * uma sobra que ninguém explica.
   */
  async criarParcelas(
    db: Executor,
    paiId: string,
    dados: CriarTituloPagar,
  ): Promise<void> {
    const total = dados.parcelas
    const valorTotal = Number(dados.valor_original)
    const base = Math.floor((valorTotal / total) * 100) / 100
    const vencimentoBase = new Date(`${dados.data_vencimento}T12:00:00Z`)

    for (let i = 1; i <= total; i++) {
      const valor = i === total ? Math.round((valorTotal - base * (total - 1)) * 100) / 100 : base
      const venc = new Date(vencimentoBase)
      venc.setUTCMonth(venc.getUTCMonth() + (i - 1))

      await db.consultar(
        `insert into public.titulo_pagar
           (tenant_id, empresa_id, filial_id, fornecedor_id, descricao, classificacao,
            contrato_fornecedor_ref, valor_original, data_emissao, data_vencimento,
            titulo_pai_id, parcela_numero, parcela_total, created_by, updated_by)
         values (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 app.usuario_atual(), app.usuario_atual())`,
        [
          dados.empresa_id,
          dados.filial_id ?? null,
          dados.fornecedor_id ?? null,
          `${dados.descricao} (${i}/${total})`,
          dados.classificacao,
          dados.contrato_fornecedor_ref ?? null,
          valor.toFixed(4),
          dados.data_emissao,
          venc.toISOString().slice(0, 10),
          paiId,
          i,
          total,
        ],
      )
    }
  }

  async gravarRateio(db: Executor, tituloId: string, rateio: RateioEntrada[]): Promise<void> {
    if (rateio.length === 0) return
    // Uma instrução só: o gatilho de statement confere a soma do conjunto, e
    // inserir linha por linha reprovaria a primeira.
    const valores: unknown[] = [tituloId]
    const tuplas = rateio.map((r) => {
      valores.push(r.centro_custo_id, r.percentual)
      return `(app.tenant_atual(), $1, $${valores.length - 1}, $${valores.length})`
    })
    await db.consultar(
      `insert into public.titulo_pagar_rateio (tenant_id, titulo_id, centro_custo_id, percentual)
       values ${tuplas.join(', ')}`,
      valores,
    )
  }

  async editar(
    db: Executor,
    id: string,
    versao: number,
    dados: EditarTituloPagar,
  ): Promise<boolean> {
    const l = await db.consultarUm<{ id: string }>(
      `update public.titulo_pagar
          set descricao = coalesce($3, descricao),
              classificacao = coalesce($4, classificacao),
              fornecedor_id = case when $5::boolean then $6 else fornecedor_id end,
              filial_id = case when $7::boolean then $8 else filial_id end,
              contrato_fornecedor_ref = case when $9::boolean then $10 else contrato_fornecedor_ref end,
              valor_original = coalesce($11, valor_original),
              data_vencimento = coalesce($12, data_vencimento),
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and version = $2 and deleted_at is null and status = 'PENDENTE'
        returning id`,
      [
        id,
        versao,
        dados.descricao ?? null,
        dados.classificacao ?? null,
        'fornecedor_id' in dados,
        dados.fornecedor_id ?? null,
        'filial_id' in dados,
        dados.filial_id ?? null,
        'contrato_fornecedor_ref' in dados,
        dados.contrato_fornecedor_ref ?? null,
        dados.valor_original ?? null,
        dados.data_vencimento ?? null,
      ],
    )
    return l !== null
  }

  async ajustarValor(db: Executor, id: string, versao: number, valor: string): Promise<boolean> {
    const l = await db.consultarUm<{ id: string }>(
      `update public.titulo_pagar
          set valor_ajustado = $3, version = version + 1,
              updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and version = $2 and deleted_at is null
          and status in ('PENDENTE','EM_APROVACAO','APROVADO','AGENDADO','PAGO_PARCIAL','EM_DISPUTA')
        returning id`,
      [id, versao, valor],
    )
    return l !== null
  }

  /**
   * Propaga o status do pai para as parcelas ainda pendentes.
   *
   * Existe por causa de um defeito que o teste de integração encontrou: as
   * parcelas nasciam `PENDENTE` e **nenhuma rodada de aprovação era aberta para
   * elas**. A aprovação vai para o pai — é ele que representa o compromisso
   * inteiro, e é o valor dele que a alçada avalia —, então as filhas ficavam
   * impagáveis para sempre, sem nada na tela explicando por quê.
   *
   * Só as pendentes: uma parcela já paga ou cancelada não volta atrás.
   */
  async propagarStatusParaParcelas(db: Executor, paiId: string, status: string): Promise<void> {
    await db.consultar(
      `update public.titulo_pagar
          set status = $2, updated_at = now(), updated_by = app.usuario_atual()
        where titulo_pai_id = $1 and deleted_at is null
          and status in ('PENDENTE', 'EM_APROVACAO', 'APROVADO')`,
      [paiId, status],
    )
  }

  async definirStatus(db: Executor, id: string, status: string): Promise<void> {
    await db.consultar(
      `update public.titulo_pagar set status = $2, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1`,
      [id, status],
    )
  }

  /** Abre a rodada de aprovação, uma linha por nível. Zero níveis = nada. */
  async abrirRodada(db: Executor, tituloId: string, niveis: number): Promise<number> {
    const r = await db.consultarUm<{ rodada: number }>(
      `select coalesce(max(rodada), 0) + 1 as rodada
         from public.titulo_pagar_aprovacao where titulo_id = $1`,
      [tituloId],
    )
    const rodada = Number(r!.rodada)

    for (let nivel = 1; nivel <= niveis; nivel++) {
      await db.consultar(
        `insert into public.titulo_pagar_aprovacao (tenant_id, titulo_id, nivel, rodada)
         values (app.tenant_atual(), $1, $2, $3)`,
        [tituloId, nivel, rodada],
      )
    }
    return rodada
  }

  async rodadaAtual(db: Executor, tituloId: string): Promise<number> {
    const r = await db.consultarUm<{ rodada: number }>(
      `select coalesce(max(rodada), 0) as rodada
         from public.titulo_pagar_aprovacao where titulo_id = $1`,
      [tituloId],
    )
    return Number(r!.rodada)
  }

  /**
   * Registra a decisão.
   *
   * `delegado_de` é resolvido no banco: se quem decide não tem posto próprio
   * para o nível, a autoridade veio de uma delegação vigente, e é ela que fica
   * registrada. Resolver no serviço exigiria uma consulta a mais e abriria a
   * possibilidade de gravar um delegante que não delegou nada.
   */
  async decidir(
    db: Executor,
    tituloId: string,
    nivel: number,
    rodada: number,
    usuarioId: string,
    decisao: 'APROVADO' | 'REJEITADO',
    justificativa: string | null,
  ): Promise<boolean> {
    const l = await db.consultarUm<{ id: string }>(
      `update public.titulo_pagar_aprovacao a
          set aprovador_id = $4, decisao = $5, decidido_em = now(), justificativa = $6,
              delegado_de = case
                when app.posto_alcada_pagar($4) >= a.nivel then null
                else (
                  select d.delegante_id from public.delegacao_aprovacao d
                   where d.delegado_id = $4 and d.nivel >= a.nivel
                     and current_date between d.inicio and d.fim
                   limit 1
                )
              end
        where a.titulo_id = $1 and a.nivel = $2 and a.rodada = $3 and a.decisao is null
        returning a.id`,
      [tituloId, nivel, rodada, usuarioId, decisao, justificativa],
    )
    return l !== null
  }

  /** Quantos níveis da rodada ainda esperam decisão. */
  async pendentesNaRodada(db: Executor, tituloId: string, rodada: number): Promise<number> {
    const r = await db.consultarUm<{ n: string }>(
      `select count(*) as n from public.titulo_pagar_aprovacao
        where titulo_id = $1 and rodada = $2 and decisao is null`,
      [tituloId, rodada],
    )
    return Number(r!.n)
  }

  async baixar(
    db: Executor,
    tituloId: string,
    dados: RegistrarPagamento,
  ): Promise<{ pagamento_id: string; movimentacao_id: string }> {
    const l = await db.consultarUm<{ pagamento_id: string; movimentacao_id: string }>(
      `select pagamento_id, movimentacao_id
         from app.baixar_titulo_pagar($1, $2::numeric, $3::date, $4, $5)`,
      [tituloId, dados.valor_pago, dados.data_pagamento, dados.conta_id, dados.forma],
    )
    return l!
  }

  async estornarPagamento(db: Executor, pagamentoId: string, motivo: string): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `select app.estornar_baixa_titulo_pagar($1, $2) as id`,
      [pagamentoId, motivo],
    )
    return l!.id
  }

  async parcelasPendentes(db: Executor, paiId: string): Promise<{ id: string; status: string }[]> {
    return db.consultar<{ id: string; status: string }>(
      `select id, status from public.titulo_pagar
        where titulo_pai_id = $1 and deleted_at is null order by parcela_numero`,
      [paiId],
    )
  }

  /* ------------------------------------------------------- delegação */

  async listarDelegacoes(
    db: Executor,
    filtro: ListarDelegacoes,
  ): Promise<{ linhas: Delegacao[]; temMais: boolean }> {
    const clausulas: string[] = ['true']
    const valores: unknown[] = []

    if (filtro.apenas_vigentes) clausulas.push('current_date between d.inicio and d.fim')

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(d.created_at, d.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const linhas = await db.consultar<{
      id: string
      delegante_id: string
      delegante_nome: string
      delegado_id: string
      delegado_nome: string
      nivel: number
      inicio: Date
      fim: Date
      motivo: string
      vigente: boolean
      created_at: Date
    }>(
      `select d.id, d.delegante_id, ug.nome as delegante_nome,
              d.delegado_id, ud.nome as delegado_nome,
              d.nivel, d.inicio, d.fim, d.motivo,
              (current_date between d.inicio and d.fim) as vigente,
              d.created_at
         from public.delegacao_aprovacao d
         join public.usuario ug on ug.id = d.delegante_id
         join public.usuario ud on ud.id = d.delegado_id
        where ${clausulas.join(' and ')}
        order by d.created_at desc, d.id desc
        limit $${valores.length}`,
      valores,
    )

    const pagina = linhas.slice(0, filtro.limit).map((l) => ({
      id: l.id,
      delegante_id: l.delegante_id,
      delegante_nome: l.delegante_nome,
      delegado_id: l.delegado_id,
      delegado_nome: l.delegado_nome,
      nivel: Number(l.nivel),
      inicio: dia(l.inicio),
      fim: dia(l.fim),
      motivo: l.motivo,
      vigente: l.vigente,
    }))
    return { linhas: pagina, temMais: linhas.length > filtro.limit }
  }

  /**
   * O delegante é sempre quem chama, nunca um id do corpo.
   *
   * Aceitar `delegante_id` na entrada permitiria a qualquer pessoa com a
   * permissão delegar a autoridade **de outra** — o que é a forma mais direta de
   * contornar a segregação de funções: eu delego a alçada do gestor para mim
   * mesmo e aprovo o que lancei.
   */
  async criarDelegacao(db: Executor, dados: CriarDelegacao): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.delegacao_aprovacao
         (tenant_id, delegante_id, delegado_id, nivel, inicio, fim, motivo, created_by)
       values (app.tenant_atual(), app.usuario_atual(), $1, $2, $3, $4, $5, app.usuario_atual())
       returning id`,
      [dados.delegado_id, dados.nivel, dados.inicio, dados.fim, dados.motivo],
    )
    return l!.id
  }

  async usuarioPorId(
    db: Executor,
    id: string,
  ): Promise<{ id: string; nome: string; email: string } | null> {
    return db.consultarUm<{ id: string; nome: string; email: string }>(
      `select id, nome, email from public.usuario where id = $1`,
      [id],
    )
  }

  /**
   * Quem pode decidir um nível, para o aviso saber a quem ir.
   *
   * Exclui o criador do título: RN-F04 recusaria a decisão dele, e avisar
   * alguém sobre algo que ele não pode fazer é ruído que ensina a ignorar o
   * aviso.
   */
  async aprovadoresDoNivel(
    db: Executor,
    nivel: number,
    excluirUsuarioId: string | null,
  ): Promise<{ id: string; nome: string; email: string }[]> {
    return db.consultar<{ id: string; nome: string; email: string }>(
      `select distinct u.id, u.nome, u.email
         from public.usuario u
        where u.status = 'ATIVO'
          and app.pode_decidir_nivel_pagar(u.id, $1)
          and ($2::uuid is null or u.id <> $2)
        order by u.nome`,
      [nivel, excluirUsuarioId],
    )
  }
}

export { mapear as mapearTitulo }
