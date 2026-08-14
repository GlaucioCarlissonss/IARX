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
  // Segregação de funções (RN-027): registrar, conferir e integrar são
  // permissões distintas de propósito. Quem lança a nota não a confere.
  | 'nota_fiscal:ler' | 'nota_fiscal:criar' | 'nota_fiscal:conferir'
  | 'nota_fiscal:integrar' | 'nota_fiscal:cancelar'
  | 'mapa:ler'
  | 'comercial:ler' | 'comercial:gerenciar'
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
  'nota_fiscal:ler', 'nota_fiscal:criar', 'nota_fiscal:conferir',
  'nota_fiscal:integrar', 'nota_fiscal:cancelar',
  'mapa:ler',
  'comercial:ler', 'comercial:gerenciar',
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
