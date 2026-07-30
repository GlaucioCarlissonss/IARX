# 11. Segurança e Escalabilidade

## 11.1 Modelo de ameaças considerado

| Ameaça | Vetor típico | Mitigação principal |
| --- | --- | --- |
| Vazamento entre tenants | Consulta sem filtro de tenant | RLS no banco + filtro obrigatório no repositório (`RN-028`) |
| Escalonamento de privilégio | Endpoint sem guard, papel mal configurado | Negação por padrão, guard declarativo, teste automatizado de autorização por endpoint |
| Fraude interna | Desconto indevido, ajuste de estoque, cancelamento de fatura | Alçadas, segregação de funções (`RN-027`), auditoria imutável, alertas de padrão atípico |
| Manipulação de histórico | Edição de log para encobrir ação | `audit_log` append-only, sem permissão de UPDATE/DELETE, *hash chain* |
| Sequestro de sessão | Token roubado, XSS | Access token curto, refresh em cookie `httpOnly`, CSP restritiva, sanitização de entrada |
| Abuso de API | Credencial de integração exposta | Escopos mínimos, rotação, *rate limit*, IP allowlist opcional, revogação imediata |
| Perda de dado | Falha de infraestrutura, erro humano, ransomware | Backups com PITR, cópia imutável em outra região, restauração testada |
| Dispositivo de campo perdido | Aparelho do técnico extraviado | Token de dispositivo revogável, dados locais cifrados, escopo mínimo, expiração curta |
| Exposição de dados pessoais | Exportação sem controle, log verboso | Minimização, mascaramento em logs, auditoria de exportação, retenção definida |

## 11.2 Controle de acesso

- **Autenticação:** OIDC com PKCE, MFA obrigatório para perfis sensíveis, política de senha
  conforme NIST (comprimento sobre complexidade, verificação contra vazamentos conhecidos).
- **Autorização:** RBAC (`recurso:ação`) + ABAC de escopo organizacional, com alçadas por valor
  avaliadas pelo motor de regras (7.6).
- **Imposição em profundidade:** interface → API → aplicação → repositório → banco (RLS).
- **Ciclo de vida de acesso:** convite com expiração, revisão periódica de acessos, desativação
  imediata no desligamento, herança de escopo por estrutura organizacional.
- **Sessões:** listagem e revogação por usuário e por administrador; expiração por inatividade
  parametrizável; alerta de acesso a partir de dispositivo/local incomum.
- **Suporte técnico:** acesso a dados de tenant somente por sessão temporária de suporte, com
  motivo obrigatório, prazo curto, auditoria integral e notificação ao administrador do tenant.

Detalhamento de perfis e permissões no [Anexo C](anexos/C-matriz-de-permissoes.md).

## 11.3 Auditoria

Ver 7.9 para a estrutura técnica. Complementos de segurança:

| Aspecto | Definição |
| --- | --- |
| Escopo mínimo obrigatório | Autenticação (sucesso/falha), alteração de permissão, alteração de parametrização, criação/alteração/cancelamento de contrato, alocação/liberação de ativo, movimentação, leitura de medidor e correções, abertura/conclusão/validação de OS, movimento e ajuste de estoque, emissão/cancelamento de fatura, desconto, reabertura de competência, exportação de dados, acesso de suporte |
| Imutabilidade | Nenhum papel de aplicação possui `UPDATE`/`DELETE` na tabela de auditoria; verificação de integridade por *hash chain* |
| Consulta | Aba "Histórico" por entidade + central de auditoria com filtros e exportação assinada |
| Alertas de segurança | Volume atípico de exportação, múltiplas falhas de login, alteração de permissão fora do horário, liberação de bloqueio recorrente pelo mesmo usuário |
| Retenção | 5 anos mínimo; arquivamento frio após 12 meses; comprovação de integridade preservada no arquivo |

## 11.4 Proteção de dados

| Camada | Medida |
| --- | --- |
| Em trânsito | TLS 1.3 obrigatório, HSTS, redirecionamento forçado, certificados gerenciados e rotativos |
| Em repouso | Criptografia de volume e de backup; campos sensíveis (documentos, dados bancários) com criptografia em nível de aplicação e chaves em KMS |
| Segredos | Cofre gerenciado, rotação periódica, nunca em repositório ou variável de build; verificação de segredo vazado no CI |
| Anexos | URLs assinadas de curta duração, verificação antivírus no upload, validação de tipo real do arquivo, sem execução no domínio da aplicação |
| Minimização | Coleta apenas do necessário; dado sensível de pessoa física restrito por permissão específica |
| Mascaramento | Documentos e contatos mascarados em listas e logs; exibição completa exige permissão e é auditada |
| Ambientes não produtivos | Dados anonimizados/pseudonimizados; jamais cópia de produção sem tratamento |
| LGPD | Base legal por finalidade, registro de tratamento, atendimento a titular (acesso, correção, eliminação), política de retenção por tipo de dado, encarregado definido, contrato com suboperadores |
| Retenção e descarte | Regras por entidade: dados fiscais/financeiros conforme prazo legal; dados pessoais não essenciais eliminados ao fim da finalidade |

## 11.5 Segurança de aplicação

