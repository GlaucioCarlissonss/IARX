import type { ReactNode } from 'react'
import { Dialogo } from './Dialogo'
import { Botao } from './primitivos'
import type { ResultadoLote } from '../../lib/lote'

/**
 * Barra de ações em lote (Anexo Y §Y.3.4).
 *
 * ## Substitui a barra de ferramentas, não se soma a ela
 *
 * Somar faz a barra crescer para duas linhas e empurra a tabela para baixo
 * justamente quando o olho está nela — e a cada seleção a lista "pula". É o
 * padrão do Gmail e do Shopify Polaris: enquanto há seleção, a área da barra
 * pertence ao lote.
 *
 * Quem decide isso é a tela, que renderiza uma **ou** outra. Este componente
 * não esconde nada sozinho, para que a troca seja visível no código da tela em
 * vez de ser um efeito colateral aqui dentro.
 *
 * ## A contagem é anunciada
 *
 * Marcar uma caixa não move o foco: sem `aria-live`, quem usa leitor de tela
 * marca cinco linhas e não ouve nada mudar. A contagem vive numa região
 * `polite` — `assertive` interromperia a leitura da própria linha que a pessoa
 * acabou de marcar.
 */

interface BarraLoteProps {
  quantidade: number
  /** Singular e plural do que está selecionado: ['equipamento', 'equipamentos']. */
  substantivo: [string, string]
  /**
   * Gênero do substantivo, para o particípio concordar.
   *
   * Sem isto a barra dizia "1 cobrança selecionado". Uma interface que erra a
   * concordância da própria contagem de seleção parece — com razão — um texto
   * montado por concatenação, e quem lê desconfia do resto.
   */
  genero?: 'm' | 'f'
  aoLimpar: () => void
  /** Botões de ação. A tela monta, porque é ela que conhece as permissões. */
  children: ReactNode
  /** Progresso em curso: [feitos, total]. Desabilita as ações. */
  progresso?: [number, number] | null
}

export function BarraLote({
  quantidade,
  substantivo,
  genero = 'm',
  aoLimpar,
  children,
  progresso,
}: BarraLoteProps) {
  const nome = quantidade === 1 ? substantivo[0] : substantivo[1]
  const participio = `selecionad${genero === 'f' ? 'a' : 'o'}${quantidade === 1 ? '' : 's'}`

  return (
    <div className="barra-lote" role="group" aria-label={`Ações para ${quantidade} ${nome}`}>
      <p className="barra-lote__contagem" role="status" aria-live="polite">
        <strong>{quantidade}</strong> {nome} {participio}
      </p>

      <span className="barra-lote__separador" aria-hidden="true" />

      {progresso ? (
        <p className="barra-lote__progresso" role="status" aria-live="polite">
          Processando {progresso[0]} de {progresso[1]}…
        </p>
      ) : (
        <div className="barra-lote__acoes">{children}</div>
      )}

      <button type="button" className="barra-lote__limpar" onClick={aoLimpar} disabled={!!progresso}>
        limpar seleção
      </button>
    </div>
  )
}

/**
 * Confirmação de ação em lote irreversível.
 *
 * Duas obrigações que a confirmação genérica de um registro não tem:
 *
 *  1. **nomear os alvos** — quem confirma precisa ver sobre o que confirma, e
 *     uma lista de dez patrimônios é a única forma de perceber que um deles
 *     entrou por engano;
 *  2. **repetir a contagem no botão** — "Baixar 3 ativos", não "Confirmar".
 *     É o que impede o erro clássico de confirmar um lote diferente do que se
 *     vê na tela de trás.
 */
interface ConfirmaLoteProps {
  titulo: string
  /** O que a ação faz de irreversível, e o que o servidor pode recusar. */
  explicacao: ReactNode
  alvos: { id: string; rotulo: string }[]
  rotuloConfirmar: string
  aoConfirmar: () => void
  aoFechar: () => void
  /** Campos extras — motivo da baixa, filial de destino. */
  children?: ReactNode
  ocupado?: boolean
  /**
   * `perigo` para o que não se desfaz. Bloquear em lote também confirma — pede
   * motivo —, mas confirmar não é o mesmo que avisar de irreversibilidade, e
   * pintar as duas de vermelho gastaria o sinal.
   */
  tom?: 'normal' | 'perigo'
  /** Desabilita o confirmar enquanto um campo obrigatório não está pronto. */
  impedidoDeConfirmar?: string
}

