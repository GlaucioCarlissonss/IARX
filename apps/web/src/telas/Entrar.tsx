import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../dados/api'
import { SENHA_DEMONSTRACAO } from '../dados/comandos'
import { useSessao, useToast } from '../lib/contexto'
import { useFormulario } from '../lib/useFormulario'
import { Aviso, Botao, Entrada } from '../componentes/ui/primitivos'
import { ResumoErros } from '../componentes/ui/formulario'

/**
 * Tela de entrada.
 *
 * Três coisas nesta tela existem por razão de segurança, e as três são
 * espelhadas de `apps/api/src/modulos/auth/auth.service.ts` — não são escolha
 * de estilo:
 *
 *  1. **Recusa uniforme.** E-mail inexistente, senha errada e conta inativa
 *     devolvem a mesma frase. Mensagens distintas transformam o login num
 *     verificador de quem trabalha no locatário: basta uma lista de palpites e
 *     ler a diferença entre as respostas.
 *
 *  2. **Recuperação com resposta neutra.** "Se houver uma conta com este
 *     e-mail" em vez de "enviamos" ou "não encontramos", pela mesma razão.
 *
 *  3. **Senha no primeiro acesso definida pelo dono.** O convite não carrega
 *     senha. Senha definida por terceiro é senha compartilhada: quem a criou
 *     continua sabendo, e o dono não tem como provar que não foi ele.
 *
 * A credencial da demonstração está impressa aqui, rotulada como tal. É
 * andaime visível, não credencial fabricada — a diferença que importa é que
 * ninguém pode confundi-la com credencial real.
 */

type Passo =
  | { qual: 'credencial' }
  | { qual: 'recuperar' }
  | { qual: 'definir-senha'; usuarioId: string; nome: string }

export function Entrar() {
  const navegar = useNavigate()
  const { entrar } = useSessao()
  const { avisar } = useToast()
  const [passo, setPasso] = useState<Passo>({ qual: 'credencial' })
  const [neutra, setNeutra] = useState<string | null>(null)

  function concluir(usuarioId: string, nome: string) {
    entrar(usuarioId)
    avisar({ tom: 'ok', titulo: `Bem-vindo, ${nome.split(' ')[0]}`, texto: 'Sessão aberta.' })
    navegar('/')
  }

  return (
    <div className="entrar">
      <main className="entrar__painel" aria-labelledby="entrar-titulo">
        <div className="entrar__marca">
          <span className="entrar__glifo" aria-hidden="true">
            ◧
          </span>
          <div>
            <p className="entrar__produto">IARX</p>
            <p className="entrar__sub">Locação de impressoras e computadores corporativos</p>
          </div>
        </div>

        {passo.qual === 'credencial' && (
          <Credencial
            id="entrar-titulo"
            neutra={neutra}
            aoEntrar={concluir}
            aoPedirSenha={(usuarioId, nome) => {
              setNeutra(null)
              setPasso({ qual: 'definir-senha', usuarioId, nome })
            }}
            aoEsquecer={() => {
              setNeutra(null)
              setPasso({ qual: 'recuperar' })
            }}
          />
        )}

        {passo.qual === 'recuperar' && (
          <Recuperar
            id="entrar-titulo"
            aoVoltar={(mensagem) => {
              setNeutra(mensagem)
              setPasso({ qual: 'credencial' })
            }}
          />
        )}

        {passo.qual === 'definir-senha' && (
          <DefinirSenha id="entrar-titulo" passo={passo} aoConcluir={concluir} />
        )}
      </main>

      <p className="entrar__nota">
        Ambiente de demonstração com dados fictícios. A verificação de senha da aplicação real é Argon2id no
        servidor, com política de senha por locatário.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------- credencial */

interface CredencialProps {
  id: string
  neutra: string | null
  aoEntrar: (usuarioId: string, nome: string) => void
  aoPedirSenha: (usuarioId: string, nome: string) => void
  aoEsquecer: () => void
}

function Credencial({ id, neutra, aoEntrar, aoPedirSenha, aoEsquecer }: CredencialProps) {
  const form = useFormulario({
    inicial: { email: '', senha: '' },
    validar: (v) => ({
      email: !v.email.trim() ? 'Informe o e-mail.' : undefined,
      senha: !v.senha ? 'Informe a senha.' : undefined,
    }),
    aoEnviar: (v) => api.autenticar(v.email, v.senha),
    aoConcluir: (s) => {
      if (s.deveDefinirSenha) aoPedirSenha(s.usuario.id, s.usuario.nome)
      else aoEntrar(s.usuario.id, s.usuario.nome)
    },
  })

  return (
    <>
      <h1 id={id}>Entrar</h1>

      {/* A resposta neutra da recuperação volta para cá de propósito: mostrada
          na tela de recuperação, ela ficaria ao lado do campo de e-mail e
          pareceria confirmação de que aquele e-mail existe. */}
      {neutra && (
        <Aviso tom="ok" titulo="Pedido registrado">
          {neutra}
        </Aviso>
      )}

      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ email: 'E-mail', senha: 'Senha' }}
          refResumo={form.refResumo}
        />

        <div className="pilha g3">
          <Entrada
            rotulo="E-mail"
            nome="email"
            type="email"
            autoComplete="username"
            autoFocus
            value={form.valores.email}
            onChange={(e) => form.definir('email', e.target.value)}
            {...form.campo('email')}
          />
          <Entrada
            rotulo="Senha"
            nome="senha"
            type="password"
            autoComplete="current-password"
            value={form.valores.senha}
            onChange={(e) => form.definir('senha', e.target.value)}
            {...form.campo('senha')}
          />

          <Botao variante="primario" type="submit" disabled={form.enviando}>
            {form.enviando ? 'Entrando…' : 'Entrar'}
          </Botao>

          {/* Botão, não link: não navega para nenhum lugar, troca o passo do
              formulário. Um `<a href>` que não leva a um endereço quebra o
              clique do meio, o "abrir em nova aba" e o anúncio de "link". */}
          <Botao variante="sutil" type="button" onClick={aoEsquecer}>
            Esqueci minha senha
          </Botao>
        </div>
      </form>

      <div className="entrar__demo">
        <p className="entrar__demo__titulo">Credencial de demonstração</p>
        <p>
          E-mail <code className="dado">operacao@iarx.app</code> · senha{' '}
          <code className="dado">{SENHA_DEMONSTRACAO}</code>
        </p>
        <p className="texto-atenuado">
          Vale para qualquer conta ativa da base de demonstração. Não é credencial real e não existe fora
          deste ambiente.
        </p>
      </div>
    </>
  )
}

