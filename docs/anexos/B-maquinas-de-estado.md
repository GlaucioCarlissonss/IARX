# Anexo B — Máquinas de Estado

Toda transição não listada é **inválida** e rejeitada pelo domínio com erro de negócio explícito.
Cada transição declara ator autorizado, pré-condições, efeitos colaterais e evento publicado.

---

## B.1 Contrato

```
                    ┌───────────┐
                    │ RASCUNHO  │◄──────────────────────┐
                    └─────┬─────┘                       │ (recusa de assinatura /
                          │ submeter                    │  reprovação)
                          ▼                             │
                   ┌──────────────┐                     │
                   │EM_APROVAÇÃO  │─────────────────────┘
                   └──────┬───────┘
                          │ aprovar
                          ▼
             ┌────────────────────────┐
             │ AGUARDANDO_ASSINATURA  │
             └────────────┬───────────┘
                          │ assinar (ou dispensar assinatura)
                          ▼
        ┌──────────────► ┌────────┐ ◄──────────────┐
        │ retomar        │ ATIVO  │  renovar       │
        │                └───┬────┘                │
   ┌────┴─────┐    suspender │ │ vencer      ┌─────┴────────┐
   │ SUSPENSO │◄─────────────┘ └────────────►│ EM_RENOVAÇÃO │
   └──────────┘                              └──────────────┘
                              │ vencer sem renovação
                              ▼
                   ┌────────────────────┐
                   │ VENCIDO_EM_CAMPO   │──── renovar ──► ATIVO
                   └─────────┬──────────┘
                             │ devolver todos os itens
                             ▼
   ┌───────────┐      ┌────────────┐      ┌───────────┐
   │ CANCELADO │      │ ENCERRADO  │      │ DISTRATADO│
   └───────────┘      └────────────┘      └───────────┘
        ▲                                       ▲
        │ cancelar (antes de ATIVO)             │ rescindir antes do prazo mínimo
```

| De → Para | Ator | Pré-condições | Efeitos | Evento |
| --- | --- | --- | --- | --- |
| `RASCUNHO → EM_APROVAÇÃO` | Operador | Cliente, vigência e ≥ 1 item preenchidos | — | `contrato.submetido` |
| `EM_APROVAÇÃO → AGUARDANDO_ASSINATURA` | Gestor com alçada | Desconto dentro da alçada; cliente não bloqueado (`RN-024`) | Gera minuta | `contrato.aprovado` |
| `EM_APROVAÇÃO → RASCUNHO` | Gestor | — | Registra motivo da reprovação | `contrato.reprovado` |
| `AGUARDANDO_ASSINATURA → ATIVO` | Operador/webhook | Assinatura concluída ou dispensa registrada | Itens → `RESERVADO`; cria cronograma de faturamento | `contrato.ativado` |
| `ATIVO → SUSPENSO` | Gestor | Motivo e período informados | Interrompe faturamento; **mantém** alocação do ativo | `contrato.suspenso` |
| `SUSPENSO → ATIVO` | Gestor | — | Retoma faturamento com pro-rata | `contrato.retomado` |
| `ATIVO → EM_RENOVAÇÃO` | Sistema/Operador | Dentro da janela de vencimento | Sugere reajuste (`RN-008`) | `contrato.em_renovacao` |
| `EM_RENOVAÇÃO → ATIVO` | Operador | Nova vigência e valores definidos | Cria nova versão do contrato | `contrato.renovado` |
| `ATIVO → VENCIDO_EM_CAMPO` | Sistema | Data fim ultrapassada com itens em posse do cliente | Alerta crítico diário; criticidade no mapa (`RN-010`) | `contrato.vencido_em_campo` |
| `* → ENCERRADO` | Operador | Todos os itens devolvidos; pendência financeira quitada ou registrada (`F-CTR-12`) | Libera ativos; encerra cronograma | `contrato.encerrado` |
| `ATIVO → DISTRATADO` | Gestor com alçada | Antes do prazo mínimo | Calcula multa rescisória (`F-CTR-13`) | `contrato.distratado` |
| `pré-ATIVO → CANCELADO` | Operador | Nenhum item entregue | Libera reservas | `contrato.cancelado` |

**Item de contrato (`contrato_item`):**
`PLANEJADO → RESERVADO → EM_ENTREGA → ATIVO → (SUSPENSO) → EM_DEVOLUÇÃO → ENCERRADO`,
com `SUBSTITUÍDO` e `CANCELADO` como terminais alternativos.

