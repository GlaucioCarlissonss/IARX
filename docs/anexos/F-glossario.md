# Anexo F — Glossário (Linguagem Ubíqua)

Este vocabulário é normativo: os mesmos termos devem ser usados no código, na interface, na API, na
documentação e na comunicação com a operação. Divergência de nome entre camadas é tratada como
defeito, não como preferência de estilo.

---

## F.1 Ativos e frota

| Termo | Definição |
| --- | --- |
| **Equipamento (Ativo)** | Bem individualmente identificado por patrimônio e número de série, objeto de locação. Entidade soberana da plataforma. |
| **Patrimônio** | Identificador interno único do ativo dentro do tenant. Nunca reutilizado, mesmo após baixa. |
| **Número de série** | Identificador atribuído pelo fabricante. Único por fabricante + modelo. |
| **Categoria** | Agrupamento funcional de equipamentos que compartilham finalidade, checklist e tipo de medidor. |
| **Modelo** | Especificação técnica do fabricante; define padrões herdados pelo ativo (medidor, plano preventivo, preço de tabela). |
| **Acessório / Implemento** | Item vinculado a um ativo principal, rastreável individual ou coletivamente. |
| **Medidor** | Dispositivo ou contador que registra a utilização (horímetro, contador de ciclos, odômetro, dias). |
| **Leitura** | Registro pontual do valor de um medidor, com data, origem e responsável. Monotônica não decrescente (`RN-020`). |
| **Horímetro** | Medidor de horas de operação. |
| **Movimentação** | Evento imutável que altera a posição e/ou o estado do ativo (entrega, retorno, transferência, manutenção, baixa). |
| **Romaneio** | Documento de movimentação física, com itens, responsáveis e assinatura do recebedor. |
| **Checklist** | Roteiro de verificação executado na saída e no retorno do ativo, com itens obrigatórios e impeditivos. |
| **Etiqueta / QR Code** | Marcação física que resolve o ativo por leitura de câmera, dispensando digitação. |
| **Bloqueio operacional** | Estado que impede nova alocação por pendência técnica ou documental (`RN-014`). |
| **Baixa** | Encerramento definitivo do ativo por venda, sucateamento, sinistro ou extravio (`RN-007`). |
| **Vida útil** | Período estimado de uso econômico, base do cálculo de depreciação. |
| **Ociosidade** | Condição de ativo disponível sem alocação por período superior ao parâmetro do tenant. |
| **Frota** | Conjunto de ativos não baixados do tenant. |

## F.2 Comercial e contratos

| Termo | Definição |
| --- | --- |
| **Cliente** | Pessoa física ou jurídica contratante da locação. |
| **Local de operação** | Endereço físico onde o ativo é utilizado (obra, filial do cliente, site). Um cliente pode ter vários. |
| **Contrato** | Instrumento que governa o vínculo comercial: vigência, valores, condições e itens alocados. |
| **Item de contrato** | Vínculo entre um contrato e um equipamento (ou categoria), com vigência e precificação próprias. |
| **Alocação** | Ato de vincular um ativo a um item de contrato por um período. Não admite sobreposição (`RN-001`). |
| **Contrato-mãe (guarda-chuva)** | Contrato que define condições comerciais gerais, sob o qual são emitidas ordens de locação filhas. |
| **Vigência** | Intervalo de validade do contrato ou do item. |
| **Prazo mínimo (lock-in)** | Período contratual cuja quebra gera multa rescisória. |
| **Renovação** | Extensão da vigência, normalmente com aplicação de reajuste. |
| **Aditivo** | Alteração formal de escopo ou valor, que gera nova versão do contrato. |
| **Distrato** | Encerramento antecipado por iniciativa de uma das partes, antes do prazo mínimo. |
| **Suspensão** | Interrupção temporária do faturamento sem liberação do ativo. |
| **Vencido em campo** | Situação de contrato cuja vigência expirou com equipamentos ainda em posse do cliente. |
| **Reajuste** | Correção periódica de valores por índice, na competência de aniversário (`RN-008`). |
| **Índice** | Referência de correção monetária (IPCA, IGP-M, INPC ou percentual fixo). |
| **Alçada** | Limite de valor ou percentual que um perfil pode autorizar sem escalonamento. |
| **Situação de crédito** | Classificação do cliente (liberado, observação, bloqueado) que condiciona novas alocações (`RN-024`). |

## F.3 Manutenção

