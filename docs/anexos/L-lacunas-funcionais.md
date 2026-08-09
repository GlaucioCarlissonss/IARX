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
- [x] Melhoria sobre existente — **com bloqueio estrutural**

### Descrição

O **modelo** de autorização está completo e é o mais maduro do repositório:
`usuario`, `perfil` com array de permissões validado por gatilho,
`usuario_perfil` com escopo, `alcada` por tipo, catálogo de 106 permissões
compartilhado entre API e front (`packages/contracts`), guarda que nega rota
sem permissão declarada, e verificador que reprova o CI se algum handler
esquecer o decorador.

O que **não existe**: a interface de gestão, a autenticação por senha com
recuperação, e — o ponto crítico — **qualquer noção de usuário do cliente.**

### O bloqueio

`app.escopo_tipo` = `TENANT · EMPRESA · FILIAL · REGIAO · PROPRIO`. Todos do
locador. Os três perfis de cliente pedidos (Admin Cliente, Gestor de Filial,
Visualizador) não têm como ser expressos: não há escopo `CLIENTE`, a RLS não
filtra por `cliente_id`, e o token não carrega esse eixo.

**Nada dos módulos 4 e 5 deve ser construído antes da decisão D-01.**

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
- **[DECISÃO D-01 · BLOQUEANTE]** Como isolar o cliente? Recomendação:
  **escopo adicional na RLS** (`app.cliente_id` por transação, políticas
  extras), mantendo um único banco e uma única API. As alternativas — tenant
  por cliente, ou filtro só na aplicação — ou multiplicam a operação por N
  clientes, ou dependem de nenhum desenvolvedor esquecer um `where`.
- **[DECISÃO D-02 · BLOQUEANTE]** Modelo organizacional do cliente. Recomendação:
  `grupo_economico 1:N cliente 1:N filial_cliente`, promovendo `local_operacao`
  a `filial_cliente`. Alternativa mais barata: usar `local_operacao` como está e
  não ter grupo econômico — mas o requisito de "visão consolidada por grupo"
  deixa de ser atendível.
- **[DECISÃO D-07]** Autenticação: Supabase Auth (coerente com o Anexo H, traz
  recuperação, MFA e rotação prontos) ou implementação própria com Argon2id?
  Recomendação: Supabase Auth; `usuario.subject_oidc` já existe para isso.
- **[DECISÃO D-08]** SSO corporativo (SAML/OIDC) para clientes grandes entra
  agora ou depois?
- **[LACUNA]** MFA: a coluna `mfa_habilitado` existe, o fluxo não.

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
- **[DECISÃO D-12]** Provedor de mapa. Recomendação: **MapLibre GL + tiles
  OpenStreetMap** — sem custo por carregamento, sem chave, licença permissiva, e
  o dado geográfico permanece no nosso banco. Google Maps traz melhor qualidade
  de endereço no Brasil ao custo de cobrança por carregamento e de vínculo
  contratual. Mapbox fica no meio. **A decisão afeta o custo recorrente.**
- **[DECISÃO D-13]** Provedor de geocodificação, que pode ser diferente do de
  tiles. Nominatim (gratuito, limite de 1 req/s, proibido uso em massa),
  Google Geocoding (pago, melhor cobertura no Brasil) ou base dos Correios.
- **[LACUNA]** Não há política de retenção da posição histórica do equipamento —
  rastrear onde cada ativo esteve é útil e tem implicação de privacidade.

---

## CRONOGRAMA SUGERIDO DE IMPLEMENTAÇÃO

| Ordem | Módulo | Depende de | Prioridade | Complexidade | Observação |
| :---: | --- | --- | :---: | :---: | --- |
| **0** | **Decisões D-01 e D-02** | — | **Bloqueante** | — | Sem elas, os módulos 4, 5 e 7 (visão cliente) não começam |
| 1 | Nota Fiscal de Compra | — | Alta | Média-Alta | Independente; pode correr em paralelo com o item 0 |
| 2 | Tabela de Franquias | — | Alta | Média | Alto reaproveitamento: os parâmetros já existem |
| 3 | Preço de Locação | Módulo 2 | Alta | Média | Simulador é o item de maior valor comercial |
| 4 | Usuários e Permissões | **D-01, D-02** | Crítica | **Alta** | O modelo existe; o eixo de cliente é novo e toca RLS |
| 5 | Portal do Cliente | Módulos 2, 3, 4, 6 | Alta | Média | Composição de leitura; a complexidade está no módulo 4 |
| 6 | Consumo de Impressões | Módulo 2 | Alta | **Baixa-Média** | ~70% pronto; falta consolidação, CSV e alertas |
| 7 | Mapa Geográfico | Módulos 4, 6 | Média | Média | Backend pronto; falta geocodificação e tela |

**Ajuste sugerido à ordem proposta:** o módulo 6 deveria vir **antes** do 5, não
depois — o portal exibe consumo, e exibir consumo exige a consolidação. O módulo
7 pode adiantar a visão do fornecedor sem esperar o módulo 4; só a visão do
cliente depende dele.

