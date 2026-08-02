import { HOJE } from './gerar'
import { categoriaPorCodigo, modeloPorId } from './catalogo'
import type {
  Anexo,
  BaseDados,
  CategoriaAnexo,
  Contrato,
  ContratoItem,
  EntidadeAnexo,
  Equipamento,
  ModalidadeCobranca,
  OrdemServico,
  Peca,
} from './tipos'

/**
 * Comandos de escrita.
 *
 * Separados das consultas de propósito. Leitura pode ser refeita à vontade;
 * escrita muda o mundo e precisa de um lugar único onde as regras de domínio
 * são aplicadas — caso contrário cada formulário reimplementa a sua versão da
 * regra e as versões divergem.
 *
 * Cada comando devolve `{ ok: true, ... }` ou `{ ok: false, erro }`. Recusa **não**
 * é exceção: uma sobreposição de vigência é resposta prevista do sistema, e
 * modelá-la como erro de campo faz o formulário conseguir apontar o input
 * errado em vez de mostrar um alerta genérico.
 *
 * Na API real (`apps/api`) estas mesmas regras vivem no banco — RN-001 é uma
 * exclusion constraint, não um `if`. Aqui elas são replicadas em memória
 * porque não há banco; a assinatura é a mesma que o cliente HTTP terá, então
 * a troca não muda os formulários.
 */

export interface FalhaComando {
  /** Código estável, igual ao do catálogo da API (Anexo D.1). */
  codigo: string
  mensagem: string
  /** Campo do formulário a destacar. Ausente quando a falha não é de um campo. */
  campo?: string
  /** Saídas possíveis — bloqueio sem alternativa deixa o operador travado. */
  acoes?: string[]
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: FalhaComando }

const falha = (codigo: string, mensagem: string, extra: Partial<FalhaComando> = {}): Resultado<never> => ({
  ok: false,
  erro: { codigo, mensagem, ...extra },
})

const sucesso = <T>(valor: T): Resultado<T> => ({ ok: true, valor })

/* -------------------------------------------------------------- utilidades */

let sequencia = 0
/** Identificador local. Determinístico dentro da sessão, sem depender de relógio. */
function novoId(prefixo: string): string {
  sequencia += 1
  return `${prefixo}-n${String(sequencia).padStart(4, '0')}`
}

function competenciaDe(iso: string): string {
  return iso.slice(0, 7)
}

/** Estados de item que ocupam o equipamento — espelha o predicado de RN-001. */
const OCUPANTES: ContratoItem['status'][] = ['RESERVADO', 'ATIVO', 'SUSPENSO']

function sobrepoe(a: { inicio: string; fim: string | null }, b: { inicio: string; fim: string | null }): boolean {
  const fimA = a.fim ?? '9999-12-31'
  const fimB = b.fim ?? '9999-12-31'
  // Intervalo fechado-aberto: um item que termina no dia em que outro começa
  // não conflita. Sem isso, uma substituição no mesmo dia seria recusada.
  return a.inicio < fimB && b.inicio < fimA
}

/* ============================================================== chamados === */

export interface DadosAbrirChamado {
  equipamentoId: string
  tipo: OrdemServico['tipo']
  prioridade: OrdemServico['prioridade']
  sintoma: string
  tecnicoId: string | null
}

/**
 * Abre um chamado.
 *
 * O prazo de solução **não** é digitado: é derivado do SLA da categoria do
 * equipamento e da prioridade. Deixar o operador escolher o prazo tornaria o
 * indicador de SLA uma opinião — todo chamado em risco viraria um chamado com
 * prazo esticado, e o número no painel deixaria de significar algo.
 */
export function abrirChamado(base: BaseDados, dados: DadosAbrirChamado): Resultado<OrdemServico> {
  const equipamento = base.equipamentos.find((e) => e.id === dados.equipamentoId)
  if (!equipamento) return falha('NAO_ENCONTRADO', 'Equipamento não encontrado.', { campo: 'equipamentoId' })

  if (equipamento.status === 'BAIXADO') {
    return falha('TRANSICAO_INVALIDA', 'Este equipamento foi baixado do patrimônio e não recebe chamado.', {
      campo: 'equipamentoId',
      acoes: ['Escolher outro equipamento'],
    })
  }

  const aberta = base.ordens.find(
    (o) => o.equipamentoId === dados.equipamentoId && !['CONCLUIDA', 'VALIDADA', 'CANCELADA'].includes(o.status),
  )
  if (aberta) {
    return falha('RECURSO_DUPLICADO', `Já existe o chamado ${aberta.numero} em aberto para este equipamento.`, {
      campo: 'equipamentoId',
      acoes: [`Acompanhar ${aberta.numero}`, 'Escolher outro equipamento'],
    })
  }

  const categoria = categoriaPorCodigo.get(equipamento.categoria)
  const fatorPrioridade = { CRITICA: 0.4, ALTA: 0.7, MEDIA: 1, BAIXA: 1.5 }[dados.prioridade]
  const horas = Math.max(2, Math.round((categoria?.slaHorasSolucao ?? 24) * fatorPrioridade))
  const prazo = new Date(HOJE.getTime() + horas * 3600_000)

  const ordem: OrdemServico = {
    id: novoId('os'),
    numero: `OS-${5100 + base.ordens.length}`,
    equipamentoId: equipamento.id,
    clienteId: equipamento.clienteId,
    tipo: dados.tipo,
    status: dados.tecnicoId ? 'AGENDADA' : 'ABERTA',
    prioridade: dados.prioridade,
    sintoma: dados.sintoma.trim(),
    causaRaiz: null,
    abertaEm: HOJE.toISOString(),
    prazoSolucaoEm: prazo.toISOString(),
    concluidaEm: null,
    tecnicoId: dados.tecnicoId,
    minutosApontados: 0,
    custoMaoObra: 0,
    custoPecas: 0,
    pecasUsadas: [],
  }

  base.ordens.unshift(ordem)
  if (dados.tecnicoId) {
    const t = base.tecnicos.find((x) => x.id === dados.tecnicoId)
    if (t) t.cargaAtual += 1
  }
  return sucesso(ordem)
}

