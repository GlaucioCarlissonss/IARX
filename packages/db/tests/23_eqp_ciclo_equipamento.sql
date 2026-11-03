-- =============================================================================
-- TESTE EQP — ciclo de vida do equipamento (Anexo B.2)
--
-- Terceira máquina de estados a sair do papel. O enum nasceu na 0004 com dez
-- valores e nenhum gatilho, então `update equipamento set status = 'DISPONIVEL'`
-- devolvia à base alocável uma máquina que ninguém devolveu.
--
-- Quatro pré-condições merecem o nome de invariante, e são as que estes casos
-- protegem:
--
--  · o mapa de transições — pular a reserva e o trânsito significa que não há
--    registro de quem separou nem de quem entregou;
--  · ativo em campo não é baixado — baixa é o encerramento patrimonial, e
--    fazê-la com contrato vigente descarta contabilmente uma máquina que está
--    na mesa de alguém, que o cliente segue pagando;
--  · volta de manutenção vai para onde o ativo estava, e quem sabe isso é o
--    contrato, não quem digita;
--  · ativo com status BLOQUEADO não é alocável — o estado existia desde a 0004
--    e a guarda de alocação da 0005 não o lia.
-- =============================================================================
\set ON_ERROR_STOP on

select gen_random_uuid() as t1, gen_random_uuid() as emp, gen_random_uuid() as fil,
       gen_random_uuid() as cli, gen_random_uuid() as cat, gen_random_uuid() as fab,
       gen_random_uuid() as mod, gen_random_uuid() as ct,
       gen_random_uuid() as eq1, gen_random_uuid() as eq2, gen_random_uuid() as eq3,
       gen_random_uuid() as eq4, gen_random_uuid() as eq5, gen_random_uuid() as eq6
\gset

insert into public.tenant (id, nome) values (:'t1', 'Locadora EQP');
insert into public.empresa (id, tenant_id, razao_social) values (:'emp', :'t1', 'EQP LTDA');
insert into public.filial (id, tenant_id, empresa_id, codigo, nome)
  values (:'fil', :'t1', :'emp', 'EQP-01', 'Base EQP');
insert into public.cliente (id, tenant_id, documento, razao_social)
  values (:'cli', :'t1', '55000000000236', 'Cliente EQP');
insert into public.categoria_equipamento (id, tenant_id, codigo, nome)
  values (:'cat', :'t1', 'MFP', 'Multifuncional');
insert into public.fabricante (id, tenant_id, nome) values (:'fab', :'t1', 'Fabricante EQP');
insert into public.modelo (id, tenant_id, fabricante_id, categoria_id, codigo, nome)
  values (:'mod', :'t1', :'fab', :'cat', 'E-1', 'Modelo EQP');

insert into public.equipamento (id, tenant_id, patrimonio, modelo_id, categoria_id, filial_id)
values (:'eq1', :'t1', 'EQP-0001', :'mod', :'cat', :'fil'),
       (:'eq2', :'t1', 'EQP-0002', :'mod', :'cat', :'fil'),
       (:'eq3', :'t1', 'EQP-0003', :'mod', :'cat', :'fil'),
       (:'eq4', :'t1', 'EQP-0004', :'mod', :'cat', :'fil'),
       (:'eq5', :'t1', 'EQP-0005', :'mod', :'cat', :'fil'),
       (:'eq6', :'t1', 'EQP-0006', :'mod', :'cat', :'fil');

insert into public.contrato (id, tenant_id, numero, empresa_id, filial_id, cliente_id,
                             status, data_inicio, data_fim)
  values (:'ct', :'t1', 'EQP-2026-001', :'emp', :'fil', :'cli', 'RASCUNHO', '2026-01-01', '2026-12-31');

set role iarx_app;

