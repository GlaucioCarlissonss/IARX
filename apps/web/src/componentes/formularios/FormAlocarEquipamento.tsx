import { useEffect, useMemo } from 'react'
import { api } from '../../dados/api'
import { equipamentosLivresEm } from '../../dados/comandos'
import { categoriaPorCodigo, modeloPorId, nomeModelo } from '../../dados/catalogo'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { inteiro, moeda } from '../../lib/formato'
import { Botao, Entrada } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { CampoMoeda, CampoNumero, Combo, GrupoOpcoes, LinhaCampos, ResumoErros } from '../ui/formulario'
import type { Contrato, ContratoItem, ModalidadeCobranca } from '../../dados/tipos'

/**
 * Alocação de equipamento a contrato — o formulário que exercita RN-001.
 *
 * A ordem dos campos é a regra: **período primeiro, equipamento depois**. Com
 * o período definido, a lista de ativos já mostra quem está livre nele e
 * desabilita quem não está, com o motivo. O caminho inverso — escolher o ativo
 * e só descobrir o conflito ao salvar — é o que produz a recusa frustrante.
 *
 * Mesmo assim a verificação no comando permanece: entre carregar a lista e
 * enviar o formulário, outro operador pode ter alocado o mesmo ativo. A lista
 * reduz o erro; quem garante é a checagem na escrita (no sistema real, uma
 * exclusion constraint do PostgreSQL).
 */

interface Props {
  contrato: Contrato
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  vigenciaInicio: string
  vigenciaFim: string
  equipamentoId: string
  modalidade: ModalidadeCobranca
  valorMensal: number
  franquiaMono: number
  franquiaColor: number
  precoExcedenteMono: number
  precoExcedenteColor: number
}

const ROTULOS = {
  vigenciaInicio: 'Início da vigência do item',
  vigenciaFim: 'Fim da vigência do item',
  equipamentoId: 'Equipamento',
  valorMensal: 'Valor mensal',
  franquiaMono: 'Franquia mono',
  precoExcedenteMono: 'Excedente mono',
}

