import { gerarBase, HOJE } from './gerar'
import type { BaseDados } from './tipos'

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

export const api = {
  hoje: () => HOJE,
  /** Acesso sincrônico, para consultas derivadas que não vão à rede. */
  baseSincrona: () => BASE,

  indicadores: () => responder(() => BASE.indicadores),
  clientes: () => responder(() => BASE.clientes),
  contratos: () => responder(() => BASE.contratos),
  equipamentos: () => responder(() => BASE.equipamentos),
  ordens: () => responder(() => BASE.ordens),
  pecas: () => responder(() => BASE.pecas),
  faturas: () => responder(() => BASE.faturas),
  tecnicos: () => responder(() => BASE.tecnicos),
  catalogo: () =>
    responder(() => ({
      modelos: BASE.modelos,
      fabricantes: BASE.fabricantes,
      categorias: BASE.categorias,
      regioes: BASE.regioes,
      filiais: BASE.filiais,
    })),
}
