-- =============================================================================
-- 0006 — Papéis e Row-Level Security
--
-- Referências: docs/anexos/H-supabase.md (H.2, H.5) · docs/11-seguranca-e-escalabilidade.md
-- Invariantes: RN-028 (isolamento imposto no dado), RN-018 (auditoria imutável)
--
-- Regras estruturais desta migração:
--
--  1. A API roda como `iarx_app`, papel SUJEITO a RLS. O `service_role` do
--     Supabase (que ignora RLS) fica restrito a migrações — usá-lo no runtime
--     anularia RN-028 silenciosamente.
--
--  2. `authenticated` (cliente via PostgREST) recebe SELECT apenas onde a
--     leitura direta é deliberada. NENHUMA permissão de escrita: as invariantes
--     de domínio (RN-001, motor de faturamento, máquinas de estado, alçadas)
--     não são expressáveis como política de linha — ver H.2.
--
--  3. `audit_log` não concede UPDATE nem DELETE a nenhum papel de aplicação.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Papéis
--
-- No Supabase, `anon`, `authenticated` e `service_role` já existem. Criamos
-- condicionalmente para que a mesma migração rode em PostgreSQL puro (CI local).
-- -----------------------------------------------------------------------------
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'iarx_app'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
  end loop;
end $$;

grant usage on schema public to anon, authenticated, iarx_app;
grant usage on schema app to authenticated, iarx_app;

-- Funções de contexto precisam ser executáveis pelos papéis de runtime.
grant execute on function app.jwt_claims(), app.tenant_atual(), app.usuario_atual(),
                          app.request_id_atual(), app.origem_atual(), app.exigir_tenant()
  to anon, authenticated, iarx_app;

-- -----------------------------------------------------------------------------
-- Helper: habilita RLS e aplica a política padrão de isolamento por tenant
-- -----------------------------------------------------------------------------
create or replace function app.habilitar_rls_tenant(
  p_tabela           text,
  p_leitura_cliente  boolean default false
)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', p_tabela);
  -- FORCE garante que nem o dono da tabela escape da política em rotinas
  -- administrativas executadas por engano.
  execute format('alter table public.%I force row level security', p_tabela);

  -- API de domínio: leitura e escrita, sempre restritas ao tenant da transação.
  execute format('drop policy if exists %I_app on public.%I', p_tabela, p_tabela);
  execute format(
    'create policy %I_app on public.%I for all to iarx_app
       using (tenant_id = app.tenant_atual())
       with check (tenant_id = app.tenant_atual())',
    p_tabela, p_tabela
  );

  -- Cliente via PostgREST: SELECT apenas, e somente onde for deliberado.
  execute format('drop policy if exists %I_leitura_cliente on public.%I', p_tabela, p_tabela);
  if p_leitura_cliente then
    execute format(
      'create policy %I_leitura_cliente on public.%I for select to authenticated
         using (tenant_id = app.tenant_atual())',
      p_tabela, p_tabela
    );
  end if;

  -- Privilégios: escrita nunca vai para authenticated/anon (H.2, regra 1).
  execute format('grant select, insert, update, delete on public.%I to iarx_app', p_tabela);
  execute format('revoke all on public.%I from anon', p_tabela);
  if p_leitura_cliente then
    execute format('grant select on public.%I to authenticated', p_tabela);
  else
    execute format('revoke all on public.%I from authenticated', p_tabela);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Aplicação por tabela
--
-- p_leitura_cliente = true apenas em dados de catálogo e operacionais de baixo
-- risco. Dados financeiros e de rentabilidade passam obrigatoriamente pela API,
-- porque dependem de escopo organizacional e mascaramento (Anexo C).
-- -----------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('empresa',                false),
      ('filial',                 true),
      ('usuario',                false),
      ('perfil',                 false),
      ('usuario_perfil',         false),
      ('alcada',                 false),
      ('fabricante',             true),
      ('categoria_equipamento',  true),
      ('modelo',                 true),
      ('equipamento',            true),
      ('medidor',                true),
      ('leitura_medidor',        false),
      ('cliente',                false),
      ('local_operacao',         false),
      ('contrato',               false),
      ('contrato_item',          false)
    ) as v(tabela, leitura_cliente)
  loop
    perform app.habilitar_rls_tenant(t.tabela, t.leitura_cliente);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- tenant: a própria raiz. Um usuário só vê o seu tenant.
-- -----------------------------------------------------------------------------
alter table public.tenant enable row level security;
alter table public.tenant force row level security;

drop policy if exists tenant_app on public.tenant;
create policy tenant_app on public.tenant for all to iarx_app
  using (id = app.tenant_atual())
  with check (id = app.tenant_atual());

drop policy if exists tenant_leitura_cliente on public.tenant;
create policy tenant_leitura_cliente on public.tenant for select to authenticated
  using (id = app.tenant_atual());

grant select, insert, update on public.tenant to iarx_app;
grant select on public.tenant to authenticated;
revoke all on public.tenant from anon;

-- -----------------------------------------------------------------------------
-- audit_log — RN-018: append-only, imutável
--
-- iarx_app pode INSERIR (a aplicação registra motivo de negócio) e LER a
-- trilha do próprio tenant. UPDATE e DELETE não são concedidos a NENHUM papel
-- de aplicação, nem mesmo ao administrador da plataforma.
-- -----------------------------------------------------------------------------
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert to iarx_app
  with check (tenant_id = app.tenant_atual());

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to iarx_app
  using (tenant_id = app.tenant_atual());

revoke all on public.audit_log from anon, authenticated, iarx_app;
grant select, insert on public.audit_log to iarx_app;

-- Nenhuma política de UPDATE/DELETE é criada: com RLS habilitada, a ausência
-- de política já nega a operação. O REVOKE acima é a segunda barreira.

comment on table public.audit_log is
  'Trilha imutável (RN-018). Sem política de UPDATE/DELETE e sem privilégio correspondente: a imutabilidade é imposta pelo banco, não por convenção.';

-- -----------------------------------------------------------------------------
-- Sequências e privilégios padrão
-- -----------------------------------------------------------------------------
grant usage, select on all sequences in schema public to iarx_app;

-- Novas tabelas não recebem privilégio automaticamente: cada migração deve
-- chamar app.habilitar_rls_tenant() explicitamente. A ausência de DEFAULT
-- PRIVILEGES aqui é deliberada — evita que uma tabela nova fique acessível por
-- esquecimento.
