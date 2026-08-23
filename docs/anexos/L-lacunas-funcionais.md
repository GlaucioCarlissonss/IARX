# Anexo L — Lacunas funcionais: especificação para desenvolvimento

Especificação dos sete módulos identificados como faltantes. Cada um é
posicionado contra o que **já existe** no repositório — em vários casos a base
está mais adiantada do que a análise inicial supunha, e em um caso o modelo
atual **não comporta** o requisito sem uma decisão estrutural prévia.

> **Escopo deste anexo:** modelagem, regras, fluxos, contratos de API e
> critérios de aceite. Nenhum dado de negócio (preço, cliente, contrato) é
> inventado aqui.

---

## L.0 O que o levantamento mudou

Três achados alteram o plano antes de qualquer linha de código.

### L.0.1 Não existe eixo de cliente no modelo de acesso — bloqueia os módulos 4 e 5

`app.escopo_tipo` (migração 0001) é `TENANT · EMPRESA · FILIAL · REGIAO ·
PROPRIO`. **Todos são unidades do locador.** A RLS isola por `tenant_id`, e o
tenant é a empresa locadora.

Um usuário do cliente locatário não é um tenant — é um usuário que enxerga um
recorte do tenant do locador, delimitado por `cliente_id`. Esse eixo não
existe hoje, nem no enum, nem nas políticas de RLS, nem nas claims do token.

Consequência prática: **o Portal do Cliente não é uma tela nova, é um segundo
eixo de isolamento.** Implementá-lo com filtro na aplicação em vez de RLS
produziria a falha clássica — uma consulta nova esquece o `where cliente_id` e
o cliente A passa a ver o contrato do cliente B. Ver `MÓDULO 4`, decisão D-01.

### L.0.2 "Filial do cliente" não é a tabela `filial`

| Termo do requisito | O que existe hoje | Observação |
| --- | --- | --- |
| Filial do cliente | `local_operacao` (cliente_id, nome, endereço, geo) | É o site onde o equipamento opera |
| Filial | `filial` (empresa_id do locador, código, região) | É a base do **locador** |
| Grupo econômico | — | Não existe |

O requisito "Gestor de Filial (Cliente)" exige que a filial do cliente seja
unidade organizacional com usuários vinculados, não apenas um endereço de
entrega. Ver decisão D-02.

### L.0.3 Três módulos estão parcialmente prontos

| Módulo | Estado real |
| --- | --- |
| 6 — Consumo de impressões | **~70% pronto.** `medidor` + `leitura_medidor` (particionada por mês), RN-020 imposta por gatilho, `origem` já aceita `IMPORTACAO`/`API`/`TELEMETRIA`, estorno com motivo, `foto_anexo_id`. Falta: importação CSV, alertas de 80/100%, painel de consumo do cliente |
| 7 — Mapa | **Backend pronto.** Migração 0008 já traz `geo geography(Point,4326)` em `filial`, `local_operacao` e `equipamento`, índices GiST e a função `app.mapa_ativos(viewport, zoom)` com agrupamento por zoom. Falta: geocodificação, provedor de tiles e a tela |
| 2 e 3 — Franquia e preço | **Parâmetros existem, tabela reutilizável não.** `modelo` tem `preco_tabela_mensal` e franquia sugerida; `contrato_item` tem `valor_unitario`, `franquia_quantidade`, `valor_excedente_unitario`. Falta a tabela versionada com vigência |

---

## MÓDULO 1: Entrada de Nota Fiscal de Compra de Equipamentos

### Status
- [x] Novo

### Descrição

Registra a entrada fiscal dos equipamentos adquiridos e faz deles a **origem
única** do cadastro de ativos. Hoje `equipamento.nota_fiscal` é um campo de
texto livre e `valor_aquisicao` é digitado: dois ativos comprados na mesma nota
podem ficar com valores diferentes, e não há como reconciliar o patrimônio com
o que foi de fato comprado.

O módulo inverte o fluxo: **o ativo nasce da nota**, não o contrário. Isso
resolve de uma vez a procedência do valor de aquisição, a data de início da
depreciação e o prazo de garantia — os três hoje sem fonte.

### Modelagem de Dados

```
nota_fiscal_compra
  id                  uuid  PK
  tenant_id           uuid  FK → tenant           NOT NULL
  fornecedor_id       uuid  FK → fornecedor       NOT NULL
  numero              text                        NOT NULL
  serie               text                        NOT NULL
  chave_acesso        char(44)                    NULL   -- chave da NF-e
  modelo_documento    text  DEFAULT '55'                 -- 55=NF-e, 65=NFC-e
  data_emissao        date                        NOT NULL
  data_entrada        date                        NOT NULL
  valor_produtos      numeric(15,4)               NOT NULL
  valor_frete         numeric(15,4) DEFAULT 0
  valor_desconto      numeric(15,4) DEFAULT 0
  valor_total         numeric(15,4)               NOT NULL
  filial_destino_id   uuid  FK → filial           NOT NULL
  status              app.nf_status               NOT NULL DEFAULT 'PENDENTE_CONFERENCIA'
  observacao          text
  conferida_em        timestamptz
  conferida_por       uuid  FK → usuario
  integrada_em        timestamptz
  + colunas de auditoria e soft delete (padrão do repositório)

  CHECK  data_entrada >= data_emissao
  CHECK  valor_total = valor_produtos + valor_frete - valor_desconto
  CHECK  chave_acesso IS NULL OR chave_acesso ~ '^\d{44}$'
  CHECK  status <> 'INTEGRADA' OR conferida_em IS NOT NULL

nota_fiscal_item
  id                  uuid  PK
  tenant_id           uuid  FK → tenant           NOT NULL
  nota_fiscal_id      uuid  FK → nota_fiscal_compra ON DELETE CASCADE
  numero_item         integer                     NOT NULL
  modelo_id           uuid  FK → modelo           NOT NULL
  descricao_nf        text                        NOT NULL   -- como veio na nota
  ncm                 text
  cfop                text
  quantidade          integer                     NOT NULL
  valor_unitario      numeric(15,4)               NOT NULL
  valor_total_item    numeric(15,4)               NOT NULL
  garantia_meses      integer
  garantia_ate        date

  CHECK  quantidade > 0
  CHECK  valor_unitario >= 0
  UNIQUE (nota_fiscal_id, numero_item)

nota_fiscal_item_serie          -- uma linha por unidade física
  id                  uuid  PK
  tenant_id           uuid  FK → tenant           NOT NULL
  nota_fiscal_item_id uuid  FK → nota_fiscal_item ON DELETE CASCADE
  numero_serie        text                        NOT NULL
  patrimonio          text                        NOT NULL
  equipamento_id      uuid  FK → equipamento      NULL  -- preenchido na integração
```

**Alterações em tabelas existentes**

```
equipamento
  + nota_fiscal_item_serie_id  uuid FK → nota_fiscal_item_serie  UNIQUE  NULL
  + garantia_ate               date
  - nota_fiscal                text   -- descontinuado; migrado para a FK
```

**Relacionamentos**

- `fornecedor 1:N nota_fiscal_compra`
- `nota_fiscal_compra 1:N nota_fiscal_item` (cardinalidade obrigatória ≥ 1)
- `nota_fiscal_item 1:N nota_fiscal_item_serie` — exatamente `quantidade` linhas
- `nota_fiscal_item_serie 1:1 equipamento` — a unicidade impede que a mesma
  unidade da nota gere dois ativos

**Índices recomendados**

```sql
create unique index nfc_chave_uk on nota_fiscal_compra (chave_acesso)
  where chave_acesso is not null and deleted_at is null;
create unique index nfc_numero_uk on nota_fiscal_compra
  (tenant_id, fornecedor_id, numero, serie) where deleted_at is null;
create index nfc_periodo_ix on nota_fiscal_compra (tenant_id, data_entrada desc);
create index nfc_status_ix on nota_fiscal_compra (tenant_id, status)
  where status <> 'INTEGRADA';
create unique index nfis_serie_uk on nota_fiscal_item_serie (tenant_id, numero_serie);
create unique index nfis_patrimonio_uk on nota_fiscal_item_serie (tenant_id, patrimonio);
```

### Regras de Negócio

1. **RN-L01 — Nota é imutável após integrada.** Depois de `INTEGRADA`, nenhum
   campo da nota ou dos itens pode ser alterado. Correção só por nota de
   ajuste, referenciando a original. *Motivo: os ativos já existem e carregam
   valor de aquisição e garantia derivados dela.*
2. **RN-L02 — Séries antes da conferência.** A nota só passa a `CONFERIDA` com
   `count(nota_fiscal_item_serie) = quantidade` para **todos** os itens.
   Imposto por gatilho, não pela aplicação.
3. **RN-L03 — Integração é atômica.** A transição `CONFERIDA → INTEGRADA` cria
   todos os equipamentos numa única transação. Falha em um cria nenhum. *Um
   lote parcialmente integrado deixa o operador sem saber o que entrou.*
4. **RN-L04 — Patrimônio e série únicos no tenant.** Verificados contra
   `equipamento` **e** contra outras notas ainda não integradas.
5. **RN-L05 — Rateio de frete.** O `valor_aquisicao` do ativo é
   `valor_unitario + (frete − desconto) × valor_total_item ÷ valor_produtos ÷
   quantidade`. Arredondamento na última casa vai para a primeira unidade, de
   modo que a soma dos ativos feche exatamente com o total da nota.
6. **RN-L06 — Garantia herdada.** `garantia_ate` do ativo é, nesta ordem: o
   valor informado no item; ou `data_entrada + garantia_meses`; ou nulo.
   Herdada uma vez, na integração — alterações posteriores na nota não
   propagam (a nota já é imutável).
7. **RN-L07 — Estado inicial do ativo.** Equipamento criado nasce `DISPONIVEL`,
   na `filial_destino_id` da nota, sem contrato. Nunca nasce alocado.
8. **RN-L08 — XML é fonte, não anexo.** Quando o XML da NF-e é enviado, número,
   série, chave, emissão, valores e itens são **extraídos dele** e os campos
   ficam somente leitura. Digitação manual só na ausência de XML. *Digitar o
   que já está no arquivo é a origem mais comum de divergência fiscal.*
9. **RN-L09 — Cancelamento.** Nota `PENDENTE` ou `CONFERIDA` pode ser cancelada
   com motivo. `INTEGRADA` não pode: exige baixa patrimonial dos ativos gerados,
   que é outro fluxo.

### Fluxo de Usuário

1. Operacional abre **Notas fiscais → Registrar entrada**.
2. Envia o XML (caminho principal) ou escolhe entrada manual.
3. O sistema extrai cabeçalho e itens; o operador vincula cada item da nota a um
   `modelo` do catálogo — a descrição fiscal raramente coincide com o nome
   comercial, então este passo é humano e fica registrado.
4. Para cada item, informa as séries e os patrimônios (`quantidade` linhas).
   Leitor de código de barras preenche a série; o patrimônio pode ser gerado por
   sequência da filial.
5. Anexa o PDF (DANFE). Nota é salva como `PENDENTE_CONFERENCIA`.
6. Conferência física: o conferente marca **Conferir**. RN-L02 é verificada.
7. **Integrar ao patrimônio**: pré-visualização listando os *N* ativos que serão
   criados, com valor rateado e garantia calculada. Confirmação cria tudo.
8. A tela mostra o resultado com atalho para o parque filtrado nos novos ativos.

### Endpoints de API

```
GET    /api/v1/notas-fiscais                → lista; filtros: status, fornecedor_id,
                                               data_entrada[gte|lte], numero
POST   /api/v1/notas-fiscais                → cria (manual)         [Idempotency-Key]
POST   /api/v1/notas-fiscais/importar-xml   → cria a partir do XML  [Idempotency-Key]
GET    /api/v1/notas-fiscais/{id}           → detalhe; ?include=itens,series,anexos
PATCH  /api/v1/notas-fiscais/{id}           → edição (só PENDENTE)  [If-Match]
POST   /api/v1/notas-fiscais/{id}/itens/{itemId}/series → informa séries e patrimônios
POST   /api/v1/notas-fiscais/{id}/conferir  → → CONFERIDA
POST   /api/v1/notas-fiscais/{id}/integrar  → → INTEGRADA, cria os ativos [Idempotency-Key]
POST   /api/v1/notas-fiscais/{id}/cancelar  → cancela com motivo
GET    /api/v1/notas-fiscais/{id}/previa-integracao → ativos que serão criados
GET    /api/v1/relatorios/notas-fiscais     → por período, fornecedor, modelo
```

Permissões novas: `nota_fiscal:ler` · `:criar` · `:editar` · `:conferir` ·
`:integrar` · `:cancelar`. Segregação de funções (RN-027): **quem registra a
nota não pode conferi-la.**

### Dependências
- **Depende de:** `fornecedor` (existe), `modelo` (existe), `filial` (existe),
  anexos (existe — Anexo K.5b)
- **Habilita:** cadastro de equipamento com procedência; controle de garantia;
  depreciação com data de início confiável

### Critérios de Aceite
- [ ] Importar XML de NF-e preenche cabeçalho e itens sem digitação
- [ ] Nota sem todas as séries informadas não passa a `CONFERIDA`
- [ ] Integração cria exatamente `Σ quantidade` equipamentos, todos `DISPONIVEL`
- [ ] A soma de `valor_aquisicao` dos ativos gerados é igual a `valor_total` da nota
- [ ] Série ou patrimônio duplicado é recusado apontando o campo e o registro existente
- [ ] Nota `INTEGRADA` recusa qualquer edição
- [ ] Falha na criação de um ativo não deixa nenhum criado
- [ ] Relatório por período, fornecedor e modelo exporta em PDF e Excel

### Lacunas e Decisões Pendentes
- **[DECISÃO D-03]** Origem do XML: upload manual, integração com o portal do
  fornecedor, ou consulta à SEFAZ por chave de acesso? A consulta automática
  exige certificado A1 e muda a arquitetura do módulo.
- **[DECISÃO D-04]** Há ERP financeiro que já registra a NF de compra? Se sim,
  este módulo consome dele em vez de ser a origem, e a direção da integração
  inverte.
- **[LACUNA]** Impostos (ICMS, IPI, ST) não estão modelados. Compõem o custo de
  aquisição e afetam a depreciação. Necessário definir se entram agora.
- **[LACUNA]** Não há tratamento de nota de serviço (instalação, frete
  contratado à parte) nem de importação com nacionalização.

---

## MÓDULO 2: Tabela de Franquias

### Status
- [x] Melhoria sobre existente

### Descrição

Os parâmetros de franquia **já existem**, mas apenas como valores digitados em
cada item de contrato (`contrato_item.franquia_quantidade`,
`valor_excedente_unitario`) e como sugestão no catálogo
(`modelo.franquia_mono`). Não existe a tabela reutilizável e versionada.

O efeito hoje: reajustar o preço de excedente exige editar item por item, e não
há registro do que valia antes. Uma contestação de fatura de seis meses atrás
não tem como ser respondida.

### Decisão de arquitetura: tabela como fonte, item como fotografia

O item de contrato **continua guardando os valores**, e passa a guardar também
a referência à tabela de origem. Não é redundância: são duas verdades
diferentes e ambas necessárias.

| Onde | O que é | Muda quando |
| --- | --- | --- |
| `tabela_franquia_item` | O que a política diz hoje | Nova versão da tabela |
| `contrato_item.franquia_*` | O que este cliente acordou | Aditivo contratual |

Trocar a tabela **não** altera contrato vigente. É o que impede que um reajuste
comercial reprecifique retroativamente 400 contratos.

### Modelagem de Dados

```
tabela_franquia
  id                uuid  PK
  tenant_id         uuid  FK → tenant     NOT NULL
  nome              text                  NOT NULL
  descricao         text
  vigencia_inicio   date                  NOT NULL
  vigencia_fim      date                  NULL      -- aberta
  status            app.tabela_status     NOT NULL DEFAULT 'RASCUNHO'
                    -- RASCUNHO | ATIVA | INATIVA
  versao            integer               NOT NULL DEFAULT 1
  substitui_id      uuid  FK → tabela_franquia  NULL
  + auditoria e soft delete

  CHECK vigencia_fim IS NULL OR vigencia_fim > vigencia_inicio

tabela_franquia_item
  id                       uuid  PK
  tenant_id                uuid  FK → tenant  NOT NULL
  tabela_franquia_id       uuid  FK → tabela_franquia ON DELETE CASCADE
  -- Alvo: exatamente um dos dois
  categoria_id             uuid  FK → categoria_equipamento  NULL
  modelo_id                uuid  FK → modelo                 NULL

  franquia_mono            integer        NOT NULL DEFAULT 0
  franquia_color           integer        NOT NULL DEFAULT 0
  franquia_escopo          text           NOT NULL DEFAULT 'ITEM'   -- ITEM | CONTRATO
  valor_pagina_mono        numeric(15,6)  NOT NULL DEFAULT 0  -- dentro da franquia
  valor_pagina_color       numeric(15,6)  NOT NULL DEFAULT 0
  valor_excedente_mono     numeric(15,6)  NOT NULL
  valor_excedente_color    numeric(15,6)  NOT NULL DEFAULT 0
  permite_acumulo          boolean        NOT NULL DEFAULT false
  meses_acumulo            integer

  CHECK (categoria_id IS NULL) <> (modelo_id IS NULL)
  CHECK valor_excedente_mono >= 0 AND valor_excedente_color >= 0
  CHECK NOT permite_acumulo OR meses_acumulo BETWEEN 1 AND 12

contrato_item  (alteração)
  + tabela_franquia_id       uuid FK → tabela_franquia  NULL
  + tabela_franquia_item_id  uuid FK → tabela_franquia_item  NULL

contrato_tabela_historico   -- auditoria de vínculo (requisito explícito)
  id                  uuid PK
  tenant_id           uuid FK → tenant
  contrato_id         uuid FK → contrato
  tipo                text  -- FRANQUIA | PRECO
  tabela_anterior_id  uuid
  tabela_nova_id      uuid
  motivo              text NOT NULL
  aplicado_em         timestamptz NOT NULL DEFAULT now()
  aplicado_por        uuid FK → usuario
```

