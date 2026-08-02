import { useMemo } from 'react'
import { api } from '../../dados/api'
import { categoriaPorCodigo, regiaoPorId } from '../../dados/catalogo'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { Botao } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { Combo, ResumoErros } from '../ui/formulario'
import type { OrdemServico } from '../../dados/tipos'

/**
 * Atribuição de técnico.
 *
 * A lista mostra **todos** os técnicos, com os incompatíveis desabilitados e o
 * motivo à mostra. Filtrar em silêncio faria o supervisor procurar um nome que
 * ele sabe existir e não achar — e concluir que o sistema está quebrado.
 *
 * A carga atual aparece ao lado do nome porque é a informação que decide entre
 * dois técnicos igualmente habilitados.
 */

interface Props {
  ordem: OrdemServico
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  tecnicoId: string
}

export function FormAtribuirTecnico({ ordem, aoFechar }: Props) {
  const base = api.baseSincrona()
  const { avisar } = useToast()

  const equipamento = base.equipamentos.find((e) => e.id === ordem.equipamentoId)
  const categoria = equipamento ? categoriaPorCodigo.get(equipamento.categoria) : null

  const opcoes = useMemo(
    () =>
      base.tecnicos
        .map((t) => {
          const compativel = !categoria || t.especialidades.includes(categoria.familia)
          const mesmaRegiao = equipamento ? t.regiaoId === equipamento.regiaoId : true
          return {
            valor: t.id,
            texto: t.nome,
            detalhe: `${t.cargaAtual} na fila · ${regiaoPorId.get(t.regiaoId)?.nome ?? '—'}${mesmaRegiao ? '' : ' · outra região'}`,
            desabilitada: !compativel,
            motivoDesabilitada: compativel
              ? undefined
              : `Não atende ${categoria?.familia.toLowerCase()} — atende ${t.especialidades.join(', ').toLowerCase()}`,
            carga: t.cargaAtual,
            mesmaRegiao,
          }
        })
        // Compatíveis primeiro, depois mesma região, depois menor fila: a
        // ordem já é a recomendação.
        .sort((a, b) => {
          if (a.desabilitada !== b.desabilitada) return a.desabilitada ? 1 : -1
          if (a.mesmaRegiao !== b.mesmaRegiao) return a.mesmaRegiao ? -1 : 1
          return a.carga - b.carga
        }),
    [base.tecnicos, categoria, equipamento],
  )

  const form = useFormulario<Valores, OrdemServico>({
    inicial: { tecnicoId: ordem.tecnicoId ?? '' },
    validar: (v) => ({ tecnicoId: v.tecnicoId ? undefined : 'Escolha o técnico responsável.' }),
    aoEnviar: (v) => api.atribuirTecnico(ordem.id, v.tecnicoId),
    aoConcluir: (o) => {
      const t = base.tecnicos.find((x) => x.id === o.tecnicoId)
      avisar({ tom: 'ok', titulo: `${ordem.numero} atribuído a ${t?.nome ?? 'técnico'}`, texto: 'Chamado agendado.' })
      aoFechar()
    },
  })

  return (
    <Dialogo
      titulo={`Atribuir técnico · ${ordem.numero}`}
      descricao={categoria ? `Chamado de ${categoria.nome.toLowerCase()}.` : undefined}
      aoFechar={aoFechar}
      largura="estreito"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Atribuindo…' : 'Atribuir'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ tecnicoId: 'Técnico' }}
          refResumo={form.refResumo}
        />

        <Combo
          nome="tecnicoId"
          rotulo="Técnico"
          dica="Ordenados por compatibilidade, região e menor fila."
          opcoes={opcoes}
          valor={form.valores.tecnicoId}
          aoMudar={(v) => form.definir('tecnicoId', v)}
          {...form.campo('tecnicoId')}
        />
      </form>
    </Dialogo>
  )
}
