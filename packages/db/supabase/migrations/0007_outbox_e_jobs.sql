-- =============================================================================
-- 0007 — Transactional outbox e agendamento
--
-- Referências: docs/07-arquitetura-funcional.md (7.3.3) · docs/04 §4.3
-- Garantia: um evento de domínio nunca é publicado se a transação que o
-- originou foi revertida, e nunca é perdido se a transação foi confirmada —
-- porque é gravado na MESMA transação da mudança de estado.
-- =============================================================================

create table if not exists public.outbox_evento (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete restrict,
  agregado_tipo  text not null,
  agregado_id    uuid not null,
  tipo_evento    text not null,
  versao_schema  text not null default '1.0',
  payload        jsonb not null,
  criado_em      timestamptz not null default now(),
  publicado_em   timestamptz,
  tentativas     integer not null default 0,
  proxima_tentativa_em timestamptz,
  ultimo_erro    text,
  constraint outbox_tentativas_nao_negativas check (tentativas >= 0)
);

-- O publicador varre apenas o que falta publicar: índice parcial mantém a
-- varredura constante mesmo com milhões de eventos já publicados.
create index if not exists outbox_pendentes_ix
  on public.outbox_evento (criado_em)
  where publicado_em is null;

create index if not exists outbox_agregado_ix
  on public.outbox_evento (tenant_id, agregado_tipo, agregado_id, criado_em desc);


-- Helper para publicar evento dentro da transação de negócio.
create or replace function app.publicar_evento(
  p_agregado_tipo text,
  p_agregado_id   uuid,
  p_tipo_evento   text,
  p_payload       jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.outbox_evento (tenant_id, agregado_tipo, agregado_id, tipo_evento, payload)
  values (app.exigir_tenant(), p_agregado_tipo, p_agregado_id, p_tipo_evento, p_payload)
  returning id into v_id;
  return v_id;
end;
$$;

select app.habilitar_rls_tenant('outbox_evento', false);

-- -----------------------------------------------------------------------------
-- job_execucao — rastro de processamento assíncrono (fechamento, exportações,
-- importações, geração de preventivas)
-- -----------------------------------------------------------------------------
create table if not exists public.job_execucao (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete restrict,
  tipo         text not null,
  parametros   jsonb not null default '{}'::jsonb,
  status       text not null default 'PENDENTE',
  inicio       timestamptz,
  fim          timestamptz,
  resultado    jsonb,
  erro         text,
  solicitado_por uuid references public.usuario(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint job_status_valido check (status in ('PENDENTE','EXECUTANDO','CONCLUIDO','FALHOU','CANCELADO'))
);

create index if not exists job_execucao_status_ix
  on public.job_execucao (tenant_id, status, created_at desc);

select app.habilitar_rls_tenant('job_execucao', false);

-- -----------------------------------------------------------------------------
-- Rotinas agendadas
--
-- Usamos pg_cron para o que é manutenção do próprio banco: criação de
-- partições e selagem da auditoria. O trabalho pesado de negócio (fechamento,
-- exportação, PDFs) fica na fila da aplicação, onde há retentativa, prioridade
-- e observabilidade — ver H.6.2.
--
-- A extensão é habilitada condicionalmente para que a migração rode também em
-- PostgreSQL sem pg_cron (CI local).
-- -----------------------------------------------------------------------------
do $$
declare
  tem_pgcron boolean;
begin
  select exists (select 1 from pg_available_extensions where name = 'pg_cron') into tem_pgcron;

  if not tem_pgcron then
    raise notice 'pg_cron indisponível neste servidor: agendamentos não registrados. '
                 'No Supabase, habilitar a extensão e reaplicar esta migração.';
    return;
  end if;

  create extension if not exists pg_cron;

  -- Partições dos próximos meses, todo dia 25 às 03:00 UTC
  perform cron.schedule(
    'iarx-particoes',
    '0 3 25 * *',
    $cmd$
      select app.garantir_particoes('audit_log', 3);
      select app.garantir_particoes('leitura_medidor', 3);
    $cmd$
  );

  -- Selagem da cadeia de auditoria, de hora em hora
  perform cron.schedule('iarx-selar-auditoria', '7 * * * *', $cmd$ select app.selar_auditoria(20000); $cmd$);

exception when others then
  raise notice 'não foi possível registrar agendamentos pg_cron: %', sqlerrm;
end $$;
