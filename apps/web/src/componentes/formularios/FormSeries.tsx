import { useMemo, useState } from 'react'
import { api } from '../../dados/api'
import { proximoPatrimonio } from '../../dados/comandos'
import { modeloPorId } from '../../dados/catalogo'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { Botao, Entrada } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { LinhaCampos, ResumoErros } from '../ui/formulario'
import type { DadosSerie } from '../../dados/comandos'
import type { NotaFiscal, NotaFiscalItem } from '../../dados/tipos'

/**
 * Identificação das unidades de um item da nota.
 *
 * Uma linha por unidade física, porque é assim que a mercadoria chega: são
 * `quantidade` caixas, cada uma com uma etiqueta de série própria, e cada uma
 * vira um ativo com patrimônio próprio. Um campo de texto com "as séries
 * separadas por vírgula" seria mais curto de programar e impossível de conferir.
 *
 * O patrimônio é pré-preenchido pela sequência da operação e continua editável:
 * quem já tem etiqueta impressa precisa digitar a dela, e quem não tem precisa
 * de uma sugestão que não colida. Ambas as necessidades são reais.
 */

interface Props {
  nota: NotaFiscal
  item: NotaFiscalItem
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  unidades: DadosSerie[]
}

export function FormSeries({ nota, item, aoFechar }: Props) {
  const { avisar } = useToast()
  const modelo = modeloPorId.get(item.modeloId)

  const [inicial] = useState<DadosSerie[]>(() => {
    if (item.series.length === item.quantidade) {
      return item.series.map((s) => ({ numeroSerie: s.numeroSerie, patrimonio: s.patrimonio }))
    }
    // Continua de onde parou: as unidades já bipadas ficam, as que faltam
    // entram com o patrimônio sugerido. Recomeçar do zero obrigaria a redigitar
    // o que já estava certo.
    const base = Number(proximoPatrimonio(api.baseSincrona()))
    return Array.from({ length: item.quantidade }, (_, i) => {
      const existente = item.series[i]
      return existente
        ? { numeroSerie: existente.numeroSerie, patrimonio: existente.patrimonio }
        : { numeroSerie: '', patrimonio: String(base + i - item.series.length) }
    })
  })

  const form = useFormulario<Valores, NotaFiscalItem>({
    inicial: { unidades: inicial },
    validar: (v) => {
      const erros: Record<string, string> = {}
      const vistas = new Map<string, number>()
      v.unidades.forEach((u, i) => {
        const s = u.numeroSerie.trim().toUpperCase()
        if (!u.numeroSerie.trim()) erros[`serie-${i}`] = 'Informe a série.'
        else if (vistas.has(s)) {
          // Leitor de código de barras lendo a mesma etiqueta duas vezes é o
          // acidente mais comum aqui — e significa uma caixa não conferida.
          erros[`serie-${i}`] = `Repetida da unidade ${vistas.get(s)! + 1}.`
        } else vistas.set(s, i)

        if (!u.patrimonio.trim()) erros[`patrimonio-${i}`] = 'Informe o patrimônio.'
      })
      return erros as Record<keyof Valores & string, string>
    },
    aoEnviar: (v) => api.definirSeriesItem(nota.id, item.id, v.unidades),
    aoConcluir: (atualizado) => {
      avisar({
        tom: 'ok',
        titulo: `Item ${atualizado.numeroItem}: ${atualizado.series.length} unidade(s) identificada(s)`,
        texto: modelo?.nome ?? atualizado.descricaoNf,
      })
      aoFechar()
    },
  })

  const preenchidas = form.valores.unidades.filter((u) => u.numeroSerie.trim() && u.patrimonio.trim()).length

  const rotulos = useMemo(() => {
    const r: Record<string, string> = {}
    for (let i = 0; i < item.quantidade; i++) {
      r[`serie-${i}`] = `Série da unidade ${i + 1}`
      r[`patrimonio-${i}`] = `Patrimônio da unidade ${i + 1}`
    }
    return r
  }, [item.quantidade])

  function definirUnidade(indice: number, mudanca: Partial<DadosSerie>) {
    form.definir(
      'unidades',
      form.valores.unidades.map((u, j) => (j === indice ? { ...u, ...mudanca } : u)),
    )
  }

  return (
    <Dialogo
      titulo={`Identificar unidades · item ${item.numeroItem}`}
      descricao={`${item.quantidade} unidade(s) de ${modelo?.nome ?? item.descricaoNf}. Cada uma vira um ativo com patrimônio próprio.`}
      aoFechar={aoFechar}
      largura="largo"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Salvando…' : `Salvar ${item.quantidade} unidade(s)`}
          </Botao>
        </>
      }
    >
      <div className="pilha g4">
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={rotulos}
          refResumo={form.refResumo}
        />

        <p className="texto-secundario medida-leitura">
          {preenchidas} de {item.quantidade} preenchidas. A nota só passa à conferência com todas identificadas — é o
          que impede que ela vire patrimônio antes de alguém ter aberto as caixas.
        </p>

        <div className="pilha g3">
          {form.valores.unidades.map((u, i) => (
            <LinhaCampos key={`unidade-${i}`}>
              <Entrada
                nome={`serie-${i}`}
                rotulo={`Série da unidade ${i + 1}`}
                dica={i === 0 ? 'Leitor de código de barras preenche este campo.' : undefined}
                value={u.numeroSerie}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => definirUnidade(i, { numeroSerie: e.target.value })}
                {...form.campo(`serie-${i}` as keyof Valores & string)}
              />
              <Entrada
                nome={`patrimonio-${i}`}
                rotulo={`Patrimônio da unidade ${i + 1}`}
                dica={i === 0 ? 'Sugerido pela sequência da operação; edite se a etiqueta já existe.' : undefined}
                value={u.patrimonio}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => definirUnidade(i, { patrimonio: e.target.value })}
                {...form.campo(`patrimonio-${i}` as keyof Valores & string)}
              />
            </LinhaCampos>
          ))}
        </div>
      </div>
    </Dialogo>
  )
}
