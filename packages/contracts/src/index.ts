/**
 * @iarx/contracts — a forma do contrato de API existe uma vez só.
 *
 * API e clientes importam daqui. O ganho não é economizar digitação: é que uma
 * mudança de formato vira erro de compilação nos dois lados no mesmo commit, em
 * vez de erro de runtime em produção semanas depois.
 *
 * O pacote não tem dependência de runtime além do Zod, de propósito — ele não
 * pode arrastar Nest para dentro do bundle do navegador.
 */
export * from './primitivos.js'
export * from './erros.js'
export * from './permissoes.js'
export * from './arvore-permissoes.js'
export * from './equipamento.js'
export * from './contrato.js'
export * from './nota-fiscal.js'
export * from './local-operacao.js'
export * from './auth.js'
export * from './financeiro-base.js'
export * from './contas-pagar.js'
