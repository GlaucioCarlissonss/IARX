-- =============================================================================
-- 0003 — Auditoria append-only
--
-- Referências: docs/07-arquitetura-funcional.md (7.9) · docs/06-regras-de-negocio.md
-- Invariantes: RN-018 (histórico auditável), RN-019 (exclusão lógica rastreável)
--
-- Decisões:
--  · Particionada por mês: permite expurgo/arquivamento por DROP PARTITION.
--  · Gatilho genérico no banco como rede de segurança. A camada de aplicação
--    grava o motivo de negócio; o gatilho garante que nada escape, mesmo em
--    correção manual via SQL.
--  · Encadeamento de hash é SELADO EM LOTE por job, não em linha. Selar em
--    linha exigiria serializar todas as escritas do tenant (lock no último
--    registro), o que criaria contenção no fechamento de faturamento. O
--    encadeamento periódico preserva a capacidade de detectar manipulação
--    sem penalizar a escrita.
-- =============================================================================

create table if not exists public.audit_log (
  id             uuid        not null default gen_random_uuid(),
  criado_em      timestamptz not null default now(),
  tenant_id      uuid        not null,
  entidade_tipo  text        not null,
  entidade_id    uuid,
  acao           text        not null,
  campo          text,
  valor_anterior jsonb,
  valor_novo     jsonb,
  usuario_id     uuid,
  perfil_efetivo text,
  motivo         text,
  request_id     text,
  ip             inet,
  user_agent     text,
  origem         text        not null default 'DESCONHECIDA',
  seq            bigint,          -- atribuído na selagem, ordena a cadeia
  hash_anterior  text,
  hash_registro  text,
  primary key (id, criado_em),
  constraint audit_acao_valida check (acao in (
    'INSERIR', 'ATUALIZAR', 'EXCLUIR_LOGICO', 'RESTAURAR',
    'TRANSICAO_ESTADO', 'ACESSO_SENSIVEL', 'EXPORTACAO', 'LOGIN', 'LOGIN_FALHA',
    'PERMISSAO_ALTERADA', 'PARAMETRO_ALTERADO', 'ACESSO_SUPORTE'
  ))
) partition by range (criado_em);

comment on table public.audit_log is
  'Trilha imutável (RN-018). Nenhum papel de aplicação recebe UPDATE ou DELETE — ver 0006_rls.sql.';

create index if not exists audit_log_entidade_ix
  on public.audit_log (tenant_id, entidade_tipo, entidade_id, criado_em desc);
create index if not exists audit_log_usuario_ix
  on public.audit_log (tenant_id, usuario_id, criado_em desc);
create index if not exists audit_log_request_ix
  on public.audit_log (request_id)
  where request_id is not null;

-- -----------------------------------------------------------------------------
-- Gestão de partições mensais
-- -----------------------------------------------------------------------------
create or replace function app.criar_particao_mes(p_tabela text, p_mes date)
returns text
language plpgsql
as $$
declare
  inicio date := date_trunc('month', p_mes)::date;
  fim    date := (date_trunc('month', p_mes) + interval '1 month')::date;
  nome   text := format('%s_%s', p_tabela, to_char(inicio, 'YYYYMM'));
begin
  if not exists (select 1 from pg_class where relname = nome) then
    execute format(
      'create table public.%I partition of public.%I for values from (%L) to (%L)',
      nome, p_tabela, inicio, fim
    );
  end if;
  return nome;
end;
$$;

-- Garante a partição do mês corrente e dos próximos N meses.
create or replace function app.garantir_particoes(p_tabela text, p_meses_a_frente integer default 3)
returns integer
language plpgsql
as $$
declare
  i integer;
  criadas integer := 0;
begin
  for i in -1 .. p_meses_a_frente loop
    perform app.criar_particao_mes(p_tabela, (date_trunc('month', now()) + (i || ' month')::interval)::date);
    criadas := criadas + 1;
  end loop;
  return criadas;
end;
$$;

select app.garantir_particoes('audit_log', 3);

-- -----------------------------------------------------------------------------
-- Gatilho genérico de auditoria
-- -----------------------------------------------------------------------------
create or replace function app.auditar()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant   uuid;
  v_acao     text;
  v_ant      jsonb;
  v_novo     jsonb;
  v_id       uuid;
  v_chaves   text[];
  k          text;
