import { Injectable } from '@nestjs/common'
import type {
  AprovacaoReceber,
  CriarTituloReceber,
  Dinheiro,
  EditarTituloReceber,
  ListarTitulosReceber,
  RateioReceber,
  RateioReceberEntrada,
  Recebimento,
  RegistrarRecebimento,
  TituloReceber,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor } from '../../comum/pagina.js'

/**
 * Acesso a dados de contas a receber.
 *
 * Nenhum `where tenant_id` e nenhum `where cliente_id`: os dois eixos de
 * isolamento são da RLS (migrações 0006 e 0020). O eixo de cliente importa aqui
 * mais que em qualquer outro módulo — é esta tabela que o Portal do Cliente vai
 * ler —, e é justamente por isso que ele **não** é filtro de consulta: um filtro
 * que alguém esqueça de aplicar numa rota nova expõe a cobrança de todo mundo.
 *
 * Nenhuma regra de negócio: as cinco invariantes do Módulo 11 são gatilhos na
 * 0020, onde valem também para quem não passa por aqui.
 */

const dinheiro = (v: string | number | null): Dinheiro => Number(v ?? 0).toFixed(4) as Dinheiro
const dia = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)

const SELECT_TITULO = `
  select t.id, t.numero_titulo, t.cliente_id, cl.razao_social as cliente_nome,
         t.filial_id, t.contrato_id, ct.numero as contrato_numero, t.competencia,
         t.origem, t.descricao,
         t.valor_original, t.desconto, t.valor_liquido,
         t.desconto_motivo, t.desconto_por,
         app.saldo_titulo_receber(t.id) as saldo,
         t.data_emissao, t.data_vencimento, t.status,
         t.baixa_motivo, t.baixado_em, t.excecao_geracao,
         t.titulo_pai_id, t.parcela_numero, t.parcela_total,
         t.version, t.created_at, t.created_by,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'centro_custo_id', r.centro_custo_id,
                    'centro_custo_codigo', c.codigo,
                    'centro_custo_nome', c.nome,
                    'percentual', r.percentual
                  ) order by c.codigo)
             from public.titulo_receber_rateio r
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
             from public.titulo_receber_aprovacao a
             left join public.usuario ua on ua.id = a.aprovador_id
             left join public.usuario ud on ud.id = a.delegado_de
            where a.titulo_id = t.id
         ), '[]'::jsonb) as aprovacoes,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', r.id, 'valor_recebido', r.valor_recebido,
                    'data_recebimento', r.data_recebimento,
                    'conta_id', r.conta_id, 'conta_apelido', cb.apelido,
                    'forma', r.forma, 'movimentacao_id', r.movimentacao_id,
                    'estornado_em', r.estornado_em, 'estorno_motivo', r.estorno_motivo
                  ) order by r.data_recebimento, r.created_at)
             from public.titulo_receber_recebimento r
             join public.conta_bancaria cb on cb.id = r.conta_id
            where r.titulo_id = t.id
         ), '[]'::jsonb) as recebimentos
    from public.titulo_receber t
    join public.cliente cl on cl.id = t.cliente_id
    left join public.contrato ct on ct.id = t.contrato_id
`

interface LinhaTitulo extends Record<string, unknown> {
  id: string
  numero_titulo: string
  cliente_id: string
  cliente_nome: string
  filial_id: string | null
  contrato_id: string | null
  contrato_numero: string | null
  competencia: string | null
  origem: TituloReceber['origem']
  descricao: string
  valor_original: string
  desconto: string
  valor_liquido: string
  desconto_motivo: string | null
  desconto_por: string | null
  saldo: string
  data_emissao: Date
  data_vencimento: Date
  status: TituloReceber['status']
  baixa_motivo: string | null
  baixado_em: Date | null
  excecao_geracao: string | null
  titulo_pai_id: string | null
  parcela_numero: number | null
  parcela_total: number | null
  version: number
  created_at: Date
  created_by: string | null
  rateio: unknown
  aprovacoes: unknown
  recebimentos: unknown
}

