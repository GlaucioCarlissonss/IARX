-- =============================================================================
-- TESTE RN-L01 … RN-L10 — Entrada de nota fiscal de compra
--
-- RN-L01  nota INTEGRADA é imutável (cabeçalho, itens e séries)
-- RN-L02  conferência exige todas as unidades identificadas
-- RN-L03  o ativo não troca de procedência
-- RN-L04  série e patrimônio únicos contra outras notas E contra o parque
-- RN-L05  o rateio fecha exatamente com o custo de aquisição da nota
-- RN-L06  garantia herdada do item
-- RN-L09  cancelamento e transições inválidas
-- RN-L10  chave de acesso: DV módulo 11 e coerência com o cabeçalho
--
-- Também prova a composição de custo do imobilizado (CPC 27 item 16): tributo
-- recuperável sai do custo, tributo não recuperável fica.
--
-- Falha o arquivo inteiro (exit != 0) se qualquer assertiva não se cumprir.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------- massa de teste
do $$
declare
  v_tenant uuid := gen_random_uuid();
  v_emp uuid; v_fil uuid; v_fab uuid; v_cat uuid; v_mod uuid; v_forn uuid;
  v_usr uuid;
  v_cnpj text := '11444777000161';   -- emitente; entra na chave nas posições 7..20
  v_base43 text;
  v_chave  text;
begin
  insert into public.tenant (id, nome) values (v_tenant, 'Locadora Teste NF');
  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_tenant, 'Locadora NF LTDA', '11222333000181') returning id into v_emp;
  insert into public.filial (tenant_id, empresa_id, codigo, nome)
    values (v_tenant, v_emp, 'SP-01', 'Base São Paulo') returning id into v_fil;
  insert into public.usuario (tenant_id, nome, email)
    values (v_tenant, 'Conferente', 'conf@teste.local') returning id into v_usr;

  insert into public.fabricante (tenant_id, nome) values (v_tenant, 'Kyocera') returning id into v_fab;
  insert into public.categoria_equipamento (tenant_id, codigo, nome, tipo_medidor_padrao)
    values (v_tenant, 'MFP', 'Multifuncional', 'CONTADOR') returning id into v_cat;
  insert into public.modelo (tenant_id, fabricante_id, categoria_id, codigo, nome)
    values (v_tenant, v_fab, v_cat, 'TA3554', 'TASKalfa 3554ci') returning id into v_mod;

  insert into public.fornecedor (tenant_id, documento, razao_social, uf)
    values (v_tenant, v_cnpj, 'Distribuidora Kyocera Brasil', 'SP') returning id into v_forn;

  -- cUF(35) AAMM(2605) CNPJ(14) mod(55) serie(001) nNF(000012345) tpEmis(1) cNF(8)
  v_base43 := '35' || '2605' || v_cnpj || '55' || '001' || '000012345' || '1' || '00000001';
  v_chave  := v_base43 || app.dv_chave_nfe(v_base43)::text;

  create temporary table _ctx (chave text primary key, valor text);
  insert into _ctx values
    ('tenant', v_tenant::text), ('filial', v_fil::text), ('modelo', v_mod::text),
    ('categoria', v_cat::text), ('fornecedor', v_forn::text), ('usuario', v_usr::text),
    ('cnpj', v_cnpj), ('base43', v_base43), ('chave', v_chave);
end $$;

-- ---------------------------------------------------------- caso 1: DV da chave
do $$
declare
  v_base43 text; v_chave text; v_dv integer; v_alterada text;
