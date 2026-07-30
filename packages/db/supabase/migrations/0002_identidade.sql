-- =============================================================================
-- 0002 — Identidade e estrutura organizacional
--
-- Referências: docs/anexos/A-modelo-de-dados.md (A.3) · C-matriz-de-permissoes.md
-- Invariantes: RN-026 (permissão x escopo), RN-028 (tenant_id em toda tabela)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- tenant — raiz do isolamento. É a única tabela sem coluna tenant_id,
-- porque ela própria É o tenant.
-- -----------------------------------------------------------------------------
create table if not exists public.tenant (
  id           uuid primary key default gen_random_uuid(),
  nome         text        not null,
  documento    text,
  plano        text        not null default 'STANDARD',
  timezone     text        not null default 'America/Sao_Paulo',
  moeda        char(3)     not null default 'BRL',
  status       app.status_registro not null default 'ATIVO',
  configuracoes jsonb      not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  deleted_by   uuid,
  delete_reason text,
  constraint tenant_nome_nao_vazio check (length(btrim(nome)) > 0)
);

-- -----------------------------------------------------------------------------
-- empresa / filial
-- -----------------------------------------------------------------------------
create table if not exists public.empresa (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  razao_social  text not null,
  nome_fantasia text,
  cnpj          text,
  inscricao_estadual text,
  inscricao_municipal text,
  endereco      jsonb not null default '{}'::jsonb,
  status        app.status_registro not null default 'ATIVO',
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  deleted_by    uuid,
  delete_reason text
);

-- Unicidade sempre por tenant, e ignorando registros inativados (RN-019).
create unique index if not exists empresa_cnpj_uk
  on public.empresa (tenant_id, cnpj)
  where deleted_at is null and cnpj is not null;

create table if not exists public.filial (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete restrict,
  empresa_id uuid not null references public.empresa(id) on delete restrict,
  codigo     text not null,
  nome       text not null,
  regiao     text,
  endereco   jsonb not null default '{}'::jsonb,
  status     app.status_registro not null default 'ATIVO',
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text
);

create unique index if not exists filial_codigo_uk
  on public.filial (tenant_id, codigo)
  where deleted_at is null;

create index if not exists filial_empresa_ix on public.filial (tenant_id, empresa_id);

-- Coerência: a filial pertence à mesma empresa do mesmo tenant.
create or replace function app.validar_filial_empresa()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.empresa e
    where e.id = new.empresa_id and e.tenant_id = new.tenant_id
  ) then
    raise exception 'empresa % não pertence ao tenant %', new.empresa_id, new.tenant_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists filial_valida_empresa on public.filial;
create trigger filial_valida_empresa
  before insert or update of empresa_id, tenant_id on public.filial
  for each row execute function app.validar_filial_empresa();

-- -----------------------------------------------------------------------------
-- usuario
--
-- subject_oidc é o vínculo com o provedor de identidade (Supabase Auth).
-- Deliberadamente NÃO há foreign key para auth.users: mantém o núcleo de dados
-- portável para outro provedor OIDC (ver H.9).
-- -----------------------------------------------------------------------------
create table if not exists public.usuario (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  subject_oidc  uuid,
  nome          text not null,
  email         text not null,
  telefone      text,
  status        app.status_registro not null default 'ATIVO',
  mfa_habilitado boolean not null default false,
  ultimo_acesso_em timestamptz,
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  deleted_by    uuid,
  delete_reason text,
  constraint usuario_email_formato check (email like '%_@_%')
);

create unique index if not exists usuario_email_uk
  on public.usuario (tenant_id, lower(email))
  where deleted_at is null;

-- O subject do provedor é global, não por tenant: o mesmo login não pode
-- apontar para dois usuários.
create unique index if not exists usuario_subject_uk
  on public.usuario (subject_oidc)
  where subject_oidc is not null and deleted_at is null;

-- -----------------------------------------------------------------------------
-- perfil / permissões
-- -----------------------------------------------------------------------------
create table if not exists public.perfil (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete restrict,
  nome        text not null,
  descricao   text,
  is_sistema  boolean not null default false,
  permissoes  text[] not null default '{}',
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid,
  delete_reason text
);

create unique index if not exists perfil_nome_uk
  on public.perfil (tenant_id, nome)
  where deleted_at is null;

-- Toda permissão segue o formato recurso:acao (RN-026).
-- CHECK não aceita subconsulta, então a validação de cada elemento do array
-- é feita por gatilho.
create or replace function app.validar_permissoes()
returns trigger
language plpgsql
as $$
declare
  p text;
begin
  foreach p in array new.permissoes loop
    if p !~ '^[a-z_]+:[a-z_]+$' then
      raise exception 'permissão inválida: %', p
        using errcode = '23514',
              hint = 'Formato esperado recurso:acao, em minúsculas (ver Anexo C.2).';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists perfil_valida_permissoes on public.perfil;
create trigger perfil_valida_permissoes
  before insert or update of permissoes on public.perfil
  for each row execute function app.validar_permissoes();

create table if not exists public.usuario_perfil (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete restrict,
  usuario_id  uuid not null references public.usuario(id) on delete cascade,
  perfil_id   uuid not null references public.perfil(id) on delete restrict,
  escopo_tipo app.escopo_tipo not null,
  escopo_id   uuid,
  created_at  timestamptz not null default now(),
  created_by  uuid
);

-- Chave natural: PRIMARY KEY não aceita expressão, então a unicidade que
-- considera escopo_id nulo é imposta por índice único sobre expressão.
create unique index if not exists usuario_perfil_uk
  on public.usuario_perfil (
    usuario_id,
    perfil_id,
    escopo_tipo,
    coalesce(escopo_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Escopo TENANT e PROPRIO não levam id; os demais exigem.
alter table public.usuario_perfil drop constraint if exists usuario_perfil_escopo_coerente;
alter table public.usuario_perfil add constraint usuario_perfil_escopo_coerente check (
  (escopo_tipo in ('TENANT', 'PROPRIO') and escopo_id is null)
  or (escopo_tipo in ('EMPRESA', 'FILIAL', 'REGIAO') and escopo_id is not null)
);

create index if not exists usuario_perfil_usuario_ix on public.usuario_perfil (tenant_id, usuario_id);

-- -----------------------------------------------------------------------------
-- alcada — limites por valor, avaliados pelo motor de regras (Anexo C.5)
-- -----------------------------------------------------------------------------
create table if not exists public.alcada (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete restrict,
  perfil_id  uuid not null references public.perfil(id) on delete cascade,
  tipo       text not null,
  limite_valor      numeric(15,4),
  limite_percentual numeric(5,2),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint alcada_tipo_valido check (tipo in (
    'DESCONTO', 'EMISSAO_FATURA', 'CANCELAMENTO_FATURA', 'REABERTURA_COMPETENCIA',
    'CUSTO_OS', 'AJUSTE_INVENTARIO', 'LIBERACAO_BLOQUEIO', 'LIBERACAO_CLIENTE',
    'APROVACAO_PAGAMENTO', 'ORDEM_COMPRA'
  )),
  constraint alcada_tem_limite check (limite_valor is not null or limite_percentual is not null),
  constraint alcada_percentual_faixa check (limite_percentual is null or (limite_percentual >= 0 and limite_percentual <= 100))
);

create unique index if not exists alcada_perfil_tipo_uk on public.alcada (tenant_id, perfil_id, tipo);

-- -----------------------------------------------------------------------------
-- Gatilhos de updated_at
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tenant','empresa','filial','usuario','perfil','alcada'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format(
      'create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()',
      t, t
    );
  end loop;
end $$;
