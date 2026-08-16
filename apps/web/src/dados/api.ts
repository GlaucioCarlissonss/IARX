import { gerarBase, HOJE, recalcularIndicadores } from './gerar'
import * as cmd from './comandos'
import type { Resultado } from './comandos'
import type { BaseDados, EntidadeAnexo } from './tipos'

/**
 * Fachada de acesso aos dados.
 *
 * Hoje serve a base gerada em memória; a assinatura é a mesma que uma API HTTP
 * teria (assíncrona, com latência e possibilidade de erro), para que a troca por
 * `fetch` no futuro não exija mudar nenhuma tela. É também o que permite exibir
 * skeleton de carregamento de verdade em vez de simulá-lo.
 */

const BASE: BaseDados = gerarBase()

/** Latência artificial, calibrada para parecer uma rede corporativa real. */
const LATENCIA_MS = { min: 120, max: 340 }

/** Ativar para exercitar os estados de erro da interface. */
export const simulacao = { taxaErro: 0, latencia: true }

function esperar() {
  if (!simulacao.latencia) return Promise.resolve()
  const ms = LATENCIA_MS.min + Math.random() * (LATENCIA_MS.max - LATENCIA_MS.min)
  return new Promise<void>((r) => setTimeout(r, ms))
}

export class ErroApi extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly acoes: string[] = [],
  ) {
    super(mensagem)
    this.name = 'ErroApi'
  }
}

async function responder<T>(fn: () => T): Promise<T> {
  await esperar()
  if (simulacao.taxaErro > 0 && Math.random() < simulacao.taxaErro) {
    throw new ErroApi(
      'FALHA_TEMPORARIA',
      'Não conseguimos carregar os dados agora.',
      ['Tentar novamente'],
    )
  }
  return fn()
}

/* -------------------------------------------------------------- assinatura */

/**
 * Notificação de mudança.
 *
 * Depois de uma escrita, toda tela aberta precisa refletir o novo estado — o
 * painel conta chamados abertos, a lista mostra o item recém-criado. Sem isto
 * a interface passaria a mentir logo após a ação, que é exatamente quando o
 * usuário está olhando para ela.
 *
 * É o mesmo papel que a invalidação de cache do TanStack Query cumpre; quando
 * a API real entrar, esta função sai e `useConsulta` passa a invalidar a chave.
 */
const ouvintes = new Set<() => void>()

export function assinarMudancas(fn: () => void): () => void {
  ouvintes.add(fn)
  return () => ouvintes.delete(fn)
}

function notificar() {
  BASE.indicadores = recalcularIndicadores(BASE)
  for (const fn of ouvintes) fn()
}

/**
 * Executa um comando com a mesma latência das leituras e notifica as telas.
 *
 * A latência não é enfeite: sem ela o botão nunca fica em "salvando", o estado
 * de envio nunca é exercitado e o formulário chega à API real sem nunca ter
 * mostrado progresso. Só notifica em caso de sucesso — recusa não muda nada.
 */
async function executar<T>(fn: () => Resultado<T>): Promise<Resultado<T>> {
  await esperar()
  const r = fn()
  if (r.ok) notificar()
  return r
}

