import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import { custosDoCliente, memoriaDaCompetencia } from '../dados/portal'
import type { ConsumoDoCliente, CustoDaCompetencia } from '../dados/portal'
import { useSessao } from '../lib/contexto'
import { competenciaLonga, data, inteiro, moeda } from '../lib/formato'
import { BarraMedida, Cartao, Chip, EstadoVazio, Metrica, Selecao } from '../componentes/ui/primitivos'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'

/**
 * Consumo e custo, numa tela só.
 *
 * O Anexo L as lista separadas, e aqui elas ficam juntas porque a pergunta do
 * cliente é uma: **quanto vou pagar, e por quê**. Separar obrigaria a ir e vir
 * entre duas telas para responder metade de cada vez.
 *
 * Duas regras moram aqui, e as duas são sobre não enganar:
 *
 * **RN-L33 — a competência aberta é declarada parcial**, com a data da última
 * leitura. O número parcial não é errado; apresentá-lo como fechado é que
 * seria, e o cliente planejaria caixa sobre uma medição que ainda vai crescer.
 *
 * **RN-L32 — o total é o da cobrança emitida**, não um recálculo. Locação mais
 * excedente fecha com ele porque a locação é a decomposição desse mesmo total,
 * e não uma segunda aritmética que daria outro número igualmente defensável.
 */
