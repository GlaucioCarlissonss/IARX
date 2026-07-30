# 9. Estrutura de UX/UI

## 9.1 Princípios de design

| Princípio | Regra prática verificável |
| --- | --- |
| **Uma tela, uma decisão** | Cada tela responde a uma pergunta principal; o restante é secundário e visualmente subordinado |
| **Exceção antes do volume** | Listas e painéis abrem ordenados pelo que exige ação, não por data de cadastro |
| **Economia de interação** | Tarefas frequentes em ≤ 3 interações (desktop) e ≤ 6 toques (campo) |
| **Estado sempre explícito** | Todo registro exibe estado, e todo estado bloqueante exibe o motivo e a ação de saída |
| **Progressão de detalhe** | Resumo → detalhe → registro-fonte, em no máximo dois níveis de *drill-down* |
| **Nunca um beco sem saída** | Erro, vazio e bloqueio sempre oferecem próxima ação concreta |
| **Densidade calibrada** | Backoffice denso e tabular; campo espaçado e tátil — não é o mesmo layout redimensionado |
| **Confiança pelo rastro** | Todo número relevante permite ver de onde veio |

## 9.2 Sistema visual

### 9.2.1 Fundamentos

| Elemento | Definição |
| --- | --- |
| Grid | 12 colunas, *gutter* 24 px, largura máxima de conteúdo 1440 px com listas em largura total |
| Espaçamento | Escala 4/8/12/16/24/32/48 |
| Tipografia | Uma família sem serifa de alta legibilidade; escala 12/14/16/20/24/32; números em variante tabular em tabelas e valores |
| Raio e elevação | Raio 8 px; elevação mínima — hierarquia por espaço e contraste, não por sombra |
| Ícones | Conjunto único, traço 1,5 px, sempre acompanhados de rótulo em ações primárias |
| Modo escuro | Suportado desde o início (oficina, pátio noturno, plantão) |

### 9.2.2 Cor com significado semântico

A cor **nunca** é o único portador de informação (ver 9.7). Cada estado tem cor + rótulo + ícone.

Os valores concretos vivem em `packages/tokens/src/palette.json` e são verificados no CI
(Anexo G.3). Nenhum componente define cor literal.

| Semântica | Uso | Aplicação |
| --- | --- | --- |
| Neutro | Estrutura, texto, bordas | Base da interface |
| Primário | Ação principal e navegação ativa | Um único botão primário por tela |
| Disponível / Positivo | Ativo livre, OS no prazo, fatura paga | Indicadores verdes |
| Em uso / Informativo | Ativo locado, OS em execução, fatura emitida | Indicadores azuis |
| Atenção | Preventiva próxima, contrato vencendo, estoque no ponto de pedido | Indicadores âmbar |
| Crítico | SLA estourado, preventiva vencida, fatura em atraso, ativo bloqueado | Indicadores vermelhos |
| Inativo | Baixado, cancelado, encerrado | Cinza com hachura sutil |

### 9.2.3 Dicionário visual de estados (consistente em todos os módulos)

| Domínio | Estados e representação |
| --- | --- |
| Equipamento | ● Disponível · ◐ Reservado · ▲ Em trânsito · ■ Locado · ✚ Em manutenção · ⛔ Bloqueado · ✕ Baixado |
| Contrato | Rascunho · Em aprovação · Aguardando assinatura · **Ativo** · Suspenso · Em renovação · Vencido em campo · Encerrado |
| OS | Aberta · Triagem · Agendada · Em execução · Aguardando peça · Concluída · Validada |
| Fatura | Prevista · Em fechamento · Emitida · Paga · Parcial · **Em atraso** · Cancelada |
| Estoque | Normal · No ponto de pedido · Abaixo do mínimo · Zerado · Excesso/obsoleto |

## 9.3 Padrões de componente

| Componente | Regras |
| --- | --- |
| **Tabela operacional** | Colunas configuráveis e persistidas por usuário; ordenação múltipla; virtualização; seleção múltipla com ações em lote; densidade compacta/confortável; primeira coluna sempre identifica o registro (patrimônio/número) |
| **Filtros** | Barra de filtros com *chips* removíveis, filtros salvos nomeados e URL compartilhável (estado do filtro na rota) |
| **Painel lateral (drawer)** | Detalhe e edição rápida sem perder o contexto da lista; usado no lugar de navegação para tarefas curtas |
| **Formulário** | Uma coluna, agrupamento por blocos, rótulo acima do campo, validação no *blur*, salvamento automático de rascunho, erro sempre próximo ao campo |
| **Busca global** | `⌘/Ctrl+K`; busca patrimônio, série, cliente, contrato, OS, peça, fatura; resultados com estado e ação direta |
| **Timeline** | Linha do tempo unificada por ativo/contrato/OS, com filtro por tipo de evento |
| **Cartão de indicador** | Valor, unidade, variação vs. período anterior, faixa-alvo e link para o detalhe |
| **Vazio, carregando, erro** | Três estados obrigatórios em toda lista: vazio com ação sugerida, *skeleton* no carregamento, erro com "tentar novamente" |
| **Confirmação** | Somente para ação destrutiva ou irreversível, com resumo do efeito; nunca confirmação genérica |
| **Notificação** | Toast para resultado imediato; central de alertas para o que exige acompanhamento |

