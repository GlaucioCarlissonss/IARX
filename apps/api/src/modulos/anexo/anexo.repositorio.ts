import { Injectable } from '@nestjs/common'
import type { Anexo, ListarAnexos, RegistrarAnexo } from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'

/**
 * Acesso a anexos.
 *
 * Como nos demais repositórios: nenhum `where tenant_id`. O isolamento é da
 * RLS, e a coerência do par (entidade, id) é gatilho — sem ele, `entidade_id`
 * seria um uuid qualquer, e um anexo poderia apontar para o contrato de outro
 * locatário. A RLS protege a leitura da linha do anexo, não o que ela
 * referencia.
 */
const SELECT = `
  select a.id, a.entidade_tipo::text as entidade_tipo, a.entidade_id,
         a.tipo_documento, a.nome_arquivo, a.storage_key, a.mime_type,
         a.tamanho_bytes, a.hash_sha256, a.versao,
         to_char(a.validade_ate, 'YYYY-MM-DD') as validade_ate,
         a.antivirus_status::text as antivirus_status, a.enviado_por,
         to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at
    from public.anexo a
`

@Injectable()
export class AnexoRepositorio {
  async listar(db: Executor, filtro: ListarAnexos): Promise<Anexo[]> {
    return db.consultar<Anexo & Record<string, unknown>>(
      `${SELECT} where a.entidade_tipo = $1::app.anexo_entidade
                   and a.entidade_id = $2
                   and a.deleted_at is null
        order by a.created_at desc`,
      [filtro.entidade_tipo, filtro.entidade_id],
    )
  }

  async registrar(db: Executor, dados: RegistrarAnexo, autorId: string): Promise<Anexo | null> {
    const linha = await db.consultarUm<{ id: string }>(
      `insert into public.anexo
         (tenant_id, entidade_tipo, entidade_id, tipo_documento, nome_arquivo,
          storage_key, mime_type, tamanho_bytes, hash_sha256, validade_ate,
          enviado_por, created_by, updated_by)
       values (app.tenant_atual(), $1::app.anexo_entidade, $2, $3, $4, $5, $6, $7, $8,
               $9::date, $10, $10, $10)
       returning id`,
      [
        dados.entidade_tipo,
        dados.entidade_id,
        dados.tipo_documento ?? null,
        dados.nome_arquivo,
        dados.storage_key,
        dados.mime_type ?? null,
        dados.tamanho_bytes,
        dados.hash_sha256 ?? null,
        dados.validade_ate ?? null,
        autorId,
      ],
    )
    if (!linha) return null
    return db.consultarUm<Anexo & Record<string, unknown>>(`${SELECT} where a.id = $1`, [linha.id])
  }

  /**
   * Remoção lógica, com motivo.
   *
   * O objeto no armazenamento **não** é apagado aqui. Apagar o byte junto com
   * o registro tornaria a remoção irreversível no exato momento em que ela
   * costuma ser um engano — e a trilha de auditoria guardaria a remoção de um
   * arquivo que ninguém mais consegue ver para julgar.
   */
  async remover(db: Executor, id: string, motivo: string, autorId: string): Promise<boolean> {
    const linha = await db.consultarUm<{ id: string }>(
      `update public.anexo
          set deleted_at = now(), deleted_by = $3, delete_reason = $2, updated_by = $3
        where id = $1 and deleted_at is null
        returning id`,
      [id, motivo, autorId],
    )
    return linha !== null
  }
}
