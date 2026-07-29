# 5. Funcionalidades Essenciais

Cada funcionalidade é identificada como `F-<MÓDULO>-<nº>` e traz a fase prevista de entrega
(`[F1]`…`[F5]`, ver seção 14). Regras de negócio referenciadas estão na seção 6.

---

## 5.1 `CTR` — Controle de Contratos

### Cadastro e estrutura contratual

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-CTR-01` | Cadastro de contrato em etapa única | Formulário em 4 blocos progressivos (Cliente → Comercial → Equipamentos → Documentos) em página única com salvamento automático de rascunho | F1 |
| `F-CTR-02` | Numeração automática parametrizável | Máscara por tenant/filial (`{FILIAL}-{AAAA}-{SEQ}`), com sequência transacional sem lacunas | F1 |
| `F-CTR-03` | Tipos de contrato | Locação por prazo determinado, indeterminado, obra/projeto, comodato, contrato-guarda-chuva com pedidos filhos | F1 |
| `F-CTR-04` | Contrato-mãe e ordens de locação | Contrato-guarda-chuva define condições comerciais; ordens filhas alocam equipamentos ao longo do tempo | F2 |
| `F-CTR-05` | Duplicar contrato / usar como modelo | Cria rascunho preenchido a partir de contrato existente ou de *template* comercial | F1 |
| `F-CTR-06` | Campos personalizados por tenant | Definição de campos adicionais (texto, número, lista, data, booleano) com obrigatoriedade e exibição condicional | F3 |

### Vigência, status e ciclo de vida

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-CTR-07` | Controle de vigência | Data de início, término, prazo mínimo (*lock-in*), carência e renovação automática | F1 |
| `F-CTR-08` | Máquina de estados contratual | `RASCUNHO → EM_APROVAÇÃO → AGUARDANDO_ASSINATURA → ATIVO → (SUSPENSO) → EM_RENOVAÇÃO → ENCERRADO / CANCELADO / DISTRATADO` (Anexo B) | F1 |
| `F-CTR-09` | Suspensão temporária | Suspende faturamento sem liberar o ativo, com motivo, período e efeito de pro-rata explícito | F2 |
| `F-CTR-10` | Renovação assistida | Painel de renovação com contratos em janela D-90/60/30/15/7; renovação em 1 clique aplicando índice sugerido (`RN-010`) | F1 |
| `F-CTR-11` | Aditivos e versionamento | Toda alteração de escopo/valor gera nova versão do contrato com *diff* legível e vigência própria | F2 |
| `F-CTR-12` | Encerramento com checklist | Exige devolução de todos os itens, quitação ou registro de pendência financeira, e apuração de multa rescisória | F2 |
| `F-CTR-13` | Distrato e multa | Cálculo de multa por quebra de prazo mínimo conforme regra paramétrica | F3 |

### Clientes e locais de operação

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-CTR-14` | Cadastro de clientes | PF/PJ, documentos, inscrições, endereços múltiplos, contatos por função, condição de pagamento padrão | F1 |
| `F-CTR-15` | Enriquecimento por CNPJ/CEP | Preenchimento assistido por consulta a base pública (com edição livre) | F2 |
| `F-CTR-16` | Locais de operação (obras/sites) | Hierarquia `Cliente → Local`, com endereço, coordenadas, responsável, janela de acesso e restrições | F1 |
| `F-CTR-17` | Situação de crédito do cliente | Limite de crédito, exposição atual, situação (liberado / observação / bloqueado) e efeito na alocação (`RN-024`) | F3 |
| `F-CTR-18` | Visão 360º do cliente | Contratos, ativos em posse, faturas, inadimplência, OS abertas e rentabilidade em uma única página | F2 |

### Valores, reajustes e cobrança

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-CTR-19` | Valores contratados por item | Preço por equipamento/categoria, modalidade de cobrança, franquia, preço de excedente e mínimo mensal | F1 |
| `F-CTR-20` | Composição de valores acessórios | Frete, montagem/desmontagem, treinamento, seguro, taxa de operação — recorrentes ou pontuais | F2 |
| `F-CTR-21` | Reajuste por índice | Índice (IPCA/IGP-M/INPC/fixo %), periodicidade, mês-base e aniversário; proposta automática com aprovação (`RN-008`) | F2 |
| `F-CTR-22` | Simulador de reajuste | Projeta impacto do reajuste na carteira antes de aplicar (por cliente, filial, categoria) | F3 |
| `F-CTR-23` | Política de descontos com alçada | Faixas de desconto por perfil, com justificativa obrigatória e trilha de aprovação (`RN-009`) | F2 |

