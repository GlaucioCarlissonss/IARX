import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ENVELOPE, ESTADOS, UFS, desprojetar, projetar } from '../../dados/geo'
import { CamadaTiles, useTilesDisponiveis } from './CamadaTiles'
import { Dialogo } from './Dialogo'
import { Botao, Entrada, Selecao } from './primitivos'
import {
  PROVEDORES,
  gravarPreferencia,
  lerPreferencia,
  modeloDe,
  modeloValido,
  provedorPorId,
} from '../../dados/tiles'
import type { PreferenciaMapa } from '../../dados/tiles'
import type { ReactNode } from 'react'

/**
 * Mapa geográfico interativo.
 *
 * É um mapa de verdade — projeção Web Mercator, coordenadas reais, arrasto e
 * zoom contínuos, agrupamento por proximidade em tela — e não uma imagem com
 * pontos colados por cima nem um link que joga o usuário no Google Maps. Sair
 * da aplicação para ver onde está o parque quebra o fluxo justamente no momento
 * em que a pessoa está decidindo de onde despachar um técnico.
 *
 * Duas camadas, e a ordem entre elas é a decisão de projeto:
 *
 *  · **imagem raster** do provedor escolhido — satélite por padrão, ruas e OSM
 *    à disposição, servidor próprio configurável;
 *  · **vetor embutido** (`dados/geo.ts`), que sobe para contorno de estado
 *    quando há imagem e vira o mapa inteiro quando não há.
 *
 * O vetor não é o plano B envergonhado: é o piso. O build é um arquivo único e
 * o artefato publicado roda sob política que bloqueia host externo — ali os
 * tiles nunca chegam, e a alternativa a ter um piso seria exibir um retângulo
 * cinza, que é pior do que não ter mapa. Quando há rede, a imagem entra por
 * baixo sem recalcular a posição de um marcador sequer, porque a projeção dos
 * tiles sempre foi a mesma dos polígonos.
 *
 * Acessibilidade tratada como requisito, não como acréscimo:
 *
 *  · o mapa é `role="application"` com instruções, e responde a setas, `+`/`-`
 *    e `Home` — arrastar com o mouse não pode ser o único caminho;
 *  · cada marcador é um `<button>` real, alcançável por Tab, com nome que diz
 *    o que ele é e quantos itens agrupa;
 *  · a tabela alternativa é obrigatória e vive fora deste componente, junto de
 *    quem tem os dados — nenhuma informação existe só na forma visual.
 */

export interface PontoMapa {
  id: string
  nome: string
  detalhe: string
  lat: number
  lon: number
  /** Peso do ponto: quantidade de ativos, usada no tamanho e no mapa de calor. */
  peso: number
  /** Severidade para a cor do marcador. */
  tom: 'normal' | 'atencao' | 'critico'
}

/** Agrupamento resolvido para o zoom atual. */
interface Agrupamento {
  id: string
  x: number
  y: number
  pontos: PontoMapa[]
  peso: number
  tom: PontoMapa['tom']
}

interface Props {
  pontos: PontoMapa[]
  /** Ponto destacado — o selecionado na lista lateral, por exemplo. */
  selecionado?: string | null
  aoSelecionar?: (ponto: PontoMapa) => void
  /** Mapa de calor em vez de marcadores. */
  calor?: boolean
  altura?: number
  /** Controles sobrepostos ao mapa (busca, filtros, exportar). */
  sobreposicao?: ReactNode
  /** Rodapé sobreposto — contagens. */
  rodape?: ReactNode
  rotulo: string
}

/** Zoom 1 = Brasil inteiro na moldura. */
const ZOOM_MIN = 1
const ZOOM_MAX = 64
/**
 * Distância mínima entre marcadores, em pixels de tela.
 *
 * Não é só estética. Alvo de toque sobreposto reprova WCAG 2.5.8 — e foi
 * exatamente o que o teste de 320 px acusou: dois marcadores dimensionados
 * pelo peso encostavam um no outro, e nenhum dos dois tinha área própria.
 * O valor é maior que o maior diâmetro possível de marcador, de modo que a
 * separação seja consequência do agrupamento, não sorte.
 */
const RAIO_AGRUPAMENTO = 46
const RAIO_MARCADOR_MIN = 12
const RAIO_MARCADOR_MAX = 21

