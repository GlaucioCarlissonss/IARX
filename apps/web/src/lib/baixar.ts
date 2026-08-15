/**
 * Entrega de arquivo ao usuário, pelo caminho que o ambiente permite.
 *
 * Existem dois, e a diferença não é detalhe de implementação:
 *
 *  · **Navegador comum** — servidor de desenvolvimento, hospedagem própria ou o
 *    arquivo único aberto por duplo clique. Um `<a download>` com URL de blob
 *    resolve, e `download` é o que força o salvamento em vez de navegar para o
 *    conteúdo — é por isso que aceitar anexo de qualquer tipo é seguro.
 *
 *  · **Visualizador de artefato** — a página roda numa moldura isolada em que
 *    **nenhum download iniciado pela própria página acontece**. Link `download`,
 *    `blob:`, `data:`, salvamento por script: tudo inerte, e sem erro. O botão
 *    parecia funcionar e não entregava nada, que é a pior forma de falhar.
 *    Ali a entrega passa por `claude.downloads.save`, que mostra ao usuário o
 *    nome e o tamanho finais e só grava se ele aceitar.
 *
 * Este módulo escolhe o caminho e devolve o que aconteceu. Quem chama precisa
 * saber: uma recusa do usuário não é erro, e um tipo de arquivo não permitido
 * precisa ser dito, não engolido.
 */

export interface ResultadoDownload {
  situacao: 'salvo' | 'cancelado' | 'falhou'
  /** Texto para o usuário. Presente quando falhou, e quando salvou com ressalva. */
  aviso?: string
}

/**
 * Tipos que o visualizador aceita sem configuração adicional.
 *
 * A lista não é nossa — é do runtime do artefato — e está aqui só para a
 * mensagem de recusa poder dizer o que **é** aceito em vez de apenas que aquilo
 * não é. Beco sem saída é o que a interface não pode oferecer.
 */
const TIPOS_BASE = 'gif, png, jpg, jpeg, webp, mp4, webm, txt, json e md'

interface Downloads {
  save(r: { filename: string; data: Blob | string }): Promise<{ status: 'saved' }>
}

interface PonteClaude {
  use(nome: string): Promise<unknown>
}

/**
 * A ponte do visualizador, quando existe.
 *
 * A checagem também **identifica o ambiente**: fora do artefato `claude` não
 * existe, e é assim que o módulo sabe que pode usar o caminho nativo do
 * navegador em vez de reportar indisponibilidade.
 */
function ponte(): PonteClaude | null {
  const c = (globalThis as { claude?: Partial<PonteClaude> }).claude
  return c && typeof c.use === 'function' ? (c as PonteClaude) : null
}

/**
 * Entrega o arquivo.
 *
 * `alternativa` cobre um caso concreto: `csv` está no conjunto **estendido** de
 * extensões do visualizador, que pode não estar habilitado. Em vez de deixar a
 * exportação morrer ali, o mesmo conteúdo vai como `.txt` — que o Excel importa
 * pelo assistente — e o usuário é avisado da troca.
 */
export async function baixar(
  nome: string,
  dados: Blob | string,
  alternativa?: string,
): Promise<ResultadoDownload> {
  const c = ponte()

  if (c) {
    const downloads = (await c.use('downloads').catch(() => null)) as Downloads | null
    if (!downloads) {
      return {
        situacao: 'falhou',
        aviso: 'Esta prévia não pode salvar arquivos. Abra a aplicação hospedada para exportar.',
      }
    }
    return salvarPeloVisualizador(downloads, nome, dados, alternativa)
  }

  // Navegador comum. A URL do blob é criada no clique e revogada logo depois:
  // mantê-la viva por linha da tabela seguraria todo arquivo em memória
  // enquanto o diálogo estivesse aberto.
  const blob = typeof dados === 'string' ? new Blob([dados], { type: 'text/plain;charset=utf-8' }) : dados
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return { situacao: 'salvo' }
}

/**
 * Exportado para teste.
 *
 * Recebe o `downloads` por parâmetro em vez de buscá-lo no `globalThis`, e é o
 * que torna toda a tradução de código de erro verificável sem navegador: um
 * objeto falso que rejeita com o código desejado cobre cada ramo.
 */
export async function salvarPeloVisualizador(
  downloads: Downloads,
  nome: string,
  dados: Blob | string,
  alternativa: string | undefined,
): Promise<ResultadoDownload> {
  try {
    await downloads.save({ filename: nome, data: dados })
    return { situacao: 'salvo' }
  } catch (e) {
    const codigo = (e as { code?: string }).code ?? 'unavailable'

    // O usuário disse não. Não é erro, não repete e não merece mensagem: ele
    // sabe o que fez.
    if (codigo === 'declined') return { situacao: 'cancelado' }

    if (codigo === 'extension_not_enabled' && alternativa) {
      try {
        await downloads.save({ filename: alternativa, data: dados })
        return {
          situacao: 'salvo',
          aviso: `Esta prévia não aceita ${extensao(nome)}; o arquivo foi salvo como ${alternativa}. O conteúdo é o mesmo — no Excel, use Dados › Obter dados de texto.`,
        }
      } catch (e2) {
        if ((e2 as { code?: string }).code === 'declined') return { situacao: 'cancelado' }
        return { situacao: 'falhou', aviso: MENSAGEM['unavailable'] }
      }
    }

    return { situacao: 'falhou', aviso: MENSAGEM[codigo] ?? MENSAGEM['unavailable'] }
  }
}

const MENSAGEM: Record<string, string> = {
  rejected_extension: `Esta prévia não salva arquivos deste tipo. Ela aceita ${TIPOS_BASE}. Na aplicação hospedada, qualquer tipo é baixado normalmente.`,
  extension_not_enabled: `Esta prévia não salva arquivos deste tipo. Ela aceita ${TIPOS_BASE}.`,
  too_large: 'Arquivo acima do limite de 16 MB desta prévia. Baixe pela aplicação hospedada.',
  rate_limited: 'Já há um pedido de download aberto. Conclua-o e tente de novo.',
  bad_request: 'Não foi possível preparar o arquivo para download.',
  unavailable: 'O download não está disponível nesta prévia. Abra a aplicação hospedada para baixar.',
}

function extensao(nome: string): string {
  const i = nome.lastIndexOf('.')
  return i > 0 ? `.${nome.slice(i + 1).toLowerCase()}` : 'este formato'
}
