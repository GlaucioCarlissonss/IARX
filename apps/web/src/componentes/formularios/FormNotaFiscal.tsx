import { useMemo, useRef, useState } from 'react'
import { api } from '../../dados/api'
import { MODELOS, fabricantePorId, modeloPorId } from '../../dados/catalogo'
import { arredondar, chaveValida, decomporChave, formatarChave, formatarCnpj, lerXmlNfe, somenteDigitos } from '../../dados/nfe'
import type { NotaXml } from '../../dados/nfe'
import { useFormulario } from '../../lib/useFormulario'
import { useSessao, useToast } from '../../lib/contexto'
import { moeda } from '../../lib/formato'
import { Botao, Chip, Entrada, Selecao } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { AreaTexto, Combo, LinhaCampos, ResumoErros } from '../ui/formulario'
import { Rolagem } from '../ui/Rolagem'
import type { DadosItemNota, DadosNotaFiscal } from '../../dados/comandos'
import type { Fornecedor, NotaFiscal } from '../../dados/tipos'

/**
 * Lançamento da entrada fiscal.
 *
 * Dois caminhos, e a ordem entre eles é a regra de produto (RN-L08): **o XML é
 * fonte, não anexo**. Quando o arquivo é enviado, cabeçalho, totais e itens
 * são extraídos dele e os campos ficam somente leitura — digitar o que já está
 * no documento é a origem mais comum de divergência fiscal, e é uma divergência
 * que só aparece na auditoria, quando ninguém lembra qual número estava certo.
 *
 * O único passo que continua humano com XML é vincular cada item da nota a um
 * modelo do catálogo. A descrição fiscal ("MULTIFUNC LASER MONO A4 40PPM") não
 * casa com o nome comercial, e um casamento automático errado é pior que a
 * digitação — porque ninguém o revisa.
 */

interface Props {
  aoFechar: () => void
  aoCriar?: (nota: NotaFiscal) => void
}

interface LinhaItem extends DadosItemNota {
  chave: string
}

interface Valores extends Record<string, unknown> {
  fornecedorId: string
  filialDestinoId: string
  numero: string
  serie: string
  chaveAcesso: string
  modeloDocumento: string
  dataEmissao: string
  dataEntrada: string
  valorProdutos: number
  valorFrete: number
  valorSeguro: number
  valorOutrasDespesas: number
  valorDesconto: number
  valorIpi: number
  valorIcms: number
  valorIcmsSt: number
  valorTotal: number
  icmsRecuperavel: boolean
  ipiRecuperavel: boolean
  observacao: string
  itens: LinhaItem[]
}

