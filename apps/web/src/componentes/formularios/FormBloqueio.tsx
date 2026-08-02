import { api } from '../../dados/api'
import { nomeModelo } from '../../dados/catalogo'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { Botao } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { AreaTexto, GrupoOpcoes, ResumoErros } from '../ui/formulario'
import type { Equipamento } from '../../dados/tipos'

/**
 * Bloqueio e desbloqueio operacional do ativo (RN-014).
 *
 * O que este diálogo torna explícito: bloqueio **não** é status. Um ativo
 * instalado no cliente continua LOCADO e faturando enquanto bloqueado — o que o
 * bloqueio impede é a próxima alocação. Colapsar as duas coisas num único campo
 * perderia justamente o caso caro: o ativo com preventiva vencida que volta
 * para o estoque e é realocado no dia seguinte.
 */

interface Props {
  equipamento: Equipamento
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  motivo: string
  categoriaMotivo: string
}

const MOTIVOS = [
  { valor: 'PREVENTIVA', texto: 'Preventiva vencida', detalhe: 'além da tolerância de páginas' },
  { valor: 'AVARIA', texto: 'Avaria estrutural', detalhe: 'exige laudo antes de voltar' },
  { valor: 'FIM_DE_VIDA', texto: 'Fim de vida útil', detalhe: 'aguardando baixa patrimonial' },
  { valor: 'OUTRO', texto: 'Outro', detalhe: 'descreva abaixo' },
]

export function FormBloqueio({ equipamento, aoFechar }: Props) {
  const { avisar } = useToast()
  const bloqueando = !equipamento.bloqueado

  const form = useFormulario<Valores, Equipamento>({
    inicial: { motivo: '', categoriaMotivo: 'PREVENTIVA' },
    validar: (v) =>
      bloqueando
        ? {
            motivo:
              v.motivo.trim().length >= 10
                ? undefined
                : 'Descreva o motivo com pelo menos 10 caracteres — quem for desbloquear precisa saber o que foi resolvido.',
          }
        : {},
    aoEnviar: (v) => {
      if (!bloqueando) return api.desbloquearEquipamento(equipamento.id)
      const rotulo = MOTIVOS.find((m) => m.valor === v.categoriaMotivo)?.texto ?? 'Bloqueio'
      return api.bloquearEquipamento(equipamento.id, `${rotulo}: ${v.motivo.trim()}`)
    },
    aoConcluir: (e) => {
      avisar({
        tom: bloqueando ? 'atencao' : 'ok',
        titulo: `Patrimônio ${e.patrimonio} ${bloqueando ? 'bloqueado' : 'desbloqueado'}`,
        texto: bloqueando
          ? 'Não pode ser alocado a novos contratos. Continua no estado atual em campo.'
          : 'Voltou a ficar disponível para alocação.',
      })
      aoFechar()
    },
  })

  return (
    <Dialogo
      titulo={`${bloqueando ? 'Bloquear' : 'Desbloquear'} patrimônio ${equipamento.patrimonio}`}
      descricao={nomeModelo(equipamento.modeloId)}
      aoFechar={aoFechar}
      largura="estreito"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao
            variante={bloqueando ? 'perigo' : 'primario'}
            onClick={() => form.enviar()}
            disabled={form.enviando}
          >
            {form.enviando ? 'Aplicando…' : bloqueando ? 'Bloquear' : 'Desbloquear'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ motivo: 'Motivo' }}
          refResumo={form.refResumo}
        />

        <p className="aviso aviso--atencao" role="note">
          <span aria-hidden="true">▲</span>
          <span className="crescer">
            Bloqueio impede <strong>nova alocação</strong>. O ativo permanece em {equipamento.status.toLowerCase().replace(/_/g, ' ')}
            {equipamento.clienteId ? ' e continua faturando no contrato atual' : ''}.
          </span>
        </p>

        {bloqueando ? (
          <>
            <GrupoOpcoes
              legenda="Categoria do bloqueio"
              valor={form.valores.categoriaMotivo}
              aoMudar={(v) => form.definir('categoriaMotivo', v)}
              opcoes={MOTIVOS}
            />
            <AreaTexto
              nome="motivo"
              rotulo="Detalhe do motivo"
              dica="Quem for desbloquear lê isto para saber o que precisa ter sido resolvido."
              limite={300}
              value={form.valores.motivo}
              onChange={(e) => form.definir('motivo', e.target.value)}
              {...form.campo('motivo')}
            />
          </>
        ) : (
          <div className="cartao cartao--compacto">
            <p className="texto-secundario">Motivo registrado no bloqueio:</p>
            <p>{equipamento.bloqueioMotivo ?? 'sem motivo registrado'}</p>
          </div>
        )}
      </form>
    </Dialogo>
  )
}
