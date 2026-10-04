import { useState } from 'react'
import { api } from '../dados/api'
import type { EquipamentoDoCliente } from '../dados/portal'
import { useConsulta } from '../lib/useConsulta'
import { useSessao } from '../lib/contexto'
import {
  Carregando,
  Cartao,
  Chip,
  ErroConsulta,
  EstadoVazio,
  Selecao,
  Skeleton,
} from '../componentes/ui/primitivos'
import { Busca, Filtros } from '../componentes/ui/filtros'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'

/**
 * O parque do cliente.
 *
 * Patrimônio, série, modelo, situação e **onde a máquina está** — e nada mais.
 * Sem valor de aquisição, sem custo de manutenção, sem margem e sem filial: a
 * filial é dimensão do locador, e mostrá-la ao cliente seria expor como a
 * locadora se organiza por dentro sem acrescentar nada a quem aluga.
 *
 * A garantia não é esta tela lembrar de omitir: `equipamentosDoCliente` não tem
 * esses campos para dar.
 */
export function PortalParque() {
  const { escopo } = useSessao()
  const [local, setLocal] = useState('todos')
  const [termo, setTermo] = useState(
    () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('q') ?? '',
  )

  /*
   * Mesma saída que a operação tem: quantos filtros valem, e como desfazê-los.
   * Consistência entre os dois shells é o ponto — quem usa o portal não deveria
   * aprender um padrão diferente para a mesma coisa.
   */
  const filtrosAtivos = (local !== 'todos' ? 1 : 0) + (termo.trim() ? 1 : 0)

  function limparFiltros() {
    setLocal('todos')
    setTermo('')
  }

  const { situacao, dado, erro, recarregar } = useConsulta(
    () =>
      escopo
        ? Promise.all([api.portalEquipamentos(escopo), api.portalUnidades(escopo)]).then(
            ([equipamentos, unidades]) => ({ equipamentos, unidades }),
          )
        : Promise.resolve(null),
    [escopo],
  )

  if (!escopo) {
    return (
      <EstadoVazio
        glifo="⛔"
        titulo="O portal responde a usuário de cliente"
        texto="Esta sessão é da operação da locadora. A tela equivalente, sem o recorte, é Parque instalado."
      />
    )
  }

  if (situacao === 'erro') {
    return (
      <ErroConsulta
        titulo="Não foi possível carregar seus equipamentos"
        erro={erro}
        aoTentarNovamente={recarregar}
      />
    )
  }

  const equipamentos = dado?.equipamentos ?? []
  const unidades = dado?.unidades ?? []
  const t = termo.trim().toLowerCase()
  const filtrados = equipamentos.filter(
    (e) =>
      (local === 'todos' || e.localId === local) &&
      (!t || e.patrimonio.toLowerCase().includes(t) || e.numeroSerie.toLowerCase().includes(t)),
  )

  const colunas: Coluna<EquipamentoDoCliente>[] = [
    {
      chave: 'patrimonio',
      titulo: 'Patrimônio',
      identificadora: true,
      ordenarPor: (e) => e.patrimonio,
      celula: (e) => <span className="dado">{e.patrimonio}</span>,
    },
    {
      chave: 'modelo',
      titulo: 'Modelo',
      ordenarPor: (e) => e.modelo,
      celula: (e) => (
        <>
          {e.modelo}
          <br />
          <span className="texto-atenuado">{e.fabricante}</span>
        </>
      ),
    },
    {
      chave: 'serie',
      titulo: 'Número de série',
      ocultarEmMobile: true,
      ordenarPor: (e) => e.numeroSerie,
      celula: (e) => <span className="dado">{e.numeroSerie}</span>,
    },
    {
      chave: 'local',
      titulo: 'Unidade',
      ordenarPor: (e) => e.localNome ?? '',
      celula: (e) => e.localNome ?? <span className="texto-atenuado">sem unidade definida</span>,
    },
    {
      chave: 'status',
      titulo: 'Situação',
      ordenarPor: (e) => e.status,
      celula: (e) => (
        <Chip severidade={e.status === 'LOCADO' ? 'disponivel' : 'atencao'}>
          {e.status.toLowerCase().replace(/_/g, ' ')}
        </Chip>
      ),
    },
  ]

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Meus equipamentos</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            {situacao === 'carregando'
              ? 'Carregando o parque do seu acesso…'
              : `${equipamentos.length} máquina(s) em ${unidades.length} unidade(s) do seu acesso.`}
          </p>
        </div>
      </div>

      <Cartao>
        <Filtros ativos={filtrosAtivos} aoLimpar={limparFiltros}>
          <Busca
            rotulo="Patrimônio ou série"
            valor={termo}
            aoMudar={setTermo}
            exemplo="Ex.: 004213"
          />
          <Selecao
            rotulo="Unidade"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            opcoes={[
              { valor: 'todos', texto: 'Todas as unidades do meu acesso' },
              ...unidades.map((u) => ({ valor: u.id, texto: u.nome })),
            ]}
          />
        </Filtros>

        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando seus equipamentos">
            <Skeleton linhas={6} altura="22px" />
          </Carregando>
        ) : (
          <Tabela
            legenda="Equipamentos do cliente"
            itens={filtrados}
            chaveDe={(e) => e.id}
            colunas={colunas}
            vazio={{
              titulo: 'Nenhum equipamento com esse filtro',
              texto: 'Limpe a busca ou troque a unidade.',
            }}
          />
        )}
      </Cartao>
    </>
  )
}
