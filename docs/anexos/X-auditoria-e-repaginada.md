# Anexo X — Auditoria do código-fonte e plano de repaginada

Diagnóstico da Entrega 1. **Nenhum código foi alterado**: tudo abaixo é medido,
com o comando ao lado, e serve para o operador aprovar — ou corrigir — o plano
antes de qualquer mudança.

---

## X.0 Antes do diagnóstico: o que o briefing descreve não é este produto

O briefing nomeia módulos, uma identidade visual e um campo de escopo que **não
existem nesta base**. Registro antes de tudo porque executar as sete entregas
sobre essa premissa produziria trabalho que não se encaixa em lugar nenhum.

| O briefing diz | O que existe na IARX |
| --- | --- |
| Módulos "Financeiro, Projetos, SLA, Suporte, Sistema" | **Financeiro** existe (9 módulos). **Projetos** e **SLA** não existem em lugar nenhum. "Suporte" aproxima-se de *Chamados*, que é tela de demonstração sem API. "Sistema" aproxima-se de *Usuários/Perfis* |
| Cores por unidade: RESIDENCIAL roxo, MILAGRES laranja, ALIANÇA azul, UNION rosa, MOOVE verde | Não há essas unidades nem essas cores. A paleta é gerada em `packages/tokens/src/palette.json`, com 151 tokens validados por contraste — e as séries de gráfico são neutras, não ligadas a unidades de negócio |
| "identidade dos Faróis/Objetivos" | Não há nenhum conceito de Farol ou Objetivo no código, nos anexos ou no banco |
| `client_id` | O campo é `cliente_id`, e o recorte é por RLS (migrações 0011, 0022 e 0024), não por filtro de aplicação |

**Isto não bloqueia a auditoria** — ela foi feita sobre o que existe. Bloqueia
duas entregas específicas: a paleta por unidade da Entrega 4 e a revisão de
fluxos "projetos / SLA / suporte" da Entrega 5. Preciso de uma orientação:
adaptar ao domínio da IARX, ou o briefing é de outro produto?

E uma regra se aplica sem exceção ao resto: **não inventarei cores, unidades,
indicadores ou módulos que a especificação não tem.**

---

## X.1 Inventário, medido

```
apps/web/src       37.337 linhas   25 telas · 30 componentes · 14 módulos de dados · 7 de lib
apps/api/src       14.559          16 módulos (controller + service + repositório)
packages/db        17.433          24 migrações · 17 suítes de invariante
packages/contracts  3.666          esquemas Zod compartilhados
packages/tokens       744          paleta + validador de contraste
testes             11.971          apps/web/test + apps/api/test
```

**Duas audiências, dois shells**: operação da locadora (21 telas) e portal do
cliente (4 telas), separados por audiência e não só por permissão.

A API tem **estrutura uniforme**: 16 módulos, 15 deles com exatamente
`*.controller.ts` + `*.service.ts` + `*.repositorio.ts`. As exceções são
justificadas (`saude` só tem controller; `notificacao` e `lancamentos-futuros`
têm worker).

---

## X.2 Código morto — medido, e menor do que o briefing supõe

### Arquivos órfãos: **zero**

Grafo de importação completo (`import`, `import type` e `import()` dinâmico),
resolvendo caminhos relativos: **nenhum arquivo de `src` está sem importador**.

### Símbolos de fato mortos: **13**

Declarados e nunca referenciados, em lugar nenhum do repositório:

| Arquivo | Símbolo |
| --- | --- |
| `apps/web/src/dados/comercial.ts` | `descontoVigente` |
| `apps/web/src/lib/formato.ts` | `pontosPercentuais`, `variacaoTexto`, `dataHora`, `mascararCnpj` |
| `apps/api/src/comum/senha.ts` | `tokensIguais` |
| `packages/contracts/src/catalogo-permissoes.ts` | `EscopoConcedido` |
| `packages/contracts/src/contrato.ts` | `STATUS_OCUPANTES`, `EncerrarItem` |
| `packages/contracts/src/equipamento.ts` | `MedidorTipo`, `RegistrarLeitura` |
| `packages/contracts/src/primitivos.ts` | `Vigencia`, `colecao` |

