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

    case SQLSTATE_CHECK:
      return new ErroDominio('REGRA_DE_NEGOCIO', 'Restrição de integridade violada', {
        detail: `A operação viola a regra "${e.constraint ?? 'não identificada'}".`,
        causa: e,
      })

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