### Equipamentos vinculados

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-CTR-24` | Alocação de equipamentos | Busca por categoria/modelo com disponibilidade em tempo real; alocação por ativo específico ou por categoria (a definir na entrega) | F1 |
| `F-CTR-25` | Bloqueio de dupla alocação | Validação transacional de sobreposição de vigência (`RN-001`) | F1 |
| `F-CTR-26` | Substituição de equipamento | Troca com registro de motivo, mantendo continuidade de faturamento e histórico do contrato | F1 |
| `F-CTR-27` | Inclusão/exclusão parcial de itens | Alteração de escopo em contrato ativo com pro-rata automático (Anexo E) | F2 |
| `F-CTR-28` | Reserva futura | Reserva de ativo/categoria para data futura, com expiração automática de reserva não confirmada | F3 |

### Documentos, assinatura e observações

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-CTR-29` | Anexos e documentos | Upload múltiplo, tipagem (contrato, ART, apólice, comprovante), versionamento e validade com alerta de expiração | F1 |
| `F-CTR-30` | Geração de minuta | Contrato gerado a partir de *template* com variáveis do cadastro (PDF) | F2 |
| `F-CTR-31` | Controle de assinatura | Status (não enviado / enviado / assinado parcialmente / assinado / recusado), signatários, data e evidência | F2 |
| `F-CTR-32` | Assinatura digital integrada | Integração com provedor de assinatura eletrônica; retorno automático de status via webhook | F4 |
| `F-CTR-33` | Observações operacionais | Notas por contrato e por item, com marcação de criticidade e exibição obrigatória nos fluxos de entrega e OS | F1 |
| `F-CTR-34` | Histórico de alterações | Trilha completa (campo, antes, depois, autor, data, origem) com filtro e exportação (`RN-018`) | F1 |
| `F-CTR-35` | Alertas de vencimento | Régua configurável por tenant, com canais e destinatários por perfil (`RN-010`) | F1 |

---

## 5.2 `EQP` — Controle de Equipamentos

### Identidade e cadastro

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-EQP-01` | Cadastro completo do ativo | Patrimônio, série, categoria, modelo, fabricante, ano, capacidade, especificações técnicas, acessórios, foto | F1 |
| `F-EQP-02` | Unicidade de identificação | Patrimônio único por tenant; série única por fabricante+modelo (`RN-002`) | F1 |
| `F-EQP-03` | Árvore de catálogo | `Fabricante → Modelo → Categoria` com atributos herdados e valores-padrão (plano preventivo, medidor, preço de tabela) | F1 |
| `F-EQP-04` | Composição e acessórios | Ativo principal com acessórios/implementos rastreáveis individual ou coletivamente | F2 |
| `F-EQP-05` | Dados patrimoniais | Valor de aquisição, fornecedor, NF, data de entrada, vida útil, método e taxa de depreciação, valor residual | F2 |
| `F-EQP-06` | Documentação do ativo | Manuais, certificados, laudos (NR-12, NR-11), seguro, com validade e alerta de expiração | F2 |
| `F-EQP-07` | Importação em massa | Carga inicial via planilha com validação linha a linha e relatório de erros | F1 |

### Estado operacional e disponibilidade

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-EQP-08` | Máquina de estados do ativo | `DISPONÍVEL · RESERVADO · EM_TRÂNSITO_ENTREGA · LOCADO · EM_TRÂNSITO_RETORNO · EM_INSPEÇÃO · EM_MANUTENÇÃO · BLOQUEADO · EXTRAVIADO · BAIXADO` (Anexo B) | F1 |
| `F-EQP-09` | Disponibilidade em tempo real | Consulta consolidada por filial, categoria e período, considerando reservas, OS abertas e bloqueios (`RN-003`, `RN-004`) | F1 |
| `F-EQP-10` | Motivo de indisponibilidade explícito | Todo estado não disponível exige motivo tipificado e responsável | F1 |
| `F-EQP-11` | Bloqueio operacional | Bloqueio manual (com alçada) ou automático por preventiva vencida/laudo expirado (`RN-014`) | F2 |
| `F-EQP-12` | Painel de ociosidade | Ativos disponíveis há N dias, com custo de oportunidade estimado e sugestão de realocação | F3 |