function mapear(l: LinhaTitulo): TituloReceber {
  const rateio = (l.rateio as RateioReceber[]).map((r) => ({ ...r, percentual: Number(r.percentual) }))
  const aprovacoes = (l.aprovacoes as (AprovacaoReceber & { decidido_em: string | null })[]).map((a) => ({
    ...a,
    nivel: Number(a.nivel),
    rodada: Number(a.rodada),
  }))
  const recebimentos = (l.recebimentos as (Recebimento & { data_recebimento: string })[]).map((r) => ({
    ...r,
    valor_recebido: dinheiro(r.valor_recebido),
    data_recebimento: dia(r.data_recebimento),
  }))

  return {
    id: l.id,
    // `bigint` chega como string do driver: converter é obrigatório, senão o
    // contrato recebe "12" onde declara número e o Zod recusa a própria resposta.
    numero_titulo: Number(l.numero_titulo),
    cliente_id: l.cliente_id,
    cliente_nome: l.cliente_nome,
    filial_id: l.filial_id,
    contrato_id: l.contrato_id,
    contrato_numero: l.contrato_numero,
    competencia: l.competencia === null ? null : l.competencia.trim(),
    origem: l.origem,
    descricao: l.descricao,
    valor_original: dinheiro(l.valor_original),
    desconto: dinheiro(l.desconto),
    valor_liquido: dinheiro(l.valor_liquido),
    desconto_motivo: l.desconto_motivo,
    desconto_por: l.desconto_por,
    saldo: dinheiro(l.saldo),
    data_emissao: dia(l.data_emissao),
    data_vencimento: dia(l.data_vencimento),
    status: l.status,
    baixa_motivo: l.baixa_motivo,
    baixado_em: l.baixado_em === null ? null : l.baixado_em.toISOString(),
    excecao_geracao: l.excecao_geracao,
    titulo_pai_id: l.titulo_pai_id,
    parcela_numero: l.parcela_numero,
    parcela_total: l.parcela_total,
    version: l.version,
    rateio,
    aprovacoes,
    recebimentos,
  }
}

/** Em aberto: o que ainda representa entrada de caixa esperada. */
const EM_ABERTO = `('PENDENTE_APROVACAO','PENDENTE','APROVADO','RECEBIDO_PARCIAL','EM_DISPUTA')`

export const cursorTitulo = (l: LinhaTitulo) => ({ criadoEm: l.created_at.toISOString(), id: l.id })

