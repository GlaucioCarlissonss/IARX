# 13. Recomendações Técnicas

## 13.1 Stack recomendada — decisão consolidada

| Camada | Recomendação | Alternativa aceitável | Critério de escolha |
| --- | --- | --- | --- |
| Backend | Node.js LTS + TypeScript + NestJS | .NET 8 + ASP.NET Core; Java + Spring Boot | Base da equipe existente; a arquitetura é agnóstica |
| Banco de dados | **Supabase** (PostgreSQL 16+ com PostGIS) | Outro Postgres gerenciado | RLS, exclusion constraints, tipos de intervalo, GIS nativo, custo; portabilidade preservada por decisão de projeto (H.9) |
| Acesso a dados | Prisma para CRUD (**sem `migrate`**) + SQL versionado via Supabase CLI como dono do schema | Drizzle; EF Core; JPA | RLS, exclusion constraints, partições e triggers exigem SQL explícito (H.6.1) |
| Cache/fila | Redis + BullMQ | RabbitMQ/SQS quando o volume justificar | Simplicidade operacional no início |
| Storage | **Supabase Storage** com URLs assinadas | S3 / Azure Blob / GCS | Políticas ligadas ao mesmo RLS; antivírus por Edge Function (H.7) |
| Frontend | Next.js + React + TypeScript + TanStack Query + Tailwind | Nuxt/Vue; Angular | Ecossistema, contratação, desempenho |
| Mapas | MapLibre GL + PostGIS + provedor de *tiles* substituível | Leaflet; Google Maps SDK | Evitar dependência de fornecedor único |
| Mobile | PWA (Fase 2) → React Native/Expo (Fase 5) | Flutter | Reuso de código e de tipos |
| Identidade | **Supabase Auth** | Keycloak / Auth0 / Cognito | Não implementar autenticação artesanal; adaptador isolado em `platform-iam` para permitir troca (H.9) |
| Observabilidade | OpenTelemetry + Prometheus + Grafana + Sentry | Datadog / New Relic | Padrão aberto, custo controlado |
| CI/CD | GitHub Actions (ou equivalente) + contêineres | GitLab CI | Integração com o repositório |
| Infraestrutura | Contêineres gerenciados (ECS/Fargate, Cloud Run ou Kubernetes gerenciado) + IaC (Terraform) | — | Reprodutibilidade e autoescala |

**Racional resumido:** uma única linguagem de ponta a ponta com tipos e validadores compartilhados
reduz custo de equipe, elimina divergência de validação entre front e back e acelera a entrega. O
banco é a escolha mais crítica: PostgreSQL entrega, no mesmo produto, transações fortes,
multi-tenancy segura por RLS, restrições de intervalo que impõem `RN-001` no dado e capacidade
geoespacial para o módulo de mapa — evitando três componentes adicionais na Fase 1.

## 13.2 Modelagem de dados — recomendações críticas

| Recomendação | Motivo |
| --- | --- |
| `tenant_id` em toda tabela de negócio, com RLS ativa | Isolamento imposto no dado (`RN-028`) |
| Chaves primárias UUID v7 | Ordenáveis por tempo, geráveis no cliente (essencial para o PWA offline), sem revelar volume |
| Numeração de documentos por sequência dedicada e transacional | Contrato, OS e fatura sem lacunas e sem colisão |
| `EXCLUDE USING gist` para vigência de alocação | Impede dupla alocação no nível do banco (`RN-001`) |
| Tabelas de evento *append-only* para leituras, movimentações e movimentos de estoque | Estado é projeção auditável; saldo reconstituível |
| Saldo de estoque como projeção materializada dos movimentos | Consulta rápida com consistência verificável |
| `timestamptz` sempre, com fuso do tenant na apresentação | Operação multirregional sem ambiguidade |
| Valores monetários em `numeric(15,4)` e arredondamento explícito na apresentação | Elimina erro de ponto flutuante em faturamento |
| *Soft delete* (`deleted_at`, `deleted_by`, `delete_reason`) | `RN-019`, mantendo integridade referencial |
| Particionamento mensal em `leituras`, `movimentacoes`, `audit_log`, `notificacoes` | Crescimento controlado e manutenção viável |
| Índices dirigidos aos filtros reais das telas | Desempenho previsível nas listas operacionais |
| `GiST` em coluna `geography` para consultas espaciais | Mapa performático em escala |

