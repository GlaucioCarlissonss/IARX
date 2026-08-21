import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSessao } from '../../lib/contexto'
import { api } from '../../dados/api'
import { FILIAIS } from '../../dados/catalogo'
import { Botao } from '../ui/primitivos'
import { PaletaComandos } from './PaletaComandos'
import { GRUPOS, NAVEGACAO, TITULOS } from '../../lib/navegacao'

/**
 * Estrutura da aplicação: rail de navegação, barra superior e área de conteúdo.
 *
 * Duas decisões de navegação:
 *  · Um único nível de menu, agrupado por finalidade. Submenu esconde função e
 *    obriga a memorizar caminho; agrupamento com rótulo resolve sem esconder.
 *  · Itens sem permissão não são renderizados — a lista de cada perfil fica
 *    curta o suficiente para ser lida de uma vez.
 */

/**
 * Contadores de pendência no menu.
 *
 * Ficam aqui, e não na lista compartilhada de navegação, porque só o menu os
 * exibe — a paleta de comandos não tem onde mostrá-los. Pôr na lista comum
 * obrigaria o outro consumidor a conhecer os indicadores sem usá-los.
 */
const CONTADORES: Record<string, (i: Awaited<ReturnType<typeof api.indicadores>>) => number> = {
  '/chamados': (i) => i.chamadosEmRiscoSla,
  '/estoque': (i) => i.pecasAbaixoMinimo,
  '/faturamento': (i) => i.pendenciasMedicao,
}

export function AppShell() {
  const { usuario, perfil, perfis, trocarPerfil, filialId, definirFilial, pode, sair } = useSessao()
  const navegar = useNavigate()
  const [paletaAberta, setPaletaAberta] = useState(false)
  const [tema, setTema] = useState<'sistema' | 'light' | 'dark'>('sistema')
  const [indicadores, setIndicadores] = useState<Awaited<ReturnType<typeof api.indicadores>> | null>(null)
  const local = useLocation()

  useEffect(() => {
    api.indicadores().then(setIndicadores).catch(() => setIndicadores(null))
  }, [])

  useEffect(() => {
    const raiz = document.documentElement
    if (tema === 'sistema') raiz.removeAttribute('data-theme')
    else raiz.setAttribute('data-theme', tema)
  }, [tema])

  useEffect(() => {
    function atalho(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletaAberta(true)
      }
    }
    window.addEventListener('keydown', atalho)
    return () => window.removeEventListener('keydown', atalho)
  }, [])

  const visiveis = NAVEGACAO.filter((i) => pode(i.permissao))
  const grupos = GRUPOS
  const tituloAtual = TITULOS[local.pathname] ?? 'IARX'

  return (
    <>
      <a className="pular-conteudo" href="#principal">
        Pular para o conteúdo
      </a>

      <div className="app">
        <div className="rail">
          <div className="marca">
            <span className="marca__sigla" aria-hidden="true">
              IX
            </span>
            <span className="pilha marca__texto">
              <span className="marca__nome">IARX</span>
              <span className="marca__desc">Locação de TI</span>
            </span>
          </div>

          <nav className="nav" aria-label="Navegação principal">
            {grupos.map((grupo) => {
              const doGrupo = visiveis.filter((i) => i.grupo === grupo)
              if (!doGrupo.length) return null
              return (
                <div key={grupo} className="pilha" style={{ gap: 2 }}>
                  <span className="nav__grupo">{grupo}</span>
                  {doGrupo.map((item) => {
                    const contador = CONTADORES[item.para]
                    const n = indicadores && contador ? contador(indicadores) : 0
                    return (
                      <NavLink
                        key={item.para}
                        to={item.para}
                        end={item.para === '/'}
                        className="nav__item"
                        style={{ textDecoration: 'none' }}
                        aria-current={local.pathname === item.para ? 'page' : undefined}
                      >
                        <span className="nav__glifo" aria-hidden="true">
                          {item.glifo}
                        </span>
                        <span className="nav__rotulo">{item.rotulo}</span>
                        {n > 0 && (
                          <span className="nav__contador">
                            {n}
                            <span className="so-leitor"> pendências</span>
                          </span>
                        )}
                      </NavLink>
                    )
                  })}
                </div>
              )
            })}
          </nav>
        </div>

        <header className="barra">
          <button className="busca" onClick={() => setPaletaAberta(true)}>
            <span aria-hidden="true">⌕</span>
            <span className="busca__texto">Buscar patrimônio, cliente, contrato, chamado…</span>
            <kbd aria-hidden="true">⌘K</kbd>
            <span className="so-leitor">Abrir busca global. Atalho: Control ou Command mais K.</span>
          </button>

          {/* Os rótulos somem abaixo de 1180px, mas só visualmente: o
              `aria-label` de cada select mantém o nome acessível, e o valor
              exibido ("Todas as filiais", "Administrador") já diz do que se
              trata. Manter o texto forçaria a barra a três linhas em notebook,
              empurrando o conteúdo para baixo da dobra. */}
          <div className="barra__controles">
            <label className="barra__campo">
              <span className="barra__campo__rotulo">Filial</span>
              <select
                value={filialId}
                onChange={(e) => definirFilial(e.target.value)}
                aria-label="Escopo de filial"
              >
                <option value="todas">Todas as filiais</option>
                {FILIAIS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.codigo} — {f.nome}
                  </option>
                ))}
              </select>
            </label>

            {/* Troca de perfil: existe para demonstrar o efeito das permissões
                na navegação e nas ações. Em produção viria do login. */}
            <label className="barra__campo">
              <span className="barra__campo__rotulo">Perfil</span>
              <select value={perfil.id} onChange={(e) => trocarPerfil(e.target.value)} aria-label="Perfil de acesso">
                {perfis.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>

            <label className="barra__campo">
              <span className="so-leitor">Tema da interface</span>
              <select
                value={tema}
                onChange={(e) => setTema(e.target.value as typeof tema)}
                aria-label="Tema da interface"
              >
                <option value="sistema">Tema do sistema</option>
                <option value="light">Tema claro</option>
                <option value="dark">Tema escuro</option>
              </select>
            </label>

            {/* Quem está na sessão, à vista.
                O seletor de perfil ao lado demonstra o efeito das permissões e
                pode divergir do perfil da conta — sem o nome do usuário aqui,
                não haveria como saber de quem é a sessão aberta. */}
            <div className="barra__conta">
              <span className="barra__conta__nome" title={usuario.email}>
                {usuario.nome}
              </span>
              <Botao
                variante="sutil"
                pequeno
                onClick={() => {
                  sair()
                  navegar('/entrar')
                }}
              >
                Sair
              </Botao>
            </div>
          </div>
        </header>

        <main className="conteudo" id="principal">
          {/* Migalhas com um nível: a hierarquia é rasa de propósito. Some na
              raiz, onde não acrescentaria informação. */}
          {local.pathname !== '/' && (
            <nav className="migalhas" aria-label="Trilha de navegação">
              <Link to="/">Painel do dia</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{tituloAtual}</span>
            </nav>
          )}
          <Outlet />
        </main>

        <footer className="rodape">
          <p>
            Base de demonstração com dados fictícios de uma operação de locação de impressoras e computadores.
            Data de referência: 30/07/2026.
          </p>
          <p>
            Cores de <span className="dado">@iarx/tokens</span> — 202/202 verificações de contraste e daltonismo
            aprovadas.
          </p>
        </footer>
      </div>

      {paletaAberta && <PaletaComandos aoFechar={() => setPaletaAberta(false)} />}
    </>
  )
}
