import { Injectable } from '@nestjs/common'
import type {
  CriarLancamentoFuturo,
  CriarRecorrencia,
  Dinheiro,
  EditarLancamentoFuturo,
  EditarRecorrencia,
  LancamentoFuturo,
  ListarLancamentosFuturos,
  ListarRecorrencias,
  Recorrencia,
} from '@iarx/contracts'
import { ladoDoTipo } from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor } from '../../comum/pagina.js'

/**
 * Acesso a dados de lançamentos futuros e recorrências.
 *
 * Nenhum `where tenant_id`: o isolamento é da RLS (migração 0021). Nenhuma regra
 * de negócio: as quatro invariantes do Módulo 12 são gatilhos e funções na mesma
 * migração, onde valem também para quem não passa por aqui.
 *
 * `lado` não é escrito a partir da entrada — é derivado de `tipo` pelo mesmo
 * `ladoDoTipo` que o contrato expõe, e o banco tem o CHECK que impede os dois de
 * discordarem. Três lugares para a mesma regra parece muito; a alternativa é
 * confiar que nenhum caminho futuro mande os dois campos e erre um.
 */

const dinheiro = (v: string | number | null): Dinheiro => Number(v ?? 0).toFixed(4) as Dinheiro
const dia = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)

const SELECT_LF = `
  select lf.id, lf.tipo, lf.lado, lf.descricao, lf.valor_previsto, lf.data_prevista,
         lf.empresa_id, lf.fornecedor_id, f.razao_social as fornecedor_nome,
         lf.classificacao, lf.cliente_id, cl.razao_social as cliente_nome,
         lf.centro_custo_id, cc.nome as centro_custo_nome,
         lf.contrato_id, ct.numero as contrato_numero, lf.filial_id,
         lf.recorrencia_id, r.descricao as recorrencia_descricao,
         lf.status, lf.titulo_pagar_id, lf.titulo_receber_id, lf.convertido_em,
         lf.excecao_conversao, lf.tentativas_conversao,
         lf.version, lf.created_at
    from public.lancamento_futuro lf
    left join public.fornecedor f on f.id = lf.fornecedor_id
    left join public.cliente cl on cl.id = lf.cliente_id
    left join public.centro_custo cc on cc.id = lf.centro_custo_id
    left join public.contrato ct on ct.id = lf.contrato_id
    left join public.recorrencia r on r.id = lf.recorrencia_id
`

interface LinhaLf extends Record<string, unknown> {
  id: string
  tipo: LancamentoFuturo['tipo']
  lado: LancamentoFuturo['lado']
  descricao: string
  valor_previsto: string
  data_prevista: Date
  empresa_id: string | null
  fornecedor_id: string | null
  fornecedor_nome: string | null
  classificacao: LancamentoFuturo['classificacao']
  cliente_id: string | null
  cliente_nome: string | null
  centro_custo_id: string | null
  centro_custo_nome: string | null
  contrato_id: string | null
  contrato_numero: string | null
  filial_id: string | null
  recorrencia_id: string | null
  recorrencia_descricao: string | null
  status: LancamentoFuturo['status']
  titulo_pagar_id: string | null
  titulo_receber_id: string | null
  convertido_em: Date | null
  excecao_conversao: string | null
  tentativas_conversao: number
  version: number
  created_at: Date
}

export function mapearLancamento(l: LinhaLf): LancamentoFuturo {
  return {
    id: l.id,
    tipo: l.tipo,
    lado: l.lado,
    descricao: l.descricao,
    valor_previsto: dinheiro(l.valor_previsto),
    data_prevista: dia(l.data_prevista),
    empresa_id: l.empresa_id,
    fornecedor_id: l.fornecedor_id,
    fornecedor_nome: l.fornecedor_nome,
    classificacao: l.classificacao,
    cliente_id: l.cliente_id,
    cliente_nome: l.cliente_nome,
    centro_custo_id: l.centro_custo_id,
    centro_custo_nome: l.centro_custo_nome,
    contrato_id: l.contrato_id,
    contrato_numero: l.contrato_numero,
    filial_id: l.filial_id,
    recorrencia_id: l.recorrencia_id,
    recorrencia_descricao: l.recorrencia_descricao,
    status: l.status,
    titulo_pagar_id: l.titulo_pagar_id,
    titulo_receber_id: l.titulo_receber_id,
    convertido_em: l.convertido_em === null ? null : l.convertido_em.toISOString(),
    excecao_conversao: l.excecao_conversao,
    tentativas_conversao: Number(l.tentativas_conversao),
    version: l.version,
  }
}

