import { useMemo } from 'react'
import { api } from '../dados/api'
import { agregadoPorRegiao, linhasClientes, linhasParque } from '../dados/consultas'
import { useConsulta } from '../lib/useConsulta'
import { duracaoHoras, inteiro, moeda, moedaCompacta, percentual } from '../lib/formato'
import { Carregando, Cartao, Chip, Metrica, Skeleton } from '../componentes/ui/primitivos'
import { BarrasHorizontais, BarrasMensais, Sparkline } from '../componentes/ui/graficos'
import { Rolagem } from '../componentes/ui/Rolagem'

/**
 * Resultado operacional.
 *
 * Painel executivo: tendência, não exceção. Oito indicadores na primeira dobra,
 * todos com comparação de período, e no máximo dois níveis até o registro-fonte.
 */
export function Resultado() {
  const { situacao, dado } = useConsulta(() => api.indicadores(), [])

  const parque = useMemo(() => (dado ? linhasParque() : []), [dado])
  const clientes = useMemo(() => (dado ? linhasClientes() : []), [dado])
  const regioes = useMemo(() => (dado ? agregadoPorRegiao() : []), [dado])

  if (situacao === 'carregando' || !dado) {
    return (
      <Carregando rotulo="Carregando resultado operacional">
        <div className="grade grade--metricas">
          {Array.from({ length: 8 }, (_, i) => (
            <div className="cartao" key={i}>
              <Skeleton altura="28px" largura="60%" />
              <Skeleton linhas={2} />
            </div>
          ))}
        </div>
      </Carregando>
    )
  }

  const i = dado
  const deficitarios = parque.filter((l) => l.margem < 0).sort((a, b) => a.margem - b.margem)
  const custoTotal = i.serieCusto[i.serieCusto.length - 1].valor

  const variacaoPP = (atual: number, anterior: number) =>
    `${atual >= anterior ? '+' : '−'}${Math.abs((atual - anterior) * 100).toFixed(1)} p.p.`

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Resultado operacional</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Todos os números derivam do mesmo registro transacional das telas de operação — não há consolidação
            paralela em planilha.
          </p>
        </div>
        <p className="texto-atenuado">Competência de referência: julho de 2026</p>
      </div>

      <section aria-label="Indicadores principais" className="grade grade--metricas">
        <Cartao compacto>
          <Metrica
            rotulo="Receita da competência"
            valor={moedaCompacta(i.receitaMes)}
            variacao={`${i.receitaMes >= i.receitaMesAnterior ? '+' : '−'}${Math.abs(((i.receitaMes - i.receitaMesAnterior) / i.receitaMesAnterior) * 100).toFixed(1)}%`}
            tendencia={i.receitaMes >= i.receitaMesAnterior ? 'positiva' : 'negativa'}
            contexto={moeda(i.receitaMes)}
          />
          <Sparkline serie={i.serieReceita} rotulo="Receita mensal" />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Receita recorrente"
            valor={moedaCompacta(i.mrr)}
            variacao={`+${(((i.mrr - i.mrrAnterior) / i.mrrAnterior) * 100).toFixed(1)}%`}
            tendencia="positiva"
            contexto="base contratada mensal"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Margem operacional"
            valor={percentual(i.margemOperacional)}
            variacao={variacaoPP(i.margemOperacional, i.margemOperacionalAnterior)}
            tendencia={i.margemOperacional >= i.margemOperacionalAnterior ? 'positiva' : 'negativa'}
            contexto="após manutenção e depreciação"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Taxa de ocupação"
            valor={percentual(i.taxaOcupacao)}
            variacao={variacaoPP(i.taxaOcupacao, i.taxaOcupacaoAnterior)}
            tendencia={i.taxaOcupacao >= i.taxaOcupacaoAnterior ? 'positiva' : 'negativa'}
            contexto={`${inteiro(i.equipamentosLocados)} de ${inteiro(i.equipamentosAtivos)} equipamentos`}
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Inadimplência"
            valor={percentual(i.inadimplencia)}
            variacao={variacaoPP(i.inadimplencia, i.inadimplenciaAnterior)}
            tendencia={i.inadimplencia <= i.inadimplenciaAnterior ? 'positiva' : 'negativa'}
            contexto="vencido sobre carteira aberta"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Cumprimento de SLA"
            valor={percentual(i.slaCumprimento)}
            variacao={variacaoPP(i.slaCumprimento, i.slaAnterior)}
            tendencia={i.slaCumprimento >= i.slaAnterior ? 'positiva' : 'negativa'}
            contexto="meta 95%"
          />
          <Sparkline serie={i.serieSla} rotulo="Cumprimento de SLA por mês" cor="var(--cor-serie-4)" />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Tempo médio de reparo"
            valor={duracaoHoras(i.mttrHoras)}
            variacao={`${i.mttrHoras <= i.mttrAnterior ? '−' : '+'}${Math.abs(((i.mttrHoras - i.mttrAnterior) / i.mttrAnterior) * 100).toFixed(1)}%`}
            tendencia={i.mttrHoras <= i.mttrAnterior ? 'positiva' : 'negativa'}
            contexto="abertura até conclusão"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Disponibilidade do parque"
            valor={percentual(i.disponibilidade)}
            contexto={`${inteiro(i.equipamentosManutencao)} equipamentos fora de operação`}
          />
        </Cartao>
      </section>

      <Cartao comoRegiao titulo="Receita e custo por competência">
        <BarrasMensais
          titulo="Receita faturada e custo operacional por mês"
          series={[
            { nome: 'Receita faturada', dados: i.serieReceita, tipo: 'barra' },
            { nome: 'Custo operacional', dados: i.serieCusto, tipo: 'linha' },
          ]}
          formatarValor={moedaCompacta}
        />
        <p className="texto-atenuado">
          Custo operacional soma manutenção, peças e depreciação do parque. A margem do mês foi{' '}
          {percentual(i.margemOperacional)}, com {moeda(custoTotal)} de custo sobre {moeda(i.receitaMes)} de receita.
        </p>
      </Cartao>

      <div className="grade grade--2">
        <Cartao comoRegiao titulo="Desempenho por região">
          <Rolagem rotulo="Tabela de dados">
            <table>
              <caption className="so-leitor">Parque, ocupação e recorrente por região</caption>
              <thead>
                <tr>
                  <th scope="col">Região</th>
                  <th scope="col" className="numerico">Parque</th>
                  <th scope="col" className="numerico">Ocupação</th>
                  <th scope="col" className="numerico">Recorrente</th>
                  <th scope="col">Criticidade</th>
                </tr>
              </thead>
              <tbody>
                {regioes.map((r) => (
                  <tr key={r.regiao.id}>
                    <th scope="row" style={{ fontWeight: 600 }}>
                      {r.regiao.nome}
                      <br />
                      <span className="texto-atenuado">{r.clientes} clientes</span>
                    </th>
                    <td className="numerico dado">{inteiro(r.total)}</td>
                    <td className="numerico dado">{percentual(r.ocupacao)}</td>
                    <td className="numerico dado">{moedaCompacta(r.mrr)}</td>
                    <td>
                      {r.criticos > 0 ? (
                        <Chip severidade="critico">{r.criticos} bloqueado(s)</Chip>
                      ) : r.manutencao > 0 ? (
                        <Chip severidade="atencao">{r.manutencao} em manutenção</Chip>
                      ) : (
                        <Chip severidade="disponivel">sem pendência</Chip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Rolagem>
        </Cartao>

        <Cartao comoRegiao titulo="Rentabilidade por cliente">
          <BarrasHorizontais
            titulo="Dez clientes por margem acumulada em 12 meses"
            itens={[...clientes]
              .sort((a, b) => b.margemPercentual - a.margemPercentual)
              .slice(0, 5)
              .concat([...clientes].sort((a, b) => a.margemPercentual - b.margemPercentual).slice(0, 3))
              .map((c) => ({
                rotulo: c.cliente.nomeFantasia,
                valor: Math.round(c.margemPercentual * 100),
                severidade: c.margemPercentual < 0.1 ? ('critico' as const) : ('uso' as const),
              }))}
            formatarValor={(v) => `${v}%`}
          />
          <p className="texto-atenuado">
            Cinco melhores e três piores margens. Cliente com margem abaixo de 10% aparece em vermelho — candidato a
            renegociação de franquia ou de preço por página.
          </p>
        </Cartao>
      </div>

      <Cartao comoRegiao titulo="Equipamentos com margem negativa">
        {deficitarios.length === 0 ? (
          <p className="texto-secundario">Nenhum equipamento com margem negativa nos últimos 12 meses.</p>
        ) : (
          <>
            <p className="texto-secundario medida-leitura">
              Custo de manutenção acima da receita gerada. Três competências consecutivas assim tornam o ativo
              candidato a desmobilização.
            </p>
            <Rolagem rotulo="Tabela de dados">
              <table>
                <caption className="so-leitor">Equipamentos cujo custo excede a receita</caption>
                <thead>
                  <tr>
                    <th scope="col">Patrimônio</th>
                    <th scope="col">Modelo</th>
                    <th scope="col" className="numerico">Receita 12 m</th>
                    <th scope="col" className="numerico">Custo 12 m</th>
                    <th scope="col" className="numerico">Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {deficitarios.slice(0, 8).map((l) => (
                    <tr key={l.equipamento.id}>
                      <th scope="row" className="dado" style={{ fontWeight: 620 }}>
                        {l.equipamento.patrimonio}
                      </th>
                      <td>{l.modelo}</td>
                      <td className="numerico dado">{moeda(l.equipamento.receita12m)}</td>
                      <td className="numerico dado">{moeda(l.equipamento.custoManutencao12m)}</td>
                      <td className="numerico dado" style={{ color: 'var(--cor-critico)' }}>
                        {moeda(l.margem)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Rolagem>
          </>
        )}
      </Cartao>
    </>
  )
}
