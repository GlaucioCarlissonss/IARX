# Anexo A — Modelo de Dados

## A.1 Convenções

| Convenção | Definição |
| --- | --- |
| Chave primária | `id uuid` (UUID v7 — ordenável por tempo, gerável no cliente para o PWA offline) |
| Isolamento | `tenant_id uuid NOT NULL` em toda tabela de negócio, com RLS ativa (`RN-028`) |
| Auditoria de linha | `created_at`, `created_by`, `updated_at`, `updated_by` |
| Exclusão lógica | `deleted_at`, `deleted_by`, `delete_reason` (`RN-019`) |
| Datas | `timestamptz` sempre; fuso do tenant aplicado apenas na apresentação |
| Dinheiro | `numeric(15,4)`; arredondamento explícito na apresentação e no documento |
| Medição | `numeric(14,2)` (suporta horímetro, ciclos, km) |
| Enumerações | Tipos `enum` do PostgreSQL para estados de máquina; tabelas de domínio para taxonomias parametrizáveis |
| Concorrência | `version integer` (bloqueio otimista) nas entidades editáveis por múltiplos usuários |
| Nomenclatura | `snake_case`, tabelas no plural, prefixo do módulo em tabelas específicas |

---

## A.2 Diagrama de entidades principais

```
                          ┌──────────┐
                          │  tenant  │
                          └────┬─────┘
                               │
              ┌────────────────┼──────────────────┐
              ▼                ▼                  ▼
        ┌──────────┐     ┌──────────┐      ┌───────────┐
        │ empresa  │     │ usuario  │──────│  perfil   │
        └────┬─────┘     └──────────┘      └───────────┘
             ▼
        ┌──────────┐
        │  filial  │◄──────────────────────────┐
        └────┬─────┘                           │
             │                                 │
   ┌─────────┴──────────┐            ┌─────────┴──────────┐
   ▼                    ▼            ▼                    ▼
┌──────────┐      ┌──────────┐  ┌─────────┐        ┌───────────┐
│ cliente  │      │ deposito │  │ tecnico │        │equipamento│
└────┬─────┘      └────┬─────┘  └────┬────┘        └─────┬─────┘
     ▼                 ▼             │                   │
┌──────────────┐  ┌──────────┐       │        ┌──────────┼──────────┬─────────────┐
│local_operacao│  │saldo_est.│       │        ▼          ▼          ▼             ▼
└──────┬───────┘  └────┬─────┘       │  ┌───────────┐┌────────┐┌──────────┐┌──────────┐
       │               ▼             │  │movimentacao││leitura ││ medidor  ││plano_prev│
       │          ┌──────────┐       │  └───────────┘└────────┘└──────────┘└──────────┘
       │          │  peca    │       │
       │          └────┬─────┘       │
       │               ▼             ▼
       │       ┌────────────────┐ ┌──────────────┐
       │       │movimento_estoq.│─│ ordem_servico│
       │       └────────────────┘ └──────┬───────┘
       │                                 │
       ▼                                 ▼
┌──────────────┐   ┌──────────────┐  ┌──────────────┐
│   contrato   │──►│contrato_item │  │ apontamento  │
└──────┬───────┘   └──────┬───────┘  └──────────────┘
       │                  │
       │                  ▼
       │           ┌──────────────┐
       │           │   medicao    │
       │           └──────┬───────┘
       ▼                  ▼
┌──────────────┐   ┌──────────────┐    ┌──────────────┐
│contrato_versao│  │    fatura    │───►│ fatura_item  │
└──────────────┘   └──────┬───────┘    └──────────────┘
                          ▼
                   ┌──────────────────┐
                   │lancamento_financ.│
                   └──────────────────┘

                   ┌──────────────┐   ┌──────────────┐
                   │  audit_log   │   │ notificacao  │   (transversais)
                   └──────────────┘   └──────────────┘
```

---

## A.3 Estrutura organizacional e identidade

### `tenant`
`id` · `nome` · `documento` · `plano` · `timezone` · `moeda` · `status` · `configuracoes jsonb`

### `empresa`
`id` · `tenant_id` · `razao_social` · `nome_fantasia` · `cnpj` · `inscricoes` · `endereco`
· UNIQUE `(tenant_id, cnpj)`

