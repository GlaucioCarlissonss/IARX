# 12. Integrações Futuras

## 12.1 Arquitetura de integração

Todas as integrações passam pelo módulo `INT`, que isola o núcleo de negócio das particularidades
de cada parceiro.

```
┌─────────────────┐   evento de domínio    ┌──────────────────────────────────────┐
│  Núcleo (CTR,   │───────────────────────►│  INT — Camada de Integração          │
│  EQP, FAT, MNT, │◄───────────────────────│  ┌────────────────────────────────┐  │
│  EST, FIN)      │   comando normalizado  │  │ Conector (por parceiro)        │  │
└─────────────────┘                        │  │ · mapeamento de campos         │  │
                                           │  │ · autenticação própria         │  │
                                           │  │ · retentativa e backoff        │  │
                                           │  │ · idempotência (RN-029)        │  │
                                           │  │ · log de payload e resultado   │  │
                                           │  └────────────────────────────────┘  │
                                           └───────────┬──────────────────────────┘
                                                       │
                    ┌──────────────────────┬───────────┴──────────┬───────────────────┐
                    ▼                      ▼                      ▼                   ▼
                  ERP              Gateway/Banco            Fiscal/NF-e         Telemetria/IoT
```

**Princípios não negociáveis:**

| Princípio | Consequência |
| --- | --- |
| Conector nunca escreve direto em tabela de domínio | Toda entrada passa por caso de uso, respeitando invariantes |
| Toda integração é assíncrona e reprocessável | Falha de parceiro não derruba operação; fila com *dead letter* e reprocessamento |
| Idempotência obrigatória | Reenvio nunca duplica fatura, movimento de estoque ou OS (`RN-029`) |
| Mapeamento declarativo | Configuração por tenant, sem *fork* de código por cliente |
| Observabilidade por integração | Painel com últimas execuções, latência, taxa de erro e fila pendente |
| Contrato de dados versionado | Alterações do parceiro absorvidas no conector, não no domínio |

## 12.2 Roteiro de integrações

Prioridade: **P1** = essencial para operação corporativa · **P2** = alto valor · **P3** = diferencial.

### 12.2.1 ERP e retaguarda administrativa — **P1** `[Fase 4]`
- **Direção:** bidirecional.
- **Saída:** faturas emitidas, contas a receber, contas a pagar, lançamentos de custo,
  depreciação mensal, movimentos de estoque valorados.
- **Entrada:** cadastro de clientes/fornecedores, plano de contas, centros de custo,
  confirmação de baixa financeira.
- **Padrão:** API REST quando disponível; alternativa por arquivo (CSV/posicional) com
  conciliação de totais e relatório de divergência.
- **Cuidado:** definir claramente o sistema-mestre por entidade para evitar duplicidade de cadastro.

### 12.2.2 Sistemas fiscais (NF-e / NFS-e) — **P1** `[Fase 4]`
- Emissão via provedor homologado; a plataforma fornece a base de cálculo e recebe o resultado.
- Tratamento de rejeição com fila de correção e reenvio; cancelamento e carta de correção dentro
  das janelas legais.
- Armazenamento do XML e do DANFE/DANFSE vinculados à fatura, com retenção legal.
- Suporte a regras municipais de ISS para serviços e a diferenças de CFOP por operação de locação.

### 12.2.3 Gateways financeiros e bancos — **P1** `[Fase 3]`
- **Emissão:** boleto registrado e PIX (QR estático/dinâmico) por fatura.
- **Conciliação:** webhook de pagamento e/ou retorno CNAB/OFX, com baixa automática por
  identificador e fila de exceções.
- **Extras:** split/repasse se houver operação com parceiros; consulta de recebíveis.
- **Efeito no negócio:** baixa automática libera bloqueio comercial em minutos (`RN-024`).

### 12.2.4 APIs de geolocalização e mapas — **P1** `[Fase 2]`
- Geocodificação e *reverse geocoding* de locais de operação.
- *Tiles* de mapa (provedor substituível — a escolha do MapLibre evita dependência de fornecedor).
- Cálculo de rota e matriz de distância para sugestão de roteiro técnico e custo de deslocamento.
- Cache local de geocodificação para reduzir custo e latência.

### 12.2.5 WhatsApp (API oficial) — **P2** `[Fase 3]`
- **Saída:** confirmação de entrega/retorno, aviso de fatura e vencimento, cobrança, agendamento
  de manutenção, aviso de preventiva, pesquisa de satisfação.
- **Entrada:** abertura de chamado por mensagem, envio de foto do medidor, confirmação de
  agendamento — com interpretação estruturada e criação de registro rastreável.
- **Governança:** templates aprovados, janela de atendimento, *opt-out* respeitado, histórico
  de conversa vinculado ao cliente/OS.