## 9.4 Redução de cliques — decisões concretas

1. **Leitura de código como entrada primária** em campo: escanear resolve o ativo e abre a ação
   contextual, eliminando busca e digitação.
2. **Ações em lote** em todas as listas relevantes: aprovar pré-faturas, emitir faturas, imprimir
   etiquetas, atribuir OS, confirmar entregas.
3. **Edição em linha** para campos de baixo risco (observação, responsável, prioridade).
4. **Valores pré-preenchidos com origem visível:** preço de tabela, plano preventivo do modelo,
   condição de pagamento do cliente — sempre editáveis, com indicação de que vieram do padrão.
5. **Atalhos de teclado no backoffice:** `n` novo, `/` buscar, `e` editar, `j/k` navegar,
   `⌘Enter` salvar, `?` lista de atalhos.
6. **URL como estado:** filtro, aba e seleção refletidos na rota — permite compartilhar visão exata
   em vez de descrever o caminho.
7. **Continuar de onde parou:** rascunhos e a última visão utilizada restaurados no retorno.

## 9.5 Experiência de campo (PWA)

| Requisito | Implementação |
| --- | --- |
| Offline real | Fila local de comandos, dados do dia pré-carregados, sincronização automática (7.4.1) |
| Alvos de toque | Mínimo 44×44 px; ações primárias na zona inferior alcançável com o polegar |
| Contraste solar | Modo alto contraste; contraste mínimo 4,5:1; evitar cinza claro sobre branco |
| Entrada mínima | Seleção por lista/chips, valores sugeridos, ditado para texto livre, nenhuma digitação obrigatória |
| Câmera | Leitura de QR contínua, foto com compressão local e envio diferido |
| Assinatura | Captura em tela com nome e documento do recebedor |
| Feedback de sincronização | Indicador permanente: `N ações pendentes` / `sincronizado às HH:MM` |
| Consumo | Payload reduzido, imagens comprimidas, operação viável em 3G |

## 9.6 Dashboards

### 9.6.1 Dashboard operacional (P1, P3, P4, P6) — "o que exige ação hoje"

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Filial ▾]  [Hoje ▾]                                    🔔 12   ⌘K   Perfil │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⛔ 3 ativos bloqueados  │ ⚠ 7 OS em risco de SLA │ ⚠ 5 contratos vencem em 15d │
│ ⚠ 4 pendências medição  │ ⚠ 9 peças abaixo mínimo│ ⚠ 6 ativos parados >30d     │
├───────────────────────────────────┬──────────────────────────────────────────┤
│ ENTREGAS E RETORNOS DE HOJE       │ FILA DE MANUTENÇÃO (por risco de SLA)     │
│ ▸ 08:30 Obra Norte — 2 ativos     │ ▸ OS-1042 · 1h12 restante · Téc. A. Silva │
│ ▸ 10:00 Retorno CD Sul — 1 ativo  │ ▸ OS-1039 · 3h40 restante · não atribuída │
├───────────────────────────────────┼──────────────────────────────────────────┤
│ OCUPAÇÃO DA FROTA          78%    │ MAPA (mini) — ativos críticos destacados   │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░            │ [abrir mapa completo]                     │
└───────────────────────────────────┴──────────────────────────────────────────┘
```

- **Primeira dobra é exclusivamente exceção.** Cada cartão é clicável e leva à lista já filtrada.
- Nenhum gráfico decorativo; volume histórico fica nos relatórios.
- Escopo respeita a filial/região do usuário automaticamente.

### 9.6.2 Dashboard executivo (P7) — "para onde estamos indo"

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Consolidado ▾]  [Últimos 12 meses ▾]                        Exportar ▾      │
├─────────────┬─────────────┬─────────────┬─────────────┬──────────────────────┤
│ Receita mês │ MRR         │ Margem oper.│ Ocupação    │ Inadimplência        │
│ R$ 2,84 M   │ R$ 2,41 M   │ 31,4%       │ 78,2%       │ 4,1%                 │
│ ▲ 6,2%      │ ▲ 3,1%      │ ▼ 1,2 p.p.  │ ▲ 2,4 p.p.  │ ▲ 0,6 p.p.           │
├─────────────┴─────────────┴─────────────┴─────────────┴──────────────────────┤
│ RECEITA vs. CUSTO (12 meses)              │ MARGEM POR FILIAL                 │
│ [linha dupla + área de margem]            │ [barras ordenadas]                │
├───────────────────────────────────────────┼──────────────────────────────────┤
│ TOP 10 CLIENTES POR RENTABILIDADE         │ ATIVOS DEFICITÁRIOS (ação)        │
└───────────────────────────────────────────┴──────────────────────────────────┘
```

