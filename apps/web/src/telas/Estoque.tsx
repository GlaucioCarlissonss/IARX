import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import { linhasEstoque } from '../dados/consultas'
import type { LinhaPeca } from '../dados/consultas'
import { useConsulta } from '../lib/useConsulta'
import { useSessao, useToast } from '../lib/contexto'
import { inteiro, moeda } from '../lib/formato'
import { Botao, Carregando, Cartao, Chip, Entrada, Metrica, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'

const SITUACAO: Record<LinhaPeca['situacao'], { rotulo: string; sev: 'disponivel' | 'atencao' | 'critico' }> = {
  ZERADO: { rotulo: 'Zerado', sev: 'critico' },
  ABAIXO_MINIMO: { rotulo: 'Abaixo do mínimo', sev: 'critico' },
  PONTO_PEDIDO: { rotulo: 'Ponto de pedido', sev: 'atencao' },
  NORMAL: { rotulo: 'Normal', sev: 'disponivel' },
}

/**
 * Peças e suprimentos.
 *
 * A ordenação padrão é por impacto, não alfabética: peça que trava chamado
 * aberto aparece primeiro, porque é ela que custa SLA agora.
 */
export function Estoque() {
  const { pode } = useSessao()
  const { avisar } = useToast()
  const { situacao, dado } = useConsulta(() => api.pecas(), [])
  const [texto, setTexto] = useState('')
  const [filtro, setFiltro] = useState('')

  const linhas = useMemo(() => (dado ? linhasEstoque() : []), [dado])

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return linhas.filter((l) => {
      if (filtro === 'reposicao' && l.situacao === 'NORMAL') return false
      if (filtro === 'travando' && l.osImpactadas === 0) return false
      if (filtro && ['CONSUMIVEL', 'COMPONENTE', 'ACESSORIO'].includes(filtro) && l.peca.categoria !== filtro) return false
      if (t) {
        const alvo = `${l.peca.codigo} ${l.peca.descricao} ${l.peca.fornecedor}`.toLowerCase()
        if (!alvo.includes(t)) return false
      }
      return true
    })
  }, [linhas, filtro, texto])

  const valorEstoque = linhas.reduce((a, l) => a + l.peca.saldo * l.peca.custoMedio, 0)
  const emRisco = linhas.filter((l) => l.situacao !== 'NORMAL')
  const travando = linhas.filter((l) => l.osImpactadas > 0)
  const valorSugerido = emRisco.reduce((a, l) => a + l.sugestaoCompra * l.peca.custoMedio, 0)

  const colunas: Coluna<LinhaPeca>[] = [
    {
      chave: 'codigo',
      titulo: 'Peça',
      identificadora: true,
      ordenarPor: (l) => l.peca.codigo,
      celula: (l) => (
        <>
          <span className="dado">{l.peca.codigo}</span>
          <br />
          <span className="texto-atenuado">{l.peca.descricao}</span>
        </>
      ),
    },
    {
      chave: 'situacao',
      titulo: 'Situação',
      ordenarPor: (l) => ({ ZERADO: 0, ABAIXO_MINIMO: 1, PONTO_PEDIDO: 2, NORMAL: 3 })[l.situacao],
      celula: (l) => (
        <>
          <Chip severidade={SITUACAO[l.situacao].sev}>{SITUACAO[l.situacao].rotulo}</Chip>
          {l.osImpactadas > 0 && (
            <>
              <br />
              <span className="texto-atenuado">{l.osImpactadas} chamado(s) parado(s)</span>
            </>
          )}
        </>
      ),
    },
    {
      chave: 'saldo',
      titulo: 'Saldo',
      numerico: true,
      ordenarPor: (l) => l.peca.saldo,
      celula: (l) => (
        <>
          <span className="dado">{inteiro(l.peca.saldo)}</span>
          {l.peca.reservado > 0 && (
            <>
              <br />
              <span className="texto-atenuado">{l.peca.reservado} reservado</span>
            </>
          )}
        </>
      ),
    },
    {
      chave: 'minimo',
      titulo: 'Mínimo / pedido',
      numerico: true,
      ocultarEmMobile: true,
      celula: (l) => (
        <span className="dado">
          {l.peca.estoqueMinimo} / {l.peca.pontoPedido}
        </span>
      ),
    },
    {
      chave: 'cobertura',
      titulo: 'Cobertura',
      numerico: true,
      ordenarPor: (l) => l.cobertura,
      ocultarEmMobile: true,
      celula: (l) => {
        const dias = Math.round(l.cobertura)
        const insuficiente = dias < l.peca.leadTimeDias
        return (
          <span className="dado" style={{ color: insuficiente ? 'var(--cor-critico)' : undefined }}>
            {dias > 900 ? '—' : `${dias} d`}
            <br />
            <span className="texto-atenuado">entrega {l.peca.leadTimeDias} d</span>
          </span>
        )
      },
    },
    {
      chave: 'sugestao',
      titulo: 'Sugestão de compra',
      numerico: true,
      ordenarPor: (l) => l.sugestaoCompra,
      celula: (l) =>
        l.sugestaoCompra > 0 ? (
          <>
            <span className="dado">{inteiro(l.sugestaoCompra)}</span>
            <br />
            <span className="texto-atenuado dado">{moeda(l.sugestaoCompra * l.peca.custoMedio)}</span>
          </>
        ) : (
          <span className="texto-atenuado">—</span>
        ),
    },
  ]

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Peças e suprimentos</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Cobertura compara o saldo disponível com o consumo médio diário. Abaixo do prazo do fornecedor, a
            reposição já está atrasada.
          </p>
        </div>
        {pode('estoque:movimentar') && (
          <Botao
            variante="primario"
            glifo="⇪"
            onClick={() =>
              avisar({
                tom: 'ok',
                titulo: `Sugestão de compra gerada`,
                texto: `${emRisco.length} itens, ${moeda(valorSugerido)} estimados. Pedido segue para aprovação.`,
              })
            }
          >
            Gerar sugestão de compra
          </Botao>
        )}
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica rotulo="Valor em estoque" valor={moeda(valorEstoque)} contexto="custo médio × saldo" />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Itens em risco" valor={String(emRisco.length)} contexto={`de ${linhas.length} itens`} />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Travando chamado" valor={String(travando.length)} contexto="impacto direto em SLA" />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Reposição sugerida" valor={moeda(valorSugerido)} contexto="para voltar ao nível alvo" />
        </Cartao>
      </div>

      <Cartao>
        <div className="filtros">
          <div style={{ minWidth: 220 }}>
            <Entrada
              rotulo="Código, descrição ou fornecedor"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="ex.: toner ou Kyocera"
            />
          </div>
          <Selecao
            rotulo="Recorte"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            opcoes={[
              { valor: '', texto: 'Todos os itens' },
              { valor: 'reposicao', texto: 'Precisam de reposição' },
              { valor: 'travando', texto: 'Travando chamado' },
              { valor: 'CONSUMIVEL', texto: 'Consumíveis' },
              { valor: 'COMPONENTE', texto: 'Componentes' },
              { valor: 'ACESSORIO', texto: 'Acessórios' },
            ]}
          />
        </div>

        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando estoque">
            <Skeleton linhas={8} altura="22px" />
          </Carregando>
        ) : (
          <Tabela
            legenda="Peças com saldo, cobertura e sugestão de reposição"
            colunas={colunas}
            itens={filtradas}
            chaveDe={(l) => l.peca.id}
            ordemInicial={{ chave: 'situacao', direcao: 'asc' }}
            vazio={{
              titulo: 'Nenhuma peça com esses filtros',
              acao: (
                <Botao
                  onClick={() => {
                    setTexto('')
                    setFiltro('')
                  }}
                >
                  Limpar filtros
                </Botao>
              ),
            }}
          />
        )}
      </Cartao>
    </>
  )
}