const SELECT_REC = `
  select r.id, r.lado, r.descricao, r.valor_base, r.periodicidade, r.dia_vencimento,
         r.proxima_geracao, r.ativo,
         r.empresa_id, r.fornecedor_id, f.razao_social as fornecedor_nome,
         r.classificacao, r.cliente_id, cl.razao_social as cliente_nome,
         r.centro_custo_id, r.contrato_id, ct.numero as contrato_numero, r.filial_id,
         (select count(*) from public.lancamento_futuro lf
           where lf.recorrencia_id = r.id and lf.deleted_at is null) as lancamentos_gerados,
         r.version, r.created_at
    from public.recorrencia r
    left join public.fornecedor f on f.id = r.fornecedor_id
    left join public.cliente cl on cl.id = r.cliente_id
    left join public.contrato ct on ct.id = r.contrato_id
`

interface LinhaRec extends Record<string, unknown> {
  id: string
  lado: Recorrencia['lado']
  descricao: string
  valor_base: string
  periodicidade: Recorrencia['periodicidade']
  dia_vencimento: number
  proxima_geracao: Date
  ativo: boolean
  empresa_id: string | null
  fornecedor_id: string | null
  fornecedor_nome: string | null
  classificacao: Recorrencia['classificacao']
  cliente_id: string | null
  cliente_nome: string | null
  centro_custo_id: string | null
  contrato_id: string | null
  contrato_numero: string | null
  filial_id: string | null
  lancamentos_gerados: string
  version: number
  created_at: Date
}

export function mapearRecorrencia(l: LinhaRec): Recorrencia {
  return {
    id: l.id,
    lado: l.lado,
    descricao: l.descricao,
    valor_base: dinheiro(l.valor_base),
    periodicidade: l.periodicidade,
    dia_vencimento: Number(l.dia_vencimento),
    proxima_geracao: dia(l.proxima_geracao),
    ativo: l.ativo,
    empresa_id: l.empresa_id,
    fornecedor_id: l.fornecedor_id,
    fornecedor_nome: l.fornecedor_nome,
    classificacao: l.classificacao,
    cliente_id: l.cliente_id,
    cliente_nome: l.cliente_nome,
    centro_custo_id: l.centro_custo_id,
    contrato_id: l.contrato_id,
    contrato_numero: l.contrato_numero,
    filial_id: l.filial_id,
    // `count(*)` chega como string do driver: sem o Number, o contrato recebe
    // "3" onde declara número e o Zod recusa a própria resposta.
    lancamentos_gerados: Number(l.lancamentos_gerados),
    version: l.version,
  }
}

export const cursorLf = (l: LinhaLf) => ({ criadoEm: l.created_at.toISOString(), id: l.id })
export const cursorRec = (l: LinhaRec) => ({ criadoEm: l.created_at.toISOString(), id: l.id })

