/**
 * Modelo de permissões do front-end.
 *
 * Espelha o Anexo C: permissão no formato `recurso:ação` e escopo
 * organizacional. Aqui ele serve para renderizar apenas o que o usuário pode
 * operar — mas a decisão de autorização é sempre do servidor. O front esconde
 * para reduzir ruído, nunca para proteger.
 */

export type Permissao =
  | 'contrato:ler' | 'contrato:criar' | 'contrato:aprovar' | 'contrato:renovar'
  | 'equipamento:ler' | 'equipamento:criar' | 'equipamento:movimentar' | 'equipamento:desbloquear'
  | 'os:ler' | 'os:criar' | 'os:triar' | 'os:executar' | 'os:validar'
  | 'peca:ler' | 'estoque:movimentar' | 'estoque:ajustar'
  | 'fatura:ler' | 'prefatura:aprovar' | 'fatura:emitir'
  | 'financeiro:painel_executivo' | 'financeiro:rentabilidade_ler'
  | 'cliente:ler' | 'cliente:criar'
  | 'usuario:gerenciar' | 'auditoria:consultar'

export interface Perfil {
  id: string
  nome: string
  permissoes: Permissao[]
}

const TODAS: Permissao[] = [
  'contrato:ler', 'contrato:criar', 'contrato:aprovar', 'contrato:renovar',
  'equipamento:ler', 'equipamento:criar', 'equipamento:movimentar', 'equipamento:desbloquear',
  'os:ler', 'os:criar', 'os:triar', 'os:executar', 'os:validar',
  'peca:ler', 'estoque:movimentar', 'estoque:ajustar',
  'fatura:ler', 'prefatura:aprovar', 'fatura:emitir',
  'financeiro:painel_executivo', 'financeiro:rentabilidade_ler',
  'cliente:ler', 'cliente:criar',
  'usuario:gerenciar', 'auditoria:consultar',
]

export const PERFIS: Perfil[] = [
  { id: 'admin', nome: 'Administrador', permissoes: TODAS },
  {
    id: 'operacao',
    nome: 'Operador administrativo',
    permissoes: [
      'contrato:ler', 'contrato:criar', 'contrato:renovar',
      'equipamento:ler', 'equipamento:criar', 'equipamento:movimentar',
      'os:ler', 'os:criar', 'peca:ler', 'fatura:ler', 'cliente:ler', 'cliente:criar',
    ],
  },
  {
    id: 'suporte',
    nome: 'Supervisor de suporte técnico',
    permissoes: [
      'equipamento:ler', 'equipamento:movimentar', 'equipamento:desbloquear',
      'os:ler', 'os:criar', 'os:triar', 'os:executar', 'os:validar',
      'peca:ler', 'estoque:movimentar', 'estoque:ajustar', 'contrato:ler', 'cliente:ler',
    ],
  },
  {
    id: 'financeiro',
    nome: 'Analista financeiro',
    permissoes: [
      'fatura:ler', 'prefatura:aprovar', 'fatura:emitir',
      'financeiro:painel_executivo', 'financeiro:rentabilidade_ler',
      'contrato:ler', 'cliente:ler', 'equipamento:ler', 'os:ler', 'peca:ler',
    ],
  },
  {
    id: 'diretoria',
    nome: 'Diretoria',
    permissoes: [
      'financeiro:painel_executivo', 'financeiro:rentabilidade_ler', 'auditoria:consultar',
      'contrato:ler', 'contrato:aprovar', 'equipamento:ler', 'os:ler', 'fatura:ler', 'cliente:ler', 'peca:ler',
    ],
  },
]

export const perfilPorId = (id: string) => PERFIS.find((p) => p.id === id) ?? PERFIS[0]
