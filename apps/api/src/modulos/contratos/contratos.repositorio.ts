import { Injectable } from '@nestjs/common'
import type { AlocarItem, Contrato, ContratoItem, CriarContrato, ListarContratos } from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor } from '../../comum/pagina.js'

const SELECT_CONTRATO = `
  select c.id, c.numero, c.cliente_id, cl.nome_fantasia as cliente_nome, c.filial_id, c.tipo,
         c.status, to_char(c.data_inicio, 'YYYY-MM-DD') as data_inicio,
         to_char(c.data_fim, 'YYYY-MM-DD') as data_fim, c.renovacao_automatica,
         c.valor_mensal_estimado::text as valor_mensal_estimado, c.version
    from public.contrato c
    join public.cliente cl on cl.id = c.cliente_id
`

const SELECT_ITEM = `
  select ci.id, ci.contrato_id, ci.equipamento_id, ci.categoria_id, ci.local_operacao_id,
         ci.modalidade_cobranca, ci.valor_unitario::text as valor_unitario,
         ci.quantidade::float8 as quantidade,
         ci.franquia_quantidade::float8 as franquia_quantidade, ci.franquia_escopo,
         ci.valor_excedente_unitario::text as valor_excedente_unitario,
         ci.valor_minimo_mensal::text as valor_minimo_mensal,
         ci.vigencia_inicio, ci.vigencia_fim, ci.status, ci.version
    from public.contrato_item ci
`

interface LinhaContrato extends Record<string, unknown> {
  id: string
  numero: string
  cliente_id: string
  cliente_nome: string | null
  filial_id: string
  tipo: string
  status: Contrato['status']
  data_inicio: string | null
  data_fim: string | null
  renovacao_automatica: boolean
  valor_mensal_estimado: string | null
  version: number
}

interface LinhaItem extends Record<string, unknown> {
  id: string
  contrato_id: string
  equipamento_id: string | null
  categoria_id: string | null
  local_operacao_id: string | null
  modalidade_cobranca: ContratoItem['modalidade_cobranca']
  valor_unitario: string
  quantidade: number
  franquia_quantidade: number | null
  franquia_escopo: 'ITEM' | 'CONTRATO' | null
  valor_excedente_unitario: string | null
  valor_minimo_mensal: string | null
  vigencia_inicio: Date
  vigencia_fim: Date | null
  status: ContratoItem['status']
  version: number
}

/** Conflito de RN-001, com o contexto necessário para explicar a recusa. */
export interface Conflito {
  contrato_numero: string
  contrato_id: string
  item_status: string
  vigencia_inicio: Date
  vigencia_fim: Date | null
}

