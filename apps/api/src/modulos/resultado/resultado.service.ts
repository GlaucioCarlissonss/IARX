import { Injectable } from '@nestjs/common'
import type { ConsultarResultado, LinhaResultado, Resultado, ResultadoPorCliente } from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'

/**
 * Resultado operacional.
 *
 * Sem repositório próprio: duas consultas e nenhuma escrita.
 *
 * Como nos demais: nenhum `where tenant_id`. O isolamento é da RLS.
 */
@Injectable()
export class ResultadoService {
  async consultar(filtro: ConsultarResultado): Promise<Resultado> {
    return this.banco.emTransacao(async (db) => {
      const serie = await db.consultar<LinhaResultado & Record<string, unknown>>(
        `with competencias as (
           select to_char(d, 'YYYY-MM') as competencia
             from generate_series(
                    date_trunc('month', now()) - make_interval(months => $1::int - 1),
                    date_trunc('month', now()),
                    interval '1 month'
                  ) d
         ),
         receita as (
           select t.competencia, sum(t.valor_liquido) as valor
             from public.titulo_receber t
            where t.status <> 'CANCELADO'
            group by t.competencia
         ),
         /*
          * Só OS validada. A validação é o ponto em que outra pessoa conferiu
          * o apontamento (RN-027); contar antes faria o resultado oscilar com
          * número que ainda pode ser corrigido, e o mês fecharia diferente a
          * cada releitura.
          */
         custo_os as (
           select to_char(o.validacao_em, 'YYYY-MM') as competencia,
                  sum(o.custo_mao_obra) as mao_obra,
                  sum(o.custo_material + o.custo_terceiros + o.custo_deslocamento) as material
             from public.ordem_servico o
            where o.status = 'VALIDADA' and o.validacao_em is not null and o.deleted_at is null
            group by 1
         ),
         custo_peca as (
           select to_char(m.data_movimento, 'YYYY-MM') as competencia,
                  sum(m.custo_total) as valor
             from public.movimento_estoque m
            where m.tipo = 'SAIDA_OS'
            group by 1
         )
         select c.competencia,
                coalesce(r.valor, 0)::text as receita,
                coalesce(co.mao_obra, 0)::text as custo_mao_obra,
                (coalesce(co.material, 0) + coalesce(cp.valor, 0))::text as custo_material,
                (coalesce(co.mao_obra, 0) + coalesce(co.material, 0) + coalesce(cp.valor, 0))::text as custo_total,
                (coalesce(r.valor, 0)
                  - coalesce(co.mao_obra, 0) - coalesce(co.material, 0) - coalesce(cp.valor, 0))::text as margem
           from competencias c
           left join receita    r  on r.competencia  = c.competencia
           left join custo_os   co on co.competencia = c.competencia
           left join custo_peca cp on cp.competencia = c.competencia
          order by c.competencia`,
        [filtro.meses],
      )

      /*
       * Por cliente, as duas pontas vêm de subconsultas e não de um `join`
       * entre receita e custo: um cliente com doze títulos e três OS geraria
       * trinta e seis linhas, e tanto a receita quanto o custo sairiam
       * multiplicados. É o mesmo erro de agregação do mapa, e pela mesma razão
       * difícil de notar — os dois números continuam plausíveis.
       */
      const porCliente = await db.consultar<ResultadoPorCliente & Record<string, unknown>>(
        `select c.id as cliente_id,
                coalesce(c.nome_fantasia, c.razao_social) as cliente_nome,
                rec.valor::text  as receita,
                cus.valor::text  as custo_total,
                (rec.valor - cus.valor)::text as margem
           from public.cliente c
           cross join lateral (
             select coalesce(sum(t.valor_liquido), 0) as valor
               from public.titulo_receber t
              where t.cliente_id = c.id and t.status <> 'CANCELADO'
                and t.competencia >= to_char(now() - make_interval(months => $1::int), 'YYYY-MM')
           ) rec
           cross join lateral (
             select coalesce(sum(o.custo_total), 0) as valor
               from public.ordem_servico o
              where o.cliente_id = c.id and o.status = 'VALIDADA'
                and o.validacao_em >= now() - make_interval(months => $1::int)
                and o.deleted_at is null
           ) cus
          where c.deleted_at is null
          order by (rec.valor - cus.valor) asc`,
        [filtro.meses],
      )

      return { serie, por_cliente: porCliente }
    })
  }

  constructor(private readonly banco: BancoService) {}
}
