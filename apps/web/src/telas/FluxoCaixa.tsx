import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import {
  alertasDeCaixa,
  cenarioPadrao,
  JANELAS_CAIXA,
  projetarCaixa,
} from '../dados/comandos'
import { useConsulta } from '../lib/useConsulta'
import { data, moeda } from '../lib/formato'
import { Aviso, Botao, Cartao, Chip, Metrica, Selecao, Skeleton } from '../componentes/ui/primitivos'
import { ProjecaoCaixa } from '../componentes/ui/graficos'
import { Tabela, type Coluna } from '../componentes/ui/Tabela'
import type { AlertaCaixa } from '../dados/tipos'

/**
 * Fluxo de caixa projetado — Módulo 13.
 *
 * A tela da **leitura**: o saldo real das contas somado ao previsto — títulos a
 * pagar e a receber em aberto, e os lançamentos futuros ainda programados.
 *
 * Quatro decisões que vale registrar:
 *
 *  1. **Nada aqui é guardado.** A projeção é recalculada a cada abertura, e é o
 *     que faz o número estar certo depois da baixa registrada há um minuto. Uma
 *     tabela de posição diária estaria desatualizada no instante seguinte.
 *  2. **A janela começa hoje, sempre.** Projetar o passado não quer dizer nada: o
 *     passado tem extrato. Daí as janelas fixas de 30/60/90/180 dias em vez de
 *     duas datas livres.
 *  3. **O cenário reduz só a entrada** (RN-F20). A tela diz isso em texto, porque
 *     é a pergunta que alguém faz ao ver o pessimista: se a dívida também caísse,
 *     o teste de estresse deixaria a operação mais otimista sobre si mesma.
 *  4. **Os alertas usam o cenário padrão, não o selecionado.** Trocar o cenário
 *     muda o gráfico e não muda os alertas — de propósito: um alarme que muda de
 *     critério conforme quem abriu a tela soa para uma pessoa e não para outra no
 *     mesmo dia.
 */

const ROTULO_ALERTA: Record<AlertaCaixa['tipo'], string> = {
  SALDO_NEGATIVO: 'saldo negativo',
  CONCENTRACAO_SAIDA: 'concentração de saída',
}

