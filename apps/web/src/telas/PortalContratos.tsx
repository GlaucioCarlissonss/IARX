import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import { contratosDoCliente } from '../dados/portal'
import type { ContratoDoCliente } from '../dados/portal'
import { useSessao } from '../lib/contexto'
import { data, inteiro, moeda } from '../lib/formato'
import { Cartao, Chip, EstadoVazio, Selecao } from '../componentes/ui/primitivos'
import { Filtros } from '../componentes/ui/filtros'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'

/**
 * Os contratos do cliente, com os equipamentos de cada um.
 *
 * O valor mensal é **o que o cliente paga**, somado dos itens que ele alcança —
 * não o custo do locador e não a margem. Para o gestor de uma unidade o
 * contrato aparece com os itens dessa unidade e com o valor desses itens: o
 * contrato é o documento que a empresa dele assinou, e esconder o documento
 * inteiro seria esconder o que ele tem direito de conferir; mostrar os itens de
 * outra unidade seria mostrar parque alheio.
 */
export function PortalContratos() {
  const { escopo } = useSessao()
  const base = api.baseSincrona()
  const [aberto, setAberto] = useState<string | null>(null)
  const [status, setStatus] = useState('todos')

  const contratos = useMemo(
    () => (escopo ? contratosDoCliente(base, escopo) : []),
    [base, escopo],
  )

  if (!escopo) {
    return (
      <EstadoVazio
        glifo="⛔"
        titulo="O portal responde a usuário de cliente"
        texto="Esta sessão é da operação da locadora. A tela equivalente, sem o recorte, é Contratos."
      />
    )
  }

  const filtrados = contratos.filter((c) => status === 'todos' || c.status === status)
  const detalhe = contratos.find((c) => c.id === aberto) ?? null

  const colunas: Coluna<ContratoDoCliente>[] = [
    {
      chave: 'numero',
      titulo: 'Contrato',
      identificadora: true,
      ordenarPor: (c) => c.numero,
      celula: (c) => <span className="dado">{c.numero}</span>,
    },
    {
      chave: 'status',
      titulo: 'Situação',
      ordenarPor: (c) => c.status,
      celula: (c) => (
        <Chip severidade={c.status === 'ATIVO' ? 'disponivel' : c.status === 'ENCERRADO' ? 'inativo' : 'atencao'}>
          {c.status.toLowerCase().replace(/_/g, ' ')}
        </Chip>
      ),
    },
    {
      chave: 'vigencia',
      titulo: 'Vigência',
      ocultarEmMobile: true,
      ordenarPor: (c) => c.dataFim,
      celula: (c) => `${data(c.dataInicio)} a ${data(c.dataFim)}`,
    },
    {
      chave: 'itens',
      titulo: 'Equipamentos',
      numerico: true,
      ordenarPor: (c) => c.itens,
      celula: (c) => <span className="dado">{inteiro(c.itens)}</span>,
    },
    {
      chave: 'valor',
      titulo: 'Mensalidade',
      numerico: true,
      ordenarPor: (c) => c.valorMensal,
      celula: (c) => <span className="dado">{moeda(c.valorMensal)}</span>,
    },
  ]

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Meus contratos</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            A mensalidade é a soma dos equipamentos que você alcança. Abrir um contrato mostra qual máquina
            está em qual unidade, com a franquia contratada de cada uma.
          </p>
        </div>
      </div>

      <Cartao>
        <Filtros>
          <Selecao
            rotulo="Situação"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            opcoes={[
              { valor: 'todos', texto: 'Todas as situações' },
              ...[...new Set(contratos.map((c) => c.status))].map((s) => ({
                valor: s,
                texto: s.toLowerCase().replace(/_/g, ' '),
              })),
            ]}
          />
        </Filtros>

        <Tabela
          legenda="Contratos do cliente"
          itens={filtrados}
          chaveDe={(c) => c.id}
          colunas={colunas}
          aoClicarLinha={(c) => setAberto(c.id === aberto ? null : c.id)}
          vazio={{
            titulo: 'Nenhum contrato nesta situação',
            texto: 'Troque o filtro de situação para ver os demais.',
          }}
        />
      </Cartao>

      {detalhe && (
        <Cartao comoRegiao titulo={`Equipamentos do contrato ${detalhe.numero}`}>
          {detalhe.itensDetalhados.length === 0 ? (
            <p className="texto-secundario medida-leitura">
              Nenhum equipamento deste contrato está nas unidades do seu acesso.
            </p>
          ) : (
            <Tabela
              legenda={`Itens do contrato ${detalhe.numero}`}
              itens={detalhe.itensDetalhados}
              chaveDe={(i) => i.id}
              porPagina={0}
              colunas={[
                {
                  chave: 'patrimonio',
                  titulo: 'Patrimônio',
                  identificadora: true,
                  celula: (i) => <span className="dado">{i.patrimonio}</span>,
                },
                { chave: 'modelo', titulo: 'Modelo', celula: (i) => i.modelo },
                {
                  chave: 'local',
                  titulo: 'Unidade',
                  celula: (i) => i.localNome ?? '—',
                },
                {
                  chave: 'franquia',
                  titulo: 'Franquia',
                  numerico: true,
                  ocultarEmMobile: true,
                  celula: (i) =>
                    i.franquiaMono === null ? (
                      <span className="texto-atenuado">sem franquia</span>
                    ) : (
                      <span className="dado">{inteiro(i.franquiaMono)} pág.</span>
                    ),
                },
                {
                  chave: 'excedente',
                  titulo: 'Página excedente',
                  numerico: true,
                  ocultarEmMobile: true,
                  celula: (i) =>
                    i.precoExcedenteMono === null ? (
                      <span className="texto-atenuado">—</span>
                    ) : (
                      <span className="dado">{moeda(i.precoExcedenteMono)}</span>
                    ),
                },
                {
                  chave: 'valor',
                  titulo: 'Mensal',
                  numerico: true,
                  celula: (i) => <span className="dado">{moeda(i.valorMensal)}</span>,
                },
              ]}
            />
          )}
        </Cartao>
      )}
    </>
  )
}
