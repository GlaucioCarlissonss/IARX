# 8. Fluxos Operacionais

Os fluxos abaixo são normativos: definem etapas, atores, validações aplicadas e o estado resultante.
Cada fluxo declara o número máximo de interações-alvo, critério de aceite de usabilidade da seção 9.

---

## 8.1 Jornada operacional consolidada (visão macro)

```
  CADASTRO           CONTRATAÇÃO            EXECUÇÃO                 MONETIZAÇÃO
┌──────────┐      ┌───────────────┐    ┌──────────────────┐     ┌──────────────────┐
│ Cliente  │      │ Contrato      │    │ Entrega          │     │ Medição          │
│ Local    │─────►│ Itens/preço   │───►│ Uso em campo     │────►│ Fechamento       │
│ Ativo    │      │ Assinatura    │    │ Manutenção       │     │ Fatura           │
│ Peça     │      │ Ativação      │    │ Retorno/inspeção │     │ Recebimento      │
└──────────┘      └───────────────┘    └──────────────────┘     └──────────────────┘
      │                   │                     │                       │
      └───────────────────┴──────────┬──────────┴───────────────────────┘
                                     ▼
                        ┌──────────────────────────┐
                        │  RESULTADO E DECISÃO     │
                        │  Rentabilidade · Ocupação │
                        │  SLA · Renovação · Compra │
                        └──────────────────────────┘
```

---

## 8.2 Fluxo de cadastro

### 8.2.1 Cadastro de equipamento
**Ator:** P1 Administrativo / P8 TI · **Alvo:** ≤ 90 s por ativo (ou lote via importação)

1. Escolha do **modelo** no catálogo → herda categoria, fabricante, tipo de medidor, plano
   preventivo padrão e preço de tabela.
2. Informar **patrimônio** e **série** → validação de unicidade imediata (`RN-002`).
3. Informar dados patrimoniais (aquisição, NF, vida útil) — opcionais no cadastro, exigidos para
   cálculo de rentabilidade (`KPI-14`).
4. Definir filial/base de origem e leitura inicial do medidor.
5. **Salvar** → ativo criado em `DISPONÍVEL`, etiqueta QR gerada e disponível para impressão.

*Carga inicial:* importação por planilha com validação linha a linha; nenhuma linha inválida é
importada parcialmente.

### 8.2.2 Cadastro de cliente e local de operação
1. Informar CNPJ/CPF → enriquecimento assistido (`F-CTR-15`), com edição livre.
2. Definir condição de pagamento padrão, limite de crédito e contatos por função.
3. Cadastrar **local de operação** (obra/site) com endereço → geocodificação automática, ajuste
   manual do marcador quando necessário.
4. Resultado: cliente apto a contratar; locais disponíveis para alocação e exibição no mapa.

### 8.2.3 Cadastro de peça
1. Código interno + código do fabricante + descrição + unidade.
2. Vincular **aplicação** (modelos compatíveis) → habilita sugestão automática na OS.
3. Definir depósito, mínimo, ponto de pedido e fornecedor preferencial.
4. Entrada inicial de saldo por movimento de entrada (nunca por edição direta de saldo).

---

## 8.3 Fluxo de locação (contratação → ativação)

**Atores:** P1 Administrativo, P6 Gestor (aprovação), P4 Logística (entrega) · **Alvo:** ≤ 3 min

```
[1] Novo contrato          [2] Itens e preço         [3] Documentos          [4] Ativação
 Cliente + local            Categoria/ativo           Minuta gerada          Confirmação de itens
 Vigência + ciclo           Modalidade cobrança       Envio p/ assinatura    Estado → ATIVO
 Condição de pagto          Franquia/excedente        Status assinatura      Cronograma faturamento
      │                          │                         │                      │
      │                    valida RN-001/003/024      valida RN-009          valida RN-003
      ▼                          ▼                         ▼                      ▼
  RASCUNHO ──────────► EM_APROVAÇÃO ──────► AGUARDANDO_ASSINATURA ──────────► ATIVO
```

