import { useMemo, useRef, useState } from 'react'
import { api } from '../dados/api'
import { regiaoPorId } from '../dados/catalogo'
import { distanciaKm } from '../dados/geo'
import { MIN_CARACTERES, buscarEndereco } from '../dados/geocodificacao'
import { useConsulta } from '../lib/useConsulta'
import { useSessao } from '../lib/contexto'
import { inteiro, moeda } from '../lib/formato'
import { Aviso, Botao, Carregando, Cartao, Chip, Entrada, Metrica, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { Mapa as MapaGeografico } from '../componentes/ui/Mapa'
import { Rolagem } from '../componentes/ui/Rolagem'
import type { AlvoMapa, PontoMapa } from '../componentes/ui/Mapa'
import type { ResultadoEndereco } from '../dados/geocodificacao'
import type { Cliente, Equipamento } from '../dados/tipos'

/**
 * Distribuição geográfica do parque.
 *
 * O mapa responde a três perguntas que nenhuma tabela responde bem: onde o
 * parque está concentrado, quanto tem em cada praça, e qual filial está mais
 * perto de cada cliente — a última decide roteiro de técnico e prazo de SLA.
 *
 * Toda informação do mapa existe também em tabela, logo abaixo. Não é
 * redundância: é a regra que a proposta segue em todo gráfico. Quem usa leitor
 * de tela, quem exporta para planilha e quem precisa somar uma coluna recebem o
 * mesmo dado, e nada existe só na forma visual.
 */

interface Local {
  cliente: Cliente
  equipamentos: Equipamento[]
  receita12m: number
  filialMaisProxima: { nome: string; km: number } | null
}

export function Mapa() {
  const { pode } = useSessao()
  const { situacao, dado, recarregar } = useConsulta(() => api.clientes(), [])
  const [texto, setTexto] = useState('')
  const [recorte, setRecorte] = useState('')
  const [calor, setCalor] = useState(false)
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [aba, setAba] = useState<'mapa' | 'analises'>('mapa')

  /* ------------------------------------------------------ busca de endereço */

  const [enderecos, setEnderecos] = useState<ResultadoEndereco[] | null>(null)
  const [buscandoEndereco, setBuscandoEndereco] = useState(false)
  const [erroEndereco, setErroEndereco] = useState<string | null>(null)
  const [alvo, setAlvo] = useState<AlvoMapa | null>(null)
  const [gravacao, setGravacao] = useState<string | null>(null)
  const abortarRef = useRef<AbortController | null>(null)

  const base = api.baseSincrona()

  const locais = useMemo<Local[]>(() => {
    if (!dado) return []
    const porCliente = new Map<string, Equipamento[]>()
    for (const e of base.equipamentos) {
      if (!e.clienteId) continue
      const atual = porCliente.get(e.clienteId)
      if (atual) atual.push(e)
      else porCliente.set(e.clienteId, [e])
    }

    return dado.map((cliente) => {
      const equipamentos = porCliente.get(cliente.id) ?? []

      // A filial mais próxima é calculada por haversine sobre as coordenadas
      // reais, não pela filial de cadastro. As duas divergem com frequência —
      // cliente atendido por São Paulo que fica mais perto de Campinas — e é
      // essa divergência que custa hora de deslocamento em cada chamado.
      let filialMaisProxima: Local['filialMaisProxima'] = null
      for (const f of base.filiais) {
        const praca = regiaoPorId.get(f.regiaoId)
        if (!praca) continue
        const km = distanciaKm(cliente, praca)
        if (!filialMaisProxima || km < filialMaisProxima.km) {
          filialMaisProxima = { nome: f.nome, km }
        }
      }

      return {
        cliente,
        equipamentos,
        receita12m: equipamentos.reduce((s, e) => s + e.receita12m, 0),
        filialMaisProxima,
      }
    })
  }, [dado, base])

  const filtrados = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return locais.filter((l) => {
      const praca = regiaoPorId.get(l.cliente.regiaoId)
      if (recorte === 'com-parque' && l.equipamentos.length === 0) return false
      if (recorte === 'sem-parque' && l.equipamentos.length > 0) return false
      if (recorte === 'inadimplente' && l.cliente.situacaoCredito === 'LIBERADO') return false
      if (recorte.startsWith('uf:') && praca?.uf !== recorte.slice(3)) return false
      if (t) {
        const campos = `${l.cliente.razaoSocial} ${l.cliente.nomeFantasia} ${praca?.cidade ?? ''} ${praca?.uf ?? ''}`
        if (!campos.toLowerCase().includes(t)) return false
      }
      return true
    })
  }, [locais, texto, recorte])

  const pontos = useMemo<PontoMapa[]>(
    () =>
      filtrados.map((l) => {
        const praca = regiaoPorId.get(l.cliente.regiaoId)
        return {
          id: l.cliente.id,
          nome: l.cliente.nomeFantasia,
          detalhe: `${praca?.cidade ?? '—'}/${praca?.uf ?? '—'} · ${l.equipamentos.length} ativo(s)`,
          lat: l.cliente.lat,
          lon: l.cliente.lon,
          peso: l.equipamentos.length,
          tom:
            l.cliente.situacaoCredito === 'BLOQUEADO'
              ? 'critico'
              : l.cliente.situacaoCredito === 'OBSERVACAO'
                ? 'atencao'
                : 'normal',
        }
      }),
    [filtrados],
  )

  const ufs = useMemo(() => {
    const conjunto = new Set<string>()
    for (const l of locais) {
      const praca = regiaoPorId.get(l.cliente.regiaoId)
      if (praca) conjunto.add(praca.uf)
    }
    return [...conjunto].sort()
  }, [locais])

  const totalAtivos = filtrados.reduce((s, l) => s + l.equipamentos.length, 0)
  const comParque = filtrados.filter((l) => l.equipamentos.length > 0).length
  const media = filtrados.length === 0 ? 0 : totalAtivos / filtrados.length
  /*
   * O cliente escolhido é procurado em `locais`, não em `filtrados`.
   *
   * Com `filtrados`, a seleção evaporava assim que o filtro deixava de incluí-la
   * — e é exatamente o que acontece no fluxo da busca de endereço: escolher o
   * cliente, digitar o endereço para localizá-lo e ver o cliente sumir junto
   * com a ação de gravar a coordenada nele.
   */
  const escolhido = locais.find((l) => l.cliente.id === selecionado) ?? null

  /** Concentração por praça — a leitura que o mapa mostra e a tabela prova. */
  const porPraca = useMemo(() => {
    const mapa = new Map<string, { cidade: string; uf: string; clientes: number; ativos: number; receita: number }>()
    for (const l of filtrados) {
      const praca = regiaoPorId.get(l.cliente.regiaoId)
      if (!praca) continue
      const atual = mapa.get(praca.id) ?? { cidade: praca.cidade, uf: praca.uf, clientes: 0, ativos: 0, receita: 0 }
      atual.clientes += 1
      atual.ativos += l.equipamentos.length
      atual.receita += l.receita12m
      mapa.set(praca.id, atual)
    }
    return [...mapa.values()].sort((a, b) => b.ativos - a.ativos || a.cidade.localeCompare(b.cidade))
  }, [filtrados])

  /**
   * Busca o termo digitado como endereço.
   *
   * Ação explícita, e não busca a cada tecla. Três razões, na ordem em que
   * pesam: o filtro local já responde instantaneamente e resolve o caso comum;
   * a política de uso do serviço público pede parcimônia; e requisição que sai
   * sozinha do navegador sem o usuário pedir é uma surpresa desagradável numa
   * ferramenta de trabalho.
   */
  async function buscarComoEndereco() {
    const termo = texto.trim()
    if (termo.length < MIN_CARACTERES) return

    // Uma busca em voo por vez: a anterior perdeu o valor no instante em que
    // esta começou, e deixá-la correndo só arrisca ela responder por último.
    abortarRef.current?.abort()
    const controle = new AbortController()
    abortarRef.current = controle

    setBuscandoEndereco(true)
    setErroEndereco(null)
    setGravacao(null)
    try {
      setEnderecos(await buscarEndereco(termo, controle.signal))
    } catch (e) {
      if (controle.signal.aborted) return
      setEnderecos(null)
      setErroEndereco(
        'Não foi possível consultar o serviço de endereços agora. A busca por cliente, cidade e UF continua funcionando.',
      )
    } finally {
      if (!controle.signal.aborted) setBuscandoEndereco(false)
    }
  }

  function limparBuscaEndereco() {
    abortarRef.current?.abort()
    setEnderecos(null)
    setErroEndereco(null)
    setAlvo(null)
    setGravacao(null)
  }

  /** Grava a coordenada do alfinete no cadastro do cliente selecionado. */
  async function usarComoLocalizacao(cliente: Cliente) {
    if (!alvo) return
    const r = await api.definirLocalizacaoCliente(cliente.id, {
      lat: alvo.lat,
      lon: alvo.lon,
      precisao: 'GEOCODIFICADO',
      fonte: `Nominatim · ${alvo.rotulo}`,
    })
    if (r.ok) {
      setGravacao(`Localização de ${cliente.nomeFantasia} atualizada.`)
      setAlvo(null)
      setEnderecos(null)
      recarregar()
    } else {
      setErroEndereco(r.erro.mensagem)
    }
  }

  function exportar() {
    // Ponto e vírgula, e não vírgula: é o separador que o Excel em pt-BR
    // reconhece sem passar pelo assistente de importação. BOM pelo mesmo
    // motivo — sem ele, acento vira caractere trocado.
    const linhas = [
      ['Cliente', 'Cidade', 'UF', 'Latitude', 'Longitude', 'Ativos', 'Receita 12m', 'Filial mais próxima', 'Distância (km)'],
      ...filtrados.map((l) => {
        const praca = regiaoPorId.get(l.cliente.regiaoId)
        return [
          l.cliente.razaoSocial,
          praca?.cidade ?? '',
          praca?.uf ?? '',
          String(l.cliente.lat),
          String(l.cliente.lon),
          String(l.equipamentos.length),
          l.receita12m.toFixed(2).replace('.', ','),
          l.filialMaisProxima?.nome ?? '',
          l.filialMaisProxima ? l.filialMaisProxima.km.toFixed(1).replace('.', ',') : '',
        ]
      }),
    ]
    const csv = '﻿' + linhas.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'distribuicao-geografica.csv'
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Mapa de distribuição</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Onde o parque está e o quanto está concentrado. A filial mais próxima é calculada por distância real —
            nem sempre é a filial de cadastro, e a diferença aparece em cada deslocamento de técnico.
          </p>
        </div>
        <Botao glifo="⇩" onClick={exportar} disabled={filtrados.length === 0}>
          Exportar CSV
        </Botao>
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica rotulo="Localizações" valor={String(filtrados.length)} contexto={`de ${locais.length} clientes`} />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Com parque instalado" valor={String(comParque)} contexto="clientes com ativo em campo" />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Ativos mapeados" valor={inteiro(totalAtivos)} contexto="equipamentos locados" />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Média por cliente" valor={media.toFixed(1)} contexto="ativos por localização" />
        </Cartao>
      </div>

      <div className="abas" role="tablist" aria-label="Visões do mapa">
        <button
          role="tab"
          type="button"
          aria-selected={aba === 'mapa'}
          aria-controls="painel-mapa"
          id="aba-mapa"
          onClick={() => setAba('mapa')}
        >
          <span aria-hidden="true">◉</span> Mapa
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={aba === 'analises'}
          aria-controls="painel-analises"
          id="aba-analises"
          onClick={() => setAba('analises')}
        >
          <span aria-hidden="true">▥</span> Análises
        </button>
      </div>

      {aba === 'mapa' ? (
        <div id="painel-mapa" role="tabpanel" aria-labelledby="aba-mapa" className="mapa-painel">
          <Cartao>
            {situacao === 'carregando' ? (
              <Carregando rotulo="Carregando o mapa">
                <Skeleton linhas={10} altura="30px" />
              </Carregando>
            ) : (
              <MapaGeografico
                rotulo="Distribuição geográfica de clientes e equipamentos"
                pontos={pontos}
                selecionado={selecionado}
                alvo={alvo}
                aoSelecionar={(p) => setSelecionado(p.id)}
                calor={calor}
                altura={520}
                sobreposicao={
                  <>
                    <div style={{ minWidth: 220, flex: 1 }}>
                      <Entrada
                        rotulo="Buscar cliente, cidade ou UF"
                        rotuloOculto
                        type="search"
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                        placeholder="Buscar cliente, cidade ou UF…"
                      />
                    </div>
                    <Selecao
                      rotulo="Recorte"
                      rotuloOculto
                      value={recorte}
                      onChange={(e) => setRecorte(e.target.value)}
                      opcoes={[
                        { valor: '', texto: 'Todos os clientes' },
                        { valor: 'com-parque', texto: 'Com parque instalado' },
                        { valor: 'sem-parque', texto: 'Sem ativo em campo' },
                        { valor: 'inadimplente', texto: 'Crédito em observação ou bloqueado' },
                        ...ufs.map((uf) => ({ valor: `uf:${uf}`, texto: `Estado — ${uf}` })),
                      ]}
                    />
                    <Botao
                      pequeno
                      variante={calor ? 'primario' : 'secundario'}
                      aria-pressed={calor}
                      onClick={() => setCalor((c) => !c)}
                    >
                      Mapa de calor
                    </Botao>
                  </>
                }
                rodape={
                  <span className="mapa__contagem">
                    <span>
                      <strong>{filtrados.length}</strong> localizações
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      <strong>{inteiro(totalAtivos)}</strong> ativos
                    </span>
                  </span>
                }
              />
            )}
          </Cartao>

          <Cartao titulo={`Localizações (${filtrados.length})`}>
            {escolhido && (
              <div className="aviso aviso--info" role="status" style={{ marginBottom: 'var(--e3)' }}>
                <span aria-hidden="true">◉</span>
                <div className="pilha g1">
                  <p className="aviso__titulo">{escolhido.cliente.razaoSocial}</p>
                  <p className="texto-atenuado">
                    {escolhido.equipamentos.length} ativo(s) · {moeda(escolhido.receita12m)} em 12 meses
                    {escolhido.filialMaisProxima &&
                      ` · ${escolhido.filialMaisProxima.nome} a ${escolhido.filialMaisProxima.km.toFixed(0)} km`}
                  </p>
                </div>
              </div>
            )}

            {/*
              Busca de endereço, como acréscimo à busca local — nunca no lugar
              dela. O filtro por cliente, cidade e UF continua respondendo na
              hora e sem rede; isto aqui resolve os dois casos que ele não
              cobre: chegar a um lugar que ainda não é cliente, e descobrir a
              coordenada de um cliente cadastrado sem ela, que por isso não
              aparece no mapa.
            */}
            <div className="mapa-endereco">
              {texto.trim().length >= MIN_CARACTERES && (
                <p className="linha entre g2">
                  <span className="texto-atenuado">Não é um cliente cadastrado?</span>
                  <Botao pequeno onClick={buscarComoEndereco} disabled={buscandoEndereco}>
                    {buscandoEndereco ? 'Buscando…' : 'Buscar como endereço'}
                  </Botao>
                </p>
              )}

              {erroEndereco && (
                <Aviso tom="atencao" titulo="Não deu para consultar o serviço de endereços">
                  {erroEndereco}
                </Aviso>
              )}

              {gravacao && (
                <Aviso tom="ok" titulo="Coordenada gravada">
                  {gravacao} A origem fica registrada como geocodificação, para quem revisar depois saber de onde
                  ela veio.
                </Aviso>
              )}

              {enderecos && enderecos.length === 0 && (
                <p className="texto-secundario" role="status">
                  Nenhum endereço encontrado para “{texto.trim()}”.
                </p>
              )}

              {enderecos && enderecos.length > 0 && (
                <>
                  <p className="texto-atenuado" role="status">
                    {enderecos.length} endereço(s) encontrado(s). Escolher um leva o mapa até lá.
                  </p>
                  <ul className="mapa-lista mapa-lista--endereco" aria-label="Endereços encontrados">
                    {enderecos.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          aria-current={alvo?.chave === e.id}
                          onClick={() =>
                            setAlvo({ chave: e.id, rotulo: e.rotulo, lat: e.lat, lon: e.lon, caixa: e.caixa })
                          }
                        >
                          <span className="mapa-lista__nome">{e.rotulo}</span>
                          <span className="mapa-lista__local">
                            {e.lat.toFixed(5)}, {e.lon.toFixed(5)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {alvo && (
                <div className="aviso aviso--info">
                  <span aria-hidden="true">⚑</span>
                  <div className="pilha g2 crescer">
                    <p className="aviso__titulo">{alvo.rotulo}</p>
                    {escolhido ? (
                      <p className="texto-atenuado">
                        Gravar esta coordenada como sede de {escolhido.cliente.nomeFantasia} substitui a atual.
                      </p>
                    ) : (
                      <p className="texto-atenuado">
                        Selecione um cliente na lista abaixo para poder usar esta coordenada como a sede dele.
                      </p>
                    )}
                    <span className="linha g2">
                      {escolhido && (
                        <Botao pequeno variante="primario" onClick={() => usarComoLocalizacao(escolhido.cliente)}>
                          Usar como localização de {escolhido.cliente.nomeFantasia}
                        </Botao>
                      )}
                      <Botao pequeno variante="sutil" onClick={limparBuscaEndereco}>
                        Descartar endereço
                      </Botao>
                    </span>
                  </div>
                </div>
              )}
            </div>

            {filtrados.length === 0 ? (
              <p className="texto-secundario">
                Nenhuma localização com esses filtros.{' '}
                <Botao
                  pequeno
                  variante="sutil"
                  onClick={() => {
                    setTexto('')
                    setRecorte('')
                  }}
                >
                  Limpar filtros
                </Botao>
              </p>
            ) : (
              <ul className="mapa-lista" aria-label="Clientes no mapa">
                {filtrados.map((l) => {
                  const praca = regiaoPorId.get(l.cliente.regiaoId)
                  return (
                    <li key={l.cliente.id}>
                      <button
                        type="button"
                        aria-current={l.cliente.id === selecionado}
                        onClick={() => setSelecionado(l.cliente.id)}
                      >
                        <span className="linha entre g2">
                          <span className="mapa-lista__nome">{l.cliente.nomeFantasia}</span>
                          <Chip
                            severidade={
                              l.cliente.situacaoCredito === 'BLOQUEADO'
                                ? 'critico'
                                : l.cliente.situacaoCredito === 'OBSERVACAO'
                                  ? 'atencao'
                                  : 'disponivel'
                            }
                          >
                            {l.equipamentos.length} ativo(s)
                          </Chip>
                        </span>
                        <span className="mapa-lista__local">
                          {praca?.cidade ?? '—'}/{praca?.uf ?? '—'}
                          {l.filialMaisProxima && ` · ${l.filialMaisProxima.km.toFixed(0)} km da ${l.filialMaisProxima.nome}`}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Cartao>
        </div>
      ) : (
        <div id="painel-analises" role="tabpanel" aria-labelledby="aba-analises">
          <Cartao titulo="Concentração por praça">
            <Rolagem rotulo="Tabela de dados">
              <table>
                <caption className="so-leitor">
                  Clientes, ativos e receita por praça — os mesmos dados exibidos no mapa
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Praça</th>
                    <th scope="col" className="numerico">Clientes</th>
                    <th scope="col" className="numerico">Ativos</th>
                    <th scope="col" className="numerico">Receita 12m</th>
                    <th scope="col" className="numerico">Concentração</th>
                  </tr>
                </thead>
                <tbody>
                  {porPraca.map((p) => (
                    <tr key={`${p.cidade}-${p.uf}`}>
                      <th scope="row">
                        {p.cidade}
                        <br />
                        <span className="texto-atenuado">{p.uf}</span>
                      </th>
                      <td className="numerico dado">{p.clientes}</td>
                      <td className="numerico dado">{inteiro(p.ativos)}</td>
                      <td className="numerico dado">{moeda(p.receita)}</td>
                      <td className="numerico dado">
                        {totalAtivos === 0 ? '—' : `${Math.round((p.ativos / totalAtivos) * 100)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Rolagem>
            <p className="texto-atenuado" style={{ marginTop: 'var(--e3)' }}>
              É a mesma informação do mapa, em número. Nenhum dado desta tela existe apenas na forma visual.
            </p>
          </Cartao>

          {pode('financeiro:rentabilidade_ler') && (
            <Cartao titulo="Cobertura das filiais">
              <p className="texto-secundario medida-leitura" style={{ marginBottom: 'var(--e3)' }}>
                Distância do cliente até a filial mais próxima, por linha reta. Acima de 300 km o deslocamento
                deixa de caber num turno, e o SLA da praça precisa refletir isso.
              </p>
              <Rolagem rotulo="Tabela de dados">
                <table>
                  <caption className="so-leitor">Clientes mais distantes da filial mais próxima</caption>
                  <thead>
                    <tr>
                      <th scope="col">Cliente</th>
                      <th scope="col">Filial mais próxima</th>
                      <th scope="col" className="numerico">Distância</th>
                      <th scope="col" className="numerico">Ativos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...filtrados]
                      .filter((l) => l.filialMaisProxima)
                      .sort((a, b) => (b.filialMaisProxima!.km ?? 0) - (a.filialMaisProxima!.km ?? 0))
                      .slice(0, 12)
                      .map((l) => (
                        <tr key={l.cliente.id}>
                          <th scope="row">{l.cliente.nomeFantasia}</th>
                          <td>{l.filialMaisProxima!.nome}</td>
                          <td className="numerico dado">
                            {l.filialMaisProxima!.km > 300 ? (
                              <Chip severidade="atencao">{l.filialMaisProxima!.km.toFixed(0)} km</Chip>
                            ) : (
                              `${l.filialMaisProxima!.km.toFixed(0)} km`
                            )}
                          </td>
                          <td className="numerico dado">{l.equipamentos.length}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </Rolagem>
            </Cartao>
          )}
        </div>
      )}
    </>
  )
}