### `filial`
`id` · `tenant_id` · `empresa_id` · `codigo` · `nome` · `endereco` · `geo geography(Point,4326)`
· `regiao` · `ativo`
· UNIQUE `(tenant_id, codigo)`

### `usuario`
`id` · `tenant_id` · `subject_oidc` · `nome` · `email` · `telefone` · `status` · `mfa_habilitado`
· `ultimo_acesso_em`
· UNIQUE `(tenant_id, email)`

### `perfil`
`id` · `tenant_id` · `nome` · `descricao` · `is_sistema` · `permissoes text[]`

### `usuario_perfil`
`usuario_id` · `perfil_id` · `escopo_tipo` (`TENANT`|`EMPRESA`|`FILIAL`|`REGIAO`|`PROPRIO`)
· `escopo_id` · PK composta

### `alcada`
`id` · `tenant_id` · `perfil_id` · `tipo` (`DESCONTO`|`CUSTO_OS`|`AJUSTE_ESTOQUE`|`LIBERACAO_BLOQUEIO`|`REABERTURA_COMPETENCIA`)
· `limite_valor` · `limite_percentual`

---

## A.4 Módulo `CTR` — Contratos e Clientes

### `cliente`
`id` · `tenant_id` · `tipo_pessoa` · `documento` · `razao_social` · `nome_fantasia`
· `inscricao_estadual` · `inscricao_municipal` · `condicao_pagamento_id` · `limite_credito`
· `situacao_credito` (`LIBERADO`|`OBSERVACAO`|`BLOQUEADO`) · `filial_responsavel_id`
· `campos_personalizados jsonb`
· UNIQUE `(tenant_id, documento)`

### `contato`
`id` · `tenant_id` · `cliente_id` · `nome` · `funcao` (`COMERCIAL`|`FINANCEIRO`|`OPERACIONAL`|`TECNICO`)
· `email` · `telefone` · `recebe_fatura bool` · `recebe_alerta bool`

### `local_operacao`
`id` · `tenant_id` · `cliente_id` · `codigo` · `nome` · `endereco`
· `geo geography(Point,4326)` · `responsavel` · `janela_acesso` · `restricoes` · `ativo`
· INDEX GiST em `geo`

### `contrato`
`id` · `tenant_id` · `numero` · `empresa_id` · `filial_id` · `cliente_id` · `tipo`
· `status contrato_status` · `data_inicio` · `data_fim` · `prazo_minimo_meses`
· `renovacao_automatica bool` · `ciclo_faturamento_id` · `condicao_pagamento_id`
· `indice_reajuste` · `periodicidade_reajuste_meses` · `mes_base_reajuste`
· `valor_mensal_estimado` · `responsavel_comercial_id` · `contrato_pai_id`
· `observacoes_operacionais` · `campos_personalizados jsonb` · `version`
· UNIQUE `(tenant_id, numero)` · INDEX `(tenant_id, status, data_fim)`

### `contrato_item`
`id` · `tenant_id` · `contrato_id` · `equipamento_id` (nullable quando alocação por categoria)
· `categoria_id` · `modalidade_cobranca` · `valor_unitario` · `quantidade`
· `franquia_quantidade` · `franquia_escopo` (`ITEM`|`CONTRATO`) · `valor_excedente_unitario`
· `valor_minimo_mensal` · `desconto_percentual` · `desconto_motivo`
· `vigencia_inicio` · `vigencia_fim` · `status item_status` · `local_operacao_id`
· `observacao`

**Invariante `RN-001` no banco:**
```sql
ALTER TABLE contrato_item ADD CONSTRAINT ci_sem_sobreposicao
EXCLUDE USING gist (
  tenant_id      WITH =,
  equipamento_id WITH =,
  tstzrange(vigencia_inicio, vigencia_fim, '[)') WITH &&
) WHERE (equipamento_id IS NOT NULL
     AND status IN ('ATIVO','RESERVADO','SUSPENSO')
     AND deleted_at IS NULL);
```

### `contrato_versao`
`id` · `tenant_id` · `contrato_id` · `versao` · `motivo` · `snapshot jsonb`
· `vigencia_inicio` · `aprovado_por` · `aprovado_em`