@Injectable()
export class LancamentosFuturosRepositorio {
  async listar(
    db: Executor,
    filtro: ListarLancamentosFuturos,
  ): Promise<{ linhas: LinhaLf[]; temMais: boolean }> {
    const clausulas = ['lf.deleted_at is null']
    const valores: unknown[] = []

    const igual = (coluna: string, v: unknown) => {
      valores.push(v)
      clausulas.push(`${coluna} = $${valores.length}`)
    }
    if (filtro.status) igual('lf.status', filtro.status)
    if (filtro.lado) igual('lf.lado', filtro.lado)
    if (filtro.tipo) igual('lf.tipo', filtro.tipo)
    if (filtro.contrato_id) igual('lf.contrato_id', filtro.contrato_id)
    if (filtro.recorrencia_id) igual('lf.recorrencia_id', filtro.recorrencia_id)
    if (filtro.filial_id) igual('lf.filial_id', filtro.filial_id)
    if (filtro.centro_custo_id) igual('lf.centro_custo_id', filtro.centro_custo_id)
    if (filtro.previsto_de) {
      valores.push(filtro.previsto_de)
      clausulas.push(`lf.data_prevista >= $${valores.length}`)
    }
    if (filtro.previsto_ate) {
      valores.push(filtro.previsto_ate)
      clausulas.push(`lf.data_prevista <= $${valores.length}`)
    }
    /*
     * A fila de exceção é **derivada**, não um status.
     *
     * Um lançamento sai dela no instante em que o contrato volta a vigorar, sem
     * que ninguém o toque. Um status gravado estaria errado a partir daí, e só
     * uma varredura o corrigiria — a mesma razão pela qual `EM_ATRASO` não é
     * status no Módulo 11.
     */
    if (filtro.com_excecao) {
      clausulas.push(`lf.status = 'PROGRAMADO' and lf.excecao_conversao is not null`)
    }
    if (filtro.elegivel) {
      clausulas.push(`lf.status = 'PROGRAMADO' and lf.data_prevista <= current_date`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(lf.created_at, lf.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const linhas = await db.consultar<LinhaLf>(
      `${SELECT_LF} where ${clausulas.join(' and ')}
        order by lf.created_at desc, lf.id desc limit $${valores.length}`,
      valores,
    )
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async porId(db: Executor, id: string): Promise<LancamentoFuturo | null> {
    const l = await db.consultarUm<LinhaLf>(
      `${SELECT_LF} where lf.id = $1 and lf.deleted_at is null`,
      [id],
    )
    return l ? mapearLancamento(l) : null
  }

  async versaoDe(db: Executor, id: string): Promise<number | null> {
    const l = await db.consultarUm<{ version: number }>(
      `select version from public.lancamento_futuro where id = $1 and deleted_at is null`,
      [id],
    )
    return l ? l.version : null
  }

  async criar(db: Executor, dados: CriarLancamentoFuturo): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.lancamento_futuro
         (tenant_id, tipo, lado, descricao, valor_previsto, data_prevista,
          empresa_id, fornecedor_id, classificacao, cliente_id,
          centro_custo_id, contrato_id, filial_id, created_by, updated_by)
       values (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               app.usuario_atual(), app.usuario_atual())
       returning id`,
      [
        dados.tipo,
        ladoDoTipo(dados.tipo),
        dados.descricao,
        dados.valor_previsto,
        dados.data_prevista,
        dados.empresa_id ?? null,
        dados.fornecedor_id ?? null,
        dados.classificacao ?? null,
        dados.cliente_id ?? null,
        dados.centro_custo_id ?? null,
        dados.contrato_id ?? null,
        dados.filial_id ?? null,
      ],
    )
    return l!.id
  }

  /**
   * Editar com trava otimista.
   *
   * `version + 1` e `where version = $n` no mesmo comando: duas edições
   * simultâneas do mesmo planejamento não se sobrescrevem em silêncio. Zero
   * linhas afetadas é conflito, não "não encontrado" — quem chama distingue.
   */
  async editar(
    db: Executor,
    id: string,
    versao: number,
    dados: EditarLancamentoFuturo,
  ): Promise<number> {
    const sets: string[] = []
    const valores: unknown[] = []
    const por = (coluna: string, v: unknown) => {
      valores.push(v)
      sets.push(`${coluna} = $${valores.length}`)
    }
    if (dados.descricao !== undefined) por('descricao', dados.descricao)
    if (dados.valor_previsto !== undefined) por('valor_previsto', dados.valor_previsto)
    if (dados.data_prevista !== undefined) por('data_prevista', dados.data_prevista)
    if (dados.fornecedor_id !== undefined) por('fornecedor_id', dados.fornecedor_id ?? null)
    if (dados.centro_custo_id !== undefined) por('centro_custo_id', dados.centro_custo_id ?? null)
    if (dados.contrato_id !== undefined) por('contrato_id', dados.contrato_id ?? null)
    if (dados.filial_id !== undefined) por('filial_id', dados.filial_id ?? null)
    if (sets.length === 0) return 0

    valores.push(id, versao)
    const linhas = await db.consultar(
      `update public.lancamento_futuro
          set ${sets.join(', ')},
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $${valores.length - 1} and version = $${valores.length}
          and deleted_at is null
        returning id`,
      valores,
    )
    return linhas.length
  }

  async cancelar(db: Executor, id: string, motivo: string): Promise<number> {
    const linhas = await db.consultar(
      `update public.lancamento_futuro
          set status = 'CANCELADO', delete_reason = $2,
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and deleted_at is null
        returning id`,
      [id, motivo],
    )
    return linhas.length
  }

  /**
   * A conversão, na transação de quem chamou.
   *
   * Uma chamada de função e nada mais: RN-F15 (o `for update` antes de decidir),
   * RN-F16 (a fila de exceção) e RN-F18 (o próximo da série) vivem na 0021, onde
   * valem para o worker e para esta rota igualmente. Reimplementá-las aqui daria
   * duas conversões possíveis, e a divergência apareceria como um título que a
   * tela criou e o job não criaria.
   */
  async converter(
    db: Executor,
    id: string,
  ): Promise<{ titulo_id: string | null; lado: 'PAGAR' | 'RECEBER'; excecao: string | null }> {
    const r = await db.consultarUm<{
      titulo_id: string | null
      lado: 'PAGAR' | 'RECEBER'
      excecao: string | null
    }>(`select * from app.converter_lancamento_futuro($1)`, [id])
    return r!
  }

  /** O lançamento que a série gerou para uma data — o "próximo" de RN-F18. */
  async proximoDaSerie(
    db: Executor,
    recorrenciaId: string,
    depoisDe: string,
  ): Promise<string | null> {
    const l = await db.consultarUm<{ id: string }>(
      `select id from public.lancamento_futuro
        where recorrencia_id = $1 and data_prevista > $2 and deleted_at is null
        order by data_prevista limit 1`,
      [recorrenciaId, depoisDe],
    )
    return l ? l.id : null
  }

  /** Quantos níveis de alçada o título vai exigir, pelo lado do lançamento. */
  async niveisPrevistos(db: Executor, lado: string, valor: string): Promise<number> {
    const r = await db.consultarUm<{ niveis: number }>(
      lado === 'PAGAR'
        ? `select app.niveis_aprovacao_pagar($1::numeric) as niveis`
        : `select app.niveis_aprovacao_receber($1::numeric) as niveis`,
      [valor],
    )
    return Number(r!.niveis)
  }

  /**
   * O impedimento de RN-F16, **antes** de tentar converter.
   *
   * A prévia não chama a conversão: chamá-la incrementaria o contador de
   * tentativas e gravaria a exceção, fazendo uma leitura ter efeito. O estado do
   * contrato é a mesma checagem, feita sem escrever.
   */
  async impedimento(db: Executor, id: string): Promise<string | null> {
    const r = await db.consultarUm<{ impedimento: string | null }>(
      `select case
                when lf.status <> 'PROGRAMADO'
                  then format('O lançamento está em %s: a conversão ocorre uma vez só.', lf.status)
                when lf.contrato_id is not null and ct.status::text <> 'ATIVO'
                  then format('Contrato %s está em %s: a conversão não gera título de contrato inativo.',
                              ct.numero, ct.status)
              end as impedimento
         from public.lancamento_futuro lf
         left join public.contrato ct on ct.id = lf.contrato_id
        where lf.id = $1 and lf.deleted_at is null`,
      [id],
    )
    return r ? r.impedimento : null
  }

  /* ------------------------------------------------------- recorrências */

  async listarRecorrencias(
    db: Executor,
    filtro: ListarRecorrencias,
  ): Promise<{ linhas: LinhaRec[]; temMais: boolean }> {
    const clausulas = ['r.deleted_at is null']
    const valores: unknown[] = []
    if (filtro.lado) {
      valores.push(filtro.lado)
      clausulas.push(`r.lado = $${valores.length}`)
    }
    if (filtro.ativo !== undefined) {
      valores.push(filtro.ativo)
      clausulas.push(`r.ativo = $${valores.length}`)
    }
    if (filtro.contrato_id) {
      valores.push(filtro.contrato_id)
      clausulas.push(`r.contrato_id = $${valores.length}`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(r.created_at, r.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const linhas = await db.consultar<LinhaRec>(
      `${SELECT_REC} where ${clausulas.join(' and ')}
        order by r.created_at desc, r.id desc limit $${valores.length}`,
      valores,
    )
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async recorrenciaPorId(db: Executor, id: string): Promise<Recorrencia | null> {
    const l = await db.consultarUm<LinhaRec>(
      `${SELECT_REC} where r.id = $1 and r.deleted_at is null`,
      [id],
    )
    return l ? mapearRecorrencia(l) : null
  }

  async versaoRecorrencia(db: Executor, id: string): Promise<number | null> {
    const l = await db.consultarUm<{ version: number }>(
      `select version from public.recorrencia where id = $1 and deleted_at is null`,
      [id],
    )
    return l ? l.version : null
  }

  async criarRecorrencia(db: Executor, dados: CriarRecorrencia): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.recorrencia
         (tenant_id, lado, descricao, valor_base, periodicidade, dia_vencimento,
          proxima_geracao, empresa_id, fornecedor_id, classificacao, cliente_id,
          centro_custo_id, contrato_id, filial_id, created_by, updated_by)
       values (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               app.usuario_atual(), app.usuario_atual())
       returning id`,
      [
        dados.lado,
        dados.descricao,
        dados.valor_base,
        dados.periodicidade,
        dados.dia_vencimento,
        dados.proxima_geracao,
        dados.empresa_id ?? null,
        dados.fornecedor_id ?? null,
        dados.classificacao ?? null,
        dados.cliente_id ?? null,
        dados.centro_custo_id ?? null,
        dados.contrato_id ?? null,
        dados.filial_id ?? null,
      ],
    )
    return l!.id
  }

  async editarRecorrencia(
    db: Executor,
    id: string,
    versao: number,
    dados: EditarRecorrencia,
  ): Promise<number> {
    const sets: string[] = []
    const valores: unknown[] = []
    const por = (coluna: string, v: unknown) => {
      valores.push(v)
      sets.push(`${coluna} = $${valores.length}`)
    }
    if (dados.descricao !== undefined) por('descricao', dados.descricao)
    if (dados.valor_base !== undefined) por('valor_base', dados.valor_base)
    if (dados.periodicidade !== undefined) por('periodicidade', dados.periodicidade)
    if (dados.dia_vencimento !== undefined) por('dia_vencimento', dados.dia_vencimento)
    if (dados.proxima_geracao !== undefined) por('proxima_geracao', dados.proxima_geracao)
    if (dados.ativo !== undefined) por('ativo', dados.ativo)
    if (dados.fornecedor_id !== undefined) por('fornecedor_id', dados.fornecedor_id ?? null)
    if (dados.centro_custo_id !== undefined) por('centro_custo_id', dados.centro_custo_id ?? null)
    if (dados.filial_id !== undefined) por('filial_id', dados.filial_id ?? null)
    if (sets.length === 0) return 0

    valores.push(id, versao)
    const linhas = await db.consultar(
      `update public.recorrencia
          set ${sets.join(', ')},
              version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $${valores.length - 1} and version = $${valores.length}
          and deleted_at is null
        returning id`,
      valores,
    )
    return linhas.length
  }

  /** Gera o próximo da série, na transação de quem chamou (RN-F18). */
  async gerarProximo(db: Executor, recorrenciaId: string): Promise<string | null> {
    const r = await db.consultarUm<{ id: string | null }>(
      `select app.gerar_proximo_lancamento($1) as id`,
      [recorrenciaId],
    )
    return r?.id ?? null
  }
}
