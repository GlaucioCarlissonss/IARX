import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import { MODELOS, categoriaPorCodigo, fabricantePorId, modeloPorId } from '../dados/catalogo'
import { rotuloAlvo, simular } from '../dados/comercial'
import type { LinhaSimulacao } from '../dados/comercial'
import { useConsulta } from '../lib/useConsulta'
import { useSessao } from '../lib/contexto'
import { data, inteiro, moeda } from '../lib/formato'
import { Botao, Carregando, Cartao, Chip, Entrada, Metrica, Skeleton } from '../componentes/ui/primitivos'
import { Rolagem } from '../componentes/ui/Rolagem'
import { Combo, LinhaCampos } from '../componentes/ui/formulario'
import type { Severidade } from '../componentes/ui/primitivos'
import type { TabelaFranquia, TabelaPreco, TabelaStatus } from '../dados/tipos'

/**
 * Política comercial: franquia, preço e simulador.
 *
 * As três coisas moram juntas porque a pergunta que o comercial faz é uma só —
 * "quanto sai esta proposta?" — e ela precisa das três respostas na mesma tela.
 * Separá-las em telas distintas obrigaria a decorar números entre uma e outra.
 *
 * O princípio que governa a tela: **a tabela é a fonte, o contrato é a
 * fotografia**. Trocar a tabela não reprecifica contrato vigente, e a interface
 * diz isso onde a dúvida aparece — no momento de ativar uma versão nova.
 */

const STATUS: Record<TabelaStatus, { rotulo: string; sev: Severidade }> = {
  RASCUNHO: { rotulo: 'Rascunho', sev: 'atencao' },
  ATIVA: { rotulo: 'Vigente', sev: 'disponivel' },
  INATIVA: { rotulo: 'Encerrada', sev: 'inativo' },
}

type Aba = 'simulador' | 'franquia' | 'preco'

export function Comercial() {
  const { pode } = useSessao()
  const { situacao } = useConsulta(() => api.clientes(), [])
  const [aba, setAba] = useState<Aba>('simulador')

  const base = api.baseSincrona()

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Política comercial</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Franquia, preço e simulação usam a mesma resolução que o faturamento. É o que impede a proposta de
            prometer um número que a primeira fatura não confirma.
          </p>
        </div>
      </div>

      <div className="abas" role="tablist" aria-label="Visões da política comercial">
        {(
          [
            ['simulador', '◈', 'Simulador'],
            ['franquia', '▤', 'Franquias'],
            ['preco', '◫', 'Preços'],
          ] as [Aba, string, string][]
        ).map(([id, glifo, rotulo]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={aba === id}
            aria-controls={`painel-${id}`}
            id={`aba-${id}`}
            onClick={() => setAba(id)}
          >
            <span aria-hidden="true">{glifo}</span> {rotulo}
          </button>
        ))}
      </div>

      {situacao === 'carregando' ? (
        <Carregando rotulo="Carregando a política comercial">
          <Skeleton linhas={8} altura="24px" />
        </Carregando>
      ) : aba === 'simulador' ? (
        <div id="painel-simulador" role="tabpanel" aria-labelledby="aba-simulador">
          <Simulador />
        </div>
      ) : aba === 'franquia' ? (
        <div id="painel-franquia" role="tabpanel" aria-labelledby="aba-franquia" className="pilha g4">
          {base.tabelasFranquia.map((t) => (
            <CartaoFranquia key={t.id} tabela={t} podeEditar={pode('contrato:criar')} />
          ))}
        </div>
      ) : (
        <div id="painel-preco" role="tabpanel" aria-labelledby="aba-preco" className="pilha g4">
          {base.tabelasPreco.map((t) => (
            <CartaoPreco key={t.id} tabela={t} />
          ))}
        </div>
      )}
    </>
  )
}

/* ========================================================== simulador === */

let seqLinha = 0

/**
 * Simulador de proposta.
 *
 * Não persiste nada (RN-L27): simulação é cálculo, não proposta. Virar
 * proposta é ação explícita, e cria um contrato em rascunho.
 *
 * O resultado separa recorrente de evento porque somar instalação ao MRR infla
 * o indicador de receita recorrente com um valor que acontece uma vez — e o
 * erro só aparece quando alguém compara o MRR com o extrato do mês seguinte.
 */