### `reajuste`
`id` · `tenant_id` · `contrato_id` · `competencia` · `indice` · `percentual_indice`
· `percentual_aplicado` · `valor_anterior` · `valor_novo`
· `status` (`PROPOSTO`|`APROVADO`|`APLICADO`|`RENUNCIADO`) · `aprovado_por` · `motivo_renuncia`

### `assinatura`
`id` · `tenant_id` · `contrato_id` · `provedor` · `provedor_ref` · `status`
· `signatarios jsonb` · `enviado_em` · `assinado_em` · `evidencia jsonb` · `documento_id`

### `anexo`
`id` · `tenant_id` · `entidade_tipo` · `entidade_id` · `tipo_documento` · `nome_arquivo`
· `storage_key` · `mime_type` · `tamanho_bytes` · `hash_sha256` · `versao`
· `validade_ate` · `antivirus_status` · `enviado_por`
· INDEX `(tenant_id, entidade_tipo, entidade_id)`

---

## A.5 Módulo `EQP` — Equipamentos

### `fabricante` / `modelo` / `categoria_equipamento`
- `fabricante`: `id` · `tenant_id` · `nome` · `pais` · `contato_suporte`
- `categoria_equipamento`: `id` · `tenant_id` · `nome` · `codigo` · `tipo_medidor_padrao`
  · `checklist_saida_id` · `checklist_retorno_id` · `vida_util_meses_padrao`
- `modelo`: `id` · `tenant_id` · `fabricante_id` · `categoria_id` · `nome` · `codigo`
  · `especificacoes jsonb` · `plano_preventivo_id` · `preco_tabela_mensal` · `preco_tabela_diaria`

### `equipamento`
`id` · `tenant_id` · `patrimonio` · `numero_serie` · `modelo_id` · `categoria_id`
· `filial_id` · `status equipamento_status` · `motivo_indisponibilidade`
· `local_atual_tipo` (`FILIAL`|`LOCAL_OPERACAO`|`TERCEIRO`|`TRANSITO`) · `local_atual_id`
· `geo_atual geography(Point,4326)` · `geo_origem` (`DECLARADA`|`RASTREADA`)
· `ano_fabricacao` · `data_aquisicao` · `valor_aquisicao` · `fornecedor_id` · `nota_fiscal`
· `vida_util_meses` · `metodo_depreciacao` · `valor_residual` · `depreciacao_acumulada`
· `equipamento_pai_id` (acessórios) · `qr_token` · `bloqueado bool` · `bloqueio_motivo`
· `campos_personalizados jsonb` · `version`
· UNIQUE `(tenant_id, patrimonio)` · UNIQUE `(tenant_id, modelo_id, numero_serie)`
· INDEX `(tenant_id, status, filial_id)` · INDEX GiST em `geo_atual`

### `medidor`
`id` · `tenant_id` · `equipamento_id` · `tipo` (`HORIMETRO`|`CONTADOR`|`ODOMETRO`|`DIAS`)
· `unidade` · `valor_inicial` · `valor_atual` · `acumulado_total` · `ativo bool`
· `substituido_em` · `substituido_por_id`

### `leitura_medidor` *(append-only, particionada por mês)*
`id` · `tenant_id` · `medidor_id` · `equipamento_id` · `valor` · `data_leitura`
· `origem` (`MANUAL`|`CAMPO`|`IMPORTACAO`|`TELEMETRIA`|`API`) · `contrato_item_id`
· `registrado_por` · `foto_anexo_id` · `geo geography(Point,4326)`
· `status` (`VALIDA`|`REVISADA`|`ESTORNADA`) · `estorno_de_id` · `motivo_estorno`
· INDEX `(tenant_id, equipamento_id, data_leitura DESC)`
- **Invariante `RN-020`:** valor ≥ última leitura válida do medidor (validado em domínio + trigger).

### `movimentacao` *(append-only, particionada por mês)*
`id` · `tenant_id` · `equipamento_id` · `tipo` (`ENTREGA`|`RETORNO`|`TRANSFERENCIA`|`ENVIO_MANUTENCAO`|`RETORNO_MANUTENCAO`|`ENVIO_TERCEIRO`|`BAIXA`)
· `origem_tipo` · `origem_id` · `destino_tipo` · `destino_id`
· `contrato_item_id` · `ordem_servico_id` · `data_movimento` · `responsavel_id`
· `documento_ref` (romaneio) · `leitura_id` · `checklist_resposta_id`
· `status_resultante equipamento_status` · `aceite_em` · `aceite_por` · `observacao`
· INDEX `(tenant_id, equipamento_id, data_movimento DESC)`

