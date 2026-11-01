-- =============================================================================
-- TESTE EST — RN-017: o saldo é projeção do movimento, e o movimento é imutável
--
-- A tentação neste módulo é guardar só o saldo e atualizá-lo: é uma coluna e um
-- `update`. O problema aparece no primeiro inventário divergente, quando
-- alguém pergunta "por que o saldo é 3 se compramos 10 e usamos 5" e não existe
-- resposta — o `update` apagou o caminho.
--
-- Estes casos provam as três consequências do desenho oposto: o saldo nunca é
-- escrito por fora, o movimento nunca é editado, e a reserva não é baixa.
-- =============================================================================
\set ON_ERROR_STOP on

select gen_random_uuid() as t1, gen_random_uuid() as emp, gen_random_uuid() as fil,
       gen_random_uuid() as dep, gen_random_uuid() as pc, gen_random_uuid() as u1
\gset

-- ---------------------------------------------------------------- massa
insert into public.tenant (id, nome) values (:'t1', 'Locadora EST');
insert into public.empresa (id, tenant_id, razao_social) values (:'emp', :'t1', 'EST LTDA');
insert into public.filial (id, tenant_id, empresa_id, codigo, nome)
  values (:'fil', :'t1', :'emp', 'EST-01', 'Base EST');
insert into public.usuario (id, tenant_id, nome, email)
  values (:'u1', :'t1', 'Almoxarife', 'almox@est.local');
insert into public.deposito (id, tenant_id, filial_id, codigo, nome, tipo)
  values (:'dep', :'t1', :'fil', 'ALM-01', 'Almoxarifado Central', 'ALMOXARIFADO');
insert into public.peca (id, tenant_id, codigo_interno, descricao, unidade)
  values (:'pc', :'t1', 'ROL-001', 'Rolete de tração', 'UN');

set role iarx_app;

