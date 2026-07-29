# 14. Sugestão de Roadmap Evolutivo

## 14.1 Estratégia de faseamento

O roadmap é organizado em **ondas fechadas**, cada uma com objetivo de negócio, escopo, critério de
saída verificável e valor entregue. Nenhuma onda inicia antes de a anterior atender seu critério de
saída — a única exceção é a Fase 0, que roda em paralelo ao refinamento da Fase 1.

**Regra de priorização:** entrega-se primeiro o que **substitui planilha e gera receita correta**.
Manutenção e estoque vêm em seguida, porque dependem de uma base de ativos confiável. Inteligência
financeira vem depois, porque só é confiável quando receita e custo já estão sendo capturados
corretamente. Integrações vêm por último dentro do núcleo, porque exigem que o dado interno já
esteja íntegro.

```
Fase 0        Fase 1              Fase 2                Fase 3            Fase 4            Fase 5
Fundação  →   Núcleo         →    Operação de campo →   Inteligência  →   Integração    →   Escala
              operacional         e manutenção          financeira        corporativa       e diferenciação
4-5 sem       10-12 sem           10-12 sem             8-10 sem          8-10 sem          contínuo
              ▲                                         ▲                                   ▲
              └─ 1º go-live                              └─ decisão                          └─ expansão
                 (substitui planilhas)                      gerencial                          comercial
```

---

## 14.2 Fase 0 — Fundação técnica *(4–5 semanas)*

**Objetivo:** construir a base que não pode ser adicionada depois sem retrabalho estrutural.

| Entrega | Detalhe |
| --- | --- |
| Infraestrutura como código | Ambientes dev/staging/produção, contêineres, rede, storage, secrets |
| CI/CD | Pipeline com lint, tipos, testes, migrações, deploy automatizado e rollback |
| Multi-tenancy | `tenant_id` + RLS + contexto de sessão + suíte de teste de isolamento |
| Identidade e acesso | OIDC, MFA, perfis-base, permissões `recurso:ação`, escopos organizacionais |
| Auditoria | `audit_log` append-only, interceptor, hash chain, aba de histórico genérica |
| Observabilidade | Traces, métricas, logs estruturados, painel de saúde |
| Design system | Tokens, componentes-base, tabela, formulário, estados vazio/erro/carregando, modo escuro |
| Estrutura modular | Pacotes por domínio, `contracts/`, lint de fronteira, geração de OpenAPI |

**Critério de saída:** aplicação vazia em produção, com login, tenant isolado, auditoria funcionando
e pipeline verde de ponta a ponta.

**Por que primeiro:** multi-tenancy, auditoria e modelo de permissão são decisões que permeiam todas
as tabelas e endpoints. Adicioná-las na Fase 3 significaria refazer o schema e revisar cada consulta.

---

## 14.3 Fase 1 — Núcleo operacional e faturamento *(10–12 semanas)* — **MVP em produção**

**Objetivo:** substituir integralmente as planilhas de contrato, frota e faturamento.

| Módulo | Escopo da fase |
| --- | --- |
| `EQP` | `F-EQP-01,02,03,07,08,09,10,13,14,16,17,18,20,21` — cadastro, catálogo, importação, estados, disponibilidade em tempo real, movimentações, checklists, QR Code, timeline, medidores e leituras |
| `CTR` | `F-CTR-01,02,03,05,07,08,10,14,16,19,24,25,26,29,33,34,35` — contrato, vigência, estados, renovação, clientes, locais, valores, alocação com bloqueio de conflito, anexos, histórico, alertas |
| `FAT` | `F-FAT-01,02,03,05,06,07,08,09,10,14,17,22` — ciclos, medição, pendências, pré-fatura, modalidades, pro-rata, memória de cálculo, conferência, imutabilidade |
| `SYS` | `F-SYS-01,02,04` — busca global, central de alertas, gestão de usuários e perfis |
| Regras | `RN-001` a `RN-010`, `RN-018` a `RN-021`, `RN-023`, `RN-026`, `RN-028`, `RN-029`, `RN-030` |
| Indicadores | `KPI-01,03,05,06,07,29,36,37` |

**Critério de saída:**
1. Um ciclo completo de faturamento executado na plataforma e conciliado valor a valor com o
   processo anterior.
2. 100% da frota cadastrada, etiquetada com QR Code e com estado conferido fisicamente por amostragem.
3. Nenhuma planilha necessária para faturar.
4. Fechamento executado por uma pessoa em ≤ 1 dia útil.

**Valor entregue:** fim do faturamento manual, fim da dupla alocação, disponibilidade real de frota,
alerta de vencimento contratual.

---

## 14.4 Fase 2 — Operação de campo, manutenção, estoque e mapa *(10–12 semanas)*

**Objetivo:** capturar o custo operacional na origem e levar o sistema ao pátio e ao campo.