**Cuidado com sete deles.** Os de `packages/contracts` são a superfície pública
de um pacote compartilhado: `RegistrarLeitura` e `EncerrarItem` são esquemas de
rotas **especificadas e não construídas**. Apagá-los não remove código morto —
remove a especificação de uma rota que falta. A recomendação é marcá-los, não
excluí-los; só `descontoVigente`, os quatro de `formato.ts` e `tokensIguais` são
remoção limpa.

`mascararCnpj` merece atenção própria: existe por causa de
`dados_sensiveis:ver_completo` (Anexo C) e **nunca foi ligado**. É a mesma classe
de defeito que esta base já corrigiu três vezes — peça construída, nunca ligada.
Remover é uma decisão; ligar é outra. Não é limpeza.

### Exports desnecessários: **~60**

Símbolos exportados e usados **só dentro do próprio arquivo**. Não são código
morto: são superfície pública maior que o necessário. Reduzi-la é barato e
melhora o que a auditoria seguinte consegue enxergar.

### Dependências não usadas: **zero**

Todas as 27 dependências declaradas têm uso. As que não aparecem em `import`
(`@types/*`, `typescript`, `@nestjs/platform-express`) são exigidas pelo
compilador ou pelo adaptador HTTP padrão do Nest — **não são órfãs**.

### Comentários obsoletos / código comentado: **nada relevante encontrado**

A densidade de comentário é alta e deliberada (o projeto documenta *por quê*, não
*o quê*). Não encontrei blocos de código comentado nem comentário contradizendo o
código. **Recomendo não mexer**: aqui o comentário é o registro das decisões.

---

## X.3 Duplicação — uma oportunidade real, e grande

### Tabelas: metade do sistema ignora o componente que existe

```
22 ocorrências de <Tabela>   (componente com aria-sort, th scope=row,
                              contagem em aria-live, paginação, rolagem)
22 ocorrências de <table>    cru, em 13 arquivos
```

Das 22 cruas, 4 são legítimas (3 são a "alternativa em tabela" dos gráficos, 1 é
o próprio componente). **Sobram ~18 candidatas** em Faturamento, Comercial,
Resultado, Mapa, Início, NotasFiscais, Despesas e quatro formulários.

Nem todas devem migrar: uma tabela de 3 linhas num cartão de resumo não precisa
de paginação nem de ordenação. A proposta é migrar as que têm **ordenação,
paginação ou mais de ~10 linhas**, e deixar as demais com um comentário dizendo
por quê — para a próxima auditoria não reabrir a questão.

### Barras de filtro: 16 telas, cada uma com a sua

`className="filtros"` aparece em 16 arquivos, cada um montando os seus
`<Selecao>`. Há um padrão claro repetido — filtro de competência, filtro de
situação, busca por texto — que cabe em dois ou três componentes.

### Duplicação deliberada, que **não** deve ser removida

Regras de negócio existem duas vezes: como função no banco
(`app.despesa_realizada`, `app.execucao_orcamentaria`, `app.saldo_titulo_receber`)
e como função no front. É assumido e tem contrapartida declarada: as duas suítes
falham juntas se a regra mudar de um lado só. **Consolidar isso seria uma
regressão de segurança**, não uma limpeza.

---

## X.4 Inconsistências

### Nomenclatura: já consistente — três exceções

- Rotas: **26/26 em kebab-case**.
- Módulos da API: 15/16 no padrão `controller/service/repositorio`.
- Componentes: **3 de 30** fora de PascalCase — `primitivos.tsx`,
  `formulario.tsx`, `graficos.tsx`. São *coleções* de componentes, não
  componentes; o nome minúsculo está certo pelo conteúdo e errado pela
  convenção. Decisão pequena, mas é decisão.

### Tokens: duas fontes, e **8 referências quebradas**

