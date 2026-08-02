import { useMemo, useState } from 'react'
import { api } from '../../dados/api'
import { nomeModelo } from '../../dados/catalogo'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { inteiro, moeda } from '../../lib/formato'
import { Botao, Chip } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { AreaTexto, CampoNumero, Combo, LinhaCampos, ResumoErros } from '../ui/formulario'
import type { OrdemServico } from '../../dados/tipos'

/**
 * Conclusão de chamado com apontamento.
 *
 * Duas coisas acontecem juntas aqui, e é essencial que sejam a mesma operação:
 * o chamado é encerrado e as peças usadas saem do estoque. Separar em dois
 * passos produz o estado que ninguém percebe — chamado concluído com peça
 * consumida que continua no saldo até o inventário seguinte.
 *
 * O custo aparece calculado enquanto o técnico preenche. Ver o número subir a
 * cada peça é o que faz alguém reparar que colocou 10 toners em vez de 1.
 */

interface Props {
  ordem: OrdemServico
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  causaRaiz: string
  minutosApontados: number
}

const ROTULOS = { causaRaiz: 'Causa raiz', minutosApontados: 'Tempo apontado' }
const CUSTO_HORA = 92

export function FormConcluirChamado({ ordem, aoFechar }: Props) {
  const base = api.baseSincrona()
  const { avisar } = useToast()

  // Peças ficam fora do `useFormulario` porque são uma lista dinâmica, não
  // campos fixos; o hook cuida do que tem nome estável.
  const [pecas, setPecas] = useState<{ pecaId: string; quantidade: number }[]>([])
  const [pecaEscolhida, setPecaEscolhida] = useState('')

  const equipamento = base.equipamentos.find((e) => e.id === ordem.equipamentoId)
  const tecnico = base.tecnicos.find((t) => t.id === ordem.tecnicoId)

  const aplicaveis = useMemo(
    () =>
      base.pecas
        .filter((p) => !equipamento || p.aplicacao.includes(equipamento.categoria))
        .map((p) => {
          const disponivel = p.saldo - p.reservado
          return {
            valor: p.id,
            texto: `${p.codigo} · ${p.descricao}`,
            detalhe: `${disponivel} ${p.unidade} disponível · ${moeda(p.custoMedio)}`,
            desabilitada: disponivel <= 0 || pecas.some((u) => u.pecaId === p.id),
            motivoDesabilitada:
              disponivel <= 0 ? 'Sem saldo disponível' : pecas.some((u) => u.pecaId === p.id) ? 'Já adicionada' : undefined,
          }
        }),
    [base.pecas, equipamento, pecas],
  )

  const custoPecas = pecas.reduce((s, u) => {
    const p = base.pecas.find((x) => x.id === u.pecaId)
    return s + (p ? p.custoMedio * u.quantidade : 0)
  }, 0)

  const form = useFormulario<Valores, OrdemServico>({
    inicial: { causaRaiz: '', minutosApontados: 60 },
    validar: (v) => ({
      causaRaiz:
        v.causaRaiz.trim().length >= 10
          ? undefined
          : 'Registre a causa raiz: é ela que alimenta a análise de reincidência.',
      minutosApontados:
        v.minutosApontados > 0 && v.minutosApontados <= 24 * 60
          ? undefined
          : 'Informe o tempo real de atendimento, entre 1 minuto e 24 horas.',
    }),
    aoEnviar: (v) =>
      api.concluirChamado(ordem.id, {
        causaRaiz: v.causaRaiz,
        minutosApontados: v.minutosApontados,
        pecas,
      }),
    aoConcluir: (o) => {
      avisar({
        tom: 'ok',
        titulo: `Chamado ${o.numero} concluído`,
        texto:
          pecas.length > 0
            ? `${pecas.length} peça(s) baixada(s) do estoque · custo total ${moeda(o.custoMaoObra + o.custoPecas)}`
            : `Custo total ${moeda(o.custoMaoObra)}`,
      })
      aoFechar()
    },
  })

  const custoMaoObra = Math.round((form.valores.minutosApontados / 60) * CUSTO_HORA * 100) / 100

  function adicionar() {
    if (!pecaEscolhida) return
    setPecas((atual) => [...atual, { pecaId: pecaEscolhida, quantidade: 1 }])
    setPecaEscolhida('')
  }

  return (
    <Dialogo
      titulo={`Concluir ${ordem.numero}`}
      descricao="Concluir dá baixa nas peças usadas na mesma operação."
      aoFechar={aoFechar}
      largura="largo"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Concluindo…' : 'Concluir chamado'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros erros={form.errosResumo} erroGeral={form.erroGeral} rotulos={ROTULOS} refResumo={form.refResumo} />

        <div className="cartao cartao--compacto">
          <dl className="pares">
            <div>
              <dt>Equipamento</dt>
              <dd>
                <span className="dado">{equipamento?.patrimonio}</span> · {equipamento && nomeModelo(equipamento.modeloId)}
              </dd>
            </div>
            <div>
              <dt>Técnico</dt>
              <dd>{tecnico?.nome ?? 'não atribuído'}</dd>
            </div>
            <div>
              <dt>Sintoma</dt>
              <dd>{ordem.sintoma}</dd>
            </div>
          </dl>
        </div>

        <LinhaCampos>
          <AreaTexto
            nome="causaRaiz"
            rotulo="Causa raiz"
            dica="O que de fato causou o defeito — não o que foi feito."
            limite={240}
            value={form.valores.causaRaiz}
            onChange={(e) => form.definir('causaRaiz', e.target.value)}
            {...form.campo('causaRaiz')}
          />
          <CampoNumero
            nome="minutosApontados"
            rotulo="Tempo apontado"
            dica={`Mão de obra a ${moeda(CUSTO_HORA)}/hora.`}
            sufixo="min"
            min={1}
            max={1440}
            valor={form.valores.minutosApontados}
            aoMudar={(v) => form.definir('minutosApontados', v)}
            {...form.campo('minutosApontados')}
          />
        </LinhaCampos>

        <fieldset className="grupo-opcoes">
          <legend>Peças utilizadas</legend>

          <div className="linha g3 envolver alinhar-fim">
            <div className="crescer">
              <Combo
                nome="pecaNova"
                rotulo="Adicionar peça"
                dica="Apenas peças aplicáveis à categoria do equipamento."
                opcoes={aplicaveis}
                valor={pecaEscolhida}
                aoMudar={setPecaEscolhida}
              />
            </div>
            <Botao onClick={adicionar} disabled={!pecaEscolhida} motivoDesabilitado="Escolha uma peça primeiro">
              Adicionar
            </Botao>
          </div>

          {pecas.length === 0 ? (
            <p className="texto-atenuado">Nenhuma peça utilizada. Deixe vazio se o atendimento foi só de mão de obra.</p>
          ) : (
            <table>
              <caption className="so-leitor">Peças a baixar do estoque na conclusão</caption>
              <thead>
                <tr>
                  <th scope="col">Peça</th>
                  <th scope="col" className="numerico">
                    Quantidade
                  </th>
                  <th scope="col" className="numerico">
                    Custo
                  </th>
                  <th scope="col">
                    <span className="so-leitor">Remover</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pecas.map((u) => {
                  const p = base.pecas.find((x) => x.id === u.pecaId)
                  if (!p) return null
                  const disponivel = p.saldo - p.reservado
                  const excede = u.quantidade > disponivel
                  return (
                    <tr key={u.pecaId}>
                      <th scope="row">
                        <span className="dado">{p.codigo}</span>
                        <br />
                        <span className="texto-atenuado">{p.descricao}</span>
                        {excede && (
                          <>
                            <br />
                            <Chip severidade="critico">
                              Excede o disponível ({inteiro(disponivel)} {p.unidade})
                            </Chip>
                          </>
                        )}
                      </th>
                      <td className="numerico">
                        <label>
                          <span className="so-leitor">Quantidade de {p.codigo}</span>
                          <input
                            type="number"
                            min={1}
                            max={disponivel}
                            aria-invalid={excede || undefined}
                            value={u.quantidade}
                            style={{ width: 88 }}
                            onChange={(e) =>
                              setPecas((atual) =>
                                atual.map((x) =>
                                  x.pecaId === u.pecaId ? { ...x, quantidade: Number(e.target.value) || 0 } : x,
                                ),
                              )
                            }
                          />
                        </label>
                      </td>
                      <td className="numerico dado">{moeda(p.custoMedio * u.quantidade)}</td>
                      <td>
                        <Botao
                          variante="sutil"
                          pequeno
                          onClick={() => setPecas((atual) => atual.filter((x) => x.pecaId !== u.pecaId))}
                        >
                          Remover<span className="so-leitor"> {p.codigo}</span>
                        </Botao>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </fieldset>

        {/* Total recalculado ao vivo: é o que faz alguém notar 10 toners no
            lugar de 1 antes de confirmar. */}
        <div className="cartao cartao--compacto" role="status" aria-live="polite">
          <dl className="pares">
            <div>
              <dt>Mão de obra</dt>
              <dd className="dado">{moeda(custoMaoObra)}</dd>
            </div>
            <div>
              <dt>Peças</dt>
              <dd className="dado">{moeda(custoPecas)}</dd>
            </div>
            <div>
              <dt>Custo total do atendimento</dt>
              <dd className="dado" style={{ fontWeight: 700 }}>
                {moeda(custoMaoObra + custoPecas)}
              </dd>
            </div>
          </dl>
        </div>
      </form>
    </Dialogo>
  )
}
