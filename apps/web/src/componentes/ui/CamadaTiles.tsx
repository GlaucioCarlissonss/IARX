import { useEffect, useMemo, useState } from 'react'
import { TILE_SONDA, montarUrl, nivelDeTile, tilesVisiveis } from '../../dados/tiles'

/**
 * Camada raster do mapa.
 *
 * Desenha os tiles do provedor por baixo de tudo o que `Mapa.tsx` já desenha.
 * Não sabe nada de marcadores, agrupamento ou acessibilidade — a camada é
 * decoração posicionada, e o conteúdo continua onde sempre esteve. É por isso
 * que ela pôde ser acrescentada sem tocar em nenhuma das garantias já testadas.
 *
 * Toda a aritmética vive em `dados/tiles.ts`, que não importa React e é testado
 * com `node --test`. Aqui fica só o que depende do DOM.
 */

/** Espera máxima da sondagem. Além disso, o usuário já concluiu que travou. */
const ESPERA_SONDA = 4000

export type EstadoTiles = 'sondando' | 'ok' | 'indisponivel'

/**
 * Descobre se há caminho até o servidor de tiles.
 *
 * Uma imagem de zoom baixo sobre o Brasil, com prazo. `onerror` dispara rápido
 * quando a CSP bloqueia ou o DNS falha; o prazo cobre o caso pior, que é o
 * proxy que aceita a conexão e nunca responde — foi exatamente o que aconteceu
 * ao sondar os provedores deste ambiente.
 *
 * O ponto de projeto: enquanto sonda, o mapa **já está desenhado** em vetor.
 * Não existe estado em que o usuário encara um retângulo cinza esperando.
 */
export function useTilesDisponiveis(modelo: string, chave: string): EstadoTiles {
  const [estado, setEstado] = useState<EstadoTiles>('sondando')

  useEffect(() => {
    if (!modelo) {
      setEstado('indisponivel')
      return
    }
    // Sem rede declarada, nem vale gastar a sondagem.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setEstado('indisponivel')
      return
    }

    setEstado('sondando')
    let vivo = true
    const img = new Image()

    const encerrar = (resultado: EstadoTiles) => {
      if (!vivo) return
      vivo = false
      clearTimeout(relogio)
      setEstado(resultado)
    }
    const relogio = setTimeout(() => encerrar('indisponivel'), ESPERA_SONDA)

    img.onload = () => encerrar('ok')
    img.onerror = () => encerrar('indisponivel')
    img.src = montarUrl(modelo, TILE_SONDA, chave)

    return () => {
      vivo = false
      clearTimeout(relogio)
    }
  }, [modelo, chave])

  return estado
}

interface Props {
  modelo: string
  chave: string
  /** Pixels por unidade de mundo — a largura que o planeta teria na tela. */
  escala: number
  centro: { cx: number; cy: number }
  dim: { largura: number; altura: number }
  zoomMax: number
  /** Cor sob os tiles, para o basemap escuro não piscar branco. */
  fundo: 'claro' | 'escuro'
}

export function CamadaTiles({ modelo, chave, escala, centro, dim, zoomMax, fundo }: Props) {
  const z = nivelDeTile(escala, zoomMax)

  const tiles = useMemo(
    () => tilesVisiveis(z, escala, centro, dim),
    [z, escala, centro, dim],
  )

  /*
   * Nível anterior mantido por baixo até o novo terminar de pintar.
   *
   * Trocar de nível de uma vez apaga a imagem e repinta — o mapa "pisca" a cada
   * passo de zoom, que é justamente o momento em que o usuário está seguindo um
   * ponto com os olhos. Manter o nível velho embaixo custa uma camada e resolve.
   *
   * O nível de fundo é recalculado para a **vista atual**, e não congelado: sem
   * isso ele descolaria da imagem de cima ao arrastar durante o carregamento.
   */
  const [nivelFundo, setNivelFundo] = useState<number | null>(null)
  const [zPintado, setZPintado] = useState(z)
  const [resolvidos, setResolvidos] = useState(0)

  if (zPintado !== z) {
    setNivelFundo(zPintado)
    setZPintado(z)
    setResolvidos(0)
  }

  useEffect(() => {
    // Conta carregamento **e** falha: um tile 404 — comum em alto zoom sobre o
    // oceano — nunca carregaria, e o fundo ficaria preso para sempre.
    if (nivelFundo !== null && tiles.length > 0 && resolvidos >= tiles.length) {
      setNivelFundo(null)
    }
  }, [resolvidos, tiles.length, nivelFundo])

  const tilesFundo = useMemo(
    () => (nivelFundo === null ? [] : tilesVisiveis(nivelFundo, escala, centro, dim)),
    [nivelFundo, escala, centro, dim],
  )

  const desenhar = (lista: typeof tiles, contar: boolean) =>
    lista.map((t) => (
      <img
        // A chave usa a coluna **não normalizada**: ao dar a volta no mundo, duas
        // cópias do mesmo tile aparecem lado a lado, e com a coluna da URL elas
        // colidiriam numa chave só.
        key={`${t.z}/${t.coluna}/${t.linha}`}
        src={montarUrl(modelo, t, chave)}
        alt=""
        // Sem isto, arrastar o mapa a partir de um tile inicia o arrasto nativo
        // de imagem do navegador e o gesto de deslocamento morre no meio.
        draggable={false}
        decoding="async"
        style={{ left: t.esquerda, top: t.topo, width: t.lado, height: t.lado }}
        onLoad={contar ? () => setResolvidos((n) => n + 1) : undefined}
        onError={contar ? () => setResolvidos((n) => n + 1) : undefined}
      />
    ))

  return (
    <div className="mapa__camada" data-fundo={fundo} aria-hidden="true">
      {nivelFundo !== null && <div className="mapa__camada__nivel">{desenhar(tilesFundo, false)}</div>}
      <div className="mapa__camada__nivel">{desenhar(tiles, true)}</div>
    </div>
  )
}
