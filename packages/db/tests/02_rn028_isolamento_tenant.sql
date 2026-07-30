-- =============================================================================
-- TESTE RN-028 — Isolamento entre tenants imposto no dado (RLS)
--
-- Este é o teste mais importante da adoção do Supabase (ver H.5.2). Ele simula
-- o comportamento do pooler em modo transação: DUAS TRANSAÇÕES DE TENANTS
-- DIFERENTES NA MESMA CONEXÃO. É exatamente aí que o uso incorreto de `SET`
-- (em vez de `SET LOCAL`) vazaria dados de um cliente para outro — falha que
-- nenhum teste de requisição isolada detectaria.
--
-- Verifica também o comportamento fail-closed: sem contexto de tenant,
-- nenhuma linha é visível.
-- =============================================================================
\set ON_ERROR_STOP on

-- Identificadores gerados no cliente (psql), evitando tabela auxiliar que o
-- papel de aplicação não poderia ler.
select gen_random_uuid() as t1, gen_random_uuid() as t2,
       gen_random_uuid() as emp1, gen_random_uuid() as fil1,
       gen_random_uuid() as cli1, gen_random_uuid() as cli2,
       gen_random_uuid() as emp2, gen_random_uuid() as fil2,
       gen_random_uuid() as cli3
\gset

-- ---------------------------------------------------------------- massa (superusuário)
-- Superusuário ignora RLS, então a semeadura ocorre antes de assumir iarx_app.
insert into public.tenant (id, nome) values (:'t1', 'Locadora A'), (:'t2', 'Locadora B');

insert into public.empresa (id, tenant_id, razao_social) values
  (:'emp1', :'t1', 'A LTDA'),
  (:'emp2', :'t2', 'B LTDA');

insert into public.filial (id, tenant_id, empresa_id, codigo, nome) values
  (:'fil1', :'t1', :'emp1', 'A-01', 'Base A'),
  (:'fil2', :'t2', :'emp2', 'B-01', 'Base B');

insert into public.cliente (id, tenant_id, documento, razao_social) values
  (:'cli1', :'t1', '10000000000101', 'Cliente A1'),
  (:'cli2', :'t1', '10000000000102', 'Cliente A2'),
  (:'cli3', :'t2', '20000000000201', 'Cliente B1');

insert into public.contrato (tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim) values
  (:'t1', 'A-2026-001', :'emp1', :'fil1', :'cli1', 'ATIVO', '2026-01-01', '2026-12-31'),
  (:'t2', 'B-2026-001', :'emp2', :'fil2', :'cli3', 'ATIVO', '2026-01-01', '2026-12-31');

-- A partir daqui operamos como a API operaria: papel iarx_app, sujeito a RLS.
set role iarx_app;

-- ---------------------------------------------------------------- caso 1: tenant A
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare n integer;
  begin
    select count(*) into n from public.cliente;
    if n <> 2 then
      raise exception 'FALHA: tenant A deveria ver 2 clientes, viu %', n;
    end if;

    select count(*) into n from public.contrato;
    if n <> 1 then
      raise exception 'FALHA: tenant A deveria ver 1 contrato, viu %', n;
    end if;

    select count(*) into n from public.cliente where razao_social like 'Cliente B%';
    if n <> 0 then
      raise exception 'VAZAMENTO: tenant A viu % cliente(s) do tenant B', n;
    end if;

    raise notice 'caso 1 OK — tenant A vê apenas os próprios dados';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 2: MESMA CONEXÃO, tenant B
-- Se a aplicação usasse `SET` de sessão em vez de `SET LOCAL`, o tenant A
-- continuaria valendo aqui e este caso falharia.
begin;
  set local app.tenant_id = :'t2';

  do $$
  declare n integer;
  begin
    select count(*) into n from public.cliente;
    if n <> 1 then
      raise exception 'FALHA: tenant B deveria ver 1 cliente, viu % (possível vazamento de contexto entre transações)', n;
    end if;

    select count(*) into n from public.cliente where razao_social like 'Cliente A%';
    if n <> 0 then
      raise exception 'VAZAMENTO ENTRE TRANSAÇÕES: tenant B viu % cliente(s) do tenant A na mesma conexão', n;
    end if;

    raise notice 'caso 2 OK — troca de tenant na mesma conexão não vaza dados';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 3: fail-closed
