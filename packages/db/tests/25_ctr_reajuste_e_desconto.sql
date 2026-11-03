-- =============================================================================
-- TESTE CTR — reajuste (RN-008) e alçada de desconto no contrato (RN-009)
--
-- Duas regras do mesmo módulo que dependiam de estrutura que já existia e não
-- era consultada de um dos dois lados.
--
-- RN-009 vale para "CTR, FAT". A alçada de desconto entrou na 0020 e passou a
-- valer no título a receber; no item de contrato, nada conferia. O efeito é
-- maior desse lado, não menor: desconto em título é uma cobrança, desconto em
-- item se repete em toda competência até o fim da vigência.
--
-- RN-008 é a régua de reajuste. O que estes casos protegem:
--
--  · a regra de arredondamento — duas casas, meio para cima, no **unitário**
--    antes de multiplicar pela quantidade. Inverter a ordem produz centavos por
--    item que o cliente encontra ao recalcular;
--  · reajuste nasce proposta e aplicar exige passar por aprovação;
--  · renunciar é um estado com motivo, não um apagamento: reajuste não aplicado
--    é receita renunciada, e some do indicador se a linha sumir.
-- =============================================================================
\set ON_ERROR_STOP on

select gen_random_uuid() as t1, gen_random_uuid() as emp, gen_random_uuid() as fil,
       gen_random_uuid() as cli, gen_random_uuid() as cat, gen_random_uuid() as fab,
       gen_random_uuid() as mod, gen_random_uuid() as ct, gen_random_uuid() as ct2,
       gen_random_uuid() as eq1, gen_random_uuid() as eq2,
       gen_random_uuid() as perf, gen_random_uuid() as usr
\gset

insert into public.tenant (id, nome) values (:'t1', 'Locadora RJT');
insert into public.empresa (id, tenant_id, razao_social) values (:'emp', :'t1', 'RJT LTDA');
insert into public.filial (id, tenant_id, empresa_id, codigo, nome)
  values (:'fil', :'t1', :'emp', 'RJT-01', 'Base RJT');
insert into public.cliente (id, tenant_id, documento, razao_social)
  values (:'cli', :'t1', '55000000000398', 'Cliente RJT');
insert into public.categoria_equipamento (id, tenant_id, codigo, nome)
  values (:'cat', :'t1', 'MFP', 'Multifuncional');
insert into public.fabricante (id, tenant_id, nome) values (:'fab', :'t1', 'Fabricante RJT');
insert into public.modelo (id, tenant_id, fabricante_id, categoria_id, codigo, nome)
  values (:'mod', :'t1', :'fab', :'cat', 'R-1', 'Modelo RJT');
insert into public.equipamento (id, tenant_id, patrimonio, modelo_id, categoria_id, filial_id)
values (:'eq1', :'t1', 'RJT-0001', :'mod', :'cat', :'fil'),
       (:'eq2', :'t1', 'RJT-0002', :'mod', :'cat', :'fil');

insert into public.contrato (id, tenant_id, numero, empresa_id, filial_id, cliente_id,
                             status, data_inicio, data_fim, indice_reajuste,
                             periodicidade_reajuste_meses, mes_base_reajuste)
values (:'ct',  :'t1', 'RJT-2026-001', :'emp', :'fil', :'cli', 'RASCUNHO',
        '2026-01-01', '2027-12-31', 'IPCA', 12, 1),
       (:'ct2', :'t1', 'RJT-2026-002', :'emp', :'fil', :'cli', 'RASCUNHO',
        '2026-01-01', '2027-12-31', 'IGPM', 12, 1);

-- Perfil com teto de desconto de 5% (o padrão de operador em RN-009), e um
-- usuário que o carrega. O teto é dado do locatário, não do código.
insert into public.perfil (id, tenant_id, nome, permissoes)
  values (:'perf', :'t1', 'Operador RJT', array['contrato:item_alocar']);
insert into public.alcada (tenant_id, perfil_id, tipo, limite_percentual)
  values (:'t1', :'perf', 'DESCONTO', 5.00);
insert into public.usuario (id, tenant_id, email, nome)
  values (:'usr', :'t1', 'operador.rjt@exemplo.local', 'Operador RJT');
insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo)
  values (:'t1', :'usr', :'perf', 'TENANT');

set role iarx_app;