export const api = {
  hoje: () => HOJE,
  /** Acesso sincrônico, para consultas derivadas que não vão à rede. */
  baseSincrona: () => BASE,

  /*
   * Cada leitura devolve uma coleção NOVA, não a referência interna.
   *
   * Não é zelo com imutabilidade: é o que faz a recarga após uma escrita
   * funcionar. Devolvendo o mesmo array, `useMemo([dado])` nas telas vê a mesma
   * identidade e não recalcula — a lista continuaria exibindo o estado anterior
   * à ação, mesmo tendo sido "recarregada". Um cliente HTTP real entrega
   * objetos novos a cada resposta, então copiar aqui também é mais fiel.
   */
  indicadores: () => responder(() => ({ ...BASE.indicadores })),
  clientes: () => responder(() => [...BASE.clientes]),
  contratos: () => responder(() => [...BASE.contratos]),
  equipamentos: () => responder(() => [...BASE.equipamentos]),
  ordens: () => responder(() => [...BASE.ordens]),
  pecas: () => responder(() => [...BASE.pecas]),
  faturas: () => responder(() => [...BASE.faturas]),
  tecnicos: () => responder(() => [...BASE.tecnicos]),
  fornecedores: () => responder(() => [...BASE.fornecedores]),
  usuarios: () => responder(() => [...BASE.usuarios]),
  perfis: () => responder(() => [...BASE.perfis]),
  notasFiscais: () => responder(() => [...BASE.notasFiscais]),
  anexos: (entidade: EntidadeAnexo, entidadeId: string) =>
    responder(() => cmd.anexosDe(BASE, entidade, entidadeId)),
  catalogo: () =>
    responder(() => ({
      modelos: BASE.modelos,
      fabricantes: BASE.fabricantes,
      categorias: BASE.categorias,
      regioes: BASE.regioes,
      filiais: BASE.filiais,
    })),

  /* --------------------------------------------------------------- escrita */

  abrirChamado: (d: cmd.DadosAbrirChamado) => executar(() => cmd.abrirChamado(BASE, d)),
  atribuirTecnico: (ordemId: string, tecnicoId: string) => executar(() => cmd.atribuirTecnico(BASE, ordemId, tecnicoId)),
  concluirChamado: (ordemId: string, d: cmd.DadosConcluirChamado) =>
    executar(() => cmd.concluirChamado(BASE, ordemId, d)),

  criarCliente: (d: cmd.DadosCliente) => executar(() => cmd.criarCliente(BASE, d)),

  convidarUsuario: (d: cmd.DadosConvite) => executar(() => cmd.convidarUsuario(BASE, d)),
  atribuirPerfil: (usuarioId: string, perfilId: string) =>
    executar(() => cmd.atribuirPerfil(BASE, usuarioId, perfilId)),
  revogarPerfil: (usuarioId: string, perfilId: string) =>
    executar(() => cmd.revogarPerfil(BASE, usuarioId, perfilId)),
  desativarUsuario: (usuarioId: string, motivo: string) =>
    executar(() => cmd.desativarUsuario(BASE, usuarioId, motivo)),
  ativarUsuario: (usuarioId: string) => executar(() => cmd.ativarUsuario(BASE, usuarioId)),
  salvarPerfil: (perfilId: string | null, d: cmd.DadosPerfil) =>
    executar(() => cmd.salvarPerfil(BASE, perfilId, d)),
  definirLocalizacaoCliente: (clienteId: string, d: Parameters<typeof cmd.definirLocalizacaoCliente>[2]) =>
    executar(() => cmd.definirLocalizacaoCliente(BASE, clienteId, d)),
  definirCredito: (clienteId: string, situacao: 'LIBERADO' | 'OBSERVACAO' | 'BLOQUEADO', motivo: string) =>
    executar(() => cmd.definirCredito(BASE, clienteId, situacao, motivo)),

  criarContrato: (d: cmd.DadosContrato) => executar(() => cmd.criarContrato(BASE, d)),
  mudarStatusContrato: (contratoId: string, destino: Parameters<typeof cmd.mudarStatusContrato>[2]) =>
    executar(() => cmd.mudarStatusContrato(BASE, contratoId, destino)),
  alocarEquipamento: (contratoId: string, d: cmd.DadosAlocacao) =>
    executar(() => cmd.alocarEquipamento(BASE, contratoId, d)),

  criarEquipamento: (d: cmd.DadosEquipamento) => executar(() => cmd.criarEquipamento(BASE, d)),
  bloquearEquipamento: (id: string, motivo: string) => executar(() => cmd.bloquearEquipamento(BASE, id, motivo)),
  desbloquearEquipamento: (id: string) => executar(() => cmd.desbloquearEquipamento(BASE, id)),
  registrarLeitura: (id: string, d: cmd.DadosLeitura) => executar(() => cmd.registrarLeitura(BASE, id, d)),

  movimentarEstoque: (pecaId: string, d: cmd.DadosMovimento) => executar(() => cmd.movimentarEstoque(BASE, pecaId, d)),
  definirPolitica: (pecaId: string, d: cmd.DadosPolitica) => executar(() => cmd.definirPolitica(BASE, pecaId, d)),

  resolverMedicao: (equipamentoId: string, competencia: string, d: cmd.DadosMedicao) =>
    executar(() => cmd.resolverMedicao(BASE, equipamentoId, competencia, d)),

  anexarArquivos: (entidade: EntidadeAnexo, entidadeId: string, itens: cmd.DadosAnexo[]) =>
    executar(() => cmd.anexarArquivos(BASE, entidade, entidadeId, itens)),
  removerAnexo: (anexoId: string, motivo: string) => executar(() => cmd.removerAnexo(BASE, anexoId, motivo)),

  criarNotaFiscal: (d: cmd.DadosNotaFiscal, criadaPor: string) =>
    executar(() => cmd.criarNotaFiscal(BASE, d, criadaPor)),
  definirSeriesItem: (notaId: string, itemId: string, unidades: cmd.DadosSerie[]) =>
    executar(() => cmd.definirSeriesItem(BASE, notaId, itemId, unidades)),
  conferirNota: (notaId: string, conferidaPor: string) => executar(() => cmd.conferirNota(BASE, notaId, conferidaPor)),
  integrarNota: (notaId: string, integradaPor: string) => executar(() => cmd.integrarNota(BASE, notaId, integradaPor)),
  cancelarNota: (notaId: string, motivo: string) => executar(() => cmd.cancelarNota(BASE, notaId, motivo)),
}
