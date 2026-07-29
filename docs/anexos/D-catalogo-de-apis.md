# Anexo D — Catálogo de APIs

## D.1 Convenções gerais

| Aspecto | Definição |
| --- | --- |
| Estilo | REST sobre JSON (`application/json`), UTF-8 |
| Base | `https://api.{dominio}/api/v1` |
| Versionamento | Na rota (`/v1`); mudança incompatível apenas em nova versão, com sobreposição mínima de 6 meses |
| Documentação | OpenAPI 3.1 gerado do código, publicado em `/api/v1/openapi.json` e em portal interativo |
| Autenticação | `Authorization: Bearer <access_token>` (OIDC) ou `X-Api-Key` para contas de serviço |
| Tenant | Derivado do token; nunca aceito por parâmetro de query (`RN-028`) |
| Correlação | `X-Request-Id` aceito e ecoado; propagado até os workers |
| Idempotência | `Idempotency-Key` obrigatório em POST de efeito financeiro/operacional (`RN-029`) |
| Concorrência | `If-Match: <etag>` em PATCH de entidades versionadas → `409 Conflict` em divergência |
| Datas | ISO 8601 com fuso (`2026-07-29T14:32:00-03:00`) |
| Dinheiro | String decimal (`"1234.5600"`) para evitar erro de ponto flutuante |
| Paginação | Cursor: `?limit=50&cursor=<opaco>`; resposta com `meta.next_cursor` |
| Ordenação | `?sort=-criado_em,patrimonio` |
| Filtros | `?status=DISPONIVEL&filial_id=...&categoria_id=...`; intervalos com `campo[gte]`/`campo[lte]` |
| Expansão | `?include=cliente,itens.equipamento` — profundidade máxima 2 |
| Campos | `?fields=id,patrimonio,status` para respostas enxutas |
| Rate limit | Por chave/tenant; cabeçalhos `X-RateLimit-Limit`, `-Remaining`, `-Reset`; `429` com `Retry-After` |
| Exportação | Sempre assíncrona: `202 Accepted` + `job_id` + link assinado ao concluir |

### Envelope de resposta

```jsonc
// Coleção
{
  "data": [ { "id": "018f…", "patrimonio": "10422", "status": "DISPONIVEL" } ],
  "meta": { "next_cursor": "eyJpZCI6…", "limit": 50, "total_aproximado": 1284 }
}

// Recurso único — ETag no cabeçalho
{ "data": { "id": "018f…", "…": "…" } }
```

### Erros — `application/problem+json` (RFC 9457)

```jsonc
{
  "type": "https://api.iarx.app/errors/equipamento-ja-alocado",
  "title": "Equipamento já alocado no período",
  "status": 409,
  "code": "EQUIPAMENTO_JA_ALOCADO",
  "detail": "O patrimônio 10422 está alocado ao contrato SP-2026-0148 até 30/09/2026.",
  "instance": "/api/v1/contratos/018f…/itens",
  "request_id": "req_01J8…",
  "errors": [
    { "field": "itens[0].equipamento_id", "code": "CONFLITO_VIGENCIA",
      "meta": { "contrato_conflitante": "SP-2026-0148", "vigencia_fim": "2026-09-30" } }
  ],
  "acoes_sugeridas": [
    { "code": "ALOCAR_EQUIVALENTE", "descricao": "Alocar outro ativo da mesma categoria" },
    { "code": "RESERVAR_FUTURO",   "descricao": "Reservar a partir de 01/10/2026" }
  ]
}
```

### Códigos de status utilizados

| Código | Uso |
| --- | --- |
| `200` / `201` / `202` | Sucesso · criado · aceito (processamento assíncrono) |
| `204` | Sucesso sem corpo (ex.: soft delete) |
| `400` | Payload malformado |
| `401` / `403` | Não autenticado · sem permissão ou fora de escopo |
| `404` | Inexistente ou fora do escopo do tenant (indistinguível por design) |
| `409` | Conflito de estado, de vigência ou de versão (ETag) |
| `422` | Violação de regra de negócio (com `code` estável e ações sugeridas) |
| `429` | Limite de requisições excedido |
| `500` / `503` | Erro interno · indisponibilidade temporária (com `Retry-After`) |

### Princípio das ações de domínio

Transições de estado são **sub-recursos de ação**, nunca `PATCH` de campo de status. Isso mantém a
máquina de estados explícita, auditável e autorizável de forma granular.