-- ---------------------------------------------------------------- caso 1: desconto dentro da alçada
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_ct   = :'ct';
  set local app.teste_eq1  = :'eq1';

  do $$
  declare v_d numeric;
  begin
    insert into public.contrato_item
      (tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
       valor_unitario, quantidade, desconto_percentual, desconto_motivo,
       vigencia_inicio, vigencia_fim)
    values (app.tenant_atual(), current_setting('app.teste_ct')::uuid,
            current_setting('app.teste_eq1')::uuid, 'FIXO_MENSAL', 289.3300, 1,
            5.00, 'renovacao antecipada negociada', '2026-01-01', '2027-12-31');

    select desconto_percentual into v_d from public.contrato_item
     where contrato_id = current_setting('app.teste_ct')::uuid;
    if v_d <> 5.00 then
      raise exception 'FALHA: desconto dentro da alçada não foi gravado (%)', v_d;
    end if;

    -- Ativa o contrato: item PLANEJADO → RESERVADO, e o ativo vai junto para
    -- RESERVADO (efeito da 0029). Só item contratado entra na base do reajuste
    -- — proposta sobre rascunho reajustaria o que ninguém assinou.
    update public.contrato set status = 'EM_APROVACAO'          where id = current_setting('app.teste_ct')::uuid;
    update public.contrato set status = 'AGUARDANDO_ASSINATURA' where id = current_setting('app.teste_ct')::uuid;
    update public.contrato set status = 'ATIVO'                 where id = current_setting('app.teste_ct')::uuid;

    raise notice 'caso 1 OK — desconto no teto do perfil passa';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 2: desconto acima da alçada
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_ct2  = :'ct2';
  set local app.teste_eq2  = :'eq2';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    begin
      insert into public.contrato_item
        (tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
         valor_unitario, quantidade, desconto_percentual, desconto_motivo,
         vigencia_inicio, vigencia_fim)
      values (app.tenant_atual(), current_setting('app.teste_ct2')::uuid,
              current_setting('app.teste_eq2')::uuid, 'FIXO_MENSAL', 289.3300, 1,
              20.00, 'cliente pediu e eu concedi', '2026-01-01', '2027-12-31');
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;

    if v_erro is null then
      raise exception 'FALHA: desconto de 20%% passou com alçada de 5%%';
    end if;
    if v_constraint <> 'contrato_desconto_acima_da_alcada' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;
    /*
     * RN-009 lista "CTR, FAT" e só o FAT conferia. O caminho mais curto para
     * furar a alçada era conceder o desconto onde ninguém olhava e deixar o
     * faturamento repeti-lo em toda competência.
     */
    raise notice 'caso 2 OK — alçada de desconto vale também no contrato';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 3: proposta deriva os dois valores
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_ct   = :'ct';

  do $$
  declare v_ant numeric; v_novo numeric; v_esperado numeric;
  begin
    insert into public.reajuste
      (tenant_id, contrato_id, competencia, indice, percentual_indice, percentual_aplicado)
    values (app.tenant_atual(), current_setting('app.teste_ct')::uuid,
            '2027-01-01', 'IPCA', 4.6200, 4.6200);

    select valor_anterior, valor_novo into v_ant, v_novo
      from public.reajuste where contrato_id = current_setting('app.teste_ct')::uuid;

    -- 289,33 com 5% de desconto = 274,8635 → 274,86 (meio para cima, no unitário).
    if v_ant <> 274.86 then
      raise exception 'FALHA: valor_anterior veio % (esperado 274.86)', v_ant;
    end if;

    /*
     * E aqui a regra de RN-008 por inteiro: o índice incide sobre o unitário,
     * que é arredondado **antes** de qualquer outra conta.
     *   289,33 × 1,0462 = 302,6991... → 302,70
     *   302,70 com 5% = 287,565      → 287,57  (meio para cima)
     * Arredondar só no fim daria 287,56 — um centavo por item, por mês, que o
     * cliente encontra ao recalcular.
     */
    v_esperado := 287.57;
    if v_novo <> v_esperado then
      raise exception 'FALHA: valor_novo veio % (esperado %)', v_novo, v_esperado;
    end if;
    raise notice 'caso 3 OK — proposta deriva os valores com o arredondamento de RN-008';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 4: não aplica sem aprovar
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    begin
      update public.reajuste set status = 'APLICADO' where indice = 'IPCA';
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: proposta foi aplicada sem aprovação';
    end if;
    if v_constraint <> 'reajuste_transicao_valida' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;
    -- "A aplicação exige aprovação com alçada" (RN-008). Com PROPOSTO →
    -- APLICADO disponível, a alçada seria opcional na prática.
    raise notice 'caso 4 OK — aplicar exige passar por aprovação';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 5: aprovar carimba e aplicar reescreve o item
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_ct   = :'ct';

  do $$
  declare v_por uuid; v_vu numeric; v_novo numeric;
  begin
    update public.reajuste set status = 'APROVADO' where indice = 'IPCA';
    select aprovado_por into v_por from public.reajuste where indice = 'IPCA';
    if v_por is null then
      raise exception 'FALHA: aprovado_por não foi carimbado';
    end if;

    update public.reajuste set status = 'APLICADO' where indice = 'IPCA';

    select valor_unitario into v_vu from public.contrato_item
     where contrato_id = current_setting('app.teste_ct')::uuid;
    if v_vu <> 302.70 then
      raise exception 'FALHA: unitário ficou % (esperado 302.70)', v_vu;
    end if;

    select valor_novo into v_novo from public.reajuste where indice = 'IPCA';
    if v_novo <> 287.57 then
      raise exception 'FALHA: valor_novo após aplicar veio % (esperado 287.57)', v_novo;
    end if;
    raise notice 'caso 5 OK — aplicar reescreve o unitário e confere o valor cobrado';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 6: renúncia exige motivo e não apaga
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_ct2  = :'ct2';

  do $$
  declare v_erro text := null; v_constraint text := null; v_n integer;
  begin
    insert into public.reajuste
      (tenant_id, contrato_id, competencia, indice, percentual_indice, percentual_aplicado)
    values (app.tenant_atual(), current_setting('app.teste_ct2')::uuid,
            '2027-01-01', 'IGPM', 3.1000, 3.1000);

    begin
      update public.reajuste set status = 'RENUNCIADO' where indice = 'IGPM';
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: renúncia sem motivo foi aceita';
    end if;
    if v_constraint <> 'reajuste_renuncia_com_motivo' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;

    update public.reajuste
       set status = 'RENUNCIADO', motivo_renuncia = 'cliente em renegociacao de contrato'
     where indice = 'IGPM';

    v_erro := null;
    begin
      delete from public.reajuste where indice = 'IGPM';
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: reajuste renunciado foi apagado';
    end if;
    if v_constraint <> 'reajuste_imutavel' then
      raise exception 'FALHA: DELETE recusado por "%": %', v_constraint, v_erro;
    end if;

    select count(*) into v_n from public.reajuste where status = 'RENUNCIADO';
    if v_n <> 1 then
      raise exception 'FALHA: a renúncia não ficou visível (% linhas)', v_n;
    end if;
    /*
     * "Reajustes não aplicados permanecem visíveis como receita renunciada até
     * decisão explícita" (RN-008). É o KPI-34 — e ele mede zero se a linha
     * puder sumir.
     */
    raise notice 'caso 6 OK — renúncia exige motivo e permanece visível';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 7: um reajuste vivo por competência
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'usr';
  set local app.teste_ct2  = :'ct2';

  do $$
  declare v_erro text := null; v_id uuid;
  begin
    -- Renunciado abre espaço para propor de novo: é o caminho normal quando a
    -- negociação muda.
    insert into public.reajuste
      (tenant_id, contrato_id, competencia, indice, percentual_indice, percentual_aplicado)
    values (app.tenant_atual(), current_setting('app.teste_ct2')::uuid,
            '2027-01-01', 'IGPM', 3.1000, 2.0000)
    returning id into v_id;

    begin
      insert into public.reajuste
        (tenant_id, contrato_id, competencia, indice, percentual_indice, percentual_aplicado)
      values (app.tenant_atual(), current_setting('app.teste_ct2')::uuid,
              '2027-01-01', 'IGPM', 3.1000, 1.0000);
    exception when others then v_erro := sqlerrm;
    end;

    if v_erro is null then
      raise exception 'FALHA: dois reajustes vivos na mesma competência';
    end if;
    raise notice 'caso 7 OK — um reajuste vivo por contrato e competência';
  end $$;
