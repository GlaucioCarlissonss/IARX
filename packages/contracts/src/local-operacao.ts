import { z } from 'zod'
import { DataHora, Paginacao, Uuid } from './primitivos.js'

/**
 * Local de operação — o endereço onde o parque fica instalado.
 *
 * A coordenada é o que o mapa consome e o que decide de onde o técnico sai. Por
 * isso ela não é um par de números soltos: vem sempre com **precisão** e
 * **fonte**. Sem proveniência, ninguém sabe se um ponto pode ser corrigido por
 * um palpite — e uma coordenada de rastreio sobrescrita por uma geocodificação
 * aproximada é uma perda de informação que não dá para desfazer.
 *
 * O mesmo vale na direção contrária: `PATCH /locais/{id}` com `lat` no corpo
 * não existe. Existe uma ação, `/localizacao`, que exige dizer de onde o número
 * veio.
 */

export const GEO_PRECISAO = ['DECLARADA', 'GEOCODIFICADO', 'RASTREADA', 'APROXIMADA'] as const
export const GeoPrecisao = z.enum(GEO_PRECISAO)
export type GeoPrecisao = z.infer<typeof GeoPrecisao>

export const LocalOperacao = z.object({
  id: Uuid,
  cliente_id: Uuid,
  nome: z.string(),
  /** Nulos quando o local ainda não foi localizado — e é o caso que interessa. */
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  geo_precisao: GeoPrecisao.nullable(),
  geo_fonte: z.string().nullable(),
  geo_atualizado_em: DataHora.nullable(),
})
export type LocalOperacao = z.infer<typeof LocalOperacao>

export const ListarLocais = Paginacao.extend({
  cliente_id: Uuid.optional(),
  /** Só os que ainda não têm coordenada — a fila de trabalho do mapa. */
  sem_coordenada: z.coerce.boolean().optional(),
})
export type ListarLocais = z.infer<typeof ListarLocais>

export const DefinirLocalizacao = z.object({
  /*
   * Latitude primeiro, como devolve qualquer geocodificador.
   *
   * A ordem inversa — longitude primeiro — é a do PostGIS e a do GeoJSON, e a
   * troca entre as duas é o erro clássico desta área: não lança nada, o ponto
   * some do mapa e a única pista é alguém reparar que um cliente sumiu. A
   * conversão acontece num lugar só, dentro do banco.
   */
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  precisao: GeoPrecisao,
  /** De onde veio: serviço e termo consultado, rastreador, ou quem digitou. */
  fonte: z.string().trim().min(1).max(200),
})
export type DefinirLocalizacao = z.infer<typeof DefinirLocalizacao>
