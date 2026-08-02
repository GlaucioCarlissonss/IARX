import { useMemo } from 'react'
import { api } from '../../dados/api'
import { categoriaPorCodigo, nomeModelo } from '../../dados/catalogo'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { Botao } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { AreaTexto, Combo, GrupoOpcoes, LinhaCampos, ResumoErros } from '../ui/formulario'
import type { OrdemServico } from '../../dados/tipos'

/**
 * Abertura de chamado técnico.
 *
 * O que este formulário deliberadamente **não** pede: o prazo de solução. Ele é
 * derivado do SLA da categoria e da prioridade, e mostrado como consequência da
 * escolha. Um prazo digitado transformaria o indicador de SLA em opinião — todo
 * chamado atrasado viraria um chamado com prazo generoso.
 *
 * Escolher o equipamento define cliente, local e categoria: pedir de novo o que
 * já se sabe é o tipo de campo que faz um formulário parecer burocracia.
 */

interface Props {
  /** Pré-seleção vinda da tela de parque, quando o operador já sabe o ativo. */
  equipamentoId?: string
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  equipamentoId: string
  tipo: OrdemServico['tipo']
  prioridade: OrdemServico['prioridade']
  sintoma: string
  tecnicoId: string
}

const ROTULOS = {
  equipamentoId: 'Equipamento',
  tipo: 'Tipo de atendimento',
  prioridade: 'Prioridade',
  sintoma: 'Sintoma relatado',
  tecnicoId: 'Técnico',
}

const FATOR_PRIORIDADE = { CRITICA: 0.4, ALTA: 0.7, MEDIA: 1, BAIXA: 1.5 }

