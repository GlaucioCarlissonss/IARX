import { Injectable } from '@nestjs/common'
import type {
  CategoriaEquipamento,
  Catalogo,
  Fabricante,
  FilialCatalogo,
  ModeloEquipamento,
} from '@iarx/contracts'
import type { Executor } from '../../banco/banco.service.js'

/**
 * Leitura do catálogo.
 *
 * Como nos demais repositórios: nenhum `where tenant_id`. O isolamento é da
 * RLS, dentro do banco — escrevê-lo aqui daria a impressão de que depende do
 * SQL estar certo, e um filtro esquecido numa consulta nova passaria batido.
 *
 * As quatro consultas vão na mesma transação, e isso importa mais do que
 * parece: um modelo aponta para um fabricante, e ler os dois em transações
 * diferentes abre a janela para a resposta trazer um modelo cujo fabricante
 * não está na lista. A interface então desenha um `<select>` com um rótulo
 * vazio, e ninguém entende por quê.
 */
@Injectable()
export class CatalogoRepositorio {
  async tudo(db: Executor): Promise<Catalogo> {
    const [fabricantes, categorias, modelos, filiais] = await Promise.all([
      db.consultar<Fabricante & Record<string, unknown>>(
        `select id, nome, pais, contato_suporte
           from public.fabricante
          where deleted_at is null
          order by nome`,
      ),
      db.consultar<CategoriaEquipamento & Record<string, unknown>>(
        `select id, codigo, nome, tipo_medidor_padrao::text as tipo_medidor_padrao,
                vida_util_meses_padrao
           from public.categoria_equipamento
          where deleted_at is null
          order by nome`,
      ),
      db.consultar<ModeloEquipamento & Record<string, unknown>>(
        `select id, fabricante_id, categoria_id, codigo, nome, especificacoes,
                preco_tabela_mensal, preco_tabela_diaria
           from public.modelo
          where deleted_at is null
          order by nome`,
      ),
      db.consultar<FilialCatalogo & Record<string, unknown>>(
        `select id, empresa_id, codigo, nome, regiao, status::text as status
           from public.filial
          where deleted_at is null
          order by nome`,
      ),
    ])

    return { fabricantes, categorias, modelos, filiais }
  }
}
