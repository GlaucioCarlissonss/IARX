# 6. Regras de Negócio

## 6.1 Convenção

Cada regra possui identificador estável (`RN-xxx`), tipo de aplicação e ponto de imposição.

| Tipo | Significado |
| --- | --- |
| **Invariante** | Nunca pode ser violada; imposta no banco de dados e/ou na camada de domínio |
| **Validação** | Verificada na transação; bloqueia a operação com mensagem acionável |
| **Automação** | Executada por evento ou agendador, sem intervenção humana |
| **Política** | Parametrizável por tenant; o comportamento padrão é indicado |
| **Alçada** | Permite a operação, condicionada a perfil e justificativa |

Toda regra bloqueante deve produzir mensagem que informe **o que impede** e **qual a ação de
saída** — nunca apenas "operação não permitida".

---

## 6.2 Contratos e alocação

### `RN-001` — Equipamento não pode estar em dois contratos simultaneamente
**Tipo:** Invariante · **Módulos:** CTR, EQP

Um ativo não pode ter duas alocações contratuais com períodos de vigência sobrepostos.

- **Imposição em banco:** restrição de exclusão por intervalo —
  `EXCLUDE USING gist (equipamento_id WITH =, tstzrange(inicio, fim, '[)') WITH &&)
  WHERE (status IN ('ATIVO','RESERVADO','SUSPENSO'))`.
- **Imposição em domínio:** validação com bloqueio pessimista do ativo durante a alocação.
- **Exceções controladas:** substituição de equipamento (`F-CTR-26`) encerra a alocação anterior
  na mesma transação; reserva futura não conflita com locação vigente que termine antes.
- **Mensagem:** "Patrimônio 10422 já alocado ao contrato SP-2026-0148 até 30/09. Opções: alocar
  outro ativo da categoria · reservar a partir de 01/10 · substituir no contrato atual."

### `RN-002` — Identificação do ativo é única
**Tipo:** Invariante · **Módulo:** EQP

Patrimônio único por tenant (`UNIQUE (tenant_id, patrimonio)`); número de série único por
fabricante + modelo. Divergência na importação em massa é rejeitada linha a linha, sem carga parcial
silenciosa.

### `RN-003` — Somente ativo disponível pode ser alocado
**Tipo:** Validação · **Módulos:** CTR, EQP

Alocação exige estado `DISPONÍVEL` (ou `RESERVADO` para o mesmo contrato). Estados
`EM_MANUTENÇÃO`, `EM_TRÂNSITO`, `BLOQUEADO`, `EXTRAVIADO` e `BAIXADO` impedem alocação.

### `RN-004` — Equipamento em manutenção fica indisponível
**Tipo:** Automação + Invariante · **Módulos:** MNT, EQP

A abertura de OS com impacto de indisponibilidade transiciona o ativo para `EM_MANUTENÇÃO` e o
retira da base alocável. A conclusão e validação da OS o devolve ao estado anterior compatível
(`DISPONÍVEL` se em pátio; `LOCADO` se a manutenção ocorreu em campo sem retirada).

- **Efeito contratual:** ativo locado que entra em manutenção com retirada dispara a política de
  `RN-012` (suspensão de cobrança ou substituição).

### `RN-005` — Ativo em trânsito não é alocável nem transferível
**Tipo:** Invariante · **Módulo:** EQP

Transferência entre filiais exige aceite no destino. Enquanto em `EM_TRÂNSITO_*`, o ativo não
aceita nova alocação, nova transferência ou abertura de OS de campo.

### `RN-006` — Divergência de checklist gera pendência rastreável
**Tipo:** Automação · **Módulos:** EQP, MNT

Retorno com item reprovado no checklist cria automaticamente: (a) pendência de inspeção, e (b) OS
corretiva quando o item for classificado como impeditivo. O ativo vai para `EM_INSPEÇÃO` e não
retorna a `DISPONÍVEL` até a tratativa.

- **Efeito comercial:** dano além do desgaste natural gera lançamento de recobrança ao cliente,
  sujeito a aprovação (`RN-009`).

### `RN-007` — Baixa de ativo exige liberação total
**Tipo:** Validação · **Módulos:** EQP, FIN