**Índices**

```sql
create index tf_vigencia_ix on tabela_franquia (tenant_id, status, vigencia_inicio desc);
create unique index tfi_alvo_uk on tabela_franquia_item
  (tabela_franquia_id, coalesce(categoria_id, modelo_id));
```

### Regras de Negócio

1. **RN-L10 — Resolução mais específica primeiro.** Ao aplicar a tabela a um
   ativo: linha por `modelo_id` vence linha por `categoria_id`. Sem nenhuma das
   duas, o item exige preenchimento manual — nunca assume zero. *Franquia
   assumida como zero cobra tudo como excedente.*
2. **RN-L11 — Tabela `ATIVA` é imutável.** Alterar exige criar nova versão
   (`substitui_id`), que herda o conteúdo. A anterior recebe `vigencia_fim` e
   passa a `INATIVA`.
3. **RN-L12 — Sem sobreposição de vigência por alvo.** Duas tabelas `ATIVA` não
   podem cobrir o mesmo `(categoria|modelo)` em períodos que se cruzam.
   Imposto por `EXCLUDE USING gist` sobre `daterange` — mesmo mecanismo de
   RN-001.
4. **RN-L13 — Vínculo não retroage.** Trocar a tabela de um contrato vale a
   partir da **próxima competência**. A competência em fechamento usa a que
   estava vigente no início dela.
5. **RN-L14 — Troca exige motivo.** Registrada em `contrato_tabela_historico`.
6. **RN-L15 — Franquia de contrato exige rateio declarado.** Com
   `franquia_escopo = 'CONTRATO'`, o excedente é apurado sobre a soma dos
   ativos, e a política de rateio entre itens precisa estar definida no
   contrato — caso contrário a fatura não sabe a qual item atribuir o excedente.
7. **RN-L16 — Categoria sem contador não aceita franquia.** Desktop e notebook
   (`categoria.tem_contador = false`) recusam linha de franquia.

### Fluxo de Usuário

1. **Tabelas → Franquias → Nova tabela.** Nome, descrição e vigência.
2. Acrescenta linhas: escolhe categoria **ou** modelo, define franquia mono e
   color, valores de excedente. A tela mostra, para cada linha, quantos
   contratos vigentes seriam afetados se a tabela fosse aplicada.
3. Salva como `RASCUNHO`. Enquanto rascunho, edita livremente.
4. **Ativar**: RN-L12 é verificada; conflito de vigência é recusado nomeando a
   tabela conflitante.
5. No contrato, **Aplicar tabela de franquia**: escolhe a tabela, informa o
   motivo, vê a prévia do impacto por item e confirma.
6. Reajuste anual: **Nova versão** a partir da tabela vigente, ajusta os
   valores, define o início da nova vigência e ativa. As duas ficam no
   histórico.

### Endpoints de API

```
GET    /api/v1/tabelas-franquia                 → lista; ?status=ATIVA&vigente_em=
POST   /api/v1/tabelas-franquia                 → cria rascunho
GET    /api/v1/tabelas-franquia/{id}            → ?include=itens,contratos_vinculados
PATCH  /api/v1/tabelas-franquia/{id}            → edita (só RASCUNHO)  [If-Match]
POST   /api/v1/tabelas-franquia/{id}/itens      → acrescenta linha
POST   /api/v1/tabelas-franquia/{id}/ativar     → RASCUNHO → ATIVA (valida RN-L12)
POST   /api/v1/tabelas-franquia/{id}/nova-versao→ clona para nova versão
POST   /api/v1/contratos/{id}/tabela-franquia   → vincula, com motivo [Idempotency-Key]
GET    /api/v1/contratos/{id}/tabela-franquia/historico
GET    /api/v1/tabelas-franquia/{id}/impacto    → contratos e itens afetados
```

Permissões: `tabela_franquia:ler` · `:gerenciar` · `:ativar`.

### Dependências
- **Depende de:** `categoria_equipamento`, `modelo`, `contrato_item` (todos existem)
- **Habilita:** Módulo 3 (simulador), Módulo 5 (portal mostra a franquia
  contratada), Módulo 6 (cálculo de excedente com origem rastreável)

### Critérios de Aceite
- [ ] Tabela `ATIVA` recusa edição direta e oferece "nova versão"
- [ ] Duas tabelas ativas cobrindo o mesmo modelo em vigências sobrepostas são recusadas
- [ ] Linha por modelo prevalece sobre linha por categoria na resolução
- [ ] Trocar a tabela de um contrato não altera a fatura da competência em fechamento
- [ ] O histórico registra tabela anterior, nova, motivo, usuário e data
- [ ] Categoria sem contador recusa franquia com mensagem explicando por quê
- [ ] A prévia de impacto lista os contratos afetados antes da confirmação

### Lacunas e Decisões Pendentes
- **[DECISÃO D-05]** Franquia acumulativa (saldo não usado passa para o mês
  seguinte) existe no negócio? Está modelada como opção mas muda o motor de
  faturamento — o Anexo E hoje apura por competência fechada.
- **[LACUNA]** Franquia por página A3 contando como 2×A4 é prática comum e não
  está prevista. Confirmar se aplica.
- **[LACUNA]** Não há previsão de franquia por *scan* — alguns contratos cobram.

---

## MÓDULO 3: Preço de Locação

### Status
- [x] Melhoria sobre existente

### Descrição

Mesma situação do módulo 2: `modelo.preco_tabela_mensal` é o preço de tabela e
`contrato_item.valor_unitario` é o acordado, mas não há tabela comercial
versionada, nem desconto com vigência própria, nem os valores de setup e
retirada — hoje eles simplesmente não existem em lugar nenhum.

### Modelagem de Dados

```
tabela_preco
  id, tenant_id, nome, descricao, vigencia_inicio, vigencia_fim, status,
  versao, substitui_id                              (mesma forma de tabela_franquia)
  + moeda                text NOT NULL DEFAULT 'BRL'
  + abrangencia          text NOT NULL DEFAULT 'GERAL'   -- GERAL | CLIENTE | CONTRATO
  + cliente_id           uuid FK → cliente  NULL
  CHECK (abrangencia = 'CLIENTE') = (cliente_id IS NOT NULL)

tabela_preco_item
  id                    uuid PK
  tenant_id             uuid FK → tenant
  tabela_preco_id       uuid FK → tabela_preco ON DELETE CASCADE
  categoria_id          uuid FK → categoria_equipamento  NULL
  modelo_id             uuid FK → modelo                 NULL

  valor_mensal          numeric(15,4)  NOT NULL
  valor_instalacao      numeric(15,4)  NOT NULL DEFAULT 0
  valor_retirada        numeric(15,4)  NOT NULL DEFAULT 0
  valor_manutencao      numeric(15,4)  NOT NULL DEFAULT 0   -- 0 = incluso
  prazo_minimo_meses    integer

  CHECK (categoria_id IS NULL) <> (modelo_id IS NULL)
  CHECK todos os valores >= 0

desconto_comercial
  id                    uuid PK
  tenant_id             uuid FK → tenant
  -- Alvo: contrato inteiro ou item específico
  contrato_id           uuid FK → contrato       NULL
  contrato_item_id      uuid FK → contrato_item  NULL
  tipo                  text NOT NULL            -- PERCENTUAL | VALOR_FIXO
  percentual            numeric(5,2)
  valor                 numeric(15,4)
  vigencia_inicio       date NOT NULL
  vigencia_fim          date NULL
  motivo                text NOT NULL
  aprovado_por          uuid FK → usuario
  aprovado_em           timestamptz

  CHECK (contrato_id IS NULL) <> (contrato_item_id IS NULL)
  CHECK (tipo = 'PERCENTUAL') = (percentual IS NOT NULL)
  CHECK percentual IS NULL OR percentual BETWEEN 0 AND 100

contrato_item  (alteração)
  + tabela_preco_id       uuid FK → tabela_preco       NULL
  + tabela_preco_item_id  uuid FK → tabela_preco_item  NULL
  + valor_instalacao      numeric(15,4) DEFAULT 0
  + valor_retirada        numeric(15,4) DEFAULT 0
```

### Regras de Negócio

1. **RN-L17 — Precedência de tabela.** Contrato → Cliente → Geral. A mais
   específica vigente na data vence. Registrada no item para a fatura poder
   explicar de onde veio o valor.
2. **RN-L18 — Desconto tem vigência própria.** Um desconto de carência de três
   meses expira sozinho; não depende de alguém lembrar de removê-lo. *É a
   origem mais comum de receita perdida em locação.*
3. **RN-L19 — Desconto acima da alçada exige aprovação.** Reaproveita
   `alcada.tipo = 'DESCONTO'`, que já existe. Sem aprovação, o contrato não
   avança de `EM_APROVACAO`.
4. **RN-L20 — Descontos não se acumulam por padrão.** Havendo desconto de
   contrato e de item, aplica-se o de item. Acúmulo, se existir, precisa ser
   declarado no contrato.
5. **RN-L21 — Setup e retirada são eventos, não recorrência.** `valor_instalacao`
   entra na primeira fatura do item; `valor_retirada`, na fatura seguinte à
   devolução. Nunca compõem o MRR.
6. **RN-L22 — Tabela ativa é imutável** (mesma RN-L11).
7. **RN-L23 — O simulador não persiste.** Simulação é cálculo, não proposta.
   Virar proposta é ação explícita que cria um contrato em `RASCUNHO`.

### Fluxo de Usuário — Simulador

1. **Comercial → Simulador de custo.**
2. Escolhe o cliente (opcional — sem cliente usa a tabela geral).
3. Monta a cesta: modelo ou categoria + quantidade, repetindo por linha.
4. Escolhe a tabela de franquia e informa o volume mensal estimado por linha.
5. O simulador devolve, por linha e no total:
   - locação mensal, franquia inclusa, excedente projetado, custo mensal
     estimado, setup na primeira fatura, custo total do prazo contratado
6. Ajusta desconto e vê o impacto na margem — **ocultado de quem não tem
   `financeiro:rentabilidade_ler`**.
7. **Gerar proposta** cria um contrato `RASCUNHO` com os itens da simulação.

### Endpoints de API

```
GET    /api/v1/tabelas-preco                  → ?abrangencia=&cliente_id=&vigente_em=
POST   /api/v1/tabelas-preco                  → cria rascunho
POST   /api/v1/tabelas-preco/{id}/ativar
POST   /api/v1/tabelas-preco/{id}/nova-versao
POST   /api/v1/contratos/{id}/tabela-preco    → vincula, com motivo
GET    /api/v1/contratos/{id}/preco-efetivo   → preço aplicado por item, com origem
POST   /api/v1/descontos                      → cria (valida alçada)
DELETE /api/v1/descontos/{id}                 → encerra antecipadamente, com motivo
POST   /api/v1/simulacoes/custo               → calcula; NÃO persiste
POST   /api/v1/simulacoes/custo/proposta      → converte em contrato RASCUNHO
```

Permissões: `tabela_preco:ler` · `:gerenciar` · `:ativar` ·
`contrato:desconto_conceder` (já existe) · `simulacao:executar`.

### Dependências
- **Depende de:** Módulo 2 (o simulador precisa da franquia para projetar
  excedente), `alcada` (existe), `categoria`/`modelo` (existem)
- **Habilita:** Módulo 5 (portal mostra o preço contratado), proposta comercial

### Critérios de Aceite
- [ ] Tabela de cliente prevalece sobre a geral na mesma data
- [ ] Desconto com fim de vigência para de ser aplicado sem intervenção manual
- [ ] Desconto acima da alçada bloqueia o avanço do contrato e indica quem aprova
- [ ] Simulador devolve custo mensal e do prazo total a partir de cesta + volume
- [ ] Simulação não cria registro algum até a conversão explícita em proposta
- [ ] O item de contrato registra de qual tabela e versão o preço veio
- [ ] Setup aparece na primeira fatura e não no recorrente

### Lacunas e Decisões Pendentes
- **[LACUNA]** Reajuste por índice (IPCA/IGP-M) existe em `contrato` mas o motor
  de aplicação não está especificado. A tabela de preços é a origem natural —
  definir se o reajuste gera nova versão automática.
- **[DECISÃO D-06]** Preço diferenciado por filial do **cliente** depende da
  decisão D-02 (o que é filial do cliente). Modelado como pendente.
- **[LACUNA]** Não há modelagem de comissão de vendas sobre o contrato.

---

## MÓDULO 4: Usuários e Permissões

### Status
- [x] Melhoria sobre existente — **✅ implementado; ver [Anexo Q](Q-usuarios-e-permissoes.md)**

> **Atualização.** Esta seção foi escrita antes das decisões D-01/D-02, na
> época em que elas ainda bloqueavam o módulo inteiro. As duas foram tomadas
> (Anexo M) e **implementadas** na migração `0011_eixo_cliente.sql`: o escopo
> `CLIENTE` existe, `usuario.tipo`/`cliente_id` existem, a RLS restritiva por
> cliente existe, `app.provisionar_perfis_cliente` semeia os três perfis de
> cliente na criação do tenant. O texto original abaixo é mantido como registro
> — o nome real de uma tabela (`usuario_local_cliente`, não
> `usuario_filial_cliente`) e o do segundo valor de escopo (`LOCAL_CLIENTE`,
> não `FILIAL_CLIENTE`) divergem do rascunho por decisão tomada durante a
> implementação. **O que falta agora não é o modelo — é a tela e a API que o
> operam**, detalhado em §4.1 e §4.2 abaixo.

### Descrição

O **modelo** de autorização está completo e é o mais maduro do repositório:
`usuario`, `perfil` com array de permissões validado por gatilho,
`usuario_perfil` com escopo, `alcada` por tipo, catálogo de 106 permissões
compartilhado entre API e front (`packages/contracts`), guarda que nega rota
sem permissão declarada, e verificador que reprova o CI se algum handler
esquecer o decorador.

O que **não existe** — confirmado por busca no repositório, não suposição:
nenhum controlador em `apps/api/src/modulos` para usuário, perfil ou
autenticação; nenhuma rota `/auth/*`; o front (`lib/contexto.tsx`) simula a
sessão com um **seletor de perfil local**, sem login real. `pode()` já existe e
já é o que qualquer `<Can>` faria — o que falta é ele ler de uma sessão de
verdade, não de um `useState` de demonstração.

### O bloqueio (histórico)

`app.escopo_tipo` = `TENANT · EMPRESA · FILIAL · REGIAO · PROPRIO`. Todos do
locador. Os três perfis de cliente pedidos (Admin Cliente, Gestor de Filial,
Visualizador) não tinham como ser expressos: não havia escopo `CLIENTE`, a RLS
não filtrava por `cliente_id`, e o token não carregava esse eixo.

Resolvido — ver a atualização acima.

### Modelagem de Dados

```
-- Extensão do enum de escopo
ALTER TYPE app.escopo_tipo ADD VALUE 'CLIENTE';
ALTER TYPE app.escopo_tipo ADD VALUE 'FILIAL_CLIENTE';

usuario  (alteração)
  + tipo             text NOT NULL DEFAULT 'INTERNO'   -- INTERNO | CLIENTE
  + cliente_id       uuid FK → cliente  NULL
  + senha_hash       text NULL           -- argon2id; nulo quando usa OIDC
  + senha_alterada_em timestamptz
  + deve_trocar_senha boolean NOT NULL DEFAULT false
  + tentativas_falhas integer NOT NULL DEFAULT 0
  + bloqueado_ate    timestamptz

  CHECK (tipo = 'CLIENTE') = (cliente_id IS NOT NULL)
  CHECK senha_hash IS NOT NULL OR subject_oidc IS NOT NULL

usuario_filial_cliente          -- visibilidade por filial do cliente
  id                 uuid PK
  tenant_id          uuid FK → tenant
  usuario_id         uuid FK → usuario ON DELETE CASCADE
  filial_cliente_id  uuid FK → filial_cliente
  UNIQUE (usuario_id, filial_cliente_id)

token_recuperacao
  id            uuid PK
  tenant_id     uuid FK → tenant
  usuario_id    uuid FK → usuario ON DELETE CASCADE
  token_hash    text NOT NULL        -- só o hash; o token vive no e-mail
  expira_em     timestamptz NOT NULL
  usado_em      timestamptz
  ip_solicitante inet
  CHECK expira_em > created_at
```

A trilha de auditoria de ações **já existe** (`audit_log`, append-only com
cadeia de hash, migração 0003). Falta apenas o log de *acesso*:

```
log_acesso
  id, tenant_id, usuario_id, evento, ip, user_agent, sucesso, motivo_falha, created_at
  -- evento: LOGIN | LOGOUT | FALHA_SENHA | BLOQUEIO | RECUPERACAO_SOLICITADA
  --       | RECUPERACAO_CONCLUIDA | TROCA_SENHA
```

### Perfis-base a provisionar

| Perfil | Tipo | Escopo típico | Base |
| --- | --- | --- | --- |
| Admin Fornecedor | INTERNO | TENANT | Existe (`Administrador da Plataforma`) |
| Operacional Fornecedor | INTERNO | FILIAL | Existe (`Operador Administrativo`) |
| Financeiro Fornecedor | INTERNO | EMPRESA | Existe (`Analista Financeiro`) |
| Admin Cliente | CLIENTE | CLIENTE | **Novo** |
| Gestor de Filial | CLIENTE | FILIAL_CLIENTE | **Novo** |
| Visualizador | CLIENTE | FILIAL_CLIENTE | **Novo** |

Permissões dos perfis de cliente são um **subconjunto restrito**, somente
leitura sobre os próprios dados: `contrato:ler`, `equipamento:ler`,
`fatura:ler`, `medicao:ler`, `os:ler`, `os:criar`, `mapa:ler`,
`relatorio:ler`. Nenhuma permissão de escrita sobre cadastro, preço ou
faturamento.

### Regras de Negócio