### Movimentação e rastreio

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-EQP-13` | Registro de movimentação | Entrega, retorno, transferência entre filiais, envio a terceiro, entrada/saída de manutenção — todas com origem, destino, data/hora, responsável e documento | F1 |
| `F-EQP-14` | Checklist de saída e retorno | Modelos por categoria, com itens obrigatórios, foto, nota de estado e geração automática de pendência/OS em divergência (`RN-006`) | F1 |
| `F-EQP-15` | Romaneio / guia de movimentação | Documento imprimível e digital com QR Code, itens, assinatura do recebedor | F2 |
| `F-EQP-16` | QR Code / etiqueta | Geração de etiqueta por ativo (QR + patrimônio + contato), impressão em lote, leitura pela câmera no PWA | F1 |
| `F-EQP-17` | Leitura por código | Escaneamento resolve o ativo e abre a ação contextual (ver ficha, apontar leitura, abrir OS, conferir saída) | F1 |
| `F-EQP-18` | Timeline unificada do ativo | Linha do tempo com movimentações, contratos, OS, leituras, peças e ocorrências financeiras | F1 |
| `F-EQP-19` | Transferência entre filiais | Fluxo com aceite no destino; ativo em trânsito não é alocável (`RN-005`) | F2 |

### Medição, utilização e vida útil

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-EQP-20` | Medidores configuráveis | Horímetro, contador de ciclos/cópias, odômetro, dias corridos, múltiplos medidores por ativo | F1 |
| `F-EQP-21` | Registro de leitura | Manual (web/PWA com foto), importação em lote, API/telemetria; validação de monotonicidade (`RN-020`) | F1 |
| `F-EQP-22` | Correção de leitura | Estorno com justificativa, mantendo o valor original visível e recalculando dependências | F2 |
| `F-EQP-23` | Troca de medidor | Registro de substituição com valor final do antigo e inicial do novo, preservando o acumulado total | F3 |
| `F-EQP-24` | Controle de utilização | Horas/ciclos por período, por contrato e por cliente; comparação com franquia contratada | F2 |
| `F-EQP-25` | Vida útil e depreciação | Depreciação linear ou por uso; percentual de vida consumida; alerta de fim de vida econômica | F3 |
| `F-EQP-26` | Recomendação de desmobilização | Sinaliza ativos com custo de manutenção acumulado acima de limiar do valor residual | F4 |
| `F-EQP-27` | Baixa de ativo | Venda, sucateamento, sinistro ou extravio, com documento, valor e efeito patrimonial (`RN-007`) | F3 |

---

