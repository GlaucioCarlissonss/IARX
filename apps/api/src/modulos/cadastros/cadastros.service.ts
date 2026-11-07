import { Injectable } from '@nestjs/common'
import type {
  FornecedorCadastro,
  Inativar,
  ListarFornecedores,
  ListarTecnicos,
  SalvarCategoria,
  SalvarFabricante,
  SalvarFornecedor,
  SalvarModelo,
  SalvarPeca,
  SalvarTecnico,
  Tecnico,
} from '@iarx/contracts'
import { BancoService, type Executor } from '../../banco/banco.service.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor, decodificarCursor } from '../../comum/pagina.js'

/**
 * Cadastros de apoio: catálogo, peça, fornecedor e técnico.
 *
 * ## Inativar, nunca apagar
 *
 * As quatro entidades são apontadas por registros históricos — peça por
 * movimento de estoque de meses atrás, fornecedor por nota fiscal lançada,
 * técnico por ordem de serviço validada, modelo por equipamento em campo.
 * Apagar qualquer uma deixaria o histórico apontando para o nada, ou forçaria
 * apagar o histórico junto.
 *
 * A operação que a tela chama de "excluir" é um `ativo = false` com motivo: o
 * cadastro some das listas de escolha e continua resolvendo as referências
 * antigas. É RN-019 — exclusão crítica é lógica e rastreável.
 */
@Injectable()
export class CadastrosService {
  constructor(private readonly banco: BancoService) {}

  /* ----------------------------------------------------------- catálogo --- */

  async salvarFabricante(dados: SalvarFabricante, id?: string): Promise<{ id: string }> {
    return this.banco.emTransacao(
      async (db) => {
        if (id) {
          const r = await db.consultarUm<{ id: string }>(
            `update public.fabricante
                set nome = $2, pais = $3, contato_suporte = $4,
                    updated_at = now(), updated_by = app.usuario_atual()
              where id = $1 and deleted_at is null
              returning id`,
            [id, dados.nome, dados.pais ?? null, dados.contato_suporte ?? null],
          )
          if (!r) throw naoEncontrado('Fabricante', id)
          return r
        }
        const r = await db.consultarUm<{ id: string }>(
          `insert into public.fabricante (tenant_id, nome, pais, contato_suporte, created_by)
           values (app.tenant_atual(), $1, $2, $3, app.usuario_atual())
           returning id`,
          [dados.nome, dados.pais ?? null, dados.contato_suporte ?? null],
        )
        return r as { id: string }
      },
      { motivo: 'cadastro de fabricante' },
    )
  }

  async salvarCategoria(dados: SalvarCategoria, id?: string): Promise<{ id: string }> {
    return this.banco.emTransacao(
      async (db) => {
        if (id) {
          /*
           * `tipo_medidor_padrao` muda o que a medição consegue apurar nos
           * equipamentos criados **a partir de agora**. Os que já existem
           * carregam o próprio medidor, e por isso a troca aqui não os alcança
           * — é o que torna a edição segura sem precisar bloquear a coluna.
           */
          const r = await db.consultarUm<{ id: string }>(
            `update public.categoria_equipamento
                set codigo = $2, nome = $3, tipo_medidor_padrao = $4,
                    vida_util_meses_padrao = $5,
                    updated_at = now(), updated_by = app.usuario_atual()
              where id = $1 and deleted_at is null
              returning id`,
            [id, dados.codigo, dados.nome, dados.tipo_medidor_padrao ?? null, dados.vida_util_meses_padrao ?? null],
          )
          if (!r) throw naoEncontrado('Categoria', id)
          return r
        }
        const r = await db.consultarUm<{ id: string }>(
          `insert into public.categoria_equipamento
             (tenant_id, codigo, nome, tipo_medidor_padrao, vida_util_meses_padrao, created_by)
           values (app.tenant_atual(), $1, $2, $3, $4, app.usuario_atual())
           returning id`,
          [dados.codigo, dados.nome, dados.tipo_medidor_padrao ?? null, dados.vida_util_meses_padrao ?? null],
        )
        return r as { id: string }
      },
      { motivo: 'cadastro de categoria' },
    )
  }

