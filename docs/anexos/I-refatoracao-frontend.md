# Anexo I — Refatoração do Front-End e da Base de Teste

> **Escopo:** substituição do protótipo por aplicação React estruturada, e reconstrução completa da
> base de dados de teste para a operação real de **locação de impressoras e computadores corporativos**.
> **Entregável executável:** `apps/web` · **Verificação:** `pnpm verificar`

---

## 1. Diagnóstico do front-end anterior

O que existia era `apps/prototipo`: um único arquivo HTML de 55 KB. Cumpriu seu papel — provar
conceito e validar o design system — mas não servia como base de crescimento. Os problemas, em ordem
de gravidade:

| # | Problema | Consequência concreta |
| --- | --- | --- |
| 1 | **Renderização por concatenação de string** (`innerHTML +=`) | Nenhuma garantia de escape em dado de usuário; XSS a um passo de distância. Reconciliação manual do DOM a cada filtro |
| 2 | **Dados embutidos no script da tela** | Impossível trocar por API sem reescrever a tela; nenhuma tipagem; 9 equipamentos fictícios não exercitavam paginação nem virtualização |
| 3 | **Zero tipagem** | Renomear um campo quebrava silenciosamente; nenhum apoio do editor |
| 4 | **Navegação por `hidden` em seções** | Sem URL por tela: impossível compartilhar link, favoritar ou usar voltar do navegador |
| 5 | **Estado espalhado em variáveis de módulo** | Filtro, seleção e tema em escopos distintos, sem fonte única |
| 6 | **CSS num único bloco sem camadas** | Colisão de cascata real: componentes com `all: unset` apagaram o indicador de foco de 8 controles |
| 7 | **Componentes duplicados por copiar-colar** | Cinco tabelas com cinco implementações diferentes de cabeçalho — quatro erravam `scope` ou `aria-sort` |
| 8 | **Nenhum estado de carregamento ou erro** | Dado aparecia instantaneamente; a interface não tinha vocabulário para latência ou falha |
| 9 | **Sem permissões** | Toda ação visível para todos; nenhuma estrutura para autenticação futura |
| 10 | **Domínio errado** | Escavadeiras, geradores e horímetro — não impressoras, computadores e contador de páginas |

**O que valia preservar, e foi preservado:** os tokens de cor verificados (188/188), o dicionário de
estados, a regra de exceção-antes-de-volume nos painéis, a técnica de anel duplo de foco e a
disciplina de acessibilidade do Anexo G. A refatoração é de estrutura, não de princípios.

---

## 2. Melhorias propostas e executadas

| Frente | Antes | Depois |
| --- | --- | --- |
| Renderização | String concatenada | React 18 com escape por padrão |
| Tipagem | Nenhuma | TypeScript estrito, `noUnusedLocals`, zero `any` |
| Dados | 9 registros inline | 420 equipamentos, 34 clientes, 62 contratos, 219 chamados, 24 peças, ~380 faturas — gerados de forma determinística |
| Domínio | Equipamento pesado | Impressão e computação corporativa, com medição por página |
| Navegação | Seções escondidas | 8 rotas com URL, filtro na query string, rota protegida por permissão |
| Estado | Variáveis de módulo | Contexto mínimo para sessão e avisos; dado de tela via hook de consulta |
| Componentes | Duplicados | 12 primitivos + tabela genérica reutilizada em 6 telas |
| Carregamento | Inexistente | Skeleton com `aria-busy` e anúncio em região viva |
| Erro | Inexistente | Tratamento com mensagem e caminho de saída |
| Permissões | Inexistentes | RBAC com 25 permissões, 5 perfis, menu e ações condicionados |
| Build | Arquivo escrito à mão | Vite, tipos verificados, saída em arquivo único |

---

## 3. Refatoração estrutural