---

## B.2 Equipamento

```
                     ┌──────────────┐
      cadastro ─────►│  DISPONÍVEL  │◄─────────────────────────────┐
                     └──┬────┬───┬──┘                              │
          alocar        │    │   │ bloquear (RN-014)               │ liberar / concluir
                        ▼    │   ▼                                 │
                 ┌───────────┐│ ┌────────────┐                     │
                 │ RESERVADO ││ │ BLOQUEADO  │──── desbloquear ────┤
                 └─────┬─────┘│ └────────────┘     (execução ou    │
              expedir  │      │                     alçada)        │
                       ▼      │                                    │
          ┌────────────────────┐                                   │
          │ EM_TRÂNSITO_ENTREGA│                                   │
          └─────────┬──────────┘                                   │
                    │ entregar (checklist + leitura inicial)       │
                    ▼                                             │
              ┌──────────┐  manutenção em campo   ┌──────────────┐ │
              │  LOCADO  │◄──────────────────────►│EM_MANUTENÇÃO │─┤
              └────┬─────┘                        └──────┬───────┘ │
       iniciar     │                                     ▲         │
       devolução   ▼                                     │         │
        ┌────────────────────┐                           │         │
        │ EM_TRÂNSITO_RETORNO│                           │         │
        └─────────┬──────────┘                           │         │
                  │ receber                              │         │
                  ▼                                      │         │
           ┌──────────────┐  divergência impeditiva      │         │
           │ EM_INSPEÇÃO  │──────────────────────────────┘         │
           └──────┬───────┘  (RN-006)                              │
                  │ aprovar inspeção                               │
                  └────────────────────────────────────────────────┘

        ┌─────────────┐        ┌──────────┐
        │  EXTRAVIADO │        │  BAIXADO │   (terminais)
        └─────────────┘        └──────────┘
```

| De → Para | Gatilho | Pré-condições | Efeitos | Evento |
| --- | --- | --- | --- | --- |
| `DISPONÍVEL → RESERVADO` | Ativação de contrato | Sem conflito de vigência (`RN-001`), sem bloqueio (`RN-003`) | Vincula `contrato_item` | `contrato.item.alocado` |
| `RESERVADO → EM_TRÂNSITO_ENTREGA` | Expedição | Romaneio emitido | Registra movimentação | `equipamento.movimentado` |
| `EM_TRÂNSITO_ENTREGA → LOCADO` | Entrega confirmada | Checklist de saída + leitura inicial + assinatura | Inicia faturamento na data/hora efetiva | `equipamento.movimentado` |
| `LOCADO → EM_TRÂNSITO_RETORNO` | Início da devolução | — | Registra movimentação | `equipamento.movimentado` |
| `EM_TRÂNSITO_RETORNO → EM_INSPEÇÃO` | Recebimento | Checklist de retorno + leitura final | Encerra período de faturamento | `contrato.item.encerrado` |
| `EM_INSPEÇÃO → DISPONÍVEL` | Inspeção aprovada | Nenhuma divergência impeditiva | Libera para nova alocação | `equipamento.disponibilizado` |
| `EM_INSPEÇÃO → EM_MANUTENÇÃO` | Divergência impeditiva | OS corretiva criada (`RN-006`) | Ativo indisponível | `os.aberta` |
| `LOCADO/DISPONÍVEL → EM_MANUTENÇÃO` | OS com impacto | `impacta_disponibilidade = true` (`RN-004`) | Sai da base alocável; inicia downtime | `os.aberta` |
| `EM_MANUTENÇÃO → estado anterior` | OS validada | Apontamento completo (`RN-015`) | Encerra downtime; consolida custo | `os.concluida` |
| `qualquer → BLOQUEADO` | Preventiva/laudo vencidos ou bloqueio manual | Alçada no bloqueio manual | Impede nova alocação (`RN-014`) | `equipamento.bloqueado` |
| `BLOQUEADO → DISPONÍVEL` | Preventiva executada ou liberação excepcional | Alçada + prazo + justificativa | Registra em auditoria | `equipamento.desbloqueado` |
| `DISPONÍVEL → EM_TRÂNSITO_ENTREGA` | Transferência entre filiais | Aceite pendente no destino (`RN-005`) | Não alocável em trânsito | `equipamento.movimentado` |
| `qualquer → EXTRAVIADO` | Registro de extravio | Boletim/ocorrência anexada | Abre processo de sinistro | `equipamento.extraviado` |
| `qualquer → BAIXADO` | Baixa de ativo | Sem alocação, OS, reserva ou saldo pendente (`RN-007`) | Efeito patrimonial; encerra timeline | `equipamento.baixado` |

