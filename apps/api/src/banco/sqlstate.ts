import { ErroDominio } from '../comum/erros.js'

/**
 * Tradução de erro do PostgreSQL para erro de domínio.
 *
 * A premissa: as invariantes vivem no banco (RN-001 é exclusion constraint,
 * RN-028 é RLS, coerência de valores são checks). Isso é deliberado — nenhum
 * caminho de escrita, integração ou correção manual consegue produzir estado
 * inválido. O preço é que a violação chega até a API como um SQLSTATE, e alguém
 * precisa transformá-la em algo que um operador entenda.
 *
 * Este arquivo é esse alguém. Ele é a única ponte, e por isso é curto e
 * exaustivo: um SQLSTATE não mapeado vira `ERRO_INTERNO` — falha fechada, sem
 * vazar a mensagem do banco para o cliente.
 */

export interface ErroPg {
  code?: string
  constraint?: string
  table?: string
  column?: string
  detail?: string
  message?: string
}

export function ehErroPg(e: unknown): e is ErroPg {
  return typeof e === 'object' && e !== null && typeof (e as ErroPg).code === 'string'
}

/** Violação de exclusion constraint — o SQLSTATE de RN-001. */
export const SQLSTATE_EXCLUSAO = '23P01'
export const SQLSTATE_UNICO = '23505'
export const SQLSTATE_CHECK = '23514'
export const SQLSTATE_FK = '23503'
export const SQLSTATE_NOT_NULL = '23502'
export const SQLSTATE_PRIVILEGIO = '42501'
export const SQLSTATE_SERIALIZACAO = '40001'
export const SQLSTATE_DEADLOCK = '40P01'

/**
 * Mensagens por constraint nomeada.
 *
 * Depender do nome da constraint é acoplamento com o schema — assumido de olhos
 * abertos. A alternativa (checar a regra antes de escrever) é pior: cria uma
 * janela de corrida entre a checagem e o INSERT, e duplica a regra em dois
 * lugares que divergem com o tempo. Aqui o banco decide e a API só traduz.
 *
 * O teste de integração cobre cada entrada desta tabela; renomear a constraint
 * sem atualizar aqui quebra o teste, não a produção.
 */
