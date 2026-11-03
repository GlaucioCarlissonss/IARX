-- =============================================================================
-- TESTE EST — ordem de compra e inventário (Anexo A.7, D.6)
--
-- As duas pontas do eixo de estoque: a reposição entra por ordem de compra, a
-- correção da contagem sai por inventário.
--
-- Os status das duas entidades são **derivados** das operações do Anexo D.6 —
-- o Anexo B não traz máquina para nenhuma delas, ao contrário de contrato, OS,
-- equipamento e reserva de peça. O que estes casos provam não é o vocabulário
-- escolhido; é o conjunto de invariantes que qualquer vocabulário teria de
-- sustentar:
--
--  · ordem aprovada não tem item alterado — a alçada validou um valor, e mudar
--    o item depois faria a ordem chegar com outro;
--  · o recebimento não passa do pedido: receber a mais é divergência de nota,
--    e o lugar dela é a entrada fiscal, não um número que cresce em silêncio;
--  · o saldo do sistema é congelado **na contagem**, não na aprovação. Sem
--    isso, toda movimentação ocorrida no meio vira divergência de contagem e o
--    ajuste corrige para um número que já não corresponde a nada;
--  · aprovar o inventário gera os ajustes em lote, e um ajuste acima da alçada
--    derruba a aprovação inteira — aprovar metade deixaria o saldo numa
--    combinação que ninguém contou.
-- =============================================================================
\set ON_ERROR_STOP on

select gen_random_uuid() as t1, gen_random_uuid() as emp, gen_random_uuid() as fil,
       gen_random_uuid() as dep, gen_random_uuid() as forn,
       gen_random_uuid() as p1, gen_random_uuid() as p2,
       gen_random_uuid() as usr, gen_random_uuid() as perf,
       gen_random_uuid() as oc, gen_random_uuid() as inv
\gset

insert into public.tenant (id, nome) values (:'t1', 'Locadora OCI');
insert into public.empresa (id, tenant_id, razao_social) values (:'emp', :'t1', 'OCI LTDA');
insert into public.filial (id, tenant_id, empresa_id, codigo, nome)
  values (:'fil', :'t1', :'emp', 'OCI-01', 'Base OCI');
insert into public.deposito (id, tenant_id, filial_id, codigo, nome, tipo)
  values (:'dep', :'t1', :'fil', 'OCI-D1', 'Almoxarifado OCI', 'ALMOXARIFADO');
insert into public.fornecedor (id, tenant_id, documento, razao_social)
  values (:'forn', :'t1', '11444777000161', 'Fornecedor OCI');
insert into public.peca (id, tenant_id, codigo_interno, descricao, unidade) values
  (:'p1', :'t1', 'TONER-01', 'Toner preto',    'UN'),
  (:'p2', :'t1', 'ROLO-01',  'Rolo de pressao', 'UN');

insert into public.usuario (id, tenant_id, email, nome)
  values (:'usr', :'t1', 'compras.oci@exemplo.local', 'Comprador OCI');
insert into public.perfil (id, tenant_id, nome, permissoes)
  values (:'perf', :'t1', 'Comprador OCI', array['ordem_compra:criar']);
insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo)
  values (:'t1', :'usr', :'perf', 'TENANT');
-- Teto de R$ 5.000 para aprovar compra, e de R$ 1.000 para ajustar inventário.
-- Os dois valores são escolhidos para o caso 7 passar com folga e o caso 8
-- reprovar com folga: um teto justo demais faria o teste depender da terceira
-- casa de um custo médio móvel, e qualquer mexida na massa o quebraria sem que
-- nada de errado tivesse acontecido.
insert into public.alcada (tenant_id, perfil_id, tipo, limite_valor) values
  (:'t1', :'perf', 'ORDEM_COMPRA', 5000.0000),
  (:'t1', :'perf', 'AJUSTE_INVENTARIO', 1000.0000);

set role iarx_app;