begin
  select valor into v_base43 from _ctx where chave = 'base43';
  select valor into v_chave  from _ctx where chave = 'chave';

  v_dv := app.dv_chave_nfe(v_base43);
  if v_dv is null or v_dv < 0 or v_dv > 9 then
    raise exception 'FALHA RN-L10: DV calculado fora da faixa (valor=%)', v_dv;
  end if;
  if not app.chave_nfe_valida(v_chave) then
    raise exception 'FALHA RN-L10: chave montada com o próprio DV foi recusada (%)', v_chave;
  end if;

  -- Troca de um dígito no meio: o DV tem de deixar de fechar.
  v_alterada := overlay(v_chave placing
                        case when substr(v_chave, 20, 1) = '9' then '8' else '9' end
                        from 20 for 1);
  if app.chave_nfe_valida(v_alterada) then
    raise exception 'FALHA RN-L10: chave com dígito trocado passou na validação (%)', v_alterada;
  end if;

  -- 44 dígitos com DV errado também não passa.
  if app.chave_nfe_valida(v_base43 || (case when v_dv = 0 then 1 else v_dv - 1 end)::text) then
    raise exception 'FALHA RN-L10: DV incorreto aceito';
  end if;

  raise notice 'caso 1 OK — DV módulo 11 aceita a chave íntegra e recusa a adulterada';
end $$;

-- --------------------------------------------- caso 2: total da nota tem de fechar
do $$
declare v_t uuid; v_forn uuid; v_fil uuid; v_erro text := null;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_forn from _ctx where chave = 'fornecedor';
  select valor::uuid into v_fil  from _ctx where chave = 'filial';

  begin
    insert into public.nota_fiscal_compra (
      tenant_id, fornecedor_id, filial_destino_id, numero, serie,
      data_emissao, data_entrada, valor_produtos, valor_frete, valor_total
    ) values (v_t, v_forn, v_fil, '999', '1', '2026-05-10', '2026-05-12', 10000, 500, 10000);
  exception when others then v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA: nota com total divergente do somatório foi aceita';
  end if;
  raise notice 'caso 2 OK — total incoerente recusado: %', left(v_erro, 60);
end $$;

-- ------------------------------------------ caso 3: chave de outro emitente
do $$
declare
  v_t uuid; v_forn uuid; v_fil uuid; v_erro text := null;
  v_outra43 text; v_outra text;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_forn from _ctx where chave = 'fornecedor';
  select valor::uuid into v_fil  from _ctx where chave = 'filial';

  -- Chave estruturalmente válida (DV correto), mas de OUTRO CNPJ emitente.
  v_outra43 := '35' || '2605' || '99888777000166' || '55' || '001' || '000012345' || '1' || '00000001';
  v_outra   := v_outra43 || app.dv_chave_nfe(v_outra43)::text;

  if not app.chave_nfe_valida(v_outra) then
    raise exception 'FALHA (setup): a chave de controle deveria ser válida no DV';
  end if;

  begin
    insert into public.nota_fiscal_compra (
      tenant_id, fornecedor_id, filial_destino_id, numero, serie, chave_acesso,
      data_emissao, data_entrada, valor_produtos, valor_total
    ) values (v_t, v_forn, v_fil, '12345', '1', v_outra, '2026-05-10', '2026-05-12', 10000, 10000);
  exception when others then v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA RN-L10: chave de outro emitente foi aceita — o DV sozinho não pega XML trocado';
  end if;
  if v_erro not like '%emitente%' then
    raise exception 'FALHA RN-L10: recusado, mas sem apontar o emitente divergente: %', v_erro;
  end if;
  raise notice 'caso 3 OK — chave de outro emitente recusada apontando o CNPJ';
end $$;