| Módulo | Escopo da fase |
| --- | --- |
| `MNT` | `F-MNT-01` a `F-MNT-08`, `11,12,13,14,15,16,18,19,20,21,22` — chamados, OS, triagem, fila por SLA, execução offline, apontamento, peças, planos preventivos, agenda, SLA, downtime, custos |
| `EST` | `F-EST-01` a `F-EST-09`, `13,16` — peças, multidepósito, saldos, movimentações, reservas, mínimo/ponto de pedido, alertas, fornecedores, custo médio, integração com OS |
| `MAP` | `F-MAP-01` a `F-MAP-05`, `07,09,14` — mapa, clusters, camadas, visão por cliente, filtros, criticidade, geocodificação, desempenho |
| `EQP` | `F-EQP-04,05,06,11,19,22,24` — acessórios, dados patrimoniais, documentos com validade, bloqueio, transferência entre filiais, correção de leitura, utilização |
| `CTR` | `F-CTR-04,09,11,12,15,18,20,21,23,27,30,31` — contrato-mãe, suspensão, aditivos, encerramento, visão 360º, acessórios, reajuste, descontos com alçada, pro-rata de escopo, minuta, assinatura |
| PWA | Aplicativo de campo offline para técnico e logística |
| Regras | `RN-011` a `RN-017`, `RN-022`, `RN-024`, `RN-027` |
| Indicadores | `KPI-08,12,17,18,21,23,25,26,33` |

**Critério de saída:**
1. 100% das OS registradas na plataforma, com tempo apontado e peças baixadas (`KPI-39` = 0).
2. Saldo de estoque conferido por inventário com acuracidade ≥ 98% (`KPI-27`).
3. Planos preventivos ativos para todas as categorias principais, com aderência medida (`KPI-21`).
4. Mapa em uso diário pela logística e pelos gestores de filial.

**Valor entregue:** custo real de manutenção por ativo, redução de corretivas, fim da peça trocada
sem baixa, visão geográfica da frota, disciplina de movimentação.

---

## 14.5 Fase 3 — Inteligência financeira e cobrança *(8–10 semanas)*

**Objetivo:** transformar dado operacional em decisão gerencial e acelerar o ciclo de caixa.

| Módulo | Escopo da fase |
| --- | --- |
| `FIN` | `F-FIN-01` a `F-FIN-10`, `12,13,14,15` — recebíveis, pagáveis, conciliação, fluxo de caixa, receitas, custos, centros de custo, alocação por ativo, rentabilidade, painel executivo, MRR, inadimplência, exportações, relatórios |
| `FAT` | `F-FAT-04,11,12,15,16,18,19,20,21,23` — estimativa, emissão em lote, boleto/PIX, agrupamento, motor de regras, reajuste, fechamento formal, simulação, inadimplência, exportação |
| `EQP` | `F-EQP-12,25,27` — ociosidade com custo de oportunidade, depreciação e vida útil, baixa de ativo |
| `MNT` | `F-MNT-09,10,24` — terceiros, diagnóstico estruturado, alçada de custo |
| `EST` | `F-EST-10,11,12` — requisição interna, ordem de compra, inventário |
| `MAP` | `F-MAP-06,08,13` — filtros salvos, indicadores regionais, ação direta |
| Integrações | Gateway financeiro (boleto/PIX + conciliação), WhatsApp para cobrança e agendamento |
| Indicadores | `KPI-02,04,10,11,13,14,15,16,19,22,24,27,28,30,31,32,34,35,38,40` |

**Critério de saída:**
1. Rentabilidade por cliente e por equipamento reconhecida pela diretoria como fonte oficial.
2. Baixa automática de recebimento em funcionamento, com fila de exceções sob controle.
3. Painel executivo em uso na reunião mensal de resultado.
4. Redução mensurável da inadimplência versus a linha de base pré-plataforma.

**Valor entregue:** decisão de compra/venda de ativo por ROI, renegociação com base em margem real,
cobrança automatizada, previsibilidade de caixa.

---

## 14.6 Fase 4 — Integração corporativa e abertura *(8–10 semanas)*

**Objetivo:** eliminar redigitação entre sistemas e habilitar clientes de grande porte.

| Frente | Escopo |
| --- | --- |
| ERP | Integração bidirecional de faturas, recebíveis, pagáveis, custos e depreciação |
| Fiscal | Emissão de NF-e/NFS-e via provedor homologado, com tratamento de rejeição |
| Assinatura digital | `F-CTR-32` — envio, múltiplos signatários, retorno por webhook, evidências |
| API pública | `F-SYS-09` — API versionada, chaves por tenant, escopos, sandbox, webhooks assinados |
| Telemetria/IoT | Leitura automática de medidor, posição rastreada, divergência declarada vs. rastreada (`F-MAP-10,11`) |
| SSO corporativo | OIDC/SAML por tenant |
| Manutenção avançada | `F-MNT-17,23` — roteirização, análise de recorrência e MTBF (`KPI-20`) |
| Estoque avançado | `F-EST-14,15` — curva ABC, giro, rastreabilidade por lote/série |
| Financeiro | `F-FIN-11` — DRE gerencial, orçado vs. realizado |
| Plataforma | `F-SYS-10` — modo somente leitura de contingência; relatórios configuráveis |