## 5.3 `MAP` — Mapa de Localização dos Equipamentos

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-MAP-01` | Visualização geográfica da frota | Mapa com marcadores por ativo/local, cor por estado operacional e forma por categoria | F2 |
| `F-MAP-02` | Agrupamento (clustering) | Agrupamento dinâmico por zoom, com contagem e composição por estado no *tooltip* | F2 |
| `F-MAP-03` | Camadas | Ativos, locais de clientes, filiais/bases, OS abertas, técnicos em rota, calor de concentração | F2 |
| `F-MAP-04` | Visão por cliente/local | Seleção de local exibe todos os ativos presentes, contrato vigente e pendências | F2 |
| `F-MAP-05` | Filtros inteligentes | Combinação de estado, categoria, cliente, filial, região, criticidade, tempo no local, situação financeira | F2 |
| `F-MAP-06` | Filtros salvos e compartilháveis | Visões nomeadas (ex.: "Ativos críticos — Nordeste") reutilizáveis e compartilháveis por equipe | F3 |
| `F-MAP-07` | Destaque de equipamentos críticos | Regras de criticidade: OS vencendo SLA, preventiva atrasada, contrato vencido em campo, cliente inadimplente, ativo sem leitura há N dias | F2 |
| `F-MAP-08` | Agrupamento regional e indicadores | Painel lateral com ocupação, receita, ativos parados e MTTR por região/filial selecionada | F3 |
| `F-MAP-09` | Geocodificação de locais | Endereço → coordenadas com revisão manual e ajuste por arraste do marcador | F2 |
| `F-MAP-10` | Posição declarada vs. rastreada | Distinção visual entre posição do cadastro/movimentação e posição de telemetria, com alerta de divergência | F4 |
| `F-MAP-11` | Histórico de posições | Reprodução do deslocamento do ativo em janela de tempo | F4 |
| `F-MAP-12` | Cercas virtuais (geofence) | Perímetro por local de operação com alerta de saída não autorizada | F5 |
| `F-MAP-13` | Ação direta do mapa | Do marcador: abrir ficha, abrir OS, iniciar retorno, ver contrato — sem sair do contexto | F3 |
| `F-MAP-14` | Desempenho em escala | Renderização vetorial com *tiles*, consultas espaciais indexadas, carga por *viewport* | F2 |

---

## 5.4 `FAT` — Faturamento e Consumo

### Medição e consumo

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-FAT-01` | Ciclos de faturamento | Ciclos configuráveis (dia fixo, aniversário do contrato, quinzenal, semanal) por cliente/contrato | F1 |
| `F-FAT-02` | Coleta de medição do período | Consolidação das leituras por ativo/contrato, com identificação de leitura faltante | F1 |
| `F-FAT-03` | Painel de pendências de medição | Lista bloqueante do fechamento, com ação direta de solicitar/registrar leitura (`RN-021`) | F1 |
| `F-FAT-04` | Estimativa assistida | Em ausência justificada, permite estimativa por média histórica, marcada como estimada e com acerto no ciclo seguinte | F2 |
| `F-FAT-05` | Cálculo de franquia e excedente | Franquia por ativo ou por contrato (pool), com excedente unitário ou por faixa | F1 |

### Geração e emissão

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-FAT-06` | Pré-fatura automática | Geração automática no fechamento, com itens, memória de cálculo e situação de conferência | F1 |
| `F-FAT-07` | Modalidades de cobrança | Fixo mensal, por medição, franquia + excedente, diária/hora efetiva, mínimo mensal, escalonado por volume, misto (Anexo E) | F1 |
| `F-FAT-08` | Pro-rata automático | Entrada e saída no meio do ciclo, suspensão e substituição de ativo (Anexo E) | F1 |
| `F-FAT-09` | Memória de cálculo navegável | Cada valor rastreável até leitura, movimentação e cláusula contratual de origem | F1 |
| `F-FAT-10` | Conferência e aprovação | Revisão por exceção com aprovação individual ou em lote; alçada por valor | F1 |
| `F-FAT-11` | Emissão em lote | Emissão de todas as faturas aprovadas do ciclo, com pré-validação de bloqueios e relatório de resultado | F2 |
| `F-FAT-12` | Documentos de cobrança | PDF da fatura com detalhamento, boleto/PIX e envio automático por e-mail/WhatsApp | F2 |
| `F-FAT-13` | Integração fiscal | Emissão de NF-e/NFS-e via provedor homologado, com retorno de status e armazenamento do XML/DANFE | F4 |
| `F-FAT-14` | Imutabilidade e correção | Fatura emitida não é editável; ajustes por nota de crédito/débito vinculada (`RN-023`) | F1 |
| `F-FAT-15` | Agrupamento de cobrança | Uma fatura por cliente, por contrato, por local ou por centro de custo do cliente | F2 |

### Regras, descontos e fechamento

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-FAT-16` | Motor de regras de cobrança | Regras parametrizáveis por contrato com precedência explícita e simulação | F2 |
| `F-FAT-17` | Descontos e acréscimos | Pontuais ou recorrentes, com alçada, motivo e vigência (`RN-009`) | F1 |
| `F-FAT-18` | Aplicação de reajuste | Reajuste refletido automaticamente na competência correta, com destaque na fatura | F2 |
| `F-FAT-19` | Fechamento mensal formal | Bloqueio da competência após fechamento; reabertura apenas com alçada e registro (`RN-022`) | F2 |
| `F-FAT-20` | Simulação de faturamento | Projeção do faturamento do ciclo antes do fechamento (previsto vs. realizado) | F3 |
| `F-FAT-21` | Controle de inadimplência | Situação por fatura, aging, régua de cobrança automatizada e histórico de tratativas | F2 |
| `F-FAT-22` | Histórico financeiro do contrato | Todas as faturas, pagamentos, créditos e disputas do contrato em visão única | F1 |
| `F-FAT-23` | Exportação financeira | CSV/XLSX/JSON e layout de integração com ERP; exportação assíncrona com download seguro | F2 |

