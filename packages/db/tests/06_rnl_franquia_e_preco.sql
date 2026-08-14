-- =============================================================================
-- TESTE RN-L14 … RN-L27 — Tabelas de franquia e de preço
--
-- RN-L14/L21  tabela ATIVA é imutável, inclusive pelos itens
-- RN-L15      resolução mais específica primeiro: modelo vence categoria
-- RN-L16      sem sobreposição de vigência para o mesmo alvo
-- RN-L20      categoria sem contador não aceita franquia
-- RN-L21      precedência de preço: Contrato → Cliente → Geral
-- RN-L22/L23  desconto tem vigência própria e não acumula
--
-- A regra que este arquivo protege acima de todas: **trocar a tabela não
-- reprecifica contrato vigente**. É o que separa um reajuste comercial de um
-- incidente que atinge quatrocentos clientes de uma vez.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_t uuid := gen_random_uuid();
  v_emp uuid; v_fil uuid; v_fab uuid;
  v_cat_mfp uuid; v_cat_note uuid;
  v_mod_a uuid; v_mod_b uuid; v_mod_note uuid;
  v_cli uuid; v_cli2 uuid; v_ctr uuid;
  v_eq_a uuid; v_eq_b uuid; v_eq_note uuid;
  v_tf uuid; v_tp_geral uuid; v_tp_cliente uuid;
begin
  insert into public.tenant (id, nome) values (v_t, 'Locadora Comercial');
  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_t, 'Comercial LTDA', '11222333000181') returning id into v_emp;
  insert into public.filial (tenant_id, empresa_id, codigo, nome)
    values (v_t, v_emp, 'SP-01', 'Base SP') returning id into v_fil;
  insert into public.fabricante (tenant_id, nome) values (v_t, 'Kyocera') returning id into v_fab;

  -- Uma categoria com medidor e outra sem: é a diferença que RN-L20 usa.
  insert into public.categoria_equipamento (tenant_id, codigo, nome, tipo_medidor_padrao)
    values (v_t, 'MFP', 'Multifuncional', 'CONTADOR') returning id into v_cat_mfp;
  insert into public.categoria_equipamento (tenant_id, codigo, nome, tipo_medidor_padrao)
    values (v_t, 'NOTE', 'Notebook', null) returning id into v_cat_note;

  insert into public.modelo (tenant_id, fabricante_id, categoria_id, codigo, nome)
    values (v_t, v_fab, v_cat_mfp, 'TA3554', 'TASKalfa 3554ci') returning id into v_mod_a;
  insert into public.modelo (tenant_id, fabricante_id, categoria_id, codigo, nome)
    values (v_t, v_fab, v_cat_mfp, 'TA4054', 'TASKalfa 4054ci') returning id into v_mod_b;
  insert into public.modelo (tenant_id, fabricante_id, categoria_id, codigo, nome)
    values (v_t, v_fab, v_cat_note, 'L14', 'ThinkPad L14') returning id into v_mod_note;

  insert into public.cliente (tenant_id, documento, razao_social)
    values (v_t, '11444777000161', 'CLIENTE ALFA LTDA') returning id into v_cli;
  insert into public.cliente (tenant_id, documento, razao_social)
    values (v_t, '99888777000166', 'CLIENTE BETA LTDA') returning id into v_cli2;
  insert into public.contrato (tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim)
    values (v_t, 'SP-2026-001', v_emp, v_fil, v_cli, 'ATIVO', '2026-01-01', '2026-12-31')
    returning id into v_ctr;

  insert into public.equipamento (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_t, 'EQ-A', 'SN-A', v_mod_a, v_cat_mfp, v_fil) returning id into v_eq_a;
  insert into public.equipamento (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_t, 'EQ-B', 'SN-B', v_mod_b, v_cat_mfp, v_fil) returning id into v_eq_b;
  insert into public.equipamento (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_t, 'EQ-N', 'SN-N', v_mod_note, v_cat_note, v_fil) returning id into v_eq_note;

  insert into public.tabela_franquia (tenant_id, nome, vigencia_inicio)
    values (v_t, 'Padrão 2026', '2026-01-01') returning id into v_tf;
  insert into public.tabela_preco (tenant_id, nome, vigencia_inicio)
    values (v_t, 'Tabela geral 2026', '2026-01-01') returning id into v_tp_geral;
  insert into public.tabela_preco (tenant_id, nome, vigencia_inicio, abrangencia, cliente_id)
    values (v_t, 'Negociada Alfa', '2026-01-01', 'CLIENTE', v_cli) returning id into v_tp_cliente;

  create temporary table _ctx (chave text primary key, valor text);
  insert into _ctx values
    ('tenant', v_t::text), ('cat_mfp', v_cat_mfp::text), ('cat_note', v_cat_note::text),
    ('mod_a', v_mod_a::text), ('mod_b', v_mod_b::text), ('mod_note', v_mod_note::text),
    ('cliente', v_cli::text), ('cliente2', v_cli2::text), ('contrato', v_ctr::text),
    ('eq_a', v_eq_a::text), ('eq_b', v_eq_b::text), ('eq_note', v_eq_note::text),
    ('tf', v_tf::text), ('tp_geral', v_tp_geral::text), ('tp_cliente', v_tp_cliente::text);
