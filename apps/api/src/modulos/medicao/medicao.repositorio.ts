import { Injectable } from '@nestjs/common'
import type {
  EstornarLeitura,
  Leitura,
  ListarLeituras,
  Medidor,
  RegistrarLeituraMedidor,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'

/**
 * Acesso a medidores e leituras.
 *
 * Como nos demais repositórios: nenhum `where tenant_id`. O isolamento é da
 * RLS, dentro do banco.
 *
 * Nenhuma validação de monotonia aqui, e é deliberado: RN-020 é gatilho em
 * `leitura_medidor`, e repetir a checagem nesta camada criaria dois lugares
 * para a regra divergir — com a agravante de que o segundo lugar só valeria
 * para quem passa por esta API, deixando importação e correção manual de fora.
 */

const SELECT_LEITURA = `
  select l.id, l.medidor_id, l.equipamento_id,
         to_char(l.data_leitura, 'YYYY-MM-DD"T"HH24:MI:SSOF') as data_leitura,
         l.valor::text as valor, l.origem, l.status,
         l.contrato_item_id, l.registrado_por, l.motivo_estorno,
         to_char(l.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at
    from public.leitura_medidor l
`

@Injectable()
export class MedicaoRepositorio {
  async medidoresDe(db: Executor, equipamentoId: string): Promise<Medidor[]> {
    return db.consultar<Medidor & Record<string, unknown>>(
      `select id, equipamento_id, tipo::text as tipo, unidade,
              valor_inicial::text as valor_inicial,
              valor_atual::text   as valor_atual,
              acumulado_total::text as acumulado_total,
              ativo
         from public.medidor
        where equipamento_id = $1
        order by ativo desc, tipo`,
      [equipamentoId],
    )
  }

  async leiturasDe(db: Executor, equipamentoId: string, filtro: ListarLeituras): Promise<Leitura[]> {
    const valores: unknown[] = [equipamentoId]
    let onde = 'l.equipamento_id = $1'

    if (filtro.medidor_id) {
      valores.push(filtro.medidor_id)
      onde += ` and l.medidor_id = $${valores.length}`
    }
    /*
     * Estornada e revisada ficam de fora por omissão.
     *
     * Quem abre o histórico quer saber o que vale; a leitura estornada e a que
     * a substituiu, lado a lado sem distinção visual, fazem o contador parecer
     * ter andado para trás — que é justamente o que RN-020 impede.
     */
    if (!filtro.incluir_invalidas) onde += ` and l.status = 'VALIDA'`

    valores.push(filtro.limit)
    return db.consultar<Leitura & Record<string, unknown>>(
      `${SELECT_LEITURA} where ${onde}
        order by l.data_leitura desc, l.created_at desc
        limit $${valores.length}`,
      valores,
    )
  }

  async porId(db: Executor, id: string): Promise<Leitura | null> {
    return db.consultarUm<Leitura & Record<string, unknown>>(`${SELECT_LEITURA} where l.id = $1`, [id])
  }

  async registrar(
    db: Executor,
    equipamentoId: string,
    dados: RegistrarLeituraMedidor,
    autorId: string,
  ): Promise<Leitura | null> {
    const linha = await db.consultarUm<{ id: string }>(
      `insert into public.leitura_medidor
         (tenant_id, medidor_id, equipamento_id, data_leitura, valor, origem,
          contrato_item_id, registrado_por, created_by)
       values (app.tenant_atual(), $1, $2, $3::timestamptz, $4::numeric, $5, $6, $7, $7)
       returning id`,
      [
        dados.medidor_id,
        equipamentoId,
        dados.data_leitura,
        dados.valor,
        dados.origem,
        dados.contrato_item_id ?? null,
        autorId,
      ],
    )
    return linha ? this.porId(db, linha.id) : null
  }

  /**
   * Marca a leitura como estornada.
   *
   * Não apaga e não edita o valor. A fatura do mês passado saiu com este
   * número, e apagá-lo removeria a única evidência de por que o valor mudou —
   * exatamente a pergunta que alguém faz quando o cliente contesta.
   */
  async estornar(db: Executor, id: string, dados: EstornarLeitura, autorId: string): Promise<Leitura | null> {
    /*
     * `returning id` e não contagem de linhas: o `Executor` desta base expõe
     * consulta, não execução — e devolver a linha diz, de uma vez, se o
     * estorno aconteceu. Zero linhas significa que a leitura não existe ou já
     * estava estornada, e as duas merecem a mesma resposta: não há o que
     * estornar.
     */
    const linha = await db.consultarUm<{ id: string }>(
      `update public.leitura_medidor
          set status = 'ESTORNADA', motivo_estorno = $2, created_by = coalesce(created_by, $3)
        where id = $1 and status = 'VALIDA'
        returning id`,
      [id, dados.motivo, autorId],
    )
    return linha ? this.porId(db, id) : null
  }
}
