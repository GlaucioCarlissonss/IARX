-- =============================================================================
-- 0012 — Tabela de franquias e tabela de preços
--
-- Referências: docs/anexos/L-lacunas-funcionais.md (Módulos 2 e 3)
--              docs/anexos/M-decisoes-mercado-brasileiro.md (M.3, M.4)
-- Invariantes: RN-L14…RN-L20 (franquia), RN-L21…RN-L27 (preço)
--
-- Nota de numeração: o Anexo L numerou as regras por módulo e as faixas
-- colidiram (o `RN-L10` da franquia é outro `RN-L10` da nota fiscal). Aqui elas
-- são renumeradas em faixa única e contínua — uma regra com dois significados é
-- pior que uma regra com nome feio.
--
--   RN-L01…L10  nota fiscal de compra   (migração 0010)
--   RN-L11…L13  eixo de cliente          (migração 0011)
--   RN-L14…L20  tabela de franquia       (esta)
--   RN-L21…L27  tabela de preço          (esta)
--
-- A decisão de arquitetura que governa as duas: **a tabela é a fonte, o item de
-- contrato é a fotografia**. São duas verdades diferentes e ambas necessárias.
--
--   tabela_*_item          → o que a política diz hoje    (muda: nova versão)
--   contrato_item.valor_*  → o que este cliente acordou   (muda: aditivo)
--
-- Trocar a tabela **não** altera contrato vigente. É o que impede que um
-- reajuste comercial reprecifique retroativamente 400 contratos.
-- =============================================================================

do $$ begin
  create type app.tabela_status as enum ('RASCUNHO', 'ATIVA', 'INATIVA');
exception when duplicate_object then null; end $$;

-- =============================================================================
-- MÓDULO 2 — Tabela de franquias
-- =============================================================================

create table if not exists public.tabela_franquia (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete restrict,
  nome            text not null,
  descricao       text,
  vigencia_inicio date not null,
  vigencia_fim    date,
  status          app.tabela_status not null default 'RASCUNHO',
  versao          integer not null default 1,
  substitui_id    uuid references public.tabela_franquia(id) on delete restrict,
  ativada_em      timestamptz,
  ativada_por     uuid references public.usuario(id) on delete set null,
  version         integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  constraint tf_vigencia_coerente check (vigencia_fim is null or vigencia_fim > vigencia_inicio),
  constraint tf_ativa_tem_marca check (status <> 'ATIVA' or ativada_em is not null),
  constraint tf_nao_substitui_a_si check (substitui_id is distinct from id)
);
create unique index if not exists tf_nome_versao_uk
  on public.tabela_franquia (tenant_id, lower(nome), versao) where deleted_at is null;
create index if not exists tf_vigencia_ix
  on public.tabela_franquia (tenant_id, status, vigencia_inicio desc) where deleted_at is null;

create table if not exists public.tabela_franquia_item (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant(id) on delete restrict,
  tabela_franquia_id uuid not null references public.tabela_franquia(id) on delete cascade,
  categoria_id       uuid references public.categoria_equipamento(id) on delete restrict,
  modelo_id          uuid references public.modelo(id) on delete restrict,

  franquia_mono      integer not null default 0,
  franquia_color     integer not null default 0,
  franquia_escopo    text not null default 'ITEM',
  valor_pagina_mono     numeric(15,6) not null default 0,
  valor_pagina_color    numeric(15,6) not null default 0,
  valor_excedente_mono  numeric(15,6) not null,
  valor_excedente_color numeric(15,6) not null default 0,
  permite_acumulo    boolean not null default false,
  meses_acumulo      integer,

  /*
   * Alvo e vigência desnormalizados do pai.
   *
   * Existem para que RN-L16 seja uma EXCLUDE constraint de verdade — o mesmo
   * mecanismo de RN-001 — e não um gatilho que consulta antes de escrever.
   * A diferença não é estilística: o gatilho tem uma janela entre a leitura e
   * a gravação, e duas requisições simultâneas passariam as duas.
   *
   * Mantidos pelo gatilho `tfi_herda_vigencia`; nenhum caminho de escrita os
   * informa à mão.
   */
  alvo_id   uuid generated always as (coalesce(categoria_id, modelo_id)) stored,
  vigencia  daterange,
  ativa     boolean not null default false,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,

  -- Exatamente um alvo. Linha sem alvo não se aplica a nada; com os dois,
  -- não se sabe qual precedência usar.
  constraint tfi_alvo_unico check ((categoria_id is null) <> (modelo_id is null)),
  constraint tfi_escopo_valido check (franquia_escopo in ('ITEM', 'CONTRATO')),
  constraint tfi_franquias_nao_negativas check (franquia_mono >= 0 and franquia_color >= 0),
  constraint tfi_valores_nao_negativos check (
    valor_pagina_mono >= 0 and valor_pagina_color >= 0
    and valor_excedente_mono >= 0 and valor_excedente_color >= 0
  ),
  constraint tfi_acumulo_coerente check (
    not permite_acumulo or (meses_acumulo between 1 and 12)
  )
);

