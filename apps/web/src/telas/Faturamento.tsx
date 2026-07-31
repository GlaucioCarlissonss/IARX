import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import { excecoesFechamento, linhasFaturas } from '../dados/consultas'
import type { LinhaFatura } from '../dados/consultas'
import { useConsulta } from '../lib/useConsulta'
import { useSessao, useToast } from '../lib/contexto'
import { competenciaLonga, data, inteiro, moeda, moedaCompacta, percentual } from '../lib/formato'
import { Aviso, Botao, Carregando, Cartao, Chip, Entrada, Metrica, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { Rolagem } from '../componentes/ui/Rolagem'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'
import type { FaturaStatus } from '../dados/tipos'

const STATUS: Record<FaturaStatus, { rotulo: string; sev: 'disponivel' | 'uso' | 'atencao' | 'critico' | 'inativo' }> = {
  PREVISTA: { rotulo: 'Prevista', sev: 'inativo' },
  EM_FECHAMENTO: { rotulo: 'Em fechamento', sev: 'atencao' },
  EMITIDA: { rotulo: 'Emitida', sev: 'uso' },
  PARCIAL: { rotulo: 'Paga parcialmente', sev: 'atencao' },
  PAGA: { rotulo: 'Paga', sev: 'disponivel' },
  EM_ATRASO: { rotulo: 'Em atraso', sev: 'critico' },
  CANCELADA: { rotulo: 'Cancelada', sev: 'inativo' },
}

/**
 * Faturamento.
 *
 * A tela é organizada em torno da conferência por exceção: de dezenas de itens
 * do ciclo, o painel lista apenas os que fugiram do padrão. O restante é
 * aprovado em lote. É o que transforma o fechamento de dias em horas.
 */
export function Faturamento() {
  const { pode } = useSessao()
  const { avisar } = useToast()
  const { situacao, dado } = useConsulta(() => api.faturas(), [])
  const [texto, setTexto] = useState('')
  const [recorte, setRecorte] = useState('')
  const [detalhe, setDetalhe] = useState<LinhaFatura | null>(null)

  const linhas = useMemo(() => (dado ? linhasFaturas() : []), [dado])
  const excecoes = useMemo(() => (dado ? excecoesFechamento() : []), [dado])
  const indicadores = api.baseSincrona().indicadores
  const compAtual = indicadores.serieReceita[indicadores.serieReceita.length - 1].competencia

  const emFechamento = linhas.filter((l) => l.fatura.competencia === compAtual)
  const totalCiclo = emFechamento.reduce((a, l) => a + l.fatura.valorLiquido, 0)
  const emAtraso = linhas.filter((l) => l.fatura.status === 'EM_ATRASO')
  const semExcecao = emFechamento.length - excecoes.length

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return linhas.filter((l) => {
      if (recorte === 'ciclo' && l.fatura.competencia !== compAtual) return false
      if (recorte === 'atraso' && l.fatura.status !== 'EM_ATRASO') return false
      if (recorte === 'aberto' && (l.fatura.status === 'PAGA' || l.fatura.status === 'CANCELADA')) return false
      if (t) {
        const alvo = `${l.fatura.numero} ${l.clienteNome} ${l.contratoNumero}`.toLowerCase()
        if (!alvo.includes(t)) return false
      }
      return true
    })
  }, [linhas, recorte, texto, compAtual])

  const colunas: Coluna<LinhaFatura>[] = [
    {
      chave: 'numero',
      titulo: 'Fatura',
      identificadora: true,
      ordenarPor: (l) => l.fatura.numero,
      celula: (l) => (
        <>
          <span className="dado">{l.fatura.numero}</span>
          <br />
          <span className="texto-atenuado dado">{l.contratoNumero}</span>
        </>
      ),
    },
    { chave: 'cliente', titulo: 'Cliente', ordenarPor: (l) => l.clienteNome, celula: (l) => l.clienteNome },
    {
      chave: 'competencia',
      titulo: 'Competência',
      ordenarPor: (l) => l.fatura.competencia,
      ocultarEmMobile: true,
      celula: (l) => <span className="dado">{l.fatura.competencia}</span>,
    },
    {
      chave: 'status',
      titulo: 'Situação',
      ordenarPor: (l) => l.fatura.status,
      celula: (l) => (
        <>
          <Chip severidade={STATUS[l.fatura.status].sev}>{STATUS[l.fatura.status].rotulo}</Chip>
          {l.fatura.diasAtraso > 0 && (
            <>
              <br />
              <span className="texto-atenuado">{l.fatura.diasAtraso} dias</span>
            </>
          )}
        </>
      ),
    },
    {
      chave: 'vencimento',
      titulo: 'Vencimento',
      ordenarPor: (l) => l.fatura.vencimento,
      ocultarEmMobile: true,
      celula: (l) => <span className="dado">{data(l.fatura.vencimento)}</span>,
    },
    {
      chave: 'valor',
      titulo: 'Valor líquido',
      numerico: true,
      ordenarPor: (l) => l.fatura.valorLiquido,
      celula: (l) => <span className="dado">{moeda(l.fatura.valorLiquido)}</span>,
    },
    {
      chave: 'acao',
      titulo: 'Memória',
      celula: (l) => (
        <Botao pequeno variante="sutil" onClick={() => setDetalhe(l)}>
          Ver cálculo
        </Botao>
      ),
    },
  ]

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Faturamento</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Nenhum valor é digitado. Cada linha vem de contrato, franquia contratada e contador de páginas do período.
          </p>
        </div>
        {pode('fatura:emitir') && (
          <Botao
            variante="primario"
            glifo="⇥"
            onClick={() =>
              avisar({
                tom: 'ok',
                titulo: `${semExcecao} itens aprovados em lote`,
                texto: `Restam ${excecoes.length} exceções para tratativa antes da emissão.`,
              })
            }
          >
            Aprovar {semExcecao} itens sem exceção
          </Botao>
        )}
      </div>

      {indicadores.pendenciasMedicao > 0 && (
        <Aviso
          tom="critico"
          titulo={`${indicadores.pendenciasMedicao} pendências de medição bloqueiam o fechamento de ${competenciaLonga(compAtual)}`}
          saidas={[
            'Solicitar leitura do contador ao técnico responsável',
            'Registrar a leitura manualmente com foto do painel',
            'Usar estimativa por média histórica — exige alçada e gera acerto no ciclo seguinte',
          ]}
        >
          <p>
            Itens com cobrança por franquia e excedente não fecham sem leitura do período. O restante do ciclo pode
            seguir normalmente.
          </p>
        </Aviso>
      )}

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica rotulo="Ciclo em fechamento" valor={moedaCompacta(totalCiclo)} contexto={`${emFechamento.length} faturas · ${moeda(totalCiclo)}`} />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Conferência por exceção" valor={String(excecoes.length)} contexto={`${semExcecao} seguiram o padrão`} />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Em atraso" valor={String(emAtraso.length)} contexto={moeda(emAtraso.reduce((a, l) => a + l.saldo, 0))} />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Inadimplência"
            valor={percentual(indicadores.inadimplencia)}
            variacao={`${indicadores.inadimplencia <= indicadores.inadimplenciaAnterior ? '−' : '+'}${Math.abs((indicadores.inadimplencia - indicadores.inadimplenciaAnterior) * 100).toFixed(1)} p.p.`}
            tendencia={indicadores.inadimplencia <= indicadores.inadimplenciaAnterior ? 'positiva' : 'negativa'}
            contexto="vencido sobre carteira aberta"
          />
        </Cartao>
      </div>

      {excecoes.length > 0 && (
        <Cartao comoRegiao titulo={`Itens que pedem conferência — ${competenciaLonga(compAtual)}`}>
          <Rolagem rotulo="Tabela de dados">
            <table>
              <caption className="so-leitor">Faturas da competência corrente sinalizadas para revisão</caption>
              <thead>
                <tr>
                  <th scope="col">Fatura</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Motivo do destaque</th>
                  <th scope="col" className="numerico">Valor</th>
                </tr>
              </thead>
              <tbody>
                {excecoes.map((e) => (
                  <tr key={e.fatura.id}>
                    <th scope="row" className="dado" style={{ fontWeight: 620 }}>{e.fatura.numero}</th>
                    <td>{e.clienteNome}</td>
                    <td>
                      <Chip severidade={e.severidade === 'critico' ? 'critico' : 'atencao'}>{e.motivo}</Chip>
                    </td>
                    <td className="numerico dado">{moeda(e.fatura.valorLiquido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Rolagem>
        </Cartao>
      )}

      {detalhe && (
        <Cartao
          comoRegiao
          titulo={`Memória de cálculo — fatura ${detalhe.fatura.numero}`}
          acessorio={
            <Botao pequeno variante="sutil" onClick={() => setDetalhe(null)}>
              Fechar
            </Botao>
          }
        >
          <p className="texto-secundario">
            {detalhe.clienteNome} · competência {detalhe.fatura.competencia} · contrato{' '}
            <span className="dado">{detalhe.contratoNumero}</span>
          </p>
          <Rolagem rotulo="Tabela de dados">
            <table>
              <caption>Composição do valor por equipamento</caption>
              <thead>
                <tr>
                  <th scope="col">Equipamento</th>
                  <th scope="col" className="numerico">Fixo</th>
                  <th scope="col" className="numerico">Franquia</th>
                  <th scope="col" className="numerico">Consumo</th>
                  <th scope="col" className="numerico">Excedente</th>
                  <th scope="col" className="numerico">Total</th>
                </tr>
              </thead>
              <tbody>
                {detalhe.fatura.itens.slice(0, 12).map((it) => (
                  <tr key={it.equipamentoPatrimonio}>
                    <th scope="row" style={{ fontWeight: 600 }}>
                      <span className="dado">{it.equipamentoPatrimonio}</span>
                      <br />
                      <span className="texto-atenuado">{it.descricao}</span>
                    </th>
                    <td className="numerico dado">{moeda(it.valorFixo)}</td>
                    <td className="numerico dado">
                      {it.franquiaMono ? inteiro(it.franquiaMono) : '—'}
                      {it.franquiaColor ? <span className="texto-atenuado"> +{inteiro(it.franquiaColor)} cor</span> : null}
                    </td>
                    <td className="numerico dado">
                      {it.consumoMono ? inteiro(it.consumoMono) : '—'}
                      {it.consumoColor ? <span className="texto-atenuado"> +{inteiro(it.consumoColor)} cor</span> : null}
                    </td>
                    <td className="numerico dado">
                      {it.excedenteMono + it.excedenteColor > 0
                        ? moeda(it.valorExcedenteMono + it.valorExcedenteColor)
                        : '—'}
                    </td>
                    <td className="numerico dado" style={{ fontWeight: 650 }}>{moeda(it.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" style={{ fontWeight: 700 }}>Valor líquido da fatura</th>
                  <td colSpan={4} />
                  <td className="numerico dado" style={{ fontWeight: 700 }}>{moeda(detalhe.fatura.valorLiquido)}</td>
                </tr>
              </tfoot>
            </table>
          </Rolagem>
          <p className="texto-atenuado">
            {detalhe.fatura.itens.length > 12
              ? `Exibindo 12 de ${detalhe.fatura.itens.length} itens. `
              : ''}
            O excedente é a diferença entre o contador do período e a franquia contratada, multiplicada pelo preço por
            página da cláusula comercial.
          </p>
        </Cartao>
      )}

      <Cartao>
        <div className="filtros">
          <div style={{ minWidth: 220 }}>
            <Entrada
              rotulo="Fatura, cliente ou contrato"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="ex.: 1-004 ou Meridiano"
            />
          </div>
          <Selecao
            rotulo="Recorte"
            value={recorte}
            onChange={(e) => setRecorte(e.target.value)}
            opcoes={[
              { valor: '', texto: 'Todas as competências' },
              { valor: 'ciclo', texto: 'Ciclo em fechamento' },
              { valor: 'aberto', texto: 'Em aberto' },
              { valor: 'atraso', texto: 'Em atraso' },
            ]}
          />
        </div>

        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando faturas">
            <Skeleton linhas={8} altura="22px" />
          </Carregando>
        ) : (
          <Tabela
            legenda="Faturas com competência, situação, vencimento e valor"
            colunas={colunas}
            itens={filtradas}
            chaveDe={(l) => l.fatura.id}
            ordemInicial={{ chave: 'vencimento', direcao: 'desc' }}
            vazio={{
              titulo: 'Nenhuma fatura com esses filtros',
              acao: (
                <Botao
                  onClick={() => {
                    setTexto('')
                    setRecorte('')
                  }}
                >
                  Limpar filtros
                </Botao>
              ),
            }}
          />
        )}
      </Cartao>
    </>
  )
}
