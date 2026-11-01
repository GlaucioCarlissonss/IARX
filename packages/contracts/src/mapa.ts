import { z } from 'zod'
import { Dinheiro, Uuid } from './primitivos.js'

/**
 * Mapa — onde o parque está.
 *
 * O ponto do mapa é o **local de operação**, não o cliente. A distinção é a que
 * decide um despacho: um cliente com matriz em São Paulo e três filiais no
 * interior é um ponto só na visão comercial e quatro na visão de campo, e é a
 * segunda que responde "quem vai atender".
 *
 * Local sem coordenada fica de fora, e a contagem de quantos ficaram vai na
 * resposta. Omitir em silêncio faria o mapa parecer completo: quem olha conta
 * os pinos e conclui que é o parque inteiro, quando pode faltar um terço.
 */

export const PontoMapa = z.object({
  local_id: Uuid,
  local_nome: z.string(),
  cliente_id: Uuid,
  cliente_nome: z.string(),
  lat: z.number(),
  lon: z.number(),
  /** Precisão da geocodificação — ponto de rua e ponto de cidade não são o mesmo. */
  geo_precisao: z.string().nullable(),
  equipamentos: z.number().int(),
  situacao_credito: z.string(),
  /** Receita dos últimos doze meses, do que já foi emitido. */
  receita_12m: Dinheiro,
})
export type PontoMapa = z.infer<typeof PontoMapa>

export const Mapa = z.object({
  pontos: z.array(PontoMapa),
  /**
   * Quantos locais ficaram de fora por não ter coordenada.
   *
   * É a fila de trabalho do mapa: local sem coordenada não aparece, o que na
   * prática é o mesmo que não existir para quem planeja rota.
   */
  sem_coordenada: z.number().int(),
})
export type Mapa = z.infer<typeof Mapa>

export const ConsultarMapa = z.object({
  cliente_id: Uuid.optional(),
  /** Só quem tem equipamento instalado — o mapa de parque, não o de cadastro. */
  somente_com_parque: z.coerce.boolean().optional(),
})
export type ConsultarMapa = z.infer<typeof ConsultarMapa>
