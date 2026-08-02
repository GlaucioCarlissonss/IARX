import { api } from '../../dados/api'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { Botao } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { AreaTexto, ResumoErros } from '../ui/formulario'
import type { Contrato, ContratoStatus } from '../../dados/tipos'

/**
 * Confirmação de transição de estado do contrato.
 *
 * Transição é ação, não edição de campo — por isso um diálogo próprio, com o
 * efeito descrito em texto antes da confirmação. Um `<select>` de status
 * esconderia que "Ativar" também reserva os equipamentos e muda o estado de
 * cada ativo.
 *
 * Transições destrutivas exigem justificativa; as de avanço no fluxo normal,
 * não. Pedir justificativa para tudo treina o usuário a digitar "ok".
 */

const EFEITO: Record<string, { titulo: string; texto: string; exigeMotivo: boolean; tom: 'primario' | 'perigo' }> = {
  EM_APROVACAO: {
    titulo: 'Submeter para aprovação',
    texto: 'O contrato sai de rascunho e deixa de aceitar edição de cláusulas até a aprovação.',
    exigeMotivo: false,
    tom: 'primario',
  },
  AGUARDANDO_ASSINATURA: {
    titulo: 'Aprovar contrato',
    texto: 'Libera o envio para assinatura. Os valores ficam travados a partir daqui.',
    exigeMotivo: false,
    tom: 'primario',
  },
  ATIVO: {
    titulo: 'Ativar contrato',
    texto:
      'Ativa todos os itens reservados e marca os equipamentos como locados. A partir daqui o contrato entra no faturamento.',
    exigeMotivo: false,
    tom: 'primario',
  },
  SUSPENSO: {
    titulo: 'Suspender contrato',
    texto:
      'O faturamento para, mas os equipamentos continuam alocados e no cliente — o ativo permanece indisponível para outro contrato.',
    exigeMotivo: true,
    tom: 'perigo',
  },
  EM_RENOVACAO: {
    titulo: 'Colocar em renovação',
    texto: 'Sinaliza a negociação em curso. O faturamento continua normalmente durante a renovação.',
    exigeMotivo: false,
    tom: 'primario',
  },
  ENCERRADO: {
    titulo: 'Encerrar contrato',
    texto:
      'Só é possível com todos os equipamentos devolvidos. Encerrar com ativo em campo é o que produz equipamento sem contrato que o cubra.',
    exigeMotivo: true,
    tom: 'perigo',
  },
  DISTRATADO: {
    titulo: 'Distratar contrato',
    texto: 'Encerramento antecipado por descumprimento. Registra multa e aciona o jurídico.',
    exigeMotivo: true,
    tom: 'perigo',
  },
  RASCUNHO: {
    titulo: 'Devolver para rascunho',
    texto: 'O contrato volta a aceitar edição de cláusulas e valores.',
    exigeMotivo: true,
    tom: 'perigo',
  },
}

interface Props {
  contrato: Contrato
  destino: ContratoStatus
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  motivo: string
}

export function FormTransicaoContrato({ contrato, destino, aoFechar }: Props) {
  const { avisar } = useToast()
  const efeito = EFEITO[destino] ?? {
    titulo: `Mudar para ${destino}`,
    texto: '',
    exigeMotivo: true,
    tom: 'perigo' as const,
  }

  const itensEmCampo = contrato.itens.filter((i) => ['RESERVADO', 'ATIVO', 'SUSPENSO'].includes(i.status))

  const form = useFormulario<Valores, Contrato>({
    inicial: { motivo: '' },
    validar: (v) => ({
      motivo:
        efeito.exigeMotivo && v.motivo.trim().length < 10
          ? 'Descreva o motivo com pelo menos 10 caracteres — a decisão é auditada.'
          : undefined,
    }),
    aoEnviar: () => api.mudarStatusContrato(contrato.id, destino),
    aoConcluir: (c) => {
      avisar({
        tom: 'ok',
        titulo: `${c.numero} — ${efeito.titulo.toLowerCase()}`,
        texto:
          destino === 'ATIVO' && c.itens.length > 0
            ? `${c.itens.length} item(ns) ativado(s) e equipamento(s) marcado(s) como locado(s).`
            : undefined,
      })
      aoFechar()
    },
  })

  return (
    <Dialogo
      titulo={`${efeito.titulo} · ${contrato.numero}`}
      aoFechar={aoFechar}
      largura="estreito"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao variante={efeito.tom} onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Aplicando…' : efeito.titulo}
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

        <p>{efeito.texto}</p>

        {destino === 'ENCERRADO' && itensEmCampo.length > 0 && (
          <p className="aviso aviso--critico" role="status">
            <span aria-hidden="true">⛔</span>
            <span className="crescer">
              {itensEmCampo.length} equipamento(s) ainda em campo neste contrato. Registre a retirada antes de encerrar.
            </span>
          </p>
        )}

        {destino === 'ATIVO' && (
          <p className="aviso aviso--ok" role="status">
            <span aria-hidden="true">✓</span>
            <span className="crescer">
              {contrato.itens.length === 0
                ? 'Nenhum item alocado: o contrato ficará ativo sem faturamento até que equipamentos sejam alocados.'
                : `${contrato.itens.length} item(ns) serão ativados.`}
            </span>
          </p>
        )}

        {efeito.exigeMotivo && (
          <AreaTexto
            nome="motivo"
            rotulo="Motivo"
            dica="Fica na trilha de auditoria com seu usuário e a data."
            limite={300}
            value={form.valores.motivo}
            onChange={(e) => form.definir('motivo', e.target.value)}
            {...form.campo('motivo')}
          />
        )}
      </form>
    </Dialogo>
  )
}
