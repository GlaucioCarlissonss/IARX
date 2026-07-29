# Anexo E — Motor de Faturamento

O motor de faturamento é o componente de maior risco funcional da plataforma: um erro aqui não gera
um bug, gera uma perda de receita ou uma quebra de confiança do cliente. Por isso é isolado,
determinístico, versionado e integralmente testado por matriz de cenários.

---

## E.1 Princípios do motor

| Princípio | Consequência |
| --- | --- |
| **Determinismo** | Mesmas entradas (contrato, leituras, movimentações, parâmetros) produzem sempre o mesmo resultado |
| **Derivação, não digitação** | Nenhum valor é digitado no fechamento; todo valor é calculado a partir de fatos registrados |
| **Rastreabilidade total** | Cada valor guarda a memória de cálculo com referência aos fatos de origem |
| **Precedência explícita** | A ordem de aplicação das regras é declarada e imutável (E.5) |
| **Reprocessabilidade** | Um ciclo pode ser recalculado enquanto a competência estiver aberta, sem efeito colateral |
| **Separação de responsabilidade** | O motor calcula; a emissão fiscal e a cobrança são etapas posteriores e independentes |

---

## E.2 Entradas do cálculo

| Entrada | Origem | Papel |
| --- | --- | --- |
| Contrato e itens vigentes | `CTR` | Preço, modalidade, franquia, mínimo, vigência, índice |
| Movimentações do período | `EQP` | Determinam o período efetivo de locação (base do pro-rata) |
| Leituras de medidor | `EQP` | Determinam o consumo do período |
| Reajustes aprovados | `CTR` | Aplicados a partir da competência de aniversário |
| Descontos vigentes | `CTR`/`FAT` | Percentual ou valor, com vigência própria |
| Suspensões | `CTR` | Excluem dias do período faturável |
| Downtime indenizável | `MNT` | Abatimento pro-rata conforme `RN-012` |
| Acessórios e serviços | `CTR` | Itens recorrentes ou pontuais |
| Recobranças | `EQP`/`MNT` | Avarias e mau uso aprovados |
| Parâmetros do tenant | `RUL` | Arredondamento, base de dias, tolerâncias |

---

## E.3 Modalidades de cobrança

### E.3.1 `FIXO_MENSAL`
Valor fixo por competência, independente de uso.
```
valor = valor_unitario × quantidade × fator_proporcional
```
**Uso típico:** locação de longo prazo com disponibilidade garantida.

### E.3.2 `POR_MEDICAO`
Cobrança integralmente variável pelo consumo.
```
consumo = leitura_final − leitura_inicial
valor   = consumo × valor_unitario
```
**Uso típico:** equipamentos de impressão (por cópia), geradores (por hora).

### E.3.3 `FRANQUIA_EXCEDENTE`
Valor fixo com quantidade inclusa e cobrança do que exceder.
```
franquia_efetiva = franquia_quantidade × fator_proporcional
excedente        = max(0, consumo − franquia_efetiva)
valor            = (valor_unitario × fator_proporcional) + (excedente × valor_excedente_unitario)
```
**Escopo da franquia:**
- `ITEM` — franquia individual por equipamento;
- `CONTRATO` (*pool*) — franquias somadas no contrato, excedente calculado sobre o total consumido.
  O *pool* favorece o cliente e reduz contestação; é a opção recomendada em contratos com muitos ativos.

### E.3.4 `DIARIA` / `HORA_EFETIVA`
```
valor = dias_efetivos × valor_diaria     (ou horas_medidas × valor_hora)
```
**Uso típico:** locação de curto prazo, eventos, obras pontuais.
`dias_efetivos` conta apenas dias em estado `LOCADO`, conforme política de contagem (E.4.3).

### E.3.5 `ESCALONADO_POR_VOLUME`
Faixas progressivas ou regressivas sobre o consumo.
```
Ex.: 0–1.000 → R$ 0,12/un · 1.001–5.000 → R$ 0,10/un · > 5.000 → R$ 0,08/un
valor = Σ (quantidade na faixa × preço da faixa)
```
**Variante:** preço único da faixa alcançada (menos comum, deve ser declarado no contrato).

### E.3.6 `MINIMO_MENSAL`
Modificador aplicável a qualquer modalidade variável.
```
valor = max(valor_calculado, valor_minimo_mensal × fator_proporcional)
```
Quando o mínimo é acionado, a memória de cálculo registra explicitamente
`"minimo_acionado": true` e o valor que teria sido cobrado — informação essencial para renegociação.

### E.3.7 `MISTO`
Composição de parcela fixa + parcela variável + acessórios no mesmo item, com cada componente
registrado separadamente na memória de cálculo.