### `checklist_modelo` / `checklist_item` / `checklist_resposta` / `checklist_resposta_item`
- Modelo por categoria e tipo de movimentação; item com `obrigatorio`, `impeditivo`, `exige_foto`.
- Resposta com `equipamento_id`, `movimentacao_id`, `respondido_por`, `assinatura_anexo_id`.
- Item de resposta com `situacao` (`OK`|`DIVERGENTE`|`NAO_APLICAVEL`), `observacao`, `foto_anexo_id`.

---

## A.6 Módulo `MNT` — Manutenção

### `ordem_servico`
`id` · `tenant_id` · `numero` · `equipamento_id` · `filial_id` · `tipo` (`CORRETIVA`|`PREVENTIVA`|`INSPECAO`|`MELHORIA`|`SINISTRO`)
· `origem` (`INTERNA`|`CLIENTE`|`PREVENTIVA_AUTO`|`CHECKLIST`|`API`|`TELEMETRIA`)
· `status os_status` · `prioridade` · `criticidade`
· `contrato_id` · `cliente_id` · `local_operacao_id` · `sintoma_id` · `causa_raiz_id` · `solucao_id`
· `descricao` · `tecnico_responsavel_id` · `sla_id`
· `abertura_em` · `prazo_resposta_em` · `resposta_em` · `prazo_solucao_em`
· `inicio_execucao_em` · `conclusao_em` · `validacao_em` · `validado_por`
· `tempo_pausado_minutos` · `impacta_disponibilidade bool`
· `causa_responsabilidade` (`LOCADORA`|`CLIENTE`|`TERCEIRO`|`DESGASTE_NATURAL`)
· `custo_mao_obra` · `custo_material` · `custo_terceiros` · `custo_deslocamento` · `custo_total`
· `os_origem_id` (reabertura) · `version`
· UNIQUE `(tenant_id, numero)` · INDEX `(tenant_id, status, prazo_solucao_em)`

### `os_apontamento`
`id` · `tenant_id` · `ordem_servico_id` · `tecnico_id` · `tipo` (`EXECUCAO`|`DESLOCAMENTO`|`ESPERA`)
· `inicio` · `fim` · `minutos` · `custo_hora` · `descricao` · `geo geography(Point,4326)`

### `os_pausa`
`id` · `tenant_id` · `ordem_servico_id` · `motivo` (`AGUARDANDO_PECA`|`ACESSO_NEGADO`|`APROVACAO_CLIENTE`|`APROVACAO_INTERNA`)
· `inicio` · `fim` · `registrado_por` · `justificativa`

### `os_peca`
`id` · `tenant_id` · `ordem_servico_id` · `peca_id` · `quantidade_reservada`
· `quantidade_consumida` · `custo_unitario_baixa` · `movimento_estoque_id`
· `status` (`RESERVADA`|`CONSUMIDA`|`DEVOLVIDA`|`CANCELADA`)

### `plano_preventivo` / `plano_preventivo_tarefa`
- `plano_preventivo`: `id` · `tenant_id` · `nome` · `modelo_id` · `categoria_id`
  · `gatilho_horas` · `gatilho_ciclos` · `gatilho_km` · `gatilho_dias`
  · `tolerancia_percentual` · `tolerancia_dias` · `bloqueia_ao_vencer bool` · `ativo`
- `plano_preventivo_tarefa`: `id` · `plano_id` · `descricao` · `tempo_estimado_minutos`
  · `pecas_previstas jsonb` · `ordem`

### `preventiva_programada`
`id` · `tenant_id` · `equipamento_id` · `plano_id` · `proxima_execucao_valor`
· `proxima_execucao_data` · `ultima_execucao_valor` · `ultima_execucao_data`
· `status` (`EM_DIA`|`PROXIMA`|`VENCIDA`) · `ordem_servico_id`

### `sla`
`id` · `tenant_id` · `nome` · `tipo_os` · `prioridade` · `cliente_id` (nullable)
· `prazo_resposta_minutos` · `prazo_solucao_minutos` · `calendario_id` · `permite_pausa bool`

---

## A.7 Módulo `EST` — Peças e Estoque

