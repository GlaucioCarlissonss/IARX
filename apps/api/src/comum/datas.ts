/**
 * Formatação de data para texto lido por humanos.
 *
 * Existe por causa de um erro fácil e caro: `data.toISOString().slice(0, 10)`
 * parece "pegar a data", mas devolve a data **em UTC**. Uma vigência que termina
 * em `2026-12-31T23:59:59-03:00` vira `2027-01-01` — o operador lê que o ativo
 * está ocupado até janeiro, sendo que ele libera em dezembro. O erro só aparece
 * depois das 21h no horário de Brasília, o que é exatamente o tipo de defeito
 * que passa por revisão e por teste escrito de manhã.
 *
 * O fuso deveria vir dos parâmetros do tenant (uma operação em Manaus fecha
 * ciclo em outro deslocamento). Enquanto o módulo de parametrização não existe,
 * fica em variável de ambiente — explícito e num lugar só, em vez de espalhado
 * em cada mensagem.
 */
const FUSO = process.env['IARX_FUSO'] ?? 'America/Sao_Paulo'

const FORMATO_ISO_LOCAL = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Data civil (AAAA-MM-DD) no fuso da operação, não em UTC. */
export function dataLocal(d: Date): string {
  return FORMATO_ISO_LOCAL.format(d)
}