```
apps/web/
├── index.html                    envelope mínimo, com <noscript> útil
├── vite.config.ts                build em arquivo único (removível quando houver hospedagem)
├── tsconfig.json                 strict + noUnusedLocals/Parameters
├── a11y.spec.mjs                 27 testes: axe, teclado, permissões, domínio
└── src/
    ├── main.tsx                  ponto de entrada; declara lang=pt-BR
    ├── App.tsx                   provedores + roteador
    ├── rotas.tsx                 rotas e componente de proteção
    ├── estilos/
    │   └── global.css            4 camadas explícitas, tokens importados
    ├── lib/                      infraestrutura, sem regra de negócio
    │   ├── formato.ts            moeda, data, percentual, p.p., duração, prazo
    │   ├── permissoes.ts         catálogo de permissões e perfis
    │   ├── contexto.tsx          sessão e avisos
    │   └── useConsulta.ts        carregamento, erro, cancelamento, nova tentativa
    ├── dados/                    a base de teste, isolada da interface
    │   ├── tipos.ts              contratos de dado do domínio
    │   ├── catalogo.ts           fabricantes, modelos, categorias, regiões, filiais
    │   ├── gerar.ts              gerador determinístico + casos plantados
    │   ├── consultas.ts          seletores derivados (regra de negócio de leitura)
    │   └── api.ts                fachada assíncrona com latência e erro
    ├── componentes/
    │   ├── layout/
    │   │   ├── AppShell.tsx      rail, barra, migalhas, escopo, tema
    │   │   └── PaletaComandos.tsx busca global com padrão combobox
    │   └── ui/
    │       ├── primitivos.tsx    Botao, Campo, Entrada, Selecao, Chip, Cartao,
    │       │                     Metrica, Skeleton, Carregando, EstadoVazio,
    │       │                     Aviso, BarraMedida
    │       ├── Tabela.tsx        tabela genérica em T
    │       └── graficos.tsx      Sparkline, BarrasMensais, BarrasHorizontais
    └── telas/                    uma pasta por tela, sem lógica de dado
        ├── Inicio.tsx            painel do dia (exceções)
        ├── Parque.tsx            parque instalado
        ├── Contratos.tsx         vigência e renovação
        ├── Clientes.tsx          carteira e rentabilidade
        ├── Chamados.tsx          fila por risco de prazo
        ├── Estoque.tsx           suprimentos e reposição
        ├── Faturamento.tsx       fechamento e memória de cálculo
        └── Resultado.tsx         painel executivo
```

**Regra de dependência, verificável por leitura:** `telas` → `componentes` → `lib`; `telas` →
`dados`. Nunca o contrário. Nenhum componente de UI importa `dados`; nenhum arquivo de `dados`
importa React. É isso que permite trocar a fonte de dados sem tocar em interface, e trocar a
interface sem tocar em dados.

### Acoplamento reduzido de forma concreta

| Decisão | Efeito |
| --- | --- |
| `api.ts` como fachada assíncrona | A troca de mock por `fetch` altera um arquivo |
| `useConsulta` com a mesma superfície do TanStack Query | Adotar a biblioteca depois não muda nenhuma tela |
| Regra de leitura em `consultas.ts` | "Cobertura de estoque" e "margem por ativo" existem em um lugar só |
| `Tabela<T>` genérica | Ordenação, paginação, `aria-sort` e rolagem acessível implementados uma vez |
| Tokens em `@iarx/tokens` | Nenhuma cor literal em componente; o CI reprova quem inventar cor |

---

## 4. Refatoração visual — a identidade

Não copiamos referência. As decisões saem do próprio domínio: um operador que passa oito horas em
tabela densa, e um gestor que abre a tela por 40 segundos entre reuniões.

| Elemento | Decisão | Por quê |
| --- | --- | --- |
| **Cor** | Tokens verificados: fundo `#ffffff`/`#f4f6f9`, acento `#0b4fa8`, semânticas verde/âmbar/vermelho | Neutros com viés azul — escolhidos, não herdados de um cinza puro |
| **Tipografia** | Dois papéis: stack de interface para texto; **monoespaçada para identificadores** (patrimônio, série, contrato, valores) | É como se lê etiqueta de ativo e coluna de fatura. Números tabulares alinham na vertical em todas as tabelas |
| **Superfície** | Bordas de fio, raio 10 px, **zero sombra** exceto em elemento flutuante | Sombra em cartão de dado é ruído; hierarquia por espaço e contraste |
| **Densidade** | Linha de 36 px, escala de espaço 4→48 | Cabe mais informação sem apertar; o operador vê 25 linhas sem rolar |
| **Ênfase** | Um único botão primário por tela | Se tudo é primário, nada é |
| **Estado** | Sempre glifo + rótulo + cor | Cor nunca é o único canal (WCAG 1.4.1) |
| **Severidade** | Faixa lateral de 3 px no cartão de exceção | A gravidade se lê pela forma, não só pela cor |

