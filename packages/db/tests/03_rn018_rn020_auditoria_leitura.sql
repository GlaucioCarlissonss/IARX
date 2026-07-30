-- =============================================================================
-- TESTE RN-018 / RN-019 / RN-020
--
-- RN-018: toda alteração crítica gera histórico auditável com antes/depois
-- RN-019: exclusão é lógica e rastreável, com ação própria no log
-- RN-020: leitura de medidor é monotônica não decrescente
--
-- Verifica também o encadeamento de hash da auditoria (selagem em lote).
-- =============================================================================
\set ON_ERROR_STOP on

select gen_random_uuid() as t1, gen_random_uuid() as emp, gen_random_uuid() as fil,
       gen_random_uuid() as fab, gen_random_uuid() as cat, gen_random_uuid() as mod,
       gen_random_uuid() as eq,  gen_random_uuid() as med, gen_random_uuid() as usr
\gset

insert into public.tenant (id, nome) values (:'t1', 'Locadora Auditoria');
insert into public.empresa (id, tenant_id, razao_social) values (:'emp', :'t1', 'Aud LTDA');
insert into public.filial (id, tenant_id, empresa_id, codigo, nome) values (:'fil', :'t1', :'emp', 'AU-01', 'Base');
insert into public.usuario (id, tenant_id, nome, email) values (:'usr', :'t1', 'Operador Teste', 'op@teste.local');
insert into public.fabricante (id, tenant_id, nome) values (:'fab', :'t1', 'Fabricante Y');
insert into public.categoria_equipamento (id, tenant_id, codigo, nome, tipo_medidor_padrao)
  values (:'cat', :'t1', 'GER', 'Gerador', 'HORIMETRO');
insert into public.modelo (id, tenant_id, fabricante_id, categoria_id, codigo, nome)
  values (:'mod', :'t1', :'fab', :'cat', 'G150', 'Gerador 150 kVA');

