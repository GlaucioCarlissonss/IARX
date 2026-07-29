# 10. Indicadores e Métricas

## 10.1 Governança de indicadores

| Diretriz | Definição |
| --- | --- |
| Fonte única | Todo indicador é calculado a partir do log transacional; não existe planilha ou ETL paralelo |
| Definição explícita | Cada KPI possui fórmula, granularidade, dimensões de corte, periodicidade e responsável |
| Rastreabilidade | Todo indicador permite *drill-down* até o registro de origem em no máximo dois níveis |
| Corte temporal | Regime de competência para receita/custo; regime de caixa apenas em fluxo de caixa (indicado na tela) |
| Frescor declarado | Toda tela informa a hora de atualização; indicadores em tempo real são identificados como tal |
| Comparabilidade | Todo indicador exibe período anterior e, quando aplicável, meta/faixa-alvo |

**Dimensões de corte padrão (aplicáveis a quase todos os KPIs):** período · empresa · filial ·
região · cliente · contrato · categoria de equipamento · modelo · equipamento · técnico ·
centro de custo.

---

## 10.2 Indicadores financeiros

### `KPI-01` — Receita mensal
- **Fórmula:** `Σ valor_liquido_faturado(competência)` — bruto − descontos, sem impostos retidos.
- **Granularidade:** mensal · **Cortes:** filial, cliente, categoria, natureza de receita.
- **Fonte:** `FAT.fatura_item` · **Alvo:** crescimento vs. mesmo mês do ano anterior.
- **Cuidado de leitura:** separar receita recorrente de eventual (venda de ativo, recobrança) para
  não distorcer a tendência.

### `KPI-02` — Receita recorrente (MRR)
- **Fórmula:** `Σ valor_mensal_normalizado(itens de contrato ativos no fim do período)`.
- **Decomposição obrigatória:** `MRR_final = MRR_inicial + novos + expansão (reajuste/upsell) − contração − churn`.
- **Granularidade:** mensal · **Cortes:** cliente, filial, categoria.
- **Por que importa:** é o indicador de previsibilidade do negócio; sustenta a projeção de caixa.

### `KPI-03` — Ticket médio
- **Fórmulas complementares:**
  - por contrato: `receita_recorrente_periodo ÷ contratos_ativos`
  - por equipamento locado: `receita_periodo ÷ equipamentos_locados_médios`
  - por cliente: `receita_periodo ÷ clientes_ativos`
- **Uso:** avaliar política de preço e mix de categorias.

### `KPI-09` — Custo de manutenção
- **Fórmula:** `mão de obra + material (peças) + serviços de terceiros + deslocamento`, consolidado
  por OS, ativo, categoria e período.
- **Granularidade:** mensal e acumulada por ativo · **Cortes:** tipo de OS (corretiva/preventiva),
  modelo, fabricante, filial, técnico.
- **Fonte:** `MNT.ordem_servico` + `EST.movimento_estoque` · **Integridade:** depende do apontamento
  completo da OS (`RN-015`); `KPI-39` monitora essa integridade.
- **Derivado principal:** `KPI-22` (custo por hora locada), que permite comparação justa entre
  ativos de intensidades de uso diferentes.

### `KPI-10` — Custo operacional
- **Fórmula:** `manutenção + peças + logística + depreciação + custos indiretos rateados`.
- **Cortes:** filial, categoria, ativo, natureza · **Granularidade:** mensal.
- **Regra:** todo custo é alocado a ativo, contrato, categoria ou centro de custo (`RN-025`).

### `KPI-04` — Margem operacional
- **Fórmula:** `(receita_liquida − custo_operacional_total) ÷ receita_liquida`.
- **Cortes:** consolidado, filial, categoria, cliente, ativo.
- **Alerta:** margem por corte abaixo do piso definido pelo tenant.

### `KPI-11` — Índice de inadimplência
- **Fórmulas:**
  - por carteira: `saldo_vencido_acima_de_N_dias ÷ saldo_total_a_receber`
  - por faturamento: `valor_vencido_no_periodo ÷ valor_faturado_no_periodo`
- **Aging padrão:** 1–15 · 16–30 · 31–60 · 61–90 · > 90 dias.
- **Cortes:** cliente, filial, faixa de atraso · **Atualização:** diária (`RN-024`).

### `KPI-13` — Rentabilidade por cliente
- **Fórmula:** `receita_cliente − (custo_manutenção + peças + logística + depreciação dos ativos alocados ao cliente) − custo_de_atendimento`.
- **Uso:** renegociação, revisão de preço, decisão de manter ou encerrar carteira.
- **Complemento:** margem acumulada desde o início do relacionamento (visão de ciclo de vida).

### `KPI-14` — Rentabilidade por equipamento
- **Fórmula:** `receita_alocada_ativo − custo_manutenção_ativo − peças_ativo − logística_ativo − depreciação_ativo`.
- **Granularidade:** mensal e acumulada desde a aquisição.
- **Derivados:** `receita por hora locada`, `custo de manutenção por hora locada`,
  `custo de manutenção acumulado ÷ valor de aquisição`.
