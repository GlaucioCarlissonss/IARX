# 7. Arquitetura Funcional

## 7.1 Visão geral em camadas

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  CLIENTES                                                                        │
│  Web App (Next.js/React)   PWA de Campo (offline-first)   API Pública / Parceiros │
└─────────────────────────────────────┬────────────────────────────────────────────┘
                                      │ HTTPS · JWT · OpenAPI v1
┌─────────────────────────────────────▼────────────────────────────────────────────┐
│  BORDA                                                                           │
│  CDN/WAF · API Gateway (rate limit, autenticação, idempotência, tracing)          │
└─────────────────────────────────────┬────────────────────────────────────────────┘
                                      │
┌─────────────────────────────────────▼────────────────────────────────────────────┐
│  APLICAÇÃO — Monólito modular (NestJS/TypeScript)                                │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ Camada de Interface: Controllers REST · Validação (DTO) · Serialização    │   │
│  ├──────────────────────────────────────────────────────────────────────────┤   │
│  │ Camada de Aplicação: Casos de uso · Orquestração · Transação · Outbox     │   │
│  ├──────────────────────────────────────────────────────────────────────────┤   │
│  │ Camada de Domínio: Agregados · Invariantes · Máquinas de estado · Eventos │   │
│  │  CTR · EQP · MAP · FAT · MNT · EST · FIN                                  │   │
│  ├──────────────────────────────────────────────────────────────────────────┤   │
│  │ Camada de Infraestrutura: Repositórios · Storage · Fila · E-mail · Mapas  │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
└──────────┬──────────────────────┬───────────────────────┬────────────────────────┘
           │                      │                       │
┌──────────▼─────────┐  ┌─────────▼──────────┐  ┌─────────▼────────────────────┐
│ PostgreSQL         │  │ Redis              │  │ Object Storage (S3-compat.)  │
│ + PostGIS          │  │ cache · locks      │  │ anexos · exportações · PDFs  │
│ + RLS multi-tenant │  │ filas (BullMQ)     │  └──────────────────────────────┘
│ + réplica leitura  │  └────────────────────┘
└────────────────────┘
           │
┌──────────▼───────────────────────────────────────────────────────────────────────┐
│  WORKERS ASSÍNCRONOS (mesma base de código, processo separado)                    │
│  Fechamento · Réguas de alerta · Geração de preventivas · Exportações ·           │
│  Notificações · Integrações · Reprocessamentos · Projeções analíticas             │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## 7.2 Decisão arquitetural principal: monólito modular

| Critério | Monólito modular (escolhido) | Microsserviços desde o início (descartado) |
| --- | --- | --- |
| Transação de alocação e fechamento | ACID nativa | Exigiria saga/compensação desde o dia 1 |
| Velocidade de entrega do MVP | Alta | Baixa (infra + observabilidade distribuída) |
| Custo operacional | Um pipeline, um deploy | N pipelines, service mesh, versionamento de contrato |
| Caminho de escala | Réplicas horizontais + workers + extração módulo a módulo | Já distribuído, porém complexo antes da necessidade |
| Risco | Erosão de fronteiras (mitigado por lint de importação e testes de fronteira) | Complexidade acidental e falhas parciais difusas |

**Regra de evolução:** um módulo só é extraído para serviço próprio quando apresentar, de forma
sustentada, perfil de carga ou de disponibilidade distinto do núcleo. Candidatos naturais e ordem
provável: `RPT` → `MAP` → `INT` → `NTF`.

## 7.3 Backend

### 7.3.1 Stack recomendada