| Termo | Definição |
| --- | --- |
| **Chamado** | Solicitação inicial de atendimento técnico, de qualquer canal. |
| **Ordem de Serviço (OS)** | Registro formal do atendimento técnico, com escopo, execução, custo e evidências. |
| **Preventiva** | Manutenção programada por gatilho de uso ou calendário, antes da falha. |
| **Corretiva** | Manutenção decorrente de falha ou defeito identificado. |
| **Inspeção** | Verificação técnica sem intervenção necessária, frequentemente pós-retorno. |
| **Plano preventivo** | Conjunto de gatilhos e tarefas que define quando e o que executar preventivamente. |
| **Gatilho** | Condição que dispara a preventiva (horas, ciclos, quilometragem, dias) — vale o que ocorrer primeiro (`RN-013`). |
| **Tolerância** | Margem admitida após o gatilho antes de o ativo ser bloqueado. |
| **Apontamento** | Registro de tempo de mão de obra, deslocamento ou espera em uma OS. |
| **Causa raiz** | Classificação estruturada da origem real da falha, base da análise de recorrência. |
| **SLA** | Compromisso de prazo de resposta e de solução, medido em calendário útil configurado (`RN-011`). |
| **Pausa de SLA** | Interrupção justificada da contagem de prazo (espera de peça, acesso negado, aprovação pendente). |
| **MTTR** | Tempo médio de reparo (`KPI-12`). |
| **MTBF** | Tempo médio entre falhas (`KPI-20`). |
| **Downtime / Tempo parado** | Período em que o ativo esteve indisponível por causa não programada (`KPI-18`). |
| **Disponibilidade** | Proporção do tempo em que o ativo esteve apto a operar (`KPI-16`). |
| **Reincidência** | Nova OS pelo mesmo sintoma no mesmo ativo em janela definida. |

## F.4 Peças e estoque

| Termo | Definição |
| --- | --- |
| **Peça** | Item de reposição ou insumo consumido em manutenção. |
| **Aplicação** | Vínculo entre peça e modelos de equipamento compatíveis. |
| **Depósito** | Local de guarda de peças (almoxarifado, oficina, veículo de técnico). |
| **Saldo físico** | Quantidade efetivamente existente no depósito. |
| **Saldo reservado** | Quantidade comprometida com OS ainda não baixada. |
| **Saldo disponível** | `físico − reservado`. É o valor que autoriza uma nova reserva. |
| **Movimento de estoque** | Evento imutável que altera o saldo, sempre tipificado e valorado (`RN-017`). |
| **Reserva** | Comprometimento de peça para uma OS, antes do consumo efetivo. |
| **Estoque mínimo** | Quantidade abaixo da qual o abastecimento é considerado crítico. |
| **Ponto de pedido** | Nível que dispara a sugestão de reposição, considerando consumo médio e prazo do fornecedor. |
| **Lote econômico** | Quantidade sugerida de compra que otimiza custo de pedido e de estoque. |
| **Custo médio móvel** | Método de valoração recalculado a cada entrada; base do custo de baixa. |
| **Inventário** | Contagem física para conferir e ajustar o saldo do sistema. |
| **Ruptura** | Situação em que a falta de peça impede a execução de uma OS. |
| **Curva ABC** | Classificação de peças por relevância de valor e giro. |

## F.5 Faturamento e financeiro