-- Fora da transação, o SET LOCAL já expirou: nada deve ser visível.
do $$
declare n integer; v_ctx text;
begin
  v_ctx := coalesce(nullif(current_setting('app.tenant_id', true), ''), '(vazio)');
  if v_ctx <> '(vazio)' then
    raise exception 'FALHA: contexto de tenant sobreviveu ao COMMIT (valor=%) — SET LOCAL não respeitado', v_ctx;
  end if;

  select count(*) into n from public.cliente;
  if n <> 0 then
    raise exception 'FALHA FAIL-CLOSED: sem contexto de tenant, % cliente(s) visível(is)', n;
  end if;

  select count(*) into n from public.contrato;
  if n <> 0 then
    raise exception 'FALHA FAIL-CLOSED: sem contexto de tenant, % contrato(s) visível(is)', n;
  end if;

  raise notice 'caso 3 OK — sem contexto de tenant, nenhuma linha é visível (fail-closed)';
end $$;

-- ---------------------------------------------------------------- caso 4: escrita cruzada
-- Com contexto do tenant A, tentar gravar linha marcada como tenant B.
begin;
  set local app.tenant_id = :'t1';
  -- o tenant alheio viaja por outra chave, só para o teste poder referenciá-lo
  set local app.teste_outro_tenant = :'t2';

  do $$
  declare v_erro text := null; v_state text := null;
  begin
    begin
      insert into public.cliente (tenant_id, documento, razao_social)
        values (current_setting('app.teste_outro_tenant')::uuid, '30000000000301', 'Cliente injetado');
    exception when others then
      v_erro := sqlerrm; v_state := sqlstate;
    end;

    if v_erro is null then
      raise exception 'FALHA: gravação com tenant_id de outro tenant foi ACEITA';
    end if;
    if v_state <> '42501' then
      raise exception 'FALHA: rejeitado com SQLSTATE % (esperado 42501 insufficient_privilege): %', v_state, v_erro;
    end if;

    raise notice 'caso 4 OK — escrita com tenant_id alheio rejeitada pela política WITH CHECK';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 5: auditoria imutável
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare n integer; v_erro text := null;
  begin
    select count(*) into n from public.audit_log;
    if n = 0 then
      raise exception 'FALHA RN-018: nenhuma entrada de auditoria para o tenant A';
    end if;

    begin
      update public.audit_log set motivo = 'manipulado' where true;
    exception when others then
      v_erro := sqlerrm;
    end;
    if v_erro is null then
      raise exception 'FALHA RN-018: UPDATE em audit_log foi ACEITO — trilha não é imutável';
    end if;

    v_erro := null;
    begin
      delete from public.audit_log where true;
    exception when others then
      v_erro := sqlerrm;
    end;
    if v_erro is null then
      raise exception 'FALHA RN-018: DELETE em audit_log foi ACEITO — trilha não é imutável';
    end if;

    raise notice 'caso 5 OK — audit_log aceita INSERT/SELECT e recusa UPDATE/DELETE (% entradas visíveis)', n;
  end $$;
commit;

reset role;

-- ---------------------------------------------------------------- limpeza
delete from public.audit_log where tenant_id in (:'t1', :'t2');
delete from public.contrato where tenant_id in (:'t1', :'t2');
delete from public.cliente  where tenant_id in (:'t1', :'t2');
delete from public.filial   where tenant_id in (:'t1', :'t2');
delete from public.empresa  where tenant_id in (:'t1', :'t2');
delete from public.tenant   where id in (:'t1', :'t2');

\echo '== 02_rn028_isolamento_tenant: TODOS OS CASOS APROVADOS =='
