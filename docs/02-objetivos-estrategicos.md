# 2. Objetivos Estratégicos

Os objetivos abaixo são declarados em formato mensurável (objetivo → resultado-chave → como a
plataforma habilita). Servem como critério de priorização do roadmap e de aceite do produto.

## 2.1 OE-01 — Maximizar receita por ativo

**Tese:** a maior perda financeira de uma locadora não é inadimplência, é **ativo ocioso e
faturamento subaplicado**.

| Resultado-chave | Habilitador na plataforma |
| --- | --- |
| Elevar a taxa de ocupação da frota (`KPI-05`) | Painel de ociosidade com dias parados por ativo, motivo e responsável |
| Zerar perda de medição no fechamento | Captura de leitura em campo + pendência bloqueante (`RN-021`) |
| Eliminar faturamento a menos por pro-rata manual | Motor de faturamento derivado de vigência (Anexo E) |
| Aplicar 100% dos reajustes contratuais devidos | Régua de reajuste por índice/aniversário com proposta automática (`RN-008`) |

## 2.2 OE-02 — Reduzir custo operacional e tempo parado

| Resultado-chave | Habilitador |
| --- | --- |
| Reduzir MTTR (`KPI-12`) | Triagem de OS com prioridade por SLA, agenda técnica e reserva de peça |
| Reduzir corretivas por falha evitável | Plano preventivo por horímetro/ciclo/calendário + alerta antecipado |
| Reduzir compra emergencial de peças | Estoque mínimo/ponto de pedido com alerta e sugestão de reposição (`RN-016`) |
| Reduzir deslocamento técnico improdutivo | Agrupamento geográfico de OS por região e roteiro sugerido |

## 2.3 OE-03 — Encurtar o ciclo caixa (do consumo ao recebimento)

| Resultado-chave | Habilitador |
| --- | --- |
| Fechamento mensal em ≤ 1 dia útil | Pré-faturamento automático; equipe trata apenas exceções |
| Reduzir prazo médio de emissão pós-fechamento | Emissão em lote com validação prévia de bloqueios |
| Reduzir inadimplência (`KPI-11`) | Régua de cobrança automatizada e bloqueio comercial parametrizável (`RN-024`) |
| Reduzir contestação de fatura | Fatura com memória de cálculo rastreável até a leitura de origem |

## 2.4 OE-04 — Tornar a decisão gerencial baseada em dado corrente

| Resultado-chave | Habilitador |
| --- | --- |
| Rentabilidade por cliente e por equipamento sempre disponível | Alocação contínua de receita e custo por ativo (`KPI-13`, `KPI-14`) |
| Painel executivo confiável sem consolidação manual | Métricas calculadas do mesmo log transacional, sem planilha intermediária |
| Decisão de compra/venda de ativo com base em ROI | ROI operacional acumulado por ativo (`KPI-15`) |

## 2.5 OE-05 — Garantir conformidade, auditabilidade e continuidade

| Resultado-chave | Habilitador |
| --- | --- |
| 100% das operações críticas auditáveis | Log de auditoria append-only com antes/depois (`RN-018`) |
| Nenhuma exclusão física de registro crítico | *Soft delete* com motivo, autor e trilha (`RN-019`) |
| Segregação de funções efetiva | Perfis com escopo por filial/região e ações sensíveis segregadas (Anexo C) |
| Recuperação previsível | RPO ≤ 5 min e RTO ≤ 2 h (seção 11) |

## 2.6 OE-06 — Escalar sem reescrever

| Resultado-chave | Habilitador |
| --- | --- |
| Suportar crescimento de frota e volume transacional | Monólito modular com fronteiras explícitas e workers assíncronos |
| Atender múltiplas empresas na mesma instância | Multi-tenancy com RLS desde a Fase 1 |
| Abrir a plataforma a parceiros | API pública versionada + webhooks (Anexo D) |
| Evoluir sem regressão | Contratos de API versionados, testes de invariantes de domínio, migrações reversíveis |

## 2.7 Critérios de sucesso do produto (definição de "pronto para escalar")

O produto é considerado maduro para expansão comercial quando, em operação real:

1. Nenhum controle paralelo em planilha permanece necessário para faturar.
2. O fechamento mensal é executado por **uma** pessoa em menos de um dia útil.
3. O estado físico do pátio confere com o estado do sistema em auditoria por amostragem (≥ 98%).
4. Toda OS encerrada possui peças baixadas, tempo apontado e custo consolidado.
5. Os indicadores do painel executivo são reconhecidos pela diretoria como fonte oficial.
