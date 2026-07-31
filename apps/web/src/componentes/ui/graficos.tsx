import { useId } from 'react'
import { competenciaCurta } from '../../lib/formato'
import { Rolagem } from './Rolagem'
import type { SerieMensal } from '../../dados/tipos'

/**
 * Gráficos em SVG próprio, sem biblioteca.
 *
 * Três razões: controle total da acessibilidade (nenhuma lib entrega
 * alternativa tabular e rótulo direto por padrão), bundle menor, e aderência ao
 * limite de 5 séries por cor definido em G.6.
 *
 * Toda figura tem: descrição textual da conclusão, alternativa em tabela e
 * segundo canal além da cor.
 */

const COR_SERIE = ['var(--cor-serie-1)', 'var(--cor-serie-2)', 'var(--cor-serie-3)', 'var(--cor-serie-4)', 'var(--cor-serie-5)']
/** Padrão de traço por série — o segundo canal exigido por WCAG 1.4.1. */
const TRACO_SERIE = ['none', '5 3', '2 2', '8 3 2 3', '1 3']

/* -------------------------------------------------------------- sparkline */

export function Sparkline({
  serie,
  rotulo,
  cor = 'var(--cor-serie-1)',
  altura = 40,
}: {
  serie: SerieMensal[]
  rotulo: string
  cor?: string
  altura?: number
}) {
  if (serie.length < 2) return null
  const w = 160
  const valores = serie.map((s) => s.valor)
  const min = Math.min(...valores)
  const max = Math.max(...valores)
  const faixa = max - min || 1
  const px = (i: number) => (i / (serie.length - 1)) * w
  const py = (v: number) => altura - 4 - ((v - min) / faixa) * (altura - 10)

  const linha = serie.map((s, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(s.valor).toFixed(1)}`).join(' ')
  const area = `${linha} L${w},${altura} L0,${altura} Z`
  const ultimo = serie[serie.length - 1]
  const primeiro = serie[0]
  const direcao = ultimo.valor >= primeiro.valor ? 'em alta' : 'em queda'
  const id = useId()

  return (
    <svg
      className="grafico"
      viewBox={`0 0 ${w} ${altura}`}
      height={altura}
      role="img"
      aria-label={`${rotulo}: ${direcao} nos últimos ${serie.length} meses, de ${primeiro.valor.toLocaleString('pt-BR')} em ${competenciaCurta(primeiro.competencia)} para ${ultimo.valor.toLocaleString('pt-BR')} em ${competenciaCurta(ultimo.competencia)}.`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cor} stopOpacity="0.22" />
          <stop offset="100%" stopColor={cor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#grad-${id})`} />
      <path d={linha} fill="none" stroke={cor} strokeWidth="1.75" strokeLinejoin="round" />
      {/* Ponto final enfatizado: dá o "onde estamos agora" sem precisar de eixo. */}
      <circle cx={px(serie.length - 1)} cy={py(ultimo.valor)} r="2.75" fill={cor} />
    </svg>
  )
}

/* ------------------------------------------------------ barras + linha mensal */

interface BarrasProps {
  titulo: string
  series: { nome: string; dados: SerieMensal[]; tipo: 'barra' | 'linha' }[]
  formatarValor: (v: number) => string
  altura?: number
}

/**
 * Composto de barras (volume) com linha (tendência). Usado para receita vs.
 * custo e para páginas impressas por mês.
 */