### E.3.8 Itens acessórios
| Tipo | Comportamento |
| --- | --- |
| Recorrente (seguro, taxa de operação, gestão) | Faturado em cada competência, sujeito a pro-rata |
| Pontual (frete, montagem, treinamento) | Faturado uma única vez, na competência do evento |
| Recobrança (avaria, mau uso, limpeza) | Faturado na competência da aprovação, com referência à OS/checklist |

---

## E.4 Pro-rata — o cálculo mais sensível

### E.4.1 Fator proporcional
```
fator_proporcional = dias_faturaveis ÷ dias_base_do_ciclo
```

| Parâmetro do tenant | Opções | Padrão recomendado |
| --- | --- | --- |
| `base_dias` | `DIAS_REAIS_DO_MES` (28/29/30/31) · `MES_COMERCIAL_30` | `DIAS_REAIS_DO_MES` |
| `contagem_periodo` | `INCLUI_INICIO_EXCLUI_FIM` · `INCLUI_AMBOS` | `INCLUI_AMBOS` (dia de entrega e dia de devolução são cobrados) |
| `granularidade` | `DIA` · `HORA` | `DIA` para mensal, `HORA` para diária/curtíssimo prazo |
| `arredondamento` | 2 casas, meio para cima, aplicado ao valor unitário antes da multiplicação | fixo |

> A escolha de `MES_COMERCIAL_30` simplifica a conferência do cliente, mas gera divergência em
> fevereiro e nos meses de 31 dias. A recomendação é `DIAS_REAIS_DO_MES`, com o critério declarado
> em contrato e exibido na memória de cálculo.

### E.4.2 Eventos que alteram `dias_faturaveis`

| Evento | Efeito |
| --- | --- |
| Entrega no meio do ciclo | Conta da data de entrega até o fim do ciclo |
| Devolução no meio do ciclo | Conta do início do ciclo até a data de devolução |
| Entrega e devolução no mesmo ciclo | Conta apenas o intervalo efetivo |
| Suspensão de contrato | Exclui os dias suspensos |
| Substituição de equipamento | Divide o período: dias do ativo A + dias do ativo B, sem sobreposição e sem lacuna |
| Downtime indenizável (`RN-012`) | Exclui os dias parados além da tolerância contratada |
| Transferência entre locais do mesmo cliente | Sem efeito no valor; registra a mudança na memória |

### E.4.3 Exemplo — entrega no meio do ciclo
```
Contrato: FIXO_MENSAL R$ 3.000,00/mês · base DIAS_REAIS · contagem INCLUI_AMBOS
Competência: julho/2026 (31 dias) · Entrega: 12/07 · Fim do ciclo: 31/07

dias_faturaveis = 31 − 12 + 1 = 20
fator           = 20 ÷ 31 = 0,645161
valor           = 3.000,00 × 0,645161 = R$ 1.935,48
```

### E.4.4 Exemplo — franquia com excedente e pro-rata
```
Item: FRANQUIA_EXCEDENTE · R$ 2.400,00/mês · franquia 200 h · excedente R$ 9,50/h
Competência: agosto/2026 (31 dias) · Entrega 06/08 → dias_faturaveis = 26
Leitura inicial 4.120 h (06/08) · Leitura final 4.348 h (31/08)

fator            = 26 ÷ 31 = 0,838710
franquia_efetiva = 200 × 0,838710 = 167,74 h
consumo          = 4.348 − 4.120  = 228,00 h
excedente        = 228,00 − 167,74 = 60,26 h
parcela_fixa     = 2.400,00 × 0,838710 = R$ 2.012,90
parcela_excedente= 60,26 × 9,50        = R$   572,47
valor_bruto                              = R$ 2.585,37
```

### E.4.5 Exemplo — substituição de equipamento no ciclo
```
Item contratado: R$ 3.100,00/mês · Competência: setembro/2026 (30 dias)
Ativo A (patrimônio 10422): 01/09 a 14/09 → 14 dias
Ativo B (patrimônio 10870): 15/09 a 30/09 → 16 dias

valor_A = 3.100,00 × (14 ÷ 30) = R$ 1.446,67
valor_B = 3.100,00 × (16 ÷ 30) = R$ 1.653,33
total                            = R$ 3.100,00   ← soma exata, sem dupla cobrança nem lacuna
```
A conferência de que a soma dos períodos de substituição equivale ao ciclo integral (quando não há
interrupção de serviço) é um **teste obrigatório** do motor.

---

## E.5 Ordem de precedência das regras

A ordem é fixa e não configurável — alterá-la mudaria valores retroativamente.