end $$;

-- ------------------------------ caso 1: RN-L20, sem contador não há franquia
do $$
declare v_t uuid; v_tf uuid; v_cat_note uuid; v_erro text := null;
begin
  select valor::uuid into v_t        from _ctx where chave = 'tenant';
  select valor::uuid into v_tf       from _ctx where chave = 'tf';
  select valor::uuid into v_cat_note from _ctx where chave = 'cat_note';

  begin
    insert into public.tabela_franquia_item
      (tenant_id, tabela_franquia_id, categoria_id, franquia_mono, valor_excedente_mono)
    values (v_t, v_tf, v_cat_note, 3000, 0.08);
  exception when others then v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA RN-L20: notebook aceitou franquia — o excedente nunca seria apurado';
  end if;
  if v_erro not like '%Notebook%' then
    raise exception 'FALHA RN-L20: recusado sem nomear a categoria: %', v_erro;
  end if;

  raise notice 'caso 1 OK — categoria sem medidor recusa franquia, nomeando-a';
end $$;

-- ------------------- caso 2: linha por categoria e por modelo convivem
do $$
declare v_t uuid; v_tf uuid; v_cat uuid; v_mod_a uuid;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_tf    from _ctx where chave = 'tf';
  select valor::uuid into v_cat   from _ctx where chave = 'cat_mfp';
  select valor::uuid into v_mod_a from _ctx where chave = 'mod_a';

  insert into public.tabela_franquia_item
    (tenant_id, tabela_franquia_id, categoria_id, franquia_mono, franquia_color, valor_excedente_mono, valor_excedente_color)
  values (v_t, v_tf, v_cat, 3000, 500, 0.0800, 0.4500);

  -- O modelo A tem política própria, mais generosa: é a exceção comercial que
  -- justifica a resolução por especificidade.
  insert into public.tabela_franquia_item
    (tenant_id, tabela_franquia_id, modelo_id, franquia_mono, franquia_color, valor_excedente_mono, valor_excedente_color)
  values (v_t, v_tf, v_mod_a, 8000, 1200, 0.0600, 0.3800);

  raise notice 'caso 2 OK — a mesma tabela comporta política por categoria e por modelo';
end $$;

-- ------------------- caso 3: alvo repetido na mesma tabela é recusado
do $$
declare v_t uuid; v_tf uuid; v_cat uuid; v_erro text := null;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_tf  from _ctx where chave = 'tf';
  select valor::uuid into v_cat from _ctx where chave = 'cat_mfp';

  begin
    insert into public.tabela_franquia_item
      (tenant_id, tabela_franquia_id, categoria_id, franquia_mono, valor_excedente_mono)
    values (v_t, v_tf, v_cat, 4000, 0.09);
  exception when others then v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA: duas linhas para a mesma categoria na mesma tabela — a resolução ficaria ambígua';
  end if;
  raise notice 'caso 3 OK — alvo único por tabela';
end $$;

-- ---------------------------- caso 4: ativação e RN-L15 (modelo vence categoria)
do $$
declare
  v_tf uuid; v_eq_a uuid; v_eq_b uuid; r record;
