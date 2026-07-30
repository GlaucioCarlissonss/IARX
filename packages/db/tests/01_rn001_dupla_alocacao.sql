-- =============================================================================
-- TESTE RN-001 — Um equipamento não pode estar em dois contratos com vigências
-- sobrepostas.
--
-- Prova que a invariante é imposta pelo BANCO: nenhum caminho de escrita,
-- integração ou correção manual via SQL consegue produzir o estado inválido.
--
-- Falha o arquivo inteiro (exit != 0) se qualquer assertiva não se cumprir.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------- massa de teste
do $$
declare
  v_tenant uuid := gen_random_uuid();
  v_emp uuid; v_fil uuid; v_cli uuid; v_fab uuid; v_cat uuid; v_mod uuid;
  v_eq  uuid; v_eq2 uuid; v_ctr uuid; v_ctr2 uuid;
begin
  insert into public.tenant (id, nome) values (v_tenant, 'Locadora Teste RN-001');

  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_tenant, 'Locadora Teste LTDA', '11222333000181') returning id into v_emp;
  insert into public.filial (tenant_id, empresa_id, codigo, nome)
    values (v_tenant, v_emp, 'SP-01', 'Base São Paulo') returning id into v_fil;
  insert into public.cliente (tenant_id, documento, razao_social)
    values (v_tenant, '99888777000166', 'Construtora Alfa') returning id into v_cli;

  insert into public.fabricante (tenant_id, nome) values (v_tenant, 'Fabricante X') returning id into v_fab;
  insert into public.categoria_equipamento (tenant_id, codigo, nome, tipo_medidor_padrao)
    values (v_tenant, 'ESC', 'Escavadeira', 'HORIMETRO') returning id into v_cat;
  insert into public.modelo (tenant_id, fabricante_id, categoria_id, codigo, nome, preco_tabela_mensal)
    values (v_tenant, v_fab, v_cat, 'EX210', 'Escavadeira 21t', 12000) returning id into v_mod;

  insert into public.equipamento (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_tenant, '10422', 'SN-0001', v_mod, v_cat, v_fil) returning id into v_eq;
  insert into public.equipamento (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_tenant, '10870', 'SN-0002', v_mod, v_cat, v_fil) returning id into v_eq2;

  insert into public.contrato (tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim)
    values (v_tenant, 'SP-2026-0148', v_emp, v_fil, v_cli, 'ATIVO', '2026-08-01', '2026-12-31')
    returning id into v_ctr;
  insert into public.contrato (tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim)
    values (v_tenant, 'SP-2026-0149', v_emp, v_fil, v_cli, 'ATIVO', '2026-09-01', '2027-06-30')
    returning id into v_ctr2;

  -- guarda os ids para os testes seguintes
  create temporary table _ctx (chave text primary key, valor uuid);
  insert into _ctx values
    ('tenant', v_tenant), ('equip', v_eq), ('equip2', v_eq2),
    ('contrato', v_ctr), ('contrato2', v_ctr2), ('categoria', v_cat);
end $$;

-- ---------------------------------------------------------------- caso 1: base
-- Alocação inicial válida: 01/08/2026 a 31/12/2026
do $$
declare v_t uuid; v_e uuid; v_c uuid;
begin
  select valor into v_t from _ctx where chave = 'tenant';
  select valor into v_e from _ctx where chave = 'equip';
  select valor into v_c from _ctx where chave = 'contrato';

  insert into public.contrato_item (
    tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
    valor_unitario, vigencia_inicio, vigencia_fim, status
  ) values (
    v_t, v_c, v_e, 'FIXO_MENSAL',
    12000, '2026-08-01 00:00-03', '2027-01-01 00:00-03', 'ATIVO'
  );

  raise notice 'caso 1 OK — alocação inicial aceita';
end $$;

-- ---------------------------------------------------------------- caso 2: bloqueio
-- Sobreposição no MESMO equipamento em outro contrato: deve ser rejeitada.
do $$
declare
  v_t uuid; v_e uuid; v_c2 uuid; v_erro text := null; v_sqlstate text := null;
begin
  select valor into v_t from _ctx where chave = 'tenant';
  select valor into v_e from _ctx where chave = 'equip';
  select valor into v_c2 from _ctx where chave = 'contrato2';

  begin
    insert into public.contrato_item (
      tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
      valor_unitario, vigencia_inicio, vigencia_fim, status
    ) values (
      v_t, v_c2, v_e, 'FIXO_MENSAL',
      11500, '2026-09-01 00:00-03', '2027-07-01 00:00-03', 'ATIVO'
    );
  exception when others then
    v_erro := sqlerrm;
    v_sqlstate := sqlstate;
  end;

  if v_erro is null then
    raise exception 'FALHA RN-001: sobreposição de vigência foi ACEITA — invariante não está sendo imposta';
  end if;

  if v_sqlstate <> '23P01' then
    raise exception 'FALHA RN-001: rejeitado com SQLSTATE % (esperado 23P01 exclusion_violation): %', v_sqlstate, v_erro;
  end if;

  raise notice 'caso 2 OK — sobreposição rejeitada por exclusion_violation';
end $$;

-- ---------------------------------------------------------------- caso 3: adjacente
-- Vigência que começa exatamente quando a anterior termina: o range é [inicio, fim),
-- portanto NÃO há sobreposição e a alocação deve ser aceita.
do $$
declare v_t uuid; v_e uuid; v_c2 uuid;
begin
  select valor into v_t from _ctx where chave = 'tenant';
  select valor into v_e from _ctx where chave = 'equip';
  select valor into v_c2 from _ctx where chave = 'contrato2';

  insert into public.contrato_item (
    tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
    valor_unitario, vigencia_inicio, vigencia_fim, status
  ) values (
    v_t, v_c2, v_e, 'FIXO_MENSAL',
    11500, '2027-01-01 00:00-03', '2027-07-01 00:00-03', 'ATIVO'
  );

  raise notice 'caso 3 OK — vigência adjacente aceita (range semiaberto)';
