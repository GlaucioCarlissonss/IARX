# Anexo C — Matriz de Permissões

## C.1 Modelo

```
Autorização = possui(permissão)  AND  registro ∈ escopo(usuário)  AND  satisfaz(alçada/política)
```

- **Permissão:** `recurso:ação` — granular, atômica, negada por padrão (`RN-026`).
- **Escopo:** `TENANT` · `EMPRESA` · `FILIAL` · `REGIAO` · `PROPRIO` (apenas registros do usuário).
- **Alçada:** limite por valor/percentual avaliado pelo motor de regras, independente da permissão.
- **Segregação de funções:** restrições estruturais que nenhuma permissão sobrepõe (`RN-027`).

Um usuário pode ter múltiplos perfis, cada um com escopo próprio (ex.: `Supervisor de Manutenção`
na filial SP e `Consulta` no tenant).

---

## C.2 Catálogo de permissões

### Contratos e clientes
| Permissão | Descrição |
| --- | --- |
| `cliente:ler` / `cliente:criar` / `cliente:editar` / `cliente:inativar` | Cadastro de clientes |
| `cliente:credito_definir` | Definir limite de crédito e situação |
| `local_operacao:gerenciar` | Criar/editar locais de operação |
| `contrato:ler` / `contrato:criar` / `contrato:editar` | Ciclo de cadastro |
| `contrato:aprovar` | Aprovar contrato em `EM_APROVAÇÃO` |
| `contrato:ativar` | Ativar contrato assinado |
| `contrato:suspender` / `contrato:retomar` | Suspensão temporária |
| `contrato:renovar` | Renovação e nova vigência |
| `contrato:encerrar` / `contrato:cancelar` / `contrato:distratar` | Terminais |
| `contrato:item_alocar` / `contrato:item_substituir` / `contrato:item_encerrar` | Gestão de itens |
| `contrato:desconto_conceder` | Conceder desconto (limitado por alçada) |
| `contrato:reajuste_aprovar` | Aprovar/aplicar reajuste |
| `contrato:anexo_gerenciar` | Anexos e documentos |

### Equipamentos
| Permissão | Descrição |
| --- | --- |
| `equipamento:ler` / `equipamento:criar` / `equipamento:editar` | Cadastro |
| `equipamento:importar` | Carga em massa |
| `equipamento:patrimonial_editar` | Valor de aquisição, vida útil, depreciação |
| `equipamento:movimentar` | Entrega, retorno, envio a terceiro |
| `equipamento:transferir` / `equipamento:transferencia_aceitar` | Entre filiais |
| `equipamento:bloquear` / `equipamento:desbloquear` | Bloqueio operacional |
| `equipamento:baixar` | Baixa de ativo |
| `equipamento:leitura_registrar` / `equipamento:leitura_estornar` | Medição |
| `equipamento:etiqueta_gerar` | QR Code / etiquetas |
| `catalogo:gerenciar` | Fabricantes, modelos, categorias |

### Manutenção
| Permissão | Descrição |
| --- | --- |
| `os:ler` / `os:criar` | Chamados e OS |
| `os:triar` / `os:atribuir` / `os:agendar` | Despacho |
| `os:executar` | Apontar tempo, peças e evidências |
| `os:concluir` | Encerrar execução |
| `os:validar` | Validação supervisória |
| `os:cancelar` / `os:reabrir` | Exceções |
| `os:custo_aprovar` | Aprovar OS acima do limite (alçada) |
| `os:sla_pausar` | Registrar pausa de SLA |
| `plano_preventivo:gerenciar` | Planos e gatilhos |
| `tecnico:gerenciar` | Cadastro e capacidade de técnicos |

### Peças e estoque
| Permissão | Descrição |
| --- | --- |
| `peca:ler` / `peca:criar` / `peca:editar` | Cadastro |
| `estoque:movimentar` | Entradas, saídas e transferências |
| `estoque:reservar` | Reserva para OS |
| `estoque:ajustar` | Ajuste de saldo (alçada + inventário) |
| `estoque:politica_definir` | Mínimo, ponto de pedido, lote |
| `inventario:executar` / `inventario:aprovar` | Contagem e aprovação |
| `fornecedor:gerenciar` | Cadastro de fornecedores |
| `ordem_compra:criar` / `ordem_compra:aprovar` / `ordem_compra:receber` | Reposição |

### Faturamento
| Permissão | Descrição |
| --- | --- |
| `medicao:ler` / `medicao:consolidar` / `medicao:estimar` | Consumo do período |
| `fatura:ler` | Consulta |
| `prefatura:gerar` / `prefatura:editar` / `prefatura:aprovar` | Fechamento |
| `fatura:emitir` | Emissão (alçada por valor) |
| `fatura:cancelar` | Cancelamento |
| `fatura:nota_correcao` | Nota de crédito/débito |
| `fatura:desconto_aplicar` | Desconto na fatura (alçada) |
| `competencia:fechar` / `competencia:reabrir` | Controle de competência |
| `faturamento:exportar` | Exportações |