O design system está dividido: cores em `packages/tokens` (geradas, validadas por
contraste) e escalas de espaço/tipografia/raio escritas à mão em `global.css`.

E há defeito real — **3 variáveis usadas sem existir e sem fallback**:

| Variável | Onde | Efeito |
| --- | --- | --- |
| `--cor-text` (5×) | `.mapa__zoom button`, `.mapa__aviso`, `.previa-alcada`, `.descricoes dd`, `.alternador:has(...)` | A declaração `color:` inteira é inválida: a cor cai para a herdada |
| `--t-16` (2×) | `.mapa__zoom button`, `.entrar__produto` | `font-size` inválido: o tamanho cai para o herdado |
| `--cor-atencao-subtle-bg` (1×) | `.mapa__aviso` | Sem fundo de atenção — o aviso perde o destaque |

O nome certo é `--cor-text-primary` e `--cor-atencao-bg`; `--t-16` não existe na
escala. Nenhum portão pega isto hoje: `a11y:tokens` valida a **paleta**, não o
CSS que a consome, e o axe aprova porque a cor herdada tem contraste suficiente.
**É o achado mais acionável desta auditoria** — custa minutos e corrige aparência
em cinco lugares.

Também: **6 tokens declarados e nunca usados** (`--e6`, `--t-34`,
`--foco-espessura`, `--foco-offset`, `--foco-sombra`, `--alvo-toque-min`).

### Estilos inline: 108 — mas o diagnóstico do briefing não se aplica

| | |
| --- | --- |
| Com `var(--token)` | **62** — uso correto, só não cabe numa classe |
| Geometria calculada (mapa, skeleton, gráfico) | **~20** — tem de ser inline |
| Candidatos reais a classe | **~23** — `fontWeight` 600/620/650/700 (12×), `minWidth` 78/88/220/240/520 (12×), `cursor`, `textDecoration`, `margin: 0` |
| Cor ou `px` mágico | **2** |

Ou seja: não há "valores mágicos espalhados". Há **duas escalas faltando** — peso
tipográfico e largura mínima de campo —, e é isso que produz os 23.

### Estados: os quatro portais não têm carregamento

20 das 21 telas da operação usam `useConsulta` (carregando / pronto / erro, com
cancelamento e nova tentativa). As **4 telas do portal usam zero** — leem a base
de forma síncrona e não têm estado de carregamento nenhum. É inconsistência
introduzida na rodada do portal, e é dívida minha.

---

## X.5 Performance

### Medido

```
bundle          829,5 kB  (785,9 kB JS + 42,9 kB CSS, arquivo único)
gzip            ~234 kB
data: URIs      nenhum
memoização      116 useMemo · 14 useCallback · 0 React.memo
```

### Três gargalos reais

1. **O gerador de massa está no bundle.** `gerar.ts` (2.807 linhas) +
   `comandos.ts` (4.951) + `catalogo.ts` são ~8.800 linhas de dados e regras de
   demonstração embutidas no artefato publicado. É a maior fatia isolada do
   JS, e sai inteira quando o front falar com a API.
2. **59 leituras de `baseSincrona()` no corpo de componentes**, fora de
   `useMemo`. Cada uma devolve coleções novas a cada render (de propósito — é o
   que faz a recarga funcionar), então todo `useMemo` que dependa delas
   recalcula sempre. O efeito hoje é pequeno porque tudo é memória; passa a ser
   grande quando virar `fetch`.
3. **Dois N+1 reais na API**, ambos em escrita:
   `contas-receber.service.ts:340` faz um `porId` por parcela antes de cancelar
   em cascata; `notas-fiscais.service.ts:338` cria equipamento linha a linha.
   Ambos são limitados pelo número de parcelas/linhas, não pela base inteira —
   **médio, não crítico**.

### Dois gargalos que o briefing supõe e **não** existem

- **Queries N+1 de leitura**: as consultas de listagem são únicas, com
  `left join lateral` para agregados. O resumo do portal é uma consulta só, com
  dez subconsultas, deliberadamente.