Estrutura completa no [Anexo A](anexos/A-modelo-de-dados.md).

## 13.3 Qualidade e testes

| Nível | Escopo | Meta |
| --- | --- | --- |
| Unidade | Regras de domínio, cálculos de faturamento, transições de estado | Cobertura ≥ 85% no domínio; 100% nas fórmulas de cálculo |
| Integração | Repositórios, RLS, constraints, filas — contra PostgreSQL real (Testcontainers) | Toda invariante de `RN-*` com teste dedicado |
| Contrato | Validação do OpenAPI e dos schemas de evento contra implementação | Nenhuma quebra silenciosa de contrato |
| Autorização | Varredura de todos os endpoints garantindo negação sem permissão | 100% dos endpoints |
| E2E | Jornadas críticas: contratação → entrega → medição → fatura; abertura → conclusão de OS | Executadas a cada release |
| Offline | Sincronização do PWA com conflito simulado | Cenários de conflito cobertos |
| Carga | Listas, mapa e fechamento em volume de referência (11.7) | SLOs de 7.8 atendidos |
| Acessibilidade | Verificação automatizada (axe) + revisão manual por teclado e leitor de tela | WCAG 2.2 AA nas telas críticas |

**Cenários de teste de faturamento obrigatórios** (fonte histórica de erro): entrada no meio do
ciclo, saída no meio do ciclo, substituição de ativo no ciclo, suspensão parcial, franquia com pool
por contrato, excedente por faixa, reajuste na competência de aniversário, mínimo mensal com
consumo abaixo, competência fechada com acerto no ciclo seguinte, mês de 28/29/30/31 dias,
fuso horário na virada do dia.

## 13.4 Desempenho

| Prática | Aplicação |
| --- | --- |
| Paginação por cursor em toda lista | Estabilidade sob inserção concorrente e custo constante |
| Virtualização de tabela no frontend | Milhares de linhas sem degradar o navegador |
| Nenhuma consulta N+1 | Detecção automatizada em CI; carregamento explícito de relações |
| Projeções para dashboards | Views materializadas atualizadas por evento, não agregação ao vivo |
| Agregação espacial no banco | Mapa recebe *clusters*, não todos os pontos |
| Processamento longo sempre em fila | Fechamento, exportação, importação, PDFs, etiquetas |
| Cache com invalidação por evento | Catálogo, parametrizações e projeções — nunca cache de dado financeiro sem invalidação explícita |
| Orçamento de desempenho no CI | Regressão de bundle ou de latência bloqueia o merge |

## 13.5 Organização de equipe e processo

| Item | Recomendação |
| --- | --- |
| Time inicial (Fases 1–2) | 1 tech lead · 2 devs backend · 2 devs frontend · 1 designer de produto · 1 QA · 1 product owner com vivência no setor |
| Time em escala (Fases 3–5) | Dois times de fluxo: **Operações** (CTR/EQP/MNT/EST/MAP) e **Monetização** (FAT/FIN/INT), com plataforma compartilhada |
| Especialista de domínio | Presença obrigatória de alguém da operação real (pátio/manutenção/faturamento) na definição de cada módulo |
| Cadência | Ciclos de 2 semanas, revisão com usuários reais ao fim de cada ciclo |
| Processo | Trunk-based, PR obrigatório, deploy contínuo em staging, promoção controlada |
| Definição de pronto | Código + testes + telemetria + documentação de API + revisão de acessibilidade + validação com persona-alvo |
| Governança de produto | Backlog priorizado por objetivo estratégico (seção 2), não por solicitação isolada |

## 13.6 Estratégia de dados legados e adoção

| Etapa | Ação |
| --- | --- |
| 1. Diagnóstico | Inventariar planilhas e sistemas atuais; identificar fonte da verdade de cada dado |
| 2. Higienização | Deduplicar ativos e clientes; padronizar patrimônio, categorias e modelos antes de importar |
| 3. Carga faseada | Catálogo → ativos → clientes/locais → contratos vigentes → peças/saldos → histórico de OS (opcional) |
| 4. Corte (go-live) | Data de corte definida: histórico anterior fica somente para consulta; nova operação inteiramente na plataforma |
| 5. Operação paralela | No máximo um ciclo de faturamento em paralelo, com conciliação total obrigatória |
| 6. Validação de aceite | Fechamento do primeiro mês pela plataforma deve conciliar com o processo anterior, valor a valor |
| 7. Desativação | Encerramento formal das planilhas; acesso somente leitura ao legado |
| 8. Capacitação | Treinamento por persona (≤ 2 h), material curto em vídeo, ambiente de treino com dados fictícios |
| 9. Suporte reforçado | Presença próxima da operação nas duas primeiras semanas e no primeiro fechamento |