  async salvarModelo(dados: SalvarModelo, id?: string): Promise<{ id: string }> {
    return this.banco.emTransacao(
      async (db) => {
        const valores = [
          dados.fabricante_id,
          dados.categoria_id,
          dados.codigo,
          dados.nome,
          dados.especificacoes ? JSON.stringify(dados.especificacoes) : null,
          dados.preco_tabela_mensal ?? null,
          dados.preco_tabela_diaria ?? null,
        ]
        if (id) {
          const r = await db.consultarUm<{ id: string }>(
            `update public.modelo
                set fabricante_id = $2, categoria_id = $3, codigo = $4, nome = $5,
                    especificacoes = coalesce($6::jsonb, especificacoes),
                    preco_tabela_mensal = $7::numeric, preco_tabela_diaria = $8::numeric,
                    updated_at = now(), updated_by = app.usuario_atual()
              where id = $1 and deleted_at is null
              returning id`,
            [id, ...valores],
          )
          if (!r) throw naoEncontrado('Modelo', id)
          return r
        }
        const r = await db.consultarUm<{ id: string }>(
          `insert into public.modelo
             (tenant_id, fabricante_id, categoria_id, codigo, nome, especificacoes,
              preco_tabela_mensal, preco_tabela_diaria, created_by)
           values (app.tenant_atual(), $1, $2, $3, $4, coalesce($5::jsonb, '{}'::jsonb),
                   $6::numeric, $7::numeric, app.usuario_atual())
           returning id`,
          valores,
        )
        return r as { id: string }
      },
      { motivo: 'cadastro de modelo' },
    )
  }

  /* --------------------------------------------------------------- peça --- */

  async salvarPeca(dados: SalvarPeca, id?: string): Promise<{ id: string }> {
    return this.banco.emTransacao(
      async (db) => {
        const valores = [
          dados.codigo_interno,
          dados.codigo_fabricante ?? null,
          dados.descricao,
          dados.unidade,
          dados.fornecedor_preferencial_id ?? null,
          dados.criticidade,
          dados.localizacao_fisica ?? null,
        ]
        if (id) {
          const r = await db.consultarUm<{ id: string }>(
            `update public.peca
                set codigo_interno = $2, codigo_fabricante = $3, descricao = $4,
                    unidade = $5, fornecedor_preferencial_id = $6,
                    criticidade = $7::app.peca_criticidade, localizacao_fisica = $8,
                    version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
              where id = $1 and deleted_at is null
              returning id`,
            [id, ...valores],
          )
          if (!r) throw naoEncontrado('Peça', id)
          return r
        }
        const r = await db.consultarUm<{ id: string }>(
          `insert into public.peca
             (tenant_id, codigo_interno, codigo_fabricante, descricao, unidade,
              fornecedor_preferencial_id, criticidade, localizacao_fisica, created_by)
           values (app.tenant_atual(), $1, $2, $3, $4, $5, $6::app.peca_criticidade, $7,
                   app.usuario_atual())
           returning id`,
          valores,
        )
        return r as { id: string }
      },
      { motivo: 'cadastro de peça' },
    )
  }

  /* --------------------------------------------------------- fornecedor --- */