| Prática | Implementação |
| --- | --- |
| Validação de entrada | Schemas Zod na borda; nada chega ao domínio sem validação |
| Injeção | Queries parametrizadas; SQL nativo apenas com parâmetros vinculados; nenhuma concatenação |
| XSS | Escapamento por padrão do framework, CSP restritiva, proibição de `dangerouslySetInnerHTML` sem sanitização revisada |
| CSRF | Tokens de mesma origem + `SameSite=Strict` no refresh cookie |
| Desserialização e upload | Limite de tamanho, tipos permitidos, verificação de assinatura de arquivo |
| Dependências | SCA automatizado, atualização contínua, política de correção por severidade (crítico ≤ 7 dias) |
| SAST/DAST | Análise estática no CI e varredura dinâmica periódica em *staging* |
| Testes de autorização | Suíte que percorre todos os endpoints garantindo negação sem permissão |
| Revisão de código | PR obrigatório com revisão humana; mudanças em IAM, faturamento e auditoria exigem revisor sênior designado |
| Resposta a incidente | Runbook com severidades, comunicação, contenção, análise de causa raiz e *post-mortem* sem culpabilização |

## 11.6 Multiempresa (multi-tenancy)

| Aspecto | Definição |
| --- | --- |
| Estratégia padrão | Banco compartilhado, schema compartilhado, isolamento por `tenant_id` + RLS |
| Contexto de sessão | `SET LOCAL app.tenant_id` por transação, resolvido por `app.tenant_atual()`; nenhuma query executa sem contexto. **`SET` de sessão é proibido**: com pooler em modo transação vazaria o tenant para a requisição seguinte (H.5.2) |
| Verificação | Suíte obrigatória executa duas transações de tenants distintos **na mesma conexão** e prova que não há vazamento — `packages/db/tests/02_rn028_isolamento_tenant.sql` |
| Hierarquia | `Tenant → Empresa → Filial/Base → Local de operação`, com escopos de permissão em qualquer nível |
| Parametrização | Numeração, SLAs, regras de cobrança, planos preventivos, checklists, campos personalizados e políticas — todos por tenant |
| Isolamento de recursos | Filas com prioridade e cota por tenant; *rate limit* por tenant; jobs longos não bloqueiam outros tenants |
| Tenant de grande porte | Promoção para banco dedicado com roteamento por `tenant_id`, sem alteração de código |
| Migração e onboarding | Provisionamento automatizado, importação assistida de frota/clientes/peças, dados de exemplo removíveis |
| Encerramento | Exportação completa dos dados do tenant + eliminação verificável após prazo contratual |

## 11.7 Escalabilidade

Detalhamento técnico em 7.8. Consolidação por vetor:

| Vetor | Situação inicial | Caminho de crescimento |
| --- | --- | --- |
| Aplicação | 2 instâncias da API + 2 workers | Autoescala horizontal por latência/CPU; separação de workers por tipo de carga |
| Banco | Instância Supabase + réplica de leitura (conforme plano) | Réplicas adicionais, pooling por Supavisor, particionamento temporal, banco dedicado para tenant de grande porte (H.8) |
| Filas | Redis gerenciado com filas por domínio | Filas dedicadas por criticidade, *dead letter queue* com reprocessamento controlado |
| Mapa | Consultas espaciais com índice GiST e agregação no banco | *Tiles* vetoriais pré-gerados e cache por *viewport* |
| Analítico | Views materializadas atualizadas por evento | Exportação para *data warehouse* e camada de BI (Fase 5) |
| Storage | Bucket único por região | Ciclo de vida por idade (quente → frio), CDN para conteúdo público assinado |
| Custo/observabilidade | Métricas por tenant desde o início | Base para precificação por uso e para detecção de tenant anômalo |

**Limites de projeto adotados como referência:** 20.000 ativos ativos por tenant, 5.000
contratos-item vigentes, 1.000.000 de leituras/ano, 200.000 movimentações/ano, 50.000 OS/ano.
Acima disso, aciona-se a revisão de particionamento e a extração de módulos.

## 11.8 Backup, recuperação e continuidade

| Item | Definição |
| --- | --- |
| RPO | ≤ 5 minutos (WAL contínuo / *point-in-time recovery*). **Condicionado ao plano Supabase contratado**: PITR é recurso pago. Sem ele, o RPO real é o do backup diário e precisa ser aceito formalmente (H.8) |
| RTO | ≤ 2 horas para restauração completa do serviço |
| Backup completo | Diário, retenção 30 dias |
| Backup incremental/WAL | Contínuo, retenção 7 dias para PITR |
| Cópia mensal | Retenção 12 meses, armazenamento imutável (*object lock*) |
| Geografia | Cópia em região distinta da primária |
| Teste de restauração | Exercício mensal automatizado com validação de integridade e registro do tempo obtido |
| Restauração parcial | Procedimento para restaurar dados de um único tenant sem afetar os demais |
| Storage de anexos | Versionamento habilitado + replicação entre regiões |
| DR | Runbook documentado, responsáveis nomeados, simulação semestral |
| Degradação controlada | Modo somente leitura em incidente parcial, preservando consulta de contratos, ativos e OS |

## 11.9 Boas práticas de desenvolvimento adotadas

| Prática | Aplicação |
| --- | --- |
| Tipagem estrita e validação compartilhada | TypeScript estrito + Zod na borda e no domínio |
| Testes de invariantes de domínio | Regras `RN-001`, `RN-017`, `RN-020`, `RN-022` testadas contra banco real via Testcontainers |
| Migrações reversíveis | Padrão *expand → migrate → contract*; nenhuma migração destrutiva em uma única release |
| Feature flags | Funcionalidade de risco desligada por padrão, habilitação por tenant |
| CI obrigatória | Lint, tipos, unidade, integração, fronteira de módulo, SCA, verificação de migração |
| Ambientes com paridade | `staging` equivalente à produção, com dados anonimizados |
| Deploy seguro | Blue-green/rolling, *health check* real, rollback automatizado, canário por tenant |
| Observabilidade desde o commit | Todo caso de uso emite métrica e trace nomeados |
| ADRs | Decisões estruturais registradas com contexto, alternativas e consequências |
| Orçamento de dívida técnica | 15–20% da capacidade por ciclo, priorizado junto ao produto |