create unique index if not exists tfi_alvo_uk
  on public.tabela_franquia_item (tabela_franquia_id, alvo_id);
create index if not exists tfi_tabela_ix
  on public.tabela_franquia_item (tenant_id, tabela_franquia_id);

-- -----------------------------------------------------------------------------
-- RN-L16 — sem sobreposição de vigência para o mesmo alvo
--
-- Duas tabelas ATIVAS não podem cobrir a mesma categoria ou o mesmo modelo em
-- períodos que se cruzam: o motor de faturamento não teria como escolher, e
-- escolheria em silêncio pela ordem do índice.
--
-- Requer btree_gist (migração 0001) para combinar uuid (=) com daterange (&&).
-- -----------------------------------------------------------------------------
alter table public.tabela_franquia_item drop constraint if exists tfi_sem_sobreposicao;
alter table public.tabela_franquia_item add constraint tfi_sem_sobreposicao
  exclude using gist (
    tenant_id with =,
    alvo_id   with =,
    vigencia  with &&
  ) where (ativa);

-- =============================================================================
-- MÓDULO 3 — Tabela de preços
-- =============================================================================

create table if not exists public.tabela_preco (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete restrict,
  nome            text not null,
  descricao       text,
  vigencia_inicio date not null,
  vigencia_fim    date,
  status          app.tabela_status not null default 'RASCUNHO',
  versao          integer not null default 1,
  substitui_id    uuid references public.tabela_preco(id) on delete restrict,
  moeda           text not null default 'BRL',

  /*
   * Abrangência define a precedência (RN-L21): CONTRATO vence CLIENTE, que
   * vence GERAL. É o que permite negociar um cliente sem duplicar a tabela
   * inteira — e o que faz a fatura conseguir explicar de onde veio o valor.
   */
  abrangencia     text not null default 'GERAL',
  cliente_id      uuid references public.cliente(id) on delete restrict,
  contrato_id     uuid references public.contrato(id) on delete restrict,

  /* Reajuste: IPCA anual é o padrão de mercado (Lei 10.192/01 art. 2º §1º). */
  indice_reajuste text not null default 'IPCA',
  meses_reajuste  integer not null default 12,

  ativada_em      timestamptz,
  ativada_por     uuid references public.usuario(id) on delete set null,
  version         integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,

  constraint tp_vigencia_coerente check (vigencia_fim is null or vigencia_fim > vigencia_inicio),
  constraint tp_ativa_tem_marca check (status <> 'ATIVA' or ativada_em is not null),
  constraint tp_abrangencia_valida check (abrangencia in ('GERAL', 'CLIENTE', 'CONTRATO')),
  constraint tp_alvo_coerente check (
    (abrangencia = 'CLIENTE') = (cliente_id is not null)
    and (abrangencia = 'CONTRATO') = (contrato_id is not null)
  ),
  constraint tp_indice_valido check (indice_reajuste in ('IPCA', 'IGPM', 'INPC', 'FIXO')),
  constraint tp_reajuste_anual_minimo check (meses_reajuste >= 12),
  constraint tp_nao_substitui_a_si check (substitui_id is distinct from id)
);

