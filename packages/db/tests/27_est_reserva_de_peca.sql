-- =============================================================================
-- TESTE EST — reserva de peça na OS (Anexo B.5) e alçada de ajuste
--
-- Quarta máquina de estados que existia no anexo e não no banco. É a que fecha
-- o circuito entre três módulos: a peça sai do estoque, entra no custo da OS, e
-- o custo da OS entra na margem do ativo e do cliente (RN-025).
--
-- O que estes casos protegem:
--
--  · reservar compromete sem baixar — o disponível cai, o físico fica;
--  · consumir baixa pelo custo médio **do instante**, gera o movimento
--    `SAIDA_OS` e lança o custo na ordem. Sem esse último passo a peça some:
--    sai do estoque, o custo de material fica zero, a margem do ativo fica
--    melhor do que é, e a diferença só aparece no inventário;
--  · devolver e cancelar liberam a reserva sem tocar no físico;
--  · RN-015 — conclusão exige destino para toda peça reservada. OS concluída
--    com peça presa deixa saldo comprometido por uma ordem que acabou;
--  · a alçada de ajuste mede o **valor**, em módulo: sobra esconde compra não
--    lançada e falta esconde furto, e as duas custam a mesma atenção.
-- =============================================================================
\set ON_ERROR_STOP on

select gen_random_uuid() as t1, gen_random_uuid() as emp, gen_random_uuid() as fil,
       gen_random_uuid() as cat, gen_random_uuid() as fab, gen_random_uuid() as mod,
       gen_random_uuid() as eq, gen_random_uuid() as tec, gen_random_uuid() as usr,
       gen_random_uuid() as perf, gen_random_uuid() as dep, gen_random_uuid() as pec,
       gen_random_uuid() as os1, gen_random_uuid() as os2
\gset

insert into public.tenant (id, nome) values (:'t1', 'Locadora PEC');
insert into public.empresa (id, tenant_id, razao_social) values (:'emp', :'t1', 'PEC LTDA');
insert into public.filial (id, tenant_id, empresa_id, codigo, nome)
  values (:'fil', :'t1', :'emp', 'PEC-01', 'Base PEC');
insert into public.categoria_equipamento (id, tenant_id, codigo, nome)
  values (:'cat', :'t1', 'MFP', 'Multifuncional');
insert into public.fabricante (id, tenant_id, nome) values (:'fab', :'t1', 'Fabricante PEC');
insert into public.modelo (id, tenant_id, fabricante_id, categoria_id, codigo, nome)
  values (:'mod', :'t1', :'fab', :'cat', 'P-1', 'Modelo PEC');
insert into public.equipamento (id, tenant_id, patrimonio, modelo_id, categoria_id, filial_id)
  values (:'eq', :'t1', 'PEC-0001', :'mod', :'cat', :'fil');

insert into public.usuario (id, tenant_id, email, nome)
  values (:'usr', :'t1', 'almoxarife.pec@exemplo.local', 'Almoxarife PEC');
insert into public.perfil (id, tenant_id, nome, permissoes)
  values (:'perf', :'t1', 'Almoxarife PEC', array['estoque:movimentar']);
insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo)
  values (:'t1', :'usr', :'perf', 'TENANT');
insert into public.tecnico (id, tenant_id, usuario_id, nome, matricula, filial_id)
  values (:'tec', :'t1', :'usr', 'Tecnico PEC', 'PEC-T1', :'fil');

insert into public.deposito (id, tenant_id, filial_id, codigo, nome, tipo)
  values (:'dep', :'t1', :'fil', 'PEC-D1', 'Almoxarifado PEC', 'ALMOXARIFADO');
insert into public.peca (id, tenant_id, codigo_interno, descricao, unidade)
  values (:'pec', :'t1', 'FUSOR-01', 'Unidade fusora', 'UN');

set role iarx_app;

