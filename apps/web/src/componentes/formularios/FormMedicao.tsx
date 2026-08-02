import { api } from '../../dados/api'
import { categoriaPorCodigo, nomeModelo } from '../../dados/catalogo'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { inteiro } from '../../lib/formato'
import { Botao } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { AreaTexto, CampoNumero, GrupoOpcoes, LinhaCampos, ResumoErros } from '../ui/formulario'
import type { Equipamento } from '../../dados/tipos'

/**
 * Tratativa de pendência de medição no fechamento.
 *
 * A estimativa existe porque o fechamento não pode parar por um ativo sem
 * leitura — mas ela substitui um fato por uma projeção, e por isso exige
 * justificativa e fica marcada. Sem a marca, a estimativa vira o caminho fácil,
 * ninguém mais coleta leitura, e em três meses a receita medida é ficção.
 *
 * A opção de estimativa mostra o valor projetado antes de ser escolhida: quem
 * decide precisa ver o que vai ser cobrado do cliente.
 */

interface Props {
  equipamento: Equipamento
  competencia: string
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  origem: 'LEITURA' | 'ESTIMATIVA'
  mono: number
  color: number
  justificativa: string
}

export function FormMedicao({ equipamento, competencia, aoFechar }: Props) {
  const { avisar } = useToast()
  const categoria = categoriaPorCodigo.get(equipamento.categoria)
  const temColor = categoria?.temContadorColor ?? false

  const historico = equipamento.historicoConsumo
  const mediaMono = historico.length ? Math.round(historico.reduce((s, h) => s + h.mono, 0) / historico.length) : 0
  const mediaColor = historico.length ? Math.round(historico.reduce((s, h) => s + h.color, 0) / historico.length) : 0

  const form = useFormulario<Valores, { origem: string }>({
    inicial: {
      origem: 'LEITURA',
      mono: equipamento.contadorMono,
      color: equipamento.contadorColor,
      justificativa: '',
    },
    validar: (v) => ({
      mono:
        v.origem === 'LEITURA' && v.mono < equipamento.contadorMono
          ? `Menor que a leitura anterior (${inteiro(equipamento.contadorMono)}). O contador não retrocede.`
          : undefined,
      color:
        v.origem === 'LEITURA' && temColor && v.color < equipamento.contadorColor
          ? `Menor que a leitura anterior (${inteiro(equipamento.contadorColor)}).`
          : undefined,
      justificativa:
        v.origem === 'ESTIMATIVA' && v.justificativa.trim().length < 10
          ? 'Estimativa exige justificativa: ela substitui um fato por uma projeção.'
          : undefined,
    }),
    aoEnviar: (v) =>
      api.resolverMedicao(equipamento.id, competencia, {
        origem: v.origem,
        mono: v.mono,
        color: v.color,
        justificativa: v.justificativa,
      }),
    aoConcluir: (r) => {
      avisar({
        tom: r.origem === 'ESTIMATIVA' ? 'atencao' : 'ok',
        titulo: `Medição de ${equipamento.patrimonio} resolvida`,
        texto:
          r.origem === 'ESTIMATIVA'
            ? `Estimada em ${inteiro(mediaMono)} páginas. O item sai marcado na fatura.`
            : `Leitura registrada para ${competencia}.`,
      })
      aoFechar()
    },
  })

  const estimando = form.valores.origem === 'ESTIMATIVA'
  const consumoMono = Math.max(0, form.valores.mono - equipamento.contadorMono)

  return (
    <Dialogo
      titulo={`Pendência de medição · ${equipamento.patrimonio}`}
      descricao={`${nomeModelo(equipamento.modeloId)} · competência ${competencia}`}
      aoFechar={aoFechar}
      largura="medio"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao
            variante={estimando ? 'perigo' : 'primario'}
            onClick={() => form.enviar()}
            disabled={form.enviando}
          >
            {form.enviando ? 'Aplicando…' : estimando ? 'Estimar e liberar' : 'Registrar leitura'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ mono: 'Contador mono', color: 'Contador color', justificativa: 'Justificativa' }}
          refResumo={form.refResumo}
        />

        <p className="aviso aviso--atencao" role="note">
          <span aria-hidden="true">▲</span>
          <span className="crescer">
            Este item bloqueia o fechamento de {competencia}. Enquanto não houver medição, a fatura do contrato não pode
            ser emitida.
          </span>
        </p>

        <GrupoOpcoes
          legenda="Origem da medição"
          valor={form.valores.origem}
          aoMudar={(v) => form.definir('origem', v as Valores['origem'])}
          opcoes={[
            { valor: 'LEITURA', texto: 'Leitura coletada', detalhe: 'valor lido no painel do equipamento' },
            {
              valor: 'ESTIMATIVA',
              texto: 'Estimativa pela média',
              detalhe: `projeta ${inteiro(mediaMono)} páginas mono${temColor ? ` e ${inteiro(mediaColor)} color` : ''}`,
            },
          ]}
        />

        {!estimando ? (
          <>
            <LinhaCampos>
              <CampoNumero
                nome="mono"
                rotulo="Contador mono"
                dica={`Anterior: ${inteiro(equipamento.contadorMono)}`}
                sufixo="pág"
                min={equipamento.contadorMono}
                valor={form.valores.mono}
                aoMudar={(v) => form.definir('mono', v)}
                {...form.campo('mono')}
              />
              {temColor && (
                <CampoNumero
                  nome="color"
                  rotulo="Contador color"
                  dica={`Anterior: ${inteiro(equipamento.contadorColor)}`}
                  sufixo="pág"
                  min={equipamento.contadorColor}
                  valor={form.valores.color}
                  aoMudar={(v) => form.definir('color', v)}
                  {...form.campo('color')}
                />
              )}
            </LinhaCampos>

            <p className="texto-secundario" role="status" aria-live="polite">
              Consumo do período: <strong className="dado">{inteiro(consumoMono)} páginas</strong>
              {mediaMono > 0 && ` · média histórica ${inteiro(mediaMono)}`}
            </p>
          </>
        ) : (
          <>
            <div className="cartao cartao--compacto">
              <dl className="pares">
                <div>
                  <dt>Páginas mono a cobrar</dt>
                  <dd className="dado">{inteiro(mediaMono)}</dd>
                </div>
                {temColor && (
                  <div>
                    <dt>Páginas color a cobrar</dt>
                    <dd className="dado">{inteiro(mediaColor)}</dd>
                  </div>
                )}
                <div>
                  <dt>Base do cálculo</dt>
                  <dd>média de {historico.length} competência(s) medida(s)</dd>
                </div>
              </dl>
            </div>

            <AreaTexto
              nome="justificativa"
              rotulo="Justificativa da estimativa"
              dica="Por que a leitura não foi coletada. O item sai marcado na fatura e entra no relatório de exceções."
              limite={300}
              value={form.valores.justificativa}
              onChange={(e) => form.definir('justificativa', e.target.value)}
              {...form.campo('justificativa')}
            />
          </>
        )}
      </form>
    </Dialogo>
  )
}