### `peca`
`id` · `tenant_id` · `codigo_interno` · `codigo_fabricante` · `descricao` · `unidade`
· `categoria_peca_id` · `fornecedor_preferencial_id` · `custo_medio` · `ultimo_custo`
· `criticidade` (`BAIXA`|`MEDIA`|`ALTA`) · `localizacao_fisica` · `ativo`
· UNIQUE `(tenant_id, codigo_interno)`

### `peca_aplicacao`
`peca_id` · `modelo_id` · PK composta — habilita sugestão automática na OS

### `deposito`
`id` · `tenant_id` · `filial_id` · `codigo` · `nome`
· `tipo` (`ALMOXARIFADO`|`OFICINA`|`VEICULO_TECNICO`) · `responsavel_id`

### `saldo_estoque` *(projeção materializada)*
`tenant_id` · `peca_id` · `deposito_id` · `quantidade_fisica` · `quantidade_reservada`
· `quantidade_disponivel` (gerada) · `valor_total` · `atualizado_em`
· PK `(tenant_id, peca_id, deposito_id)`
- **`RN-017`:** `CHECK (quantidade_fisica >= 0 AND quantidade_reservada >= 0)`

### `movimento_estoque` *(append-only, particionada por mês)*
`id` · `tenant_id` · `peca_id` · `deposito_id` · `tipo` (`ENTRADA_COMPRA`|`ENTRADA_DEVOLUCAO`|`SAIDA_OS`|`SAIDA_PERDA`|`TRANSFERENCIA_SAIDA`|`TRANSFERENCIA_ENTRADA`|`AJUSTE_INVENTARIO`|`DEVOLUCAO_FORNECEDOR`)
· `quantidade` (sinalizada) · `custo_unitario` · `custo_total`
· `ordem_servico_id` · `inventario_id` · `ordem_compra_id` · `deposito_contraparte_id`
· `saldo_apos` · `data_movimento` · `registrado_por` · `motivo`
· INDEX `(tenant_id, peca_id, data_movimento DESC)`

### `politica_reposicao`
`tenant_id` · `peca_id` · `deposito_id` · `estoque_minimo` · `estoque_maximo`
· `ponto_pedido` · `lote_economico` · `lead_time_dias` · PK composta

### `fornecedor`
`id` · `tenant_id` · `documento` · `razao_social` · `contato` · `prazo_medio_entrega_dias`
· `avaliacao` · `ativo` · UNIQUE `(tenant_id, documento)`

### `ordem_compra` / `ordem_compra_item`
`numero` · `fornecedor_id` · `status` · `previsao_entrega` · itens com `quantidade_pedida`,
`quantidade_recebida`, `preco_unitario`

### `inventario` / `inventario_contagem`
- `inventario`: `id` · `tenant_id` · `deposito_id` · `tipo` (`GERAL`|`CICLICO`) · `status`
  · `iniciado_em` · `finalizado_em` · `aprovado_por`
- `inventario_contagem`: `inventario_id` · `peca_id` · `saldo_sistema` · `saldo_contado`
  · `divergencia` · `contado_por` · `justificativa` · `movimento_ajuste_id`

---

## A.8 Módulo `FAT` — Faturamento

### `ciclo_faturamento`
`id` · `tenant_id` · `nome` · `tipo` (`DIA_FIXO`|`ANIVERSARIO`|`QUINZENAL`|`SEMANAL`)
· `dia_referencia` · `dias_para_vencimento` · `dia_fechamento`

### `competencia`
`id` · `tenant_id` · `ano_mes` · `status` (`ABERTA`|`EM_FECHAMENTO`|`FECHADA`|`REABERTA`)
· `fechada_em` · `fechada_por` · `reaberturas jsonb`
· UNIQUE `(tenant_id, ano_mes)` — imposição de `RN-022`

### `medicao`
`id` · `tenant_id` · `contrato_item_id` · `competencia_id` · `equipamento_id` · `medidor_id`
· `leitura_inicial_id` · `leitura_final_id` · `valor_inicial` · `valor_final`
· `consumo` · `dias_locados` · `origem` (`MEDIDA`|`ESTIMADA`|`AJUSTE`)
· `status` (`PENDENTE`|`CONSOLIDADA`|`FATURADA`) · `justificativa_estimativa`
· UNIQUE `(tenant_id, contrato_item_id, competencia_id)`