-- ---------------------------------------------------------------- caso 1: entrada projeta saldo
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_peca = :'pc';
  set local app.teste_dep  = :'dep';

  do $$
  declare v_fisico numeric; v_apos numeric; v_medio numeric;
  begin
    insert into public.movimento_estoque
      (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario)
    values (app.tenant_atual(), current_setting('app.teste_peca')::uuid,
            current_setting('app.teste_dep')::uuid, 'ENTRADA_COMPRA', 10, 25.0000);

    select quantidade_fisica into v_fisico from public.saldo_estoque
     where peca_id = current_setting('app.teste_peca')::uuid;
    if v_fisico <> 10 then
      raise exception 'FALHA: saldo % após entrada de 10', v_fisico;
    end if;

    -- `saldo_apos` gravado pelo gatilho: é o que permite auditar sem recalcular.
    select saldo_apos into v_apos from public.movimento_estoque
     where peca_id = current_setting('app.teste_peca')::uuid;
    if v_apos <> 10 then
      raise exception 'FALHA: saldo_apos % no movimento', v_apos;
    end if;

    select custo_medio into v_medio from public.peca
     where id = current_setting('app.teste_peca')::uuid;
    if v_medio <> 25.0000 then
      raise exception 'FALHA: custo médio % após entrada a 25', v_medio;
    end if;

    raise notice 'caso 1 OK — entrada projeta saldo, saldo_apos e custo médio';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 2: custo médio móvel
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_peca = :'pc';
  set local app.teste_dep  = :'dep';

  do $$
  declare v_medio numeric;
  begin
    -- Dez a 25 mais dez a 35 dá vinte a 30.
    insert into public.movimento_estoque
      (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario)
    values (app.tenant_atual(), current_setting('app.teste_peca')::uuid,
            current_setting('app.teste_dep')::uuid, 'ENTRADA_COMPRA', 10, 35.0000);

    select custo_medio into v_medio from public.peca
     where id = current_setting('app.teste_peca')::uuid;
    if round(v_medio, 2) <> 30.00 then
      raise exception 'FALHA: custo médio % (esperado 30,00)', v_medio;
    end if;
    raise notice 'caso 2 OK — custo médio móvel: 10@25 + 10@35 = 20@30';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 3: saída não altera custo médio
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_peca = :'pc';
  set local app.teste_dep  = :'dep';

  do $$
  declare v_medio numeric; v_fisico numeric;
  begin
    insert into public.movimento_estoque
      (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario)
    values (app.tenant_atual(), current_setting('app.teste_peca')::uuid,
            current_setting('app.teste_dep')::uuid, 'SAIDA_OS', -5, 30.0000);

    select quantidade_fisica into v_fisico from public.saldo_estoque
     where peca_id = current_setting('app.teste_peca')::uuid;
    if v_fisico <> 15 then
      raise exception 'FALHA: saldo % após saída de 5 sobre 20', v_fisico;
    end if;

    -- Se a saída mexesse no custo médio, consumir peça barata baratearia o
    -- estoque restante e o custo da OS seguinte sairia errado para menos.
    select custo_medio into v_medio from public.peca
     where id = current_setting('app.teste_peca')::uuid;
    if round(v_medio, 2) <> 30.00 then
      raise exception 'FALHA: saída alterou o custo médio para %', v_medio;
    end if;
    raise notice 'caso 3 OK — saída baixa saldo e não mexe no custo médio';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 4: RN-017, saldo não fica negativo
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_peca = :'pc';
  set local app.teste_dep  = :'dep';

  do $$
  declare v_erro text := null;
  begin
    begin
      insert into public.movimento_estoque
        (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario)
      values (app.tenant_atual(), current_setting('app.teste_peca')::uuid,
              current_setting('app.teste_dep')::uuid, 'SAIDA_OS', -100, 30.0000);
    exception when others then v_erro := sqlerrm;
    end;

    if v_erro is null then
      raise exception 'FALHA RN-017: saída maior que o saldo foi aceita';
    end if;
    -- Saldo negativo não é "estoque devendo": é um movimento que não deveria
    -- ter sido aceito, e descobrir isso no inventário custa reconstruir meses.
    raise notice 'caso 4 OK — saldo não fica negativo';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 5: movimento é imutável
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_peca = :'pc';

  do $$
  declare v_erro text := null; v_state text := null;
  begin
    begin
      update public.movimento_estoque set quantidade = 1
       where peca_id = current_setting('app.teste_peca')::uuid;
    exception when others then v_erro := sqlerrm; v_state := sqlstate;
    end;
    if v_erro is null then
      raise exception 'FALHA: UPDATE em movimento_estoque foi ACEITO';
    end if;

    v_erro := null;
    begin
      delete from public.movimento_estoque
       where peca_id = current_setting('app.teste_peca')::uuid;
    exception when others then v_erro := sqlerrm;
    end;
    if v_erro is null then
      raise exception 'FALHA: DELETE em movimento_estoque foi ACEITO';
    end if;

    -- Sem isto, "o saldo sempre tem explicação" dependeria de ninguém escrever
    -- o `update` que resolve o problema mais rápido. Alguém sempre escreve.
    raise notice 'caso 5 OK — movimento não aceita UPDATE nem DELETE';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 6: ajuste e perda exigem motivo
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_peca = :'pc';
  set local app.teste_dep  = :'dep';

  do $$
  declare v_erro text := null;
  begin
    begin
      insert into public.movimento_estoque
        (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario)
      values (app.tenant_atual(), current_setting('app.teste_peca')::uuid,
              current_setting('app.teste_dep')::uuid, 'AJUSTE_INVENTARIO', -1, 30.0000);
    exception when others then v_erro := sqlerrm;
    end;

    if v_erro is null then
      raise exception 'FALHA: ajuste de inventário sem motivo foi aceito';
    end if;

    -- Ajuste e perda são exatamente os dois movimentos que alguém vai auditar.
    insert into public.movimento_estoque
      (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario, motivo)
    values (app.tenant_atual(), current_setting('app.teste_peca')::uuid,
            current_setting('app.teste_dep')::uuid, 'AJUSTE_INVENTARIO', -1, 30.0000,
            'divergência apurada no inventário cíclico de novembro');

    raise notice 'caso 6 OK — ajuste e perda exigem motivo legível';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 7: reserva não é baixa
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_peca = :'pc';

  do $$
  declare v_fisico numeric; v_disp numeric; v_erro text := null;
  begin
    update public.saldo_estoque set quantidade_reservada = 4
     where peca_id = current_setting('app.teste_peca')::uuid;

    select quantidade_fisica, quantidade_disponivel into v_fisico, v_disp
      from public.saldo_estoque where peca_id = current_setting('app.teste_peca')::uuid;

    -- A peça reservada ainda está na prateleira: físico não muda.
    if v_fisico <> 14 then
      raise exception 'FALHA: reserva alterou o saldo físico para %', v_fisico;
    end if;
    -- E ainda assim não está disponível para outra OS.
    if v_disp <> 10 then
      raise exception 'FALHA: disponível % (esperado 14 - 4 = 10)', v_disp;
    end if;

    -- Disponível é gerado: não há como escrevê-lo e prometer peça inexistente.
    begin
      update public.saldo_estoque set quantidade_disponivel = 99
       where peca_id = current_setting('app.teste_peca')::uuid;
    exception when others then v_erro := sqlerrm;
    end;
    if v_erro is null then
      raise exception 'FALHA: quantidade_disponivel aceitou escrita direta';
    end if;

    raise notice 'caso 7 OK — reserva compromete sem baixar, e disponível é derivado';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 8: não se reserva o que não existe
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_peca = :'pc';

  do $$
  declare v_erro text := null;
  begin
    begin
      update public.saldo_estoque set quantidade_reservada = 999
       where peca_id = current_setting('app.teste_peca')::uuid;
    exception when others then v_erro := sqlerrm;
    end;
    if v_erro is null then
      raise exception 'FALHA: reserva maior que o físico foi aceita';
    end if;
    -- Prometer a mesma peça duas vezes é o defeito mais caro deste módulo:
    -- só aparece no dia da visita, com o técnico já no cliente.
    raise notice 'caso 8 OK — não se reserva mais do que existe';
  end $$;