- **Ação disparada:** ativo com margem negativa por 3 competências consecutivas entra na lista de
  desmobilização (`F-EQP-26`).

### `KPI-15` — ROI operacional do ativo
- **Fórmula:** `margem_operacional_acumulada ÷ investimento_total(aquisição + benfeitorias)`.
- **Complemento:** *payback* em meses (tempo até margem acumulada igualar o investimento).
- **Uso:** decisão de compra de novos ativos e escolha de modelo/fabricante.

---

## 10.3 Indicadores operacionais de frota

### `KPI-06` — Equipamentos ativos
- **Fórmula:** `total_da_frota − baixados`, aberto por estado atual.
- **Atualização:** tempo real.

### `KPI-05` — Taxa de ocupação
- **Fórmula (por tempo):**
  `Σ dias_em_locação(ativos) ÷ Σ dias_disponíveis_para_locação(ativos)`, onde
  `dias_disponíveis = dias_calendário − dias_baixado − dias_em_manutenção_programada`.
- **Variante financeira (taxa de utilização de receita):**
  `receita_realizada ÷ receita_potencial_máxima_da_frota`, que revela desconto e ociosidade juntos.
- **Cortes:** filial, categoria, modelo · **Alvo típico:** 75–85% conforme segmento.
- **Nota metodológica:** ambas as variantes devem estar disponíveis; usar apenas a primeira esconde
  perda por preço, e apenas a segunda esconde perda por ociosidade física.

### `KPI-07` — Equipamentos parados (ociosos)
- **Fórmula:** `contagem(ativos DISPONÍVEL há ≥ N dias)`, N parametrizável (padrão 15).
- **Complemento:** `custo de oportunidade = Σ dias_ociosos × valor_diária_de_tabela`.
- **Cortes:** filial, categoria, faixa de dias parados.

### `KPI-08` — Equipamentos em manutenção
- **Fórmula:** `contagem(ativos EM_MANUTENÇÃO)` e `% da frota`.
- **Aberturas:** corretiva vs. preventiva; em oficina vs. em campo; aguardando peça.
- **Alerta:** percentual acima do limite do tenant (padrão 8% da frota).

### `KPI-16` — Disponibilidade operacional
- **Fórmula:** `tempo_disponível ÷ (tempo_disponível + tempo_indisponível_não_programado)`.
- **Granularidade:** mensal, por ativo, modelo e categoria.
- **Uso:** cumprimento de compromisso contratual de disponibilidade e escolha de fabricante.

### `KPI-19` — Índice de utilização efetiva *(complementar)*
- **Fórmula:** `horas/ciclos medidos ÷ horas/ciclos disponíveis contratados`.
- **Uso:** identificar ativo locado mas subutilizado — oportunidade de renegociar franquia ou
  realocar o ativo para cliente com maior demanda.

---

## 10.4 Indicadores de manutenção e serviço

### `KPI-12` — Tempo médio de reparo (MTTR)
- **Fórmula:** `Σ (data_conclusão − data_abertura − pausas_justificadas) ÷ nº de OS concluídas`.
- **Cortes:** tipo de OS, categoria, modelo, técnico, filial.
- **Aberturas:** tempo de resposta (abertura → início) e tempo de execução (início → conclusão) —
  separá-los revela se o problema é de despacho ou de execução.

### `KPI-17` — SLA de atendimento
- **Fórmulas:** `% OS com resposta dentro do prazo` e `% OS com solução dentro do prazo`.
- **Regras de cálculo:** calendário útil configurado, pausas justificadas descontadas (`RN-011`).
- **Cortes:** cliente, prioridade, tipo, técnico, filial · **Alvo típico:** ≥ 95%.

### `KPI-18` — Tempo parado (downtime)
- **Fórmula:** `Σ horas_indisponível` por ativo e por causa (falha, aguardando peça, aguardando
  aprovação, aguardando acesso ao local, logística).
- **Uso:** a abertura por causa direciona a ação — estoque, alçada, logística ou equipe técnica.

### `KPI-20` — MTBF (tempo médio entre falhas) *(complementar)*
- **Fórmula:** `horas_em_operação ÷ nº de falhas corretivas` no período.
- **Cortes:** modelo, fabricante, componente · **Uso:** decisão de compra e revisão de plano preventivo.

### `KPI-21` — Aderência à preventiva *(complementar)*
- **Fórmula:** `preventivas_executadas_no_prazo ÷ preventivas_programadas`.
- **Alvo:** ≥ 95%. Correlaciona-se diretamente com redução de corretivas e de `KPI-18`.

### `KPI-22` — Custo de manutenção por hora locada *(complementar)*
- **Fórmula:** `custo_manutenção_ativo ÷ horas_locadas_ativo`.
- **Uso:** comparação justa entre ativos de intensidades de uso diferentes.

---

## 10.5 Indicadores de estoque e suprimentos