begin
  select valor::uuid into v_tf   from _ctx where chave = 'tf';
  select valor::uuid into v_eq_a from _ctx where chave = 'eq_a';
  select valor::uuid into v_eq_b from _ctx where chave = 'eq_b';

  update public.tabela_franquia set status = 'ATIVA', ativada_em = now() where id = v_tf;

  -- Equipamento do modelo A: existe linha de modelo, e ela vence.
  select * into r from app.resolver_franquia(v_eq_a, '2026-06-15');
  if r.origem <> 'MODELO' or r.franquia_mono <> 8000 then
    raise exception 'FALHA RN-L15: modelo deveria vencer categoria (origem=%, franquia=%)',
      r.origem, r.franquia_mono;
  end if;

  -- Equipamento do modelo B: sem linha de modelo, cai na categoria.
  select * into r from app.resolver_franquia(v_eq_b, '2026-06-15');
  if r.origem <> 'CATEGORIA' or r.franquia_mono <> 3000 then
    raise exception 'FALHA RN-L15: deveria cair na categoria (origem=%, franquia=%)',
      r.origem, r.franquia_mono;
  end if;

  raise notice 'caso 4 OK — modelo vence categoria; sem linha de modelo, cai na categoria';
end $$;

-- ------------- caso 5: RN-L15, sem política a resolução devolve NADA
do $$
declare v_eq_note uuid; v_n integer;
begin
  select valor::uuid into v_eq_note from _ctx where chave = 'eq_note';

  select count(*) into v_n from app.resolver_franquia(v_eq_note, '2026-06-15');
  -- Devolver franquia zero seria cobrar tudo como excedente, em silêncio. A
  -- ausência precisa ser ausência, para o chamador exigir preenchimento.
  if v_n <> 0 then
    raise exception 'FALHA RN-L15: sem política deveria devolver zero linhas, devolveu %', v_n;
  end if;

  raise notice 'caso 5 OK — ausência de política é ausência, não franquia zero';
end $$;

-- --------------- caso 6: RN-L14, tabela ativa é imutável (cabeçalho e item)
do $$
declare
  v_t uuid; v_tf uuid; v_mod_b uuid;
  v_erro_cab text := null; v_erro_item text := null; v_erro_novo text := null;
begin
  select valor::uuid into v_t      from _ctx where chave = 'tenant';
  select valor::uuid into v_tf     from _ctx where chave = 'tf';
  select valor::uuid into v_mod_b  from _ctx where chave = 'mod_b';

  begin
    update public.tabela_franquia set nome = 'Padrão 2026 (rev)' where id = v_tf;
  exception when others then v_erro_cab := sqlerrm;
  end;
  if v_erro_cab is null then
    raise exception 'FALHA RN-L14: cabeçalho de tabela ativa aceitou alteração';
  end if;

  begin
    update public.tabela_franquia_item set valor_excedente_mono = 0.20
     where tabela_franquia_id = v_tf and categoria_id is not null;
  exception when others then v_erro_item := sqlerrm;
  end;
  if v_erro_item is null then
    raise exception 'FALHA RN-L14: item de tabela ativa aceitou reprecificação — bloquear só o cabeçalho não basta';
  end if;

  begin
    insert into public.tabela_franquia_item
      (tenant_id, tabela_franquia_id, modelo_id, franquia_mono, valor_excedente_mono)
    values (v_t, v_tf, v_mod_b, 5000, 0.07);
  exception when others then v_erro_novo := sqlerrm;
  end;
  if v_erro_novo is null then
    raise exception 'FALHA RN-L14: linha nova aceita em tabela já ativa';
  end if;

  raise notice 'caso 6 OK — cabeçalho, alteração de item e item novo recusados';
end $$;

