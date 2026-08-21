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
| [I — Refatoração do Front-End](docs/anexos/I-refatoracao-frontend.md) | Diagnóstico, arquitetura React, componentes, dashboards, navegação e base de teste do domínio |
| [J — Implementação da API](docs/anexos/J-api-implementacao.md) | Contexto de tenant por transação, autorização negada por padrão, tradução de SQLSTATE, idempotência e o que os testes provam |
| [K — Formulários](docs/anexos/K-formularios.md) | Os onze formulários de escrita, camada de comandos, diálogo acessível, combobox e os defeitos que os testes encontraram |
| [L — Lacunas funcionais](docs/anexos/L-lacunas-funcionais.md) | Especificação de quatorze módulos: os sete originais (NF de compra, franquia, preço, usuários, portal do cliente, consumo, mapa — cinco já implementados) e o bloco financeiro acrescentado depois (centro de custo, conta bancária, contas a pagar com aprovação por alçada, contas a receber unificando a fatura ainda não persistida, lançamentos futuros, fluxo de caixa, controle de despesas), com matriz de permissões, checklist de revisão de código e decisões pendentes |
| [M — Decisões de mercado](docs/anexos/M-decisoes-mercado-brasileiro.md) | ADR das treze decisões pendentes do Anexo L, resolvidas pela regra brasileira: CNPJ e grupo econômico, tributos na aquisição, retenção fiscal, contagem A3/duplex, reajuste, autenticação e mapa — com o custo de reverter cada uma |
| [N — Nota fiscal de compra](docs/anexos/N-nota-fiscal-de-compra.md) | Módulo 1 implementado: composição do custo do imobilizado, rateio que fecha ao centavo, chave de acesso, XML como fonte, segregação de funções e o defeito de acessibilidade que os testes acharam |
| [O — Mapa geográfico](docs/anexos/O-mapa-geografico.md) | Módulo 7 implementado: mapa vetorial interativo dentro da aplicação, por que a decisão D-12 mudou, coordenadas reais no lugar de pixels, e os três defeitos que os testes acharam |
| [P — Núcleo comercial e consumo](docs/anexos/P-nucleo-comercial-e-consumo.md) | Itens 0, 2, 3 e 6 do cronograma: eixo de cliente com RLS restritiva, tabelas de franquia e preço versionadas, simulador que usa a mesma resolução da fatura, e consumo derivado de leitura |
| [Q — Usuários e permissões](docs/anexos/Q-usuarios-e-permissoes.md) | Módulo 4 implementado: Argon2id próprio no lugar do Supabase Auth e por quê, a superfície fechada que resolve o login sob RLS, a árvore módulo → tela → ação, o verificador de CI que reprova rota sem permissão, e os cinco defeitos que os testes acharam — inclusive o perfil que salvava sem mudar nada na tela |

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
| `apps/web` | Aplicação React + TypeScript: 14 telas, 14 formulários de escrita, simulador comercial, mapa geográfico com camada raster e busca de endereço, leitor de XML da NF-e, árvore de permissões módulo → tela → ação, tela de entrada com recusa uniforme, diálogo acessível, combobox, RBAC e base de teste do domínio de locação de TI | `npm run a11y:dom` — 134 testes de axe, teclado, formulários, permissões, entrada fiscal, mapa, política comercial, autenticação e domínio · `npm run web:test` — 74 unitários da árvore de permissões, dos comandos de usuário e autenticação, da aritmética de tiles, do parser de geocodificação e da entrega de arquivos |
| `apps/api` | API NestJS sobre PostgreSQL com RLS: contexto de tenant por transação, autorização negada por padrão, `problem+json`, idempotência, concorrência otimista, a entrada fiscal de compra, os locais de operação e a autenticação com Argon2id | `npm run api:test` — 84 assertivas contra PostgreSQL real · `verificar-rotas.mjs` — 25/25 rotas declaram autorização explícita, e o build reprova quem esquecer |
| `packages/contracts` | Esquemas Zod compartilhados entre API e clientes: primitivos, catálogo de erros, catálogo das 116 permissões, a árvore módulo → tela → ação derivada dele, entidades e a chave de acesso da NF-e com dígito verificador | Compilado no CI; consumido pelos dois lados — o front deixou de ter vocabulário próprio |
| `packages/db` | 16 migrações SQL: fundação, identidade, auditoria, equipamentos, contratos, RLS, outbox, geoespacial, idempotência, nota fiscal de compra, eixo de cliente, franquia e preço, consumo, proveniência da coordenada, autenticação e superfície fechada de autenticação | `npm run db:test` — 86 assertivas de invariante contra PostgreSQL real, com e sem PostGIS |
| `packages/tokens` | Tokens de cor, validador de contraste e de daltonismo, gerador de CSS | `npm run a11y:tokens` — 202/202 verificações, inclusive o marcador sobre imagem de satélite |
| `.github/workflows/ci.yml` | Cinco jobs: tokens, DOM renderizado, invariantes de banco, integração da API, guardas de segurança — inclusive a que reprova política de locatário permissiva | Bloqueiam merge |