commit;

reset role;

-- ---------------------------------------------------------------- limpeza
--
-- O gatilho de imutabilidade recusa o `delete`, e está certo: é a regra que o
-- caso 5 acabou de provar. A limpeza o desliga de propósito, como
-- superusuário, pelo tempo de remover a massa — e volta a ligá-lo.
--
-- Vale dizer o que **não** se faz aqui: abrir uma exceção no gatilho para
-- "limpeza". Uma condição dessas no código de produção é a porta pela qual a
-- imutabilidade deixa de valer, e quem a usar não vai se chamar de teste.
alter table public.movimento_estoque disable trigger movimento_sem_update;
delete from public.movimento_estoque where tenant_id = :'t1';
alter table public.movimento_estoque enable trigger movimento_sem_update;
delete from public.saldo_estoque      where tenant_id = :'t1';
delete from public.os_peca            where tenant_id = :'t1';
delete from public.politica_reposicao where tenant_id = :'t1';
delete from public.peca_aplicacao     where tenant_id = :'t1';
delete from public.peca               where tenant_id = :'t1';
delete from public.deposito           where tenant_id = :'t1';
delete from public.audit_log          where tenant_id = :'t1';
delete from public.usuario            where tenant_id = :'t1';
delete from public.filial             where tenant_id = :'t1';
delete from public.empresa            where tenant_id = :'t1';
delete from public.perfil             where tenant_id = :'t1';
delete from public.categoria_despesa  where tenant_id = :'t1';
delete from public.tenant             where id = :'t1';

\echo '== 20_est_estoque: TODOS OS CASOS APROVADOS =='
