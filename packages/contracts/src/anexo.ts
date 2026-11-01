import { z } from 'zod'
import { Data, DataHora, Uuid } from './primitivos.js'

/**
 * Anexos.
 *
 * A API guarda **metadado**; o arquivo vive no armazenamento de objetos. Por
 * isso não existe rota que receba binário aqui: o cliente pede uma URL de
 * envio, manda o arquivo direto para o armazenamento, e então registra o
 * metadado.
 *
 * Fazer o upload passar pela API seria mais simples de escrever e pior em três
 * frentes: o processo da API passa a segurar megabytes em memória enquanto o
 * cliente envia, o tempo limite de requisição vira o limite de tamanho de
 * arquivo, e um envio interrompido deixa a transação aberta. O caminho direto
 * tira a API da rota do byte e a deixa com o que ela sabe fazer — decidir se
 * pode, e registrar que aconteceu.
 */

export const AnexoEntidade = z.enum([
  'CONTRATO',
  'EQUIPAMENTO',
  'CLIENTE',
  'ORDEM_SERVICO',
  'NOTA_FISCAL',
  'TITULO_PAGAR',
  'TITULO_RECEBER',
  'LEITURA',
])
export type AnexoEntidade = z.infer<typeof AnexoEntidade>

export const AntivirusStatus = z.enum(['PENDENTE', 'LIMPO', 'INFECTADO', 'FALHOU'])
export type AntivirusStatus = z.infer<typeof AntivirusStatus>

export const Anexo = z.object({
  id: Uuid,
  entidade_tipo: AnexoEntidade,
  entidade_id: Uuid,
  tipo_documento: z.string().nullable(),
  nome_arquivo: z.string(),
  storage_key: z.string(),
  mime_type: z.string().nullable(),
  tamanho_bytes: z.number().int(),
  /** SHA-256 em minúsculas. Responde "é o mesmo arquivo que foi assinado?". */
  hash_sha256: z.string().nullable(),
  versao: z.number().int(),
  validade_ate: Data.nullable(),
  antivirus_status: AntivirusStatus,
  enviado_por: Uuid.nullable(),
  created_at: DataHora,
})
export type Anexo = z.infer<typeof Anexo>

export const RegistrarAnexo = z.object({
  entidade_tipo: AnexoEntidade,
  entidade_id: Uuid,
  nome_arquivo: z.string().trim().min(1),
  storage_key: z.string().trim().min(1),
  tipo_documento: z.string().trim().nullish(),
  mime_type: z.string().trim().nullish(),
  /**
   * Tamanho com teto.
   *
   * Cinquenta megabytes é generoso para contrato digitalizado e foto de OS, e
   * ainda assim é um teto: sem ele, um envio errado de vídeo transforma a
   * conta de armazenamento num problema que só aparece na fatura do mês
   * seguinte. O teto aqui não impede o envio — o arquivo já foi para o
   * armazenamento —, impede que ele vire anexo registrado, que é o que o
   * sistema passa a servir.
   */
  tamanho_bytes: z.number().int().positive().max(50 * 1024 * 1024, 'arquivo acima de 50 MB'),
  hash_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'hash deve ser SHA-256 em minúsculas')
    .nullish(),
  validade_ate: Data.nullish(),
})
export type RegistrarAnexo = z.infer<typeof RegistrarAnexo>

export const RemoverAnexo = z.object({
  /**
   * Obrigatório, como toda remoção nesta base.
   *
   * Anexo é evidência: a remoção de um documento de contrato sem motivo é
   * indistinguível de encobrimento, e é exatamente o que alguém vai perguntar.
   */
  motivo: z.string().trim().min(10, 'descreva o motivo da remoção'),
})
export type RemoverAnexo = z.infer<typeof RemoverAnexo>

export const ListarAnexos = z.object({
  entidade_tipo: AnexoEntidade,
  entidade_id: Uuid,
})
export type ListarAnexos = z.infer<typeof ListarAnexos>