---

## 5.5 `MNT` — Controle de Manutenção

### Chamados e ordens de serviço

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-MNT-01` | Abertura de chamado técnico | Canais: interno (web/PWA), leitura de QR pelo técnico, portal/link do cliente, e-mail e API | F1 |
| `F-MNT-02` | Triagem e classificação | Tipo (corretiva, preventiva, inspeção, melhoria, sinistro), sintoma, prioridade, criticidade e impacto operacional | F1 |
| `F-MNT-03` | Ordem de serviço | `ABERTA → TRIAGEM → AGENDADA → EM_EXECUÇÃO → AGUARDANDO_PEÇA → CONCLUÍDA → VALIDADA` (Anexo B) | F1 |
| `F-MNT-04` | Fila priorizada | Ordenação por risco de SLA, criticidade do cliente e impacto de receita | F1 |
| `F-MNT-05` | Atribuição de técnico | Manual ou sugerida por especialidade, carga atual e proximidade geográfica | F2 |
| `F-MNT-06` | Execução em campo (offline) | PWA com fila local, anexos, apontamento e sincronização automática com resolução de conflito | F2 |
| `F-MNT-07` | Apontamento de mão de obra | Início/fim, deslocamento, tempo produtivo/improdutivo, técnico e custo/hora | F1 |
| `F-MNT-08` | Registro de peças utilizadas | Requisição e baixa de peça na OS, com reserva prévia e custo médio no momento da baixa (`RN-017`) | F1 |
| `F-MNT-09` | Serviços de terceiros | OS com fornecedor externo, ordem de compra de serviço e custo associado | F3 |
| `F-MNT-10` | Diagnóstico estruturado | Sintoma → causa raiz → solução, em taxonomia parametrizável, alimentando análise de recorrência | F3 |
| `F-MNT-11` | Evidências | Fotos antes/depois, vídeo curto, documentos e assinatura do cliente na conclusão | F2 |
| `F-MNT-12` | Validação e reabertura | Validação pelo supervisor; reabertura vinculada à OS original em caso de reincidência | F2 |

### Preventiva, agenda e SLA

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-MNT-13` | Planos preventivos | Por modelo/categoria, com gatilho por horas, ciclos, quilometragem, calendário ou o que ocorrer primeiro | F2 |
| `F-MNT-14` | Geração automática de OS preventiva | Criação antecipada com janela de tolerância e lista de tarefas/peças previstas (`RN-013`) | F2 |
| `F-MNT-15` | Alertas preventivos | Aviso em % do intervalo (ex.: 80%/95%), com escalonamento a vencido e bloqueio operacional (`RN-014`) | F2 |
| `F-MNT-16` | Agenda técnica | Visão dia/semana por técnico e por oficina, com arrastar-e-soltar, capacidade e conflito de agenda | F2 |
| `F-MNT-17` | Roteirização básica | Agrupamento de OS por região e ordenação sugerida do roteiro do dia | F4 |
| `F-MNT-18` | Definição e medição de SLA | SLA por tipo/prioridade/cliente, com prazos de resposta e solução, calendário útil e pausas justificadas (`RN-011`) | F2 |
| `F-MNT-19` | Escalonamento de SLA | Notificação progressiva a supervisor e gestor conforme consumo do prazo | F2 |
| `F-MNT-20` | Controle de tempo parado | *Downtime* por ativo e por causa, com efeito em disponibilidade e faturamento (`RN-012`) | F2 |
| `F-MNT-21` | Histórico técnico completo | Todas as OS, peças, custos, tempos e diagnósticos do ativo, com busca e exportação | F1 |
| `F-MNT-22` | Custos de manutenção | Mão de obra + material + terceiros + deslocamento, consolidados por OS, ativo, categoria e período | F2 |
| `F-MNT-23` | Análise de recorrência | Falhas repetidas por modelo/componente, MTBF e indicação de ação estrutural | F4 |
| `F-MNT-24` | Alçada de custo | OS acima de valor-limite exige aprovação antes da execução | F3 |

