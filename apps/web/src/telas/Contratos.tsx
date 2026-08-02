import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../dados/api'
import { filialPorId } from '../dados/catalogo'
import { HOJE } from '../dados/gerar'
import { useConsulta } from '../lib/useConsulta'
import { useSessao } from '../lib/contexto'
import { data, moeda, moedaCompacta } from '../lib/formato'
import { Botao, Carregando, Cartao, Chip, Entrada, Metrica, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { Tabela } from '../componentes/ui/Tabela'
import type { Coluna } from '../componentes/ui/Tabela'
import type { Contrato, ContratoStatus } from '../dados/tipos'
import { FormContrato } from '../componentes/formularios/FormContrato'
import { FormAlocarEquipamento } from '../componentes/formularios/FormAlocarEquipamento'
import { FormTransicaoContrato } from '../componentes/formularios/FormTransicaoContrato'
import { FormAnexos } from '../componentes/formularios/FormAnexos'

type Aberto =
  | { tipo: 'novo' }
  | { tipo: 'alocar'; contrato: Contrato }
  | { tipo: 'transicao'; contrato: Contrato; destino: ContratoStatus }
  | { tipo: 'anexos'; contrato: Contrato }
  | null

/**
 * Próximo passo natural de cada estado, para o botão principal da linha.
 * O fluxo tem uma ordem esperada; oferecer todas as transições em cada linha
 * transformaria a tabela numa lista de opções onde a certa some no meio.
 */
const PROXIMO: Partial<Record<ContratoStatus, { destino: ContratoStatus; rotulo: string }>> = {
  RASCUNHO: { destino: 'EM_APROVACAO', rotulo: 'Submeter' },
  EM_APROVACAO: { destino: 'AGUARDANDO_ASSINATURA', rotulo: 'Aprovar' },
  AGUARDANDO_ASSINATURA: { destino: 'ATIVO', rotulo: 'Ativar' },
  VENCIDO_EM_CAMPO: { destino: 'EM_RENOVACAO', rotulo: 'Renovar' },
  SUSPENSO: { destino: 'ATIVO', rotulo: 'Retomar' },
}

const STATUS: Record<ContratoStatus, { rotulo: string; sev: 'disponivel' | 'uso' | 'atencao' | 'critico' | 'inativo' }> = {
  RASCUNHO: { rotulo: 'Rascunho', sev: 'inativo' },
  EM_APROVACAO: { rotulo: 'Em aprovação', sev: 'atencao' },
  AGUARDANDO_ASSINATURA: { rotulo: 'Aguardando assinatura', sev: 'atencao' },
  ATIVO: { rotulo: 'Ativo', sev: 'uso' },
  SUSPENSO: { rotulo: 'Suspenso', sev: 'atencao' },
  EM_RENOVACAO: { rotulo: 'Em renovação', sev: 'atencao' },
  VENCIDO_EM_CAMPO: { rotulo: 'Vencido em campo', sev: 'critico' },
  ENCERRADO: { rotulo: 'Encerrado', sev: 'inativo' },
  DISTRATADO: { rotulo: 'Distratado', sev: 'inativo' },
}

interface LinhaContrato {
  contrato: Contrato
  clienteNome: string
  itens: number
  mrr: number
  diasParaVencer: number
}

/**
 * Contratos.
 *
 * O recorte que importa não é "todos os contratos", é "os que exigem decisão":
 * vencendo, vencidos em campo, em renovação. O filtro padrão reflete isso.
 */
export function Contratos() {
  const [params] = useSearchParams()
  const { pode, filialId } = useSessao()
  const { situacao, dado } = useConsulta(() => api.contratos(), [])
  const [texto, setTexto] = useState(params.get('q') ?? '')
  const [recorte, setRecorte] = useState(params.get('situacao') ?? '')
  const [aberto, setAberto] = useState<Aberto>(null)

  const base = api.baseSincrona()

  const linhas = useMemo<LinhaContrato[]>(() => {
    if (!dado) return []
    return dado.map((c) => ({
      contrato: c,
      clienteNome: base.clientes.find((x) => x.id === c.clienteId)?.nomeFantasia ?? '—',
      itens: c.itens.length,
      mrr: c.itens.reduce((a, i) => a + i.valorMensal, 0),
      diasParaVencer: Math.round((new Date(c.dataFim).getTime() - HOJE.getTime()) / 86400000),
    }))
  }, [dado, base])

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return linhas.filter((l) => {
      if (filialId !== 'todas' && l.contrato.filialId !== filialId) return false
      if (recorte === 'vencendo' && !(l.diasParaVencer >= 0 && l.diasParaVencer <= 90)) return false
      if (recorte === 'vencidos' && l.contrato.status !== 'VENCIDO_EM_CAMPO') return false
      if (recorte === 'renovacao' && l.contrato.status !== 'EM_RENOVACAO') return false
      if (recorte === 'ativos' && l.contrato.status !== 'ATIVO') return false
      if (recorte === 'encerrados' && l.contrato.status !== 'ENCERRADO') return false
      if (t) {
        const alvo = `${l.contrato.numero} ${l.clienteNome}`.toLowerCase()
        if (!alvo.includes(t)) return false
      }
      return true
    })
  }, [linhas, recorte, texto, filialId])

  const vencidosEmCampo = linhas.filter((l) => l.contrato.status === 'VENCIDO_EM_CAMPO')
  const vencendo = linhas.filter((l) => l.diasParaVencer >= 0 && l.diasParaVencer <= 90 && l.contrato.status !== 'ENCERRADO')
  const mrrTotal = linhas
    .filter((l) => ['ATIVO', 'EM_RENOVACAO', 'VENCIDO_EM_CAMPO'].includes(l.contrato.status))
    .reduce((a, l) => a + l.mrr, 0)

  // Contagem de anexos na própria linha: sem ela, descobrir se o contrato tem
  // documento exige abrir o diálogo de cada um.
  const contarAnexos = (contratoId: string) =>
    base.anexos.filter((a) => a.entidade === 'CONTRATO' && a.entidadeId === contratoId).length

  const colunas: Coluna<LinhaContrato>[] = [
    {
      chave: 'numero',
      titulo: 'Contrato',
      identificadora: true,
      ordenarPor: (l) => l.contrato.numero,
      celula: (l) => (
        <>
          <span className="dado">{l.contrato.numero}</span>
          <br />
          <span className="texto-atenuado">{filialPorId.get(l.contrato.filialId)?.codigo}</span>
        </>
      ),
    },
    { chave: 'cliente', titulo: 'Cliente', ordenarPor: (l) => l.clienteNome, celula: (l) => l.clienteNome },
    {
      chave: 'status',
      titulo: 'Situação',
      ordenarPor: (l) => l.contrato.status,
      celula: (l) => <Chip severidade={STATUS[l.contrato.status].sev}>{STATUS[l.contrato.status].rotulo}</Chip>,
    },
    {
      chave: 'vigencia',
      titulo: 'Vigência',
      ordenarPor: (l) => l.contrato.dataFim,
      ocultarEmMobile: true,
      celula: (l) => (
        <>
          <span className="dado">
            {data(l.contrato.dataInicio)} — {data(l.contrato.dataFim)}
          </span>
          <br />
          <span className="texto-atenuado">
            {l.diasParaVencer < 0
              ? `vencido há ${Math.abs(l.diasParaVencer)} dias`
              : `vence em ${l.diasParaVencer} dias`}
          </span>
        </>
      ),
    },
    {
      chave: 'itens',
      titulo: 'Equipamentos',
      numerico: true,
      ordenarPor: (l) => l.itens,
      celula: (l) => <span className="dado">{l.itens}</span>,
    },
    {
      chave: 'mrr',
      titulo: 'Recorrente mensal',
      numerico: true,
      ordenarPor: (l) => l.mrr,
      celula: (l) => <span className="dado">{moeda(l.mrr)}</span>,
    },
    {
      chave: 'reajuste',
      titulo: 'Índice',
      ocultarEmMobile: true,
      celula: (l) => <span className="texto-atenuado">{l.contrato.indiceReajuste}</span>,
    },
    {
      chave: 'acoes',
      titulo: 'Ações',
      celula: (l) => {
        const proximo = PROXIMO[l.contrato.status]
        const aceitaItem = ['RASCUNHO', 'EM_APROVACAO', 'AGUARDANDO_ASSINATURA', 'ATIVO', 'EM_RENOVACAO'].includes(
          l.contrato.status,
        )
        return (
          <div className="linha g2 envolver">
            {pode('contrato:criar') && (
              <Botao
                pequeno
                disabled={!aceitaItem}
                motivoDesabilitado={`Contrato em ${l.contrato.status.toLowerCase()} não recebe novos itens`}
                onClick={() => setAberto({ tipo: 'alocar', contrato: l.contrato })}
              >
                Alocar<span className="so-leitor"> equipamento no contrato {l.contrato.numero}</span>
              </Botao>
            )}
            <Botao pequeno onClick={() => setAberto({ tipo: 'anexos', contrato: l.contrato })}>
              Anexos
              {contarAnexos(l.contrato.id) > 0 && (
                <span className="distintivo">{contarAnexos(l.contrato.id)}</span>
              )}
              <span className="so-leitor"> do contrato {l.contrato.numero}</span>
            </Botao>
            {proximo && pode('contrato:aprovar') && (
              <Botao
                pequeno
                variante="primario"
                onClick={() => setAberto({ tipo: 'transicao', contrato: l.contrato, destino: proximo.destino })}
              >
                {proximo.rotulo}
                <span className="so-leitor"> contrato {l.contrato.numero}</span>
              </Botao>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Contratos</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Impressão e parque de TI podem ter contratos separados para o mesmo cliente, como é usual no setor.
          </p>
        </div>
        {pode('contrato:criar') && (
          <Botao variante="primario" glifo="＋" onClick={() => setAberto({ tipo: 'novo' })}>
            Novo contrato
          </Botao>
        )}
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica rotulo="Recorrente contratado" valor={moedaCompacta(mrrTotal)} contexto={moeda(mrrTotal)} />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Vencem em 90 dias" valor={String(vencendo.length)} contexto="janela de renovação" />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="Vencidos em campo" valor={String(vencidosEmCampo.length)} contexto="equipamento ainda no cliente" />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Receita em risco"
            valor={moedaCompacta(vencidosEmCampo.reduce((a, l) => a + l.mrr, 0))}
            contexto="contratos vencidos sem renovação"
          />
        </Cartao>
      </div>

      {vencidosEmCampo.length > 0 && recorte !== 'vencidos' && (
        <div className="aviso aviso--critico">
          <span aria-hidden="true">⛔</span>
          <div className="crescer">
            <p className="aviso__titulo">
              {vencidosEmCampo.length} contratos com vigência expirada e equipamento em posse do cliente
            </p>
            <p className="aviso__corpo">
              A cobrança segue ativa, mas sem amparo contratual. Renovar ou programar retirada resolve.
            </p>
            <p style={{ marginTop: 'var(--e3)' }}>
              <Botao pequeno onClick={() => setRecorte('vencidos')}>
                Ver apenas esses contratos
              </Botao>
            </p>
          </div>
        </div>
      )}

      <Cartao>
        <div className="filtros">
          <div style={{ minWidth: 220 }}>
            <Entrada
              rotulo="Número do contrato ou cliente"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="ex.: SP-2025 ou Andirá"
            />
          </div>
          <Selecao
            rotulo="Recorte"
            value={recorte}
            onChange={(e) => setRecorte(e.target.value)}
            opcoes={[
              { valor: '', texto: 'Todos' },
              { valor: 'vencendo', texto: 'Vencem em 90 dias' },
              { valor: 'vencidos', texto: 'Vencidos em campo' },
              { valor: 'renovacao', texto: 'Em renovação' },
              { valor: 'ativos', texto: 'Ativos' },
              { valor: 'encerrados', texto: 'Encerrados' },
            ]}
          />
        </div>

        {situacao === 'carregando' ? (
          <Carregando rotulo="Carregando contratos">
            <Skeleton linhas={8} altura="22px" />
          </Carregando>
        ) : (
          <Tabela
            legenda="Contratos com vigência, equipamentos vinculados e valor recorrente"
            colunas={colunas}
            itens={filtradas}
            chaveDe={(l) => l.contrato.id}
            ordemInicial={{ chave: 'vigencia', direcao: 'asc' }}
            vazio={{
              titulo: 'Nenhum contrato com esses filtros',
              acao: (
                <Botao
                  onClick={() => {
                    setTexto('')
                    setRecorte('')
                  }}
                >
                  Limpar filtros
                </Botao>
              ),
            }}
          />
        )}
      </Cartao>

      {aberto?.tipo === 'novo' && <FormContrato aoFechar={() => setAberto(null)} />}
      {aberto?.tipo === 'alocar' && (
        <FormAlocarEquipamento contrato={aberto.contrato} aoFechar={() => setAberto(null)} />
      )}
      {aberto?.tipo === 'anexos' && (
        <FormAnexos
          entidade="CONTRATO"
          entidadeId={aberto.contrato.id}
          titulo={aberto.contrato.numero}
          aoFechar={() => setAberto(null)}
        />
      )}
      {aberto?.tipo === 'transicao' && (
        <FormTransicaoContrato
          contrato={aberto.contrato}
          destino={aberto.destino}
          aoFechar={() => setAberto(null)}
        />
      )}
    </>
  )
}
