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
  'inventario:executar': 'módulo de inventário: sem tela no front',
  'inventario:aprovar': 'idem',
  'plano_preventivo:gerenciar': 'manutenção preventiva programada: sem tela no front',
  'ordem_compra:criar': 'compras: sem tela no front',
  'ordem_compra:aprovar': 'idem',
  'ordem_compra:receber': 'idem',
  'relatorio:criar': 'relatórios sob demanda: sem tela no front',
  'relatorio:ler': 'idem',
  'relatorio:agendar': 'idem',

  /*
   * Faturamento. A tela existe; o modelo de dados de pré-fatura e fatura, não.
   * Entra depois da migração correspondente, que é a ordem acordada — modelagem
   * antes de API.
   */
  'prefatura:gerar': 'pré-fatura: modelagem pendente (tela existe, tabela não)',
  'prefatura:editar': 'idem',
  'prefatura:aprovar': 'idem',
  'fatura:emitir': 'fatura: modelagem pendente',
  'fatura:cancelar': 'idem',
  'fatura:desconto_aplicar': 'idem',
  'fatura:nota_correcao': 'idem',
  'faturamento:exportar': 'idem',

  /*
   * Capacidades transversais que hoje são de configuração de ambiente, não de
   * rota: não há tela nem necessidade de API para elas.
   */
  'apikey:gerenciar': 'chaves de integração: configuração de ambiente, sem rota',
  'webhook:gerenciar': 'idem',
  'integracao:gerenciar': 'idem',
  'parametro:gerenciar': 'parâmetros do locatário: configuração, sem tela',

  /*
   * Ações de equipamento previstas no Anexo C e ainda não construídas. A
   * diferença para as de cima é que aqui existe tela de parque: são ações a
   * acrescentar nela, não módulo a criar.
   */
  'equipamento:transferir': 'ação de parque ainda não construída',
  'equipamento:transferencia_aceitar': 'idem',
  'equipamento:baixar': 'idem',
  'equipamento:etiqueta_gerar': 'idem',
  'equipamento:importar': 'idem',
  'equipamento:patrimonial_editar': 'idem',
  'equipamento:movimentar': 'idem',

  /*
   * Medição: consolidar e estimar são do fechamento de competência, que hoje
   * acontece por `competencia:fechar`. Ficam até a prévia de fechamento ganhar
   * as duas ações separadas.
   */
  'medicao:consolidar': 'parte do fechamento de competência, sem ação própria ainda',
  'medicao:estimar': 'idem',

  /* Estoque: reserva e política entram com a tela de OS consumindo peça. */
  'estoque:reservar': 'reserva de peça na OS: tela pendente',
  'estoque:politica_definir': 'política de reposição: edição pendente (leitura já existe)',
  'estoque:ajustar': 'ajuste entra hoje como movimento AJUSTE_INVENTARIO',

  /* Peça: cadastro ainda não tem tela de edição. */
  'peca:criar': 'cadastro de peça: tela pendente',
  'peca:editar': 'idem',

  /* Técnico: cadastro pendente; a leitura entra por `os:ler`. */
  'tecnico:gerenciar': 'cadastro de técnico: tela pendente',

  /* Comercial: edição de tabela pendente; a leitura já existe. */
  'comercial:gerenciar': 'edição de política comercial: tela pendente',

  /* Catálogo: edição pendente; a leitura entra por `equipamento:ler`. */
  'catalogo:gerenciar': 'edição de catálogo: tela pendente',

  /* Mapa: compartilhar filtro é recurso de colaboração, sem tela. */
  'mapa:filtro_compartilhar': 'compartilhamento de filtro: sem tela',

  /* OS: reabertura e custo pendentes. */
  'os:reabrir': 'reabertura cria OS nova vinculada: fluxo pendente',
  'os:custo_aprovar': 'aprovação de custo de OS: alçada pendente',

  /* Auditoria e sensíveis: leitura por tela ainda não construída. */
  'auditoria:consultar': 'consulta de trilha: sem tela',
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
   * A leitura e a criação existem; o ciclo, não. É a maior pendência que
   * sobrou, e é a que o levantamento manual perdeu — porque listar o que falta
   * à mão é listar o que se lembra.
   */
  'contrato:editar': 'ciclo de vida do contrato: ação pendente',
  'contrato:aprovar': 'idem',
  'contrato:ativar': 'idem',
  'contrato:suspender': 'idem',
  'contrato:retomar': 'idem',
  'contrato:renovar': 'idem',
  'contrato:encerrar': 'idem',
  'contrato:distratar': 'idem',
  'contrato:cancelar': 'idem',
  'contrato:reajuste_aprovar': 'idem',
  'contrato:desconto_conceder': 'idem',
  'contrato:item_encerrar': 'item de contrato: ação pendente',
  'contrato:item_substituir': 'idem',

  /* Outras ações previstas e não construídas. */
  'cliente:inativar': 'inativação de cliente: ação pendente',
  'equipamento:editar': 'edição de equipamento: ação pendente',
  'fornecedor:gerenciar': 'cadastro de fornecedor: tela pendente (a leitura existe)',
  'alcada:definir': 'configuração de alçada: tela pendente',
  'competencia:reabrir': 'reabertura de competência: ação pendente',
  'os:atribuir': 'atribuição de técnico separada do agendamento: ação pendente',
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