1. **RN-L24 — Isolamento do cliente é RLS, não filtro de aplicação.** Toda
   tabela visível ao cliente ganha política adicional: `cliente_id =
   app.cliente_atual()`, com `app.cliente_atual()` lendo de `SET LOCAL
   app.cliente_id` como já se faz com o tenant. *Filtro em código esquece; RLS
   nega por omissão.*
2. **RN-L25 — Usuário de cliente nunca recebe permissão de escrita de cadastro.**
   Imposto por gatilho sobre `usuario_perfil`: perfil com permissão fora da
   lista branca não pode ser atribuído a `usuario.tipo = 'CLIENTE'`.
3. **RN-L26 — Gestor de filial vê só as filiais vinculadas.** Sem vínculo em
   `usuario_filial_cliente`, não vê nada — negado por omissão.
4. **RN-L27 — Senha.** Argon2id; mínimo 12 caracteres; verificada contra lista
   de senhas vazadas; nunca trafega em log. Bloqueio progressivo após 5 falhas.
5. **RN-L28 — Token de recuperação.** Uso único, 30 minutos, invalidado ao ser
   usado ou ao gerar outro. **A resposta é idêntica para e-mail existente e
   inexistente** — caso contrário o endpoint vira enumerador de usuários.
6. **RN-L29 — Autodesativação impedida.** Usuário não desativa a própria conta
   nem remove o próprio perfil de administrador; o último admin ativo do tenant
   não pode ser desativado.
7. **RN-L30 — Desativar preserva histórico.** `status = 'INATIVO'` revoga
   sessões; nunca apaga o usuário — o `audit_log` referencia o autor.

### Fluxo de Usuário

**Convite (não cadastro com senha pelo admin)**

1. Admin abre **Configurações → Usuários → Convidar**.
2. Nome, e-mail, tipo (interno/cliente), perfil, escopo. Para cliente: qual
   cliente e quais filiais.
3. O sistema envia convite com token de uso único. **O admin nunca define a
   senha** — senha definida por terceiro é senha compartilhada.
4. O convidado define a senha, aceita os termos e acessa.

**Recuperação**

1. "Esqueci minha senha" → informa e-mail.
2. Mensagem neutra sempre: "Se houver conta com este e-mail, enviamos as
   instruções."
3. Link com token de 30 minutos → nova senha → sessões anteriores revogadas →
   evento em `log_acesso`.

### Endpoints de API

```
GET    /api/v1/usuarios                     → ?tipo=&status=&perfil_id=&cliente_id=
POST   /api/v1/usuarios/convites            → convida             [Idempotency-Key]
POST   /api/v1/usuarios/convites/{token}/aceitar → define senha (público)
GET    /api/v1/usuarios/{id}                → ?include=perfis,filiais
PATCH  /api/v1/usuarios/{id}                → dados básicos       [If-Match]
POST   /api/v1/usuarios/{id}/perfis         → atribui perfil com escopo
DELETE /api/v1/usuarios/{id}/perfis/{pid}   → revoga
POST   /api/v1/usuarios/{id}/ativar|desativar
POST   /api/v1/usuarios/{id}/revogar-sessoes
GET    /api/v1/perfis                       → catálogo
POST   /api/v1/perfis                       → cria perfil derivado
GET    /api/v1/permissoes                   → catálogo agrupado por módulo
POST   /api/v1/auth/login                   → público
POST   /api/v1/auth/recuperacao             → público, resposta neutra
POST   /api/v1/auth/recuperacao/{token}     → público, redefine
GET    /api/v1/auditoria/acessos            → ?usuario_id=&evento=&periodo=
```

Permissões: `usuario:gerenciar`, `perfil:gerenciar`, `auditoria:consultar` —
**as três já existem no catálogo.**

### 4.1 Interface administrativa de permissões (acréscimo)

O catálogo (`packages/contracts/src/catalogo-permissoes.ts`) já é granular —
106 permissões `recurso:ação`, agrupadas por comentário em oito blocos
("Contratos e clientes", "Equipamentos", "Manutenção", …). O que esse formato
**não** tem é os dois últimos níveis do pedido — módulo → tela → botão como
estrutura navegável — porque hoje o agrupamento é um comentário para quem lê o
código-fonte, não um dado que a interface possa desenhar em árvore.

Fechar essa lacuna não pede tabela nova: pede **metadado sobre o catálogo que
já existe**.

```
// packages/contracts/src/catalogo-permissoes.ts — acréscimo
export interface DescritorPermissao {
  permissao: Permissao
  modulo: string   // "Financeiro", "Contratos", "Equipamentos", …
  tela: string     // "Contas a Pagar", "Fluxo de Caixa", …
  acao: string      // rótulo curto para o botão: "Aprovar", "Exportar", …
}
export const DESCRITORES: DescritorPermissao[] = [ /* uma linha por permissão */ ]
```

A árvore da tela de permissões é `agrupar(DESCRITORES, 'modulo', 'tela')` — três
`Object.groupBy` encadeados, sem estado novo no banco. Perfil custom continua
sendo `perfil.permissoes text[]`; a árvore só decide **quais valores** essa
lista pode conter, e a validação de formato (`recurso:ação`) já existe em
`app.validar_permissoes()`.

**Herança módulo → tela → botão**, como o pedido exige: é uma regra de
**renderização**, não de dado. Marcar/desmarcar o nó "Financeiro" na árvore
marca/desmarca todos os descendentes no array enviado — o `perfil.permissoes`
resultante já sai sem o módulo, e a RLS/guarda nem precisa saber que existiu
uma árvore. Não existe "módulo sem tela" nem "tela sem botão" fora da árvore:
a permissão sempre foi atômica (`RN-026`), a árvore é só a forma de
apresentá-la sem obrigar quem configura a marcar 106 caixas soltas.

### 4.2 Autenticação, sessão e o front que hoje é encenação

O que falta, em ordem de bloqueio:

1. `POST /api/v1/auth/login` — verifica `senha_hash` (coluna já existe),
   incrementa `tentativas_falhas`, aplica `bloqueado_ate` após o limite
   configurável, emite o JWT com `permissoes` resolvidas
   (`perfil.permissoes` do(s) perfil(is) do usuário, unidos) e `escopos`
   (de `usuario_perfil`) — **o mesmo formato que `apps/api/test/apoio.ts` já
   assina para teste.** Produção passa a assinar o token real; o formato não
   muda.
2. `lib/contexto.tsx` troca o seletor de perfil local pela sessão vinda do
   login. `pode()` não muda de assinatura — só passa a ler permissão de rede,
   não de `useState`.
3. Telas de usuário (`GET/POST /api/v1/usuarios`, `.../perfis`,
   `.../convites`) e de perfil (árvore de §4.1), no padrão de
   `apps/api/src/modulos/notas-fiscais`.
4. Recuperação de senha (`token_recuperacao` já existe) e expiração periódica
   configurável — precisa de `tenant.politica_senha jsonb` ou equivalente;
   **decisão pendente, ver D-15**.

### Dependências
- **Depende de:** decisão **D-01** (eixo de cliente na RLS) e **D-02** (filial
  do cliente). Sem elas, os três perfis de cliente não são implementáveis
- **Habilita:** Módulo 5 integralmente; recorte por filial nos módulos 6 e 7

### Critérios de Aceite
- [ ] Usuário de cliente A não obtém dado do cliente B **mesmo com o filtro da
      aplicação removido** — teste que ataca a consulta diretamente
- [ ] Gestor de filial sem vínculo não vê contrato algum
- [ ] Perfil com permissão de escrita não pode ser atribuído a usuário de cliente
- [ ] Recuperação responde igual para e-mail existente e inexistente
- [ ] Token de recuperação usado duas vezes falha na segunda
- [ ] Último admin ativo do tenant não pode ser desativado
- [ ] Todo login, falha e bloqueio aparece em `log_acesso` com IP
- [ ] Revogar sessões encerra o acesso em menos de 60 segundos

### Lacunas e Decisões Pendentes
- ~~**[DECISÃO D-01 · BLOQUEANTE]**~~ **Resolvida** (Anexo M) — escopo `CLIENTE`
  adicional na RLS, `SET LOCAL app.cliente_id`, implementado em 0011.
- ~~**[DECISÃO D-02 · BLOQUEANTE]**~~ **Resolvida** (Anexo M) — `grupo_economico
  → cliente → local_operacao`, implementado em 0011. O nome ficou
  `local_operacao` mesmo (não `filial_cliente`): o dado já existia com esse
  nome desde a 0005, e criar um segundo conceito para a mesma linha teria sido
  duplicação, não modelagem.
- **[DECISÃO D-07]** Autenticação: Supabase Auth (coerente com o Anexo H, traz
  recuperação, MFA e rotação prontos) ou implementação própria com Argon2id?
  Recomendação: Supabase Auth; `usuario.subject_oidc` já existe para isso.
  **Ainda pendente** — nenhum dos dois foi construído; é o item que bloqueia
  §4.2 item 1.
- **[DECISÃO D-08]** SSO corporativo (SAML/OIDC) para clientes grandes entra
  agora ou depois?
- **[DECISÃO D-15 · NOVA]** Política de senha é **configurável por tenant**
  (expiração em N dias, limite de tentativas antes do bloqueio, quais perfis
  ela alcança) ou **fixa no sistema**? O pedido que originou esta seção supõe
  que diretor/executivo poderiam ficar isentos de expiração — isso só é
  possível com política por perfil, que é mais estrutura do que política única
  por tenant. Recomendação: política única por tenant no lançamento (um campo
  `tenant.politica_senha jsonb`), isenção por perfil como extensão do mesmo
  campo quando houver pedido real — adicionar a exceção depois é compatível
  para trás; supor a exceção sem pedido é a lacuna de "regra que ninguém testa
  porque ninguém usa".
- **[LACUNA]** MFA: a coluna `mfa_habilitado` existe, o fluxo não.
- **[LACUNA]** Bloqueio após tentativas inválidas: a coluna `tentativas_falhas`
  e `bloqueado_ate` existem (0011), o **limite de tentativas** e a **duração do
  bloqueio** não estão parametrizados em lugar nenhum — hoje seriam constantes
  no código do futuro `POST /auth/login`. Mesma recomendação de D-15: campo de
  configuração por tenant, não constante.

---

## MÓDULO 5: Portal do Cliente

### Status
- [x] Novo

### Descrição

Superfície de consulta do locatário: contratos, equipamentos, consumo e custos
das suas filiais. Não é um produto separado — é a mesma aplicação com um
recorte de dados e uma navegação própria.

### Decisão: mesma aplicação, navegação distinta

Recomenda-se **um app, dois shells**: mesma base de código, mesmo design system,
mesma API. O perfil determina o menu, as rotas e o recorte. Duplicar a aplicação
duplicaria também cada correção de acessibilidade e cada regra de formatação.

O recorte de dados **não** é responsabilidade do shell — é da RLS (RN-L24). O
front esconde para reduzir ruído; o servidor é a autoridade. É a mesma regra já
aplicada no resto do sistema.

### Modelagem de Dados

Nenhuma tabela nova. O portal é composição de leitura sobre o que existe, com
duas visões materializadas por desempenho:

```
mv_consumo_mensal_filial       -- refresh diário + após fechamento
  tenant_id, cliente_id, filial_cliente_id, competencia,
  equipamentos_ativos, paginas_mono, paginas_color,
  franquia_mono, franquia_color, excedente_mono, excedente_color,
  valor_locacao, valor_excedente, valor_total

mv_contrato_resumo_cliente
  tenant_id, cliente_id, contrato_id, numero, status,
  data_inicio, data_fim, dias_para_vencer,
  qtd_equipamentos, valor_mensal, tabela_franquia_nome, tabela_preco_nome
```

Ambas com RLS por `tenant_id` **e** `cliente_id`.

### Regras de Negócio

1. **RN-L31 — O portal nunca mostra custo do locador.** Margem, custo de
   manutenção e valor de aquisição não existem nas rotas do cliente. Garantido
   por permissão, não por ocultação em tela.
2. **RN-L32 — O que o cliente vê é o que foi faturado.** Competência fechada
   mostra o valor da fatura emitida, não recalculado. *Recalcular na hora da
   consulta produz divergência com o boleto.*
3. **RN-L33 — Competência aberta é declarada como parcial.** Consumo do mês
   corrente aparece marcado como parcial, com a data da última leitura.
4. **RN-L34 — Drill-down respeita o escopo.** Gestor de filial não vê o
   consolidado do grupo, nem por navegação nem por URL montada à mão.
5. **RN-L35 — Exportação carrega o recorte.** O arquivo gerado contém apenas o
   que o usuário podia ver, e traz no rodapé o escopo e o instante da extração.
6. **RN-L36 — Notificação é opt-in por usuário.** Alertas de vencimento e de
   franquia têm preferência por canal e limiar.

### Fluxo de Usuário

1. Login → **Painel do cliente**: cartões de exceção primeiro (contrato vencendo,
   franquia estourada, chamado em aberto), depois consolidado.
2. Admin Cliente vê o grupo com quebra por cliente e por filial; gestor entra
   direto na sua filial.
3. **Contratos** → lista com vigência, equipamentos, tabela aplicada, valor
   mensal; detalhe abre a relação de ativos com patrimônio, modelo e local.
4. **Consumo** → por filial e por equipamento; barra de utilização da franquia
   com projeção de fechamento do mês.
5. **Custos** → histórico por competência: locação + excedente = total, com a
   memória de cálculo por item (a mesma da fatura, sem os custos do locador).
6. **Exportar** PDF ou Excel.

### Endpoints de API

```
GET /api/v1/portal/resumo                  → consolidado do escopo do usuário
GET /api/v1/portal/contratos               → ?filial_id=&status=
GET /api/v1/portal/contratos/{id}          → ?include=itens,equipamentos
GET /api/v1/portal/equipamentos            → ?filial_id=&modelo_id=
GET /api/v1/portal/consumo                 → ?competencia=&filial_id=&equipamento_id=
GET /api/v1/portal/custos                  → ?competencia_de=&competencia_ate=
GET /api/v1/portal/faturas/{id}/memoria    → memória de cálculo, sem custo do locador
POST /api/v1/portal/exportacoes            → 202 + job_id (assíncrona, Anexo D.1)
GET /api/v1/portal/notificacoes/preferencias
PUT /api/v1/portal/notificacoes/preferencias
```

O prefixo `/portal` é deliberado: torna trivial auditar que nenhuma rota de
cliente alcança dado do locador.

### Dependências
- **Depende de:** Módulo 4 (**bloqueante**), Módulo 2, Módulo 3, Módulo 6
- **Habilita:** Módulo 7 na visão do cliente; redução de chamados de "quanto vou
  pagar este mês"

### Critérios de Aceite
- [ ] Usuário do cliente A recebe 404 — não 403 — ao pedir contrato do cliente B
- [ ] Nenhuma rota `/portal` devolve margem, custo de manutenção ou valor de aquisição
- [ ] Valor de competência fechada é idêntico ao da fatura emitida
- [ ] Competência aberta aparece marcada como parcial, com a data da última leitura
- [ ] Gestor de filial não alcança o consolidado do grupo por URL montada à mão
- [ ] Exportação em PDF e Excel reflete exatamente o recorte do usuário
- [ ] Alertas de vencimento e de franquia respeitam a preferência do usuário
- [ ] Portal atende WCAG 2.2 AA no mesmo gate já existente

### Lacunas e Decisões Pendentes
- **[DECISÃO D-09]** Subdomínio próprio (`portal.cliente.app`) ou mesma origem
  com rota `/portal`? Subdomínio separado facilita CSP e cookies distintos;
  mesma origem simplifica a operação.
- **[DECISÃO D-10]** O cliente pode **abrir chamado** pelo portal? A permissão
  `os:criar` está prevista, mas isso muda o fluxo de triagem.
- **[LACUNA]** Não há definição de SLA de disponibilidade do portal, nem de
  política de retenção do histórico visível ao cliente.

---

## MÓDULO 6: Acompanhamento de Consumo de Impressões

### Status
- [x] Melhoria sobre existente — **base já implementada**

### Descrição

A espinha dorsal existe: `medidor` (um por equipamento e tipo), `leitura_medidor`
particionada por mês com `origem`, `status`, estorno com motivo e anexo de foto,
e RN-020 imposta por gatilho — leitura menor que a anterior é recusada pelo
banco, não pela aplicação. O front tem os formulários de leitura e de tratativa
de pendência.

Falta o que transforma leitura em **acompanhamento**: consolidação por
competência, comparação com a franquia como objeto de primeira classe, alertas e
importação em massa.

### Modelagem de Dados

```
consumo_competencia            -- consolidação por equipamento e competência
  id                    uuid PK
  tenant_id             uuid FK → tenant
  competencia           char(7) NOT NULL          -- AAAA-MM
  equipamento_id        uuid FK → equipamento
  contrato_item_id      uuid FK → contrato_item
  filial_cliente_id     uuid FK → filial_cliente  NULL

  leitura_inicial_mono  numeric(14,2) NOT NULL
  leitura_final_mono    numeric(14,2) NOT NULL
  paginas_mono          numeric(14,2) GENERATED ALWAYS AS
                        (leitura_final_mono - leitura_inicial_mono) STORED
  leitura_inicial_color numeric(14,2) NOT NULL DEFAULT 0
  leitura_final_color   numeric(14,2) NOT NULL DEFAULT 0
  paginas_color         numeric(14,2) GENERATED ...

  franquia_mono         integer NOT NULL
  franquia_color        integer NOT NULL DEFAULT 0
  excedente_mono        numeric(14,2) NOT NULL
  excedente_color       numeric(14,2) NOT NULL DEFAULT 0
  valor_excedente       numeric(15,4) NOT NULL

  origem_final          text NOT NULL   -- MANUAL | CAMPO | IMPORTACAO | TELEMETRIA | API | ESTIMATIVA
  justificativa         text            -- obrigatória quando ESTIMATIVA
  fechado_em            timestamptz
  fatura_item_id        uuid

  UNIQUE (tenant_id, equipamento_id, competencia)
  CHECK leitura_final_mono >= leitura_inicial_mono
  CHECK origem_final <> 'ESTIMATIVA' OR justificativa IS NOT NULL

importacao_leitura            -- lote de CSV
  id, tenant_id, arquivo_anexo_id, linhas_total, linhas_aceitas,
  linhas_rejeitadas, status, iniciada_em, concluida_em, iniciada_por
  -- status: PROCESSANDO | CONCLUIDA | CONCLUIDA_COM_ERROS | FALHOU

importacao_leitura_linha
  id, importacao_id, numero_linha, conteudo_original jsonb,
  equipamento_id, valor, resultado, mensagem_erro
  -- resultado: ACEITA | REJEITADA

alerta_consumo
  id, tenant_id, equipamento_id, contrato_item_id, competencia,
  limiar integer NOT NULL,          -- 80 | 100
  disparado_em timestamptz, notificado_em timestamptz
  UNIQUE (equipamento_id, competencia, limiar)   -- não repete o mesmo alerta
```