export function FormAbrirChamado({ equipamentoId, aoFechar }: Props) {
  const base = api.baseSincrona()
  const { avisar } = useToast()

  const form = useFormulario<Valores, OrdemServico>({
    inicial: {
      equipamentoId: equipamentoId ?? '',
      tipo: 'CORRETIVA',
      prioridade: 'MEDIA',
      sintoma: '',
      tecnicoId: '',
    },
    validar: (v) => ({
      equipamentoId: v.equipamentoId ? undefined : 'Escolha o equipamento do chamado.',
      sintoma:
        v.sintoma.trim().length >= 12
          ? undefined
          : 'Descreva o sintoma com pelo menos 12 caracteres — "não funciona" não ajuda o técnico a se preparar.',
    }),
    aoEnviar: (v) =>
      api.abrirChamado({
        equipamentoId: v.equipamentoId,
        tipo: v.tipo,
        prioridade: v.prioridade,
        sintoma: v.sintoma,
        tecnicoId: v.tecnicoId || null,
      }),
    aoConcluir: (ordem) => {
      avisar({
        tom: 'ok',
        titulo: `Chamado ${ordem.numero} aberto`,
        texto: ordem.tecnicoId
          ? 'Técnico já atribuído e chamado agendado.'
          : 'Sem técnico atribuído: aparece na fila de triagem.',
      })
      aoFechar()
    },
  })

  const opcoesEquipamento = useMemo(
    () =>
      base.equipamentos
        .filter((e) => e.status !== 'BAIXADO')
        .map((e) => {
          const cliente = base.clientes.find((c) => c.id === e.clienteId)
          const aberta = base.ordens.find(
            (o) => o.equipamentoId === e.id && !['CONCLUIDA', 'VALIDADA', 'CANCELADA'].includes(o.status),
          )
          return {
            valor: e.id,
            texto: `${e.patrimonio} · ${nomeModelo(e.modeloId)}`,
            detalhe: cliente ? `${cliente.nomeFantasia} · ${e.numeroSerie}` : `Em estoque · ${e.numeroSerie}`,
            // Não some da lista: quem procura o patrimônio e não o acha conclui
            // que digitou errado. Vendo o motivo, resolve sozinho.
            desabilitada: Boolean(aberta),
            motivoDesabilitada: aberta ? `Já tem o chamado ${aberta.numero} em aberto` : undefined,
          }
        }),
    [base],
  )

  const equipamento = base.equipamentos.find((e) => e.id === form.valores.equipamentoId)
  const categoria = equipamento ? categoriaPorCodigo.get(equipamento.categoria) : null
  const cliente = equipamento ? base.clientes.find((c) => c.id === equipamento.clienteId) : null

  // Prazo mostrado como consequência da escolha, não como campo.
  const horasSla = categoria
    ? Math.max(2, Math.round(categoria.slaHorasSolucao * FATOR_PRIORIDADE[form.valores.prioridade]))
    : null

  const tecnicosCompativeis = useMemo(() => {
    if (!categoria) return base.tecnicos
    return base.tecnicos.filter((t) => t.especialidades.includes(categoria.familia))
  }, [base.tecnicos, categoria])

  return (
    <Dialogo
      titulo="Abrir chamado técnico"
      descricao="O prazo é calculado pelo SLA da categoria e pela prioridade — não é digitado."
      aoFechar={aoFechar}
      largura="medio"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Abrindo…' : 'Abrir chamado'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros erros={form.errosResumo} erroGeral={form.erroGeral} rotulos={ROTULOS} refResumo={form.refResumo} />

        <Combo
          nome="equipamentoId"
          rotulo="Equipamento"
          dica="Busque por patrimônio, modelo ou número de série."
          opcoes={opcoesEquipamento}
          valor={form.valores.equipamentoId}
          aoMudar={(v) => form.definir('equipamentoId', v)}
          {...form.campo('equipamentoId')}
        />

        {equipamento && (
          <div className="cartao cartao--compacto">
            <dl className="pares">
              <div>
                <dt>Cliente</dt>
                <dd>{cliente?.nomeFantasia ?? 'Em estoque, sem cliente'}</dd>
              </div>
              <div>
                <dt>Categoria</dt>
                <dd>{categoria?.nome ?? '—'}</dd>
              </div>
              <div>
                <dt>Situação atual</dt>
                <dd>{equipamento.status.toLowerCase().replace(/_/g, ' ')}</dd>
              </div>
            </dl>
          </div>
        )}

        <LinhaCampos>
          <GrupoOpcoes
            legenda="Tipo de atendimento"
            valor={form.valores.tipo}
            aoMudar={(v) => form.definir('tipo', v as Valores['tipo'])}
            opcoes={[
              { valor: 'CORRETIVA', texto: 'Corretiva', detalhe: 'defeito relatado' },
              { valor: 'PREVENTIVA', texto: 'Preventiva', detalhe: 'plano de manutenção' },
              { valor: 'INSTALACAO', texto: 'Instalação', detalhe: 'entrega no cliente' },
              { valor: 'RETIRADA', texto: 'Retirada', detalhe: 'devolução do ativo' },
            ]}
          />

          <GrupoOpcoes
            legenda="Prioridade"
            dica="Define o prazo a partir do SLA da categoria."
            valor={form.valores.prioridade}
            aoMudar={(v) => form.definir('prioridade', v as Valores['prioridade'])}
            opcoes={[
              { valor: 'CRITICA', texto: 'Crítica', detalhe: 'operação parada' },
              { valor: 'ALTA', texto: 'Alta', detalhe: 'impacto relevante' },
              { valor: 'MEDIA', texto: 'Média', detalhe: 'uso degradado' },
              { valor: 'BAIXA', texto: 'Baixa', detalhe: 'sem impacto imediato' },
            ]}
          />
        </LinhaCampos>

        {horasSla !== null && (
          <p className="aviso aviso--ok" role="status">
            <span aria-hidden="true">✓</span>
            <span className="crescer">
              Prazo de solução: <strong>{horasSla} horas</strong> a partir da abertura, pelo SLA de{' '}
              {categoria?.nome.toLowerCase()} na prioridade {form.valores.prioridade.toLowerCase()}.
            </span>
          </p>
        )}

        <AreaTexto
          nome="sintoma"
          rotulo="Sintoma relatado"
          dica="O que o usuário descreveu. Quanto mais específico, menos retorno em vão."
          limite={280}
          value={form.valores.sintoma}
          onChange={(e) => form.definir('sintoma', e.target.value)}
          {...form.campo('sintoma')}
        />

        <Combo
          nome="tecnicoId"
          rotulo="Técnico (opcional)"
          dica={
            categoria
              ? `Somente técnicos de ${categoria.familia.toLowerCase()}. Sem atribuir, o chamado entra na triagem.`
              : 'Escolha o equipamento primeiro para filtrar por especialidade.'
          }
          vazio="Deixar para a triagem"
          opcoes={tecnicosCompativeis.map((t) => ({
            valor: t.id,
            texto: t.nome,
            detalhe: `${t.cargaAtual} chamado(s) na fila`,
          }))}
          valor={form.valores.tecnicoId}
          aoMudar={(v) => form.definir('tecnicoId', v)}
          {...form.campo('tecnicoId')}
        />
      </form>
    </Dialogo>
  )
}