export function BarrasMensais({ titulo, series, formatarValor, altura = 210 }: BarrasProps) {
  const id = useId()
  const meses = series[0]?.dados ?? []
  if (!meses.length) return null

  const w = 760
  const padEsq = 8
  const padBaixo = 26
  const alturaPlot = altura - padBaixo
  const maximo = Math.max(...series.flatMap((s) => s.dados.map((d) => d.valor))) || 1
  const larguraSlot = (w - padEsq) / meses.length
  const larguraBarra = Math.min(30, larguraSlot * 0.5)

  const py = (v: number) => alturaPlot - (v / maximo) * (alturaPlot - 12)

  const resumo = series
    .map((s) => {
      const ult = s.dados[s.dados.length - 1]
      return `${s.nome}: ${formatarValor(ult.valor)} em ${competenciaCurta(ult.competencia)}`
    })
    .join('; ')

  return (
    <figure className="pilha g3" style={{ margin: 0 }}>
      <Rolagem rotulo={titulo}>
        <svg
          className="grafico"
          viewBox={`0 0 ${w} ${altura}`}
          role="img"
          aria-labelledby={`${id}-titulo`}
          style={{ minWidth: 520 }}
        >
          <title id={`${id}-titulo`}>{`${titulo}. ${resumo}. A tabela abaixo traz os mesmos valores.`}</title>

          {/* Grade horizontal discreta — referência sem competir com os dados. */}
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={padEsq}
              x2={w}
              y1={py(maximo * f)}
              y2={py(maximo * f)}
              stroke="var(--cor-border)"
              strokeWidth="1"
            />
          ))}

          {series.map((s, si) =>
            s.tipo === 'barra' ? (
              <g key={s.nome}>
                {s.dados.map((d, i) => {
                  const x = padEsq + i * larguraSlot + (larguraSlot - larguraBarra) / 2
                  const y = py(d.valor)
                  return (
                    <rect
                      key={d.competencia}
                      x={x}
                      y={y}
                      width={larguraBarra}
                      height={Math.max(1, alturaPlot - y)}
                      rx="3"
                      fill={COR_SERIE[si % COR_SERIE.length]}
                      fillOpacity={i === s.dados.length - 1 ? 1 : 0.82}
                    />
                  )
                })}
              </g>
            ) : (
              <path
                key={s.nome}
                d={s.dados
                  .map(
                    (d, i) =>
                      `${i === 0 ? 'M' : 'L'}${(padEsq + i * larguraSlot + larguraSlot / 2).toFixed(1)},${py(d.valor).toFixed(1)}`,
                  )
                  .join(' ')}
                fill="none"
                stroke={COR_SERIE[si % COR_SERIE.length]}
                strokeWidth="2"
                strokeDasharray={TRACO_SERIE[si % TRACO_SERIE.length]}
                strokeLinejoin="round"
              />
            ),
          )}

          {meses.map((d, i) => (
            <text
              key={d.competencia}
              x={padEsq + i * larguraSlot + larguraSlot / 2}
              y={altura - 8}
              textAnchor="middle"
              fontSize="11"
              fill="var(--cor-text-muted)"
            >
              {competenciaCurta(d.competencia)}
            </text>
          ))}
        </svg>
      </Rolagem>

      <div className="legenda">
        {series.map((s, si) => (
          <span className="legenda__item" key={s.nome}>
            <span
              className="legenda__marca"
              style={{
                background: COR_SERIE[si % COR_SERIE.length],
                borderRadius: s.tipo === 'linha' ? '999px' : '2px',
                height: s.tipo === 'linha' ? 3 : 10,
              }}
              aria-hidden="true"
            />
            {s.nome} <span className="texto-atenuado">({s.tipo === 'barra' ? 'barra' : 'linha'})</span>
          </span>
        ))}
      </div>

      <details>
        <summary className="texto-atenuado" style={{ cursor: 'pointer' }}>
          Ver os mesmos dados em tabela
        </summary>
        <Rolagem rotulo={`${titulo} em tabela`}>
          <table style={{ marginTop: 'var(--e2)' }}>
            <caption>{titulo} — valores por competência</caption>
            <thead>
              <tr>
                <th scope="col">Competência</th>
                {series.map((s) => (
                  <th scope="col" className="numerico" key={s.nome}>
                    {s.nome}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {meses.map((m, i) => (
                <tr key={m.competencia}>
                  <th scope="row">{competenciaCurta(m.competencia)}</th>
                  {series.map((s) => (
                    <td className="numerico dado" key={s.nome}>
                      {formatarValor(s.dados[i]?.valor ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Rolagem>
      </details>
    </figure>
  )
}

/* ------------------------------------------------------------- barras horizontais */

export function BarrasHorizontais({
  titulo,
  itens,
  formatarValor,
}: {
  titulo: string
  itens: { rotulo: string; valor: number; severidade?: 'disponivel' | 'uso' | 'atencao' | 'critico' | 'inativo' }[]
  formatarValor: (v: number) => string
}) {
  const maximo = Math.max(...itens.map((i) => i.valor), 1)
  const COR: Record<string, string> = {
    disponivel: 'var(--cor-disponivel-mark)',
    uso: 'var(--cor-em-uso-mark)',
    atencao: 'var(--cor-atencao-mark)',
    critico: 'var(--cor-critico-mark)',
    inativo: 'var(--cor-inativo-mark)',
  }

  return (
    <table>
      <caption className="so-leitor">{titulo}</caption>
      <thead className="so-leitor">
        <tr>
          <th scope="col">Item</th>
          <th scope="col">Valor</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((i) => (
          <tr key={i.rotulo}>
            <th scope="row" style={{ fontWeight: 600, width: '42%' }}>
              {i.rotulo}
            </th>
            <td>
              <div className="linha g3">
                <div className="crescer">
                  <div className="barra-medida">
                    <i
                      style={{
                        width: `${(i.valor / maximo) * 100}%`,
                        background: i.severidade ? COR[i.severidade] : 'var(--cor-serie-1)',
                      }}
                    />
                  </div>
                </div>
                <span className="dado" style={{ minWidth: 78, textAlign: 'right' }}>
                  {formatarValor(i.valor)}
                </span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
