import { Injectable } from '@nestjs/common'
import type {
  CentroCusto,
  ContaBancaria,
  CriarCentroCusto,
  CriarContaBancaria,
  EditarCentroCusto,
  EditarContaBancaria,
  LancarMovimentacao,
  ListarCentrosCusto,
  ListarContasBancarias,
  Dinheiro,
  ListarExtrato,
  MovimentacaoBancaria,
  Transferir,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'
import { decodificarCursor } from '../../comum/pagina.js'

/**
 * Acesso a dados de centro de custo, conta bancária e movimentação.
 *
 * Como nos demais repositórios: nenhum `where tenant_id`. O isolamento é da
 * RLS, dentro do banco — escrevê-lo aqui daria a impressão de que depende do
 * SQL estar certo, e um filtro esquecido numa consulta nova passaria batido.
 */

/*
 * O nível vem de uma CTE recursiva, não de uma coluna.
 *
 * Guardar `nivel` na tabela criaria a possibilidade de ele discordar da cadeia
 * de pais — o mesmo problema do saldo, uma linha acima na mesma migração. E
 * calcular no cliente não serve: a árvore pode chegar paginada, e um nó sem os
 * ancestrais na mesma página não tem como saber em que nível está.
 */
const SELECT_CENTRO = `
  with recursive arvore as (
    select c.id, 1 as nivel
      from public.centro_custo c
     where c.centro_pai_id is null and c.deleted_at is null
    union all
    select f.id, a.nivel + 1
      from public.centro_custo f
      join arvore a on f.centro_pai_id = a.id
     where f.deleted_at is null
  )
  select c.id, c.empresa_id, c.codigo, c.nome, c.descricao, c.centro_pai_id,
         coalesce(a.nivel, 1) as nivel, c.ativo, c.version, c.created_at
    from public.centro_custo c
    left join arvore a on a.id = c.id
`

interface LinhaCentro extends Record<string, unknown> {
  id: string
  empresa_id: string | null
  codigo: string
  nome: string
  descricao: string | null
  centro_pai_id: string | null
  nivel: string | number
  ativo: boolean
  version: number
  created_at: Date
}

function mapearCentro(l: LinhaCentro): CentroCusto {
  return {
    id: l.id,
    empresa_id: l.empresa_id,
    codigo: l.codigo,
    nome: l.nome,
    descricao: l.descricao,
    centro_pai_id: l.centro_pai_id,
    // `bigint` do PostgreSQL chega como string no driver: convertido aqui, uma
    // vez, em vez de o consumidor descobrir um "3" onde esperava 3.
    nivel: Number(l.nivel),
    ativo: l.ativo,
    version: l.version,
  }
}

/*
 * O saldo vem da função, junto da conta, numa consulta só.
 *
 * A alternativa — listar as contas e chamar `app.saldo_conta` por cada uma —
 * é uma consulta por linha, e a lista de contas é justamente onde o saldo é
 * mais visto.
 */
const SELECT_CONTA = `
  select b.id, b.empresa_id, b.banco_codigo, b.agencia, b.numero, b.tipo,
         b.apelido, b.saldo_inicial, b.data_saldo_inicial, b.limite_credito,
         b.status, b.version, b.created_at,
         app.saldo_conta(b.id) as saldo_atual
    from public.conta_bancaria b
`

interface LinhaConta extends Record<string, unknown> {
  id: string
  empresa_id: string
  banco_codigo: string
  agencia: string
  numero: string
  tipo: ContaBancaria['tipo']
  apelido: string
  saldo_inicial: string
  data_saldo_inicial: Date
  limite_credito: string | null
  status: ContaBancaria['status']
  saldo_atual: string
  version: number
  created_at: Date
}

/*
 * `numeric` chega do driver como **string**, e continua string até o cliente.
 *
 * Converter para `number` aqui seria desfazer a razão de o primitivo `Dinheiro`
 * ser textual: um `numeric(15,4)` de treze dígitos inteiros não cabe num
 * `double` sem perder o último centavo, e o erro aparece como um relatório que
 * fecha com um centavo de diferença — sem nenhuma pista de onde.
 *
 * O que a função faz é só normalizar a escala, para que o mesmo valor não chegue
 * como "100" numa consulta e "100.0000" em outra.
 */
const dinheiro = (v: string | null): Dinheiro => Number(v ?? 0).toFixed(4) as Dinheiro
const dia = (d: Date): string => d.toISOString().slice(0, 10)

function mapearConta(l: LinhaConta): ContaBancaria {
  return {
    id: l.id,
    empresa_id: l.empresa_id,
    banco_codigo: l.banco_codigo,
    agencia: l.agencia,
    numero: l.numero,
    tipo: l.tipo,
    apelido: l.apelido,
    saldo_inicial: dinheiro(l.saldo_inicial),
    data_saldo_inicial: dia(l.data_saldo_inicial),
    limite_credito: l.limite_credito === null ? null : dinheiro(l.limite_credito),
    status: l.status,
    saldo_atual: dinheiro(l.saldo_atual),
    version: l.version,
  }
}

const SELECT_MOVIMENTO = `
  select m.id, m.conta_id, m.tipo, m.valor, m.data_movimento, m.descricao,
         m.transferencia_par_id, m.estorna_id, m.motivo,
         m.conciliado, m.conciliado_em, m.created_at
    from public.movimentacao_bancaria m
`

interface LinhaMovimento extends Record<string, unknown> {
  id: string
  conta_id: string
  tipo: MovimentacaoBancaria['tipo']
  valor: string
  data_movimento: Date
  descricao: string
  transferencia_par_id: string | null
  estorna_id: string | null
  motivo: string | null
  conciliado: boolean
  conciliado_em: Date | null
  created_at: Date
}

function mapearMovimento(l: LinhaMovimento): MovimentacaoBancaria {
  return {
    id: l.id,
    conta_id: l.conta_id,
    tipo: l.tipo,
    valor: dinheiro(l.valor),
    data_movimento: dia(l.data_movimento),
    descricao: l.descricao,
    transferencia_par_id: l.transferencia_par_id,
    estorna_id: l.estorna_id,
    motivo: l.motivo,
    conciliado: l.conciliado,
    conciliado_em: l.conciliado_em ? l.conciliado_em.toISOString() : null,
    created_at: l.created_at.toISOString(),
  }
}

export const cursorCentro = (l: LinhaCentro) => ({ criadoEm: l.created_at.toISOString(), id: l.id })
export const cursorConta = (l: LinhaConta) => ({ criadoEm: l.created_at.toISOString(), id: l.id })
export const cursorMovimento = (l: LinhaMovimento) => ({ criadoEm: l.created_at.toISOString(), id: l.id })

@Injectable()
export class FinanceiroRepositorio {
  /* ------------------------------------------------- centro de custo */

  async listarCentros(
    db: Executor,
    filtro: ListarCentrosCusto,
  ): Promise<{ linhas: LinhaCentro[]; temMais: boolean }> {
    const clausulas = ['c.deleted_at is null']
    const valores: unknown[] = []

    if (filtro.apenas_ativos) clausulas.push('c.ativo')
    if (filtro.empresa_id) {
      valores.push(filtro.empresa_id)
      // Centro global (empresa nula) aparece em qualquer filtro de empresa: é o
      // caso do "Administrativo", que serve todas as PJs do locatário.
      clausulas.push(`(c.empresa_id = $${valores.length} or c.empresa_id is null)`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(c.created_at, c.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const sql = `${SELECT_CENTRO} where ${clausulas.join(' and ')}
      order by c.created_at desc, c.id desc limit $${valores.length}`

    const linhas = await db.consultar<LinhaCentro>(sql, valores)
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async centroPorId(db: Executor, id: string): Promise<CentroCusto | null> {
    const l = await db.consultarUm<LinhaCentro>(
      `${SELECT_CENTRO} where c.id = $1 and c.deleted_at is null`,
      [id],
    )
    return l ? mapearCentro(l) : null
  }

  async criarCentro(db: Executor, dados: CriarCentroCusto): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.centro_custo
         (tenant_id, empresa_id, codigo, nome, descricao, centro_pai_id, created_by, updated_by)
       values (app.tenant_atual(), $1, $2, $3, $4, $5, app.usuario_atual(), app.usuario_atual())
       returning id`,
      [
        dados.empresa_id ?? null,
        dados.codigo,
        dados.nome,
        dados.descricao ?? null,
        dados.centro_pai_id ?? null,
      ],
    )
    return l!.id
  }

  /**
   * Edita com trava de versão na própria cláusula.
   *
   * `where version = $n` é o que torna a atualização perdida impossível sem uma
   * segunda consulta: se a linha mudou entre a leitura do cliente e este
   * update, nada é afetado e o serviço sabe disso pelo retorno nulo. Ler a
   * versão antes e comparar em JavaScript deixaria a janela entre a leitura e a
   * escrita aberta.
   */
  async editarCentro(
    db: Executor,
    id: string,
    versao: number,
    dados: EditarCentroCusto,
  ): Promise<boolean> {
    const l = await db.consultarUm<{ id: string }>(
      `update public.centro_custo
          set codigo = coalesce($3, codigo),
              nome = coalesce($4, nome),
              descricao = case when $5::boolean then $6 else descricao end,
              version = version + 1,
              updated_at = now(),
              updated_by = app.usuario_atual()
        where id = $1 and version = $2 and deleted_at is null
        returning id`,
      [
        id,
        versao,
        dados.codigo ?? null,
        dados.nome ?? null,
        // `descricao` distingue "não enviado" de "enviado como nulo": sem o
        // sinalizador, limpar a descrição seria indistinguível de não mexer nela.
        'descricao' in dados,
        dados.descricao ?? null,
      ],
    )
    return l !== null
  }

  async definirAtivoCentro(db: Executor, id: string, versao: number, ativo: boolean): Promise<boolean> {
    const l = await db.consultarUm<{ id: string }>(
      `update public.centro_custo
          set ativo = $3, version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
        where id = $1 and version = $2 and deleted_at is null
        returning id`,
      [id, versao, ativo],
    )
    return l !== null
  }

  /* ------------------------------------------------- conta bancária */

  async listarContas(
    db: Executor,
    filtro: ListarContasBancarias,
  ): Promise<{ linhas: LinhaConta[]; temMais: boolean }> {
    const clausulas = ['b.deleted_at is null']
    const valores: unknown[] = []

    if (filtro.status) {
      valores.push(filtro.status)
      clausulas.push(`b.status = $${valores.length}`)
    }
    if (filtro.empresa_id) {
      valores.push(filtro.empresa_id)
      clausulas.push(`b.empresa_id = $${valores.length}`)
    }

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(b.created_at, b.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const sql = `${SELECT_CONTA} where ${clausulas.join(' and ')}
      order by b.created_at desc, b.id desc limit $${valores.length}`

    const linhas = await db.consultar<LinhaConta>(sql, valores)
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async contaPorId(db: Executor, id: string): Promise<ContaBancaria | null> {
    const l = await db.consultarUm<LinhaConta>(
      `${SELECT_CONTA} where b.id = $1 and b.deleted_at is null`,
      [id],
    )
    return l ? mapearConta(l) : null
  }

  async criarConta(db: Executor, dados: CriarContaBancaria): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.conta_bancaria
         (tenant_id, empresa_id, banco_codigo, agencia, numero, tipo, apelido,
          saldo_inicial, data_saldo_inicial, limite_credito, created_by, updated_by)
       values (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9,
               app.usuario_atual(), app.usuario_atual())
       returning id`,
      [
        dados.empresa_id,
        dados.banco_codigo,
        dados.agencia,
        dados.numero,
        dados.tipo,
        dados.apelido,
        dados.saldo_inicial,
        dados.data_saldo_inicial,
        dados.limite_credito ?? null,
      ],
    )
    return l!.id
  }

  async editarConta(
    db: Executor,
    id: string,
    versao: number,
    dados: EditarContaBancaria,
  ): Promise<boolean> {
    const l = await db.consultarUm<{ id: string }>(
      `update public.conta_bancaria
          set apelido = coalesce($3, apelido),
              limite_credito = case when $4::boolean then $5 else limite_credito end,
              status = coalesce($6, status),
              version = version + 1,
              updated_at = now(),
              updated_by = app.usuario_atual()
        where id = $1 and version = $2 and deleted_at is null
        returning id`,
      [
        id,
        versao,
        dados.apelido ?? null,
        'limite_credito' in dados,
        dados.limite_credito ?? null,
        dados.status ?? null,
      ],
    )
    return l !== null
  }

  /* ------------------------------------------------- movimentação */

  async listarExtrato(
    db: Executor,
    contaId: string,
    filtro: ListarExtrato,
  ): Promise<{ linhas: LinhaMovimento[]; temMais: boolean }> {
    const valores: unknown[] = [contaId]
    const clausulas = ['m.conta_id = $1']

    if (filtro.de) {
      valores.push(filtro.de)
      clausulas.push(`m.data_movimento >= $${valores.length}`)
    }
    if (filtro.ate) {
      valores.push(filtro.ate)
      clausulas.push(`m.data_movimento <= $${valores.length}`)
    }
    if (filtro.tipo) {
      valores.push(filtro.tipo)
      clausulas.push(`m.tipo = $${valores.length}`)
    }
    if (filtro.pendente_conciliacao) clausulas.push('not m.conciliado')

    const cursor = decodificarCursor(filtro.cursor)
    if (cursor) {
      valores.push(cursor.criadoEm, cursor.id)
      clausulas.push(
        `(m.created_at, m.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
      )
    }

    valores.push(filtro.limit + 1)
    const sql = `${SELECT_MOVIMENTO} where ${clausulas.join(' and ')}
      order by m.created_at desc, m.id desc limit $${valores.length}`

    const linhas = await db.consultar<LinhaMovimento>(sql, valores)
    return { linhas: linhas.slice(0, filtro.limit), temMais: linhas.length > filtro.limit }
  }

  async movimentoPorId(db: Executor, id: string): Promise<MovimentacaoBancaria | null> {
    const l = await db.consultarUm<LinhaMovimento>(`${SELECT_MOVIMENTO} where m.id = $1`, [id])
    return l ? mapearMovimento(l) : null
  }

  async lancar(db: Executor, contaId: string, dados: LancarMovimentacao): Promise<string> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.movimentacao_bancaria
         (tenant_id, conta_id, tipo, valor, data_movimento, descricao, created_by)
       values (app.tenant_atual(), $1, $2, $3, $4, $5, app.usuario_atual())
       returning id`,
      [contaId, dados.tipo, dados.valor, dados.data_movimento, dados.descricao],
    )
    return l!.id
  }

  /**
   * Estorno é lançamento contrário, nunca um update.
   *
   * O tipo invertido sai daqui e não do cliente: deixar o chamador escolher o
   * tipo do estorno permitiria estornar uma saída com outra saída, o que
   * dobraria a despesa em vez de anulá-la — e o extrato continuaria fechando
   * consigo mesmo.
   */
  async estornar(db: Executor, movimentoId: string, motivo: string): Promise<string | null> {
    const l = await db.consultarUm<{ id: string }>(
      `insert into public.movimentacao_bancaria
         (tenant_id, conta_id, tipo, valor, data_movimento, descricao, estorna_id, motivo, created_by)
       select app.tenant_atual(), o.conta_id,
              case o.tipo
                when 'ENTRADA' then 'SAIDA'
                when 'SAIDA' then 'ENTRADA'
                when 'TAXA' then 'ENTRADA'
                when 'TRANSFERENCIA_ENTRADA' then 'TRANSFERENCIA_SAIDA'
                else 'TRANSFERENCIA_ENTRADA'
              end,
              o.valor, current_date,
              'Estorno de: ' || o.descricao, o.id, $2, app.usuario_atual()
         from public.movimentacao_bancaria o
        where o.id = $1
          -- Estornar um estorno reabriria o valor original pela terceira vez.
          -- Quem errou o estorno lança o valor de novo, com descrição própria.
          and o.estorna_id is null
          and not exists (select 1 from public.movimentacao_bancaria e where e.estorna_id = o.id)
       returning id`,
      [movimentoId, motivo],
    )
    return l ? l.id : null
  }

  async transferir(db: Executor, dados: Transferir): Promise<{ saida_id: string; entrada_id: string }> {
    const l = await db.consultarUm<{ saida_id: string; entrada_id: string }>(
      `select saida_id, entrada_id from app.transferir_entre_contas($1, $2, $3, $4, $5)`,
      [
        dados.conta_origem_id,
        dados.conta_destino_id,
        dados.valor,
        dados.data_movimento,
        dados.descricao,
      ],
    )
    return l!
  }

  async conciliar(db: Executor, movimentoId: string, conciliado: boolean): Promise<boolean> {
    const l = await db.consultarUm<{ id: string }>(
      `update public.movimentacao_bancaria
          set conciliado = $2, conciliado_em = case when $2 then now() else null end
        where id = $1
        returning id`,
      [movimentoId, conciliado],
    )
    return l !== null
  }
}

export { mapearCentro, mapearConta, mapearMovimento }
