/**
 * Permissões e rotas, um contra o outro.
 *
 * Dois sentidos, e cada um fecha uma porta diferente.
 *
 * **Rota → catálogo.** Uma rota não pode exigir permissão que o catálogo não
 * tem. Sem isto, acrescentar `@ExigePermissao('os:despachar')` compila, roda e
 * cria uma permissão que perfil nenhum concede — a rota fica inalcançável para
 * todo mundo, e o defeito aparece como "o botão não faz nada" semanas depois.
 * É também o que impede inventar permissão em vez de decidi-la no Anexo C.
 *
 * **Catálogo → rota.** Uma permissão sem rota é uma capacidade prometida e não
 * construída. Ela não quebra nada — e é justamente esse o problema: fica
 * décadas no catálogo parecendo implementada.
 *
 * Este segundo sentido é o que faltava, e custou caro. O Anexo X afirmava que
 * Ordens de Serviço e Estoque eram "pendência de **especificação**". Eram
 * pendência de construção: a especificação estava escrita em quatro anexos, e
 * dezesseis permissões já nomeavam as capacidades. Ninguém reabriu o anexo
 * para conferir, porque nada obrigava a conferir.
 *
 * `SEM_ROTA_JUSTIFICADA` é o lugar onde essa conferência passa a ser
 * obrigatória: entrar nela exige escrever por quê, e sair dela é o que
 * acontece quando a rota é construída. A lista só encolhe.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PERMISSOES } from '../../../packages/contracts/dist/catalogo-permissoes.js'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const controllers = join(raiz, 'apps', 'api', 'src')

function arquivos(dir: string): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho))
    else if (nome.endsWith('.controller.ts')) saida.push(caminho)
  }
  return saida
}

const fontes = arquivos(controllers).map((f) => readFileSync(f, 'utf8'))

/** Permissões exigidas por alguma rota. */
const exigidas = new Set<string>()
for (const src of fontes) {
  for (const m of src.matchAll(/@ExigePermissao\('([^']+)'\)/g)) exigidas.add(m[1]!)
}

const catalogo = new Set<string>(PERMISSOES as readonly string[])

/**
 * Permissões do catálogo que ainda não têm rota — e por quê.
 *
 * Cada entrada é uma decisão registrada, não uma lacuna tolerada. A razão
 * importa porque ela é o que distingue "não construímos ainda" de "não
 * construímos porque não há tela que use", e as duas pedem trabalho diferente.
 */
const SEM_ROTA_JUSTIFICADA: Record<string, string> = {
  /*
   * Módulos inteiros sem tela no front.
   *
   * Construir API para tela que não existe é construir contra suposição: a
   * forma da resposta sai do que alguém imagina que a tela vai pedir, e a tela
   * real pede outra coisa. Ficam aqui até existir a tela — ou até alguém
   * decidir que o módulo é de integração e não de interface, que é uma
   * decisão legítima e também precisa ser escrita.
   */
  'plano_preventivo:gerenciar': 'manutenção preventiva programada: sem tela no front',
  'relatorio:criar': 'relatórios sob demanda: sem tela no front',
  'relatorio:ler': 'idem',
  'relatorio:agendar': 'idem',

  /*
   * Faturamento — e a razão mudou depois da 0030.
   *
   * O motivo registrado era "modelagem pendente", e estava errado: a cobrança
   * contratual já era `titulo_receber`, e a composição dela passou a ser
   * `titulo_receber_item`. O que falta não é tabela.
   *
   * O que falta é **emissão fiscal**: série, chave de NF-e, linha digitável de
   * boleto. Isso é integração com a SEFAZ e com um emissor, e depende de
   * decisões que ninguém tomou — qual provedor, qual regime tributário, qual
   * série por filial. Modelar os campos agora seria criar colunas cujo
   * preenchimento ninguém sabe descrever.
   *
   * Pendência de **decisão**, portanto, e não de construção. A distinção
   * importa: a primeira espera alguém escolher, a segunda espera alguém
   * trabalhar — e tratá-las igual faz a segunda parecer bloqueada quando não
   * está.
   */
  'prefatura:gerar': 'a prévia já existe como previa-fechamento; falta a emissão fiscal',
  'prefatura:editar': 'idem',
  'prefatura:aprovar': 'aprovação já existe em contas a receber, por alçada',
  'fatura:emitir': 'emissão fiscal: pendência de decisão (provedor, regime, série)',
  'fatura:cancelar': 'o cancelamento da cobrança existe em contas a receber',
  'fatura:desconto_aplicar': 'o desconto existe em contas a receber',
  'fatura:nota_correcao': 'nota de correção: depende do mesmo provedor fiscal',
  'faturamento:exportar': 'exportação fiscal: depende do mesmo provedor',

  /*
   * Capacidades transversais que hoje são de configuração de ambiente, não de
   * rota: não há tela nem necessidade de API para elas.
   */
  'apikey:gerenciar': 'chaves de integração: configuração de ambiente, sem rota',
  'webhook:gerenciar': 'idem',
  'integracao:gerenciar': 'idem',
  'parametro:gerenciar': 'parâmetros do locatário: configuração, sem tela',

  /*
   * Restam duas do eixo de parque, e as duas dependem de coisa que o módulo
   * não tem — não de tempo de digitação.
   */
  'equipamento:etiqueta_gerar':
    'etiqueta/QR: depende de um codificador de QR Code, que é dependência nova; o token já existe em equipamento.qr_token',
  'equipamento:importar':
    'carga em massa: o Anexo D especifica 202 + job_id, e não há executor de trabalho assíncrono no projeto',

  /*
   * Medição: consolidar e estimar são do fechamento de competência, que hoje
   * acontece por `competencia:fechar`. Ficam até a prévia de fechamento ganhar
   * as duas ações separadas.
   */
  'medicao:consolidar': 'parte do fechamento de competência, sem ação própria ainda',
  'medicao:estimar': 'idem',


  /* Técnico: cadastro pendente; a leitura entra por `os:ler`. */

  /* Comercial: edição de tabela pendente; a leitura já existe. */
  'comercial:gerenciar': 'edição de política comercial: tela pendente',


  /* Mapa: compartilhar filtro é recurso de colaboração, sem tela. */
  'mapa:filtro_compartilhar': 'compartilhamento de filtro: sem tela',

  /*
   * Não tem rota porque **não governa uma rota**, e isso é desenho, não
   * pendência.
   *
   * Criar uma visão pessoal e publicar uma para a operação inteira entram pelo
   * mesmo `POST /visoes`; só o valor de `compartilhada` no corpo distingue as
   * duas. Declarar a permissão na rota tiraria de quem opera a capacidade de
   * salvar o próprio recorte — o problema que a fase 3 existe para resolver.
   *
   * Quem confere é o gatilho da 0038, que vê o corpo. É a mesma divisão das
   * alçadas: a permissão da rota responde "pode fazer isto?", o banco responde
   * "até onde?".
   */
  'visao:compartilhar': 'regra de corpo, não de rota: conferida no gatilho da 0038 (ver POST /visoes)',

  /*
   * Como `contrato:desconto_conceder`: conferida no corpo, não no decorador.
   *
   * `os:custo_aprovar` é exigida em `validar` quando o custo apurado passa do
   * teto do validador. A maioria das ordens é barata, e exigi-la na rota
   * inteira obrigaria todo supervisor a tê-la para validar qualquer coisa.
   * O Anexo C descreve a permissão e o Anexo D **não lhe dá rota** — essa
   * ausência é o que diz que ela é condição sobre um passo, não um passo.
   */
  'os:custo_aprovar':
    'exigida no corpo de POST /ordens-servico/{id}/validar quando o custo passa do teto, não por decorador',

  /* Auditoria e sensíveis: leitura por tela ainda não construída. */
  'dados_sensiveis:ver_completo': 'mascaramento ainda não ligado na interface (ver X.3)',

  /* Financeiro: exportação pendente. */
  'financeiro:exportar': 'exportação: sem rota',

  /*
   * Ciclo de vida do contrato — e a lacuna maior que o portão encontrou.
   *
   * Eu tinha escrito esta lista à mão antes de rodar o teste, e ela não
   * incluía nenhuma destas. São dezoito ações de ciclo previstas no Anexo B.2
   * e no catálogo, com a máquina de estados de contrato já no banco: aprovar,
   * ativar, suspender, retomar, renovar, encerrar, distratar, cancelar.
   *
   * **Construídas.** Nove das dezoito saíram desta lista quando as rotas
   * entraram: submeter, aprovar, reprovar, ativar, suspender, retomar,
   * renovar, encerrar, distratar e cancelar. Ficam as de reajuste, desconto e
   * item, que dependem de alçada e de cálculo ainda não construídos.
   *
   * O que a lista provou ao encolher é o que ela existe para provar: entrar
   * exige escrever por quê, sair acontece sozinho quando a rota aparece, e um
   * teste reprova quem esquecer de tirar.
   */
  /*
   * Conferida no corpo, não no decorador — e por isso fica aqui.
   *
   * `contrato:desconto_conceder` é exigida em `alocarItem` quando o payload
   * traz desconto; a mesma alocação sem desconto continua precisando apenas de
   * `contrato:item_alocar`. Pôr `@ExigePermissao('contrato:desconto_conceder')`
   * na rota obrigaria todo operador a tê-la para alocar, que é o colapso
   * oposto ao que RN-009 quer evitar.
   *
   * Este portão lê decoradores, então ele não a enxerga. Declará-la como
   * "coberta" afrouxaria a medição; deixá-la aqui com o motivo certo mantém a
   * lista verdadeira — ela registra o que o portão não alcança, não só o que
   * não foi construído.
   */
  'contrato:desconto_conceder':
    'exigida no corpo de POST /contratos/{id}/itens (RN-009), não por decorador de rota',

  /* Outras ações previstas e não construídas. */
}

test('a massa é a esperada — o portão não pode passar vazio', () => {
  assert.ok(catalogo.size >= 100, `só ${catalogo.size} permissões no catálogo`)
  assert.ok(fontes.length >= 20, `só ${fontes.length} controllers encontrados`)
  assert.ok(exigidas.size >= 40, `só ${exigidas.size} permissões exigidas por rotas`)
})

test('nenhuma rota exige permissão fora do catálogo', () => {
  const inventadas = [...exigidas].filter((p) => !catalogo.has(p)).sort()

  assert.deepEqual(
    inventadas,
    [],
    'rota exigindo permissão que não está no catálogo do Anexo C.\n' +
      'Permissão inventada na rota não é concedida por perfil nenhum: a rota fica\n' +
      'inalcançável para todo mundo, e o defeito aparece como "o botão não faz nada".\n' +
      'Decida a permissão no catálogo antes de usá-la aqui.',
  )
})

test('toda permissão do catálogo tem rota, ou uma razão escrita para não ter', () => {
  const orfas = [...catalogo]
    .filter((p) => !exigidas.has(p) && !(p in SEM_ROTA_JUSTIFICADA))
    .sort()

  assert.deepEqual(
    orfas,
    [],
    'permissão no catálogo sem rota e sem justificativa.\n' +
      'Ou construa a rota, ou registre em SEM_ROTA_JUSTIFICADA dizendo por que não.\n' +
      'Permissão sem rota não quebra nada — e é por isso que fica anos no catálogo\n' +
      'parecendo implementada. Foi assim que "Ordens de Serviço: pendência de\n' +
      'especificação" sobreviveu no Anexo X a uma especificação que já existia.',
  )
})

test('a lista de justificadas não guarda permissão que já ganhou rota', () => {
  const obsoletas = Object.keys(SEM_ROTA_JUSTIFICADA)
    .filter((p) => exigidas.has(p))
    .sort()

  assert.deepEqual(
    obsoletas,
    [],
    'justificativa para permissão que já tem rota.\n' +
      'A lista só encolhe: entrada que não se aplica mais faz ela crescer sozinha\n' +
      'e esconder o que importa.',
  )
})

test('a lista de justificadas não inventa permissão', () => {
  const foraDoCatalogo = Object.keys(SEM_ROTA_JUSTIFICADA)
    .filter((p) => !catalogo.has(p))
    .sort()

  assert.deepEqual(foraDoCatalogo, [], 'justificativa para permissão que não existe no catálogo')
})
