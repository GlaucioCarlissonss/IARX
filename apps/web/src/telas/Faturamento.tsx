import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import { excecoesFechamento, linhasCobranca, pendenciasDeMedicao } from '../dados/consultas'
import type { LinhaCobranca } from '../dados/consultas'
import { useConsulta } from '../lib/useConsulta'
import { useSessao, useToast } from '../lib/contexto'
import { competenciaLonga, data, inteiro, moeda, moedaCompacta, percentual } from '../lib/formato'
import { Botao, Carregando, Cartao, Chip, ErroConsulta, Metrica, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { Busca, Filtros } from '../componentes/ui/filtros'
import { Rolagem } from '../componentes/ui/Rolagem'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'
import type { Equipamento, StatusReceber } from '../dados/tipos'
import { FormMedicao } from '../componentes/formularios/FormMedicao'

type Severidade = 'disponivel' | 'uso' | 'atencao' | 'critico' | 'inativo'

/**
 * A situação mostrada é a do **título**, e não um estado próprio da tela.
 *
 * Havia um enum de fatura aqui — `PREVISTA`, `EMITIDA`, `EM_ATRASO`… — paralelo
 * ao do título, e os dois precisavam ser mantidos em correspondência à mão.
 * Sobrou um: `StatusReceber`.
 *
 * `EM_ATRASO` não está na lista, e é de propósito: atraso é vencimento no
 * passado com saldo em aberto, calculado por quem exibe. Como estado guardado,
 * estaria errado no dia seguinte ao vencimento até algum job noturno passar.
 */
const STATUS: Record<StatusReceber, { rotulo: string; sev: Severidade }> = {
  PENDENTE_APROVACAO: { rotulo: 'Em aprovação', sev: 'atencao' },
  PENDENTE: { rotulo: 'Pendente', sev: 'atencao' },
  APROVADO: { rotulo: 'Emitida', sev: 'uso' },
  RECEBIDO_PARCIAL: { rotulo: 'Paga parcialmente', sev: 'atencao' },
  RECEBIDO: { rotulo: 'Paga', sev: 'disponivel' },
  CANCELADO: { rotulo: 'Cancelada', sev: 'inativo' },
  EM_DISPUTA: { rotulo: 'Em disputa', sev: 'critico' },
  BAIXADO: { rotulo: 'Baixada sem recebimento', sev: 'inativo' },
}

/** Medida e ainda não cobrada: é o que "competência aberta" quer dizer. */
const EM_FECHAMENTO = { rotulo: 'Em fechamento', sev: 'atencao' as Severidade }

const situacaoDe = (l: LinhaCobranca) => (l.titulo ? STATUS[l.titulo.status] : EM_FECHAMENTO)

/**
 * Como a linha se identifica.
 *
 * Cobrança gerada tem número; medição da competência aberta não tem — e a
 * ausência é a informação, não um dado faltando. O número de fatura aparecia
 * aqui para todas as linhas porque o modelo antigo o inventava antes de a
 * cobrança existir.
 */
const identificadorDe = (l: LinhaCobranca): string =>
  l.titulo ? String(l.titulo.numeroTitulo).padStart(5, '0') : 'a faturar'

const diasDeAtraso = (l: LinhaCobranca): number =>
  l.atrasada && l.titulo
    ? Math.max(1, Math.round((Date.now() - new Date(`${l.titulo.dataVencimento}T00:00:00Z`).getTime()) / 86_400_000))
    : 0

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
  const { situacao, dado, erro, recarregar } = useConsulta(() => api.medicoes(), [])
  const [texto, setTexto] = useState('')
  const [recorte, setRecorte] = useState('')
  const [detalhe, setDetalhe] = useState<LinhaCobranca | null>(null)
  const [medicao, setMedicao] = useState<{ equipamento: Equipamento; competencia: string } | null>(null)

  const linhas = useMemo(() => (dado ? linhasCobranca() : []), [dado])
  const excecoes = useMemo(() => (dado ? excecoesFechamento() : []), [dado])
  const pendencias = useMemo(() => (dado ? pendenciasDeMedicao() : []), [dado])
  const indicadores = api.baseSincrona().indicadores
  const compAtual = indicadores.serieReceita[indicadores.serieReceita.length - 1].competencia

  const emFechamento = linhas.filter((l) => l.medicao.competencia === compAtual)
  const totalCiclo = emFechamento.reduce((a, l) => a + l.medicao.valorLiquido, 0)
  const emAtraso = linhas.filter((l) => l.atrasada)
  const semExcecao = emFechamento.length - excecoes.length

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return linhas.filter((l) => {
      if (recorte === 'ciclo' && l.medicao.competencia !== compAtual) return false
      if (recorte === 'atraso' && !l.atrasada) return false
      if (recorte === 'aberto' && (l.titulo?.status === 'RECEBIDO' || l.titulo?.status === 'CANCELADO'))
        return false
      if (t) {
        const alvo = `${identificadorDe(l)} ${l.clienteNome} ${l.contratoNumero}`.toLowerCase()
        if (!alvo.includes(t)) return false
      }
      return true
    })
  }, [linhas, recorte, texto, compAtual])

  const colunas: Coluna<LinhaCobranca>[] = [
    {
      chave: 'numero',
      titulo: 'Cobrança',
      identificadora: true,
      ordenarPor: (l) => identificadorDe(l),
      celula: (l) => (
        <>
          <span className={l.titulo ? 'dado' : 'texto-atenuado'}>{identificadorDe(l)}</span>
          <br />
          <span className="texto-atenuado dado">{l.contratoNumero}</span>
        </>
      ),
    },
    { chave: 'cliente', titulo: 'Cliente', ordenarPor: (l) => l.clienteNome, celula: (l) => l.clienteNome },
    {
      chave: 'competencia',
      titulo: 'Competência',
      ordenarPor: (l) => l.medicao.competencia,
      ocultarEmMobile: true,
      celula: (l) => <span className="dado">{l.medicao.competencia}</span>,
    },
    {
      chave: 'status',
      titulo: 'Situação',
      ordenarPor: (l) => situacaoDe(l).rotulo,
      celula: (l) => (
        <>
          <Chip severidade={situacaoDe(l).sev}>{situacaoDe(l).rotulo}</Chip>
          {diasDeAtraso(l) > 0 && (
            <>
              <br />
              <span className="texto-atenuado">{diasDeAtraso(l)} dias em atraso</span>
            </>
          )}
        </>
      ),
    },
    {
      chave: 'vencimento',
      titulo: 'Vencimento',
      ordenarPor: (l) => l.titulo?.dataVencimento ?? '',
      ocultarEmMobile: true,
      celula: (l) =>
        l.titulo ? (
          <span className="dado">{data(l.titulo.dataVencimento)}</span>
        ) : (
          <span className="texto-atenuado">no fechamento</span>
        ),
    },
    {
      chave: 'valor',
      titulo: 'Valor líquido',
      numerico: true,
      ordenarPor: (l) => l.medicao.valorLiquido,
      celula: (l) => <span className="dado">{moeda(l.medicao.valorLiquido)}</span>,
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

  /*
   * Falha de carga é dita, e não disfarçada de lista vazia.
   *
   * Sem isto a tela renderizava `dado ?? []` e a tabela anunciava
   * "nenhum registro" — uma resposta errada apresentada como certa. Quem
   * lê conclui que não há o que ver e vai embora, em vez de tentar de novo.
   */
  if (situacao === 'erro') {
    return (
      <ErroConsulta titulo="Não foi possível carregar o faturamento" erro={erro} aoTentarNovamente={recarregar} />
    )
  }

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

      {pendencias.length > 0 && (
        <Cartao
          comoRegiao
          titulo={`${pendencias.length} pendências de medição bloqueiam o fechamento de ${competenciaLonga(compAtual)}`}
        >
          <p className="medida-leitura">
            Itens com cobrança por franquia e excedente não fecham sem leitura do período. Cada pendência é tratada
            individualmente — em lote, a estimativa vira o caminho fácil e a coleta de leitura acaba.
          </p>
          <Tabela
            legenda="Equipamentos locados sem leitura de contador na competência em fechamento"
            itens={pendencias}
            chaveDe={(p) => p.equipamento.id}
            ordemInicial={{ chave: 'semLeitura', direcao: 'desc' }}
            colunas={[
              {
                chave: 'patrimonio',
                titulo: 'Patrimônio',
                identificadora: true,
                ordenarPor: (p) => p.equipamento.patrimonio,
                celula: (p) => <span className="dado">{p.equipamento.patrimonio}</span>,
              },
              {
                chave: 'cliente',
                titulo: 'Cliente',
                ordenarPor: (p) => p.clienteNome,
                celula: (p) => p.clienteNome,
              },
              {
                chave: 'semLeitura',
                titulo: 'Sem leitura há',
                numerico: true,
                ordenarPor: (p) => p.mesesSemLeitura,
                celula: (p) => (
                  <Chip severidade={p.mesesSemLeitura > 1 ? 'critico' : 'atencao'}>
                    {p.mesesSemLeitura} {p.mesesSemLeitura === 1 ? 'mês' : 'meses'}
                  </Chip>
                ),
              },
              {
                chave: 'media',
                titulo: 'Média histórica',
                numerico: true,
                ocultarEmMobile: true,
                ordenarPor: (p) => p.mediaMono,
                celula: (p) => <span className="dado">{inteiro(p.mediaMono)} pág</span>,
              },
              {
                chave: 'acao',
                titulo: 'Ação',
                celula: (p) =>
                  pode('prefatura:aprovar') ? (
                    <Botao
                      pequeno
                      variante="primario"
                      onClick={() => setMedicao({ equipamento: p.equipamento, competencia: p.competencia })}
                    >
                      Tratar
                      <span className="so-leitor"> medição do patrimônio {p.equipamento.patrimonio}</span>
                    </Botao>
                  ) : (
                    <span className="texto-atenuado">sem permissão</span>
                  ),
              },
            ]}
          />
        </Cartao>
      )}

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica rotulo="Ciclo em fechamento" valor={moedaCompacta(totalCiclo)} contexto={`${emFechamento.length} contratos medidos · ${moeda(totalCiclo)}`} />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Conferência por exceção" valor={String(excecoes.length)} contexto={`${semExcecao} seguiram o padrão`} />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Em atraso" valor={String(emAtraso.length)} contexto={moeda(emAtraso.reduce((a, l) => a + (l.saldo ?? 0), 0))} />
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
          <Tabela
            legenda="Medições da competência corrente sinalizadas para revisão"
            itens={excecoes}
            chaveDe={(e) => e.medicao.id}
            colunas={[
              {
                chave: 'contrato',
                titulo: 'Contrato',
                identificadora: true,
                ordenarPor: (e) => e.contratoNumero,
                celula: (e) => <span className="dado">{e.contratoNumero}</span>,
              },
              {
                chave: 'cliente',
                titulo: 'Cliente',
                ordenarPor: (e) => e.clienteNome,
                celula: (e) => e.clienteNome,
              },
              {
                chave: 'motivo',
                titulo: 'Motivo do destaque',
                ordenarPor: (e) => e.motivo,
                celula: (e) => (
                  <Chip severidade={e.severidade === 'critico' ? 'critico' : 'atencao'}>{e.motivo}</Chip>
                ),
              },
              {
                chave: 'valor',
                titulo: 'Valor',
                numerico: true,
                ordenarPor: (e) => e.medicao.valorLiquido,
                celula: (e) => <span className="dado">{moeda(e.medicao.valorLiquido)}</span>,
              },
            ]}
          />
        </Cartao>
      )}

      {detalhe && (
        <Cartao
          comoRegiao
          titulo={`Memória de cálculo — contrato ${detalhe.contratoNumero}`}
          acessorio={
            <Botao pequeno variante="sutil" onClick={() => setDetalhe(null)}>
              Fechar
            </Botao>
          }
        >
          <p className="texto-secundario">
            {detalhe.clienteNome} · competência {detalhe.medicao.competencia} ·{' '}
            {detalhe.titulo ? (
              <>
                cobrança <span className="dado">{identificadorDe(detalhe)}</span>
              </>
            ) : (
              'ainda não faturada'
            )}
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
                {detalhe.medicao.itens.slice(0, 12).map((it) => (
                  <tr key={it.equipamentoPatrimonio}>
                    <th scope="row" className="peso-rotulo">
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
                    <td className="numerico dado peso-destaque">{moeda(it.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="peso-total">Valor líquido da competência</th>
                  <td colSpan={4} />
                  <td className="numerico dado peso-total">{moeda(detalhe.medicao.valorLiquido)}</td>
                </tr>
              </tfoot>
            </table>
          </Rolagem>
          <p className="texto-atenuado">
            {detalhe.medicao.itens.length > 12
              ? `Exibindo 12 de ${detalhe.medicao.itens.length} itens. `
              : ''}
            O excedente é a diferença entre o contador do período e a franquia contratada, multiplicada pelo preço por
            página da cláusula comercial.
          </p>
        </Cartao>
      )}

      <Cartao>
        <Filtros>
          <div className="campo-busca">
            <Busca
              rotulo="Fatura, cliente ou contrato"
              valor={texto}
              aoMudar={setTexto}
              exemplo="ex.: 00042 ou Meridiano"
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
        </Filtros>

        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando o ciclo de faturamento">
            <Skeleton linhas={8} altura="22px" />
          </Carregando>
        ) : (
          <Tabela
            legenda="Faturas com competência, situação, vencimento e valor"
            colunas={colunas}
            itens={filtradas}
            chaveDe={(l) => l.medicao.id}
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

      {medicao && (
        <FormMedicao
          equipamento={medicao.equipamento}
          competencia={medicao.competencia}
          aoFechar={() => setMedicao(null)}
        />
      )}
    </>
  )
}