comment on constraint tp_reajuste_anual_minimo on public.tabela_preco is
  'Lei 10.192/01, art. 2º §1º: é nula de pleno direito a cláusula de reajuste com periodicidade inferior a um ano.';

create unique index if not exists tp_nome_versao_uk
  on public.tabela_preco (tenant_id, lower(nome), versao) where deleted_at is null;
create index if not exists tp_precedencia_ix
  on public.tabela_preco (tenant_id, abrangencia, status, vigencia_inicio desc)
  where deleted_at is null;

create table if not exists public.tabela_preco_item (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete restrict,
  tabela_preco_id uuid not null references public.tabela_preco(id) on delete cascade,
  categoria_id    uuid references public.categoria_equipamento(id) on delete restrict,
  modelo_id       uuid references public.modelo(id) on delete restrict,

  valor_mensal       numeric(15,4) not null,
  valor_instalacao   numeric(15,4) not null default 0,
  valor_retirada     numeric(15,4) not null default 0,
  valor_manutencao   numeric(15,4) not null default 0,
  prazo_minimo_meses integer,

  alvo_id uuid generated always as (coalesce(categoria_id, modelo_id)) stored,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,

  constraint tpi_alvo_unico check ((categoria_id is null) <> (modelo_id is null)),
  constraint tpi_valores_nao_negativos check (
    valor_mensal >= 0 and valor_instalacao >= 0 and valor_retirada >= 0 and valor_manutencao >= 0
  ),
  constraint tpi_prazo_positivo check (prazo_minimo_meses is null or prazo_minimo_meses > 0)
);
create unique index if not exists tpi_alvo_uk
  on public.tabela_preco_item (tabela_preco_id, alvo_id);
create index if not exists tpi_tabela_ix
  on public.tabela_preco_item (tenant_id, tabela_preco_id);

-- -----------------------------------------------------------------------------
-- desconto_comercial
--
-- RN-L22: desconto tem **vigência própria**. Uma carência de três meses expira
-- sozinha, sem depender de alguém lembrar de removê-la — é a origem mais comum
-- de receita perdida em locação.
-- -----------------------------------------------------------------------------
create table if not exists public.desconto_comercial (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete restrict,
  contrato_id      uuid references public.contrato(id) on delete cascade,
  contrato_item_id uuid references public.contrato_item(id) on delete cascade,
  tipo             text not null,
  percentual       numeric(5,2),
  valor            numeric(15,4),
  vigencia_inicio  date not null,
  vigencia_fim     date,
  motivo           text not null,
  aprovado_por     uuid references public.usuario(id) on delete set null,
  aprovado_em      timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,

  constraint dc_alvo_unico check ((contrato_id is null) <> (contrato_item_id is null)),
  constraint dc_tipo_valido check (tipo in ('PERCENTUAL', 'VALOR_FIXO')),
  constraint dc_valor_coerente check (
    (tipo = 'PERCENTUAL') = (percentual is not null)
    and (tipo = 'VALOR_FIXO') = (valor is not null)
  ),
  constraint dc_percentual_na_faixa check (percentual is null or percentual between 0 and 100),
  constraint dc_valor_nao_negativo check (valor is null or valor >= 0),
  constraint dc_vigencia_coerente check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  -- RN-009 já exigia motivo para desconto; aqui ele deixa de ser convenção.
  constraint dc_motivo_substantivo check (length(btrim(motivo)) >= 5)
);
create index if not exists dc_contrato_ix
  on public.desconto_comercial (tenant_id, contrato_id) where deleted_at is null;
create index if not exists dc_item_ix
  on public.desconto_comercial (tenant_id, contrato_item_id) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- contrato_item guarda a procedência do que foi acordado
-- -----------------------------------------------------------------------------
alter table public.contrato_item
  add column if not exists tabela_franquia_id uuid references public.tabela_franquia(id) on delete restrict,
  add column if not exists tabela_franquia_item_id uuid references public.tabela_franquia_item(id) on delete restrict,
  add column if not exists tabela_preco_id uuid references public.tabela_preco(id) on delete restrict,
  add column if not exists tabela_preco_item_id uuid references public.tabela_preco_item(id) on delete restrict,
  add column if not exists valor_instalacao numeric(15,4) not null default 0,
  add column if not exists valor_retirada numeric(15,4) not null default 0;