| Termo | Definição |
| --- | --- |
| **Competência** | Mês de referência contábil/gerencial ao qual receitas e custos são atribuídos. |
| **Ciclo de faturamento** | Periodicidade e datas de fechamento e vencimento aplicáveis a um contrato. |
| **Fechamento** | Processo que consolida medições e gera as pré-faturas da competência. |
| **Medição** | Consolidação do consumo e dos dias faturáveis de um item em uma competência. |
| **Pré-fatura** | Documento provisório, calculado e conferível, anterior à emissão. |
| **Fatura** | Documento de cobrança emitido. Imutável após emissão (`RN-023`). |
| **Memória de cálculo** | Detalhamento rastreável de como cada valor da fatura foi obtido (Anexo E.6). |
| **Pro-rata** | Proporcionalização do valor conforme os dias efetivamente faturáveis. |
| **Franquia** | Quantidade de uso inclusa no valor fixo, antes da cobrança de excedente. |
| **Excedente** | Consumo acima da franquia, cobrado ao preço unitário definido. |
| **Pool de franquia** | Franquia somada no nível do contrato, com excedente calculado sobre o consumo total. |
| **Mínimo mensal** | Piso de faturamento aplicável a modalidades variáveis. |
| **Nota de crédito/débito** | Documento vinculado que corrige uma fatura emitida. |
| **Recobrança** | Cobrança adicional por avaria, mau uso ou serviço extraordinário. |
| **Recebível** | Direito de crédito gerado pela emissão de fatura. |
| **Aging** | Distribuição dos recebíveis vencidos por faixas de atraso. |
| **Inadimplência** | Proporção de valores vencidos sobre a carteira ou o faturamento (`KPI-11`). |
| **Conciliação** | Vinculação entre movimento bancário e recebível/pagável. |
| **Centro de custo** | Unidade organizacional à qual custos são atribuídos. |
| **Rateio** | Distribuição de custo indireto entre destinos por regra definida. |
| **MRR** | Receita recorrente mensal contratada (`KPI-02`). |
| **Churn** | Perda de receita recorrente por encerramento ou redução de contrato (`KPI-31`). |
| **Ticket médio** | Receita média por contrato, cliente ou ativo locado (`KPI-03`). |
| **Margem operacional** | Resultado percentual após custos operacionais (`KPI-04`). |
| **Rentabilidade por ativo** | Resultado individual do equipamento (`KPI-14`). |
| **ROI operacional** | Retorno acumulado sobre o investimento no ativo (`KPI-15`). |
| **Receita renunciada** | Valor não cobrado por desconto concedido ou reajuste não aplicado (`KPI-33`, `KPI-34`). |

## F.6 Plataforma e arquitetura

| Termo | Definição |
| --- | --- |
| **Tenant** | Instância lógica isolada de uma empresa cliente da plataforma (`RN-028`). |
| **Empresa / Filial / Base** | Níveis da hierarquia organizacional interna do tenant. |
| **Escopo** | Alcance organizacional das permissões de um usuário (tenant, empresa, filial, região, próprio). |
| **Perfil** | Conjunto nomeado de permissões atribuível a usuários. |
| **Permissão** | Autorização atômica no formato `recurso:ação`. |
| **Segregação de funções** | Restrição estrutural que impede o mesmo usuário de executar e aprovar a mesma operação (`RN-027`). |
| **Auditoria** | Trilha imutável de alterações e acessos sensíveis (`RN-018`). |
| **Soft delete** | Exclusão lógica com motivo, autor e data, preservando histórico (`RN-019`). |
| **Evento de domínio** | Fato de negócio publicado por um módulo e consumido por outros. |
| **Outbox** | Padrão que garante publicação de evento na mesma transação da mudança de estado. |
| **Idempotência** | Propriedade que permite repetir uma operação sem duplicar seu efeito (`RN-029`). |
| **Projeção** | Visão de leitura derivada de eventos, otimizada para consulta. |
| **Máquina de estados** | Conjunto declarado de estados e transições válidas de uma entidade (Anexo B). |
| **Invariante** | Condição que nunca pode ser violada, imposta no domínio e no banco. |
| **Alerta** | Notificação acionável derivada de regra de negócio ou limite de indicador. |
| **PWA** | Aplicação web instalável, com funcionamento offline, usada pela operação de campo. |
| **Webhook** | Notificação HTTP assinada enviada a um sistema externo assinante de eventos. |
| **RLS (Row-Level Security)** | Mecanismo do banco que restringe linhas por tenant, independentemente da consulta. |
| **Feature flag** | Chave que habilita ou desabilita funcionalidade por tenant, sem novo deploy. |
| **SLO** | Meta interna de desempenho ou disponibilidade do sistema. |
| **RPO / RTO** | Perda máxima de dados aceitável / tempo máximo de recuperação aceitável. |

---

## F.7 Termos deliberadamente evitados

| Evitar | Usar | Motivo |
| --- | --- | --- |
| "Máquina" | "Equipamento" ou "Ativo" | Ambíguo em segmentos não industriais |
| "Aluguel" | "Locação" | Locação é o termo contratual correto |
| "Cliente" para usuário do sistema | "Usuário" | `Cliente` é sempre o contratante da locação |
| "Ordem de compra" para OS | "Ordem de serviço" | Confusão com suprimentos |
| "Deletar" | "Inativar" ou "Excluir logicamente" | Não há exclusão física de registro crítico (`RN-019`) |
| "Status" genérico | Nome do estado específico | Evita ambiguidade entre máquinas de estado distintas |
| "Baixar" para download | "Exportar" / "Obter arquivo" | `Baixa` é operação de estoque e de ativo |
| "Faturar" para emitir NF | "Emitir nota fiscal" | Faturamento é o cálculo; emissão fiscal é etapa distinta |
