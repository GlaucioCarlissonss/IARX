# Anexo Y — Revisão de usabilidade e plano de unificação

> **Estado: fase 1 entregue; fases 2 a 5 aguardando.**
> O protótipo em imagem precede o código por decisão do cliente.
>
> Decisões tomadas em 07/11/2026: começar pela navegação; o seletor de perfil é
> de demonstração; as visões salvas serão **compartilhadas no locatário**.

## Y.1 Como esta revisão foi feita

Capturando as telas do **build** (`apps/web/dist/index.html`, o mesmo artefato
que a suíte de acessibilidade exercita) em 1440×900 e em 390×844, e olhando
para elas. Revisar usabilidade lendo código revisa a intenção, não o resultado
— e foi assim que vários dos achados abaixo passaram despercebidos até agora,
incluindo um em que a navegação do celular é inutilizável.

O instrumento ficou no repositório: `apps/web/scripts/capturar-telas.mjs`.

## Y.2 O que está bom, e não se mexe

Antes do que falta, o que já está resolvido e seria caro perder:

- **Paleta de comandos (⌘K) com lista única de navegação.** A lista do menu e a
  da paleta são o mesmo array (`lib/navegacao.ts`), filtrado por permissão. É a
  prática que Linear e Raycast popularizaram, e aqui ela já está correta.
- **Tipografia tabular para dado.** Patrimônio, percentual e dinheiro em
  monoespaçada com `tabular-nums`. Colunas numéricas alinham, o olho compara.
- **Tokens com verificação de contraste bloqueando o merge.** WCAG 2.2 AA
  conferido por script, não por opinião.
- **Texto que explica a regra, não o campo.** "O estado é a projeção da última
  movimentação registrada — não um campo editável" vale mais que um *tooltip*.
- **Estados nomeados com cor + forma + texto**, nunca só cor.

## Y.3 Achados

Ordenados por custo de não corrigir.

### Y.3.1 A navegação do celular é inutilizável · **bloqueante**

Em 390 px o menu lateral vira uma fileira de **seis glifos sem rótulo**
(`▤ ◰ ◍ ◉ …`) no topo, mostrando 6 dos 20 destinos. Não há como saber o que
cada um é senão tocando, e 14 telas não têm caminho nenhum.

Referência de mercado: barra inferior com 4–5 destinos **rotulados** e um
"Mais" — o padrão de Gmail, Linear mobile e dos apps de campo da ServiceNow.
Campo é onde o técnico usa o sistema; é a tela que menos pode falhar.

### Y.3.2 Vinte itens de menu, nove deles em "Financeiro" · **alto**

`Operação (5) · Serviço (2) · Financeiro (9) · Administração (4)`. O grupo
Financeiro sozinho é quase metade, e em 900 px de altura "Administração" já
fica fora da dobra. Com as rotas novas (compras, inventário, reajustes,
alçadas, auditoria, cadastros) seriam ~30.

Referência: Stripe e Xero usam **acordeão com só a seção ativa expandida**;
SAP Fiori chama de *work centers*. A proposta adota o acordeão — é o que reduz
de 20 para 6 linhas visíveis sem acrescentar coluna nem mudar o componente.

### Y.3.3 Três botões por linha, em listas de centenas · **alto**

No Parque cada linha traz `Leitura`, `Chamado` e `Bloquear/Desbloquear`. São
438 linhas × 3 botões, empurrando as colunas de dado para a direita e fazendo
a página inteira parecer um formulário.

Referência: o *index table* do Shopify Polaris e do Atlassian — uma ação
primária visível e o resto em `⋯`.

### Y.3.4 Nenhuma lista tem seleção múltipla · **alto**

Bloquear as 14 preventivas vencidas são 14 idas e voltas. Aprovar 20 cobranças,
20. Não há uma única ação em lote no sistema — e o back-end já tem todas as
rotas que elas chamariam.

Referência: barra de lote que **substitui** a de ferramentas quando há seleção
(Gmail, Polaris). Substituir, e não somar, é o que impede a barra de crescer.

### Y.3.5 O filtro é remontado à mão todo dia · **médio**

Quem cuida de preventiva vencida refaz o mesmo filtro toda manhã. Não há visões
salvas, e o filtro não sobrevive à navegação.

Referência: *saved views* do Linear, *segments* do Stripe, listas do Jira.

### Y.3.6 Os cartões de KPI não parecem clicáveis, nem dizem se pioraram · **médio**

O subtítulo avisa que "cada cartão abre a lista já filtrada", mas o cartão não
tem nenhuma afordância. E `11 chamados em risco` não diz se ontem eram 7 ou 15
— que é a única coisa que decide se alguém larga o que está fazendo.

