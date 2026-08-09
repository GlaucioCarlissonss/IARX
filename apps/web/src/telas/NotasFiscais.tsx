import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import { custoAquisicao, itensIncompletos } from '../dados/comandos'
import { modeloPorId } from '../dados/catalogo'
import { formatarChave, formatarCnpj } from '../dados/nfe'
import { useConsulta } from '../lib/useConsulta'
import { useSessao, useToast } from '../lib/contexto'
import { data, moeda } from '../lib/formato'
import { Botao, Carregando, Cartao, Chip, Entrada, Metrica, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'
import { Dialogo } from '../componentes/ui/Dialogo'
import { Rolagem } from '../componentes/ui/Rolagem'
import { FormNotaFiscal } from '../componentes/formularios/FormNotaFiscal'
import { FormSeries } from '../componentes/formularios/FormSeries'
import { FormIntegrarNota } from '../componentes/formularios/FormIntegrarNota'
import { FormAnexos } from '../componentes/formularios/FormAnexos'
import type { Severidade } from '../componentes/ui/primitivos'
import type { NfStatus, NotaFiscal, NotaFiscalItem } from '../dados/tipos'

/**
 * Entrada fiscal de compra.
 *
 * A ordenação padrão é por pendência, não por data: nota parada esperando
 * conferência é ativo comprado que ainda não pode ser locado — dinheiro no
 * pátio sem gerar receita. A data resolve o empate.
 */

const STATUS: Record<NfStatus, { rotulo: string; sev: Severidade }> = {
  PENDENTE_CONFERENCIA: { rotulo: 'Pendente de conferência', sev: 'atencao' },
  CONFERIDA: { rotulo: 'Conferida', sev: 'uso' },
  INTEGRADA: { rotulo: 'Integrada', sev: 'disponivel' },
  CANCELADA: { rotulo: 'Cancelada', sev: 'inativo' },
}

/** Ordem de urgência operacional — usada para ordenar a lista. */
const URGENCIA: Record<NfStatus, number> = {
  CONFERIDA: 0,
  PENDENTE_CONFERENCIA: 1,
  INTEGRADA: 2,
  CANCELADA: 3,
}

type Aberto =
  | { tipo: 'nova' }
  | { tipo: 'detalhe'; nota: NotaFiscal }
  | { tipo: 'series'; nota: NotaFiscal; item: NotaFiscalItem }
  | { tipo: 'integrar'; nota: NotaFiscal }
  | { tipo: 'cancelar'; nota: NotaFiscal }
  | { tipo: 'anexos'; nota: NotaFiscal }
  | null

export function NotasFiscais() {
  const { pode, usuario } = useSessao()
  const { avisar } = useToast()
  const { situacao, dado } = useConsulta(() => api.notasFiscais(), [])
  const [texto, setTexto] = useState('')
  const [filtro, setFiltro] = useState('')
  const [aberto, setAberto] = useState<Aberto>(null)

  const fornecedores = api.baseSincrona().fornecedores
  const notas = useMemo(() => dado ?? [], [dado])

  // A nota aberta é relida da lista a cada render: depois de informar séries, o
  // diálogo de detalhe precisa refletir o novo estado — segurar o objeto do
  // clique deixaria a tela mostrando o passado.
  const notaAberta =
    aberto && 'nota' in aberto ? notas.find((n) => n.id === aberto.nota.id) ?? aberto.nota : null

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return notas.filter((n) => {
      if (filtro === 'pendentes' && n.status === 'INTEGRADA') return false
      if (filtro && filtro !== 'pendentes' && n.status !== filtro) return false
      if (t) {
        const fornecedor = fornecedores.find((f) => f.id === n.fornecedorId)
        const alvo = `${n.serie}/${n.numero} ${n.chaveAcesso ?? ''} ${fornecedor?.razaoSocial ?? ''} ${fornecedor?.cnpj ?? ''}`
        if (!alvo.toLowerCase().includes(t)) return false
      }
      return true
    })
  }, [notas, filtro, texto, fornecedores])

  const aguardando = notas.filter((n) => n.status === 'PENDENTE_CONFERENCIA')
  const conferidas = notas.filter((n) => n.status === 'CONFERIDA')
  const unidadesParadas = [...aguardando, ...conferidas].reduce(
    (s, n) => s + n.itens.reduce((t, i) => t + i.quantidade, 0),
    0,
  )
  const capitalParado = [...aguardando, ...conferidas].reduce((s, n) => s + custoAquisicao(n), 0)
  const integradas12m = notas.filter((n) => n.status === 'INTEGRADA')

  async function conferir(nota: NotaFiscal) {
    const r = await api.conferirNota(nota.id, usuario.nome)
    if (!r.ok) {
      avisar({ tom: 'erro', titulo: 'Conferência recusada', texto: r.erro.mensagem })
      return
    }
    avisar({
      tom: 'ok',
      titulo: `Nota ${nota.serie}/${nota.numero} conferida`,
      texto: 'Pronta para integrar ao patrimônio.',
    })
  }

  const colunas: Coluna<NotaFiscal>[] = [
    {
      chave: 'nota',
      titulo: 'Nota',
      identificadora: true,
      ordenarPor: (n) => Number(n.numero),
      celula: (n) => (
        <>
          <span className="dado">
            {n.serie}/{n.numero}
          </span>
          <br />
          <span className="texto-atenuado">
            {fornecedores.find((f) => f.id === n.fornecedorId)?.nomeFantasia ?? '—'}
          </span>
        </>
      ),
    },
    {
      chave: 'status',
      titulo: 'Situação',
      ordenarPor: (n) => URGENCIA[n.status],
      celula: (n) => {
        const faltando = itensIncompletos(n)
        return (
          <>
            <Chip severidade={STATUS[n.status].sev}>{STATUS[n.status].rotulo}</Chip>
            {n.status === 'PENDENTE_CONFERENCIA' && faltando.length > 0 && (
              <>
                <br />
                <span className="texto-atenuado">
                  {faltando.length} item(ns) sem todas as unidades
                </span>
              </>
            )}
          </>
        )
      },
    },
    {
      chave: 'entrada',
      titulo: 'Entrada',
      ordenarPor: (n) => n.dataEntrada,
      celula: (n) => (
        <>
          {data(n.dataEntrada)}
          <br />
          <span className="texto-atenuado">emissão {data(n.dataEmissao)}</span>
        </>
      ),
    },
    {
      chave: 'unidades',
      titulo: 'Unidades',
      numerico: true,
      ocultarEmMobile: true,
      ordenarPor: (n) => n.itens.reduce((s, i) => s + i.quantidade, 0),
      celula: (n) => {
        const total = n.itens.reduce((s, i) => s + i.quantidade, 0)
        const identificadas = n.itens.reduce((s, i) => s + i.series.length, 0)
        return (
          <span className="dado">
            {identificadas === total ? total : `${identificadas}/${total}`}
            <br />
            <span className="texto-atenuado">{n.itens.length} item(ns)</span>
          </span>
        )
      },
    },
    {
      chave: 'custo',
      titulo: 'Custo de aquisição',
      numerico: true,
      ordenarPor: (n) => custoAquisicao(n),
      celula: (n) => (
        <>
          <span className="dado">{moeda(custoAquisicao(n))}</span>
          {custoAquisicao(n) !== n.valorTotal && (
            <>
              <br />
              <span className="texto-atenuado dado">nota {moeda(n.valorTotal)}</span>
            </>
          )}
        </>
      ),
    },
    {
      chave: 'acoes',
      titulo: 'Ações',
      celula: (n) => (
        <div className="linha g2 envolver">
          <Botao pequeno onClick={() => setAberto({ tipo: 'detalhe', nota: n })}>
            Abrir<span className="so-leitor"> nota {n.serie}/{n.numero}</span>
          </Botao>
          {pode('nota_fiscal:conferir') && n.status === 'PENDENTE_CONFERENCIA' && (
            <Botao
              pequeno
              variante="primario"
              onClick={() => void conferir(n)}
              disabled={itensIncompletos(n).length > 0}
              motivoDesabilitado="Todas as unidades precisam de série e patrimônio"
            >
              Conferir<span className="so-leitor"> nota {n.serie}/{n.numero}</span>
            </Botao>
          )}
          {pode('nota_fiscal:integrar') && n.status === 'CONFERIDA' && (
            <Botao pequeno variante="primario" onClick={() => setAberto({ tipo: 'integrar', nota: n })}>
              Integrar<span className="so-leitor"> nota {n.serie}/{n.numero} ao patrimônio</span>
            </Botao>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Notas fiscais de compra</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            O ativo nasce da nota. Valor de aquisição, início da depreciação e prazo de garantia vêm daqui — não são
            digitados no cadastro do equipamento.
          </p>
        </div>
        {pode('nota_fiscal:criar') && (
          <Botao variante="primario" glifo="⊕" onClick={() => setAberto({ tipo: 'nova' })}>
            Registrar entrada
          </Botao>
        )}
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica
            rotulo="Aguardando conferência"
            valor={String(aguardando.length)}
            contexto="nenhum ativo criado ainda"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Prontas para integrar" valor={String(conferidas.length)} contexto="conferidas fisicamente" />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Unidades paradas"
            valor={String(unidadesParadas)}
            contexto="compradas e ainda não locáveis"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Capital parado" valor={moeda(capitalParado)} contexto="custo das notas em aberto" />
        </Cartao>
      </div>

      <Cartao>
        <div className="filtros">
          <div style={{ minWidth: 220 }}>
            <Entrada
              rotulo="Número, chave ou fornecedor"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="ex.: 41205 ou Printech"
            />
          </div>
          <Selecao
            rotulo="Recorte"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            opcoes={[
              { valor: '', texto: 'Todas as notas' },
              { valor: 'pendentes', texto: 'Ainda não integradas' },
              { valor: 'PENDENTE_CONFERENCIA', texto: 'Pendentes de conferência' },
              { valor: 'CONFERIDA', texto: 'Conferidas' },
              { valor: 'INTEGRADA', texto: 'Integradas' },
              { valor: 'CANCELADA', texto: 'Canceladas' },
            ]}
          />
        </div>

        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando notas fiscais">
            <Skeleton linhas={8} altura="22px" />
          </Carregando>
        ) : (
          <Tabela
            legenda="Notas fiscais de compra com situação, unidades e custo de aquisição"
            colunas={colunas}
            itens={filtradas}
            chaveDe={(n) => n.id}
            ordemInicial={{ chave: 'status', direcao: 'asc' }}
            vazio={{
              titulo: 'Nenhuma nota com esses filtros',
              acao: (
                <Botao
                  onClick={() => {
                    setTexto('')
                    setFiltro('')
                  }}
                >
                  Limpar filtros
                </Botao>
              ),
            }}
          />
        )}
      </Cartao>

      <Cartao titulo="Procedência do parque">
        <ProcedenciaParque integradas={integradas12m.length} />
      </Cartao>

      {aberto?.tipo === 'nova' && <FormNotaFiscal aoFechar={() => setAberto(null)} />}

      {aberto?.tipo === 'detalhe' && notaAberta && (
        <DetalheNota
          nota={notaAberta}
          aoFechar={() => setAberto(null)}
          aoEditarSeries={(item) => setAberto({ tipo: 'series', nota: notaAberta, item })}
          aoAnexos={() => setAberto({ tipo: 'anexos', nota: notaAberta })}
          aoCancelar={() => setAberto({ tipo: 'cancelar', nota: notaAberta })}
        />
      )}

      {aberto?.tipo === 'series' && notaAberta && (
        <FormSeries
          nota={notaAberta}
          item={notaAberta.itens.find((i) => i.id === aberto.item.id) ?? aberto.item}
          aoFechar={() => setAberto({ tipo: 'detalhe', nota: notaAberta })}
        />
      )}

      {aberto?.tipo === 'integrar' && notaAberta && (
        <FormIntegrarNota nota={notaAberta} aoFechar={() => setAberto(null)} />
      )}

      {aberto?.tipo === 'cancelar' && notaAberta && (
        <CancelarNota nota={notaAberta} aoFechar={() => setAberto({ tipo: 'detalhe', nota: notaAberta })} />
      )}

      {aberto?.tipo === 'anexos' && notaAberta && (
        <FormAnexos
          entidade="NOTA_FISCAL"
          entidadeId={notaAberta.id}
          titulo={`Nota ${notaAberta.serie}/${notaAberta.numero}`}
          aoFechar={() => setAberto({ tipo: 'detalhe', nota: notaAberta })}
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Quanto do parque tem origem verificável.
 *
 * Não é vaidade de indicador: ativo sem nota tem valor de aquisição digitado, e
 * é sobre esse valor que a depreciação e a margem por ativo são calculadas. A
 * proporção diz o quanto do resultado é auditável.
 */
function ProcedenciaParque({ integradas }: { integradas: number }) {
  const equipamentos = api.baseSincrona().equipamentos
  const com = equipamentos.filter((e) => e.notaSerieId).length
  const total = equipamentos.length
  const percentual = total === 0 ? 0 : Math.round((com / total) * 100)

  return (
    <div className="pilha g3">
      <div className="grade grade--metricas">
        <Metrica
          rotulo="Ativos com procedência fiscal"
          valor={`${percentual}%`}
          contexto={`${com} de ${total} equipamentos`}
        />
        <Metrica rotulo="Notas integradas" valor={String(integradas)} contexto="origem dos ativos rastreáveis" />
        <Metrica
          rotulo="Sem nota vinculada"
          valor={String(total - com)}
          contexto="valor de aquisição sem origem verificável"
        />
      </div>
      <p className="texto-secundario medida-leitura">
        Os ativos sem procedência foram cadastrados antes deste módulo. Eles continuam operando normalmente — o que
        não têm é a nota que explica o valor de aquisição, e é sobre esse valor que a depreciação e a margem por
        ativo são calculadas.
      </p>
    </div>
  )
}

interface DetalheProps {
  nota: NotaFiscal
  aoFechar: () => void
  aoEditarSeries: (item: NotaFiscalItem) => void
  aoAnexos: () => void
  aoCancelar: () => void
}

function DetalheNota({ nota, aoFechar, aoEditarSeries, aoAnexos, aoCancelar }: DetalheProps) {
  const { pode } = useSessao()
  const fornecedor = api.baseSincrona().fornecedores.find((f) => f.id === nota.fornecedorId)
  const filial = api.baseSincrona().filiais.find((f) => f.id === nota.filialDestinoId)
  const selada = nota.status === 'INTEGRADA' || nota.status === 'CANCELADA'

  return (
    <Dialogo
      titulo={`Nota ${nota.serie}/${nota.numero}`}
      descricao={`${fornecedor?.razaoSocial ?? 'Fornecedor'} · entrada em ${data(nota.dataEntrada)} · ${filial?.nome ?? ''}`}
      aoFechar={aoFechar}
      largura="largo"
      acoes={
        <>
          <Botao onClick={aoFechar}>Fechar</Botao>
          <Botao onClick={aoAnexos}>Anexos</Botao>
          {pode('nota_fiscal:cancelar') && !selada && (
            <Botao variante="perigo" onClick={aoCancelar}>
              Cancelar nota
            </Botao>
          )}
        </>
      }
    >
      <div className="pilha g4">
        <div className="linha g3 envolver">
          <Chip severidade={STATUS[nota.status].sev}>{STATUS[nota.status].rotulo}</Chip>
          <Chip severidade={nota.origemDados === 'XML' ? 'disponivel' : 'atencao'}>
            {nota.origemDados === 'XML' ? 'Extraída do XML' : 'Digitada manualmente'}
          </Chip>
        </div>

        {nota.status === 'INTEGRADA' && (
          <div className="aviso aviso--ok" role="note">
            <span aria-hidden="true">✓</span>
            <div>
              <p className="aviso__titulo">
                Integrada em {data(nota.integradaEm ?? nota.dataEntrada)} por {nota.integradaPor}
              </p>
              <p>
                A nota está selada: os ativos gerados carregam o valor de aquisição e a garantia que ela definiu.
                Correção só por nota de ajuste referenciando esta.
              </p>
            </div>
          </div>
        )}

        {nota.status === 'CANCELADA' && (
          <div className="aviso aviso--critico" role="note">
            <span aria-hidden="true">✕</span>
            <div>
              <p className="aviso__titulo">Cancelada em {data(nota.canceladaEm ?? nota.dataEntrada)}</p>
              <p>{nota.motivoCancelamento}</p>
            </div>
          </div>
        )}

        <dl className="pares">
          <div>
            <dt>Fornecedor</dt>
            <dd>
              {fornecedor?.razaoSocial}
              <br />
              <span className="texto-atenuado dado">{formatarCnpj(fornecedor?.cnpj ?? '')}</span>
            </dd>
          </div>
          <div>
            <dt>Chave de acesso</dt>
            <dd className="dado">
              {nota.chaveAcesso ? formatarChave(nota.chaveAcesso) : <span className="texto-atenuado">não informada</span>}
            </dd>
          </div>
          <div>
            <dt>Custo de aquisição</dt>
            <dd className="dado">
              {moeda(custoAquisicao(nota))}
              <br />
              <span className="texto-atenuado">
                total da nota {moeda(nota.valorTotal)}
                {nota.icmsRecuperavel && ` · ICMS creditado`}
                {nota.ipiRecuperavel && ` · IPI creditado`}
              </span>
            </dd>
          </div>
          <div>
            <dt>Lançada por</dt>
            <dd>
              {nota.criadaPor}
              {nota.conferidaPor && (
                <>
                  <br />
                  <span className="texto-atenuado">conferida por {nota.conferidaPor}</span>
                </>
              )}
            </dd>
          </div>
        </dl>

        <section aria-label="Itens da nota" className="pilha g3">
          <h3>Itens</h3>
          <Rolagem rotulo="Tabela de dados">
            <table>
              <caption className="so-leitor">
                Itens da nota {nota.serie}/{nota.numero}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Modelo</th>
                  <th scope="col" className="numerico">
                    Qtd.
                  </th>
                  <th scope="col" className="numerico">
                    Total
                  </th>
                  <th scope="col">Unidades identificadas</th>
                </tr>
              </thead>
              <tbody>
                {nota.itens.map((item) => {
                  const completo = item.series.length === item.quantidade
                  return (
                    <tr key={item.id}>
                      <th scope="row">
                        {item.numeroItem}
                        <br />
                        <span className="texto-atenuado dado">{item.descricaoNf}</span>
                      </th>
                      <td>
                        {modeloPorId.get(item.modeloId)?.nome ?? '—'}
                        {item.ncm && (
                          <>
                            <br />
                            <span className="texto-atenuado dado">
                              NCM {item.ncm}
                              {item.cfop && ` · CFOP ${item.cfop}`}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="numerico dado">{item.quantidade}</td>
                      <td className="numerico dado">{moeda(item.valorTotalItem)}</td>
                      <td>
                        <div className="linha g2 envolver">
                          <Chip severidade={completo ? 'disponivel' : 'atencao'}>
                            {item.series.length} de {item.quantidade}
                          </Chip>
                          {!selada && pode('nota_fiscal:criar') && (
                            <Botao pequeno onClick={() => aoEditarSeries(item)}>
                              {completo ? 'Revisar' : 'Informar'}
                              <span className="so-leitor"> séries do item {item.numeroItem}</span>
                            </Botao>
                          )}
                        </div>
                        {item.series.length > 0 && (
                          <>
                            <br />
                            <span className="texto-atenuado dado">
                              {item.series
                                .slice(0, 3)
                                .map((s) => s.patrimonio)
                                .join(', ')}
                              {item.series.length > 3 && ` +${item.series.length - 3}`}
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Rolagem>
        </section>
      </div>
    </Dialogo>
  )
}

function CancelarNota({ nota, aoFechar }: { nota: NotaFiscal; aoFechar: () => void }) {
  const { avisar } = useToast()
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function confirmar() {
    setEnviando(true)
    const r = await api.cancelarNota(nota.id, motivo)
    setEnviando(false)
    if (!r.ok) {
      setErro(r.erro.mensagem)
      return
    }
    avisar({ tom: 'atencao', titulo: `Nota ${nota.serie}/${nota.numero} cancelada`, texto: motivo.trim() })
    aoFechar()
  }

  return (
    <Dialogo
      titulo={`Cancelar nota ${nota.serie}/${nota.numero}`}
      descricao="O motivo fica na trilha de auditoria. A nota não pode ser reaberta depois."
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={enviando}>
            Voltar
          </Botao>
          <Botao variante="perigo" onClick={confirmar} disabled={enviando}>
            {enviando ? 'Cancelando…' : 'Cancelar definitivamente'}
          </Botao>
        </>
      }
    >
      <div className="pilha g3">
        <Entrada
          nome="motivo"
          rotulo="Motivo do cancelamento"
          dica="Ex.: “devolução ao fornecedor — modelo divergente do pedido”."
          erro={erro ?? undefined}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
        <p className="texto-atenuado">
          Nenhum ativo foi criado a partir desta nota, então o cancelamento não deixa patrimônio órfão.
        </p>
      </div>
    </Dialogo>
  )
}