-- ---------------------------------------------------------------- RN-018: INSERT
begin;
  set local app.tenant_id = :'t1';
  set local app.usuario_id = :'usr';
  set local app.request_id = 'req_teste_0001';
  set local app.origem = 'WEB';

  insert into public.equipamento (id, tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (:'eq', :'t1', '20001', 'SN-G-001', :'mod', :'cat', :'fil');

  do $$
  declare r record;
  begin
    select * into r from public.audit_log
    where entidade_tipo = 'equipamento' and acao = 'INSERIR'
    order by criado_em desc limit 1;

    if r.id is null then
      raise exception 'FALHA RN-018: INSERT em equipamento não gerou entrada de auditoria';
    end if;
    if r.request_id <> 'req_teste_0001' then
      raise exception 'FALHA RN-018: request_id não propagado (valor=%)', r.request_id;
    end if;
    if r.origem <> 'WEB' then
      raise exception 'FALHA RN-018: origem não registrada (valor=%)', r.origem;
    end if;
    if r.usuario_id is null then
      raise exception 'FALHA RN-018: autor não registrado';
    end if;
    if r.valor_novo -> 'patrimonio' is null then
      raise exception 'FALHA RN-018: valor_novo não contém o estado inserido';
    end if;
    raise notice 'caso 1 OK — INSERT auditado com autor, request_id e origem';
  end $$;
commit;

-- ---------------------------------------------------------------- RN-018: UPDATE
begin;
  set local app.tenant_id = :'t1';
  set local app.usuario_id = :'usr';
  set local app.motivo = 'bloqueio por preventiva vencida';

  update public.equipamento
     set bloqueado = true, bloqueio_motivo = 'preventiva vencida há 12 dias'
   where id = :'eq';

  do $$
  declare r record;
  begin
    select * into r from public.audit_log
    where entidade_tipo = 'equipamento' and acao = 'ATUALIZAR'
    order by criado_em desc limit 1;

    if r.id is null then
      raise exception 'FALHA RN-018: UPDATE não gerou auditoria';
    end if;
    -- registra apenas o que mudou
    if (r.valor_anterior -> 'bloqueado')::text <> 'false'
       or (r.valor_novo -> 'bloqueado')::text <> 'true' then
      raise exception 'FALHA RN-018: antes/depois incorretos (ant=%, novo=%)', r.valor_anterior, r.valor_novo;
    end if;
    if r.valor_novo ? 'patrimonio' then
      raise exception 'FALHA RN-018: campos não alterados foram registrados (ruído no log)';
    end if;
    if r.motivo <> 'bloqueio por preventiva vencida' then
      raise exception 'FALHA RN-018: motivo de negócio não registrado (valor=%)', r.motivo;
    end if;
    raise notice 'caso 2 OK — UPDATE auditado apenas com campos alterados e motivo';
  end $$;
commit;

-- ---------------------------------------------------------------- update sem mudança
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare n_antes integer; n_depois integer; v_eq uuid;
  begin
    select id into v_eq from public.equipamento where patrimonio = '20001';
    select count(*) into n_antes from public.audit_log where entidade_tipo = 'equipamento';

    update public.equipamento set bloqueado = true where id = v_eq;  -- já era true

    select count(*) into n_depois from public.audit_log where entidade_tipo = 'equipamento';
    if n_depois <> n_antes then
      raise exception 'FALHA: UPDATE sem mudança efetiva gerou % entrada(s) de auditoria', n_depois - n_antes;
    end if;
    raise notice 'caso 3 OK — UPDATE sem mudança efetiva não gera ruído';
  end $$;
commit;

-- ---------------------------------------------------------------- RN-019: exclusão lógica
begin;
  set local app.tenant_id = :'t1';
  set local app.usuario_id = :'usr';

  update public.equipamento
     set deleted_at = now(), deleted_by = :'usr', delete_reason = 'cadastro duplicado'
   where id = :'eq';

  do $$
  declare r record;
  begin
    select * into r from public.audit_log
    where entidade_tipo = 'equipamento' and acao = 'EXCLUIR_LOGICO'
    order by criado_em desc limit 1;

    if r.id is null then
      raise exception 'FALHA RN-019: exclusão lógica não gerou ação própria no log';
    end if;
    raise notice 'caso 4 OK — exclusão lógica registrada com ação EXCLUIR_LOGICO';
  end $$;

  -- restaura para os testes de leitura
  update public.equipamento
     set deleted_at = null, deleted_by = null, delete_reason = null, bloqueado = false, bloqueio_motivo = null
   where id = :'eq';
commit;

-- ---------------------------------------------------------------- RN-020: monotonicidade
insert into public.medidor (id, tenant_id, equipamento_id, tipo, unidade, valor_inicial, valor_atual)
  values (:'med', :'t1', :'eq', 'HORIMETRO', 'h', 0, 0);

begin;
  set local app.tenant_id = :'t1';

  insert into public.leitura_medidor (tenant_id, medidor_id, equipamento_id, valor, data_leitura, origem)
    values (:'t1', :'med', :'eq', 1200.50, now() - interval '10 days', 'CAMPO');
  insert into public.leitura_medidor (tenant_id, medidor_id, equipamento_id, valor, data_leitura, origem)
    values (:'t1', :'med', :'eq', 1310.00, now() - interval '5 days', 'CAMPO');

  do $$
  declare v_erro text := null; v_med uuid; v_eq uuid;
  begin
    select id, equipamento_id into v_med, v_eq from public.medidor limit 1;

    -- leitura menor que a anterior: deve ser rejeitada
    begin
      insert into public.leitura_medidor (tenant_id, medidor_id, equipamento_id, valor, data_leitura, origem)
        select tenant_id, v_med, v_eq, 1250.00, now(), 'MANUAL' from public.medidor where id = v_med;
    exception when others then
      v_erro := sqlerrm;
    end;

    if v_erro is null then
      raise exception 'FALHA RN-020: leitura retroativa menor foi ACEITA';
    end if;
    raise notice 'caso 5 OK — leitura menor que a anterior rejeitada';

    -- leitura maior: aceita
    insert into public.leitura_medidor (tenant_id, medidor_id, equipamento_id, valor, data_leitura, origem)
      select tenant_id, v_med, v_eq, 1402.25, now(), 'TELEMETRIA' from public.medidor where id = v_med;
    raise notice 'caso 6 OK — leitura crescente aceita';
  end $$;
commit;

-- ---------------------------------------------------------------- selagem da auditoria
do $$
declare
  n_seladas integer;
  n_problemas integer;
  v_t uuid;
begin
  select id into v_t from public.tenant where nome = 'Locadora Auditoria';

  n_seladas := app.selar_auditoria(1000);
  if n_seladas = 0 then
    raise exception 'FALHA: nenhuma entrada de auditoria foi selada';
  end if;

  select count(*) into n_problemas
  from app.verificar_cadeia_auditoria(v_t)
  where situacao <> 'OK';

  if n_problemas > 0 then
    raise exception 'FALHA: cadeia de auditoria inconsistente logo após a selagem (% problema(s))', n_problemas;
  end if;

  raise notice 'caso 7 OK — % entradas seladas, cadeia de hash íntegra', n_seladas;
end $$;

-- Detecção de manipulação: alterar um registro já selado deve romper a cadeia.
-- (Executado como superusuário; a aplicação não tem esse privilégio — caso 5 do teste 02.)
do $$
declare
  v_t uuid; v_id uuid; v_criado timestamptz; n_problemas integer;
begin
  select id into v_t from public.tenant where nome = 'Locadora Auditoria';
  select id, criado_em into v_id, v_criado
  from public.audit_log where tenant_id = v_t and seq = 1;

  update public.audit_log set motivo = 'valor manipulado'
   where id = v_id and criado_em = v_criado;

  select count(*) into n_problemas
  from app.verificar_cadeia_auditoria(v_t)
  where situacao <> 'OK';

  if n_problemas = 0 then
    raise exception 'FALHA: manipulação de registro selado NÃO foi detectada pela verificação de cadeia';
  end if;

  raise notice 'caso 8 OK — manipulação detectada: % registro(s) sinalizado(s)', n_problemas;
end $$;

-- ---------------------------------------------------------------- limpeza
delete from public.leitura_medidor where tenant_id = :'t1';
delete from public.medidor where tenant_id = :'t1';
delete from public.audit_log where tenant_id = :'t1';
delete from public.equipamento where tenant_id = :'t1';
delete from public.modelo where tenant_id = :'t1';
delete from public.categoria_equipamento where tenant_id = :'t1';
delete from public.fabricante where tenant_id = :'t1';
delete from public.usuario where tenant_id = :'t1';
delete from public.filial where tenant_id = :'t1';
delete from public.empresa where tenant_id = :'t1';
delete from public.tenant where id = :'t1';

\echo '== 03_rn018_rn020_auditoria_leitura: TODOS OS CASOS APROVADOS =='
