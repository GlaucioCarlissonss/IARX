import { useEffect, useRef, useState } from 'react'
import { carregarGoogle, clientIdGoogle, entrarComGoogle, type SessaoRemota } from '../../dados/google'
import { ErroApi } from '../../dados/http'
import { Aviso } from './primitivos'

/**
 * O botão "Entrar com Google".
 *
 * Desenhado pelo próprio Google, de propósito. Não é preguiça de estilo: as
 * diretrizes de marca do Google exigem forma, cor e texto específicos, e um
 * botão caseiro que *imita* o deles é pior que os dois — parece oficial sem
 * ser, que é exatamente o que uma pessoa aprende a desconfiar ao entrar numa
 * tela de senha.
 *
 * O que fica por nossa conta é o que o Google não faz: dizer o que deu errado
 * quando dá, e dizer de um jeito que ofereça saída.
 */
export function BotaoGoogle({ aoEntrar }: { aoEntrar: (s: SessaoRemota) => void }) {
  const caixa = useRef<HTMLDivElement>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [acoes, setAcoes] = useState<string[]>([])

  /*
   * O callback entra pelo script do Google, que não sabe nada de React e
   * guarda a função que receber na inicialização. Sem a ref, ele chamaria para
   * sempre a versão da primeira renderização — e `aoEntrar` fechado sobre
   * estado velho é a classe de defeito que só aparece na segunda tentativa.
   */
  const entrarRef = useRef(aoEntrar)
  entrarRef.current = aoEntrar

  useEffect(() => {
    const clientId = clientIdGoogle()
    if (!clientId) {
      setErro('Entrada pelo Google não configurada nesta instalação.')
      return
    }

    let vivo = true

    carregarGoogle()
      .then((google) => {
        if (!vivo || !caixa.current) return

        google.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          // Sem seleção automática: entrar é uma decisão, e uma sessão que
          // abre sozinha ao visitar a página surpreende quem só queria olhar.
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: ({ credential }) => {
            setErro(null)
            setAcoes([])
            entrarComGoogle(credential)
              .then((s) => entrarRef.current(s))
              .catch((e: unknown) => {
                if (e instanceof ErroApi) {
                  setErro(e.message)
                  setAcoes(e.acoes)
                } else {
                  setErro('Não foi possível concluir a entrada.')
                  setAcoes(['Tentar novamente'])
                }
              })
          },
        })

        google.renderButton(caixa.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          locale: 'pt-BR',
        })
      })
      .catch(() => {
        if (!vivo) return
        /*
         * O caso real é rede corporativa que bloqueia o domínio do Google. Sem
         * esta mensagem, o botão simplesmente não aparece — e quem olha
         * conclui que o sistema está quebrado, sem nada que indique onde.
         */
        setErro('Não foi possível carregar a entrada do Google.')
        setAcoes(['Conferir se a rede permite accounts.google.com', 'Tentar novamente'])
      })

    return () => {
      vivo = false
    }
  }, [])

  return (
    <div className="entrar__google">
      <div ref={caixa} />
      {/* `saidas` em vez de uma lista escrita aqui: o primitivo já desenha o
          que fazer a seguir, e repetir a marcação faria a recusa do Google
          parecer diferente de toda outra recusa da aplicação. */}
      {erro && <Aviso tom="atencao" titulo={erro} saidas={acoes} />}
    </div>
  )
}
