import { Injectable } from '@nestjs/common'
import type {
  AtualizarCliente,
  Cliente,
  CriarCliente,
  CriarLocalOperacao,
  DefinirCredito,
  ListarClientes,
  LocalOperacao,
  Visao360,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor } from '../../comum/pagina.js'
import { EM_ABERTO } from '../contas-receber/contas-receber.repositorio.js'

/**
 * Acesso a dados de cliente.
 *
 * Como nos demais repositórios: **nenhum `where tenant_id`**. O isolamento é da
 * RLS, dentro do banco. Escrevê-lo aqui daria a impressão de que o isolamento
 * depende de o SQL estar certo, e um filtro esquecido numa consulta nova
 * passaria batido — que é exatamente o modo como esse tipo de defeito entra.
 *
 * O mesmo vale para a política de cliente da migração 0011: um usuário de
 * cliente que chame `GET /clientes` recebe o próprio CNPJ e os do grupo, e não
 * porque esta classe filtra — porque a política restritiva já filtrou.
 */
const SELECT_BASE = `
  select c.id, c.tipo_pessoa, c.documento, c.razao_social, c.nome_fantasia,
         c.inscricao_estadual, c.inscricao_municipal,
         c.limite_credito, c.situacao_credito, c.filial_responsavel_id,
         c.grupo_economico_id, c.cnpj_raiz, c.version, c.created_at
    from public.cliente c
`

export interface LinhaCliente extends Record<string, unknown> {
  id: string
  tipo_pessoa: string
  documento: string
  razao_social: string
  nome_fantasia: string | null
  inscricao_estadual: string | null
  inscricao_municipal: string | null
  limite_credito: string | null
  situacao_credito: Cliente['situacao_credito']
  filial_responsavel_id: string | null
  grupo_economico_id: string | null
  cnpj_raiz: string | null
  version: number
  created_at: Date
}

export function mapearCliente(c: LinhaCliente): Cliente {
  return {
    id: c.id,
    tipo_pessoa: c.tipo_pessoa.trim() as Cliente['tipo_pessoa'],
    documento: c.documento,
    razao_social: c.razao_social,
    nome_fantasia: c.nome_fantasia,
    inscricao_estadual: c.inscricao_estadual,
    inscricao_municipal: c.inscricao_municipal,
    limite_credito: c.limite_credito as Cliente['limite_credito'],
    situacao_credito: c.situacao_credito,
    filial_responsavel_id: c.filial_responsavel_id,
    grupo_economico_id: c.grupo_economico_id,
    cnpj_raiz: c.cnpj_raiz,
    version: c.version,
  }
}

export const cursorDe = (c: LinhaCliente) => ({ criadoEm: c.created_at.toISOString(), id: c.id })

