import { PERMISSOES } from '@iarx/contracts/catalogo-permissoes'
import type { Permissao } from '@iarx/contracts/catalogo-permissoes'

/**
 * Modelo de permissões do front-end.
 *
 * O tipo `Permissao` **vem do catálogo compartilhado**, o mesmo que a API
 * compara na guarda e que o banco valida por gatilho. Antes ele era declarado
 * aqui, com 33 nomes, enquanto o catálogo tinha 113 — dois vocabulários
 * paralelos que ninguém reconciliava, e que o Anexo I descrevia como se fossem
 * um só.
 *
 * A divergência não era teórica: uma árvore de configuração construída sobre o
 * catálogo produziria permissões que este arquivo não reconhecia. O perfil
 * gravaria `pagar:aprovar` e o botão continuaria escondido, sem erro em lugar
 * nenhum — exatamente o defeito que o catálogo diz existir para evitar.
 *
 * A decisão de autorização continua sendo do servidor. O front esconde para
 * reduzir ruído, **nunca** para proteger.
 */

export type { Permissao }

export interface Perfil {
  id: string
  nome: string
  permissoes: Permissao[]
}

/**
 * Perfis da demonstração.
 *
 * Massa de exemplo, não configuração de produção: no ambiente real eles vêm de
 * `public.perfil`, provisionados por tenant. Ficam aqui porque a aplicação
 * ainda opera sobre base em memória — ver Anexo I, "Preparação para
 * autenticação e API real".
 */
const TODAS: Permissao[] = [...PERMISSOES]

export const PERFIS: Perfil[] = [
  { id: 'admin', nome: 'Administrador', permissoes: TODAS },
  {
    id: 'operacao',
    nome: 'Operador administrativo',
    permissoes: [
      'contrato:ler', 'contrato:criar', 'contrato:renovar',
      'equipamento:ler', 'equipamento:criar', 'equipamento:movimentar',
      'os:ler', 'os:criar', 'peca:ler', 'fatura:ler', 'cliente:ler', 'cliente:criar',
      // Lança e cancela a nota. Não confere nem integra: são as duas outras
      // mãos da segregação (RN-027).
      'nota_fiscal:ler', 'nota_fiscal:criar', 'nota_fiscal:cancelar',
      'mapa:ler', 'comercial:ler',
    ],
  },
  {
    id: 'suporte',
    nome: 'Supervisor de suporte técnico',
    permissoes: [
      'equipamento:ler', 'equipamento:movimentar', 'equipamento:desbloquear',
      'os:ler', 'os:criar', 'os:triar', 'os:executar', 'os:validar',
      'peca:ler', 'estoque:movimentar', 'estoque:ajustar', 'contrato:ler', 'cliente:ler',
      // Confere a mercadoria: é quem abre as caixas e lê as etiquetas.
      'nota_fiscal:ler', 'nota_fiscal:conferir',
      'mapa:ler',
    ],
  },
  {
    id: 'financeiro',
    nome: 'Analista financeiro',
    permissoes: [
      'fatura:ler', 'prefatura:aprovar', 'fatura:emitir',
      'financeiro:painel_executivo', 'financeiro:rentabilidade_ler',
      'contrato:ler', 'cliente:ler', 'equipamento:ler', 'os:ler', 'peca:ler',
      // Integra ao imobilizado: é o lançamento contábil do ativo.
      'nota_fiscal:ler', 'nota_fiscal:integrar',
      'mapa:ler', 'comercial:ler', 'comercial:gerenciar',
    ],
  },
  {
    id: 'diretoria',
    nome: 'Diretoria',
    permissoes: [
      'financeiro:painel_executivo', 'financeiro:rentabilidade_ler', 'auditoria:consultar',
      'contrato:ler', 'contrato:aprovar', 'equipamento:ler', 'os:ler', 'fatura:ler', 'cliente:ler', 'peca:ler',
      'nota_fiscal:ler', 'mapa:ler', 'comercial:ler',
    ],
  },
]

export const perfilPorId = (id: string) => PERFIS.find((p) => p.id === id) ?? PERFIS[0]
