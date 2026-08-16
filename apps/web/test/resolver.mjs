/**
 * Resolvedor de import sem extensão, para os testes unitários do front.
 *
 * O código de `apps/web/src` importa `'./catalogo'`, sem extensão — convenção
 * do Vite, usada em todos os arquivos. O executor de TypeScript do Node exige o
 * caminho completo e falha com `ERR_MODULE_NOT_FOUND`.
 *
 * As três saídas possíveis, e por que esta:
 *
 *  1. **Pôr extensão em todo o front.** Diff enorme, e brigaria com a convenção
 *     do bundler que o resto do ecossistema React segue.
 *  2. **Testar só pela interface, com Playwright.** É o que já acontece para o
 *     comportamento visível — mas uma regra como "o último administrador não se
 *     desativa" merece um teste que rode em milissegundos e aponte a linha, não
 *     um que suba um navegador.
 *  3. **Ensinar o resolvedor a completar a extensão** — esta. Vinte linhas, e
 *     só afeta o processo de teste: nada em produção passa por aqui.
 *
 * Deliberadamente **só tenta `.ts`, e só depois de o caminho normal falhar**.
 * Um resolvedor que tentasse primeiro mascararia um arquivo `.js` legítimo, e
 * um que aceitasse qualquer extensão tornaria o erro de digitação silencioso.
 */
export async function resolve(especificador, contexto, proximo) {
  try {
    return await proximo(especificador, contexto)
  } catch (e) {
    const relativo = especificador.startsWith('./') || especificador.startsWith('../')
    const semExtensao = !/\.[cm]?[jt]sx?$/.test(especificador)

    if (relativo && semExtensao) {
      // Um único candidato: o mesmo caminho com `.ts`. Sem varredura de
      // diretório e sem `index.ts` — o front não usa nenhum dos dois, e
      // suportá-los aqui aceitaria estruturas que o Vite recusaria.
      return proximo(`${especificador}.ts`, contexto)
    }
    throw e
  }
}
