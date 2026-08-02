import { api } from '../../dados/api'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { moeda } from '../../lib/formato'
import { Botao } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { AreaTexto, GrupoOpcoes, ResumoErros } from '../ui/formulario'
import type { Cliente, SituacaoCredito } from '../../dados/tipos'

/**
 * Alteração da situação de crédito.
 *
 * Motivo obrigatório **nas duas direções**, inclusive na liberação. Bloquear é
 * uma decisão visível e raramente contestada; liberar um cliente inadimplente é
 * quem assume o risco, e é essa a decisão que a auditoria precisa conseguir
 * rastrear até uma pessoa.
 *
 * O impacto de cada opção aparece ao lado dela, porque "bloqueado" significa
 * coisas diferentes em sistemas diferentes — aqui significa que novos contratos
 * e novas alocações param, mas o que já está em campo continua faturando.
 */

interface Props {
  cliente: Cliente
  /** Exposição em aberto, para dimensionar a decisão. */
  emAberto?: number
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  situacao: SituacaoCredito
  motivo: string
}

export function FormCredito({ cliente, emAberto, aoFechar }: Props) {
  const { avisar } = useToast()

  const form = useFormulario<Valores, Cliente>({
    inicial: { situacao: cliente.situacaoCredito, motivo: '' },
    validar: (v) => ({
      situacao: v.situacao === cliente.situacaoCredito ? 'Escolha uma situação diferente da atual.' : undefined,
      motivo: v.motivo.trim().length >= 10 ? undefined : 'Descreva o motivo com pelo menos 10 caracteres.',
    }),
    aoEnviar: (v) => api.definirCredito(cliente.id, v.situacao, v.motivo),
    aoConcluir: (c) => {
      avisar({
        tom: c.situacaoCredito === 'BLOQUEADO' ? 'atencao' : 'ok',
        titulo: `${c.nomeFantasia}: crédito ${c.situacaoCredito.toLowerCase()}`,
        texto:
          c.situacaoCredito === 'BLOQUEADO'
            ? 'Novos contratos e alocações ficam impedidos até a regularização.'
            : 'A carteira volta a aceitar contratação.',
      })
      aoFechar()
    },
  })

  return (
    <Dialogo
      titulo={`Situação de crédito · ${cliente.nomeFantasia}`}
      descricao={
        emAberto !== undefined
          ? `${moeda(emAberto)} em aberto · atraso máximo de ${cliente.diasAtrasoMaximo} dias.`
          : `Atraso máximo de ${cliente.diasAtrasoMaximo} dias na carteira.`
      }
      aoFechar={aoFechar}
      largura="estreito"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao
            variante={form.valores.situacao === 'BLOQUEADO' ? 'perigo' : 'primario'}
            onClick={() => form.enviar()}
            disabled={form.enviando}
          >
            {form.enviando ? 'Aplicando…' : 'Aplicar'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ situacao: 'Situação', motivo: 'Motivo' }}
          refResumo={form.refResumo}
        />

        <GrupoOpcoes
          legenda="Nova situação"
          dica={`Situação atual: ${cliente.situacaoCredito.toLowerCase()}.`}
          erro={form.erros.situacao}
          valor={form.valores.situacao}
          aoMudar={(v) => form.definir('situacao', v as SituacaoCredito)}
          opcoes={[
            { valor: 'LIBERADO', texto: 'Liberado', detalhe: 'contrata e recebe novos ativos' },
            { valor: 'OBSERVACAO', texto: 'Em observação', detalhe: 'contrata, mas o financeiro é notificado' },
            {
              valor: 'BLOQUEADO',
              texto: 'Bloqueado',
              detalhe: 'sem novos contratos nem alocações; o parque em campo segue faturando',
            },
          ]}
        />

        <AreaTexto
          nome="motivo"
          rotulo="Motivo da alteração"
          dica={
            form.valores.situacao === 'LIBERADO'
              ? 'Liberar assume o risco: registre o acordo, o pagamento recebido ou a alçada que autorizou.'
              : 'Fica na trilha de auditoria com seu usuário e a data.'
          }
          limite={300}
          value={form.valores.motivo}
          onChange={(e) => form.definir('motivo', e.target.value)}
          {...form.campo('motivo')}
        />
      </form>
    </Dialogo>
  )
}