```
✔  POST /contratos/{id}/ativar
✘  PATCH /contratos/{id}  { "status": "ATIVO" }
```

---

## D.2 Endpoints — `CTR` Contratos e Clientes

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| `GET` | `/clientes` | `cliente:ler` | Lista com filtros (documento, situação de crédito, filial) |
| `POST` | `/clientes` | `cliente:criar` | Cria cliente |
| `GET` | `/clientes/{id}` | `cliente:ler` | Detalhe; `?include=contatos,locais` |
| `PATCH` | `/clientes/{id}` | `cliente:editar` | Atualização parcial (ETag) |
| `GET` | `/clientes/{id}/visao-360` | `cliente:ler` | Contratos, ativos, faturas, OS, rentabilidade |
| `PUT` | `/clientes/{id}/credito` | `cliente:credito_definir` | Limite e situação |
| `GET/POST` | `/clientes/{id}/locais` | `local_operacao:gerenciar` | Locais de operação |
| `GET` | `/contratos` | `contrato:ler` | Filtros: status, vencimento, cliente, filial |
| `POST` | `/contratos` | `contrato:criar` | Cria rascunho |
| `GET` | `/contratos/{id}` | `contrato:ler` | `?include=itens,anexos,versoes` |
| `PATCH` | `/contratos/{id}` | `contrato:editar` | Somente em `RASCUNHO`/`EM_APROVAÇÃO` |
| `POST` | `/contratos/{id}/submeter` | `contrato:criar` | → `EM_APROVAÇÃO` |
| `POST` | `/contratos/{id}/aprovar` | `contrato:aprovar` | → `AGUARDANDO_ASSINATURA` |
| `POST` | `/contratos/{id}/ativar` | `contrato:ativar` | → `ATIVO`; reserva ativos |
| `POST` | `/contratos/{id}/suspender` | `contrato:suspender` | Motivo e período |
| `POST` | `/contratos/{id}/retomar` | `contrato:retomar` | Retoma com pro-rata |
| `POST` | `/contratos/{id}/renovar` | `contrato:renovar` | Nova vigência e valores |
| `POST` | `/contratos/{id}/encerrar` | `contrato:encerrar` | Exige devolução total |
| `POST` | `/contratos/{id}/cancelar` | `contrato:cancelar` | Antes de qualquer entrega |
| `GET/POST` | `/contratos/{id}/itens` | `contrato:item_alocar` | Alocação (valida `RN-001`) |
| `POST` | `/contratos/{id}/itens/{itemId}/substituir` | `contrato:item_substituir` | Troca de ativo |
| `POST` | `/contratos/{id}/itens/{itemId}/encerrar` | `contrato:item_encerrar` | Encerra vigência do item |
| `GET/POST` | `/contratos/{id}/reajustes` | `contrato:reajuste_aprovar` | Proposta e aplicação |
| `GET/POST` | `/contratos/{id}/anexos` | `contrato:anexo_gerenciar` | Upload por URL assinada |
| `GET` | `/contratos/{id}/historico` | `contrato:ler` | Trilha de auditoria da entidade |
| `POST` | `/contratos/{id}/assinatura` | `contrato:anexo_gerenciar` | Envia para assinatura |
| `GET` | `/contratos/renovacoes` | `contrato:ler` | Painel de renovação (janelas D-90…D-7) |

### Exemplo — alocar equipamento

```http
POST /api/v1/contratos/018f2a.../itens
Authorization: Bearer …
Idempotency-Key: 8f3c1b2e-...
Content-Type: application/json

{
  "equipamento_id": "018f31...",
  "modalidade_cobranca": "FRANQUIA_EXCEDENTE",
  "valor_unitario": "2400.0000",
  "franquia_quantidade": 200,
  "franquia_escopo": "ITEM",
  "valor_excedente_unitario": "9.5000",
  "valor_minimo_mensal": "2400.0000",
  "vigencia_inicio": "2026-08-01T00:00:00-03:00",
  "vigencia_fim": "2027-07-31T23:59:59-03:00",
  "local_operacao_id": "018f28..."
}
```

---

