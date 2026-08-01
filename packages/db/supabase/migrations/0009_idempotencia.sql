-- =============================================================================
-- 0009 — Idempotência de requisições
--
-- Referências: docs/anexos/D-catalogo-de-apis.md (D.1) · RN-029
--
-- Por que isto existe no banco e não em cache:
--
--  O cliente que recebe timeout não sabe se a alocação foi criada. Ele reenvia.
--  Sem registro durável, o reenvio cria um segundo item — e no caso de POST de
--  efeito financeiro, uma segunda cobrança. Um cache em memória não serve:
--  perde-se no restart e não é compartilhado entre instâncias da API, que é
--  exatamente quando o reenvio acontece.
--
--  O registro guarda o hash do payload junto com a chave. Mesma chave com
--  payload diferente é erro do cliente, não repetição — e precisa ser recusada
--  em vez de devolver silenciosamente a resposta da primeira chamada.
-- =============================================================================

do $$ begin
  create type app.idempotencia_status as enum ('EM_ANDAMENTO', 'CONCLUIDA');
exception when duplicate_object then null; end $$;

create table if not exists public.requisicao_idempotente (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  chave         text not null,
  metodo        text not null,
  rota          text not null,
  -- SHA-256 do corpo canonicalizado. Detecta reenvio com payload alterado.
  hash_payload  text not null,
  status        app.idempotencia_status not null default 'EM_ANDAMENTO',
  status_http   integer,
  resposta      jsonb,
  usuario_id    uuid,
  request_id    text,
  created_at    timestamptz not null default now(),
  concluida_em  timestamptz,
  -- Janela de retenção: além dela, a chave pode ser reusada. 24 h cobre com
  -- folga qualquer política de retentativa razoável de cliente.
  expira_em     timestamptz not null default now() + interval '24 hours',

  constraint ri_hash_formato check (hash_payload ~ '^[0-9a-f]{64}$'),
  constraint ri_concluida_tem_resposta check (
    status <> 'CONCLUIDA' or (status_http is not null and resposta is not null)
  )
);

-- A chave é única por tenant. Escopo mais estreito (por usuário) permitiria a
-- dois usuários do mesmo tenant colidirem intencionalmente; mais largo (global)
-- vazaria a existência de chaves entre tenants.
create unique index if not exists ri_chave_uq
  on public.requisicao_idempotente (tenant_id, chave);

create index if not exists ri_expiracao_ix
  on public.requisicao_idempotente (expira_em);

comment on table public.requisicao_idempotente is
  'RN-029: torna POST de efeito financeiro/operacional seguro para retentativa. A unicidade de (tenant_id, chave) é o que serializa duas chamadas concorrentes com a mesma chave.';

select app.habilitar_rls_tenant('requisicao_idempotente', false);

-- Limpeza. Chamada por job agendado; escrita como função para que a política de
-- retenção viva junto do schema e não em um cron opaco.
create or replace function app.limpar_idempotencia_expirada()
returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare
  removidas integer;
begin
  delete from public.requisicao_idempotente where expira_em < now();
  get diagnostics removidas = row_count;
  return removidas;
end;
$$;

revoke all on function app.limpar_idempotencia_expirada() from public;
grant execute on function app.limpar_idempotencia_expirada() to iarx_app;
