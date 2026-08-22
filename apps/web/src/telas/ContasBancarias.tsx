import { useMemo, useState } from 'react'
import { api } from '../dados/api'
import { saldoDaConta } from '../dados/comandos'
import { useConsulta } from '../lib/useConsulta'
import { useFormulario } from '../lib/useFormulario'
import { useSessao, useToast } from '../lib/contexto'
import { data, moeda } from '../lib/formato'
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
import { ResumoErros } from '../componentes/ui/formulario'
import { Tabela, type Coluna } from '../componentes/ui/Tabela'
import type { ContaBancaria, Movimentacao } from '../dados/tipos'

/**
 * Contas bancárias e extrato.
 *
 * O saldo exibido é **derivado** das movimentações, por `saldoDaConta()`, e
 * espelha `app.saldo_conta` do banco. Não há campo de saldo em lugar nenhum: uma
 * cópia guardada divergiria na primeira escrita que esquecesse de atualizá-la, e
 * a divergência apareceria como dinheiro que não fecha — meses depois, sem
 * pista de onde começou.
 *
 * O extrato não tem botão de editar nem de excluir, e isso é a regra, não um
 * recorte: movimentação bancária é registro imutável (RN-L46). O que existe é
 * estorno, com motivo obrigatório.
 */
export function ContasBancarias() {
  const { pode } = useSessao()
  const { avisar } = useToast()
  const { situacao, dado, recarregar } = useConsulta(() => api.contasBancarias(), [])
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null)
  const [aberto, setAberto] = useState<
    | { tipo: 'conta'; conta: ContaBancaria | null }
    | { tipo: 'lancar'; conta: ContaBancaria }
    | { tipo: 'transferir' }
    | { tipo: 'estornar'; movimento: Movimentacao }
    | null
  >(null)
  const [erro, setErro] = useState<string | null>(null)

  const base = api.baseSincrona()
  const contas = dado ?? []
  const selecionada = contas.find((c) => c.id === selecionadaId) ?? contas[0] ?? null

  const saldos = useMemo(
    () => new Map(contas.map((c) => [c.id, saldoDaConta(base, c.id)])),
    [base, contas, dado],
  )
  const total = [...saldos.values()].reduce((a, b) => a + b, 0)

  const extrato = useMemo(
    () => (selecionada ? base.movimentacoes.filter((m) => m.contaId === selecionada.id) : []),
    [base, selecionada, dado],
  )
  const pendentes = extrato.filter((m) => !m.conciliado).length

  async function alternarConciliacao(m: Movimentacao) {
    setErro(null)
    const r = await api.conciliarMovimentacao(m.id, !m.conciliado)
    if (r.ok) recarregar()
    else setErro(r.erro.mensagem)
  }

  const colunas: Coluna<Movimentacao>[] = [
    {
      chave: 'data',
      titulo: 'Data',
      identificadora: true,
      ordenarPor: (m) => m.dataMovimento,
      celula: (m) => data(m.dataMovimento),
    },
    {
      chave: 'descricao',
      titulo: 'Lançamento',
      celula: (m) => (
        <span className="pilha g1">
          <span>{m.descricao}</span>
          {m.motivo && <span className="texto-atenuado">Motivo: {m.motivo}</span>}
          {m.transferenciaParId && (
            <span className="texto-atenuado">Transferência entre contas · par vinculado</span>
          )}
        </span>
      ),
    },
    {
      chave: 'tipo',
      titulo: 'Tipo',
      ordenarPor: (m) => m.tipo,
      celula: (m) => <Chip severidade={ENTRA.has(m.tipo) ? 'disponivel' : 'atencao'}>{ROTULO[m.tipo]}</Chip>,
    },
    {
      chave: 'valor',
      titulo: 'Valor',
      numerico: true,
      ordenarPor: (m) => m.valor,
      /*
       * O sinal é exibido, mas não está gravado: o valor é sempre positivo e o
       * sinal vem do tipo. Guardar negativo criaria duas formas de registrar a
       * mesma saída, e toda soma passaria a precisar saber qual delas está lendo.
       */
      celula: (m) => (
        <span className={ENTRA.has(m.tipo) ? 'valor-entrada' : 'valor-saida'}>
          {ENTRA.has(m.tipo) ? '+' : '−'} {moeda(m.valor)}
        </span>
      ),
    },
    {
      chave: 'conciliado',
      titulo: 'Conciliação',
      ocultarEmMobile: true,
      ordenarPor: (m) => (m.conciliado ? 1 : 0),
      celula: (m) =>
        pode('conciliacao:executar') ? (
          <Botao pequeno variante="sutil" onClick={() => alternarConciliacao(m)}>
            {m.conciliado ? 'Conciliado' : 'Conciliar'}
            <span className="so-leitor"> — {m.descricao}</span>
          </Botao>
        ) : (
          <Chip severidade={m.conciliado ? 'disponivel' : 'inativo'}>
            {m.conciliado ? 'Conciliado' : 'Pendente'}
          </Chip>
        ),
    },
    {
      chave: 'acoes',
      titulo: 'Ações',
      celula: (m) =>
        pode('conta_bancaria:movimentar') ? (
          <Botao
            pequeno
            variante="sutil"
            disabled={m.estornaId !== null}
            motivoDesabilitado="Estorno não se estorna — lance um movimento novo"
            onClick={() => setAberto({ tipo: 'estornar', movimento: m })}
          >
            Estornar<span className="so-leitor"> {m.descricao}</span>
          </Botao>
        ) : null,
    },
  ]

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>Contas bancárias</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            Saldo derivado das movimentações, nunca digitado. Não existe campo de saldo — é o que garante que
            extrato e saldo não divergem.
          </p>
        </div>
        <div className="linha g2">
          {pode('conta_bancaria:transferir') && (
            <Botao onClick={() => setAberto({ tipo: 'transferir' })}>Transferir</Botao>
          )}
          {pode('conta_bancaria:gerenciar') && (
            <Botao variante="primario" glifo="+" onClick={() => setAberto({ tipo: 'conta', conta: null })}>
              Nova conta
            </Botao>
          )}
        </div>
      </div>

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica rotulo="Saldo consolidado" valor={moeda(total)} contexto={`${contas.length} conta(s)`} />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Contas ativas"
            valor={String(contas.filter((c) => c.status === 'ATIVA').length)}
            contexto="aceitam lançamento"
          />
        </Cartao>
        <Cartao compacto>
          <Metrica rotulo="A conciliar" valor={String(pendentes)} contexto="na conta selecionada" />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Limite disponível"
            valor={moeda(contas.reduce((t, c) => t + (c.limiteCredito ?? 0), 0))}
            contexto="cheque especial contratado"
          />
        </Cartao>
      </div>

      {erro && (
        <Aviso tom="critico" titulo="Não foi possível concluir">
          {erro}
        </Aviso>
      )}

      {situacao === 'carregando' ? (
        <Cartao>
          <Carregando rotulo="Carregando contas">
            <Skeleton linhas={6} altura="24px" />
          </Carregando>
        </Cartao>
      ) : (
        <div className="grade grade--contas">
          {contas.map((c) => {
            const saldo = saldos.get(c.id) ?? 0
            return (
              <Cartao key={c.id} compacto>
                <button
                  type="button"
                  className="conta-cartao"
                  aria-current={selecionada?.id === c.id}
                  onClick={() => setSelecionadaId(c.id)}
                >
                  <span className="linha entre g2">
                    <span className="conta-cartao__apelido">{c.apelido}</span>
                    <Chip severidade={c.status === 'ATIVA' ? 'disponivel' : c.status === 'BLOQUEADA' ? 'critico' : 'inativo'}>
                      {c.status === 'ATIVA' ? 'Ativa' : c.status === 'BLOQUEADA' ? 'Bloqueada' : 'Inativa'}
                    </Chip>
                  </span>
                  <span className="conta-cartao__banco">
                    {c.bancoNome} · ag. {c.agencia} · c/{c.tipo === 'POUPANCA' ? 'p' : 'c'} {c.numero}
                  </span>
                  {/* Saldo negativo em vermelho e com o sinal explícito: um
                      parêntese contábil não é lido por leitor de tela. */}
                  <span className={saldo < 0 ? 'conta-cartao__saldo valor-saida' : 'conta-cartao__saldo'}>
                    {moeda(saldo)}
                  </span>
                  {c.limiteCredito !== null && (
                    <span className="conta-cartao__limite">
                      Limite de {moeda(c.limiteCredito)}
                      {saldo < 0 && ` · usando ${moeda(Math.min(-saldo, c.limiteCredito))}`}
                    </span>
                  )}
                </button>

                {pode('conta_bancaria:movimentar') && c.status === 'ATIVA' && (
                  <div className="linha g2" style={{ marginTop: 'var(--e2)' }}>
                    <Botao pequeno onClick={() => setAberto({ tipo: 'lancar', conta: c })}>
                      Lançar<span className="so-leitor"> em {c.apelido}</span>
                    </Botao>
                    {pode('conta_bancaria:gerenciar') && (
                      <Botao pequeno variante="sutil" onClick={() => setAberto({ tipo: 'conta', conta: c })}>
                        Editar<span className="so-leitor"> {c.apelido}</span>
                      </Botao>
                    )}
                  </div>
                )}

                {c.status === 'BLOQUEADA' && (
                  <p className="texto-atenuado" style={{ marginTop: 'var(--e2)' }}>
                    Bloqueada para lançamento manual. Importação de extrato e estorno seguem permitidos.
                  </p>
                )}
              </Cartao>
            )
          })}
        </div>
      )}

      {selecionada && (
        <Cartao titulo={`Extrato — ${selecionada.apelido} (${extrato.length})`}>
          <p className="texto-atenuado" role="status">
            Saldo em {data(api.hoje())}: {moeda(saldos.get(selecionada.id) ?? 0)} · saldo inicial de{' '}
            {moeda(selecionada.saldoInicial)} em {data(selecionada.dataSaldoInicial)}
          </p>
          <Tabela
            legenda={`Extrato da conta ${selecionada.apelido}`}
            colunas={colunas}
            itens={extrato}
            chaveDe={(m) => m.id}
            ordemInicial={{ chave: 'data', direcao: 'desc' }}
            vazio={{
              titulo: 'Nenhuma movimentação nesta conta',
              texto: 'Lançamentos aparecem aqui em ordem cronológica, do mais recente ao mais antigo.',
            }}
          />
        </Cartao>
      )}

      {aberto?.tipo === 'conta' && (
        <DialogoConta
          conta={aberto.conta}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({ tom: 'ok', titulo: 'Conta salva' })
          }}
        />
      )}

      {aberto?.tipo === 'lancar' && (
        <DialogoLancamento
          conta={aberto.conta}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({ tom: 'ok', titulo: 'Lançamento registrado' })
          }}
        />
      )}

      {aberto?.tipo === 'transferir' && (
        <DialogoTransferencia
          contas={contas.filter((c) => c.status === 'ATIVA')}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({ tom: 'ok', titulo: 'Transferência registrada', texto: 'As duas pernas foram criadas.' })
          }}
        />
      )}

      {aberto?.tipo === 'estornar' && (
        <DialogoEstorno
          movimento={aberto.movimento}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            setAberto(null)
            recarregar()
            avisar({ tom: 'ok', titulo: 'Estorno lançado' })
          }}
        />
      )}
    </>
  )
}

