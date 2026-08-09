/**
 * Chave de acesso e XML da NF-e (layout 4.00).
 *
 * Este arquivo existe por causa de uma regra de produto, não de tecnologia:
 * **o XML é fonte, não anexo** (RN-L08). Quando o arquivo está disponível,
 * cabeçalho, totais e itens são extraídos dele e os campos ficam somente
 * leitura. Digitar o que já está no documento é a origem mais comum de
 * divergência fiscal — e é uma divergência que só aparece na auditoria, anos
 * depois, quando ninguém lembra qual dos dois números estava certo.
 *
 * O XML da NF-e é *o* documento original; o DANFE em PDF é representação dele
 * (Ajuste SINIEF 07/05). Por isso a extração parte do XML e o PDF é anexo.
 */

/* ------------------------------------------------------- chave de acesso --- */

/**
 * Dígito verificador da chave de acesso: módulo 11, pesos 2–9 cíclicos, da
 * direita para a esquerda sobre os 43 primeiros dígitos.
 *
 * Espelha `app.dv_chave_nfe` na migração 0010. A duplicação é deliberada: o
 * banco precisa da regra para recusar escrita por qualquer caminho, e o
 * formulário precisa dela para avisar *antes* de enviar. As duas
 * implementações são cobertas pelos respectivos testes.
 */
