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
 * Os nove perfis-base do [Anexo C](../../../../docs/anexos/C-matriz-de-permissoes.md) §C.3,
 * com o conteúdo de §C.4 e §C.4.2.
 *
 * **Estas listas não são escolha de quem escreveu o arquivo.** São a transcrição
 * da matriz perfil × permissão, e `test/matriz-permissoes.test.ts` relê o anexo
 * e compara — se as duas divergirem, a suíte falha e diz qual permissão sobrou
 * ou faltou em qual perfil. As convenções de tradução (◐ concede, ○ concede só
 * as leituras da linha, o Administrador é ✔ em tudo) estão em §C.4.1.
 *
 * Antes disto o código tinha cinco perfis com nomes próprios e **94 das 125
 * permissões não alcançavam ninguém além do Administrador** — entre elas o bloco
 * financeiro inteiro, o que impedia a aplicação de demonstrar a segregação de
 * funções que os Módulos 10 e 11 existem para provar. Hoje sobram seis, todas de
 * administração do locatário, e é o que a própria matriz determina.
 *
 * Massa de exemplo, não configuração de produção: no ambiente real os perfis
 * vêm de `public.perfil`, provisionados por tenant.
 *
 * **Único consumidor: `dados/gerar.ts`.** A sessão lê os perfis de `BASE.perfis`,
 * não daqui. Enquanto lia desta lista, a tela de perfis gravava numa coleção e o
 * `pode()` consultava outra — salvar não mudava nada na interface.
 */
const TODAS: Permissao[] = [...PERMISSOES]