-- ------------------------------------------ caso 4: nota válida + itens + séries
--
-- Nota deliberadamente com resto de divisão: 3 unidades, frete que não divide
-- por 3. É o caso em que o rateio ingênuo perde centavo.
do $$
declare
  v_t uuid; v_forn uuid; v_fil uuid; v_mod uuid; v_chave text;
  v_nota uuid; v_item uuid; v_item2 uuid;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_forn  from _ctx where chave = 'fornecedor';
  select valor::uuid into v_fil   from _ctx where chave = 'filial';
  select valor::uuid into v_mod   from _ctx where chave = 'modelo';
  select valor      into v_chave  from _ctx where chave = 'chave';

  -- vProd 30.000 + ST 0 + frete 1.000 + seguro 0 + outras 0 + IPI 500 − desc 100
  insert into public.nota_fiscal_compra (
    tenant_id, fornecedor_id, filial_destino_id, numero, serie, chave_acesso,
    modelo_documento, origem_dados, data_emissao, data_entrada,
    valor_produtos, valor_frete, valor_desconto, valor_ipi, valor_icms, valor_total
  ) values (
    v_t, v_forn, v_fil, '12345', '1', v_chave,
    '55', 'XML', '2026-05-10', '2026-05-12',
    30000, 1000, 100, 500, 5400, 31400
  ) returning id into v_nota;

  insert into public.nota_fiscal_item (
    tenant_id, nota_fiscal_id, numero_item, modelo_id, descricao_nf,
    ncm, cfop, quantidade, valor_unitario, valor_total_item, garantia_meses
  ) values (
    v_t, v_nota, 1, v_mod, 'MULTIFUNCIONAL LASER COLOR A3 TASKALFA 3554CI',
    '84433221', '5102', 3, 6000, 18000, 24
  ) returning id into v_item;

  insert into public.nota_fiscal_item (
    tenant_id, nota_fiscal_id, numero_item, modelo_id, descricao_nf,
    ncm, cfop, quantidade, valor_unitario, valor_total_item, garantia_meses
  ) values (
    v_t, v_nota, 2, v_mod, 'MULTIFUNCIONAL LASER COLOR A3 TASKALFA 3554CI (LOTE 2)',
    '84433221', '5102', 2, 6000, 12000, 12
  ) returning id into v_item2;

  insert into _ctx values ('nota', v_nota::text), ('item', v_item::text), ('item2', v_item2::text);
  raise notice 'caso 4 OK — nota com chave coerente e dois itens aceita';
end $$;

-- ------------------------------- caso 5: RN-L02 — conferir sem todas as séries
do $$
declare v_nota uuid; v_item uuid; v_t uuid; v_erro text := null;
begin
  select valor::uuid into v_nota from _ctx where chave = 'nota';
  select valor::uuid into v_item from _ctx where chave = 'item';
  select valor::uuid into v_t    from _ctx where chave = 'tenant';

  -- Só 2 das 3 unidades do item 1; nenhuma do item 2.
  insert into public.nota_fiscal_item_serie (tenant_id, nota_fiscal_item_id, numero_serie, patrimonio)
  values (v_t, v_item, 'W7A1000001', 'PAT-90001'),
         (v_t, v_item, 'W7A1000002', 'PAT-90002');

  begin
    update public.nota_fiscal_compra
       set status = 'CONFERIDA', conferida_em = now()
     where id = v_nota;
  exception when others then v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA RN-L02: nota conferida com unidades faltando';
  end if;
  if v_erro not like '%unidades identificadas%' then
    raise exception 'FALHA RN-L02: recusado sem dizer qual item está incompleto: %', v_erro;
  end if;
  raise notice 'caso 5 OK — conferência recusada nomeando o item incompleto: %', left(v_erro, 70);
end $$;

-- ------------------------------- caso 6: RN-L04 — série já existente no parque
do $$
declare
  v_t uuid; v_mod uuid; v_cat uuid; v_fil uuid; v_item uuid;
  v_erro_serie text := null; v_erro_pat text := null;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_mod  from _ctx where chave = 'modelo';
  select valor::uuid into v_cat  from _ctx where chave = 'categoria';
  select valor::uuid into v_fil  from _ctx where chave = 'filial';
  select valor::uuid into v_item from _ctx where chave = 'item';

  -- Ativo cadastrado antes do módulo, sem procedência fiscal.
  insert into public.equipamento (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_t, 'PAT-ANTIGO', 'W7A0999999', v_mod, v_cat, v_fil);

  begin
    insert into public.nota_fiscal_item_serie (tenant_id, nota_fiscal_item_id, numero_serie, patrimonio)
      values (v_t, v_item, 'w7a0999999', 'PAT-90003');   -- minúscula: tem de bater mesmo assim
  exception when others then v_erro_serie := sqlerrm;
  end;

  if v_erro_serie is null then
    raise exception 'FALHA RN-L04: série já existente no parque foi aceita na nota';
  end if;
  if v_erro_serie not like '%PAT-ANTIGO%' then
    raise exception 'FALHA RN-L04: recusado sem apontar o ativo conflitante: %', v_erro_serie;
  end if;

  begin
    insert into public.nota_fiscal_item_serie (tenant_id, nota_fiscal_item_id, numero_serie, patrimonio)
      values (v_t, v_item, 'W7A1000003', 'pat-antigo');
  exception when others then v_erro_pat := sqlerrm;
  end;

  if v_erro_pat is null then
    raise exception 'FALHA RN-L04: patrimônio já existente no parque foi aceito na nota';
  end if;

  raise notice 'caso 6 OK — série e patrimônio já usados no parque recusados, sem depender de caixa';