export function FormNotaFiscal({ aoFechar, aoCriar }: Props) {
  const { avisar } = useToast()
  const { usuario } = useSessao()
  const [fornecedores] = useState<Fornecedor[]>(() => api.baseSincrona().fornecedores)
  const filiais = api.baseSincrona().filiais

  const [xml, setXml] = useState<NotaXml | null>(null)
  const [erroXml, setErroXml] = useState<{ motivo: string; detalhe?: string } | null>(null)
  const entradaXml = useRef<HTMLInputElement>(null)

  const hoje = api.hoje().toISOString().slice(0, 10)

  const form = useFormulario<Valores, NotaFiscal>({
    inicial: {
      fornecedorId: '',
      filialDestinoId: filiais[0]!.id,
      numero: '',
      serie: '1',
      chaveAcesso: '',
      modeloDocumento: '55',
      dataEmissao: hoje,
      dataEntrada: hoje,
      valorProdutos: 0,
      valorFrete: 0,
      valorSeguro: 0,
      valorOutrasDespesas: 0,
      valorDesconto: 0,
      valorIpi: 0,
      valorIcms: 0,
      valorIcmsSt: 0,
      valorTotal: 0,
      icmsRecuperavel: false,
      ipiRecuperavel: false,
      observacao: '',
      itens: [],
    },
    validar: (v) => ({
      fornecedorId: v.fornecedorId ? undefined : 'Selecione o fornecedor emitente.',
      numero: v.numero.trim() ? undefined : 'Informe o número da nota.',
      serie: v.serie.trim() ? undefined : 'Informe a série.',
      dataEntrada:
        v.dataEntrada < v.dataEmissao
          ? 'A entrada não pode ser anterior à emissão.'
          : v.dataEntrada > hoje
            ? 'A entrada não pode ser em data futura.'
            : undefined,
      chaveAcesso:
        v.chaveAcesso && !chaveValida(v.chaveAcesso)
          ? 'A chave não passa na verificação do dígito. Confira os 44 dígitos.'
          : undefined,
      itens:
        v.itens.length === 0
          ? 'Acrescente ao menos um item.'
          : v.itens.some((i) => !i.modeloId)
            ? 'Vincule todos os itens a um modelo do catálogo.'
            : undefined,
    }),
    aoEnviar: (v) => {
      const dados: DadosNotaFiscal = {
        fornecedorId: v.fornecedorId,
        filialDestinoId: v.filialDestinoId,
        numero: v.numero,
        serie: v.serie,
        chaveAcesso: v.chaveAcesso ? somenteDigitos(v.chaveAcesso) : null,
        modeloDocumento: v.modeloDocumento,
        dataEmissao: v.dataEmissao,
        dataEntrada: v.dataEntrada,
        valorProdutos: v.valorProdutos,
        valorFrete: v.valorFrete,
        valorSeguro: v.valorSeguro,
        valorOutrasDespesas: v.valorOutrasDespesas,
        valorDesconto: v.valorDesconto,
        valorIpi: v.valorIpi,
        valorIcms: v.valorIcms,
        valorIcmsSt: v.valorIcmsSt,
        valorTotal: v.valorTotal,
        icmsRecuperavel: v.icmsRecuperavel,
        ipiRecuperavel: v.ipiRecuperavel,
        origemDados: xml ? 'XML' : 'MANUAL',
        observacao: v.observacao,
        itens: v.itens.map(({ chave: _chave, ...resto }) => resto),
      }
      return api.criarNotaFiscal(dados, usuario.nome)
    },
    aoConcluir: (nota) => {
      avisar({
        tom: 'ok',
        titulo: `Nota ${nota.serie}/${nota.numero} lançada`,
        texto: `${nota.itens.reduce((s, i) => s + i.quantidade, 0)} unidade(s) a identificar antes da conferência.`,
      })
      aoCriar?.(nota)
      aoFechar()
    },
  })

  /* --------------------------------------------------------------- XML --- */

  async function importar(arquivo: File | undefined) {
    if (!arquivo) return
    setErroXml(null)

    const conteudo = await arquivo.text()
    const leitura = lerXmlNfe(conteudo)
    if (!leitura.ok) {
      setErroXml({ motivo: leitura.motivo, detalhe: leitura.detalhe })
      setXml(null)
      if (entradaXml.current) entradaXml.current.value = ''
      return
    }

    const n = leitura.nota
    const emitente = fornecedores.find((f) => somenteDigitos(f.cnpj) === n.emitente.cnpj)
    if (!emitente) {
      // Cadastrar o fornecedor daqui seria conveniente e errado: o cadastro tem
      // dados fiscais que o XML da nota não traz completos, e um fornecedor
      // criado pela metade reaparece em toda compra seguinte.
      setErroXml({
        motivo: `O emitente ${formatarCnpj(n.emitente.cnpj)} não está cadastrado como fornecedor.`,
        detalhe: `${n.emitente.razaoSocial} — cadastre o fornecedor antes de lançar a nota.`,
      })
      setXml(null)
      return
    }

    setXml(n)
    form.redefinir({
      fornecedorId: emitente.id,
      numero: n.numero,
      serie: n.serie,
      chaveAcesso: n.chaveAcesso,
      modeloDocumento: n.modeloDocumento,
      dataEmissao: n.dataEmissao,
      // A entrada é a data em que a mercadoria chegou — o XML não a conhece.
      dataEntrada: n.dataEmissao > hoje ? hoje : hoje,
      valorProdutos: n.valorProdutos,
      valorFrete: n.valorFrete,
      valorSeguro: n.valorSeguro,
      valorOutrasDespesas: n.valorOutrasDespesas,
      valorDesconto: n.valorDesconto,
      valorIpi: n.valorIpi,
      valorIcms: n.valorIcms,
      valorIcmsSt: n.valorIcmsSt,
      valorTotal: n.valorTotal,
      itens: n.itens.map((i) => ({
        chave: `xml-${i.numeroItem}`,
        modeloId: sugerirModelo(i.descricao),
        descricaoNf: i.descricao,
        codigoFornecedor: i.codigoFornecedor,
        ncm: i.ncm,
        cfop: i.cfop,
        unidade: i.unidade,
        quantidade: i.quantidade,
        valorUnitario: i.valorUnitario,
        valorTotalItem: i.valorTotalItem,
        garantiaMeses: null,
      })),
    })
  }

  const travado = xml !== null
  const v = form.valores

  const partes = v.chaveAcesso && chaveValida(v.chaveAcesso) ? decomporChave(v.chaveAcesso) : null
  const custo = arredondar(
    v.valorTotal - (v.icmsRecuperavel ? v.valorIcms : 0) - (v.ipiRecuperavel ? v.valorIpi : 0),
  )
  const somaItens = arredondar(v.itens.reduce((s, i) => s + i.valorTotalItem, 0))
  const unidades = v.itens.reduce((s, i) => s + i.quantidade, 0)

  const opcoesModelo = useMemo(
    () =>
      MODELOS.map((m) => ({
        valor: m.id,
        texto: `${fabricantePorId.get(m.fabricanteId)?.nome ?? ''} ${m.nome}`.trim(),
        detalhe: m.categoria.replace(/_/g, ' ').toLowerCase(),
      })),
    [],
  )

  return (
    <Dialogo
      titulo="Registrar entrada de nota fiscal"
      descricao="Envie o XML da NF-e. Sem XML, o lançamento é manual — e os valores passam a depender de digitação."
      aoFechar={aoFechar}
      largura="largo"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Lançando…' : 'Lançar nota'}
          </Botao>
        </>
      }
    >
      <div className="pilha g5">
        <ResumoErros
          erros={form.errosResumo}
          erroGeral={form.erroGeral}
          rotulos={{
            fornecedorId: 'Fornecedor',
            numero: 'Número',
            serie: 'Série',
            dataEntrada: 'Data de entrada',
            chaveAcesso: 'Chave de acesso',
            itens: 'Itens',
            valorTotal: 'Total da nota',
            valorProdutos: 'Valor dos produtos',
          }}
          refResumo={form.refResumo}
        />

        {/* ------------------------------------------------------------ XML */}
        <section aria-label="Documento fiscal" className="pilha g3">
          <h3>Documento fiscal</h3>
          <div className="campo">
            <label className="campo__rotulo" htmlFor="campo-xml">
              XML da NF-e
            </label>
            <input
              ref={entradaXml}
              id="campo-xml"
              type="file"
              accept=".xml,text/xml,application/xml"
              aria-describedby="campo-xml-dica"
              onChange={(e) => void importar(e.target.files?.[0])}
            />
            <p className="campo__dica" id="campo-xml-dica">
              O XML é o documento original; o DANFE em PDF é só representação dele. Anexe o PDF depois de lançar.
            </p>
          </div>

          {erroXml && (
            <div className="aviso aviso--critico" role="alert">
              <span aria-hidden="true">⛔</span>
              <div>
                <p className="aviso__titulo">{erroXml.motivo}</p>
                {erroXml.detalhe && <p>{erroXml.detalhe}</p>}
              </div>
            </div>
          )}

          {xml && (
            <div className="aviso aviso--ok" role="status">
              <span aria-hidden="true">✓</span>
              <div>
                <p className="aviso__titulo">
                  XML lido: {xml.emitente.razaoSocial} · nota {xml.serie}/{xml.numero} · {xml.itens.length} item(ns)
                </p>
                <p>
                  Os campos abaixo vieram do arquivo e ficam somente leitura. Só o vínculo com o modelo do catálogo e
                  a garantia continuam sendo seus.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ------------------------------------------------------- cabeçalho */}
        <section aria-label="Cabeçalho da nota" className="pilha g4">
          <h3>Cabeçalho</h3>

          <Combo
            nome="fornecedorId"
            rotulo="Fornecedor emitente"
            opcoes={fornecedores.map((f) => ({
              valor: f.id,
              texto: f.razaoSocial,
              detalhe: `${formatarCnpj(f.cnpj)} · ${f.uf}`,
            }))}
            valor={v.fornecedorId}
            aoMudar={(x) => form.definir('fornecedorId', x)}
            vazio="Nenhum fornecedor com esse nome"
            dica={travado ? 'Identificado pelo CNPJ do emitente no XML.' : undefined}
            {...form.campo('fornecedorId')}
          />

          <LinhaCampos>
            <Entrada
              nome="numero"
              rotulo="Número"
              value={v.numero}
              readOnly={travado}
              onChange={(e) => form.definir('numero', e.target.value)}
              {...form.campo('numero')}
            />
            <Entrada
              nome="serie"
              rotulo="Série"
              value={v.serie}
              readOnly={travado}
              onChange={(e) => form.definir('serie', e.target.value)}
              {...form.campo('serie')}
            />
            <Selecao
              nome="modeloDocumento"
              rotulo="Modelo"
              disabled={travado}
              opcoes={[
                { valor: '55', texto: '55 — NF-e' },
                { valor: '65', texto: '65 — NFC-e' },
                { valor: '01', texto: '01 — Nota fiscal (modelo 1)' },
              ]}
              value={v.modeloDocumento}
              onChange={(e) => form.definir('modeloDocumento', e.target.value)}
            />
          </LinhaCampos>

          <Entrada
            nome="chaveAcesso"
            rotulo="Chave de acesso"
            dica={
              partes
                ? `Emitente ${formatarCnpj(partes.cnpjEmitente)} · série ${partes.serie} · nota ${partes.numero} · competência ${partes.competencia}`
                : 'Os 44 dígitos do rodapé do DANFE. O dígito verificador é conferido aqui.'
            }
            value={travado ? formatarChave(v.chaveAcesso) : v.chaveAcesso}
            readOnly={travado}
            inputMode="numeric"
            onChange={(e) => form.definir('chaveAcesso', somenteDigitos(e.target.value).slice(0, 44))}
            {...form.campo('chaveAcesso')}
          />

          <LinhaCampos>
            <Entrada
              nome="dataEmissao"
              rotulo="Emissão"
              type="date"
              value={v.dataEmissao}
              readOnly={travado}
              onChange={(e) => form.definir('dataEmissao', e.target.value)}
              {...form.campo('dataEmissao')}
            />
            <Entrada
              nome="dataEntrada"
              rotulo="Entrada na filial"
              dica="Data em que a mercadoria chegou — o XML não a conhece."
              type="date"
              value={v.dataEntrada}
              onChange={(e) => form.definir('dataEntrada', e.target.value)}
              {...form.campo('dataEntrada')}
            />
            <Selecao
              nome="filialDestinoId"
              rotulo="Filial de destino"
              dica="Onde os ativos nascem."
              opcoes={filiais.map((f) => ({ valor: f.id, texto: `${f.codigo} · ${f.nome}` }))}
              value={v.filialDestinoId}
              onChange={(e) => form.definir('filialDestinoId', e.target.value)}
            />
          </LinhaCampos>
        </section>

        {/* --------------------------------------------------------- valores */}
        <section aria-label="Valores da nota" className="pilha g4">
          <h3>Valores</h3>

          <Rolagem rotulo="Tabela de dados">
            <table>
              <caption className="so-leitor">Composição de valores da nota fiscal</caption>
              <thead>
                <tr>
                  <th scope="col">Componente</th>
                  <th scope="col" className="numerico">
                    Valor
                  </th>
                  <th scope="col">Entra no custo do ativo?</th>
                </tr>
              </thead>
              <tbody>
                <LinhaValor rotulo="Produtos" valor={v.valorProdutos} entra="Sim" />
                <LinhaValor rotulo="Frete" valor={v.valorFrete} entra="Sim" />
                <LinhaValor rotulo="Seguro" valor={v.valorSeguro} entra="Sim" />
                <LinhaValor rotulo="Outras despesas" valor={v.valorOutrasDespesas} entra="Sim" />
                <LinhaValor rotulo="ICMS-ST" valor={v.valorIcmsSt} entra="Sim — nunca recuperável" />
                <LinhaValor
                  rotulo="IPI"
                  valor={v.valorIpi}
                  entra={v.ipiRecuperavel ? 'Não — creditado' : 'Sim'}
                />
                <LinhaValor
                  rotulo="ICMS destacado"
                  valor={v.valorIcms}
                  entra={v.icmsRecuperavel ? 'Não — creditado' : 'Sim — está no valor dos produtos'}
                />
                <LinhaValor rotulo="Desconto" valor={-v.valorDesconto} entra="Reduz" />
                <tr>
                  <th scope="row">Total da nota</th>
                  <td className="numerico dado">{moeda(v.valorTotal)}</td>
                  <td className="texto-atenuado">vNF do layout 4.00</td>
                </tr>
                <tr>
                  <th scope="row">Custo de aquisição</th>
                  <td className="numerico dado">{moeda(custo)}</td>
                  <td className="texto-atenuado">base do rateio e da depreciação</td>
                </tr>
              </tbody>
            </table>
          </Rolagem>

          {!travado && (
            <LinhaCampos>
              <Entrada
                nome="valorProdutos"
                rotulo="Produtos (R$)"
                type="number"
                step="0.01"
                value={String(v.valorProdutos)}
                onChange={(e) => form.definir('valorProdutos', Number(e.target.value))}
                {...form.campo('valorProdutos')}
              />
              <Entrada
                nome="valorFrete"
                rotulo="Frete (R$)"
                type="number"
                step="0.01"
                value={String(v.valorFrete)}
                onChange={(e) => form.definir('valorFrete', Number(e.target.value))}
              />
              <Entrada
                nome="valorDesconto"
                rotulo="Desconto (R$)"
                type="number"
                step="0.01"
                value={String(v.valorDesconto)}
                onChange={(e) => form.definir('valorDesconto', Number(e.target.value))}
              />
              <Entrada
                nome="valorTotal"
                rotulo="Total da nota (R$)"
                type="number"
                step="0.01"
                value={String(v.valorTotal)}
                onChange={(e) => form.definir('valorTotal', Number(e.target.value))}
                {...form.campo('valorTotal')}
              />
            </LinhaCampos>
          )}

          {/*
            O regime fica gravado NA NOTA, não só em parâmetro global: mudar o
            regime da empresa não pode reprecificar uma aquisição já feita.
            O padrão é não recuperável porque locação de bem móvel não é fato
            gerador de ICMS (Súmula 573 do STF) — a locadora pura não se credita.
          */}
          <fieldset className="grupo-opcoes">
            <legend>Aproveitamento de crédito nesta nota</legend>
            <p className="campo__dica">
              Padrão de locadora pura: nenhum crédito. Marcar muda o custo do ativo e, por consequência, a
              depreciação e a margem.
            </p>
            <div className="grupo-opcoes__itens">
              <label className="opcao" data-marcada={v.icmsRecuperavel}>
                <input
                  type="checkbox"
                  checked={v.icmsRecuperavel}
                  onChange={(e) => form.definir('icmsRecuperavel', e.target.checked)}
                />
                <span>
                  <span className="opcao__texto">Creditar o ICMS ({moeda(v.valorIcms)})</span>
                  <br />
                  <span className="opcao__detalhe">exige controle CIAP em 48 parcelas</span>
                </span>
              </label>
              <label className="opcao" data-marcada={v.ipiRecuperavel}>
                <input
                  type="checkbox"
                  checked={v.ipiRecuperavel}
                  onChange={(e) => form.definir('ipiRecuperavel', e.target.checked)}
                />
                <span>
                  <span className="opcao__texto">Creditar o IPI ({moeda(v.valorIpi)})</span>
                  <br />
                  <span className="opcao__detalhe">só para industrial ou equiparado</span>
                </span>
              </label>
            </div>
          </fieldset>
        </section>

        {/* ----------------------------------------------------------- itens */}
        <section aria-label="Itens da nota" className="pilha g3">
          <div className="linha entre base envolver g3">
            <h3>Itens</h3>
            <span className="texto-atenuado">
              {v.itens.length} item(ns) · {unidades} unidade(s) · {moeda(somaItens)}
            </span>
          </div>

          {somaItens !== v.valorProdutos && v.itens.length > 0 && (
            <div className="aviso aviso--atencao" role="status">
              <span aria-hidden="true">▲</span>
              <div>
                <p className="aviso__titulo">
                  A soma dos itens ({moeda(somaItens)}) não fecha com o valor dos produtos ({moeda(v.valorProdutos)}).
                </p>
                <p>Diferença de {moeda(Math.abs(arredondar(somaItens - v.valorProdutos)))}.</p>
              </div>
            </div>
          )}

          {v.itens.length === 0 ? (
            <p className="texto-secundario">
              Nenhum item. Envie o XML ou acrescente manualmente.
            </p>
          ) : (
            <div className="pilha g4">
              {v.itens.map((item, i) => (
                <div key={item.chave} className="cartao cartao--compacto pilha g3">
                  <div className="linha entre base envolver g3">
                    <strong>
                      Item {i + 1}
                      {item.ncm && <span className="texto-atenuado"> · NCM {item.ncm}</span>}
                      {item.cfop && <span className="texto-atenuado"> · CFOP {item.cfop}</span>}
                    </strong>
                    <span className="dado">
                      {item.quantidade} × {moeda(item.valorUnitario)} = {moeda(item.valorTotalItem)}
                    </span>
                  </div>

                  <p className="dado texto-secundario">{item.descricaoNf}</p>

                  <LinhaCampos>
                    <Combo
                      nome={`modelo-${i}`}
                      rotulo="Modelo do catálogo"
                      dica="A descrição fiscal raramente coincide com o nome comercial — este vínculo é humano de propósito."
                      opcoes={opcoesModelo}
                      valor={item.modeloId}
                      aoMudar={(x) => atualizarItem(form, i, { modeloId: x })}
                      vazio="Nenhum modelo com esse nome"
                    />
                    <Entrada
                      nome={`garantia-${i}`}
                      rotulo="Garantia (meses)"
                      dica="Contada a partir da entrada."
                      type="number"
                      min="1"
                      value={item.garantiaMeses === null ? '' : String(item.garantiaMeses)}
                      onChange={(e) =>
                        atualizarItem(form, i, {
                          garantiaMeses: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    />
                  </LinhaCampos>

                  {!travado && (
                    <div className="linha g2 envolver">
                      <Botao
                        pequeno
                        variante="sutil"
                        onClick={() =>
                          form.definir(
                            'itens',
                            v.itens.filter((_, j) => j !== i),
                          )
                        }
                      >
                        Remover item {i + 1}
                      </Botao>
                    </div>
                  )}

                  {item.modeloId && (
                    <p className="texto-atenuado">
                      Vinculado a {modeloPorId.get(item.modeloId)?.nome}. Cada unidade vira um ativo próprio na
                      integração.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {!travado && (
            <div className="linha g2 envolver">
              <Botao
                onClick={() =>
                  form.definir('itens', [
                    ...v.itens,
                    {
                      chave: `manual-${v.itens.length}-${Date.now()}`,
                      modeloId: '',
                      descricaoNf: '',
                      quantidade: 1,
                      valorUnitario: 0,
                      valorTotalItem: 0,
                      garantiaMeses: 12,
                    },
                  ])
                }
              >
                Acrescentar item
              </Botao>
            </div>
          )}
        </section>

        {v.itens.length > 0 && !travado && <ItensManuais form={form} />}

        <AreaTexto
          nome="observacao"
          rotulo="Observação (opcional)"
          limite={300}
          value={v.observacao}
          onChange={(e) => form.definir('observacao', e.target.value)}
        />

        <p className="texto-atenuado">
          A nota entra como <Chip severidade="atencao">Pendente de conferência</Chip> — nenhum ativo é criado agora.
          As unidades são identificadas por série e patrimônio no passo seguinte.
        </p>
      </div>
    </Dialogo>
  )
}

/* -------------------------------------------------------------------------- */

function LinhaValor({ rotulo, valor, entra }: { rotulo: string; valor: number; entra: string }) {
  return (
    <tr>
      <th scope="row">{rotulo}</th>
      <td className="numerico dado">{moeda(valor)}</td>
      <td className="texto-atenuado">{entra}</td>
    </tr>
  )
}

/**
 * Campos de quantidade e valor dos itens digitados à mão.
 *
 * Separado do bloco acima porque com XML eles não existem: os valores vêm do
 * arquivo e editá-los seria justamente a divergência que RN-L08 evita.
 */
function ItensManuais({ form }: { form: ReturnType<typeof useFormulario<Valores, NotaFiscal>> }) {
  const v = form.valores
  return (
    <section aria-label="Valores dos itens digitados" className="pilha g3">
      <h3>Quantidades e valores dos itens</h3>
      {v.itens.map((item, i) => (
        <LinhaCampos key={`vals-${item.chave}`}>
          <Entrada
            nome={`descricao-${i}`}
            rotulo={`Descrição do item ${i + 1}`}
            dica="Como está escrito na nota."
            value={item.descricaoNf}
            onChange={(e) => atualizarItem(form, i, { descricaoNf: e.target.value })}
          />
          <Entrada
            nome={`qtd-${i}`}
            rotulo="Quantidade"
            type="number"
            min="1"
            step="1"
            value={String(item.quantidade)}
            onChange={(e) => {
              const q = Math.max(1, Math.round(Number(e.target.value) || 1))
              atualizarItem(form, i, { quantidade: q, valorTotalItem: arredondar(q * item.valorUnitario) })
            }}
          />
          <Entrada
            nome={`unit-${i}`}
            rotulo="Valor unitário (R$)"
            type="number"
            step="0.01"
            value={String(item.valorUnitario)}
            onChange={(e) => {
              const u = Number(e.target.value) || 0
              atualizarItem(form, i, { valorUnitario: u, valorTotalItem: arredondar(u * item.quantidade) })
            }}
          />
        </LinhaCampos>
      ))}
    </section>
  )
}

function atualizarItem(
  form: ReturnType<typeof useFormulario<Valores, NotaFiscal>>,
  indice: number,
  mudanca: Partial<LinhaItem>,
) {
  form.definir(
    'itens',
    form.valores.itens.map((it, j) => (j === indice ? { ...it, ...mudanca } : it)),
  )
}

/**
 * Sugere o modelo pela descrição fiscal — sem nunca decidir por conta própria.
 *
 * Só sugere quando **um único** modelo do catálogo tem o nome contido na
 * descrição. Empate ou ausência devolve vazio, e o operador escolhe. Uma
 * sugestão errada aceita em silêncio é pior que nenhuma: o ativo nasce com o
 * modelo trocado e ninguém revisa depois.
 */
function sugerirModelo(descricao: string): string {
  const alvo = descricao
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()

  const candidatos = MODELOS.filter((m) => {
    const nome = m.nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
    return nome.length >= 4 && alvo.includes(nome)
  })

  return candidatos.length === 1 ? candidatos[0]!.id : ''
}