-- ------------- caso 7: RN-L16, duas tabelas ativas não cobrem o mesmo alvo
do $$
declare
  v_t uuid; v_cat uuid; v_tf2 uuid; v_erro text := null; v_sqlstate text := null;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_cat from _ctx where chave = 'cat_mfp';

  insert into public.tabela_franquia (tenant_id, nome, vigencia_inicio)
    values (v_t, 'Concorrente 2026', '2026-06-01') returning id into v_tf2;
  insert into public.tabela_franquia_item
    (tenant_id, tabela_franquia_id, categoria_id, franquia_mono, valor_excedente_mono)
  values (v_t, v_tf2, v_cat, 2000, 0.10);

  begin
    -- Ativar faz o gatilho marcar os itens como ativos, e é aí que a EXCLUDE
    -- constraint recusa: a categoria já está coberta no período.
    update public.tabela_franquia set status = 'ATIVA', ativada_em = now() where id = v_tf2;
  exception when others then
    v_erro := sqlerrm;
    v_sqlstate := sqlstate;
  end;

  if v_erro is null then
    raise exception 'FALHA RN-L16: duas tabelas ativas cobrindo a mesma categoria no mesmo período';
  end if;
  if v_sqlstate <> '23P01' then
    raise exception 'FALHA RN-L16: recusado com SQLSTATE % (esperado 23P01 exclusion_violation): %',
      v_sqlstate, v_erro;
  end if;

  raise notice 'caso 7 OK — sobreposição recusada por exclusion_violation, não por gatilho com janela';
end $$;

-- ------------- caso 8: vigência adjacente é aceita (intervalo semiaberto)
do $$
declare v_t uuid; v_tf uuid; v_cat uuid; v_tf3 uuid;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_tf  from _ctx where chave = 'tf';
  select valor::uuid into v_cat from _ctx where chave = 'cat_mfp';

  -- Encerra a vigente em 01/07 e faz a próxima começar no mesmo dia. Com
  -- `[)`, não há sobreposição — é como uma sucessão de tabelas de fato ocorre.
  update public.tabela_franquia
     set status = 'INATIVA', vigencia_fim = '2026-07-01' where id = v_tf;

  insert into public.tabela_franquia (tenant_id, nome, vigencia_inicio, substitui_id)
    values (v_t, 'Padrão 2026 v2', '2026-07-01', v_tf) returning id into v_tf3;
  insert into public.tabela_franquia_item
    (tenant_id, tabela_franquia_id, categoria_id, franquia_mono, valor_excedente_mono)
  values (v_t, v_tf3, v_cat, 3500, 0.0850);

  update public.tabela_franquia set status = 'ATIVA', ativada_em = now() where id = v_tf3;

  insert into _ctx values ('tf3', v_tf3::text);
  raise notice 'caso 8 OK — sucessão de tabelas aceita: o intervalo é semiaberto';
end $$;

-- ------------- caso 9: encerrar tabela ativa exige data de fim
do $$
declare v_tf3 uuid; v_erro text := null;
begin
  select valor::uuid into v_tf3 from _ctx where chave = 'tf3';

  begin
    update public.tabela_franquia set status = 'INATIVA' where id = v_tf3;
  exception when others then v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA: tabela encerrada sem data de fim — o histórico não saberia até quando valeu';
  end if;
  raise notice 'caso 9 OK — encerramento sem data de fim recusado';
end $$;

-- ------------- caso 10: RN-L21, precedência Contrato → Cliente → Geral
do $$
declare
  v_t uuid; v_cat uuid; v_cli uuid; v_cli2 uuid; v_ctr uuid;
  v_tp_geral uuid; v_tp_cliente uuid; v_eq_b uuid; r record;
