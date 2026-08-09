import { Injectable } from '@nestjs/common'
import type {
  CancelarNota,
  CriarNotaFiscal,
  DefinirSeries,
  Fornecedor,
  ListarNotasFiscais,
  NotaFiscal,
  NotaFiscalComItens,
  NotaFiscalItem,
  PreviaIntegracao,
  ResultadoIntegracao,
  UnidadePrevista,
} from '@iarx/contracts'
import { decomporChave } from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { exigirClaims } from '../../comum/contexto.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { Pagina, codificarCursor } from '../../comum/pagina.js'
import { NotasFiscaisRepositorio } from './notas-fiscais.repositorio.js'

/**
 * Entrada fiscal de compra — Módulo 1 do Anexo L, decisões do Anexo M.
 *
 * O que este serviço **não** faz: calcular o custo do ativo em TypeScript. O
 * rateio vem de `app.ratear_custo_nota`, e `custo_aquisicao` é coluna gerada.
 * Reimplementar aqui criaria duas verdades sobre o custo do imobilizado, e a
 * divergência só apareceria numa conciliação contábil — meses depois, sem
 * ninguém saber qual dos dois números estava certo.
 *
 * O que ele faz é o trabalho que o banco não pode fazer sozinho: transformar a
 * recusa em algo acionável, e impor a única regra que depende de *quem* está
 * pedindo (segregação de funções).
 */
