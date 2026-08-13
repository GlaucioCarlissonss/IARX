import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../dados/api'
import { agregadoPorRegiao, linhasChamados, linhasEstoque } from '../dados/consultas'
import { useConsulta } from '../lib/useConsulta'
import { inteiro, moeda, moedaCompacta, percentual, prazoRestante } from '../lib/formato'
import { HOJE } from '../dados/gerar'
import { Aviso, BarraMedida, Carregando, Cartao, Chip, Metrica, Skeleton } from '../componentes/ui/primitivos'
import { BarrasHorizontais, Sparkline } from '../componentes/ui/graficos'
import { Rolagem } from '../componentes/ui/Rolagem'
import { Mapa as MapaGeografico } from '../componentes/ui/Mapa'
import { regiaoPorId } from '../dados/catalogo'
import { useSessao } from '../lib/contexto'
import type { PontoMapa } from '../componentes/ui/Mapa'

/**
 * Painel do dia.
 *
 * A primeira dobra é exclusivamente exceção — o que exige ação hoje. Volume e
 * tendência ficam na tela de Resultado. Cada cartão de exceção é um atalho para
 * a lista já filtrada, o que elimina o passo "abrir a tela e filtrar".
 */
export function Inicio() {
  const navegar = useNavigate()
  const { pode } = useSessao()
  const { situacao, dado, erro, recarregar } = useConsulta(() => api.indicadores(), [])

  /**
   * Pontos do mapa do painel: clientes com o parque que têm em campo.
   *
   * Lido da base síncrona porque o cartão é secundário na dobra — pendurá-lo
   * numa segunda consulta assíncrona faria o painel inteiro esperar por ele.
   */
  const pontosMapa = useMemo<PontoMapa[]>(() => {
    const base = api.baseSincrona()
    const porCliente = new Map<string, number>()
    for (const e of base.equipamentos) {
      if (e.clienteId) porCliente.set(e.clienteId, (porCliente.get(e.clienteId) ?? 0) + 1)
    }
    return base.clientes.map((c) => {
      const praca = regiaoPorId.get(c.regiaoId)
      return {
        id: c.id,
        nome: c.nomeFantasia,
        detalhe: `${praca?.cidade ?? '—'}/${praca?.uf ?? '—'} · ${porCliente.get(c.id) ?? 0} ativo(s)`,
        lat: c.lat,
        lon: c.lon,
        peso: porCliente.get(c.id) ?? 0,
        tom:
          c.situacaoCredito === 'BLOQUEADO'
            ? 'critico'
            : c.situacaoCredito === 'OBSERVACAO'
              ? 'atencao'
              : 'normal',
      }
    })
  }, [dado])

  if (situacao === 'erro') {
    return (
      <Aviso tom="critico" titulo="Não foi possível carregar o painel">
        <p>{erro.mensagem}</p>
        <p style={{ marginTop: 'var(--e3)' }}>
          <button className="btn" onClick={recarregar}>
            Tentar novamente
          </button>
        </p>
      </Aviso>
    )
  }

  if (situacao === 'carregando') {
    return (
      <Carregando rotulo="Carregando indicadores do dia">
        <div className="grade grade--excecoes">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="cartao" key={i}>
              <Skeleton altura="30px" largura="52%" />
              <Skeleton linhas={2} />
            </div>
          ))}
        </div>
      </Carregando>
    )
  }

  const i = dado
  const chamados = linhasChamados()
  const estoque = linhasEstoque()
  const regioes = agregadoPorRegiao()

  const excecoes = [
    {
      n: i.chamadosEmRiscoSla,
      rotulo: 'chamados em risco de SLA',
      meta: 'menos de 4 h de prazo restante',
      sev: 'critico' as const,
      destino: '/chamados',
    },
    {
      n: i.equipamentosBloqueados,
      rotulo: 'equipamentos bloqueados',
      meta: 'preventiva vencida além da tolerância',
      sev: 'critico' as const,
      destino: '/parque?bloqueado=1',
    },
    {
      n: i.pendenciasMedicao,
      rotulo: 'pendências de medição',
      meta: 'bloqueiam o fechamento da competência',
      sev: 'critico' as const,
      destino: '/faturamento',
    },
    {
      n: i.pecasAbaixoMinimo,
      rotulo: 'peças abaixo do mínimo',
      meta: `${estoque.filter((e) => e.osImpactadas > 0).length} travando chamado em aberto`,
      sev: 'atencao' as const,
      destino: '/estoque',
    },
    {
      n: i.contratosVencendo,
      rotulo: 'contratos vencem em 90 dias',
      meta: 'sem renovação registrada',
      sev: 'atencao' as const,
      destino: '/contratos?situacao=vencendo',
    },
    {
      n: i.equipamentosManutencao,
      rotulo: 'equipamentos em manutenção',
      meta: `${percentual(1 - i.disponibilidade)} do parque indisponível`,
      sev: 'atencao' as const,
      destino: '/parque?estado=EM_MANUTENCAO',
    },
  ]

  const filaCritica = chamados.filter((c) => c.emRisco || c.estourado).slice(0, 6)
  const reposicao = estoque
    .filter((e) => e.situacao !== 'NORMAL')
    .sort((a, b) => b.osImpactadas - a.osImpactadas || a.cobertura - b.cobertura)
    .slice(0, 6)

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>O que exige ação hoje</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Esta tela mostra desvio, não volume. Cada cartão abre a lista já filtrada.
          </p>
        </div>
        <p className="texto-atenuado">Atualizado às {HOJE.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
      </div>

      <section aria-label="Exceções do dia" className="grade grade--excecoes">
        {excecoes.map((e) => (
          <button key={e.rotulo} className="excecao" data-sev={e.n === 0 ? 'ok' : e.sev} onClick={() => navegar(e.destino)}>
            <span className="excecao__numero">{e.n}</span>
            <span className="excecao__rotulo">{e.rotulo}</span>
            <span className="excecao__meta">{e.n === 0 ? 'nada pendente' : e.meta}</span>
          </button>
        ))}
      </section>

      {pode('mapa:ler') && (
        <Cartao
          comoRegiao
          titulo="Distribuição geográfica"
          acessorio={
            <button className="btn btn--sutil btn--pequeno" onClick={() => navegar('/mapa')}>
              Expandir
            </button>
          }
        >
          {/*
            Mapa de verdade dentro do cartão, e não uma imagem que abre o Google
            Maps em outra aba. Sair da aplicação para ver onde está o parque
            quebra o fluxo justamente quando a pessoa está decidindo de onde
            despachar um técnico — e a aba que abre não sabe nada dos filtros
            nem do estado de crédito de cada cliente.
          */}
          <MapaGeografico
            rotulo="Distribuição geográfica de clientes"
            pontos={pontosMapa}
            altura={300}
            aoSelecionar={() => navegar('/mapa')}
            rodape={
              <span className="mapa__contagem">
                <span>
                  <strong>{pontosMapa.length}</strong> localizações
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <strong>{inteiro(pontosMapa.reduce((s, p) => s + p.peso, 0))}</strong> ativos
                </span>
              </span>
            }
          />
        </Cartao>
      )}

      <div className="grade grade--2">
        <Cartao
          comoRegiao
          titulo="Fila técnica por risco de prazo"
          acessorio={
            <button className="btn btn--sutil btn--pequeno" onClick={() => navegar('/chamados')}>
              Ver todos
            </button>
          }
        >
          {filaCritica.length === 0 ? (
            <p className="texto-secundario">Nenhum chamado em risco de prazo. Fila sob controle.</p>
          ) : (
            <Rolagem rotulo="Tabela de dados">
              <table>
                <caption className="so-leitor">Chamados com menos de 4 horas de prazo restante</caption>
                <thead>
                  <tr>
                    <th scope="col">Chamado</th>
                    <th scope="col">Cliente</th>
                    <th scope="col">Prazo</th>
                    <th scope="col">Técnico</th>
                  </tr>
                </thead>
                <tbody>
                  {filaCritica.map((c) => {
                    const p = prazoRestante(c.ordem.prazoSolucaoEm, HOJE)
                    return (
                      <tr key={c.ordem.id}>
                        <th scope="row" className="dado" style={{ fontWeight: 620 }}>
                          {c.ordem.numero}
                        </th>
                        <td>{c.clienteNome ?? '—'}</td>
                        <td>
                          <Chip severidade={p.estourado ? 'critico' : 'atencao'}>{p.texto}</Chip>
                        </td>
                        <td>{c.tecnicoNome ?? <span className="texto-atenuado">não atribuído</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Rolagem>
          )}
        </Cartao>

        <Cartao
          comoRegiao
          titulo="Reposição urgente de suprimentos"
          acessorio={
            <button className="btn btn--sutil btn--pequeno" onClick={() => navegar('/estoque')}>
              Ver estoque
            </button>
          }
        >
          <Rolagem rotulo="Tabela de dados">
            <table>
              <caption className="so-leitor">Peças abaixo do mínimo ou no ponto de pedido</caption>
              <thead>
                <tr>
                  <th scope="col">Peça</th>
                  <th scope="col">Situação</th>
                  <th scope="col" className="numerico">
                    Saldo
                  </th>
                  <th scope="col" className="numerico">
                    Sugestão
                  </th>
                </tr>
              </thead>
              <tbody>
                {reposicao.map((r) => (
                  <tr key={r.peca.id}>
                    <th scope="row" style={{ fontWeight: 600 }}>
                      <span className="dado">{r.peca.codigo}</span>
                      <br />
                      <span className="texto-atenuado">{r.peca.descricao}</span>
                    </th>
                    <td>
                      <Chip severidade={r.situacao === 'PONTO_PEDIDO' ? 'atencao' : 'critico'}>
                        {r.situacao === 'ZERADO'
                          ? 'Zerado'
                          : r.situacao === 'ABAIXO_MINIMO'
                            ? 'Abaixo do mínimo'
                            : 'Ponto de pedido'}
                      </Chip>
                      {r.osImpactadas > 0 && (
                        <span className="texto-atenuado"> · {r.osImpactadas} chamado(s) parado(s)</span>
                      )}
                    </td>
                    <td className="numerico dado">{inteiro(r.peca.saldo)}</td>
                    <td className="numerico dado">{inteiro(r.sugestaoCompra)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Rolagem>
        </Cartao>

        <Cartao comoRegiao titulo="Ocupação do parque">
          <Metrica
            rotulo="Equipamentos em contrato ativo"
            valor={percentual(i.taxaOcupacao)}
            variacao={`${i.taxaOcupacao >= i.taxaOcupacaoAnterior ? '+' : '−'}${Math.abs((i.taxaOcupacao - i.taxaOcupacaoAnterior) * 100).toFixed(1)} p.p.`}
            tendencia={i.taxaOcupacao >= i.taxaOcupacaoAnterior ? 'positiva' : 'negativa'}
            contexto={`${inteiro(i.equipamentosLocados)} de ${inteiro(i.equipamentosAtivos)} ativos · meta 80%`}
          >
            <div style={{ marginTop: 'var(--e2)' }}>
              <BarraMedida
                valor={i.taxaOcupacao}
                rotuloAcessivel={`Ocupação em ${percentual(i.taxaOcupacao)}, meta de 80%`}
              />
            </div>
          </Metrica>

          <div className="grade grade--3" style={{ marginTop: 'var(--e3)' }}>
            <Metrica rotulo="Disponíveis" valor={inteiro(i.equipamentosDisponiveis)} contexto="prontos para instalar" />
            <Metrica rotulo="Em manutenção" valor={inteiro(i.equipamentosManutencao)} contexto="fora de operação" />
            <Metrica rotulo="Bloqueados" valor={inteiro(i.equipamentosBloqueados)} contexto="não alocáveis" />
          </div>
        </Cartao>

        <Cartao comoRegiao titulo="Volume de impressão do mês">
          <Metrica
            rotulo="Páginas medidas na competência"
            valor={inteiro(i.paginasMes)}
            contexto="mono e color somadas, todo o parque"
          />
          <Sparkline serie={i.seriePaginas} rotulo="Páginas impressas por mês" cor="var(--cor-serie-2)" altura={52} />
          <p className="texto-atenuado">
            A queda de dezembro e janeiro é sazonal: recesso reduz impressão em quase 40% na base instalada.
          </p>
        </Cartao>

        <Cartao comoRegiao titulo="Parque por região">
          <BarrasHorizontais
            titulo="Equipamentos instalados por região"
            itens={regioes.slice(0, 6).map((r) => ({
              rotulo: r.regiao.nome,
              valor: r.total,
              severidade: r.criticos > 0 ? ('atencao' as const) : ('uso' as const),
            }))}
            formatarValor={(v) => `${inteiro(v)} un`}
          />
          <p className="texto-atenuado">
            Regiões com equipamento bloqueado aparecem em âmbar. Abra o parque para ver quais.
          </p>
        </Cartao>

        <Cartao comoRegiao titulo="Recebimento e cobrança">
          <Metrica
            rotulo="Inadimplência da carteira"
            valor={percentual(i.inadimplencia)}
            variacao={`${i.inadimplencia <= i.inadimplenciaAnterior ? '−' : '+'}${Math.abs((i.inadimplencia - i.inadimplenciaAnterior) * 100).toFixed(1)} p.p.`}
            tendencia={i.inadimplencia <= i.inadimplenciaAnterior ? 'positiva' : 'negativa'}
            contexto="valores vencidos sobre o total em aberto"
          />
          <div className="grade grade--2" style={{ marginTop: 'var(--e2)' }}>
            <Metrica rotulo="Receita da competência" valor={moedaCompacta(i.receitaMes)} contexto={moeda(i.receitaMes)} />
            <Metrica rotulo="Receita recorrente" valor={moedaCompacta(i.mrr)} contexto="base contratada mensal" />
          </div>
        </Cartao>
      </div>
    </>
  )
}