### Regras de Negócio

1. **RN-L37 — Consumo é derivado, nunca digitado.** `paginas_*` são colunas
   geradas. Não existe caminho para informar "consumo do mês" diretamente.
2. **RN-L38 — Leitura inicial é a final da competência anterior.** Na primeira
   competência do item, é a leitura da instalação. *Isso fecha a série: nenhuma
   página some entre dois meses.*
3. **RN-L39 — RN-020 permanece no banco.** A validação de monotonicidade
   continua no gatilho de `leitura_medidor`. A consolidação não a reimplementa.
4. **RN-L40 — Troca de medidor zera com registro.** Substituição cria novo
   `medidor` com `valor_inicial`, e a competência da troca soma o consumo dos
   dois. Sem isso a troca aparece como consumo negativo.
5. **RN-L41 — Importação é tudo-ou-nada por linha, não por arquivo.** Linhas
   válidas entram, inválidas ficam no relatório com o motivo. *Rejeitar 900
   leituras boas por 3 ruins é pior que aceitar as 900.*
6. **RN-L42 — Alerta dispara uma vez por limiar e competência.** Reprocessar não
   duplica.
7. **RN-L43 — Estimativa é exceção marcada.** Já implementado no front
   (`FormMedicao`); agora fica gravado em `origem_final` e sai marcado na fatura.
8. **RN-L44 — Competência fechada é imutável.** Correção só por estorno com
   motivo, gerando ajuste na competência seguinte.

### Fluxo de Usuário

**Coleta**
1. Manual, por equipamento (existe) · em lote por filial · por CSV · por
   telemetria (futuro).
2. CSV: modelo para download com `patrimonio;data_leitura;contador_mono;contador_color`.
   Pré-visualização mostra aceitas e rejeitadas **antes** de gravar.
3. Cada linha rejeitada informa a razão: patrimônio inexistente, leitura menor
   que a anterior, competência já fechada.

**Acompanhamento**
1. **Consumo** → filtros por cliente, filial, competência, modelo.
2. Barra de utilização por equipamento: consumido / franquia, com projeção
   linear até o fim do mês.
3. Gráfico de 12 meses por equipamento, filial e cliente.
4. Alertas de 80% e 100% na fila de exceções e por e-mail.

### Endpoints de API

```
POST /api/v1/leituras                        → registra uma  [Idempotency-Key]
POST /api/v1/leituras/importacoes            → 202 + job_id (CSV)
GET  /api/v1/leituras/importacoes/{id}       → progresso e relatório de linhas
GET  /api/v1/leituras/importacoes/modelo.csv → modelo para preenchimento
GET  /api/v1/consumo                         → ?competencia=&cliente_id=&filial_id=
GET  /api/v1/consumo/{equipamentoId}/serie   → 12 meses
POST /api/v1/consumo/consolidar              → fecha a competência
POST /api/v1/consumo/{id}/estornar           → estorna com motivo
GET  /api/v1/alertas-consumo                 → ?limiar=&competencia=
```

Permissões: `medicao:ler` · `:consolidar` · `:estimar` ·
`equipamento:leitura_registrar` · `:leitura_estornar` — **todas já existem.**

### Dependências
- **Depende de:** Módulo 2 (franquia para calcular excedente); `medidor` e
  `leitura_medidor` (existem)
- **Habilita:** Módulo 5 (painel de consumo), faturamento com origem rastreável

### Critérios de Aceite
- [ ] Leitura menor que a anterior é recusada pelo banco, citando o valor anterior
- [ ] CSV com 1.000 linhas e 3 inválidas grava 997 e relata as 3 com a razão
- [ ] Consolidação da competência N usa como inicial a final de N−1
- [ ] Troca de medidor não produz consumo negativo
- [ ] Alerta de 80% dispara uma vez por equipamento e competência
- [ ] Competência fechada recusa alteração e oferece estorno
- [ ] Estimativa fica marcada na fatura e no relatório de exceções

### Lacunas e Decisões Pendentes
- **[DECISÃO D-11]** Telemetria: DCA na rede do cliente (SNMP/PJL), API do
  fabricante, ou permanece manual? Muda de "importação" para "integração
  contínua" e exige acordo de instalação com o cliente.
- **[LACUNA]** Não está definido o dia de corte da leitura. Ler no dia 1 e
  faturar dia 5 produz resultado diferente de ler no último dia útil.
- **[LACUNA]** Impressão A3 e duplex podem contar diferente. Confirmar a regra
  comercial.

---

## MÓDULO 7: Mapa de Filiais e Equipamentos

### Status
- [x] Melhoria sobre existente — **backend pronto, front removido**

### Descrição

A migração 0008 já entrega o backend completo: `geo geography(Point,4326)` em
`filial`, `local_operacao` e `equipamento`, índices GiST, e a função
`app.mapa_ativos(viewport, zoom)` que devolve pontos individuais ou agrupados
conforme o zoom.

O mapa existiu como SVG esquemático no protótipo e **foi removido** na
refatoração para React (Anexo I). O que falta: geocodificação, provedor de tiles
e a tela.

### Modelagem de Dados

Colunas já existentes:

```
filial.geo                    geography(Point, 4326)
local_operacao.geo            geography(Point, 4326)
local_operacao.geo_precisao   text
equipamento.geo_atual         geography(Point, 4326)
equipamento.geo_origem        text
equipamento.geo_atualizado_em timestamptz
```

A acrescentar:

```
endereco_geocodificado        -- cache; geocodificação é cara e tem cota
  id            uuid PK
  tenant_id     uuid FK → tenant
  hash_endereco text NOT NULL      -- sha256 do endereço normalizado
  cep           text
  logradouro, numero, bairro, municipio, uf
  geo           geography(Point, 4326) NOT NULL
  precisao      text NOT NULL      -- EXATA | APROXIMADA | CENTROIDE_CEP | MANUAL
  provedor      text NOT NULL
  geocodificado_em timestamptz NOT NULL DEFAULT now()
  UNIQUE (tenant_id, hash_endereco)
```

### Regras de Negócio

1. **RN-L45 — Precisão é sempre exibida.** Ponto vindo de centroide de CEP não
   pode parecer endereço exato. *Um técnico despachado para o centroide do CEP
   chega no quarteirão errado.*
2. **RN-L46 — Ajuste manual prevalece.** Coordenada corrigida à mão
   (`precisao = 'MANUAL'`) nunca é sobrescrita por regeocodificação.
3. **RN-L47 — Posição do equipamento é herdada.** `equipamento.geo_atual` é a
   do local de operação, salvo posição própria informada em campo.
4. **RN-L48 — O mapa respeita o mesmo escopo das listas.** No portal do cliente,
   só as filiais dele — pela RLS, não por filtro de front.
5. **RN-L49 — Mapa nunca é a única forma de acesso.** Toda informação do mapa
   está na visão em lista, com os mesmos filtros. *Mapa vetorial é hostil a
   teclado e leitor de tela; a lista é a implementação acessível, não um extra.*
   Esta regra já foi aplicada no protótipo e deve ser mantida.
6. **RN-L50 — Agrupamento por zoom vem do banco.** `app.mapa_ativos` já agrupa;
   o front não recebe 420 pontos para agrupar no navegador.

### Fluxo de Usuário

1. **Mapa** no menu. Abre no enquadramento que cobre o escopo do usuário.
2. Marcadores por filial, com o número de equipamentos ativos dentro.
3. Clique abre o popup: nome, endereço, quantidade e modelos, situação do
   contrato, consumo do mês. Cada dado é um atalho para a tela correspondente.
4. Filtros: cliente, filial, situação do contrato, modelo, categoria.
5. Alternância **Mapa / Lista** — a lista é a mesma informação em tabela.
6. Heatmap opcional para planejamento de rota técnica.
7. Endereço sem coordenada aparece numa fila "Sem localização" com ação de
   geocodificar ou marcar no mapa.

### Endpoints de API

```
GET  /api/v1/mapa/ativos       → ?norte=&sul=&leste=&oeste=&zoom=&cliente_id=&status=
                                 (usa app.mapa_ativos)
GET  /api/v1/mapa/filiais/{id} → popup: equipamentos, contrato, consumo
GET  /api/v1/mapa/heatmap      → densidade por célula
POST /api/v1/geocodificacao    → geocodifica endereço  [Idempotency-Key]
PUT  /api/v1/locais/{id}/geo   → ajuste manual de coordenada
GET  /api/v1/locais/sem-geo    → fila de pendências
```

Permissões: `mapa:ler`, `mapa:filtro_compartilhar` — **já existem.**

### Dependências
- **Depende de:** migração 0008 (existe), Módulo 4 para o recorte do cliente,
  Módulo 6 para o consumo no popup
- **Habilita:** planejamento de rota técnica; visão geográfica no portal

### Critérios de Aceite
- [ ] Mapa carrega em menos de 2 s com 500 equipamentos, usando agrupamento do banco
- [ ] Ponto de precisão aproximada é visualmente distinto e declarado no popup
- [ ] Ajuste manual sobrevive à regeocodificação
- [ ] Cliente vê apenas as próprias filiais, verificado com a consulta direta
- [ ] Toda informação do mapa existe na visão em lista, navegável por teclado
- [ ] Marcadores são alcançáveis por teclado e anunciados por leitor de tela
- [ ] Endereços sem coordenada aparecem em fila de pendência, não somem

### Lacunas e Decisões Pendentes
- ~~**[DECISÃO D-12]**~~ **Resolvida, revista** (Anexo O) — vetor embutido como
  piso, com camada de tiles acrescentada depois (satélite Esri por padrão,
  ruas CARTO, OSM, servidor próprio configurável). A revisão em relação ao
  texto original: nenhum provedor de tile é obrigatório, porque o build é um
  arquivo único que precisa funcionar sem rede nenhuma — algo que não estava em
  jogo quando esta decisão foi escrita.
- ~~**[DECISÃO D-13]**~~ **Resolvida** (Anexo O §O.9.4) — Nominatim, respeitando
  a política de uso (1 req/s, `countrycodes=br`), disparado por ação explícita
  e não a cada tecla. Campo de servidor de tiles próprio já previsto para
  quando o volume justificar sair do serviço público.
- **[LACUNA]** Não há política de retenção da posição histórica do equipamento —
  rastrear onde cada ativo esteve é útil e tem implicação de privacidade.

---

## MÓDULO 8: Centros de Custo

### Status
- [x] Novo — **✅ implementado** (migração 0017, API, tela)

### Descrição

Nenhuma tabela de centro de custo existe hoje. É a peça que faltava para os
outros seis módulos financeiros terem onde ratear despesa e receita — sem ela,
"análise por área" fica restrita a filial, que é uma dimensão só e já
insuficiente (duas equipes na mesma filial não se distinguem).

### Modelagem de Dados

```
centro_custo
  id            uuid PK
  tenant_id     uuid FK → tenant
  empresa_id    uuid FK → empresa NULL       -- NULL = centro global do tenant
  codigo        text NOT NULL                -- curto, para rateio e relatório
  nome          text NOT NULL
  descricao     text
  centro_pai_id uuid FK → centro_custo NULL   -- até 3 níveis (RN abaixo)
  ativo         boolean NOT NULL DEFAULT true
  created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, delete_reason
  UNIQUE (tenant_id, codigo) WHERE deleted_at IS NULL

-- Rateio: um título (a pagar ou a receber, módulos 10/11) distribuído entre
-- vários centros. Vive junto do título, não aqui — ver Módulos 10/11.
```

**Índices:** `(tenant_id, centro_pai_id)` para montar a árvore sem varrer a
tabela inteira a cada nível.

**RLS:** política restritiva de tenant, no padrão de toda tabela de negócio
(`0006`). Sem eixo de cliente — centro de custo é estrutura do locador, o
cliente nunca precisa vê-la.

### Regras de Negócio

1. **Profundidade máxima 3.** Imposta por gatilho, contando `centro_pai_id` até
   a raiz — `CHECK` não alcança recursão. Acima de 3 níveis a árvore vira
   difícil de ler numa tela e nenhuma operação de locação pediu mais que isso.
2. **Ciclo é impossível por construção**, não por checagem: o gatilho que
   valida a profundidade já percorre a cadeia de pais e recusa se encontrar o
   próprio id no caminho.
3. **Inativar um centro com filho ativo é recusado.** Inativar em cascata seria
   uma ação destrutiva silenciosa; o operador inativa a folha primeiro.
4. **Centro com título lançado não pode ser excluído**, só inativado — a
   mesma regra de soft delete que rege o resto do banco, aqui com um motivo
   extra: apagar romperia a FK de todo título já rateado nele.

### Fluxo de Usuário

1. **Configurações → Centros de Custo.** Árvore com indentação por nível,
   botão "Novo subcentro" em cada nó.
2. Cadastro: código, nome, empresa (ou "global"), centro pai (opcional).
3. Cada título a pagar/receber ganha um campo de centro de custo — obrigatório
   por padrão, com exceção configurável por tenant (ver Módulo 10, RN de
   rateio).

### Endpoints de API

```
GET    /api/v1/centros-custo              → árvore ou lista plana (?arvore=true)
POST   /api/v1/centros-custo              → cria                [Idempotency-Key]
PATCH  /api/v1/centros-custo/{id}         → edita                [If-Match]
POST   /api/v1/centros-custo/{id}/inativar
```

Permissão: `financeiro:centro_custo_gerenciar` — **já existe no catálogo**
desde antes deste levantamento, o que sugere que este módulo sempre esteve
previsto e só não tinha sido modelado.

### Dependências
- **Depende de:** nada — pode ser construído isoladamente
- **Habilita:** Módulos 10, 11, 12, 13, 14 (todos ratcam ou filtram por centro
  de custo)

### Critérios de Aceite
- [ ] Quarto nível de centro de custo é recusado, citando a profundidade
- [ ] Centro pai apontando para o próprio descendente é recusado (ciclo)
- [ ] Inativar centro com filho ativo é recusado
- [ ] Centro com título lançado não aceita exclusão física

### Lacunas e Decisões Pendentes
- **[DECISÃO D-16]** O rateio de um título entre centros aceita **percentual**,
  **valor fixo**, ou os dois? Percentual fecha sozinho em 100% e sobrevive a
  reajuste de valor sem reabrir o rateio; valor fixo é mais direto quando as
  partes já são conhecidas em reais. Recomendação: **percentual como regra**,
  valor fixo como caso especial resolvido no momento do lançamento (o valor
  fixo vira percentual calculado na hora e gravado como tal) — um único
  formato de armazenamento, duas formas de digitar.

---

## MÓDULO 9: Contas Bancárias

### Status
- [x] Novo — **✅ implementado** (migração 0017, API, tela); importação de extrato OFX fica para a próxima rodada

### Descrição

Registro das contas da operação e de suas movimentações, com saldo derivado
(não digitado) e conciliação contra os títulos dos Módulos 10/11.

### Modelagem de Dados

```
conta_bancaria
  id             uuid PK
  tenant_id      uuid FK → tenant
  empresa_id     uuid FK → empresa NOT NULL   -- toda conta pertence a uma PJ
  banco_codigo   text NOT NULL                -- código FEBRABAN, ex. '341'
  agencia        text NOT NULL
  numero         text NOT NULL
  tipo           text NOT NULL CHECK (tipo IN ('CORRENTE','POUPANCA','PAGAMENTO'))
  apelido        text NOT NULL                -- "Operação", "Investimento", "Folha"
  saldo_inicial  numeric(15,4) NOT NULL DEFAULT 0
  data_saldo_inicial date NOT NULL
  limite_credito numeric(15,4)
  status         text NOT NULL DEFAULT 'ATIVA' CHECK (status IN ('ATIVA','INATIVA','BLOQUEADA'))
  created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, delete_reason
  UNIQUE (tenant_id, empresa_id, banco_codigo, agencia, numero) WHERE deleted_at IS NULL

movimentacao_bancaria
  id              uuid PK
  tenant_id       uuid FK → tenant
  conta_id        uuid FK → conta_bancaria
  tipo            text NOT NULL CHECK (tipo IN ('ENTRADA','SAIDA','TRANSFERENCIA_ENTRADA','TRANSFERENCIA_SAIDA','TAXA'))
  valor           numeric(15,4) NOT NULL CHECK (valor > 0)
  data_movimento  date NOT NULL
  descricao       text NOT NULL
  titulo_pagar_id    uuid FK → titulo_pagar NULL     -- Módulo 10, quando é baixa
  titulo_receber_id  uuid FK → titulo_receber NULL   -- Módulo 11, idem
  transferencia_par_id uuid FK → movimentacao_bancaria NULL  -- a outra ponta da transferência
  conciliado      boolean NOT NULL DEFAULT false
  conciliado_em   timestamptz
  origem_extrato  text                              -- linha do OFX/CSV importado, para auditoria
  created_at, created_by
```

**Saldo é view, não coluna.** `saldo_atual = saldo_inicial + Σ(entrada) −
Σ(saída)`, calculado por função (`app.saldo_conta(id, ate_data)`), no mesmo
espírito de `custo_aquisicao` na nota fiscal (Anexo N): nenhum caminho de
escrita direta em saldo, então nenhum saldo pode divergir do que a soma das
movimentações prova.

