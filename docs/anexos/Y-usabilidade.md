# Anexo Y — Revisão de usabilidade e plano de unificação

> **Estado: proposta, aguardando aprovação.** Nada deste anexo foi implementado.
> O protótipo em imagem precede o código por decisão do cliente.

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
| **1** | Navegação: acordeão de 6 áreas (desktop) e barra inferior rotulada (celular) | baixo — `lib/navegacao.ts` já é a fonte única; muda a apresentação |
| **2** | Lista de trabalho: seleção múltipla, barra de lote, ações em `⋯`, rodapé de paginação. Primeiro no Parque, depois nas outras seis listas | médio — o componente `Tabela` é compartilhado |
| **3** | Visões salvas e filtro na URL | médio — exige decidir se a visão é por usuário ou por locatário |
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