### Y.3.7 A barra de topo gasta espaço com o que não é contexto · **médio**

Hoje: busca + `Filial` + **`Perfil`** + `Tema` + "Operação IARX" + `Sair`.

O seletor de **Perfil** é uma afordância de demonstração exposta como produção:
trocar o próprio perfil na barra superior contradiz todo o modelo de permissão
que o back-end sustenta. **Isto é decisão sua, não minha** — se ele existe para
demonstração, proponho escondê-lo atrás de uma variável de ambiente; se existe
para operação, ele precisa de permissão própria e de trilha de auditoria.

`Tema` vai para o menu do avatar. Entram `Período`, que hoje não existe e é o
recorte mais usado do sistema inteiro.

### Y.3.8 Inconsistência de onde mora o filtro · **médio**

Em *Parque* a barra de filtro é da tela; em *Contas a receber* ela está dentro
do cartão da tabela, abaixo de dois alertas que ocupam ~230 px. Duas telas da
mesma família, dois lugares.

### Y.3.9 Paginação anunciada, não oferecida · **baixo**

"438 registros · página 1 de 18" aparece no cabeçalho e os controles ficam fora
da área visível. O rodapé fixo da tabela é o lugar.

### Y.3.10 Dezoito formulários, um arquivo cada · **baixo, mas cresce**

`FormAbrirChamado`, `FormAlocarEquipamento`, … 18 arquivos que repetem o mesmo
esqueleto. Com as rotas novas seriam ~28. Não é urgente; é o tipo de coisa que
fica cara exatamente quando já não dá para mexer.

## Y.4 Plano

Cinco fases, cada uma entregável e verificável sozinha. Cada fase começa com um
protótipo em imagem aprovado.

| Fase | Entrega | Risco |
| --- | --- | --- |
| **1** ✅ | Navegação: acordeão de 6 áreas (desktop) e barra inferior rotulada (celular) | entregue — ver §Y.6 |
| **2** | Lista de trabalho: seleção múltipla, barra de lote, ações em `⋯`, rodapé de paginação. Primeiro no Parque, depois nas outras seis listas | médio — o componente `Tabela` é compartilhado |
| **3** | Visões salvas **compartilhadas no locatário** e filtro na URL | médio — decidido: compartilhadas. Exige tabela nova e permissão `visao:gerenciar` |
| **4** | Cartões de KPI com variação e afordância de link; barra de topo com contexto | baixo |
| **5** | Unificação dos formulários num descritor único | médio — 18 arquivos tocados de uma vez |

### O que o plano **não** inclui

- **Nenhuma mudança de paleta, tipografia ou escala.** Os tokens passam por
  verificação de contraste que bloqueia o merge; mexer neles é outro assunto,
  com outro risco.
- **Nenhuma mudança de regra de negócio.** Esta revisão é de interface.
- **Nenhuma biblioteca de componentes nova.** O que existe é próprio, tem
  verificação de acessibilidade por tela e 231 casos de teste em cima. Trocar
  por uma biblioteca de terceiro jogaria fora essa cobertura.

### Como cada fase é verificada

A suíte `a11y:dom` já roda axe, teclado e refluxo em 320 px em cada tela. Cada
fase acrescenta casos antes do código:

- fase 1 — todo destino alcançável em 390 px; rótulo visível em cada um;
- fase 2 — seleção por teclado; a barra de lote anuncia a contagem em
  `aria-live`; nenhuma ação em lote sem confirmação quando é irreversível;
- fase 3 — a visão sobrevive a recarregar a página;
- fase 4 — o cartão é um `link` com nome acessível que inclui a variação;
- fase 5 — nenhuma regressão nos formulários existentes.

## Y.5 O que precisa de decisão sua

1. **O seletor de Perfil na barra superior** — demonstração ou operação?
   (§Y.3.7)
2. **Visão salva é por usuário ou compartilhada no locatário?** A segunda é
   mais útil e exige permissão nova.
3. **Ordem das fases.** A 1 é a de maior retorno por esforço; a 2 é a que mais
   muda o dia de quem opera.

## Y.6 Fase 1 — o que foi entregue

Comparativo em `docs/prototipos/fase-1-antes-depois.png`, capturado do build nas
três larguras.

### Desktop

Seis áreas, só a da tela atual aberta. Financeiro, que sozinho tinha nove
telas, ficou dividido em três blocos — Cobrança, Fiscal e Controladoria. O
bloco é um rótulo, **não** um nível de clique: o destino continua a um clique
assim que a área está aberta.

