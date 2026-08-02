import { api } from '../../dados/api'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { inteiro, moeda } from '../../lib/formato'
import { Botao, Entrada } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { AreaTexto, CampoNumero, GrupoOpcoes, LinhaCampos, ResumoErros } from '../ui/formulario'
import type { Peca } from '../../dados/tipos'
import type { TipoMovimento } from '../../dados/comandos'

/**
 * Movimentação de estoque.
 *
 * `AJUSTE` e `ENTRADA` são operações distintas de propósito, e o formulário
 * insiste nisso: contagem de inventário informa "o que existe", recebimento
 * informa "o que chegou". Tratar as duas como a mesma coisa é como um
 * inventário vira uma entrada duplicada — e o saldo passa a valer o dobro.
 *
 * O saldo resultante aparece antes de confirmar, porque num campo de ajuste o
 * erro típico é digitar a quantidade contada achando que está somando.
 */

interface Props {
  peca: Peca
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  tipo: TipoMovimento
  quantidade: number
  motivo: string
  documento: string
}

const ROTULOS = { quantidade: 'Quantidade', motivo: 'Motivo', documento: 'Documento' }

export function FormEstoque({ peca, aoFechar }: Props) {
  const { avisar } = useToast()
  const disponivel = peca.saldo - peca.reservado

  const form = useFormulario<Valores, Peca>({
    inicial: { tipo: 'ENTRADA', quantidade: 1, motivo: '', documento: '' },
    validar: (v) => ({
      quantidade:
        v.quantidade <= 0
          ? 'Informe uma quantidade maior que zero.'
          : v.tipo === 'SAIDA' && v.quantidade > disponivel
            ? `Saldo insuficiente: ${inteiro(disponivel)} ${peca.unidade} disponível (${inteiro(peca.reservado)} reservado para chamados).`
            : v.tipo === 'AJUSTE' && v.quantidade < peca.reservado
              ? `Ajuste abaixo do reservado (${inteiro(peca.reservado)}) deixaria chamados sem peça.`
              : undefined,
      motivo: v.motivo.trim().length >= 5 ? undefined : 'Toda movimentação exige motivo — o saldo é auditado.',
    }),
    aoEnviar: (v) => api.movimentarEstoque(peca.id, v),
    aoConcluir: (p) => {
      avisar({
        tom: p.saldo <= p.estoqueMinimo ? 'atencao' : 'ok',
        titulo: `${p.codigo}: saldo ${inteiro(p.saldo)} ${p.unidade}`,
        texto:
          p.saldo <= p.estoqueMinimo
            ? `Abaixo do mínimo de ${inteiro(p.estoqueMinimo)} — reposição sugerida.`
            : undefined,
      })
      aoFechar()
    },
  })

  const saldoFinal =
    form.valores.tipo === 'ENTRADA'
      ? peca.saldo + form.valores.quantidade
      : form.valores.tipo === 'SAIDA'
        ? peca.saldo - form.valores.quantidade
        : form.valores.quantidade

  const ficaAbaixo = saldoFinal <= peca.estoqueMinimo

  return (
    <Dialogo
      titulo={`Movimentar ${peca.codigo}`}
      descricao={peca.descricao}
      aoFechar={aoFechar}
      largura="medio"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Registrando…' : 'Registrar movimentação'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros erros={form.errosResumo} erroGeral={form.erroGeral} rotulos={ROTULOS} refResumo={form.refResumo} />

        <div className="cartao cartao--compacto">
          <dl className="pares">
            <div>
              <dt>Saldo atual</dt>
              <dd className="dado">
                {inteiro(peca.saldo)} {peca.unidade}
              </dd>
            </div>
            <div>
              <dt>Reservado</dt>
              <dd className="dado">{inteiro(peca.reservado)}</dd>
            </div>
            <div>
              <dt>Disponível</dt>
              <dd className="dado">{inteiro(disponivel)}</dd>
            </div>
            <div>
              <dt>Mínimo</dt>
              <dd className="dado">{inteiro(peca.estoqueMinimo)}</dd>
            </div>
          </dl>
        </div>

        <GrupoOpcoes
          legenda="Tipo de movimentação"
          valor={form.valores.tipo}
          aoMudar={(v) => form.definir('tipo', v as TipoMovimento)}
          opcoes={[
            { valor: 'ENTRADA', texto: 'Entrada', detalhe: 'soma ao saldo — recebimento de compra' },
            { valor: 'SAIDA', texto: 'Saída', detalhe: 'subtrai do saldo — consumo fora de chamado' },
            { valor: 'AJUSTE', texto: 'Ajuste de inventário', detalhe: 'define o saldo absoluto contado' },
          ]}
        />

        <LinhaCampos>
          <CampoNumero
            nome="quantidade"
            rotulo={form.valores.tipo === 'AJUSTE' ? 'Saldo contado' : 'Quantidade'}
            dica={
              form.valores.tipo === 'AJUSTE'
                ? 'O que foi de fato contado na prateleira, não a diferença.'
                : `Custo médio ${moeda(peca.custoMedio)} por ${peca.unidade}.`
            }
            sufixo={peca.unidade}
            min={0}
            valor={form.valores.quantidade}
            aoMudar={(v) => form.definir('quantidade', v)}
            {...form.campo('quantidade')}
          />
          <Entrada
            nome="documento"
            rotulo="Documento (opcional)"
            dica="Nota fiscal, ordem de compra ou ata de inventário."
            value={form.valores.documento}
            onChange={(e) => form.definir('documento', e.target.value)}
          />
        </LinhaCampos>

        <AreaTexto
          nome="motivo"
          rotulo="Motivo"
          limite={200}
          value={form.valores.motivo}
          onChange={(e) => form.definir('motivo', e.target.value)}
          {...form.campo('motivo')}
        />

        <div className={`aviso aviso--${ficaAbaixo ? 'atencao' : 'ok'}`} role="status" aria-live="polite">
          <span aria-hidden="true">{ficaAbaixo ? '▲' : '✓'}</span>
          <span className="crescer">
            Saldo após a movimentação: <strong className="dado">{inteiro(saldoFinal)} {peca.unidade}</strong>
            {ficaAbaixo && ` — abaixo do mínimo de ${inteiro(peca.estoqueMinimo)}, entra na lista de reposição.`}
          </span>
        </div>
      </form>
    </Dialogo>
  )
}