## D.3 Endpoints — `EQP` Equipamentos

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| `GET` | `/equipamentos` | `equipamento:ler` | Filtros: status, categoria, filial, cliente, bloqueado |
| `POST` | `/equipamentos` | `equipamento:criar` | Cadastro |
| `GET` | `/equipamentos/{id}` | `equipamento:ler` | `?include=medidores,contrato_atual,preventivas` |
| `PATCH` | `/equipamentos/{id}` | `equipamento:editar` | Atualização parcial |
| `GET` | `/equipamentos/disponibilidade` | `equipamento:ler` | `?categoria_id&inicio&fim&filial_id` → disponíveis no período |
| `GET` | `/equipamentos/{id}/timeline` | `equipamento:ler` | Movimentações, OS, leituras, contratos, financeiro |
| `GET/POST` | `/equipamentos/{id}/movimentacoes` | `equipamento:movimentar` | Registro de movimentação |
| `POST` | `/equipamentos/{id}/transferir` | `equipamento:transferir` | Origem → destino |
| `POST` | `/transferencias/{id}/aceitar` | `equipamento:transferencia_aceitar` | Aceite no destino |
| `GET/POST` | `/equipamentos/{id}/leituras` | `equipamento:leitura_registrar` | Leitura de medidor (`RN-020`) |
| `POST` | `/equipamentos/{id}/leituras/{leituraId}/estornar` | `equipamento:leitura_estornar` | Estorno com justificativa |
| `POST` | `/equipamentos/{id}/bloquear` | `equipamento:bloquear` | Motivo obrigatório |
| `POST` | `/equipamentos/{id}/desbloquear` | `equipamento:desbloquear` | Alçada + prazo + justificativa |
| `POST` | `/equipamentos/{id}/baixar` | `equipamento:baixar` | Valida `RN-007` |
| `GET` | `/equipamentos/{id}/qrcode` | `equipamento:etiqueta_gerar` | PNG/SVG da etiqueta |
| `POST` | `/equipamentos/etiquetas` | `equipamento:etiqueta_gerar` | Geração em lote (assíncrona) |
| `POST` | `/equipamentos/importar` | `equipamento:importar` | Upload de planilha → `202` + `job_id` |
| `GET` | `/resolver/{qr_token}` | `equipamento:ler` | Resolve QR → ativo + ações contextuais |
| `GET/POST` | `/catalogo/fabricantes` `/catalogo/modelos` `/catalogo/categorias` | `catalogo:gerenciar` | Catálogo |

---

## D.4 Endpoints — `MAP` Mapa

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| `GET` | `/mapa/ativos` | `mapa:ler` | `?bbox=lng1,lat1,lng2,lat2&zoom=&status=&categoria=` → pontos/clusters |
| `GET` | `/mapa/clusters` | `mapa:ler` | Agregação espacial por zoom |
| `GET` | `/mapa/locais/{id}/ativos` | `mapa:ler` | Ativos presentes no local |
| `GET` | `/mapa/criticos` | `mapa:ler` | Ativos com criticidade (`F-MAP-07`) |
| `GET` | `/mapa/indicadores` | `mapa:ler` | `?regiao=&filial=` → ocupação, receita, MTTR regionais |
| `GET/POST` | `/mapa/visoes` | `mapa:filtro_compartilhar` | Filtros salvos |

> A resposta de `/mapa/ativos` é sempre limitada pelo *viewport* e agregada conforme o zoom;
> nunca retorna a frota inteira.

---

## D.5 Endpoints — `MNT` Manutenção

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| `GET` | `/ordens-servico` | `os:ler` | Filtros: status, técnico, SLA em risco, equipamento, cliente |
| `POST` | `/ordens-servico` | `os:criar` | Abertura de chamado/OS |
| `GET` | `/ordens-servico/{id}` | `os:ler` | `?include=apontamentos,pecas,pausas,anexos` |
| `POST` | `/ordens-servico/{id}/triar` | `os:triar` | Classificação e prazos |
| `POST` | `/ordens-servico/{id}/atribuir` | `os:atribuir` | Técnico responsável |
| `POST` | `/ordens-servico/{id}/agendar` | `os:agendar` | Data/janela |
| `POST` | `/ordens-servico/{id}/iniciar` | `os:executar` | *Check-in* com geolocalização |
| `POST` | `/ordens-servico/{id}/apontamentos` | `os:executar` | Tempo de execução/deslocamento |
| `POST` | `/ordens-servico/{id}/pecas` | `os:executar` | Reserva/baixa de peça |
| `POST` | `/ordens-servico/{id}/pausas` | `os:sla_pausar` | Pausa de SLA com motivo |
| `POST` | `/ordens-servico/{id}/concluir` | `os:concluir` | Valida `RN-015` |
| `POST` | `/ordens-servico/{id}/validar` | `os:validar` | Segregação `RN-027` |
| `POST` | `/ordens-servico/{id}/cancelar` | `os:cancelar` | Libera reservas |
| `POST` | `/ordens-servico/{id}/reabrir` | `os:reabrir` | Cria OS vinculada |
| `GET` | `/ordens-servico/fila` | `os:ler` | Fila priorizada por risco de SLA |
| `GET` | `/agenda-tecnica` | `os:ler` | `?tecnico_id&inicio&fim` |
| `GET/POST` | `/planos-preventivos` | `plano_preventivo:gerenciar` | Planos e gatilhos |
| `GET` | `/preventivas` | `os:ler` | `?status=EM_DIA\|PROXIMA\|VENCIDA` |
| `GET/POST` | `/slas` | `plano_preventivo:gerenciar` | Definição de SLA |

