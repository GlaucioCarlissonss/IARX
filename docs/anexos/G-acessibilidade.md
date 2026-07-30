# Anexo G — Acessibilidade

> **Meta:** WCAG 2.2 nível AA · **Escopo:** web administrativa, PWA de campo, documentos gerados
> **Estado:** critérios definidos e **paleta verificada por ferramenta executável no CI**
>
> Este anexo existe porque a seção 9.7 declarava a meta sem torná-la verificável. "WCAG 2.2 AA"
> no nível do sistema não é testável — só é testável um critério por componente, com número medido.

---

## G.1 Princípio orientador

Acessibilidade nesta plataforma não é conformidade formal: é **condição de operação**. O público
inclui técnico com luva sob sol direto, operador de pátio em turno noturno e analista financeiro
oito horas por dia em tabela densa. As mesmas medidas que atendem deficiência permanente atendem
limitação situacional — e é assim que o investimento se paga.

| Deficiência permanente | Limitação situacional equivalente | Medida comum |
| --- | --- | --- |
| Baixa visão | Sol direto na tela do celular no pátio | Contraste alto, tipografia grande, modo alto contraste |
| Daltonismo | Tela desgastada, impressão em preto e branco | Estado com rótulo + ícone, nunca só cor |
| Limitação motora | Luva de raspa, mão suja de graxa | Alvo de toque ≥ 44 px, poucos toques |
| Surdez | Oficina ruidosa | Nenhum feedback só sonoro |
| Deficiência cognitiva | Fim de turno, pressão do fechamento | Fluxo curto, linguagem direta, erro que diz o que fazer |

---

## G.2 O que já está verificado e o que falta

| Item | Estado | Evidência |
| --- | --- | --- |
| Paleta de cores — contraste WCAG AA | **Verificado** | 108 pares medidos, 108 aprovados — `pnpm a11y:tokens` |
| Paleta — distinção de séries sob daltonismo | **Verificado** | 80 pares medidos por ΔE2000 sob 3 tipos de dicromacia |
| Gate de CI bloqueando regressão de cor | **Implementado** | `.github/workflows/ci.yml`, job `acessibilidade-tokens` |
| Gate de CI sobre o DOM renderizado | **Implementado** | job `acessibilidade-dom`, com Chromium e axe |
| Anel de foco visível sobre qualquer fundo | **Implementado** | Técnica de anel duplo em `dist/tokens.css` |
| `prefers-reduced-motion` | **Implementado** | `dist/tokens.css` |
| Critérios por componente | **Definido** (G.4) | Aguarda os componentes existirem para ser aferido |
| Verificação automatizada de DOM (axe) | **Implementado** | 20 testes em Chromium real: axe em 5 telas × 2 temas, teclado, reflow 320 px, zoom 200% |
| Reflow 320 px sem rolagem lateral do corpo | **Verificado** | Teste dedicado — encontrou e corrigiu 105 px de transbordo |
| Indicador de foco em todo elemento focável | **Verificado** | Teste dedicado — encontrou 8 controles sem indicador, por colisão de cascata |
| Teste com tecnologia assistiva real | **Pendente** — Fase 1 | Plano em G.9 |
| PDFs com marcação PDF/UA | **Pendente** — Fase 2 | Requisito em G.7 |
| Declaração de acessibilidade | **Pendente** — Fase 3 | Modelo em G.10 |

**Leitura honesta:** a camada de cor está resolvida e protegida contra regressão. Todo o resto está
especificado de forma aferível, mas não pode ser verificado antes de existir interface.

---

## G.3 Paleta — resultado medido

Validador: `packages/tokens/scripts/validate-contrast.mjs` · Fonte: `packages/tokens/src/palette.json`

```
188/188 verificações aprovadas — WCAG 2.2 AA + distinção categórica sob CVD
  tema light · 54 pares de contraste · 40 pares de série
  tema dark  · 54 pares de contraste · 40 pares de série
```

### G.3.1 Pares de contraste verificados

| Categoria | Mínimo | Critério WCAG |
| --- | --- | --- |
| Texto primário, secundário e atenuado sobre as 3 superfícies | 4,5:1 | 1.4.3 |
| Rótulo de botão primário e link em texto | 4,5:1 | 1.4.3 |
| Rótulo de cada um dos 5 estados semânticos, sobre fundo, tabela e chip | 4,5:1 | 1.4.3 |
| Marcador (bolinha/ícone/barra) de cada estado | 3:1 | 1.4.11 |
| Limite de componente (`border-strong`) | 3:1 | 1.4.11 |
| Anel de foco externo sobre fundo e superfície | 3:1 | 2.4.11 |
| Anel de foco interno sobre botão primário | 3:1 | 2.4.13 |
| Marca de cada série de gráfico sobre fundo e superfície | 3:1 | 1.4.11 |