**Detalhamento:**

1. **Abertura (RASCUNHO)** — cliente, local, vigência, ciclo de faturamento e responsável comercial.
   Se o cliente estiver em observação/bloqueio, aviso imediato no topo do formulário (`RN-024`).
2. **Itens** — busca por categoria com **disponibilidade em tempo real** no período informado.
   Escolha por ativo específico (garantia de patrimônio) ou por categoria (definição na entrega).
   Preço sugerido pela tabela, com desconto sujeito a alçada (`RN-009`).
3. **Aprovação** — exigida se houver desconto acima da alçada, prazo especial ou cliente em
   observação. Caso contrário, o contrato segue direto para assinatura.
4. **Assinatura** — minuta gerada do *template*; envio ao signatário; retorno automático de status
   quando integrado a provedor de assinatura (`F-CTR-32`).
5. **Ativação** — confirma itens e datas: ativos passam a `RESERVADO`, é criado o cronograma de
   faturamento e publicado `contrato.ativado`.
6. **Programação de entrega** — gera tarefa de logística com romaneio e checklist de saída.

**Caminhos alternativos:**
- Ativo indisponível → sugere ativos equivalentes da categoria, ou reserva para data futura.
- Cliente bloqueado → contrato permanece em `EM_APROVAÇÃO` até liberação por alçada, com motivo.
- Assinatura recusada → retorna a `RASCUNHO` mantendo o histórico da tentativa.

---

## 8.4 Fluxo de movimentação de equipamentos

### 8.4.1 Entrega (saída)
**Ator:** P4 Logística (mobile) · **Alvo:** ≤ 6 toques por ativo

1. Abrir a tarefa de entrega do dia (lista já filtrada por rota/filial).
2. **Escanear QR** de cada ativo → conferência automática contra o romaneio; divergência é destacada.
3. Executar **checklist de saída** (itens obrigatórios, foto do estado, acessórios).
4. Registrar leitura inicial do medidor.
5. Coletar assinatura do recebedor (nome + documento + assinatura em tela).
6. **Confirmar** → ativos passam a `LOCADO`, posição vinculada ao local do cliente, início efetivo do
   faturamento na data/hora da entrega (base do pro-rata), evento `equipamento.movimentado` publicado.

*Offline:* toda a conferência funciona sem rede; sincroniza ao reconectar (7.4.1).

### 8.4.2 Retorno (devolução)
1. Escanear QR na chegada → ativo passa a `EM_TRÂNSITO_RETORNO` ou direto a `EM_INSPEÇÃO`.
2. **Checklist de retorno** com comparação lado a lado das fotos de saída.
3. Registrar leitura final → consumo do período consolidado para faturamento.
4. Divergência/avaria → pendência e, se impeditiva, OS corretiva automática (`RN-006`);
   avaria além do desgaste natural gera proposta de recobrança sujeita a aprovação.
5. Sem pendência → `DISPONÍVEL`; item do contrato encerrado com data/hora efetiva (pro-rata final).

### 8.4.3 Transferência entre filiais
1. Solicitação na filial de origem (motivo, destino, transportador, previsão).
2. Ativo → `EM_TRÂNSITO_ENTREGA`; não alocável (`RN-005`).
3. **Aceite no destino** com conferência por QR; divergência abre ocorrência de logística.
4. Ativo → `DISPONÍVEL` na filial de destino; custo de logística lançado no ativo.

---

## 8.5 Fluxo de manutenção

**Atores:** P2 Técnico, P3 Supervisor · **Alvo (técnico):** ≤ 6 toques para fechar OS simples