/* -------------------------------------------------------------- recuperar */

function Recuperar({ id, aoVoltar }: { id: string; aoVoltar: (mensagem: string) => void }) {
  const form = useFormulario({
    inicial: { email: '' },
    validar: (v) => ({ email: !v.email.trim() ? 'Informe o e-mail.' : undefined }),
    aoEnviar: (v) => api.solicitarRecuperacao(v.email),
    aoConcluir: (r) => aoVoltar(r.mensagem),
  })

  return (
    <>
      <h1 id={id}>Recuperar acesso</h1>
      <p className="texto-secundario medida-leitura">
        Informe o e-mail da conta. A resposta é a mesma exista ou não uma conta com ele — é o que impede esta
        tela de servir para descobrir quem tem acesso ao ambiente.
      </p>

      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ email: 'E-mail' }}
          refResumo={form.refResumo}
        />

        <div className="pilha g3">
          <Entrada
            rotulo="E-mail"
            nome="email"
            type="email"
            autoComplete="username"
            autoFocus
            value={form.valores.email}
            onChange={(e) => form.definir('email', e.target.value)}
            {...form.campo('email')}
          />
          <Botao variante="primario" type="submit" disabled={form.enviando}>
            {form.enviando ? 'Enviando…' : 'Enviar instruções'}
          </Botao>
          <Botao variante="sutil" type="button" onClick={() => aoVoltar('')}>
            Voltar para o login
          </Botao>
        </div>
      </form>
    </>
  )
}

/* ---------------------------------------------------------- primeiro acesso */

interface DefinirSenhaProps {
  id: string
  passo: { usuarioId: string; nome: string }
  aoConcluir: (usuarioId: string, nome: string) => void
}

function DefinirSenha({ id, passo, aoConcluir }: DefinirSenhaProps) {
  const form = useFormulario({
    inicial: { senha: '', confirmacao: '' },
    validar: (v) => ({
      senha: v.senha.length < 12 ? 'A senha precisa de ao menos 12 caracteres.' : undefined,
      confirmacao: v.confirmacao !== v.senha ? 'A confirmação não coincide.' : undefined,
    }),
    aoEnviar: (v) => api.definirSenhaPrimeiroAcesso(passo.usuarioId, v.senha, v.confirmacao),
    aoConcluir: (u) => aoConcluir(u.id, u.nome),
  })

  return (
    <>
      <h1 id={id}>Defina sua senha</h1>
      <Aviso tom="atencao" titulo="Primeiro acesso">
        Este convite ainda não foi aceito. Quem define a senha é você — nem o administrador que convidou nem
        ninguém mais a conhece.
      </Aviso>

      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ senha: 'Nova senha', confirmacao: 'Confirmação' }}
          refResumo={form.refResumo}
        />

        <div className="pilha g3">
          <Entrada
            rotulo="Nova senha"
            nome="senha"
            type="password"
            autoComplete="new-password"
            dica="Ao menos 12 caracteres — é o piso da política do locatário."
            autoFocus
            value={form.valores.senha}
            onChange={(e) => form.definir('senha', e.target.value)}
            {...form.campo('senha')}
          />
          <Entrada
            rotulo="Confirmação"
            nome="confirmacao"
            type="password"
            autoComplete="new-password"
            value={form.valores.confirmacao}
            onChange={(e) => form.definir('confirmacao', e.target.value)}
            {...form.campo('confirmacao')}
          />
          <Botao variante="primario" type="submit" disabled={form.enviando}>
            {form.enviando ? 'Salvando…' : 'Definir senha e entrar'}
          </Botao>
        </div>
      </form>
    </>
  )
}