/** Que tipos somam. A saída não é negativa: o sinal é o tipo. */
const ENTRA = new Set<Movimentacao['tipo']>(['ENTRADA', 'TRANSFERENCIA_ENTRADA'])

const ROTULO: Record<Movimentacao['tipo'], string> = {
  ENTRADA: 'Entrada',
  SAIDA: 'Saída',
  TRANSFERENCIA_ENTRADA: 'Transf. recebida',
  TRANSFERENCIA_SAIDA: 'Transf. enviada',
  TAXA: 'Tarifa',
}

/**
 * Bancos da demonstração: código FEBRABAN e nome.
 *
 * A lista é curta de propósito — são os cinco bancos com que uma operação
 * brasileira de médio porte de fato trabalha. Um cadastro completo é dado de
 * catálogo, e virá do servidor quando ele existir.
 */
const BANCOS = [
  { valor: '001', texto: '001 — Banco do Brasil' },
  { valor: '033', texto: '033 — Santander' },
  { valor: '104', texto: '104 — Caixa Econômica Federal' },
  { valor: '237', texto: '237 — Bradesco' },
  { valor: '341', texto: '341 — Itaú Unibanco' },
]

function DialogoConta({
  conta,
  aoFechar,
  aoSalvar,
}: {
  conta: ContaBancaria | null
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const form = useFormulario({
    inicial: {
      bancoCodigo: conta?.bancoCodigo ?? '341',
      agencia: conta?.agencia ?? '',
      numero: conta?.numero ?? '',
      tipo: conta?.tipo ?? ('CORRENTE' as ContaBancaria['tipo']),
      apelido: conta?.apelido ?? '',
      saldoInicial: conta ? String(conta.saldoInicial) : '0',
      dataSaldoInicial: conta?.dataSaldoInicial ?? api.hoje().toISOString().slice(0, 10),
      limiteCredito: conta?.limiteCredito !== null && conta ? String(conta.limiteCredito) : '',
      status: conta?.status ?? ('ATIVA' as ContaBancaria['status']),
    },
    validar: (v) => ({
      apelido: v.apelido.trim().length < 2 ? 'Informe como a operação chama esta conta.' : undefined,
      agencia: !v.agencia.trim() ? 'Informe a agência.' : undefined,
      numero: !v.numero.trim() ? 'Informe o número da conta.' : undefined,
    }),
    aoEnviar: (v) =>
      api.salvarContaBancaria(conta?.id ?? null, {
        bancoCodigo: v.bancoCodigo,
        bancoNome: BANCOS.find((b) => b.valor === v.bancoCodigo)!.texto.split(' — ')[1]!,
        agencia: v.agencia,
        numero: v.numero,
        tipo: v.tipo,
        apelido: v.apelido,
        saldoInicial: Number(v.saldoInicial) || 0,
        dataSaldoInicial: v.dataSaldoInicial,
        limiteCredito: v.limiteCredito.trim() ? Number(v.limiteCredito) : null,
      }),
    aoConcluir: aoSalvar,
  })

  return (
    <Dialogo
      titulo={conta ? `Editar ${conta.apelido}` : 'Nova conta bancária'}
      descricao="O apelido é o que aparece no seletor da baixa de um título — agência e número não distinguem nada para quem escolhe."
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
          rotulos={{ apelido: 'Apelido', agencia: 'Agência', numero: 'Número' }}
          refResumo={form.refResumo}
        />

        <div className="pilha g3">
          <Entrada
            rotulo="Apelido"
            nome="apelido"
            dica='Como a operação chama a conta: "Operação", "Folha", "Reserva".'
            value={form.valores.apelido}
            onChange={(e) => form.definir('apelido', e.target.value)}
            {...form.campo('apelido')}
          />
          <Selecao
            rotulo="Banco"
            nome="bancoCodigo"
            opcoes={BANCOS}
            value={form.valores.bancoCodigo}
            onChange={(e) => form.definir('bancoCodigo', e.target.value)}
            disabled={conta !== null}
            {...form.campo('bancoCodigo')}
          />
          <div className="linha g3">
            <Entrada
              rotulo="Agência"
              nome="agencia"
              value={form.valores.agencia}
              onChange={(e) => form.definir('agencia', e.target.value)}
              disabled={conta !== null}
              {...form.campo('agencia')}
            />
            <Entrada
              rotulo="Número"
              nome="numero"
              value={form.valores.numero}
              onChange={(e) => form.definir('numero', e.target.value)}
              disabled={conta !== null}
              {...form.campo('numero')}
            />
          </div>
          <Selecao
            rotulo="Tipo"
            nome="tipo"
            opcoes={[
              { valor: 'CORRENTE', texto: 'Conta corrente' },
              { valor: 'POUPANCA', texto: 'Poupança' },
              { valor: 'PAGAMENTO', texto: 'Conta de pagamento' },
            ]}
            value={form.valores.tipo}
            onChange={(e) => form.definir('tipo', e.target.value as ContaBancaria['tipo'])}
            disabled={conta !== null}
          />

          {conta === null ? (
            <div className="linha g3">
              <Entrada
                rotulo="Saldo inicial"
                nome="saldoInicial"
                type="number"
                step="0.01"
                dica="O saldo na data abaixo. Movimentação anterior a ela não é somada de novo."
                value={form.valores.saldoInicial}
                onChange={(e) => form.definir('saldoInicial', e.target.value)}
              />
              <Entrada
                rotulo="Data do saldo inicial"
                nome="dataSaldoInicial"
                type="date"
                value={form.valores.dataSaldoInicial}
                onChange={(e) => form.definir('dataSaldoInicial', e.target.value)}
              />
            </div>
          ) : (
            /* Saldo inicial e identificação bancária não se editam: mudá-los
               reescreveria o saldo de todo o histórico da conta. Para corrigir,
               a saída é lançar um ajuste, que fica registrado. */
            <Aviso tom="atencao" titulo="Saldo inicial e identificação não se editam">
              Alterá-los reescreveria o saldo de todo o histórico. Para corrigir, lance um ajuste — ele fica
              registrado no extrato.
            </Aviso>
          )}

          <Entrada
            rotulo="Limite de crédito"
            nome="limiteCredito"
            type="number"
            step="0.01"
            dica="Cheque especial contratado. Vazio = sem limite."
            value={form.valores.limiteCredito}
            onChange={(e) => form.definir('limiteCredito', e.target.value)}
          />
        </div>
      </form>
    </Dialogo>
  )
}

function DialogoLancamento({
  conta,
  aoFechar,
  aoSalvar,
}: {
  conta: ContaBancaria
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const form = useFormulario({
    inicial: {
      tipo: 'SAIDA' as 'ENTRADA' | 'SAIDA' | 'TAXA',
      valor: '',
      dataMovimento: api.hoje().toISOString().slice(0, 10),
      descricao: '',
    },
    validar: (v) => ({
      valor: !(Number(v.valor) > 0) ? 'O valor tem de ser positivo — o sinal vem do tipo.' : undefined,
      descricao:
        v.descricao.trim().length < 3
          ? 'Descreva o lançamento: o extrato é lido por quem não estava aqui.'
          : undefined,
    }),
    aoEnviar: (v) =>
      api.lancarMovimentacao(conta.id, {
        tipo: v.tipo,
        valor: Number(v.valor),
        dataMovimento: v.dataMovimento,
        descricao: v.descricao,
      }),
    aoConcluir: aoSalvar,
  })

  return (
    <Dialogo
      titulo={`Lançar em ${conta.apelido}`}
      descricao="Transferência entre contas tem ação própria — lançada aqui, ficaria uma perna sem par."
      aoFechar={aoFechar}
      largura="estreito"
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Lançando…' : 'Lançar'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ valor: 'Valor', descricao: 'Descrição' }}
          refResumo={form.refResumo}
        />
        <div className="pilha g3">
          <Selecao
            rotulo="Tipo"
            nome="tipo"
            opcoes={[
              { valor: 'ENTRADA', texto: 'Entrada — dinheiro chegando' },
              { valor: 'SAIDA', texto: 'Saída — dinheiro saindo' },
              { valor: 'TAXA', texto: 'Tarifa bancária' },
            ]}
            value={form.valores.tipo}
            onChange={(e) => form.definir('tipo', e.target.value as 'ENTRADA' | 'SAIDA' | 'TAXA')}
          />
          <Entrada
            rotulo="Valor"
            nome="valor"
            type="number"
            step="0.01"
            min="0.01"
            dica="Sempre positivo. O sinal é o tipo escolhido acima."
            value={form.valores.valor}
            onChange={(e) => form.definir('valor', e.target.value)}
            {...form.campo('valor')}
          />
          <Entrada
            rotulo="Data"
            nome="dataMovimento"
            type="date"
            value={form.valores.dataMovimento}
            onChange={(e) => form.definir('dataMovimento', e.target.value)}
          />
          <Entrada
            rotulo="Descrição"
            nome="descricao"
            value={form.valores.descricao}
            onChange={(e) => form.definir('descricao', e.target.value)}
            {...form.campo('descricao')}
          />
        </div>
      </form>
    </Dialogo>
  )
}

function DialogoTransferencia({
  contas,
  aoFechar,
  aoSalvar,
}: {
  contas: ContaBancaria[]
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const form = useFormulario({
    inicial: {
      contaOrigemId: contas[0]?.id ?? '',
      contaDestinoId: contas[1]?.id ?? '',
      valor: '',
      dataMovimento: api.hoje().toISOString().slice(0, 10),
      descricao: '',
    },
    validar: (v) => ({
      contaDestinoId:
        v.contaOrigemId === v.contaDestinoId ? 'Origem e destino têm de ser contas distintas.' : undefined,
      valor: !(Number(v.valor) > 0) ? 'Informe o valor a transferir.' : undefined,
    }),
    aoEnviar: (v) =>
      api.transferirEntreContas({
        contaOrigemId: v.contaOrigemId,
        contaDestinoId: v.contaDestinoId,
        valor: Number(v.valor),
        dataMovimento: v.dataMovimento,
        descricao: v.descricao,
      }),
    aoConcluir: aoSalvar,
  })

  const opcoes = contas.map((c) => ({ valor: c.id, texto: `${c.apelido} — ${c.bancoNome}` }))

  return (
    <Dialogo
      titulo="Transferir entre contas"
      descricao="Gera as duas pernas na mesma operação: uma saída na origem e uma entrada no destino, cada uma apontando para a outra."
      aoFechar={aoFechar}
      largura="estreito"
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Transferindo…' : 'Transferir'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ contaDestinoId: 'Conta de destino', valor: 'Valor' }}
          refResumo={form.refResumo}
        />
        <div className="pilha g3">
          <Selecao
            rotulo="De"
            nome="contaOrigemId"
            opcoes={opcoes}
            value={form.valores.contaOrigemId}
            onChange={(e) => form.definir('contaOrigemId', e.target.value)}
          />
          <Selecao
            rotulo="Para"
            nome="contaDestinoId"
            opcoes={opcoes}
            value={form.valores.contaDestinoId}
            onChange={(e) => form.definir('contaDestinoId', e.target.value)}
            {...form.campo('contaDestinoId')}
          />
          <Entrada
            rotulo="Valor"
            nome="valor"
            type="number"
            step="0.01"
            min="0.01"
            value={form.valores.valor}
            onChange={(e) => form.definir('valor', e.target.value)}
            {...form.campo('valor')}
          />
          <Entrada
            rotulo="Data"
            nome="dataMovimento"
            type="date"
            value={form.valores.dataMovimento}
            onChange={(e) => form.definir('dataMovimento', e.target.value)}
          />
          <Entrada
            rotulo="Descrição"
            nome="descricao"
            dica="Aparece nas duas pontas do extrato."
            value={form.valores.descricao}
            onChange={(e) => form.definir('descricao', e.target.value)}
          />
        </div>
      </form>
    </Dialogo>
  )
}

function DialogoEstorno({
  movimento,
  aoFechar,
  aoSalvar,
}: {
  movimento: Movimentacao
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const form = useFormulario({
    inicial: { motivo: '' },
    validar: (v) => ({
      motivo: v.motivo.trim().length < 5 ? 'Explique o motivo do estorno.' : undefined,
    }),
    aoEnviar: (v) => api.estornarMovimentacao(movimento.id, v.motivo),
    aoConcluir: aoSalvar,
  })

  return (
    <Dialogo
      titulo="Estornar movimentação"
      descricao="A movimentação original não é apagada nem alterada: o estorno é um lançamento contrário, e os dois ficam no extrato."
      aoFechar={aoFechar}
      largura="estreito"
      acoes={
        <>
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="perigo" onClick={form.enviar} disabled={form.enviando}>
            {form.enviando ? 'Estornando…' : 'Estornar'}
          </Botao>
        </>
      }
    >
      <form onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ motivo: 'Motivo' }}
          refResumo={form.refResumo}
        />
        <div className="pilha g3">
          <Aviso tom="atencao" titulo="O que será estornado">
            {ROTULO[movimento.tipo]} de {moeda(movimento.valor)} em {data(movimento.dataMovimento)} —{' '}
            {movimento.descricao}
          </Aviso>
          <Entrada
            rotulo="Motivo"
            nome="motivo"
            dica="Quem lê o extrato depois precisa entender por que os dois lançamentos existem."
            value={form.valores.motivo}
            onChange={(e) => form.definir('motivo', e.target.value)}
            {...form.campo('motivo')}
          />
        </div>
      </form>
    </Dialogo>
  )
}