### 12.2.6 E-mail transacional — **P1** `[Fase 2]`
- Envio de faturas, contratos para assinatura, relatórios agendados, alertas e recuperação de acesso.
- Domínio autenticado (SPF, DKIM, DMARC), rastreamento de entrega/abertura, tratamento de *bounce*
  com sinalização de contato inválido no cadastro.

### 12.2.7 Assinatura digital — **P2** `[Fase 4]`
- Envio de minuta, múltiplos signatários com ordem, autenticação do signatário, retorno de status
  por webhook, armazenamento do documento assinado com evidências (hash, IP, data/hora, log).
- Aplicação também em termos de entrega/retorno e ordens de serviço em campo.

### 12.2.8 Telemetria, IoT e rastreamento GPS — **P2** `[Fase 4–5]`
- **Entrada de dados:** horímetro, odômetro, contadores, posição, ignição, códigos de falha,
  nível de combustível, tensão de bateria.
- **Protocolos:** API REST/MQTT do fornecedor de telemetria; normalização no conector.
- **Efeitos no negócio de alto valor:**
  - leitura automática de medidor → elimina pendência de medição (`KPI-36` → 0);
  - preventiva disparada por uso real, não por estimativa (`RN-013`);
  - divergência entre posição declarada e rastreada como alerta de criticidade (`F-MAP-10`);
  - *geofence* por local de operação (`F-MAP-12`);
  - detecção de subutilização de ativo locado (`KPI-19`).
- **Cuidados:** volume alto de eventos exige ingestão em fila com agregação e retenção por
  granularidade (bruto por 90 dias, agregado por 5 anos); telemetria é fonte auxiliar — a leitura
  oficial para faturamento continua auditável e corrigível.

### 12.2.9 BI e *data warehouse* — **P2** `[Fase 5]`
- Exportação incremental (CDC ou *batch* noturno) para warehouse, com modelo dimensional
  (fatos: faturamento, movimentação, OS, consumo de peça; dimensões: ativo, cliente, contrato,
  tempo, filial, técnico).
- Conectores para ferramentas de BI e endpoint analítico somente leitura com credencial própria.
- **Regra:** o BI consome dados da plataforma; nunca escreve nela.

### 12.2.10 Aplicativos mobile nativos — **P2** `[Fase 5]`
- App do técnico (React Native/Expo, reutilizando `contracts/`) com NFC/RFID, câmera avançada,
  notificação push e rastreamento em segundo plano opcional.
- App do cliente com ativos em posse, faturas, abertura de chamado e envio de leitura.

### 12.2.11 APIs externas e portal de parceiros — **P2** `[Fase 4]`
- API pública versionada com chave por tenant, escopos, *rate limit*, sandbox e documentação
  interativa.
- Webhooks assinados (HMAC-SHA256) para `contrato.*`, `equipamento.*`, `os.*`, `fatura.*`,
  `estoque.*`, com reentrega exponencial e log consultável.
- Casos de uso: integração com sistema do cliente corporativo, marketplaces de locação,
  automações do próprio cliente.

### 12.2.12 Integrações complementares — **P3**
| Integração | Valor | Fase |
| --- | --- | --- |
| Consulta de crédito / *bureau* | Definir limite e situação do cliente na contratação (`F-CTR-17`) | 4 |
| Consulta de CNPJ/CEP | Reduzir digitação e erro de cadastro | 2 |
| Catálogo de peças do fabricante | Enriquecer cadastro e compatibilidade | 5 |
| Cotação eletrônica com fornecedores | Reduzir custo de reposição | 5 |
| SSO corporativo (OIDC/SAML) | Requisito de clientes de grande porte | 4 |
| Contabilidade / SPED | Reduzir retrabalho contábil | 5 |
| Central telefônica / ITSM | Abertura de chamado por telefone/ticket | 5 |
| Seguros de equipamento | Apólice, vigência e sinistro vinculados ao ativo | 5 |

## 12.3 Extensibilidade da plataforma

| Recurso | Descrição | Fase |
| --- | --- | --- |
| Campos personalizados | Definidos por tenant em cliente, contrato, ativo, OS e peça, disponíveis em filtros, relatórios e API | 3 |
| Regras paramétricas | SLAs, políticas de bloqueio, alçadas, regras de cobrança e réguas de alerta configuráveis sem código | 2–3 |
| Modelos de documento | *Templates* de contrato, romaneio, OS e fatura editáveis por tenant | 3 |
| Checklists configuráveis | Por categoria de equipamento e tipo de movimentação | 2 |
| Relatórios configuráveis | Construtor com colunas, filtros, agrupamento, agendamento e envio | 4 |
| Webhooks de saída | Assinatura de eventos pelo próprio cliente | 4 |
| Automações condicionais | "Quando X, faça Y" sobre eventos de domínio (ex.: ativo parado 20 dias → notificar comercial) | 5 |
| *App marketplace* interno | Conectores instaláveis por tenant com escopos declarados | 5 |
