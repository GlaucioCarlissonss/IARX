import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import { nivelDoCentro } from '../dados/comandos'
import { useConsulta } from '../lib/useConsulta'
import { useFormulario } from '../lib/useFormulario'
import { useSessao, useToast } from '../lib/contexto'
import {
  Aviso,
  Botao,
  Carregando,
  Cartao,
  Chip,
  Entrada,
  Metrica,
  Selecao,
  Skeleton,
} from '../componentes/ui/primitivos'
import { Dialogo } from '../componentes/ui/Dialogo'
import { AreaTexto, ResumoErros } from '../componentes/ui/formulario'
import type { CentroCusto } from '../dados/tipos'

/**
 * Centros de custo.
 *
 * A tela é uma árvore, e não uma tabela, porque a pergunta que ela responde é
 * hierárquica: "quanto custa a operação" só faz sentido se "campo" e "logística"
 * estiverem visivelmente dentro dela. Uma tabela plana com uma coluna "pai"
 * obrigaria quem lê a montar a árvore de cabeça.
 *
 * Três níveis é o limite, imposto pelo banco (RN-L42). A tela **desabilita** o
 * botão de subcentro no terceiro nível em vez de deixar tentar e recusar: o
 * limite é estrutural e conhecido antes do clique, e uma recusa que se pode
 * antecipar é uma recusa que não deveria acontecer.
 */