### Exemplo — concluir OS (offline-safe)

```http
POST /api/v1/ordens-servico/018f4c.../concluir
Idempotency-Key: 3ac9-...   # gerado no dispositivo antes de perder conexão

{
  "causa_raiz_id": "018f10...",
  "solucao_id": "018f11...",
  "causa_responsabilidade": "DESGASTE_NATURAL",
  "observacao": "Substituído filtro hidráulico e mangueira do cilindro de elevação.",
  "anexos": ["018f4d...", "018f4e..."],
  "assinatura_cliente": { "nome": "M. Andrade", "documento": "***.***.789-**",
                          "anexo_id": "018f4f..." }
}
```

---

## D.6 Endpoints — `EST` Peças e Estoque

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| `GET/POST` | `/pecas` | `peca:ler` / `peca:criar` | Catálogo de peças |
| `GET` | `/pecas/{id}/aplicacoes` | `peca:ler` | Modelos compatíveis |
| `GET` | `/estoque/saldos` | `peca:ler` | `?deposito_id&abaixo_minimo=true` |
| `GET/POST` | `/estoque/movimentos` | `estoque:movimentar` | Extrato e registro |
| `POST` | `/estoque/transferencias` | `estoque:movimentar` | Entre depósitos |
| `POST` | `/estoque/ajustes` | `estoque:ajustar` | Alçada + justificativa |
| `GET` | `/estoque/reposicao` | `peca:ler` | Sugestões de compra (`RN-016`) |
| `GET/PUT` | `/estoque/politicas` | `estoque:politica_definir` | Mínimo, ponto de pedido, lote |
| `GET/POST` | `/fornecedores` | `fornecedor:gerenciar` | Fornecedores |
| `GET/POST` | `/ordens-compra` | `ordem_compra:criar` | Reposição |
| `POST` | `/ordens-compra/{id}/aprovar` | `ordem_compra:aprovar` | Alçada |
| `POST` | `/ordens-compra/{id}/receber` | `ordem_compra:receber` | Total ou parcial; recalcula custo médio |
| `GET/POST` | `/inventarios` | `inventario:executar` | Contagem |
| `POST` | `/inventarios/{id}/aprovar` | `inventario:aprovar` | Gera movimentos de ajuste |

---