-- ---------------------------------------------------------------- caso 1: ordem vazia não é aprovada
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_oc   = :'oc';
  set local app.teste_forn = :'forn';
  set local app.teste_dep  = :'dep';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    insert into public.ordem_compra (id, tenant_id, numero, fornecedor_id, deposito_id)
    values (current_setting('app.teste_oc')::uuid, app.tenant_atual(), 'OC-2026-0001',
            current_setting('app.teste_forn')::uuid, current_setting('app.teste_dep')::uuid);

    begin
      update public.ordem_compra set status = 'APROVADA'
       where id = current_setting('app.teste_oc')::uuid;
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: ordem sem item foi aprovada';
    end if;
    if v_constraint <> 'oc_sem_item' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;
    -- Aprovar uma ordem vazia compromete alçada sobre valor nenhum.
    raise notice 'caso 1 OK — ordem sem item não é aprovada';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 2: alçada sobre o valor da ordem
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_oc   = :'oc';
  set local app.teste_p1   = :'p1';

  do $$
  declare v_erro text := null; v_constraint text := null; v_status app.ordem_compra_status;
  begin
    -- 100 × 80 = 8.000, acima do teto de 5.000.
    insert into public.ordem_compra_item
      (tenant_id, ordem_compra_id, peca_id, quantidade_pedida, preco_unitario)
    values (app.tenant_atual(), current_setting('app.teste_oc')::uuid,
            current_setting('app.teste_p1')::uuid, 100, 80.0000);

    begin
      update public.ordem_compra set status = 'APROVADA'
       where id = current_setting('app.teste_oc')::uuid;
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: ordem de 8000 foi aprovada com teto de 5000';
    end if;
    if v_constraint <> 'oc_acima_da_alcada' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;

    -- Reduzida para 40 × 80 = 3.200, passa.
    update public.ordem_compra_item set quantidade_pedida = 40
     where ordem_compra_id = current_setting('app.teste_oc')::uuid;
    update public.ordem_compra set status = 'APROVADA'
     where id = current_setting('app.teste_oc')::uuid;

    select status into v_status from public.ordem_compra
     where id = current_setting('app.teste_oc')::uuid;
    if v_status <> 'APROVADA' then
      raise exception 'FALHA: ordem dentro do teto não aprovou (status %)', v_status;
    end if;
    -- Quinta alçada que já existia na estrutura e não era lida.
    raise notice 'caso 2 OK — a alçada mede o valor da ordem';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 3: item não muda depois de aprovado
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_oc   = :'oc';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    begin
      update public.ordem_compra_item set preco_unitario = 10.0000
       where ordem_compra_id = current_setting('app.teste_oc')::uuid;
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: preço mudou depois da aprovação';
    end if;
    if v_constraint <> 'oc_item_apos_aprovacao' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;
    /*
     * A alçada aprovou um valor. Mudar o item depois faria a ordem chegar com
     * outro — e a aprovação continuaria registrada como se tivesse validado
     * este.
     */
    raise notice 'caso 3 OK — item não muda depois da aprovação';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 4: recebimento não passa do pedido
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_oc   = :'oc';
  set local app.teste_p1   = :'p1';

  do $$
  declare v_erro text := null; v_status app.ordem_compra_status; v_fis numeric; v_mov integer;
  begin
    -- Recebimento parcial: 10 das 40.
    update public.ordem_compra_item set quantidade_recebida = 10
     where ordem_compra_id = current_setting('app.teste_oc')::uuid;

    /*
     * Receber e dar entrada no estoque são o mesmo fato. Separá-los criaria o
     * estado em que a ordem diz que chegou e o estoque diz que não — e essa
     * divergência só apareceria no inventário seguinte, sem como atribuí-la a
     * nenhum recebimento.
     */
    select count(*) into v_mov from public.movimento_estoque
     where ordem_compra_id = current_setting('app.teste_oc')::uuid;
    if v_mov <> 1 then
      raise exception 'FALHA: esperado 1 movimento de entrada, vieram %', v_mov;
    end if;

    select quantidade_fisica into v_fis from public.saldo_estoque
     where peca_id = current_setting('app.teste_p1')::uuid;
    if v_fis <> 10 then
      raise exception 'FALHA: saldo após recebimento veio % (esperado 10)', v_fis;
    end if;

    -- E o status da ordem acompanha, derivado dos itens.
    select status into v_status from public.ordem_compra
     where id = current_setting('app.teste_oc')::uuid;
    if v_status <> 'PARCIALMENTE_RECEBIDA' then
      raise exception 'FALHA: status após recebimento parcial veio %', v_status;
    end if;

    begin
      update public.ordem_compra_item set quantidade_recebida = 41
       where ordem_compra_id = current_setting('app.teste_oc')::uuid;
    exception when others then v_erro := sqlerrm;
    end;
    if v_erro is null then
      raise exception 'FALHA: recebeu 41 de uma ordem de 40';
    end if;
    -- Receber a mais é divergência de nota, e o lugar dela é a entrada fiscal.
    raise notice 'caso 4 OK — recebimento dá entrada no estoque e não passa do pedido';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 5: contagem congela o saldo do sistema
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_dep  = :'dep';
  set local app.teste_p1   = :'p1';
  set local app.teste_inv  = :'inv';

  do $$
  declare v_div numeric; v_sis numeric;
  begin
    -- Mais vinte unidades a R$ 50, sobre as dez que o recebimento trouxe.
    insert into public.movimento_estoque
      (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario, registrado_por)
    values (app.tenant_atual(), current_setting('app.teste_p1')::uuid,
            current_setting('app.teste_dep')::uuid, 'ENTRADA_COMPRA', 20, 50.0000,
            current_setting('app.usuario_id')::uuid);

    insert into public.inventario (id, tenant_id, deposito_id, tipo)
    values (current_setting('app.teste_inv')::uuid, app.tenant_atual(),
            current_setting('app.teste_dep')::uuid, 'CICLICO');

    insert into public.inventario_contagem
      (tenant_id, inventario_id, peca_id, saldo_sistema, saldo_contado,
       contado_por, justificativa)
    select app.tenant_atual(), current_setting('app.teste_inv')::uuid,
           current_setting('app.teste_p1')::uuid,
           s.quantidade_fisica, 18,
           current_setting('app.usuario_id')::uuid,
           'duas unidades nao localizadas na prateleira'
      from public.saldo_estoque s
     where s.peca_id = current_setting('app.teste_p1')::uuid;

    -- Entre contar e aprovar, o estoque se move: mais cinco entram.
    insert into public.movimento_estoque
      (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario, registrado_por)
    values (app.tenant_atual(), current_setting('app.teste_p1')::uuid,
            current_setting('app.teste_dep')::uuid, 'ENTRADA_COMPRA', 5, 50.0000,
            current_setting('app.usuario_id')::uuid);

    select saldo_sistema, divergencia into v_sis, v_div
      from public.inventario_contagem
     where inventario_id = current_setting('app.teste_inv')::uuid;

    /*
     * O saldo gravado continua 30, e a divergência continua −12. Se o sistema
     * recalculasse na aprovação, a divergência viraria −17 e o ajuste tiraria
     * cinco unidades que acabaram de entrar — "corrigindo" o estoque para um
     * número que ninguém contou.
     */
    if v_sis <> 30 or v_div <> -12 then
      raise exception 'FALHA: esperado sistema 30 e divergência -12, veio % e %', v_sis, v_div;
    end if;
    raise notice 'caso 5 OK — o saldo do sistema é congelado na contagem';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 6: divergência sem justificativa
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_inv  = :'inv';
  set local app.teste_p2   = :'p2';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    insert into public.inventario_contagem
      (tenant_id, inventario_id, peca_id, saldo_sistema, saldo_contado, contado_por)
    values (app.tenant_atual(), current_setting('app.teste_inv')::uuid,
            current_setting('app.teste_p2')::uuid, 0, 3,
            current_setting('app.usuario_id')::uuid);

    begin
      update public.inventario set status = 'CONTADO'
       where id = current_setting('app.teste_inv')::uuid;
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: inventário fechou com divergência sem justificativa';
    end if;
    if v_constraint <> 'inv_divergencia_sem_justificativa' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;

    update public.inventario_contagem
       set justificativa = 'tres unidades recebidas sem lancamento de entrada'
     where inventario_id = current_setting('app.teste_inv')::uuid
       and peca_id = current_setting('app.teste_p2')::uuid;

    update public.inventario set status = 'CONTADO'
     where id = current_setting('app.teste_inv')::uuid;
    raise notice 'caso 6 OK — divergência exige justificativa antes do fechamento';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 7: aprovar gera os ajustes em lote
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_inv  = :'inv';
  set local app.teste_p1   = :'p1';

  do $$
  declare v_mov integer; v_fis numeric; v_ligados integer;
  begin
    update public.inventario set status = 'APROVADO'
     where id = current_setting('app.teste_inv')::uuid;

    select count(*) into v_mov from public.movimento_estoque
     where inventario_id = current_setting('app.teste_inv')::uuid;
    if v_mov <> 2 then
      raise exception 'FALHA: esperados 2 ajustes, vieram %', v_mov;
    end if;

    -- 10 do recebimento + 20 + 5 de entrada, menos 12 do ajuste = 23.
    select quantidade_fisica into v_fis from public.saldo_estoque
     where peca_id = current_setting('app.teste_p1')::uuid;
    if v_fis <> 23 then
      raise exception 'FALHA: saldo físico ficou % (esperado 23)', v_fis;
    end if;

    -- Cada contagem divergente aponta para o movimento que a corrigiu: é o que
    -- liga a linha do extrato à pessoa que contou e ao que ela escreveu.
    select count(*) into v_ligados from public.inventario_contagem
     where inventario_id = current_setting('app.teste_inv')::uuid
       and movimento_ajuste_id is not null;
    if v_ligados <> 2 then
      raise exception 'FALHA: % contagem(ns) ligada(s) ao ajuste (esperado 2)', v_ligados;
    end if;
    raise notice 'caso 7 OK — aprovar gera os ajustes e os liga à contagem';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 8: ajuste acima da alçada derruba a aprovação
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_dep  = :'dep';
  set local app.teste_p1   = :'p1';

  do $$
  declare
    v_erro text := null; v_constraint text := null;
    v_inv uuid := gen_random_uuid(); v_n integer;
  begin
    insert into public.inventario (id, tenant_id, deposito_id, tipo)
    values (v_inv, app.tenant_atual(), current_setting('app.teste_dep')::uuid, 'GERAL');

    -- Divergência de 21 unidades ao custo médio (~58,57) = ~1.230, acima do
    -- teto de 1.000.
    insert into public.inventario_contagem
      (tenant_id, inventario_id, peca_id, saldo_sistema, saldo_contado,
       contado_por, justificativa)
    values (app.tenant_atual(), v_inv, current_setting('app.teste_p1')::uuid,
            23, 2, current_setting('app.usuario_id')::uuid,
            'vinte e uma unidades nao localizadas em contagem geral');

    update public.inventario set status = 'CONTADO' where id = v_inv;

    begin
      update public.inventario set status = 'APROVADO' where id = v_inv;
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: ajuste acima do teto de 1000 foi aprovado';
    end if;
    if v_constraint <> 'estoque_ajuste_acima_da_alcada' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;

    -- E nenhum ajuste parcial ficou: aprovar metade deixaria o saldo numa
    -- combinação que ninguém contou.
    select count(*) into v_n from public.movimento_estoque where inventario_id = v_inv;
    if v_n <> 0 then
      raise exception 'FALHA: % ajuste(s) sobreviveram à recusa', v_n;
    end if;
    raise notice 'caso 8 OK — um ajuste acima da alçada derruba a aprovação inteira';
  end $$;
