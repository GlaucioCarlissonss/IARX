import { api } from '../../dados/api'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { inteiro } from '../../lib/formato'
import { Botao } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { CampoNumero, LinhaCampos, ResumoErros } from '../ui/formulario'
import type { Peca } from '../../dados/tipos'

/**
 * Política de reposição da peça.
 *
 * O ponto de pedido precisa ser maior ou igual ao mínimo — caso contrário o
 * pedido só dispara depois de já ter faltado, e o mínimo deixa de proteger
 * qualquer coisa. A sugestão calculada a partir do consumo e do lead time
 * aparece ao lado, porque quase ninguém faz essa conta de cabeça.
 */

interface Props {
  peca: Peca
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  estoqueMinimo: number
  pontoPedido: number
}

export function FormPolitica({ peca, aoFechar }: Props) {
  const { avisar } = useToast()

  const consumoMensal = Math.round(peca.consumo12m / 12)
  const consumoDiario = peca.consumo12m / 365
  // Cobertura do lead time mais uma folga de meio período: é a regra prática
  // que evita ruptura sem inflar o capital parado.
  const sugestaoPonto = Math.max(1, Math.ceil(consumoDiario * peca.leadTimeDias * 1.5))
  const sugestaoMinimo = Math.max(1, Math.ceil(consumoDiario * peca.leadTimeDias * 0.5))

  const form = useFormulario<Valores, Peca>({
    inicial: { estoqueMinimo: peca.estoqueMinimo, pontoPedido: peca.pontoPedido },
    validar: (v) => ({
      estoqueMinimo: v.estoqueMinimo >= 0 ? undefined : 'O mínimo não pode ser negativo.',
      pontoPedido:
        v.pontoPedido >= v.estoqueMinimo
          ? undefined
          : 'O ponto de pedido precisa ser maior ou igual ao mínimo — senão o pedido só dispara depois de faltar.',
    }),
    aoEnviar: (v) => api.definirPolitica(peca.id, v),
    aoConcluir: (p) => {
      avisar({
        tom: 'ok',
        titulo: `Política de ${p.codigo} atualizada`,
        texto: `Mínimo ${inteiro(p.estoqueMinimo)} · ponto de pedido ${inteiro(p.pontoPedido)}`,
      })
      aoFechar()
    },
  })

  return (
    <Dialogo
      titulo={`Política de reposição · ${peca.codigo}`}
      descricao={peca.descricao}
      aoFechar={aoFechar}
      largura="medio"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Salvando…' : 'Salvar política'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{ estoqueMinimo: 'Estoque mínimo', pontoPedido: 'Ponto de pedido' }}
          refResumo={form.refResumo}
        />

        <div className="cartao cartao--compacto">
          <dl className="pares">
            <div>
              <dt>Consumo médio</dt>
              <dd className="dado">
                {inteiro(consumoMensal)} {peca.unidade}/mês
              </dd>
            </div>
            <div>
              <dt>Lead time do fornecedor</dt>
              <dd className="dado">{peca.leadTimeDias} dias</dd>
            </div>
            <div>
              <dt>Fornecedor</dt>
              <dd>{peca.fornecedor}</dd>
            </div>
          </dl>
        </div>

        <LinhaCampos>
          <CampoNumero
            nome="estoqueMinimo"
            rotulo="Estoque mínimo"
            dica={`Sugestão: ${inteiro(sugestaoMinimo)} — meio lead time de cobertura.`}
            sufixo={peca.unidade}
            min={0}
            valor={form.valores.estoqueMinimo}
            aoMudar={(v) => form.definir('estoqueMinimo', v)}
            {...form.campo('estoqueMinimo')}
          />
          <CampoNumero
            nome="pontoPedido"
            rotulo="Ponto de pedido"
            dica={`Sugestão: ${inteiro(sugestaoPonto)} — cobre o lead time com folga.`}
            sufixo={peca.unidade}
            min={0}
            valor={form.valores.pontoPedido}
            aoMudar={(v) => form.definir('pontoPedido', v)}
            {...form.campo('pontoPedido')}
          />
        </LinhaCampos>

        <p className="linha g2">
          <Botao
            pequeno
            onClick={() => {
              form.definir('estoqueMinimo', sugestaoMinimo)
              form.definir('pontoPedido', sugestaoPonto)
            }}
          >
            Usar as sugestões
          </Botao>
        </p>
      </form>
    </Dialogo>
  )
}