end $$;

-- ------------------------------- caso 7: RN-L04 — duplicidade entre notas
do $$
declare v_t uuid; v_item2 uuid; v_erro text := null;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_item2 from _ctx where chave = 'item2';

  begin
    insert into public.nota_fiscal_item_serie (tenant_id, nota_fiscal_item_id, numero_serie, patrimonio)
      values (v_t, v_item2, 'W7A1000001', 'PAT-90010');   -- série já lançada no item 1
  exception when others then v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA RN-L04: mesma série lançada em dois itens da mesma nota';
  end if;
  raise notice 'caso 7 OK — série repetida entre itens recusada';
end $$;

-- ------------------------------- caso 8: completar séries e conferir
do $$
declare v_t uuid; v_item uuid; v_item2 uuid; v_nota uuid; v_usr uuid; v_status app.nf_status;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_item  from _ctx where chave = 'item';
  select valor::uuid into v_item2 from _ctx where chave = 'item2';
  select valor::uuid into v_nota  from _ctx where chave = 'nota';
  select valor::uuid into v_usr   from _ctx where chave = 'usuario';

  insert into public.nota_fiscal_item_serie (tenant_id, nota_fiscal_item_id, numero_serie, patrimonio)
  values (v_t, v_item,  'W7A1000003', 'PAT-90003'),
         (v_t, v_item2, 'W7A1000004', 'PAT-90004'),
         (v_t, v_item2, 'W7A1000005', 'PAT-90005');

  update public.nota_fiscal_compra
     set status = 'CONFERIDA', conferida_em = now(), conferida_por = v_usr
   where id = v_nota;

  select status into v_status from public.nota_fiscal_compra where id = v_nota;
  if v_status <> 'CONFERIDA' then
    raise exception 'FALHA RN-L02: nota completa não passou a CONFERIDA (status=%)', v_status;
  end if;
  raise notice 'caso 8 OK — nota com todas as unidades identificadas passa a CONFERIDA';
end $$;

-- ------------------------- caso 9: RN-L05/RN-L06 — o rateio fecha com a nota
do $$
declare
  v_nota uuid;
  v_custo numeric(15,4);
  v_soma  numeric(15,4);
  v_linhas integer;
  r record;
begin
  select valor::uuid into v_nota from _ctx where chave = 'nota';
  select custo_aquisicao into v_custo from public.nota_fiscal_compra where id = v_nota;

  -- ICMS não recuperável (padrão de locadora): custo = total da nota.
  if v_custo <> 31400 then
    raise exception 'FALHA: custo de aquisição com ICMS não recuperável deveria ser 31400,00 (valor=%)', v_custo;
  end if;

  select count(*), sum(valor_aquisicao) into v_linhas, v_soma
  from app.ratear_custo_nota(v_nota);

  if v_linhas <> 5 then
    raise exception 'FALHA RN-L05: rateio produziu % linhas para 5 unidades', v_linhas;
  end if;
  if v_soma <> v_custo then
    raise exception 'FALHA RN-L05: soma do rateio (%) não fecha com o custo da nota (%)', v_soma, v_custo;
  end if;

  -- RN-L06: garantia herdada de garantia_meses a partir da data de entrada.
  select * into r from app.ratear_custo_nota(v_nota) where numero_item = 1 limit 1;
  if r.garantia_ate <> date '2028-05-12' then
    raise exception 'FALHA RN-L06: garantia de 24 meses sobre entrada 2026-05-12 deveria ser 2028-05-12 (valor=%)',
      r.garantia_ate;
  end if;
  select * into r from app.ratear_custo_nota(v_nota) where numero_item = 2 limit 1;
  if r.garantia_ate <> date '2027-05-12' then
    raise exception 'FALHA RN-L06: garantia de 12 meses deveria ser 2027-05-12 (valor=%)', r.garantia_ate;
  end if;

  raise notice 'caso 9 OK — rateio de 5 unidades soma exatamente % e garantia herdada por item', v_soma;