export function CentrosCusto() {
  const { pode } = useSessao()
  const { avisar } = useToast()
  const { situacao, dado, recarregar } = useConsulta(() => api.centrosCusto(), [])
  const [aberto, setAberto] = useState<
    { tipo: 'novo'; paiId: string | null } | { tipo: 'editar'; centro: CentroCusto } | null
  >(null)
  const [erro, setErro] = useState<string | null>(null)

  const base = api.baseSincrona()
  const centros = dado ?? []

  /** Achata a árvore na ordem de exibição, com o nível de cada nó. */
  const linhas = useMemo(() => {
    const saida: { centro: CentroCusto; nivel: number }[] = []
    const descer = (paiId: string | null, nivel: number) => {
      for (const c of centros.filter((x) => x.centroPaiId === paiId)) {
        saida.push({ centro: c, nivel })
        descer(c.id, nivel + 1)
      }
    }
    descer(null, 1)
    return saida
  }, [centros])

  const ativos = centros.filter((c) => c.ativo).length

  async function alternarAtivo(c: CentroCusto) {
    setErro(null)
    const r = await api.definirAtivoCentro(c.id, !c.ativo)
    if (r.ok) {
      recarregar()
      avisar({
        tom: 'ok',
        titulo: c.ativo ? 'Centro inativado' : 'Centro reativado',
        texto: `${c.codigo} — ${c.nome}`,
      })
    } else {
      setErro([r.erro.mensagem, ...(r.erro.acoes ?? [])].join(' '))
    }
  }

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Centros de custo</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            A dimensão de análise da despesa e da receita, por área. Filial é uma dimensão só, e duas equipes
            na mesma filial não se distinguem por ela.
          </p>
        </div>
        {pode('centro_custo:gerenciar') && (
          <Botao variante="primario" glifo="+" onClick={() => setAberto({ tipo: 'novo', paiId: null })}>
            Novo centro
          </Botao>
        )}
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica rotulo="Centros" valor={String(centros.length)} contexto="no ambiente" />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Ativos" valor={String(ativos)} contexto="disponíveis para lançamento" />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Raízes"
            valor={String(centros.filter((c) => !c.centroPaiId).length)}
            contexto="grandes áreas"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Profundidade" valor="3" contexto="níveis, o máximo" />
        </Cartao>
      </div>

      {erro && (
        <Aviso tom="critico" titulo="Não foi possível concluir">
          {erro}
        </Aviso>
      )}

      <Cartao titulo={`Árvore (${centros.length})`}>
        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando centros de custo">
            <Skeleton linhas={8} altura="24px" />
          </Carregando>
        ) : (
          <ul className="arvore-custo" aria-label="Centros de custo">
            {linhas.map(({ centro, nivel }) => (
              <li key={centro.id} className={`arvore-custo__no arvore-custo__no--n${nivel}`}>
                <div className="arvore-custo__linha">
                  <span className="arvore-custo__identidade">
                    <code className="dado">{centro.codigo}</code>
                    <span className="arvore-custo__nome">{centro.nome}</span>
                    <Chip severidade={centro.ativo ? 'disponivel' : 'inativo'}>
                      {centro.ativo ? 'Ativo' : 'Inativo'}
                    </Chip>
                    {/* O nível é anunciado sempre e **exibido** nas telas
                        estreitas, onde a indentação não cabe. Sem ele, remover
                        o recuo em 320px apagaria a hierarquia para quem vê. */}
                    <span className="arvore-custo__nivel">nível {nivel}</span>
                  </span>

                  {centro.descricao && <p className="arvore-custo__descricao">{centro.descricao}</p>}

                  {pode('centro_custo:gerenciar') && (
                    <span className="linha g2">
                      <Botao
                        pequeno
                        disabled={nivel >= 3}
                        motivoDesabilitado="Terceiro nível é o máximo da árvore"
                        onClick={() => setAberto({ tipo: 'novo', paiId: centro.id })}
                      >
                        Subcentro<span className="so-leitor"> de {centro.nome}</span>
                      </Botao>
                      <Botao pequeno variante="sutil" onClick={() => setAberto({ tipo: 'editar', centro })}>
                        Editar<span className="so-leitor"> {centro.nome}</span>
                      </Botao>
                      <Botao pequeno variante="sutil" onClick={() => alternarAtivo(centro)}>
                        {centro.ativo ? 'Inativar' : 'Reativar'}
                        <span className="so-leitor"> {centro.nome}</span>
                      </Botao>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      {aberto && (
        <DialogoCentro
          aberto={aberto}
          centros={centros}
          nivelDe={(id) => nivelDoCentro(base, id)}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({ tom: 'ok', titulo: 'Centro de custo salvo' })
          }}
        />
      )}
    </>
  )
}

interface DialogoCentroProps {
  aberto: { tipo: 'novo'; paiId: string | null } | { tipo: 'editar'; centro: CentroCusto }
  centros: CentroCusto[]
  nivelDe: (id: string) => number
  aoFechar: () => void
  aoSalvar: () => void
}

function DialogoCentro({ aberto, centros, nivelDe, aoFechar, aoSalvar }: DialogoCentroProps) {
  const editando = aberto.tipo === 'editar'
  const centro = editando ? aberto.centro : null

  const form = useFormulario({
    inicial: {
      codigo: centro?.codigo ?? '',
      nome: centro?.nome ?? '',
      descricao: centro?.descricao ?? '',
      centroPaiId: centro?.centroPaiId ?? (aberto.tipo === 'novo' ? (aberto.paiId ?? '') : ''),
    },
    validar: (v) => ({
      codigo: v.codigo.trim().length < 2 ? 'Informe o código.' : undefined,
      nome: v.nome.trim().length < 3 ? 'Informe o nome.' : undefined,
    }),
    aoEnviar: (v) =>
      api.salvarCentroCusto(centro?.id ?? null, {
        codigo: v.codigo,
        nome: v.nome,
        descricao: v.descricao,
        centroPaiId: v.centroPaiId || null,
      }),
    aoConcluir: aoSalvar,
  })

  /*
   * Só aparecem como pai os centros que ainda cabem um filho.
   *
   * Um seletor que oferecesse um nó de terceiro nível deixaria o operador
   * escolher e só descobrir a recusa depois de salvar. E, ao editar, o próprio
   * centro e seus descendentes ficam fora — escolhê-los criaria o ciclo.
   */
  const possiveisPais = useMemo(() => {
    const descendentes = new Set<string>()
    if (centro) {
      const marcar = (id: string) => {
        descendentes.add(id)
        for (const f of centros.filter((c) => c.centroPaiId === id)) marcar(f.id)
      }
      marcar(centro.id)
    }
    return centros.filter((c) => c.ativo && !descendentes.has(c.id) && nivelDe(c.id) < 3)
  }, [centros, centro, nivelDe])

  return (
    <Dialogo
      titulo={editando ? `Editar ${centro!.codigo}` : 'Novo centro de custo'}
      descricao="O código aparece no rateio e nos relatórios — curto e estável é melhor que descritivo."
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Salvando…' : 'Salvar'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ codigo: 'Código', nome: 'Nome', centroPaiId: 'Centro pai' }}
          refResumo={form.refResumo}
        />

        <div className="pilha g3">
          <Entrada
            rotulo="Código"
            nome="codigo"
            dica="Sem espaços. Vira maiúsculo automaticamente."
            value={form.valores.codigo}
            onChange={(e) => form.definir('codigo', e.target.value.toUpperCase())}
            {...form.campo('codigo')}
          />
          <Entrada
            rotulo="Nome"
            nome="nome"
            value={form.valores.nome}
            onChange={(e) => form.definir('nome', e.target.value)}
            {...form.campo('nome')}
          />
          <Selecao
            rotulo="Centro pai"
            nome="centroPaiId"
            dica="Vazio cria na raiz. Só aparecem centros que ainda cabem um filho."
            value={form.valores.centroPaiId}
            onChange={(e) => form.definir('centroPaiId', e.target.value)}
            opcoes={[
              { valor: '', texto: 'Nenhum — centro de primeiro nível' },
              ...possiveisPais.map((c) => ({ valor: c.id, texto: `${c.codigo} — ${c.nome}` })),
            ]}
            {...form.campo('centroPaiId')}
          />
          <AreaTexto
            rotulo="Descrição"
            nome="descricao"
            dica="Para que serve este centro. Quem escolhe um centro seis meses depois lê isto."
            value={form.valores.descricao}
            onChange={(e) => form.definir('descricao', e.target.value)}
          />
        </div>
      </form>
    </Dialogo>
  )
}