@Injectable()
export class ContratosRepositorio {
  async listar(db: Executor, filtro: ListarContratos): Promise<{ linhas: Contrato[]; temMais: boolean }> {
    const clausulas = ['c.deleted_at is null']
    const valores: unknown[] = []
    const p = () => `$${valores.length}`

    if (filtro.status) {
      valores.push(filtro.status)
      clausulas.push(`c.status = ${p()}::app.contrato_status`)
    }
    if (filtro.cliente_id) {
      valores.push(filtro.cliente_id)
      clausulas.push(`c.cliente_id = ${p()}`)
    }
    if (filtro.filial_id) {
      valores.push(filtro.filial_id)
      clausulas.push(`c.filial_id = ${p()}`)
    }
    if (filtro.vence_ate) {
      valores.push(filtro.vence_ate)
      clausulas.push(`c.data_fim <= ${p()}::date`)
    }
    if (filtro.q) {
      valores.push(`${filtro.q}%`)
      clausulas.push(`upper(c.numero) like upper(${p()})`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(`(c.created_at, c.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`)
    }

    valores.push(filtro.limit + 1)
    const sql = `${SELECT_CONTRATO} where ${clausulas.join(' and ')}
                 order by c.created_at desc, c.id desc limit $${valores.length}`

    const linhas = await db.consultar<LinhaContrato>(sql, valores)
    const temMais = linhas.length > filtro.limit
    return { linhas: linhas.slice(0, filtro.limit).map(mapearContrato), temMais }
  }

  async porId(db: Executor, id: string): Promise<Contrato | null> {
    const l = await db.consultarUm<LinhaContrato>(`${SELECT_CONTRATO} where c.id = $1 and c.deleted_at is null`, [id])
    return l ? mapearContrato(l) : null
  }

  /**
   * Cria o contrato em rascunho.
   *
   * Sem `status` no INSERT: o default do banco é RASCUNHO, e repeti-lo aqui
   * criaria um segundo lugar onde o estado inicial está escrito.
   */
  async criar(db: Executor, tenantId: string, dados: CriarContrato): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.contrato
         (tenant_id, numero, empresa_id, filial_id, cliente_id, tipo,
          data_inicio, data_fim, prazo_minimo_meses, renovacao_automatica,
          observacoes_operacionais)
       values ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11)
       returning id`,
      [
        tenantId,
        dados.numero,
        dados.empresa_id,
        dados.filial_id,
        dados.cliente_id,
        dados.tipo,
        dados.data_inicio ?? null,
        dados.data_fim ?? null,
        dados.prazo_minimo_meses ?? null,
        dados.renovacao_automatica,
        dados.observacoes_operacionais ?? null,
      ],
    )
    return (l as { id: string }).id
  }

  /** `created_at` do contrato, necessário para compor o cursor da listagem. */
  async criadoEm(db: Executor, id: string): Promise<string | null> {
    const l = await db.consultarUm<{ created_at: Date }>(`select created_at from public.contrato where id = $1`, [id])
    return l ? l.created_at.toISOString() : null
  }

  async itensDoContrato(db: Executor, contratoId: string): Promise<ContratoItem[]> {
    const linhas = await db.consultar<LinhaItem>(
      `${SELECT_ITEM} where ci.contrato_id = $1 and ci.deleted_at is null order by ci.created_at`,
      [contratoId],
    )
    return linhas.map(mapearItem)
  }

  /**
   * Insere o item. O status inicial não vem do cliente, e isso é deliberado:
   * quem decide se a escrita ocupa o ativo é a regra, não o payload. Item com
   * equipamento nomeado entra como `RESERVADO` — estado ocupante, portanto
   * sujeito a RN-001. Item que aponta apenas categoria entra como `PLANEJADO`:
   * ainda não há ativo a reservar.
   */
  async inserirItem(db: Executor, contratoId: string, dto: AlocarItem): Promise<ContratoItem> {
    const status = dto.equipamento_id ? 'RESERVADO' : 'PLANEJADO'

    // Duas instruções, e não uma CTE `with novo as (insert ...) select ...`:
    // uma CTE que modifica dados não é visível para o restante da mesma
    // consulta — todas as partes enxergam o mesmo snapshot, de antes da
    // escrita. O SELECT viria vazio. Sequencial dentro da transação funciona,
    // porque a segunda instrução já enxerga o efeito da primeira.
    const inserido = await db.consultarUm<{ id: string }>(
      `insert into public.contrato_item (
           tenant_id, contrato_id, equipamento_id, categoria_id, local_operacao_id,
           modalidade_cobranca, valor_unitario, quantidade,
           franquia_quantidade, franquia_escopo, valor_excedente_unitario, valor_minimo_mensal,
           desconto_percentual, desconto_motivo,
           vigencia_inicio, vigencia_fim, status, observacao, created_by, updated_by
         ) values (
           app.exigir_tenant(), $1, $2, $3, $4,
           $5::app.modalidade_cobranca, $6::numeric, $7::numeric,
           $8::numeric, $9, $10::numeric, $11::numeric,
           $12::numeric, $13,
           $14::timestamptz, $15::timestamptz, $16::app.contrato_item_status, $17,
           app.usuario_atual(), app.usuario_atual()
         )
         returning id`,
      [
        contratoId,
        dto.equipamento_id,
        dto.categoria_id,
        dto.local_operacao_id,
        dto.modalidade_cobranca,
        dto.valor_unitario,
        dto.quantidade,
        dto.franquia_quantidade,
        dto.franquia_escopo,
        dto.valor_excedente_unitario,
        dto.valor_minimo_mensal,
        dto.desconto_percentual,
        dto.desconto_motivo,
        dto.vigencia_inicio,
        dto.vigencia_fim,
        status,
        dto.observacao ?? null,
      ],
    )
    if (!inserido) throw new Error('insert de contrato_item não retornou linha')

    const l = await db.consultarUm<LinhaItem>(`${SELECT_ITEM} where ci.id = $1`, [inserido.id])
    if (!l) throw new Error('item recém-inserido não encontrado na releitura')
    return mapearItem(l)
  }

  /**
   * Localiza a alocação que conflita, para transformar "não pode" em "não pode
   * porque o ativo está no contrato X até tal data".
   *
   * Roda **depois** do rollback, em conexão separada: uma transação abortada
   * recusa qualquer comando até o ROLLBACK, então não há como perguntar isso
   * dentro dela.
   */
  async conflitoDeVigencia(
    db: Executor,
    equipamentoId: string,
    inicio: string,
    fim: string | null,
  ): Promise<Conflito | null> {
    return db.consultarUm<Conflito & Record<string, unknown>>(
      `select c.numero as contrato_numero, c.id as contrato_id, ci.status::text as item_status,
              ci.vigencia_inicio, ci.vigencia_fim
         from public.contrato_item ci
         join public.contrato c on c.id = ci.contrato_id
        where ci.equipamento_id = $1
          and ci.deleted_at is null
          and ci.status in ('RESERVADO','EM_ENTREGA','ATIVO','SUSPENSO','EM_DEVOLUCAO')
          and ci.vigencia && tstzrange($2::timestamptz, coalesce($3::timestamptz, 'infinity'), '[)')
        order by ci.vigencia_inicio
        limit 1`,
      [equipamentoId, inicio, fim],
    )
  }

  /**
   * Ativos equivalentes livres no mesmo período — a alternativa que acompanha a
   * recusa. Sem ela o operador recebe um "não" e precisa procurar na mão.
   */
  async equivalentesLivres(
    db: Executor,
    equipamentoId: string,
    inicio: string,
    fim: string | null,
    limite = 3,
  ): Promise<{ id: string; patrimonio: string }[]> {
    return db.consultar<{ id: string; patrimonio: string }>(
      `select e.id, e.patrimonio
         from public.equipamento e
         join public.equipamento alvo on alvo.id = $1
        where e.categoria_id = alvo.categoria_id
          and e.filial_id = alvo.filial_id
          and e.id <> alvo.id
          and e.deleted_at is null
          and e.bloqueado = false
          and e.status in ('DISPONIVEL','LOCADO')
          and not exists (
            select 1 from public.contrato_item ci
             where ci.equipamento_id = e.id
               and ci.deleted_at is null
               and ci.status in ('RESERVADO','EM_ENTREGA','ATIVO','SUSPENSO','EM_DEVOLUCAO')
               and ci.vigencia && tstzrange($2::timestamptz, coalesce($3::timestamptz, 'infinity'), '[)')
          )
        order by e.patrimonio
        limit $4`,
      [equipamentoId, inicio, fim, limite],
    )
  }

  async situacaoCreditoDoContrato(db: Executor, contratoId: string): Promise<string | null> {
    const l = await db.consultarUm<{ situacao_credito: string }>(
      `select cl.situacao_credito::text
         from public.contrato c join public.cliente cl on cl.id = c.cliente_id
        where c.id = $1`,
      [contratoId],
    )
    return l?.situacao_credito ?? null
  }
}

function mapearContrato(l: LinhaContrato): Contrato {
  return {
    id: l.id,
    numero: l.numero,
    cliente_id: l.cliente_id,
    cliente_nome: l.cliente_nome,
    filial_id: l.filial_id,
    tipo: l.tipo,
    status: l.status,
    data_inicio: l.data_inicio,
    data_fim: l.data_fim,
    renovacao_automatica: l.renovacao_automatica,
    valor_mensal_estimado: l.valor_mensal_estimado as Contrato['valor_mensal_estimado'],
    version: l.version,
  }
}

function mapearItem(l: LinhaItem): ContratoItem {
  return {
    id: l.id,
    contrato_id: l.contrato_id,
    equipamento_id: l.equipamento_id,
    categoria_id: l.categoria_id,
    local_operacao_id: l.local_operacao_id,
    modalidade_cobranca: l.modalidade_cobranca,
    valor_unitario: l.valor_unitario as ContratoItem['valor_unitario'],
    quantidade: l.quantidade,
    franquia_quantidade: l.franquia_quantidade,
    franquia_escopo: l.franquia_escopo,
    valor_excedente_unitario: l.valor_excedente_unitario as ContratoItem['valor_excedente_unitario'],
    valor_minimo_mensal: l.valor_minimo_mensal as ContratoItem['valor_minimo_mensal'],
    vigencia_inicio: l.vigencia_inicio.toISOString(),
    vigencia_fim: l.vigencia_fim ? l.vigencia_fim.toISOString() : null,
    status: l.status,
    version: l.version,
  }
}