export function FormAlocarEquipamento({ contrato, aoFechar }: Props) {
  const base = api.baseSincrona()
  const { avisar } = useToast()

  const form = useFormulario<Valores, ContratoItem>({
    inicial: {
      // Herda a vigência do contrato: o caso comum é o item durar o contrato
      // inteiro, e redigitar as duas datas é trabalho sem informação nova.
      vigenciaInicio: contrato.dataInicio,
      vigenciaFim: contrato.dataFim,
      equipamentoId: '',
      modalidade: 'FRANQUIA_EXCEDENTE',
      valorMensal: 0,
      franquiaMono: 0,
      franquiaColor: 0,
      precoExcedenteMono: 0,
      precoExcedenteColor: 0,
    },
    validar: (v) => ({
      vigenciaInicio: v.vigenciaInicio ? undefined : 'Informe o início da vigência.',
      vigenciaFim: !v.vigenciaFim
        ? undefined
        : v.vigenciaFim <= v.vigenciaInicio
          ? 'O fim precisa ser posterior ao início.'
          : undefined,
      equipamentoId: v.equipamentoId ? undefined : 'Escolha o equipamento a alocar.',
      valorMensal: v.valorMensal > 0 ? undefined : 'Informe o valor mensal contratado.',
      franquiaMono:
        v.modalidade === 'FRANQUIA_EXCEDENTE' && v.franquiaMono <= 0
          ? 'Franquia com excedente exige uma franquia de páginas maior que zero.'
          : undefined,
      precoExcedenteMono:
        v.modalidade === 'FRANQUIA_EXCEDENTE' && v.precoExcedenteMono <= 0
          ? 'Informe o preço por página excedente.'
          : undefined,
    }),
    aoEnviar: (v) =>
      api.alocarEquipamento(contrato.id, {
        equipamentoId: v.equipamentoId,
        modalidade: v.modalidade,
        valorMensal: v.valorMensal,
        franquiaMono: v.modalidade === 'FRANQUIA_EXCEDENTE' ? v.franquiaMono : null,
        franquiaColor: v.modalidade === 'FRANQUIA_EXCEDENTE' && v.franquiaColor > 0 ? v.franquiaColor : null,
        precoExcedenteMono: v.modalidade === 'FRANQUIA_EXCEDENTE' ? v.precoExcedenteMono : null,
        precoExcedenteColor:
          v.modalidade === 'FRANQUIA_EXCEDENTE' && v.precoExcedenteColor > 0 ? v.precoExcedenteColor : null,
        vigenciaInicio: v.vigenciaInicio,
        vigenciaFim: v.vigenciaFim || null,
      }),
    aoConcluir: (item) => {
      const eq = base.equipamentos.find((e) => e.id === item.equipamentoId)
      avisar({
        tom: 'ok',
        titulo: `Patrimônio ${eq?.patrimonio} alocado`,
        texto: `${contrato.numero} · ${moeda(item.valorMensal)}/mês · item ${item.status.toLowerCase()}`,
      })
      aoFechar()
    },
  })

  const periodo = { inicio: form.valores.vigenciaInicio, fim: form.valores.vigenciaFim || null }

  /**
   * Todos os ativos, com os ocupados desabilitados e o motivo visível.
   * Recalculado quando o período muda — é o que torna a escolha informada.
   */
  const opcoesEquipamento = useMemo(() => {
    const livres = new Set(equipamentosLivresEm(base, periodo).map((e) => e.id))
    return base.equipamentos
      .filter((e) => e.status !== 'BAIXADO' && e.status !== 'EXTRAVIADO')
      .map((e) => {
        const conflito = base.contratos
          .flatMap((c) => c.itens.map((i) => ({ c, i })))
          .find(
            ({ i }) =>
              i.equipamentoId === e.id && ['RESERVADO', 'ATIVO', 'SUSPENSO'].includes(i.status) && !livres.has(e.id),
          )
        const motivo = e.bloqueado
          ? `Bloqueado: ${e.bloqueioMotivo ?? 'sem motivo registrado'}`
          : conflito
            ? `No contrato ${conflito.c.numero}${conflito.i.vigenciaFim ? ` até ${conflito.i.vigenciaFim}` : ''}`
            : undefined
        return {
          valor: e.id,
          texto: `${e.patrimonio} · ${nomeModelo(e.modeloId)}`,
          detalhe: `${categoriaPorCodigo.get(e.categoria)?.nome} · ${e.numeroSerie}`,
          desabilitada: !livres.has(e.id),
          motivoDesabilitada: motivo,
        }
      })
      .sort((a, b) => Number(a.desabilitada) - Number(b.desabilitada))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, form.valores.vigenciaInicio, form.valores.vigenciaFim])

  const equipamento = base.equipamentos.find((e) => e.id === form.valores.equipamentoId)
  const modelo = equipamento ? modeloPorId.get(equipamento.modeloId) : null
  const categoria = equipamento ? categoriaPorCodigo.get(equipamento.categoria) : null

  /**
   * Escolher o ativo preenche preço e franquia com a tabela do modelo.
   * Sugestão, não imposição: os campos continuam editáveis, porque desconto
   * negociado é a regra e não a exceção neste mercado.
   */
  useEffect(() => {
    if (!modelo) return
    form.definir('valorMensal', modelo.precoMensal)
    form.definir('franquiaMono', modelo.franquiaMono ?? 0)
    form.definir('franquiaColor', modelo.franquiaColor ?? 0)
    form.definir('precoExcedenteMono', modelo.precoExcedenteMono ?? 0)
    form.definir('precoExcedenteColor', modelo.precoExcedenteColor ?? 0)
    // Sem medidor não existe franquia: computadores são mensalidade fixa.
    form.definir('modalidade', categoria?.temContador ? 'FRANQUIA_EXCEDENTE' : 'FIXO_MENSAL')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelo?.id])

  const temContador = categoria?.temContador ?? false
  const temColor = categoria?.temContadorColor ?? false
  const franquia = form.valores.modalidade === 'FRANQUIA_EXCEDENTE'

  return (
    <Dialogo
      titulo={`Alocar equipamento · ${contrato.numero}`}
      descricao="Defina o período primeiro: a lista de ativos passa a mostrar quem está livre nele."
      aoFechar={aoFechar}
      largura="largo"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Alocando…' : 'Alocar equipamento'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros erros={form.errosResumo} erroGeral={form.erroGeral} rotulos={ROTULOS} refResumo={form.refResumo} />

        <LinhaCampos>
          <Entrada
            nome="vigenciaInicio"
            rotulo="Início da vigência do item"
            type="date"
            dica={`Contrato vigente de ${contrato.dataInicio} a ${contrato.dataFim}.`}
            value={form.valores.vigenciaInicio}
            onChange={(e) => form.definir('vigenciaInicio', e.target.value)}
            {...form.campo('vigenciaInicio')}
          />
          <Entrada
            nome="vigenciaFim"
            rotulo="Fim da vigência do item"
            type="date"
            min={form.valores.vigenciaInicio}
            dica="Vazio para vigência aberta."
            value={form.valores.vigenciaFim}
            onChange={(e) => form.definir('vigenciaFim', e.target.value)}
            {...form.campo('vigenciaFim')}
          />
        </LinhaCampos>

        <Combo
          nome="equipamentoId"
          rotulo="Equipamento"
          dica="Ativos ocupados no período aparecem desabilitados, com o contrato que os ocupa."
          opcoes={opcoesEquipamento}
          valor={form.valores.equipamentoId}
          aoMudar={(v) => form.definir('equipamentoId', v)}
          {...form.campo('equipamentoId')}
        />

        {equipamento && modelo && (
          <div className="cartao cartao--compacto">
            <dl className="pares">
              <div>
                <dt>Modelo</dt>
                <dd>{modelo.nome}</dd>
              </div>
              <div>
                <dt>Tabela</dt>
                <dd className="dado">{moeda(modelo.precoMensal)}/mês</dd>
              </div>
              <div>
                <dt>Medição</dt>
                <dd>
                  {temContador
                    ? `Contador de páginas${temColor ? ' mono e color' : ' mono'}`
                    : 'Sem contador — cobrança fixa'}
                </dd>
              </div>
            </dl>
          </div>
        )}

        <GrupoOpcoes
          legenda="Modalidade de cobrança"
          dica={temContador ? undefined : 'Equipamentos sem contador só admitem valor fixo mensal.'}
          valor={form.valores.modalidade}
          aoMudar={(v) => form.definir('modalidade', v as ModalidadeCobranca)}
          opcoes={
            temContador
              ? [
                  { valor: 'FRANQUIA_EXCEDENTE', texto: 'Franquia + excedente', detalhe: 'páginas incluídas e preço além' },
                  { valor: 'FIXO_MENSAL', texto: 'Fixo mensal', detalhe: 'sem medição de páginas' },
                  { valor: 'POR_PAGINA', texto: 'Por página', detalhe: 'sem mínimo, tudo medido' },
                ]
              : [{ valor: 'FIXO_MENSAL', texto: 'Fixo mensal', detalhe: 'única modalidade sem contador' }]
          }
        />

        <LinhaCampos>
          <CampoMoeda
            nome="valorMensal"
            rotulo="Valor mensal"
            dica={modelo ? `Tabela: ${moeda(modelo.precoMensal)}. Editável para desconto negociado.` : undefined}
            valor={form.valores.valorMensal}
            aoMudar={(v) => form.definir('valorMensal', v)}
            {...form.campo('valorMensal')}
          />
          {modelo && form.valores.valorMensal > 0 && form.valores.valorMensal < modelo.precoMensal && (
            <p className="aviso aviso--atencao" role="status">
              <span aria-hidden="true">▲</span>
              <span className="crescer">
                Desconto de {(((modelo.precoMensal - form.valores.valorMensal) / modelo.precoMensal) * 100).toFixed(1)}%
                sobre a tabela. Acima de 15% exige alçada comercial.
              </span>
            </p>
          )}
        </LinhaCampos>

        {franquia && (
          <>
            <LinhaCampos>
              <CampoNumero
                nome="franquiaMono"
                rotulo="Franquia mono"
                sufixo="pág/mês"
                min={0}
                valor={form.valores.franquiaMono}
                aoMudar={(v) => form.definir('franquiaMono', v)}
                {...form.campo('franquiaMono')}
              />
              <CampoMoeda
                nome="precoExcedenteMono"
                rotulo="Excedente mono"
                dica="Preço por página além da franquia."
                valor={form.valores.precoExcedenteMono}
                aoMudar={(v) => form.definir('precoExcedenteMono', v)}
                {...form.campo('precoExcedenteMono')}
              />
            </LinhaCampos>

            {temColor && (
              <LinhaCampos>
                <CampoNumero
                  nome="franquiaColor"
                  rotulo="Franquia color"
                  sufixo="pág/mês"
                  min={0}
                  valor={form.valores.franquiaColor}
                  aoMudar={(v) => form.definir('franquiaColor', v)}
                />
                <CampoMoeda
                  nome="precoExcedenteColor"
                  rotulo="Excedente color"
                  valor={form.valores.precoExcedenteColor}
                  aoMudar={(v) => form.definir('precoExcedenteColor', v)}
                />
              </LinhaCampos>
            )}

            {/* Projeção com a franquia cheia: mostra o piso da receita do item
                antes de qualquer excedente. */}
            <div className="cartao cartao--compacto" role="status" aria-live="polite">
              <p className="texto-secundario">
                Receita mínima do item: <strong className="dado">{moeda(form.valores.valorMensal)}</strong> por mês,
                cobrindo {inteiro(form.valores.franquiaMono)} páginas mono
                {temColor && form.valores.franquiaColor > 0 && ` e ${inteiro(form.valores.franquiaColor)} color`}. Cada
                página além custa {moeda(form.valores.precoExcedenteMono)}.
              </p>
            </div>
          </>
        )}
      </form>
    </Dialogo>
  )
}