### G.3.2 Correções que a medição forçou

O validador reprovou três pares que pareciam corretos a olho nu:

| Token | Valor original | Medido | Corrigido para | Resultado |
| --- | --- | --- | --- | --- |
| `text-muted` sobre `surface` (light) | `#6b7480` | **4,37:1** | `#616a76` | aprovado |
| `border-strong` sobre `surface` (light) | `#8c95a3` | **2,79:1** | `#6f7885` | aprovado |
| `focus-ring` sobre `primary` | `#0b4fa8` | **1,00:1** | anel duplo | aprovado |

O terceiro caso não era erro de cor, era **erro de modelagem**: um anel de foco de cor única não
pode contrastar simultaneamente com fundo branco e com botão azul-escuro. A solução é a técnica de
anel duplo — anel externo escuro para o fundo da página, anel interno claro para a superfície do
componente. Está implementada em `--foco-sombra`.

### G.3.3 Defeitos que só o navegador encontrou

O validador de tokens estava 188/188 quando o gate de DOM entrou em operação — e ainda assim ele
encontrou cinco defeitos reais no primeiro uso. É a evidência de que as duas camadas não se
substituem:

| Defeito | Como se manifestava | Correção |
| --- | --- | --- |
| `html-has-lang` | Página servida dentro de envelope que não controlamos; leitor de tela pronunciaria português com fonemas de inglês | Idioma declarado por script (`pt-BR`) |
| `button-name` (crítico) | Abaixo de 560 px o rótulo do menu era escondido com `display:none`, deixando o botão sem nome acessível — o glifo é `aria-hidden` | Rótulo movido para fora da tela, mas mantido no fluxo de acessibilidade |
| `scrollable-region-focusable` | Tabelas com `overflow-x` não eram roláveis por teclado | `tabindex="0"` + `role="region"` aplicados **somente** quando o conteúdo de fato transborda |
| Foco invisível em 8 controles | Componentes com `all: unset` (especificidade de classe) venciam a regra de foco escrita com `:where()` (especificidade 0) e zeravam o `box-shadow` | Regra reescrita com `:is()` e declarada por último |
| Transbordo de 105 px em 320 px | `minmax(340px, 1fr)` não encolhe; itens de grid têm `min-width: auto`, então a faixa `1fr` crescia além da viewport | `minmax(min(340px, 100%), 1fr)` e `min-width: 0` nos itens |

Houve também um erro **no próprio teste**, não no código: o indicador de foco em SVG se expressa no
traço da forma, não em `box-shadow`. O teste genérico passou a excluir elementos SVG, e um teste
dedicado verifica o traço do marcador do mapa.

---

## G.4 Critérios de aceite por componente

Cada componente do design system só é considerado pronto quando atende **todos** os itens da sua
linha. Estes critérios entram na definição de pronto da seção 13.5.

### Tabela operacional
- [ ] Cabeçalho associado às células (`<th scope="col">`), com `<caption>` descrevendo o conteúdo
- [ ] Ordenação anunciada por `aria-sort`, acionável por teclado
- [ ] Seleção múltipla operável por teclado, com contagem anunciada por região `aria-live`
- [ ] Virtualização não quebra a navegação: total de linhas exposto via `aria-rowcount`
- [ ] Nenhuma ação exclusiva de *hover* — tudo alcançável por foco
- [ ] Estado do registro presente como **texto**, não apenas cor ou ícone
- [ ] Em 320 px, rolagem horizontal contida na tabela, nunca no `body` (1.4.10)

### Formulário
- [ ] `<label>` programaticamente associado; `placeholder` nunca substitui rótulo
- [ ] Erro vinculado por `aria-describedby` e anunciado ao surgir
- [ ] Erro identifica o campo e diz como corrigir (3.3.3)
- [ ] Campos de dado pessoal com `autocomplete` apropriado (1.3.5)
- [ ] Salvamento automático de rascunho — evita perda por expiração (2.2.1)
- [ ] Nenhuma validação bloqueante durante a digitação
- [ ] Grupos com `<fieldset>` e `<legend>`

### Busca global (command palette)
- [ ] Padrão *combobox* ARIA completo, com `aria-expanded` e `aria-activedescendant`
- [ ] Resultado anunciado por `aria-live="polite"` com a contagem
- [ ] `Esc` fecha e devolve o foco ao elemento de origem
- [ ] Alcançável sem atalho de teclado (botão visível também)

