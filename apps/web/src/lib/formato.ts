/**
 * Formatação pt-BR centralizada.
 *
 * Nenhuma tela chama Intl diretamente: assim moeda, data e número têm o mesmo
 * aspecto em todo o sistema, e uma mudança de padrão acontece em um só lugar.
 */

const moedaFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
})

const moedaCompactaFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const inteiroFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const decimalFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const moeda = (v: number) => moedaFmt.format(v)
export const moedaCompacta = (v: number) => moedaCompactaFmt.format(v)
export const inteiro = (v: number) => inteiroFmt.format(v)
export const decimal = (v: number) => decimalFmt.format(v)

export const percentual = (v: number, casas = 1) =>
  `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`

/** Pontos percentuais — a unidade correta para variação de um percentual. */
export const pontosPercentuais = (v: number, casas = 1) =>
  `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })} p.p.`

export const variacao = (atual: number, anterior: number) =>
  anterior === 0 ? 0 : (atual - anterior) / Math.abs(anterior)

export const variacaoTexto = (atual: number, anterior: number) => {
  const v = variacao(atual, anterior)
  const sinal = v >= 0 ? '+' : '−'
  return `${sinal}${Math.abs(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

export const data = (iso: string | Date) => {
  const d = typeof iso === 'string' ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso) : iso
  return d.toLocaleDateString('pt-BR')
}

export const dataHora = (iso: string | Date) => {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export const competenciaCurta = (comp: string) => {
  const [ano, mes] = comp.split('-')
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`
}

export const competenciaLonga = (comp: string) => {
  const [ano, mes] = comp.split('-')
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  return `${nomes[Number(mes) - 1]} de ${ano}`
}

/** Duração em horas → "3 h 40" ou "42 min". */
export const duracaoHoras = (horas: number) => {
  if (horas < 1) return `${Math.round(horas * 60)} min`
  const h = Math.floor(horas)
  const m = Math.round((horas - h) * 60)
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
}

/** Tempo restante até um prazo, com sinal de estouro. */
export function prazoRestante(prazoIso: string, agora: Date) {
  const ms = new Date(prazoIso).getTime() - agora.getTime()
  const estourado = ms < 0
  const abs = Math.abs(ms) / 3600000
  const texto = abs >= 24 ? `${Math.floor(abs / 24)} d ${String(Math.floor(abs % 24)).padStart(2, '0')} h` : duracaoHoras(abs)
  return { estourado, texto: estourado ? `${texto} em atraso` : texto, horas: ms / 3600000 }
}

export const mascararCnpj = (cnpj: string) => cnpj.replace(/^(\d{2})\.(\d{3})\.(\d{3})/, '$1.***.***')