**Transferência entre contas é dupla entrada**, sempre as duas linhas na mesma
transação, uma apontando para a outra via `transferencia_par_id` — o mesmo
padrão de par que a nota fiscal usa entre item e série, adaptado.

**Índices:** `(tenant_id, conta_id, data_movimento desc)` para extrato;
`(tenant_id, conta_id) WHERE NOT conciliado` para a fila de conciliação.

**RLS:** restritiva de tenant. Nenhum eixo de cliente — conta bancária é
estrutura interna, nunca exposta ao portal.

### Regras de Negócio

1. **Movimentação não se edita nem se apaga.** Estorno é lançamento contrário,
   com motivo — a mesma filosofia de `app.auditar()`: histórico nunca é
   reescrito.
2. **Transferência gera as duas pontas na mesma transação** ou nenhuma —
   nunca uma perna órfã.
3. **Conta bloqueada não aceita nova movimentação manual**, só as automáticas
   de baixa de título já em andamento (para não travar uma baixa em curso por
   um bloqueio decidido no meio do processo).
4. **Conciliação automática por correspondência exata** — valor, data (±2 dias
   de tolerância configurável) e, quando disponível, o número do documento do
   extrato batendo com o do título. Sobrando ambiguidade, cai para conciliação
   manual: o sistema nunca escolhe entre dois candidatos igualmente prováveis.

### Fluxo de Usuário

1. **Financeiro → Contas Bancárias.** Cartão por conta, com saldo atual e
   selo de status.
2. **Extrato**: lista cronológica, filtro por período/tipo, exportação.
3. **Conciliação**: importar arquivo → sistema propõe pares (movimentação ↔
   título) → operador confirma em lote ou individualmente os que ficaram
   ambíguos.
4. **Transferência**: formulário com conta de origem, destino, valor, data —
   gera as duas movimentações.

### Endpoints de API

```
GET    /api/v1/contas-bancarias                      → lista, com saldo atual calculado
POST   /api/v1/contas-bancarias                       [Idempotency-Key]
PATCH  /api/v1/contas-bancarias/{id}                  [If-Match]
GET    /api/v1/contas-bancarias/{id}/extrato          → ?de=&ate=&tipo=
POST   /api/v1/contas-bancarias/transferencias         [Idempotency-Key]
POST   /api/v1/contas-bancarias/{id}/movimentacoes    → manual  [Idempotency-Key]
POST   /api/v1/contas-bancarias/{id}/importar-extrato → 202 + job_id
GET    /api/v1/contas-bancarias/importacoes/{id}      → propostas de conciliação
POST   /api/v1/contas-bancarias/conciliacoes          → confirma pares  [Idempotency-Key]
```

Permissão: `conciliacao:executar` já existe; `conta_bancaria:gerenciar` e
`conta_bancaria:ler` são **novas** — não havia recurso "conta bancária" no
catálogo porque a tabela não existia.

### Dependências
- **Depende de:** Módulo 8 (opcionalmente, para relatório cruzado); nenhuma
  dependência dura
- **Habilita:** Módulos 10, 11 (toda baixa referencia uma conta), Módulo 13
  (fluxo de caixa parte do saldo real)

### Critérios de Aceite
- [ ] Saldo nunca é gravável diretamente — só a função de leitura existe
- [ ] Transferência sem par gerado não fica sozinha: teste força a falha da
      segunda perna e confirma que a primeira também não persiste
- [ ] Movimentação conciliada não some do extrato nem perde o vínculo com o
      título ao ser reconciliada
- [ ] Conta bloqueada recusa movimentação manual nova

### Lacunas e Decisões Pendentes
- **[DECISÃO D-17]** Formato de importação de extrato: **OFX**, **CSV** (com
  layout próprio) ou **CNAB 240/400**? OFX é o mais universal para conta
  corrente comum; CNAB é o formato de retorno de banco para cobrança
  registrada (boletos emitidos pela própria operação), que é um caso diferente
  de "conciliar o que já saiu da conta". Recomendação: **OFX primeiro**
  (cobre a maioria dos bancos brasileiros sem acordo prévio com o banco);
  CNAB entra se e quando a operação emitir boleto registrado via convênio.
- **[LACUNA]** Limite de crédito/cheque especial existe como campo, mas não há
  regra descrita de o que acontece quando o saldo projetado o ultrapassa —
  fica para o Módulo 13 (Fluxo de Caixa), que é quem tem a visão projetada.

---

## MÓDULO 10: Contas a Pagar

### Status
- [x] Novo — **✅ implementado** (migrações 0018 e 0019, API de 13 rotas, tela
      com fila de aprovação); ver [Anexo S](S-contas-a-pagar.md)

### Descrição

Títulos de despesa, com aprovação por alçada de valor — o módulo que consome
diretamente o `alcada.tipo = 'APROVACAO_PAGAMENTO'`, que **já existe no banco
desde a migração 0002** sem nunca ter tido o que aprovar. É o módulo que
alimenta o Controle de Despesas (Módulo 14): toda despesa fixa, variável ou
investimento nasce aqui.

### Modelagem de Dados

```
titulo_pagar
  id                uuid PK
  tenant_id         uuid FK → tenant
  empresa_id        uuid FK → empresa
  filial_id         uuid FK → filial NULL
  fornecedor_id     uuid FK → fornecedor NULL       -- reaproveita a tabela do Anexo N
  descricao         text NOT NULL
  classificacao     text NOT NULL CHECK (classificacao IN ('DESPESA_FIXA','DESPESA_VARIAVEL','INVESTIMENTO'))
  categoria_id      uuid FK → categoria_despesa NULL  -- Módulo 14
  contrato_fornecedor_ref text NULL                  -- livre até existir contrato de fornecedor formal
  valor_original    numeric(15,4) NOT NULL CHECK (valor_original > 0)
  valor_ajustado    numeric(15,4) NOT NULL DEFAULT valor_original  -- multa, juro, desconto negociado
  data_emissao      date NOT NULL
  data_vencimento   date NOT NULL
  status            text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN (
                      'PENDENTE','EM_APROVACAO','APROVADO','AGENDADO',
                      'PAGO_PARCIAL','PAGO','CANCELADO','EM_DISPUTA'
                    ))
  titulo_pai_id     uuid FK → titulo_pagar NULL       -- parcela filha aponta pro título pai
  parcela_numero    integer                          -- 1, 2, 3… quando é filha
  parcela_total     integer
  recorrencia_id    uuid FK → recorrencia_pagar NULL  -- Módulo 12
  version           integer NOT NULL DEFAULT 1
  created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, delete_reason

titulo_pagar_rateio
  id              uuid PK
  tenant_id       uuid FK → tenant
  titulo_id       uuid FK → titulo_pagar
  centro_custo_id uuid FK → centro_custo
  percentual      numeric(5,2) NOT NULL CHECK (percentual > 0 AND percentual <= 100)
  UNIQUE (titulo_id, centro_custo_id)
  -- CHECK cross-row (soma = 100) é gatilho, como em qualquer soma que a linha
  -- sozinha não prova — mesmo motivo do RN-L29 no rateio de nota fiscal.

titulo_pagar_aprovacao
  id            uuid PK
  tenant_id     uuid FK → tenant
  titulo_id     uuid FK → titulo_pagar
  nivel         integer NOT NULL            -- 1, 2, 3
  aprovador_id  uuid FK → usuario NULL      -- NULL até ser decidido
  decisao       text CHECK (decisao IN ('APROVADO','REJEITADO'))
  decidido_em   timestamptz
  justificativa text                        -- obrigatória em REJEITADO
  delegado_de   uuid FK → usuario NULL      -- se decidiu por delegação (ver RN abaixo)
  created_at    timestamptz NOT NULL DEFAULT now()

titulo_pagar_pagamento
  id               uuid PK
  tenant_id        uuid FK → tenant
  titulo_id        uuid FK → titulo_pagar
  valor_pago       numeric(15,4) NOT NULL CHECK (valor_pago > 0)
  data_pagamento   date NOT NULL
  conta_id         uuid FK → conta_bancaria
  forma            text NOT NULL CHECK (forma IN ('TRANSFERENCIA','BOLETO','PIX','CHEQUE'))
  estornado_em     timestamptz
  estorno_motivo   text
  movimentacao_id  uuid FK → movimentacao_bancaria
  created_at, created_by

delegacao_aprovacao
  id           uuid PK
  tenant_id    uuid FK → tenant
  delegante_id uuid FK → usuario
  delegado_id  uuid FK → usuario
  nivel        integer NOT NULL             -- delega o quê: qual nível de alçada
  inicio       date NOT NULL
  fim          date NOT NULL
  motivo       text NOT NULL
  CHECK (fim >= inicio)
```

### Regras de Negócio

1. **RN-F01 — Faixa de valor decide o número de níveis, resolvida por
   `alcada`.** `alcada.tipo = 'APROVACAO_PAGAMENTO'` já existe, por perfil, com
   `limite_valor`. Ao criar o título, o sistema busca o menor `limite_valor`
   que **não** cobre o valor do título entre os perfis do tenant, em ordem, e
   monta uma linha em `titulo_pagar_aprovacao` por nível necessário. Abaixo do
   menor limite configurado, zero linhas — aprovação automática, sem
   intervenção humana, que é literalmente "não criar linha nenhuma".
2. **RN-F02 — Aprovação é sequencial, nunca paralela.** Nível 2 só fica visível
   ao respectivo aprovador depois que o nível 1 decide `APROVADO`. Uma
   rejeição em qualquer nível encerra o fluxo em `REJEITADO`; não avança.
3. **RN-F03 — Rejeição exige justificativa** (`titulo_pagar_aprovacao.justificativa
   NOT NULL WHERE decisao = 'REJEITADO'`, gatilho) e devolve o título a
   `PENDENTE` para o solicitante corrigir e reenviar — reenviar cria uma nova
   rodada de aprovação, não reaproveita a antiga.
4. **RN-F04 — Segregação de funções.** Quem cria o título (`created_by`) não
   pode ser o aprovador de nenhum nível dele — a mesma classe de restrição do
   RN-027 (nota fiscal). Quem cadastra o fornecedor não aprova pagamento a
   esse fornecedor (Anexo C.6, já documentado — este módulo é quem finalmente
   o impõe em código).
5. **RN-F05 — Delegação é por período e por nível**, nunca "delega tudo para
   sempre". Fora do período de `delegacao_aprovacao`, a aprovação volta para o
   titular, mesmo que a delegação não tenha sido revogada manualmente — a
   data faz o trabalho, ninguém precisa lembrar de desfazer.
6. **RN-F06 — Pagamento parcial recalcula saldo, não status binário.** Status
   vira `PAGO_PARCIAL` enquanto `Σ(valor_pago) < valor_ajustado`; `PAGO`
   quando fecha; nunca abaixo de zero — pagamento que exceda o saldo é
   recusado, não vira crédito solto.
7. **RN-F07 — Estorno é lançamento contrário com motivo**, nunca exclusão do
   pagamento original (mesma regra de conta bancária, Módulo 9).
8. **RN-F08 — Parcelamento: título pai nunca recebe pagamento diretamente.**
   Só as parcelas filhas pagam; o pai existe para o relatório e para o
   cancelamento em lote (cancelar o pai propõe cancelar as filhas ainda
   pendentes, com confirmação — não cancela silenciosamente uma parcela já
   paga).
9. **RN-F09 — Rateio soma exatamente 100%** ou não existe (título sem rateio é
   100% do próprio centro de custo, um valor implícito, não uma linha).

### Fluxos de Aprovação

1. Operador financeiro cria o título → sistema calcula os níveis (RN-F01) →
   status `PENDENTE` se zero níveis (some direto para `APROVADO`) ou
   `EM_APROVACAO`.
2. Aprovador nível 1 vê o título na fila (`titulo_pagar_aprovacao` onde
   `nivel = 1 AND decisao IS NULL`) → aprova ou rejeita com justificativa.
3. Se aprovado e houver nível 2, ele aparece na fila do aprovador seguinte —
   nunca antes.
4. Ao decidir o último nível como `APROVADO`, o título vira `APROVADO` e fica
   disponível para agendamento/pagamento.
5. Notificação (via `outbox_evento`, que já existe desde a 0007 — este módulo
   é o primeiro consumidor real dele) a cada mudança de status, para
   solicitante e para o próximo aprovador da fila.

### Automações

- Ao alcançar `data_vencimento` sem pagamento, o título não muda de status
  sozinho (pagamento é ação humana), mas passa a contar para o indicador de
  atraso e para o alerta de fluxo de caixa (Módulo 13).
- Geração de parcelas: ao criar um título com `parcela_total > 1`, o sistema
  cria o pai e as N filhas na mesma transação, com vencimentos mensais a
  partir da data informada — nunca uma parcela sem as demais.

### Fluxo de Usuário

1. **Financeiro → Contas a Pagar → Novo título.** Fornecedor, categoria,
   classificação (despesa/investimento), valor, vencimento, centro(s) de
   custo, anexos.
2. Ao salvar, a tela mostra os níveis de aprovação calculados **antes** de
   confirmar — o operador vê o que vai acontecer, não é surpreendido depois.
3. Fila de aprovação: cada aprovador vê só os títulos no próprio nível.
4. Pagamento: baixa com conta de origem, forma, data — gera a movimentação
   bancária (Módulo 9) na mesma transação.

### Endpoints de API

```
GET    /api/v1/contas-pagar                      → ?status=&fornecedor_id=&vencimento_de=&vencimento_ate=
POST   /api/v1/contas-pagar                        [Idempotency-Key]
GET    /api/v1/contas-pagar/{id}
PATCH  /api/v1/contas-pagar/{id}                   [If-Match] — só em PENDENTE
POST   /api/v1/contas-pagar/{id}/enviar-aprovacao
POST   /api/v1/contas-pagar/{id}/aprovacoes/{nivel}/decidir  → {decisao, justificativa?}
POST   /api/v1/contas-pagar/{id}/pagamentos         [Idempotency-Key]
POST   /api/v1/contas-pagar/{id}/pagamentos/{pid}/estornar
POST   /api/v1/contas-pagar/{id}/cancelar
GET    /api/v1/delegacoes-aprovacao                → ?ativas=true
POST   /api/v1/delegacoes-aprovacao                 [Idempotency-Key]
```

Permissões: `pagar:ler` · `pagar:criar` · `pagar:aprovar` · `pagar:baixar` —
**as quatro já existem no catálogo.** `pagar:cancelar` e
`alcada:definir` (já existe) para configurar as faixas por perfil.

### Dependências
- **Depende de:** Módulo 8 (centro de custo), Módulo 9 (conta bancária,
  fornecedor já existe desde o Anexo N)
- **Habilita:** Módulo 12 (lançamentos futuros de despesa), Módulo 13 (fluxo
  de caixa), Módulo 14 (controle de despesas)

### Critérios de Aceite
- [x] Título abaixo do menor limite de alçada não gera linha de aprovação
- [x] O nível 2 **não decide** antes de o nível 1 aprovar — 422 do gatilho
- [x] Rejeição sem justificativa é recusada pelo banco
- [x] Criador do título não aparece como aprovador possível de nenhum nível
      dele, nem mesmo por escopo de perfil coincidente
- [x] Delegação fora do período não desvia a aprovação
- [x] Pagamento que excede o saldo em aberto é recusado
- [x] Estorno gera lançamento contrário; o pagamento original nunca é apagado
- [x] Cancelar o título pai propõe cancelamento das filhas pendentes e
      preserva as já pagas

**Um critério deste levantamento estava errado, e a implementação o corrigiu.**
A redação original era "nível 2 fica **invisível** ao respectivo aprovador
enquanto o nível 1 não decidir". Isso é incompatível com a própria RN-F03, que
aceita posto ≥ nível: um aprovador de posto 2 pode decidir o nível 1, e
portanto o título no nível 1 pendente **deve** aparecer na fila dele — do
contrário as férias do gerente travariam o nível 1 com o diretor disponível ao
lado, e o contorno seria emprestar credencial (ver [Anexo S](S-contas-a-pagar.md)
§S.4). A garantia real é a da decisão, não a da visibilidade: decidir o nível 2
antes do nível 1 é recusado. Foi um teste de integração, escrito sobre o
critério original, que expôs a contradição.

### Lacunas e Decisões Pendentes
- **[DECISÃO D-18 — RESOLVIDA]** Faixas de alçada **configuráveis por
  locatário**, via `alcada`, que já é por tenant desde a 0002. Não é escolha
  por flexibilidade: fixá-las seria inventar regra de negócio, e dez mil reais
  é valor de diretoria numa operação e de rotina em outra. A consequência de
  projeto é que o **posto é a posição da faixa, não o valor** — trocar 50 mil
  por 80 mil no cadastro não reescreve a hierarquia de aprovação. Falta a tela
  de configuração de alçada, que hoje não existe (o cadastro é por SQL).
- **[DECISÃO D-19 — RESOLVIDA]** Notificação implementada com **SMTP** como
  adaptador, para que o provedor (SES, Resend, SendGrid, Postmark, Mailgun,
  servidor próprio) seja configuração e não código. O adaptador padrão é
  registro em log, por assimetria de erro: um ambiente que deveria enviar e
  apenas registra é descoberto na primeira conferência; o inverso manda e-mail
  de teste para pessoas reais, e isso não se desfaz. Migração 0018 e
  [Anexo S](S-contas-a-pagar.md) §S.9.
- **[LACUNA]** "Vínculo com contrato de fornecedor" pressupõe contrato de
  fornecedor como entidade — hoje só existe `fornecedor` (cadastro) e
  `contrato` (com cliente, não com fornecedor). Ficou como referência livre
  (`contrato_fornecedor_ref text`) até que exista demanda real de um contrato
  de fornecedor formal com vigência e cláusulas — modelar isso sem um caso de
  uso concreto seria a "lacuna que ninguém testa porque ninguém usa".

---

## MÓDULO 11: Contas a Receber

### Status
- [x] Novo — **✅ implementado** (migração 0020, API de 14 rotas, tela com
      fechamento de competência); ver [Anexo T](T-contas-a-receber.md)

### Descrição

