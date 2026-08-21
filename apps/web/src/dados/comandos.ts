import { HOJE } from './gerar'
import { categoriaPorCodigo, modeloPorId } from './catalogo'
import { arredondar, chaveValida, decomporChave, diferencaTotal, formatarCnpj, somenteDigitos } from './nfe'
import type {
  Anexo,
  BaseDados,
  CategoriaAnexo,
  Cliente,
  Contrato,
  ContratoItem,
  EntidadeAnexo,
  Equipamento,
  ModalidadeCobranca,
  NotaFiscal,
  NotaFiscalItem,
  OrdemServico,
  Peca,
  PerfilGravado,
  PrecisaoGeo,
  Usuario,
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

/**
 * Máscara aplicada enquanto se digita — aceita entrada parcial.
 *
 * Distinta de `formatarCnpj` (em `nfe.ts`), que formata um documento já
 * completo. As duas existem porque os usos são diferentes: aqui o valor muda a
 * cada tecla e ainda não é um CNPJ; lá é sempre um documento inteiro.
 */
export function mascaraCnpj(bruto: string): string {
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

  // Coordenada da praça da filial responsável, sem geocodificar o endereço.
  // O cliente aparece no mapa desde o cadastro — na cidade certa, no ponto
  // aproximado. Geocodificar de verdade é do módulo de mapa (D-13, Anexo M):
  // ViaCEP, depois Nominatim, com cache; até lá, a praça é a melhor
  // aproximação honesta, e o mapa a marca como não confirmada.
  const praca = base.regioes.find((r) => r.id === filial.regiaoId) ?? base.regioes[0]!

  const cliente = {
    id: novoId('cli'),
    cnpj: mascaraCnpj(cnpj),
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
    lat: praca.lat,
    lon: praca.lon,
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

/**
 * Grava a coordenada do cliente a partir de um resultado de busca de endereço.
 *
 * Resolve o cliente que foi cadastrado sem coordenada e por isso não aparecia
 * no mapa — não deixava de existir, deixava de ser visto, que na prática é a
 * mesma coisa para quem planeja rota de técnico.
 *
 * A proveniência é obrigatória, e não um enfeite de auditoria: coordenada sem
 * origem é coordenada que ninguém sabe se pode corrigir. Uma vinda de rastreio
 * de equipamento não deve ser sobrescrita por um palpite de endereço, e sem
 * registrar a origem não há como saber qual é qual.
 */
export function definirLocalizacaoCliente(
  base: BaseDados,
  clienteId: string,
  dados: { lat: number; lon: number; precisao: PrecisaoGeo; fonte: string },
): Resultado<Cliente> {
  const cliente = base.clientes.find((c) => c.id === clienteId)
  if (!cliente) return falha('NAO_ENCONTRADO', 'Cliente não encontrado.')

  if (!Number.isFinite(dados.lat) || !Number.isFinite(dados.lon)) {
    return falha('REGRA_DE_NEGOCIO', 'Coordenada inválida.', { campo: 'lat' })
  }

  /*
   * Recusa coordenada fora do território brasileiro.
   *
   * A busca de endereço já restringe o país, então um ponto fora daqui não é
   * um caso de uso: é sintoma de eixo trocado — latitude no lugar da longitude
   * inverte o Brasil para o meio da Somália, e sem esta checagem o cliente
   * simplesmente sumiria do mapa sem nenhum erro.
   */
  if (!dentroDoBrasil(dados.lat, dados.lon)) {
    return falha(
      'REGRA_DE_NEGOCIO',
      'A coordenada cai fora do território brasileiro. Confira se latitude e longitude não estão trocadas.',
      { campo: 'lat' },
    )
  }

  if (dados.fonte.trim() === '') {
    return falha('REGRA_DE_NEGOCIO', 'Informe a origem da coordenada.', { campo: 'fonte' })
  }

  cliente.lat = dados.lat
  cliente.lon = dados.lon
  cliente.geoPrecisao = dados.precisao
  cliente.geoFonte = dados.fonte.trim()
  cliente.geoAtualizadoEm = new Date().toISOString()
  return sucesso(cliente)
}

/** Envelope do território, com folga para a margem e as ilhas próximas. */
function dentroDoBrasil(lat: number, lon: number): boolean {
  return lat >= -34.5 && lat <= 6 && lon >= -74.5 && lon <= -33.5
}

/* ========================================== usuários e perfis de acesso === */

/**
 * O último administrador ativo não se desativa.
 *
 * RN-L39, espelhada do gatilho da migração 0015. Aqui a checagem existe para a
 * interface poder **explicar** antes de tentar — no servidor ela existe porque
 * é lá que a regra precisa valer mesmo que ninguém pergunte. As duas não são
 * redundância: uma evita o erro, a outra o torna impossível.
 *
 * Vale para desativar e para revogar o perfil administrativo, porque as duas
 * portas levam ao mesmo locatário órfão — sem ninguém capaz de conceder acesso
 * a ninguém, e sem caminho de volta pela própria aplicação.
 */
function ehAdministrador(base: BaseDados, u: Usuario): boolean {
  return u.perfilIds.some((id) => {
    const p = base.perfis.find((x) => x.id === id)
    return p?.tipo === 'INTERNO' && p.permissoes.includes('usuario:gerenciar')
  })
}

function outroAdministradorAtivo(base: BaseDados, excetoId: string): boolean {
  return base.usuarios.some(
    (u) => u.id !== excetoId && u.status === 'ATIVO' && ehAdministrador(base, u),
  )
}

export interface DadosConvite {
  nome: string
  email: string
  tipo: 'INTERNO' | 'CLIENTE'
  clienteId: string | null
  perfilId: string
  filiaisIds: string[]
}

/**
 * Convida — nunca "cria com senha".
 *
 * O administrador não define a senha de ninguém. Senha definida por terceiro é
 * senha compartilhada: quem a criou continua sabendo, e o dono não tem como
 * provar que não foi ele. O convidado define a própria no primeiro acesso.
 */
export function convidarUsuario(base: BaseDados, dados: DadosConvite): Resultado<Usuario> {
  const nome = dados.nome.trim()
  const email = dados.email.trim().toLowerCase()

  if (nome.length < 3) {
    return falha('REGRA_DE_NEGOCIO', 'Informe o nome completo.', { campo: 'nome' })
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return falha('REGRA_DE_NEGOCIO', 'Informe um e-mail válido.', { campo: 'email' })
  }
  if (base.usuarios.some((u) => u.email.toLowerCase() === email)) {
    return falha('REGRA_DE_NEGOCIO', 'Já existe um usuário com este e-mail.', { campo: 'email' })
  }

  const perfil = base.perfis.find((p) => p.id === dados.perfilId)
  if (!perfil) return falha('NAO_ENCONTRADO', 'Perfil não encontrado.', { campo: 'perfilId' })

  // O tipo do perfil e o do usuário têm de casar. Um usuário de cliente com
  // perfil interno enxergaria a operação inteira da locadora (RN-L25).
  if (perfil.tipo !== dados.tipo) {
    return falha(
      'REGRA_DE_NEGOCIO',
      `O perfil "${perfil.nome}" é do tipo ${perfil.tipo.toLowerCase()} e não pode ser atribuído a um usuário ${dados.tipo.toLowerCase()}.`,
      { campo: 'perfilId' },
    )
  }
  if (dados.tipo === 'CLIENTE' && !dados.clienteId) {
    return falha('REGRA_DE_NEGOCIO', 'Usuário de cliente precisa estar vinculado a um cliente.', {
      campo: 'clienteId',
    })
  }

  const usuario: Usuario = {
    id: `usr-${email.split('@')[0]!.replace(/[^a-z0-9]+/g, '-')}-${base.usuarios.length + 1}`,
    nome,
    email,
    tipo: dados.tipo,
    clienteId: dados.tipo === 'CLIENTE' ? dados.clienteId : null,
    status: 'ATIVO',
    perfilIds: [perfil.id],
    filiaisIds: dados.filiaisIds,
    ultimoAcesso: null,
    criadoEm: HOJE.toISOString().slice(0, 10),
    // Convite pendente: existe, e não entra. É um estado legítimo, não um
    // cadastro incompleto.
    conviteAceito: false,
  }
  base.usuarios.push(usuario)
  return sucesso(usuario)
}

export function atribuirPerfil(base: BaseDados, usuarioId: string, perfilId: string): Resultado<Usuario> {
  const u = base.usuarios.find((x) => x.id === usuarioId)
  if (!u) return falha('NAO_ENCONTRADO', 'Usuário não encontrado.')

  const perfil = base.perfis.find((p) => p.id === perfilId)
  if (!perfil) return falha('NAO_ENCONTRADO', 'Perfil não encontrado.', { campo: 'perfilId' })

  if (perfil.tipo !== u.tipo) {
    return falha(
      'REGRA_DE_NEGOCIO',
      `Perfil de tipo ${perfil.tipo.toLowerCase()} não se aplica a usuário ${u.tipo.toLowerCase()}.`,
      { campo: 'perfilId' },
    )
  }
  if (u.perfilIds.includes(perfilId)) {
    return falha('REGRA_DE_NEGOCIO', 'Este usuário já tem o perfil.', { campo: 'perfilId' })
  }

  u.perfilIds = [...u.perfilIds, perfilId]
  return sucesso(u)
}

export function revogarPerfil(base: BaseDados, usuarioId: string, perfilId: string): Resultado<Usuario> {
  const u = base.usuarios.find((x) => x.id === usuarioId)
  if (!u) return falha('NAO_ENCONTRADO', 'Usuário não encontrado.')
  if (!u.perfilIds.includes(perfilId)) {
    return falha('REGRA_DE_NEGOCIO', 'O usuário não tem este perfil.')
  }
  if (u.perfilIds.length === 1) {
    return falha('REGRA_DE_NEGOCIO', 'Um usuário precisa de ao menos um perfil. Atribua outro antes de revogar este.')
  }

  const restantes = u.perfilIds.filter((id) => id !== perfilId)
  const aindaAdmin = restantes.some((id) => {
    const p = base.perfis.find((x) => x.id === id)
    return p?.tipo === 'INTERNO' && p.permissoes.includes('usuario:gerenciar')
  })

  if (ehAdministrador(base, u) && !aindaAdmin && u.status === 'ATIVO' && !outroAdministradorAtivo(base, u.id)) {
    return falha(
      'REGRA_DE_NEGOCIO',
      'Revogar este perfil deixaria o ambiente sem administrador. Conceda o perfil administrativo a outro usuário antes.',
    )
  }

  u.perfilIds = restantes
  return sucesso(u)
}

export function desativarUsuario(base: BaseDados, usuarioId: string, motivo: string): Resultado<Usuario> {
  const u = base.usuarios.find((x) => x.id === usuarioId)
  if (!u) return falha('NAO_ENCONTRADO', 'Usuário não encontrado.')
  if (u.status !== 'ATIVO') return falha('REGRA_DE_NEGOCIO', 'O usuário já está inativo.')

  if (motivo.trim().length < 5) {
    return falha('REGRA_DE_NEGOCIO', 'Descreva o motivo — a desativação é auditada.', { campo: 'motivo' })
  }

  if (ehAdministrador(base, u) && !outroAdministradorAtivo(base, u.id)) {
    return falha(
      'REGRA_DE_NEGOCIO',
      'Este é o último administrador ativo. Conceda o perfil administrativo a outro usuário antes de desativá-lo.',
    )
  }

  // Desativar preserva o histórico: o registro de auditoria referencia o autor,
  // e apagar a conta deixaria a trilha apontando para ninguém (RN-L30).
  u.status = 'INATIVO'
  return sucesso(u)
}

export function ativarUsuario(base: BaseDados, usuarioId: string): Resultado<Usuario> {
  const u = base.usuarios.find((x) => x.id === usuarioId)
  if (!u) return falha('NAO_ENCONTRADO', 'Usuário não encontrado.')
  if (u.status === 'ATIVO') return falha('REGRA_DE_NEGOCIO', 'O usuário já está ativo.')
  u.status = 'ATIVO'
  return sucesso(u)
}

export interface DadosPerfil {
  nome: string
  descricao: string
  tipo: 'INTERNO' | 'CLIENTE'
  permissoes: string[]
}

/**
 * Cria ou altera um perfil.
 *
 * Perfil de sistema é recusado: ele é estrutural, e alterá-lo mudaria o acesso
 * de todo mundo que o tem, inclusive de quem nunca foi consultado. Quem precisa
 * de variação duplica e edita a cópia — o que a tela oferece como ação própria.
 */
export function salvarPerfil(
  base: BaseDados,
  perfilId: string | null,
  dados: DadosPerfil,
): Resultado<PerfilGravado> {
  const nome = dados.nome.trim()
  if (nome.length < 3) {
    return falha('REGRA_DE_NEGOCIO', 'Informe o nome do perfil.', { campo: 'nome' })
  }
  if (dados.permissoes.length === 0) {
    return falha('REGRA_DE_NEGOCIO', 'Um perfil sem nenhuma permissão não dá acesso a nada. Marque ao menos uma.', {
      campo: 'permissoes',
    })
  }

  const duplicado = base.perfis.find((p) => p.nome.toLowerCase() === nome.toLowerCase() && p.id !== perfilId)
  if (duplicado) return falha('REGRA_DE_NEGOCIO', 'Já existe um perfil com este nome.', { campo: 'nome' })

  if (perfilId) {
    const p = base.perfis.find((x) => x.id === perfilId)
    if (!p) return falha('NAO_ENCONTRADO', 'Perfil não encontrado.')
    if (p.isSistema) {
      return falha(
        'REGRA_DE_NEGOCIO',
        'Perfil de sistema não é editável. Duplique-o para criar uma variação.',
      )
    }
    p.nome = nome
    p.descricao = dados.descricao.trim()
    p.permissoes = [...dados.permissoes].sort()
    return sucesso(p)
  }

  const novo: PerfilGravado = {
    id: `perf-${nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')}`,
    nome,
    descricao: dados.descricao.trim(),
    tipo: dados.tipo,
    isSistema: false,
    permissoes: [...dados.permissoes].sort(),
  }
  base.perfis.push(novo)
  return sucesso(novo)
}

/** Quantos usuários ativos usam este perfil — a tela precisa avisar antes de mudar. */
export function usuariosComPerfil(base: BaseDados, perfilId: string): number {
  return base.usuarios.filter((u) => u.perfilIds.includes(perfilId) && u.status === 'ATIVO').length
}

/* ------------------------------------------------------------ autenticação */

/**
 * Senha única da demonstração, impressa na tela de login e rotulada como tal.
 *
 * É andaime visível, não credencial fabricada: a distinção que importa é que
 * ninguém pode confundi-la com senha real. Na aplicação de verdade nada disto
 * existe — a verificação é Argon2id no servidor (`apps/api/src/comum/senha.ts`),
 * com o hash em `usuario.senha_hash` e a política de senha por locatário
 * (migração 0015). Aqui não há servidor, e uma tela de login que aceitasse
 * qualquer coisa não exercitaria nem a recusa nem a mensagem uniforme.
 */
export const SENHA_DEMONSTRACAO = 'iarx-demo'

export interface SessaoAberta {
  usuario: Usuario
  /** Convite não aceito: precisa definir a senha antes de entrar. */
  deveDefinirSenha: boolean
}

/**
 * Recusa uniforme: e-mail inexistente, senha errada e conta inativa devolvem a
 * **mesma** mensagem.
 *
 * Não é economia de texto. "Este e-mail não está cadastrado" transforma a tela
 * de login num verificador de quem trabalha aqui: quem quiser descobrir os
 * e-mails válidos de um locatário só precisa de uma lista de palpites e de ler
 * a diferença entre as respostas. É o mesmo comportamento de
 * `auth.service.ts`, e o motivo de o serviço queimar tempo equivalente quando
 * o hash é nulo — sem isso o relógio responde o que a mensagem esconde.
 */
export function autenticar(base: BaseDados, email: string, senha: string): Resultado<SessaoAberta> {
  const alvo = email.trim().toLowerCase()
  const usuario = base.usuarios.find((u) => u.email.toLowerCase() === alvo)
  const recusa = () =>
    falha('CREDENCIAL_INVALIDA', 'E-mail ou senha inválidos.', {
      acoes: ['Conferir o e-mail digitado', 'Usar "Esqueci minha senha"'],
    })

  if (!usuario || usuario.status !== 'ATIVO' || senha !== SENHA_DEMONSTRACAO) return recusa()

  usuario.ultimoAcesso = iso(HOJE)
  return sucesso({ usuario, deveDefinirSenha: !usuario.conviteAceito })
}

/**
 * Resposta neutra, sempre a mesma, exista ou não a conta.
 *
 * Pela mesma razão da recusa uniforme: uma resposta que diferencie "enviamos"
 * de "não encontramos" entrega a lista de e-mails válidos a quem perguntar
 * educadamente.
 */
export function solicitarRecuperacao(base: BaseDados, email: string): Resultado<{ mensagem: string }> {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
    return falha('REGRA_DE_NEGOCIO', 'Informe um e-mail válido.', { campo: 'email' })
  }
  // A busca acontece e o resultado é descartado de propósito: é o que mantém o
  // tempo de resposta parecido nos dois casos.
  base.usuarios.find((u) => u.email.toLowerCase() === email.trim().toLowerCase())
  return sucesso({
    mensagem:
      'Se houver uma conta com este e-mail, enviamos as instruções de recuperação. O link vale por 30 minutos.',
  })
}

/** Primeiro acesso: o convidado define a própria senha, e só então entra. */
export function definirSenhaPrimeiroAcesso(
  base: BaseDados,
  usuarioId: string,
  senha: string,
  confirmacao: string,
): Resultado<Usuario> {
  const usuario = base.usuarios.find((u) => u.id === usuarioId)
  if (!usuario) return falha('NAO_ENCONTRADO', 'Usuário não encontrado.')

  // Mínimo de 12 caracteres: é o piso da política padrão do locatário na
  // migração 0015 (`tenant.politica_senha`), não um número escolhido aqui.
  if (senha.length < 12) {
    return falha('REGRA_DE_NEGOCIO', 'A senha precisa de ao menos 12 caracteres.', { campo: 'senha' })
  }
  if (senha !== confirmacao) {
    return falha('REGRA_DE_NEGOCIO', 'A confirmação não coincide com a senha.', { campo: 'confirmacao' })
  }

  usuario.conviteAceito = true
  return sucesso(usuario)
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
 * o conteúdo nunca é executado nem renderizado como HTML, e a entrega é sempre
 * um salvamento — `download` no link, ou o salvamento mediado do visualizador
 * de artefato — nunca navegação para o arquivo. Um `.html` anexado baixa; não
 * abre no contexto da aplicação, em nenhum dos dois caminhos.
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

  // Retenção fiscal: 5 anos a contar do envio (CTN art. 173 — prazo decadencial
  // para o Fisco constituir crédito tributário). O XML da NF-e é o documento
  // *original*; o DANFE é só representação dele. Perder o XML é perder o
  // documento, e a multa é do locador, não de quem clicou.
  const alvo = base.anexos[i]!
  if (CATEGORIAS_FISCAIS.has(alvo.categoria)) {
    const liberaEm = somarMesesIso(alvo.enviadoEm, ANOS_RETENCAO_FISCAL * 12)
    if (liberaEm > iso(HOJE)) {
      return falha(
        'REGRA_DE_NEGOCIO',
        `“${alvo.nome}” é documento fiscal e tem retenção obrigatória de ${ANOS_RETENCAO_FISCAL} anos. Removível a partir de ${liberaEm.split('-').reverse().join('/')}.`,
        {
          campo: 'motivo',
          acoes: ['Enviar a versão correta como novo anexo', 'Registrar a divergência na observação da nota'],
        },
      )
    }
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
  NOTA_FISCAL: [
    { valor: 'XML_NFE', texto: 'XML da NF-e (documento original)' },
    { valor: 'DANFE', texto: 'DANFE em PDF' },
    { valor: 'BOLETO_COMPRA', texto: 'Boleto ou comprovante de pagamento' },
    { valor: 'OUTRO', texto: 'Outro documento' },
  ],
}

/**
 * Categorias sujeitas à retenção fiscal.
 *
 * O boleto fica de fora de propósito: é comprovante de pagamento, não
 * documento fiscal do imobilizado, e prendê-lo por cinco anos seria estender a
 * regra sem base legal.
 */
export const CATEGORIAS_FISCAIS = new Set<CategoriaAnexo>(['XML_NFE', 'DANFE'])
export const ANOS_RETENCAO_FISCAL = 5

export const ROTULO_CATEGORIA: Record<CategoriaAnexo, string> = {
  CONTRATO_ASSINADO: 'Contrato assinado',
  PROPOSTA: 'Proposta comercial',
  ADITIVO: 'Aditivo',
  TERMO_ENTREGA: 'Termo de entrega',
  CARTAO_CNPJ: 'Cartão CNPJ',
  CONTRATO_SOCIAL: 'Contrato social',
  CERTIDAO: 'Certidão',
  PROCURACAO: 'Procuração',
  XML_NFE: 'XML da NF-e',
  DANFE: 'DANFE',
  BOLETO_COMPRA: 'Boleto de compra',
  OUTRO: 'Outro documento',
}

/* ==================================================== nota fiscal de compra = */

/**
 * Entrada fiscal de compra.
 *
 * A inversão que este módulo introduz: **o ativo nasce da nota**. Antes,
 * `valorAquisicao` era digitado no cadastro de equipamento — duas unidades da
 * mesma compra podiam ficar com valores diferentes, e a data de início da
 * depreciação e o prazo de garantia não tinham origem alguma.
 *
 * O fluxo tem três portões, e nenhum deles é decorativo:
 *
 *  1. **Lançamento** — cabeçalho e itens, do XML quando existe (RN-L08).
 *  2. **Conferência** — só passa com todas as unidades identificadas por série
 *     e patrimônio (RN-L02). É a conferência física, e é o que impede que a
 *     nota vire patrimônio antes de alguém ter aberto as caixas.
 *  3. **Integração** — cria os ativos numa transação só (RN-L03) e sela a nota
 *     (RN-L01). Depois disso a nota não muda mais: os ativos já carregam valor
 *     de aquisição e garantia derivados dela.
 *
 * Em `apps/api` estas regras vivem no banco — RN-L01 e RN-L02 são gatilhos,
 * não `if`. Aqui são replicadas em memória com as mesmas mensagens.
 */

/** Custo de aquisição do imobilizado: total da nota menos tributos recuperáveis. */
export function custoAquisicao(n: NotaFiscal): number {
  return arredondar(
    n.valorTotal - (n.icmsRecuperavel ? n.valorIcms : 0) - (n.ipiRecuperavel ? n.valorIpi : 0),
  )
}

export function notaPorId(base: BaseDados, id: string): NotaFiscal | undefined {
  return base.notasFiscais.find((n) => n.id === id)
}

export interface DadosItemNota {
  modeloId: string
  descricaoNf: string
  codigoFornecedor?: string
  ncm?: string
  cfop?: string
  unidade?: string
  quantidade: number
  valorUnitario: number
  valorTotalItem: number
  garantiaMeses: number | null
}

export interface DadosNotaFiscal {
  fornecedorId: string
  filialDestinoId: string
  numero: string
  serie: string
  chaveAcesso: string | null
  modeloDocumento: string
  dataEmissao: string
  dataEntrada: string
  valorProdutos: number
  valorFrete: number
  valorSeguro: number
  valorOutrasDespesas: number
  valorDesconto: number
  valorIpi: number
  valorIcms: number
  valorIcmsSt: number
  valorTotal: number
  icmsRecuperavel: boolean
  ipiRecuperavel: boolean
  origemDados: 'MANUAL' | 'XML'
  observacao?: string
  itens: DadosItemNota[]
}

export function criarNotaFiscal(
  base: BaseDados,
  dados: DadosNotaFiscal,
  criadaPor = 'Operação IARX',
): Resultado<NotaFiscal> {
  const fornecedor = base.fornecedores.find((f) => f.id === dados.fornecedorId)
  if (!fornecedor) return falha('NAO_ENCONTRADO', 'Selecione o fornecedor da nota.', { campo: 'fornecedorId' })

  if (!dados.numero.trim()) return falha('PAYLOAD_INVALIDO', 'Informe o número da nota.', { campo: 'numero' })
  if (!dados.serie.trim()) return falha('PAYLOAD_INVALIDO', 'Informe a série da nota.', { campo: 'serie' })

  if (dados.dataEntrada < dados.dataEmissao) {
    return falha('REGRA_DE_NEGOCIO', 'A entrada não pode ser anterior à emissão da nota.', {
      campo: 'dataEntrada',
      acoes: ['Conferir a data de emissão no DANFE'],
    })
  }
  if (dados.dataEntrada > iso(HOJE)) {
    return falha('REGRA_DE_NEGOCIO', 'A entrada não pode ser em data futura.', { campo: 'dataEntrada' })
  }

  // A chave carrega verificação própria. Recusar aqui evita que o erro só
  // apareça na conciliação fiscal, meses depois.
  if (dados.chaveAcesso) {
    const limpa = somenteDigitos(dados.chaveAcesso)
    if (!chaveValida(limpa)) {
      return falha('PAYLOAD_INVALIDO', 'A chave de acesso não passa na verificação do dígito.', {
        campo: 'chaveAcesso',
        acoes: ['Conferir os 44 dígitos no rodapé do DANFE', 'Enviar o XML em vez de digitar'],
      })
    }

    const partes = decomporChave(limpa)!
    if (partes.cnpjEmitente !== somenteDigitos(fornecedor.cnpj)) {
      return falha(
        'REGRA_DE_NEGOCIO',
        `A chave é do emitente ${formatarCnpj(partes.cnpjEmitente)}, e a nota está sendo lançada para ${fornecedor.razaoSocial}.`,
        { campo: 'chaveAcesso', acoes: ['Selecionar o fornecedor correto', 'Conferir se o XML é desta compra'] },
      )
    }
    if (partes.numero !== String(Number(dados.numero)) || partes.serie !== String(Number(dados.serie))) {
      return falha(
        'REGRA_DE_NEGOCIO',
        `A chave é da nota ${partes.serie}/${partes.numero}, e o cabeçalho declara ${dados.serie}/${dados.numero}.`,
        { campo: 'chaveAcesso' },
      )
    }
    if (partes.competencia !== dados.dataEmissao.slice(0, 7)) {
      return falha(
        'REGRA_DE_NEGOCIO',
        `A chave é da competência ${partes.competencia}, e a emissão informada é ${dados.dataEmissao}.`,
        { campo: 'dataEmissao' },
      )
    }

    const repetida = base.notasFiscais.find(
      (n) => n.chaveAcesso === limpa && n.status !== 'CANCELADA',
    )
    if (repetida) {
      return falha('RECURSO_DUPLICADO', `Esta chave já foi lançada na nota ${repetida.serie}/${repetida.numero}.`, {
        campo: 'chaveAcesso',
        acoes: [`Abrir a nota ${repetida.serie}/${repetida.numero}`],
      })
    }
  }

  const duplicada = base.notasFiscais.find(
    (n) =>
      n.fornecedorId === dados.fornecedorId &&
      n.numero === dados.numero.trim() &&
      n.serie === dados.serie.trim() &&
      n.modeloDocumento === dados.modeloDocumento &&
      n.status !== 'CANCELADA',
  )
  if (duplicada) {
    return falha('RECURSO_DUPLICADO', `A nota ${dados.serie}/${dados.numero} deste fornecedor já foi lançada.`, {
      campo: 'numero',
      acoes: [`Abrir a nota ${duplicada.serie}/${duplicada.numero}`],
    })
  }

  if (dados.itens.length === 0) {
    return falha('PAYLOAD_INVALIDO', 'Uma nota sem item não descreve compra alguma.', { campo: 'itens' })
  }

  for (const [i, item] of dados.itens.entries()) {
    if (!item.modeloId) {
      return falha(
        'PAYLOAD_INVALIDO',
        `Vincule o item ${i + 1} (“${item.descricaoNf}”) a um modelo do catálogo.`,
        { campo: 'itens', acoes: ['Cadastrar o modelo, se ainda não existir'] },
      )
    }
    if (!modeloPorId.has(item.modeloId)) {
      return falha('NAO_ENCONTRADO', `Modelo do item ${i + 1} não existe no catálogo.`, { campo: 'itens' })
    }
    if (!Number.isInteger(item.quantidade) || item.quantidade <= 0) {
      return falha('PAYLOAD_INVALIDO', `A quantidade do item ${i + 1} precisa ser um número inteiro de unidades.`, {
        campo: 'itens',
      })
    }
    if (Math.abs(item.valorTotalItem - item.quantidade * item.valorUnitario) > 0.01) {
      return falha(
        'REGRA_DE_NEGOCIO',
        `O total do item ${i + 1} não fecha com quantidade × valor unitário.`,
        { campo: 'itens' },
      )
    }
  }

  const somaItens = arredondar(dados.itens.reduce((s, i) => s + i.valorTotalItem, 0))
  if (Math.abs(somaItens - dados.valorProdutos) > 0.01) {
    return falha(
      'REGRA_DE_NEGOCIO',
      `A soma dos itens (${moedaSimples(somaItens)}) não fecha com o valor dos produtos (${moedaSimples(dados.valorProdutos)}).`,
      { campo: 'valorProdutos' },
    )
  }

  const dif = diferencaTotal(dados)
  if (dif !== null) {
    return falha(
      'REGRA_DE_NEGOCIO',
      `O total da nota está ${dif > 0 ? 'acima' : 'abaixo'} do somatório em ${moedaSimples(Math.abs(dif))}.`,
      {
        campo: 'valorTotal',
        acoes: ['Conferir frete, seguro, despesas, IPI, ST e desconto no DANFE'],
      },
    )
  }
  if (dados.valorIcms > dados.valorProdutos) {
    // ICMS é imposto por dentro: está contido no valor dos produtos.
    return falha('REGRA_DE_NEGOCIO', 'O ICMS destacado não pode exceder o valor dos produtos.', { campo: 'valorIcms' })
  }

  const nota: NotaFiscal = {
    id: novoId('nf'),
    fornecedorId: dados.fornecedorId,
    filialDestinoId: dados.filialDestinoId,
    numero: dados.numero.trim(),
    serie: dados.serie.trim(),
    chaveAcesso: dados.chaveAcesso ? somenteDigitos(dados.chaveAcesso) : null,
    modeloDocumento: dados.modeloDocumento,
    dataEmissao: dados.dataEmissao,
    dataEntrada: dados.dataEntrada,
    valorProdutos: dados.valorProdutos,
    valorFrete: dados.valorFrete,
    valorSeguro: dados.valorSeguro,
    valorOutrasDespesas: dados.valorOutrasDespesas,
    valorDesconto: dados.valorDesconto,
    valorIpi: dados.valorIpi,
    valorIcms: dados.valorIcms,
    valorIcmsSt: dados.valorIcmsSt,
    valorTotal: dados.valorTotal,
    icmsRecuperavel: dados.icmsRecuperavel,
    ipiRecuperavel: dados.ipiRecuperavel,
    status: 'PENDENTE_CONFERENCIA',
    origemDados: dados.origemDados,
    observacao: dados.observacao?.trim() || undefined,
    conferidaEm: null,
    conferidaPor: null,
    integradaEm: null,
    integradaPor: null,
    canceladaEm: null,
    motivoCancelamento: null,
    criadaPor,
    itens: dados.itens.map((item, i) => ({
      id: novoId('nfi'),
      numeroItem: i + 1,
      modeloId: item.modeloId,
      descricaoNf: item.descricaoNf.trim(),
      codigoFornecedor: item.codigoFornecedor?.trim() ?? '',
      ncm: item.ncm ?? '',
      cfop: item.cfop ?? '',
      unidade: item.unidade || 'UN',
      quantidade: item.quantidade,
      valorUnitario: item.valorUnitario,
      valorTotalItem: item.valorTotalItem,
      garantiaMeses: item.garantiaMeses,
      garantiaAte: null,
      series: [],
    })),
  }

  base.notasFiscais.push(nota)
  return sucesso(nota)
}

export interface DadosSerie {
  numeroSerie: string
  patrimonio: string
}

/**
 * Informa série e patrimônio das unidades de um item.
 *
 * Substitui o conjunto inteiro do item, não acrescenta: a tela edita uma
 * grade de `quantidade` linhas, e um comando que só adiciona tornaria
 * impossível corrigir uma leitura de código de barras errada.
 *
 * Valida tudo antes de gravar qualquer coisa. Um lote parcialmente aceito
 * deixa o conferente sem saber quais linhas entraram.
 */
export function definirSeriesItem(
  base: BaseDados,
  notaId: string,
  itemId: string,
  unidades: DadosSerie[],
): Resultado<NotaFiscalItem> {
  const nota = notaPorId(base, notaId)
  if (!nota) return falha('NAO_ENCONTRADO', 'Nota fiscal não encontrada.')
  if (nota.status === 'INTEGRADA') {
    return falha('TRANSICAO_INVALIDA', `A nota ${nota.serie}/${nota.numero} já foi integrada e não aceita alteração.`, {
      acoes: ['Registrar uma nota de ajuste referenciando a original'],
    })
  }
  if (nota.status === 'CANCELADA') {
    return falha('TRANSICAO_INVALIDA', 'Esta nota está cancelada.', { acoes: ['Lançar a entrada novamente'] })
  }

  const item = nota.itens.find((i) => i.id === itemId)
  if (!item) return falha('NAO_ENCONTRADO', 'Item não encontrado nesta nota.')

  if (unidades.length !== item.quantidade) {
    return falha(
      'PAYLOAD_INVALIDO',
      `O item ${item.numeroItem} tem ${item.quantidade} unidade(s); foram informadas ${unidades.length}.`,
      { campo: 'unidades' },
    )
  }

  // Índice do que já está em uso, ignorando as linhas do próprio item — que
  // estão sendo substituídas.
  const seriesEmUso = new Map<string, string>()
  const patrimoniosEmUso = new Map<string, string>()

  for (const e of base.equipamentos) {
    seriesEmUso.set(e.numeroSerie.toUpperCase(), `equipamento ${e.patrimonio}`)
    patrimoniosEmUso.set(e.patrimonio.toUpperCase(), `equipamento ${e.patrimonio}`)
  }
  for (const n of base.notasFiscais) {
    if (n.status === 'CANCELADA') continue
    for (const outro of n.itens) {
      if (outro.id === itemId) continue
      for (const s of outro.series) {
        const onde = `nota ${n.serie}/${n.numero}, item ${outro.numeroItem}`
        seriesEmUso.set(s.numeroSerie.toUpperCase(), onde)
        patrimoniosEmUso.set(s.patrimonio.toUpperCase(), onde)
      }
    }
  }

  const vistosSerie = new Set<string>()
  const vistosPatrimonio = new Set<string>()

  for (const [i, u] of unidades.entries()) {
    const serie = u.numeroSerie.trim()
    const patrimonio = u.patrimonio.trim()

    if (!serie) {
      return falha('PAYLOAD_INVALIDO', `Informe o número de série da unidade ${i + 1}.`, { campo: `serie-${i}` })
    }
    if (!patrimonio) {
      return falha('PAYLOAD_INVALIDO', `Informe o patrimônio da unidade ${i + 1}.`, { campo: `patrimonio-${i}` })
    }

    const chaveSerie = serie.toUpperCase()
    const chavePatrimonio = patrimonio.toUpperCase()

    if (vistosSerie.has(chaveSerie)) {
      // Quase sempre é o leitor de código de barras lendo a mesma etiqueta
      // duas vezes — a caixa seguinte ficou sem ser bipada.
      return falha('RECURSO_DUPLICADO', `A série ${serie} foi informada duas vezes neste item.`, {
        campo: `serie-${i}`,
        acoes: ['Conferir se a etiqueta foi lida duas vezes'],
      })
    }
    if (vistosPatrimonio.has(chavePatrimonio)) {
      return falha('RECURSO_DUPLICADO', `O patrimônio ${patrimonio} foi informado duas vezes neste item.`, {
        campo: `patrimonio-${i}`,
      })
    }

    const conflitoSerie = seriesEmUso.get(chaveSerie)
    if (conflitoSerie) {
      return falha('RECURSO_DUPLICADO', `A série ${serie} já pertence ao ${conflitoSerie}.`, {
        campo: `serie-${i}`,
        acoes: ['Conferir a etiqueta da unidade'],
      })
    }
    const conflitoPatrimonio = patrimoniosEmUso.get(chavePatrimonio)
    if (conflitoPatrimonio) {
      return falha('RECURSO_DUPLICADO', `O patrimônio ${patrimonio} já pertence ao ${conflitoPatrimonio}.`, {
        campo: `patrimonio-${i}`,
        acoes: ['Usar a próxima etiqueta da sequência da filial'],
      })
    }

    vistosSerie.add(chaveSerie)
    vistosPatrimonio.add(chavePatrimonio)
  }

  item.series = unidades.map((u) => ({
    id: novoId('nfs'),
    numeroSerie: u.numeroSerie.trim(),
    patrimonio: u.patrimonio.trim(),
    equipamentoId: null,
  }))

  return sucesso(item)
}

/** Sugere o próximo patrimônio livre, seguindo a numeração já em uso. */
export function proximoPatrimonio(base: BaseDados): string {
  let maior = 10000
  for (const e of base.equipamentos) {
    const n = Number(e.patrimonio)
    if (Number.isFinite(n) && n > maior) maior = n
  }
  for (const n of base.notasFiscais) {
    for (const item of n.itens) {
      for (const s of item.series) {
        const v = Number(s.patrimonio)
        if (Number.isFinite(v) && v > maior) maior = v
      }
    }
  }
  return String(maior + 1)
}

/** Itens que ainda não têm todas as unidades identificadas (RN-L02). */
export function itensIncompletos(nota: NotaFiscal): NotaFiscalItem[] {
  return nota.itens.filter((i) => i.series.length !== i.quantidade)
}

export function conferirNota(base: BaseDados, notaId: string, conferidaPor: string): Resultado<NotaFiscal> {
  const nota = notaPorId(base, notaId)
  if (!nota) return falha('NAO_ENCONTRADO', 'Nota fiscal não encontrada.')

  if (nota.status !== 'PENDENTE_CONFERENCIA') {
    return falha('TRANSICAO_INVALIDA', `A nota ${nota.serie}/${nota.numero} não está pendente de conferência.`)
  }
  if (nota.itens.length === 0) {
    return falha('REGRA_DE_NEGOCIO', 'Uma nota sem item não descreve compra alguma.')
  }

  const faltando = itensIncompletos(nota)
  if (faltando.length > 0) {
    const primeiro = faltando[0]!
    return falha(
      'REGRA_DE_NEGOCIO',
      `O item ${primeiro.numeroItem} (${primeiro.descricaoNf}) tem ${primeiro.series.length} de ${primeiro.quantidade} unidades identificadas.`,
      {
        acoes: faltando.map((i) => `Informar as séries do item ${i.numeroItem}`),
      },
    )
  }

  // Segregação de funções (RN-027): quem lançou a nota não a confere. A
  // conferência existe para ser uma segunda pessoa olhando a mercadoria; se
  // fosse a mesma, seria só um segundo clique.
  if (nota.criadaPor === conferidaPor) {
    return falha(
      'PERMISSAO_NEGADA',
      `A nota foi lançada por ${nota.criadaPor}. A conferência é de outra pessoa — é o que a torna uma conferência.`,
      { acoes: ['Solicitar a conferência a outro operador'] },
    )
  }

  nota.status = 'CONFERIDA'
  nota.conferidaEm = iso(HOJE)
  nota.conferidaPor = conferidaPor
  return sucesso(nota)
}

export interface UnidadePrevista {
  serieId: string
  itemId: string
  numeroItem: number
  patrimonio: string
  numeroSerie: string
  modeloId: string
  valorAquisicao: number
  garantiaAte: string | null
}

/**
 * Prévia da integração: os ativos que serão criados, com valor rateado.
 *
 * O rateio distribui o acessório — frete, seguro, ST, IPI e outras despesas,
 * menos desconto e tributos recuperáveis — proporcionalmente ao valor de cada
 * item. Pode ser **negativo**, quando o ICMS recuperável supera o frete; é o
 * resultado correto, não um erro de sinal.
 *
 * O resíduo de arredondamento vai inteiro para a primeira unidade de cada
 * item, de modo que a soma feche exatamente com o custo de aquisição da nota.
 * Distribuir o resíduo faria a conciliação depender da ordem de leitura;
 * concentrá-lo torna o desvio de um centavo localizável.
 *
 * Espelha `app.ratear_custo_nota` da migração 0010.
 */
export function previaIntegracao(nota: NotaFiscal): UnidadePrevista[] {
  const custo = custoAquisicao(nota)
  const acessorioTotal = arredondar(custo - nota.valorProdutos)
  const previstas: UnidadePrevista[] = []

  for (const item of nota.itens) {
    const acessorioItem =
      nota.valorProdutos === 0 ? 0 : (acessorioTotal * item.valorTotalItem) / nota.valorProdutos
    const custoItem = arredondar(item.valorTotalItem + acessorioItem)
    const porUnidade = arredondar(custoItem / item.quantidade)
    const residuo = arredondar(custoItem - porUnidade * item.quantidade)

    const garantia =
      item.garantiaAte ??
      (item.garantiaMeses !== null ? somarMesesIso(nota.dataEntrada, item.garantiaMeses) : null)

    const ordenadas = [...item.series].sort((a, b) => a.patrimonio.localeCompare(b.patrimonio, 'pt-BR'))
    ordenadas.forEach((s, i) => {
      previstas.push({
        serieId: s.id,
        itemId: item.id,
        numeroItem: item.numeroItem,
        patrimonio: s.patrimonio,
        numeroSerie: s.numeroSerie,
        modeloId: item.modeloId,
        valorAquisicao: i === 0 ? arredondar(porUnidade + residuo) : porUnidade,
        garantiaAte: garantia,
      })
    })
  }

  return previstas
}

/**
 * Integra a nota ao patrimônio: cria os ativos e sela a nota.
 *
 * Atômico por construção (RN-L03): tudo é validado, os equipamentos são
 * montados em memória e só então empurrados de uma vez. Falha em um significa
 * nenhum criado — um lote parcialmente integrado deixa o operador sem saber o
 * que entrou, e a única saída seria conferir cento e poucas etiquetas à mão.
 */
export function integrarNota(
  base: BaseDados,
  notaId: string,
  integradaPor: string,
): Resultado<{ nota: NotaFiscal; criados: Equipamento[] }> {
  const nota = notaPorId(base, notaId)
  if (!nota) return falha('NAO_ENCONTRADO', 'Nota fiscal não encontrada.')

  if (nota.status === 'INTEGRADA') {
    return falha('TRANSICAO_INVALIDA', `A nota ${nota.serie}/${nota.numero} já foi integrada ao patrimônio.`, {
      acoes: ['Abrir o parque filtrado nos ativos desta nota'],
    })
  }
  if (nota.status !== 'CONFERIDA') {
    return falha(
      'TRANSICAO_INVALIDA',
      'A nota precisa ser conferida antes de virar patrimônio.',
      { acoes: ['Conferir a nota'] },
    )
  }

  const previstas = previaIntegracao(nota)
  if (previstas.length === 0) {
    return falha('REGRA_DE_NEGOCIO', 'Não há unidades a integrar nesta nota.')
  }

  // Revalidação completa antes de escrever a primeira linha: entre a
  // conferência e a integração alguém pode ter cadastrado um equipamento à mão
  // com a mesma etiqueta.
  const seriesEmUso = new Map(base.equipamentos.map((e) => [e.numeroSerie.toUpperCase(), e.patrimonio]))
  const patrimoniosEmUso = new Map(base.equipamentos.map((e) => [e.patrimonio.toUpperCase(), e.patrimonio]))

  for (const u of previstas) {
    const conflito =
      seriesEmUso.get(u.numeroSerie.toUpperCase()) ?? patrimoniosEmUso.get(u.patrimonio.toUpperCase())
    if (conflito) {
      return falha(
        'RECURSO_DUPLICADO',
        `A unidade ${u.patrimonio} / ${u.numeroSerie} conflita com o equipamento ${conflito}, cadastrado depois da conferência.`,
        { acoes: ['Corrigir as séries do item', 'Conferir se o ativo já foi lançado à mão'] },
      )
    }
    if (!modeloPorId.has(u.modeloId)) {
      return falha('NAO_ENCONTRADO', `Modelo do item ${u.numeroItem} não existe mais no catálogo.`)
    }
  }

  const somaRateio = arredondar(previstas.reduce((s, u) => s + u.valorAquisicao, 0))
  const custo = custoAquisicao(nota)
  if (Math.abs(somaRateio - custo) > 0.005) {
    // Se isto disparar, o rateio tem defeito — e integrar produziria um
    // patrimônio que não reconcilia com a nota. Melhor recusar.
    return falha(
      'REGRA_DE_NEGOCIO',
      `O rateio soma ${moedaSimples(somaRateio)} e o custo de aquisição da nota é ${moedaSimples(custo)}.`,
      { acoes: ['Conferir os valores da nota'] },
    )
  }

  const filial = base.filiais.find((f) => f.id === nota.filialDestinoId)
  const criados: Equipamento[] = previstas.map((u) => {
    const modelo = modeloPorId.get(u.modeloId)!
    return {
      id: `eqp-${u.patrimonio}`,
      patrimonio: u.patrimonio,
      numeroSerie: u.numeroSerie,
      modeloId: u.modeloId,
      categoria: modelo.categoria,
      filialId: nota.filialDestinoId,
      // RN-L07: nasce disponível, na filial de destino, sem contrato. Nunca
      // nasce alocado — alocar é decisão comercial, não consequência da compra.
      status: 'DISPONIVEL',
      motivoIndisponibilidade: null,
      bloqueado: false,
      bloqueioMotivo: null,
      clienteId: null,
      localId: null,
      contratoId: null,
      regiaoId: filial?.regiaoId ?? base.regioes[0]!.id,
      contadorMono: 0,
      contadorColor: 0,
      historicoConsumo: [],
      dataAquisicao: nota.dataEntrada,
      valorAquisicao: u.valorAquisicao,
      receita12m: 0,
      custoManutencao12m: 0,
      diasParado: 0,
      ultimaPreventiva: null,
      proximaPreventivaPaginas: null,
      notaSerieId: u.serieId,
      garantiaAte: u.garantiaAte ?? undefined,
    }
  })

  // Ponto de escrita: daqui para baixo nada mais pode falhar.
  base.equipamentos.push(...criados)
  for (const item of nota.itens) {
    for (const s of item.series) {
      const criado = criados.find((e) => e.notaSerieId === s.id)
      if (criado) s.equipamentoId = criado.id
    }
    item.garantiaAte = previstas.find((u) => u.itemId === item.id)?.garantiaAte ?? item.garantiaAte
  }

  nota.status = 'INTEGRADA'
  nota.integradaEm = iso(HOJE)
  nota.integradaPor = integradaPor

  return sucesso({ nota, criados })
}

export function cancelarNota(base: BaseDados, notaId: string, motivo: string): Resultado<NotaFiscal> {
  const nota = notaPorId(base, notaId)
  if (!nota) return falha('NAO_ENCONTRADO', 'Nota fiscal não encontrada.')

  if (nota.status === 'INTEGRADA') {
    return falha(
      'TRANSICAO_INVALIDA',
      `A nota ${nota.serie}/${nota.numero} gerou ${nota.itens.reduce((s, i) => s + i.quantidade, 0)} ativos no patrimônio e não pode ser cancelada.`,
      { acoes: ['Baixa patrimonial dos ativos gerados', 'Registrar nota de devolução'] },
    )
  }
  if (nota.status === 'CANCELADA') {
    return falha('TRANSICAO_INVALIDA', 'Esta nota já está cancelada.')
  }
  if (motivo.trim().length < 5) {
    return falha('REGRA_DE_NEGOCIO', 'Informe o motivo do cancelamento — a operação é auditada.', { campo: 'motivo' })
  }

  nota.status = 'CANCELADA'
  nota.canceladaEm = iso(HOJE)
  nota.motivoCancelamento = motivo.trim()
  return sucesso(nota)
}

/* ------------------------------------------------------------- utilidades -- */

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Soma meses a uma data AAAA-MM-DD sem passar por fuso horário. */
function somarMesesIso(data: string, meses: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number]
  const total = (a * 12 + (m - 1)) + meses
  const ano = Math.floor(total / 12)
  const mes = (total % 12) + 1
  // Dia 31 somado a um mês de 30 cai no último dia do mês, não no dia 1 do
  // seguinte — que é como o cálculo de garantia é lido comercialmente.
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  const dia = Math.min(d, ultimoDia)
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

const moedaSimples = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