| ID | Indicador | Fórmula | Uso |
| --- | --- | --- | --- |
| `KPI-23` | Itens abaixo do mínimo | `contagem(peças com saldo < mínimo)` | Risco imediato de OS travada |
| `KPI-24` | Giro de estoque | `custo_consumido_periodo ÷ saldo_médio_valorado` | Eficiência do capital em peças |
| `KPI-25` | Cobertura de estoque | `saldo_atual ÷ consumo_médio_diário` (em dias) | Dimensionar reposição vs. prazo do fornecedor |
| `KPI-26` | Ruptura de peça | `nº OS que entraram em AGUARDANDO_PEÇA ÷ total de OS` | Impacto real da falta no atendimento |
| `KPI-27` | Acuracidade de inventário | `itens_sem_divergência ÷ itens_contados` | Confiabilidade do saldo (alvo ≥ 98%) |
| `KPI-28` | Estoque obsoleto | `valor de peças sem consumo há > 12 meses ÷ valor total` | Capital imobilizado sem retorno |

---

## 10.6 Indicadores comerciais e contratuais

| ID | Indicador | Fórmula | Uso |
| --- | --- | --- | --- |
| `KPI-29` | Contratos ativos | `contagem(contratos em ATIVO)` | Base instalada |
| `KPI-30` | Taxa de renovação | `contratos_renovados ÷ contratos_com_vencimento_no_periodo` | Saúde da carteira |
| `KPI-31` | Churn de receita | `MRR_perdido ÷ MRR_inicial` | Perda recorrente real |
| `KPI-32` | Prazo médio de contrato | `média(duração dos contratos ativos)` | Previsibilidade |
| `KPI-33` | Desconto médio concedido | `Σ descontos ÷ Σ valor de tabela` | Disciplina comercial (`RN-009`) |
| `KPI-34` | Receita renunciada por reajuste não aplicado | `Σ (reajuste devido − aplicado)` | Perda silenciosa recuperável (`RN-008`) |
| `KPI-35` | Tempo de ciclo da locação | `média(data_entrega − data_criação_contrato)` | Agilidade comercial e logística |

---

## 10.7 Indicadores de processo (saúde do uso da plataforma)

| ID | Indicador | Fórmula | Por que existe |
| --- | --- | --- | --- |
| `KPI-36` | Pendências de medição no fechamento | `itens sem leitura ÷ itens que exigem leitura` | Mede a disciplina de campo; alvo 0% |
| `KPI-37` | Prazo de fechamento | `data_conclusão_fechamento − data_referência` | Meta ≤ 1 dia útil (OE-03) |
| `KPI-38` | Movimentações registradas em atraso | `movimentações com registro > 24 h após o fato ÷ total` | Detecta erosão da confiabilidade do estado |
| `KPI-39` | OS concluídas sem apontamento completo | deve ser 0 por construção (`RN-015`) | Monitor de integridade de custo |
| `KPI-40` | Divergência entre estado do sistema e auditoria física | `ativos divergentes ÷ ativos auditados` | Confiança operacional (alvo ≤ 2%) |

---

## 10.8 Distribuição por painel

| Painel | Indicadores | Frequência |
| --- | --- | --- |
| Operacional (filial) | `KPI-05` `KPI-07` `KPI-08` `KPI-17` `KPI-23` `KPI-36` + exceções do dia | Tempo real |
| Manutenção | `KPI-09` `KPI-12` `KPI-17` `KPI-18` `KPI-20` `KPI-21` `KPI-22` `KPI-26` | Tempo real / diária |
| Estoque | `KPI-23` `KPI-24` `KPI-25` `KPI-27` `KPI-28` | Diária |
| Faturamento | `KPI-01` `KPI-36` `KPI-37` `KPI-33` | Ciclo de faturamento |
| Financeiro | `KPI-01` `KPI-02` `KPI-04` `KPI-10` `KPI-11` `KPI-13` | Diária / mensal |
| Executivo | `KPI-01` `KPI-02` `KPI-04` `KPI-05` `KPI-11` `KPI-14` `KPI-15` `KPI-16` | Mensal com tendência 12 meses |

## 10.9 Alertas derivados de indicadores

| Condição | Severidade | Destinatário padrão |
| --- | --- | --- |
| Ocupação da filial abaixo da meta por 2 semanas | Atenção | Gestor de filial |
| Ativo com margem negativa em 3 competências | Atenção | Diretor operacional |
| SLA mensal abaixo de 95% | Crítico | Supervisor + gestor |
| Inadimplência acima do limite do tenant | Crítico | Financeiro + diretoria |
| Percentual da frota em manutenção acima do limite | Crítico | Supervisor de manutenção |
| Peça crítica com cobertura < prazo do fornecedor | Atenção | Responsável do depósito |
| Pendência de medição existente em D-1 do fechamento | Crítico | Financeiro + gestor da filial |
| Reajuste devido não aplicado após 30 dias | Atenção | Comercial + diretoria |