-- ---------------------------------------------------------------- caso 1: salto fora do mapa
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_erro text := null; v_state text := null; v_constraint text := null;
  begin
    begin
      -- DISPONÍVEL → LOCADO pula reserva e trânsito de entrega. Se fosse
      -- aceito, não haveria registro de quem separou o ativo nem de quem o
      -- levou — e é desse registro que sai a responsabilidade pela máquina
      -- enquanto ela está na rua.
      update public.equipamento set status = 'LOCADO' where patrimonio = 'EQP-0001';
    exception when others then
      v_erro := sqlerrm; v_state := sqlstate;
      get stacked diagnostics v_constraint = constraint_name;
    end;

    if v_erro is null then
      raise exception 'FALHA: DISPONIVEL → LOCADO foi aceito';
    end if;
    if v_state <> '23514' then
      raise exception 'FALHA: recusado com SQLSTATE % (esperado 23514): %', v_state, v_erro;
    end if;
    if v_constraint <> 'equipamento_transicao_valida' then
      raise exception 'FALHA: recusado por "%" e não pelo mapa de transições: %', v_constraint, v_erro;
    end if;
    raise notice 'caso 1 OK — transição fora do Anexo B.2 recusada';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 2: caminho feliz completo
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_status app.equipamento_status;
  begin
    update public.equipamento set status = 'RESERVADO'            where patrimonio = 'EQP-0001';
    update public.equipamento set status = 'EM_TRANSITO_ENTREGA',
           motivo_indisponibilidade = 'em rota de entrega'        where patrimonio = 'EQP-0001';
    update public.equipamento set status = 'LOCADO'               where patrimonio = 'EQP-0001';
    update public.equipamento set status = 'EM_TRANSITO_RETORNO',
           motivo_indisponibilidade = 'coleta agendada'           where patrimonio = 'EQP-0001';
    update public.equipamento set status = 'EM_INSPECAO',
           motivo_indisponibilidade = 'inspecao de retorno'       where patrimonio = 'EQP-0001';
    update public.equipamento set status = 'DISPONIVEL'           where patrimonio = 'EQP-0001';

    select status into v_status from public.equipamento where patrimonio = 'EQP-0001';
    if v_status <> 'DISPONIVEL' then
      raise exception 'FALHA: esperado DISPONIVEL ao fim do ciclo, veio %', v_status;
    end if;
    raise notice 'caso 2 OK — ciclo completo de locação e retorno';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 3: não baixa com alocação vigente
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_ct  = :'ct';
  set local app.teste_eq  = :'eq2';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    insert into public.contrato_item
      (tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
       valor_unitario, vigencia_inicio, vigencia_fim, status)
    values (app.tenant_atual(), current_setting('app.teste_ct')::uuid,
            current_setting('app.teste_eq')::uuid, 'FIXO_MENSAL', 500.0000,
            '2026-01-01', '2026-12-31', 'ATIVO');

    begin
      update public.equipamento
         set status = 'BAIXADO', motivo_indisponibilidade = 'fim de vida util'
       where patrimonio = 'EQP-0002';
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;

    if v_erro is null then
      raise exception 'FALHA: equipamento com item vigente foi baixado';
    end if;
    if v_constraint <> 'equipamento_alocado_nao_baixa' then
      raise exception 'FALHA: recusado por "%" e não pela alocação vigente: %', v_constraint, v_erro;
    end if;
    /*
     * É o modo de falha mais caro do eixo patrimonial: o ativo sai do balanço
     * e da base alocável, e continua na mesa do cliente — que segue pagando
     * por um equipamento que o sistema diz não existir.
     */
    raise notice 'caso 3 OK — alocação vigente impede a baixa';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 4: não baixa com OS aberta
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_eq3 = :'eq3';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    insert into public.ordem_servico
      (tenant_id, numero, equipamento_id, filial_id, tipo, descricao)
    values (app.tenant_atual(), 'OS-EQP-0001', current_setting('app.teste_eq3')::uuid,
            (select id from public.filial where codigo = 'EQP-01'),
            'CORRETIVA', 'ruido no mecanismo de traccao');

    begin
      update public.equipamento
         set status = 'BAIXADO', motivo_indisponibilidade = 'sinistro'
       where patrimonio = 'EQP-0003';
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;

    if v_erro is null then
      raise exception 'FALHA: equipamento com OS aberta foi baixado';
    end if;
    if v_constraint <> 'equipamento_com_os_nao_baixa' then
      raise exception 'FALHA: recusado por "%" e não pela OS aberta: %', v_constraint, v_erro;
    end if;
    raise notice 'caso 4 OK — ordem de serviço aberta impede a baixa';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 5: baixa limpa é aceita
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_status app.equipamento_status;
  begin
    update public.ordem_servico set status = 'CANCELADA' where numero = 'OS-EQP-0001';
    update public.equipamento
       set status = 'BAIXADO', motivo_indisponibilidade = 'sinistro'
     where patrimonio = 'EQP-0003';

    select status into v_status from public.equipamento where patrimonio = 'EQP-0003';
    if v_status <> 'BAIXADO' then
      raise exception 'FALHA: baixa sem pendência não passou (status %)', v_status;
    end if;
    raise notice 'caso 5 OK — ativo sem alocação nem OS é baixado';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 6: retorno de manutenção com contrato vigente
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_ct  = :'ct';
  set local app.teste_eq4 = :'eq4';

  do $$
  declare v_erro text := null; v_constraint text := null; v_status app.equipamento_status;
  begin
    insert into public.contrato_item
      (tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
       valor_unitario, vigencia_inicio, vigencia_fim, status)
    values (app.tenant_atual(), current_setting('app.teste_ct')::uuid,
            current_setting('app.teste_eq4')::uuid, 'FIXO_MENSAL', 400.0000,
            '2026-01-01', '2026-12-31', 'ATIVO');

    update public.equipamento
       set status = 'EM_MANUTENCAO', motivo_indisponibilidade = 'troca de fusor'
     where patrimonio = 'EQP-0004';

    begin
      update public.equipamento set status = 'DISPONIVEL' where patrimonio = 'EQP-0004';
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;

    if v_erro is null then
      raise exception 'FALHA: ativo com contrato vigente voltou da manutenção como DISPONIVEL';
    end if;
    if v_constraint <> 'equipamento_retorno_alocado' then
      raise exception 'FALHA: recusado por "%" e não pelo contrato vigente: %', v_constraint, v_erro;
    end if;

    -- O destino correto é LOCADO, e o banco aceita esse.
    update public.equipamento set status = 'LOCADO' where patrimonio = 'EQP-0004';
    select status into v_status from public.equipamento where patrimonio = 'EQP-0004';
    if v_status <> 'LOCADO' then
      raise exception 'FALHA: retorno para LOCADO recusado (status %)', v_status;
    end if;

    /*
     * O erro que isto impede é o de hábito: a máquina volta do conserto,
     * alguém marca DISPONÍVEL, e ela entra na base alocável enquanto o item
     * de contrato do cliente segue vigente. O próximo contrato a reservá-la
     * encontra um ativo "livre" que está na mesa de outro cliente, e a
     * descoberta acontece na entrega.
     */
    raise notice 'caso 6 OK — retorno de manutenção respeita o contrato vigente';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 7: retorno de manutenção sem contrato
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_erro text := null; v_constraint text := null; v_status app.equipamento_status;
  begin
    update public.equipamento
       set status = 'EM_MANUTENCAO', motivo_indisponibilidade = 'preventiva'
     where patrimonio = 'EQP-0005';

    begin
      update public.equipamento set status = 'LOCADO' where patrimonio = 'EQP-0005';
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;

    if v_erro is null then
      raise exception 'FALHA: ativo sem contrato voltou da manutenção como LOCADO';
    end if;
    if v_constraint <> 'equipamento_retorno_sem_contrato' then
      raise exception 'FALHA: recusado por "%" e não pela ausência de contrato: %', v_constraint, v_erro;
    end if;

    update public.equipamento set status = 'DISPONIVEL' where patrimonio = 'EQP-0005';
    select status into v_status from public.equipamento where patrimonio = 'EQP-0005';
    if v_status <> 'DISPONIVEL' then
      raise exception 'FALHA: retorno para DISPONIVEL recusado (status %)', v_status;
    end if;
    raise notice 'caso 7 OK — sem contrato, o retorno é para a base disponível';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 8: BLOQUEADO vem de qualquer estado e barra alocação
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_ct  = :'ct';
  set local app.teste_eq6 = :'eq6';

  do $$
  declare v_erro text := null; v_constraint text := null; v_status app.equipamento_status;
  begin
    -- Bloqueio é fato, não etapa: alcança o ativo onde ele estiver.
    update public.equipamento set status = 'RESERVADO' where patrimonio = 'EQP-0006';
    update public.equipamento
       set status = 'BLOQUEADO', motivo_indisponibilidade = 'preventiva vencida'
     where patrimonio = 'EQP-0006';

    select status into v_status from public.equipamento where patrimonio = 'EQP-0006';
    if v_status <> 'BLOQUEADO' then
      raise exception 'FALHA: bloqueio a partir de RESERVADO recusado (status %)', v_status;
    end if;

    /*
     * O estado existia desde a 0004 e a guarda de alocação da 0005 lia só a
     * flag `bloqueado` e uma lista de status que o omitia. Nenhum dado ruim
     * chegou a existir porque nada escrevia esse status — e é exatamente por
     * isso que a correção tinha de vir antes da rota que o escreve.
     */
    begin
      insert into public.contrato_item
        (tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
         valor_unitario, vigencia_inicio, vigencia_fim, status)
      values (app.tenant_atual(), current_setting('app.teste_ct')::uuid,
              current_setting('app.teste_eq6')::uuid, 'FIXO_MENSAL', 300.0000,
              '2026-01-01', '2026-12-31', 'ATIVO');
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;

    if v_erro is null then
      raise exception 'FALHA: ativo com status BLOQUEADO foi alocado';
    end if;
    /*
     * Sem esta conferência o caso passaria por qualquer recusa — inclusive a
     * de sobreposição de vigência, que não é o que se quer provar aqui.
     */
    if v_constraint <> 'equipamento_indisponivel_alocacao' then
      raise exception 'FALHA: recusado por "%" e não pela guarda de alocação: %', v_constraint, v_erro;
    end if;
    raise notice 'caso 8 OK — status BLOQUEADO impede alocação';
  end $$;
commit;

reset role;

-- ---------------------------------------------------------------- limpeza
delete from public.ordem_servico where tenant_id = :'t1';
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

\echo '== 23_eqp_ciclo_equipamento: TODOS OS CASOS APROVADOS =='
