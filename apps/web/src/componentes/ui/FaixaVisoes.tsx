import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../dados/api'
import { useSessao, useToast } from '../../lib/contexto'
import type { TelaComVisao, VisaoSalva } from '../../dados/tipos'
import type { FiltroNaUrl } from '../../lib/useFiltroNaUrl'
import { Botao, Entrada } from './primitivos'
import { Dialogo } from './Dialogo'
import { MenuAcoes } from './MenuAcoes'
import type { AcaoMenu } from './MenuAcoes'

/**
 * Faixa de visões salvas (Anexo Y §Y.3.5).
 *
 * Um recorte nomeado vira um clique, e o endereço da página **é** o recorte.
 * O achado que isto resolve: quem cuida de preventiva vencida remontava o
 * mesmo filtro toda manhã, e o filtro nem sobrevivia à navegação.
 *
 * ## Duas espécies, e por que as duas
 *
 *  · **pessoal** — qualquer um salva a sua, sem permissão nenhuma. A decisão
 *    registrada no anexo era "compartilhadas no locatário", e sozinha deixaria
 *    de fora justamente quem tem o problema: quem opera resolveria o próprio
 *    dia pedindo a alguém com permissão;
 *  · **da equipe** (⚑) — aparece para todo o locatário, e exige
 *    `visao:compartilhar`.
 *
 * ## Contagem
 *
 * Só a visão ativa mostra contagem, e ela vem de quem renderiza a faixa.
 * Contar todas a cada carregamento pediria uma consulta por visão, e a faixa
 * ficaria mais cara que a lista que ela recorta.
 *
 * ## Alterar o filtro não altera a visão
 *
 * Mexer num seletor com uma visão aberta não a salva: a faixa passa a dizer
 * "filtros alterados", com *Atualizar* e *Descartar*. Salvar em silêncio
 * mudaria, para todo o locatário, o recorte que outra pessoa usa de manhã — e
 * ninguém saberia por quê.
 */

interface Props {
  tela: TelaComVisao
  filtro: FiltroNaUrl<Record<string, string>>
  /** Quantos registros a lista mostra agora. Só a visão ativa a exibe. */
  contagem?: number
}