**Tema escuro não é "preparado para o futuro": está pronto e testado.** Os 8 pares de tela rodam
axe nos dois temas, e há seletor explícito na barra além do respeito a `prefers-color-scheme`.

---

## 5. Melhorias de UX/UI

### Redução de cliques — medida, não afirmada

| Tarefa | Antes | Agora |
| --- | --- | --- |
| Ver equipamentos bloqueados | abrir Frota → escolher filtro de estado → aplicar (3 passos) | clicar no cartão de exceção (1) |
| Achar ativo por patrimônio | abrir Frota → digitar na busca da tela (2 + digitação) | `⌘K` → digitar → Enter (1 atalho) |
| Ver por que uma fatura deu aquele valor | não existia | botão "Ver cálculo" na linha (1) |
| Voltar ao recorte de ontem | não existia | o filtro está na URL — favoritar ou compartilhar |
| Saber o que trava um chamado | cruzar Chamados com Estoque manualmente | a linha de estoque já diz "N chamados parados" |

### Vocabulário completo de estados de interface

O protótipo tinha um único estado: dado presente. Agora existem cinco, e todos foram implementados
antes das telas, para não ficarem de fora por pressa:

1. **Carregando** — skeleton visual + `aria-busy` + anúncio em região viva.
2. **Pronto** — o dado.
3. **Vazio** — explica o motivo e oferece saída ("Limpar filtros"), nunca beco sem saída.
4. **Erro** — o que falhou e o que fazer, com botão de nova tentativa.
5. **Bloqueado por permissão** — diz qual permissão falta e a quem pedir.

### Feedback de ação

Toda escrita produz aviso em `role="region" aria-live="polite"`. Aviso de erro **não desaparece
sozinho** — sumir esconde problema; os demais expiram em 5 s. O texto diz o resultado e o próximo
passo, não "operação realizada com sucesso".

---

## 6. Performance

| Medida | Implementação |
| --- | --- |
| Paginação de 25 linhas | Nenhuma tela renderiza 420 linhas de uma vez |
| `useMemo` nos derivados | Filtro e ordenação não recalculam a cada tecla |
| Ordenação sobre cópia | Sem mutação do array de origem, sem re-render em cascata |
| Zero biblioteca de gráfico | SVG próprio; a alternativa mais leve pesaria ~50 KB gzip |
| Zero biblioteca de ícone | Glifos tipográficos; nenhuma fonte de ícone baixada |
| CSS único, sem runtime | Nenhum custo de CSS-in-JS na renderização |
| `ResizeObserver` em vez de `resize` global | Recalcula rolagem só do que mudou |
| Bundle | **305 KB · 92 KB gzip**, incluindo React, roteador, toda a base de dados e os gráficos |

Um cuidado deliberado: a latência artificial de 120–340 ms na fachada de dados existe para que os
estados de carregamento sejam **reais** e testáveis. Desligá-la é uma linha em `api.ts`.

---

## 7. Organização de código

| Prática | Aplicação |
| --- | --- |
| Nome no idioma do domínio | `contrato`, `patrimonio`, `franquia`, `excedente` — o mesmo vocabulário do Anexo F, do banco e da API |
| Uma responsabilidade por arquivo | Formatação não conhece domínio; domínio não conhece React |
| Comentário explica o "por quê" | Não há comentário narrando o que o código já diz |
| Sem `any`, sem `as` de conveniência | `Tabela<T>` é genérica de verdade |
| Constantes de domínio em mapa único | O dicionário de estados existe uma vez por domínio, não por tela |
| `noUnusedLocals` ligado | Import morto reprova a build — cinco foram removidos durante esta refatoração |