## D.7 Endpoints — `FAT` Faturamento

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| `GET` | `/medicoes` | `medicao:ler` | `?competencia&status=PENDENTE` |
| `POST` | `/medicoes/consolidar` | `medicao:consolidar` | Consolida período (assíncrono) |
| `GET` | `/faturamento/pendencias` | `medicao:ler` | Painel bloqueante (`RN-021`) |
| `POST` | `/faturamento/fechar` | `prefatura:gerar` | Gera pré-faturas → `202` + `job_id` |
| `GET` | `/prefaturas` | `fatura:ler` | Lista para conferência |
| `GET` | `/prefaturas/{id}` | `fatura:ler` | `?include=itens.memoria_calculo` |
| `PATCH` | `/prefaturas/{id}/itens/{itemId}` | `prefatura:editar` | Ajuste antes da emissão |
| `POST` | `/prefaturas/{id}/aprovar` | `prefatura:aprovar` | Individual |
| `POST` | `/prefaturas/aprovar-lote` | `prefatura:aprovar` | Em lote |
| `POST` | `/faturas/emitir-lote` | `fatura:emitir` | Emissão em lote (assíncrona) |
| `GET` | `/faturas` | `fatura:ler` | Filtros: status, vencimento, cliente |
| `GET` | `/faturas/{id}` | `fatura:ler` | `?include=itens,recebiveis,nota_fiscal` |
| `POST` | `/faturas/{id}/emitir` | `fatura:emitir` | Torna imutável (`RN-023`) |
| `POST` | `/faturas/{id}/cancelar` | `fatura:cancelar` | Dentro da janela permitida |
| `POST` | `/faturas/{id}/notas-correcao` | `fatura:nota_correcao` | Crédito/débito vinculado |
| `GET` | `/faturas/{id}/pdf` | `fatura:ler` | URL assinada |
| `POST` | `/faturas/{id}/enviar` | `fatura:ler` | E-mail/WhatsApp |
| `GET/POST` | `/competencias` | `competencia:fechar` | Controle de competência |
| `POST` | `/competencias/{anoMes}/reabrir` | `competencia:reabrir` | Alçada + motivo (`RN-022`) |
| `POST` | `/faturamento/simular` | `prefatura:gerar` | Projeção sem gravar |

---

## D.8 Endpoints — `FIN` Financeiro

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| `GET` | `/recebiveis` | `receber:ler` | `?status&vencimento[lte]&cliente_id` |
| `POST` | `/recebiveis/{id}/baixar` | `receber:baixar` | Baixa total/parcial |
| `POST` | `/recebiveis/{id}/negociar` | `receber:negociar` | Acordo/parcelamento |
| `GET` | `/recebiveis/aging` | `receber:ler` | Faixas de atraso |
| `GET/POST` | `/pagaveis` | `pagar:ler` / `pagar:criar` | Contas a pagar |
| `POST` | `/pagaveis/{id}/aprovar` | `pagar:aprovar` | Alçada |
| `POST` | `/conciliacao/importar` | `conciliacao:executar` | CNAB/OFX → `202` + `job_id` |
| `GET` | `/conciliacao/pendencias` | `conciliacao:executar` | Fila de exceções |
| `GET` | `/financeiro/fluxo-caixa` | `financeiro:painel_executivo` | Realizado e projetado |
| `GET` | `/financeiro/resultado` | `financeiro:painel_executivo` | DRE gerencial |
| `GET` | `/financeiro/rentabilidade/clientes` | `financeiro:rentabilidade_ler` | `KPI-13` |
| `GET` | `/financeiro/rentabilidade/equipamentos` | `financeiro:rentabilidade_ler` | `KPI-14`, `KPI-15` |
| `GET` | `/indicadores` | conforme KPI | `?kpi=KPI-05,KPI-11&periodo=&agrupar_por=filial` |
| `POST` | `/exportacoes` | `financeiro:exportar` | Exportação assíncrona |
| `GET` | `/exportacoes/{jobId}` | `financeiro:exportar` | Status + link assinado |

### Exemplo — consulta de indicadores

```http
GET /api/v1/indicadores?kpi=KPI-05,KPI-14&periodo=2026-01..2026-07&agrupar_por=filial
```
```jsonc
{
  "data": [
    { "kpi": "KPI-05", "nome": "Taxa de ocupação", "unidade": "percentual",
      "series": [ { "grupo": "SP-01", "pontos": [ {"periodo":"2026-01","valor":"0.7820"} ] } ],
      "calculado_em": "2026-07-29T03:15:00-03:00" }
  ]
}
```

---

## D.9 Endpoints transversais

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| `GET` | `/busca?q=` | conforme recurso | Busca global multi-entidade |
| `GET` | `/notificacoes` | autenticado | Central de alertas |
| `POST` | `/notificacoes/{id}/ler` | autenticado | Marcar como lida |
| `GET` | `/auditoria` | `auditoria:consultar` | `?entidade_tipo&entidade_id&usuario_id&periodo` |
| `GET/POST` | `/usuarios` `/perfis` | `usuario:gerenciar` | IAM |
| `GET/PUT` | `/parametros` | `parametro:gerenciar` | Parametrização do tenant |
| `POST` | `/anexos/upload-url` | conforme recurso | URL assinada para upload direto |
| `GET/POST` | `/webhooks` | `webhook:gerenciar` | Assinaturas de evento |
| `GET` | `/webhooks/entregas` | `webhook:gerenciar` | Log de entregas |
| `GET/POST` | `/apikeys` | `apikey:gerenciar` | Chaves de integração |
| `GET` | `/jobs/{id}` | autenticado | Status de processamento assíncrono |
| `GET` | `/health` · `/health/ready` | público/interno | Liveness e readiness |

