import { useMemo } from 'react'
import { api } from '../../dados/api'
import { categoriaPorCodigo, fabricantePorId, MODELOS } from '../../dados/catalogo'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { moeda } from '../../lib/formato'
import { Botao, Entrada, Selecao } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { Combo, LinhaCampos, ResumoErros } from '../ui/formulario'
import type { Equipamento } from '../../dados/tipos'

/**
 * Cadastro de equipamento no parque.
 *
 * Patrimônio e número de série são únicos, e a checagem é feita nos dois: o
 * patrimônio é a etiqueta que o técnico lê em campo, a série é o que o
 * fabricante reconhece na garantia. Duplicar qualquer um dos dois cria dois
 * registros para a mesma máquina física, e a partir daí o histórico de
 * manutenção se divide ao meio.
 *
 * Categoria, valor e periodicidade de preventiva vêm do modelo — não são
 * digitados. Deixar digitável seria convidar duas impressoras do mesmo modelo a
 * terem SLAs diferentes.
 */

interface Props {
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  patrimonio: string
  numeroSerie: string
  modeloId: string
  filialId: string
}

const ROTULOS = {
  patrimonio: 'Patrimônio',
  numeroSerie: 'Número de série',
  modeloId: 'Modelo',
  filialId: 'Filial',
}

export function FormEquipamento({ aoFechar }: Props) {
  const base = api.baseSincrona()
  const { avisar } = useToast()

  const opcoesModelo = useMemo(
    () =>
      MODELOS.map((m) => ({
        valor: m.id,
        texto: `${fabricantePorId.get(m.fabricanteId)?.nome ?? ''} ${m.nome}`.trim(),
        detalhe: `${categoriaPorCodigo.get(m.categoria)?.nome} · ${moeda(m.precoMensal)}/mês`,
      })),
    [],
  )

  const form = useFormulario<Valores, Equipamento>({
    inicial: { patrimonio: '', numeroSerie: '', modeloId: '', filialId: base.filiais[0]?.id ?? '' },
    validar: (v) => ({
      patrimonio: /^\d{4,8}$/.test(v.patrimonio.trim())
        ? undefined
        : 'O patrimônio é numérico, de 4 a 8 dígitos — é a etiqueta lida em campo.',
      numeroSerie:
        v.numeroSerie.trim().length >= 5 ? undefined : 'Informe o número de série do fabricante (mínimo 5 caracteres).',
      modeloId: v.modeloId ? undefined : 'Escolha o modelo.',
      filialId: v.filialId ? undefined : 'Escolha a filial onde o ativo fica.',
    }),
    aoEnviar: (v) => api.criarEquipamento(v),
    aoConcluir: (e) => {
      avisar({
        tom: 'ok',
        titulo: `Patrimônio ${e.patrimonio} cadastrado`,
        texto: 'Disponível no estoque, pronto para alocação em contrato.',
      })
      aoFechar()
    },
  })

  const modelo = MODELOS.find((m) => m.id === form.valores.modeloId)
  const categoria = modelo ? categoriaPorCodigo.get(modelo.categoria) : null

  return (
    <Dialogo
      titulo="Cadastrar equipamento"
      descricao="Categoria, valor patrimonial e SLA vêm do modelo — não são digitados."
      aoFechar={aoFechar}
      largura="medio"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Cadastrando…' : 'Cadastrar'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros erros={form.errosResumo} erroGeral={form.erroGeral} rotulos={ROTULOS} refResumo={form.refResumo} />

        <LinhaCampos>
          <Entrada
            nome="patrimonio"
            rotulo="Patrimônio"
            inputMode="numeric"
            placeholder="10425"
            dica="Único no parque."
            value={form.valores.patrimonio}
            onChange={(e) => form.definir('patrimonio', e.target.value.replace(/\D/g, ''))}
            {...form.campo('patrimonio')}
          />
          <Entrada
            nome="numeroSerie"
            rotulo="Número de série"
            placeholder="KYO-A-0104"
            dica="Do fabricante — é o que vale na garantia."
            value={form.valores.numeroSerie}
            onChange={(e) => form.definir('numeroSerie', e.target.value.toUpperCase())}
            {...form.campo('numeroSerie')}
          />
        </LinhaCampos>

        <Combo
          nome="modeloId"
          rotulo="Modelo"
          dica="Busque por fabricante ou nome do modelo."
          opcoes={opcoesModelo}
          valor={form.valores.modeloId}
          aoMudar={(v) => form.definir('modeloId', v)}
          {...form.campo('modeloId')}
        />

        {modelo && categoria && (
          <div className="cartao cartao--compacto">
            <dl className="pares">
              <div>
                <dt>Categoria</dt>
                <dd>{categoria.nome}</dd>
              </div>
              <div>
                <dt>Valor de aquisição</dt>
                <dd className="dado">{moeda(modelo.valorAquisicao)}</dd>
              </div>
              <div>
                <dt>SLA de solução</dt>
                <dd>{categoria.slaHorasSolucao} h</dd>
              </div>
              <div>
                <dt>Medição</dt>
                <dd>
                  {categoria.temContador
                    ? `Contador de páginas${categoria.temContadorColor ? ' mono e color' : ''} · preventiva a cada 50.000`
                    : 'Sem contador'}
                </dd>
              </div>
            </dl>
          </div>
        )}

        <Selecao
          nome="filialId"
          rotulo="Filial"
          dica="Onde o ativo fica quando disponível."
          opcoes={base.filiais.map((f) => ({ valor: f.id, texto: `${f.codigo} — ${f.nome}` }))}
          value={form.valores.filialId}
          onChange={(e) => form.definir('filialId', e.target.value)}
          {...form.campo('filialId')}
        />
      </form>
    </Dialogo>
  )
}