### Financeiro
| Permissão | Descrição |
| --- | --- |
| `receber:ler` / `receber:baixar` / `receber:negociar` | Contas a receber |
| `pagar:ler` / `pagar:criar` / `pagar:aprovar` / `pagar:baixar` | Contas a pagar |
| `conciliacao:executar` | Conciliação bancária |
| `financeiro:lancamento_manual` | Ajuste manual (com justificativa) |
| `financeiro:centro_custo_gerenciar` | Estrutura de custo e rateio |
| `financeiro:painel_executivo` | Painel de resultado |
| `financeiro:rentabilidade_ler` | Rentabilidade por cliente/ativo |
| `financeiro:exportar` | Exportações contábeis |

### Mapa, relatórios e administração
| Permissão | Descrição |
| --- | --- |
| `mapa:ler` / `mapa:filtro_compartilhar` | Visualização geográfica |
| `relatorio:ler` / `relatorio:criar` / `relatorio:agendar` | Relatórios |
| `usuario:gerenciar` / `perfil:gerenciar` / `alcada:definir` | IAM |
| `parametro:gerenciar` | Parametrizações do tenant |
| `integracao:gerenciar` / `apikey:gerenciar` / `webhook:gerenciar` | Integrações |
| `auditoria:consultar` | Trilha de auditoria |
| `dados_sensiveis:ver_completo` | Exibir documentos/contatos sem máscara (auditado) |

---

## C.3 Perfis-base

Perfis de referência entregues no provisionamento; cada tenant pode derivar os seus.

| Perfil | Escopo típico | Finalidade |
| --- | --- | --- |
| `Administrador da Plataforma` | `TENANT` | Configuração, IAM, integrações, auditoria |
| `Diretor` | `TENANT` | Visão executiva e alçadas máximas |
| `Gestor de Filial` | `FILIAL` | Operação e resultado da filial |
| `Operador Administrativo` | `FILIAL` | Contratos, clientes, movimentações |
| `Coordenador de Logística` | `FILIAL` | Movimentações, romaneios, transferências |
| `Supervisor de Manutenção` | `FILIAL`/`REGIAO` | Triagem, agenda, validação, estoque |
| `Técnico de Manutenção` | `PROPRIO` | Execução de OS e leituras |
| `Analista Financeiro` | `EMPRESA` | Faturamento, recebíveis, pagáveis |
| `Consulta` | `FILIAL`/`TENANT` | Somente leitura |
| `Integração (conta de serviço)` | `TENANT` | Escopos mínimos declarados por integração |

---

## C.4 Matriz perfil × permissão

Legenda: **✔** concedida · **◐** concedida com alçada/condição · **○** somente leitura · **—** negada

