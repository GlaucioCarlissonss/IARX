-- =============================================================================
-- TESTE CTR — ciclo de vida do contrato (Anexo B.2)
--
-- A máquina do contrato existia no papel e não no banco. Com o enum e nenhum
-- gatilho, `update contrato set status = 'ATIVO'` levava um rascunho direto
-- para ativo — sem aprovação, sem assinatura, por qualquer caminho de escrita.
--
-- Três pré-condições merecem o nome de invariante, e são as que estes casos
-- protegem:
--
--  · contrato sem item não vai para aprovação — o gestor aprovaria nada, e a
--    primeira competência fecharia em zero sem ninguém saber por quê;
--  · contrato com item em campo não encerra — o ativo sai do parque alocável e
--    a máquina fica no cliente, sem ninguém para cobrar nem buscar;
--  · suspensão, distrato e encerramento exigem motivo — as três interrompem
--    dinheiro, e as três são as que alguém vai auditar.
-- =============================================================================
\set ON_ERROR_STOP on

select gen_random_uuid() as t1, gen_random_uuid() as emp, gen_random_uuid() as fil,
       gen_random_uuid() as cli, gen_random_uuid() as cat, gen_random_uuid() as fab,
       gen_random_uuid() as mod, gen_random_uuid() as eq, gen_random_uuid() as ct,
       gen_random_uuid() as ct2
\gset

insert into public.tenant (id, nome) values (:'t1', 'Locadora CTR');
insert into public.empresa (id, tenant_id, razao_social) values (:'emp', :'t1', 'CTR LTDA');
insert into public.filial (id, tenant_id, empresa_id, codigo, nome)
  values (:'fil', :'t1', :'emp', 'CTR-01', 'Base CTR');
insert into public.cliente (id, tenant_id, documento, razao_social)
  values (:'cli', :'t1', '55000000000155', 'Cliente CTR');
insert into public.categoria_equipamento (id, tenant_id, codigo, nome)
  values (:'cat', :'t1', 'MFP', 'Multifuncional');
insert into public.fabricante (id, tenant_id, nome) values (:'fab', :'t1', 'Fabricante CTR');
insert into public.modelo (id, tenant_id, fabricante_id, categoria_id, codigo, nome)
  values (:'mod', :'t1', :'fab', :'cat', 'C-1', 'Modelo CTR');
insert into public.equipamento (id, tenant_id, patrimonio, modelo_id, categoria_id, filial_id)
  values (:'eq', :'t1', 'CTR-0001', :'mod', :'cat', :'fil');

insert into public.contrato (id, tenant_id, numero, empresa_id, filial_id, cliente_id,
                             status, data_inicio, data_fim)
values (:'ct',  :'t1', 'CTR-2026-001', :'emp', :'fil', :'cli', 'RASCUNHO', '2026-01-01', '2026-12-31'),
       (:'ct2', :'t1', 'CTR-2026-002', :'emp', :'fil', :'cli', 'RASCUNHO', '2026-01-01', '2026-12-31');

set role iarx_app;