### `fatura`
`id` · `tenant_id` · `numero` · `serie` · `empresa_id` · `filial_id` · `cliente_id`
· `contrato_id` (nullable em fatura agrupada) · `competencia_id`
· `status fatura_status` · `data_emissao` · `data_vencimento`
· `valor_bruto` · `valor_descontos` · `valor_acrescimos` · `valor_liquido`
· `valor_pago` · `valor_saldo`
· `nf_numero` · `nf_chave` · `nf_status` · `nf_xml_anexo_id` · `pdf_anexo_id`
· `boleto_linha_digitavel` · `pix_qrcode` · `documento_origem_id` (nota de crédito/débito)
· `emitida_por` · `cancelada_em` · `cancelamento_motivo`
· UNIQUE `(tenant_id, serie, numero)` · INDEX `(tenant_id, status, data_vencimento)`
- **`RN-023`:** trigger impede `UPDATE` de campos de valor quando `status >= EMITIDA`.

### `fatura_item`
`id` · `tenant_id` · `fatura_id` · `contrato_item_id` · `equipamento_id` · `descricao`
· `modalidade_cobranca` · `quantidade` · `valor_unitario` · `valor_bruto`
· `valor_desconto` · `valor_liquido` · `periodo_inicio` · `periodo_fim`
· `dias_proporcionais` · `franquia` · `consumo` · `excedente`
· `medicao_id` · `memoria_calculo jsonb` · `natureza_receita`

### `desconto_concedido`
`id` · `tenant_id` · `escopo` (`CONTRATO`|`CONTRATO_ITEM`|`FATURA`|`FATURA_ITEM`) · `escopo_id`
· `tipo` (`PERCENTUAL`|`VALOR`) · `valor` · `motivo_id` · `justificativa`
· `concedido_por` · `aprovado_por` · `vigencia_inicio` · `vigencia_fim`

---

## A.9 Módulo `FIN` — Financeiro

### `lancamento_financeiro` *(append-only)*
`id` · `tenant_id` · `tipo` (`RECEITA`|`CUSTO`|`DESPESA`|`DEPRECIACAO`)
· `natureza_id` · `competencia_id` · `data_competencia` · `valor`
· `origem_tipo` (`FATURA`|`OS`|`MOVIMENTO_ESTOQUE`|`ORDEM_COMPRA`|`CONTRATO`|`AJUSTE_MANUAL`)
· `origem_id` · `equipamento_id` · `contrato_id` · `cliente_id`
· `centro_custo_id` · `filial_id` · `rateio_regra_id` · `ajuste_justificativa`
· INDEX `(tenant_id, competencia_id, tipo)` · INDEX `(tenant_id, equipamento_id)`
- **`RN-025`:** `CHECK` exige `origem_id` OU `ajuste_justificativa` preenchida.

### `conta_receber`
`id` · `tenant_id` · `fatura_id` · `cliente_id` · `parcela` · `valor` · `valor_pago`
· `vencimento` · `status` (`ABERTA`|`PARCIAL`|`PAGA`|`VENCIDA`|`NEGOCIADA`|`CANCELADA`)
· `dias_atraso` (calculado) · `provisao_perda` · `acordo_id`
· INDEX `(tenant_id, status, vencimento)`

### `conta_pagar`
`id` · `tenant_id` · `fornecedor_id` · `origem_tipo` · `origem_id` · `descricao`
· `valor` · `valor_pago` · `vencimento` · `status` · `centro_custo_id`
· `aprovado_por` · `aprovado_em`

### `movimento_bancario` / `conciliacao`
- `movimento_bancario`: `id` · `tenant_id` · `conta_bancaria_id` · `data` · `valor` · `tipo`
  · `identificador_externo` · `descricao` · `status_conciliacao`
- `conciliacao`: vínculo `movimento_bancario_id` ↔ (`conta_receber_id` | `conta_pagar_id`)
  · `valor_conciliado` · `conciliado_por` · `automatica bool`

### `centro_custo` / `natureza_lancamento` / `rateio_regra`
Estruturas hierárquicas parametrizáveis por tenant, usadas na alocação de `RN-025`.

---

## A.10 Serviços transversais