function Simulador() {
  const base = api.baseSincrona()
  const [clienteId, setClienteId] = useState('')
  const [prazo, setPrazo] = useState(36)
  const [desconto, setDesconto] = useState(0)
  const [linhas, setLinhas] = useState<LinhaSimulacao[]>(() => [novaLinha('mod-kyo-4054')])

  const hoje = api.hoje().toISOString().slice(0, 10)

  const resultado = useMemo(
    () =>
      simular(
        { linhas, prazoMeses: prazo, data: hoje, clienteId: clienteId || null, descontoPercentual: desconto },
        { tabelasFranquia: base.tabelasFranquia, tabelasPreco: base.tabelasPreco },
      ),
    [linhas, prazo, desconto, clienteId, hoje, base],
  )

  const cliente = base.clientes.find((c) => c.id === clienteId)
  const tabelaDoCliente = base.tabelasPreco.find(
    (t) => t.abrangencia === 'CLIENTE' && t.clienteId === clienteId && t.status === 'ATIVA',
  )

  function alterar(chave: string, mudanca: Partial<LinhaSimulacao>) {
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...mudanca } : l)))
  }

  return (
    <div className="pilha g4">
      <Cartao titulo="Configuração da proposta">
        <div className="pilha g4">
          <LinhaCampos>
            <Combo
              nome="cliente"
              rotulo="Cliente (opcional)"
              dica="Com cliente escolhido, a condição negociada dele prevalece sobre a tabela geral."
              opcoes={[
                { valor: '', texto: 'Sem cliente — usa a tabela geral' },
                ...base.clientes.map((c) => ({ valor: c.id, texto: c.nomeFantasia, detalhe: c.segmento })),
              ]}
              valor={clienteId}
              aoMudar={setClienteId}
              vazio="Nenhum cliente com esse nome"
            />
            <Entrada
              nome="prazo"
              rotulo="Prazo (meses)"
              type="number"
              min="1"
              max="120"
              value={String(prazo)}
              onChange={(e) => setPrazo(Math.max(1, Number(e.target.value) || 1))}
            />
            <Entrada
              nome="desconto"
              rotulo="Desconto comercial (%)"
              dica="Acima da alçada, exige aprovação antes de o contrato avançar."
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={String(desconto)}
              onChange={(e) => setDesconto(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
            />
          </LinhaCampos>

          {cliente && (
            <div className="aviso aviso--info" role="status">
              <span aria-hidden="true">◧</span>
              <div>
                <p className="aviso__titulo">
                  {tabelaDoCliente
                    ? `Aplicando “${tabelaDoCliente.nome}”`
                    : `${cliente.nomeFantasia} não tem condição negociada`}
                </p>
                <p>
                  {tabelaDoCliente
                    ? 'A condição do cliente vence a tabela geral. Uma condição de contrato, se existir, venceria as duas.'
                    : 'A cotação usa a tabela geral. Criar uma condição para este cliente muda apenas as propostas novas.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </Cartao>

      <Cartao
        titulo="Equipamentos"
        acessorio={
          <Botao pequeno onClick={() => setLinhas((ls) => [...ls, novaLinha(MODELOS[0]!.id)])}>
            Acrescentar linha
          </Botao>
        }
      >
        <div className="pilha g4">
          {linhas.map((l, i) => {
            const modelo = modeloPorId.get(l.modeloId)
            const categoria = modelo ? categoriaPorCodigo.get(modelo.categoria) : undefined
            return (
              <div key={l.chave} className="cartao cartao--compacto pilha g3">
                <LinhaCampos>
                  <Combo
                    nome={`modelo-${i}`}
                    rotulo={`Modelo da linha ${i + 1}`}
                    opcoes={MODELOS.map((m) => ({
                      valor: m.id,
                      texto: `${fabricantePorId.get(m.fabricanteId)?.nome ?? ''} ${m.nome}`.trim(),
                      detalhe: categoriaPorCodigo.get(m.categoria)?.nome,
                    }))}
                    valor={l.modeloId}
                    aoMudar={(v) => alterar(l.chave, { modeloId: v })}
                  />
                  <Entrada
                    nome={`qtd-${i}`}
                    rotulo="Quantidade"
                    type="number"
                    min="1"
                    value={String(l.quantidade)}
                    onChange={(e) => alterar(l.chave, { quantidade: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  {categoria?.temContador ? (
                    <>
                      <Entrada
                        nome={`mono-${i}`}
                        rotulo="Volume mono/mês"
                        dica="Por unidade."
                        type="number"
                        min="0"
                        value={String(l.volumeMono)}
                        onChange={(e) => alterar(l.chave, { volumeMono: Math.max(0, Number(e.target.value) || 0) })}
                      />
                      {categoria.temContadorColor && (
                        <Entrada
                          nome={`color-${i}`}
                          rotulo="Volume color/mês"
                          type="number"
                          min="0"
                          value={String(l.volumeColor)}
                          onChange={(e) => alterar(l.chave, { volumeColor: Math.max(0, Number(e.target.value) || 0) })}
                        />
                      )}
                    </>
                  ) : (
                    <p className="texto-atenuado" style={{ alignSelf: 'end' }}>
                      Sem medidor: cobrança por valor fixo mensal.
                    </p>
                  )}
                </LinhaCampos>

                {linhas.length > 1 && (
                  <div className="linha g2">
                    <Botao
                      pequeno
                      variante="sutil"
                      onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}
                    >
                      Remover linha {i + 1}
                    </Botao>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Cartao>

      {resultado.pendencias.length > 0 && (
        <div className="aviso aviso--atencao" role="status">
          <span aria-hidden="true">▲</span>
          <div>
            <p className="aviso__titulo">Esta proposta não pode ser fechada como está</p>
            <ul>
              {resultado.pendencias.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p className="texto-atenuado">
              Faltando política, o valor exibido está incompleto — e não é zero: é desconhecido.
            </p>
          </div>
        </div>
      )}

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica rotulo="Mensal líquido" valor={moeda(resultado.mensalLiquido)} contexto="entra no MRR" />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Instalação"
            valor={moeda(resultado.instalacaoTotal)}
            contexto="evento — não compõe o MRR"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Primeira fatura"
            valor={moeda(resultado.totalPrimeiraFatura)}
            contexto="mensal + instalação"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo={`Total em ${prazo} meses`}
            valor={moeda(resultado.totalContrato)}
            contexto="valor global do contrato"
          />
        </Cartao>
      </div>

      <Cartao titulo="Memória de cálculo">
        <Rolagem rotulo="Tabela de dados">
          <table>
            <caption className="so-leitor">Composição do valor mensal por linha da proposta</caption>
            <thead>
              <tr>
                <th scope="col">Equipamento</th>
                <th scope="col">Origem do preço</th>
                <th scope="col" className="numerico">Fixo</th>
                <th scope="col" className="numerico">Franquia</th>
                <th scope="col" className="numerico">Excedente</th>
                <th scope="col" className="numerico">Mensal</th>
              </tr>
            </thead>
            <tbody>
              {resultado.linhas.map((r) => (
                <tr key={r.linha.chave}>
                  <th scope="row">
                    {r.modeloNome}
                    <br />
                    <span className="texto-atenuado">
                      {r.linha.quantidade} × {moeda(r.precoUnitario)}
                    </span>
                  </th>
                  <td>
                    {r.origemPreco ?? <Chip severidade="critico">sem tabela</Chip>}
                  </td>
                  <td className="numerico dado">{moeda(r.valorFixo)}</td>
                  <td className="numerico dado">
                    {r.categoria?.temContador ? (
                      <>
                        {inteiro(r.franquiaMono)}
                        {r.categoria.temContadorColor && (
                          <>
                            <br />
                            <span className="texto-atenuado">{inteiro(r.franquiaColor)} color</span>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="texto-atenuado">—</span>
                    )}
                  </td>
                  <td className="numerico dado">
                    {r.excedenteMonoPaginas + r.excedenteColorPaginas > 0 ? (
                      <>
                        {moeda(r.valorExcedente)}
                        <br />
                        <span className="texto-atenuado">
                          {inteiro(r.excedenteMonoPaginas)} pág. além
                        </span>
                      </>
                    ) : (
                      <span className="texto-atenuado">dentro da franquia</span>
                    )}
                  </td>
                  <td className="numerico dado">{moeda(r.totalMensal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={5}>
                  Mensal bruto
                </th>
                <td className="numerico dado">{moeda(resultado.mensalBruto)}</td>
              </tr>
              {resultado.desconto > 0 && (
                <tr>
                  <th scope="row" colSpan={5}>
                    Desconto de {desconto}%
                  </th>
                  <td className="numerico dado">− {moeda(resultado.desconto)}</td>
                </tr>
              )}
            </tfoot>
          </table>
        </Rolagem>
        <p className="texto-atenuado" style={{ marginTop: 'var(--e3)' }}>
          Simulação é cálculo, não proposta: nada aqui é gravado. Transformar em contrato é ação explícita, e cria
          um rascunho com estes valores congelados.
        </p>
      </Cartao>
    </div>
  )
}

function novaLinha(modeloId: string): LinhaSimulacao {
  seqLinha += 1
  const m = modeloPorId.get(modeloId)
  return {
    chave: `sim-${seqLinha}`,
    modeloId,
    quantidade: 1,
    // Volume inicial na franquia do modelo: parte de um cenário neutro, sem
    // excedente, que é onde a conversa comercial costuma começar.
    volumeMono: m?.franquiaMono ?? 0,
    volumeColor: m?.franquiaColor ?? 0,
  }
}

/* ============================================================ tabelas === */

function CartaoFranquia({ tabela, podeEditar }: { tabela: TabelaFranquia; podeEditar: boolean }) {
  return (
    <Cartao
      titulo={tabela.nome}
      acessorio={<Chip severidade={STATUS[tabela.status].sev}>{STATUS[tabela.status].rotulo}</Chip>}
    >
      <div className="pilha g3">
        <p className="texto-secundario medida-leitura">{tabela.descricao}</p>
        <p className="texto-atenuado">
          Vigência: {data(tabela.vigenciaInicio)} —{' '}
          {tabela.vigenciaFim ? data(tabela.vigenciaFim) : 'em aberto'} · versão {tabela.versao}
        </p>

        {tabela.status === 'ATIVA' && podeEditar && (
          <div className="aviso aviso--info" role="note">
            <span aria-hidden="true">◧</span>
            <div>
              <p className="aviso__titulo">Tabela vigente não se edita</p>
              <p>
                Alterar valores aqui reprecificaria, em silêncio, todo contrato que a referencia. A correção é criar
                uma versão nova — os contratos assinados mantêm o que acordaram.
              </p>
            </div>
          </div>
        )}

        <Rolagem rotulo="Tabela de dados">
          <table>
            <caption className="so-leitor">Linhas de franquia de {tabela.nome}</caption>
            <thead>
              <tr>
                <th scope="col">Alvo</th>
                <th scope="col" className="numerico">Franquia mono</th>
                <th scope="col" className="numerico">Franquia color</th>
                <th scope="col" className="numerico">Excedente mono</th>
                <th scope="col" className="numerico">Excedente color</th>
                <th scope="col">Escopo</th>
              </tr>
            </thead>
            <tbody>
              {tabela.itens.map((i) => (
                <tr key={i.id}>
                  <th scope="row">
                    {rotuloAlvo(i)}
                    <br />
                    <span className="texto-atenuado">{i.modeloId ? 'por modelo' : 'por categoria'}</span>
                  </th>
                  <td className="numerico dado">{inteiro(i.franquiaMono)}</td>
                  <td className="numerico dado">
                    {i.franquiaColor > 0 ? inteiro(i.franquiaColor) : <span className="texto-atenuado">—</span>}
                  </td>
                  <td className="numerico dado">{moeda(i.excedenteMono)}</td>
                  <td className="numerico dado">
                    {i.excedenteColor > 0 ? moeda(i.excedenteColor) : <span className="texto-atenuado">—</span>}
                  </td>
                  <td>{i.escopo === 'ITEM' ? 'Por ativo' : 'Por contrato'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Rolagem>
      </div>
    </Cartao>
  )
}

function CartaoPreco({ tabela }: { tabela: TabelaPreco }) {
  const base = api.baseSincrona()
  const cliente = base.clientes.find((c) => c.id === tabela.clienteId)

  return (
    <Cartao
      titulo={tabela.nome}
      acessorio={
        <div className="linha g2 envolver">
          <Chip severidade={tabela.abrangencia === 'GERAL' ? 'inativo' : 'uso'}>
            {tabela.abrangencia === 'GERAL'
              ? 'Geral'
              : tabela.abrangencia === 'CLIENTE'
                ? `Cliente · ${cliente?.nomeFantasia ?? '—'}`
                : 'Contrato'}
          </Chip>
          <Chip severidade={STATUS[tabela.status].sev}>{STATUS[tabela.status].rotulo}</Chip>
        </div>
      }
    >
      <div className="pilha g3">
        <p className="texto-secundario medida-leitura">{tabela.descricao}</p>
        <p className="texto-atenuado">
          Vigência desde {data(tabela.vigenciaInicio)} · reajuste por {tabela.indiceReajuste} a cada{' '}
          {tabela.mesesReajuste} meses
        </p>

        <Rolagem rotulo="Tabela de dados">
          <table>
            <caption className="so-leitor">Preços de {tabela.nome}</caption>
            <thead>
              <tr>
                <th scope="col">Alvo</th>
                <th scope="col" className="numerico">Mensal</th>
                <th scope="col" className="numerico">Instalação</th>
                <th scope="col" className="numerico">Retirada</th>
                <th scope="col" className="numerico">Prazo mínimo</th>
              </tr>
            </thead>
            <tbody>
              {tabela.itens.map((i) => (
                <tr key={i.id}>
                  <th scope="row">{rotuloAlvo(i)}</th>
                  <td className="numerico dado">{moeda(i.valorMensal)}</td>
                  <td className="numerico dado">
                    {i.valorInstalacao > 0 ? moeda(i.valorInstalacao) : <span className="texto-atenuado">isenta</span>}
                  </td>
                  <td className="numerico dado">{moeda(i.valorRetirada)}</td>
                  <td className="numerico dado">
                    {i.prazoMinimoMeses ? `${i.prazoMinimoMeses} m` : <span className="texto-atenuado">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Rolagem>
        <p className="texto-atenuado">
          Instalação e retirada são eventos, não recorrência: entram na primeira fatura e na fatura seguinte à
          devolução, e nunca compõem o MRR.
        </p>
      </div>
    </Cartao>
  )
}