```
 Origem do chamado                Triagem              Execução                Encerramento
┌──────────────────┐        ┌────────────────┐    ┌────────────────┐     ┌──────────────────┐
│ Cliente/portal   │        │ Tipo, sintoma  │    │ Check-in       │     │ Causa raiz       │
│ Técnico (QR)     │───────►│ Prioridade+SLA │───►│ Peças (baixa)  │────►│ Evidências       │
│ Alerta preventivo│        │ Técnico+agenda │    │ Tempo apontado │     │ Assinatura       │
│ Checklist retorno│        │ Reserva peça   │    │ Pausas c/motivo│     │ Validação superv.│
└──────────────────┘        └────────────────┘    └────────────────┘     └──────────────────┘
   ABERTA ──────────► TRIAGEM ──► AGENDADA ──► EM_EXECUÇÃO ⇄ AGUARDANDO_PEÇA ──► CONCLUÍDA ──► VALIDADA
```

**Detalhamento:**

1. **Abertura** — por qualquer canal (`F-MNT-01`). Se houver impacto de indisponibilidade, o ativo
   vai a `EM_MANUTENÇÃO` e sai da base alocável (`RN-004`); o SLA inicia (`RN-011`).
2. **Triagem** — supervisor classifica tipo, sintoma e prioridade; sistema calcula prazos e sugere
   técnico por especialidade, carga e proximidade. Peças previstas são reservadas (`F-EST-05`).
3. **Execução** — técnico faz *check-in* (com geolocalização), aponta tempo, baixa peças efetivamente
   usadas, anexa fotos antes/depois. Falta de peça → `AGUARDANDO_PEÇA` com pausa de SLA justificada.
4. **Conclusão** — obrigatórios: tempo apontado, destino de todas as peças reservadas, causa raiz e
   evidências (`RN-015`). Assinatura do cliente quando em campo.
5. **Validação** — supervisor valida; ativo retorna ao estado compatível; custos consolidados
   (mão de obra + material + terceiros + deslocamento) são lançados no ativo e no resultado.
6. **Efeito contratual** — a classificação da causa determina abatimento pro-rata, substituição ou
   recobrança (`RN-012`).

### 8.5.1 Preventiva automática
1. Leitura de medidor ou calendário atinge o gatilho do plano (`RN-013`).
2. Sistema gera OS preventiva antecipada, com tarefas e peças previstas, dentro da janela.
3. Alertas em 80% e 95% do intervalo; escalonamento ao vencer.
4. Vencida a tolerância → ativo `BLOQUEADO` para novas alocações (`RN-014`), com liberação
   excepcional apenas por alçada, prazo e justificativa auditada.

---

## 8.6 Fluxo de faturamento (medição → emissão)

**Atores:** P5 Financeiro (condutor), P1 Administrativo (pendências) · **Alvo:** ≤ 1 dia útil

```
 D-3 ─────────────► D0 (fechamento) ─────────► D+1 (emissão) ─────────► D+n (recebimento)
┌──────────────┐   ┌────────────────────┐   ┌───────────────────┐   ┌────────────────────┐
│ Coleta de    │   │ Pré-faturas        │   │ Emissão em lote   │   │ Baixa/conciliação  │
│ leituras     │──►│ Memória de cálculo │──►│ NF + boleto/PIX   │──►│ Régua de cobrança  │
│ Pendências   │   │ Conferência exceção│   │ Envio ao cliente  │   │ Aging/inadimplência│
└──────────────┘   └────────────────────┘   └───────────────────┘   └────────────────────┘
```

**Detalhamento:**

1. **Preparação (D-3)** — painel de pendências de medição lista itens sem leitura; solicitação
   automática ao responsável/técnico/cliente. Medição faltante bloqueia o item (`RN-021`).
2. **Geração da pré-fatura (D0)** — o motor aplica, por item: modalidade, franquia e excedente,
   pro-rata de entrada/saída/suspensão, acessórios, reajuste vigente, descontos e mínimo mensal
   (Anexo E). Cada valor traz memória de cálculo navegável até a origem.
3. **Conferência por exceção** — o painel destaca apenas o que fugiu do padrão: variação relevante
   contra o mês anterior, item estimado, desconto novo, primeira/última competência, valor zero.