```
1.  Determinar período faturável do item (vigência ∩ ciclo − suspensões − downtime indenizável)
2.  Calcular fator proporcional
3.  Obter consumo do período (leitura final − leitura inicial), se a modalidade exigir
4.  Aplicar reajuste vigente na competência ao valor unitário
5.  Calcular parcela fixa (valor unitário reajustado × quantidade × fator)
6.  Calcular franquia efetiva e excedente (ou faixas escalonadas)
7.  Somar itens acessórios recorrentes proporcionalizados
8.  Somar itens pontuais e recobranças da competência
9.  Aplicar mínimo mensal (comparação após 5–8)
10. Aplicar descontos vigentes (item → contrato → fatura)
11. Arredondar para 2 casas por item
12. Consolidar totais da fatura e gerar memória de cálculo
```

**Pontos de atenção deliberados:**
- O **mínimo mensal é avaliado antes do desconto** (etapa 9 antes da 10): descontar sobre o mínimo é
  o comportamento comercialmente esperado, pois o desconto é uma concessão sobre o valor devido.
- O **reajuste incide sobre o valor unitário**, nunca sobre o total já proporcionalizado — evita
  distorção em competências parciais.
- O **arredondamento ocorre por item**, não no total, para que a soma exibida ao cliente feche
  exatamente com as linhas da fatura.

---

## E.6 Memória de cálculo

Estrutura persistida em `fatura_item.memoria_calculo` — é o que sustenta a defesa de qualquer valor
em contestação.

```jsonc
{
  "versao_motor": "1.4.0",
  "modalidade": "FRANQUIA_EXCEDENTE",
  "periodo": {
    "ciclo_inicio": "2026-08-01", "ciclo_fim": "2026-08-31",
    "dias_base": 31, "dias_faturaveis": 26,
    "fator_proporcional": "0.838710",
    "eventos": [
      { "tipo": "ENTREGA", "data": "2026-08-06T09:14:00-03:00",
        "movimentacao_id": "018f61…", "documento": "ROM-2026-00918" }
    ],
    "exclusoes": []
  },
  "consumo": {
    "medidor_id": "018f32…", "unidade": "h",
    "leitura_inicial": { "id": "018f62…", "valor": "4120.00", "data": "2026-08-06", "origem": "CAMPO" },
    "leitura_final":   { "id": "018f6a…", "valor": "4348.00", "data": "2026-08-31", "origem": "TELEMETRIA" },
    "consumo": "228.00"
  },
  "precificacao": {
    "valor_unitario_contratado": "2400.0000",
    "reajuste": { "id": "018f45…", "indice": "IPCA", "percentual": "0.0000", "aplicado": false },
    "valor_unitario_efetivo": "2400.0000",
    "parcela_fixa": "2012.9040",
    "franquia_contratada": "200.00",
    "franquia_efetiva": "167.74",
    "excedente_quantidade": "60.26",
    "excedente_unitario": "9.5000",
    "parcela_excedente": "572.4700",
    "minimo_mensal": "2400.0000",
    "minimo_acionado": false
  },
  "descontos": [],
  "totais": { "valor_bruto": "2585.3740", "valor_desconto": "0.0000", "valor_liquido": "2585.37" },
  "parametros": {
    "base_dias": "DIAS_REAIS_DO_MES",
    "contagem_periodo": "INCLUI_AMBOS",
    "arredondamento": "2_CASAS_MEIO_ACIMA"
  },
  "calculado_em": "2026-09-01T02:14:33-03:00"
}
```

Na interface, essa estrutura é renderizada como uma explicação legível, com links para o romaneio, as
leituras e a cláusula contratual de origem — de modo que o analista financeiro consiga responder a
qualquer questionamento do cliente sem consultar outra tela.

---

## E.7 Reajuste

| Aspecto | Definição |
| --- | --- |
| Gatilho | Competência de aniversário do contrato (ou mês-base configurado) |
| Índices | IPCA, IGP-M, INPC, percentual fixo, ou índice customizado do tenant |
| Fonte do índice | Tabela de índices atualizada mensalmente (importação ou API); valor congelado ao aplicar |
| Cálculo | `novo_valor = valor_atual × (1 + acumulado_do_periodo)`, com arredondamento a 2 casas |
| Fluxo | Proposta automática → aprovação com alçada → aplicação na competência (`RN-008`) |
| Não aplicação | Registra `RENUNCIADO` com motivo; alimenta `KPI-34` (receita renunciada) |
| Retroatividade | Se aprovado após a competência de aniversário, gera diferença cobrável na competência corrente, discriminada como "acerto de reajuste" |
| Exibição | Destacada na fatura: valor anterior, índice, percentual e novo valor |

---

## E.8 Regras de fechamento

