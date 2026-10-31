-- =============================================================================
-- TESTE MNT — máquina de estados da OS (Anexo B.3) e RN-027
--
-- Duas invariantes, e as duas só valem se morarem no banco.
--
-- A **máquina de estados**, porque a API é um dos caminhos de escrita e não o
-- único: correção manual, importação e qualquer job futuro escrevem na mesma
-- tabela, e uma transição ilegal feita por fora é indistinguível de uma legal
-- depois de gravada.
--
-- **RN-027**, porque validação é o ponto em que o custo da OS entra no
-- resultado e o ativo volta a ficar disponível. Deixar o executor validar o
-- próprio trabalho transforma a conferência em formalidade — e é exatamente
-- onde um reparo mal feito volta como reincidência no mês seguinte.
-- =============================================================================
\set ON_ERROR_STOP on

select gen_random_uuid() as t1, gen_random_uuid() as emp, gen_random_uuid() as fil,
       gen_random_uuid() as cat, gen_random_uuid() as fab, gen_random_uuid() as mod,
       gen_random_uuid() as eq,  gen_random_uuid() as u_exec, gen_random_uuid() as u_sup,
       gen_random_uuid() as tec, gen_random_uuid() as os
\gset

-- ---------------------------------------------------------------- massa
insert into public.tenant (id, nome) values (:'t1', 'Locadora MNT');
insert into public.empresa (id, tenant_id, razao_social) values (:'emp', :'t1', 'MNT LTDA');
insert into public.filial (id, tenant_id, empresa_id, codigo, nome)
  values (:'fil', :'t1', :'emp', 'MNT-01', 'Base MNT');
insert into public.categoria_equipamento (id, tenant_id, codigo, nome)
  values (:'cat', :'t1', 'MFP', 'Multifuncional');
insert into public.fabricante (id, tenant_id, nome) values (:'fab', :'t1', 'Fabricante MNT');
insert into public.modelo (id, tenant_id, fabricante_id, categoria_id, codigo, nome)
  values (:'mod', :'t1', :'fab', :'cat', 'M-1', 'Modelo MNT');
insert into public.equipamento (id, tenant_id, patrimonio, modelo_id, categoria_id, filial_id)
  values (:'eq', :'t1', 'MNT-0001', :'mod', :'cat', :'fil');

insert into public.usuario (id, tenant_id, nome, email) values
  (:'u_exec', :'t1', 'Técnico Executor', 'exec@mnt.local'),
  (:'u_sup',  :'t1', 'Supervisor',       'sup@mnt.local');

insert into public.tecnico (id, tenant_id, usuario_id, nome, filial_id)
  values (:'tec', :'t1', :'u_exec', 'Técnico Executor', :'fil');

insert into public.ordem_servico
  (id, tenant_id, numero, equipamento_id, filial_id, tipo, descricao, tecnico_responsavel_id)
values
  (:'os', :'t1', '2026-00001', :'eq', :'fil', 'CORRETIVA',
   'Equipamento não puxa papel da bandeja 2', :'tec');

set role iarx_app;