end $$;

-- ------------------------- caso 10: tributo recuperável sai do custo (CPC 27)
do $$
declare
  v_t uuid; v_forn uuid; v_fil uuid; v_mod uuid;
  v_nota uuid; v_custo numeric(15,4); v_soma numeric(15,4);
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_forn from _ctx where chave = 'fornecedor';
  select valor::uuid into v_fil  from _ctx where chave = 'filial';
  select valor::uuid into v_mod  from _ctx where chave = 'modelo';

  insert into public.nota_fiscal_compra (
    tenant_id, fornecedor_id, filial_destino_id, numero, serie,
    data_emissao, data_entrada,
    valor_produtos, valor_frete, valor_ipi, valor_icms, valor_total,
    icms_recuperavel, ipi_recuperavel
  ) values (
    v_t, v_forn, v_fil, '20001', '1', '2026-06-01', '2026-06-03',
    10000, 300, 200, 1800, 10500,
    true, true
  ) returning id into v_nota;

  select custo_aquisicao into v_custo from public.nota_fiscal_compra where id = v_nota;
  -- 10500 − 1800 (ICMS recuperável) − 200 (IPI recuperável) = 8500
  if v_custo <> 8500 then
    raise exception 'FALHA CPC 27: custo com tributos recuperáveis deveria ser 8500,00 (valor=%)', v_custo;
  end if;

  insert into public.nota_fiscal_item (
    tenant_id, nota_fiscal_id, numero_item, modelo_id, descricao_nf,
    quantidade, valor_unitario, valor_total_item
  ) values (v_t, v_nota, 1, v_mod, 'IMPRESSORA LASER MONO', 3, 3333.3333, 10000);

  insert into public.nota_fiscal_item_serie (tenant_id, nota_fiscal_item_id, numero_serie, patrimonio)
  select v_t, i.id, 'REC-' || g, 'PAT-REC-' || g
  from public.nota_fiscal_item i, generate_series(1,3) g
  where i.nota_fiscal_id = v_nota;

  select sum(valor_aquisicao) into v_soma from app.ratear_custo_nota(v_nota);
  if v_soma <> v_custo then
    raise exception 'FALHA RN-L05: rateio com acessório negativo não fecha (soma=%, custo=%)', v_soma, v_custo;
  end if;

  insert into _ctx values ('nota_rec', v_nota::text);
  raise notice 'caso 10 OK — tributo recuperável sai do custo e o rateio negativo ainda fecha em %', v_soma;
end $$;

