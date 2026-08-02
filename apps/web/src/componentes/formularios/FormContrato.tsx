import { useMemo } from 'react'
import { api } from '../../dados/api'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { Botao, Chip } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { AreaTexto, Combo, GrupoOpcoes, LinhaCampos, ResumoErros } from '../ui/formulario'
import { CampoArquivos } from '../ui/CampoArquivos'
import { Entrada, Selecao } from '../ui/primitivos'
import { HOJE } from '../../dados/gerar'
import type { Contrato } from '../../dados/tipos'

/**
 * Cadastro de contrato.
 *
 * O contrato nasce em **rascunho**, sempre, e o formulário deixa isso explícito
 * em vez de esconder num campo de status. Um contrato que nasce ativo pula
 * aprovação e assinatura — é assim que aparece contrato faturando sem
 * documento assinado, e é o tipo de coisa que só se descobre na auditoria.
 *
 * Equipamentos não entram aqui. Alocar exige verificar sobreposição de vigência
 * por ativo (RN-001), e um formulário que faz as duas coisas ao mesmo tempo
 * obriga o usuário a refazer tudo quando um único ativo conflita.
 */

interface Props {
  /** Cliente pré-selecionado, quando aberto a partir da ficha do cliente. */
  clienteId?: string
  aoFechar: () => void
  aoCriar?: (contrato: Contrato) => void
}

interface Valores extends Record<string, unknown> {
  clienteId: string
  filialId: string
  dataInicio: string
  dataFim: string
  indiceReajuste: Contrato['indiceReajuste']
  diaVencimento: number
  responsavel: string
  observacao: string
  arquivos: File[]
}

const ROTULOS = {
  clienteId: 'Cliente',
  filialId: 'Filial responsável',
  dataInicio: 'Início da vigência',
  dataFim: 'Fim da vigência',
  diaVencimento: 'Dia de vencimento',
  responsavel: 'Responsável comercial',
}