| Permissão (agrupada) | Admin | Diretor | Gestor Filial | Oper. Admin | Logística | Superv. Mnt | Técnico | Financeiro | Consulta |
| --- | :--: | :--: | :--: | :--: | :--: | :--: | :--: | :--: | :--: |
| `cliente:ler` | ✔ | ✔ | ✔ | ✔ | ○ | ○ | — | ✔ | ○ |
| `cliente:criar/editar` | ✔ | — | ✔ | ✔ | — | — | — | ◐ | — |
| `cliente:credito_definir` | ✔ | ✔ | ◐ | — | — | — | — | ✔ | — |
| `contrato:ler` | ✔ | ✔ | ✔ | ✔ | ○ | ○ | ○¹ | ✔ | ○ |
| `contrato:criar/editar` | ✔ | — | ✔ | ✔ | — | — | — | — | — |
| `contrato:aprovar` | ✔ | ✔ | ◐ | — | — | — | — | — | — |
| `contrato:ativar` | ✔ | — | ✔ | ✔ | — | — | — | — | — |
| `contrato:suspender/retomar` | ✔ | ✔ | ✔ | ◐ | — | — | — | — | — |
| `contrato:renovar` | ✔ | ✔ | ✔ | ✔ | — | — | — | — | — |
| `contrato:cancelar/distratar` | ✔ | ✔ | ◐ | — | — | — | — | — | — |
| `contrato:item_alocar/substituir` | ✔ | — | ✔ | ✔ | ✔ | — | — | — | — |
| `contrato:desconto_conceder` | ✔ | ✔ | ◐ | ◐ | — | — | — | ◐ | — |
| `contrato:reajuste_aprovar` | ✔ | ✔ | ◐ | — | — | — | — | ◐ | — |
| `equipamento:ler` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ○ | ○ |
| `equipamento:criar/editar` | ✔ | — | ✔ | ✔ | ◐ | ◐ | — | — | — |
| `equipamento:patrimonial_editar` | ✔ | ✔ | ◐ | — | — | — | — | ✔ | — |
| `equipamento:movimentar` | ✔ | — | ✔ | ✔ | ✔ | ✔ | ◐² | — | — |
| `equipamento:transferir/aceitar` | ✔ | — | ✔ | ◐ | ✔ | — | — | — | — |
| `equipamento:bloquear` | ✔ | ✔ | ✔ | — | — | ✔ | ◐³ | — | — |
| `equipamento:desbloquear` | ✔ | ✔ | ◐ | — | — | ◐ | — | — | — |
| `equipamento:baixar` | ✔ | ✔ | — | — | — | — | — | — | — |
| `equipamento:leitura_registrar` | ✔ | — | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| `equipamento:leitura_estornar` | ✔ | — | ◐ | ◐ | — | ◐ | — | ◐ | — |
| `catalogo:gerenciar` | ✔ | — | ◐ | ◐ | — | ✔ | — | — | — |
| `os:ler` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ○ | ○ |
| `os:criar` | ✔ | — | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| `os:triar/atribuir/agendar` | ✔ | — | ◐ | — | — | ✔ | — | — | — |
| `os:executar` | ✔ | — | — | — | — | ✔ | ✔ | — | — |
| `os:concluir` | ✔ | — | — | — | — | ✔ | ✔ | — | — |
| `os:validar` | ✔ | — | ◐ | — | — | ✔⁴ | — | — | — |
| `os:cancelar/reabrir` | ✔ | — | ◐ | — | — | ✔ | — | — | — |
| `os:custo_aprovar` | ✔ | ✔ | ◐ | — | — | ◐ | — | — | — |
| `plano_preventivo:gerenciar` | ✔ | — | ◐ | — | — | ✔ | — | — | — |
| `peca:ler` | ✔ | ○ | ✔ | ○ | ✔ | ✔ | ✔ | ○ | ○ |
| `peca:criar/editar` | ✔ | — | ◐ | — | — | ✔ | — | — | — |
| `estoque:movimentar` | ✔ | — | ◐ | — | ✔ | ✔ | ◐⁵ | — | — |
| `estoque:ajustar` | ✔ | ✔ | ◐ | — | — | ◐ | — | — | — |
| `inventario:executar` | ✔ | — | ✔ | — | ✔ | ✔ | ✔ | — | — |
| `inventario:aprovar` | ✔ | ✔ | ✔ | — | — | ◐⁶ | — | — | — |
| `ordem_compra:criar` | ✔ | — | ✔ | — | — | ✔ | — | ✔ | — |
| `ordem_compra:aprovar` | ✔ | ✔ | ◐ | — | — | — | — | ◐ | — |
| `medicao:consolidar` | ✔ | — | ✔ | ✔ | — | — | — | ✔ | — |
| `medicao:estimar` | ✔ | ✔ | ◐ | — | — | — | — | ◐ | — |
| `prefatura:gerar/editar/aprovar` | ✔ | ○ | ◐ | ◐ | — | — | — | ✔ | ○ |
| `fatura:emitir` | ✔ | ✔ | — | — | — | — | — | ◐ | — |
| `fatura:cancelar` | ✔ | ✔ | — | — | — | — | — | ◐ | — |
| `fatura:desconto_aplicar` | ✔ | ✔ | ◐ | — | — | — | — | ◐ | — |
| `competencia:fechar` | ✔ | ✔ | — | — | — | — | — | ✔ | — |
| `competencia:reabrir` | ✔ | ✔ | — | — | — | — | — | ◐ | — |
| `receber:baixar/negociar` | ✔ | ✔ | — | — | — | — | — | ✔ | — |
| `pagar:criar/baixar` | ✔ | — | — | — | — | — | — | ✔ | — |
| `pagar:aprovar` | ✔ | ✔ | ◐ | — | — | — | — | ◐⁷ | — |
| `conciliacao:executar` | ✔ | — | — | — | — | — | — | ✔ | — |
| `financeiro:lancamento_manual` | ✔ | ✔ | — | — | — | — | — | ◐ | — |
| `financeiro:painel_executivo` | ✔ | ✔ | ◐⁸ | — | — | — | — | ✔ | ○ |
| `financeiro:rentabilidade_ler` | ✔ | ✔ | ◐⁸ | — | — | — | — | ✔ | — |
| `financeiro:exportar` | ✔ | ✔ | — | — | — | — | — | ✔ | — |
| `mapa:ler` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ○¹ | — | ○ |
| `relatorio:ler` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ○ | ✔ | ○ |
| `usuario:gerenciar` / `perfil:gerenciar` | ✔ | ○ | — | — | — | — | — | — | — |
| `alcada:definir` | ✔ | ✔ | — | — | — | — | — | — | — |
| `parametro:gerenciar` | ✔ | — | — | — | — | — | — | — | — |
| `integracao:gerenciar` / `apikey:gerenciar` | ✔ | — | — | — | — | — | — | — | — |
| `auditoria:consultar` | ✔ | ✔ | ◐⁸ | — | — | — | — | ◐ | — |
| `dados_sensiveis:ver_completo` | ✔ | ✔ | ◐ | ◐ | — | — | — | ✔ | — |