---

## D.10 Sincronização do PWA

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/sync/pacote-dia` | Pacote inicial: OS do dia, ativos da rota, peças do depósito, checklists, catálogo mínimo |
| `POST` | `/sync/comandos` | Envio em lote de comandos enfileirados offline |
| `GET` | `/sync/status?desde=` | Deltas desde o último *sync* |

```jsonc
// POST /sync/comandos
{
  "device_id": "dev_018f…",
  "comandos": [
    { "client_id": "c1-uuid", "idempotency_key": "c1-uuid", "tipo": "LEITURA_REGISTRAR",
      "ocorrido_em": "2026-07-29T09:14:22-03:00",
      "payload": { "equipamento_id": "018f31…", "medidor_id": "018f32…", "valor": "4821.50" } },
    { "client_id": "c2-uuid", "idempotency_key": "c2-uuid", "tipo": "OS_CONCLUIR",
      "ocorrido_em": "2026-07-29T10:02:10-03:00", "payload": { "…": "…" } }
  ]
}
```
```jsonc
// Resposta — resultado por comando, nunca falha global
{
  "data": [
    { "client_id": "c1-uuid", "status": "APLICADO",  "recurso_id": "018f55…" },
    { "client_id": "c2-uuid", "status": "REJEITADO", "code": "OS_JA_VALIDADA",
      "detail": "OS validada por outro usuário em 29/07 09:58.", "acao": "REVISAR_MANUALMENTE" }
  ]
}
```

---

## D.11 Webhooks de saída

| Aspecto | Definição |
| --- | --- |
| Entrega | `POST` no endpoint do assinante, com `Content-Type: application/json` |
| Assinatura | `X-IARX-Signature: t=<ts>,v1=<hmac_sha256(ts + '.' + body, secret)>` |
| Anti-replay | Rejeitar `ts` com desvio > 5 min |
| Reentrega | Backoff exponencial (1 min → 24 h, até 12 tentativas); log consultável |
| Idempotência | `event_id` estável; assinante deve deduplicar |
| Ordem | Não garantida — usar `ocorrido_em` e `versao_agregado` |

### Eventos publicados

`contrato.ativado` · `contrato.suspenso` · `contrato.renovado` · `contrato.encerrado` ·
`contrato.vencimento_aproximando` · `contrato.item_alocado` · `contrato.item_encerrado` ·
`equipamento.movimentado` · `equipamento.leitura_registrada` · `equipamento.bloqueado` ·
`equipamento.desbloqueado` · `equipamento.baixado` ·
`os.aberta` · `os.agendada` · `os.concluida` · `os.validada` · `os.sla_em_risco` ·
`preventiva.vencida` ·
`estoque.abaixo_do_minimo` · `peca.consumida` · `inventario.aprovado` ·
`medicao.pendente` · `fatura.emitida` · `fatura.vencida` · `fatura.paga` · `fatura.cancelada` ·
`pagamento.conciliado` · `competencia.fechada`

```jsonc
{
  "event_id": "evt_01J8…",
  "tipo": "fatura.emitida",
  "versao_schema": "1.0",
  "tenant_id": "018f00…",
  "ocorrido_em": "2026-07-29T11:04:00-03:00",
  "agregado": { "tipo": "fatura", "id": "018f70…", "versao": 3 },
  "dados": {
    "numero": "1-004821", "cliente_id": "018f21…", "contrato_id": "018f2a…",
    "competencia": "2026-07", "valor_liquido": "18420.5000",
    "vencimento": "2026-08-10"
  }
}
```

## D.12 Limites operacionais

| Limite | Valor padrão |
| --- | --- |
| `limit` de paginação | 50 (máximo 200) |
| Tamanho de payload | 1 MB (JSON) · 25 MB (upload via URL assinada) |
| Rate limit padrão | 600 req/min por chave; 60 req/min em endpoints de escrita |
| Profundidade de `include` | 2 níveis |
| Itens por operação em lote | 500 |
| Validade de URL assinada | 15 min (upload) · 60 min (download) |
| Retenção de `job` | 7 dias |
| TTL de `Idempotency-Key` | 24 h |
