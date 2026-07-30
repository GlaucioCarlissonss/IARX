# IARX — Plataforma de Gestão de Locação de Equipamentos

> Proposta técnica, funcional e organizacional para uma plataforma SaaS corporativa de
> controle integrado da operação de locação de equipamentos.

**Status do documento:** Proposta de arquitetura e produto — versão 1.0
**Natureza:** Base de desenvolvimento (product blueprint + architecture blueprint)
**Escopo:** Contratos, Equipamentos, Localização, Faturamento & Consumo, Manutenção,
Peças & Estoque e Financeiro — em um único núcleo transacional auditável.

---

## Resumo executivo

Empresas de locação de equipamentos operam, na prática, quatro negócios simultâneos:
um **negócio de ativos** (comprar, manter e depreciar máquinas), um **negócio de contratos**
(vender disponibilidade recorrente), um **negócio de serviços** (atender chamados dentro de SLA)
e um **negócio financeiro** (faturar consumo, cobrar, controlar margem). Quando esses quatro
domínios vivem em planilhas separadas, o prejuízo não aparece como erro de sistema — aparece
como equipamento parado sem faturar, contrato vencido ainda em campo, medição perdida no
fechamento e margem negativa descoberta meses depois.

A IARX resolve isso com um princípio central: **o equipamento é a entidade soberana da
plataforma**. Contrato, medição, ordem de serviço, peça consumida, receita e custo são
sempre lançados *contra um ativo identificado*, produzindo uma linha de tempo única e
auditável por equipamento. Disso decorre, sem esforço adicional de operação, a rentabilidade
por ativo, a taxa de ocupação real e o custo de manutenção por hora locada.

**Três decisões de produto sustentam a proposta:**

| Decisão | Consequência prática |
| --- | --- |
| Ciclo de vida do equipamento como máquina de estados única | Elimina divergência entre "disponível no sistema" e "disponível no pátio" |
| Faturamento derivado do contrato + medição (nunca digitado) | Fechamento mensal deixa de ser trabalho manual e passa a ser conferência por exceção |
| Tudo é evento imutável (movimentação, leitura, apontamento) | Auditoria, rastreabilidade e indicadores saem do mesmo log, sem ETL paralelo |

---

## Índice da proposta

| # | Seção | Documento |
| --- | --- | --- |
| 1 | Visão Geral da Plataforma | [docs/01-visao-geral.md](docs/01-visao-geral.md) |
| 2 | Objetivos Estratégicos | [docs/02-objetivos-estrategicos.md](docs/02-objetivos-estrategicos.md) |
| 3 | Público-Alvo | [docs/03-publico-alvo.md](docs/03-publico-alvo.md) |
| 4 | Estrutura dos Módulos | [docs/04-estrutura-dos-modulos.md](docs/04-estrutura-dos-modulos.md) |
| 5 | Funcionalidades Essenciais | [docs/05-funcionalidades-essenciais.md](docs/05-funcionalidades-essenciais.md) |
| 6 | Regras de Negócio | [docs/06-regras-de-negocio.md](docs/06-regras-de-negocio.md) |
| 7 | Arquitetura Funcional | [docs/07-arquitetura-funcional.md](docs/07-arquitetura-funcional.md) |
| 8 | Fluxos Operacionais | [docs/08-fluxos-operacionais.md](docs/08-fluxos-operacionais.md) |
| 9 | Estrutura de UX/UI | [docs/09-ux-ui.md](docs/09-ux-ui.md) |
| 10 | Indicadores e Métricas | [docs/10-indicadores-e-metricas.md](docs/10-indicadores-e-metricas.md) |
| 11 | Segurança e Escalabilidade | [docs/11-seguranca-e-escalabilidade.md](docs/11-seguranca-e-escalabilidade.md) |
| 12 | Integrações Futuras | [docs/12-integracoes-futuras.md](docs/12-integracoes-futuras.md) |
| 13 | Recomendações Técnicas | [docs/13-recomendacoes-tecnicas.md](docs/13-recomendacoes-tecnicas.md) |
| 14 | Roadmap Evolutivo | [docs/14-roadmap-evolutivo.md](docs/14-roadmap-evolutivo.md) |