export function Mapa({
  pontos,
  selecionado,
  aoSelecionar,
  calor = false,
  altura = 460,
  sobreposicao,
  rodape,
  rotulo,
}: Props) {
  const caixaRef = useRef<HTMLDivElement>(null)
  const cromoRef = useRef<HTMLDivElement>(null)
  const [dim, setDim] = useState({ largura: 900, altura })
  /**
   * A vista inicial é o centro do envelope brasileiro, não o centro do mundo.
   *
   * `0.5, 0.5` é o cruzamento de Greenwich com a linha do Equador, no golfo da
   * Guiné — o Brasil ficaria inteiro fora da moldura, à esquerda, e a tela
   * abriria em branco.
   */
  const [vista, setVista] = useState(VISTA_INICIAL)
  const [foco, setFoco] = useState<string | null>(null)
  const arrasto = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)

  /* ---------------------------------------------------------------- camada */

  const [pref, setPref] = useState<PreferenciaMapa>(lerPreferencia)
  const [configurando, setConfigurando] = useState(false)
  const escuro = useTemaEscuro()

  const provedor = provedorPorId(pref.provedor)
  const modelo = modeloDe(provedor, escuro, pref.modeloProprio)
  const estadoTiles = useTilesDisponiveis(provedor.precisaRede ? modelo : '', pref.chavePropria)
  const comImagem = provedor.precisaRede && estadoTiles === 'ok' && modelo !== ''

  function trocarPreferencia(nova: PreferenciaMapa) {
    setPref(nova)
    gravarPreferencia(nova)
  }

  /* --------------------------------------------------------------- medidas */

  /**
   * Áreas cobertas por controle opaco — busca, zoom, rodapé.
   *
   * Marcador debaixo de um controle é marcador inoperável: o clique vai para o
   * botão de cima, e o alvo obscurecido reprova WCAG 2.5.8. Em vez de esconder
   * o problema com z-index, o componente **mede** o que os próprios controles
   * ocupam e não desenha marcador ali — quem quiser ver o que está embaixo
   * arrasta o mapa, que é o gesto natural.
   *
   * Medido, e não estimado: a barra de controles quebra em duas linhas em
   * telas estreitas, e qualquer constante que eu escrevesse aqui estaria certa
   * numa largura e errada em todas as outras.
   */
  const [reservas, setReservas] = useState<{ x0: number; y0: number; x1: number; y1: number }[]>([])

  useEffect(() => {
    const el = caixaRef.current
    if (!el) return

    const medir = () => {
      setDim({ largura: el.clientWidth, altura: el.clientHeight })
      const base = el.getBoundingClientRect()
      const areas: { x0: number; y0: number; x1: number; y1: number }[] = []
      for (const alvo of cromoRef.current?.querySelectorAll<HTMLElement>('[data-reserva]') ?? []) {
        const r = alvo.getBoundingClientRect()
        if (r.width === 0) continue
        areas.push({
          x0: r.left - base.left,
          y0: r.top - base.top,
          x1: r.right - base.left,
          y1: r.bottom - base.top,
        })
      }
      setReservas(areas)
    }

    medir()
    const obs = new ResizeObserver(medir)
    obs.observe(el)
    if (cromoRef.current) obs.observe(cromoRef.current)
    return () => obs.disconnect()
  }, [sobreposicao, rodape])

  /**
   * Escala base: o Brasil inteiro cabe na moldura com uma margem.
   *
   * `min` das duas razões, e não a média: usar a média cortaria o Norte em
   * moldura larga e o Nordeste em moldura alta, e o usuário nunca veria o
   * país inteiro ao abrir a tela.
   */
  const escalaBase = useMemo(() => {
    const margem = 0.92
    return Math.min(dim.largura / ENVELOPE.largura, dim.altura / ENVELOPE.altura) * margem
  }, [dim])

  const escala = escalaBase * vista.zoom

  /** Coordenada geográfica → pixel na moldura. */
  const paraTela = useCallback(
    (lon: number, lat: number) => {
      const p = projetar(lon, lat)
      return {
        x: (p.x - centroX(vista)) * escala + dim.largura / 2,
        y: (p.y - centroY(vista)) * escala + dim.altura / 2,
      }
    },
    [vista, escala, dim],
  )

  /* ------------------------------------------------------------ navegação */

  const aplicarZoom = useCallback(
    (fator: number, ancoraX?: number, ancoraY?: number) => {
      setVista((v) => {
        const novo = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * fator))
        if (novo === v.zoom) return v
        if (ancoraX === undefined || ancoraY === undefined) return { ...v, zoom: novo }

        // Zoom ancorado no cursor: o ponto sob o ponteiro fica onde está. Sem
        // isto, aproximar de um agrupamento o empurra para fora da moldura e o
        // usuário precisa recentralizar a cada passo.
        const e0 = escalaBase * v.zoom
        const e1 = escalaBase * novo
        const gx = centroX(v) + (ancoraX - dim.largura / 2) / e0
        const gy = centroY(v) + (ancoraY - dim.altura / 2) / e0
        return {
          zoom: novo,
          cx: gx - (ancoraX - dim.largura / 2) / e1,
          cy: gy - (ancoraY - dim.altura / 2) / e1,
        }
      })
    },
    [escalaBase, dim],
  )

  useEffect(() => {
    const el = caixaRef.current
    if (!el) return
    // Ouvinte não passivo: `preventDefault` no wheel é o que impede a página
    // inteira de rolar enquanto se aproxima o mapa. React registra como
    // passivo, então precisa ser à mão.
    const roda = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      aplicarZoom(e.deltaY < 0 ? 1.22 : 1 / 1.22, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', roda, { passive: false })
    return () => el.removeEventListener('wheel', roda)
  }, [aplicarZoom])

  function iniciarArrasto(e: React.PointerEvent) {
    if (e.button !== 0) return
    const alvo = e.target as HTMLElement
    if (alvo.closest('button, a, input, select')) return
    arrasto.current = { x: e.clientX, y: e.clientY, cx: centroX(vista), cy: centroY(vista) }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function moverArrasto(e: React.PointerEvent) {
    const a = arrasto.current
    if (!a) return
    setVista((v) => ({
      ...v,
      cx: a.cx - (e.clientX - a.x) / (escalaBase * v.zoom),
      cy: a.cy - (e.clientY - a.y) / (escalaBase * v.zoom),
    }))
  }

  function encerrarArrasto(e: React.PointerEvent) {
    arrasto.current = null
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    }
  }

  function tecla(e: React.KeyboardEvent) {
    const passo = 60 / escala
    const acoes: Record<string, () => void> = {
      ArrowUp: () => setVista((v) => ({ ...v, cy: centroY(v) - passo })),
      ArrowDown: () => setVista((v) => ({ ...v, cy: centroY(v) + passo })),
      ArrowLeft: () => setVista((v) => ({ ...v, cx: centroX(v) - passo })),
      ArrowRight: () => setVista((v) => ({ ...v, cx: centroX(v) + passo })),
      '+': () => aplicarZoom(1.35),
      '=': () => aplicarZoom(1.35),
      '-': () => aplicarZoom(1 / 1.35),
      _: () => aplicarZoom(1 / 1.35),
      Home: () => setVista(VISTA_INICIAL),
    }
    const acao = acoes[e.key]
    if (acao) {
      e.preventDefault()
      acao()
    }
  }

  /* --------------------------------------------------------- agrupamentos */

  /**
   * Agrupa por proximidade **em pixels**, não em quilômetros.
   *
   * É a diferença entre um agrupamento que se abre ao aproximar e um que fica
   * grudado para sempre: o critério tem de ser o que o olho vê. Dois clientes a
   * 3 km um do outro são um só ponto no Brasil inteiro e dois pontos distintos
   * no zoom da cidade — e é exatamente esse comportamento que se espera.
   */
  const grupos = useMemo<Agrupamento[]>(() => {
    const restantes = pontos.map((p) => ({ p, tela: paraTela(p.lon, p.lat) }))
    const saida: Agrupamento[] = []

    while (restantes.length > 0) {
      const semente = restantes.shift()!
      const membros = [semente]

      for (let i = restantes.length - 1; i >= 0; i--) {
        const outro = restantes[i]!
        const dx = outro.tela.x - semente.tela.x
        const dy = outro.tela.y - semente.tela.y
        if (dx * dx + dy * dy <= RAIO_AGRUPAMENTO * RAIO_AGRUPAMENTO) {
          membros.push(outro)
          restantes.splice(i, 1)
        }
      }

      saida.push(montarGrupo(membros))
    }

    /*
     * Segunda passada: o centro do grupo é a média dos membros, e a média pode
     * cair mais perto de outro grupo do que a semente estava. Sem esta fusão,
     * dois marcadores nascem encostados — e alvos sobrepostos reprovam WCAG
     * 2.5.8, além de serem impossíveis de acertar no toque.
     *
     * Converge porque cada fusão reduz o número de grupos; o teto de voltas é
     * rede de segurança contra um caso patológico, não expectativa.
     */
    for (let volta = 0; volta < 6; volta++) {
      let fundiu = false
      for (let i = 0; i < saida.length && !fundiu; i++) {
        for (let j = i + 1; j < saida.length; j++) {
          const dx = saida[j]!.x - saida[i]!.x
          const dy = saida[j]!.y - saida[i]!.y
          if (dx * dx + dy * dy < RAIO_AGRUPAMENTO * RAIO_AGRUPAMENTO) {
            const membros = [
              ...saida[i]!.pontos.map((p) => ({ p, tela: paraTela(p.lon, p.lat) })),
              ...saida[j]!.pontos.map((p) => ({ p, tela: paraTela(p.lon, p.lat) })),
            ]
            saida.splice(j, 1)
            saida.splice(i, 1, montarGrupo(membros))
            fundiu = true
            break
          }
        }
      }
      if (!fundiu) break
    }

    return saida.sort((a, b) => a.y - b.y)
  }, [pontos, paraTela])

  const maiorPeso = Math.max(1, ...grupos.map((g) => g.peso))

  /* -------------------------------------------------------------- desenho */

  const caminhos = useMemo(
    () =>
      UFS.map((uf) => ({
        uf,
        nome: ESTADOS[uf]!.nome,
        d: ESTADOS[uf]!.aneis
          .map(
            (anel) =>
              'M' +
              anel
                .map(([lon, lat]) => {
                  const t = paraTela(lon, lat)
                  return `${t.x.toFixed(1)} ${t.y.toFixed(1)}`
                })
                .join('L') +
              'Z',
          )
          .join(' '),
      })),
    [paraTela],
  )

  const grupoEmFoco = grupos.find((g) => g.id === foco)
  const escalaKm = escalaDeDistancia(escala, vista)

  return (
    <div className="mapa" ref={caixaRef} style={{ height: altura }} data-imagem={comImagem || undefined}>
      <div
        className="mapa__tela"
        role="application"
        aria-label={`${rotulo}. Use as setas para deslocar, mais e menos para aproximar, Home para enquadrar o Brasil.`}
        tabIndex={0}
        onKeyDown={tecla}
        onPointerDown={iniciarArrasto}
        onPointerMove={moverArrasto}
        onPointerUp={encerrarArrasto}
        onPointerCancel={encerrarArrasto}
      >
        {comImagem && (
          <CamadaTiles
            modelo={modelo}
            chave={pref.chavePropria}
            escala={escala}
            centro={{ cx: vista.cx, cy: vista.cy }}
            dim={dim}
            zoomMax={provedor.zoomMax}
            fundo={provedor.fundo}
          />
        )}

        <svg width={dim.largura} height={dim.altura} aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id="mapa-calor">
              <stop offset="0%" stopColor="var(--cor-critico-mark)" stopOpacity="0.55" />
              <stop offset="55%" stopColor="var(--cor-atencao-mark)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--cor-atencao-mark)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {!comImagem && <rect width={dim.largura} height={dim.altura} className="mapa__agua" />}

          {/* Paralelos e meridianos a cada 5°: dão noção de escala e de
              deformação da projeção sem competir com os dados. Sobre imagem
              seriam ruído — a foto já dá a referência. */}
          {!comImagem && <g className="mapa__grade">{gradeGeografica(paraTela, dim)}</g>}

          {/* Os contornos ficam nas duas camadas, mudando de papel: preenchidos
              são o mapa; sobre a imagem viram divisa de estado em traço fino,
              que o satélite não mostra e a operação usa o tempo todo. */}
          {caminhos.map((c) => (
            <path key={c.uf} d={c.d} className="mapa__uf" data-sobre-imagem={comImagem || undefined} />
          ))}

          {calor &&
            grupos.map((g) => (
              <circle
                key={`calor-${g.id}`}
                cx={g.x}
                cy={g.y}
                r={22 + (g.peso / maiorPeso) * 62}
                fill="url(#mapa-calor)"
              />
            ))}
        </svg>

        {/* Marcadores fora do SVG: botão de HTML tem foco, rótulo e alvo de
            toque previsíveis em todo navegador — dentro do SVG, nada disso é. */}
        {!calor && (
          <ul className="mapa__marcadores">
            {grupos.map((g) => {
              const visivel =
                g.x > -60 && g.y > -60 && g.x < dim.largura + 60 && g.y < dim.altura + 60
              if (!visivel) return null

              const unico = g.pontos.length === 1 ? g.pontos[0]! : null
              const raio =
                RAIO_MARCADOR_MIN +
                Math.round((g.peso / maiorPeso) * (RAIO_MARCADOR_MAX - RAIO_MARCADOR_MIN))

              // Sob um controle opaco o marcador não é alcançável nem por
              // clique nem por toque; desenhá-lo só criaria um alvo falso.
              //
              // A área reservada é inflada pelo raio: testar só o centro deixa
              // passar o marcador cujo centro está de fora mas cujo corpo
              // invade o controle — que foi exatamente o caso que o teste de
              // 320 px encontrou.
              const obstruido = reservas.some(
                (r) =>
                  g.x >= r.x0 - raio && g.x <= r.x1 + raio && g.y >= r.y0 - raio && g.y <= r.y1 + raio,
              )
              if (obstruido) return null

              const destacado = unico ? unico.id === selecionado : g.pontos.some((p) => p.id === selecionado)

              return (
                <li key={g.id} style={{ left: g.x, top: g.y }}>
                  <button
                    type="button"
                    className="mapa__marcador"
                    data-tom={g.tom}
                    data-grupo={g.pontos.length > 1 || undefined}
                    data-destacado={destacado || undefined}
                    style={{ width: raio * 2, height: raio * 2 }}
                    // `detalhe` já traz a contagem de ativos; repeti-la fazia o
                    // leitor de tela anunciar "7 ativo(s), 7 ativo(s)".
                    aria-label={
                      unico
                        ? `${unico.nome}, ${unico.detalhe}`
                        : `Agrupamento de ${g.pontos.length} locais, ${g.peso} ativo(s). Ativar para aproximar.`
                    }
                    onFocus={() => setFoco(g.id)}
                    onBlur={() => setFoco((f) => (f === g.id ? null : f))}
                    onMouseEnter={() => setFoco(g.id)}
                    onMouseLeave={() => setFoco((f) => (f === g.id ? null : f))}
                    onClick={() => {
                      if (unico) {
                        aoSelecionar?.(unico)
                        return
                      }
                      // Agrupamento aproxima em vez de abrir lista: é o gesto
                      // que o usuário já espera de qualquer mapa, e resolve o
                      // agrupamento em vez de só descrevê-lo.
                      aplicarZoom(2.4, g.x, g.y)
                    }}
                  >
                    <span aria-hidden="true">{g.pontos.length > 1 ? g.pontos.length : g.peso}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {/* Balão de detalhe. `aria-hidden` porque o mesmo texto já está no
            rótulo do botão que o abriu — anunciá-lo duas vezes é ruído. */}
        {grupoEmFoco && grupoEmFoco.pontos.length === 1 && (
          <div
            className="mapa__balao"
            aria-hidden="true"
            style={{ left: grupoEmFoco.x, top: grupoEmFoco.y - 16 }}
          >
            <strong>{grupoEmFoco.pontos[0]!.nome}</strong>
            <span>{grupoEmFoco.pontos[0]!.detalhe}</span>
          </div>
        )}

        <div ref={cromoRef}>
        <div className="mapa__sobreposicao" data-reserva>
          {sobreposicao}
        </div>

        {/* Seletor de camada e zoom numa coluna só.
            Enquanto foram dois blocos posicionados de forma independente, o
            seletor cobria parcialmente o botão de enquadrar num mapa de 300 px
            de altura — alvo obscurecido reprova WCAG 2.5.8, e foi o que o axe
            acusou no cartão da tela inicial. Empilhados no mesmo fluxo, não há
            sobreposição possível em nenhuma altura. */}
        <div className="mapa__controles" data-reserva>
          <div className="mapa__camadas">
            <Selecao
              rotulo="Camada do mapa"
              rotuloOculto
              value={pref.provedor}
              onChange={(e) => trocarPreferencia({ ...pref, provedor: e.target.value as PreferenciaMapa['provedor'] })}
              opcoes={PROVEDORES.map((p) => ({ valor: p.id, texto: p.nome }))}
            />
            {pref.provedor === 'proprio' && (
              <Botao pequeno variante="sutil" onClick={() => setConfigurando(true)}>
                Configurar
              </Botao>
            )}
          </div>

          <div className="mapa__zoom">
            <button type="button" onClick={() => aplicarZoom(1.5)} aria-label="Aproximar o mapa">
              <span aria-hidden="true">+</span>
            </button>
            <button type="button" onClick={() => aplicarZoom(1 / 1.5)} aria-label="Afastar o mapa">
              <span aria-hidden="true">−</span>
            </button>
            <button
              type="button"
              onClick={() => setVista(VISTA_INICIAL)}
              aria-label="Enquadrar o Brasil inteiro"
            >
              <span aria-hidden="true">⤢</span>
            </button>
          </div>
        </div>

        <div className="mapa__rodape">
          <span data-reserva>{rodape}</span>

          {/* Aviso de queda.
              `role="status"` porque a troca acontece sozinha, segundos depois de
              a tela abrir: sem anúncio, quem não vê a imagem não tem como saber
              que está olhando outra coisa. */}
          {provedor.precisaRede && estadoTiles === 'indisponivel' && (
            <span className="mapa__aviso" data-reserva role="status">
              <span aria-hidden="true">◍</span>{' '}
              {modelo === ''
                ? 'Servidor de tiles não configurado — exibindo o mapa vetorial embutido.'
                : 'Sem acesso ao servidor de imagens — exibindo o mapa vetorial embutido.'}
            </span>
          )}

          {/* Crédito exigido por licença (ODbL, no caso do OSM), não enfeite.
              Fundo sólido para o texto nunca cair direto sobre a fotografia. */}
          <span className="mapa__credito" data-reserva>
            {provedor.atribuicaoHref && comImagem ? (
              <a href={provedor.atribuicaoHref} target="_blank" rel="noreferrer noopener">
                {provedor.atribuicao}
              </a>
            ) : (
              comImagem && provedor.atribuicao
            )}
          </span>

          <span className="mapa__escala" data-reserva aria-hidden="true">
            <span className="mapa__escala__barra" style={{ width: escalaKm.pixels }} />
            {escalaKm.rotulo}
          </span>
        </div>
        </div>
      </div>

      {configurando && (
        <ConfigurarProvedor
          pref={pref}
          aoFechar={() => setConfigurando(false)}
          aoGravar={(nova) => {
            trocarPreferencia(nova)
            setConfigurando(false)
          }}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Configuração do servidor de tiles próprio.
 *
 * Existe porque a política de uso do OpenStreetMap desaconselha uso comercial
 * pesado dos servidores públicos, e a plataforma vai crescer para isso. Trocar
 * por MapTiler, Mapbox, Google ou um servidor da casa passa a ser configuração,
 * não alteração de código.
 */
function ConfigurarProvedor({
  pref,
  aoFechar,
  aoGravar,
}: {
  pref: PreferenciaMapa
  aoFechar: () => void
  aoGravar: (p: PreferenciaMapa) => void
}) {
  const [modelo, setModelo] = useState(pref.modeloProprio)
  const [chave, setChave] = useState(pref.chavePropria)

  const tocado = modelo.trim() !== ''
  const invalido = tocado && !modeloValido(modelo)

  return (
    <Dialogo
      titulo="Servidor de tiles próprio"
      descricao="Endereço no padrão XYZ. A aplicação substitui {z}, {x} e {y} a cada tile, e {chave} pela credencial."
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="primario"
            disabled={!modeloValido(modelo)}
            motivoDesabilitado="Informe um endereço https com {z}, {x} e {y}"
            onClick={() => aoGravar({ ...pref, modeloProprio: modelo.trim(), chavePropria: chave.trim() })}
          >
            Usar este servidor
          </Botao>
        </>
      }
    >
      <div className="pilha g3">
        <Entrada
          rotulo="Endereço do tile"
          value={modelo}
          onChange={(e) => setModelo(e.target.value)}
          placeholder="https://tiles.exemplo.com.br/{z}/{x}/{y}.png"
          erro={invalido ? 'Precisa começar com https e conter {z}, {x} e {y}.' : undefined}
          dica="https é obrigatório: servida por HTTPS, a aplicação teria a imagem bloqueada por conteúdo misto — e o sintoma seria um mapa cinza, sem erro visível."
        />
        <Entrada
          rotulo="Credencial (opcional)"
          value={chave}
          onChange={(e) => setChave(e.target.value)}
          placeholder="chave de API do provedor"
          dica="Fica guardada neste navegador e viaja em cada requisição de tile. Credencial usada em navegador é pública por natureza — restrinja-a por domínio no painel do provedor."
        />
      </div>
    </Dialogo>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Tema em vigor, para escolher a variante do basemap.
 *
 * A aplicação não tem seletor de tema: ela segue `prefers-color-scheme` só por
 * CSS. Aqui, porém, a escolha precisa chegar ao JavaScript — a variante clara e
 * a escura do provedor de ruas são **URLs diferentes**, não cores diferentes.
 */
function useTemaEscuro(): boolean {
  const consultar = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false

  const [escuro, setEscuro] = useState(consultar)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const consulta = window.matchMedia('(prefers-color-scheme: dark)')
    const ouvir = (e: MediaQueryListEvent) => setEscuro(e.matches)
    consulta.addEventListener('change', ouvir)
    return () => consulta.removeEventListener('change', ouvir)
  }, [])

  return escuro
}

/** Centro na média dos membros: com a semente, o marcador salta ao entrar um vizinho. */
function montarGrupo(membros: { p: PontoMapa; tela: { x: number; y: number } }[]): Agrupamento {
  const lista = membros.map((m) => m.p)
  return {
    id: lista.map((p) => p.id).join('|'),
    x: membros.reduce((s, m) => s + m.tela.x, 0) / membros.length,
    y: membros.reduce((s, m) => s + m.tela.y, 0) / membros.length,
    pontos: lista,
    peso: lista.reduce((s, p) => s + p.peso, 0),
    // O tom do grupo é o do pior membro: um cliente bloqueado escondido dentro
    // de um agrupamento verde é exatamente o que não pode acontecer.
    tom: lista.some((p) => p.tom === 'critico')
      ? 'critico'
      : lista.some((p) => p.tom === 'atencao')
        ? 'atencao'
        : 'normal',
  }
}

const VISTA_INICIAL = {
  zoom: 1,
  cx: ENVELOPE.x0 + ENVELOPE.largura / 2,
  cy: ENVELOPE.y0 + ENVELOPE.altura / 2,
}

const centroX = (v: { cx: number }) => v.cx
const centroY = (v: { cy: number }) => v.cy

/**
 * Barra de escala.
 *
 * Um mapa sem escala não permite julgar distância, e distância é a variável que
 * decide roteiro de técnico. O valor é escolhido na sequência 1-2-5 para a
 * barra cair sempre num número redondo.
 */
function escalaDeDistancia(escala: number, vista: { cy: number }): { pixels: number; rotulo: string } {
  const { lat } = desprojetar(0.5, vista.cy)
  // Circunferência da Terra na latitude do centro, dividida pela largura do
  // mundo projetado: quantos km cabem num pixel aqui.
  const kmPorPixel = (40075 * Math.cos((lat * Math.PI) / 180)) / escala
  const alvoKm = kmPorPixel * 110

  const magnitude = 10 ** Math.floor(Math.log10(Math.max(alvoKm, 0.001)))
  const passo = [1, 2, 5, 10].find((m) => magnitude * m >= alvoKm) ?? 10
  const km = magnitude * passo

  return {
    pixels: Math.round(km / kmPorPixel),
    rotulo: km >= 1 ? `${km.toLocaleString('pt-BR')} km` : `${Math.round(km * 1000)} m`,
  }
}

/** Paralelos e meridianos a cada 5°, recortados na moldura. */
function gradeGeografica(
  paraTela: (lon: number, lat: number) => { x: number; y: number },
  dim: { largura: number; altura: number },
) {
  const linhas: JSX.Element[] = []
  for (let lon = -75; lon <= -30; lon += 5) {
    const a = paraTela(lon, 6)
    const b = paraTela(lon, -34)
    if (a.x < -20 || a.x > dim.largura + 20) continue
    linhas.push(<line key={`m${lon}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />)
  }
  for (let lat = -35; lat <= 5; lat += 5) {
    const a = paraTela(-75, lat)
    const b = paraTela(-30, lat)
    if (a.y < -20 || a.y > dim.altura + 20) continue
    linhas.push(<line key={`p${lat}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />)
  }
  return linhas
}