@Injectable()
export class NotasFiscaisService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: NotasFiscaisRepositorio,
  ) {}

  async listar(filtro: ListarNotasFiscais): Promise<Pagina<NotaFiscal>> {
    return this.banco.emTransacao(async (db) => {
      const { linhas, temMais } = await this.repo.listar(db, filtro)
      const ultimo = linhas[linhas.length - 1]
      const criadoEm = temMais && ultimo ? await this.repo.criadoEm(db, ultimo.id) : null
      return new Pagina(linhas, {
        limit: filtro.limit,
        next_cursor: criadoEm && ultimo ? codificarCursor({ criadoEm, id: ultimo.id }) : null,
      })
    })
  }

  async porId(id: string): Promise<NotaFiscalComItens> {
    return this.banco.emTransacao(async (db) => {
      const nota = await this.repo.porId(db, id)
      if (!nota) throw naoEncontrado('Nota fiscal', id)
      return { ...nota, itens: await this.repo.itens(db, id) }
    })
  }

  async fornecedores(): Promise<Fornecedor[]> {
    return this.banco.emTransacao((db) => this.repo.fornecedores(db))
  }

  /**
   * Lança a nota.
   *
   * A conferência da chave contra o cabeçalho é feita aqui **e** por gatilho no
   * banco. Não é redundância descuidada: o gatilho é a garantia (nenhum caminho
   * de escrita escapa), e a checagem aqui é o que permite dizer *qual* campo
   * divergiu e o que cada lado vale — o gatilho responderia com um SQLSTATE.
   */
  async criar(dto: CriarNotaFiscal): Promise<NotaFiscalComItens> {
    return this.banco.emTransacao(async (db) => {
      const fornecedor = await this.repo.fornecedorPorId(db, dto.fornecedor_id)
      if (!fornecedor) throw naoEncontrado('Fornecedor', dto.fornecedor_id)

      if (dto.chave_acesso) {
        const partes = decomporChave(dto.chave_acesso)!
        if (partes.cnpj_emitente !== fornecedor.documento) {
          throw new ErroDominio('REGRA_DE_NEGOCIO', 'Chave de acesso de outro emitente', {
            detail:
              `A chave pertence ao emitente ${partes.cnpj_emitente}, e a nota está sendo lançada para ` +
              `${fornecedor.razao_social} (${fornecedor.documento}).`,
            errors: [{ field: 'chave_acesso', code: 'EMITENTE_DIVERGENTE' }],
            acoes: [
              { code: 'CONFERIR_FORNECEDOR', descricao: 'Selecionar o fornecedor correto' },
              { code: 'CONFERIR_XML', descricao: 'Conferir se o XML é desta compra' },
            ],
          })
        }
        if (partes.numero !== String(Number(dto.numero)) || partes.serie !== String(Number(dto.serie))) {
          throw new ErroDominio('REGRA_DE_NEGOCIO', 'Chave de acesso de outra nota', {
            detail: `A chave é da nota ${partes.serie}/${partes.numero}, e o cabeçalho declara ${dto.serie}/${dto.numero}.`,
            errors: [{ field: 'chave_acesso', code: 'NUMERO_DIVERGENTE' }],
          })
        }
        if (partes.competencia !== dto.data_emissao.slice(0, 7)) {
          throw new ErroDominio('REGRA_DE_NEGOCIO', 'Chave de acesso de outra competência', {
            detail: `A chave é da competência ${partes.competencia}, e a emissão informada é ${dto.data_emissao}.`,
            errors: [{ field: 'data_emissao', code: 'COMPETENCIA_DIVERGENTE' }],
          })
        }
      }

      const soma = dto.itens.reduce((s, i) => s + Math.round(Number(i.valor_total_item) * 10000), 0)
      if (soma !== Math.round(Number(dto.valor_produtos) * 10000)) {
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'Itens não fecham com o valor dos produtos', {
          detail: `A soma dos itens é ${(soma / 10000).toFixed(2)} e o valor dos produtos declarado é ${Number(dto.valor_produtos).toFixed(2)}.`,
          errors: [{ field: 'valor_produtos', code: 'ITENS_INCOERENTES' }],
        })
      }

      const id = await this.repo.inserir(db, dto)
      const nota = await this.repo.porId(db, id)
      if (!nota) throw new Error('nota recém-inserida não encontrada na releitura')
      return { ...nota, itens: await this.repo.itens(db, id) }
    })
  }

  /**
   * Identifica as unidades de um item.
   *
   * A duplicidade contra o parque é verificada antes de escrever, para que a
   * mensagem diga qual ativo já tem a etiqueta — os índices únicos pegam o
   * resto (duplicidade entre notas) e o gatilho pega a corrida. Aqui só ganha-se
   * a mensagem melhor no caso mais provável: a série já existe no parque porque
   * o ativo foi cadastrado à mão antes deste módulo.
   */
  async definirSeries(notaId: string, itemId: string, dto: DefinirSeries): Promise<NotaFiscalItem> {
    return this.banco.emTransacao(async (db) => {
      const nota = await this.repo.porId(db, notaId)
      if (!nota) throw naoEncontrado('Nota fiscal', notaId)
      this.exigirEditavel(nota)

      const item = await this.repo.itemPorId(db, notaId, itemId)
      if (!item) throw naoEncontrado('Item da nota', itemId)

      if (dto.unidades.length !== item.quantidade) {
        throw new ErroDominio('PAYLOAD_INVALIDO', 'Quantidade de unidades não corresponde ao item', {
          detail: `O item ${item.numero_item} tem ${item.quantidade} unidade(s); foram informadas ${dto.unidades.length}.`,
          errors: [{ field: 'unidades', code: 'QUANTIDADE_DIVERGENTE' }],
        })
      }

      const vistas = new Map<string, number>()
      const vistosPatrimonio = new Map<string, number>()
      for (const [i, u] of dto.unidades.entries()) {
        const serie = u.numero_serie.trim().toUpperCase()
        const patrimonio = u.patrimonio.trim().toUpperCase()

        if (vistas.has(serie)) {
          // Ler a mesma etiqueta duas vezes é o acidente mais comum aqui, e
          // significa uma caixa que não foi conferida.
          throw new ErroDominio('RECURSO_DUPLICADO', 'Série repetida no mesmo item', {
            detail: `A série ${u.numero_serie} foi informada nas unidades ${vistas.get(serie)! + 1} e ${i + 1}.`,
            errors: [{ field: `unidades.${i}.numero_serie`, code: 'SERIE_REPETIDA' }],
            acoes: [{ code: 'CONFERIR_LEITURA', descricao: 'Conferir se a etiqueta foi lida duas vezes' }],
          })
        }
        if (vistosPatrimonio.has(patrimonio)) {
          throw new ErroDominio('RECURSO_DUPLICADO', 'Patrimônio repetido no mesmo item', {
            detail: `O patrimônio ${u.patrimonio} foi informado nas unidades ${vistosPatrimonio.get(patrimonio)! + 1} e ${i + 1}.`,
            errors: [{ field: `unidades.${i}.patrimonio`, code: 'PATRIMONIO_REPETIDO' }],
          })
        }
        vistas.set(serie, i)
        vistosPatrimonio.set(patrimonio, i)

        const conflito = await this.repo.ativoComEtiqueta(db, u.numero_serie.trim(), u.patrimonio.trim())
        if (conflito) {
          const campo = conflito.qual === 'patrimonio' ? 'patrimonio' : 'numero_serie'
          throw new ErroDominio('RECURSO_DUPLICADO', 'Etiqueta já pertence a um ativo', {
            detail:
              conflito.qual === 'patrimonio'
                ? `O patrimônio ${u.patrimonio} já pertence a um equipamento cadastrado.`
                : `A série ${u.numero_serie} já pertence ao equipamento de patrimônio ${conflito.patrimonio}.`,
            errors: [{ field: `unidades.${i}.${campo}`, code: 'ETIQUETA_EM_USO' }],
            acoes: [
              { code: 'CONFERIR_ETIQUETA', descricao: 'Conferir a etiqueta da unidade' },
              { code: 'VERIFICAR_LANCAMENTO', descricao: 'Verificar se o ativo já foi lançado à mão' },
            ],
          })
        }
      }

      await this.repo.substituirSeries(db, itemId, dto)
      const itens = await this.repo.itens(db, notaId)
      const atualizado = itens.find((i) => i.id === itemId)
      if (!atualizado) throw new Error('item não encontrado após gravar as séries')
      return atualizado
    })
  }

  /**
   * Conferência física.
   *
   * A regra que só existe aqui: **quem lançou a nota não a confere** (RN-027).
   * A conferência existe para ser uma segunda pessoa olhando a mercadoria; se
   * fosse a mesma, seria só um segundo clique. A permissão sozinha não resolve —
   * um administrador tem todas, e sem esta checagem a segregação valeria para
   * todo mundo menos para quem mais precisa dela.
   */
  async conferir(notaId: string): Promise<NotaFiscal> {
    return this.banco.emTransacao(async (db) => {
      const nota = await this.repo.porId(db, notaId)
      if (!nota) throw naoEncontrado('Nota fiscal', notaId)

      if (nota.status !== 'PENDENTE_CONFERENCIA') {
        throw new ErroDominio('TRANSICAO_INVALIDA', 'Nota não está pendente de conferência', {
          detail: `A nota ${nota.serie}/${nota.numero} está em ${nota.status}.`,
        })
      }

      const incompletos = await this.repo.itensIncompletos(db, notaId)
      if (incompletos.length > 0) {
        const primeiro = incompletos[0]!
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'Unidades por identificar', {
          detail: `O item ${primeiro.numero_item} (${primeiro.descricao_nf}) tem ${primeiro.informadas} de ${primeiro.quantidade} unidades identificadas.`,
          errors: incompletos.map((i) => ({
            field: `itens.${i.numero_item}`,
            code: 'SERIES_INCOMPLETAS',
            meta: { quantidade: i.quantidade, informadas: i.informadas },
          })),
          acoes: incompletos.map((i) => ({
            code: 'INFORMAR_SERIES',
            descricao: `Informar série e patrimônio das unidades do item ${i.numero_item}`,
          })),
        })
      }

      const autor = await this.repo.autorDoLancamento(db, notaId)
      const usuario = exigirClaims().usuario_id
      if (autor && autor === usuario) {
        throw new ErroDominio('SEM_PERMISSAO', 'Segregação de funções', {
          detail:
            'Quem lançou a nota não pode conferi-la. A conferência existe para ser uma segunda pessoa ' +
            'olhando a mercadoria (RN-027).',
          acoes: [{ code: 'SOLICITAR_CONFERENCIA', descricao: 'Solicitar a conferência a outro operador' }],
        })
      }

      await this.repo.marcarConferida(db, notaId)
      const atualizada = await this.repo.porId(db, notaId)
      if (!atualizada) throw new Error('nota não encontrada após conferência')
      return atualizada
    })
  }

  /**
   * Prévia da integração: os ativos que serão criados, com valor rateado.
   *
   * Existe como endpoint próprio porque a integração é irreversível — a nota
   * fica selada (RN-L01) — e criar cento e poucos ativos com valor errado custa
   * uma correção manual em cada um. `fecha` é exposto para que o cliente possa
   * desabilitar a confirmação em vez de deixar o operador descobrir no 422.
   */
  async previa(notaId: string): Promise<PreviaIntegracao> {
    return this.banco.emTransacao(async (db) => {
      const nota = await this.repo.porId(db, notaId)
      if (!nota) throw naoEncontrado('Nota fiscal', notaId)

      const linhas = await this.repo.rateio(db, notaId)
      const unidades: UnidadePrevista[] = linhas.map((l) => ({
        serie_id: l.nota_fiscal_item_serie_id,
        numero_item: l.numero_item,
        patrimonio: l.patrimonio,
        numero_serie: l.numero_serie,
        modelo_id: l.modelo_id,
        valor_aquisicao: l.valor_aquisicao as UnidadePrevista['valor_aquisicao'],
        garantia_ate: l.garantia_ate,
      }))

      // Em centavos inteiros: comparar decimais em ponto flutuante é o que faz
      // uma nota fechada "não fechar" por 1e-10.
      const c = (v: string) => Math.round(Number(v) * 10000)
      const somaCentavos = unidades.reduce((s, u) => s + c(u.valor_aquisicao), 0)

      return {
        nota_id: notaId,
        custo_aquisicao: nota.custo_aquisicao,
        soma_rateio: (somaCentavos / 10000).toFixed(4) as PreviaIntegracao['soma_rateio'],
        fecha: somaCentavos === c(nota.custo_aquisicao),
        unidades,
      }
    })
  }

  /**
   * Integra ao patrimônio.
   *
   * Atômico por transação (RN-L03): falha em um ativo significa nenhum criado.
   * Um lote parcialmente integrado deixaria o operador sem saber o que entrou, e
   * a única saída seria conferir cento e poucas etiquetas à mão.
   *
   * O selo da nota vem **por último**, e não por estilo: o gativo `RN-L01`
   * recusa qualquer escrita nos filhos depois de `INTEGRADA` — incluindo o
   * vínculo `equipamento_id` que a criação de cada ativo grava.
   */
  async integrar(notaId: string): Promise<ResultadoIntegracao> {
    return this.banco.emTransacao(async (db) => {
      const nota = await this.repo.porId(db, notaId)
      if (!nota) throw naoEncontrado('Nota fiscal', notaId)

      if (nota.status === 'INTEGRADA') {
        throw new ErroDominio('TRANSICAO_INVALIDA', 'Nota já integrada', {
          detail: `A nota ${nota.serie}/${nota.numero} já gerou ativos no patrimônio.`,
          acoes: [{ code: 'ABRIR_PARQUE', descricao: 'Abrir o parque filtrado nos ativos desta nota' }],
        })
      }
      if (nota.status !== 'CONFERIDA') {
        throw new ErroDominio('TRANSICAO_INVALIDA', 'Nota não conferida', {
          detail: 'A nota precisa ser conferida antes de virar patrimônio.',
          acoes: [{ code: 'CONFERIR', descricao: 'Conferir a nota' }],
        })
      }

      const linhas = await this.repo.rateio(db, notaId)
      if (linhas.length === 0) {
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'Nada a integrar', {
          detail: 'A nota não tem unidades identificadas.',
        })
      }

      const c = (v: string) => Math.round(Number(v) * 10000)
      const soma = linhas.reduce((s, l) => s + c(l.valor_aquisicao), 0)
      if (soma !== c(nota.custo_aquisicao)) {
        // Chegar aqui significa defeito no rateio. Integrar produziria um
        // patrimônio que não reconcilia com a nota — melhor recusar.
        throw new ErroDominio('REGRA_DE_NEGOCIO', 'Rateio não fecha com o custo da nota', {
          detail: `O rateio soma ${(soma / 10000).toFixed(2)} e o custo de aquisição da nota é ${Number(nota.custo_aquisicao).toFixed(2)}.`,
          errors: [{ field: 'valor_total', code: 'RATEIO_DIVERGENTE' }],
        })
      }

      const criados: ResultadoIntegracao['equipamentos_criados'] = []
      for (const l of linhas) {
        criados.push(await this.repo.criarEquipamento(db, notaId, l))
      }

      await this.repo.marcarIntegrada(db, notaId)
      const atualizada = await this.repo.porId(db, notaId)
      if (!atualizada) throw new Error('nota não encontrada após integração')

      return { nota: atualizada, equipamentos_criados: criados }
    })
  }

  async cancelar(notaId: string, dto: CancelarNota): Promise<NotaFiscal> {
    return this.banco.emTransacao(async (db) => {
      const nota = await this.repo.porId(db, notaId)
      if (!nota) throw naoEncontrado('Nota fiscal', notaId)

      if (nota.status === 'INTEGRADA') {
        const itens = await this.repo.itens(db, notaId)
        const unidades = itens.reduce((s, i) => s + i.quantidade, 0)
        throw new ErroDominio('TRANSICAO_INVALIDA', 'Nota integrada não pode ser cancelada', {
          detail: `A nota ${nota.serie}/${nota.numero} gerou ${unidades} ativo(s) no patrimônio.`,
          acoes: [
            { code: 'BAIXA_PATRIMONIAL', descricao: 'Registrar baixa patrimonial dos ativos gerados' },
            { code: 'NOTA_DEVOLUCAO', descricao: 'Registrar nota de devolução ao fornecedor' },
          ],
        })
      }
      if (nota.status === 'CANCELADA') {
        throw new ErroDominio('TRANSICAO_INVALIDA', 'Nota já cancelada', {
          detail: 'Nota cancelada não pode ser reaberta. Lance a entrada novamente.',
        })
      }

      await this.repo.marcarCancelada(db, notaId, dto.motivo.trim())
      const atualizada = await this.repo.porId(db, notaId)
      if (!atualizada) throw new Error('nota não encontrada após cancelamento')
      return atualizada
    })
  }

  private exigirEditavel(nota: NotaFiscal): void {
    if (nota.status === 'INTEGRADA') {
      throw new ErroDominio('TRANSICAO_INVALIDA', 'Nota integrada é imutável', {
        detail:
          `A nota ${nota.serie}/${nota.numero} já foi integrada: os ativos carregam o valor de aquisição e a ` +
          'garantia que ela definiu.',
        acoes: [{ code: 'NOTA_DE_AJUSTE', descricao: 'Registrar uma nota de ajuste referenciando a original' }],
      })
    }
    if (nota.status === 'CANCELADA') {
      throw new ErroDominio('TRANSICAO_INVALIDA', 'Nota cancelada', {
        detail: 'Nota cancelada não aceita alteração.',
      })
    }
  }
}