const POR_CONSTRAINT: Record<string, () => ErroDominio> = {
  ci_sem_sobreposicao: () =>
    new ErroDominio('EQUIPAMENTO_JA_ALOCADO', 'Equipamento já alocado no período', {
      detail: 'Existe outra alocação vigente para este equipamento no intervalo informado.',
      errors: [{ field: 'equipamento_id', code: 'CONFLITO_VIGENCIA' }],
    }),

  ci_vigencia_coerente: () =>
    new ErroDominio('VIGENCIA_INVALIDA', 'Vigência incoerente', {
      detail: 'O fim da vigência precisa ser posterior ao início.',
      errors: [{ field: 'vigencia_fim', code: 'FIM_ANTES_DO_INICIO' }],
    }),

  ci_franquia_completa: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Parâmetros de franquia incompletos', {
      detail: 'Cobrança por franquia com excedente exige quantidade, escopo e preço do excedente.',
      errors: [{ field: 'franquia_quantidade', code: 'FRANQUIA_INCOMPLETA' }],
    }),

  contrato_transicao_valida: () =>
    new ErroDominio('TRANSICAO_INVALIDA', 'Transição não permitida', {
      detail:
        'O contrato não pode ir deste estado para o informado. Renovação que muda vigência cria uma nova versão, vinculada à original.',
      errors: [{ field: 'status', code: 'TRANSICAO_INVALIDA' }],
    }),

  contrato_sem_item: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Contrato sem item', {
      detail:
        'Um contrato sem item em aprovação faz o gestor aprovar nada: ele ativa e a primeira competência fecha em zero.',
      errors: [{ field: 'itens', code: 'ITEM_OBRIGATORIO' }],
      acoes: [{ code: 'ALOCAR_ITEM', descricao: 'Alocar ao menos um equipamento' }],
    }),

  contrato_item_em_campo: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Há itens em campo', {
      detail:
        'Encerrar com equipamento instalado tira o ativo do parque alocável e deixa a máquina no cliente — ninguém a cobra e ninguém a busca.',
      errors: [{ field: 'itens', code: 'ITEM_EM_CAMPO' }],
      acoes: [{ code: 'REGISTRAR_DEVOLUCAO', descricao: 'Registrar a devolução dos itens' }],
    }),

  contrato_item_entregue: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Contrato já teve item entregue', {
      detail:
        'Cancelamento é para contrato que nunca vigorou. Com item entregue, a saída é distrato ou encerramento — a diferença é que o distrato calcula multa.',
      errors: [{ field: 'status', code: 'ITEM_JA_ENTREGUE' }],
      acoes: [
        { code: 'DISTRATAR', descricao: 'Distratar, se for rescisão antecipada' },
        { code: 'ENCERRAR', descricao: 'Encerrar, após a devolução dos itens' },
      ],
    }),

  contrato_motivo_obrigatorio: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Motivo obrigatório', {
      detail:
        'Suspensão, distrato e encerramento interrompem faturamento ou liberam ativo. Sem motivo registrado, nenhuma das três se explica depois.',
      errors: [{ field: 'motivo', code: 'JUSTIFICATIVA_OBRIGATORIA' }],
    }),

  os_transicao_valida: () =>
    new ErroDominio('TRANSICAO_INVALIDA', 'Transição não permitida', {
      detail:
        'A ordem de serviço não pode ir deste estado para o informado. Reabertura cria uma OS nova, vinculada à original.',
      errors: [{ field: 'status', code: 'TRANSICAO_INVALIDA' }],
    }),

  os_rn027_segregacao: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Quem executou não pode validar', {
      detail:
        'RN-027: a validação da ordem de serviço precisa ser feita por outra pessoa. Validação é o ponto em que o custo entra no resultado — conferir o próprio trabalho torna a conferência formalidade.',
      errors: [{ field: 'validado_por', code: 'SEGREGACAO_DE_FUNCOES' }],
      acoes: [{ code: 'OUTRO_VALIDADOR', descricao: 'Pedir a validação a outro supervisor' }],
    }),

  /* ------------------------------------------ compra e inventário --- */

  oc_transicao_valida: () =>
    new ErroDominio('TRANSICAO_INVALIDA', 'Transição de ordem de compra não permitida', {
      detail: 'Rascunho se aprova, aprovada se recebe, e o que já foi recebido não volta atrás.',
      errors: [{ field: 'status', code: 'TRANSICAO_INVALIDA' }],
    }),

  oc_sem_item: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Ordem de compra sem item', {
      detail: 'Aprovar uma ordem vazia compromete alçada sobre valor nenhum.',
      errors: [{ field: 'itens', code: 'ITEM_OBRIGATORIO' }],
    }),

  oc_acima_da_alcada: () =>
    new ErroDominio('SEM_PERMISSAO', 'Ordem acima da alçada', {
      detail: 'O valor da ordem excede o teto do seu perfil para aprovação de compra.',
      errors: [{ field: 'valor_total', code: 'ACIMA_DA_ALCADA' }],
      acoes: [{ code: 'PEDIR_APROVACAO', descricao: 'Pedir a aprovação a quem tem alçada maior' }],
    }),

  oc_item_apos_aprovacao: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Ordem aprovada não tem itens alterados', {
      detail:
        'A alçada aprovou um valor. Mudar o item depois faria a ordem chegar com outro, e a aprovação continuaria registrada como se tivesse validado este.',
      errors: [{ field: 'itens', code: 'ORDEM_APROVADA' }],
      acoes: [{ code: 'CANCELAR_E_REFAZER', descricao: 'Cancelar a ordem e abrir outra' }],
    }),

  oc_recebimento_sem_aprovacao: () =>
    new ErroDominio('TRANSICAO_INVALIDA', 'Ordem não aprovada não recebe', {
      detail: 'Receber antes de aprovar faria a mercadoria entrar sem que ninguém tivesse autorizado a compra.',
      errors: [{ field: 'status', code: 'STATUS_NAO_PERMITE' }],
    }),

  oci_recebido_ate_pedido: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Recebimento maior que o pedido', {
      detail:
        'Receber a mais é divergência de nota, e o lugar dela é a entrada fiscal — não um número que cresce em silêncio na ordem.',
      errors: [{ field: 'quantidade_recebida', code: 'ACIMA_DO_PEDIDO' }],
    }),

  inv_transicao_valida: () =>
    new ErroDominio('TRANSICAO_INVALIDA', 'Transição de inventário não permitida', {
      detail: 'A contagem se fecha antes de ser aprovada, e o que foi aprovado já virou ajuste de saldo.',
      errors: [{ field: 'status', code: 'TRANSICAO_INVALIDA' }],
    }),

  inv_sem_contagem: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Inventário sem nenhuma contagem', {
      detail: 'Fechar um inventário vazio registraria que nada divergiu sem ninguém ter contado.',
      errors: [{ field: 'contagens', code: 'CONTAGEM_OBRIGATORIA' }],
    }),

  inv_divergencia_sem_justificativa: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Divergência sem justificativa', {
      detail:
        'Toda diferença entre o sistema e a prateleira vira ajuste de saldo. Sem justificativa, o ajuste é a linha que ninguém consegue explicar depois.',
      errors: [{ field: 'justificativa', code: 'JUSTIFICATIVA_OBRIGATORIA' }],
    }),

  inv_contagem_fora_de_abertura: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Inventário já fechado', {
      detail:
        'A contagem é a evidência do que estava na prateleira. Mudá-la depois do fechamento mudaria a divergência que alguém aprovou.',
      errors: [{ field: 'status', code: 'INVENTARIO_FECHADO' }],
    }),

  inv_aberto_uk: () =>
    new ErroDominio('RECURSO_DUPLICADO', 'Já há inventário aberto neste depósito', {
      detail:
        'Dois inventários simultâneos contam a mesma prateleira e geram dois ajustes para a mesma diferença — o segundo corrigindo o que o primeiro já corrigiu.',
      errors: [{ field: 'deposito_id', code: 'INVENTARIO_EM_ANDAMENTO' }],
    }),

  /* --------------------------------------- reserva de peça e inventário --- */

  os_peca_transicao_valida: () =>
    new ErroDominio('TRANSICAO_INVALIDA', 'Transição de peça não permitida', {
      detail:
        'Anexo B.5. Peça consumida não volta por edição de status — volta por entrada de estoque, que deixa rastro e recalcula o custo médio.',
      errors: [{ field: 'status', code: 'TRANSICAO_INVALIDA' }],
    }),

  os_peca_sem_saldo: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Sem saldo desta peça no depósito', {
      detail: 'Não há registro de saldo da peça no depósito informado.',
      errors: [{ field: 'deposito_id', code: 'SEM_SALDO' }],
      acoes: [{ code: 'REGISTRAR_ENTRADA', descricao: 'Registrar a entrada no depósito' }],
    }),

  os_peca_sem_deposito: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Reserva sem depósito', {
      detail: 'O saldo é por depósito: sem ele não há de onde reservar nem onde baixar.',
      errors: [{ field: 'deposito_id', code: 'OBRIGATORIO' }],
    }),

  os_peca_nasce_solicitada: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Peça de OS nasce solicitada', {
      detail: 'Entre pedir e reservar há a pergunta "tem saldo?", e é ela que leva a ordem para aguardando peça quando a resposta é não.',
      errors: [{ field: 'status', code: 'ESTADO_INICIAL_INVALIDO' }],
    }),

  os_peca_sem_destino: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Há peças sem destino definido', {
      detail:
        'RN-015: concluir com peça reservada deixa saldo comprometido por uma ordem que acabou — a peça não está na prateleira para a próxima OS, e não está no custo desta.',
      errors: [{ field: 'pecas', code: 'DESTINO_INDEFINIDO' }],
      acoes: [
        { code: 'CONSUMIR', descricao: 'Baixar as peças aplicadas' },
        { code: 'DEVOLVER', descricao: 'Devolver as que não foram usadas' },
      ],
    }),

  estoque_ajuste_acima_da_alcada: () =>
    new ErroDominio('SEM_PERMISSAO', 'Ajuste acima da alçada', {
      detail:
        'O valor do ajuste excede o teto do seu perfil. Ajuste é o único movimento que cria ou destrói quantidade sem contrapartida.',
      errors: [{ field: 'quantidade', code: 'ACIMA_DA_ALCADA' }],
      acoes: [{ code: 'PEDIR_APROVACAO', descricao: 'Pedir o ajuste a quem tem alçada maior' }],
    }),

  /* ------------------------------------- reajuste e alçada de desconto --- */

  contrato_desconto_acima_da_alcada: () =>
    new ErroDominio('SEM_PERMISSAO', 'Desconto acima da alçada', {
      detail:
        'RN-009: o percentual excede o teto do seu perfil. Desconto em item de contrato não é um abatimento único — ele se repete em toda competência até o fim da vigência.',
      errors: [{ field: 'desconto_percentual', code: 'ACIMA_DA_ALCADA' }],
      acoes: [{ code: 'PEDIR_APROVACAO', descricao: 'Pedir a concessão a quem tem alçada maior' }],
    }),

  reajuste_transicao_valida: () =>
    new ErroDominio('TRANSICAO_INVALIDA', 'Transição de reajuste não permitida', {
      detail:
        'RN-008: a proposta passa por aprovação antes de ser aplicada, e o que já foi aplicado ou renunciado não volta atrás.',
      errors: [{ field: 'status', code: 'TRANSICAO_INVALIDA' }],
    }),

  reajuste_nasce_proposto: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Reajuste nasce como proposta', {
      detail: 'A aplicação exige aprovação, e aprovação exige que haja uma proposta a aprovar.',
      errors: [{ field: 'status', code: 'ESTADO_INICIAL_INVALIDO' }],
    }),

  reajuste_renuncia_com_motivo: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Renúncia exige motivo', {
      detail:
        'Reajuste não aplicado é receita renunciada e entra no indicador do período. Sem motivo, ninguém sabe depois por que se deixou de cobrar.',
      errors: [{ field: 'motivo', code: 'JUSTIFICATIVA_OBRIGATORIA' }],
    }),

  reajuste_imutavel: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Reajuste não é apagado', {
      detail:
        'A saída é renunciar com motivo. Apagar faria o indicador de receita renunciada medir zero justamente nos casos que ele existe para medir.',
      errors: [{ field: 'id', code: 'REGISTRO_IMUTAVEL' }],
      acoes: [{ code: 'RENUNCIAR', descricao: 'Renunciar ao reajuste, registrando o motivo' }],
    }),

  reajuste_competencia_uk: () =>
    new ErroDominio('RECURSO_DUPLICADO', 'Já há reajuste nesta competência', {
      detail:
        'Existe um reajuste vivo para este contrato na competência informada. Renuncie ao atual antes de propor outro — a renúncia fica registrada.',
      errors: [{ field: 'competencia', code: 'REAJUSTE_DUPLICADO' }],
    }),

  /* ------------------------------------------ ciclo de vida do ativo --- */

  equipamento_transicao_valida: () =>
    new ErroDominio('TRANSICAO_INVALIDA', 'Transição não permitida', {
      detail:
        'O equipamento não pode ir deste estado para o informado. Entrega passa por reserva e trânsito; retorno passa por inspeção.',
      errors: [{ field: 'status', code: 'TRANSICAO_INVALIDA' }],
    }),

  equipamento_alocado_nao_baixa: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Equipamento alocado em contrato', {
      detail:
        'Baixa é o encerramento patrimonial: o ativo sai do balanço e do parque alocável. Com item de contrato vigente, a máquina continua no cliente — que segue pagando por um equipamento que o sistema passa a dizer que não existe.',
      errors: [{ field: 'status', code: 'ALOCACAO_VIGENTE' }],
      acoes: [{ code: 'ENCERRAR_ITENS', descricao: 'Encerrar os itens de contrato antes da baixa' }],
    }),

  equipamento_com_os_nao_baixa: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Equipamento com ordem de serviço aberta', {
      detail:
        'A ordem em aberto ainda vai acumular custo de mão de obra, peça e deslocamento. Baixar antes é perder esse custo de vista no momento em que ele é apurado.',
      errors: [{ field: 'status', code: 'OS_ABERTA' }],
      acoes: [{ code: 'CONCLUIR_OS', descricao: 'Concluir ou cancelar as ordens de serviço' }],
    }),

  equipamento_retorno_alocado: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'O ativo ainda está em contrato', {
      detail:
        'O retorno de manutenção de equipamento com item de contrato vigente é LOCADO, não DISPONÍVEL. Marcá-lo disponível o devolve ao parque alocável enquanto ele está na mesa do cliente, e o próximo contrato a reservá-lo descobre isso na entrega.',
      errors: [{ field: 'status', code: 'RETORNO_INCOERENTE' }],
      acoes: [{ code: 'RETORNAR_LOCADO', descricao: 'Registrar o retorno como LOCADO' }],
    }),

  equipamento_retorno_sem_contrato: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'O ativo não tem contrato vigente', {
      detail:
        'O retorno de manutenção de equipamento sem item de contrato vigente é DISPONÍVEL. LOCADO sem contrato é uma máquina que o parque considera entregue e que nenhuma cobrança alcança.',
      errors: [{ field: 'status', code: 'RETORNO_INCOERENTE' }],
      acoes: [{ code: 'RETORNAR_DISPONIVEL', descricao: 'Registrar o retorno como DISPONÍVEL' }],
    }),

  equipamento_ja_alocado: () =>
    new ErroDominio('EQUIPAMENTO_JA_ALOCADO', 'Equipamento já alocado', {
      detail: 'Existe item de contrato vigente para este equipamento.',
      errors: [{ field: 'status', code: 'ALOCACAO_VIGENTE' }],
    }),

  equipamento_indisponivel_alocacao: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Equipamento indisponível para alocação', {
      detail:
        'RN-003 e RN-014: o ativo está bloqueado ou em estado operacional que impede a alocação (manutenção, trânsito, extravio, bloqueio ou baixa).',
      errors: [{ field: 'equipamento_id', code: 'ATIVO_INDISPONIVEL' }],
      acoes: [{ code: 'DESBLOQUEAR', descricao: 'Verificar bloqueio por preventiva vencida' }],
    }),

  movimentacao_item_de_outro_ativo: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Item de contrato não é deste equipamento', {
      detail:
        'A movimentação mexe na cobrança do ativo que se moveu. O item informado pertence a outro equipamento — registrá-lo aqui encerraria a cobrança de um cliente que não teve nada movimentado.',
      errors: [{ field: 'contrato_item_id', code: 'ITEM_DE_OUTRO_ATIVO' }],
    }),

  movimentacao_destino_inexistente: () =>
    new ErroDominio('PAYLOAD_INVALIDO', 'Destino inexistente', {
      detail: 'A filial ou o local de operação informado não existe neste locatário.',
      errors: [{ field: 'destino', code: 'DESTINO_INEXISTENTE' }],
    }),

  movimentacao_imutavel: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Movimentação é imutável', {
      detail:
        'O razão do ativo não se edita nem se apaga: alguém agiu com base no que está registrado. A correção é uma movimentação nova.',
      errors: [{ field: 'id', code: 'REGISTRO_IMUTAVEL' }],
    }),

  equipamento_motivo_obrigatorio: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Motivo obrigatório', {
      detail:
        'RN-010: todo estado diferente de disponível, reservado ou locado exige motivo tipificado — é ele que explica, depois, por que o ativo não estava rendendo.',
      errors: [{ field: 'motivo', code: 'JUSTIFICATIVA_OBRIGATORIA' }],
    }),

  equipamento_bloqueio_com_motivo: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Bloqueio sem justificativa', {
      detail: 'RN-014: bloquear um ativo tira receita; sem motivo registrado, ninguém sabe o que destravar.',
      errors: [{ field: 'motivo', code: 'JUSTIFICATIVA_OBRIGATORIA' }],
    }),

  ci_desconto_com_motivo: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Desconto sem justificativa', {
      detail: 'RN-009: todo desconto exige motivo registrado, porque ele é auditável.',
      errors: [{ field: 'desconto_motivo', code: 'JUSTIFICATIVA_OBRIGATORIA' }],
    }),

  ci_alvo_definido: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Item sem alvo', {
      detail: 'Informe um equipamento específico ou uma categoria a definir na entrega.',
      errors: [{ field: 'equipamento_id', code: 'ALVO_INDEFINIDO' }],
    }),

  ci_valores_nao_negativos: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Valores inválidos', {
      detail: 'Valores monetários não podem ser negativos e a quantidade precisa ser maior que zero.',
      errors: [{ field: 'valor_unitario', code: 'VALOR_INVALIDO' }],
    }),

  /* ------------------------------------------- entrada fiscal de compra --- */

  nfc_chave_uk: () =>
    new ErroDominio('RECURSO_DUPLICADO', 'Chave de acesso já lançada', {
      detail: 'Esta chave de acesso já pertence a outra nota fiscal registrada.',
      errors: [{ field: 'chave_acesso', code: 'CHAVE_DUPLICADA' }],
    }),

  nfc_numero_uk: () =>
    new ErroDominio('RECURSO_DUPLICADO', 'Nota já lançada para este fornecedor', {
      detail: 'Já existe uma nota com o mesmo modelo, série e número para este fornecedor.',
      errors: [{ field: 'numero', code: 'NOTA_DUPLICADA' }],
    }),

  nfc_total_fecha: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Total da nota não fecha', {
      detail:
        'vNF = vProd + vST + vFrete + vSeg + vOutro + vIPI − vDesc (layout 4.00 da NF-e). ' +
        'Confira frete, seguro, despesas, IPI, ST e desconto no DANFE.',
      errors: [{ field: 'valor_total', code: 'TOTAL_INCOERENTE' }],
    }),

  nfc_entrada_apos_emissao: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Entrada anterior à emissão', {
      detail: 'A mercadoria não pode ter entrado antes de a nota ser emitida.',
      errors: [{ field: 'data_entrada', code: 'ENTRADA_ANTES_DA_EMISSAO' }],
    }),

  nfc_chave_formato: () =>
    new ErroDominio('PAYLOAD_INVALIDO', 'Chave de acesso inválida', {
      detail: 'A chave precisa ter 44 dígitos e passar na verificação do dígito verificador (módulo 11).',
      errors: [{ field: 'chave_acesso', code: 'DV_INVALIDO' }],
    }),

  nfc_icms_dentro_dos_produtos: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'ICMS maior que o valor dos produtos', {
      detail: 'ICMS é imposto por dentro: ele está contido no valor dos produtos e não pode excedê-lo.',
      errors: [{ field: 'valor_icms', code: 'ICMS_INCOERENTE' }],
    }),

  nfi_total_fecha: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Total do item não fecha', {
      detail: 'O total de cada item precisa corresponder a quantidade × valor unitário.',
      errors: [{ field: 'itens', code: 'ITEM_INCOERENTE' }],
    }),

  nfi_quantidade_positiva: () =>
    new ErroDominio('REGRA_DE_NEGOCIO', 'Quantidade inválida', {
      detail: 'Cada unidade vira um patrimônio próprio, então a quantidade é um inteiro positivo.',
      errors: [{ field: 'quantidade', code: 'QUANTIDADE_INVALIDA' }],
    }),

  nfis_serie_uk: () =>
    new ErroDominio('RECURSO_DUPLICADO', 'Número de série já usado', {
      detail: 'Esta série já foi informada em outra nota fiscal deste tenant.',
      errors: [{ field: 'numero_serie', code: 'SERIE_DUPLICADA' }],
      acoes: [{ code: 'CONFERIR_ETIQUETA', descricao: 'Conferir se a etiqueta correta foi lida' }],
    }),

  nfis_patrimonio_uk: () =>
    new ErroDominio('RECURSO_DUPLICADO', 'Patrimônio já usado', {
      detail: 'Este patrimônio já foi informado em outra nota fiscal deste tenant.',
      errors: [{ field: 'patrimonio', code: 'PATRIMONIO_DUPLICADO' }],
    }),

  equipamento_nfis_uk: () =>
    new ErroDominio('RECURSO_DUPLICADO', 'Unidade já integrada', {
      detail: 'Esta unidade da nota já gerou um equipamento no patrimônio.',
      errors: [{ field: 'nota_fiscal_item_serie_id', code: 'JA_INTEGRADA' }],
    }),

  ri_chave_uq: () =>
    new ErroDominio('IDEMPOTENCIA_EM_ANDAMENTO', 'Requisição idêntica em processamento', {
      detail: 'Outra requisição com a mesma Idempotency-Key ainda está sendo processada.',
    }),
}