4. **Aprovação** — individual ou em lote, respeitando alçada por valor.
5. **Emissão** — em lote, com pré-validação de bloqueios (cadastro fiscal incompleto, cliente sem
   e-mail, competência não fechada). Fatura emitida torna-se imutável (`RN-023`) e gera recebível.
6. **Envio e cobrança** — PDF + boleto/PIX por e-mail/WhatsApp; régua de cobrança automática
   (D-3, D0, D+1, D+7, D+15, D+30) com escalonamento e efeito de bloqueio comercial (`RN-024`).
7. **Fechamento formal da competência** — bloqueia lançamentos retroativos (`RN-022`); divergências
   posteriores viram acerto na competência corrente.

---

## 8.7 Fluxo financeiro (resultado)

1. **Entradas automáticas:** `fatura.emitida` → contas a receber; `os.concluida` → custo de serviço;
   `peca.consumida` → custo de material; compras → contas a pagar; depreciação mensal por ativo.
2. **Conciliação:** importação de retorno bancário/gateway, baixa automática por identificador e
   fila de exceções para tratamento manual.
3. **Alocação:** todo lançamento recebe destino de rateio — ativo, contrato, categoria ou centro de
   custo (`RN-025`).
4. **Apuração:** margem por ativo, por contrato, por cliente e por filial recalculada continuamente.
5. **Painéis:** operacional (exceções do dia), gerencial (filial/carteira), executivo (tendência).
6. **Saídas:** exportação para ERP/contabilidade e relatórios agendados por e-mail.

---

## 8.8 Navegação e estrutura de menus

**Princípio:** no máximo **2 níveis** de menu; toda entidade acessível por busca global (`⌘/Ctrl+K`).

```
◉ Início                      → dashboard por perfil (operacional ou executivo)
◉ Operação
   ├ Contratos                → lista, renovações, vencendo, rascunhos
   ├ Equipamentos             → frota, disponibilidade, ociosidade, bloqueados
   ├ Movimentações            → entregas do dia, retornos, transferências, romaneios
   └ Mapa                     → visão geográfica com filtros salvos
◉ Manutenção
   ├ Chamados & OS            → fila priorizada por SLA
   ├ Agenda técnica           → dia/semana por técnico e oficina
   └ Preventivas              → programadas, em risco, vencidas
◉ Estoque
   ├ Peças                    → catálogo, saldos, curva ABC
   ├ Movimentações            → entradas, saídas, transferências, ajustes
   └ Reposição & Inventário   → sugestões de compra, contagens
◉ Financeiro
   ├ Faturamento              → fechamento, pré-faturas, faturas
   ├ Recebíveis               → aging, cobrança, negociações
   ├ Pagáveis                 → aprovações, agenda de pagamento
   └ Resultados               → rentabilidade, fluxo de caixa, DRE gerencial
◉ Relatórios                  → biblioteca, agendamentos, exportações
◉ Administração               → usuários, perfis, parametrizações, integrações, auditoria
```

**Elementos globais persistentes:** busca/command palette, seletor de filial/escopo, central de
alertas com contador, ações rápidas (+ Contrato, + OS, + Movimentação, Escanear QR), perfil e ajuda.

---

## 8.9 Ações rápidas por perfil (atalho da tela inicial)

| Perfil | Ações em destaque na tela inicial |
| --- | --- |
| P1 Administrativo | Novo contrato · Registrar devolução · Localizar ativo · Renovações do mês |
| P2 Técnico | Escanear QR · Minhas OS de hoje · Apontar leitura · Requisitar peça |
| P3 Supervisor | Fila de SLA em risco · Agenda do dia · Preventivas vencidas · Aprovar custo |
| P4 Logística | Entregas do dia · Retornos previstos · Conferir romaneio · Transferências |
| P5 Financeiro | Fechamento do ciclo · Pendências de medição · Emitir em lote · Inadimplentes |
| P6 Gestor | Ativos parados · Contratos vencendo · Ocupação da filial · Exceções abertas |
| P7 Diretor | Receita e margem · Ocupação consolidada · Inadimplência · Comparativo de filiais |
