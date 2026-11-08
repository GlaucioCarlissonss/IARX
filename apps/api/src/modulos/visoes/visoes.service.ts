import { Injectable } from '@nestjs/common'
import type {
  CriarVisao,
  DuplicarVisao,
  EditarVisao,
  TelaComVisao,
  VisaoSalva,
} from '@iarx/contracts'
import { BancoService } from '../../banco/banco.service.js'
import { exigirClaims } from '../../comum/contexto.js'
import { ErroDominio, naoEncontrado } from '../../comum/erros.js'
import { VisoesRepositorio } from './visoes.repositorio.js'

/**
 * Visões salvas de lista — Anexo Y §Y.3.5.
 *
 * As duas regras que importam moram no gatilho da 0038 e **não** são
 * reimplementadas aqui: publicar exige `visao:compartilhar`, e mexer na visão
 * da equipe de outra pessoa exige o mesmo. O decorador do controlador é a
 * primeira tranca; o gatilho é a que continua valendo quando alguém chama por
 * outro caminho.
 *
 * O que este serviço acrescenta é o que o banco não tem como saber: que
 * duplicar uma visão é criar outra, pessoal, com o mesmo recorte.
 */
@Injectable()
export class VisoesService {
  constructor(
    private readonly banco: BancoService,
    private readonly repo: VisoesRepositorio,
  ) {}

  async listar(tela: TelaComVisao): Promise<VisaoSalva[]> {
    return this.banco.emTransacao((db) => this.repo.listar(db, tela))
  }

  async criar(dados: CriarVisao): Promise<VisaoSalva> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const id = await this.repo.criar(db, claims.tenant_id, dados, claims.usuario_id)
      const criada = await this.repo.porId(db, id)
      if (!criada) throw naoEncontrado('Visão', id)
      return criada
    })
  }

  async editar(id: string, dados: EditarVisao): Promise<VisaoSalva> {
    return this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Visão', id)

      const ok = await this.repo.editar(db, id, dados)
      if (!ok) throw naoEncontrado('Visão', id)

      const nova = await this.repo.porId(db, id)
      if (!nova) throw naoEncontrado('Visão', id)
      return nova
    })
  }

  /**
   * Excluir.
   *
   * A visão pessoal de outra pessoa nem chega aqui — a política da 0038 já a
   * esconde, e `porId` devolve nada. A da equipe é protegida pela permissão:
   * sem ela, só quem criou apaga a própria.
   */
  async excluir(id: string): Promise<void> {
    const claims = exigirClaims()
    await this.banco.emTransacao(async (db) => {
      const atual = await this.repo.porId(db, id)
      if (!atual) throw naoEncontrado('Visão', id)

      if (atual.compartilhada && atual.dono_id !== claims.usuario_id) {
        /*
         * A conferência de permissão para excluir é aqui, e não no gatilho.
         *
         * `DELETE` não tem `new` nem `old.compartilhada` a comparar: um gatilho
         * de exclusão teria de repetir a leitura que o serviço já fez. E, ao
         * contrário da publicação, excluir não tem como ser confundido com
         * outra operação — quem chama sabe o que está fazendo.
         *
         * A pergunta vai ao banco, e não ao token: ver `podeCompartilhar`.
         */
        if (!(await this.repo.podeCompartilhar(db))) {
          throw new ErroDominio('SEM_PERMISSAO', 'Esta visão é da equipe', {
            detail:
              'Excluir um recorte que a operação inteira usa exige visao:compartilhar. Se você só não quer vê-lo, peça a quem o publicou.',
            errors: [{ field: 'id', code: 'VISAO_DE_OUTRA_PESSOA' }],
          })
        }
      }

      const ok = await this.repo.excluir(db, id)
      if (!ok) throw naoEncontrado('Visão', id)
    })
  }

  /**
   * Duplicar como minha.
   *
   * A saída de quem não pode editar a visão da equipe e quer ajustá-la. Sem
   * ela, a alternativa é pedir a alguém — e o recorte morre aí.
   *
   * A cópia nasce **pessoal**, sempre, inclusive para quem tem permissão de
   * publicar: duplicar é querer uma variação própria. Quem quer publicar a
   * variação publica depois, com um ato a mais e visível.
   */
  async duplicar(id: string, dados: DuplicarVisao): Promise<VisaoSalva> {
    const claims = exigirClaims()
    return this.banco.emTransacao(async (db) => {
      const origem = await this.repo.porId(db, id)
      if (!origem) throw naoEncontrado('Visão', id)

      const novoId = await this.repo.criar(
        db,
        claims.tenant_id,
        {
          tela: origem.tela,
          nome: dados.nome ?? sufixar(origem.nome),
          consulta: origem.consulta,
          compartilhada: false,
        },
        claims.usuario_id,
      )
      const copia = await this.repo.porId(db, novoId)
      if (!copia) throw naoEncontrado('Visão', novoId)
      return copia
    })
  }
}

/**
 * "Preventiva vencida" vira "Preventiva vencida (minha)".
 *
 * Um sufixo e não um número: o nome precisa dizer **por que** há duas, e
 * "(2)" não diz. O limite de 60 caracteres é do banco, então o corte é aqui —
 * deixar o banco recusar faria a duplicação falhar por um detalhe que a pessoa
 * não escolheu.
 */
const SUFIXO = ' (minha)'
function sufixar(nome: string): string {
  if (nome.endsWith(SUFIXO)) return nome
  const espaco = 60 - SUFIXO.length
  return `${nome.length > espaco ? nome.slice(0, espaco).trimEnd() : nome}${SUFIXO}`
}