| Camada | Escolha | Justificativa |
| --- | --- | --- |
| Runtime/linguagem | Node.js LTS + TypeScript estrito | Mesma linguagem no front e no back reduz custo de equipe e permite compartilhar tipos e validadores |
| Framework | NestJS | Modularidade e injeção de dependência nativas, alinhadas ao desenho por módulos |
| ORM/Query | Prisma (CRUD e migrações) + SQL nativo para consultas analíticas e espaciais | Produtividade sem perder controle nos pontos críticos |
| Banco | PostgreSQL 16+ com PostGIS | Transações fortes, RLS, tipos de intervalo/exclusion constraints, GIS nativo |
| Cache/locks/fila | Redis + BullMQ | Filas confiáveis, agendamento, *rate limit*, locks distribuídos |
| Storage | S3-compatível com URLs assinadas | Anexos, PDFs, exportações, sem servir arquivo pela aplicação |
| Validação | Zod (compartilhado front/back) | Mesma regra de forma de dado nas duas pontas |
| Observabilidade | OpenTelemetry + Prometheus + Grafana + Sentry | Rastreamento distribuído, métricas de negócio e erros correlacionados |
| Testes | Vitest (unidade), Testcontainers (integração), Playwright (E2E) | Invariantes de domínio testadas contra banco real |

> **Alternativa equivalente:** .NET 8 + EF Core ou Java/Spring Boot, se a equipe existente tiver
> essa base. A arquitetura funcional proposta é independente da linguagem; o que não é negociável é
> PostgreSQL com RLS, modularidade explícita e workers assíncronos separados.

### 7.3.2 Organização do código

```
apps/
  api/                     # HTTP + composição de módulos
  worker/                  # consumidores de fila e jobs agendados
packages/
  domain-ctr/              # entidades, invariantes, casos de uso, eventos
  domain-eqp/
  domain-fat/
  domain-mnt/
  domain-est/
  domain-fin/
  domain-map/
  platform-iam/            # autenticação, autorização, escopos
  platform-audit/
  platform-notify/
  platform-rules/          # motor de regras paramétricas
  platform-storage/
  contracts/               # DTOs, schemas Zod, tipos de eventos (fonte única)
  db/                      # schema, migrações, seeds, políticas RLS
```

- Cada `domain-*` expõe apenas sua *service interface* pública; o restante é privado.
- `contracts/` é a única fonte de tipos compartilhados com o frontend (gera cliente e OpenAPI).
- CI valida grafo de importação: nenhum `domain-x` importa internals de `domain-y`.

### 7.3.3 Padrões de domínio aplicados

| Padrão | Onde | Por quê |
| --- | --- | --- |
| Agregado com invariante local | `Contrato`, `Equipamento`, `OrdemServico`, `Fatura` | Consistência garantida na fronteira transacional |
| Máquina de estados explícita | Contrato, Equipamento, OS, Fatura, Movimento | Transições válidas declaradas e testáveis (Anexo B) |
| Event sourcing *lite* | Movimentações, leituras, movimentos de estoque, lançamentos | Estado atual é projeção do log imutável; auditoria nativa |
| Transactional Outbox | Publicação de eventos | Nunca perde evento nem publica evento de transação revertida |
| Idempotência por chave | Toda escrita externa e consumo de fila | Reprocessamento seguro (`RN-029`) |
| CQRS leve | Leituras de mapa, dashboards e relatórios | Consultas pesadas em réplica/projeção, sem penalizar escrita |
| Especificação/Policy | Regras paramétricas por tenant | Comportamento configurável sem *fork* de código |

## 7.4 Frontend

| Camada | Escolha | Justificativa |
| --- | --- | --- |
| Framework | Next.js (App Router) + React + TypeScript | Renderização híbrida, rotas aninhadas e ótimo desempenho percebido |
| Estado de servidor | TanStack Query | Cache, invalidação, otimismo e revalidação sem *boilerplate* |
| Estado de UI | Zustand (local, mínimo) | Estado de interface sem *store* global monolítica |
| Design system | Tailwind CSS + componentes acessíveis (base Radix/shadcn) | Consistência visual com velocidade e acessibilidade |
| Formulários | React Hook Form + Zod | Validação idêntica à do backend, evitando divergência |
| Tabelas | TanStack Table com virtualização | Listas de milhares de ativos sem travar |
| Mapas | MapLibre GL (vetorial) + PostGIS no servidor | Independência de provedor de tiles, desempenho em escala |
| Gráficos | Biblioteca leve de charts (ECharts ou Recharts) | Painéis executivos responsivos |
| PWA de campo | Service Worker + IndexedDB + fila de sincronização | Offline real para técnico e pátio |
| Mobile nativo *(futuro)* | React Native/Expo reutilizando `contracts/` | Câmera, GPS e notificação nativas quando necessário |