begin
  select valor::uuid into v_t          from _ctx where chave = 'tenant';
  select valor::uuid into v_cat        from _ctx where chave = 'cat_mfp';
  select valor::uuid into v_cli        from _ctx where chave = 'cliente';
  select valor::uuid into v_cli2       from _ctx where chave = 'cliente2';
  select valor::uuid into v_ctr        from _ctx where chave = 'contrato';
  select valor::uuid into v_tp_geral   from _ctx where chave = 'tp_geral';
  select valor::uuid into v_tp_cliente from _ctx where chave = 'tp_cliente';
  select valor::uuid into v_eq_b       from _ctx where chave = 'eq_b';

  insert into public.tabela_preco_item (tenant_id, tabela_preco_id, categoria_id, valor_mensal, valor_instalacao)
    values (v_t, v_tp_geral, v_cat, 289.0000, 120.0000);
  insert into public.tabela_preco_item (tenant_id, tabela_preco_id, categoria_id, valor_mensal, valor_instalacao)
    values (v_t, v_tp_cliente, v_cat, 249.0000, 0);

  update public.tabela_preco set status = 'ATIVA', ativada_em = now()
   where id in (v_tp_geral, v_tp_cliente);

  -- Cliente com tabela negociada recebe o preço dela.
  select * into r from app.resolver_preco(v_eq_b, v_cli, v_ctr, '2026-06-15');
  if r.abrangencia <> 'CLIENTE' or r.valor_mensal <> 249 then
    raise exception 'FALHA RN-L21: cliente com tabela própria deveria pagar 249 (abrang=%, valor=%)',
      r.abrangencia, r.valor_mensal;
  end if;

  -- Cliente sem tabela própria cai na geral.
  select * into r from app.resolver_preco(v_eq_b, v_cli2, null, '2026-06-15');
  if r.abrangencia <> 'GERAL' or r.valor_mensal <> 289 then
    raise exception 'FALHA RN-L21: cliente sem tabela deveria cair na geral (abrang=%, valor=%)',
      r.abrangencia, r.valor_mensal;
  end if;

  raise notice 'caso 10 OK — a tabela do cliente vence a geral, e a ausência dela cai na geral';
end $$;

-- ------------- caso 11: tabela de contrato vence a de cliente
do $$
declare
  v_t uuid; v_cat uuid; v_cli uuid; v_ctr uuid; v_eq_b uuid; v_tp_ctr uuid; r record;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_cat  from _ctx where chave = 'cat_mfp';
  select valor::uuid into v_cli  from _ctx where chave = 'cliente';
  select valor::uuid into v_ctr  from _ctx where chave = 'contrato';
  select valor::uuid into v_eq_b from _ctx where chave = 'eq_b';

  insert into public.tabela_preco (tenant_id, nome, vigencia_inicio, abrangencia, contrato_id)
    values (v_t, 'Condição especial SP-2026-001', '2026-01-01', 'CONTRATO', v_ctr)
    returning id into v_tp_ctr;
  insert into public.tabela_preco_item (tenant_id, tabela_preco_id, categoria_id, valor_mensal)
    values (v_t, v_tp_ctr, v_cat, 199.0000);
  update public.tabela_preco set status = 'ATIVA', ativada_em = now() where id = v_tp_ctr;

  select * into r from app.resolver_preco(v_eq_b, v_cli, v_ctr, '2026-06-15');
  if r.abrangencia <> 'CONTRATO' or r.valor_mensal <> 199 then
    raise exception 'FALHA RN-L21: contrato deveria vencer cliente (abrang=%, valor=%)',
      r.abrangencia, r.valor_mensal;
  end if;

  raise notice 'caso 11 OK — a condição do contrato vence a tabela do cliente';
end $$;

-- ------------- caso 12: reajuste com periodicidade inferior a um ano é nulo
do $$
declare v_t uuid; v_erro text := null;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  begin
    insert into public.tabela_preco (tenant_id, nome, vigencia_inicio, meses_reajuste)
      values (v_t, 'Reajuste semestral', '2026-01-01', 6);
  exception when others then v_erro := sqlerrm;
  end;

  -- Lei 10.192/01, art. 2º §1º: cláusula de reajuste em periodicidade inferior
  -- a um ano é nula de pleno direito. Aceitá-la produziria contrato inexigível.
  if v_erro is null then
    raise exception 'FALHA: aceitou reajuste semestral (Lei 10.192/01 art. 2º §1º)';
  end if;
  raise notice 'caso 12 OK — periodicidade de reajuste abaixo de doze meses recusada';
end $$;