commit;

reset role;

-- ---------------------------------------------------------------- limpeza
alter table public.movimento_estoque disable trigger movimento_sem_update;
delete from public.movimento_estoque where tenant_id = :'t1';
alter table public.movimento_estoque enable trigger movimento_sem_update;

alter table public.inventario_contagem disable trigger inv_contagem_valida;
delete from public.inventario_contagem where tenant_id = :'t1';
alter table public.inventario_contagem enable trigger inv_contagem_valida;

alter table public.ordem_compra_item disable trigger oci_valida_edicao;
delete from public.ordem_compra_item where tenant_id = :'t1';
alter table public.ordem_compra_item enable trigger oci_valida_edicao;

delete from public.inventario    where tenant_id = :'t1';
delete from public.ordem_compra  where tenant_id = :'t1';
delete from public.saldo_estoque where tenant_id = :'t1';
delete from public.peca          where tenant_id = :'t1';
delete from public.deposito      where tenant_id = :'t1';
delete from public.fornecedor    where tenant_id = :'t1';
delete from public.audit_log     where tenant_id = :'t1';
delete from public.usuario_perfil where tenant_id = :'t1';
delete from public.alcada        where tenant_id = :'t1';
delete from public.usuario       where tenant_id = :'t1';
delete from public.filial        where tenant_id = :'t1';
delete from public.empresa       where tenant_id = :'t1';
delete from public.perfil        where tenant_id = :'t1';
delete from public.categoria_despesa where tenant_id = :'t1';
delete from public.tenant        where id = :'t1';

\echo '== 28_est_compra_e_inventario: TODOS OS CASOS APROVADOS =='