/**
 * Atribui técnico a um chamado.
 *
 * A recusa por especialidade é a regra que evita o erro caro: mandar quem não
 * atende impressão para um chamado de multifuncional gera uma segunda visita, e
 * a segunda visita já estourou o prazo.
 */
export function atribuirTecnico(base: BaseDados, ordemId: string, tecnicoId: string): Resultado<OrdemServico> {
  const ordem = base.ordens.find((o) => o.id === ordemId)
  if (!ordem) return falha('NAO_ENCONTRADO', 'Chamado não encontrado.')
  if (['CONCLUIDA', 'VALIDADA', 'CANCELADA'].includes(ordem.status)) {
    return falha('TRANSICAO_INVALIDA', 'Chamado encerrado não aceita atribuição.', { campo: 'tecnicoId' })
  }

  const tecnico = base.tecnicos.find((t) => t.id === tecnicoId)
  if (!tecnico) return falha('NAO_ENCONTRADO', 'Técnico não encontrado.', { campo: 'tecnicoId' })

  const equipamento = base.equipamentos.find((e) => e.id === ordem.equipamentoId)
  const familia = equipamento ? categoriaPorCodigo.get(equipamento.categoria)?.familia : undefined
  if (familia && !tecnico.especialidades.includes(familia)) {
    return falha('REGRA_DE_NEGOCIO', `${tecnico.nome} não atende equipamentos de ${familia.toLowerCase()}.`, {
      campo: 'tecnicoId',
      acoes: ['Escolher um técnico com a especialidade', 'Registrar exceção com o supervisor'],
    })
  }

  if (ordem.tecnicoId) {
    const anterior = base.tecnicos.find((t) => t.id === ordem.tecnicoId)
    if (anterior) anterior.cargaAtual = Math.max(0, anterior.cargaAtual - 1)
  }
  ordem.tecnicoId = tecnicoId
  tecnico.cargaAtual += 1
  if (ordem.status === 'ABERTA' || ordem.status === 'TRIAGEM') ordem.status = 'AGENDADA'
  return sucesso(ordem)
}

export interface DadosConcluirChamado {
  causaRaiz: string
  minutosApontados: number
  pecas: { pecaId: string; quantidade: number }[]
}

/**
 * Conclui o chamado e dá baixa nas peças usadas.
 *
 * A baixa acontece **na mesma operação** que a conclusão, e é por isso que o
 * saldo é validado antes de qualquer mutação: concluir sem baixar deixaria o
 * estoque mentindo até o próximo inventário, e baixar parcialmente deixaria
 * metade das peças consumidas sem registro.
 */
export function concluirChamado(
  base: BaseDados,
  ordemId: string,
  dados: DadosConcluirChamado,
): Resultado<OrdemServico> {
  const ordem = base.ordens.find((o) => o.id === ordemId)
  if (!ordem) return falha('NAO_ENCONTRADO', 'Chamado não encontrado.')
  if (['CONCLUIDA', 'VALIDADA', 'CANCELADA'].includes(ordem.status)) {
    return falha('TRANSICAO_INVALIDA', `Chamado já está em ${ordem.status.toLowerCase()}.`)
  }
  if (!ordem.tecnicoId) {
    return falha('REGRA_DE_NEGOCIO', 'Chamado sem técnico atribuído não pode ser concluído.', {
      acoes: ['Atribuir um técnico antes de concluir'],
    })
  }

  // Valida tudo antes de escrever qualquer coisa.
  const baixas: { peca: Peca; quantidade: number }[] = []
  for (const uso of dados.pecas) {
    if (uso.quantidade <= 0) continue
    const peca = base.pecas.find((p) => p.id === uso.pecaId)
    if (!peca) return falha('NAO_ENCONTRADO', 'Peça não encontrada.', { campo: `pecas.${uso.pecaId}` })
    const disponivel = peca.saldo - peca.reservado
    if (uso.quantidade > disponivel) {
      return falha(
        'REGRA_DE_NEGOCIO',
        `Saldo insuficiente de ${peca.codigo}: ${disponivel} ${peca.unidade} disponível, ${uso.quantidade} solicitado.`,
        {
          campo: `pecas.${uso.pecaId}`,
          acoes: ['Reduzir a quantidade', 'Registrar entrada no estoque antes de concluir'],
        },
      )
    }
    baixas.push({ peca, quantidade: uso.quantidade })
  }

  let custoPecas = 0
  for (const { peca, quantidade } of baixas) {
    peca.saldo -= quantidade
    peca.consumo12m += quantidade
    custoPecas += peca.custoMedio * quantidade
  }

  const custoHora = 92
  ordem.status = 'CONCLUIDA'
  ordem.causaRaiz = dados.causaRaiz.trim()
  ordem.concluidaEm = HOJE.toISOString()
  ordem.minutosApontados = dados.minutosApontados
  ordem.custoMaoObra = Math.round((dados.minutosApontados / 60) * custoHora * 100) / 100
  ordem.custoPecas = Math.round(custoPecas * 100) / 100
  ordem.pecasUsadas = baixas.map((b) => ({ pecaId: b.peca.id, quantidade: b.quantidade }))

  const tecnico = base.tecnicos.find((t) => t.id === ordem.tecnicoId)
  if (tecnico) tecnico.cargaAtual = Math.max(0, tecnico.cargaAtual - 1)

  const equipamento = base.equipamentos.find((e) => e.id === ordem.equipamentoId)
  if (equipamento) {
    equipamento.custoManutencao12m += ordem.custoMaoObra + ordem.custoPecas
    if (equipamento.status === 'EM_MANUTENCAO') {
      equipamento.status = equipamento.contratoId ? 'LOCADO' : 'DISPONIVEL'
      equipamento.motivoIndisponibilidade = null
    }
    if (ordem.tipo === 'PREVENTIVA') equipamento.ultimaPreventiva = HOJE.toISOString().slice(0, 10)
  }

  return sucesso(ordem)
}