-- ---------------------------------------------------------------- caso 1: reservar compromete sem baixar
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_dep  = :'dep';
  set local app.teste_pec  = :'pec';
  set local app.teste_eq   = :'eq';
  set local app.teste_os   = :'os1';

  do $$
  declare v_fis numeric; v_res numeric; v_disp numeric;
  begin
    -- Dez unidades a R$ 300 cada.
    insert into public.movimento_estoque
      (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario, registrado_por)
    values (app.tenant_atual(), current_setting('app.teste_pec')::uuid,
            current_setting('app.teste_dep')::uuid, 'ENTRADA_COMPRA', 10, 300.0000,
            current_setting('app.usuario_id')::uuid);

    insert into public.ordem_servico
      (id, tenant_id, numero, equipamento_id, filial_id, tipo, descricao)
    values (current_setting('app.teste_os')::uuid, app.tenant_atual(), 'OS-PEC-0001',
            current_setting('app.teste_eq')::uuid,
            (select id from public.filial where codigo = 'PEC-01'),
            'CORRETIVA', 'fusor com ruido e falha de fusao');

    insert into public.os_peca
      (tenant_id, ordem_servico_id, peca_id, deposito_id, quantidade_reservada)
    values (app.tenant_atual(), current_setting('app.teste_os')::uuid,
            current_setting('app.teste_pec')::uuid, current_setting('app.teste_dep')::uuid, 2);

    update public.os_peca set status = 'RESERVADA'
     where ordem_servico_id = current_setting('app.teste_os')::uuid;

    select quantidade_fisica, quantidade_reservada, quantidade_disponivel
      into v_fis, v_res, v_disp
      from public.saldo_estoque
     where peca_id = current_setting('app.teste_pec')::uuid;

    if v_fis <> 10 or v_res <> 2 or v_disp <> 8 then
      raise exception 'FALHA: esperado 10/2/8, veio %/%/%', v_fis, v_res, v_disp;
    end if;
    -- A peça continua na prateleira; o que mudou é que ela já tem dono.
    raise notice 'caso 1 OK — reservar compromete sem baixar';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 2: consumir baixa, custeia e lança na OS
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_pec  = :'pec';
  set local app.teste_os   = :'os1';

  do $$
  declare
    v_fis numeric; v_res numeric; v_custo numeric;
    v_mov integer; v_unit numeric;
  begin
    update public.os_peca set status = 'CONSUMIDA'
     where ordem_servico_id = current_setting('app.teste_os')::uuid;

    select quantidade_fisica, quantidade_reservada into v_fis, v_res
      from public.saldo_estoque where peca_id = current_setting('app.teste_pec')::uuid;
    if v_fis <> 8 or v_res <> 0 then
      raise exception 'FALHA: esperado 8/0 após baixa, veio %/%', v_fis, v_res;
    end if;

    select count(*) into v_mov from public.movimento_estoque
     where ordem_servico_id = current_setting('app.teste_os')::uuid and tipo = 'SAIDA_OS';
    if v_mov <> 1 then
      raise exception 'FALHA: esperado 1 movimento SAIDA_OS, vieram %', v_mov;
    end if;

    select custo_unitario_baixa into v_unit from public.os_peca
     where ordem_servico_id = current_setting('app.teste_os')::uuid;
    if v_unit <> 300.0000 then
      raise exception 'FALHA: custo de baixa veio % (esperado 300)', v_unit;
    end if;

    /*
     * O elo que faltava. Sem este lançamento a peça sai do estoque e some: o
     * custo de material da ordem fica zero, a margem do ativo fica melhor do
     * que é, e a diferença só aparece no inventário — meses depois, sem como
     * atribuí-la a nenhuma manutenção.
     */
    select custo_material into v_custo from public.ordem_servico
     where id = current_setting('app.teste_os')::uuid;
    if v_custo <> 600.0000 then
      raise exception 'FALHA: custo_material da OS veio % (esperado 600)', v_custo;
    end if;
    raise notice 'caso 2 OK — consumir baixa pelo médio e lança o custo na ordem';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 3: consumida é terminal
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_os   = :'os1';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    begin
      update public.os_peca set status = 'DEVOLVIDA'
       where ordem_servico_id = current_setting('app.teste_os')::uuid;
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: peça consumida voltou a devolvida';
    end if;
    if v_constraint <> 'os_peca_transicao_valida' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;
    -- Peça baixada não volta por edição de status; volta por entrada de
    -- estoque, que deixa rastro e recalcula o custo médio.
    raise notice 'caso 3 OK — consumida é terminal';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 4: devolver libera sem mexer no físico
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_dep  = :'dep';
  set local app.teste_pec  = :'pec';
  set local app.teste_eq   = :'eq';
  set local app.teste_os2  = :'os2';

  do $$
  declare v_fis numeric; v_res numeric;
  begin
    insert into public.ordem_servico
      (id, tenant_id, numero, equipamento_id, filial_id, tipo, descricao)
    values (current_setting('app.teste_os2')::uuid, app.tenant_atual(), 'OS-PEC-0002',
            current_setting('app.teste_eq')::uuid,
            (select id from public.filial where codigo = 'PEC-01'),
            'CORRETIVA', 'suspeita de falha no fusor, a confirmar');

    insert into public.os_peca
      (tenant_id, ordem_servico_id, peca_id, deposito_id, quantidade_reservada)
    values (app.tenant_atual(), current_setting('app.teste_os2')::uuid,
            current_setting('app.teste_pec')::uuid, current_setting('app.teste_dep')::uuid, 3);

    update public.os_peca set status = 'RESERVADA'
     where ordem_servico_id = current_setting('app.teste_os2')::uuid;
    update public.os_peca set status = 'DEVOLVIDA'
     where ordem_servico_id = current_setting('app.teste_os2')::uuid;

    select quantidade_fisica, quantidade_reservada into v_fis, v_res
      from public.saldo_estoque where peca_id = current_setting('app.teste_pec')::uuid;
    if v_fis <> 8 or v_res <> 0 then
      raise exception 'FALHA: esperado 8/0 após devolução, veio %/%', v_fis, v_res;
    end if;
    raise notice 'caso 4 OK — devolver libera a reserva e não toca no físico';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 5: RN-015 — conclusão exige destino
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_dep  = :'dep';
  set local app.teste_pec  = :'pec';
  set local app.teste_os2  = :'os2';
  set local app.teste_tec  = :'tec';

  do $$
  declare v_erro text := null; v_constraint text := null; v_status app.os_status;
  begin
    insert into public.os_peca
      (tenant_id, ordem_servico_id, peca_id, deposito_id, quantidade_reservada)
    values (app.tenant_atual(), current_setting('app.teste_os2')::uuid,
            current_setting('app.teste_pec')::uuid, current_setting('app.teste_dep')::uuid, 1);

    update public.ordem_servico set status = 'TRIAGEM'     where numero = 'OS-PEC-0002';
    update public.ordem_servico set status = 'AGENDADA',
           tecnico_responsavel_id = current_setting('app.teste_tec')::uuid
     where numero = 'OS-PEC-0002';
    update public.ordem_servico set status = 'EM_EXECUCAO' where numero = 'OS-PEC-0002';

    begin
      update public.ordem_servico set status = 'CONCLUIDA' where numero = 'OS-PEC-0002';
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;

    if v_erro is null then
      raise exception 'FALHA: OS concluiu com peça sem destino';
    end if;
    if v_constraint <> 'os_peca_sem_destino' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;

    -- Cancelada a solicitação, a conclusão passa.
    update public.os_peca set status = 'CANCELADA'
     where ordem_servico_id = current_setting('app.teste_os2')::uuid
       and status = 'SOLICITADA';
    update public.ordem_servico set status = 'CONCLUIDA' where numero = 'OS-PEC-0002';

    select status into v_status from public.ordem_servico where numero = 'OS-PEC-0002';
    if v_status <> 'CONCLUIDA' then
      raise exception 'FALHA: conclusão não passou com as peças resolvidas (status %)', v_status;
    end if;
    /*
     * Concluir com peça presa deixa saldo comprometido por uma ordem que
     * acabou: a peça não está na prateleira para a próxima OS, e não está em
     * lugar nenhum no custo desta.
     */
    raise notice 'caso 5 OK — RN-015: nenhuma peça fica sem destino';
  end $$;