- **Listas grandes sem paginação**: `<Tabela>` pagina em 25 por padrão. As
  tabelas cruas é que não paginam — o que reforça X.3.

---

## X.6 Três conflitos dentro do próprio plano de entregas

Preciso de decisão antes das Entregas 4 e 6. Nenhum deles é obstáculo técnico:
são escolhas que trocam uma coisa boa por outra.

### 1. Fonte distinta × bundle menor

A Entrega 4 pede tipografia **não genérica** (proíbe Arial, Inter, Roboto) — e
hoje `--fonte-ui` é exatamente a pilha do sistema. Mas o build é **arquivo
único, abrível sem servidor** (`vite-plugin-singlefile`), e o portão de
acessibilidade roda contra `file://`. Uma fonte de verdade teria de ser
embutida em base64 **dentro do HTML**: duas famílias × dois pesos ≈ 120–200 kB a
mais, contra a Entrega 6, que pede bundle menor.

Três saídas, e recomendo a terceira:
- **(a)** Embutir subconjunto (só latim, 2 pesos) — ~60–90 kB; identidade real,
  bundle maior.
- **(b)** `@import` de CDN — bundle intacto, mas **quebra offline** e o portão
  a11y passa a depender de rede.
- **(c)** **Recomendada:** identidade por *sistema tipográfico*, não por arquivo
  de fonte — escala, pesos, tracking, medida de linha e uma família mono já
  distinta para dado. Zero kB, e resolve a maior parte do "visual genérico".
  Se depois quiserem uma display family, ela entra só nos títulos (um peso,
  ~25 kB).

### 2. Code splitting × arquivo único

A Entrega 6 pede *lazy loading* de rotas. Com `inlineDynamicImports: true` e o
plugin de arquivo único, **code splitting é estruturalmente impossível**: o
build inlina todo `import()`. Ou o entregável deixa de ser um HTML avulso, ou a
Entrega 6 troca *lazy loading* por outras alavancas (remover a massa do bundle,
que vale mais: ~8.800 linhas).

### 3. "Não quebrar funcionalidade" × front desligado da API

32 arquivos do front leem uma base gerada em memória; a API, com 126 rotas e 277
testes, **não é consumida por tela nenhuma**. Então:
- otimizar query, índice e paginação no banco (Entrega 6) **não muda nada** no
  que o usuário vê;
- e qualquer repaginada acontece sobre a camada de demonstração.

Ligar o front à API é a rodada que destrava a Entrega 6 de verdade — e é a maior
de todas. Não cabe dentro de "limpeza e repaginada" sem ser dito.

---

## X.7 Plano de ação, por prioridade

### Crítico — corrige defeito visível hoje

| # | Ação | Onde | Entrega |
| --- | --- | --- | --- |
| 1 | Corrigir as 8 referências a variável inexistente | `global.css` | 2 |
| 2 | Dar estado de carregamento às 4 telas do portal | `telas/Portal*.tsx` | 5 |

### Médio — paga-se rápido

| # | Ação | Medida | Entrega |
| --- | --- | --- | --- |
| 3 | Remover os 6 símbolos de remoção limpa; **marcar** (não apagar) os 7 de `contracts` | 13 símbolos | 2 |
| 4 | Migrar as tabelas cruas elegíveis para `<Tabela>` | ~18 candidatas | 2 |
| 5 | Extrair os filtros repetidos em 2–3 componentes | 16 telas | 2 |
| 6 | Criar escala de peso tipográfico e de largura de campo; eliminar os ~23 inline | 23 ocorrências | 3 |
| 7 | Unificar as duas fontes de token sob um índice só | 2 arquivos | 3 |
| 8 | Reduzir os ~60 exports desnecessários | 60 símbolos | 3 |
| 9 | Corrigir os 2 N+1 de escrita da API | 2 serviços | 6 |

### Baixo — cosmético ou discutível