**Estratégia mobile:** PWA primeiro (Fase 2), aplicativo nativo somente se surgirem requisitos que o
PWA não atenda bem — leitura de tag NFC/RFID, uso intensivo de câmera em baixa luminosidade,
rastreamento em segundo plano.

### 7.4.1 Sincronização offline (PWA)

1. **Fila local de comandos:** cada ação (apontar leitura, baixar peça, concluir OS) grava um
   comando com `client_id` (UUID) e `idempotency_key` no IndexedDB.
2. **Envio ordenado por entidade:** ao recuperar conexão, os comandos são enviados na ordem em que
   afetam a mesma entidade.
3. **Resolução de conflito determinística:** anexos e apontamentos são aditivos (nunca conflitam);
   mudanças de estado usam *last-write-wins* com detecção de versão e sinalização ao usuário quando
   o servidor rejeita a transição (ex.: OS já validada por outra pessoa).
4. **Dados pré-carregados:** OS do dia, ativos da rota, catálogo de peças do depósito do técnico e
   modelos de checklist.

## 7.5 Autenticação

| Aspecto | Definição |
| --- | --- |
| Protocolo | OAuth 2.1 / OIDC com *Authorization Code + PKCE* |
| Provedor | Servidor de identidade dedicado (Keycloak ou equivalente gerenciado), evitando autenticação artesanal |
| Tokens | Access token JWT curto (15 min, com `tenant_id`, `sub`, `perfis`, `escopos`) + refresh token rotativo em cookie `httpOnly`+`Secure`+`SameSite=Strict` |
| MFA | TOTP obrigatório para perfis administrativo, financeiro e de alçada; opcional para os demais |
| Sessões | Listagem e revogação de sessões ativas; expiração por inatividade parametrizável por tenant |
| Login federado | SSO corporativo via OIDC/SAML por tenant (Fase 4) |
| Contas de serviço | Chaves de API por tenant com escopos restritos, rotação e expiração |
| Dispositivos de campo | Token de dispositivo de longa duração com escopo mínimo (`os:executar`, `leitura:registrar`), revogável individualmente |
| Antiabuso | *Rate limit* por IP e por conta, bloqueio progressivo, alerta de login atípico |

## 7.6 Controle de permissões

### 7.6.1 Modelo RBAC + ABAC de escopo

```
Usuário ──► Perfil(is) ──► Permissões (recurso:ação)
    │                            │
    └──► Escopo organizacional ──┘  (tenant · empresa · filial · região · carteira própria)

Autorização = possui(permissão) AND registro ∈ escopo(usuário) AND satisfaz(política do tenant)
```

- **Permissão** no formato `recurso:ação` — ex.: `contrato:criar`, `contrato:aprovar`,
  `fatura:emitir`, `estoque:ajustar`, `equipamento:desbloquear`, `auditoria:consultar`.
- **Escopo** aplicado no repositório, não no controller: toda consulta recebe o filtro de escopo,
  impossibilitando vazamento por endpoint esquecido.
- **Alçadas por valor** como política avaliada pelo motor de regras (desconto, custo de OS,
  ajuste de estoque, liberação de bloqueio).
- **Negação por padrão** e **segregação de funções** conforme `RN-026` e `RN-027`.
- Detalhamento completo no [Anexo C](anexos/C-matriz-de-permissoes.md).

### 7.6.2 Imposição em profundidade