### Anexos técnicos

| Anexo | Conteúdo |
| --- | --- |
| [A — Modelo de Dados](docs/anexos/A-modelo-de-dados.md) | Entidades, relacionamentos, chaves, índices e invariantes |
| [B — Máquinas de Estado](docs/anexos/B-maquinas-de-estado.md) | Transições válidas de Contrato, Equipamento, OS, Fatura e Estoque |
| [C — Matriz de Permissões](docs/anexos/C-matriz-de-permissoes.md) | Perfis × recursos × ações, escopos e segregação de funções |
| [D — Catálogo de APIs](docs/anexos/D-catalogo-de-apis.md) | Convenções REST, endpoints por domínio, webhooks e erros |
| [E — Motor de Faturamento](docs/anexos/E-motor-de-faturamento.md) | Modalidades de cobrança, pro-rata, franquia/excedente e reajuste |
| [F — Glossário](docs/anexos/F-glossario.md) | Vocabulário único de domínio (ubiquitous language) |
| [G — Acessibilidade](docs/anexos/G-acessibilidade.md) | Critérios por componente, paleta com contraste medido, gate de CI, plano de teste assistivo |
| [H — Supabase](docs/anexos/H-supabase.md) | ADR da plataforma de dados: RLS, claims, pooling, propriedade do schema, riscos e portabilidade |

---

## Como ler esta proposta

- **Diretoria / Produto:** seções 1, 2, 10 e 14.
- **Arquitetura / Engenharia:** seções 7, 11, 13 e anexos A, B, D.
- **Operação / Negócio:** seções 4, 5, 6, 8 e anexos B, E.
- **Design:** seções 3, 8, 9.

## Código — fundação da Fase 0

O repositório deixou de ser apenas documental. O que já existe e está verificado:

| Pacote | Conteúdo | Verificação |
| --- | --- | --- |
| `packages/db` | 8 migrações SQL: fundação, identidade, auditoria, equipamentos, contratos, RLS, outbox, geoespacial | `pnpm db:test` — 20 assertivas de invariante contra PostgreSQL real |
| `packages/tokens` | Tokens de cor, validador de contraste e de daltonismo, gerador de CSS | `pnpm a11y:tokens` — 188/188 verificações |
| `apps/prototipo` | Protótipo navegável de 5 telas, gerado a partir dos tokens verificados | `npx playwright test` — 20 testes de axe, teclado, reflow e regras de negócio |
| `.github/workflows/ci.yml` | Quatro jobs: tokens, DOM renderizado, invariantes de banco, guardas do Supabase | Bloqueiam merge |

```bash
pnpm a11y:tokens      # contraste WCAG 2.2 AA + ΔE sob 3 tipos de daltonismo
pnpm tokens:build     # gera packages/tokens/dist/tokens.css
pnpm db:test          # recria o banco, aplica migrações e roda a suíte de invariantes
npx playwright test   # axe + teclado + reflow 320px, em navegador real
pnpm verificar        # tudo acima
```

**Invariantes já impostas pelo banco, não por código de aplicação:**

| Regra | Mecanismo | Teste |
| --- | --- | --- |
| `RN-001` dupla alocação | `EXCLUDE USING gist` sobre `tstzrange` | `tests/01` — 7 casos |
| `RN-028` isolamento entre tenants | RLS + `FORCE ROW LEVEL SECURITY` | `tests/02` — 5 casos, incluindo vazamento em conexão compartilhada |
| `RN-018` auditoria imutável | Gatilho genérico + ausência de `UPDATE`/`DELETE` + cadeia de hash | `tests/02` e `tests/03` |
| `RN-020` leitura monotônica | Gatilho com consulta ao histórico | `tests/03` — 2 casos |

## Convenções

- Regras de negócio são identificadas como `RN-xxx` e referenciadas pelos demais documentos.
- Indicadores são identificados como `KPI-xx` e trazem fórmula, granularidade e fonte de dados.
- Requisitos de módulo são identificados como `F-<MÓDULO>-xx`.
- Marcações `[Fase N]` indicam a onda de entrega prevista no roadmap (seção 14).