@Injectable()
export class ContasReceberRepositorio {
  async listar(
    db: Executor,
    filtro: ListarTitulosReceber,
    usuarioId: string,
  ): Promise<{ linhas: LinhaTitulo[]; temMais: boolean }> {
    const clausulas = ['t.deleted_at is null']
    const valores: unknown[] = []

    if (filtro.status) {
      valores.push(filtro.status)
      clausulas.push(`t.status = $${valores.length}`)
    }
    if (filtro.cliente_id) {
      valores.push(filtro.cliente_id)
      clausulas.push(`t.cliente_id = $${valores.length}`)
    }
    if (filtro.contrato_id) {
      valores.push(filtro.contrato_id)
      clausulas.push(`t.contrato_id = $${valores.length}`)
    }
    if (filtro.competencia) {
      valores.push(filtro.competencia)
      clausulas.push(`t.competencia = $${valores.length}`)
    }
    if (filtro.origem) {
      valores.push(filtro.origem)
      clausulas.push(`t.origem = $${valores.length}`)
    }
    if (filtro.vencimento_de) {
      valores.push(filtro.vencimento_de)
      clausulas.push(`t.data_vencimento >= $${valores.length}`)
    }
    if (filtro.vencimento_ate) {
      valores.push(filtro.vencimento_ate)
      clausulas.push(`t.data_vencimento <= $${valores.length}`)
    }
    /*
     * Em atraso é **calculado**, não um status.
     *
     * A simulação da interface guardava `EM_ATRASO` como valor de coluna: no dia
     * seguinte ao vencimento ele estava errado, e só um job noturno o
     * corrigiria. Aqui a data faz o trabalho, e a resposta está certa em
     * qualquer instante.
     */
    if (filtro.em_atraso) {
      clausulas.push(`t.data_vencimento < current_date and t.status in ${EM_ABERTO}`)
    }

    /*
     * A fila do aprovador, na consulta e não na tela.
     *
     * O `not exists` é o que faz a sequência valer aqui também: uma pré-cobrança
     * com o nível 1 pendente não aparece como decidível no nível 2. E o
     * `created_by is distinct from` é a segregação: no fechamento automático
     * quem "gera" é quem disparou o fechamento, então esta cláusula é o que
     * impede a mesma pessoa de fechar a competência e liberar as cobranças que
     * ela gerou.
     */
    if (filtro.minha_aprovacao) {
      valores.push(usuarioId)
      const u = `$${valores.length}`
      clausulas.push(`exists (
        select 1 from public.titulo_receber_aprovacao a
         where a.titulo_id = t.id
           and a.decisao is null
           and app.pode_decidir_nivel_receber(${u}, a.nivel)
           and not exists (
             select 1 from public.titulo_receber_aprovacao anterior
              where anterior.titulo_id = a.titulo_id
                and anterior.rodada = a.rodada
                and anterior.nivel < a.nivel
                and anterior.decisao is distinct from 'APROVADO'
           )
      )`)
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

  async porId(db: Executor, id: string): Promise<TituloReceber | null> {
    const l = await db.consultarUm<LinhaTitulo>(
      `${SELECT_TITULO} where t.id = $1 and t.deleted_at is null`,
      [id],
    )
    return l ? mapear(l) : null
  }

  async niveisExigidos(db: Executor, valor: string): Promise<{ niveis: number; limites: string[] }> {
    const r = await db.consultarUm<{ niveis: number; limites: string[] | null }>(
      `select app.niveis_aprovacao_receber($1::numeric) as niveis,
              (select array_agg(distinct a.limite_valor::text order by a.limite_valor::text)
                 from public.alcada a
                where a.tipo = 'EMISSAO_FATURA' and a.limite_valor is not null) as limites`,
      [valor],
    )
    return { niveis: Number(r!.niveis), limites: r!.limites ?? [] }
  }

  /** Teto de desconto do usuário corrente, em percentual. Zero = não concede. */
  async limiteDesconto(db: Executor, usuarioId: string): Promise<number> {
    const r = await db.consultarUm<{ limite: string }>(
      `select app.limite_desconto_percentual($1) as limite`,
      [usuarioId],
    )
    return Number(r!.limite)
  }

  async criar(db: Executor, dados: CriarTituloReceber): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.titulo_receber
         (tenant_id, cliente_id, filial_id, origem, descricao, valor_original,
          data_emissao, data_vencimento, parcela_total, status, created_by, updated_by)
       values (app.tenant_atual(), $1, $2, 'AVULSO', $3, $4, $5, $6, $7,
               'PENDENTE_APROVACAO', app.usuario_atual(), app.usuario_atual())
       returning id`,
      [
        dados.cliente_id,
        dados.filial_id ?? null,
        dados.descricao,
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
   * A última absorve a diferença de arredondamento: dividir 1000 em 3 dá 333,33
   * três vezes e sobra um centavo. Sem a correção, a soma das parcelas fica
   * abaixo do título — e é a soma que o cliente vai pagar.
   */
  async criarParcelas(db: Executor, paiId: string, dados: CriarTituloReceber): Promise<void> {
    const total = dados.parcelas
    const valorTotal = Number(dados.valor_original)
    const base = Math.floor((valorTotal / total) * 100) / 100
    const vencimentoBase = new Date(`${dados.data_vencimento}T12:00:00Z`)

    for (let i = 1; i <= total; i++) {
      const valor = i === total ? Math.round((valorTotal - base * (total - 1)) * 100) / 100 : base
      const venc = new Date(vencimentoBase)
      venc.setUTCMonth(venc.getUTCMonth() + (i - 1))

      await db.consultar(
        `insert into public.titulo_receber
           (tenant_id, cliente_id, filial_id, origem, descricao, valor_original,
            data_emissao, data_vencimento, titulo_pai_id, parcela_numero, parcela_total,
            status, created_by, updated_by)
         values (app.tenant_atual(), $1, $2, 'AVULSO', $3, $4, $5, $6, $7, $8, $9,
                 'PENDENTE_APROVACAO', app.usuario_atual(), app.usuario_atual())`,
        [
          dados.cliente_id,
          dados.filial_id ?? null,
          `${dados.descricao} (${i}/${total})`,
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

  async gravarRateio(db: Executor, tituloId: string, rateio: RateioReceberEntrada[]): Promise<void> {
    if (rateio.length === 0) return
    // Uma instrução só: o gatilho de statement confere a soma do conjunto, e
    // inserir linha por linha reprovaria a primeira.
    const valores: unknown[] = [tituloId]
    const tuplas = rateio.map((r) => {
      valores.push(r.centro_custo_id, r.percentual)
      return `(app.tenant_atual(), $1, $${valores.length - 1}, $${valores.length})`
    })
    await db.consultar(
      `insert into public.titulo_receber_rateio (tenant_id, titulo_id, centro_custo_id, percentual)
       values ${tuplas.join(', ')}`,
      valores,
    )
  }

  async editar(db: Executor, id: string, versao: number, dados: EditarTituloReceber): Promise<boolean> {
    const l = await db.consultarUm<{ id: string }>(
      `update public.titulo_receber
          set descricao = coalesce($3, descricao),
              filial_id = case when $4::boolean then $5 else filial_id end,
              valor_original = coalesce($6, valor_original),
              data_vencimento = coalesce($7, data_vencimento),
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and version = $2 and deleted_at is null
          and status in ('PENDENTE_APROVACAO', 'PENDENTE')
        returning id`,
      [
        id,
        versao,
        dados.descricao ?? null,
        'filial_id' in dados,
        dados.filial_id ?? null,
        dados.valor_original ?? null,
        dados.data_vencimento ?? null,
      ],
    )
    return l !== null
  }

  /**
   * Aplica o desconto. A alçada é conferida no gatilho, não aqui.
   *
   * O `where` não restringe status: o gatilho da 0020 é quem sabe quais estados
   * aceitam desconto, e duplicar a lista aqui criaria duas fontes para a mesma
   * regra — a que divergiria seria justamente esta, na primeira vez que o
   * gatilho mudasse.
   */
  async aplicarDesconto(
    db: Executor,
    id: string,
    versao: number,
    desconto: string,
    motivo: string,
  ): Promise<boolean> {
    const l = await db.consultarUm<{ id: string }>(
      `update public.titulo_receber
          set desconto = $3, desconto_motivo = $4,
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and version = $2 and deleted_at is null
        returning id`,
      [id, versao, desconto, motivo],
    )
    return l !== null
  }

  async definirStatus(db: Executor, id: string, status: string): Promise<void> {
    await db.consultar(
      `update public.titulo_receber set status = $2, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1`,
      [id, status],
    )
  }

  /**
   * Propaga o status do pai para as parcelas ainda abertas.
   *
   * A aprovação é do pai — é ele que representa o compromisso inteiro, e é o
   * valor dele que a alçada avalia. Sem a propagação as filhas ficariam
   * `PENDENTE_APROVACAO` esperando uma rodada que ninguém abriu, e portanto
   * nunca receberiam. Foi o defeito que o Módulo 10 já teve.
   */
  async propagarStatusParaParcelas(db: Executor, paiId: string, status: string): Promise<void> {
    await db.consultar(
      `update public.titulo_receber
          set status = $2, updated_at = now(), updated_by = app.usuario_atual()
        where titulo_pai_id = $1 and deleted_at is null
          and status in ('PENDENTE_APROVACAO', 'PENDENTE', 'APROVADO')`,
      [paiId, status],
    )
  }

  /**
   * Abre a rodada de aprovação, com piso de um nível.
   *
   * O piso vem do serviço para o contratual e é 0 para o avulso abaixo da menor
   * faixa; aqui só se insere o que foi pedido.
   */
  async abrirRodada(db: Executor, tituloId: string, niveis: number): Promise<number> {
    const r = await db.consultarUm<{ rodada: number }>(
      `select coalesce(max(rodada), 0) + 1 as rodada
         from public.titulo_receber_aprovacao where titulo_id = $1`,
      [tituloId],
    )
    const rodada = Number(r!.rodada)

    for (let nivel = 1; nivel <= niveis; nivel++) {
      await db.consultar(
        `insert into public.titulo_receber_aprovacao (tenant_id, titulo_id, nivel, rodada)
         values (app.tenant_atual(), $1, $2, $3)`,
        [tituloId, nivel, rodada],
      )
    }
    return rodada
  }

  async rodadaAtual(db: Executor, tituloId: string): Promise<number> {
    const r = await db.consultarUm<{ rodada: number }>(
      `select coalesce(max(rodada), 0) as rodada
         from public.titulo_receber_aprovacao where titulo_id = $1`,
      [tituloId],
    )
    return Number(r!.rodada)
  }

  /**
   * Registra a decisão. `delegado_de` é resolvido no banco.
   *
   * Se quem decide não tem posto próprio para o nível, a autoridade veio de uma
   * delegação vigente, e é ela que fica registrada. Resolver no serviço abriria
   * a possibilidade de gravar um delegante que não delegou nada.
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
      `update public.titulo_receber_aprovacao a
          set aprovador_id = $4, decisao = $5, decidido_em = now(), justificativa = $6,
              delegado_de = case
                when app.posto_alcada_receber($4) >= a.nivel then null
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

  async pendentesNaRodada(db: Executor, tituloId: string, rodada: number): Promise<number> {
    const r = await db.consultarUm<{ n: string }>(
      `select count(*) as n from public.titulo_receber_aprovacao
        where titulo_id = $1 and rodada = $2 and decisao is null`,
      [tituloId, rodada],
    )
    return Number(r!.n)
  }

  async receber(
    db: Executor,
    tituloId: string,
    dados: RegistrarRecebimento,
  ): Promise<{ recebimento_id: string; movimentacao_id: string }> {
    const l = await db.consultarUm<{ recebimento_id: string; movimentacao_id: string }>(
      `select recebimento_id, movimentacao_id
         from app.receber_titulo($1, $2::numeric, $3::date, $4, $5)`,
      [tituloId, dados.valor_recebido, dados.data_recebimento, dados.conta_id, dados.forma],
    )
    return l!
  }

  async estornarRecebimento(db: Executor, recebimentoId: string, motivo: string): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `select app.estornar_recebimento($1, $2) as id`,
      [recebimentoId, motivo],
    )
    return l!.id
  }