commit;

reset role;

-- ---------------------------------------------------------------- limpeza
-- O gatilho de não-apagamento é o que o caso 6 prova. Desligá-lo para a
-- limpeza é diferente de abrir uma exceção dentro dele.
alter table public.reajuste disable trigger reajuste_sem_delete;
delete from public.reajuste     where tenant_id = :'t1';
alter table public.reajuste enable trigger reajuste_sem_delete;

delete from public.contrato_item where tenant_id = :'t1';
delete from public.contrato      where tenant_id = :'t1';
delete from public.equipamento   where tenant_id = :'t1';
delete from public.modelo        where tenant_id = :'t1';
delete from public.fabricante    where tenant_id = :'t1';
delete from public.categoria_equipamento where tenant_id = :'t1';
delete from public.audit_log     where tenant_id = :'t1';
delete from public.usuario_perfil where tenant_id = :'t1';
delete from public.alcada        where tenant_id = :'t1';
delete from public.usuario       where tenant_id = :'t1';
delete from public.cliente       where tenant_id = :'t1';
delete from public.filial        where tenant_id = :'t1';
delete from public.empresa       where tenant_id = :'t1';
delete from public.perfil        where tenant_id = :'t1';
delete from public.categoria_despesa where tenant_id = :'t1';
delete from public.tenant        where id = :'t1';

\echo '== 25_ctr_reajuste_e_desconto: TODOS OS CASOS APROVADOS =='
