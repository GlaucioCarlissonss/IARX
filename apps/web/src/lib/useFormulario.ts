import { useCallback, useRef, useState } from 'react'
import type { FalhaComando, Resultado } from '../dados/comandos'

/**
 * Estado e validação de formulário.
 *
 * Três coisas que este hook resolve e que, feitas à mão em cada tela, sempre
 * saem diferentes:
 *
 *  1. **Quando mostrar erro.** Validar a cada tecla acusa "campo obrigatório"
 *     antes de o usuário terminar de digitar a primeira letra. Aqui o erro de um
 *     campo só aparece depois que ele foi tocado — ou depois da primeira
 *     tentativa de envio, quando tudo é revelado de uma vez.
 *
 *  2. **Erro do servidor vira erro de campo.** A recusa do comando traz `campo`,
 *     e ele é mesclado aos erros locais. Sem isso, "CNPJ duplicado" apareceria
 *     como alerta solto no topo enquanto o input continuaria verde.
 *
 *  3. **Envio duplo.** `enviando` bloqueia o segundo clique. Sem trava, um
 *     duplo clique em "Abrir chamado" abre dois chamados — e o segundo é
 *     invisível até alguém reclamar.
 */

export type Erros<T> = Partial<Record<keyof T & string, string>>

export interface Formulario<T> {
  valores: T
  /** Erros a exibir no campo: aparecem quando ele é tocado ou após o envio. */
  erros: Erros<T>
  /**
   * Erros do resumo do topo. Vazio até a primeira tentativa de envio.
   *
   * Separado de `erros` por causa de um defeito concreto: o resumo aparecendo
   * no blur de um campo cresce o diálogo, que se recentraliza, e o botão de
   * enviar sai de debaixo do ponteiro entre o mousedown e o mouseup — o clique
   * se perde e o usuário precisa clicar duas vezes. Além disso, um resumo de
   * "5 erros" enquanto a pessoa ainda está preenchendo o segundo campo é
   * ruído, não ajuda.
   */
  errosResumo: Erros<T>
  /** Erro que não pertence a um campo — bloqueio de regra, falha de rede. */
  erroGeral: FalhaComando | null
  enviando: boolean
  definir: <K extends keyof T & string>(campo: K, valor: T[K]) => void
  tocar: (campo: keyof T & string) => void
  /** Props prontas para o primitivo de campo: valor, erro e onBlur. */
  campo: <K extends keyof T & string>(nome: K) => { erro?: string; onBlur: () => void }
  enviar: (e?: { preventDefault: () => void }) => Promise<void>
  redefinir: (novos?: Partial<T>) => void
  /** Elemento a receber foco quando houver erro após o envio. */
  refResumo: React.RefObject<HTMLDivElement>
}

interface Opcoes<T, R> {
  inicial: T
  /** Validação local. Devolve mensagem por campo; ausência de chave = válido. */
  validar?: (v: T) => Erros<T>
  aoEnviar: (v: T) => Promise<Resultado<R>>
  aoConcluir?: (valor: R) => void
}

export function useFormulario<T extends Record<string, unknown>, R>(opcoes: Opcoes<T, R>): Formulario<T> {
  const [valores, setValores] = useState<T>(opcoes.inicial)
  const [tocados, setTocados] = useState<Set<string>>(new Set())
  const [tentouEnviar, setTentouEnviar] = useState(false)
  const [errosServidor, setErrosServidor] = useState<Erros<T>>({})
  const [erroGeral, setErroGeral] = useState<FalhaComando | null>(null)
  const [enviando, setEnviando] = useState(false)
  const refResumo = useRef<HTMLDivElement>(null)

  const errosLocais = opcoes.validar ? opcoes.validar(valores) : {}
  const visiveis: Erros<T> = {}
  for (const [chave, msg] of Object.entries({ ...errosLocais, ...errosServidor })) {
    if (msg && (tentouEnviar || tocados.has(chave))) visiveis[chave as keyof T & string] = msg as string
  }

  const definir = useCallback(<K extends keyof T & string>(nome: K, valor: T[K]) => {
    setValores((v) => ({ ...v, [nome]: valor }))
    // O erro do servidor se refere ao valor que foi enviado. Assim que o campo
    // muda, ele deixa de ser verdade e precisa sair.
    setErrosServidor((e) => (nome in e ? { ...e, [nome]: undefined } : e))
  }, [])

  const tocar = useCallback((nome: keyof T & string) => {
    setTocados((t) => (t.has(nome) ? t : new Set(t).add(nome)))
  }, [])

  const campo = useCallback(
    <K extends keyof T & string>(nome: K) => ({
      erro: visiveis[nome],
      onBlur: () => tocar(nome),
    }),
    // `visiveis` é recalculado a cada render de propósito: ele depende dos
    // valores atuais, e memorizar exigiria invalidar a cada tecla mesmo assim.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visiveis, tocar],
  )

  const enviar = useCallback(
    async (e?: { preventDefault: () => void }) => {
      e?.preventDefault()
      if (enviando) return

      setTentouEnviar(true)
      setErroGeral(null)

      const locais = opcoes.validar ? opcoes.validar(valores) : {}
      if (Object.values(locais).some(Boolean)) {
        // Foco no resumo, não no primeiro campo: o usuário precisa saber
        // quantos erros existem antes de ser levado ao primeiro deles.
        requestAnimationFrame(() => refResumo.current?.focus())
        return
      }

      setEnviando(true)
      try {
        const r = await opcoes.aoEnviar(valores)
        if (r.ok) {
          opcoes.aoConcluir?.(r.valor)
          return
        }
        if (r.erro.campo) {
          setErrosServidor({ [r.erro.campo]: r.erro.mensagem } as Erros<T>)
          setTocados((t) => new Set(t).add(r.erro.campo!))
        }
        setErroGeral(r.erro)
        requestAnimationFrame(() => refResumo.current?.focus())
      } catch (falha) {
        setErroGeral({
          codigo: 'FALHA_TEMPORARIA',
          mensagem: falha instanceof Error ? falha.message : 'Não foi possível concluir a operação.',
          acoes: ['Tentar novamente'],
        })
        requestAnimationFrame(() => refResumo.current?.focus())
      } finally {
        setEnviando(false)
      }
    },
    [enviando, opcoes, valores],
  )

  const redefinir = useCallback(
    (novos?: Partial<T>) => {
      setValores({ ...opcoes.inicial, ...novos })
      setTocados(new Set())
      setTentouEnviar(false)
      setErrosServidor({})
      setErroGeral(null)
    },
    [opcoes.inicial],
  )

  return {
    valores,
    erros: visiveis,
    errosResumo: tentouEnviar ? visiveis : {},
    erroGeral,
    enviando,
    definir,
    tocar,
    campo,
    enviar,
    redefinir,
    refResumo,
  }
}