export function FluxoCaixa() {
  const { situacao, dado } = useConsulta(() => api.cenariosCaixa(), [])
  const [dias, setDias] = useState<number>(90)
  const [cenarioId, setCenarioId] = useState<string>('')
  const [contaId, setContaId] = useState<string>('')
  const [filialId, setFilialId] = useState<string>('')

  const base = api.baseSincrona()
  const cenarios = dado ?? []
  const padrao = cenarioPadrao(base)

  const projecao = useMemo(
    () =>
      projetarCaixa(base, {
        dias,
        cenarioId: cenarioId || null,
        contaId: contaId || null,
        filialId: filialId || null,
      }),
    [base, dias, cenarioId, contaId, filialId],
  )

  /*
   * Os alertas não recebem o cenário selecionado, e não é esquecimento.
   *
   * Eles saem do cenário padrão — a referência que o próprio locatário declarou.
   * Ligá-los ao seletor faria o alarme depender de quem abriu a tela: quem
   * estivesse olhando o pessimista veria alertas que o colega ao lado não vê.
   */
  const alertas = useMemo(() => alertasDeCaixa(base, dias), [base, dias])
  const negativos = alertas.filter((a) => a.tipo === 'SALDO_NEGATIVO')
  const concentracoes = alertas.filter((a) => a.tipo === 'CONCENTRACAO_SAIDA')

  const colunas: Coluna<AlertaCaixa>[] = [
    {
      chave: 'dia',
      titulo: 'Dia',
      identificadora: true,
      ordenarPor: (a) => a.dia,
      celula: (a) => data(a.dia),
    },
    {
      chave: 'tipo',
      titulo: 'Alerta',
      ordenarPor: (a) => a.tipo,
      celula: (a) => (
        <Chip severidade={a.tipo === 'SALDO_NEGATIVO' ? 'critico' : 'atencao'}>
          {ROTULO_ALERTA[a.tipo]}
        </Chip>
      ),
    },
    {
      chave: 'valor',
      titulo: 'Valor',
      numerico: true,
      ordenarPor: (a) => a.valor,
      celula: (a) => moeda(a.valor),
    },
    { chave: 'detalhe', titulo: 'O que aconteceu', celula: (a) => a.detalhe },
  ]

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Fluxo de caixa projetado</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            O saldo real das contas somado ao que está previsto: títulos em aberto e compromissos
            programados. Recalculado a cada abertura — nenhuma posição diária fica guardada, porque a de
            amanhã muda a cada baixa de hoje.
          </p>
        </div>
      </div>

      <div className="filtros">
        <Selecao
          rotulo="Janela"
          value={String(dias)}
          onChange={(e) => setDias(Number(e.target.value))}
          dica="Sempre a partir de hoje: o passado tem extrato, não projeção."
          opcoes={JANELAS_CAIXA.map((d) => ({ valor: String(d), texto: `${d} dias` }))}
        />
        <Selecao
          rotulo="Cenário"
          value={cenarioId}
          onChange={(e) => setCenarioId(e.target.value)}
          opcoes={[
            { valor: '', texto: padrao ? `${padrao.nome} (padrão)` : 'Sem cenário' },
            ...cenarios.filter((c) => !c.padrao).map((c) => ({ valor: c.id, texto: c.nome })),
          ]}
        />
        <Selecao
          rotulo="Conta"
          value={contaId}
          onChange={(e) => setContaId(e.target.value)}
          opcoes={[
            { valor: '', texto: 'Todas as contas' },
            ...base.contasBancarias
              .filter((c) => c.status !== 'INATIVA')
              .map((c) => ({ valor: c.id, texto: c.apelido })),
          ]}
        />
        <Selecao
          rotulo="Filial"
          value={filialId}
          onChange={(e) => setFilialId(e.target.value)}
          opcoes={[
            { valor: '', texto: 'Todas as filiais' },
            ...base.filiais.map((f) => ({ valor: f.id, texto: f.nome })),
          ]}
        />
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica
            rotulo="Saldo hoje"
            valor={moeda(projecao.saldoInicial)}
            contexto={contaId ? 'da conta selecionada' : 'de todas as contas ativas'}
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Entradas previstas"
            valor={moeda(projecao.totalEntradas)}
            contexto={
              projecao.cenario && projecao.cenario.inadimplencia > 0
                ? `já líquidas de ${projecao.cenario.inadimplencia}% de inadimplência`
                : 'sem desconto de inadimplência'
            }
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Saídas previstas"
            valor={moeda(projecao.totalSaidas)}
            /*
              O contexto diz explicitamente que a saída não muda com o cenário.
              É a pergunta que alguém faz ao ver o pessimista — e a resposta errada
              (descontar a própria dívida) é a que passa desapercebida.
            */
            contexto="o cenário não desconta a própria dívida"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Menor saldo da janela"
            valor={moeda(projecao.menorSaldo)}
            contexto={projecao.diaMenorSaldo ? `em ${data(projecao.diaMenorSaldo)}` : 'é o saldo de hoje'}
            tendencia={projecao.menorSaldo < 0 ? 'negativa' : 'neutra'}
          />
        </Cartao>
      </div>

      {negativos.length > 0 && (
        <Aviso
          tom="critico"
          titulo={`Saldo projetado fica negativo em ${negativos.length} dia(s)`}
          saidas={[
            'Antecipe recebimento ou renegocie vencimento nos dias apontados',
            'Confira a concentração de saídas: um único dia pode estar carregando a janela',
          ]}
        >
          O primeiro dia negativo é {data(negativos[0]!.dia)}, com {moeda(negativos[0]!.valor)}. O
          cálculo usa o cenário padrão
          {padrao ? ` ("${padrao.nome}")` : ''}, não o selecionado acima — um alarme que muda de critério
          conforme quem abre a tela soa para uma pessoa e não para outra.
        </Aviso>
      )}

      <Cartao titulo="Saldo acumulado projetado" comoRegiao>
        {situacao === 'carregando' ? (
          <Skeleton linhas={5} />
        ) : (
          <ProjecaoCaixa
            titulo={`Saldo projetado — ${dias} dias${projecao.cenario ? ` · cenário ${projecao.cenario.nome}` : ''}`}
            pontos={projecao.dias}
            formatarValor={moeda}
          />
        )}
        <p className="texto-atenuado" style={{ marginTop: 'var(--e2)' }}>
          De {data(projecao.de)} a {data(projecao.ate)}. Saldo final projetado:{' '}
          <strong>{moeda(projecao.saldoFinal)}</strong>.
        </p>
      </Cartao>

      <Cartao
        titulo="Alertas"
        comoRegiao
        acessorio={
          <span className="texto-atenuado">
            derivados da projeção, nunca gravados
          </span>
        }
      >
        <p className="texto-secundario medida-leitura">
          Um alerta gravado ficaria desatualizado no instante seguinte a uma baixa: o saldo negativo de
          terça deixa de existir quando o recebimento de segunda entra. Estes são recalculados a cada
          abertura, e o limiar de concentração vem do cadastro do cenário padrão
          {padrao ? ` (${padrao.limiarConcentracao}% da janela)` : ''}.
        </p>
        <Tabela
          legenda="Alertas de caixa"
          colunas={colunas}
          itens={alertas}
          chaveDe={(a) => `${a.tipo}-${a.dia}`}
          vazio={{
            titulo: 'Nenhum alerta nesta janela',
            texto: 'O saldo projetado não fica negativo e nenhum dia concentra saídas acima do limiar.',
          }}
        />
        {concentracoes.length > 0 && (
          <p className="texto-atenuado" style={{ marginTop: 'var(--e2)' }}>
            Concentração não é problema por si: é um aviso de que a janela depende de um dia. Se aquele
            pagamento atrasar, o resto da projeção muda de forma.
          </p>
        )}
      </Cartao>

      <Cartao titulo="Cenários cadastrados" comoRegiao>
        <p className="texto-secundario medida-leitura">
          O percentual de inadimplência de um cenário se aplica <strong>só às entradas</strong>. Aplicá-lo
          também às saídas faria o cenário pessimista deixar a operação mais otimista sobre a própria
          dívida — o inverso de um teste de estresse.
        </p>
        {situacao === 'carregando' ? (
          <Skeleton linhas={2} />
        ) : (
          <Tabela
            legenda="Cenários de caixa"
            colunas={[
              {
                chave: 'nome',
                titulo: 'Cenário',
                identificadora: true,
                celula: (c) => (
                  <span className="linha g1">
                    <strong>{c.nome}</strong>
                    {c.padrao && <Chip severidade="disponivel">padrão</Chip>}
                  </span>
                ),
              },
              {
                chave: 'inadimplencia',
                titulo: 'Inadimplência',
                numerico: true,
                celula: (c) => `${c.inadimplencia}%`,
              },
              {
                chave: 'limiar',
                titulo: 'Limiar de concentração',
                numerico: true,
                celula: (c) => `${c.limiarConcentracao}%`,
              },
              {
                chave: 'uso',
                titulo: 'Uso',
                celula: (c) =>
                  c.padrao ? (
                    <span className="texto-atenuado">abre a tela e alimenta os alertas</span>
                  ) : (
                    <Botao pequeno variante="sutil" onClick={() => setCenarioId(c.id)}>
                      Ver a projeção<span className="so-leitor"> no cenário {c.nome}</span>
                    </Botao>
                  ),
              },
            ]}
            itens={cenarios}
            chaveDe={(c) => c.id}
            vazio={{ titulo: 'Nenhum cenário cadastrado' }}
          />
        )}
      </Cartao>
    </>
  )
}