Ativo não pode ser baixado com alocação vigente, OS aberta, peça reservada ou saldo financeiro
pendente vinculado. A baixa exige tipo (venda, sucateamento, sinistro, extravio), documento,
valor e aprovação de alçada; registra efeito patrimonial e encerra a linha do tempo do ativo.

### `RN-008` — Reajuste segue índice e aniversário contratual
**Tipo:** Automação + Alçada · **Módulo:** CTR

Na competência de aniversário, o sistema calcula o reajuste conforme índice, periodicidade e
mês-base, e gera **proposta** de reajuste. A aplicação exige aprovação com alçada. Reajustes não
aplicados permanecem visíveis como receita renunciada até decisão explícita.

- **Regra de arredondamento:** duas casas decimais, meio para cima, aplicada ao valor unitário
  antes da multiplicação por quantidade.

### `RN-009` — Desconto e recobrança exigem alçada e justificativa
**Tipo:** Alçada · **Módulos:** CTR, FAT

Faixas de desconto por perfil (padrão: operador até 5%, gestor até 15%, diretor acima).
Toda concessão registra motivo tipificado, autor, data e valor renunciado, e é somada ao
indicador de desconto concedido do período. Sem justificativa, a operação não é gravada.

### `RN-010` — Contratos com vencimento próximo e vencidos geram alerta automático
**Tipo:** Automação · **Módulos:** CTR, NTF

Régua padrão em D-90, D-60, D-30, D-15, D-7 e D+1, escalonando destinatário (responsável comercial
→ gestor de filial → diretor). Após o vencimento sem renovação nem devolução, o contrato entra em
`VENCIDO_EM_CAMPO`, sinalizado como criticidade no mapa e no painel operacional, com faturamento
mantido conforme política do tenant (padrão: mantém cobrança e alerta diariamente).

---

## 6.3 Manutenção e disponibilidade

### `RN-011` — SLA conta em calendário útil configurado, com pausas justificadas
**Tipo:** Política · **Módulo:** MNT

O prazo de resposta e de solução usa o calendário de atendimento do tenant/cliente (turnos,
feriados, 24×7 opcional). Pausas de SLA são permitidas apenas com motivo tipificado — espera de
peça, acesso negado ao local, aprovação do cliente pendente — e todo período pausado fica visível
na OS. Pausa sem motivo válido é rejeitada.

### `RN-012` — Tempo parado por indisponibilidade tem efeito contratual definido
**Tipo:** Política · **Módulos:** MNT, FAT

Padrão: parada por falha de responsabilidade da locadora acima da tolerância contratada (ex.: 24 h)
gera abatimento pro-rata na fatura ou substituição do ativo. Parada por mau uso do cliente não gera
abatimento e pode gerar recobrança. A classificação da causa é obrigatória no encerramento da OS.

### `RN-013` — Preventiva é gerada automaticamente pelo gatilho que ocorrer primeiro
**Tipo:** Automação · **Módulo:** MNT

O plano preventivo define gatilhos concorrentes (horas, ciclos, quilometragem, calendário). A OS é
criada antecipadamente na janela de tolerância, com tarefas e peças previstas, e vinculada ao ativo
e à leitura que a disparou. Cumprida a preventiva, o contador do próximo ciclo é reancorado na
leitura efetiva da execução, não na prevista.

### `RN-014` — Preventiva vencida bloqueia operação do ativo
**Tipo:** Automação + Política · **Módulos:** MNT, EQP

Ultrapassada a tolerância do plano (padrão: 10% do intervalo ou 15 dias), o ativo é marcado
`BLOQUEADO` para novas alocações. Ativo já locado não é retirado automaticamente: gera alerta
crítico, notifica gestor e entra na fila de atendimento prioritário. O desbloqueio ocorre pela
execução da preventiva ou por liberação excepcional com alçada, prazo máximo e justificativa
— sempre registrada em auditoria.

Regra equivalente aplica-se a certificação/laudo obrigatório expirado (NR-11, NR-12, apólice).

### `RN-015` — OS não conclui sem apontamento completo
**Tipo:** Validação · **Módulos:** MNT, EST

Conclusão exige: (a) tempo de mão de obra apontado, (b) destino definido para toda peça reservada
(consumida, devolvida ou cancelada), (c) causa raiz classificada, e (d) evidência quando o tipo de
OS a exigir. Isso garante custo de manutenção íntegro (`KPI-09`) e estoque fiel.