### `audit_log` *(append-only, particionada por mês, sem UPDATE/DELETE)*
`id` · `tenant_id` · `entidade_tipo` · `entidade_id` · `acao`
· `campo` · `valor_anterior jsonb` · `valor_novo jsonb`
· `usuario_id` · `perfil_efetivo` · `motivo`
· `request_id` · `ip` · `user_agent` · `origem` (`WEB`|`PWA`|`API`|`JOB`|`SUPORTE`)
· `criado_em` · `hash_anterior` · `hash_registro`
· INDEX `(tenant_id, entidade_tipo, entidade_id, criado_em DESC)`

### `notificacao` *(particionada por mês)*
`id` · `tenant_id` · `tipo` · `severidade` · `titulo` · `mensagem`
· `entidade_tipo` · `entidade_id` · `destinatario_id` · `canais text[]`
· `status` (`PENDENTE`|`ENVIADA`|`LIDA`|`ARQUIVADA`|`FALHA`) · `atribuido_a`
· `agrupamento_chave` · `criado_em` · `lido_em`

### `outbox_evento`
`id` · `tenant_id` · `agregado_tipo` · `agregado_id` · `tipo_evento` · `versao_schema`
· `payload jsonb` · `criado_em` · `publicado_em` · `tentativas` · `ultimo_erro`
- Gravado na **mesma transação** da mudança de estado; publicado por worker dedicado.

### `job_execucao`
`id` · `tenant_id` · `tipo` · `parametros jsonb` · `status` · `inicio` · `fim`
· `resultado jsonb` · `erro` · `solicitado_por` — usado por fechamento, exportações e importações.

### `integracao_config` / `integracao_log` / `webhook_entrega`
Configuração por tenant e parceiro; log de payload/resultado com `idempotency_key`;
entregas de webhook com tentativas e assinatura HMAC.

### `parametro_tenant`
`tenant_id` · `chave` · `valor jsonb` · `atualizado_por` · `atualizado_em`
— política de bloqueio, réguas de alerta, tolerâncias, limites de indicadores.

---

## A.11 Índices críticos de desempenho

| Tabela | Índice | Consulta atendida |
| --- | --- | --- |
| `equipamento` | `(tenant_id, status, categoria_id, filial_id)` | Disponibilidade em tempo real |
| `equipamento` | GiST `(geo_atual)` | Mapa por *viewport* |
| `contrato_item` | GiST `(tenant_id, equipamento_id, vigencia)` | Verificação de conflito (`RN-001`) |
| `contrato` | `(tenant_id, status, data_fim)` | Painel de renovação e alertas |
| `leitura_medidor` | `(tenant_id, equipamento_id, data_leitura DESC)` | Última leitura e consumo do período |
| `movimentacao` | `(tenant_id, equipamento_id, data_movimento DESC)` | Timeline do ativo |
| `ordem_servico` | `(tenant_id, status, prazo_solucao_em)` | Fila por risco de SLA |
| `ordem_servico` | `(tenant_id, equipamento_id, abertura_em DESC)` | Histórico técnico |
| `movimento_estoque` | `(tenant_id, peca_id, data_movimento DESC)` | Extrato e reconstituição de saldo |
| `conta_receber` | `(tenant_id, status, vencimento)` | Aging e régua de cobrança |
| `lancamento_financeiro` | `(tenant_id, equipamento_id, data_competencia)` | Rentabilidade por ativo |
| `audit_log` | `(tenant_id, entidade_tipo, entidade_id, criado_em DESC)` | Aba de histórico |

## A.12 Projeções materializadas (leitura)

| Projeção | Conteúdo | Atualização |
| --- | --- | --- |
| `mv_disponibilidade_frota` | Contagem por filial × categoria × estado | Por evento (`equipamento.*`) |
| `mv_ocupacao_periodo` | Dias locados vs. disponíveis por ativo/mês | Diária |
| `mv_resultado_equipamento` | Receita, custo e margem por ativo/mês | Por evento financeiro |
| `mv_resultado_cliente` | Receita, custo e margem por cliente/mês | Por evento financeiro |
| `mv_aging_recebiveis` | Faixas de atraso por cliente | Diária |
| `mv_sla_manutencao` | Aderência de SLA por período/técnico/cliente | Por evento (`os.*`) |
| `mv_mapa_clusters` | Agregação espacial por zoom | Por evento de movimentação |