---

## 5.6 `EST` — Controle de Peças e Estoque

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-EST-01` | Cadastro de peças | Código interno, código do fabricante, descrição, unidade, categoria, aplicação (modelos compatíveis), foto, localização física | F1 |
| `F-EST-02` | Multidepósito | Depósitos por filial, oficina e veículo de técnico, com saldo independente | F2 |
| `F-EST-03` | Controle de saldo | Saldo físico, reservado e disponível por depósito, reconstituível pelo histórico de movimentos | F1 |
| `F-EST-04` | Movimentações | Entrada por compra/devolução, saída por consumo em OS, transferência, ajuste de inventário, perda e devolução ao fornecedor | F1 |
| `F-EST-05` | Reserva para OS | Reserva na abertura da OS; liberação automática no cancelamento; OS em `AGUARDANDO_PEÇA` quando indisponível | F2 |
| `F-EST-06` | Estoque mínimo e ponto de pedido | Mínimo, máximo, ponto de pedido e lote econômico por peça/depósito; sugestão de compra automática (`RN-016`) | F1 |
| `F-EST-07` | Alertas de reposição | Alerta ao cruzar o ponto de pedido, com priorização por criticidade da peça e OS impactadas | F1 |
| `F-EST-08` | Fornecedores | Cadastro, peças fornecidas, prazo de entrega, preço histórico e desempenho de atendimento | F2 |
| `F-EST-09` | Custos e valoração | Custo médio móvel como padrão, com suporte a último custo; recálculo automático na entrada (`RN-017`) | F1 |
| `F-EST-10` | Requisição interna | Solicitação de peça pelo técnico, com aprovação e atendimento no depósito | F3 |
| `F-EST-11` | Ordem de compra simplificada | Geração a partir da sugestão de reposição, com recebimento total ou parcial | F3 |
| `F-EST-12` | Inventário operacional | Contagem cíclica ou geral, por leitura de código, com divergência, aprovação e ajuste auditado | F3 |
| `F-EST-13` | Histórico de utilização | Consumo por peça, ativo, modelo, técnico e período; identificação de consumo atípico | F2 |
| `F-EST-14` | Curva ABC e giro | Classificação por valor e giro, com identificação de estoque obsoleto | F4 |
| `F-EST-15` | Rastreabilidade por lote/série | Para peças críticas, com vínculo à OS e ao ativo em que foram aplicadas | F4 |
| `F-EST-16` | Integração com manutenção | Baixa obrigatória na OS; custo de material refletido no ativo e no resultado (`RN-017`) | F1 |

---

## 5.7 `FIN` — Módulo Financeiro

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-FIN-01` | Contas a receber | Geradas automaticamente da fatura emitida; parcelas, vencimentos, situação e histórico de cobrança | F2 |
| `F-FIN-02` | Contas a pagar | Compras de peças, serviços de terceiros, despesas operacionais e recorrentes; aprovação por alçada | F2 |
| `F-FIN-03` | Baixa e conciliação | Baixa manual, importação de retorno bancário (CNAB/OFX) e conciliação por gateway; baixa parcial | F3 |
| `F-FIN-04` | Fluxo de caixa | Realizado e projetado por período, com cenários (otimista/base/pessimista) a partir do recorrente contratado | F3 |
| `F-FIN-05` | Receitas | Recorrente contratual, variável por consumo, serviços, venda de ativo e outras — classificadas por natureza | F2 |
| `F-FIN-06` | Despesas e custos | Diretos (manutenção, peças, logística, depreciação) e indiretos, com rateio parametrizável | F3 |
| `F-FIN-07` | Centros de custo e rateio | Estrutura por filial, categoria de ativo e contrato; rateio por regra configurável | F3 |
| `F-FIN-08` | Alocação de resultado por ativo | Receita e custo direto atribuídos ao equipamento, base da rentabilidade por ativo (`KPI-14`) | F3 |
| `F-FIN-09` | Rentabilidade operacional | Por cliente, contrato, ativo, categoria e filial, com abertura da composição | F3 |
| `F-FIN-10` | Painel executivo | Receita, margem, ocupação, inadimplência, custo de manutenção e tendência, com comparação de períodos | F3 |
| `F-FIN-11` | Resultado operacional gerencial | DRE gerencial simplificada por filial e consolidada, com comparativo orçado vs. realizado | F4 |
| `F-FIN-12` | Faturamento recorrente (MRR) | Base recorrente contratada, adições, reduções, cancelamentos e reajustes do período (`KPI-02`) | F3 |
| `F-FIN-13` | Gestão de inadimplência | Aging, provisão, negociação, acordo de parcelamento e efeito em bloqueio comercial (`RN-024`) | F3 |
| `F-FIN-14` | Exportações contábeis | Layouts para ERP/contabilidade, com conciliação de totais e trilha do que foi exportado | F3 |
| `F-FIN-15` | Relatórios gerenciais | Biblioteca de relatórios com filtros, colunas configuráveis, agendamento e envio automático | F3 |
| `F-FIN-16` | Orçamento operacional | Meta por filial/categoria com acompanhamento de realização | F5 |

