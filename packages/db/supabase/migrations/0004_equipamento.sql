-- =============================================================================
-- 0004 — Catálogo e equipamentos
--
-- Referências: docs/anexos/A-modelo-de-dados.md (A.5) · B-maquinas-de-estado.md (B.2)
-- Invariantes: RN-002 (unicidade de identificação), RN-003/004 (disponibilidade),
--              RN-020 (leitura monotônica)
-- =============================================================================

-- Estados do ativo — máquina de estados do Anexo B.2
do $$ begin
  create type app.equipamento_status as enum (
    'DISPONIVEL',
    'RESERVADO',
    'EM_TRANSITO_ENTREGA',
    'LOCADO',
    'EM_TRANSITO_RETORNO',
    'EM_INSPECAO',
    'EM_MANUTENCAO',
    'BLOQUEADO',
    'EXTRAVIADO',
    'BAIXADO'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.medidor_tipo as enum ('HORIMETRO', 'CONTADOR', 'ODOMETRO', 'DIAS');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Catálogo: fabricante -> modelo -> categoria
-- -----------------------------------------------------------------------------
create table if not exists public.fabricante (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete restrict,
  nome       text not null,
  pais       text,
  contato_suporte jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text
);
create unique index if not exists fabricante_nome_uk
  on public.fabricante (tenant_id, lower(nome)) where deleted_at is null;

create table if not exists public.categoria_equipamento (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete restrict,
  codigo     text not null,
  nome       text not null,
  tipo_medidor_padrao app.medidor_tipo,
  vida_util_meses_padrao integer,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text
);
create unique index if not exists categoria_codigo_uk
  on public.categoria_equipamento (tenant_id, codigo) where deleted_at is null;

create table if not exists public.modelo (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  fabricante_id uuid not null references public.fabricante(id) on delete restrict,
  categoria_id  uuid not null references public.categoria_equipamento(id) on delete restrict,
  codigo        text not null,
  nome          text not null,
  especificacoes jsonb not null default '{}'::jsonb,
  preco_tabela_mensal  numeric(15,4),
  preco_tabela_diaria  numeric(15,4),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  constraint modelo_precos_nao_negativos check (
    coalesce(preco_tabela_mensal, 0) >= 0 and coalesce(preco_tabela_diaria, 0) >= 0
  )
);
create unique index if not exists modelo_codigo_uk
  on public.modelo (tenant_id, codigo) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- equipamento — entidade soberana da plataforma (docs/01 §1.2)
-- -----------------------------------------------------------------------------
create table if not exists public.equipamento (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  patrimonio    text not null,
  numero_serie  text,
  modelo_id     uuid not null references public.modelo(id) on delete restrict,
  categoria_id  uuid not null references public.categoria_equipamento(id) on delete restrict,
  filial_id     uuid not null references public.filial(id) on delete restrict,

  status        app.equipamento_status not null default 'DISPONIVEL',
  motivo_indisponibilidade text,
  bloqueado     boolean not null default false,
  bloqueio_motivo text,
  bloqueio_ate  timestamptz,

  local_atual_tipo text,
  local_atual_id   uuid,

  ano_fabricacao   integer,
  data_aquisicao   date,
  valor_aquisicao  numeric(15,4),
  nota_fiscal      text,
  vida_util_meses  integer,
  metodo_depreciacao text,
  valor_residual   numeric(15,4),
  depreciacao_acumulada numeric(15,4) not null default 0,

  equipamento_pai_id uuid references public.equipamento(id) on delete restrict,
  qr_token      text not null default replace(gen_random_uuid()::text, '-', ''),

  campos_personalizados jsonb not null default '{}'::jsonb,
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  deleted_by    uuid,
  delete_reason text,

  -- RN-010: todo estado não disponível exige motivo tipificado
  constraint equipamento_motivo_obrigatorio check (
    status in ('DISPONIVEL', 'LOCADO', 'RESERVADO') or motivo_indisponibilidade is not null
  ),
  -- Bloqueio sempre com justificativa (RN-014)
  constraint equipamento_bloqueio_com_motivo check (
    bloqueado = false or bloqueio_motivo is not null
  ),
  constraint equipamento_valores_nao_negativos check (
    coalesce(valor_aquisicao, 0) >= 0 and coalesce(valor_residual, 0) >= 0
    and depreciacao_acumulada >= 0
  ),
  constraint equipamento_nao_e_pai_de_si check (equipamento_pai_id is distinct from id)
);

-- RN-002: patrimônio único por tenant; série única por modelo.
create unique index if not exists equipamento_patrimonio_uk
  on public.equipamento (tenant_id, patrimonio) where deleted_at is null;
create unique index if not exists equipamento_serie_uk
  on public.equipamento (tenant_id, modelo_id, numero_serie)
  where numero_serie is not null and deleted_at is null;
create unique index if not exists equipamento_qr_uk on public.equipamento (qr_token);

-- Índice que atende a consulta de disponibilidade em tempo real (A.11)
create index if not exists equipamento_disponibilidade_ix
  on public.equipamento (tenant_id, status, categoria_id, filial_id)
  where deleted_at is null;

-- -----------------------------------------------------------------------------
-- medidor e leituras
-- -----------------------------------------------------------------------------
create table if not exists public.medidor (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete restrict,
  equipamento_id uuid not null references public.equipamento(id) on delete restrict,
  tipo           app.medidor_tipo not null,
  unidade        text not null,
  valor_inicial  numeric(14,2) not null default 0,
  valor_atual    numeric(14,2) not null default 0,
  acumulado_total numeric(14,2) not null default 0,
  ativo          boolean not null default true,
  substituido_em timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint medidor_valores_nao_negativos check (
    valor_inicial >= 0 and valor_atual >= 0 and acumulado_total >= 0
  )
);

-- Um único medidor ativo por tipo em cada equipamento.
create unique index if not exists medidor_ativo_uk
  on public.medidor (tenant_id, equipamento_id, tipo) where ativo;

create table if not exists public.leitura_medidor (
  id             uuid not null default gen_random_uuid(),
  data_leitura   timestamptz not null default now(),
  tenant_id      uuid not null,
  medidor_id     uuid not null,
  equipamento_id uuid not null,
  valor          numeric(14,2) not null,
  origem         text not null default 'MANUAL',
  contrato_item_id uuid,
  registrado_por uuid,
  foto_anexo_id  uuid,
  status         text not null default 'VALIDA',
  estorno_de_id  uuid,
  motivo_estorno text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  primary key (id, data_leitura),
  constraint leitura_valor_nao_negativo check (valor >= 0),
  constraint leitura_origem_valida check (origem in ('MANUAL','CAMPO','IMPORTACAO','TELEMETRIA','API')),
  constraint leitura_status_valido check (status in ('VALIDA','REVISADA','ESTORNADA')),
  constraint leitura_estorno_com_motivo check (status <> 'ESTORNADA' or motivo_estorno is not null)
) partition by range (data_leitura);

select app.garantir_particoes('leitura_medidor', 3);

create index if not exists leitura_equipamento_ix
  on public.leitura_medidor (tenant_id, equipamento_id, data_leitura desc);

-- RN-020: leitura monotônica não decrescente por medidor.
-- Imposta por gatilho porque depende do histórico, não da linha isolada.
create or replace function app.validar_leitura_monotonica()
returns trigger
language plpgsql
as $$
declare
  v_ultimo numeric(14,2);
begin
  if new.status = 'ESTORNADA' then
    return new;
  end if;

  select l.valor into v_ultimo
  from public.leitura_medidor l
  where l.medidor_id = new.medidor_id
    and l.status = 'VALIDA'
    and l.data_leitura <= new.data_leitura
    and (l.id, l.data_leitura) is distinct from (new.id, new.data_leitura)
  order by l.data_leitura desc
  limit 1;

  if v_ultimo is not null and new.valor < v_ultimo then
    raise exception
      'leitura % é menor que a última leitura válida (%) do medidor %',
      new.valor, v_ultimo, new.medidor_id
      using errcode = '23514',
            hint = 'Registre troca de medidor ou estorne a leitura anterior com justificativa (RN-020, F-EQP-22/23).';
  end if;

  return new;
end;
$$;

drop trigger if exists leitura_monotonica on public.leitura_medidor;
create trigger leitura_monotonica
  before insert or update on public.leitura_medidor
  for each row execute function app.validar_leitura_monotonica();

do $$
declare t text;
begin
  foreach t in array array['fabricante','categoria_equipamento','modelo','equipamento','medidor'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
    perform app.habilitar_auditoria(t);
  end loop;
end $$;