  async listarFornecedores(filtro: ListarFornecedores): Promise<Pagina<FornecedorCadastro>> {
    return this.banco.emTransacao(async (db) => {
      const valores: unknown[] = []
      const clausulas = ['f.deleted_at is null']

      if (filtro.ativo !== undefined) {
        valores.push(filtro.ativo)
        clausulas.push(`f.ativo = $${valores.length}`)
      }
      if (filtro.q) {
        valores.push(`${filtro.q}%`)
        clausulas.push(
          `(upper(f.razao_social) like upper($${valores.length}) or f.documento like $${valores.length})`,
        )
      }

      const cursor = decodificarCursor(filtro.cursor)
      if (cursor) {
        valores.push(cursor.criadoEm, cursor.id)
        clausulas.push(
          `(f.created_at, f.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
        )
      }

      valores.push(filtro.limit + 1)
      const linhas = await db.consultar<FornecedorCadastro & { created_at: Date }>(
        `select f.id, f.tipo_pessoa, f.documento, f.razao_social, f.nome_fantasia,
                f.inscricao_estadual, f.uf, f.contato, f.ativo, f.created_at
           from public.fornecedor f
          where ${clausulas.join(' and ')}
          order by f.created_at desc, f.id desc
          limit $${valores.length}`,
        valores,
      )
      const temMais = linhas.length > filtro.limit
      const ultimo = linhas[filtro.limit - 1]
      return new Pagina(linhas.slice(0, filtro.limit), {
        limit: filtro.limit,
        next_cursor:
          temMais && ultimo ? codificarCursor({ criadoEm: ultimo.created_at.toISOString(), id: ultimo.id }) : null,
      })
    })
  }

  async salvarFornecedor(dados: SalvarFornecedor, id?: string): Promise<{ id: string }> {
    return this.banco.emTransacao(
      async (db) => {
        const valores = [
          dados.tipo_pessoa,
          dados.documento,
          dados.razao_social,
          dados.nome_fantasia ?? null,
          dados.inscricao_estadual ?? null,
          dados.uf ?? null,
          dados.contato ? JSON.stringify(dados.contato) : null,
        ]
        try {
          if (id) {
            const r = await db.consultarUm<{ id: string }>(
              `update public.fornecedor
                  set tipo_pessoa = $2, documento = $3, razao_social = $4,
                      nome_fantasia = $5, inscricao_estadual = $6, uf = $7,
                      contato = coalesce($8::jsonb, contato),
                      version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
                where id = $1 and deleted_at is null
                returning id`,
              [id, ...valores],
            )
            if (!r) throw naoEncontrado('Fornecedor', id)
            return r
          }
          const r = await db.consultarUm<{ id: string }>(
            `insert into public.fornecedor
               (tenant_id, tipo_pessoa, documento, razao_social, nome_fantasia,
                inscricao_estadual, uf, contato, created_by)
             values (app.tenant_atual(), $1, $2, $3, $4, $5, $6,
                     coalesce($7::jsonb, '{}'::jsonb), app.usuario_atual())
             returning id`,
            valores,
          )
          return r as { id: string }
        } catch (e) {
          if ((e as { code?: string }).code === '23505') {
            throw new ErroDominio('RECURSO_DUPLICADO', 'Já existe fornecedor com este documento', {
              detail: 'O CNPJ ou CPF identifica o fornecedor dentro do locatário.',
              errors: [{ field: 'documento', code: 'DUPLICADO' }],
            })
          }
          throw e
        }
      },
      { motivo: 'cadastro de fornecedor' },
    )
  }

  /* ------------------------------------------------------------ técnico --- */

  async listarTecnicos(filtro: ListarTecnicos): Promise<Pagina<Tecnico>> {
    return this.banco.emTransacao(async (db) => {
      const valores: unknown[] = []
      const clausulas = ['t.deleted_at is null']

      if (filtro.ativo !== undefined) {
        valores.push(filtro.ativo)
        clausulas.push(`t.ativo = $${valores.length}`)
      }
      if (filtro.filial_id) {
        valores.push(filtro.filial_id)
        clausulas.push(`t.filial_id = $${valores.length}`)
      }

      const cursor = decodificarCursor(filtro.cursor)
      if (cursor) {
        valores.push(cursor.criadoEm, cursor.id)
        clausulas.push(
          `(t.created_at, t.id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`,
        )
      }

      valores.push(filtro.limit + 1)
      const linhas = await db.consultar<Tecnico & { created_at: Date }>(
        `select t.id, t.nome, t.matricula, t.filial_id, t.usuario_id,
                t.especialidades, t.custo_hora::text as custo_hora, t.ativo, t.created_at
           from public.tecnico t
          where ${clausulas.join(' and ')}
          order by t.created_at desc, t.id desc
          limit $${valores.length}`,
        valores,
      )
      const temMais = linhas.length > filtro.limit
      const ultimo = linhas[filtro.limit - 1]
      return new Pagina(linhas.slice(0, filtro.limit), {
        limit: filtro.limit,
        next_cursor:
          temMais && ultimo ? codificarCursor({ criadoEm: ultimo.created_at.toISOString(), id: ultimo.id }) : null,
      })
    })
  }

  async salvarTecnico(dados: SalvarTecnico, id?: string): Promise<{ id: string }> {
    return this.banco.emTransacao(
      async (db) => {
        const valores = [
          dados.nome,
          dados.matricula ?? null,
          dados.filial_id ?? null,
          dados.usuario_id ?? null,
          dados.especialidades ?? null,
          dados.custo_hora ?? null,
        ]
        if (id) {
          const r = await db.consultarUm<{ id: string }>(
            `update public.tecnico
                set nome = $2, matricula = $3, filial_id = $4, usuario_id = $5,
                    especialidades = coalesce($6::text[], especialidades),
                    custo_hora = $7::numeric,
                    version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
              where id = $1 and deleted_at is null
              returning id`,
            [id, ...valores],
          )
          if (!r) throw naoEncontrado('Técnico', id)
          return r
        }
        const r = await db.consultarUm<{ id: string }>(
          `insert into public.tecnico
             (tenant_id, nome, matricula, filial_id, usuario_id, especialidades,
              custo_hora, created_by)
           values (app.tenant_atual(), $1, $2, $3, $4,
                   coalesce($5::text[], '{}'::text[]), $6::numeric, app.usuario_atual())
           returning id`,
          valores,
        )
        return r as { id: string }
      },
      { motivo: 'cadastro de técnico' },
    )
  }

  /* --------------------------------------------------------- inativação --- */

  /**
   * Inativa o cadastro: ele some das listas de escolha e continua resolvendo
   * as referências antigas.
   *
   * A tabela chega como literal de um conjunto fechado, nunca do cliente —
   * concatenar nome de tabela vindo de requisição é a forma mais direta de
   * injeção que existe, e o parâmetro numerado não cobre identificador.
   */
  async inativar(entidade: 'peca' | 'fornecedor' | 'tecnico', id: string, dados: Inativar): Promise<void> {
    const tabela = { peca: 'peca', fornecedor: 'fornecedor', tecnico: 'tecnico' }[entidade]
    await this.banco.emTransacao(
      async (db) => {
        const r = await db.consultarUm<{ id: string }>(
          `update public.${tabela}
              set ativo = false, delete_reason = $2,
                  version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
            where id = $1 and deleted_at is null
            returning id`,
          [id, dados.motivo],
        )
        if (!r) throw naoEncontrado(entidade, id)
      },
      { motivo: dados.motivo },
    )
  }

  async reativar(entidade: 'peca' | 'fornecedor' | 'tecnico', id: string): Promise<void> {
    const tabela = { peca: 'peca', fornecedor: 'fornecedor', tecnico: 'tecnico' }[entidade]
    await this.banco.emTransacao(
      async (db) => {
        const r = await db.consultarUm<{ id: string }>(
          `update public.${tabela}
              set ativo = true, delete_reason = null,
                  version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
            where id = $1 and deleted_at is null
            returning id`,
          [id],
        )
        if (!r) throw naoEncontrado(entidade, id)
      },
      { motivo: 'reativação de cadastro' },
    )
  }

  /** Inativação de cliente — permissão própria (`cliente:inativar`). */
  async inativarCliente(id: string, dados: Inativar): Promise<void> {
    await this.banco.emTransacao(
      async (db) => {
        await this.exigirSemContratoVigente(db, id)
        const r = await db.consultarUm<{ id: string }>(
          `update public.cliente
              set ativo = false, delete_reason = $2,
                  version = version + 1, updated_at = now(), updated_by = app.usuario_atual()
            where id = $1 and deleted_at is null
            returning id`,
          [id, dados.motivo],
        )
        if (!r) throw naoEncontrado('Cliente', id)
      },
      { motivo: dados.motivo },
    )
  }

  /**
   * Cliente com contrato vigente não é inativado.
   *
   * Inativar tira o cliente das listas e dos filtros padrão. Com contrato
   * ativo, a cobrança continua sendo gerada todo mês para alguém que sumiu das
   * telas — e quem for cobrar não encontra o cadastro para ligar.
   */
  private async exigirSemContratoVigente(db: Executor, clienteId: string): Promise<void> {
    const r = await db.consultarUm<{ n: string }>(
      `select count(*)::text as n
         from public.contrato c
        where c.cliente_id = $1
          and c.status in ('ATIVO','SUSPENSO','EM_RENOVACAO','AGUARDANDO_ASSINATURA')
          and c.deleted_at is null`,
      [clienteId],
    )
    const n = Number(r?.n ?? '0')
    if (n > 0) {
      throw new ErroDominio('REGRA_DE_NEGOCIO', 'Cliente com contrato vigente', {
        detail: `Há ${n} contrato(s) em vigor. Inativar tiraria o cliente das telas enquanto a cobrança continua sendo gerada todo mês.`,
        errors: [{ field: 'id', code: 'CONTRATO_VIGENTE', meta: { contratos: n } }],
        acoes: [{ code: 'ENCERRAR_CONTRATOS', descricao: 'Encerrar ou distratar os contratos antes' }],
      })
    }
  }
}
