import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSessao } from '../../lib/contexto'
import { api } from '../../dados/api'
import { enderecoDaApi } from '../../dados/http'
import { emDemonstracao } from '../../lib/demonstracao'
import { FILIAIS } from '../../dados/catalogo'
import { Botao } from '../ui/primitivos'
import { MarcaIarx } from '../ui/MarcaIarx'
import { PaletaComandos } from './PaletaComandos'
import {
  AREAS,
  AREAS_PORTAL,
  ATALHOS_CELULAR,
  ATALHOS_CELULAR_PORTAL,
  NAVEGACAO,
  NAVEGACAO_PORTAL,
  TITULOS,
  areaDe,
} from '../../lib/navegacao'
import type { ItemNavegacao } from '../../lib/navegacao'

/**
 * Estrutura da aplicação: rail de navegação, barra superior e área de conteúdo.
 *
 * ## A navegação em áreas (Anexo Y §Y.3.1 e §Y.3.2)
 *
 * Eram vinte itens sempre visíveis, nove deles em Financeiro. Em notebook a
 * última área já ficava fora da dobra, e as telas construídas depois levariam o
 * total a trinta.
 *
 * Agora são seis áreas e só a aberta mostra os filhos. **Não é submenu**: o
 * destino continua a um clique de distância assim que a área está aberta, e a
 * área da tela atual abre sozinha — ninguém precisa lembrar onde algo mora para
 * voltar a ele. O que o acordeão esconde é o que não se está usando.
 *
 * No celular a decisão é outra e mais grave. O rail virava uma faixa horizontal
 * de glifos **sem rótulo**, mostrando seis dos vinte destinos — as outras
 * quatorze telas não tinham caminho nenhum. Agora há uma barra inferior com
 * quatro destinos nomeados e "Mais", que abre a lista inteira. Campo é onde o
 * sistema mais é usado no celular, e era a tela que mais falhava.
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
  const { usuario, perfil, perfis, trocarPerfil, filialId, definirFilial, pode, sair, escopo } = useSessao()
  const navegar = useNavigate()
  const [paletaAberta, setPaletaAberta] = useState(false)
  const [maisAberto, setMaisAberto] = useState(false)
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

  /* Mudar de tela fecha a folha de "Mais" — ela é um caminho, não um destino. */
  useEffect(() => setMaisAberto(false), [local.pathname])

  /*
   * A audiência vem do **escopo**, e o escopo vem da identidade.
   *
   * Não é "o perfil é de cliente?": trocar de perfil demonstra o efeito das
   * permissões e não muda de aplicação. É a mesma separação do servidor, onde o
   * que distingue `/portal` das rotas da operação é o `cliente_id` do token, e
   * não as permissões dele.
   */
  const doPortal = escopo !== null
  const visiveis = (doPortal ? NAVEGACAO_PORTAL : NAVEGACAO).filter((i) => pode(i.permissao))
  const areas = doPortal ? AREAS_PORTAL : AREAS
  const atalhos = doPortal ? ATALHOS_CELULAR_PORTAL : ATALHOS_CELULAR
  const tituloAtual = TITULOS[local.pathname] ?? 'IARX'
  const raiz = doPortal ? '/portal' : '/'
  const demo = emDemonstracao(enderecoDaApi())

  /*
   * Quais áreas estão abertas — **várias ao mesmo tempo**.
   *
   * A primeira versão guardava uma só: abrir Financeiro fechava Parque. Quem
   * trabalha com duas áreas ao mesmo tempo — e é o caso de quase todo mundo
   * aqui, entre o parque e o chamado — reabria a mesma seção a cada ida e
   * volta. Sanfona não é rádio: cada seção abre e fecha por conta própria, e o
   * que você abriu continua aberto.
   *
   * A área da tela atual entra sozinha, e **nunca sai por navegação**: quem
   * chega por link — paleta de comandos, cartão do painel, migalha — precisa
   * ver no menu onde está. Fechar continua sendo decisão de quem clica.
   */
  const areaDaTela = areaDe(local.pathname)
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(
    () => new Set(areaDaTela ? [areaDaTela] : []),
  )

  useEffect(() => {
    if (!areaDaTela) return
    setAbertas((atuais) => (atuais.has(areaDaTela) ? atuais : new Set([...atuais, areaDaTela])))
  }, [areaDaTela])

  function alternarArea(id: string) {
    setAbertas((atuais) => {
      const nova = new Set(atuais)
      if (nova.has(id)) nova.delete(id)
      else nova.add(id)
      return nova
    })
  }

  const porArea = useMemo(() => {
    const mapa = new Map<string, ItemNavegacao[]>()
    for (const item of visiveis) {
      const lista = mapa.get(item.area)
      if (lista) lista.push(item)
      else mapa.set(item.area, [item])
    }
    return mapa
  }, [visiveis])

  const pendencias = (item: ItemNavegacao) => {
    const contador = CONTADORES[item.para]
    return indicadores && contador ? contador(indicadores) : 0
  }

  /** Pendências de uma área inteira — é o que o botão fechado mostra. */
  const pendenciasDaArea = (id: string) =>
    (porArea.get(id) ?? []).reduce((soma, i) => soma + pendencias(i), 0)

  const itensDaArea = (id: string) => porArea.get(id) ?? []

  /** Itens agrupados pelo subtítulo, preservando a ordem da lista. */
  const blocosDaArea = (id: string) => {
    const blocos: { titulo?: string; itens: ItemNavegacao[] }[] = []
    for (const item of itensDaArea(id)) {
      const ultimo = blocos[blocos.length - 1]
      if (ultimo && ultimo.titulo === item.subgrupo) ultimo.itens.push(item)
      else blocos.push({ titulo: item.subgrupo, itens: [item] })
    }
    return blocos
  }

  const link = (item: ItemNavegacao, classe: string) => {
    const n = pendencias(item)
    return (
      <NavLink
        key={item.para}
        to={item.para}
        end={item.para === raiz}
        className={`${classe} sem-sublinhado`}
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
  }

  return (
    <>
      <a className="pular-conteudo" href="#principal">
        Pular para o conteúdo
      </a>

      <div className="app">
        <div className="rail">
          <div className="marca">
            {/*
              A marca é o rótulo acessível do rail quando ele colapsa: abaixo de
              1024px o texto ao lado some, e o `aria-label` do símbolo é tudo o
              que resta para dizer de que aplicação é esta janela.
            */}
            <MarcaIarx titulo={doPortal ? 'IARX — Portal do cliente' : 'IARX'} />
            <span className="pilha marca__texto">
              <span className="marca__nome">IARX</span>
              <span className="marca__desc">{doPortal ? 'Portal do cliente' : 'Locação de TI'}</span>
            </span>
          </div>

          <nav className="nav" aria-label="Navegação principal">
            {areas.map((area) => {
              const itens = itensDaArea(area.id)
              if (!itens.length) return null

              /*
               * Área de um item só não tem o que esconder: ela **é** o link.
               * Um acordeão aqui pediria um clique para revelar um filho de
               * mesmo nome — gasto puro, e um alvo de toque a mais no caminho.
               */
              if (itens.length === 1 && itens[0]!.para === raiz) {
                return link(itens[0]!, 'nav__item nav__item--unico')
              }

              const aberta = abertas.has(area.id)
              const n = pendenciasDaArea(area.id)
              return (
                <div key={area.id} className="nav__area">
                  <button
                    type="button"
                    className="nav__area__botao"
                    aria-expanded={aberta}
                    aria-controls={`area-${area.id}`}
                    onClick={() => alternarArea(area.id)}
                  >
                    <span className="nav__glifo" aria-hidden="true">
                      {area.glifo}
                    </span>
                    <span className="nav__rotulo">{area.rotulo}</span>
                    {n > 0 && !aberta && (
                      <span className="nav__contador">
                        {n}
                        <span className="so-leitor"> pendências</span>
                      </span>
                    )}
                    {/*
                      Uma seta só, que gira.

                      Trocar o glifo — `›` fechado, `⌄` aberto — obriga a ler
                      dois símbolos diferentes e compará-los de memória com o
                      estado que se espera. A mesma seta girando mostra o
                      estado **e** a transição: o movimento é a explicação.
                      Quem desligou animação no sistema vê a seta já girada,
                      sem movimento, e o significado não se perde.
                    */}
                    <span className="nav__area__seta" aria-hidden="true">
                      ▾
                    </span>
                  </button>

                  {aberta && (
                    <div className="nav__area__itens" id={`area-${area.id}`}>
                      {blocosDaArea(area.id).map((bloco, i) => (
                        <div key={bloco.titulo ?? i} className="nav__bloco">
                          {bloco.titulo && <span className="nav__grupo">{bloco.titulo}</span>}
                          {bloco.itens.map((item) => link(item, 'nav__item'))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
        </div>

        <header className="barra">
          {/*
            A marca na barra, só em celular.
            
            Abaixo de 760px o rail some inteiro, e com ele o único lugar que
            dizia de que aplicação é esta janela. Numa aba entre outras seis, a
            página sem marca é a que o usuário fecha por engano.
          */}
          <span className="barra__marca" aria-hidden="true">
            <MarcaIarx titulo={doPortal ? 'IARX — Portal do cliente' : 'IARX'} />
          </span>

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
            {/*
              Filial é dimensão do **locador**: para quem é do cliente ela não
              existe, e oferecê-la sugeriria um recorte que não é o dele. No
              lugar dela, o escopo que de fato se aplica — e ele aparece escrito
              porque um recorte silencioso faz quem vê uma unidade ler o número
              como se fosse o do grupo.
            */}
            {doPortal ? (
              <p className="barra__campo texto-secundario sem-margem">
                {escopo!.locaisIds === null
                  ? 'Todas as unidades'
                  : `${escopo!.locaisIds.length} unidade(s) no seu acesso`}
              </p>
            ) : (
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
            )}

            {/*
              Troca de perfil — só na demonstração (Anexo Y §Y.3.7).

              Ela existe para mostrar o efeito das permissões na navegação e nas
              ações. Numa instalação real o perfil vem do token, e trocá-lo pela
              barra superior seria um caminho sem permissão e sem trilha de
              auditoria — exatamente o que o modelo do servidor não admite.
            */}
            {demo && (
              <label className="barra__campo">
                <span className="barra__campo__rotulo">Perfil</span>
                <select
                  value={perfil.id}
                  onChange={(e) => trocarPerfil(e.target.value)}
                  aria-label="Perfil de acesso (demonstração)"
                >
                  {perfis.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </select>
              </label>
            )}

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
                Na demonstração o seletor de perfil ao lado pode divergir do
                perfil da conta — sem o nome do usuário aqui, não haveria como
                saber de quem é a sessão aberta. */}
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
          {local.pathname !== raiz && (
            <nav className="migalhas" aria-label="Trilha de navegação">
              <Link to={raiz}>{doPortal ? 'Meu painel' : 'Painel do dia'}</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{tituloAtual}</span>
            </nav>
          )}
          <Outlet />
        </main>

        {/*
          Barra inferior — só em celular, por CSS.

          Renderizada sempre e escondida acima de 760px, em vez de montada por
          medição de largura: medir no JavaScript faz a barra aparecer depois do
          primeiro quadro, e um alvo de toque que surge sob o dedo é pior que
          um que nunca existiu.
        */}
        <nav className="barra-inferior" aria-label="Navegação em celular">
          {atalhos.map((id) => {
            const area = areas.find((a) => a.id === id)
            const itens = itensDaArea(id)
            if (!area || !itens.length) return null

            /* Área de um destino leva direto a ele; de vários, ao primeiro —
               que é a tela mais usada da área, pela ordem da lista. */
            const destino = itens[0]!.para
            const n = pendenciasDaArea(id)
            const ativa = areaDaTela === id
            return (
              <NavLink
                key={id}
                to={destino}
                end={destino === raiz}
                className="barra-inferior__item sem-sublinhado"
                aria-current={ativa ? 'page' : undefined}
              >
                <span className="barra-inferior__glifo" aria-hidden="true">
                  {area.glifo}
                </span>
                <span className="barra-inferior__rotulo">{area.curto}</span>
                {n > 0 && (
                  <span className="barra-inferior__ponto">
                    {n}
                    <span className="so-leitor"> pendências</span>
                  </span>
                )}
              </NavLink>
            )
          })}

          <button
            type="button"
            className="barra-inferior__item barra-inferior__item--mais"
            aria-expanded={maisAberto}
            aria-controls="folha-mais"
            onClick={() => setMaisAberto((v) => !v)}
          >
            <span className="barra-inferior__glifo" aria-hidden="true">
              ☰
            </span>
            <span className="barra-inferior__rotulo">Mais</span>
          </button>
        </nav>

        {maisAberto && (
          <div className="folha" id="folha-mais">
            <div className="folha__cabecalho">
              <h2 className="folha__titulo">Todas as áreas</h2>
              <Botao variante="sutil" pequeno onClick={() => setMaisAberto(false)}>
                Fechar
              </Botao>
            </div>
            <nav className="folha__lista" aria-label="Todas as áreas">
              {areas.map((area) => {
                const itens = itensDaArea(area.id)
                if (!itens.length) return null
                return (
                  <div key={area.id} className="folha__area">
                    <span className="nav__grupo">{area.rotulo}</span>
                    {itens.map((item) => link(item, 'nav__item'))}
                  </div>
                )
              })}
            </nav>
          </div>
        )}

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
