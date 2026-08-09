import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../dados/api'
import { custoAquisicao, previaIntegracao } from '../../dados/comandos'
import { modeloPorId } from '../../dados/catalogo'
import { useSessao, useToast } from '../../lib/contexto'
import { data, moeda } from '../../lib/formato'
import { Botao, Chip } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { Rolagem } from '../ui/Rolagem'
import type { FalhaComando } from '../../dados/comandos'
import type { NotaFiscal } from '../../dados/tipos'

/**
 * Prévia da integração ao patrimônio.
 *
 * A confirmação vem depois de o operador ver **exatamente** o que será criado:
 * cada ativo, com o valor rateado e a garantia calculada. É deliberado — a
 * integração é irreversível (a nota fica selada, RN-L01) e criar cento e poucos
 * ativos com valor errado custa uma correção manual em cada um.
 *
 * O rodapé mostra a soma do rateio ao lado do custo de aquisição da nota. Se
 * divergissem, a integração seria recusada; mostrá-los lado a lado é o que
 * torna a garantia verificável por quem confirma, e não só por quem programou.
 */

interface Props {
  nota: NotaFiscal
  aoFechar: () => void
}

export function FormIntegrarNota({ nota, aoFechar }: Props) {
  const { avisar } = useToast()
  const { usuario } = useSessao()
  const navegar = useNavigate()
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<FalhaComando | null>(null)

  const previstas = previaIntegracao(nota)
  const custo = custoAquisicao(nota)
  const soma = previstas.reduce((s, u) => s + u.valorAquisicao, 0)
  const fecha = Math.abs(soma - custo) < 0.005
  const acessorio = custo - nota.valorProdutos

  async function confirmar() {
    setEnviando(true)
    setErro(null)
    const r = await api.integrarNota(nota.id, usuario.nome)
    setEnviando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    avisar({
      tom: 'ok',
      titulo: `${r.valor.criados.length} ativo(s) criados no patrimônio`,
      texto: `Nota ${nota.serie}/${nota.numero} · todos disponíveis na filial de destino.`,
    })
    aoFechar()
    navegar('/parque')
  }

  return (
    <Dialogo
      titulo={`Integrar ao patrimônio · nota ${nota.serie}/${nota.numero}`}
      descricao="Depois de integrada, a nota não aceita mais alteração: os ativos passam a carregar o valor de aquisição e a garantia que ela definiu."
      aoFechar={aoFechar}
      largura="largo"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={enviando}>
            Cancelar
          </Botao>
          <Botao
            variante="primario"
            onClick={confirmar}
            disabled={enviando || !fecha}
            motivoDesabilitado={fecha ? undefined : 'O rateio não fecha com o custo da nota'}
          >
            {enviando ? 'Integrando…' : `Criar ${previstas.length} ativo(s)`}
          </Botao>
        </>
      }
    >
      <div className="pilha g4">
        {erro && (
          <div className="aviso aviso--critico" role="alert">
            <span aria-hidden="true">⛔</span>
            <div>
              <p className="aviso__titulo">{erro.mensagem}</p>
              {erro.acoes && erro.acoes.length > 0 && (
                <ul>
                  {erro.acoes.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="aviso aviso--info" role="note">
          <span aria-hidden="true">◧</span>
          <div>
            <p className="aviso__titulo">
              Como o valor de cada ativo é calculado
            </p>
            <p>
              Custo de aquisição da nota ({moeda(custo)}) = total ({moeda(nota.valorTotal)})
              {nota.icmsRecuperavel && ` − ICMS creditado (${moeda(nota.valorIcms)})`}
              {nota.ipiRecuperavel && ` − IPI creditado (${moeda(nota.valorIpi)})`}. O acessório de{' '}
              {moeda(acessorio)} — frete, seguro, ST, IPI e despesas, menos desconto e créditos — é rateado
              proporcionalmente ao valor de cada item. O resíduo de arredondamento vai inteiro para a primeira
              unidade, para a soma fechar exatamente.
            </p>
          </div>
        </div>

        <Rolagem rotulo="Tabela de dados">
          <table>
            <caption className="so-leitor">
              Ativos que serão criados a partir da nota {nota.serie}/{nota.numero}
            </caption>
            <thead>
              <tr>
                <th scope="col">Patrimônio</th>
                <th scope="col">Série</th>
                <th scope="col">Modelo</th>
                <th scope="col" className="numerico">
                  Valor de aquisição
                </th>
                <th scope="col">Garantia até</th>
              </tr>
            </thead>
            <tbody>
              {previstas.map((u) => (
                <tr key={u.serieId}>
                  <th scope="row" className="dado">
                    {u.patrimonio}
                  </th>
                  <td className="dado">{u.numeroSerie}</td>
                  <td>
                    {modeloPorId.get(u.modeloId)?.nome ?? '—'}
                    <br />
                    <span className="texto-atenuado">item {u.numeroItem}</span>
                  </td>
                  <td className="numerico dado">{moeda(u.valorAquisicao)}</td>
                  <td>
                    {u.garantiaAte ? (
                      data(u.garantiaAte)
                    ) : (
                      <span className="texto-atenuado">não informada</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Soma do rateio
                </th>
                <td className="numerico dado">{moeda(soma)}</td>
                <td>
                  {fecha ? (
                    <Chip severidade="disponivel">Fecha com a nota</Chip>
                  ) : (
                    <Chip severidade="critico">Diverge de {moeda(Math.abs(soma - custo))}</Chip>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </Rolagem>

        <p className="texto-atenuado">
          Todos nascem <Chip severidade="disponivel">Disponível</Chip> na filial de destino, sem contrato. Alocar é
          decisão comercial, não consequência da compra.
        </p>
      </div>
    </Dialogo>
  )
}