/* ============================================================== clientes === */

export interface DadosCliente {
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  segmento: string
  filialId: string
  contatoNome: string
  contatoEmail: string
  contatoTelefone: string
}

/** Verificação dos dois dígitos do CNPJ. Um dígito trocado passa por qualquer máscara. */
export function cnpjValido(bruto: string): boolean {
  const n = bruto.replace(/\D/g, '')
  if (n.length !== 14) return false
  // Todos os dígitos iguais satisfazem o cálculo mas nunca são CNPJ real.
  if (/^(\d)\1{13}$/.test(n)) return false
  const dv = (nums: number[], pesos: number[]) => {
    const soma = nums.reduce((acc, d, i) => acc + d * pesos[i]!, 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const d = n.split('').map(Number)
  const d1 = dv(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = dv(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return d1 === d[12] && d2 === d[13]
}

export function formatarCnpj(bruto: string): string {
  const n = bruto.replace(/\D/g, '').slice(0, 14)
  return n
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function criarCliente(base: BaseDados, dados: DadosCliente) {
  const cnpj = dados.cnpj.replace(/\D/g, '')
  if (!cnpjValido(cnpj)) {
    return falha('PAYLOAD_INVALIDO', 'CNPJ inválido: os dígitos verificadores não conferem.', { campo: 'cnpj' })
  }
  if (base.clientes.some((c) => c.cnpj.replace(/\D/g, '') === cnpj)) {
    return falha('RECURSO_DUPLICADO', 'Já existe um cliente com este CNPJ.', {
      campo: 'cnpj',
      acoes: ['Abrir o cadastro existente'],
    })
  }

  const filial = base.filiais.find((f) => f.id === dados.filialId)
  if (!filial) return falha('NAO_ENCONTRADO', 'Filial não encontrada.', { campo: 'filialId' })

  const cliente = {
    id: novoId('cli'),
    cnpj: formatarCnpj(cnpj),
    razaoSocial: dados.razaoSocial.trim(),
    nomeFantasia: dados.nomeFantasia.trim() || dados.razaoSocial.trim(),
    segmento: dados.segmento,
    regiaoId: filial.regiaoId,
    filialId: filial.id,
    situacaoCredito: 'LIBERADO' as const,
    diasAtrasoMaximo: 0,
    desde: HOJE.toISOString().slice(0, 10),
    contato: {
      nome: dados.contatoNome.trim(),
      email: dados.contatoEmail.trim(),
      telefone: dados.contatoTelefone.trim(),
    },
  }
  base.clientes.push(cliente)
  return sucesso(cliente)
}

/**
 * Altera a situação de crédito.
 *
 * Motivo obrigatório em qualquer direção, inclusive na liberação: quem libera
 * um cliente bloqueado está assumindo um risco, e a auditoria precisa saber
 * quem assumiu e por quê.
 */
export function definirCredito(
  base: BaseDados,
  clienteId: string,
  situacao: 'LIBERADO' | 'OBSERVACAO' | 'BLOQUEADO',
  motivo: string,
) {
  const cliente = base.clientes.find((c) => c.id === clienteId)
  if (!cliente) return falha('NAO_ENCONTRADO', 'Cliente não encontrado.')
  if (motivo.trim().length < 10) {
    return falha('REGRA_DE_NEGOCIO', 'Descreva o motivo com pelo menos 10 caracteres — a decisão é auditada.', {
      campo: 'motivo',
    })
  }
  cliente.situacaoCredito = situacao
  return sucesso(cliente)
}

/* ============================================================= contratos === */

export interface DadosContrato {
  clienteId: string
  filialId: string
  dataInicio: string
  dataFim: string
  indiceReajuste: Contrato['indiceReajuste']
  diaVencimento: number
  responsavel: string
  observacao: string
}

export function criarContrato(base: BaseDados, dados: DadosContrato): Resultado<Contrato> {
  const cliente = base.clientes.find((c) => c.id === dados.clienteId)
  if (!cliente) return falha('NAO_ENCONTRADO', 'Cliente não encontrado.', { campo: 'clienteId' })

  if (cliente.situacaoCredito === 'BLOQUEADO') {
    return falha('CREDITO_BLOQUEADO', `${cliente.nomeFantasia} está com crédito bloqueado.`, {
      campo: 'clienteId',
      acoes: ['Regularizar a situação de crédito', 'Solicitar liberação com alçada'],
    })
  }
  if (dados.dataFim <= dados.dataInicio) {
    return falha('VIGENCIA_INVALIDA', 'O fim da vigência precisa ser posterior ao início.', { campo: 'dataFim' })
  }

  const contrato: Contrato = {
    id: novoId('ctr'),
    numero: `SP-${dados.dataInicio.slice(0, 4)}-${String(400 + base.contratos.length).padStart(4, '0')}`,
    clienteId: cliente.id,
    filialId: dados.filialId,
    // Nasce em rascunho, sempre. Um contrato que já nasce ATIVO pula aprovação
    // e assinatura, e é assim que aparece contrato faturando sem documento.
    status: 'RASCUNHO',
    dataInicio: dados.dataInicio,
    dataFim: dados.dataFim,
    indiceReajuste: dados.indiceReajuste,
    diaVencimento: dados.diaVencimento,
    responsavel: dados.responsavel.trim(),
    itens: [],
    observacao: dados.observacao.trim() || undefined,
  }
  base.contratos.unshift(contrato)
  return sucesso(contrato)
}

/** Transições permitidas do contrato (Anexo B.1). */
const TRANSICOES: Record<string, Contrato['status'][]> = {
  RASCUNHO: ['EM_APROVACAO', 'ENCERRADO'],
  EM_APROVACAO: ['AGUARDANDO_ASSINATURA', 'RASCUNHO'],
  AGUARDANDO_ASSINATURA: ['ATIVO', 'RASCUNHO'],
  ATIVO: ['SUSPENSO', 'EM_RENOVACAO', 'ENCERRADO'],
  SUSPENSO: ['ATIVO', 'DISTRATADO'],
  EM_RENOVACAO: ['ATIVO', 'ENCERRADO'],
  VENCIDO_EM_CAMPO: ['EM_RENOVACAO', 'ENCERRADO'],
}

export function mudarStatusContrato(
  base: BaseDados,
  contratoId: string,
  destino: Contrato['status'],
): Resultado<Contrato> {
  const contrato = base.contratos.find((c) => c.id === contratoId)
  if (!contrato) return falha('NAO_ENCONTRADO', 'Contrato não encontrado.')

  const permitidos = TRANSICOES[contrato.status] ?? []
  if (!permitidos.includes(destino)) {
    return falha('TRANSICAO_INVALIDA', `Um contrato em ${contrato.status} não pode ir para ${destino}.`, {
      acoes: permitidos.length ? [`Destinos possíveis: ${permitidos.join(', ')}`] : ['Este é um estado terminal'],
    })
  }

  // Encerrar exige devolução: itens ainda ocupando significam equipamento em
  // campo sem contrato que o cubra — o caso que gera prejuízo silencioso.
  if (destino === 'ENCERRADO') {
    const emCampo = contrato.itens.filter((i) => OCUPANTES.includes(i.status))
    if (emCampo.length > 0) {
      return falha('REGRA_DE_NEGOCIO', `${emCampo.length} equipamento(s) ainda em campo neste contrato.`, {
        acoes: ['Encerrar os itens antes do contrato', 'Registrar retirada dos equipamentos'],
      })
    }
  }

  contrato.status = destino

  if (destino === 'ATIVO') {
    // Ativar o contrato ativa os itens reservados e leva os ativos a LOCADO.
    for (const item of contrato.itens) {
      if (item.status === 'RESERVADO') item.status = 'ATIVO'
      const eq = base.equipamentos.find((e) => e.id === item.equipamentoId)
      if (eq) {
        eq.status = 'LOCADO'
        eq.contratoId = contrato.id
        eq.clienteId = contrato.clienteId
      }
    }
  }
  return sucesso(contrato)
}

export interface DadosAlocacao {
  equipamentoId: string
  modalidade: ModalidadeCobranca
  valorMensal: number
  franquiaMono: number | null
  franquiaColor: number | null
  precoExcedenteMono: number | null
  precoExcedenteColor: number | null
  vigenciaInicio: string
  vigenciaFim: string | null
}

/**
 * Aloca equipamento a contrato — RN-001.
 *
 * A verificação de sobreposição varre **todos** os contratos, não só o de
 * destino: o conflito que importa é o ativo já estar em outro contrato.
 * Verificar só o contrato atual deixaria passar exatamente o caso que a regra
 * existe para impedir.
 */
export function alocarEquipamento(
  base: BaseDados,
  contratoId: string,
  dados: DadosAlocacao,
): Resultado<ContratoItem> {
  const contrato = base.contratos.find((c) => c.id === contratoId)
  if (!contrato) return falha('NAO_ENCONTRADO', 'Contrato não encontrado.')

  const ACEITAM = ['RASCUNHO', 'EM_APROVACAO', 'AGUARDANDO_ASSINATURA', 'ATIVO', 'EM_RENOVACAO']
  if (!ACEITAM.includes(contrato.status)) {
    return falha('TRANSICAO_INVALIDA', `Contrato em ${contrato.status} não recebe novos itens.`)
  }

  const equipamento = base.equipamentos.find((e) => e.id === dados.equipamentoId)
  if (!equipamento) return falha('NAO_ENCONTRADO', 'Equipamento não encontrado.', { campo: 'equipamentoId' })
  if (equipamento.status === 'BAIXADO') {
    return falha('TRANSICAO_INVALIDA', 'Equipamento baixado não pode ser alocado.', { campo: 'equipamentoId' })
  }
  if (equipamento.bloqueado) {
    return falha('REGRA_DE_NEGOCIO', `Equipamento bloqueado: ${equipamento.bloqueioMotivo ?? 'sem motivo registrado'}.`, {
      campo: 'equipamentoId',
      acoes: ['Desbloquear o ativo', 'Escolher outro equipamento'],
    })
  }
  if (dados.vigenciaFim && dados.vigenciaFim <= dados.vigenciaInicio) {
    return falha('VIGENCIA_INVALIDA', 'O fim da vigência precisa ser posterior ao início.', { campo: 'vigenciaFim' })
  }

  const novo = { inicio: dados.vigenciaInicio, fim: dados.vigenciaFim }
  for (const outro of base.contratos) {
    for (const item of outro.itens) {
      if (item.equipamentoId !== dados.equipamentoId) continue
      if (!OCUPANTES.includes(item.status)) continue
      if (!sobrepoe(novo, { inicio: item.vigenciaInicio, fim: item.vigenciaFim })) continue

      // Recusa acionável: qual contrato, até quando, e o que fazer no lugar.
      const livres = equivalentesLivres(base, equipamento, novo).slice(0, 3)
      const acoes: string[] = []
      if (livres.length) acoes.push(`Alocar equivalente: ${livres.map((e) => e.patrimonio).join(', ')}`)
      if (item.vigenciaFim) acoes.push(`Reservar a partir de ${item.vigenciaFim}`)
      return falha(
        'EQUIPAMENTO_JA_ALOCADO',
        `O patrimônio ${equipamento.patrimonio} está no contrato ${outro.numero}` +
          (item.vigenciaFim ? ` até ${item.vigenciaFim}.` : ' por prazo indeterminado.'),
        { campo: 'equipamentoId', acoes },
      )
    }
  }

  if (dados.modalidade === 'FRANQUIA_EXCEDENTE') {
    if (dados.franquiaMono === null || dados.precoExcedenteMono === null) {
      return falha('REGRA_DE_NEGOCIO', 'Franquia com excedente exige franquia e preço por página excedente.', {
        campo: 'franquiaMono',
      })
    }
  }

  const item: ContratoItem = {
    id: novoId('item'),
    equipamentoId: dados.equipamentoId,
    modalidade: dados.modalidade,
    valorMensal: dados.valorMensal,
    franquiaMono: dados.franquiaMono,
    franquiaColor: dados.franquiaColor,
    precoExcedenteMono: dados.precoExcedenteMono,
    precoExcedenteColor: dados.precoExcedenteColor,
    vigenciaInicio: dados.vigenciaInicio,
    vigenciaFim: dados.vigenciaFim,
    // Item com ativo nomeado nasce ocupante; é o que faz RN-001 valer para ele.
    status: contrato.status === 'ATIVO' ? 'ATIVO' : 'RESERVADO',
  }
  contrato.itens.push(item)

  equipamento.contratoId = contrato.id
  equipamento.clienteId = contrato.clienteId
  if (equipamento.status === 'DISPONIVEL') {
    equipamento.status = contrato.status === 'ATIVO' ? 'LOCADO' : 'RESERVADO'
  }
  return sucesso(item)
}

/** Ativos da mesma categoria e filial livres no período — a alternativa da recusa. */
function equivalentesLivres(
  base: BaseDados,
  alvo: Equipamento,
  periodo: { inicio: string; fim: string | null },
): Equipamento[] {
  return base.equipamentos.filter((e) => {
    if (e.id === alvo.id) return false
    if (e.categoria !== alvo.categoria || e.filialId !== alvo.filialId) return false
    if (e.bloqueado || e.status === 'BAIXADO' || e.status === 'EXTRAVIADO') return false
    return !base.contratos.some((c) =>
      c.itens.some(
        (i) =>
          i.equipamentoId === e.id &&
          OCUPANTES.includes(i.status) &&
          sobrepoe(periodo, { inicio: i.vigenciaInicio, fim: i.vigenciaFim }),
      ),
    )
  })
}

/** Livres no período, para alimentar o seletor do formulário de alocação. */
export function equipamentosLivresEm(
  base: BaseDados,
  periodo: { inicio: string; fim: string | null },
  filtro: { categoria?: string; filialId?: string } = {},
): Equipamento[] {
  return base.equipamentos.filter((e) => {
    if (e.bloqueado || e.status === 'BAIXADO' || e.status === 'EXTRAVIADO') return false
    if (filtro.categoria && e.categoria !== filtro.categoria) return false
    if (filtro.filialId && e.filialId !== filtro.filialId) return false
    return !base.contratos.some((c) =>
      c.itens.some(
        (i) =>
          i.equipamentoId === e.id &&
          OCUPANTES.includes(i.status) &&
          sobrepoe(periodo, { inicio: i.vigenciaInicio, fim: i.vigenciaFim }),
      ),
    )
  })
}

/* ========================================================== equipamentos === */

export interface DadosEquipamento {
  patrimonio: string
  numeroSerie: string
  modeloId: string
  filialId: string
}

export function criarEquipamento(base: BaseDados, dados: DadosEquipamento): Resultado<Equipamento> {
  const patrimonio = dados.patrimonio.trim()
  if (base.equipamentos.some((e) => e.patrimonio === patrimonio)) {
    return falha('RECURSO_DUPLICADO', `Já existe um ativo com o patrimônio ${patrimonio}.`, { campo: 'patrimonio' })
  }
  const serie = dados.numeroSerie.trim().toUpperCase()
  if (base.equipamentos.some((e) => e.numeroSerie.toUpperCase() === serie)) {
    return falha('RECURSO_DUPLICADO', 'Já existe um ativo com este número de série.', { campo: 'numeroSerie' })
  }

  const modelo = modeloPorId.get(dados.modeloId)
  if (!modelo) return falha('NAO_ENCONTRADO', 'Modelo não encontrado.', { campo: 'modeloId' })
  const filial = base.filiais.find((f) => f.id === dados.filialId)
  if (!filial) return falha('NAO_ENCONTRADO', 'Filial não encontrada.', { campo: 'filialId' })

  const equipamento: Equipamento = {
    id: novoId('eq'),
    patrimonio,
    numeroSerie: serie,
    modeloId: modelo.id,
    categoria: modelo.categoria,
    filialId: filial.id,
    status: 'DISPONIVEL',
    motivoIndisponibilidade: null,
    bloqueado: false,
    bloqueioMotivo: null,
    clienteId: null,
    localId: null,
    contratoId: null,
    regiaoId: filial.regiaoId,
    contadorMono: 0,
    contadorColor: 0,
    historicoConsumo: [],
    dataAquisicao: HOJE.toISOString().slice(0, 10),
    valorAquisicao: modelo.valorAquisicao,
    receita12m: 0,
    custoManutencao12m: 0,
    diasParado: 0,
    ultimaPreventiva: null,
    proximaPreventivaPaginas: categoriaPorCodigo.get(modelo.categoria)?.temContador ? 50_000 : null,
  }
  base.equipamentos.push(equipamento)
  return sucesso(equipamento)
}

export function bloquearEquipamento(base: BaseDados, id: string, motivo: string): Resultado<Equipamento> {
  const eq = base.equipamentos.find((e) => e.id === id)
  if (!eq) return falha('NAO_ENCONTRADO', 'Equipamento não encontrado.')
  if (motivo.trim().length < 10) {
    return falha('REGRA_DE_NEGOCIO', 'Bloqueio exige motivo com pelo menos 10 caracteres (RN-014).', {
      campo: 'motivo',
    })
  }
  // Bloqueio não muda o status: um ativo instalado no cliente continua LOCADO
  // enquanto bloqueado para nova alocação. São eixos independentes.
  eq.bloqueado = true
  eq.bloqueioMotivo = motivo.trim()
  return sucesso(eq)
}

export function desbloquearEquipamento(base: BaseDados, id: string): Resultado<Equipamento> {
  const eq = base.equipamentos.find((e) => e.id === id)
  if (!eq) return falha('NAO_ENCONTRADO', 'Equipamento não encontrado.')
  eq.bloqueado = false
  eq.bloqueioMotivo = null
  return sucesso(eq)
}

export interface DadosLeitura {
  competencia: string
  mono: number
  color: number
}

/**
 * Registra leitura de contador — RN-020, monotonicidade.
 *
 * Contador de impressora é acumulado e físico: não anda para trás. Uma leitura
 * menor que a anterior significa erro de digitação ou troca de placa, e aceitar
 * produziria excedente negativo na fatura. A recusa cita o valor anterior,
 * porque quase sempre o operador trocou dois dígitos e precisa ver qual.
 */
export function registrarLeitura(base: BaseDados, equipamentoId: string, dados: DadosLeitura): Resultado<Equipamento> {
  const eq = base.equipamentos.find((e) => e.id === equipamentoId)
  if (!eq) return falha('NAO_ENCONTRADO', 'Equipamento não encontrado.')

  const categoria = categoriaPorCodigo.get(eq.categoria)
  if (!categoria?.temContador) {
    return falha('REGRA_DE_NEGOCIO', `${categoria?.nome ?? 'Esta categoria'} não possui contador de páginas.`, {
      campo: 'mono',
    })
  }
  if (dados.mono < eq.contadorMono) {
    return falha(
      'REGRA_DE_NEGOCIO',
      `Leitura mono menor que a anterior (${eq.contadorMono.toLocaleString('pt-BR')}). Contador não retrocede.`,
      { campo: 'mono', acoes: ['Conferir os dígitos', 'Registrar troca de placa lógica com o supervisor'] },
    )
  }
  if (categoria.temContadorColor && dados.color < eq.contadorColor) {
    return falha(
      'REGRA_DE_NEGOCIO',
      `Leitura color menor que a anterior (${eq.contadorColor.toLocaleString('pt-BR')}).`,
      { campo: 'color' },
    )
  }
  if (eq.historicoConsumo.some((h) => h.competencia === dados.competencia)) {
    return falha('RECURSO_DUPLICADO', `Já existe leitura registrada para ${dados.competencia}.`, {
      campo: 'competencia',
      acoes: ['Estornar a leitura anterior antes de registrar outra'],
    })
  }

  const consumoMono = dados.mono - eq.contadorMono
  const consumoColor = categoria.temContadorColor ? dados.color - eq.contadorColor : 0
  eq.contadorMono = dados.mono
  if (categoria.temContadorColor) eq.contadorColor = dados.color
  eq.historicoConsumo.push({ competencia: dados.competencia, mono: consumoMono, color: consumoColor })
  eq.historicoConsumo.sort((a, b) => a.competencia.localeCompare(b.competencia))
  return sucesso(eq)
}

/* =============================================================== estoque === */

export type TipoMovimento = 'ENTRADA' | 'SAIDA' | 'AJUSTE'

export interface DadosMovimento {
  tipo: TipoMovimento
  quantidade: number
  motivo: string
  documento: string
}

/**
 * Movimenta o estoque.
 *
 * `AJUSTE` define o saldo absoluto; `ENTRADA` e `SAIDA` somam e subtraem. São
 * operações diferentes de propósito: contagem de inventário informa "o que
 * existe", recebimento informa "o que chegou". Tratar as duas como a mesma
 * coisa é como um inventário vira uma entrada duplicada.
 */
export function movimentarEstoque(base: BaseDados, pecaId: string, dados: DadosMovimento): Resultado<Peca> {
  const peca = base.pecas.find((p) => p.id === pecaId)
  if (!peca) return falha('NAO_ENCONTRADO', 'Peça não encontrada.')
  if (dados.quantidade <= 0) {
    return falha('PAYLOAD_INVALIDO', 'Informe uma quantidade maior que zero.', { campo: 'quantidade' })
  }
  if (dados.motivo.trim().length < 5) {
    return falha('REGRA_DE_NEGOCIO', 'Toda movimentação exige motivo — o saldo é auditado.', { campo: 'motivo' })
  }

  if (dados.tipo === 'SAIDA') {
    const disponivel = peca.saldo - peca.reservado
    if (dados.quantidade > disponivel) {
      return falha(
        'REGRA_DE_NEGOCIO',
        `Saldo insuficiente: ${disponivel} ${peca.unidade} disponível (${peca.reservado} reservado para chamados).`,
        { campo: 'quantidade', acoes: ['Reduzir a quantidade', 'Liberar reservas de chamados encerrados'] },
      )
    }
    peca.saldo -= dados.quantidade
    peca.consumo12m += dados.quantidade
  } else if (dados.tipo === 'ENTRADA') {
    peca.saldo += dados.quantidade
  } else {
    if (dados.quantidade < peca.reservado) {
      return falha(
        'REGRA_DE_NEGOCIO',
        `Ajuste abaixo do reservado (${peca.reservado} ${peca.unidade}) deixaria chamados sem peça.`,
        { campo: 'quantidade', acoes: ['Liberar as reservas antes de ajustar'] },
      )
    }
    peca.saldo = dados.quantidade
  }
  return sucesso(peca)
}

export interface DadosPolitica {
  estoqueMinimo: number
  pontoPedido: number
}

export function definirPolitica(base: BaseDados, pecaId: string, dados: DadosPolitica): Resultado<Peca> {
  const peca = base.pecas.find((p) => p.id === pecaId)
  if (!peca) return falha('NAO_ENCONTRADO', 'Peça não encontrada.')
  if (dados.pontoPedido < dados.estoqueMinimo) {
    return falha(
      'REGRA_DE_NEGOCIO',
      'O ponto de pedido precisa ser maior ou igual ao mínimo — senão o pedido só dispara depois de faltar.',
      { campo: 'pontoPedido' },
    )
  }
  peca.estoqueMinimo = dados.estoqueMinimo
  peca.pontoPedido = dados.pontoPedido
  return sucesso(peca)
}

/* =========================================================== faturamento === */

export interface DadosMedicao {
  origem: 'LEITURA' | 'ESTIMATIVA'
  mono: number
  color: number
  justificativa: string
}

/**
 * Resolve uma pendência de medição do fechamento.
 *
 * A estimativa existe porque o fechamento não pode parar por um ativo sem
 * leitura — mas ela é exceção, exige justificativa e fica marcada na fatura.
 * Sem a marca, a estimativa vira o caminho fácil e ninguém mais coleta leitura.
 */
export function resolverMedicao(
  base: BaseDados,
  equipamentoId: string,
  competencia: string,
  dados: DadosMedicao,
): Resultado<{ equipamentoId: string; competencia: string; origem: DadosMedicao['origem'] }> {
  const eq = base.equipamentos.find((e) => e.id === equipamentoId)
  if (!eq) return falha('NAO_ENCONTRADO', 'Equipamento não encontrado.')

  if (dados.origem === 'ESTIMATIVA' && dados.justificativa.trim().length < 10) {
    return falha('REGRA_DE_NEGOCIO', 'Estimativa exige justificativa: ela substitui um fato por uma projeção.', {
      campo: 'justificativa',
    })
  }

  if (dados.origem === 'LEITURA') {
    const r = registrarLeitura(base, equipamentoId, { competencia, mono: dados.mono, color: dados.color })
    if (!r.ok) return r
  } else {
    const media =
      eq.historicoConsumo.length > 0
        ? Math.round(eq.historicoConsumo.reduce((s, h) => s + h.mono, 0) / eq.historicoConsumo.length)
        : 0
    const mediaColor =
      eq.historicoConsumo.length > 0
        ? Math.round(eq.historicoConsumo.reduce((s, h) => s + h.color, 0) / eq.historicoConsumo.length)
        : 0
    eq.contadorMono += media
    eq.contadorColor += mediaColor
    eq.historicoConsumo.push({ competencia, mono: media, color: mediaColor })
  }

  return sucesso({ equipamentoId, competencia, origem: dados.origem })
}

export function competenciaAtual(): string {
  return competenciaDe(HOJE.toISOString())
}

/* ================================================================ anexos === */

/**
 * Limite por arquivo.
 *
 * Não é restrição de formato — qualquer tipo é aceito. É limite de tamanho, e
 * existe por uma razão de arquitetura: acima disto o caminho certo deixa de ser
 * "enviar pelo formulário" e passa a ser upload direto para o armazenamento por
 * URL assinada, sem trafegar pela API. Aceitar 300 MB aqui só produziria uma
 * aba travada e um envio que falha no fim.
 */
export const LIMITE_ARQUIVO_BYTES = 10 * 1024 * 1024
export const LIMITE_TOTAL_BYTES = 50 * 1024 * 1024

export interface DadosAnexo {
  arquivo: File
  categoria: CategoriaAnexo
  descricao?: string
}

export function anexosDe(base: BaseDados, entidade: EntidadeAnexo, entidadeId: string): Anexo[] {
  return base.anexos
    .filter((a) => a.entidade === entidade && a.entidadeId === entidadeId)
    .sort((a, b) => b.enviadoEm.localeCompare(a.enviadoEm) || a.nome.localeCompare(b.nome))
}

/**
 * Anexa arquivos a um contrato ou cliente.
 *
 * **Qualquer tipo é aceito** — PDF, imagem, planilha, .p7s de assinatura
 * digital, .dwg de planta, arquivo sem extensão reconhecida. Restringir por
 * extensão é uma falsa proteção: renomear contorna, e o custo real é o
 * operador que não consegue anexar o comprovante que o cliente mandou.
 *
 * A segurança vem de outro lugar, e é o que torna a permissividade defensável:
 * o conteúdo nunca é executado nem renderizado como HTML, e o download é
 * sempre forçado com o atributo `download` — nunca navegação para o arquivo.
 * Um `.html` anexado baixa; não abre no contexto da aplicação.
 *
 * Valida tudo antes de gravar qualquer coisa: um lote parcialmente aceito
 * deixa o operador sem saber o que subiu e o que não subiu.
 */
export function anexarArquivos(
  base: BaseDados,
  entidade: EntidadeAnexo,
  entidadeId: string,
  itens: DadosAnexo[],
  enviadoPor = 'Operação IARX',
): Resultado<Anexo[]> {
  if (itens.length === 0) {
    return falha('PAYLOAD_INVALIDO', 'Escolha ao menos um arquivo.', { campo: 'arquivos' })
  }

  const existentes = anexosDe(base, entidade, entidadeId)
  const jaUsados = new Set(existentes.map((a) => a.nome.toLowerCase()))
  let totalAtual = existentes.reduce((s, a) => s + a.tamanhoBytes, 0)

  for (const item of itens) {
    const { arquivo } = item

    if (arquivo.size === 0) {
      // Quase sempre é exportação que falhou. Aceitar produz um anexo que
      // ninguém consegue abrir e que só é descoberto quando é preciso.
      return falha('PAYLOAD_INVALIDO', `“${arquivo.name}” está vazio (0 bytes).`, {
        campo: 'arquivos',
        acoes: ['Gerar o arquivo novamente e reenviar'],
      })
    }
    if (arquivo.size > LIMITE_ARQUIVO_BYTES) {
      return falha(
        'PAYLOAD_INVALIDO',
        `“${arquivo.name}” tem ${formatarBytes(arquivo.size)}; o limite por arquivo é ${formatarBytes(LIMITE_ARQUIVO_BYTES)}.`,
        { campo: 'arquivos', acoes: ['Compactar o arquivo', 'Dividir em partes menores'] },
      )
    }
    if (jaUsados.has(arquivo.name.toLowerCase())) {
      return falha('RECURSO_DUPLICADO', `Já existe um anexo chamado “${arquivo.name}”.`, {
        campo: 'arquivos',
        acoes: ['Renomear o arquivo', 'Remover o anexo anterior antes de enviar a nova versão'],
      })
    }
    totalAtual += arquivo.size
    if (totalAtual > LIMITE_TOTAL_BYTES) {
      return falha(
        'REGRA_DE_NEGOCIO',
        `O total de anexos passaria de ${formatarBytes(LIMITE_TOTAL_BYTES)}.`,
        { campo: 'arquivos', acoes: ['Remover anexos obsoletos'] },
      )
    }
    jaUsados.add(arquivo.name.toLowerCase())
  }

  const criados: Anexo[] = itens.map((item) => ({
    id: novoId('anx'),
    entidade,
    entidadeId,
    nome: item.arquivo.name,
    // Navegador não reconhece toda extensão; guardar vazio é mais honesto que
    // inventar um tipo que o arquivo pode não ter.
    tipoMime: item.arquivo.type || '',
    tamanhoBytes: item.arquivo.size,
    categoria: item.categoria,
    descricao: item.descricao?.trim() || undefined,
    enviadoEm: HOJE.toISOString().slice(0, 10),
    enviadoPor,
    conteudo: item.arquivo,
  }))

  base.anexos.push(...criados)
  return sucesso(criados)
}

/**
 * Remove um anexo.
 *
 * Motivo obrigatório: apagar documento de contrato é ação com consequência
 * jurídica, e a trilha precisa registrar quem removeu e por quê. Em produção
 * isto é soft delete; aqui a lista em memória é a única cópia.
 */
export function removerAnexo(base: BaseDados, anexoId: string, motivo: string): Resultado<Anexo> {
  const i = base.anexos.findIndex((a) => a.id === anexoId)
  if (i < 0) return falha('NAO_ENCONTRADO', 'Anexo não encontrado.')
  if (motivo.trim().length < 5) {
    return falha('REGRA_DE_NEGOCIO', 'Informe o motivo da remoção — a exclusão é auditada.', { campo: 'motivo' })
  }
  const [removido] = base.anexos.splice(i, 1)
  return sucesso(removido!)
}

export function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

/** Rótulos das categorias, por entidade — cada uma tem seu conjunto útil. */
export const CATEGORIAS_ANEXO: Record<EntidadeAnexo, { valor: CategoriaAnexo; texto: string }[]> = {
  CONTRATO: [
    { valor: 'CONTRATO_ASSINADO', texto: 'Contrato assinado' },
    { valor: 'PROPOSTA', texto: 'Proposta comercial' },
    { valor: 'ADITIVO', texto: 'Aditivo' },
    { valor: 'TERMO_ENTREGA', texto: 'Termo de entrega' },
    { valor: 'OUTRO', texto: 'Outro documento' },
  ],
  CLIENTE: [
    { valor: 'CARTAO_CNPJ', texto: 'Cartão CNPJ' },
    { valor: 'CONTRATO_SOCIAL', texto: 'Contrato social' },
    { valor: 'CERTIDAO', texto: 'Certidão' },
    { valor: 'PROCURACAO', texto: 'Procuração' },
    { valor: 'OUTRO', texto: 'Outro documento' },
  ],
}

export const ROTULO_CATEGORIA: Record<CategoriaAnexo, string> = {
  CONTRATO_ASSINADO: 'Contrato assinado',
  PROPOSTA: 'Proposta comercial',
  ADITIVO: 'Aditivo',
  TERMO_ENTREGA: 'Termo de entrega',
  CARTAO_CNPJ: 'Cartão CNPJ',
  CONTRATO_SOCIAL: 'Contrato social',
  CERTIDAO: 'Certidão',
  PROCURACAO: 'Procuração',
  OUTRO: 'Outro documento',
}
