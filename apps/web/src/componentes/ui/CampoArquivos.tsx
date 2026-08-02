import { useId, useRef, useState } from 'react'
import { formatarBytes, LIMITE_ARQUIVO_BYTES } from '../../dados/comandos'
import { Botao } from './primitivos'

/**
 * Seleção de arquivos com arrastar-e-soltar.
 *
 * Aceita **qualquer tipo** — sem `accept`. Filtrar por extensão é falsa
 * proteção (renomear contorna) e o custo real é o operador que não consegue
 * anexar o `.p7s` da assinatura digital ou o `.dwg` da planta do andar.
 *
 * Arrastar-e-soltar **nunca é o único caminho**: o `<input type="file">` é um
 * controle real, focável e acionável por teclado, e a área de soltar é um
 * acréscimo para quem usa mouse. Um dropzone que só aceita arrastar exclui
 * teclado, leitor de tela e boa parte do uso em telas de toque.
 *
 * A área é `aria-hidden` de propósito: para quem usa leitor de tela ela não
 * acrescenta nada além de ruído — o input já está anunciado logo acima, com
 * rótulo, dica e limite.
 */

interface Props {
  rotulo: string
  dica?: string
  erro?: string
  nome?: string
  arquivos: File[]
  aoMudar: (arquivos: File[]) => void
  /** Nomes já anexados na entidade, para acusar duplicidade antes do envio. */
  jaExistentes?: string[]
  disabled?: boolean
}

export function CampoArquivos({
  rotulo,
  dica,
  erro,
  nome,
  arquivos,
  aoMudar,
  jaExistentes = [],
  disabled,
}: Props) {
  const gerado = useId()
  const id = nome ? `campo-${nome}` : gerado
  const idDica = `${id}-dica`
  const idErro = `${id}-erro`
  const entradaRef = useRef<HTMLInputElement>(null)
  const [sobre, setSobre] = useState(false)

  const existentes = new Set(jaExistentes.map((n) => n.toLowerCase()))

  function acrescentar(novos: FileList | null) {
    if (!novos || novos.length === 0) return
    const atuais = new Set(arquivos.map((a) => a.name.toLowerCase()))
    // Selecionar o mesmo arquivo duas vezes na mesma sessão é acidente comum
    // (dois cliques no seletor); duplicar em silêncio confunde.
    const acrescidos = Array.from(novos).filter((f) => !atuais.has(f.name.toLowerCase()))
    if (acrescidos.length > 0) aoMudar([...arquivos, ...acrescidos])
    // Zera o input para permitir reescolher o mesmo arquivo após remover.
    if (entradaRef.current) entradaRef.current.value = ''
  }

  const total = arquivos.reduce((s, a) => s + a.size, 0)

  return (
    <div className="campo">
      <label className="campo__rotulo" htmlFor={id}>
        {rotulo}
      </label>

      <input
        ref={entradaRef}
        id={id}
        type="file"
        multiple
        disabled={disabled}
        aria-describedby={[erro ? idErro : '', idDica].filter(Boolean).join(' ') || undefined}
        aria-invalid={Boolean(erro) || undefined}
        onChange={(e) => acrescentar(e.target.files)}
        className="entrada-arquivo"
      />

      {erro && (
        <p className="campo__erro" id={idErro}>
          {erro}
        </p>
      )}

      <p className="campo__dica" id={idDica}>
        {dica ? `${dica} ` : ''}
        Qualquer tipo de arquivo, até {formatarBytes(LIMITE_ARQUIVO_BYTES)} cada.
      </p>

      {/* Complemento para mouse. Sem papel na árvore de acessibilidade: o
          input acima já é o controle, e anunciar uma "área" que não é focável
          só atrapalha quem navega por teclado. */}
      <div
        className="soltar"
        data-sobre={sobre || undefined}
        aria-hidden="true"
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setSobre(true)
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => {
          e.preventDefault()
          setSobre(false)
          if (!disabled) acrescentar(e.dataTransfer.files)
        }}
        onClick={() => entradaRef.current?.click()}
      >
        <span className="soltar__glifo">⇪</span>
        <span>Arraste arquivos aqui ou use o seletor acima</span>
      </div>

      {arquivos.length > 0 && (
        <>
          <ul className="lista-arquivos">
            {arquivos.map((a) => {
              const duplicado = existentes.has(a.name.toLowerCase())
              const grande = a.size > LIMITE_ARQUIVO_BYTES
              const vazio = a.size === 0
              const problema = duplicado
                ? 'já anexado nesta ficha'
                : grande
                  ? `excede ${formatarBytes(LIMITE_ARQUIVO_BYTES)}`
                  : vazio
                    ? 'arquivo vazio'
                    : null
              return (
                <li key={a.name} className="arquivo" data-problema={problema ? 'sim' : undefined}>
                  <span className="arquivo__glifo" aria-hidden="true">
                    {glifoDe(a.type, a.name)}
                  </span>
                  <span className="crescer pilha g1">
                    <span className="arquivo__nome">{a.name}</span>
                    <span className="arquivo__meta">
                      {formatarBytes(a.size)}
                      {a.type ? ` · ${a.type}` : ' · tipo não reconhecido'}
                      {problema && <span className="arquivo__problema"> · {problema}</span>}
                    </span>
                  </span>
                  <Botao
                    variante="sutil"
                    pequeno
                    disabled={disabled}
                    onClick={() => aoMudar(arquivos.filter((x) => x !== a))}
                  >
                    Remover<span className="so-leitor"> {a.name}</span>
                  </Botao>
                </li>
              )
            })}
          </ul>

          {/* Região viva: quem usa leitor de tela precisa saber que a seleção
              mudou — o arquivo entra numa lista abaixo, fora do foco. */}
          <p className="campo__dica" role="status" aria-live="polite">
            {arquivos.length === 1 ? '1 arquivo selecionado' : `${arquivos.length} arquivos selecionados`} ·{' '}
            {formatarBytes(total)}
          </p>
        </>
      )}
    </div>
  )
}

/** Glifo por família de tipo. Decorativo: o nome e o tipo estão em texto. */
function glifoDe(mime: string, nome: string): string {
  const ext = nome.split('.').pop()?.toLowerCase() ?? ''
  if (mime.startsWith('image/')) return '▣'
  if (mime === 'application/pdf' || ext === 'pdf') return '▤'
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return '▦'
  if (['doc', 'docx', 'odt', 'txt', 'rtf'].includes(ext)) return '▥'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '▧'
  if (['p7s', 'pem', 'cer', 'crt'].includes(ext)) return '⚿'
  return '▢'
}