| Camada | Mecanismo |
| --- | --- |
| Interface | Menus, botões e campos renderizados conforme permissões efetivas (com motivo no *tooltip* quando desabilitado) |
| API | Guard declarativo por endpoint (`@RequirePermission('fatura:emitir')`) |
| Aplicação | Verificação de alçada e política antes do comando de domínio |
| Repositório | Injeção obrigatória de filtro de tenant e escopo |
| Banco | RLS por `tenant_id` (`RN-028`) |

## 7.7 Estrutura de APIs

Convenções completas e endpoints no [Anexo D](anexos/D-catalogo-de-apis.md). Resumo:

- **Estilo:** REST sobre JSON, versionado em rota (`/api/v1`), documentado por OpenAPI 3.1 gerado do
  código (nunca escrito à mão).
- **Recursos por domínio:** `/clientes`, `/contratos`, `/equipamentos`, `/movimentacoes`,
  `/leituras`, `/ordens-servico`, `/pecas`, `/estoque/movimentos`, `/medicoes`, `/faturas`,
  `/recebiveis`, `/pagaveis`, `/relatorios`, `/mapa/ativos`.
- **Ações de domínio como sub-recursos**, não como campos de update:
  `POST /contratos/{id}/ativar`, `POST /contratos/{id}/renovar`,
  `POST /equipamentos/{id}/movimentacoes`, `POST /ordens-servico/{id}/concluir`,
  `POST /faturas/{id}/emitir`. Isso mantém a máquina de estados explícita e auditável.
- **Paginação por cursor** (estável sob inserção concorrente), filtros declarativos e
  `?include=` para expansão controlada.
- **Erros** em `application/problem+json` (RFC 9457) com `code` estável, mensagem acionável e
  campo violado — inclusive para regras de negócio (ex.: `EQUIPAMENTO_JA_ALOCADO`).
- **Idempotência** obrigatória em POST de efeito financeiro/operacional (`RN-029`).
- **Webhooks** assinados (HMAC-SHA256), com reentrega exponencial e log de entrega consultável.
- **Limites:** *rate limit* por chave/tenant, tamanho máximo de payload, e exportação sempre
  assíncrona (job + link assinado), nunca resposta síncrona gigante.

## 7.8 Estratégia de escalabilidade

| Vetor | Estratégia |
| --- | --- |
| Aplicação | Contêineres *stateless* com autoescala horizontal por CPU/latência; sessão apenas no token |
| Leitura | Réplica de leitura para mapa, dashboards e relatórios; *connection pooling* (PgBouncer) |
| Escrita | Índices dirigidos aos filtros reais; particionamento por tempo em tabelas de alto volume (`leituras`, `movimentacoes`, `audit_log`, `notificacoes`) |
| Trabalho pesado | Todo processo longo em fila (fechamento, exportação, importação, PDFs, geração de preventivas), com prioridade por tipo |
| Cache | Cache de catálogo, parametrização e projeções de dashboard, invalidado por evento de domínio |
| Mapa | *Tiles* vetoriais e agregação espacial no banco; nunca envio de todos os pontos ao navegador |
| Analítico | Projeções materializadas atualizadas por evento; exportação para *data warehouse* na Fase 5 |
| Multi-tenant | Isolamento lógico com RLS por padrão; tenants de altíssimo volume podem migrar para banco dedicado sem mudança de código (roteamento por `tenant_id`) |
| Custo | Métricas por tenant (transações, storage, jobs) para dimensionamento e futura precificação por uso |

**Metas de desempenho (SLO de produto):**

| Operação | Meta p95 |
| --- | --- |
| Carga de lista com filtro (1.000+ registros) | < 800 ms |
| Consulta de disponibilidade em tempo real | < 400 ms |
| Alocação de equipamento (escrita transacional) | < 700 ms |
| Renderização inicial do mapa (5.000 ativos) | < 2,5 s |
| Dashboard operacional | < 1,5 s |
| Fechamento de 1.000 contratos (assíncrono) | < 10 min |

