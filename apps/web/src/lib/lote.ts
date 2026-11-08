import type { Resultado } from '../dados/comandos'

/**
 * Execução de uma ação sobre muitos registros (Anexo Y §Y.3.4).
 *
 * ## Por que N chamadas, e não uma rota de lote
 *
 * A API tem `POST /equipamentos/:id/baixar`, uma por equipamento — não há rota
 * de lote. O lote daqui chama N vezes a rota que já existe e **relata o
 * resultado parcial**.
 *
 * A alternativa seria criar rotas `/lote` no servidor, com tudo-ou-nada numa
 * transação só. Tudo-ou-nada parece mais seguro e é pior aqui: das quinze
 * preventivas vencidas que alguém mandou bloquear, catorze podiam ter sido
 * bloqueadas. Desfazer as catorze porque a décima quinta tem contrato vigente
 * é jogar fora trabalho correto, e ainda esconde **qual** falhou. Rota de lote
 * também seria permissão nova e alçada nova por ação.
 *
 * ## Por que em série
 *
 * Em paralelo a ordem do relato depende de qual promessa resolve primeiro, e o
 * relato vira um conjunto sem ordem — ninguém encontra o registro que falhou.
 * Em série o relato sai na ordem em que a pessoa selecionou. O custo é
 * latência somada, e a barra de progresso existe para isso.
 *
 * ## O que conta como falha
 *
 * Três coisas distintas, e a interface não as mistura:
 *
 *  - **recusa de regra** — o comando devolveu `ok: false`. É resposta, não
 *    defeito: o banco disse por que não pode, com o nome da regra;
 *  - **exceção** — a chamada lançou. Rede, ou defeito;
 *  - **sem permissão** — nem foi tentada, porque o perfil não autoriza. Filtrar
 *    antes de chamar é o que impede N respostas 403 idênticas.
 */

export interface FalhaDoLote {
  id: string
  /** Como a pessoa reconhece o registro: patrimônio, número do chamado. */
  rotulo: string
  mensagem: string
  /** Nome da regra que recusou, quando o comando informa. */
  codigo?: string
  /** Saídas que o comando sugere. Recusa sem saída deixa o operador travado. */
  acoes?: string[]
}

export interface ResultadoLote {
  /** Ids que a ação concluiu. */
  concluidos: string[]
  recusados: FalhaDoLote[]
  /** Selecionados que nem foram tentados, por falta de permissão ou de estado. */
  ignorados: FalhaDoLote[]
}

export interface AlvoDoLote {
  id: string
  rotulo: string
  /** Preenchido quando este alvo não deve ser tentado; vira `ignorados`. */
  impedimento?: string
}

/**
 * Roda `acao` sobre cada alvo, em série, e junta o que aconteceu.
 *
 * `aoProgredir` recebe quantos já terminaram — a barra de lote a usa para
 * anunciar progresso, e é também o que permite a quem olha saber que a lista
 * longa não travou.
 */
export async function executarLote(
  alvos: AlvoDoLote[],
  acao: (id: string) => Promise<Resultado<unknown>>,
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<ResultadoLote> {
  const concluidos: string[] = []
  const recusados: FalhaDoLote[] = []
  const ignorados: FalhaDoLote[] = []

  const tentaveis = alvos.filter((a) => {
    if (a.impedimento) {
      ignorados.push({ id: a.id, rotulo: a.rotulo, mensagem: a.impedimento })
      return false
    }
    return true
  })

  let feitos = 0
  for (const alvo of tentaveis) {
    try {
      const r = await acao(alvo.id)
      if (r.ok) {
        concluidos.push(alvo.id)
      } else {
        recusados.push({
          id: alvo.id,
          rotulo: alvo.rotulo,
          mensagem: r.erro.mensagem,
          codigo: r.erro.codigo,
          acoes: r.erro.acoes,
        })
      }
    } catch (e) {
      /*
       * Uma exceção numa linha não interrompe as demais.
       *
       * Parar no primeiro erro faria uma queda de rede na terceira de vinte
       * linhas deixar dezessete sem tentativa e sem explicação — e, pior, sem
       * registro de que não foram tentadas.
       */
      recusados.push({
        id: alvo.id,
        rotulo: alvo.rotulo,
        mensagem: e instanceof Error ? e.message : 'Falha inesperada.',
      })
    }
    feitos += 1
    aoProgredir?.(feitos, tentaveis.length)
  }

  return { concluidos, recusados, ignorados }
}
