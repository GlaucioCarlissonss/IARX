-- =============================================================================
-- TESTE ADM — reabertura de competência e coerência da alçada
--
-- Entre a 0033 e a 0036, cinco alçadas que dormiam na estrutura passaram a
-- valer. Esta é a sexta, e é a que o Anexo B §B.6 escreve explicitamente:
-- "Competência | FECHADA | Sim, apenas por alçada (REABERTA)".
--
-- O que estes casos protegem:
--
--  · cobrança aprovada bloqueia a reabertura. É o que o comentário da 0013
--    diz com outras palavras: depois de aprovado, o título é o que o cliente
--    recebeu, e reabrir o consumo por trás dele faria a cobrança e a medição
--    divergirem sem que nada acusasse;
--  · a alçada mede o **valor da competência** — reabrir um mês de meio milhão
--    não é a mesma decisão que reabrir um de dois mil;
--  · a alçada tem de ser do tipo certo. Um teto percentual em `CUSTO_OS` não é
--    lido por ninguém, e quem o cadastrar vai acreditar que configurou a
--    regra. Alçada que existe e não vale é pior que alçada ausente, porque
--    ninguém procura o que acha que já fez.
-- =============================================================================
\set ON_ERROR_STOP on

select gen_random_uuid() as t1, gen_random_uuid() as emp, gen_random_uuid() as fil,
       gen_random_uuid() as cli, gen_random_uuid() as cat, gen_random_uuid() as fab,
       gen_random_uuid() as mod, gen_random_uuid() as eq, gen_random_uuid() as ct,
       gen_random_uuid() as med, gen_random_uuid() as usr, gen_random_uuid() as perf
\gset

insert into public.tenant (id, nome) values (:'t1', 'Locadora ADM');
insert into public.empresa (id, tenant_id, razao_social) values (:'emp', :'t1', 'ADM LTDA');
insert into public.filial (id, tenant_id, empresa_id, codigo, nome)
  values (:'fil', :'t1', :'emp', 'ADM-01', 'Base ADM');
insert into public.cliente (id, tenant_id, documento, razao_social)
  values (:'cli', :'t1', '55000000000479', 'Cliente ADM');
insert into public.categoria_equipamento (id, tenant_id, codigo, nome, tipo_medidor_padrao)
  values (:'cat', :'t1', 'MFP', 'Multifuncional', 'CONTADOR');
insert into public.fabricante (id, tenant_id, nome) values (:'fab', :'t1', 'Fabricante ADM');
insert into public.modelo (id, tenant_id, fabricante_id, categoria_id, codigo, nome)
  values (:'mod', :'t1', :'fab', :'cat', 'A-1', 'Modelo ADM');
insert into public.equipamento (id, tenant_id, patrimonio, modelo_id, categoria_id, filial_id)
  values (:'eq', :'t1', 'ADM-0001', :'mod', :'cat', :'fil');

insert into public.usuario (id, tenant_id, email, nome)
  values (:'usr', :'t1', 'supervisor.adm@exemplo.local', 'Supervisor ADM');
insert into public.perfil (id, tenant_id, nome, permissoes)
  values (:'perf', :'t1', 'Supervisor ADM', array['competencia:fechar']);
insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo)
  values (:'t1', :'usr', :'perf', 'TENANT');

insert into public.contrato (id, tenant_id, numero, empresa_id, filial_id, cliente_id,
                             status, data_inicio, data_fim)
  values (:'ct', :'t1', 'ADM-2026-001', :'emp', :'fil', :'cli', 'ATIVO', '2026-01-01', '2026-12-31');

set role iarx_app;