Aqui mora a decisão arquitetural mais importante deste bloco. Buscando no
repositório: **não existe tabela `fatura`.** O que existe é
`consumo_competencia` (Anexo P, migração 0013) — a consolidação de leitura
por período — e uma tela de "Faturamento" inteiramente simulada em memória no
front-end (`apps/web/src/dados`). O motor de preço (Anexo E, `app.resolver_preco`
e `app.resolver_franquia`) calcula o valor; nada grava o título.

O pedido original trata "Contas a Receber" como módulo novo, mas construí-lo
como uma segunda tabela paralela à fatura duplicaria o conceito de "cobrança
ao cliente" em dois lugares que inevitavelmente divergem — exatamente o
defeito que o Anexo P dedicou uma seção inteira a evitar no rateio de
franquia. A recomendação é **uma tabela só**, `titulo_receber`, com um
discriminador de origem: `CONTRATUAL` (gerado a partir de contrato + consumo,
o que hoje seria chamado de "fatura") e `AVULSO` (lançamento manual, o caso
que o pedido original chama de "contas a receber" propriamente dito).

### Modelagem de Dados

```
titulo_receber
  id                uuid PK
  tenant_id         uuid FK → tenant
  cliente_id        uuid FK → cliente
  filial_id         uuid FK → filial NULL
  contrato_id       uuid FK → contrato NULL      -- presente quando origem = CONTRATUAL
  competencia       text NULL                    -- 'AAAA-MM', presente quando CONTRATUAL
  origem            text NOT NULL CHECK (origem IN ('CONTRATUAL','AVULSO'))
  descricao         text NOT NULL
  valor_original    numeric(15,4) NOT NULL CHECK (valor_original > 0)
  desconto          numeric(15,4) NOT NULL DEFAULT 0 CHECK (desconto >= 0)
  valor_liquido     numeric(15,4) GENERATED ALWAYS AS (valor_original - desconto) STORED
  data_emissao      date NOT NULL
  data_vencimento   date NOT NULL
  status            text NOT NULL DEFAULT 'PENDENTE_APROVACAO' CHECK (status IN (
                      'PENDENTE_APROVACAO','PENDENTE','APROVADO',
                      'RECEBIDO_PARCIAL','RECEBIDO','CANCELADO','EM_DISPUTA','BAIXADO'
                    ))
  titulo_pai_id     uuid FK → titulo_receber NULL
  parcela_numero    integer
  parcela_total     integer
  recorrencia_id    uuid FK → recorrencia_receber NULL  -- Módulo 12
  version           integer NOT NULL DEFAULT 1
  created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, delete_reason

  CHECK ((origem = 'CONTRATUAL') = (contrato_id IS NOT NULL AND competencia IS NOT NULL))

titulo_receber_rateio      -- mesma forma de titulo_pagar_rateio (Módulo 10)
titulo_receber_aprovacao   -- mesma forma; alcada.tipo = 'DESCONTO' já cobre o caso de desconto,
                            -- falta 'EMISSAO_TITULO_RECEBER' para o título em si (D-20)
titulo_receber_recebimento
  id               uuid PK
  tenant_id        uuid FK → tenant
  titulo_id        uuid FK → titulo_receber
  valor_recebido   numeric(15,4) NOT NULL CHECK (valor_recebido > 0)
  data_recebimento date NOT NULL
  conta_id         uuid FK → conta_bancaria
  forma            text NOT NULL CHECK (forma IN ('TRANSFERENCIA','BOLETO','PIX','CHEQUE'))
  movimentacao_id  uuid FK → movimentacao_bancaria
  created_at, created_by
```

`consumo_competencia` (0013) não muda: continua sendo a fonte do valor
CONTRATUAL. O que muda é que, ao fechar a competência, em vez de o front-end
simular uma fatura, o banco passa a **gerar a linha em `titulo_receber`** com
`origem = 'CONTRATUAL'`.

> **Correção deste levantamento.** A frase acima dizia
> "(`app.fechar_competencia`, já existente)". **A função não existia.** O que a
> migração 0013 tinha era a coluna `consumo_competencia.fechado_em`, o
> `fechado_por` e o gatilho `app.bloquear_competencia_fechada`, que impede
> alterar linha fechada — a trava, sem a chave: nenhum caminho do sistema chegava
> a preencher a coluna. A função foi construída na 0020, junto da geração dos
> títulos, conforme D-22 já recomendava. Ver [Anexo T](T-contas-a-receber.md)
> §T.3.

### Regras de Negócio

1. **RN-F10 — Título contratual nasce `PENDENTE_APROVACAO`.** Ninguém emite
   cobrança direto do cálculo automático sem um humano validar — é o
   equivalente ao que o pedido original chamou de "aprovação de títulos
   gerados por contrato antes de efetivar".
2. **RN-F11 — Vigência é checada na geração, não depois.** Se o contrato foi
   suspenso ou encerrado entre o fechamento da competência e a geração do
   título, o título nasce com uma exceção sinalizada (`EM_DISPUTA`), nunca
   silenciosamente com o valor do contrato morto.
3. **RN-F12 — Desconto acima da alçada do perfil exige aprovação adicional**,
   mesmo em título já aprovado por outro motivo — reaproveita
   `alcada.tipo = 'DESCONTO'`, que já existe.
4. **RN-F13 — Baixa parcial recalcula saldo**, espelhando RN-F06 do contas a
   pagar.
5. **RN-F14 — `BAIXADO` é diferente de `RECEBIDO`.** Recebido é dinheiro que
   entrou; baixado é título encerrado sem entrada de caixa (perda reconhecida,
   renegociação que zerou o saldo por outro instrumento) — confundir os dois
   inflaria a receita realizada.

### Fluxos de Aprovação

Mesma forma do Módulo 10 (níveis sequenciais, rejeição com justificativa,
segregação de funções — quem gera a pré-cobrança pode aprovar, quem cancela
título de valor relevante precisa de alçada distinta, exatamente como o
Anexo C.6 já documentava para fatura).

### Automações

- **Fechamento de competência → título contratual.** Consumidor de
  `consumo_competencia` fechada: para cada contrato com competência fechada e
  sem título já gerado, cria `titulo_receber` com `origem='CONTRATUAL'`.
  Idempotente por natureza (chave única `contrato_id + competencia`) — fechar
  a mesma competência duas vezes não duplica título.

### Fluxo de Usuário

1. Ao fechar a competência (tela já existente do Módulo 6/Anexo P), a lista
   de títulos gerados aparece para aprovação, não para emissão direta.
2. **Financeiro → Contas a Receber → Novo título avulso**, para o caso
   `AVULSO` — mesma tela, campos comuns, sem contrato/competência.
3. Baixa: recebimento com conta de destino, forma, data.

### Endpoints de API

```
GET    /api/v1/contas-receber                      → ?status=&cliente_id=&origem=&vencimento_de=&vencimento_ate=
POST   /api/v1/contas-receber                       [Idempotency-Key]  -- origem AVULSO
GET    /api/v1/contas-receber/{id}
POST   /api/v1/contas-receber/{id}/aprovacoes/{nivel}/decidir
POST   /api/v1/contas-receber/{id}/recebimentos     [Idempotency-Key]
POST   /api/v1/contas-receber/{id}/baixar-sem-recebimento  → BAIXADO, com motivo
POST   /api/v1/contas-receber/{id}/cancelar
```

Permissões: `receber:ler` · `receber:baixar` · `receber:negociar` — **já
existem.** `receber:criar` e `receber:aprovar` são **novas**, no mesmo padrão
de `pagar:*`.

### Dependências
- **Depende de:** Módulo 6/Anexo P (`consumo_competencia`, `app.resolver_preco`),
  Módulo 8, Módulo 9
- **Habilita:** Módulo 12, Módulo 13, Módulo 14 (receita, para comparar com
  despesa), Módulo 5 — Portal do Cliente (que hoje lê `fatura:ler` sobre uma
  tabela inexistente; passa a ler `titulo_receber` filtrado por
  `origem='CONTRATUAL'`)

### Critérios de Aceite
- [ ] Fechar a mesma competência duas vezes não duplica título
- [ ] Título de contrato suspenso entre fechamento e geração nasce em disputa,
      nunca com o valor de um contrato morto
- [ ] Desconto acima da alçada do perfil é barrado mesmo com o título já
      aprovado por outro motivo
- [ ] `BAIXADO` e `RECEBIDO` nunca são contados juntos como receita realizada
      num mesmo indicador

### Lacunas e Decisões Pendentes
- **[DECISÃO D-20 · a mais importante deste módulo]** Confirmar a unificação
  proposta (`titulo_receber` único, com discriminador `origem`) em vez de duas
  tabelas paralelas (`fatura` de um lado, `contas_a_receber` de outro). A
  alternativa mais barata — manter fatura simulada no front e criar
  `contas_a_receber` só para o caso avulso — deixa duas fontes de verdade
  sobre "quanto o cliente deve", que é precisamente o defeito que o Anexo P
  evitou ao tratar franquia como tabela única com histórico, e não como
  "tabela nova + o que já existia continua igual".
- **[DECISÃO D-21]** O índice de reajuste (IPCA/IGPM) é **consultado
  automaticamente** de fonte externa (IBGE tem API pública para IPCA; IGPM é
  da FGV, sem API pública gratuita) ou **cadastro manual mensal**? A tabela
  `contrato.indice_reajuste` e `periodicidade_reajuste_meses` já existem
  desde a 0005 sem motor nenhum atrás — este é o mesmo débito técnico já
  listado antes deste levantamento, e continua sem dono. Recomendação:
  **cadastro manual do índice do mês** no lançamento — consultar API externa
  é uma dependência de rede num motor que hoje roda inteiramente dentro do
  banco, e o índice publicado tem defasagem de divulgação que precisaria de
  tratamento de qualquer forma.
- **[DECISÃO D-22 — RESOLVIDA]** A geração ocorre **ao fechar a competência**,
  na mesma chamada que sela o consumo. Criar um segundo agendador duplicaria o
  conceito de "quando processar o mês" que o fechamento já resolve. E a ordem
  dentro da função importa: sela **por último**, para que um erro na geração
  deixe o mês aberto em vez de trancado e sem título. `app.fechar_competencia`
  foi construída na migração 0020 — ela não existia, ao contrário do que a
  descrição deste módulo afirmava.

---

## MÓDULO 12: Lançamentos Futuros

### Status
- [x] Novo — **✅ implementado** (migração 0021, API de 13 rotas, worker de
  conversão, tela com fila de exceção e prévia); ver
  [Anexo U](U-lancamentos-e-fluxo-de-caixa.md)

**Três desvios do que esta seção especifica, e o motivo de cada um:**

1. **`recorrencia` é uma tabela, não duas.** Onde esta seção pede
   `recorrencia_pagar` e `recorrencia_receber`, a 0021 tem uma `recorrencia` com
   discriminador `lado`. É o raciocínio de D-20 aplicado um nível acima: duas
   tabelas paralelas para o mesmo conceito dão duas respostas para "o que está
   programado". A diferença entre elas — fornecedor contra cliente — se resolve
   com colunas nuláveis amarradas ao discriminador, que é o que
   `lancamento_futuro` já faz nesta mesma seção.
2. **`titulo_gerado_id` virou duas FK reais** (`titulo_pagar_id` e
   `titulo_receber_id`) com CHECK de "exatamente uma quando convertido, nenhuma
   antes". Ver a correção abaixo.
3. **A projeção do Módulo 12 e a do 13 são a mesma função.** As duas rotas
   existem — as permissões diferem —, mas a conta acontece uma vez. Esta seção
   admitia "calculado aqui e lá".

> **Correção de fato.** O texto abaixo justifica `titulo_gerado_id` sem FK
> dizendo que "outras bases poliformas do sistema já usam" integridade por
> gatilho. **O precedente não existe.** A única referência polimórfica do esquema
> é `audit_log` (migração 0003), e ela não tem FK **nem gatilho** — por uma razão
> oposta: é log, e precisa sobreviver à exclusão da linha referenciada. Nenhuma
> outra tabela faz o que o texto descreve. Decidido com o operador: duas FK
> reais, porque um gatilho confere no momento da escrita e não impede o
> apagamento depois — e "exatamente uma preenchida" passa a ser restrição
> declarada em vez de convenção.

### Descrição

Camada de intenção: despesa/receita programada que ainda não é título. Existe
separada de `titulo_pagar`/`titulo_receber` porque um compromisso futuro pode
ser editado ou cancelado livremente até a conversão — um título já criado
carrega workflow de aprovação e rateio, que não deveriam ser reabertos por
uma edição de planejamento.

### Modelagem de Dados

```
lancamento_futuro
  id                 uuid PK
  tenant_id          uuid FK → tenant
  tipo               text NOT NULL CHECK (tipo IN (
                       'DESPESA_RECORRENTE','RECEITA_RECORRENTE',
                       'DESPESA_PARCELADA','RECEITA_PARCELADA','PROVISAO'
                     ))
  descricao          text NOT NULL
  valor_previsto     numeric(15,4) NOT NULL CHECK (valor_previsto > 0)
  data_prevista      date NOT NULL
  centro_custo_id    uuid FK → centro_custo NULL
  contrato_id        uuid FK → contrato NULL       -- quando vinculado a contrato (RN abaixo)
  fornecedor_id      uuid FK → fornecedor NULL
  cliente_id         uuid FK → cliente NULL
  status             text NOT NULL DEFAULT 'PROGRAMADO' CHECK (status IN (
                       'PROGRAMADO','CONVERTIDO','CANCELADO'
                     ))
  titulo_gerado_id   uuid                            -- aponta pra titulo_pagar OU titulo_receber; ver nota
  titulo_gerado_tipo text CHECK (titulo_gerado_tipo IN ('PAGAR','RECEBER'))
  convertido_em      timestamptz
  created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, delete_reason

recorrencia_pagar / recorrencia_receber
  id              uuid PK
  tenant_id       uuid FK → tenant
  periodicidade   text NOT NULL CHECK (periodicidade IN ('MENSAL','TRIMESTRAL','SEMESTRAL','ANUAL'))
  dia_vencimento  integer NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 28)  -- 28 evita mês sem o dia
  valor_base      numeric(15,4) NOT NULL
  proxima_geracao date NOT NULL
  ativo           boolean NOT NULL DEFAULT true
  -- referenciada por titulo_pagar.recorrencia_id / titulo_receber.recorrencia_id
```

`titulo_gerado_id` **sem FK declarada** é deliberado, não descuido: aponta
para uma de duas tabelas conforme `titulo_gerado_tipo`, e Postgres não tem FK
polimórfica. A integridade é garantida por gatilho (checa a existência na
tabela indicada por `titulo_gerado_tipo`), o mesmo mecanismo que outras bases
poliformas do sistema já usam quando duas entidades se alternam.

### Regras de Negócio

1. **RN-F15 — Conversão só ocorre uma vez.** `status='PROGRAMADO' AND
   data_prevista <= hoje` é a condição de elegibilidade; a conversão muda
   para `CONVERTIDO` na mesma transação que cria o título — nunca duas
   transações separadas, que abririam janela para duplicar em execução
   concorrente do agendador.
2. **RN-F16 — Vinculado a contrato, valida vigência antes de converter.**
   Se `contrato_id` aponta para contrato não mais `ATIVO`, a conversão não
   ocorre; o lançamento futuro fica `PROGRAMADO` e aparece numa fila de
   exceção — não gera título de contrato morto (mesma lógica de RN-F11).
3. **RN-F17 — Editar ou cancelar só é possível em `PROGRAMADO`.** Uma vez
   convertido, a edição é do título gerado, não do lançamento futuro — que
   vira só um registro histórico de "isso foi previsto e virou aquilo".
4. **RN-F18 — Recorrência gera o próximo lançamento futuro ao converter o
   atual**, avançando `proxima_geracao` pela periodicidade — nunca todos de
   uma vez (evita gerar anos de lançamentos futuros no primeiro clique).

### Automações

- **Job diário de conversão** (usa `job_execucao`, que já existe desde 0007):
  varre `lancamento_futuro` elegível, converte em título (Módulo 10 ou 11
  conforme o tipo), avança a recorrência quando houver.
- **Job de geração de recorrência**: para cada `recorrencia_*` ativa com
  `proxima_geracao <= hoje + N dias` (N configurável — antecedência para
  aparecer no planejamento antes de vencer), cria o próximo
  `lancamento_futuro`.

### Fluxo de Usuário

1. **Financeiro → Lançamentos Futuros → Dashboard.** Fluxo de caixa projetado
   em 30/60/90/180 dias (consumido pelo Módulo 13, calculado aqui e lá).
2. Criar/editar/cancelar lançamento futuro, enquanto `PROGRAMADO`.
3. Fila de exceção: lançamentos que não converteram por contrato inválido.

### Endpoints de API

```
GET    /api/v1/lancamentos-futuros           → ?tipo=&status=&de=&ate=
POST   /api/v1/lancamentos-futuros            [Idempotency-Key]
PATCH  /api/v1/lancamentos-futuros/{id}       [If-Match] — só em PROGRAMADO
POST   /api/v1/lancamentos-futuros/{id}/cancelar
GET    /api/v1/lancamentos-futuros/projecao   → ?dias=30|60|90|180
```

Permissões: reaproveita `pagar:criar`/`receber:criar` para o lançamento que
vai gerar cada tipo; `financeiro:lancamento_manual` (já existe) para o
avulso/provisão.

### Dependências
- **Depende de:** Módulo 10 e 11 (é o que ele converte para)
- **Habilita:** Módulo 13 (fluxo de caixa projetado)

### Critérios de Aceite
- [x] Dois disparos concorrentes do job de conversão não duplicam o título
      do mesmo lançamento — `for update` dentro de
      `app.converter_lancamento_futuro`, e a guarda de estado que fecha a porta
      **sequencial** (um convertido devolvido a `PROGRAMADO` convertia de novo;
      ver Anexo U §U.5)
- [x] Lançamento vinculado a contrato suspenso não converte; aparece na fila
      de exceção — com o motivo escrito, e a fila é filtro derivado, não status