-- ------------- caso 13: RN-L22/L23, desconto vigente e não acumulativo
do $$
declare
  v_t uuid; v_ctr uuid; v_eq_b uuid; v_item uuid; r record; v_n integer;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_ctr   from _ctx where chave = 'contrato';
  select valor::uuid into v_eq_b  from _ctx where chave = 'eq_b';

  insert into public.contrato_item
    (tenant_id, contrato_id, equipamento_id, modalidade_cobranca, valor_unitario, vigencia_inicio, vigencia_fim, status)
  values (v_t, v_ctr, v_eq_b, 'FIXO_MENSAL', 289, '2026-01-01T00:00-03', '2027-01-01T00:00-03', 'ATIVO')
  returning id into v_item;

  insert into public.desconto_comercial
    (tenant_id, contrato_id, tipo, percentual, vigencia_inicio, vigencia_fim, motivo)
  values (v_t, v_ctr, 'PERCENTUAL', 10, '2026-01-01', '2026-12-31', 'Desconto de campanha do contrato');

  insert into public.desconto_comercial
    (tenant_id, contrato_item_id, tipo, percentual, vigencia_inicio, vigencia_fim, motivo)
  values (v_t, v_item, 'PERCENTUAL', 25, '2026-01-01', '2026-03-31', 'Carência de implantação do ativo');

  -- Havendo os dois, vale o de item. Somar produziria 35% — e é assim que
  -- aparece mensalidade negativa em fatura.
  select * into r from app.desconto_vigente(v_item, '2026-02-15');
  if r.origem <> 'ITEM' or r.percentual <> 25 then
    raise exception 'FALHA RN-L23: deveria valer o desconto de item (origem=%, pct=%)', r.origem, r.percentual;
  end if;

  -- Depois de 31/03 a carência expira sozinha e sobra o do contrato. É o ponto
  -- de RN-L22: ninguém precisa lembrar de removê-la.
  select * into r from app.desconto_vigente(v_item, '2026-06-15');
  if r.origem <> 'CONTRATO' or r.percentual <> 10 then
    raise exception 'FALHA RN-L22: a carência deveria ter expirado sozinha (origem=%, pct=%)',
      r.origem, r.percentual;
  end if;

  -- E em 2027 não sobra nada.
  select count(*) into v_n from app.desconto_vigente(v_item, '2027-02-15');
  if v_n <> 0 then
    raise exception 'FALHA RN-L22: desconto ainda vigente após o fim declarado';
  end if;

  raise notice 'caso 13 OK — item vence contrato, e a carência expira sem intervenção';
end $$;

-- ------------- caso 14: desconto sem motivo substantivo é recusado
do $$
declare v_t uuid; v_ctr uuid; v_erro text := null;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_ctr from _ctx where chave = 'contrato';

  begin
    insert into public.desconto_comercial
      (tenant_id, contrato_id, tipo, percentual, vigencia_inicio, motivo)
    values (v_t, v_ctr, 'PERCENTUAL', 15, '2026-01-01', 'ok');
  exception when others then v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA RN-009: desconto aceito com motivo vazio de conteúdo';
  end if;
  raise notice 'caso 14 OK — desconto exige justificativa com substância';
end $$;

-- ------------- caso 15: trocar a tabela não reprecifica contrato vigente
do $$
declare
  v_t uuid; v_ctr uuid; v_item uuid; v_valor numeric(15,4); v_tp_novo uuid; v_cat uuid;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_ctr from _ctx where chave = 'contrato';
  select valor::uuid into v_cat from _ctx where chave = 'cat_mfp';

  select id, valor_unitario into v_item, v_valor
    from public.contrato_item where contrato_id = v_ctr limit 1;

  -- Nova tabela geral, muito mais cara, entrando em vigor no meio do contrato.
  update public.tabela_preco set status = 'INATIVA', vigencia_fim = '2026-07-01'
   where tenant_id = v_t and abrangencia = 'GERAL' and status = 'ATIVA';
  insert into public.tabela_preco (tenant_id, nome, vigencia_inicio)
    values (v_t, 'Tabela geral 2026 v2', '2026-07-01') returning id into v_tp_novo;
  insert into public.tabela_preco_item (tenant_id, tabela_preco_id, categoria_id, valor_mensal)
    values (v_t, v_tp_novo, v_cat, 999.0000);
  update public.tabela_preco set status = 'ATIVA', ativada_em = now() where id = v_tp_novo;

  -- É esta a regra que separa um reajuste comercial de um incidente que atinge
  -- quatrocentos clientes de uma vez.
  if (select valor_unitario from public.contrato_item where id = v_item) <> v_valor then
    raise exception 'FALHA: a troca de tabela alterou o valor do contrato vigente';
  end if;

  raise notice 'caso 15 OK — a tabela nova não tocou no que o cliente já acordou';
end $$;

rollback;

\echo '== 06_rnl_franquia_e_preco: TODOS OS CASOS APROVADOS =='