---

## B.3 Ordem de Serviço

```
  ┌────────┐  triar   ┌─────────┐  agendar  ┌──────────┐  iniciar  ┌──────────────┐
  │ ABERTA │─────────►│ TRIAGEM │──────────►│ AGENDADA │──────────►│ EM_EXECUÇÃO  │
  └────────┘          └────┬────┘           └──────────┘           └──┬────────┬──┘
                           │ cancelar                       falta peça│        │ concluir
                           ▼                                          ▼        ▼
                    ┌────────────┐                    ┌────────────────┐  ┌────────────┐
                    │ CANCELADA  │                    │AGUARDANDO_PEÇA │  │ CONCLUÍDA  │
                    └────────────┘                    └───────┬────────┘  └──────┬─────┘
                                                    peça disponível              │ validar
                                                              │                  ▼
                                                              └──► EM_EXECUÇÃO   ┌──────────┐
                                                                                 │ VALIDADA │
                                          reabrir (reincidência) ◄────────────────└──────────┘
```

| De → Para | Ator | Pré-condições | Efeitos |
| --- | --- | --- | --- |
| `→ ABERTA` | Qualquer canal | Equipamento identificado | Inicia SLA (`RN-011`); ativo → `EM_MANUTENÇÃO` se impacta disponibilidade |
| `ABERTA → TRIAGEM` | Supervisor | — | Classifica tipo/prioridade; calcula prazos |
| `TRIAGEM → AGENDADA` | Supervisor | Técnico e data definidos | Reserva peças previstas |
| `AGENDADA → EM_EXECUÇÃO` | Técnico | *Check-in* realizado | Marca `resposta_em` (SLA de resposta) |
| `EM_EXECUÇÃO → AGUARDANDO_PEÇA` | Técnico | Peça indisponível | Pausa SLA com motivo (`RN-011`); alerta ao estoque |
| `AGUARDANDO_PEÇA → EM_EXECUÇÃO` | Sistema/Técnico | Peça disponível | Retoma SLA |
| `EM_EXECUÇÃO → CONCLUÍDA` | Técnico | Tempo apontado + destino de todas as peças + causa raiz + evidências (`RN-015`) | Consolida custo total |
| `CONCLUÍDA → VALIDADA` | Supervisor | Segregação: validador ≠ executor (`RN-027`) | Ativo retorna ao estado compatível; lança custo no resultado |
| `VALIDADA → ABERTA (nova OS)` | Supervisor | Reincidência do mesmo sintoma | Nova OS vinculada à original |
| `* → CANCELADA` | Supervisor | Antes da execução | Libera reservas de peça |

---

## B.4 Fatura

```
  ┌──────────┐  fechar   ┌───────────────┐  aprovar+emitir  ┌─────────┐
  │ PREVISTA │──────────►│ EM_FECHAMENTO │─────────────────►│ EMITIDA │
  └──────────┘           └───────┬───────┘                  └────┬────┘
                                 │ ajustar                       │
                                 └──► EM_FECHAMENTO         ┌────┴──────┬──────────────┐
                                                     pagto  │           │ vencer       │ cancelar
                                                    parcial ▼           ▼              ▼
                                                      ┌─────────┐  ┌───────────┐  ┌────────────┐
                                                      │ PARCIAL │  │EM_ATRASO  │  │ CANCELADA  │
                                                      └────┬────┘  └─────┬─────┘  └────────────┘
                                                  quitação │             │ pagamento
                                                           ▼             ▼
                                                       ┌──────┐    ┌──────┐
                                                       │ PAGA │◄───│ PAGA │
                                                       └──────┘    └──────┘
                                              ┌──────────────┐
                                              │ EM_DISPUTA   │◄── contestação do cliente
                                              └──────────────┘
```