  async baixarSemRecebimento(db: Executor, tituloId: string, motivo: string): Promise<void> {
    await db.consultar(`select app.baixar_sem_recebimento($1, $2)`, [tituloId, motivo])
  }

  async parcelas(db: Executor, paiId: string): Promise<{ id: string; status: string }[]> {
    return db.consultar<{ id: string; status: string }>(
      `select id, status from public.titulo_receber
        where titulo_pai_id = $1 and deleted_at is null order by parcela_numero`,
      [paiId],
    )
  }

  /* --------------------------------------------- fechamento de competência */

  /**
   * A prévia do fechamento: o que vai acontecer, antes de acontecer.
   *
   * Consulta separada da função de fechamento de propósito. Ela **não** escreve,
   * então pode ser chamada quantas vezes a tela quiser sem selar nada — e é o
   * que permite responder "isto vai gerar 34 cobranças, 2 delas em disputa"
   * antes de o operador confirmar.
   */
  async previaFechamento(
    db: Executor,
    competencia: string,
  ): Promise<{
    contratos: number
    titulos_a_gerar: number
    ja_existentes: number
    valor_total: string
    excecoes: { contrato_id: string; contrato_numero: string; motivo: string }[]
  }> {
    const linhas = await db.consultar<{
      contrato_id: string
      contrato_numero: string
      status: string
      data_fim: Date | null
      valor: string
      preco_ausente: number
      ja_existe: boolean
    }>(
      `with ultimo_dia as (
         select (to_date($1 || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date as dia
       )
       select c.id as contrato_id, c.numero as contrato_numero, c.status::text as status,
              c.data_fim,
              (vc.valor_mensal + vc.valor_excedente - vc.desconto)::text as valor,
              vc.preco_ausente,
              exists (
                select 1 from public.titulo_receber t
                 where t.contrato_id = c.id and t.competencia = $1
                   and t.origem = 'CONTRATUAL' and t.deleted_at is null
                   and t.titulo_pai_id is null
              ) as ja_existe
         from public.contrato c
        cross join ultimo_dia u
        cross join lateral app.valor_contratual_competencia(c.id, $1) vc
        where c.deleted_at is null
          and exists (
            select 1 from public.consumo_competencia cc
            join public.contrato_item ci on ci.id = cc.contrato_item_id
           where cc.competencia = $1 and ci.contrato_id = c.id
          )
        order by c.numero`,
      [competencia],
    )

    const semVigencia = new Set(['SUSPENSO', 'ENCERRADO', 'CANCELADO', 'DISTRATADO'])
    const ultimoDia = new Date(Date.UTC(Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7)), 0))
    const excecoes: { contrato_id: string; contrato_numero: string; motivo: string }[] = []
    let aGerar = 0
    let jaExistentes = 0
    let total = 0

    for (const l of linhas) {
      const valor = Number(l.valor)
      // Valor zero não gera título: uma cobrança de nada é pior que nenhuma.
      if (!(valor > 0)) continue
      if (l.ja_existe) {
        jaExistentes += 1
        continue
      }
      aGerar += 1
      total += valor

      if (semVigencia.has(l.status)) {
        excecoes.push({
          contrato_id: l.contrato_id,
          contrato_numero: l.contrato_numero,
          motivo: `Contrato em ${l.status} no fechamento de ${competencia}.`,
        })
      } else if (l.data_fim !== null && new Date(dia(l.data_fim)) < ultimoDia) {
        excecoes.push({
          contrato_id: l.contrato_id,
          contrato_numero: l.contrato_numero,
          motivo: `Contrato venceu em ${dia(l.data_fim)}, antes do fim de ${competencia}.`,
        })
      } else if (Number(l.preco_ausente) > 0) {
        excecoes.push({
          contrato_id: l.contrato_id,
          contrato_numero: l.contrato_numero,
          motivo: `${l.preco_ausente} item(ns) sem política de preço vigente em ${competencia}.`,
        })
      }
    }

    return {
      contratos: linhas.length,
      titulos_a_gerar: aGerar,
      ja_existentes: jaExistentes,
      valor_total: total.toFixed(4),
      excecoes,
    }
  }

  async fecharCompetencia(
    db: Executor,
    competencia: string,
  ): Promise<{
    titulos_criados: number
    em_disputa: number
    consumos_selados: number
    ja_existiam: number
  }> {
    const l = await db.consultarUm<{
      titulos_criados: number
      em_disputa: number
      consumos_selados: number
      ja_existiam: number
    }>(
      `select titulos_criados, em_disputa, consumos_selados, ja_existiam
         from app.fechar_competencia($1)`,
      [competencia],
    )
    return {
      titulos_criados: Number(l!.titulos_criados),
      em_disputa: Number(l!.em_disputa),
      consumos_selados: Number(l!.consumos_selados),
      ja_existiam: Number(l!.ja_existiam),
    }
  }

  /**
   * Os títulos recém-criados por um fechamento, para o aviso saber quais são.
   *
   * Filtra por `created_by = usuário atual` **e** competência: é o recorte do
   * que esta chamada acabou de gerar, sem depender de a função devolver ids.
   */
  async contratuaisPendentes(
    db: Executor,
    competencia: string,
  ): Promise<{ id: string; descricao: string; valor_liquido: string; data_vencimento: Date }[]> {
    return db.consultar(
      `select t.id, t.descricao, t.valor_liquido, t.data_vencimento
         from public.titulo_receber t
        where t.competencia = $1
          and t.origem = 'CONTRATUAL'
          and t.status = 'PENDENTE_APROVACAO'
          and t.created_by = app.usuario_atual()
          and t.deleted_at is null
        order by t.numero_titulo`,
      [competencia],
    )
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
   * Quem pode decidir um nível de emissão, para o aviso saber a quem ir.
   *
   * Exclui quem gerou: a segregação recusaria a decisão dele, e avisar alguém
   * sobre algo que ele não pode fazer é ruído que ensina a ignorar o aviso.
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
          and app.pode_decidir_nivel_receber(u.id, $1)
          and ($2::uuid is null or u.id <> $2)
        order by u.nome`,
      [nivel, excluirUsuarioId],
    )
  }
}

export { mapear as mapearTituloReceber }