comment on column public.contrato_item.tabela_preco_id is
  'De onde o valor veio. A fatura precisa poder explicar o preço; o valor em si fica no item, porque trocar a tabela não reprecifica contrato vigente.';

-- -----------------------------------------------------------------------------
-- contrato_tabela_historico — a troca de vínculo é auditável por si
-- -----------------------------------------------------------------------------
create table if not exists public.contrato_tabela_historico (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant(id) on delete restrict,
  contrato_id        uuid not null references public.contrato(id) on delete cascade,
  tipo               text not null,
  tabela_anterior_id uuid,
  tabela_nova_id     uuid,
  /* RN-L18: troca exige motivo. */
  motivo             text not null,
  /* RN-L17: não retroage — vale a partir desta competência. */
  competencia_efeito text not null,
  aplicado_em        timestamptz not null default now(),
  aplicado_por       uuid references public.usuario(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint cth_tipo_valido check (tipo in ('FRANQUIA', 'PRECO')),
  constraint cth_motivo_substantivo check (length(btrim(motivo)) >= 5),
  constraint cth_competencia_formato check (competencia_efeito ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
create index if not exists cth_contrato_ix
  on public.contrato_tabela_historico (tenant_id, contrato_id, aplicado_em desc);

-- =============================================================================
-- INVARIANTES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Herança de vigência e status para os itens da tabela de franquia
--
-- É o que sustenta a EXCLUDE constraint. Sem esta propagação, ativar uma tabela
-- não marcaria os itens como ativos e a sobreposição passaria despercebida.
-- -----------------------------------------------------------------------------
create or replace function app.herdar_vigencia_franquia()
returns trigger
language plpgsql
as $$
declare
  v_ini date; v_fim date; v_status app.tabela_status;
begin
  select vigencia_inicio, vigencia_fim, status
    into v_ini, v_fim, v_status
    from public.tabela_franquia where id = new.tabela_franquia_id;

  -- `daterange` semiaberto, como em RN-001: uma tabela que termina no dia em
  -- que a seguinte começa não conflita com ela.
  new.vigencia := daterange(v_ini, v_fim, '[)');
  new.ativa := (v_status = 'ATIVA');
  return new;
end;
$$;

drop trigger if exists tfi_herda_vigencia on public.tabela_franquia_item;
create trigger tfi_herda_vigencia
  before insert or update of tabela_franquia_id on public.tabela_franquia_item
  for each row execute function app.herdar_vigencia_franquia();

create or replace function app.propagar_vigencia_franquia()
returns trigger
language plpgsql
as $$
begin
  if new.vigencia_inicio is distinct from old.vigencia_inicio
     or new.vigencia_fim is distinct from old.vigencia_fim
     or new.status is distinct from old.status then
    update public.tabela_franquia_item
       set vigencia = daterange(new.vigencia_inicio, new.vigencia_fim, '[)'),
           ativa = (new.status = 'ATIVA')
     where tabela_franquia_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists tf_propaga_vigencia on public.tabela_franquia;
create trigger tf_propaga_vigencia
  after update on public.tabela_franquia
  for each row execute function app.propagar_vigencia_franquia();

-- -----------------------------------------------------------------------------
-- RN-L14 / RN-L21 — tabela ATIVA é imutável
--
-- Alterar preço ou franquia de uma tabela em uso reprecificaria, em silêncio,
-- todo contrato que a referencia. A correção é criar nova versão, que herda o
-- conteúdo; a anterior recebe `vigencia_fim` e passa a INATIVA.
--
-- A transição ATIVA → INATIVA continua permitida: é justamente o encerramento.
-- -----------------------------------------------------------------------------
create or replace function app.bloquear_tabela_ativa()
returns trigger
language plpgsql
as $$
declare
  v_encerrando boolean;
begin
  if old.status <> 'ATIVA' then
    return new;
  end if;

  v_encerrando := new.status = 'INATIVA';

  -- Encerrar exige data de fim: uma tabela inativa sem fim declarado deixa o
  -- histórico sem saber até quando ela valeu.
  if v_encerrando then
    if new.vigencia_fim is null then
      raise exception 'encerrar a tabela % exige informar a data de fim de vigência', old.nome
        using errcode = '23514', hint = 'Sem fim declarado o histórico não sabe até quando ela valeu.';
    end if;
    return new;
  end if;

  if new.status <> old.status
     or new.vigencia_inicio is distinct from old.vigencia_inicio
     or new.nome is distinct from old.nome then
    raise exception 'a tabela % está ativa e não aceita alteração', old.nome
      using errcode = '23514',
            hint = 'Crie uma nova versão (substitui_id) e encerre esta (RN-L14/RN-L21).';
  end if;

  return new;
end;
$$;

drop trigger if exists tf_imutavel on public.tabela_franquia;
create trigger tf_imutavel
  before update on public.tabela_franquia
  for each row execute function app.bloquear_tabela_ativa();

drop trigger if exists tp_imutavel on public.tabela_preco;
create trigger tp_imutavel
  before update on public.tabela_preco
  for each row execute function app.bloquear_tabela_ativa();

/** Itens de tabela ativa também são imutáveis — bloquear só o cabeçalho deixaria
 *  a porta aberta para reprecificar pela linha. */
create or replace function app.bloquear_item_de_tabela_ativa()
returns trigger
language plpgsql
as $$
declare
  v_status app.tabela_status;
  v_nome   text;
begin
  if tg_table_name = 'tabela_franquia_item' then
    select status, nome into v_status, v_nome from public.tabela_franquia
     where id = coalesce(new.tabela_franquia_id, old.tabela_franquia_id);
  else
    select status, nome into v_status, v_nome from public.tabela_preco
     where id = coalesce(new.tabela_preco_id, old.tabela_preco_id);
  end if;

  if v_status <> 'ATIVA' then
    return coalesce(new, old);
  end if;

  -- Exceção deliberada: a propagação de `vigencia` e `ativa` a partir do pai
  -- não é edição de política — é o próprio ato de ativar ou encerrar a tabela.
  -- Sem esta janela, ativar uma tabela seria impossível: o gatilho de
  -- propagação bateria no de imutabilidade, e a tabela nunca sairia de
  -- RASCUNHO.
  --
  -- A verificação lista **o que constitui a política**, em vez de subtrair as
  -- colunas de sincronismo de um `to_jsonb`. É mais longo e é melhor: uma
  -- coluna nova entra bloqueada por omissão, e não liberada por esquecimento.
  if tg_op = 'UPDATE' and tg_table_name = 'tabela_franquia_item' then
    if new.categoria_id          is not distinct from old.categoria_id
   and new.modelo_id             is not distinct from old.modelo_id
   and new.franquia_mono         is not distinct from old.franquia_mono
   and new.franquia_color        is not distinct from old.franquia_color
   and new.franquia_escopo       is not distinct from old.franquia_escopo
   and new.valor_pagina_mono     is not distinct from old.valor_pagina_mono
   and new.valor_pagina_color    is not distinct from old.valor_pagina_color
   and new.valor_excedente_mono  is not distinct from old.valor_excedente_mono
   and new.valor_excedente_color is not distinct from old.valor_excedente_color
   and new.permite_acumulo       is not distinct from old.permite_acumulo
   and new.meses_acumulo         is not distinct from old.meses_acumulo
    then
      return new;
    end if;
  end if;

  raise exception 'a tabela % está ativa; seus itens são imutáveis', v_nome
    using errcode = '23514', hint = 'Crie uma nova versão (RN-L14/RN-L21).';
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['tabela_franquia_item','tabela_preco_item'] loop
    execute format('drop trigger if exists %I_tabela_imutavel on public.%I', t, t);
    execute format(
      'create trigger %I_tabela_imutavel before insert or update or delete on public.%I
         for each row execute function app.bloquear_item_de_tabela_ativa()', t, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- RN-L20 — categoria sem contador não aceita franquia
--
-- Desktop e notebook não têm medidor. Uma linha de franquia para eles produz
-- um excedente que nunca é apurado — e, pior, sugere ao vendedor que existe
-- uma franquia a negociar onde não existe medição.
-- -----------------------------------------------------------------------------
create or replace function app.validar_franquia_exige_contador()
returns trigger
language plpgsql
as $$
declare
  v_tem_contador boolean;
  v_nome text;
begin
  if new.categoria_id is not null then
    select c.tipo_medidor_padrao is not null, c.nome
      into v_tem_contador, v_nome
      from public.categoria_equipamento c where c.id = new.categoria_id;
  else
    select c.tipo_medidor_padrao is not null, c.nome
      into v_tem_contador, v_nome
      from public.modelo m
      join public.categoria_equipamento c on c.id = m.categoria_id
     where m.id = new.modelo_id;
  end if;

  if not coalesce(v_tem_contador, false)
     and (new.franquia_mono > 0 or new.franquia_color > 0
          or new.valor_excedente_mono > 0 or new.valor_excedente_color > 0) then
    raise exception '% não tem medidor e não aceita franquia nem excedente', v_nome
      using errcode = '23514',
            hint = 'Categorias sem contador são cobradas por valor fixo mensal (RN-L20).';
  end if;

  return new;
end;
$$;

drop trigger if exists tfi_exige_contador on public.tabela_franquia_item;
create trigger tfi_exige_contador
  before insert or update on public.tabela_franquia_item
  for each row execute function app.validar_franquia_exige_contador();

-- =============================================================================
-- Resolução: a função que a proposta e a fatura compartilham
-- =============================================================================

/**
 * Franquia aplicável a um equipamento numa data.
 *
 * RN-L15 — **mais específico primeiro**: linha por modelo vence linha por
 * categoria. Sem nenhuma das duas devolve zero linhas, e é deliberado: o
 * chamador precisa exigir preenchimento manual. Devolver franquia zero seria
 * cobrar tudo como excedente, silenciosamente.
 */
create or replace function app.resolver_franquia(p_equipamento_id uuid, p_data date default current_date)
returns table (
  tabela_franquia_id      uuid,
  tabela_franquia_item_id uuid,
  origem                  text,
  franquia_mono           integer,
  franquia_color          integer,
  franquia_escopo         text,
  valor_excedente_mono    numeric(15,6),
  valor_excedente_color   numeric(15,6)
)
language sql
stable
as $$
  select tf.id, tfi.id,
         case when tfi.modelo_id is not null then 'MODELO' else 'CATEGORIA' end,
         tfi.franquia_mono, tfi.franquia_color, tfi.franquia_escopo,
         tfi.valor_excedente_mono, tfi.valor_excedente_color
    from public.equipamento e
    join public.tabela_franquia_item tfi
      on tfi.modelo_id = e.modelo_id or tfi.categoria_id = e.categoria_id
    join public.tabela_franquia tf on tf.id = tfi.tabela_franquia_id
   where e.id = p_equipamento_id
     and tf.status = 'ATIVA'
     and tf.deleted_at is null
     and tf.vigencia_inicio <= p_data
     and (tf.vigencia_fim is null or tf.vigencia_fim > p_data)
   -- Modelo antes de categoria; empate improvável resolvido pela tabela mais
   -- recente, para que o resultado nunca dependa da ordem física das linhas.
   order by (tfi.modelo_id is not null) desc, tf.vigencia_inicio desc
   limit 1;
$$;

/**
 * Preço aplicável a um equipamento, para um contrato/cliente, numa data.
 *
 * RN-L21 — precedência **Contrato → Cliente → Geral**, e dentro de cada nível,
 * modelo antes de categoria. Devolve também a origem, porque a fatura precisa
 * conseguir explicar de onde veio o valor: "R$ 289,00" sem procedência vira
 * discussão comercial sem árbitro.
 */
create or replace function app.resolver_preco(
  p_equipamento_id uuid,
  p_cliente_id     uuid default null,
  p_contrato_id    uuid default null,
  p_data           date default current_date
)
returns table (
  tabela_preco_id      uuid,
  tabela_preco_item_id uuid,
  abrangencia          text,
  origem_alvo          text,
  valor_mensal         numeric(15,4),
  valor_instalacao     numeric(15,4),
  valor_retirada       numeric(15,4),
  prazo_minimo_meses   integer
)
language sql
stable
as $$
  select tp.id, tpi.id, tp.abrangencia,
         case when tpi.modelo_id is not null then 'MODELO' else 'CATEGORIA' end,
         tpi.valor_mensal, tpi.valor_instalacao, tpi.valor_retirada, tpi.prazo_minimo_meses
    from public.equipamento e
    join public.tabela_preco_item tpi
      on tpi.modelo_id = e.modelo_id or tpi.categoria_id = e.categoria_id
    join public.tabela_preco tp on tp.id = tpi.tabela_preco_id
   where e.id = p_equipamento_id
     and tp.status = 'ATIVA'
     and tp.deleted_at is null
     and tp.vigencia_inicio <= p_data
     and (tp.vigencia_fim is null or tp.vigencia_fim > p_data)
     and (
       (tp.abrangencia = 'CONTRATO' and tp.contrato_id = p_contrato_id)
       or (tp.abrangencia = 'CLIENTE' and tp.cliente_id = p_cliente_id)
       or tp.abrangencia = 'GERAL'
     )
   order by case tp.abrangencia when 'CONTRATO' then 0 when 'CLIENTE' then 1 else 2 end,
            (tpi.modelo_id is not null) desc,
            tp.vigencia_inicio desc
   limit 1;
$$;

/**
 * Desconto vigente para um item, com a regra de não acúmulo.
 *
 * RN-L23 — havendo desconto de contrato **e** de item, vale o de item. Somar os
 * dois é o erro que produz mensalidade negativa, e ele só aparece na fatura.
 */
create or replace function app.desconto_vigente(p_contrato_item_id uuid, p_data date default current_date)
returns table (tipo text, percentual numeric(5,2), valor numeric(15,4), origem text, motivo text)
language sql
stable
as $$
  select d.tipo, d.percentual, d.valor,
         case when d.contrato_item_id is not null then 'ITEM' else 'CONTRATO' end,
         d.motivo
    from public.desconto_comercial d
   where d.deleted_at is null
     and d.vigencia_inicio <= p_data
     and (d.vigencia_fim is null or d.vigencia_fim >= p_data)
     and (
       d.contrato_item_id = p_contrato_item_id
       or d.contrato_id = (select contrato_id from public.contrato_item where id = p_contrato_item_id)
     )
   order by (d.contrato_item_id is not null) desc, d.vigencia_inicio desc
   limit 1;
$$;

comment on function app.resolver_franquia(uuid, date) is
  'Franquia aplicável (RN-L15). Zero linhas quando não há política — devolver franquia zero cobraria tudo como excedente.';
comment on function app.resolver_preco(uuid, uuid, uuid, date) is
  'Preço aplicável com precedência Contrato → Cliente → Geral (RN-L21), com a origem para a fatura poder explicá-lo.';

-- =============================================================================
-- Gatilhos padrão, auditoria e RLS
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'tabela_franquia','tabela_franquia_item',
    'tabela_preco','tabela_preco_item',
    'desconto_comercial','contrato_tabela_historico'
  ] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
    perform app.habilitar_auditoria(t);
    perform app.habilitar_rls_tenant(t, false);
  end loop;
end $$;

-- `contrato_tabela_historico` não tem `updated_at`: é registro de evento.
drop trigger if exists contrato_tabela_historico_touch on public.contrato_tabela_historico;

-- Tabela de preço com abrangência de cliente entra no eixo do locatário: um
-- cliente não pode enxergar a negociação de outro.
select app.habilitar_rls_cliente('tabela_preco', 'cliente_id');
select app.habilitar_rls_cliente('desconto_comercial',
  '(select c.cliente_id from public.contrato c where c.id = coalesce(contrato_id,
     (select ci.contrato_id from public.contrato_item ci where ci.id = contrato_item_id)))');

comment on table public.tabela_franquia is
  'Política de franquia versionada. A tabela é a fonte; o item de contrato é a fotografia do que o cliente acordou (Módulo 2 do Anexo L).';
comment on table public.tabela_preco is
  'Política de preço versionada, com precedência Contrato → Cliente → Geral (Módulo 3 do Anexo L).';