```bash
npm run dev           # servidor de desenvolvimento da aplicação
npm run build         # bundle de arquivo único em apps/web/dist/index.html
npm run tipos         # TypeScript estrito nos três pacotes
npm run a11y:tokens   # contraste WCAG 2.2 AA + ΔE sob 3 tipos de daltonismo
npm run web:test      # unitários puros da aplicação, sem navegador e sem rede
npm run a11y:dom      # axe, teclado, reflow, permissões e domínio, em Chromium real
npm run db:test       # recria o banco, aplica migrações e roda a suíte de invariantes
npm run api:test      # sobe o banco, semeia massa e roda a integração da API
npm run verificar     # tudo acima
```

A API roda como o papel `iarx_app`, **sujeito a RLS** — inclusive nos testes. Conectar como
superusuário faria as políticas serem ignoradas e o teste de isolamento passaria sem provar nada.
Ver [Anexo J](docs/anexos/J-api-implementacao.md).

**Domínio da base de demonstração:** locação de impressoras e computadores corporativos —
multifuncionais, laser, térmicas, desktops, notebooks, thin clients e nobreaks, com cobrança por
franquia de páginas e excedente. Ver [Anexo I](docs/anexos/I-refatoracao-frontend.md).

**O mapa é um mapa.** A distribuição geográfica é interativa dentro da aplicação — imagem de
satélite ou de ruas, projeção Web Mercator, coordenadas reais, agrupamento, zoom e arrasto — e não
um botão que abre o Google Maps noutra aba. A aba que abre não conhece os filtros, não sabe quem
está com crédito bloqueado e não volta. Sem acesso ao servidor de imagens, o mapa cai para as
fronteiras vetoriais embutidas e **diz que caiu**, em vez de exibir um retângulo cinza. A busca de
endereço é adição à busca local, nunca substituição: o filtro por cliente, cidade e UF continua
funcionando sem rede. Ver [Anexo O](docs/anexos/O-mapa-geografico.md).

**A proposta e a fatura contam a mesma história.** O simulador comercial usa a mesma resolução que
o faturamento — precedência de tabela, franquia por especificidade, desconto sem acúmulo. Cotar por
uma regra e faturar por outra faria a divergência aparecer só no primeiro fechamento, na frente do
cliente e sobre um valor já assinado. E trocar a tabela **não** reprecifica contrato vigente: a
tabela é a fonte, o item do contrato é a fotografia.

**O ativo nasce da nota.** Valor de aquisição, início da depreciação e prazo de garantia vêm da
nota fiscal de compra — não são digitados no cadastro do equipamento. O custo do imobilizado é o
total da nota menos os tributos recuperáveis (CPC 27 item 16), com padrão de locadora pura porque
locação de bem móvel não é fato gerador de ICMS (Súmula 573 do STF). Ver
[Anexo N](docs/anexos/N-nota-fiscal-de-compra.md).

**Invariantes já impostas pelo banco, não por código de aplicação:**

| Regra | Mecanismo | Teste |
| --- | --- | --- |
| `RN-001` dupla alocação | `EXCLUDE USING gist` sobre `tstzrange` | `tests/01` — 7 casos |
| `RN-028` isolamento entre tenants | RLS + `FORCE ROW LEVEL SECURITY` | `tests/02` — 5 casos, incluindo vazamento em conexão compartilhada |
| `RN-018` auditoria imutável | Gatilho genérico + ausência de `UPDATE`/`DELETE` + cadeia de hash | `tests/02` e `tests/03` |
| `RN-020` leitura monotônica | Gatilho com consulta ao histórico | `tests/03` — 2 casos |
| `RN-029` idempotência | Índice único `(tenant_id, chave)` serializando reenvios | `apps/api/test` — 5 casos, incluindo replay e chave divergente |
| `RN-L01` nota integrada imutável | Gatilhos no cabeçalho, nos itens e nas séries | `tests/04` — 4 tentativas de alteração, todas recusadas |
| `RN-L05` rateio fecha com a nota | `app.ratear_custo_nota` com resíduo concentrado | `tests/04` — 2 casos, incluindo acessório negativo |
| `RN-L12` isolamento do locatário | Política **restritiva** sobre a de tenant, com predicado único | `tests/05` — 10 casos, incluindo o concorrente do mesmo fornecedor |
| `RN-L16` uma política por alvo e período | `EXCLUDE USING gist` sobre `daterange` | `tests/06` — 2 casos, incluindo a sucessão adjacente |
| `RN-L28` consumo é derivado | Colunas geradas: não há caminho para digitá-lo | `tests/07` — 2 casos |
| `RN-L29` a série de consumo fecha | Gatilho comparando com a competência anterior | `tests/07` — 1 caso, citando a leitura que não fecha |

**E o que a API acrescenta sobre isso:** traduz a recusa do banco em `problem+json` com o contrato
conflitante, a data de liberação e os ativos equivalentes livres — de modo que a mensagem de erro
resolva o problema em vez de apenas relatá-lo. Duas requisições concorrentes pelo mesmo ativo
produzem exatamente um `201` e um `409`, provado por teste.

## Convenções

- Regras de negócio são identificadas como `RN-xxx` e referenciadas pelos demais documentos.
- Indicadores são identificados como `KPI-xx` e trazem fórmula, granularidade e fonte de dados.
- Requisitos de módulo são identificados como `F-<MÓDULO>-xx`.
- Marcações `[Fase N]` indicam a onda de entrega prevista no roadmap (seção 14).