export function PortalConsumo() {
  const { escopo } = useSessao()
  const base = api.baseSincrona()

  const custos = useMemo(() => (escopo ? custosDoCliente(base, escopo) : []), [base, escopo])
  const [competencia, setCompetencia] = useState<string>(() => custos[0]?.competencia ?? '')

  const memoria = useMemo(
    () => (escopo && competencia ? memoriaDaCompetencia(base, escopo, competencia) : null),
    [base, escopo, competencia],
  )

  if (!escopo) {
    return (
      <EstadoVazio
        glifo="⛔"
        titulo="O portal responde a usuário de cliente"
        texto="Esta sessão é da operação da locadora. As telas equivalentes, sem o recorte, são Faturamento e Contas a receber."
      />
    )
  }

  if (custos.length === 0) {
    return (
      <EstadoVazio
        glifo="◱"
        titulo="Ainda não há medição no seu acesso"
        texto="Assim que a primeira leitura for registrada nas suas unidades, o consumo e o custo da competência aparecem aqui."
      />
    )
  }

  const colunasCusto: Coluna<CustoDaCompetencia>[] = [
    {
      chave: 'competencia',
      titulo: 'Competência',
      identificadora: true,
      ordenarPor: (c) => c.competencia,
      celula: (c) => (
        <>
          {competenciaLonga(c.competencia)}
          {c.parcial && (
            <>
              {' '}
              <Chip severidade="atencao">Parcial</Chip>
            </>
          )}
        </>
      ),
    },
    {
      chave: 'locacao',
      titulo: 'Locação',
      numerico: true,
      ordenarPor: (c) => c.locacao,
      celula: (c) => <span className="dado">{moeda(c.locacao)}</span>,
    },
    {
      chave: 'excedente',
      titulo: 'Excedente',
      numerico: true,
      ordenarPor: (c) => c.excedente,
      celula: (c) => <span className="dado">{moeda(c.excedente)}</span>,
    },
    {
      chave: 'total',
      titulo: 'Total',
      numerico: true,
      ordenarPor: (c) => c.total,
      celula: (c) => <span className="dado">{moeda(c.total)}</span>,
    },
    {
      chave: 'vencimento',
      titulo: 'Vencimento',
      ocultarEmMobile: true,
      ordenarPor: (c) => c.vencimento ?? '',
      celula: (c) =>
        c.vencimento ? (
          data(c.vencimento)
        ) : (
          <span className="texto-atenuado">sem cobrança emitida</span>
        ),
    },
  ]

  const colunasItem: Coluna<ConsumoDoCliente>[] = [
    {
      chave: 'patrimonio',
      titulo: 'Patrimônio',
      identificadora: true,
      ordenarPor: (i) => i.patrimonio,
      celula: (i) => <span className="dado">{i.patrimonio}</span>,
    },
    {
      chave: 'local',
      titulo: 'Unidade',
      ocultarEmMobile: true,
      ordenarPor: (i) => i.localNome ?? '',
      celula: (i) => i.localNome ?? '—',
    },
    {
      chave: 'paginas',
      titulo: 'Páginas',
      numerico: true,
      ordenarPor: (i) => i.paginasMono + i.paginasColor,
      celula: (i) => (
        <span className="dado">
          {inteiro(i.paginasMono + i.paginasColor)}
          {i.paginasColor > 0 && (
            <span className="texto-atenuado"> ({inteiro(i.paginasColor)} cor)</span>
          )}
        </span>
      ),
    },
    {
      chave: 'franquia',
      titulo: 'Uso da franquia',
      ordenarPor: (i) => (i.franquiaMono ? i.paginasMono / i.franquiaMono : -1),
      celula: (i) => {
        if (!i.franquiaMono) return <span className="texto-atenuado">sem franquia</span>
        const uso = i.paginasMono / i.franquiaMono
        return (
          <>
            <BarraMedida
              valor={uso}
              rotuloAcessivel={`${i.patrimonio}: ${Math.round(uso * 100)}% da franquia de ${inteiro(i.franquiaMono)} páginas`}
              cor={uso > 1 ? 'var(--cor-critico)' : uso > 0.8 ? 'var(--cor-atencao)' : 'var(--cor-primary)'}
            />
            <span className="texto-atenuado dado">
              {inteiro(i.paginasMono)} de {inteiro(i.franquiaMono)}
            </span>
          </>
        )
      },
    },
    {
      chave: 'excedente',
      titulo: 'Excedente',
      numerico: true,
      ordenarPor: (i) => i.valorExcedente,
      celula: (i) =>
        i.valorExcedente > 0 ? (
          <span className="dado">{moeda(i.valorExcedente)}</span>
        ) : (
          <span className="texto-atenuado">—</span>
        ),
    },
  ]

  const leitura = memoria?.itens.map((i) => i.ultimaLeituraEm).filter(Boolean).sort().at(-1) ?? null

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Consumo e custos</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Locação mais excedente é o total — e o total é o da cobrança emitida, não um recálculo. Por isso
            o que você vê aqui bate com o boleto que recebeu.
          </p>
        </div>
      </div>

      <Cartao comoRegiao titulo="Histórico por competência">
        <Tabela
          legenda="Custo por competência"
          itens={custos}
          chaveDe={(c) => c.competencia}
          colunas={colunasCusto}
          aoClicarLinha={(c) => setCompetencia(c.competencia)}
          porPagina={12}
        />
      </Cartao>

      <Cartao>
        <div className="filtros">
          <Selecao
            rotulo="Memória de cálculo da competência"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            opcoes={custos.map((c) => ({
              valor: c.competencia,
              texto: competenciaLonga(c.competencia) + (c.parcial ? ' (parcial)' : ''),
            }))}
          />
        </div>

        {!memoria ? (
          <p className="texto-secundario medida-leitura">
            Não há medição em {competenciaLonga(competencia)} nas unidades do seu acesso.
          </p>
        ) : (
          <>
            {/*
              A declaração vem antes dos números, e não depois: quem lê de cima
              para baixo precisa saber que o valor ainda vai mudar **antes** de
              anotá-lo.
            */}
            {memoria.parcial && (
              <p className="medida-leitura" style={{ marginBottom: 'var(--e3)' }}>
                <Chip severidade="atencao">Parcial</Chip>{' '}
                {leitura
                  ? `Competência aberta, com leitura mais recente em ${data(leitura)}.`
                  : 'Competência aberta.'}{' '}
                O valor fecha no fechamento da competência.
              </p>
            )}

            <div className="grade grade--metricas">
              <Cartao compacto>
                <Metrica rotulo="Locação" valor={moeda(memoria.locacao)} contexto="dos equipamentos do período" />
              </Cartao>
              <Cartao compacto>
                <Metrica
                  rotulo="Excedente"
                  valor={moeda(memoria.excedente)}
                  contexto="páginas acima da franquia"
                />
              </Cartao>
              <Cartao compacto>
                <Metrica
                  rotulo="Total"
                  valor={moeda(memoria.total)}
                  contexto={memoria.parcial ? 'parcial — a competência não fechou' : 'igual ao da cobrança emitida'}
                />
              </Cartao>
            </div>

            <Tabela
              legenda={`Consumo por equipamento em ${competenciaLonga(memoria.competencia)}`}
              itens={memoria.itens}
              chaveDe={(i) => `${i.competencia}-${i.equipamentoId}`}
              colunas={colunasItem}
            />
          </>
        )}
      </Cartao>
    </>
  )
}