-- ---------------------------------------------------------------- caso 1: sem item não submete
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_erro text := null; v_state text := null;
  begin
    begin
      update public.contrato set status = 'EM_APROVACAO' where numero = 'CTR-2026-001';
    exception when others then v_erro := sqlerrm; v_state := sqlstate;
    end;

    if v_erro is null then
      raise exception 'FALHA: contrato sem item foi para aprovação';
    end if;
    if v_state <> '23514' then
      raise exception 'FALHA: recusado com SQLSTATE % (esperado 23514): %', v_state, v_erro;
    end if;
    raise notice 'caso 1 OK — contrato sem item não vai para aprovação';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 2: caminho feliz
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_ct = :'ct';
  set local app.teste_eq = :'eq';

  do $$
  declare v_status app.contrato_status;
  begin
    insert into public.contrato_item
      (tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
       valor_unitario, vigencia_inicio, vigencia_fim)
    values (app.tenant_atual(), current_setting('app.teste_ct')::uuid,
            current_setting('app.teste_eq')::uuid, 'FIXO_MENSAL', 500.0000,
            '2026-01-01', '2026-12-31');

    update public.contrato set status = 'EM_APROVACAO'          where numero = 'CTR-2026-001';
    update public.contrato set status = 'AGUARDANDO_ASSINATURA' where numero = 'CTR-2026-001';
    update public.contrato set status = 'ATIVO'                 where numero = 'CTR-2026-001';

    select status into v_status from public.contrato where numero = 'CTR-2026-001';
    if v_status <> 'ATIVO' then
      raise exception 'FALHA: esperado ATIVO, veio %', v_status;
    end if;
    raise notice 'caso 2 OK — RASCUNHO → EM_APROVACAO → AGUARDANDO_ASSINATURA → ATIVO';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 3: salto ilegal
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_erro text := null;
  begin
    begin
      -- ATIVO → RASCUNHO não existe. Se existisse, um contrato em vigor
      -- voltaria a rascunho e poderia ser reativado com outros valores sem
      -- nenhum rastro de aprovação.
      update public.contrato set status = 'RASCUNHO' where numero = 'CTR-2026-001';
    exception when others then v_erro := sqlerrm;
    end;
    if v_erro is null then
      raise exception 'FALHA: transição ATIVO → RASCUNHO foi aceita';
    end if;
    raise notice 'caso 3 OK — transição fora do Anexo B.2 recusada';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 4: suspensão exige motivo
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_erro text := null; v_susp timestamptz;
  begin
    begin
      update public.contrato set status = 'SUSPENSO' where numero = 'CTR-2026-001';
    exception when others then v_erro := sqlerrm;
    end;
    if v_erro is null then
      raise exception 'FALHA: suspensão sem motivo foi aceita';
    end if;

    update public.contrato
       set status = 'SUSPENSO',
           motivo_status = 'inadimplencia superior a sessenta dias'
     where numero = 'CTR-2026-001';

    -- O carimbo é preenchido pelo gatilho, não por quem escreve.
    select suspenso_em into v_susp from public.contrato where numero = 'CTR-2026-001';
    if v_susp is null then
      raise exception 'FALHA: suspenso_em não foi carimbado';
    end if;
    raise notice 'caso 4 OK — suspensão exige motivo e carimba a data';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 5: não encerra com item em campo
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_erro text := null;
  begin
    begin
      update public.contrato
         set status = 'ENCERRADO', motivo_status = 'encerramento a pedido do cliente'
       where numero = 'CTR-2026-001';
    exception when others then v_erro := sqlerrm;
    end;

    if v_erro is null then
      raise exception 'FALHA: contrato com item em campo foi encerrado';
    end if;
    /*
     * É o modo de falha mais caro do módulo: o ativo sai do parque alocável e
     * a máquina continua no cliente. Ninguém a cobra e ninguém a busca, porque
     * ela deixou de ser responsabilidade de alguém — e continua existindo.
     */
    raise notice 'caso 5 OK — contrato com item em campo não encerra';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 6: encerra com item devolvido
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_status app.contrato_status;
  begin
    update public.contrato_item set status = 'ENCERRADO'
     where contrato_id = (select id from public.contrato where numero = 'CTR-2026-001');

    update public.contrato
       set status = 'ENCERRADO', motivo_status = 'itens devolvidos e pendencia quitada'
     where numero = 'CTR-2026-001';

    select status into v_status from public.contrato where numero = 'CTR-2026-001';
    if v_status <> 'ENCERRADO' then
      raise exception 'FALHA: não encerrou com item devolvido (status %)', v_status;
    end if;
    raise notice 'caso 6 OK — encerra quando nada está em campo';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 7: cancelamento só antes da entrega
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_ct2 = :'ct2';

  do $$
  declare v_status app.contrato_status;
  begin
    -- Rascunho sem nada entregue: cancela.
    update public.contrato set status = 'CANCELADO' where numero = 'CTR-2026-002';
    select status into v_status from public.contrato where numero = 'CTR-2026-002';
    if v_status <> 'CANCELADO' then
      raise exception 'FALHA: rascunho sem item não cancelou';
    end if;
    /*
     * Cancelamento é "este contrato nunca existiu na prática". Com item
     * entregue a saída é distrato ou encerramento — e a diferença importa
     * porque uma calcula multa e a outra não.
     */
    raise notice 'caso 7 OK — cancelamento antes de qualquer entrega';
  end $$;
commit;

reset role;

-- ---------------------------------------------------------------- limpeza
delete from public.contrato_item where tenant_id = :'t1';
delete from public.contrato      where tenant_id = :'t1';
delete from public.equipamento   where tenant_id = :'t1';
delete from public.modelo        where tenant_id = :'t1';
delete from public.fabricante    where tenant_id = :'t1';
delete from public.categoria_equipamento where tenant_id = :'t1';
delete from public.audit_log     where tenant_id = :'t1';
delete from public.cliente       where tenant_id = :'t1';
delete from public.filial        where tenant_id = :'t1';
delete from public.empresa       where tenant_id = :'t1';
delete from public.perfil        where tenant_id = :'t1';
delete from public.categoria_despesa where tenant_id = :'t1';
delete from public.tenant        where id = :'t1';

\echo '== 21_ctr_ciclo_contrato: TODOS OS CASOS APROVADOS =='