| Etapa | Verificação | Resultado se falhar |
| --- | --- | --- |
| 1. Elegibilidade | Competência aberta (`RN-022`) | Fechamento não inicia |
| 2. Integridade de medição | Toda modalidade dependente de leitura possui leitura do período | Item bloqueado (`RN-021`); permite estimativa com alçada |
| 3. Integridade de movimentação | Nenhuma movimentação pendente de confirmação no período | Alerta e pendência de tratativa |
| 4. Consistência de vigência | Nenhum item com vigência inconsistente ou sobreposta | Erro crítico (indica violação de `RN-001`) |
| 5. Cálculo | Motor executa por item, em paralelo, com resultado idempotente | Item com erro isolado, ciclo continua |
| 6. Conferência por exceção | Sinaliza desvio: variação > X% vs. mês anterior, item estimado, valor zero, mínimo acionado, primeira/última competência, desconto novo | Itens sinalizados para revisão |
| 7. Aprovação | Individual ou em lote, respeitando alçada | Sem aprovação, não emite |
| 8. Emissão | Valida cadastro fiscal, contato de envio e regras do provedor | Fatura permanece em `EM_FECHAMENTO` com pendência listada |
| 9. Fechamento formal | Bloqueia a competência | Ajustes posteriores viram acerto no ciclo seguinte |

---

## E.9 Matriz de cenários de teste obrigatórios

Nenhuma release do motor é promovida sem todos estes cenários verdes.

| # | Cenário | Verificação central |
| --- | --- | --- |
| 1 | Fixo mensal, ciclo integral | Valor = valor contratado, sem proporcionalização |
| 2 | Entrega no meio do ciclo | Pro-rata correto com `INCLUI_AMBOS` |
| 3 | Devolução no meio do ciclo | Pro-rata correto e encerramento do item |
| 4 | Entrega e devolução no mesmo ciclo | Apenas o intervalo efetivo |
| 5 | Substituição de ativo no ciclo | Soma dos períodos = ciclo integral, sem lacuna nem sobreposição |
| 6 | Suspensão parcial | Dias suspensos excluídos |
| 7 | Franquia por item | Excedente sobre a franquia individual |
| 8 | Franquia por *pool* de contrato | Excedente sobre o total consolidado |
| 9 | Franquia proporcionalizada | Franquia reduzida na entrada no meio do ciclo |
| 10 | Escalonado por faixa | Soma por faixa correta na fronteira exata |
| 11 | Mínimo mensal acionado | Valor = mínimo, com flag e valor original na memória |
| 12 | Mínimo + desconto | Desconto aplicado após o mínimo |
| 13 | Reajuste na competência de aniversário | Incide sobre o valor unitário |
| 14 | Reajuste retroativo | Acerto na competência corrente, discriminado |
| 15 | Downtime indenizável acima da tolerância | Abatimento pro-rata (`RN-012`) |
| 16 | Leitura estornada e substituída | Recálculo correto em competência aberta |
| 17 | Medição faltante | Item bloqueado; fechamento não conclui (`RN-021`) |
| 18 | Medição estimada e acerto no ciclo seguinte | Diferença cobrada/creditada corretamente |
| 19 | Fevereiro (28 e 29 dias) | `DIAS_REAIS` correto em ano bissexto |
| 20 | Meses de 30 e 31 dias | Fator proporcional coerente |
| 21 | Virada de fuso horário no limite do dia | Data do evento na competência correta |
| 22 | Competência fechada | Nenhum lançamento aceito (`RN-022`) |
| 23 | Fatura emitida | Imutável; correção por nota vinculada (`RN-023`) |
| 24 | Reprocessamento do mesmo ciclo | Resultado idêntico (idempotência) |
| 25 | Recobrança de avaria aprovada | Lançada na competência da aprovação, com vínculo à OS |
| 26 | Item com quantidade > 1 | Multiplicação após arredondamento do unitário |
| 27 | Fatura agrupada por cliente | Totais conferem com a soma dos contratos |
| 28 | Contrato-mãe com ordens filhas | Condições herdadas aplicadas corretamente |

---

## E.10 Versionamento do motor

| Regra | Definição |
| --- | --- |
| Versão registrada | Toda fatura guarda `versao_motor` na memória de cálculo |
| Mudança de comportamento | Nova versão do motor; competências já fechadas nunca são recalculadas |
| Correção de defeito | Aplicada somente às competências abertas; competências fechadas são corrigidas por documento de acerto |
| Simulação comparativa | Antes de promover nova versão, executa-se o ciclo anterior nas duas versões e compara-se valor a valor; qualquer divergência exige justificativa documentada |
| Parâmetros do tenant | Alterações de `base_dias`, `contagem_periodo` ou arredondamento têm vigência futura declarada — nunca efeito retroativo |