-- ------------------------- caso 11: integração cria os ativos e sela a nota
do $$
declare
  v_t uuid; v_nota uuid; v_cat uuid; v_fil uuid; v_usr uuid;
  v_criados integer := 0;
  v_soma numeric(15,4); v_custo numeric(15,4);
  r record;
  v_eq uuid;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_nota from _ctx where chave = 'nota';
  select valor::uuid into v_cat  from _ctx where chave = 'categoria';
  select valor::uuid into v_fil  from _ctx where chave = 'filial';
  select valor::uuid into v_usr  from _ctx where chave = 'usuario';

  for r in select * from app.ratear_custo_nota(v_nota) loop
    insert into public.equipamento (
      tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id,
      status, data_aquisicao, valor_aquisicao, garantia_ate, nota_fiscal_item_serie_id
    ) values (
      v_t, r.patrimonio, r.numero_serie, r.modelo_id, v_cat, v_fil,
      'DISPONIVEL', '2026-05-12', r.valor_aquisicao, r.garantia_ate, r.nota_fiscal_item_serie_id
    ) returning id into v_eq;

    update public.nota_fiscal_item_serie set equipamento_id = v_eq
     where id = r.nota_fiscal_item_serie_id;

    v_criados := v_criados + 1;
  end loop;

  -- O vínculo é gravado ANTES da transição: depois de INTEGRADA nada muda.
  update public.nota_fiscal_compra
     set status = 'INTEGRADA', integrada_em = now(), integrada_por = v_usr
   where id = v_nota;

  if v_criados <> 5 then
    raise exception 'FALHA RN-L03: integração criou % ativos para 5 unidades', v_criados;
  end if;

  select count(*) into v_criados from public.equipamento e
   join public.nota_fiscal_item_serie s on s.equipamento_id = e.id
   join public.nota_fiscal_item i on i.id = s.nota_fiscal_item_id
  where i.nota_fiscal_id = v_nota and e.status = 'DISPONIVEL';
  if v_criados <> 5 then
    raise exception 'FALHA RN-L07: nem todos os ativos nasceram DISPONIVEL (% de 5)', v_criados;
  end if;

  select sum(e.valor_aquisicao) into v_soma from public.equipamento e
   join public.nota_fiscal_item_serie s on s.equipamento_id = e.id
   join public.nota_fiscal_item i on i.id = s.nota_fiscal_item_id
  where i.nota_fiscal_id = v_nota;
  select custo_aquisicao into v_custo from public.nota_fiscal_compra where id = v_nota;

  if v_soma <> v_custo then
    raise exception 'FALHA RN-L05: Σ valor_aquisicao dos ativos (%) ≠ custo da nota (%)', v_soma, v_custo;
  end if;

  raise notice 'caso 11 OK — 5 ativos DISPONIVEL criados e Σ valor_aquisicao = %', v_soma;
end $$;

-- ------------------------- caso 12: RN-L01 — nota integrada é imutável
do $$
declare
  v_nota uuid; v_item uuid; v_t uuid;
  v_erro_nota text := null; v_erro_item text := null;
  v_erro_serie text := null; v_erro_delete text := null;
begin
  select valor::uuid into v_nota from _ctx where chave = 'nota';
  select valor::uuid into v_item from _ctx where chave = 'item';
  select valor::uuid into v_t    from _ctx where chave = 'tenant';

  begin
    update public.nota_fiscal_compra set observacao = 'ajuste' where id = v_nota;
  exception when others then v_erro_nota := sqlerrm;
  end;
  if v_erro_nota is null then
    raise exception 'FALHA RN-L01: nota INTEGRADA aceitou alteração de cabeçalho';
  end if;

  begin
    update public.nota_fiscal_item set valor_unitario = 1 where id = v_item;
  exception when others then v_erro_item := sqlerrm;
  end;
  if v_erro_item is null then
    raise exception 'FALHA RN-L01: item de nota INTEGRADA aceitou alteração — bloquear só o cabeçalho não basta';
  end if;

  begin
    insert into public.nota_fiscal_item_serie (tenant_id, nota_fiscal_item_id, numero_serie, patrimonio)
      values (v_t, v_item, 'W7A1000099', 'PAT-90099');
  exception when others then v_erro_serie := sqlerrm;
  end;
  if v_erro_serie is null then
    raise exception 'FALHA RN-L01: unidade nova aceita em nota já INTEGRADA';
  end if;

  begin
    delete from public.nota_fiscal_compra where id = v_nota;
  exception when others then v_erro_delete := sqlerrm;
  end;
  if v_erro_delete is null then
    raise exception 'FALHA RN-L09: nota INTEGRADA foi removida — os ativos ficariam sem procedência';
  end if;

  raise notice 'caso 12 OK — cabeçalho, item, série nova e remoção todos recusados após integração';
end $$;