commit;

reset role;

-- O locatário configura a alçada de ajuste: o almoxarife ajusta até R$ 500.
insert into public.alcada (tenant_id, perfil_id, tipo, limite_valor)
  values (:'t1', :'perf', 'AJUSTE_INVENTARIO', 500.0000);

set role iarx_app;

-- ---------------------------------------------------------------- caso 6: alçada de ajuste, nos dois sentidos
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_dep  = :'dep';
  set local app.teste_pec  = :'pec';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    -- Falta de 3 unidades a 300 = 900, acima do teto de 500.
    begin
      insert into public.movimento_estoque
        (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario,
         registrado_por, motivo)
      values (app.tenant_atual(), current_setting('app.teste_pec')::uuid,
              current_setting('app.teste_dep')::uuid, 'AJUSTE_INVENTARIO', -3, 300.0000,
              current_setting('app.usuario_id')::uuid, 'diferenca apurada na contagem');
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: ajuste de 900 passou com teto de 500';
    end if;
    if v_constraint <> 'estoque_ajuste_acima_da_alcada' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;

    -- Sobra do mesmo valor também é recusada: o módulo é o que importa.
    v_erro := null;
    begin
      insert into public.movimento_estoque
        (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario,
         registrado_por, motivo)
      values (app.tenant_atual(), current_setting('app.teste_pec')::uuid,
              current_setting('app.teste_dep')::uuid, 'AJUSTE_INVENTARIO', 3, 300.0000,
              current_setting('app.usuario_id')::uuid, 'sobra apurada na contagem');
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: sobra de 900 passou com teto de 500';
    end if;
    /*
     * Sobra esconde compra não lançada; falta esconde furto. As duas aparecem
     * como diferença de inventário e custam a mesma atenção — medir só a falta
     * deixaria metade do problema fora da alçada.
     */
    if v_constraint <> 'estoque_ajuste_acima_da_alcada' then
      raise exception 'FALHA: sobra recusada por "%": %', v_constraint, v_erro;
    end if;

    -- Dentro do teto, passa.
    insert into public.movimento_estoque
      (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario,
       registrado_por, motivo)
    values (app.tenant_atual(), current_setting('app.teste_pec')::uuid,
            current_setting('app.teste_dep')::uuid, 'AJUSTE_INVENTARIO', -1, 300.0000,
            current_setting('app.usuario_id')::uuid, 'uma unidade avariada no transporte');

    raise notice 'caso 6 OK — a alçada de ajuste mede o valor, em módulo';
  end $$;