export const PERFIS: Perfil[] = [
  { id: 'admin', nome: 'Administrador da Plataforma', permissoes: TODAS },
  {
    id: 'diretoria',
    nome: 'Diretor',
    permissoes: [
      'cliente:ler', 'cliente:credito_definir',
      'contrato:ler', 'contrato:aprovar', 'contrato:suspender', 'contrato:retomar',
      'contrato:renovar', 'contrato:encerrar', 'contrato:cancelar', 'contrato:distratar',
      'contrato:desconto_conceder', 'contrato:reajuste_aprovar',
      'equipamento:ler', 'equipamento:patrimonial_editar', 'equipamento:bloquear',
      'equipamento:desbloquear', 'equipamento:baixar',
      'os:ler', 'os:custo_aprovar',
      'peca:ler',
      'estoque:ajustar',
      'inventario:aprovar',
      'ordem_compra:aprovar',
      'nota_fiscal:ler',
      'fornecedor:ler',
      'medicao:ler', 'medicao:estimar',
      'fatura:ler', 'fatura:emitir', 'fatura:cancelar', 'fatura:nota_correcao',
      'fatura:desconto_aplicar',
      'competencia:fechar', 'competencia:reabrir',
      'faturamento:exportar',
      'receber:ler', 'receber:baixar', 'receber:negociar', 'receber:aprovar',
      'pagar:ler', 'pagar:aprovar', 'pagar:cancelar', 'pagar:delegar_aprovacao',
      'financeiro:lancamento_manual', 'financeiro:painel_executivo',
      'financeiro:rentabilidade_ler', 'financeiro:exportar',
      'centro_custo:ler',
      'conta_bancaria:ler', 'conta_bancaria:transferir',
      'comercial:ler',
      'mapa:ler', 'mapa:filtro_compartilhar',
      'relatorio:ler', 'relatorio:criar', 'relatorio:agendar',
      'alcada:definir',
      'auditoria:consultar',
      'dados_sensiveis:ver_completo',
    ],
  },
  {
    id: 'gestor-filial',
    nome: 'Gestor de Filial',
    permissoes: [
      'cliente:ler', 'cliente:criar', 'cliente:editar', 'cliente:inativar',
      'cliente:credito_definir',
      'local_operacao:gerenciar',
      'contrato:ler', 'contrato:criar', 'contrato:editar', 'contrato:aprovar',
      'contrato:ativar', 'contrato:suspender', 'contrato:retomar', 'contrato:renovar',
      'contrato:encerrar', 'contrato:cancelar', 'contrato:distratar', 'contrato:item_alocar',
      'contrato:item_substituir', 'contrato:item_encerrar', 'contrato:desconto_conceder',
      'contrato:reajuste_aprovar', 'contrato:anexo_gerenciar',
      'equipamento:ler', 'equipamento:criar', 'equipamento:editar', 'equipamento:importar',
      'equipamento:patrimonial_editar', 'equipamento:movimentar', 'equipamento:transferir',
      'equipamento:transferencia_aceitar', 'equipamento:bloquear', 'equipamento:desbloquear',
      'equipamento:leitura_registrar', 'equipamento:leitura_estornar',
      'equipamento:etiqueta_gerar',
      'catalogo:gerenciar',
      'os:ler', 'os:criar', 'os:triar', 'os:atribuir', 'os:agendar', 'os:validar',
      'os:cancelar', 'os:reabrir', 'os:custo_aprovar',
      'plano_preventivo:gerenciar',
      'peca:ler', 'peca:criar', 'peca:editar',
      'estoque:movimentar', 'estoque:ajustar', 'estoque:politica_definir',
      'inventario:executar', 'inventario:aprovar',
      'ordem_compra:criar', 'ordem_compra:aprovar',
      'medicao:ler', 'medicao:consolidar', 'medicao:estimar',
      'fatura:ler', 'fatura:desconto_aplicar',
      'prefatura:gerar', 'prefatura:editar', 'prefatura:aprovar',
      'pagar:ler', 'pagar:aprovar',
      'financeiro:painel_executivo', 'financeiro:rentabilidade_ler',
      'centro_custo:ler',
      'comercial:ler',
      'mapa:ler', 'mapa:filtro_compartilhar',
      'relatorio:ler', 'relatorio:criar', 'relatorio:agendar',
      'auditoria:consultar',
      'dados_sensiveis:ver_completo',
    ],
  },
  {
    id: 'operacao',
    nome: 'Operador Administrativo',
    permissoes: [
      'cliente:ler', 'cliente:criar', 'cliente:editar',
      'local_operacao:gerenciar',
      'contrato:ler', 'contrato:criar', 'contrato:editar', 'contrato:ativar',
      'contrato:suspender', 'contrato:retomar', 'contrato:renovar', 'contrato:item_alocar',
      'contrato:item_substituir', 'contrato:item_encerrar', 'contrato:desconto_conceder',
      'contrato:anexo_gerenciar',
      'equipamento:ler', 'equipamento:criar', 'equipamento:editar', 'equipamento:importar',
      'equipamento:movimentar', 'equipamento:transferir', 'equipamento:transferencia_aceitar',
      'equipamento:leitura_registrar', 'equipamento:leitura_estornar',
      'equipamento:etiqueta_gerar',
      'catalogo:gerenciar',
      'os:ler', 'os:criar',
      'peca:ler',
      'nota_fiscal:ler', 'nota_fiscal:criar', 'nota_fiscal:editar', 'nota_fiscal:cancelar',
      'fornecedor:ler', 'fornecedor:gerenciar',
      'medicao:ler', 'medicao:consolidar',
      'fatura:ler',
      'prefatura:gerar', 'prefatura:editar', 'prefatura:aprovar',
      'centro_custo:ler',
      'comercial:ler',
      'mapa:ler', 'mapa:filtro_compartilhar',
      'relatorio:ler',
      'dados_sensiveis:ver_completo',
    ],
  },
  {
    id: 'logistica',
    nome: 'Coordenador de Logística',
    permissoes: [
      'cliente:ler',
      'contrato:ler', 'contrato:item_alocar', 'contrato:item_substituir',
      'contrato:item_encerrar',
      'equipamento:ler', 'equipamento:criar', 'equipamento:editar', 'equipamento:movimentar',
      'equipamento:transferir', 'equipamento:transferencia_aceitar',
      'equipamento:leitura_registrar',
      'os:ler', 'os:criar',
      'peca:ler',
      'estoque:movimentar',
      'inventario:executar',
      'ordem_compra:receber',
      'mapa:ler', 'mapa:filtro_compartilhar',
      'relatorio:ler',
    ],
  },
  {
    id: 'manutencao',
    nome: 'Supervisor de Manutenção',
    permissoes: [
      'cliente:ler',
      'contrato:ler',
      'equipamento:ler', 'equipamento:criar', 'equipamento:editar', 'equipamento:movimentar',
      'equipamento:bloquear', 'equipamento:desbloquear', 'equipamento:leitura_registrar',
      'equipamento:leitura_estornar',
      'catalogo:gerenciar',
      'os:ler', 'os:criar', 'os:triar', 'os:atribuir', 'os:agendar', 'os:executar',
      'os:concluir', 'os:validar', 'os:cancelar', 'os:reabrir', 'os:custo_aprovar',
      'os:sla_pausar',
      'plano_preventivo:gerenciar',
      'tecnico:gerenciar',
      'peca:ler', 'peca:criar', 'peca:editar',
      'estoque:movimentar', 'estoque:reservar', 'estoque:ajustar', 'estoque:politica_definir',
      'inventario:executar', 'inventario:aprovar',
      'ordem_compra:criar', 'ordem_compra:receber',
      'nota_fiscal:ler', 'nota_fiscal:conferir',
      'fornecedor:ler',
      'mapa:ler', 'mapa:filtro_compartilhar',
      'relatorio:ler',
    ],
  },
  {
    id: 'tecnico',
    nome: 'Técnico de Manutenção',
    permissoes: [
      'contrato:ler',
      'equipamento:ler', 'equipamento:movimentar', 'equipamento:bloquear',
      'equipamento:leitura_registrar',
      'os:ler', 'os:criar', 'os:executar', 'os:concluir', 'os:sla_pausar',
      'peca:ler',
      'estoque:movimentar', 'estoque:reservar',
      'inventario:executar',
      'mapa:ler', 'mapa:filtro_compartilhar',
      'relatorio:ler',
    ],
  },
  {
    id: 'financeiro',
    nome: 'Analista Financeiro',
    permissoes: [
      'cliente:ler', 'cliente:criar', 'cliente:editar', 'cliente:credito_definir',
      'contrato:ler', 'contrato:desconto_conceder', 'contrato:reajuste_aprovar',
      'equipamento:ler', 'equipamento:patrimonial_editar', 'equipamento:leitura_estornar',
      'os:ler',
      'peca:ler',
      'ordem_compra:criar', 'ordem_compra:aprovar',
      'nota_fiscal:ler', 'nota_fiscal:integrar',
      'fornecedor:ler', 'fornecedor:gerenciar',
      'medicao:ler', 'medicao:consolidar', 'medicao:estimar',
      'fatura:ler', 'fatura:emitir', 'fatura:cancelar', 'fatura:nota_correcao',
      'fatura:desconto_aplicar',
      'prefatura:gerar', 'prefatura:editar', 'prefatura:aprovar',
      'competencia:fechar', 'competencia:reabrir',
      'faturamento:exportar',
      'receber:ler', 'receber:baixar', 'receber:negociar', 'receber:criar', 'receber:aprovar',
      'receber:cancelar',
      'pagar:ler', 'pagar:criar', 'pagar:aprovar', 'pagar:baixar', 'pagar:cancelar',
      'conciliacao:executar',
      'financeiro:lancamento_manual', 'financeiro:painel_executivo',
      'financeiro:rentabilidade_ler', 'financeiro:exportar',
      'centro_custo:ler', 'centro_custo:gerenciar',
      'conta_bancaria:ler', 'conta_bancaria:gerenciar', 'conta_bancaria:movimentar',
      'conta_bancaria:transferir',
      'comercial:ler', 'comercial:gerenciar',
      'relatorio:ler', 'relatorio:criar', 'relatorio:agendar',
      'auditoria:consultar',
      'dados_sensiveis:ver_completo',
    ],
  },
  {
    id: 'consulta',
    nome: 'Consulta',
    permissoes: [
      'cliente:ler',
      'contrato:ler',
      'equipamento:ler',
      'os:ler',
      'peca:ler',
      'fatura:ler',
      'receber:ler',
      'pagar:ler',
      'financeiro:painel_executivo',
      'comercial:ler',
      'mapa:ler',
      'relatorio:ler',
    ],
  },
]

export const perfilPorId = (id: string) => PERFIS.find((p) => p.id === id) ?? PERFIS[0]