**SOLID onde tem efeito prático:** `Tabela` depende da abstração `Coluna<T>`, não das telas
(inversão de dependência); `primitivos.tsx` é aberto a variantes e fechado a modificação
(`variante`, `severidade`); cada primitivo tem uma razão para mudar.

---

## 8. Componentes

| Componente | O que resolve de uma vez por todas |
| --- | --- |
| `Botao` | Variantes, estado desabilitado **com motivo** exibido |
| `Campo` / `Entrada` / `Selecao` | `id` gerado, rótulo associado, erro por `aria-describedby` + `aria-invalid` |
| `Chip` | Estado com glifo + rótulo + cor; impossível criar chip só-cor |
| `Cartao` | Cabeçalho padronizado; opcionalmente região nomeada para leitor de tela |
| `Metrica` | Valor, unidade, variação com **sinal explícito** e direção semântica (queda de inadimplência é positiva) |
| `Skeleton` + `Carregando` | Skeleton visual e anúncio sonoro juntos — um sem o outro é meia solução |
| `EstadoVazio` | Título, explicação e ação de saída |
| `Aviso` | Bloqueio com lista de saídas |
| `Tabela<T>` | `scope`, `aria-sort`, contagem viva, paginação, rolagem acessível condicional |
| `Sparkline` / `BarrasMensais` / `BarrasHorizontais` | Descrição textual da conclusão, alternativa tabular, segundo canal além da cor |
| `PaletaComandos` | Combobox ARIA completo, com devolução de foco |
| `AppShell` | Navegação filtrada por permissão, escopo, tema, migalhas |

---

## 9. Arquitetura front-end

```
┌───────────────────────────────────────────────────────────────┐
│  telas/            o que mostrar e em que ordem               │
├───────────────────────────────────────────────────────────────┤
│  componentes/ui/   como mostrar (sem saber de domínio)        │
│  componentes/layout/  onde mostrar                            │
├───────────────────────────────────────────────────────────────┤
│  lib/              formato · permissões · sessão · consulta   │
├───────────────────────────────────────────────────────────────┤
│  dados/consultas   o que os números significam                │
│  dados/api         de onde vêm  ← único ponto a trocar         │
└───────────────────────────────────────────────────────────────┘
```

### Preparação para autenticação e API real

| Item | Estado atual | O que muda no go-live |
| --- | --- | --- |
| Sessão | `ProvedorSessao` com perfil selecionável | Perfil e escopos passam a vir do JWT (Anexo H.4) |
| Permissões | Catálogo idêntico ao do Anexo C | Nada — já é o mesmo vocabulário do servidor |
| Proteção de rota | Componente `Protegida` por permissão | Acrescenta redirecionamento para login |
| Chamada de dados | `api.ts` com latência simulada | `fetch` com `Authorization` e `Idempotency-Key` |
| Erro | `ErroApi` com código e ações | Passa a ler `application/problem+json` (Anexo D) |
| Roteador | `HashRouter` (arquivo único) | `BrowserRouter` — uma linha |

**Nota de segurança que vale registrar:** este front-end esconde o que o perfil não pode operar
para reduzir ruído — **nunca como proteção**. A autoridade é o servidor, e o guarda de CI que
proíbe `service_role` em código de cliente continua ativo (Anexo H.2).

---

## 10. A nova experiência

Navegação de **um nível**, agrupada por finalidade, com contadores de pendência no próprio menu:

```
Operação    ◧ Painel do dia        ▤ Parque instalado
            ❐ Contratos            ⚯ Clientes
Serviço     ⚒ Chamados ⑤           ⬒ Peças e suprimentos ④
Financeiro  ▦ Faturamento ④        ◈ Resultado
```

Submenu foi descartado de propósito: esconde função e obriga a memorizar caminho. Oito destinos
cabem em uma lista lida de uma vez.

**Jornada do operador administrativo:** abre no painel do dia → vê seis cartões de exceção →
clica no que exige ação → chega na lista já filtrada → resolve. Nenhum passo de "escolher a tela
certa primeiro".