-- ---------------------------------------------------------------- caso 1: reabrir o que está aberto não é erro
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';

  do $$
  declare v_n integer;
  begin
    v_n := app.reabrir_competencia('2026-03');
    if v_n <> 0 then
      raise exception 'FALHA: reabriu % consumo(s) numa competência sem nada fechado', v_n;
    end if;
    -- Zero é "não havia nada fechado", que é diferente de falha. Levantar aqui
    -- faria a tela precisar distinguir dois erros que não são erro nenhum.
    raise notice 'caso 1 OK — reabrir o que já está aberto não levanta';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 2: reabre o consumo selado
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_eq   = :'eq';
  set local app.teste_cli  = :'cli';

  do $$
  declare v_n integer; v_fechado timestamptz;
  begin
    insert into public.consumo_competencia
      (tenant_id, competencia, equipamento_id, cliente_id,
       leitura_inicial_mono, leitura_final_mono, fechado_em, fechado_por)
    values (app.tenant_atual(), '2026-04', current_setting('app.teste_eq')::uuid,
            current_setting('app.teste_cli')::uuid, 1000, 4200,
            now(), current_setting('app.usuario_id')::uuid);

    v_n := app.reabrir_competencia('2026-04');
    if v_n <> 1 then
      raise exception 'FALHA: esperado 1 consumo reaberto, veio %', v_n;
    end if;

    select fechado_em into v_fechado from public.consumo_competencia
     where competencia = '2026-04';
    if v_fechado is not null then
      raise exception 'FALHA: o selo não saiu';
    end if;
    raise notice 'caso 2 OK — a reabertura tira o selo do consumo';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 3: cobrança aprovada bloqueia
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_cli  = :'cli';
  set local app.teste_fil  = :'fil';
  set local app.teste_ct   = :'ct';
  set local app.teste_eq   = :'eq';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    insert into public.consumo_competencia
      (tenant_id, competencia, equipamento_id, cliente_id,
       leitura_inicial_mono, leitura_final_mono, fechado_em, fechado_por)
    values (app.tenant_atual(), '2026-05', current_setting('app.teste_eq')::uuid,
            current_setting('app.teste_cli')::uuid, 4200, 7000,
            now(), current_setting('app.usuario_id')::uuid);

    insert into public.titulo_receber
      (tenant_id, numero_titulo, cliente_id, filial_id, contrato_id, competencia,
       origem, descricao, valor_original, data_emissao, data_vencimento, status)
    values (app.tenant_atual(), 9000001, current_setting('app.teste_cli')::uuid,
            current_setting('app.teste_fil')::uuid, current_setting('app.teste_ct')::uuid,
            '2026-05', 'CONTRATUAL', 'locacao 05/2026', 1500.0000,
            '2026-06-01', '2026-06-10', 'APROVADO');

    begin
      perform app.reabrir_competencia('2026-05');
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;

    if v_erro is null then
      raise exception 'FALHA: reabriu competência com cobrança aprovada';
    end if;
    if v_constraint <> 'competencia_com_cobranca_aprovada' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;
    /*
     * Depois de aprovado, o título é o que o cliente recebeu. Reabrir o consumo
     * por trás dele faria a cobrança e a medição divergirem sem que nada
     * acusasse — e a correção prevista para esse caso é estorno com ajuste na
     * competência seguinte.
     */
    raise notice 'caso 3 OK — cobrança aprovada bloqueia a reabertura';
  end $$;
commit;

reset role;

-- O locatário configura a alçada: este perfil reabre competência de até R$ 1.000.
insert into public.alcada (tenant_id, perfil_id, tipo, limite_valor)
  values (:'t1', :'perf', 'REABERTURA_COMPETENCIA', 1000.0000);

set role iarx_app;

