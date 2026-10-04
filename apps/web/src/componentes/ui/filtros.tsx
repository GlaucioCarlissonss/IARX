import type { ReactNode } from 'react'
import { Entrada } from './primitivos'

/**
 * Os dois componentes que toda tela de lista repetia.
 *
 * `Busca` e `Filtros` existiam dez e dezesseis vezes, escritos à mão, iguais
 * exceto pelo rótulo. A consolidação não é de estética: é onde o comportamento
 * passa a caber **uma vez**.
 *
 * O caso concreto que a motiva é a Entrega 6. Um `debounce` na busca, hoje,
 * seria dez alterações — e a décima primeira tela, escrita depois, nasceria sem
 * ele. Com um componente, é uma.
 */

/**
 * Campo de busca de lista.
 *
 * `type="search"` não é cosmético: dá ao navegador o botão de limpar, informa
 * ao leitor de tela que o campo filtra em vez de cadastrar, e é o que o
 * teclado de celular usa para oferecer a tecla "buscar" no lugar de "enter".
 *
 * O rótulo é sempre visível, e de propósito: `placeholder` como rótulo
 * desaparece ao digitar — a pessoa perde a referência do que estava filtrando
 * exatamente quando passa a ter o que ler na tela.
 */
export function Busca({
  rotulo,
  valor,
  aoMudar,
  exemplo,
  rotuloOculto,
}: {
  /** O que a busca alcança, dito por extenso. Vira o rótulo do campo. */
  rotulo: string
  valor: string
  aoMudar: (v: string) => void
  /** Exemplo de termo — entra como `placeholder`, nunca como rótulo. */
  exemplo?: string
  /**
   * Esconde o rótulo **visualmente**, nunca do leitor de tela.
   *
   * Só onde o espaço é do conteúdo e não do formulário — a sobreposição do
   * mapa é o caso. Em faixa de filtros o rótulo fica visível.
   */
  rotuloOculto?: boolean
}) {
  return (
    <Entrada
      rotulo={rotulo}
      rotuloOculto={rotuloOculto}
      type="search"
      value={valor}
      onChange={(e) => aoMudar(e.target.value)}
      placeholder={exemplo}
    />
  )
}

/**
 * A faixa de filtros de uma lista.
 *
 * Só o invólucro, e é o bastante: concentra num lugar o espaçamento, a quebra
 * em telas estreitas e — quando a Entrega 5 chegar — o "n filtros ativos ·
 * limpar", que hoje nenhuma tela oferece.
 */
export function Filtros({ children }: { children: ReactNode }) {
  return <div className="filtros">{children}</div>
}