- [x] Lançamento convertido não aceita mais edição
- [x] Recorrência gera exatamente o próximo lançamento, nunca o lote inteiro —
      garantido pelo índice único `(recorrencia_id, data_prevista)`

### Lacunas e Decisões Pendentes
- **[DECISÃO D-23 — ✅ resolvida como sim]** A conversão notifica quem pode
  decidir o **nível pendente** do título gerado, na rota do lado certo (o
  parâmetro `rota` que o Módulo 11 acrescentou ao `NotificacaoService`). Não
  notificar geração automática de título é o tipo de silêncio que só aparece no
  fechamento do mês.

  Duas ausências deliberadas: título que nasce já aprovado **não** gera aviso
  (não há decisão pendente, e avisar do que não precisa de ação treina a pessoa a
  ignorar a caixa); e quem converteu **não** é excluído da lista, porque no worker
  quem "gerou" foi o relógio, e no caminho manual é o gatilho de segregação que
  barra a mesma pessoa aprovando o que criou.

- **Pendências que ficam** (ver Anexo U §U.13): job sem agendador externo
  (`setInterval` do processo, como o de notificação); `dia_vencimento` limitado a
  28, porque o que fazer com 29/30/31 em fevereiro é regra que ninguém
  especificou e **não foi inventada**; provisão sem contrapartida contábil; e a
  recorrência não reajusta por índice, herdando a pendência de D-21.

---

## MÓDULO 13: Fluxo de Caixa

### Status
- [x] Novo — **✅ implementado** (migração 0021, API de 4 rotas, tela com gráfico
  de projeção próprio); ver [Anexo U](U-lancamentos-e-fluxo-de-caixa.md)

**Um desvio:** `nome` do cenário é livre, e o alerta usa o cenário marcado como
`padrao` — não um casado pelo nome "Realista". O esquema não tem o conceito de
"realista"; adivinhar que o operador vai usar essa palavra seria inventar regra de
negócio, e o tipo que quebra em silêncio quando ele escolhe outro nome. Um índice
único parcial garante um só padrão por locatário: dois fariam o painel abrir
diferente para duas pessoas no mesmo dia, pela ordem da consulta.

### Descrição

Camada de leitura, não de escrita — nenhuma tabela própria além de parâmetros
de cenário. Consolida saldo real (Módulo 9) com o previsto (Módulos 10, 11,
12) numa projeção.

### Modelagem de Dados

```
parametro_cenario_caixa
  id                    uuid PK
  tenant_id             uuid FK → tenant
  nome                  text NOT NULL      -- 'Realista', 'Otimista', 'Pessimista'
  percentual_inadimplencia numeric(5,2) NOT NULL DEFAULT 0  -- aplicado sobre titulo_receber previsto
  padrao                boolean NOT NULL DEFAULT false
  UNIQUE (tenant_id, nome)
```

Não há tabela de "posição diária de caixa": ela é **computada**, por função
(`app.fluxo_caixa_projetado(tenant_id, conta_id?, filial_id?, centro_custo_id?,
de, ate, cenario_id)`), somando saldo atual (Módulo 9) com títulos a
pagar/receber em aberto no período, aplicando o percentual de inadimplência do
cenário sobre a parcela de recebíveis. Gravar uma posição diária seria dado
derivado armazenado — o defeito que `custo_aquisicao` (coluna gerada, Anexo N)
existe para evitar em outro lugar do sistema.

### Regras de Negócio

1. **RN-F19 — Projeção nunca inclui título já `CANCELADO` ou `BAIXADO`.**
2. **RN-F20 — Cenário "pessimista" aplica inadimplência só sobre recebíveis**,
   nunca sobre pagáveis — a operação não fica mais otimista sobre a própria
   dívida por causa de um cenário de estresse.
3. **RN-F21 — Alerta de saldo negativo projetado** dispara quando, em algum
   dia da janela, `saldo_acumulado < 0` no cenário realista — não espera o
   pessimista, que é para planejamento, não para alarme do dia a dia.
4. **RN-F22 — Concentração de pagamentos** é sinalizada quando um único dia
   concentra mais que um percentual configurável (padrão sugerido: 40%) do
   total de saídas previstas na janela — útil para renegociar vencimento antes
   que o dia chegue.

### Fluxo de Usuário

1. **Financeiro → Fluxo de Caixa.** Seletor de conta/filial/centro de
   custo/cenário, janela de 30/60/90/180 dias.
2. Gráfico de linha (saldo projetado), barras (entradas × saídas por
   dia/semana/mês), área (acumulado) — reaproveitando os componentes de
   gráfico já existentes em `componentes/ui/graficos.tsx`.
3. Lista de alertas: saldo negativo, concentração, inadimplência acima da
   média histórica do tenant.

### Endpoints de API

```
GET /api/v1/fluxo-caixa/projecao   → ?conta_id=&filial_id=&centro_custo_id=&de=&ate=&cenario=
GET /api/v1/fluxo-caixa/alertas    → ?de=&ate=
GET /api/v1/cenarios-caixa
POST /api/v1/cenarios-caixa         [Idempotency-Key]
```

Permissão: `financeiro:painel_executivo` (já existe) para a visão consolidada;
`pagar:ler` + `receber:ler` (já existem) bastam para a projeção básica.

### Dependências
- **Depende de:** Módulos 9, 10, 11, 12 — é o topo da pirâmide, não a base
- **Habilita:** nada abaixo; alimenta o painel executivo

### Critérios de Aceite
- [ ] Título cancelado ou baixado nunca aparece na soma projetada
- [ ] Cenário pessimista não altera o valor de nenhum título a pagar
- [ ] Alerta de saldo negativo dispara no cenário realista, sem precisar do
      pessimista
- [ ] Projeção de 90 dias muda de forma coerente ao registrar um pagamento
      antecipado (o dia do pagamento sai da soma futura)

### Lacunas e Decisões Pendentes
- **[DECISÃO D-24]** Integração com ERP ou API bancária externa para o saldo
  real, ou o fluxo de caixa é alimentado **só pelos títulos internos**
  (recomendação, dado que Módulo 9 já é a fonte de saldo real via
  movimentação bancária — abrir integração com banco por Open Finance é
  módulo à parte, com custo de credenciamento e homologação que este
  levantamento não tem base para dimensionar).

---

## MÓDULO 14: Controle de Despesas — Orçamento e Indicadores

### Status
- [ ] Novo

### Descrição

Camada analítica sobre o Módulo 10 (contas a pagar): não introduz uma segunda
forma de lançar despesa, lê o que já foi lançado e compara contra um
orçamento. "Módulo alimentado automaticamente pelo financeiro" é a descrição
correta do pedido original — a única tabela nova de fato é o orçamento em si;
categorização e indicadores são leitura sobre `titulo_pagar`.

### Modelagem de Dados

```
categoria_despesa
  id              uuid PK
  tenant_id       uuid FK → tenant
  nome            text NOT NULL              -- "Licenças de Software", "Telefonia", …
  categoria_pai_id uuid FK → categoria_despesa NULL   -- subcategoria, 2 níveis
  classificacao_sugerida text CHECK (classificacao_sugerida IN ('DESPESA_FIXA','DESPESA_VARIAVEL','INVESTIMENTO'))
  ativo           boolean NOT NULL DEFAULT true
  UNIQUE (tenant_id, nome) WHERE deleted_at IS NULL
  -- referenciada por titulo_pagar.categoria_id (Módulo 10)

orcamento
  id              uuid PK
  tenant_id       uuid FK → tenant
  ano             integer NOT NULL
  mes             integer            -- NULL = orçamento anual, sem quebra mensal
  categoria_id    uuid FK → categoria_despesa NULL   -- NULL = orçamento geral do centro
  centro_custo_id uuid FK → centro_custo NULL
  filial_id       uuid FK → filial NULL
  valor_orcado    numeric(15,4) NOT NULL CHECK (valor_orcado >= 0)
  created_at, created_by, updated_at, updated_by
  UNIQUE (tenant_id, ano, mes, categoria_id, centro_custo_id, filial_id)
  -- a UNIQUE trata NULL como valor distinto por linha (comportamento padrão do
  -- Postgres em índice único) — duas linhas "geral" (categoria_id NULL) do
  -- mesmo centro no mesmo mês colidiriam, que é o comportamento certo

replanejamento_orcamento
  id                uuid PK
  tenant_id         uuid FK → tenant
  orcamento_origem_id uuid FK → orcamento
  orcamento_destino_id uuid FK → orcamento
  valor_transferido numeric(15,4) NOT NULL CHECK (valor_transferido > 0)
  motivo            text NOT NULL
  aprovado_por      uuid FK → usuario
  created_at        timestamptz NOT NULL DEFAULT now()
```

**Execução orçamentária não é armazenada** — é `Σ(titulo_pagar.valor_ajustado)
WHERE categoria_id = X AND status NOT IN ('CANCELADO') AND data_emissao BETWEEN
início E fim do período`, comparado a `orcamento.valor_orcado`. Guardar
"quanto já foi gasto" como coluna própria divergiria do que os títulos
realmente somam assim que um for cancelado ou tiver o valor ajustado — o
mesmo argumento do saldo de conta bancária (Módulo 9) e do custo de aquisição
(Anexo N): número que pode ser derivado não deveria ter caminho de escrita
próprio.

### Regras de Negócio

1. **RN-F23 — Replanejamento move valor entre linhas de orçamento, nunca cria
   nem destrói.** `orcamento_destino.valor_orcado += valor_transferido` e
   `orcamento_origem.valor_orcado -= valor_transferido` na mesma transação;
   `valor_transferido` não pode exceder o saldo ainda não comprometido da
   origem (ver D-25 sobre o que conta como "comprometido").
2. **RN-F24 — Alertas por limiar de execução: 75/90/100%.** Calculados na
   consulta, não armazenados — um título cancelado depois de disparar o
   alerta de 90% precisa fazer o alerta desaparecer, não persistir um estado
   que o dado atual já não sustenta.
3. **RN-F25 — Projeção de fechamento** = `gasto_ate_hoje / dias_decorridos_no_periodo
   * dias_totais_do_periodo` — método linear simples, declarado como tal (não
   é previsão estatística, é ritmo atual extrapolado).

### Indicadores (todos calculados, nenhum armazenado)

```
despesa_total_mensal        = Σ titulo_pagar do mês, todas classificações
despesa_media_filial        = despesa_total_mensal / N filiais com título no mês
execucao_orcamentaria(%)    = despesa_total_mensal_categoria / orcamento.valor_orcado
variacao_mes_anterior(%)    = (mês_atual − mês_anterior) / mês_anterior
variacao_vs_orcamento(%)    = (realizado − orçado) / orçado
indice_recorrente_vs_pontual = Σ(titulo com recorrencia_id) / Σ(total)
proporcao_investimento      = Σ(classificacao='INVESTIMENTO') / Σ(total)
```

O indicador do pedido original "custo de TI por paciente" **não se aplica**
a este domínio — não há conceito de paciente numa locadora de equipamentos de
TI. O análogo real, que o pedido claramente pretendia por analogia, é
**custo de TI por cliente ativo** ou **por equipamento em campo**:
`despesa_total_categoria_TI / count(cliente com contrato ATIVO)` ou
`/ count(equipamento LOCADO)`. Sinalizado como decisão, não assumido — ver
D-26.

### Análises e Relatórios

Evolução mensal por categoria (linha), distribuição por categoria (pizza),
comparativo mês a mês/ano a ano (barras), top 5 fornecedores por volume,
despesa por filial, despesa por centro de custo (tabela hierárquica),
execução orçamentária por categoria (medidor), investimento × despesa
operacional (proporção) — todos consultas sobre `titulo_pagar` +
`categoria_despesa` + `orcamento`, sem tabela nova além das já listadas.
Exportação PDF/Excel no padrão que `mapa-lista`/CSV já estabeleceu (Anexo O).

### Fluxo de Usuário

1. **Despesas → Orçamento.** Grade ano/mês × categoria × centro de custo,
   preenchimento em lote, cópia do orçamento do ano anterior como ponto de
   partida (nunca herança automática silenciosa — sempre uma ação explícita
   "copiar do ano anterior").
2. **Despesas → Painel.** KPIs, gráficos, tabela de execução com semáforo
   (verde/amarelo/vermelho/crítico nos limiares de 75/90/100%).
3. Replanejamento: seleciona origem e destino, valor, motivo — sujeito a
   aprovação se acima da alçada do perfil.

### Endpoints de API

```
GET    /api/v1/categorias-despesa
POST   /api/v1/categorias-despesa                  [Idempotency-Key]
GET    /api/v1/orcamentos                           → ?ano=&mes=&categoria_id=&centro_custo_id=
POST   /api/v1/orcamentos                            [Idempotency-Key]
PATCH  /api/v1/orcamentos/{id}                       [If-Match]
POST   /api/v1/orcamentos/replanejamentos            [Idempotency-Key]
GET    /api/v1/despesas/indicadores                  → ?periodo=&filial_id=&centro_custo_id=
GET    /api/v1/despesas/relatorios/{tipo}            → ?formato=pdf|xlsx
```

Permissões: `financeiro:centro_custo_gerenciar` (já existe, reaproveitado
para orçamento por proximidade de domínio) — **nova decisão**: criar
`despesa:orcamento_gerenciar` e `despesa:ler` dedicadas, para não sobrecarregar
uma permissão de centro de custo com uma responsabilidade orçamentária
distinta. `financeiro:exportar` (já existe) para os relatórios.

### Dependências
- **Depende de:** Módulo 8 (centro de custo), Módulo 10 (fonte de todo dado)
- **Habilita:** nada abaixo — é o topo analítico, junto do Módulo 13

### Critérios de Aceite
- [ ] Cancelar um título reflete no percentual de execução na consulta
      seguinte, sem job de recálculo
- [ ] Replanejamento não permite transferir mais do que o saldo não
      comprometido da origem
- [ ] Indicador "custo de TI por cliente" bate com a contagem de contratos
      ativos no mesmo período consultado
- [ ] Relatório exportado em PDF e em Excel contêm os mesmos números da tela

### Lacunas e Decisões Pendentes
- **[DECISÃO D-25]** O que conta como "comprometido" ao limitar o
  replanejamento — só o já gasto (`titulo_pagar` `PAGO`/`PAGO_PARCIAL`) ou
  também o **aprovado e ainda não pago**? Recomendação: os dois — um
  orçamento que ignora compromisso já aprovado e não pago permitiria
  replanejar verba que já tem destino certo, e o replanejamento pareceria
  válido até o vencimento do título original chegar.
- **[DECISÃO D-26]** Confirmar o indicador análogo a "custo por paciente":
  por cliente ativo, por equipamento locado, ou os dois lado a lado? Sem essa
  confirmação o indicador fica documentado como fórmula, sem entrar no painel
  padrão.

---

## CRONOGRAMA SUGERIDO DE IMPLEMENTAÇÃO

> Atualizado. Os módulos 1, 2, 3, 6 e 7 estão implementados (Anexos N, P, P, P
> e O, respectivamente) — mantidos na tabela para não quebrar a numeração de
> que os módulos 8–14 dependem, marcados como concluídos. O módulo 4 tem o
> modelo pronto (0011) e ainda não tem tela nem API. Os módulos 8–14 são desta
> rodada, na ordem de prioridade que o pedido original definiu: usuários e
> permissões primeiro, revisão de código em seguida, estrutura financeira de
> base (centro de custo, conta bancária) antes de contas a pagar, contas a
> pagar antes de contas a receber, e a camada analítica por último.

| Ordem | Módulo | Depende de | Prioridade | Complexidade | Situação |
| :---: | --- | --- | :---: | :---: | --- |
| 1 | Nota Fiscal de Compra | — | Alta | Média-Alta | ✅ Feito (Anexo N) |
| 2 | Tabela de Franquias | — | Alta | Média | ✅ Feito (Anexo P) |
| 3 | Preço de Locação | Módulo 2 | Alta | Média | ✅ Feito (Anexo P) |
| 4 | Usuários e Permissões | — | **Crítica** | Alta | ✅ Feito (Anexo Q) |
| **4.5** | **Revisão de código — permissões** | Módulo 4 | **Crítica** | Média | ✅ Feito — verificador de CI, hoje 55/55 rotas (Anexo Q §Q.8) |
| 6 | Consumo de Impressões | Módulo 2 | Alta | Baixa-Média | ✅ Feito (Anexo P) |
| 7 | Mapa Geográfico | Módulo 6 | Média | Média | ✅ Feito (Anexo O) |
| 5 | Portal do Cliente | Módulos 2, 3, 4, 6 | Alta | Média | 🔲 Pendente — depende só do 4 agora |
| **8** | **Centros de Custo** | — | Alta | Baixa | ✅ Feito (Anexo R) |
| **9** | **Contas Bancárias** | — | Alta | Média | ✅ Feito (Anexo R) — falta a importação de extrato |
| **10** | **Contas a Pagar** | Módulos 8, 9 | Alta | **Alta** | ✅ Feito (Anexo S) — nove invariantes, alçada configurável, delegação |
| **11** | **Contas a Receber** | Módulos 6, 8, 9 | Alta | **Alta** | ✅ Feito (Anexo T) — D-20 fechada, fechamento de competência construído |
| **12** | **Lançamentos Futuros** | Módulos 10, 11 | Alta | Média-Alta | ✅ Feito (Anexo U) — quatro invariantes, worker de conversão, D-23 fechada |
| **13** | **Fluxo de Caixa** | Módulos 9, 10, 11, 12 | Alta | Média | ✅ Feito (Anexo U) — uma projeção só, nenhuma posição diária gravada |
| **12** | **Lançamentos Futuros** | Módulos 10, 11 | Média | Média | 🔲 Novo |
| **13** | **Fluxo de Caixa** | Módulos 9, 10, 11, 12 | Média | Baixa | 🔲 Novo — só leitura, nenhuma tabela de posição |
| **14** | **Controle de Despesas** | Módulos 8, 10 | Média | Média | 🔲 Novo — orçamento + indicadores, tudo calculado |

