import { Injectable } from '@nestjs/common'
import type { ConsultarMapa, Mapa, PontoMapa } from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'

/**
 * O mapa, numa consulta.
 *
 * Sem repositório próprio: há uma consulta e nenhuma escrita. Uma camada a mais
 * aqui seria arquivo por simetria, não por necessidade — e simetria que não
 * resolve nada é mais um lugar para procurar quando algo quebra.
 *
 * Como nos demais: nenhum `where tenant_id`. O isolamento é da RLS.
 */
@Injectable()
export class MapaService {
  constructor(private readonly banco: BancoService) {}

  async consultar(filtro: ConsultarMapa): Promise<Mapa> {
    return this.banco.emTransacao(async (db) => {
      const valores: unknown[] = []
      const clausulas = ['l.deleted_at is null']

      if (filtro.cliente_id) {
        valores.push(filtro.cliente_id)
        clausulas.push(`l.cliente_id = $${valores.length}`)
      }

      const onde = clausulas.join(' and ')

      /*
       * Receita por subconsulta e não por `join` com `sum`: o `join`
       * multiplicaria a contagem de equipamentos pelo número de títulos, e a
       * coluna "equipamentos" do mapa passaria a mostrar um número inventado
       * que cresce com o faturamento. É o erro de agregação que não parece
       * erro — os dois valores continuam plausíveis.
       */
      const pontos = await db.consultar<PontoMapa & Record<string, unknown>>(
        `select l.id as local_id, l.nome as local_nome,
                l.cliente_id,
                coalesce(c.nome_fantasia, c.razao_social) as cliente_nome,
                st_y(l.geo::geometry) as lat,
                st_x(l.geo::geometry) as lon,
                l.geo_precisao::text as geo_precisao,
                /*
                 * O equipamento não aponta para o local: o vínculo é pelo
                 * **item de contrato**, que é onde a locação de fato acontece.
                 * A primeira versão desta consulta supôs uma coluna
                 * local_operacao_id em equipamento — ela não existe, e o
                 * motivo é bom: o mesmo equipamento muda de local ao ser
                 * realocado, e guardar o local no ativo apagaria por onde ele
                 * passou.
                 *
                 * DISTINCT porque um equipamento pode ter mais de um item
                 * ao longo do tempo no mesmo local; sem ele, a contagem
                 * cresceria a cada renovação de contrato.
                 */
                (select count(distinct ci.equipamento_id)::int
                   from public.contrato_item ci
                  where ci.local_operacao_id = l.id
                    and ci.equipamento_id is not null
                    /*
                     * Instalado é o que está em campo agora: ativo, suspenso
                     * ou em devolução. Contar só ATIVO esconderia a máquina
                     * suspensa, que continua ocupando espaço no cliente e
                     * continua sendo responsabilidade da locadora — é
                     * exatamente o equipamento que alguém esquece de buscar.
                     */
                    and ci.status in ('ATIVO','SUSPENSO','EM_DEVOLUCAO')) as equipamentos,
                c.situacao_credito::text as situacao_credito,
                (select coalesce(sum(t.valor_liquido), 0)::text
                   from public.titulo_receber t
                  where t.cliente_id = l.cliente_id
                    and t.status <> 'CANCELADO'
                    and t.competencia >= to_char(now() - interval '12 months', 'YYYY-MM')
                ) as receita_12m
           from public.local_operacao l
           join public.cliente c on c.id = l.cliente_id
          where ${onde} and l.geo is not null
          order by cliente_nome, l.nome`,
        valores,
      )

      /*
       * Quantos ficaram de fora, contado na mesma transação.
       *
       * Omitir em silêncio faria o mapa parecer completo: quem olha conta os
       * pinos e conclui que é o parque inteiro, quando pode faltar um terço.
       */
      const [faltando] = await db.consultar<{ n: number }>(
        `select count(*)::int as n from public.local_operacao l
          where ${onde} and l.geo is null`,
        valores,
      )

      const comParque = filtro.somente_com_parque ? pontos.filter((p) => p.equipamentos > 0) : pontos
      return { pontos: comParque, sem_coordenada: faltando?.n ?? 0 }
    })
  }
}