export function traduzirErroPg(e: unknown): ErroDominio | null {
  if (!ehErroPg(e)) return null

  if (e.constraint && POR_CONSTRAINT[e.constraint]) {
    return POR_CONSTRAINT[e.constraint]!()
  }

  switch (e.code) {
    case SQLSTATE_EXCLUSAO:
      // Exclusion sem constraint reconhecida: ainda é conflito de período, mas
      // sem o texto específico. Melhor um 409 genérico que um 500 enganoso.
      return new ErroDominio('EQUIPAMENTO_JA_ALOCADO', 'Conflito de período', {
        detail: 'A operação colide com outro registro no mesmo intervalo.',
        causa: e,
      })

    case SQLSTATE_UNICO:
      return new ErroDominio('RECURSO_DUPLICADO', 'Registro já existe', {
        detail: 'Já existe um registro com esse identificador único.',
        causa: e,
      })

    case SQLSTATE_CHECK: {
      /*
       * Partição ausente chega como `23514`, e sem nome de constraint.
       *
       * `leitura_medidor`, `log_acesso` e `audit_log` são particionadas por
       * data. Quando o período da linha não tem partição, o PostgreSQL levanta
       * check_violation com a mensagem "no partition of relation ... found for
       * row" — e o tratamento genérico a transformava em
       * `A operação viola a regra "não identificada"`.
       *
       * Isso não é hipótese de laboratório: é exatamente o que o operador vê no
       * dia em que a criação de partições atrasa, ou em que alguém lança uma
       * leitura com a data digitada errada. "Regra não identificada" manda a
       * pessoa procurar um erro no próprio dado, que está certo, e esconde a
       * única informação acionável — que o período não está aberto.
       */
      if (/no partition of relation/i.test(e.message ?? '')) {
        return new ErroDominio('REGRA_DE_NEGOCIO', 'Período não aberto para registro', {
          detail:
            'A data informada está fora dos períodos abertos. Confira a data ou peça a abertura do período.',
          acoes: [
            { code: 'CONFERIR_DATA', descricao: 'Conferir a data informada' },
            { code: 'ABRIR_PERIODO', descricao: 'Solicitar abertura do período ao administrador' },
          ],
          causa: e,
        })
      }

      return new ErroDominio('REGRA_DE_NEGOCIO', 'Restrição de integridade violada', {
        detail: `A operação viola a regra "${e.constraint ?? 'não identificada'}".`,
        causa: e,
      })
    }

    case SQLSTATE_FK:
      return new ErroDominio('REGRA_DE_NEGOCIO', 'Referência inválida', {
        detail: 'A operação referencia um registro que não existe ou não pode ser removido.',
        causa: e,
      })

    case SQLSTATE_NOT_NULL:
      return new ErroDominio('PAYLOAD_INVALIDO', 'Campo obrigatório ausente', {
        errors: e.column ? [{ field: e.column, code: 'OBRIGATORIO' }] : undefined,
        causa: e,
      })

    case SQLSTATE_PRIVILEGIO:
      // Inclui o `raise` de app.exigir_tenant(). Chegar aqui significa que uma
      // rota escreveu sem contexto de tenant — defeito nosso, não do cliente,
      // mas a resposta correta ainda é 403: a operação não é permitida.
      return new ErroDominio('FORA_DE_ESCOPO', 'Operação fora do escopo permitido', {
        detail: 'A transação não possui contexto de tenant suficiente para esta operação.',
        causa: e,
      })

    case SQLSTATE_SERIALIZACAO:
    case SQLSTATE_DEADLOCK:
      return new ErroDominio('INDISPONIVEL', 'Conflito de concorrência', {
        detail: 'A operação concorreu com outra transação. Repita a requisição.',
        causa: e,
      })

    default:
      return null
  }
}