@Injectable()
export class ClientesRepositorio {
  async listar(
    db: Executor,
    filtro: ListarClientes,
  ): Promise<{ linhas: LinhaCliente[]; temMais: boolean }> {
    const clausulas = ['c.deleted_at is null']
    const valores: unknown[] = []

    if (filtro.documento) {
      valores.push(`${filtro.documento}%`)
      clausulas.push(`c.documento like $${valores.length}`)
    }
    if (filtro.situacao_credito) {
      valores.push(filtro.situacao_credito)
      clausulas.push(`c.situacao_credito = $${valores.length}::app.situacao_credito`)
    }
    if (filtro.filial_id) {
      valores.push(filtro.filial_id)
      clausulas.push(`c.filial_responsavel_id = $${valores.length}`)
    }
    if (filtro.q) {
      /*
       * `unaccent` não está instalada, e a busca precisa achar "São" digitando
       * "sao". `translate` resolve o caso brasileiro sem uma extensão a mais no
       * caminho do deploy — e a lista de acentos é fixa, não uma regra de
       * negócio.
       */
      valores.push(`%${filtro.q}%`)
      const p = `$${valores.length}`
      const semAcento = (col: string) =>
        `translate(lower(${col}), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')`
      clausulas.push(
        `(${semAcento('c.razao_social')} like ${semAcento(p)} or ${semAcento('coalesce(c.nome_fantasia, \'\')')} like ${semAcento(p)})`,
      )
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(c.created_at, c.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const linhas = await db.consultar<LinhaCliente>(
      `${SELECT_BASE} where ${clausulas.join(' and ')}
        order by c.created_at desc, c.id desc limit $${valores.length}`,
      valores,
    )
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async porId(db: Executor, id: string): Promise<LinhaCliente | null> {
    return db.consultarUm<LinhaCliente>(
      `${SELECT_BASE} where c.id = $1 and c.deleted_at is null`,
      [id],
    )
  }

  async criar(db: Executor, dados: CriarCliente, tenantId: string): Promise<LinhaCliente> {
    const l = await db.consultarUm<LinhaCliente>(
      `insert into public.cliente
         (tenant_id, tipo_pessoa, documento, razao_social, nome_fantasia,
          inscricao_estadual, inscricao_municipal, filial_responsavel_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, tipo_pessoa, documento, razao_social, nome_fantasia,
                 inscricao_estadual, inscricao_municipal, limite_credito,
                 situacao_credito, filial_responsavel_id, grupo_economico_id,
                 cnpj_raiz, version, created_at`,
      [
        tenantId,
        dados.tipo_pessoa,
        dados.documento,
        dados.razao_social,
        dados.nome_fantasia ?? null,
        dados.inscricao_estadual ?? null,
        dados.inscricao_municipal ?? null,
        dados.filial_responsavel_id ?? null,
      ],
    )
    return l as LinhaCliente
  }

  /**
   * Atualização parcial com controle de versão.
   *
   * O `version` no `where` é o que transforma duas edições simultâneas em um
   * 409 em vez de uma sobrescrita silenciosa. Sem ele, quem salvou por último
   * apaga o trabalho do outro e ninguém fica sabendo.
   */
  async atualizar(
    db: Executor,
    id: string,
    versao: number,
    dados: AtualizarCliente,
  ): Promise<LinhaCliente | null> {
    const campos: string[] = []
    const valores: unknown[] = []
    for (const [coluna, valor] of Object.entries(dados)) {
      valores.push(valor)
      campos.push(`${coluna} = $${valores.length}`)
    }
    valores.push(id)
    valores.push(versao)
    const where = [
      `id = $${valores.length - 1}`,
      'deleted_at is null',
      `version = $${valores.length}`,
    ]

    return db.consultarUm<LinhaCliente>(
      `update public.cliente set ${campos.join(', ')}, version = version + 1
        where ${where.join(' and ')}
       returning id, tipo_pessoa, documento, razao_social, nome_fantasia,
                 inscricao_estadual, inscricao_municipal, limite_credito,
                 situacao_credito, filial_responsavel_id, grupo_economico_id,
                 cnpj_raiz, version, created_at`,
      valores,
    )
  }

  async definirCredito(
    db: Executor,
    id: string,
    dados: DefinirCredito,
  ): Promise<LinhaCliente | null> {
    return db.consultarUm<LinhaCliente>(
      `update public.cliente
          set limite_credito = $2::numeric,
              situacao_credito = $3::app.situacao_credito,
              version = version + 1
        where id = $1 and deleted_at is null
       returning id, tipo_pessoa, documento, razao_social, nome_fantasia,
                 inscricao_estadual, inscricao_municipal, limite_credito,
                 situacao_credito, filial_responsavel_id, grupo_economico_id,
                 cnpj_raiz, version, created_at`,
      [id, dados.limite_credito, dados.situacao_credito],
    )
  }

  /* ------------------------------------------------------ locais de operação */

  async locais(db: Executor, clienteId: string): Promise<LocalOperacao[]> {
    const linhas = await db.consultar<{
      id: string
      cliente_id: string
      nome: string
      lat: number | null
      lon: number | null
      geo_precisao: LocalOperacao['geo_precisao']
      geo_fonte: string | null
      geo_atualizado_em: Date | null
    }>(
      `select l.id, l.cliente_id, l.nome,
              st_y(l.geo::geometry) as lat, st_x(l.geo::geometry) as lon,
              l.geo_precisao, l.geo_fonte, l.geo_atualizado_em
         from public.local_operacao l
        where l.cliente_id = $1 and l.deleted_at is null
        order by l.nome`,
      [clienteId],
    )
    return linhas.map((l) => ({
      id: l.id,
      cliente_id: l.cliente_id,
      nome: l.nome,
      lat: l.lat,
      lon: l.lon,
      geo_precisao: l.geo_precisao,
      geo_fonte: l.geo_fonte,
      geo_atualizado_em: l.geo_atualizado_em ? l.geo_atualizado_em.toISOString() : null,
    }))
  }

  async criarLocal(
    db: Executor,
    tenantId: string,
    clienteId: string,
    dados: CriarLocalOperacao,
  ): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.local_operacao
         (tenant_id, cliente_id, codigo, nome, endereco, responsavel, janela_acesso, restricoes)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       returning id`,
      [
        tenantId,
        clienteId,
        dados.codigo ?? null,
        dados.nome,
        JSON.stringify(dados.endereco),
        dados.responsavel ?? null,
        dados.janela_acesso ?? null,
        dados.restricoes ?? null,
      ],
    )
    return (l as { id: string }).id
  }

  /* ------------------------------------------------------------- visão 360 */

  /**
   * Os três blocos que **têm fonte**: contratos, parque e cobrança.
   *
   * Uma consulta só, com três subconsultas, e não três viagens ao banco: os
   * números aparecem juntos na tela e precisam ser do mesmo instante. Somas
   * lidas em transações diferentes podem não fechar entre si, e a tela mostraria
   * um total que nenhum estado do banco já teve.
   */
  async visao360(
    db: Executor,
    clienteId: string,
  ): Promise<Omit<Visao360, 'cliente' | 'ausentes'>> {
    const l = await db.consultarUm<{
      contratos_total: string
      contratos_ativos: string
      proximo_vencimento: string | null
      parque_total: string
      por_status: Record<string, number>
      em_aberto: string
      vencido: string
      vencido_mais_30: string
    }>(
      `select
         (select count(*) from public.contrato ct
           where ct.cliente_id = $1 and ct.deleted_at is null) as contratos_total,
         (select count(*) from public.contrato ct
           where ct.cliente_id = $1 and ct.deleted_at is null and ct.status = 'ATIVO') as contratos_ativos,
         (select min(ct.data_fim) from public.contrato ct
           where ct.cliente_id = $1 and ct.deleted_at is null and ct.status = 'ATIVO'
             and ct.data_fim >= current_date) as proximo_vencimento,
         (select count(*) from public.equipamento e
           where e.cliente_id = $1 and e.deleted_at is null) as parque_total,
         coalesce((select jsonb_object_agg(x.status, x.n) from (
            select e.status::text as status, count(*)::int as n
              from public.equipamento e
             where e.cliente_id = $1 and e.deleted_at is null
             group by e.status) x), '{}'::jsonb) as por_status,
         coalesce((select sum(app.saldo_titulo_receber(t.id)) from public.titulo_receber t
           where t.cliente_id = $1 and t.status in ${EM_ABERTO}), 0) as em_aberto,
         coalesce((select sum(app.saldo_titulo_receber(t.id)) from public.titulo_receber t
           where t.cliente_id = $1 and t.status in ${EM_ABERTO}
             and t.data_vencimento < current_date), 0) as vencido,
         coalesce((select sum(app.saldo_titulo_receber(t.id)) from public.titulo_receber t
           where t.cliente_id = $1 and t.status in ${EM_ABERTO}
             and t.data_vencimento < current_date - 30), 0) as vencido_mais_30`,
      [clienteId],
    )
    const r = l as NonNullable<typeof l>
    const dinheiro = (v: string) => Number(v).toFixed(4) as Visao360['cobranca']['em_aberto']
    return {
      contratos: {
        total: Number(r.contratos_total),
        ativos: Number(r.contratos_ativos),
        proximo_vencimento: r.proximo_vencimento,
      },
      parque: { total: Number(r.parque_total), por_status: r.por_status },
      cobranca: {
        em_aberto: dinheiro(r.em_aberto),
        vencido: dinheiro(r.vencido),
        vencido_mais_30: dinheiro(r.vencido_mais_30),
      },
    }
  }
}
