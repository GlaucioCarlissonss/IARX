/**
 * A marca da IARX, desenhada.
 *
 * SVG e não arquivo de fonte: o entregável é um HTML único, abrível sem
 * servidor, e uma família tipográfica embutida custaria entre 60 e 200 kB em
 * base64 — contra a meta de reduzir o pacote. Quatro retas custam algumas
 * centenas de bytes e dizem a mesma coisa.
 *
 * **O que se reproduz do logotipo é o gesto, não a letra.** Aos 30px do rail
 * nenhuma letra se lê; o que se reconhece é a inclinação e a sequência de cor —
 * ouro, aço, azul-marinho, rubro. É o logotipo visto de longe, que é
 * exatamente como um ícone de aplicação é visto.
 *
 * É `role="img"` com rótulo, e não texto colorido, por duas razões que se
 * somam: semanticamente é um logotipo, e uma delas — o ouro — é clara de
 * propósito. Como texto, o verificador de contraste a reprovaria; como imagem,
 * ela é o que é, com a isenção de logotipo declarada no validador de paleta.
 */
export function MarcaIarx({ titulo = 'IARX' }: { titulo?: string }) {
  return (
    <svg
      className="marca__simbolo"
      viewBox="0 0 34 32"
      role="img"
      aria-label={titulo}
      focusable="false"
    >
      {/*
        A inclinação é a do logotipo. Vem por `skewX` num grupo, e não em cada
        reta, para as quatro manterem exatamente o mesmo ângulo — barras com
        inclinações levemente diferentes leem como erro de desenho antes de
        lerem como marca.
      */}
      <g transform="skewX(-13) translate(6 0)">
        <rect x="0" y="5" width="4" height="22" fill="var(--cor-marca-ouro)" />
        <rect x="6" y="5" width="6" height="22" fill="var(--cor-marca-aco)" />
        <rect x="14" y="5" width="6" height="22" fill="var(--cor-marca-navio)" />
        <rect x="22" y="5" width="5" height="22" fill="var(--cor-marca-rubro)" />
      </g>
    </svg>
  )
}
