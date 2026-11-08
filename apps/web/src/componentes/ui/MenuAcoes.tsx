import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/**
 * Menu de ações da linha — o `⋯` (Anexo Y §Y.3.3).
 *
 * Existia três botões por linha em listas de centenas de registros: as colunas
 * de dado eram empurradas para a direita e a página inteira parecia um
 * formulário. O padrão de mercado — *index table* do Shopify Polaris, do
 * Atlassian, do Linear — é uma ação primária visível e o resto num menu.
 *
 * ## Por que não um `<select>` nem um `<details>`
 *
 * `<select>` é escolha de valor, não disparo de ação: o leitor de tela anuncia
 * "caixa de combinação" e quem navega por teclado espera que mudar o valor não
 * faça nada ainda. `<details>` não tem semântica de menu e deixa o conteúdo na
 * ordem de Tab mesmo fechado em navegadores antigos.
 *
 * O padrão implementado é o do APG (*Actions Menu Button*):
 *
 *  1. o gatilho tem `aria-haspopup="menu"` e `aria-expanded`;
 *  2. o contêiner é `role="menu"` e cada item `role="menuitem"`;
 *  3. ↓ e ↑ circulam, Home/End vão às pontas;
 *  4. Esc fecha **e devolve o foco ao gatilho** — sem isso quem usa teclado é
 *     devolvido ao início do documento;
 *  5. escolher um item fecha antes de executar, porque a ação costuma abrir um
 *     diálogo e dois sobrepostos se disputam o foco.
 *
 * Clique fora fecha em `pointerdown`, e não em `click`: em `click` o menu só
 * fecharia depois que o alvo de baixo já tivesse recebido o evento.
 */

export interface AcaoMenu {
  rotulo: string
  glifo?: string
  aoEscolher: () => void
  /** Separador acima deste item — agrupa sem acrescentar nível. */
  separar?: boolean
  /** Destaca como destrutivo. Não confirma por si: quem confirma é a ação. */
  perigo?: boolean
  desabilitado?: boolean
  motivoDesabilitado?: string
}

interface MenuAcoesProps {
  /** Completa o nome acessível do gatilho: "Mais ações do patrimônio 10001". */
  rotuloAlvo: string
  acoes: AcaoMenu[]
  /** Cabeçalho do menu aberto. Omitido, usa `rotuloAlvo`. */
  titulo?: string
  /**
   * Contagem exibida no gatilho — a de anexos é o caso.
   *
   * Existe porque esconder a contagem dentro do menu perderia informação que
   * antes se lia de relance: quais contratos têm documento e quais não têm.
   * Recolher a **ação** para o menu é o objetivo da fase; recolher o **dado**
   * seria outra coisa, e pior que o ponto de partida.
   */
  distintivo?: { valor: number; descricao: string }
}