**Notas de condição:**
1. Técnico vê apenas contratos/mapa dos ativos das OS atribuídas a ele.
2. Técnico movimenta apenas entrada/saída de manutenção dos ativos das próprias OS.
3. Técnico pode sinalizar bloqueio por condição insegura; a efetivação requer supervisor.
4. Supervisor não pode validar OS que ele mesmo executou (`RN-027`).
5. Técnico movimenta apenas o depósito do próprio veículo e baixas nas próprias OS.
6. Supervisor não aprova inventário que ele mesmo contou (`RN-027`).
7. Analista financeiro não aprova pagamento de fornecedor que ele mesmo cadastrou (`RN-027`).
8. Restrito ao escopo da filial/região do usuário.

---

## C.5 Alçadas por valor (padrão sugerido)

| Tipo de alçada | Operador | Gestor de Filial | Analista Financeiro | Supervisor Mnt | Diretor |
| --- | --- | --- | --- | --- | --- |
| Desconto em contrato/fatura | até 5% | até 15% | até 10% | — | sem limite |
| Emissão de fatura | — | — | até R$ 50 mil | — | sem limite |
| Cancelamento de fatura | — | — | até R$ 10 mil | — | sem limite |
| Reabertura de competência | — | — | ◐ com registro | — | ✔ |
| Custo de OS | — | até R$ 10 mil | — | até R$ 5 mil | sem limite |
| Ajuste de inventário | — | até R$ 5 mil | — | até R$ 2 mil | sem limite |
| Liberação de bloqueio de preventiva | — | ◐ prazo ≤ 15 dias | — | ◐ prazo ≤ 7 dias | ✔ |
| Liberação de cliente bloqueado | — | ◐ ≤ 30 dias atraso | ◐ ≤ 30 dias atraso | — | ✔ |
| Aprovação de contas a pagar | — | até R$ 20 mil | até R$ 20 mil | — | sem limite |

Valores são parametrizáveis por tenant. Toda operação dentro de alçada exige justificativa e gera
registro de auditoria (`RN-018`).

---

## C.6 Segregação de funções — restrições estruturais

| Restrição | Regra |
| --- | --- |
| Desconto | Quem concede acima da própria alçada não pode aprovar o próprio pedido |
| Inventário | Contador ≠ aprovador do ajuste |
| Ordem de serviço | Executor ≠ validador |
| Fornecedor e pagamento | Quem cadastra o fornecedor não aprova seu pagamento |
| Fatura | Quem gera a pré-fatura pode emitir; quem cancela exige alçada distinta em valores relevantes |
| Competência | Quem fecha pode reabrir apenas com alçada própria e motivo registrado |
| Permissões | Administrador não pode conceder a si próprio alçada financeira sem aprovação de diretoria |
| Auditoria | Nenhum perfil altera ou exclui registros de auditoria |

Exceções são parametrizáveis por tenant; a ativação de qualquer exceção é registrada em auditoria e
exibida no painel de conformidade.

---

## C.7 Contas de serviço e acesso externo

| Tipo | Escopo padrão | Controles |
| --- | --- | --- |
| Integração ERP | `financeiro:exportar`, `fatura:ler`, `receber:ler`, `pagar:ler` | Chave rotativa, IP allowlist opcional, *rate limit* |
| Integração fiscal | `fatura:ler`, `fatura:nota_fiscal_atualizar` | Somente callbacks assinados |
| Telemetria | `equipamento:leitura_registrar`, `equipamento:posicao_atualizar` | Volume alto: fila dedicada, sem acesso a dados comerciais |
| Portal do cliente | `contrato:ler`, `fatura:ler`, `os:criar`, `os:ler` — restrito ao próprio cliente | Escopo `PROPRIO` por `cliente_id` |
| Dispositivo de campo | `os:executar`, `os:concluir`, `equipamento:leitura_registrar`, `equipamento:movimentar` | Token revogável por dispositivo, expiração curta |
| Suporte técnico | Sessão temporária com motivo | Prazo curto, auditoria integral, notificação ao administrador do tenant |