---

## 6.4 Peças e estoque

### `RN-016` — Estoque abaixo do mínimo gera alerta e sugestão de reposição
**Tipo:** Automação · **Módulos:** EST, NTF

Ao cruzar o ponto de pedido, o sistema emite alerta ao responsável do depósito e cria sugestão de
compra com quantidade calculada (ponto de pedido, consumo médio, prazo do fornecedor). A prioridade
do alerta aumenta se existirem OS aguardando a peça.

### `RN-017` — Toda saída de peça é rastreável e valorada
**Tipo:** Invariante · **Módulos:** EST, MNT, FIN

Não existe consumo de peça sem movimento de estoque vinculado a uma OS (ou a um destino tipificado:
ajuste, perda, devolução, transferência). A valoração usa **custo médio móvel** no instante da
baixa, e o custo é lançado simultaneamente na OS, no ativo e no resultado.

- **Saldo nunca negativo:** a baixa é rejeitada se o saldo disponível for insuficiente; a OS vai
  para `AGUARDANDO_PEÇA`.
- **Ajuste de inventário** é o único caminho para alterar saldo sem movimento operacional, e exige
  contagem, divergência registrada e aprovação.

---

## 6.5 Faturamento e financeiro

### `RN-018` — Toda movimentação e alteração crítica gera histórico auditável
**Tipo:** Invariante · **Módulos:** todos, via AUD

Alterações em contrato, ativo, contrato-item, fatura, OS, saldo de estoque, preço, permissão e
parametrização gravam registro *append-only* com: entidade, id, ação, campo, valor anterior, valor
novo, autor, perfil efetivo, data/hora com fuso, IP, agente e `request_id` de correlação. O log é
imutável e não editável por qualquer perfil, inclusive administrador.

### `RN-019` — Exclusão crítica é lógica e rastreável
**Tipo:** Invariante · **Módulos:** todos

Contratos, ativos, clientes, faturas, OS e peças não sofrem exclusão física. A operação é
*soft delete* com motivo obrigatório, autor e data, mantendo integridade referencial e presença na
auditoria. Registro inativo não aparece em listas operacionais, permanece consultável no histórico
e nunca é reutilizado para nova numeração.

### `RN-020` — Leitura de medidor é monotônica e validada
**Tipo:** Validação · **Módulos:** EQP, FAT

Nova leitura deve ser ≥ última leitura válida do mesmo medidor. Variação acima do limite plausível
configurado (ex.: > 24 h de horímetro por dia corrido) exige confirmação explícita e marca a leitura
como "revisada". Retroatividade só é aceita em competência aberta; em competência fechada, gera
acerto no ciclo seguinte.

### `RN-021` — Medição faltante bloqueia o fechamento do item
**Tipo:** Validação · **Módulo:** FAT

Item com modalidade dependente de medição não é faturado sem leitura do período. O fechamento não é
concluído com pendências, salvo uso explícito de estimativa (`F-FAT-04`) com alçada — caso em que o
item é marcado como estimado e entra na fila de acerto do ciclo seguinte.

### `RN-022` — Competência fechada é imutável
**Tipo:** Invariante + Alçada · **Módulos:** FAT, FIN

Após o fechamento formal, nenhum lançamento é criado, alterado ou excluído na competência.
Reabertura exige perfil com alçada, motivo, e registra evento de auditoria com escopo do que foi
reaberto; alternativamente, o ajuste ocorre na competência corrente por documento de acerto.

### `RN-023` — Fatura emitida é imutável; correção é por documento vinculado
**Tipo:** Invariante · **Módulo:** FAT

Após emissão, a fatura não é editada nem excluída. Correções ocorrem por cancelamento formal (com
motivo, dentro da janela permitida e conforme regra fiscal) ou por nota de crédito/débito vinculada,
preservando a numeração e a rastreabilidade.

### `RN-024` — Inadimplência impacta indicadores e pode restringir operação
**Tipo:** Automação + Política · **Módulos:** FIN, CTR, MAP

Fatura vencida atualiza automaticamente o *aging*, o índice de inadimplência (`KPI-11`) e a
exposição do cliente. Conforme política do tenant: acima de N dias de atraso, o cliente entra em
observação (alerta na alocação) e, acima de M dias, em bloqueio comercial — impedindo nova alocação
e renovação, sempre com possibilidade de liberação por alçada com justificativa. Clientes
bloqueados são destacados no mapa e no painel operacional.

