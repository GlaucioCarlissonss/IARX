import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import { execucaoOrcamentaria, indicadoresDespesa } from '../dados/consultas'
import type { LinhaExecucao } from '../dados/consultas'
import { useConsulta } from '../lib/useConsulta'
import { useSessao, useToast } from '../lib/contexto'
import { baixar } from '../lib/baixar'
import { competenciaLonga, moeda, moedaCompacta, percentual } from '../lib/formato'
import { Botao, Carregando, Cartao, Chip, Metrica, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { BarrasHorizontais } from '../componentes/ui/graficos'
import { Rolagem } from '../componentes/ui/Rolagem'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'
import type { LimiarExecucao } from '../dados/tipos'

/**
 * Controle de despesas.
 *
 * A tela responde uma pergunta só: **o que foi gasto, contra o que foi
 * orçado**. Tudo o que ela mostra é derivado de contas a pagar no instante da
 * consulta — não há campo de "gasto acumulado" em lugar nenhum, e é o que
 * permite um título cancelado mudar o percentual imediatamente, sem job.
 *
 * O semáforo tem quatro degraus (RN-F24), e o degrau é calculado junto do
 * número que o justifica. Guardá-lo faria o alerta de 90% sobreviver ao
 * cancelamento do título que o disparou — um aviso que a tela não consegue mais
 * explicar.
 */
const LIMIAR: Record<LimiarExecucao, { rotulo: string; sev: 'disponivel' | 'atencao' | 'critico' | 'inativo' }> = {
  NORMAL: { rotulo: 'Dentro do orçado', sev: 'disponivel' },
  ATENCAO: { rotulo: 'Acima de 75%', sev: 'atencao' },
  CRITICO: { rotulo: 'Acima de 90%', sev: 'critico' },
  ESTOURADO: { rotulo: 'Estourado', sev: 'critico' },
  SEM_ORCAMENTO: { rotulo: 'Sem orçamento', sev: 'inativo' },
}

export function Despesas() {
  const { pode } = useSessao()
  const { avisar } = useToast()
  const { situacao, dado } = useConsulta(() => api.orcamentos(), [])
  const base = api.baseSincrona()

  const competencias = base.competencias
  const [competencia, setCompetencia] = useState(competencias[competencias.length - 1] ?? '')
  const [ano, mes] = competencia.split('-').map(Number)

  const indicadores = useMemo(
    () => (dado && ano && mes ? indicadoresDespesa(ano, mes) : null),
    [dado, ano, mes],
  )
  const linhas = useMemo<LinhaExecucao[]>(
    () => (dado && ano && mes ? execucaoOrcamentaria(ano, mes) : []),
    [dado, ano, mes],
  )

  const estouradas = linhas.filter((l) => l.limiar === 'ESTOURADO')
  const residual = base.categoriasDespesa.find((c) => c.residual)
  const semCategoria = base.titulosPagar.filter(
    (t) =>
      t.categoriaId === residual?.id &&
      t.dataEmissao.slice(0, 7) === competencia &&
      t.status !== 'CANCELADO' &&
      t.status !== 'REJEITADO',
  )

  const colunas: Coluna<LinhaExecucao>[] = [
    {
      chave: 'categoria',
      titulo: 'Categoria',
      identificadora: true,
      ordenarPor: (l) => l.categoriaNome,
      celula: (l) => l.categoriaNome,
    },
    {
      chave: 'orcado',
      titulo: 'Orçado',
      numerico: true,
      ordenarPor: (l) => l.valorOrcado,
      celula: (l) => <span className="dado">{moeda(l.valorOrcado)}</span>,
    },
    {
      chave: 'realizado',
      titulo: 'Realizado',
      numerico: true,
      ordenarPor: (l) => l.realizado,
      celula: (l) => <span className="dado">{moeda(l.realizado)}</span>,
    },
    {
      chave: 'comprometido',
      titulo: 'Comprometido',
      numerico: true,
      ocultarEmMobile: true,
      ordenarPor: (l) => l.comprometido,
      // O gasto mais o aprovado-não-pago: é o que limita o replanejamento, e
      // por isso aparece ao lado do realizado em vez de escondido num detalhe.
      celula: (l) => <span className="dado">{moeda(l.comprometido)}</span>,
    },
    {
      chave: 'execucao',
      titulo: 'Execução',
      ordenarPor: (l) => l.percentual ?? -1,
      celula: (l) => (
        <>
          <Chip severidade={LIMIAR[l.limiar].sev}>{LIMIAR[l.limiar].rotulo}</Chip>
          {l.percentual !== null && (
            <>
              <br />
              <span className="texto-atenuado dado">{percentual(l.percentual)}</span>
            </>
          )}
        </>
      ),
    },
  ]

  async function exportar() {
    const cabecalho = 'categoria;orcado;realizado;comprometido;execucao\n'
    const corpo = linhas
      .map((l) =>
        [
          l.categoriaNome,
          l.valorOrcado.toFixed(2),
          l.realizado.toFixed(2),
          l.comprometido.toFixed(2),
          l.percentual === null ? '' : (l.percentual * 100).toFixed(1),
        ].join(';'),
      )
      .join('\n')
    const r = await baixar(`execucao-${competencia}.csv`, cabecalho + corpo, `execucao-${competencia}.txt`)
    if (r.aviso) avisar({ tom: 'atencao', titulo: 'Exportação', texto: r.aviso })
  }

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Despesas</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Nada aqui é digitado além do orçamento. O realizado vem de contas a pagar, e é recalculado a cada
            consulta — cancelar um título muda o percentual na hora.
          </p>
        </div>
        {linhas.length > 0 && (
          <Botao variante="sutil" glifo="↓" onClick={exportar}>
            Exportar execução
          </Botao>
        )}
      </div>

      {semCategoria.length > 0 && (
        <Cartao
          comoRegiao
          titulo={`${semCategoria.length} lançamentos ainda em "${residual?.nome}"`}
        >
          <p className="medida-leitura">
            Eles entram no total da competência — o painel fecha com contas a pagar — e não entram em
            nenhuma linha de orçamento, porque ainda não têm categoria. É a fila de trabalho da
            classificação, e ela fica visível de propósito:{' '}
            <strong>{moeda(semCategoria.reduce((a, t) => a + (t.valorAjustado ?? t.valorOriginal), 0))}</strong>{' '}
            à espera de destino.
          </p>
        </Cartao>
      )}

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica
            rotulo="Despesa da competência"
            valor={indicadores ? moedaCompacta(indicadores.despesaTotal) : '—'}
            variacao={
              indicadores?.variacao === null || indicadores === null
                ? undefined
                : `${indicadores.variacao >= 0 ? '+' : '−'}${Math.abs(indicadores.variacao * 100).toFixed(1)}%`
            }
            tendencia={
              indicadores?.variacao == null ? undefined : indicadores.variacao <= 0 ? 'positiva' : 'negativa'
            }
            contexto="sobre a competência anterior"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Execução do orçamento"
            valor={indicadores?.execucaoPercentual == null ? '—' : percentual(indicadores.execucaoPercentual)}
            contexto={indicadores ? `${moeda(indicadores.totalOrcado)} orçados` : ''}
          />
        </Cartao>
        <Cartao compacto>
          {/*
            D-26: os dois denominadores lado a lado. O pedido original falava em
            "custo por paciente", que não existe numa locadora; o Anexo L listou
            dois análogos e não escolheu, e mostrar um só obrigaria a decidir sem
            base — a única diferença entre eles é o divisor.
          */}
          <Metrica
            rotulo="Custo por cliente ativo"
            valor={indicadores?.custoPorClienteAtivo == null ? '—' : moeda(indicadores.custoPorClienteAtivo)}
            contexto={indicadores ? `${indicadores.clientesAtivos} clientes com contrato ativo` : ''}
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Custo por equipamento locado"
            valor={
              indicadores?.custoPorEquipamentoLocado == null
                ? '—'
                : moeda(indicadores.custoPorEquipamentoLocado)
            }
            contexto={indicadores ? `${indicadores.equipamentosLocados} em campo` : ''}
          />
        </Cartao>
      </div>

      {estouradas.length > 0 && (
        <Cartao comoRegiao titulo={`${estouradas.length} categoria(s) acima do orçado em ${competenciaLonga(competencia)}`}>
          {/*
            Crua de propósito: são as categorias estouradas do mês, poucas por
            definição — se forem muitas, o problema não é a tabela. A execução
            completa, essa sim, usa o componente logo abaixo.
          */}
          <Rolagem rotulo="Tabela de dados">
            <table>
              <caption className="so-leitor">Categorias com execução acima de 100% do orçado</caption>
              <thead>
                <tr>
                  <th scope="col">Categoria</th>
                  <th scope="col" className="numerico">Orçado</th>
                  <th scope="col" className="numerico">Realizado</th>
                  <th scope="col" className="numerico">Excesso</th>
                </tr>
              </thead>
              <tbody>
                {estouradas.map((l) => (
                  <tr key={l.orcamento.id}>
                    <th scope="row" style={{ fontWeight: 620 }}>{l.categoriaNome}</th>
                    <td className="numerico dado">{moeda(l.valorOrcado)}</td>
                    <td className="numerico dado">{moeda(l.realizado)}</td>
                    <td className="numerico dado">{moeda(l.realizado - l.valorOrcado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Rolagem>
        </Cartao>
      )}

      {linhas.length > 0 && (
        <Cartao comoRegiao titulo="Realizado por categoria">
          <BarrasHorizontais
            titulo={`Despesa de ${competenciaLonga(competencia)} por categoria`}
            itens={linhas.map((l) => ({
              rotulo: l.categoriaNome,
              valor: l.realizado,
              severidade: LIMIAR[l.limiar].sev === 'atencao' ? 'atencao' : LIMIAR[l.limiar].sev,
            }))}
            formatarValor={moeda}
          />
        </Cartao>
      )}

      <Cartao>
        <div className="filtros">
          <Selecao
            rotulo="Competência"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            opcoes={competencias.map((c) => ({ valor: c, texto: competenciaLonga(c) }))}
          />
        </div>

        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando execução orçamentária">
            <Skeleton linhas={6} />
          </Carregando>
        ) : linhas.length === 0 ? (
          <p className="texto-secundario medida-leitura">
            Não há orçamento cadastrado para {competenciaLonga(competencia)}. Sem orçamento não há execução —
            e a despesa da competência continua somando {indicadores ? moeda(indicadores.despesaTotal) : '—'}{' '}
            em contas a pagar.
          </p>
        ) : (
          <Tabela
            legenda="Execução orçamentária por categoria"
            itens={linhas}
            chaveDe={(l) => l.orcamento.id}
            colunas={colunas}
          />
        )}
      </Cartao>

      {!pode('despesa:orcamento_gerenciar') && (
        <p className="texto-atenuado medida-leitura">
          Você tem leitura do painel. Cadastrar orçamento e replanejar verba exigem
          <span className="dado"> despesa:orcamento_gerenciar</span>.
        </p>
      )}
    </>
  )
}
