/**
 * Registra o resolvedor de extensão para a suíte unitária.
 *
 * Arquivo separado porque `module.register` precisa rodar antes de qualquer
 * import do código sob teste — daí ele entrar por `--import`, e não por
 * `--loader`, que está em vias de sair.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./resolver.mjs', pathToFileURL(import.meta.filename))