commit;

reset role;

-- ---------------------------------------------------------------- limpeza
alter table public.movimento_estoque disable trigger movimento_sem_update;
delete from public.movimento_estoque where tenant_id = :'t1';
alter table public.movimento_estoque enable trigger movimento_sem_update;

delete from public.os_peca       where tenant_id = :'t1';
delete from public.saldo_estoque where tenant_id = :'t1';
delete from public.ordem_servico where tenant_id = :'t1';
delete from public.peca          where tenant_id = :'t1';
delete from public.deposito      where tenant_id = :'t1';
delete from public.tecnico       where tenant_id = :'t1';
delete from public.equipamento   where tenant_id = :'t1';
delete from public.modelo        where tenant_id = :'t1';
delete from public.fabricante    where tenant_id = :'t1';
delete from public.categoria_equipamento where tenant_id = :'t1';
delete from public.audit_log     where tenant_id = :'t1';
delete from public.usuario_perfil where tenant_id = :'t1';
delete from public.alcada        where tenant_id = :'t1';
delete from public.usuario       where tenant_id = :'t1';
delete from public.filial        where tenant_id = :'t1';
delete from public.empresa       where tenant_id = :'t1';
delete from public.perfil        where tenant_id = :'t1';
delete from public.categoria_despesa where tenant_id = :'t1';
delete from public.tenant        where id = :'t1';

\echo '== 27_est_reserva_de_peca: TODOS OS CASOS APROVADOS =='