-- ------------------------- caso 13: RN-L03 — procedência do ativo não muda
do $$
declare v_nota uuid; v_eq uuid; v_outra_serie uuid; v_erro text := null;
begin
  select valor::uuid into v_nota from _ctx where chave = 'nota';

  select e.id into v_eq from public.equipamento e
   join public.nota_fiscal_item_serie s on s.equipamento_id = e.id
   join public.nota_fiscal_item i on i.id = s.nota_fiscal_item_id
  where i.nota_fiscal_id = v_nota limit 1;

  select s.id into v_outra_serie from public.nota_fiscal_item_serie s
   join public.nota_fiscal_item i on i.id = s.nota_fiscal_item_id
  where i.nota_fiscal_id <> v_nota limit 1;

  begin
    update public.equipamento set nota_fiscal_item_serie_id = v_outra_serie where id = v_eq;
  exception when others then v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA RN-L03: ativo trocou de nota de origem';
  end if;
  raise notice 'caso 13 OK — revínculo de procedência recusado';
end $$;

-- ------------------------- caso 14: RN-L09 — transições e cancelamento
do $$
declare
  v_t uuid; v_forn uuid; v_fil uuid; v_nota uuid; v_nota_rec uuid;
  v_erro_pulo text := null; v_erro_reabrir text := null; v_erro_sem_motivo text := null;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_forn from _ctx where chave = 'fornecedor';
  select valor::uuid into v_fil  from _ctx where chave = 'filial';
  select valor::uuid into v_nota_rec from _ctx where chave = 'nota_rec';

  insert into public.nota_fiscal_compra (
    tenant_id, fornecedor_id, filial_destino_id, numero, serie,
    data_emissao, data_entrada, valor_produtos, valor_total
  ) values (v_t, v_forn, v_fil, '30001', '1', '2026-07-01', '2026-07-02', 1000, 1000)
  returning id into v_nota;

  -- PENDENTE → INTEGRADA sem passar por CONFERIDA
  begin
    update public.nota_fiscal_compra
       set status = 'INTEGRADA', conferida_em = now(), integrada_em = now()
     where id = v_nota;
  exception when others then v_erro_pulo := sqlerrm;
  end;
  if v_erro_pulo is null then
    raise exception 'FALHA RN-L09: nota pulou a conferência e foi direto a INTEGRADA';
  end if;

  -- Cancelamento sem motivo
  begin
    update public.nota_fiscal_compra set status = 'CANCELADA', cancelada_em = now() where id = v_nota;
  exception when others then v_erro_sem_motivo := sqlerrm;
  end;
  if v_erro_sem_motivo is null then
    raise exception 'FALHA RN-L09: cancelamento aceito sem motivo';
  end if;

  -- Cancelamento correto
  update public.nota_fiscal_compra
     set status = 'CANCELADA', cancelada_em = now(), motivo_cancelamento = 'Devolução ao fornecedor: divergência de modelo'
   where id = v_nota;

  -- Reabertura
  begin
    update public.nota_fiscal_compra set status = 'PENDENTE_CONFERENCIA' where id = v_nota;
  exception when others then v_erro_reabrir := sqlerrm;
  end;
  if v_erro_reabrir is null then
    raise exception 'FALHA RN-L09: nota cancelada foi reaberta';
  end if;

  raise notice 'caso 14 OK — pulo de etapa, cancelamento sem motivo e reabertura recusados';
end $$;

-- ------------------------- caso 15: RN-028 — a nota respeita o isolamento
do $$
declare
  v_t uuid; v_outro uuid := gen_random_uuid(); v_visiveis integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  -- Sob o tenant correto, a API enxerga as notas; sob outro, nenhuma.
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  select count(*) into v_visiveis from public.nota_fiscal_compra;
  if v_visiveis = 0 then
    raise exception 'FALHA RN-028: iarx_app não enxerga as notas do próprio tenant';
  end if;

  perform set_config('app.tenant_id', v_outro::text, true);
  select count(*) into v_visiveis from public.nota_fiscal_compra;
  if v_visiveis <> 0 then
    raise exception 'FALHA RN-028: % nota(s) de outro tenant visíveis', v_visiveis;
  end if;

  reset role;
  raise notice 'caso 15 OK — nota fiscal isolada por tenant sob RLS';
end $$;

rollback;

\echo '== 04_rnl_nota_fiscal: TODOS OS CASOS APROVADOS =='
