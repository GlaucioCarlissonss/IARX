import { useEffect, useRef, useState } from 'react'
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
  /*
   * O campo responde a cada tecla; a lista, ao fim da palavra.
   *
   * Medido antes de mudar: digitar "KYOCERA" no parque custava 193 ms e
   * produzia **sete** refiltragens, seis delas jogadas fora — ninguém lê o
   * resultado de "KYO". Com 180 ms de espera sai uma só, e o ganho cresce com
   * a base: a refiltragem percorre a coleção inteira a cada vez.
   *
   * O texto digitado é estado local justamente para o campo não ficar lento
   * junto: se o valor exibido dependesse do estado do pai, a letra só
   * apareceria depois da espera, e a pessoa veria a própria digitação
   * atrasada. É o inverso do que se quer.
   *
   * Cento e oitenta milissegundos é a faixa que não se percebe entre teclas
   * de uma mesma palavra e já fecha a pausa de quem terminou de digitar.
   */
  const [digitado, setDigitado] = useState(valor)
  const relogio = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /*
   * Valor que vem de fora — "limpar filtros", um parâmetro na URL — manda, e
   * cancela a espera pendente. Sem o cancelamento, o filtro recém-limpo
   * voltaria sozinho um instante depois.
   */
  useEffect(() => {
    clearTimeout(relogio.current)
    setDigitado(valor)
  }, [valor])

  useEffect(() => () => clearTimeout(relogio.current), [])

  function digitar(v: string) {
    setDigitado(v)
    clearTimeout(relogio.current)
    relogio.current = setTimeout(() => aoMudar(v), 180)
  }

  return (
    <Entrada
      rotulo={rotulo}
      rotuloOculto={rotuloOculto}
      type="search"
      value={digitado}
      onChange={(e) => digitar(e.target.value)}
      placeholder={exemplo}
    />
  )
}

/**
 * A faixa de filtros de uma lista.
 *
 * Concentra o espaçamento, a quebra em telas estreitas e a saída: **quantos
 * filtros estão valendo, e como desfazê-los de uma vez**.
 *
 * Sem essa saída, quem estreita a lista por três critérios e não acha nada
 * precisa desfazer um por um, lembrando de cada um — e o que costuma acontecer
 * é recarregar a página. A contagem fica à vista pelo mesmo motivo: uma lista
 * curta por causa de um filtro esquecido parece uma base vazia, e a conclusão
 * errada não tem como se corrigir sozinha.
 *
 * `ativos` e `aoLimpar` são opcionais: faixa com um controle só não precisa de
 * botão para zerar um controle só.
 */
export function Filtros({
  children,
  ativos = 0,
  aoLimpar,
}: {
  children: ReactNode
  /** Quantos filtros estão fora do padrão agora. */
  ativos?: number
  aoLimpar?: () => void
}) {
  return (
    <div className="filtros">
      {children}
      {aoLimpar && ativos > 0 && (
        <button type="button" className="filtros__limpar" onClick={aoLimpar}>
          Limpar {ativos} {ativos === 1 ? 'filtro' : 'filtros'}
          <span className="so-leitor"> e mostrar a lista inteira</span>
        </button>
      )}
    </div>
  )
}