**Jornada do gestor:** `⌘K` → nome do cliente → visão da carteira com recorrente, consumo, margem
e exposição vencida na mesma linha.

**Mobile:** abaixo de 1024 px o rail colapsa em ícones com rótulo preservado para leitor de tela;
abaixo de 760 px vira barra horizontal com alvos de 44 px. Colunas secundárias das tabelas saem, e
as essenciais — identificação, estado, valor — ficam.

---

## 11. Base de dados de teste

Gerada por semente fixa (`20260730`): a mesma base em toda execução, o que permite testes que
afirmam números concretos. Data de referência congelada em **30/07/2026**.

### Volume

| Entidade | Quantidade | Observação |
| --- | --- | --- |
| Clientes corporativos | 34 | Razão social, nome fantasia, segmento, contato |
| **CNPJ** | 34 | **Dígitos verificadores válidos**, calculados — verificado em teste |
| Locais de operação | ~85 | 1 a 4 por cliente |
| Contratos | 62 | Ativos, em renovação, **vencidos em campo**, encerrados |
| Equipamentos | 420 | 14 modelos, 9 fabricantes, 6 filiais, 8 regiões |
| Leituras de contador | ~2.900 | 12 meses por equipamento de impressão |
| Chamados | 219 | Histórico fechado + fila aberta + 5 em risco de SLA |
| Técnicos | 14 | Com especialidade e região |
| Peças | 24 | Toner, cilindro, fusor, kit, SSD, memória, bateria, fonte |
| Faturas | ~380 | 6 competências, com itens e memória de cálculo |

### Portfólio — o domínio correto

| Família | Categorias | Modelos |
| --- | --- | --- |
| **Impressão** | Multifuncional mono e color, laser mono e color, térmica de etiquetas | Kyocera TASKalfa 4054ci e 3554ci · HP LaserJet Managed E77830 e E52645 · Lexmark MX532adwe e CX635adwe · Brother HL-L6402DW · Zebra ZT411 |
| **Computação** | Desktop, notebook, thin client | Dell OptiPlex 3000 e Latitude 5440 · Lenovo ThinkCentre M70q e ThinkPad L14 · Positivo TC300 |
| **Contingência** | Nobreak | APC Smart-UPS 1500 VA |

### O modelo de receita — o que muda em relação ao exemplo anterior

Impressão é cobrada por **franquia de páginas + excedente por página** (mono ~R$ 0,04, color
~R$ 0,29); computação é **fixo mensal** sem medidor. Isso não exigiu alterar a arquitetura: o Anexo E
já previa `FRANQUIA_EXCEDENTE` com medição por "contador de ciclos/cópias". O domínio de impressão é
uma instância do modelo, não uma exceção a ele — o que é uma validação da modelagem original.

Consumo tem **sazonalidade real**: dezembro e janeiro caem a ~62% da média por recesso; julho fica em
86%. Sem isso a série mensal fica plana e o gráfico não ensina nada.

### Casos plantados — as exceções que a operação precisa ver

| Caso | Por que existe |
| --- | --- |
| 1 cliente **bloqueado** (34 dias de atraso) + 2 em observação | Exercita régua de cobrança e bloqueio comercial |
| Contratos **vencidos em campo** | Equipamento no cliente sem amparo contratual — cobrança sem contrato |
| 3 equipamentos **bloqueados** por preventiva vencida | Alcançaram o gatilho de páginas além da tolerância |
| 1 equipamento com **margem negativa** | Custo de manutenção 34% acima da receita — candidato a desmobilização |
| 5 chamados em **risco de SLA**, 1 já estourado | Dá tensão real à fila do supervisor |
| Toner ciano em **ruptura** (saldo 2), cabeça térmica **zerada** | Peça que trava chamado aberto |
| 4 **pendências de medição** | Bloqueiam o fechamento da competência |

**Indicadores são derivados, nunca digitados:** receita é a soma das faturas da competência;
ocupação é locados sobre ativos; SLA é a razão de chamados no prazo; MTTR é a média real de
abertura até conclusão; margem desconta manutenção e depreciação calculada por modelo.

