import { api } from '../../dados/api'
import { competenciaAtual } from '../../dados/comandos'
import { categoriaPorCodigo, nomeModelo } from '../../dados/catalogo'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { inteiro } from '../../lib/formato'
import { Botao, Selecao } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { CampoNumero, LinhaCampos, ResumoErros } from '../ui/formulario'
import type { Equipamento } from '../../dados/tipos'

/**
 * Registro de leitura de contador — RN-020.
 *
 * Contador de impressora é acumulado e físico: não anda para trás. O campo já
 * chega com o valor anterior visível, e o consumo do período aparece calculado
 * enquanto se digita — é assim que o operador percebe que trocou dois dígitos
 * antes de salvar, em vez de descobrir na contestação da fatura.
 *
 * A validação de monotonicidade também existe no comando, e não só aqui: o
 * formulário melhora a mensagem, o comando é quem garante.
 */

interface Props {
  equipamento: Equipamento
  /** Competência a fechar. Ausente usa a atual. */
  competencia?: string
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  competencia: string
  mono: number
  color: number
}

export function FormLeitura({ equipamento, competencia, aoFechar }: Props) {
  const base = api.baseSincrona()
  const { avisar } = useToast()
  const categoria = categoriaPorCodigo.get(equipamento.categoria)
  const temColor = categoria?.temContadorColor ?? false

  const form = useFormulario<Valores, Equipamento>({
    inicial: {
      competencia: competencia ?? competenciaAtual(),
      mono: equipamento.contadorMono,
      color: equipamento.contadorColor,
    },
    validar: (v) => ({
      mono:
        v.mono < equipamento.contadorMono
          ? `Menor que a leitura anterior (${inteiro(equipamento.contadorMono)}). O contador não retrocede.`
          : undefined,
      color:
        temColor && v.color < equipamento.contadorColor
          ? `Menor que a leitura anterior (${inteiro(equipamento.contadorColor)}).`
          : undefined,
      competencia: base.competencias.includes(v.competencia) || v.competencia === competenciaAtual()
        ? undefined
        : 'Competência fora do período aberto.',
    }),
    aoEnviar: (v) => api.registrarLeitura(equipamento.id, { competencia: v.competencia, mono: v.mono, color: v.color }),
    aoConcluir: () => {
      avisar({
        tom: 'ok',
        titulo: `Leitura de ${equipamento.patrimonio} registrada`,
        texto: `${inteiro(consumoMono)} páginas mono${temColor ? ` e ${inteiro(consumoColor)} color` : ''} em ${form.valores.competencia}.`,
      })
      aoFechar()
    },
  })

  const consumoMono = Math.max(0, form.valores.mono - equipamento.contadorMono)
  const consumoColor = temColor ? Math.max(0, form.valores.color - equipamento.contadorColor) : 0

  // Média dos últimos meses, para o operador reconhecer um salto absurdo.
  const historico = equipamento.historicoConsumo
  const media =
    historico.length > 0 ? Math.round(historico.reduce((s, h) => s + h.mono, 0) / historico.length) : null
  const desvio = media && media > 0 ? consumoMono / media : null
  const suspeito = desvio !== null && (desvio > 3 || (desvio < 0.2 && consumoMono > 0))

  if (!categoria?.temContador) {
    return (
      <Dialogo
        titulo={`Patrimônio ${equipamento.patrimonio}`}
        aoFechar={aoFechar}
        largura="estreito"
        acoes={<Botao onClick={aoFechar}>Fechar</Botao>}
      >
        <p className="aviso aviso--atencao">
          <span aria-hidden="true">▲</span>
          <span className="crescer">
            {categoria?.nome ?? 'Esta categoria'} não possui contador de páginas: a cobrança é fixa mensal e não há
            medição a registrar.
          </span>
        </p>
      </Dialogo>
    )
  }

  return (
    <Dialogo
      titulo={`Registrar leitura · ${equipamento.patrimonio}`}
      descricao={nomeModelo(equipamento.modeloId)}
      aoFechar={aoFechar}
      largura="medio"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Registrando…' : 'Registrar leitura'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ mono: 'Contador mono', color: 'Contador color', competencia: 'Competência' }}
          refResumo={form.refResumo}
        />

        <Selecao
          nome="competencia"
          rotulo="Competência"
          opcoes={[...base.competencias.slice(-3), competenciaAtual()]
            .filter((c, i, a) => a.indexOf(c) === i)
            .map((c) => ({ valor: c, texto: c }))}
          value={form.valores.competencia}
          onChange={(e) => form.definir('competencia', e.target.value)}
          {...form.campo('competencia')}
        />

        <LinhaCampos>
          <CampoNumero
            nome="mono"
            rotulo="Contador mono"
            dica={`Leitura anterior: ${inteiro(equipamento.contadorMono)}`}
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
              dica={`Leitura anterior: ${inteiro(equipamento.contadorColor)}`}
              sufixo="pág"
              min={equipamento.contadorColor}
              valor={form.valores.color}
              aoMudar={(v) => form.definir('color', v)}
              {...form.campo('color')}
            />
          )}
        </LinhaCampos>

        {/* Consumo derivado ao vivo: é o número que o operador reconhece como
            plausível ou não, muito mais que o acumulado. */}
        <div className="cartao cartao--compacto" role="status" aria-live="polite">
          <dl className="pares">
            <div>
              <dt>Consumo do período · mono</dt>
              <dd className="dado">{inteiro(consumoMono)} páginas</dd>
            </div>
            {temColor && (
              <div>
                <dt>Consumo do período · color</dt>
                <dd className="dado">{inteiro(consumoColor)} páginas</dd>
              </div>
            )}
            {media !== null && (
              <div>
                <dt>Média dos últimos meses</dt>
                <dd className="dado">{inteiro(media)} páginas</dd>
              </div>
            )}
          </dl>
        </div>

        {suspeito && (
          <p className="aviso aviso--atencao" role="status">
            <span aria-hidden="true">▲</span>
            <span className="crescer">
              Consumo {desvio! > 1 ? `${desvio!.toFixed(1)}× acima` : 'muito abaixo'} da média histórica. Confira os
              dígitos antes de registrar — a leitura alimenta a fatura e é difícil de estornar depois de emitida.
            </span>
          </p>
        )}
      </form>
    </Dialogo>
  )
}