---

## 5.8 Serviços transversais — funcionalidades essenciais

| ID | Funcionalidade | Detalhamento | Fase |
| --- | --- | --- | --- |
| `F-SYS-01` | Busca global (command palette) | `Ctrl/⌘+K` busca patrimônio, série, cliente, contrato, OS, peça e fatura, com ações rápidas | F1 |
| `F-SYS-02` | Central de alertas e notificações | Caixa unificada com severidade, agrupamento, atribuição e preferências por canal e perfil | F1 |
| `F-SYS-03` | Trilha de auditoria consultável | Filtro por entidade, autor, período e tipo de ação; exportação assinada | F2 |
| `F-SYS-04` | Gestão de usuários e perfis | Perfis padrão, permissões granulares, escopo por filial/região, convite e desativação | F1 |
| `F-SYS-05` | Parametrização por tenant | Numeração, SLAs, planos preventivos, regras de cobrança, checklists, campos personalizados | F2 |
| `F-SYS-06` | Exportação assíncrona | Geração em fila, notificação ao concluir e link temporário assinado | F2 |
| `F-SYS-07` | Anexos com antivírus e retenção | Verificação no upload, URL assinada, política de retenção e trilha de acesso | F2 |
| `F-SYS-08` | Portal do cliente (autoatendimento) | Ativos em posse, faturas, abertura e acompanhamento de chamados, envio de leitura | F5 |
| `F-SYS-09` | API pública e webhooks | API versionada com chaves por tenant, escopos, *rate limit* e webhooks assinados | F4 |
| `F-SYS-10` | Modo somente leitura de contingência | Degradação controlada com leitura garantida em incidente parcial | F4 |