### Painel lateral (drawer) e modal
- [ ] Foco move para o painel ao abrir, retorna à origem ao fechar
- [ ] Foco preso dentro do modal enquanto aberto
- [ ] `role="dialog"` com `aria-labelledby`
- [ ] Fecha por `Esc`; conteúdo de fundo inerte

### Cartão de indicador (KPI)
- [ ] Valor, unidade e variação em texto — nunca só em cor ou seta
- [ ] Variação com sinal explícito ("+6,2%", "queda de 1,2 p.p."), não apenas verde/vermelho
- [ ] Horário de atualização visível (`RN-030`)

### Mapa operacional — o componente mais crítico
Mapa vetorial é hostil a leitor de tela e a teclado. **Requisito estrutural:** toda informação do
mapa precisa existir também em forma tabular.
- [ ] Alternância "Mapa / Lista" sempre visível, com **os mesmos filtros e os mesmos dados**
- [ ] A visão em lista é a implementação acessível; o mapa é a visão complementar
- [ ] Marcadores navegáveis por teclado, com rótulo textual (patrimônio + estado + local)
- [ ] Zoom e deslocamento por teclado
- [ ] Contagem de resultados do recorte anunciada ao mudar o filtro
- [ ] Criticidade não depende só de cor: forma e rótulo distintos

### PWA de campo
- [ ] Alvos ≥ 44×44 px, com espaçamento ≥ 8 px (2.5.8)
- [ ] Nenhum gesto complexo obrigatório: toda ação por toque simples (2.5.7)
- [ ] Funciona em retrato e paisagem (1.3.4)
- [ ] Modo alto contraste acionável em um toque
- [ ] Estado de sincronização em texto ("3 ações pendentes"), não só ícone
- [ ] Leitura de QR com alternativa de digitação manual do patrimônio
- [ ] Captura de assinatura com alternativa (nome + documento digitados)
- [ ] Testado com TalkBack e VoiceOver — não apenas com verificador automatizado

---

## G.5 Navegação por teclado

| Contexto | Tecla | Ação |
| --- | --- | --- |
| Global | `Tab` / `Shift+Tab` | Percorre na ordem visual; foco sempre visível |
| Global | `⌘/Ctrl+K` | Busca global |
| Global | `?` | Lista de atalhos (descoberta sem documentação) |
| Global | `Esc` | Fecha sobreposição, devolve o foco à origem |
| Início da página | `Tab` | Primeiro item é "Pular para o conteúdo" (2.4.1) |
| Lista | `j` / `k` ou setas | Move a seleção |
| Lista | `Enter` | Abre o registro |
| Lista | `x` | Marca/desmarca para ação em lote |
| Formulário | `⌘/Ctrl+Enter` | Salva |
| Formulário | `n` | Novo registro (fora de campo de texto) |

**Regras invioláveis:** nenhuma funcionalidade exclusiva de mouse; nenhum atalho de caractere único
sem possibilidade de desativar (2.1.4); nenhuma armadilha de foco fora de modal (2.1.2); foco nunca
removido sem substituto de contraste equivalente.

---

## G.6 Gráficos e dashboards

Esta seção é resultado de medição, não de opinião. Ao buscar a paleta de séries, encontramos um
limite estrutural que muda a orientação de design.

### G.6.1 Por que razão de contraste é a métrica errada entre séries

Razão de contraste mede legibilidade **contra um fundo**. Entre duas marcas de dado, o problema é
outro: **colapso de matiz** sob daltonismo. Roxo é azul + vermelho; sob protanopia/deuteranopia o
componente vermelho desaparece e roxo cai praticamente sobre azul. Medimos exatamente isso ao tentar
derivar o tema escuro clareando todas as cores uniformemente: **ΔE de 1,5 entre azul e violeta** —
cores indistinguíveis, apesar de ambas terem ótimo contraste contra o fundo.

A métrica correta é distância perceptual (ΔE CIEDE2000) calculada **sobre a cor simulada** para
protanopia, deuteranopia e tritanopia. É o que o validador faz.

### G.6.2 O limite estrutural encontrado

Buscamos o conjunto de N cores que maximiza a menor distância entre todos os pares, sob visão normal
e sob os três tipos de dicromacia, restrito a cores com contraste ≥ 3:1 contra fundo e superfície
(busca por dispersão máxima sobre um espaço de ~14.000 cores candidatas em CIELAB):

| N séries | Melhor ΔE mínimo alcançável (tema claro) | Tema escuro |
| --- | --- | --- |
| 4 | 28,9 | 33,7 |
| 5 | 25,5 | 26,3 |
| 6 | 22,4 | 24,0 |
| 7 | 19,1 | 20,5 |

