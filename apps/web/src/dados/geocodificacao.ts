/**
 * Busca de endereço (geocodificação) pelo Nominatim.
 *
 * Serve a dois usos que a busca local não cobre: chegar a um lugar que ainda
 * não é cliente, e descobrir a coordenada de um cliente que foi cadastrado sem
 * ela — que hoje simplesmente não aparece no mapa.
 *
 * Não substitui a busca por cliente, cidade e UF. Aquela é instantânea, roda
 * sobre a base já carregada e funciona sem rede; trocá-la por chamada externa
 * transformaria a operação mais frequente da tela na mais frágil. Esta entra
 * como ação explícita, quando o termo digitado não casa com nenhum cliente.
 *
 * Sobre depender do servidor público: a política de uso do Nominatim pede no
 * máximo uma requisição por segundo e desaconselha uso pesado. O respeito ao
 * limite está implementado aqui, mas a resposta certa quando a plataforma
 * crescer é hospedar o próprio Nominatim ou contratar um geocodificador — daí
 * `ENDERECO_SERVICO` ser uma constante isolada, e não uma URL escondida no meio
 * de uma função.
 */

export const ENDERECO_SERVICO = 'https://nominatim.openstreetmap.org/search'

/** Abaixo disto a busca devolve o país inteiro e gasta a cota à toa. */
export const MIN_CARACTERES = 4

/**
 * Piso entre chamadas, exigido pela política de uso do serviço público.
 *
 * A busca é disparada por ação explícita, não a cada tecla — o que já mantém o
 * volume baixo sem precisar de espera de digitação. O piso cobre o resto: nada
 * impede alguém de clicar cinco vezes seguidas.
 */
const INTERVALO_MINIMO = 1000

export interface CaixaEnvolvente {
  sul: number
  norte: number
  oeste: number
  leste: number
}

export interface ResultadoEndereco {
  id: string
  rotulo: string
  lat: number
  lon: number
  /** Enquadramento sugerido pelo serviço. Ausente quando vier malformado. */
  caixa: CaixaEnvolvente | null
}

/**
 * Converte a resposta do Nominatim.
 *
 * É pura, e separada da chamada de rede, porque é aqui que mora o risco. O
 * serviço devolve **latitude e longitude como texto**, e `boundingbox` como
 * quatro strings na ordem `[sul, norte, oeste, leste]` — que não é a ordem de
 * nenhuma outra API de mapa. Tratar isso como número seria um erro silencioso:
 * `"-23.5" * 1` funciona, `undefined * 1` vira `NaN`, e um `NaN` que chega ao
 * componente enquadra o mapa em lugar nenhum sem lançar exceção.
 *
 * Tudo o que não converte é descartado em vez de propagado. Resultado a menos
 * é um incômodo; coordenada inválida no mapa é um defeito difícil de rastrear.
 */
export function lerRespostaNominatim(bruto: unknown): ResultadoEndereco[] {
  if (!Array.isArray(bruto)) return []

  const saida: ResultadoEndereco[] = []
  bruto.forEach((item, i) => {
    if (typeof item !== 'object' || item === null) return
    const o = item as Record<string, unknown>

    const lat = numero(o.lat)
    const lon = numero(o.lon)
    if (lat === null || lon === null) return
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return

    const rotulo =
      texto(o.display_name) ?? texto(o.name) ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`

    saida.push({
      id: o.place_id === undefined || o.place_id === null ? `${lat}/${lon}/${i}` : String(o.place_id),
      rotulo,
      lat,
      lon,
      caixa: lerCaixa(o.boundingbox),
    })
  })
  return saida
}

function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function lerCaixa(v: unknown): CaixaEnvolvente | null {
  if (!Array.isArray(v) || v.length !== 4) return null
  const [sul, norte, oeste, leste] = v.map(numero)
  if (sul === null || norte === null || oeste === null || leste === null) return null
  // Caixa degenerada não enquadra nada; melhor cair no zoom padrão do ponto.
  if (sul === norte && oeste === leste) return null
  return { sul, norte, oeste, leste }
}

/* ---------------------------------------------------------------- chamada */

let ultimaChamada = 0

/**
 * Consulta o serviço.
 *
 * `countrycodes=br` porque a operação é nacional e a restrição corta ruído —
 * "Santa Cruz" sem ela devolve Bolívia e Espanha antes de qualquer cidade
 * brasileira.
 */
export async function buscarEndereco(
  termo: string,
  sinal?: AbortSignal,
): Promise<ResultadoEndereco[]> {
  const consulta = termo.trim()
  if (consulta.length < MIN_CARACTERES) return []

  const desde = Date.now() - ultimaChamada
  if (desde < INTERVALO_MINIMO) {
    await esperar(INTERVALO_MINIMO - desde, sinal)
  }
  ultimaChamada = Date.now()

  const url = new URL(ENDERECO_SERVICO)
  url.searchParams.set('q', consulta)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('countrycodes', 'br')
  url.searchParams.set('limit', '5')
  url.searchParams.set('addressdetails', '0')

  const r = await fetch(url, { signal: sinal, headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`geocodificação respondeu ${r.status}`)
  return lerRespostaNominatim(await r.json())
}

function esperar(ms: number, sinal?: AbortSignal): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    if (sinal?.aborted) return rejeitar(sinal.reason)
    const t = setTimeout(resolver, ms)
    sinal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        rejeitar(sinal.reason)
      },
      { once: true },
    )
  })
}