- Máximo de **8 indicadores** na primeira dobra, sempre com tendência e comparação de período.
- *Drill-down* de dois níveis: indicador → composição → registro-fonte.
- Toda tela declara "atualizado às HH:MM" (`RN-030`).

## 9.7 Acessibilidade (meta: WCAG 2.2 AA)

> **Fonte normativa:** [Anexo G — Acessibilidade](anexos/G-acessibilidade.md). Os critérios por
> componente, a paleta com contraste **medido** (188/188 verificações aprovadas), o limite de 5
> séries por cor em gráficos e o gate de CI que bloqueia regressão estão detalhados lá. A tabela
> abaixo é o resumo dos princípios.

| Requisito | Implementação |
| --- | --- |
| Contraste | ≥ 4,5:1 para texto, ≥ 3:1 para elementos gráficos e estados |
| Independência de cor | Estado sempre com rótulo textual e ícone além da cor |
| Teclado | Navegação completa sem mouse, foco visível, ordem lógica, atalho "pular para o conteúdo" |
| Leitores de tela | HTML semântico, ARIA apenas quando necessário, tabelas com cabeçalhos associados, `aria-live` para atualizações assíncronas |
| Formulários | Rótulo programático, erro associado ao campo, instrução persistente (não apenas *placeholder*) |
| Movimento | Respeito a `prefers-reduced-motion`; nenhuma animação essencial à compreensão |
| Zoom e reflow | Uso pleno em 200% de zoom e em 320 px de largura sem rolagem horizontal |
| Tempo | Nenhuma ação crítica com tempo limite não prorrogável |
| Rótulos | Terminologia do domínio (patrimônio, romaneio, horímetro), nunca jargão técnico de sistema |

## 9.8 Responsividade

| Faixa | Comportamento |
| --- | --- |
| ≥ 1280 px | Layout completo: navegação lateral fixa, tabela densa, painel de detalhe lado a lado |
| 1024–1279 px | Navegação lateral colapsável, tabela com colunas prioritárias, detalhe em *drawer* |
| 768–1023 px | Navegação superior, tabela reduzida às 4 colunas essenciais, ações em menu contextual |
| < 768 px | Cartões em vez de tabela, ação primária fixa no rodapé, formulários em etapa única por bloco |

**Regra de prioridade de conteúdo:** em telas menores, preserva-se identificação do registro,
estado, valor crítico e ação principal — nessa ordem.

## 9.9 Microcopy e mensagens

| Situação | Padrão |
| --- | --- |
| Bloqueio de regra | O que impede + por que + como resolver: "Não é possível alocar: preventiva vencida há 12 dias. Programe a preventiva ou solicite liberação ao gestor." |
| Confirmação destrutiva | Consequência concreta: "Cancelar o contrato SP-2026-0148 encerrará 4 alocações e interromperá a cobrança em 30/09." |
| Estado vazio | Convite à ação: "Nenhuma OS na sua fila. Ver OS da filial." |
| Sucesso | Resultado + próximo passo: "Contrato ativado. Programar entrega?" |
| Erro técnico | Sem jargão, com código de suporte: "Não conseguimos salvar agora. Tente novamente — código IARX-7F3A." |
| Números | Padrão pt-BR, moeda explícita, unidade sempre visível (h, ciclos, km, dias) |

## 9.10 Critérios de aceite de usabilidade

Cada entrega é validada contra metas mensuráveis, aferidas com usuários reais das personas:

| Tarefa | Meta | Persona |
| --- | --- | --- |
| Criar contrato com 3 equipamentos | ≤ 3 min, ≤ 12 interações | P1 |
| Localizar ativo por patrimônio | ≤ 10 s, ≤ 2 interações | P1/P6 |
| Registrar entrega de 5 ativos com checklist | ≤ 4 min | P4 |
| Fechar OS simples em campo (offline) | ≤ 90 s, ≤ 6 toques | P2 |
| Conferir e aprovar 50 pré-faturas | ≤ 15 min | P5 |
| Identificar ativos parados > 30 dias | ≤ 15 s, 1 interação | P6 |
| Responder "qual cliente dá menos margem?" | ≤ 30 s, ≤ 3 interações | P7 |
| Tempo de treinamento de novo operador | ≤ 2 h para autonomia nas tarefas do dia | P1/P4 |