Duas conclusões operacionais:

1. **Sob dicromacia sobram apenas o eixo azul↔amarelo e a luminosidade.** Por isso a paleta forma
   deliberadamente uma **escada de luminosidade** — e por isso o tema escuro não pode ser o claro
   com tudo clareado: isso destrói a escada e colapsa as séries.
2. **O ótimo matemático é visualmente estridente.** A busca irrestrita devolve cores como `#6f79f8`
   e `#91847f`, perceptualmente perfeitas e inaceitáveis num produto corporativo. A paleta adotada
   foi obtida com a busca **ancorada na cor primária da marca** e restrita a uma faixa de croma
   profissional, aceitando ΔE menor que o ótimo em troca de coerência visual.

### G.6.3 Paleta adotada e limite de 5 séries

| | Tema claro | Tema escuro |
| --- | --- | --- |
| serie-1 | `#0b4fa8` | `#7fb2ff` |
| serie-2 | `#ca7805` | `#915952` |
| serie-3 | `#6d4025` | `#febbc0` |
| serie-4 | `#1a9c8f` | `#66638f` |
| serie-5 | `#9475f9` | `#9ba904` |
| **ΔE mínimo, visão normal** | **25,3** | **24,6** |
| **ΔE mínimo, sob dicromacia** | **21,1** | **24,2** |
| Piso exigido pelo CI | 18 / 15 | 18 / 15 |

**Decisão de produto:** o máximo de categorias codificáveis por cor é **5**
(`MAX_SERIES_POR_COR` em `@iarx/tokens`). Acima disso, a orientação é agrupar o excedente em
"outros", usar *small multiples* ou rotular diretamente as séries — **nunca adicionar uma sexta
cor**. É uma restrição que melhora o gráfico, não apenas a acessibilidade: seis séries num gráfico
de linha já são ilegíveis para qualquer pessoa.

### G.6.4 Redundância obrigatória (WCAG 1.4.1)

Cor nunca é suficiente por si só, mesmo com ΔE alto. Todo gráfico exige um segundo canal:

| Tipo | Segundo canal obrigatório |
| --- | --- |
| Linha | Padrão de traço distinto por série + rótulo direto no fim da linha |
| Barra empilhada | Rótulo direto ou textura; ordem estável entre gráficos |
| Dispersão | Forma do marcador distinta (círculo, quadrado, triângulo, losango, cruz) |
| Pizza/rosca | Rótulo com percentual sobre cada fatia (ou substituir por barra — preferível) |
| Mapa de calor | Escala com valor numérico visível; nunca só gradiente |
| Semáforo de estado | Ícone + texto além da cor |

Requisitos adicionais de todo gráfico: alternativa tabular acessível por um controle visível;
`<figure>` com `<figcaption>` descrevendo a conclusão (não só o título); `role="img"` com
`aria-label` resumindo tendência e ordem de grandeza; nenhuma informação exclusiva em *tooltip*
de *hover*.

---

## G.7 Documentos gerados

Fatura, romaneio, contrato e ordem de serviço saem da plataforma como PDF e frequentemente são o
único artefato que o cliente lê. Precisam ser acessíveis.

| Requisito | Definição |
| --- | --- |
| Marcação estrutural | PDF marcado (PDF/UA-1): hierarquia de títulos, ordem de leitura, tabelas com cabeçalho |
| Idioma | Declarado no documento (`pt-BR`) |
| Texto real | Nunca imagem de texto; valores selecionáveis e extraíveis |
| Contraste | Mesmos mínimos da interface, inclusive em impressão monocromática |
| Tabelas de fatura | Cabeçalho repetido em cada página, com escopo declarado |
| Metadados | Título, autor e assunto preenchidos |
| Alternativa | Toda fatura disponível também como HTML acessível e como CSV |

**Cuidado específico:** a memória de cálculo (Anexo E.6) é o conteúdo mais importante da fatura para
o cliente contestar um valor. Ela precisa ser navegável por leitor de tela — não uma imagem nem um
bloco de texto pré-formatado.

---

## G.8 Verificação automatizada e gate de CI