export function FaixaVisoes({ tela, filtro, contagem }: Props) {
  const { usuario, pode } = useSessao()
  const { avisar } = useToast()

  const [visoes, setVisoes] = useState<VisaoSalva[]>([])
  const [aberto, setAberto] = useState<'salvar' | { renomear: VisaoSalva } | null>(null)
  const [nome, setNome] = useState('')
  const [compartilhar, setCompartilhar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const podeCompartilhar = pode('visao:compartilhar')

  const recarregar = useCallback(() => {
    void api.visoes(tela, usuario.id).then(setVisoes)
  }, [tela, usuario.id])

  useEffect(recarregar, [recarregar])

  /*
   * Qual visão está aberta é **derivado** do recorte, não guardado.
   *
   * Guardar "a visão ativa" num estado faria a lista e o chip divergirem no
   * primeiro caminho que muda a URL sem passar por aqui — um link colado, o
   * botão Voltar, um cartão do painel que já chega filtrado.
   */
  const ativa = useMemo(
    () => visoes.find((v) => filtro.igualA(v.consulta)) ?? null,
    [visoes, filtro],
  )

  /*
   * "Filtros alterados" só aparece quando havia uma visão aberta e o recorte
   * saiu dela. Sem a última visão aberta não há o que comparar — um recorte
   * montado do zero não é "alteração" de nada.
   */
  const [ultima, setUltima] = useState<string | null>(null)
  useEffect(() => {
    if (ativa) setUltima(ativa.id)
  }, [ativa])
  const alterada = !ativa && ultima ? (visoes.find((v) => v.id === ultima) ?? null) : null

  function abrirSalvar() {
    setNome('')
    setCompartilhar(false)
    setErro(null)
    setAberto('salvar')
  }

  async function salvar() {
    const r = await api.criarVisao(
      { tela, nome, consulta: filtro.consulta, compartilhada: compartilhar },
      usuario.id,
      podeCompartilhar,
    )
    if (!r.ok) {
      setErro(r.erro.mensagem)
      return
    }
    setAberto(null)
    avisar({ tom: 'ok', titulo: `Visão “${r.valor.nome}” salva.` })
    recarregar()
  }

  async function renomear(v: VisaoSalva) {
    const r = await api.editarVisao(v.id, { nome }, usuario.id, podeCompartilhar)
    if (!r.ok) {
      setErro(r.erro.mensagem)
      return
    }
    setAberto(null)
    avisar({ tom: 'ok', titulo: 'Visão renomeada.' })
    recarregar()
  }

  async function agir(
    acao: Promise<{ ok: boolean; erro?: { mensagem: string } }>,
    sucesso: string,
  ) {
    const r = await acao
    if (!r.ok) {
      avisar({ tom: 'erro', titulo: 'Não foi possível concluir', texto: r.erro?.mensagem })
      return
    }
    avisar({ tom: 'ok', titulo: sucesso })
    recarregar()
  }

  function menuDa(v: VisaoSalva): AcaoMenu[] {
    const minha = v.donoId === usuario.id
    const posso = minha || !v.compartilhada || podeCompartilhar
    const motivo = 'Esta visão é da equipe — duplique como sua para ajustá-la.'

    return [
      {
        rotulo: 'Atualizar com os filtros atuais',
        glifo: '↻',
        desabilitado: !posso,
        motivoDesabilitado: motivo,
        aoEscolher: () =>
          void agir(
            api.editarVisao(v.id, { consulta: filtro.consulta }, usuario.id, podeCompartilhar),
            'Visão atualizada.',
          ),
      },
      {
        rotulo: 'Renomear',
        glifo: '✎',
        desabilitado: !posso,
        motivoDesabilitado: motivo,
        aoEscolher: () => {
          setNome(v.nome)
          setErro(null)
          setAberto({ renomear: v })
        },
      },
      {
        rotulo: v.compartilhada ? 'Deixar de compartilhar' : 'Compartilhar com a equipe',
        glifo: '⚑',
        separar: true,
        desabilitado: !podeCompartilhar,
        motivoDesabilitado: 'Publicar um recorte para a operação inteira exige permissão.',
        aoEscolher: () =>
          void agir(
            api.editarVisao(v.id, { compartilhada: !v.compartilhada }, usuario.id, podeCompartilhar),
            v.compartilhada ? 'Visão agora é só sua.' : 'Visão publicada para a equipe.',
          ),
      },
      {
        rotulo: 'Duplicar como minha',
        glifo: '⎘',
        aoEscolher: () => void agir(api.duplicarVisao(v.id, usuario.id), 'Cópia criada.'),
      },
      {
        rotulo: 'Excluir visão',
        glifo: '⊗',
        perigo: true,
        separar: true,
        desabilitado: !posso,
        motivoDesabilitado: motivo,
        aoEscolher: () =>
          void agir(api.excluirVisao(v.id, usuario.id, podeCompartilhar), 'Visão excluída.'),
      },
    ]
  }

  // Sem visões e sem filtro, a faixa não teria o que oferecer além de um botão
  // que salva o recorte vazio — e "todos os registros" não é um recorte.
  if (visoes.length === 0 && filtro.ativos === 0) return null

  return (
    <>
      <div className="faixa-visoes" role="group" aria-label="Visões salvas desta lista">
        <span className="faixa-visoes__rotulo">Visões</span>

        <button
          type="button"
          className={ativa || alterada ? 'chip-visao' : 'chip-visao chip-visao--ativa'}
          aria-pressed={!ativa && !alterada}
          onClick={filtro.limpar}
        >
          Todos
        </button>

        {visoes.map((v) => {
          const eAtiva = ativa?.id === v.id
          const eAlterada = alterada?.id === v.id
          return (
            <span key={v.id} className="chip-visao__par">
              <button
                type="button"
                className={eAtiva ? 'chip-visao chip-visao--ativa' : 'chip-visao'}
                aria-pressed={eAtiva}
                onClick={() => filtro.aplicar(v.consulta)}
              >
                {v.compartilhada && (
                  <span className="chip-visao__flama" aria-hidden="true">
                    ⚑
                  </span>
                )}
                {v.nome}
                {v.compartilhada && <span className="so-leitor"> — visão da equipe</span>}
                {eAtiva && contagem !== undefined && (
                  <span className="chip-visao__n dado">{contagem.toLocaleString('pt-BR')}</span>
                )}
                {eAlterada && <span className="chip-visao__ponto" aria-hidden="true" />}
              </button>
              {(eAtiva || eAlterada) && (
                <MenuAcoes rotuloAlvo={`da visão ${v.nome}`} titulo={v.nome} acoes={menuDa(v)} />
              )}
            </span>
          )
        })}

        {alterada ? (
          <span className="faixa-visoes__alterada" role="status">
            <span className="faixa-visoes__aviso">filtros alterados</span>
            <Botao
              pequeno
              onClick={() =>
                void agir(
                  api.editarVisao(alterada.id, { consulta: filtro.consulta }, usuario.id, podeCompartilhar),
                  'Visão atualizada.',
                )
              }
            >
              Atualizar “{alterada.nome}”
            </Botao>
            {/*
              "Salvar como nova" não é supérfluo: o caminho mais comum depois
              de abrir uma visão é estreitá-la — "preventiva vencida, mas só
              Curitiba". Sem esta saída, quem faz isso só pode sobrescrever o
              recorte da equipe ou jogar fora o próprio ajuste.
            */}
            <Botao pequeno onClick={abrirSalvar}>
              Salvar como nova
            </Botao>
            <Botao pequeno variante="sutil" onClick={() => filtro.aplicar(alterada.consulta)}>
              Descartar
            </Botao>
          </span>
        ) : (
          filtro.ativos > 0 &&
          !ativa && (
            <button type="button" className="chip-visao chip-visao--nova" onClick={abrirSalvar}>
              ＋ Salvar esta visão
            </button>
          )
        )}
      </div>

      {aberto === 'salvar' && (
        <Dialogo
          titulo="Salvar esta visão"
          descricao="A visão guarda os filtros e a ordenação — não os registros. Ela mostra o que estiver valendo quando for aberta."
          aoFechar={() => setAberto(null)}
          acoes={
            <>
              <Botao onClick={() => setAberto(null)}>Cancelar</Botao>
              <Botao variante="primario" onClick={() => void salvar()} disabled={!nome.trim()}>
                Salvar visão
              </Botao>
            </>
          }
        >
          <div className="pilha g3">
            <Entrada
              rotulo="Nome"
              nome="nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              erro={erro ?? undefined}
            />

            <fieldset className="escolha-alcance">
              <legend>Quem enxerga</legend>
              <label className="escolha-alcance__opcao">
                <input
                  type="radio"
                  name="alcance"
                  checked={!compartilhar}
                  onChange={() => setCompartilhar(false)}
                />
                <span>
                  <strong>Só eu</strong>
                  <span className="texto-atenuado">Fica na sua lista. Ninguém mais vê.</span>
                </span>
              </label>
              <label className="escolha-alcance__opcao">
                <input
                  type="radio"
                  name="alcance"
                  checked={compartilhar}
                  disabled={!podeCompartilhar}
                  onChange={() => setCompartilhar(true)}
                />
                <span>
                  <strong>Toda a operação ⚑</strong>
                  <span className="texto-atenuado">
                    {podeCompartilhar
                      ? 'Aparece para quem abre esta tela, com o seu nome ao lado.'
                      : 'Publicar um recorte para a operação inteira exige permissão.'}
                  </span>
                </span>
              </label>
            </fieldset>

            <div className="lote-alvos">
              <p className="texto-atenuado" style={{ fontSize: 'var(--t-12)' }}>
                O que esta visão guarda
              </p>
              <ul>
                {Object.entries(filtro.consulta).map(([k, v]) => (
                  <li key={k}>
                    <span className="dado">{k}</span>: {v}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Dialogo>
      )}

      {aberto && typeof aberto === 'object' && (
        <Dialogo
          titulo="Renomear visão"
          aoFechar={() => setAberto(null)}
          largura="estreito"
          acoes={
            <>
              <Botao onClick={() => setAberto(null)}>Cancelar</Botao>
              <Botao
                variante="primario"
                onClick={() => void renomear(aberto.renomear)}
                disabled={!nome.trim()}
              >
                Renomear
              </Botao>
            </>
          }
        >
          <Entrada
            rotulo="Nome"
            nome="nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            erro={erro ?? undefined}
          />
        </Dialogo>
      )}
    </>
  )
}