**Critério de saída:**
1. Nenhuma redigitação manual entre a plataforma e o ERP/sistema fiscal.
2. Telemetria eliminando pendências de medição nos ativos equipados (`KPI-36` → 0 nesse subconjunto).
3. API pública documentada, com pelo menos uma integração externa real em produção.

---

## 14.7 Fase 5 — Escala, diferenciação e produto de mercado *(contínuo)*

| Frente | Escopo | Valor |
| --- | --- | --- |
| Portal do cliente | `F-SYS-08` — ativos em posse, faturas, chamados, envio de leitura | Reduz atendimento e melhora retenção |
| App mobile nativo | Técnico (NFC/RFID, background) e cliente | Operação de campo mais rica |
| BI / *data warehouse* | Modelo dimensional, conectores, endpoint analítico | Análise livre sem impactar o transacional |
| Automações condicionais | "Quando X, faça Y" sobre eventos de domínio | Personalização sem código |
| Geofence e telemetria avançada | `F-MAP-12` — perímetro, alerta de saída, códigos de falha | Prevenção de perda e manutenção preditiva |
| Manutenção preditiva | Modelos sobre histórico de falhas, uso e telemetria | Reduz corretiva e downtime |
| Precificação assistida | Sugestão de preço por ocupação, margem histórica e demanda regional | Elevação de margem |
| Recomendação de frota | Sugestão de compra/desmobilização por ROI, ocupação e demanda | Decisão de capital orientada por dado |
| Orçamento operacional | `F-FIN-16` — meta por filial/categoria | Gestão por meta |
| Marketplace de conectores | Conectores instaláveis por tenant | Extensibilidade comercial |
| Internacionalização | Multimoeda, multi-idioma, regras fiscais por país | Expansão geográfica |

---

## 14.8 Mapa consolidado de entregas por fase

| Módulo | Fase 0 | Fase 1 | Fase 2 | Fase 3 | Fase 4 | Fase 5 |
| --- | :--: | :--: | :--: | :--: | :--: | :--: |
| Fundação / IAM / Auditoria | ●●● | ○ | ○ | ○ | ◐ | ○ |
| Contratos (`CTR`) | — | ●●● | ●● | ◐ | ○ | ○ |
| Equipamentos (`EQP`) | — | ●●● | ●● | ◐ | ○ | ◐ |
| Mapa (`MAP`) | — | — | ●●● | ◐ | ◐ | ◐ |
| Faturamento (`FAT`) | — | ●●● | ◐ | ●● | ◐ | ○ |
| Manutenção (`MNT`) | — | — | ●●● | ◐ | ◐ | ◐ |
| Estoque (`EST`) | — | — | ●●● | ◐ | ◐ | ○ |
| Financeiro (`FIN`) | — | — | — | ●●● | ◐ | ◐ |
| PWA / Mobile | — | ○ | ●●● | ○ | ○ | ●● |
| Integrações (`INT`) | — | — | ○ | ●● | ●●● | ●● |
| BI / Analítico | — | ○ | ○ | ●● | ◐ | ●●● |

Legenda: ●●● entrega principal · ●● entrega significativa · ◐ incremento · ○ base/preparação · — não iniciado

---

## 14.9 Marcos de negócio e critérios de decisão

| Marco | Quando | Decisão associada |
| --- | --- | --- |
| **M1 — Plataforma operante** | Fim da Fase 1 | Aprovar continuidade do investimento com base no primeiro fechamento conciliado |
| **M2 — Custo operacional visível** | Fim da Fase 2 | Definir metas de MTTR, aderência preventiva e acuracidade de estoque |
| **M3 — Resultado por ativo** | Fim da Fase 3 | Revisar tabela de preços, carteira de clientes e plano de investimento em frota |
| **M4 — Empresa integrada** | Fim da Fase 4 | Avaliar a plataforma como produto comercializável a terceiros |
| **M5 — Produto de mercado** | Fase 5 | Decidir modelo de precificação SaaS e estratégia de expansão |

## 14.10 Princípios de evolução após o go-live

1. **Cada onda entrega valor isolado.** Nenhuma fase depende da seguinte para ser útil em produção.
2. **Nada entra sem indicador.** Funcionalidade nova declara qual KPI pretende mover; se não move
   nenhum, é candidata a corte.
3. **Automatizar somente o que já é estável manualmente.** Automatizar processo caótico apenas
   acelera o erro.
4. **Feature flag por padrão.** Toda funcionalidade de risco entra desligada e é habilitada por
   tenant.
5. **Escutar o campo antes do escritório.** Ajustes propostos pelo técnico e pelo operador de pátio
   têm prioridade sobre pedidos de relatório.
6. **Dívida técnica com orçamento fixo.** 15–20% da capacidade por ciclo, sem negociação por
   urgência recorrente.
7. **Extrair serviço só sob evidência.** Módulo se torna serviço próprio quando a carga o exigir de
   forma sustentada — nunca por preferência arquitetural.