-- ---------------------------------------------------------------- caso 4: a alçada mede o valor da competência
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_cli  = :'cli';
  set local app.teste_fil  = :'fil';
  set local app.teste_ct   = :'ct';
  set local app.teste_eq   = :'eq';

  do $$
  declare v_erro text := null; v_constraint text := null; v_n integer;
  begin
    insert into public.consumo_competencia
      (tenant_id, competencia, equipamento_id, cliente_id,
       leitura_inicial_mono, leitura_final_mono, fechado_em, fechado_por)
    values (app.tenant_atual(), '2026-06', current_setting('app.teste_eq')::uuid,
            current_setting('app.teste_cli')::uuid, 7000, 9000,
            now(), current_setting('app.usuario_id')::uuid);

    -- Cobrança pendente de aprovação não bloqueia, mas entra no valor.
    insert into public.titulo_receber
      (tenant_id, numero_titulo, cliente_id, filial_id, contrato_id, competencia,
       origem, descricao, valor_original, data_emissao, data_vencimento, status)
    values (app.tenant_atual(), 9000002, current_setting('app.teste_cli')::uuid,
            current_setting('app.teste_fil')::uuid, current_setting('app.teste_ct')::uuid,
            '2026-06', 'CONTRATUAL', 'locacao 06/2026', 4500.0000,
            '2026-07-01', '2026-07-10', 'PENDENTE_APROVACAO');

    begin
      perform app.reabrir_competencia('2026-06');
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: reabriu competência de 4500 com alçada de 1000';
    end if;
    if v_constraint <> 'competencia_acima_da_alcada' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;

    -- A competência menor, dentro do teto, reabre.
    insert into public.consumo_competencia
      (tenant_id, competencia, equipamento_id, cliente_id,
       leitura_inicial_mono, leitura_final_mono, fechado_em, fechado_por)
    values (app.tenant_atual(), '2026-07', current_setting('app.teste_eq')::uuid,
            current_setting('app.teste_cli')::uuid, 9000, 9400,
            now(), current_setting('app.usuario_id')::uuid);

    insert into public.titulo_receber
      (tenant_id, numero_titulo, cliente_id, filial_id, contrato_id, competencia,
       origem, descricao, valor_original, data_emissao, data_vencimento, status)
    values (app.tenant_atual(), 9000003, current_setting('app.teste_cli')::uuid,
            current_setting('app.teste_fil')::uuid, current_setting('app.teste_ct')::uuid,
            '2026-07', 'CONTRATUAL', 'locacao 07/2026', 500.0000,
            '2026-08-01', '2026-08-10', 'PENDENTE_APROVACAO');

    v_n := app.reabrir_competencia('2026-07');
    if v_n <> 1 then
      raise exception 'FALHA: competência de 500 dentro do teto reabriu % consumo(s)', v_n;
    end if;
    raise notice 'caso 4 OK — a alçada mede o valor da competência';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 5: alçada com o limite errado para o tipo
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_perf = :'perf';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    begin
      insert into public.alcada (tenant_id, perfil_id, tipo, limite_percentual)
      values (app.tenant_atual(), current_setting('app.teste_perf')::uuid, 'CUSTO_OS', 15.00);
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: alçada de custo de OS aceitou teto percentual';
    end if;
    if v_constraint <> 'alcada_tipo_exige_valor' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;

    v_erro := null;
    begin
      insert into public.alcada (tenant_id, perfil_id, tipo, limite_valor)
      values (app.tenant_atual(), current_setting('app.teste_perf')::uuid, 'DESCONTO', 500.0000);
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: alçada de desconto aceitou teto em reais';
    end if;
    if v_constraint <> 'alcada_desconto_percentual' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;
    /*
     * `alcada_tem_limite` já exigia **algum** dos dois. O que faltava é que
     * fosse o certo para o tipo: um teto percentual em `CUSTO_OS` não é lido
     * por ninguém, e quem o cadastra acredita ter configurado a regra.
     */
    raise notice 'caso 5 OK — o limite tem de ser do tipo que a regra lê';
  end $$;
commit;

reset role;

-- ---------------------------------------------------------------- limpeza
delete from public.titulo_receber      where tenant_id = :'t1';
-- O gatilho que recusa apagar consumo selado é o que a 0013 instalou, e a
-- reabertura do caso 3 foi recusada de propósito: a linha continua fechada.
alter table public.consumo_competencia disable trigger cc_competencia_imutavel;
delete from public.consumo_competencia where tenant_id = :'t1';
alter table public.consumo_competencia enable trigger cc_competencia_imutavel;
delete from public.contrato            where tenant_id = :'t1';
delete from public.equipamento         where tenant_id = :'t1';
delete from public.modelo              where tenant_id = :'t1';
delete from public.fabricante          where tenant_id = :'t1';
delete from public.categoria_equipamento where tenant_id = :'t1';
delete from public.audit_log           where tenant_id = :'t1';
delete from public.usuario_perfil      where tenant_id = :'t1';
delete from public.alcada              where tenant_id = :'t1';
delete from public.usuario             where tenant_id = :'t1';
delete from public.cliente             where tenant_id = :'t1';
delete from public.filial              where tenant_id = :'t1';
delete from public.empresa             where tenant_id = :'t1';
delete from public.perfil              where tenant_id = :'t1';
delete from public.categoria_despesa   where tenant_id = :'t1';
delete from public.tenant              where id = :'t1';

\echo '== 29_adm_reabertura_e_alcada: TODOS OS CASOS APROVADOS =='