function emUmAno(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCFullYear(d.getUTCFullYear() + 1)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function FormContrato({ clienteId, aoFechar, aoCriar }: Props) {
  const base = api.baseSincrona()
  const { avisar } = useToast()
  const hoje = HOJE.toISOString().slice(0, 10)

  const opcoesCliente = useMemo(
    () =>
      base.clientes.map((c) => ({
        valor: c.id,
        texto: c.nomeFantasia,
        detalhe: `${c.cnpj} · ${c.segmento}`,
        desabilitada: c.situacaoCredito === 'BLOQUEADO',
        motivoDesabilitada:
          c.situacaoCredito === 'BLOQUEADO' ? `Crédito bloqueado · ${c.diasAtrasoMaximo} dias de atraso` : undefined,
      })),
    [base.clientes],
  )

  const form = useFormulario<Valores, Contrato>({
    inicial: {
      clienteId: clienteId ?? '',
      filialId: base.filiais[0]?.id ?? '',
      dataInicio: hoje,
      dataFim: emUmAno(hoje),
      indiceReajuste: 'IPCA',
      diaVencimento: 10,
      responsavel: '',
      observacao: '',
      arquivos: [],
    },
    validar: (v) => ({
      clienteId: v.clienteId ? undefined : 'Escolha o cliente do contrato.',
      filialId: v.filialId ? undefined : 'Escolha a filial responsável.',
      dataInicio: v.dataInicio ? undefined : 'Informe o início da vigência.',
      dataFim: !v.dataFim
        ? 'Informe o fim da vigência.'
        : v.dataFim <= v.dataInicio
          ? 'O fim precisa ser posterior ao início.'
          : undefined,
      diaVencimento:
        v.diaVencimento >= 1 && v.diaVencimento <= 28
          ? undefined
          : 'Use um dia entre 1 e 28: 29, 30 e 31 não existem em todo mês e deslocariam o vencimento.',
      responsavel: v.responsavel.trim().length >= 3 ? undefined : 'Informe o responsável comercial.',
    }),
    aoEnviar: (v) =>
      api.criarContrato({
        clienteId: v.clienteId,
        filialId: v.filialId,
        dataInicio: v.dataInicio,
        dataFim: v.dataFim,
        indiceReajuste: v.indiceReajuste,
        diaVencimento: v.diaVencimento,
        responsavel: v.responsavel,
        observacao: v.observacao,
      }),
    aoConcluir: async (c) => {
      // Os anexos são gravados depois da criação, porque só então existe a
      // entidade a que eles pertencem. Falhar aqui não desfaz o contrato: o
      // aviso diz o que ficou pendente e os arquivos podem ser reenviados pela
      // ficha, em vez de perder o cadastro inteiro por um arquivo grande.
      let avisoAnexos = ''
      if (form.valores.arquivos.length > 0) {
        const r = await api.anexarArquivos(
          'CONTRATO',
          c.id,
          form.valores.arquivos.map((arquivo) => ({ arquivo, categoria: 'CONTRATO_ASSINADO' as const })),
        )
        avisoAnexos = r.ok
          ? ` · ${r.valor.length} anexo(s)`
          : ` · anexos não enviados: ${r.erro.mensagem}`
      }
      avisar({
        tom: 'ok',
        titulo: `Contrato ${c.numero} criado`,
        texto: `Em rascunho. Aloque os equipamentos e submeta para aprovação.${avisoAnexos}`,
      })
      aoCriar?.(c)
      aoFechar()
    },
  })

  const cliente = base.clientes.find((c) => c.id === form.valores.clienteId)
  const meses =
    form.valores.dataFim > form.valores.dataInicio
      ? Math.round(
          (new Date(form.valores.dataFim).getTime() - new Date(form.valores.dataInicio).getTime()) /
            (1000 * 60 * 60 * 24 * 30.44),
        )
      : 0

  return (
    <Dialogo
      titulo="Novo contrato de locação"
      descricao="O contrato nasce em rascunho: os equipamentos são alocados depois, e a ativação exige aprovação e assinatura."
      aoFechar={aoFechar}
      largura="medio"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Criando…' : 'Criar rascunho'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros erros={form.errosResumo} erroGeral={form.erroGeral} rotulos={ROTULOS} refResumo={form.refResumo} />

        <Combo
          nome="clienteId"
          rotulo="Cliente"
          dica="Busque por nome fantasia ou CNPJ. Clientes com crédito bloqueado não podem contratar."
          opcoes={opcoesCliente}
          valor={form.valores.clienteId}
          aoMudar={(v) => form.definir('clienteId', v)}
          {...form.campo('clienteId')}
        />

        {cliente && cliente.situacaoCredito === 'OBSERVACAO' && (
          <p className="aviso aviso--atencao" role="status">
            <span aria-hidden="true">▲</span>
            <span className="crescer">
              Cliente em observação, com {cliente.diasAtrasoMaximo} dias de atraso máximo na carteira. A contratação é
              permitida, mas o financeiro será notificado.
            </span>
          </p>
        )}

        <LinhaCampos>
          <Selecao
            nome="filialId"
            rotulo="Filial responsável"
            opcoes={base.filiais.map((f) => ({ valor: f.id, texto: `${f.codigo} — ${f.nome}` }))}
            value={form.valores.filialId}
            onChange={(e) => form.definir('filialId', e.target.value)}
            {...form.campo('filialId')}
          />
          <Entrada
            nome="responsavel"
            rotulo="Responsável comercial"
            dica="Quem responde pela negociação."
            value={form.valores.responsavel}
            onChange={(e) => form.definir('responsavel', e.target.value)}
            {...form.campo('responsavel')}
          />
        </LinhaCampos>

        <LinhaCampos>
          <Entrada
            nome="dataInicio"
            rotulo="Início da vigência"
            type="date"
            value={form.valores.dataInicio}
            onChange={(e) => {
              form.definir('dataInicio', e.target.value)
              // Reprojeta o fim junto: um contrato de 12 meses é o caso comum, e
              // deixar o fim para trás do novo início produziria erro imediato.
              if (e.target.value && form.valores.dataFim <= e.target.value) {
                form.definir('dataFim', emUmAno(e.target.value))
              }
            }}
            {...form.campo('dataInicio')}
          />
          <Entrada
            nome="dataFim"
            rotulo="Fim da vigência"
            type="date"
            min={form.valores.dataInicio}
            dica={meses > 0 ? `${meses} meses de vigência` : undefined}
            value={form.valores.dataFim}
            onChange={(e) => form.definir('dataFim', e.target.value)}
            {...form.campo('dataFim')}
          />
        </LinhaCampos>

        <LinhaCampos>
          <GrupoOpcoes
            legenda="Índice de reajuste"
            dica="Aplicado no aniversário do contrato."
            valor={form.valores.indiceReajuste}
            aoMudar={(v) => form.definir('indiceReajuste', v as Valores['indiceReajuste'])}
            opcoes={[
              { valor: 'IPCA', texto: 'IPCA', detalhe: 'índice oficial de preços' },
              { valor: 'IGPM', texto: 'IGP-M', detalhe: 'mais volátil' },
              { valor: 'FIXO', texto: 'Sem reajuste', detalhe: 'valor travado na vigência' },
            ]}
          />
          <Entrada
            nome="diaVencimento"
            rotulo="Dia de vencimento"
            type="number"
            min={1}
            max={28}
            dica="Até 28, para o vencimento cair em todo mês."
            value={form.valores.diaVencimento}
            onChange={(e) => form.definir('diaVencimento', Number(e.target.value))}
            {...form.campo('diaVencimento')}
          />
        </LinhaCampos>

        <AreaTexto
          nome="observacao"
          rotulo="Observações operacionais (opcional)"
          dica="Janela de acesso, restrições do local, contato de portaria."
          limite={400}
          value={form.valores.observacao}
          onChange={(e) => form.definir('observacao', e.target.value)}
        />

        <CampoArquivos
          nome="arquivos"
          rotulo="Documentos do contrato (opcional)"
          dica="Contrato assinado, proposta, aditivos. Podem ser enviados depois pela ficha."
          arquivos={form.valores.arquivos}
          aoMudar={(a) => form.definir('arquivos', a)}
          disabled={form.enviando}
        />

        <p className="texto-secundario">
          Situação inicial: <Chip severidade="inativo">Rascunho</Chip>
        </p>
      </form>
    </Dialogo>
  )
}