| Camada | Ferramenta | Quando | Bloqueia merge |
| --- | --- | --- | --- |
| Tokens de cor | `validate-contrast.mjs` (próprio) | Todo push/PR | **Sim** — já ativo |
| CSS sincronizado com a paleta | `build-css.mjs` + `git diff` | Todo push/PR | **Sim** — já ativo |
| DOM dos componentes | `axe-core` via Playwright | Todo PR, a partir da Fase 0 | Sim, para violação `critical`/`serious` |
| Navegação por teclado | Cenários Playwright sem mouse | Todo PR | Sim, nas jornadas críticas |
| Reflow e zoom | Playwright em 320 px e 200% | Todo PR | Sim |
| Contraste em runtime | `axe` sobre a página renderizada | Todo PR | Sim — pega cor literal fora do token |
| Lint de acessibilidade | `eslint-plugin-jsx-a11y` | Todo push | Sim |
| PDF | `veraPDF` (conformidade PDF/UA) | A partir da Fase 2 | Sim |

**Política deliberada:** o gate automatizado cobre cerca de um terço dos problemas reais. Nenhum
verificador detecta rótulo enganoso, ordem de foco ilógica ou fluxo confuso. Por isso o CI é
condição necessária, nunca suficiente — e por isso G.9 existe.

Estrutura do relatório de conformidade (artefato de CI, `--json`):

```jsonc
{
  "norma": "WCAG 2.2 AA",
  "versao_tokens": "1.0.0",
  "total": 188, "aprovados": 188, "falhas": 0,
  "resultados": [
    { "tema": "light", "tipo": "contraste", "rotulo": "text-secondary / surface",
      "valor": 6.23, "unidade": ":1", "min": 4.5, "passou": true,
      "criterio": "WCAG 1.4.3 texto normal" },
    { "tema": "light", "tipo": "serie", "rotulo": "serie-1 vs serie-5 (protanopia)",
      "valor": 21.1, "unidade": " ΔE", "min": 15, "passou": true,
      "criterio": "interno: distinção sob protanopia" }
  ]
}
```

---

## G.9 Verificação com pessoas

| Atividade | Quando | Quem | Saída |
| --- | --- | --- | --- |
| Percurso por teclado das jornadas críticas | A cada ciclo | Equipe de desenvolvimento | Lista de defeitos de foco e ordem |
| Percurso com leitor de tela (NVDA + Windows, VoiceOver + macOS/iOS, TalkBack + Android) | A cada release de módulo | QA treinado | Defeitos de rótulo e anúncio |
| Teste com usuário real de tecnologia assistiva | Uma vez por fase | Usuário externo remunerado | Relatório priorizado |
| Teste de campo em condições reais | Fases 1 e 2 | Técnicos e operadores de pátio | Ajustes de contraste, alvo e fluxo |
| Auditoria externa de conformidade | Antes da comercialização (Fase 4) | Consultoria especializada | Relatório e plano de correção |

**Jornadas obrigatórias em cada percurso:** localizar ativo por patrimônio · criar contrato com
equipamento · registrar entrega com checklist · abrir e concluir OS no PWA · conferir e aprovar
pré-fatura · ler painel executivo.

---

## G.10 Conformidade legal e declaração

| Norma | Aplicabilidade | Situação |
| --- | --- | --- |
| **WCAG 2.2 AA** | Meta técnica da plataforma | Camada de cor verificada; resto especificado |
| **eMAG 3.1** | Exigível se houver cliente do setor público brasileiro | Compatível com as decisões deste anexo; auditoria específica na Fase 4 |
| **LBI — Lei 13.146/2015** | Acessibilidade como direito; relevante em licitação | Endereçado por WCAG AA + declaração |
| **LGPD** | Dado de acessibilidade do usuário é dado pessoal sensível | Preferências armazenadas sem inferência sobre condição de saúde |

**Declaração de acessibilidade** (a publicar na Fase 3, exigida em compras corporativas): nível de
conformidade alcançado, método de avaliação, data e versão, limitações conhecidas com prazo de
correção, canal de contato com prazo de resposta, e ferramentas de apoio testadas.

**Compromisso de honestidade:** a declaração informará conformidade **parcial** enquanto houver
qualquer item pendente. Declarar AA total sem auditoria externa concluída seria falso.

---

## G.11 Alterações nos documentos existentes

| Documento | Alteração |
| --- | --- |
| 9.2.2 Cor semântica | Substituída por tokens verificados (G.3); nomes passam a referenciar `@iarx/tokens` |
| 9.7 Acessibilidade | Passa a apontar para este anexo como fonte normativa |
| 9.6 Dashboards | Limite de 5 séries por cor e redundância obrigatória (G.6) |
| 13.3 Qualidade e testes | Acrescenta as camadas de verificação de G.8 |
| 13.5 Definição de pronto | Acrescenta os critérios por componente de G.4 |
| 14 Roadmap | Verificação de DOM na Fase 0; teste assistivo na Fase 1; PDF/UA na Fase 2; auditoria externa na Fase 4 |