export function ConfirmaLote({
  titulo,
  explicacao,
  alvos,
  rotuloConfirmar,
  aoConfirmar,
  aoFechar,
  children,
  ocupado,
  tom = 'perigo',
  impedidoDeConfirmar,
}: ConfirmaLoteProps) {
  return (
    <Dialogo
      titulo={titulo}
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </Botao>
          <Botao
            variante={tom === 'perigo' ? 'perigo' : 'primario'}
            onClick={aoConfirmar}
            disabled={ocupado || !!impedidoDeConfirmar}
            motivoDesabilitado={impedidoDeConfirmar}
          >
            {rotuloConfirmar}
          </Botao>
        </>
      }
    >
      <div className="pilha g3">
        <p className="texto-secundario medida-leitura">{explicacao}</p>

        <div className="lote-alvos">
          <p className="so-leitor">Registros afetados:</p>
          <ul>
            {alvos.map((a) => (
              <li key={a.id}>{a.rotulo}</li>
            ))}
          </ul>
        </div>

        {children}
      </div>
    </Dialogo>
  )
}

/**
 * Relatório do que o lote fez — e do que não fez.
 *
 * O caso que esta tela existe para cobrir é o parcial: dois baixados, um
 * recusado pelo banco. Um aviso de "ação concluída" mentiria, e um de "falha"
 * mentiria ao contrário. Cada recusa vem com o nome da regra que a produziu,
 * porque é esse nome que liga a mensagem da tela ao gatilho do banco.
 */
export function ResultadoDoLote({
  titulo,
  verbo,
  resultado,
  aoFechar,
  aoSelecionarFalhas,
}: {
  titulo: string
  /** Particípio do que aconteceu com os concluídos: "baixados", "bloqueados". */
  verbo: string
  resultado: ResultadoLote
  aoFechar: () => void
  /** Reseleciona só quem falhou. Ausente, o botão não aparece. */
  aoSelecionarFalhas?: (ids: string[]) => void
}) {
  const falhas = [...resultado.recusados, ...resultado.ignorados]

  return (
    <Dialogo
      titulo={titulo}
      aoFechar={aoFechar}
      largura={falhas.length > 0 ? 'largo' : 'estreito'}
      acoes={
        <>
          {falhas.length > 0 && aoSelecionarFalhas && (
            <Botao
              onClick={() => {
                aoSelecionarFalhas(falhas.map((f) => f.id))
                aoFechar()
              }}
            >
              Selecionar de novo só os que falharam
            </Botao>
          )}
          <Botao variante="primario" onClick={aoFechar}>
            Fechar
          </Botao>
        </>
      }
    >
      <div className="pilha g3">
        <div className="lote-resumo">
          <div className="lote-resumo__caixa lote-resumo__caixa--ok">
            <span className="lote-resumo__n dado">{resultado.concluidos.length}</span>
            <span className="lote-resumo__r">{verbo}</span>
          </div>
          <div className="lote-resumo__caixa lote-resumo__caixa--nao">
            <span className="lote-resumo__n dado">{resultado.recusados.length}</span>
            <span className="lote-resumo__r">recusados por regra</span>
          </div>
          <div className="lote-resumo__caixa">
            <span className="lote-resumo__n dado">{resultado.ignorados.length}</span>
            <span className="lote-resumo__r">não tentados</span>
          </div>
        </div>

        {falhas.length > 0 && (
          <ul className="lote-falhas">
            {falhas.map((f) => (
              <li key={f.id}>
                <span className="lote-falhas__alvo dado">{f.rotulo}</span>
                <span className="lote-falhas__texto">
                  {f.mensagem}
                  {f.codigo && <code className="lote-falhas__codigo">{f.codigo}</code>}
                  {f.acoes && f.acoes.length > 0 && (
                    <span className="lote-falhas__saida">{f.acoes.join(' · ')}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialogo>
  )
}