| # | Ação | Observação |
| --- | --- | --- |
| 10 | Remover 6 tokens não usados | Ou usá-los: `--foco-*` sugere um padrão de foco que ficou pela metade |
| 11 | Renomear `primitivos/formulario/graficos` | Convenção × conteúdo; decisão do operador |
| 12 | Envolver `baseSincrona()` em `useMemo` nos 59 pontos | Ganho real só depois de ligar à API |

### Não fazer

| Item | Por quê |
| --- | --- |
| Remover a duplicação de regra entre banco e front | É proteção deliberada, com teste dos dois lados |
| Remover comentários | São o registro das decisões; é o ativo mais caro de reconstruir |
| Remover dependências | Nenhuma está órfã |
| Apagar esquemas de `contracts` sem rota | Removeria especificação, não código morto |

---

## X.8 Linha de base para "regressão zero"

Qualquer entrega daqui para frente é comparada contra estes números. Foram
medidos hoje, não copiados.

```
npm run tipos                               três pacotes, sem erro
npm run db:test                             198 assertivas de invariante
npm run api:test                            277/277
node apps/api/scripts/verificar-rotas.mjs   126/126 rotas com autorização
npm run web:test                            221/221
npm run build && npm run a11y:dom           225/225
npm run a11y:tokens                         202/202
bundle                                      854,4 kB (238,7 kB gzip)
```

**Correção da medida do bundle.** A primeira versão deste anexo registrou
829,5 kB: era contagem de **caracteres** do `index.html`, e não de bytes — o
arquivo é UTF-8 e acentuação ocupa dois. O número que vale é o que o próprio
build reporta, e é contra ele que as entregas seguintes comparam.

Regressão zero significa: **os sete portões continuam verdes e os números não
caem** — e, quando um número mudar de propósito (o bundle deve cair; a contagem
de testes deve subir), a mudança vem dita no commit.

---

## X.9 O que falta decidir antes de começar

1. **A premissa de X.0**: adaptar ao domínio da IARX, ou o briefing é de outro
   produto?
2. **Tipografia** (X.6.1): embutir fonte, usar CDN, ou identidade por sistema
   tipográfico? *Recomendo a terceira.*
3. **Arquivo único** (X.6.2): manter o entregável abrível sem servidor — e
   portanto sem code splitting — ou trocar?
4. **Escopo da Entrega 6** (X.6.3): com o front desligado da API, otimização de
   banco não muda a experiência. Mantém assim mesmo, ou a rodada de ligação
   entra antes?

---

## X.10 Resultado da Entrega 2 — executada

Três commits: `ded0dd4`, `0279786`, `ca2289c`.

| | Antes | Depois |
| --- | --- | --- |
| `var(--x)` sem declaração e sem alternativa | 8 | **0**, com portão novo |
| Símbolos mortos | 13 | **6**, todos com a lacuna nomeada |
| Tabelas cruas · pelo componente | 22 · 22 | **18 · 26** |
| Campos de busca escritos à mão | 10 | **0** |
| Faixas de filtro repetidas | 16 | **0** |
| `web:test` | 221 | **223** |
| bundle | 854,4 kB | **853,4 kB** |

Os demais portões não se moveram: tipos ✓ · db:test 198 · api:test 277/277 ·
rotas 126/126 · a11y:dom 225 · a11y:tokens 202/202.

### Três correções ao próprio diagnóstico

1. **A auditoria errou por um símbolo.** `aplicarDesconto` passou como vivo
   porque `comandos.ts` tem outra função de mesmo nome: colisão de nome entre
   arquivos engana verificação textual. O total de mortos era 14, não 13.
2. **"~18 tabelas candidatas" estava errado.** Olhando uma a uma, só **4**
   ganhavam algo com o componente. As outras são cruas de propósito: resumos de
   topo-N já ordenados por risco, tabelas dentro de diálogo limitadas pelo
   documento, e a alternativa textual dos gráficos. A razão ficou escrita ao
   lado de cada uma — é o que impede a próxima auditoria de "corrigir" uma
   escolha deliberada.