export function MenuAcoes({ rotuloAlvo, acoes, titulo, distintivo }: MenuAcoesProps) {
  const [aberto, setAberto] = useState(false)
  const gatilhoRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const idMenu = useId()
  const idTitulo = useId()

  const uteis = acoes.filter((a) => !a.desabilitado || a.motivoDesabilitado)

  /*
   * O menu é desenhado fora da tabela, em `document.body`.
   *
   * A tabela vive dentro de `.tabela-caixa`, que tem `overflow-x: auto` — e em
   * CSS, um eixo `auto` com o outro `visible` torna os dois `auto`. Um menu
   * posicionado dentro dela era **recortado em cima e embaixo**, e abrir o
   * menu fazia o contêiner rolar para trazer o item focado à vista, o que
   * disparava um `scroll` que fechava o próprio menu que acabara de abrir.
   *
   * Fora do recorte, a posição vira `fixed` e é medida a partir do gatilho —
   * e remedida a cada rolagem, para o menu acompanhá-lo em vez de descolar.
   */
  const [posicao, setPosicao] = useState<{ topo: number; direita: number; acima: boolean } | null>(null)

  useEffect(() => {
    if (!aberto) {
      setPosicao(null)
      return
    }

    const medir = () => {
      const r = gatilhoRef.current?.getBoundingClientRect()
      if (!r) return
      /*
       * Rolou para fora da vista: aí sim fecha.
       *
       * A primeira versão fechava em **qualquer** `scroll`, e isso era um
       * defeito sutil: clicar no gatilho dá foco a ele, o navegador rola a
       * tabela para trazê-lo à vista, e o menu fechava no mesmo gesto que o
       * abriu — numa tela larga funcionava, numa com a tabela rolada não.
       * Acompanhar o gatilho é mais simples e mais certo que adivinhar quando
       * o `scroll` é "de verdade".
       */
      if (r.bottom < 0 || r.top > window.innerHeight) {
        setAberto(false)
        return
      }
      // Abre para cima quando não há espaço embaixo: as últimas linhas de uma
      // lista longa são justamente onde o menu mais é usado.
      const alturaEstimada = 56 + uteis.length * 48
      const acima = r.bottom + alturaEstimada > window.innerHeight && r.top > alturaEstimada
      setPosicao({
        topo: acima ? r.top - 4 : r.bottom + 4,
        // Alinhado pela direita do gatilho, preso à margem da janela: numa
        // coluna estreita o alinhamento puro sairia da tela.
        direita: Math.max(8, window.innerWidth - r.right),
        acima,
      })
    }
    medir()

    const foraDaqui = (e: PointerEvent) => {
      const alvo = e.target as Node
      if (menuRef.current?.contains(alvo)) return
      if (gatilhoRef.current?.contains(alvo)) return
      setAberto(false)
    }
    document.addEventListener('pointerdown', foraDaqui)

    window.addEventListener('scroll', medir, true)
    window.addEventListener('resize', medir)

    return () => {
      document.removeEventListener('pointerdown', foraDaqui)
      window.removeEventListener('scroll', medir, true)
      window.removeEventListener('resize', medir)
    }
    // `uteis.length` entra porque decide para que lado o menu abre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, uteis.length])

  /*
   * O foco espera a medição.
   *
   * O menu só é montado depois que `posicao` existe — e `posicao` nasce no
   * efeito acima, já depois do commit. Focar lá dentro encontrava `menuRef`
   * vazio e o foco ficava no gatilho: o teclado abria um menu em que ↓ não
   * andava. Separar os dois efeitos é o que faz o foco acontecer **depois**
   * de o menu existir.
   */
  useEffect(() => {
    if (!aberto || !posicao) return
    const primeiro = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
    primeiro?.focus({ preventScroll: true })
  }, [aberto, posicao])

  function fechar(devolverFoco = true) {
    setAberto(false)
    if (devolverFoco) gatilhoRef.current?.focus()
  }

  function navegar(e: React.KeyboardEvent<HTMLDivElement>) {
    const itens = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    )
    if (itens.length === 0) return
    const atual = itens.indexOf(document.activeElement as HTMLElement)

    if (e.key === 'Escape') {
      e.preventDefault()
      fechar()
      return
    }
    if (e.key === 'Tab') {
      // Tab sai do menu: fechar sem roubar o foco deixa o Tab seguir seu curso.
      fechar(false)
      return
    }
    const mapa: Record<string, number> = {
      ArrowDown: atual + 1,
      ArrowUp: atual - 1,
      Home: 0,
      End: itens.length - 1,
    }
    const destino = mapa[e.key]
    if (destino === undefined) return
    e.preventDefault()
    const i = (destino + itens.length) % itens.length
    itens[i]?.focus()
  }

  if (uteis.length === 0) return null

  return (
    <span className="menu-acoes">
      <button
        ref={gatilhoRef}
        type="button"
        className="btn btn--pequeno menu-acoes__gatilho"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idMenu : undefined}
        onClick={() => setAberto((a) => !a)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !aberto) {
            e.preventDefault()
            setAberto(true)
          }
        }}
      >
        <span aria-hidden="true">⋯</span>
        {distintivo && distintivo.valor > 0 && (
          <span className="distintivo" aria-hidden="true">
            {distintivo.valor}
          </span>
        )}
        <span className="so-leitor">
          Mais ações {rotuloAlvo}
          {distintivo && distintivo.valor > 0 ? ` — ${distintivo.valor} ${distintivo.descricao}` : ''}
        </span>
      </button>

      {aberto &&
        posicao &&
        createPortal(
          <div
            ref={menuRef}
            id={idMenu}
            role="menu"
            aria-labelledby={idTitulo}
            className="menu-acoes__lista"
            style={{
              top: posicao.acima ? undefined : posicao.topo,
              bottom: posicao.acima ? window.innerHeight - posicao.topo : undefined,
              right: posicao.direita,
            }}
            onKeyDown={navegar}
          >
            <p className="menu-acoes__titulo" id={idTitulo}>
              {titulo ?? rotuloAlvo}
            </p>
            {uteis.map((a, i) => (
              <span key={a.rotulo}>
                {a.separar && i > 0 && <hr className="menu-acoes__regua" />}
                <button
                  type="button"
                  role="menuitem"
                  className={a.perigo ? 'menu-acoes__item menu-acoes__item--perigo' : 'menu-acoes__item'}
                  disabled={a.desabilitado}
                  title={a.desabilitado ? a.motivoDesabilitado : undefined}
                  onClick={() => {
                    fechar(false)
                    a.aoEscolher()
                  }}
                >
                  {a.glifo && (
                    <span className="menu-acoes__glifo" aria-hidden="true">
                      {a.glifo}
                    </span>
                  )}
                  {a.rotulo}
                </button>
              </span>
            ))}
          </div>,
          document.body,
        )}
    </span>
  )
}

/**
 * A linha de ações: uma primária visível e o `⋯`.
 *
 * Componente e não convenção escrita, porque "uma só visível" é a regra que a
 * fase 2 existe para impor — e regra que mora em sete telas vira seis telas e
 * uma exceção.
 */
export function AcoesDaLinha({ primaria, children }: { primaria?: ReactNode; children?: ReactNode }) {
  return (
    <div className="acoes-linha">
      {primaria}
      {children}
    </div>
  )
}