A área da tela abre sozinha. Sem isso o acordeão seria submenu de verdade: quem
chega por link — paleta de comandos, cartão do painel, migalha — veria o menu
apontando para outro lugar.

### Celular

Barra inferior com quatro destinos nomeados e "Mais", que abre a lista inteira.
O rail não é escondido visualmente: ele não é renderizado, para o leitor de
tela não anunciar a mesma navegação duas vezes.

### Notebook pequeno — um defeito que a fase descobriu

O rail colapsava para uma coluna de glifos abaixo de 1024 px, com o rótulo
virando texto de leitor de tela. Com vinte itens já era ruim; com o acordeão
aberto em Financeiro ficavam dezesseis ícones sem nome — o mesmo defeito que a
barra inferior veio corrigir, reproduzido em notebook.

O colapso foi removido: o rail passa a 200 px **com rótulo**. Ícone sem rótulo
não reflui; texto, sim.

### Seletor de perfil

Só em modo demonstração (`lib/demonstracao.ts`). Sem API configurada é
demonstração — o artefato de arquivo único *é* a demonstração. Com API, some.
`VITE_IARX_DEMO` e `window.__IARX_DEMO__` têm a última palavra nos dois
sentidos.

### Verificação

Oito casos novos na suíte de acessibilidade, que passou de 231 para 239:

- as seis áreas aparecem, e na raiz nenhuma vem aberta;
- chegar numa tela abre a área dela;
- **as dezenove telas do menu são alcançáveis em duas interações** — um clique
  na área, um no destino. Se alguma exigisse um terceiro, o acordeão teria
  virado submenu aninhado;
- em 390 px todo destino é alcançável e cada atalho tem rótulo visível;
- os cinco alvos da barra inferior respeitam o piso de toque de 44 px;
- a folha de "Mais" fecha ao escolher um destino;
- **nenhum item do menu fica sem rótulo visível em nenhuma largura** — é o
  caso que impede o colapso em glifos de voltar;
- o seletor de perfil some quando há API configurada.

### O que a fase encontrou e não corrigiu

"Notas fiscais" está em Financeiro/Fiscal, mas quem tem `nota_fiscal:ler` no
perfil padrão é o **Supervisor de Manutenção** — a entrada fiscal de compra é
o documento de recebimento, e quem recebe é a manutenção. No mercado esse
documento costuma morar com suprimentos, não com o financeiro.

Mover a tela é mudança de navegação e precisa de aprovação, então ficou como
está. É pergunta para a próxima rodada.

## Y.7 Fase 2 — protótipo aguardando aprovação

Desenho em `docs/prototipos/d-fase-2-lista.html` e `.png`, em cinco quadros:
repouso, com seleção, menu `⋯` com confirmação, resultado do lote e 390 px.

### O que o desenho fixa

- **Uma ação visível por linha** (`Abrir`) e o resto em `⋯`. Hoje são três
  botões em 438 linhas, empurrando o dado para a direita.
- **A barra de lote substitui a de ferramentas**, não se soma a ela. Somar
  cresce para duas linhas e empurra a tabela justamente quando o olho está
  nela.
- **A seleção pertence à página exibida** e some ao paginar, com a contagem
  dizendo-o no rodapé. "Selecionar os 438" agiria sobre registros que ninguém
  viu.
- **Rodapé de paginação** com os controles, hoje só anunciados no cabeçalho.
- **Em 390 px**: cartão por registro em vez de tabela de sete colunas;
  "Carregar mais" em vez de Anterior/Próxima; barra de lote **acima** da barra
  inferior, nunca no lugar dela — trocar a navegação por ações faria a única
  saída da tela sumir no meio de uma operação.

### Ações em lote, e o limite que elas respeitam

Só entram ações com rota que já existe, uma por equipamento:
`bloquear`, `desbloquear`, `transferir`, `baixar`. Nada de "gerar etiquetas"
ou "exportar", que seriam rota nova disfarçada de botão.

### A decisão que falta

**A API não tem rota de lote.** O lote do front faria N chamadas à rota por
equipamento e relataria o resultado parcial — quantos passaram, quantos o
banco recusou e com qual regra, já que cada recusa chega com o nome da
*constraint*.

A alternativa é criar rotas `/lote` no servidor: tudo-ou-nada numa transação
só, mas rota nova, permissão nova e alçada nova por ação.

A proposta é **começar sem rota nova**. O parcial é honesto, e a transação
única esconderia que 14 das 15 preventivas podiam ter sido bloqueadas. Se a
preferência for tudo-ou-nada, isso vira trabalho de back-end **antes** da
fase 2.