begin
  if tg_op = 'INSERT' then
    v_acao := 'INSERIR';
    v_novo := to_jsonb(new);
    v_ant  := null;
  elsif tg_op = 'UPDATE' then
    -- Exclusão lógica é registrada com ação própria (RN-019).
    if new.deleted_at is not null and old.deleted_at is null then
      v_acao := 'EXCLUIR_LOGICO';
    elsif new.deleted_at is null and old.deleted_at is not null then
      v_acao := 'RESTAURAR';
    else
      v_acao := 'ATUALIZAR';
    end if;

    -- Registra apenas os campos que mudaram, para manter o log legível.
    v_ant  := '{}'::jsonb;
    v_novo := '{}'::jsonb;
    select array_agg(key) into v_chaves
    from jsonb_each(to_jsonb(new))
    where to_jsonb(new) -> key is distinct from to_jsonb(old) -> key;

    if v_chaves is null then
      return new;  -- update sem mudança efetiva: não gera ruído no log
    end if;

    foreach k in array v_chaves loop
      if k not in ('updated_at', 'updated_by', 'version') then
        v_ant  := v_ant  || jsonb_build_object(k, to_jsonb(old) -> k);
        v_novo := v_novo || jsonb_build_object(k, to_jsonb(new) -> k);
      end if;
    end loop;

    if v_novo = '{}'::jsonb then
      return new;  -- só metadados de linha mudaram
    end if;
  else -- DELETE
    v_acao := 'EXCLUIR_LOGICO';
    v_ant  := to_jsonb(old);
    v_novo := null;
  end if;

  if tg_op = 'DELETE' then
    v_tenant := (to_jsonb(old) ->> 'tenant_id')::uuid;
    v_id     := (to_jsonb(old) ->> 'id')::uuid;
  else
    v_tenant := (to_jsonb(new) ->> 'tenant_id')::uuid;
    v_id     := (to_jsonb(new) ->> 'id')::uuid;
  end if;

  -- A tabela tenant não possui coluna tenant_id: ela própria é o tenant.
  if v_tenant is null then
    v_tenant := v_id;
  end if;

  insert into public.audit_log (
    tenant_id, entidade_tipo, entidade_id, acao,
    valor_anterior, valor_novo,
    usuario_id, motivo, request_id, origem
  ) values (
    v_tenant, tg_table_name, v_id, v_acao,
    v_ant, v_novo,
    app.usuario_atual(),
    nullif(current_setting('app.motivo', true), ''),
    app.request_id_atual(),
    app.origem_atual()
  );

  return coalesce(new, old);
end;
$$;

comment on function app.auditar() is
  'Gatilho genérico de auditoria. Registra apenas campos alterados em UPDATE e ignora mudanças que afetem só metadados de linha.';

-- Aplica auditoria a uma tabela.
create or replace function app.habilitar_auditoria(p_tabela text)
returns void
language plpgsql
as $$
begin
  execute format('drop trigger if exists %I_audit on public.%I', p_tabela, p_tabela);
  execute format(
    'create trigger %I_audit after insert or update or delete on public.%I
       for each row execute function app.auditar()',
    p_tabela, p_tabela
  );
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['tenant','empresa','filial','usuario','perfil','alcada'] loop
    perform app.habilitar_auditoria(t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Selagem por encadeamento de hash
--
-- Executada por pg_cron (ver 0007). Sela em ordem cronológica por tenant.
-- Detecta manipulação posterior: alterar qualquer registro já selado quebra a
-- cadeia a partir dele.
-- -----------------------------------------------------------------------------
create or replace function app.selar_auditoria(p_limite integer default 10000)
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  r            record;
  v_seq        bigint;
  v_hash_ant   text;
  v_tenant     uuid := null;
  v_seladas    integer := 0;
begin
  for r in
    select id, criado_em, tenant_id, entidade_tipo, entidade_id, acao,
           valor_anterior, valor_novo, usuario_id, motivo, request_id, origem
    from public.audit_log
    where hash_registro is null
    order by tenant_id, criado_em, id
    limit p_limite
  loop
    if v_tenant is distinct from r.tenant_id then
      v_tenant := r.tenant_id;
      select seq, hash_registro into v_seq, v_hash_ant
      from public.audit_log
      where tenant_id = v_tenant and hash_registro is not null
      order by seq desc
      limit 1;
      v_seq := coalesce(v_seq, 0);
      v_hash_ant := coalesce(v_hash_ant, '');
    end if;

    v_seq := v_seq + 1;

    update public.audit_log
       set seq = v_seq,
           hash_anterior = v_hash_ant,
           hash_registro = encode(
             digest(
               v_hash_ant
               || r.id::text || r.criado_em::text || r.tenant_id::text
               || r.entidade_tipo || coalesce(r.entidade_id::text, '') || r.acao
               || coalesce(r.valor_anterior::text, '') || coalesce(r.valor_novo::text, '')
               || coalesce(r.usuario_id::text, '') || coalesce(r.motivo, '')
               || coalesce(r.request_id, '') || r.origem,
               'sha256'
             ),
             'hex'
           )
     where id = r.id and criado_em = r.criado_em;

    select hash_registro into v_hash_ant
    from public.audit_log where id = r.id and criado_em = r.criado_em;

    v_seladas := v_seladas + 1;
  end loop;

  return v_seladas;
end;
$$;

-- Verificação de integridade da cadeia de um tenant.
create or replace function app.verificar_cadeia_auditoria(p_tenant uuid)
returns table (seq bigint, id uuid, criado_em timestamptz, situacao text)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  r          record;
  v_esperado text := '';
  v_calc     text;
begin
  for r in
    select a.* from public.audit_log a
    where a.tenant_id = p_tenant and a.hash_registro is not null
    order by a.seq
  loop
    v_calc := encode(
      digest(
        v_esperado
        || r.id::text || r.criado_em::text || r.tenant_id::text
        || r.entidade_tipo || coalesce(r.entidade_id::text, '') || r.acao
        || coalesce(r.valor_anterior::text, '') || coalesce(r.valor_novo::text, '')
        || coalesce(r.usuario_id::text, '') || coalesce(r.motivo, '')
        || coalesce(r.request_id, '') || r.origem,
        'sha256'
      ),
      'hex'
    );

    return query select
      r.seq, r.id, r.criado_em,
      case
        when r.hash_anterior is distinct from v_esperado then 'CADEIA_ROMPIDA'
        when r.hash_registro is distinct from v_calc     then 'REGISTRO_ALTERADO'
        else 'OK'
      end;

    v_esperado := r.hash_registro;
  end loop;
end;
$$;
