import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import { usuariosComPerfil } from '../dados/comandos'
import { useConsulta } from '../lib/useConsulta'
import { useSessao, useToast } from '../lib/contexto'
import { Aviso, Botao, Carregando, Cartao, Chip, Entrada, Metrica, Skeleton } from '../componentes/ui/primitivos'
import { ArvorePermissoes } from '../componentes/ui/ArvorePermissoes'
import type { Permissao } from '../lib/permissoes'
import type { PerfilGravado } from '../dados/tipos'

/**
 * Perfis de acesso.
 *
 * A tela existe para responder duas perguntas que o array de permissões no
 * banco não responde sozinho: **o que este perfil pode fazer** e **quem está
 * usando ele**. A segunda é a que evita o acidente — alterar um perfil muda o
 * acesso de todo mundo que o tem, e quem edita precisa saber quantas pessoas
 * são antes de salvar, não depois.
 *
 * Perfil de sistema aparece em leitura, com a razão à vista. Escondê-lo faria
 * a lista mentir sobre o que existe; deixá-lo editável mudaria o acesso de
 * gente que nunca foi consultada.
 */
export function Perfis() {
  const { pode } = useSessao()
  const { avisar } = useToast()
  const { situacao, dado, recarregar } = useConsulta(() => api.perfis(), [])

  const [selecionadoId, setSelecionadoId] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<{ nome: string; descricao: string; permissoes: Permissao[] } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const base = api.baseSincrona()
  const perfis = dado ?? []
  const selecionado = perfis.find((p) => p.id === selecionadoId) ?? perfis[0] ?? null

  const emEdicao = rascunho !== null
  const permissoesExibidas = (rascunho?.permissoes ?? (selecionado?.permissoes as Permissao[]) ?? []) as Permissao[]

  const uso = useMemo(
    () => (selecionado ? usuariosComPerfil(base, selecionado.id) : 0),
    [base, selecionado, dado],
  )

  function comecarEdicao(p: PerfilGravado) {
    setRascunho({ nome: p.nome, descricao: p.descricao, permissoes: [...p.permissoes] as Permissao[] })
    setErro(null)
  }

  /**
   * Duplicar é a saída para quem precisa de variação de um perfil de sistema.
   *
   * Sem ela, a recusa de editar seria um beco sem saída — a interface diria
   * "não pode" e não ofereceria o que fazer em seguida.
   */
  function duplicar(p: PerfilGravado) {
    setSelecionadoId(null)
    setRascunho({
      nome: `${p.nome} (cópia)`,
      descricao: p.descricao,
      permissoes: [...p.permissoes] as Permissao[],
    })
    setErro(null)
  }

  async function salvar() {
    if (!rascunho) return
    setSalvando(true)
    setErro(null)

    const alvoId = selecionadoId && perfis.find((p) => p.id === selecionadoId && !p.isSistema) ? selecionadoId : null
    const r = await api.salvarPerfil(alvoId, {
      nome: rascunho.nome,
      descricao: rascunho.descricao,
      tipo: selecionado?.tipo ?? 'INTERNO',
      permissoes: rascunho.permissoes,
    })
    setSalvando(false)

    if (r.ok) {
      setSelecionadoId(r.valor.id)
      setRascunho(null)
      recarregar()
      avisar({ tom: 'ok', titulo: 'Perfil salvo', texto: `${r.valor.permissoes.length} permissão(ões) concedida(s).` })
    } else {
      setErro(r.erro.mensagem)
    }
  }

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Perfis de acesso</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            O que cada perfil pode operar, por módulo, tela e ação. Alterar um perfil muda o acesso de todos que
            o têm — a contagem de uso aparece antes de salvar, não depois.
          </p>
        </div>
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica rotulo="Perfis" valor={String(perfis.length)} contexto="no ambiente" />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="De sistema"
            valor={String(perfis.filter((p) => p.isSistema).length)}
            contexto="estruturais, não editáveis"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Derivados"
            valor={String(perfis.filter((p) => !p.isSistema).length)}
            contexto="criados no ambiente"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Usuários neste perfil" valor={String(uso)} contexto="ativos" />
        </Cartao>
      </div>

      {situacao === 'carregando' ? (
        <Cartao>
          <Carregando rotulo="Carregando perfis">
            <Skeleton linhas={8} altura="22px" />
          </Carregando>
        </Cartao>
      ) : (
        <div className="mapa-painel">
          <Cartao titulo={selecionado ? `Permissões — ${rascunho?.nome ?? selecionado.nome}` : 'Permissões'}>
            {erro && (
              <Aviso tom="critico" titulo="Não foi possível salvar">
                {erro}
              </Aviso>
            )}

            {selecionado?.isSistema && !emEdicao && (
              <Aviso tom="atencao" titulo="Perfil de sistema, em leitura">
                Este perfil é estrutural: alterá-lo mudaria o acesso de todos que o têm, inclusive de quem nunca
                foi consultado. Para uma variação, duplique-o.
              </Aviso>
            )}

            {emEdicao && (
              <div className="pilha g3" style={{ marginBottom: 'var(--e3)' }}>
                <Entrada
                  rotulo="Nome do perfil"
                  value={rascunho.nome}
                  onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                />
                <Entrada
                  rotulo="Descrição"
                  dica="Uma frase sobre para quem este perfil serve."
                  value={rascunho.descricao}
                  onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })}
                />
              </div>
            )}

            <p className="texto-atenuado" role="status">
              {permissoesExibidas.length} permissão(ões) concedida(s)
              {uso > 0 && ` · ${uso} usuário(s) ativo(s) usam este perfil`}
            </p>

            <ArvorePermissoes
              concedidas={permissoesExibidas}
              bloqueada={!emEdicao}
              aoMudar={(p) => rascunho && setRascunho({ ...rascunho, permissoes: p })}
            />

            {pode('perfil:gerenciar') && (
              <div className="linha g2" style={{ marginTop: 'var(--e3)' }}>
                {emEdicao ? (
                  <>
                    <Botao variante="primario" onClick={salvar} disabled={salvando}>
                      {salvando ? 'Salvando…' : 'Salvar perfil'}
                    </Botao>
                    <Botao variante="sutil" onClick={() => { setRascunho(null); setErro(null) }}>
                      Cancelar
                    </Botao>
                  </>
                ) : (
                  selecionado && (
                    <>
                      <Botao
                        variante="primario"
                        disabled={selecionado.isSistema}
                        motivoDesabilitado="Perfil de sistema não é editável — duplique para criar uma variação"
                        onClick={() => comecarEdicao(selecionado)}
                      >
                        Editar permissões
                      </Botao>
                      <Botao onClick={() => duplicar(selecionado)}>Duplicar</Botao>
                    </>
                  )
                )}
              </div>
            )}
          </Cartao>

          <Cartao titulo={`Perfis (${perfis.length})`}>
            <ul className="mapa-lista" aria-label="Perfis de acesso">
              {perfis.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-current={selecionado?.id === p.id}
                    onClick={() => { setSelecionadoId(p.id); setRascunho(null); setErro(null) }}
                  >
                    <span className="linha entre g2">
                      <span className="mapa-lista__nome">{p.nome}</span>
                      <Chip severidade={p.isSistema ? 'inativo' : 'disponivel'}>
                        {p.isSistema ? 'Sistema' : 'Derivado'}
                      </Chip>
                    </span>
                    <span className="mapa-lista__local">
                      {p.tipo === 'CLIENTE' ? 'Locatário' : 'Interno'} · {p.permissoes.length} permissão(ões) ·{' '}
                      {usuariosComPerfil(base, p.id)} usuário(s)
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Cartao>
        </div>
      )}
    </>
  )
}