| De → Para | Ator | Pré-condições | Efeitos |
| --- | --- | --- | --- |
| `PREVISTA → EM_FECHAMENTO` | Sistema (job) | Ciclo atingido | Gera itens e memória de cálculo |
| `EM_FECHAMENTO → EMITIDA` | Financeiro com alçada | Sem pendência de medição (`RN-021`); competência aberta | Fatura torna-se imutável (`RN-023`); cria recebível; dispara envio |
| `EMITIDA → PARCIAL` | Conciliação | Pagamento < saldo | Atualiza saldo |
| `EMITIDA/PARCIAL → PAGA` | Conciliação | Saldo zerado | Libera bloqueio comercial se aplicável (`RN-024`) |
| `EMITIDA/PARCIAL → EM_ATRASO` | Sistema (job diário) | Vencimento ultrapassado | Atualiza aging e `KPI-11`; aciona régua de cobrança |
| `EMITIDA → EM_DISPUTA` | Financeiro | Contestação registrada com motivo | Suspende régua de cobrança; abre tratativa |
| `EMITIDA → CANCELADA` | Financeiro com alçada | Dentro da janela permitida; regra fiscal atendida | Estorna recebível; exige documento de correção |
| `EMITIDA → (nota de crédito/débito)` | Financeiro | Correção fora da janela de cancelamento | Novo documento vinculado à fatura original |

---

## B.5 Movimento de estoque e reserva de peça

**Movimento de estoque** é *append-only*: não possui estados, apenas tipos (Anexo A.7). O que possui
ciclo de vida é a **reserva de peça na OS**:

```
  ┌────────────┐ atender ┌───────────┐ baixar  ┌────────────┐
  │ SOLICITADA │────────►│ RESERVADA │────────►│ CONSUMIDA  │
  └─────┬──────┘         └─────┬─────┘         └────────────┘
        │ sem saldo            │ não utilizada
        ▼                      ▼
  ┌──────────────┐       ┌────────────┐
  │ EM_FALTA     │       │ DEVOLVIDA  │
  └──────────────┘       └────────────┘
        │ cancelar OS           │
        └──────► CANCELADA ◄────┘
```

| Transição | Efeito no saldo |
| --- | --- |
| `SOLICITADA → RESERVADA` | `quantidade_reservada += qtd` (disponível diminui, físico inalterado) |
| `RESERVADA → CONSUMIDA` | `quantidade_fisica -= qtd`, `quantidade_reservada -= qtd`; gera `movimento_estoque` tipo `SAIDA_OS` com custo médio do instante (`RN-017`) |
| `RESERVADA → DEVOLVIDA` | `quantidade_reservada -= qtd`; físico inalterado |
| `SOLICITADA → EM_FALTA` | Sem efeito; OS → `AGUARDANDO_PEÇA`; alerta de reposição (`RN-016`) |
| `* → CANCELADA` | Libera reserva se existente |

---

## B.6 Competência de faturamento

```
  ┌────────┐ iniciar fechamento ┌───────────────┐ concluir ┌─────────┐
  │ ABERTA │───────────────────►│ EM_FECHAMENTO │─────────►│ FECHADA │
  └────────┘                    └───────┬───────┘          └────┬────┘
       ▲                                │ pendências           │ reabrir
       │                                └──► ABERTA            │ (alçada + motivo)
       │                                                       ▼
       └───────────────────────────────────────────────  ┌──────────┐
                        nova competência                 │ REABERTA │
                                                         └──────────┘
```

- `FECHADA` impõe `RN-022`: nenhum lançamento é criado, alterado ou excluído na competência.
- `REABERTA` registra escopo, motivo, autor e prazo; ao concluir, retorna a `FECHADA` com nova
  entrada no histórico de reaberturas.

---

## B.7 Matriz consolidada de estados terminais

| Entidade | Estados terminais | Reversível? |
| --- | --- | --- |
| Contrato | `ENCERRADO`, `CANCELADO`, `DISTRATADO` | Não — nova operação exige novo contrato |
| Contrato item | `ENCERRADO`, `SUBSTITUÍDO`, `CANCELADO` | Não |
| Equipamento | `BAIXADO` | Não — reversão exige registro de estorno auditado |
| Equipamento | `EXTRAVIADO` | Sim — recuperação retorna a `EM_INSPEÇÃO` |
| Ordem de serviço | `VALIDADA`, `CANCELADA` | Não — reincidência gera nova OS vinculada |
| Fatura | `PAGA`, `CANCELADA` | Não — correção por documento vinculado (`RN-023`) |
| Competência | `FECHADA` | Sim, apenas por alçada (`REABERTA`) |
| Reserva de peça | `CONSUMIDA`, `DEVOLVIDA`, `CANCELADA` | Não |