Ordem recomendada para esta rodada: **4 → 4.5 → 8 ∥ 9 → 10 → 11 → 12 → 13 →
14**, com o Módulo 5 (Portal) podendo entrar em paralelo assim que o 4
terminar, já que suas outras dependências (2, 3, 6) estão prontas.

Executado até aqui: **4, 4.5, 8, 9, 10 e 11**. O próximo é o 12 (lançamentos
futuros), que converte recorrência em título — e é ele que cria
`recorrencia_receber`, a tabela que `titulo_receber.recorrencia_id` já referencia
sem chave estrangeira.

---

## INTEGRAÇÃO ENTRE MÓDULOS

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│ 1. NOTA FISCAL DE COMPRA │        │ 4. USUÁRIOS E PERMISSÕES       │
└────────────┬─────────────┘        │    escopo CLIENTE na RLS       │
             │ cria, valor rateado  │    (modelo pronto, tela não)   │
             ▼                      └────────────────┬────────────────┘
┌──────────────────────────────┐                     │ recorta TUDO,
│  equipamento (já existe)     │                     │ inclusive o bloco
│  patrimônio·série·status·geo │                     │ financeiro abaixo
└───┬───────────┬──────────┬───┘                     ▼
    │aloca      │mede      │posiciona    ┌─────────────────────────────┐
    ▼           ▼          ▼             │ 5. PORTAL DO CLIENTE        │
┌─────────┐ ┌──────────┐ ┌────────┐      └─────────────────────────────┘
│contrato │ │6. CONSUMO│ │7. MAPA │
└──┬───┬──┘ │consolid. │ └────────┘
   │   │    └────┬─────┘
   │   │  franquia│excedente
   │   └──────────┤
   ▼              ▼
┌────────┐  ┌──────────────────────────┐
│2.FRANQ.│─►│ 11. CONTAS A RECEBER     │◄── títulos avulsos (sem contrato)
└────────┘  │  origem CONTRATUAL ou    │
┌────────┐  │  AVULSO — unifica fatura │
│3.PREÇO │─►│  (nenhuma tabela `fatura`│
└────────┘  │  paralela — D-20)        │
            └────────────┬─────────────┘
                          │ baixa
                          ▼
            ┌──────────────────────────┐        ┌───────────────────┐
            │  9. CONTAS BANCÁRIAS     │◄───────┤ 10. CONTAS A PAGAR │
            │  saldo = Σ movimentação  │  baixa  │  alçada (0002!)    │
            └────────────┬─────────────┘         └─────────┬──────────┘
                          │                                 │
                          │        ┌────────────────────────┘
                          ▼        ▼
                 ┌──────────────────────────┐      ┌─────────────────┐
                 │ 13. FLUXO DE CAIXA       │      │ 12. LANÇAMENTOS │
                 │  saldo real + previsto,  │◄─────┤     FUTUROS     │
                 │  só leitura, sem tabela  │      │  converte em 10 │
                 │  própria de posição      │      │  ou 11          │
                 └──────────────────────────┘      └─────────────────┘
                          ▲
                          │ lê titulo_pagar
                 ┌──────────────────────────┐
                 │ 8. CENTRO DE CUSTO       │
                 │  rateio de 10 e 11       │
                 └────────────┬─────────────┘
                              │
                 ┌──────────────────────────┐
                 │ 14. CONTROLE DE DESPESAS │
                 │  orçamento × execução,   │
                 │  tudo calculado sobre 10 │
                 └──────────────────────────┘
```

**Leitura do diagrama**

- O **módulo 4 continua ortogonal**: não acrescenta dado, recorta todo o
  resto — inclusive o bloco financeiro inteiro, que sem ele não tem quem
  aprove nada.
- **11 absorve o que hoje é "faturamento" simulado.** Não há duas fontes de
  verdade sobre quanto o cliente deve: título contratual (nasce do consumo,
  módulo 6) e título avulso são a mesma tabela, discriminados por origem.
- **10 finalmente usa a `alcada`** que existe desde a migração 0002 sem
  consumidor — é o motor de aprovação por faixa de valor, já modelado, só sem
  o que aprovar.
- **9 é o piso factual do 13**: fluxo de caixa não inventa saldo, soma o que
  9 registrou com o que 10/11/12 preveem.
- **8 e 14 são camada, não origem**: centro de custo rateia o que já foi
  lançado; controle de despesas lê o que já foi lançado. Nenhum dos dois é
  onde a despesa nasce.

---

## LACUNAS GLOBAIS E DECISÕES PENDENTES

### Resolvidas desde a versão anterior deste documento

| # | Decisão | Como foi resolvida |
| --- | --- | --- |
| ~~D-01~~ | Isolamento do cliente locatário | Escopo `CLIENTE` na RLS, `SET LOCAL app.cliente_id` — migração 0011 (Anexo M) |
| ~~D-02~~ | Modelo organizacional do cliente | `grupo_economico → cliente → local_operacao` — migração 0011 (Anexo M) |
| ~~D-12~~ | Provedor de mapa | Vetor embutido como piso + tiles opcionais (satélite Esri padrão) — Anexo O |
| ~~D-13~~ | Provedor de geocodificação | Nominatim, ação explícita — Anexo O §O.9.4 |
| ~~D-07~~ | Autenticação | **Revertida**: Argon2id próprio, não Supabase Auth — Anexo Q §Q.2 |
| ~~D-15~~ | Política de senha por tenant ou por perfil | Por locatário, `tenant.politica_senha` — migração 0015 |
| ~~D-20~~ | `titulo_receber` único ou `fatura` separada | Tabela única, origem CONTRATUAL/AVULSO |
| ~~D-21~~ | Índice de reajuste: API externa ou manual | Cadastro manual mensal |
| ~~D-16~~ | Rateio entre centros de custo | Percentual; soma obrigatória de 100% |
| ~~D-18~~ | Faixas de alçada configuráveis ou fixas | Configuráveis por locatário — `alcada` já é por tenant |
| ~~D-19~~ | Provedor de envio de e-mail | SMTP como adaptador; o provedor é configuração, não código — migração 0018 |
| ~~D-22~~ | Geração de título contratual | No fechamento da competência, na mesma chamada que sela o consumo — migração 0020 (Anexo T) |
| ~~D-23~~ | Conversão de lançamento futuro notifica? | **Sim** — quem pode decidir o nível pendente do título gerado, na rota do lado certo. Título que nasce aprovado não gera aviso (Anexo U §U.7) |

### Bloqueantes — precisam de resposta antes do desenvolvimento desta rodada

Nenhuma em aberto. As duas que bloqueavam o bloco financeiro — D-20 e D-18 —
foram respondidas, junto de D-16 e D-21, e estão na tabela acima.

Sobre as duas resolvidas por recomendação em vez de escolha explícita do
operador, vale registrar o raciocínio, porque as duas são reversíveis com custo
diferente:

- **D-18 configurável** é a opção que *evita* fixar valor de negócio no código:
  as faixas passam a ser dado cadastrado, e nenhuma constante de real aparece
  em migração. Fixá-las depois é trivial; descobrir depois quais eram as faixas
  fixadas por engano não é.
- **D-16 percentual** é a forma que se valida sozinha (a soma tem de fechar
  100%) e a única que sobrevive a uma alteração do valor do título — com valor
  fixo, mudar o total do título deixa o rateio sem cobrir a diferença. Valor
  fixo entra depois como segundo modo, com um discriminador na tabela de
  rateio, sem invalidar nada gravado.

### Estruturais — definem arquitetura

| # | Decisão | Observação |
| --- | --- | --- |
| D-03 | Origem do XML da NF-e | Upload, portal do fornecedor ou SEFAZ por chave (exige certificado A1) |
| D-04 | Existe ERP financeiro? | Se sim, inverte a direção da integração do módulo 1 |
| D-08 | SSO corporativo para clientes grandes | Entra agora ou depois |
| D-09 | Portal em subdomínio ou rota `/portal` | Afeta CSP, cookies e operação |
| D-11 | Telemetria de contador | DCA na rede do cliente, API do fabricante, ou manual |
| D-17 | Formato de importação de extrato bancário | OFX primeiro; CNAB se/quando houver cobrança registrada — Módulo 9 |
| ~~D-22~~ | Geração de título contratual: no fechamento ou em ciclo separado? | **Resolvida**: no fechamento, `app.fechar_competencia` — Módulo 11 (Anexo T) |
| D-24 | Fluxo de caixa integra com ERP/Open Finance ou só títulos internos? | Só títulos internos — Módulo 13 |

### De negócio — precisam de resposta da operação

| # | Pergunta | Módulo |
| --- | --- | --- |
| D-05 | Franquia acumulativa existe? | 2 |
| D-06 | Preço por filial do cliente é necessário? | 3 |
| D-10 | Cliente abre chamado pelo portal? | 5 |
| D-25 | Replanejamento de orçamento considera só o pago, ou também o aprovado-não-pago? | 14 |
| D-26 | Indicador análogo a "custo por paciente": por cliente ativo, por equipamento, ou os dois? | 14 |
| — | Página A3 conta como 2× A4? | 2, 6 |
| — | Duplex conta como 1 ou 2 páginas? | 6 |
| — | Qual o dia de corte da leitura mensal? | 6 |
| — | Impostos da NF entram no custo de aquisição? | 1 |
| — | Franquia sobre digitalização é cobrada? | 2 |
| — | Há comissão de vendas sobre o contrato? | 3 |

### Débitos técnicos que estes módulos tornam visíveis

1. **`equipamento.nota_fiscal` é texto livre** — substituído por FK no módulo 1;
   exige migração dos registros existentes.
2. **MFA tem coluna e não tem fluxo** — `usuario.mfa_habilitado` existe desde a
   migração 0002.
3. **Motor de reajuste não especificado** — `contrato.indice_reajuste` e
   `periodicidade_reajuste_meses` existem sem implementação, com CHECK menos
   restritivo que o do módulo de preço (`tabela_preco.indice_reajuste` já
   valida IPCA/IGPM/INPC/FIXO; `contrato` aceita texto livre) — inconsistência
   a fechar quando o motor for construído (Módulo 11).
4. **`app.mapa_ativos` nunca foi exercitada** — a função existe desde 0008;
   agora tem consumidor (Anexo O), mas ainda sem teste próprio.
5. **Notificações não existem como subsistema** — os módulos 5, 6, 10 e 12
   pedem e-mail e alertas; hoje há apenas o `outbox_evento` (migração 0007)
   sem worker que efetivamente envie.
6. **Nenhuma tabela `fatura` existe** — descoberto ao modelar o Módulo 11; a
   tela "Faturamento" hoje é inteiramente demonstrativa, em memória no
   front-end. Não é uma regressão desta rodada — é uma lacuna que só ficou
   visível ao se tentar modelar contas a receber sem duplicar o conceito.

---

## MATRIZ DE PERMISSÕES (Esqueleto)

Formato `recurso:ação`, não módulo→tela→botão como estrutura de dado — a
diferença e sua razão estão em §4.1. A tabela abaixo é a mesma matriz em forma
de visão administrativa: uma coluna por módulo, uma linha por perfil-base,
✔/— indicando acesso de leitura pelo menos; detalhe de ação granular fica no
catálogo (`packages/contracts/src/catalogo-permissoes.ts`), não aqui.

| Perfil | Financeiro¹ | Contas a Pagar | Contas a Receber | Fluxo de Caixa | Despesas | Usuários | Contratos | Equipamentos | Manutenção | Mapa |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Administrador da Plataforma | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Diretor / Executivo | ✔² | — | — | ✔ | ✔ | — | ✔ leitura | ✔ leitura | ✔ leitura | ✔ |
| Analista Financeiro | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ leitura | ✔ leitura | — | ✔ |
| Operador Administrativo | — | ✔ criar/baixar³ | ✔ criar/baixar³ | — | — | — | ✔ | — | — | ✔ |
| Aprovador N1/N2/N3⁴ | — | ✔ só a fila do próprio nível | ✔ idem | — | — | — | — | — | — | — |
| Visualizador | — | ✔ leitura | ✔ leitura | ✔ leitura | ✔ leitura | — | ✔ leitura | ✔ leitura | ✔ leitura | ✔ |
| Supervisor de Manutenção | — | — | — | — | — | — | ✔ leitura | ✔ | ✔ | ✔ |
| Admin Cliente / Gestor de Filial / Visualizador (cliente)⁵ | — | — | — | — | — | — | ✔ leitura, próprio | ✔ leitura, próprio | ✔ + abrir chamado | ✔ leitura, próprio |

¹ "Financeiro" aqui é o painel executivo (`financeiro:painel_executivo`,
`:rentabilidade_ler`), não uma tela própria — é visão consolidada sobre os
módulos ao lado.
² Diretor tem `financeiro:painel_executivo` mas não `pagar:aprovar` por
padrão — aprovação de valor alto é alçada, não perfil; ver Módulo 10 RN-F01.
³ "Sem aprovar" — operador cria o título e baixa o pagamento já aprovado, não
decide aprovação.
⁴ Não é um perfil, é uma **posição na fila** de `titulo_pagar_aprovacao` —
qualquer perfil com `alcada.tipo` configurado pode ocupar um nível.
⁵ Os três perfis de cliente (Módulo 4, "Perfis-base a provisionar") nunca têm
acesso a nenhuma coluna financeira — é a RN-L25 que já existe: usuário de
cliente não recebe permissão de escrita de cadastro nem, por extensão, acesso
a página financeira do locador.

---

## REVISÃO DE CÓDIGO — CHECKLIST

O pedido original trata isto como trabalho a fazer do zero. Boa parte **já
existe** — o valor desta seção é dizer com precisão o que está feito, o que
está feito mas não conectado, e o que falta.

- [x] **Mapear todos os endpoints existentes** — `apps/api/scripts/verificar-rotas.mjs`
      já faz isso a cada execução de CI, não é um mapeamento estático que
      envelhece: analisa todo `*.controller.ts` e reprova o build se algum
      `@Get/@Post/@Put/@Patch/@Delete` não tiver `@ExigePermissao` ou
      `@Publico` no mesmo bloco de decoradores.
- [x] **Middleware de autorização** — `PermissaoGuard`, registrado globalmente
      em `app.module.ts` via `APP_GUARD`. Nega por omissão (RN-026): rota sem
      permissão declarada nunca abre por esquecimento.
- [x] **Validação de permissão em cada endpoint** — decorrência do item
      acima: o guarda lê `@ExigePermissao` do handler e barra antes de
      chegar ao serviço. O que falta **não é o mecanismo**, é ele ter algo
      real para checar — ver o próximo item.
- [ ] **Emissão do JWT com permissões reais** — hoje só existe em teste
      (`apps/api/test/apoio.ts::token()`, que assina o mesmo formato que a
      produção usaria). Falta `POST /auth/login` assinando esse token a
      partir de `perfil.permissoes` de verdade — Módulo 4 §4.2 item 1. Sem
      isso, o guarda funciona mas nunca foi exercitado fora de teste.
- [ ] **Componente de renderização condicional no front** — `pode()` já
      existe (`lib/contexto.tsx`) e já é usado em telas (`pode('financeiro:rentabilidade_ler')`,
      por exemplo, no mapa). O que falta é a fonte: hoje `pode()` lê um
      perfil trocado por um seletor de demonstração, não uma sessão de login
      — Módulo 4 §4.2 item 2. A assinatura de `pode()` não muda; só a fonte.
- [x] **Filtro de filial em todas as consultas** — já é RLS (`usuario_perfil.escopo_tipo`),
      não filtro de aplicação, desde a migração 0002; estendido para o eixo
      de cliente na 0011. Toda tabela nova deste levantamento (Módulos 8–14)
      segue a mesma convenção — declarado em cada seção de modelagem acima.
- [ ] **Testar perfis com permissões diferentes** — os módulos existentes já
      têm teste de isolamento por tenant e por escopo (ver `packages/db/tests/02_rn028_isolamento_tenant.sql`
      e os testes de API por módulo); os módulos novos (8–14) precisam do
      mesmo par de testes cada um — já listado em "Critérios de Aceite" de
      cada seção acima, não repetido aqui.
- [ ] **Documentar a matriz de permissões por endpoint** — a matriz de perfil
      × módulo acima é a visão de produto; a de endpoint × permissão já é
      gerada automaticamente por `verificar-rotas.mjs` (ele sabe qual
      permissão cada rota exige, porque é o que ele confere) — falta só expor
      esse mesmo dado como relatório legível, não recolher de novo à mão.

**Diagnóstico em uma frase:** a AUTORIZAÇÃO está pronta e testada; o que falta
é a AUTENTICAÇÃO que a alimenta com dado real em vez de simulação — e isso é
inteiramente o Módulo 4.

---

## Referências cruzadas

| Assunto | Onde já está documentado |
| --- | --- |
| Modelo de dados atual | [Anexo A](A-modelo-de-dados.md) |
| Máquinas de estado | [Anexo B](B-maquinas-de-estado.md) |
| Catálogo de permissões | [Anexo C](C-matriz-de-permissoes.md) |
| Convenções de API, erros, idempotência | [Anexo D](D-catalogo-de-apis.md) |
| Motor de faturamento | [Anexo E](E-motor-de-faturamento.md) |
| Acessibilidade e gate de CI | [Anexo G](G-acessibilidade.md) |
| RLS, claims e pooling | [Anexo H](H-supabase.md) |
| Arquitetura do front-end | [Anexo I](I-refatoracao-frontend.md) |
| Implementação da API | [Anexo J](J-api-implementacao.md) |
| Formulários e camada de escrita | [Anexo K](K-formularios.md) |
| Resolução de D-01, D-02 e mais onze decisões | [Anexo M](M-decisoes-mercado-brasileiro.md) |
| Entrada fiscal de compra (Módulo 1) | [Anexo N](N-nota-fiscal-de-compra.md) |
| Mapa geográfico, tiles e geocodificação (Módulo 7) | [Anexo O](O-mapa-geografico.md) |
| Franquia, preço e consumo (Módulos 2, 3, 6) | [Anexo P](P-nucleo-comercial-e-consumo.md) |