3. **Dos 13 mortos, 7 não eram código morto.** São superfície pública de
   `packages/contracts` — esquemas de rotas especificadas e não construídas.
   Foram marcados, não apagados.

### O que a Entrega 2 deliberadamente não fez

| Item | Por quê |
| --- | --- |
| Remover `mascararCnpj` | Único vestígio de `dados_sensiveis:ver_completo`, que o Anexo C exige e a interface não cumpre. Apagar esconderia a lacuna |
| Remover os ~60 exports desnecessários | É padronização de superfície, não limpeza de código morto — Entrega 3 |
| Tocar nos comentários | São o registro das decisões, e o ativo mais caro de reconstruir |

---

## X.11 Resultado da Entrega 3 — executada

Dois commits: `512eb88`, `cb1f374`.

| | Antes | Depois |
| --- | --- | --- |
| Token declarado na folha global | 2 blocos + 1 redeclaração escondida | **0**, com portão |
| Estilos inline sem token | 43 | **13**, todos geometria calculada ou medida de uso único |
| Telas do portal sem estado de carregamento | 4 | **0** |
| Blocos de erro escritos à mão | 1 + 4 ausências | **0**, um componente |
| `web:test` | 223 | **224** |

Demais portões imóveis: tipos ✓ · db:test 198 · api:test 277/277 ·
rotas 126/126 · a11y:dom 225 · a11y:tokens 202/202.

### A divisão de token, agora por origem

- `@iarx/tokens` — **cor**, gerada de `palette.json`, verificada por contraste
  e por distinção sob daltonismo no CI. Não se edita à mão.
- `apps/web/src/estilos/escalas.css` — espaço, tipografia, peso, raio, medida e
  tempo. Escrito à mão, sem o que validar além da coerência.
- `global.css` — reset, utilitários e componentes. **Não declara token nenhum.**

O portão nasceu de um caso real: `--largura-rail` estava declarado no topo da
folha e **redeclarado numa media query oitocentas linhas abaixo**. Quem
procurasse "quanto mede o rail" acharia um dos dois valores sem saber do outro.

### Duas escalas que faltavam

**Peso por papel, não por número.** Os quatro valores existiam espalhados em
doze estilos inline, e a diferença não era arbitrária: **620 acompanha a
monoespaçada**, porque fonte mono tem peso ótico menor no mesmo valor numérico.
O token é `--peso-dado`, não `--peso-620`, para quem o usar saber quando.

**Largura mínima de campo.** Nove telas envolviam a busca num `div` com
`minWidth` inline para o mesmo fim.

### Dois defeitos que só a migração assíncrona revelou

1. `PortalConsumo` inicializava a competência com `useState(() => custos[0])`.
   O inicializador roda na primeira renderização, quando a lista assíncrona
   ainda está vazia: o seletor nasceria vazio e nunca se corrigiria.
2. `PortalInicio` mostrava "1 de 4 unidades" ao gestor de unidade — e aquele 4
   vinha de uma contagem da base que **o recorte existe para não entregar**.

### Pendências da Entrega 3 que não se fecharam aqui

| Item | Por quê |
| --- | --- |
| Reduzir os ~60 exports desnecessários | Baixo retorno e risco de remover tipo que uma assinatura pública precisa nomear. Fica para uma passagem com verificação automática, depois de corrigida a falha de colisão de nome |
| Renomear `primitivos/formulario/graficos` | São **coleções** de componentes, não componentes. O minúsculo está certo pelo conteúdo e errado pela convenção; renomear sugeriria um componente chamado `Primitivos`. Precisa de decisão, não de refatoração |
| Trocar a família tipográfica | Depende da decisão de X.9.2, e é Entrega 4 |

### Observação de instabilidade

Numa execução do `a11y:dom`, "a prévia da conversão não conta tentativa" falhou
e passou isolada e na repetição completa. Sem relação com as mudanças desta
entrega — registrado como teste intermitente a investigar.