export function dvChaveNfe(chave43: string): number | null {
  if (!/^\d{43}$/.test(chave43)) return null

  let soma = 0
  let peso = 2
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave43[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }

  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

export function chaveValida(chave: string): boolean {
  const limpa = somenteDigitos(chave)
  if (!/^\d{44}$/.test(limpa)) return false
  return dvChaveNfe(limpa.slice(0, 43)) === Number(limpa[43])
}

export interface ChaveDecomposta {
  uf: string
  competencia: string
  cnpjEmitente: string
  modelo: string
  serie: string
  numero: string
  tipoEmissao: string
  codigoNumerico: string
  dv: string
}

/**
 * Decompõe a chave nos campos que ela carrega.
 *
 * cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
 *
 * Serve para a conferência que o DV não faz: uma chave pode estar íntegra e
 * ainda assim ser **de outra nota**. Emitente, série e número divergentes do
 * cabeçalho significam XML trocado.
 */
export function decomporChave(chave: string): ChaveDecomposta | null {
  const limpa = somenteDigitos(chave)
  if (!/^\d{44}$/.test(limpa)) return null

  const aa = limpa.slice(2, 4)
  const mm = limpa.slice(4, 6)
  return {
    uf: limpa.slice(0, 2),
    competencia: `20${aa}-${mm}`,
    cnpjEmitente: limpa.slice(6, 20),
    modelo: limpa.slice(20, 22),
    serie: String(Number(limpa.slice(22, 25))),
    numero: String(Number(limpa.slice(25, 34))),
    tipoEmissao: limpa.slice(34, 35),
    codigoNumerico: limpa.slice(35, 43),
    dv: limpa.slice(43),
  }
}

export const somenteDigitos = (v: string) => v.replace(/\D/g, '')

/** Formatação da chave em blocos de 4, como no DANFE. */
export function formatarChave(chave: string): string {
  const limpa = somenteDigitos(chave)
  return limpa.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

export function formatarCnpj(doc: string): string {
  const d = somenteDigitos(doc)
  if (d.length !== 14) return doc
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/* ------------------------------------------------------------- XML da NF-e - */

export interface ItemXml {
  numeroItem: number
  codigoFornecedor: string
  descricao: string
  ncm: string
  cfop: string
  unidade: string
  quantidade: number
  valorUnitario: number
  valorTotalItem: number
}

export interface NotaXml {
  chaveAcesso: string
  modeloDocumento: string
  serie: string
  numero: string
  dataEmissao: string
  emitente: { cnpj: string; razaoSocial: string; uf: string; inscricaoEstadual: string }
  destinatarioCnpj: string
  valorProdutos: number
  valorFrete: number
  valorSeguro: number
  valorOutrasDespesas: number
  valorDesconto: number
  valorIpi: number
  valorIcms: number
  valorIcmsSt: number
  valorTotal: number
  itens: ItemXml[]
}

export type LeituraXml = { ok: true; nota: NotaXml } | { ok: false; motivo: string; detalhe?: string }

/**
 * Lê o XML de uma NF-e e devolve o que a nota declara.
 *
 * Aceita `nfeProc` (o arquivo autorizado, com protocolo) e `NFe` solto — o
 * emitente manda ora um, ora outro, e recusar o segundo obrigaria o operador a
 * abrir o arquivo num editor para descobrir por quê.
 *
 * O que **não** é feito aqui: assumir que o arquivo é confiável porque é XML.
 * Cada valor é conferido contra a estrutura da chave e contra o próprio
 * somatório da nota antes de virar sugestão de preenchimento.
 */
export function lerXmlNfe(conteudo: string): LeituraXml {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(conteudo, 'application/xml')
  } catch {
    return { ok: false, motivo: 'O arquivo não é um XML válido.' }
  }

  // DOMParser não lança em XML malformado: devolve um documento contendo
  // <parsererror>. Sem esta verificação, um PDF renomeado para .xml passaria
  // adiante e falharia depois, sem explicação.
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) {
    return {
      ok: false,
      motivo: 'O arquivo não é um XML válido.',
      detalhe: 'Verifique se não é o DANFE em PDF renomeado — o XML é outro arquivo, enviado pelo emitente.',
    }
  }

  const inf = primeiro(doc.documentElement, 'infNFe')
  if (!inf) {
    return {
      ok: false,
      motivo: 'Este XML não é de uma NF-e.',
      detalhe: 'Não foi encontrado o grupo infNFe. XML de evento (cancelamento, carta de correção) não serve como entrada.',
    }
  }

  const chave = somenteDigitos(inf.getAttribute('Id') ?? '')
  if (!chaveValida(chave)) {
    return {
      ok: false,
      motivo: 'A chave de acesso do XML não passa na verificação do dígito.',
      detalhe: chave ? `Chave lida: ${formatarChave(chave)}` : 'O atributo Id de infNFe está ausente ou vazio.',
    }
  }

  const ide = primeiro(inf, 'ide')
  const emit = primeiro(inf, 'emit')
  const total = primeiro(inf, 'ICMSTot')
  if (!ide || !emit || !total) {
    return {
      ok: false,
      motivo: 'O XML está incompleto.',
      detalhe: 'Faltam os grupos ide, emit ou total/ICMSTot exigidos pelo layout 4.00.',
    }
  }

  const partes = decomporChave(chave)!
  const modelo = texto(ide, 'mod') || partes.modelo
  const serie = texto(ide, 'serie') || partes.serie
  const numero = texto(ide, 'nNF') || partes.numero
  const cnpjEmitente = somenteDigitos(texto(emit, 'CNPJ'))

  // A chave é a única parte do XML que carrega verificação própria. Divergir
  // dela é sinal de arquivo montado à mão ou de dois documentos misturados.
  if (cnpjEmitente && cnpjEmitente !== partes.cnpjEmitente) {
    return {
      ok: false,
      motivo: 'O XML é inconsistente: o CNPJ do emitente não bate com a chave de acesso.',
      detalhe: `Emitente declarado ${formatarCnpj(cnpjEmitente)}, chave referente a ${formatarCnpj(partes.cnpjEmitente)}.`,
    }
  }
  if (String(Number(numero)) !== partes.numero || String(Number(serie)) !== partes.serie) {
    return {
      ok: false,
      motivo: 'O XML é inconsistente: número ou série divergem da chave de acesso.',
      detalhe: `Cabeçalho ${serie}/${numero}, chave ${partes.serie}/${partes.numero}.`,
    }
  }

  const itens: ItemXml[] = elementos(inf, 'det').map((det, i) => {
    const prod = primeiro(det, 'prod')
    return {
      numeroItem: Number(det.getAttribute('nItem')) || i + 1,
      codigoFornecedor: prod ? texto(prod, 'cProd') : '',
      descricao: prod ? texto(prod, 'xProd') : '',
      ncm: prod ? somenteDigitos(texto(prod, 'NCM')) : '',
      cfop: prod ? somenteDigitos(texto(prod, 'CFOP')) : '',
      unidade: (prod ? texto(prod, 'uCom') : '') || 'UN',
      quantidade: prod ? numero_(texto(prod, 'qCom')) : 0,
      valorUnitario: prod ? numero_(texto(prod, 'vUnCom')) : 0,
      valorTotalItem: prod ? numero_(texto(prod, 'vProd')) : 0,
    }
  })

  if (itens.length === 0) {
    return { ok: false, motivo: 'O XML não tem itens.', detalhe: 'Uma nota sem item não descreve compra alguma.' }
  }

  const naoInteira = itens.find((i) => !Number.isInteger(i.quantidade) || i.quantidade <= 0)
  if (naoInteira) {
    // Equipamento é unidade contável e vira patrimônio individual. Quantidade
    // fracionária significa que a nota tem serviço ou insumo — outro fluxo.
    return {
      ok: false,
      motivo: `O item ${naoInteira.numeroItem} tem quantidade ${naoInteira.quantidade}, que não é uma contagem de unidades.`,
      detalhe: 'Esta entrada registra bens que viram patrimônio. Nota de serviço ou de insumo tem outro fluxo.',
    }
  }

  const nota: NotaXml = {
    chaveAcesso: chave,
    modeloDocumento: modelo,
    serie,
    numero,
    dataEmissao: (texto(ide, 'dhEmi') || texto(ide, 'dEmi')).slice(0, 10),
    emitente: {
      cnpj: cnpjEmitente || partes.cnpjEmitente,
      razaoSocial: texto(emit, 'xNome'),
      uf: texto(emit, 'UF'),
      inscricaoEstadual: texto(emit, 'IE'),
    },
    destinatarioCnpj: somenteDigitos(texto(primeiro(inf, 'dest'), 'CNPJ')),
    valorProdutos: numero_(texto(total, 'vProd')),
    valorFrete: numero_(texto(total, 'vFrete')),
    valorSeguro: numero_(texto(total, 'vSeg')),
    valorOutrasDespesas: numero_(texto(total, 'vOutro')),
    valorDesconto: numero_(texto(total, 'vDesc')),
    valorIpi: numero_(texto(total, 'vIPI')),
    valorIcms: numero_(texto(total, 'vICMS')),
    valorIcmsSt: numero_(texto(total, 'vST')),
    valorTotal: numero_(texto(total, 'vNF')),
    itens,
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(nota.dataEmissao)) {
    return { ok: false, motivo: 'A data de emissão do XML não pôde ser lida.' }
  }

  return { ok: true, nota }
}

/**
 * Confere o somatório da nota: vNF = vProd + vST + vFrete + vSeg + vOutro +
 * vIPI − vDesc (grupo ICMSTot do layout 4.00).
 *
 * Devolve a diferença em reais, ou `null` quando fecha. Um centavo de
 * diferença já é sinal de XML editado à mão — e é exatamente o que o CHECK do
 * banco vai recusar depois, com uma mensagem bem menos útil.
 */
export function diferencaTotal(n: {
  valorProdutos: number
  valorIcmsSt: number
  valorFrete: number
  valorSeguro: number
  valorOutrasDespesas: number
  valorIpi: number
  valorDesconto: number
  valorTotal: number
}): number | null {
  const esperado =
    n.valorProdutos + n.valorIcmsSt + n.valorFrete + n.valorSeguro + n.valorOutrasDespesas + n.valorIpi - n.valorDesconto
  const dif = arredondar(n.valorTotal - esperado)
  return Math.abs(dif) < 0.005 ? null : dif
}

/** Duas casas, sem o erro de ponto flutuante que faz 0.1 + 0.2 não fechar. */
export const arredondar = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/* -------------------------------------------------------------- travessia -- */

/**
 * Busca por `localName`, não por nome qualificado.
 *
 * O XML da NF-e declara o namespace `portalfiscal.inf.br/nfe`, e alguns
 * emissores o prefixam. `getElementsByTagName('ide')` funciona no primeiro
 * caso e falha silenciosamente no segundo — devolvendo uma nota com todos os
 * campos vazios, que é pior do que um erro.
 */
function elementos(raiz: Element | null, nome: string): Element[] {
  if (!raiz) return []
  const achados: Element[] = []
  const fila: Element[] = [raiz]
  while (fila.length) {
    const atual = fila.shift()!
    for (const filho of Array.from(atual.children)) {
      if (filho.localName === nome) achados.push(filho)
      else fila.push(filho)
    }
  }
  return achados
}

function primeiro(raiz: Element | null, nome: string): Element | null {
  return elementos(raiz, nome)[0] ?? null
}

function texto(raiz: Element | null, nome: string): string {
  return primeiro(raiz, nome)?.textContent?.trim() ?? ''
}

function numero_(v: string): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