Ordem recomendada: **0 → 1 ∥ 2 → 3 → 6 → 4 → 5 → 7**

---

## INTEGRAÇÃO ENTRE MÓDULOS

```
                        ┌──────────────────────────┐
                        │ 1. NOTA FISCAL DE COMPRA │
                        └────────────┬─────────────┘
                                     │ cria, com valor rateado e garantia
                                     ▼
      ┌────────────────────────────────────────────────────────┐
      │              equipamento  (já existe)                  │
      │   patrimônio · série · modelo · status · geo_atual      │
      └───┬───────────────────┬────────────────────────┬───────┘
          │                   │                        │
          │ aloca             │ mede                   │ posiciona
          ▼                   ▼                        ▼
  ┌───────────────┐   ┌────────────────┐      ┌────────────────┐
  │   contrato    │   │ 6. CONSUMO     │      │ 7. MAPA        │
  │  (já existe)  │◄──┤   consolidação │      │  app.mapa_     │
  └───┬───────┬───┘   │   por competên.│      │  ativos()      │
      │       │       └────────┬───────┘      └────────┬───────┘
      │       │                │                       │
      │       │  franquia      │ excedente             │
      │       └────────────────┤                       │
      ▼                        ▼                       │
┌─────────────┐        ┌──────────────┐                │
│ 2. FRANQUIA │───────►│  faturamento │                │
└─────────────┘        │ (já existe)  │                │
┌─────────────┐        └──────┬───────┘                │
│ 3. PREÇO    │───────────────┘                        │
│  simulador  │                                        │
└─────────────┘                                        │
                                                       │
        ┌──────────────────────────────┐               │
        │ 4. USUÁRIOS E PERMISSÕES     │               │
        │    escopo CLIENTE na RLS     │               │
        └──────────────┬───────────────┘               │
                       │ recorta TUDO abaixo           │
                       ▼                               │
        ┌──────────────────────────────┐               │
        │ 5. PORTAL DO CLIENTE         │◄──────────────┘
        │  contratos · consumo · custo · mapa           │
        └──────────────────────────────┘
```

**Leitura do diagrama**

- O **módulo 1 é a raiz**: nenhum ativo deveria existir sem nota de origem.
- Os **módulos 2 e 3 alimentam o faturamento** que já existe — não o substituem.
  O motor do Anexo E passa a ler de tabela versionada em vez de valor solto.
- O **módulo 6 fecha o ciclo do dinheiro**: leitura → consumo → excedente →
  fatura. Sem ele o módulo 2 não tem o que multiplicar.
- O **módulo 4 é ortogonal**: não acrescenta dado, recorta todo o resto. É por
  isso que ele precisa vir antes do portal, e não junto.
- O **módulo 7 é camada de visualização** sobre dado que já existe.

---

## LACUNAS GLOBAIS E DECISÕES PENDENTES

### Bloqueantes — precisam de resposta antes do desenvolvimento

| # | Decisão | Recomendação | Impacto se adiada |
| --- | --- | --- | --- |
| **D-01** | Como isolar o cliente locatário nos dados? | Escopo `CLIENTE` adicional na RLS, com `SET LOCAL app.cliente_id` — um banco, uma API | Módulos 4, 5 e a visão de cliente do 7 não começam |
| **D-02** | Modelo organizacional do cliente | `grupo_economico → cliente → filial_cliente`, promovendo `local_operacao` | "Visão consolidada por grupo" e "Gestor de Filial" ficam inatendíveis |

### Estruturais — definem arquitetura

| # | Decisão | Observação |
| --- | --- | --- |
| D-03 | Origem do XML da NF-e | Upload, portal do fornecedor ou SEFAZ por chave (exige certificado A1) |
| D-04 | Existe ERP financeiro? | Se sim, inverte a direção da integração do módulo 1 |
| D-07 | Autenticação | Supabase Auth (coerente com o Anexo H) ou Argon2id próprio |
| D-08 | SSO corporativo para clientes grandes | Entra agora ou depois |
| D-09 | Portal em subdomínio ou rota `/portal` | Afeta CSP, cookies e operação |
| D-11 | Telemetria de contador | DCA na rede do cliente, API do fabricante, ou manual |
| D-12 | Provedor de mapa | MapLibre + OSM (sem custo) vs Google (melhor endereço, pago) — **custo recorrente** |
| D-13 | Provedor de geocodificação | Pode diferir do provedor de tiles |

### De negócio — precisam de resposta da operação

| # | Pergunta | Módulo |
| --- | --- | --- |
| D-05 | Franquia acumulativa existe? | 2 |
| D-06 | Preço por filial do cliente é necessário? | 3 (depende de D-02) |
| D-10 | Cliente abre chamado pelo portal? | 5 |
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
   `periodicidade_reajuste_meses` existem sem implementação; a tabela de preços
   é a origem natural.
4. **`app.mapa_ativos` nunca foi exercitada** — a função existe desde 0008 e não
   tem teste, porque não há consumidor.
5. **Notificações não existem como subsistema** — os módulos 5 e 6 pedem e-mail
   e alertas; hoje há apenas o `outbox_evento` (migração 0007) sem worker.

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