---

## 12. Dashboards

**Dois dashboards, estruturalmente diferentes** — a mesma tela não serve a quem age e a quem decide.

### Painel do dia (operação) — exceção
Primeira dobra: seis cartões de exceção clicáveis, cada um com número, rótulo e o porquê. Depois:
fila técnica por risco de prazo, reposição urgente, ocupação com meta, volume de impressão com
sazonalidade, parque por região e situação de recebimento. Zero gráfico decorativo.

### Resultado (executivo) — tendência
Oito indicadores com comparação de período: receita, recorrente, margem, ocupação, inadimplência,
SLA, MTTR e disponibilidade. Depois: receita × custo em 12 meses, desempenho por região,
rentabilidade por cliente (cinco melhores e três piores) e equipamentos com margem negativa.

Todos os indicadores pedidos estão cobertos, com uma escolha de unidade que vale destacar: variação
de percentual é exibida em **pontos percentuais**, não em porcentagem de porcentagem — erro comum
que distorce a leitura.

---

## 13. Navegação

| Recurso | Implementação |
| --- | --- |
| Rail moderno | Um nível, agrupado, com contador de pendência por item |
| Busca global | `⌘K`/`Ctrl+K` sobre patrimônio, série, cliente, CNPJ, contrato e chamado |
| Navegação rápida | A mesma paleta lista os destinos como comandos |
| Migalhas | Um nível, ausentes na raiz onde não acrescentariam nada |
| Filtros inteligentes | Recortes por intenção ("Vencem em 90 dias", "Travando chamado") em vez de campo cru |
| Estado na URL | Filtro compartilhável, favoritável e sobrevive a recarregamento |
| Ações contextuais | Atalho de exceção → lista filtrada; linha de fatura → memória de cálculo |
| Escopo de filial | Seletor global que recorta todas as telas |

---

## 14. Evolução futura

**Curto prazo (próxima onda)**
1. Formulários de escrita: abertura de chamado, novo contrato, movimentação — com salvamento de
   rascunho e validação Zod compartilhada com o servidor.
2. Substituir `api.ts` pelo cliente HTTP real; `useConsulta` → TanStack Query.
3. Detalhe de equipamento com linha do tempo unificada (movimentações, chamados, leituras, faturas).
4. Virtualização de tabela quando uma lista passar de ~2.000 linhas.

**Médio prazo**
5. PWA de campo para o técnico: fila offline, leitura de contador com foto, baixa de peça.
6. Exportação assíncrona com download por link assinado.
7. Mapa operacional com MapLibre, mantendo a alternativa em lista como implementação acessível.
8. Construtor de relatório com colunas e filtros salvos por usuário.

**Longo prazo**
9. Telemetria de impressora (SNMP/API do fabricante) eliminando a leitura manual de contador — é o
   que zera as pendências de medição.
10. Sugestão de reposição de toner por consumo previsto, não por saldo mínimo.
11. Portal do cliente com faturas, parque em posse e abertura de chamado.
12. Auditoria de acessibilidade externa e declaração de conformidade (Anexo G.10).

---

## Verificação desta entrega

```bash
pnpm tipos        # TypeScript estrito, zero erro
pnpm a11y:tokens  # 188/188 contraste e daltonismo
pnpm build        # bundle de arquivo único
pnpm a11y:dom     # 27 testes em Chromium real
pnpm db:test      # 20 assertivas de invariante no PostgreSQL
```

Cobertura da suíte de interface: axe em 8 telas × 2 temas · reflow em 320 px nas 8 telas · zoom
200% · ordem de foco · indicador de foco em todo focável · paleta de comandos com devolução de foco
· permissões escondendo menu, ação e rota · `aria-sort` reordenando de fato · estado vazio com saída
· contagem em região viva · filtro sobrevivendo a recarregamento · aviso de ação anunciado ·
gráfico com alternativa tabular · **validação dos dígitos verificadores dos CNPJs** · presença de
franquia, consumo e excedente na memória de cálculo.
