/**
 * Modo demonstração.
 *
 * A base de demonstração traz afordâncias que não pertencem a uma instalação
 * real — a mais evidente é o seletor de perfil na barra superior, que deixa
 * qualquer um assumir outro perfil para ver o efeito das permissões. Numa
 * operação de verdade isso contradiz o modelo que o servidor sustenta: o perfil
 * vem do token, e trocá-lo pela interface seria um caminho sem permissão e sem
 * trilha.
 *
 * ## Por que ligado por omissão
 *
 * O artefato de arquivo único **é** a demonstração: sem API configurada a
 * aplicação já opera sobre base em memória. Desligar por omissão faria a
 * demonstração perder a afordância que a explica, e quem a publica teria de
 * lembrar de ligá-la.
 *
 * A instalação real aponta para uma API — e é esse o sinal. `IARX_DEMO`
 * explícito tem a última palavra nos dois sentidos, para que uma demonstração
 * servida por API continue podendo mostrar perfis.
 */

interface JanelaDemo {
  __IARX_DEMO__?: boolean
}

function doAmbiente(): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env
  return env?.VITE_IARX_DEMO
}

function daJanela(): boolean | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as JanelaDemo).__IARX_DEMO__
}

/**
 * Se a aplicação está em modo demonstração.
 *
 * Ordem: janela, ambiente, e por fim a inferência — sem API configurada, é
 * demonstração. A inferência vem por último porque é a única que adivinha.
 */
export function emDemonstracao(enderecoApi: string): boolean {
  const janela = daJanela()
  if (janela !== undefined) return janela

  const env = doAmbiente()
  if (env !== undefined) return env !== 'false' && env !== '0'

  return enderecoApi === ''
}
