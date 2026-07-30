-- =============================================================================
-- 0001 — Fundação: extensões, schema utilitário e contexto de execução
--
-- Referências: docs/07-arquitetura-funcional.md · docs/anexos/H-supabase.md (H.5)
-- Invariantes suportadas: RN-028 (isolamento por tenant), RN-001 (via btree_gist)
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid, digest (auditoria)
create extension if not exists btree_gist;  -- INDISPENSÁVEL para o EXCLUDE de RN-001

-- PostGIS é necessário para o módulo MAP (docs/05 §5.3).
-- Fica em migração própria (0008) para permitir validação local sem PostGIS.

create schema if not exists app;
comment on schema app is
  'Funções utilitárias da plataforma: contexto de execução, auditoria, políticas. Não contém tabelas de negócio.';

-- -----------------------------------------------------------------------------
-- Contexto de execução
--
-- Duas origens possíveis de identidade, conforme H.5.1:
--   1. API de domínio (papel iarx_app) -> SET LOCAL app.tenant_id
--   2. Cliente via PostgREST/Realtime  -> claims do JWT
--
-- Deliberadamente lemos o JWT por current_setting('request.jwt.claims') em vez
-- de auth.jwt(): o resultado é idêntico no Supabase e o schema fica portável
-- para qualquer PostgreSQL (ver H.9), além de permitir teste local.
--
-- CUIDADO CRÍTICO: a API deve usar SET LOCAL (escopo de transação), nunca SET
-- de sessão. Com pooler em modo transação, um SET de sessão vazaria o tenant
-- para a requisição seguinte de outro usuário na mesma conexão.
-- -----------------------------------------------------------------------------

create or replace function app.jwt_claims()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function app.tenant_atual()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.tenant_id', true), '')::uuid,
    nullif(app.jwt_claims() ->> 'tenant_id', '')::uuid
  );
$$;
comment on function app.tenant_atual() is
  'Tenant efetivo da transação. SET LOCAL tem precedência sobre o JWT para permitir jobs assíncronos (fechamento, réguas) que operam sem usuário logado.';

create or replace function app.usuario_atual()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.usuario_id', true), '')::uuid,
    nullif(app.jwt_claims() ->> 'usuario_id', '')::uuid
  );
$$;

create or replace function app.request_id_atual()
returns text
language sql
stable
as $$
  select nullif(current_setting('app.request_id', true), '');
$$;

create or replace function app.origem_atual()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('app.origem', true), ''), 'DESCONHECIDA');
$$;

-- Exigir tenant explicitamente, para uso em funções de escrita sensíveis.
create or replace function app.exigir_tenant()
returns uuid
language plpgsql
stable
as $$
declare
  t uuid := app.tenant_atual();
begin
  if t is null then
    raise exception 'contexto de tenant ausente'
      using errcode = '42501',
            hint = 'A API deve executar SET LOCAL app.tenant_id dentro da transação (ver H.5.2).';
  end if;
  return t;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tipos de domínio compartilhados
-- -----------------------------------------------------------------------------

do $$ begin
  create type app.escopo_tipo as enum ('TENANT', 'EMPRESA', 'FILIAL', 'REGIAO', 'PROPRIO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.status_registro as enum ('ATIVO', 'INATIVO', 'SUSPENSO');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Colunas de auditoria de linha (aplicadas por convenção em toda tabela)
-- -----------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(app.usuario_atual(), new.updated_by);
  return new;
end;
$$;
