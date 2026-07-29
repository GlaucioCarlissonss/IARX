# 4. Estrutura dos Módulos

## 4.1 Organização modular

A plataforma é organizada em **7 módulos de negócio** e **8 serviços transversais**. Cada módulo
possui fronteira de domínio explícita, entidades próprias e contrato de integração público
(eventos + API interna). Nenhum módulo acessa a tabela de outro diretamente: a comunicação ocorre
por *service interface* (síncrona) ou por evento de domínio (assíncrona).

| Código | Módulo | Agregado raiz | Responsabilidade única |
| --- | --- | --- | --- |
| `CTR` | Contratos & Clientes | `Contrato` | Governar o vínculo comercial e a vigência das alocações |
| `EQP` | Equipamentos & Frota | `Equipamento` | Ser a fonte da verdade sobre identidade, estado e histórico do ativo |
| `MAP` | Mapa Operacional | *(projeção)* | Representar espacialmente frota, clientes e criticidades |
| `FAT` | Faturamento & Consumo | `Fatura`, `Medicao` | Converter contrato + consumo em documento de cobrança |
| `MNT` | Manutenção & SLA | `OrdemServico` | Manter o ativo disponível dentro de prazo e custo |
| `EST` | Peças & Estoque | `Peca`, `MovimentoEstoque` | Garantir disponibilidade de insumo e custo correto de material |
| `FIN` | Financeiro | `LancamentoFinanceiro` | Consolidar receita, custo, caixa e resultado |

| Código | Serviço transversal | Responsabilidade |
| --- | --- | --- |
| `IAM` | Identidade & Acesso | Autenticação, perfis, permissões, escopos organizacionais |
| `AUD` | Auditoria | Trilha imutável de alterações e acessos sensíveis |
| `NTF` | Notificações & Alertas | Regras de alerta, canais (in-app, e-mail, push, WhatsApp), preferências |
| `DOC` | Anexos & Documentos | Armazenamento, versionamento, assinatura e retenção de arquivos |
| `RUL` | Motor de Regras | Avaliação de políticas parametrizáveis por tenant (bloqueios, alçadas, SLAs) |
| `SCH` | Agendador | Jobs recorrentes: réguas, fechamento, preventivas, reprocessamentos |
| `RPT` | Relatórios & Exportação | Consultas analíticas, exportação assíncrona, agendamento de envio |
| `INT` | Integrações | Conectores externos, webhooks, filas de entrada/saída, idempotência |

## 4.2 Mapa de dependências entre módulos

```
                                  ┌─────┐
                                  │ IAM │◄──── todos os módulos (autorização)
                                  └─────┘
        ┌────────────┐  aloca   ┌────────────┐  posiciona  ┌─────┐
        │    CTR     │─────────►│    EQP     │────────────►│ MAP │
        │ Contratos  │◄─────────│Equipamentos│             └─────┘
        └─────┬──────┘  valida  └─────┬──────┘
              │ regras de cobrança    │ estado / disponibilidade
              ▼                       ▼
        ┌────────────┐  bloqueia ┌────────────┐  consome  ┌─────┐
        │    FAT     │           │    MNT     │──────────►│ EST │
        │Faturamento │           │ Manutenção │◄──────────│Peças│
        └─────┬──────┘           └─────┬──────┘  reserva  └──┬──┘
              │ receita                │ custo de serviço     │ custo de material
              ▼                        ▼                      ▼
                          ┌──────────────────────────┐
                          │           FIN            │
                          │        Financeiro        │
                          └──────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
              ┌──────────┐                          ┌──────────┐
              │   RPT    │                          │   INT    │
              └──────────┘                          └──────────┘
```

**Leitura das setas principais:**

- `CTR → EQP`: contrato solicita alocação; `EQP` é a autoridade que aceita ou recusa (disponibilidade).
- `EQP → MAP`: cada movimentação publica posição/estado; o mapa é **projeção de leitura**, sem escrita.
- `CTR → FAT`: contrato fornece regra de cobrança, vigência, franquia e índice de reajuste.
- `EQP → FAT`: leituras de medidor e períodos efetivos de locação alimentam a medição.
- `MNT ↔ EQP`: OS altera o estado do ativo (indisponível) e consulta seu histórico.
- `MNT → EST`: apontamento de peça gera baixa de estoque e custo de material.
- `FAT/MNT/EST → FIN`: todos publicam eventos financeiros (receita, custo de serviço, custo de material).

## 4.3 Contratos de integração entre módulos (eventos de domínio)

Eventos são a espinha dorsal do desacoplamento. Publicados via *transactional outbox*, consumidos
de forma idempotente.