-- ---------------------------------------------------------------- caso 1: caminho feliz
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_status app.os_status;
  begin
    update public.ordem_servico set status = 'TRIAGEM'     where numero = '2026-00001';
    update public.ordem_servico set status = 'AGENDADA'    where numero = '2026-00001';
    update public.ordem_servico set status = 'EM_EXECUCAO' where numero = '2026-00001';
    update public.ordem_servico set status = 'CONCLUIDA'   where numero = '2026-00001';

    select status into v_status from public.ordem_servico where numero = '2026-00001';
    if v_status <> 'CONCLUIDA' then
      raise exception 'FALHA: esperado CONCLUIDA, veio %', v_status;
    end if;
    raise notice 'caso 1 OK — ABERTA → TRIAGEM → AGENDADA → EM_EXECUCAO → CONCLUIDA';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 2: salto ilegal
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_erro text := null; v_state text := null;
  begin
    begin
      -- CONCLUIDA → AGENDADA não existe no Anexo B.3. Se passasse, uma OS já
      -- concluída poderia voltar para a fila e ser concluída de novo, dobrando
      -- o custo lançado no resultado.
      update public.ordem_servico set status = 'AGENDADA' where numero = '2026-00001';
    exception when others then
      v_erro := sqlerrm; v_state := sqlstate;
    end;

    if v_erro is null then
      raise exception 'FALHA: transição CONCLUIDA → AGENDADA foi ACEITA';
    end if;
    if v_state <> '23514' then
      raise exception 'FALHA: recusado com SQLSTATE % (esperado 23514): %', v_state, v_erro;
    end if;
    raise notice 'caso 2 OK — transição fora do Anexo B.3 recusada';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 3: RN-027
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_executor = :'u_exec';

  do $$
  declare v_erro text := null; v_state text := null;
  begin
    begin
      update public.ordem_servico
         set status = 'VALIDADA',
             validado_por = current_setting('app.teste_executor')::uuid,
             validacao_em = now()
       where numero = '2026-00001';
    exception when others then
      v_erro := sqlerrm; v_state := sqlstate;
    end;

    if v_erro is null then
      raise exception 'FALHA RN-027: o executor validou a própria ordem de serviço';
    end if;
    if v_state <> '23514' then
      raise exception 'FALHA: recusado com SQLSTATE % (esperado 23514): %', v_state, v_erro;
    end if;
    raise notice 'caso 3 OK — RN-027: executor não valida o próprio trabalho';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 4: validação por outro
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_supervisor = :'u_sup';

  do $$
  declare v_status app.os_status;
  begin
    update public.ordem_servico
       set status = 'VALIDADA',
           validado_por = current_setting('app.teste_supervisor')::uuid,
           validacao_em = now()
     where numero = '2026-00001';

    select status into v_status from public.ordem_servico where numero = '2026-00001';
    if v_status <> 'VALIDADA' then
      raise exception 'FALHA: supervisor não conseguiu validar (status %)', v_status;
    end if;
    raise notice 'caso 4 OK — validação por quem não executou é aceita';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 5: custo total é derivado
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_total numeric; v_erro text := null;
  begin
    update public.ordem_servico
       set custo_mao_obra = 150.0000, custo_material = 80.5000,
           custo_terceiros = 0, custo_deslocamento = 19.5000
     where numero = '2026-00001';

    select custo_total into v_total from public.ordem_servico where numero = '2026-00001';
    if v_total <> 250.0000 then
      raise exception 'FALHA: custo_total % não corresponde à soma das parcelas', v_total;
    end if;

    -- Coluna gerada: não há caminho de escrita, logo não há caminho de
    -- divergência. Custo total que diverge das parcelas é o número que
    -- ninguém consegue defender numa revisão de margem.
    begin
      update public.ordem_servico set custo_total = 1.00 where numero = '2026-00001';
    exception when others then
      v_erro := sqlerrm;
    end;
    if v_erro is null then
      raise exception 'FALHA: custo_total aceitou escrita direta';
    end if;

    raise notice 'caso 5 OK — custo_total é derivado e não aceita escrita';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 6: uma pausa aberta por vez
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_os = :'os';

  do $$
  declare v_erro text := null;
  begin
    insert into public.os_pausa (tenant_id, ordem_servico_id, motivo, justificativa)
      values (app.tenant_atual(), current_setting('app.teste_os')::uuid,
              'AGUARDANDO_PECA', 'peça de reposição sem saldo no depósito');

    begin
      insert into public.os_pausa (tenant_id, ordem_servico_id, motivo, justificativa)
        values (app.tenant_atual(), current_setting('app.teste_os')::uuid,
                'ACESSO_NEGADO', 'cliente não liberou o acesso ao andar');
    exception when others then
      v_erro := sqlerrm;
    end;

    if v_erro is null then
      raise exception 'FALHA RN-011: duas pausas abertas ao mesmo tempo — o SLA passaria a render tempo';
    end if;
    raise notice 'caso 6 OK — só uma pausa aberta por ordem de serviço';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 7: justificativa legível
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_os = :'os';

  do $$
  declare v_erro text := null;
  begin
    begin
      insert into public.os_pausa (tenant_id, ordem_servico_id, motivo, justificativa, fim)
        values (app.tenant_atual(), current_setting('app.teste_os')::uuid,
                'ACESSO_NEGADO', 'x', now());
    exception when others then
      v_erro := sqlerrm;
    end;

    if v_erro is null then
      raise exception 'FALHA: pausa com justificativa de um caractere foi aceita';
    end if;
    -- Pausa sem motivo legível é a porta pela qual todo SLA passa a ser
    -- cumprido: basta pausar o relógio quando ele aperta.
    raise notice 'caso 7 OK — pausa exige justificativa legível';
  end $$;
commit;

reset role;

-- ---------------------------------------------------------------- limpeza
delete from public.os_pausa        where tenant_id = :'t1';
delete from public.os_apontamento  where tenant_id = :'t1';
delete from public.ordem_servico   where tenant_id = :'t1';
delete from public.tecnico         where tenant_id = :'t1';
delete from public.equipamento     where tenant_id = :'t1';
delete from public.modelo          where tenant_id = :'t1';
delete from public.fabricante      where tenant_id = :'t1';
delete from public.categoria_equipamento where tenant_id = :'t1';
delete from public.audit_log       where tenant_id = :'t1';
delete from public.usuario         where tenant_id = :'t1';
delete from public.filial          where tenant_id = :'t1';
delete from public.empresa         where tenant_id = :'t1';
delete from public.perfil          where tenant_id = :'t1';
delete from public.categoria_despesa where tenant_id = :'t1';
delete from public.tenant          where id = :'t1';

\echo '== 19_mnt_ordem_servico: TODOS OS CASOS APROVADOS =='