## 7.9 Estratégia de auditoria

| Elemento | Definição |
| --- | --- |
| Armazenamento | Tabela `audit_log` *append-only*, particionada por mês, sem `UPDATE`/`DELETE` concedidos a nenhum papel de aplicação |
| Captura | Interceptor na camada de aplicação (intenção e contexto de negócio) + *trigger* no banco para tabelas críticas (rede de segurança) |
| Conteúdo | `tenant_id`, entidade, id, ação, `campo`, valor anterior, valor novo, autor, perfil efetivo, `request_id`, IP, agente, timestamp com fuso, motivo |
| Correlação | `request_id` propagado do navegador ao worker, ligando ação do usuário a todos os efeitos derivados |
| Auditoria de leitura | Registrada apenas para dados sensíveis (dados de cliente, exportações, relatórios financeiros) — evita ruído |
| Consulta | Aba "Histórico" em cada entidade + central de auditoria com filtros e exportação |
| Integridade | *Hash chain* por partição (cada registro encadeia o hash do anterior), permitindo detecção de manipulação |
| Retenção | Mínimo 5 anos, com arquivamento frio após 12 meses |

## 7.10 Estrutura de logs e observabilidade

| Sinal | Definição |
| --- | --- |
| Logs de aplicação | JSON estruturado, um evento por linha, com `request_id`, `tenant_id`, `user_id`, `module`, `duration_ms` e `outcome`; **nunca** dados pessoais completos ou segredos |
| Níveis | `error` (falha que exige ação), `warn` (degradação/regra violada), `info` (evento de negócio relevante), `debug` (somente em investigação, com amostragem) |
| Traces | OpenTelemetry ponta a ponta: navegador → API → banco → fila → worker |
| Métricas técnicas | Latência, taxa de erro, saturação, tamanho e idade de fila, tempo de job, *pool* de conexões |
| Métricas de negócio | Contratos ativados, faturas emitidas, OS abertas/concluídas, alertas gerados, leituras recebidas, falhas de integração |
| Alertas operacionais | Fila crescendo, job de fechamento falhando, integração fiscal indisponível, taxa de erro por endpoint, RLS negando acesso inesperadamente |
| Retenção | Logs quentes 30 dias, mornos 90 dias, auditoria conforme 7.9 (separada dos logs técnicos) |
| Painel de saúde | Página interna com estado de filas, jobs, integrações e último fechamento por tenant |

## 7.11 Estratégia de manutenção evolutiva

| Prática | Definição |
| --- | --- |
| Versionamento de API | `v1` estável; mudança incompatível só em nova versão, com sobreposição mínima de 6 meses e comunicação de depreciação por *header* e changelog |
| Migrações de banco | Sempre reversíveis e compatíveis para trás; padrão *expand → migrate → contract* em três releases |
| Feature flags | Toda funcionalidade de risco entra desligada, com habilitação por tenant e desligamento imediato |
| Trunk-based + CI/CD | Branch curto, PR obrigatório, testes automatizados, deploy contínuo em *staging* e promoção controlada para produção |
| Qualidade mínima em CI | Lint, tipos, testes unitários, testes de integração com banco real, teste de fronteira de módulo, verificação de migração, análise de dependências |
| Ambientes | `dev` → `staging` (com dados anonimizados) → `produção`; *canary* por tenant em mudanças sensíveis |
| Deploy | Blue-green ou rolling, com *health check* real (banco, fila, storage) e rollback automatizado |
| Dívida técnica | Orçamento fixo de 15–20% da capacidade por ciclo, com registro explícito e priorização junto ao produto |
| Documentação viva | ADRs para decisões estruturais, OpenAPI gerado, dicionário de dados e catálogo de eventos versionados no repositório |
| Compatibilidade de eventos | *Schema registry* com regra de evolução aditiva; consumidores toleram campos desconhecidos |