| Evento | Publicado por | Consumido por | Efeito |
| --- | --- | --- | --- |
| `contrato.ativado` | CTR | EQP, FAT, NTF | Confirma alocações, cria cronograma de faturamento |
| `contrato.item.alocado` | CTR | EQP, MAP | Reserva o ativo e vincula local de operação |
| `contrato.item.encerrado` | CTR | EQP, FAT | Libera o ativo e fecha o período para pro-rata |
| `contrato.vencimento.aproximando` | SCH | NTF, CTR | Gera alerta e item no painel de renovação |
| `equipamento.movimentado` | EQP | MAP, FAT, MNT, AUD | Atualiza posição, estado e base de faturamento |
| `equipamento.leitura.registrada` | EQP | FAT, MNT | Alimenta medição e gatilho de preventiva por horas |
| `equipamento.bloqueado` | EQP/RUL | CTR, MAP, NTF | Impede nova alocação e sinaliza criticidade |
| `os.aberta` | MNT | EQP, NTF, EST | Inicia SLA, marca indisponibilidade, reserva peças |
| `os.concluida` | MNT | EQP, FIN, EST | Retorna ativo ao ciclo, consolida custo |
| `estoque.abaixo_do_minimo` | EST | NTF, MNT | Alerta de reposição e risco de OS travada |
| `peca.consumida` | EST | FIN, MNT | Lança custo de material na OS e no ativo |
| `fatura.emitida` | FAT | FIN, NTF, INT | Cria recebível, dispara envio ao cliente |
| `fatura.vencida` | SCH | FIN, NTF, CTR | Atualiza inadimplência e aciona régua de cobrança |
| `pagamento.conciliado` | FIN | FAT, CTR | Baixa recebível e libera bloqueio comercial |

## 4.4 Detalhamento de fronteira por módulo

### 4.4.1 `CTR` — Contratos & Clientes
- **Possui:** Cliente, Contato, LocalDeOperacao, Contrato, ContratoItem, ContratoVersao,
  RegraDeCobranca (referência), Reajuste, Assinatura, ObservacaoOperacional.
- **Não possui:** estado físico do equipamento (é do `EQP`); documento fiscal (é do `FAT`).
- **Invariante-chave:** `ContratoItem` só existe com vigência válida e ativo aceito pelo `EQP`.

### 4.4.2 `EQP` — Equipamentos & Frota
- **Possui:** Equipamento, Categoria, Modelo, Fabricante, Medidor, LeituraMedidor,
  Movimentacao, Checklist, ChecklistResposta, VidaUtil/Depreciação, Etiqueta/QR.
- **Não possui:** custo de manutenção (é do `MNT`); receita (é do `FAT`).
- **Invariante-chave:** estado atual = função determinística da sequência de movimentações;
  leitura de medidor é monotônica não decrescente (salvo troca registrada de medidor).

### 4.4.3 `MAP` — Mapa Operacional
- **Possui:** apenas projeções e configurações de visualização (clusters, camadas, filtros salvos).
- **Fonte de dados:** `EQP` (posição/estado), `CTR` (cliente/local), `MNT` (criticidade), `FAT` (inadimplência).
- **Regra de projeto:** módulo **somente leitura**; jamais origem de alteração de estado.

### 4.4.4 `FAT` — Faturamento & Consumo
- **Possui:** CicloDeFaturamento, Medicao, PreFatura, Fatura, FaturaItem, Desconto,
  MemoriaDeCalculo, Fechamento.
- **Não possui:** contas a receber e conciliação (é do `FIN`).
- **Invariante-chave:** fatura emitida é imutável; correção ocorre por nota de crédito/débito.

### 4.4.5 `MNT` — Manutenção & SLA
- **Possui:** OrdemServico, Chamado, PlanoPreventivo, TarefaPreventiva, Apontamento,
  Agenda, SLA, CustoDeManutencao, Tecnico (papel operacional).
- **Não possui:** saldo de estoque (é do `EST`); estado do ativo (solicita mudança ao `EQP`).
- **Invariante-chave:** OS não conclui sem apontamento de tempo e destino de peças reservadas.

### 4.4.6 `EST` — Peças & Estoque
- **Possui:** Peca, Fornecedor, Deposito, SaldoEstoque, MovimentoEstoque, Reserva,
  PontoDePedido, Inventario, ContagemInventario, CustoMedio.
- **Invariante-chave:** saldo nunca negativo; todo saldo é reconstituível pela soma dos movimentos.

### 4.4.7 `FIN` — Financeiro
- **Possui:** ContaAPagar, ContaAReceber, LancamentoFinanceiro, CentroDeCusto, PlanoDeContas
  (gerencial), FluxoDeCaixa, Conciliacao, RateioDeCusto.
- **Invariante-chave:** todo lançamento referencia origem (`fatura`, `os`, `movimento_estoque`,
  `compra`) — não existe lançamento órfão sem justificativa de ajuste manual.

## 4.5 Estratégia de acoplamento e evolução

| Diretriz | Racional |
| --- | --- |
| Um schema de banco, múltiplos módulos com prefixo de tabela | Preserva transação ACID em operações críticas (alocação, fechamento) sem sagas prematuras |
| Acesso cruzado só por *service interface* pública do módulo | Permite extrair um módulo para serviço próprio sem caçar `JOIN`s indevidos |
| Testes de fronteira em CI (lint de importação) | Impede erosão da modularidade ao longo do tempo |
| Eventos versionados com *schema registry* | Habilita evolução independente de produtores e consumidores |
| Candidatos naturais a extração futura | `MAP` (leitura intensiva), `RPT` (analítico), `INT` (I/O externo), `NTF` (fan-out) |