## 13.7 Riscos técnicos e de produto — com mitigação

| Risco | Impacto | Probabilidade | Mitigação |
| --- | --- | --- | --- |
| Cadastro de ativos inconsistente na carga inicial | Alto — compromete todos os indicadores | Alta | Higienização obrigatória antes do go-live; importação com validação linha a linha; auditoria física por amostragem |
| Baixa adesão do técnico em campo | Alto — histórico e custo ficam incompletos | Média | PWA com ≤ 6 toques, offline real, QR Code, envolvimento dos técnicos no desenho |
| Complexidade do motor de faturamento subestimada | Alto — erro de cobrança destrói confiança | Alta | Motor isolado e testado com matriz de cenários (13.3); operação paralela por um ciclo |
| Erosão da modularidade | Médio — dificulta evolução | Média | Lint de importação em CI, testes de fronteira, revisão arquitetural periódica |
| Dependência de fornecedor de mapa/telemetria | Médio | Média | MapLibre + camada de conector; contrato de dados normalizado |
| Custo de infraestrutura crescendo mais que a receita | Médio | Média | Métricas de custo por tenant desde a Fase 1; revisão trimestral |
| Integração fiscal/bancária instável | Médio — atrasa recebimento | Média | Filas com reprocessamento, alertas dedicados, procedimento manual de contingência |
| Escopo inflando antes do MVP validado | Alto — atrasa retorno | Alta | Fases fechadas (seção 14) com critério de saída explícito; feature flags para adiar sem bloquear |
| Vazamento entre tenants | Crítico | Baixa | RLS + filtro no repositório + suíte de teste de isolamento em CI |
| Perda de dado financeiro | Crítico | Baixa | PITR, cópia imutável, teste mensal de restauração |

## 13.8 Estimativa de esforço (referência de planejamento)

Base: equipe de 6–7 pessoas descrita em 13.5. Estimativas em semanas de calendário, sequenciais.

| Fase | Escopo | Duração estimada |
| --- | --- | --- |
| Fase 0 — Fundação | Infra, IaC, CI/CD, IAM, multi-tenancy, auditoria, design system | 4–5 semanas |
| Fase 1 — Núcleo operacional | Contratos, equipamentos, movimentações, medição, faturamento básico | 10–12 semanas |
| Fase 2 — Manutenção, estoque, mapa e PWA | MNT, EST, MAP, PWA de campo, alertas | 10–12 semanas |
| Fase 3 — Financeiro e inteligência | FIN completo, dashboards, rentabilidade, cobrança | 8–10 semanas |
| Fase 4 — Integrações corporativas | ERP, fiscal, assinatura, API pública, telemetria | 8–10 semanas |
| Fase 5 — Escala e diferenciação | BI, app nativo, portal do cliente, automações, IoT avançado | contínuo |

**Primeiro valor em produção:** fim da Fase 1 (aproximadamente 15–17 semanas), já substituindo as
planilhas de contrato, frota e faturamento.

## 13.9 Checklist de prontidão para produção (go-live)

- [ ] RLS validada por suíte automatizada de isolamento entre tenants
- [ ] Todas as invariantes `RN-*` com teste de integração contra banco real
- [ ] Autorização verificada em 100% dos endpoints
- [ ] Backup com restauração testada e tempo real de RTO medido e registrado
- [ ] Observabilidade completa: traces, métricas de negócio, alertas com destinatário definido
- [ ] Runbooks: incidente, fechamento travado, integração indisponível, restauração de tenant
- [ ] Teste de carga nos volumes de referência com SLOs atendidos
- [ ] Acessibilidade AA validada nas telas críticas
- [ ] PWA testado em campo real, offline, com dispositivos e conectividade reais
- [ ] Fechamento de um ciclo conciliado valor a valor com o processo anterior
- [ ] Treinamento por persona concluído e material publicado
- [ ] LGPD: registro de tratamento, política de retenção e fluxo de atendimento a titular
- [ ] Plano de rollback do go-live documentado e aceito pela operação