### `RN-025` — Receita e custo são sempre alocados a um ativo ou centro de custo
**Tipo:** Invariante · **Módulo:** FIN

Nenhum lançamento financeiro operacional existe sem vínculo a origem (`fatura`, `os`,
`movimento_estoque`, `compra`, `contrato`) e a um destino de rateio (ativo, contrato, categoria ou
centro de custo). Isso garante que rentabilidade por ativo e por cliente sejam sempre completas.

---

## 6.6 Acesso, identidade e integridade sistêmica

### `RN-026` — Perfis de acesso controlam permissões e escopo organizacional
**Tipo:** Invariante · **Módulo:** IAM

Toda operação é autorizada por par `permissão` × `escopo`. A permissão define a ação
(`contrato:aprovar`); o escopo define o alcance (tenant, empresa, filial, região, carteira própria).
Ausência de permissão explícita nega por padrão. Perfis são configuráveis por tenant a partir de
perfis-base (Anexo C).

### `RN-027` — Segregação de funções em operações sensíveis
**Tipo:** Política · **Módulos:** IAM, FAT, FIN, EST

Por padrão, o mesmo usuário não pode simultaneamente: criar e aprovar desconto acima da própria
alçada; solicitar e aprovar ajuste de inventário; cadastrar fornecedor e aprovar seu pagamento;
executar e validar a própria OS. Cada exceção é parametrizável, e sua ativação é registrada.

### `RN-028` — Isolamento entre tenants é imposto no dado, não na aplicação
**Tipo:** Invariante · **Módulo:** IAM/infra

Toda tabela de negócio possui `tenant_id`, com *Row-Level Security* ativa. Nenhuma consulta é
executada sem contexto de tenant. Consultas administrativas cruzadas são possíveis somente por
papel de suporte, com sessão temporária, motivo e auditoria integral.

### `RN-029` — Operações externas são idempotentes
**Tipo:** Invariante · **Módulos:** INT, FAT

Requisições de escrita via API aceitam `Idempotency-Key`; reprocessamento com a mesma chave retorna
o resultado original sem duplicar efeito. Webhooks recebidos são deduplicados por identificador do
evento. Nenhuma integração pode gerar fatura, movimento de estoque ou OS em duplicidade.

### `RN-030` — Consistência eventual não vale para dinheiro nem para alocação
**Tipo:** Invariante · **Arquitetura**

Alocação de ativo, baixa de estoque, emissão de fatura e fechamento de competência ocorrem em
transação ACID única. Projeções, mapas, indicadores e notificações podem ser eventualmente
consistentes, sempre com indicação de horário de atualização na interface.

---

## 6.7 Matriz de imposição

| Regra | Banco de dados | Domínio (aplicação) | Job/Evento | Interface |
| --- | :--: | :--: | :--: | :--: |
| `RN-001` dupla alocação | ✔ exclusion constraint | ✔ lock + validação | — | ✔ disponibilidade em tempo real |
| `RN-002` unicidade | ✔ unique | ✔ | — | ✔ feedback imediato |
| `RN-003`/`RN-004` disponibilidade | ✔ check de estado | ✔ | ✔ evento de OS | ✔ filtro de seleção |
| `RN-010` alertas de vigência | — | — | ✔ agendador | ✔ painel + central de alertas |
| `RN-013`/`RN-014` preventiva | — | ✔ bloqueio | ✔ gerador de OS | ✔ badge de criticidade |
| `RN-016` estoque mínimo | — | ✔ | ✔ avaliador | ✔ alerta e sugestão |
| `RN-017` saldo não negativo | ✔ check + constraint | ✔ | — | ✔ mensagem com alternativa |
| `RN-018` auditoria | ✔ trigger/outbox | ✔ interceptor | — | ✔ aba de histórico |
| `RN-022`/`RN-023` imutabilidade | ✔ constraint de estado | ✔ | — | ✔ ações desabilitadas com motivo |
| `RN-026`/`RN-028` acesso e tenant | ✔ RLS | ✔ guard | — | ✔ menus e ações por permissão |
| `RN-029` idempotência | ✔ unique de chave | ✔ middleware | ✔ dedupe de fila | — |