end $$;

-- ---------------------------------------------------------------- caso 4: encerrado não ocupa
do $$
declare v_t uuid; v_e2 uuid; v_c uuid; v_c2 uuid; v_item uuid;
begin
  select valor into v_t from _ctx where chave = 'tenant';
  select valor into v_e2 from _ctx where chave = 'equip2';
  select valor into v_c from _ctx where chave = 'contrato';
  select valor into v_c2 from _ctx where chave = 'contrato2';

  insert into public.contrato_item (
    tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
    valor_unitario, vigencia_inicio, vigencia_fim, status
  ) values (v_t, v_c, v_e2, 'FIXO_MENSAL', 9000,
            '2026-08-01 00:00-03', '2026-10-01 00:00-03', 'ENCERRADO')
  returning id into v_item;

  -- mesmo período, outro contrato: aceito porque ENCERRADO não ocupa o ativo
  insert into public.contrato_item (
    tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
    valor_unitario, vigencia_inicio, vigencia_fim, status
  ) values (v_t, v_c2, v_e2, 'FIXO_MENSAL', 9500,
            '2026-08-15 00:00-03', '2026-11-01 00:00-03', 'ATIVO');

  raise notice 'caso 4 OK — item ENCERRADO não ocupa o ativo';

  -- ...mas reativar o item encerrado recria o conflito e deve ser rejeitado
  declare v_erro text := null; v_state text := null;
  begin
    begin
      update public.contrato_item set status = 'ATIVO' where id = v_item;
    exception when others then
      v_erro := sqlerrm; v_state := sqlstate;
    end;

    if v_erro is null then
      raise exception 'FALHA RN-001: reativar item encerrado sobreposto foi ACEITO';
    end if;
    if v_state <> '23P01' then
      raise exception 'FALHA RN-001: UPDATE rejeitado com SQLSTATE % (esperado 23P01): %', v_state, v_erro;
    end if;
    raise notice 'caso 5 OK — reativação que recria sobreposição rejeitada';
  end;
end $$;

-- ---------------------------------------------------------------- caso 6: outro tenant
-- A constraint é por tenant: o mesmo período em tenant distinto não conflita
-- (equipamentos são entidades diferentes, ainda que o patrimônio coincida).
do $$
declare
  v_t2 uuid := gen_random_uuid();
  v_emp uuid; v_fil uuid; v_cli uuid; v_fab uuid; v_cat uuid; v_mod uuid; v_eq uuid; v_ctr uuid;
begin
  insert into public.tenant (id, nome) values (v_t2, 'Outra Locadora');
  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_t2, 'Outra LTDA', '11222333000181') returning id into v_emp;
  insert into public.filial (tenant_id, empresa_id, codigo, nome)
    values (v_t2, v_emp, 'SP-01', 'Base') returning id into v_fil;
  insert into public.cliente (tenant_id, documento, razao_social)
    values (v_t2, '99888777000166', 'Cliente') returning id into v_cli;
  insert into public.fabricante (tenant_id, nome) values (v_t2, 'Fabricante X') returning id into v_fab;
  insert into public.categoria_equipamento (tenant_id, codigo, nome)
    values (v_t2, 'ESC', 'Escavadeira') returning id into v_cat;
  insert into public.modelo (tenant_id, fabricante_id, categoria_id, codigo, nome)
    values (v_t2, v_fab, v_cat, 'EX210', 'Escavadeira 21t') returning id into v_mod;
  -- MESMO patrimônio de outro tenant: aceito (unicidade é por tenant, RN-002)
  insert into public.equipamento (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_t2, '10422', 'SN-0001', v_mod, v_cat, v_fil) returning id into v_eq;
  insert into public.contrato (tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim)
    values (v_t2, 'SP-2026-0148', v_emp, v_fil, v_cli, 'ATIVO', '2026-08-01', '2026-12-31')
    returning id into v_ctr;

  insert into public.contrato_item (
    tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
    valor_unitario, vigencia_inicio, vigencia_fim, status
  ) values (v_t2, v_ctr, v_eq, 'FIXO_MENSAL', 12000,
            '2026-08-01 00:00-03', '2027-01-01 00:00-03', 'ATIVO');

  raise notice 'caso 6 OK — mesmo patrimônio e período em outro tenant não conflita';
end $$;

-- ---------------------------------------------------------------- caso 7: RN-003
-- Equipamento bloqueado não pode ser alocado.
do $$
declare
  v_t uuid; v_e2 uuid; v_c uuid; v_erro text := null;
begin
  select valor into v_t from _ctx where chave = 'tenant';
  select valor into v_e2 from _ctx where chave = 'equip2';
  select valor into v_c from _ctx where chave = 'contrato';

  update public.equipamento
     set bloqueado = true, bloqueio_motivo = 'preventiva vencida há 12 dias'
   where id = v_e2;

  begin
    insert into public.contrato_item (
      tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
      valor_unitario, vigencia_inicio, vigencia_fim, status
    ) values (v_t, v_c, v_e2, 'FIXO_MENSAL', 9000,
              '2028-01-01 00:00-03', '2028-06-01 00:00-03', 'RESERVADO');
  exception when others then
    v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA RN-003/RN-014: equipamento bloqueado foi alocado';
  end if;
  raise notice 'caso 7 OK — equipamento bloqueado recusado: %', v_erro;
end $$;

rollback;

\echo '== 01_rn001_dupla_alocacao: TODOS OS CASOS APROVADOS =='
