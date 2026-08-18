import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import { useConsulta } from '../lib/useConsulta'
import { useSessao, useToast } from '../lib/contexto'
import { data } from '../lib/formato'
import { Botao, Carregando, Cartao, Chip, Entrada, Metrica, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { Dialogo } from '../componentes/ui/Dialogo'
import { LinhaCampos, ResumoErros } from '../componentes/ui/formulario'
import { Tabela } from '../componentes/ui/Tabela'
import { useFormulario } from '../lib/useFormulario'
import type { Coluna } from '../componentes/ui/Tabela'
import type { PerfilGravado, Usuario } from '../dados/tipos'

/**
 * Gestão de usuários.
 *
 * Três estados que a tela existe para tornar visíveis, e que uma lista de
 * "quem tem acesso" esconderia: quem está **inativo** (mantém histórico e não
 * entra), quem foi **convidado e não aceitou** (existe e ainda não tem senha),
 * e quem é **usuário do locatário** (vê só o próprio parque). Confundir os três
 * é o que leva alguém a convidar de novo quem já foi convidado, ou a procurar
 * na base uma conta que está lá, desativada.
 */

interface Linha {
  usuario: Usuario
  perfis: PerfilGravado[]
}

export function Usuarios() {
  const { pode } = useSessao()
  const { avisar } = useToast()
  const { situacao, dado, recarregar } = useConsulta(() => api.usuarios(), [])

  const [texto, setTexto] = useState('')
  const [recorte, setRecorte] = useState('')
  const [aberto, setAberto] = useState<
    { tipo: 'convite' } | { tipo: 'perfil'; usuario: Usuario } | { tipo: 'desativar'; usuario: Usuario } | null
  >(null)

  const base = api.baseSincrona()

  const linhas = useMemo<Linha[]>(() => {
    if (!dado) return []
    return dado.map((u) => ({
      usuario: u,
      perfis: u.perfilIds.map((id) => base.perfis.find((p) => p.id === id)).filter((p): p is PerfilGravado => !!p),
    }))
  }, [dado, base])

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return linhas.filter((l) => {
      if (recorte === 'ativos' && l.usuario.status !== 'ATIVO') return false
      if (recorte === 'inativos' && l.usuario.status === 'ATIVO') return false
      if (recorte === 'pendentes' && l.usuario.conviteAceito) return false
      if (recorte === 'cliente' && l.usuario.tipo !== 'CLIENTE') return false
      if (t && !`${l.usuario.nome} ${l.usuario.email}`.toLowerCase().includes(t)) return false
      return true
    })
  }, [linhas, texto, recorte])

  const colunas: Coluna<Linha>[] = [
    {
      chave: 'nome',
      titulo: 'Usuário',
      identificadora: true,
      ordenarPor: (l) => l.usuario.nome,
      celula: (l) => (
        <span className="pilha g1">
          <span>{l.usuario.nome}</span>
          <span className="texto-atenuado">{l.usuario.email}</span>
        </span>
      ),
    },
    {
      chave: 'tipo',
      titulo: 'Tipo',
      ordenarPor: (l) => l.usuario.tipo,
      celula: (l) =>
        l.usuario.tipo === 'CLIENTE' ? (
          <Chip severidade="uso" detalhe={base.clientes.find((c) => c.id === l.usuario.clienteId)?.nomeFantasia}>
            Locatário
          </Chip>
        ) : (
          <Chip severidade="inativo">Interno</Chip>
        ),
    },
    {
      chave: 'perfis',
      titulo: 'Perfis',
      ocultarEmMobile: true,
      celula: (l) => l.perfis.map((p) => p.nome).join(', ') || '—',
    },
    {
      chave: 'status',
      titulo: 'Situação',
      ordenarPor: (l) => l.usuario.status,
      celula: (l) => {
        // Convite pendente vem antes do status: é o estado que explica por que
        // uma conta "ativa" nunca acessou, e o mais fácil de interpretar errado.
        if (!l.usuario.conviteAceito) return <Chip severidade="atencao">Convite pendente</Chip>
        if (l.usuario.status === 'ATIVO') return <Chip severidade="disponivel">Ativo</Chip>
        return <Chip severidade="inativo">{l.usuario.status === 'INATIVO' ? 'Inativo' : 'Bloqueado'}</Chip>
      },
    },
    {
      chave: 'acesso',
      titulo: 'Último acesso',
      ocultarEmMobile: true,
      ordenarPor: (l) => l.usuario.ultimoAcesso ?? '',
      celula: (l) => (l.usuario.ultimoAcesso ? data(l.usuario.ultimoAcesso) : <span className="texto-atenuado">nunca</span>),
    },
    {
      chave: 'acoes',
      titulo: 'Ações',
      celula: (l) =>
        pode('usuario:gerenciar') ? (
          <span className="linha g2">
            <Botao pequeno onClick={() => setAberto({ tipo: 'perfil', usuario: l.usuario })}>
              Perfil<span className="so-leitor"> de {l.usuario.nome}</span>
            </Botao>
            {l.usuario.status === 'ATIVO' ? (
              <Botao pequeno variante="sutil" onClick={() => setAberto({ tipo: 'desativar', usuario: l.usuario })}>
                Desativar<span className="so-leitor"> {l.usuario.nome}</span>
              </Botao>
            ) : (
              <Botao
                pequeno
                variante="sutil"
                onClick={async () => {
                  const r = await api.ativarUsuario(l.usuario.id)
                  if (r.ok) {
                    recarregar()
                    avisar({ tom: 'ok', titulo: 'Usuário reativado', texto: `${l.usuario.nome} voltou a ter acesso.` })
                  }
                }}
              >
                Reativar<span className="so-leitor"> {l.usuario.nome}</span>
              </Botao>
            )}
          </span>
        ) : (
          <span className="texto-atenuado">—</span>
        ),
    },
  ]

  const ativos = linhas.filter((l) => l.usuario.status === 'ATIVO').length
  const pendentes = linhas.filter((l) => !l.usuario.conviteAceito).length

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Usuários</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Quem tem acesso ao ambiente, com que perfil. O convite não define senha — quem entra escolhe a
            própria no primeiro acesso.
          </p>
        </div>
        {pode('usuario:gerenciar') && (
          <Botao variante="primario" glifo="✚" onClick={() => setAberto({ tipo: 'convite' })}>
            Convidar usuário
          </Botao>
        )}
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica rotulo="Usuários" valor={String(linhas.length)} contexto="no ambiente" />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Ativos" valor={String(ativos)} contexto="com acesso liberado" />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Convites pendentes" valor={String(pendentes)} contexto="ainda sem primeiro acesso" />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Do locatário"
            valor={String(linhas.filter((l) => l.usuario.tipo === 'CLIENTE').length)}
            contexto="acesso somente ao próprio parque"
          />
        </Cartao>
      </div>

      <Cartao>
        <div className="filtros">
          <div style={{ minWidth: 240, flex: 1 }}>
            <Entrada
              rotulo="Buscar por nome ou e-mail"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar por nome ou e-mail…"
            />
          </div>
          <Selecao
            rotulo="Recorte"
            value={recorte}
            onChange={(e) => setRecorte(e.target.value)}
            opcoes={[
              { valor: '', texto: 'Todos' },
              { valor: 'ativos', texto: 'Somente ativos' },
              { valor: 'inativos', texto: 'Inativos e bloqueados' },
              { valor: 'pendentes', texto: 'Convite pendente' },
              { valor: 'cliente', texto: 'Usuários do locatário' },
            ]}
          />
        </div>

        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando usuários">
            <Skeleton linhas={8} altura="22px" />
          </Carregando>
        ) : (
          <Tabela
            legenda="Usuários do ambiente, com perfil, situação e último acesso"
            colunas={colunas}
            itens={filtradas}
            chaveDe={(l) => l.usuario.id}
            ordemInicial={{ chave: 'nome', direcao: 'asc' }}
            vazio={{ titulo: 'Nenhum usuário com esses filtros', texto: 'Ajuste a busca ou o recorte.' }}
          />
        )}
      </Cartao>

      {aberto?.tipo === 'convite' && (
        <FormConvite aoFechar={() => setAberto(null)} aoConcluir={recarregar} />
      )}
      {aberto?.tipo === 'perfil' && (
        <FormPerfilUsuario usuario={aberto.usuario} aoFechar={() => setAberto(null)} aoConcluir={recarregar} />
      )}
      {aberto?.tipo === 'desativar' && (
        <FormDesativar usuario={aberto.usuario} aoFechar={() => setAberto(null)} aoConcluir={recarregar} />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

const ROTULOS_CONVITE = {
  nome: 'Nome completo',
  email: 'E-mail',
  perfilId: 'Perfil',
  clienteId: 'Cliente',
}

function FormConvite({ aoFechar, aoConcluir }: { aoFechar: () => void; aoConcluir: () => void }) {
  const { avisar } = useToast()
  const base = api.baseSincrona()

  const form = useFormulario({
    inicial: { nome: '', email: '', tipo: 'INTERNO' as 'INTERNO' | 'CLIENTE', clienteId: '', perfilId: '' },
    validar: (v) => {
      const e: Record<string, string> = {}
      if (v.nome.trim().length < 3) e['nome'] = 'Informe o nome completo.'
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) e['email'] = 'Informe um e-mail válido.'
      if (!v.perfilId) e['perfilId'] = 'Escolha o perfil.'
      if (v.tipo === 'CLIENTE' && !v.clienteId) e['clienteId'] = 'Escolha o cliente.'
      return e
    },
    aoEnviar: (v) =>
      api.convidarUsuario({
        nome: v.nome,
        email: v.email,
        tipo: v.tipo,
        clienteId: v.tipo === 'CLIENTE' ? v.clienteId : null,
        perfilId: v.perfilId,
        filiaisIds: [],
      }),
    aoConcluir: (u) => {
      avisar({
        tom: 'ok',
        titulo: 'Convite enviado',
        texto: `${u.nome} define a própria senha no primeiro acesso.`,
      })
      aoConcluir()
      aoFechar()
    },
  })

  const perfisDoTipo = base.perfis.filter((p) => p.tipo === form.valores.tipo)

  return (
    <Dialogo
      titulo="Convidar usuário"
      descricao="O convidado define a própria senha ao aceitar. O administrador nunca a define — senha escolhida por terceiro é senha compartilhada."
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao onClick={aoFechar}>Cancelar</Botao>
          <Botao variante="primario" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Enviando…' : 'Enviar convite'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={ROTULOS_CONVITE}
          refResumo={form.refResumo}
        />

        <LinhaCampos>
          <Entrada
            rotulo="Nome completo"
            value={form.valores.nome}
            onChange={(e) => form.definir('nome', e.target.value)}
            {...form.campo('nome')}
          />
          <Entrada
            rotulo="E-mail"
            type="email"
            value={form.valores.email}
            onChange={(e) => form.definir('email', e.target.value)}
            {...form.campo('email')}
          />
        </LinhaCampos>

        <LinhaCampos>
          <Selecao
            rotulo="Tipo de acesso"
            dica="Usuário do locatário enxerga apenas o próprio parque."
            value={form.valores.tipo}
            onChange={(e) => {
              form.definir('tipo', e.target.value as 'INTERNO' | 'CLIENTE')
              // O perfil precisa casar com o tipo; manter a escolha anterior
              // deixaria um valor inválido pré-selecionado.
              form.definir('perfilId', '')
            }}
            opcoes={[
              { valor: 'INTERNO', texto: 'Interno — equipe da locadora' },
              { valor: 'CLIENTE', texto: 'Locatário — usuário do cliente' },
            ]}
          />
          <Selecao
            rotulo="Perfil"
            value={form.valores.perfilId}
            onChange={(e) => form.definir('perfilId', e.target.value)}
            opcoes={[
              { valor: '', texto: 'Selecione…' },
              ...perfisDoTipo.map((p) => ({ valor: p.id, texto: p.nome })),
            ]}
            {...form.campo('perfilId')}
          />
        </LinhaCampos>

        {form.valores.tipo === 'CLIENTE' && (
          <Selecao
            rotulo="Cliente"
            value={form.valores.clienteId}
            onChange={(e) => form.definir('clienteId', e.target.value)}
            opcoes={[
              { valor: '', texto: 'Selecione…' },
              ...base.clientes.map((c) => ({ valor: c.id, texto: c.nomeFantasia })),
            ]}
            {...form.campo('clienteId')}
          />
        )}
      </form>
    </Dialogo>
  )
}

function FormPerfilUsuario({
  usuario,
  aoFechar,
  aoConcluir,
}: {
  usuario: Usuario
  aoFechar: () => void
  aoConcluir: () => void
}) {
  const { avisar } = useToast()
  const base = api.baseSincrona()
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const atribuidos = usuario.perfilIds
  const disponiveis = base.perfis.filter((p) => p.tipo === usuario.tipo && !atribuidos.includes(p.id))

  async function agir(fn: () => Promise<{ ok: boolean; erro?: { mensagem: string } }>, sucesso: string) {
    setOcupado(true)
    setErro(null)
    const r = (await fn()) as { ok: boolean; erro?: { mensagem: string } }
    setOcupado(false)
    if (r.ok) {
      aoConcluir()
      avisar({ tom: 'ok', titulo: sucesso, texto: usuario.nome })
      aoFechar()
    } else {
      setErro(r.erro?.mensagem ?? 'Não foi possível concluir.')
    }
  }

  return (
    <Dialogo
      titulo={`Perfis de ${usuario.nome}`}
      descricao="Um usuário pode ter mais de um perfil; o acesso é a união deles."
      aoFechar={aoFechar}
      acoes={<Botao onClick={aoFechar}>Fechar</Botao>}
    >
      <div className="pilha g4">
        {erro && (
          <div className="aviso aviso--critico" role="alert">
            <span aria-hidden="true">⛔</span>
            <div className="crescer">
              <p className="aviso__corpo">{erro}</p>
            </div>
          </div>
        )}

        <div className="pilha g2">
          <p className="rotulo-secao">Perfis atribuídos</p>
          <ul className="mapa-lista" aria-label="Perfis atribuídos">
            {atribuidos.map((id) => {
              const p = base.perfis.find((x) => x.id === id)
              if (!p) return null
              return (
                <li key={id}>
                  <span className="linha entre g2" style={{ padding: 'var(--e2) var(--e3)' }}>
                    <span>
                      <span className="mapa-lista__nome">{p.nome}</span>
                      <span className="mapa-lista__local">{p.permissoes.length} permissão(ões)</span>
                    </span>
                    <Botao
                      pequeno
                      variante="sutil"
                      disabled={ocupado}
                      onClick={() => agir(() => api.revogarPerfil(usuario.id, id), 'Perfil revogado')}
                    >
                      Revogar<span className="so-leitor"> {p.nome}</span>
                    </Botao>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        {disponiveis.length > 0 && (
          <div className="pilha g2">
            <p className="rotulo-secao">Atribuir outro</p>
            <ul className="mapa-lista" aria-label="Perfis disponíveis">
              {disponiveis.map((p) => (
                <li key={p.id}>
                  <span className="linha entre g2" style={{ padding: 'var(--e2) var(--e3)' }}>
                    <span>
                      <span className="mapa-lista__nome">{p.nome}</span>
                      <span className="mapa-lista__local">{p.descricao}</span>
                    </span>
                    <Botao
                      pequeno
                      disabled={ocupado}
                      onClick={() => agir(() => api.atribuirPerfil(usuario.id, p.id), 'Perfil atribuído')}
                    >
                      Atribuir<span className="so-leitor"> {p.nome}</span>
                    </Botao>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialogo>
  )
}

function FormDesativar({
  usuario,
  aoFechar,
  aoConcluir,
}: {
  usuario: Usuario
  aoFechar: () => void
  aoConcluir: () => void
}) {
  const { avisar } = useToast()
  const form = useFormulario({
    inicial: { motivo: '' },
    validar: (v) => (v.motivo.trim().length < 5 ? { motivo: 'Descreva o motivo — a desativação é auditada.' } : {}),
    aoEnviar: (v) => api.desativarUsuario(usuario.id, v.motivo),
    aoConcluir: () => {
      avisar({ tom: 'ok', titulo: 'Usuário desativado', texto: `${usuario.nome} não entra mais; o histórico fica.` })
      aoConcluir()
      aoFechar()
    },
  })

  return (
    <Dialogo
      titulo={`Desativar ${usuario.nome}`}
      descricao="A conta deixa de entrar e o histórico é preservado — a trilha de auditoria referencia o autor, e apagar a conta a deixaria apontando para ninguém."
      largura="estreito"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao onClick={aoFechar}>Cancelar</Botao>
          <Botao variante="perigo" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Desativando…' : 'Desativar'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ motivo: 'Motivo' }}
          refResumo={form.refResumo}
        />
        <Entrada
          rotulo="Motivo"
          dica="Fica registrado na auditoria."
          value={form.valores.motivo}
          onChange={(e) => form.definir('motivo', e.target.value)}
          {...form.campo('motivo')}
        />
      </form>
    </Dialogo>
  )
}
