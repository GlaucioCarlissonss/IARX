-- =============================================================================
-- TESTE — Controle de despesas: categoria, orçamento e execução
--
-- RN-F23  replanejamento move valor, e nunca acima do não comprometido
-- RN-F24  limiar de execução é calculado, nunca guardado
--   D-25  comprometido é o gasto **e** o aprovado-não-pago
--
-- O que está em jogo, em uma frase: **um painel de despesa que não fecha com
-- contas a pagar é pior que nenhum painel**. Ele parece medir, e a diferença
-- entre os dois números não aparece como erro — aparece como um percentual
-- ligeiramente errado que ninguém confere.
--
-- Por isso o caso central não é o orçamento: é a categoria residual. A decisão
-- do operador foi que todo título já lançado aponta para "Não categorizado",
-- e este arquivo prova as duas metades disso — o backfill não deixou título sem
-- categoria, e o gatilho mantém a promessa para os títulos que ainda vão nascer.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_t uuid := gen_random_uuid();
  v_emp uuid; v_fil uuid;
  v_residual uuid; v_soft uuid; v_lic uuid; v_tel uuid;
  v_cc uuid; v_cc2 uuid;
  v_orc_a uuid; v_orc_b uuid;
  v_titulo uuid;
  v_erro text;
  v_n integer;
  v_valor numeric;
begin
  insert into public.tenant (id, nome) values (v_t, 'Locadora Despesa');
  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_t, 'DESPESA LTDA', '11222333000181') returning id into v_emp;
  insert into public.filial (tenant_id, empresa_id, codigo, nome)
    values (v_t, v_emp, 'SP-01', 'Base SP') returning id into v_fil;
  insert into public.centro_custo (tenant_id, codigo, nome)
    values (v_t, 'ADM', 'Administrativo') returning id into v_cc;
  insert into public.centro_custo (tenant_id, codigo, nome)
    values (v_t, 'OPE', 'Operação') returning id into v_cc2;

  -- ---------- caso 1: a residual nasce com o locatário
  --
  -- Provisionada pelo gatilho `tenant_provisiona_perfis`, não por este teste. Se
  -- não existir, é a 0023 que falhou, e o teste precisa acusar isso e não seguir
  -- com uma categoria de mentira.
  select id into v_residual from public.categoria_despesa
   where tenant_id = v_t and residual and deleted_at is null;
  if v_residual is null then
    raise exception 'FALHA: a 0023 não provisionou a categoria residual deste locatário';
  end if;
  raise notice 'caso 1 OK — a categoria residual nasce com o locatário';

  -- ---------- caso 2: uma residual por locatário, e só uma
  v_erro := null;
  begin
    insert into public.categoria_despesa (tenant_id, nome, residual)
      values (v_t, 'Outra residual', true);
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: o locatário aceitou duas categorias residuais — o gatilho não saberia qual usar';
  end if;
  raise notice 'caso 2 OK — residual é única por locatário';

  insert into public.categoria_despesa (tenant_id, nome, classificacao_sugerida)
    values (v_t, 'Software', 'DESPESA_FIXA') returning id into v_soft;
  insert into public.categoria_despesa (tenant_id, nome, categoria_pai_id)
    values (v_t, 'Licenças', v_soft) returning id into v_lic;
  insert into public.categoria_despesa (tenant_id, nome, classificacao_sugerida)
    values (v_t, 'Telefonia', 'DESPESA_VARIAVEL') returning id into v_tel;

  -- ---------- caso 3: dois níveis, e o terceiro é recusado
  v_erro := null;
  begin
    insert into public.categoria_despesa (tenant_id, nome, categoria_pai_id)
      values (v_t, 'Anuais', v_lic);
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: aceitou o terceiro nível de categoria';
  end if;
  raise notice 'caso 3 OK — categoria vai até dois níveis';

  -- ---------- caso 4: ciclo é impossível
  v_erro := null;
  begin
    update public.categoria_despesa set categoria_pai_id = v_lic where id = v_soft;
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: aceitou um ciclo na árvore de categorias';
  end if;
  raise notice 'caso 4 OK — ciclo recusado pela mesma travessia';

  -- ---------- caso 5: título sem categoria cai na residual
  --
  -- É a metade da decisão do operador que vale **depois** do backfill. Sem ela,
  -- o total do painel voltaria a divergir do de contas a pagar no primeiro
  -- título lançado por uma rota que não conhece categoria — e a divergência
  -- apareceria como um número, não como um erro.
  insert into public.titulo_pagar
    (tenant_id, empresa_id, filial_id, descricao, classificacao,
     valor_original, data_emissao, data_vencimento, status)
  values (v_t, v_emp, v_fil, 'Energia elétrica da base', 'DESPESA_VARIAVEL',
          1000, current_date, current_date + 30, 'APROVADO')
  returning id into v_titulo;

  select categoria_id into v_residual from public.titulo_pagar where id = v_titulo;
  if v_residual is null then
    raise exception 'FALHA: título nasceu sem categoria — o painel deixaria de fechar com contas a pagar';
  end if;
  if not (select residual from public.categoria_despesa where id = v_residual) then
    raise exception 'FALHA: o gatilho apontou para uma categoria que não é a residual';
  end if;
  raise notice 'caso 5 OK — título sem categoria cai na residual';

  -- ---------- caso 6: nenhum título fica sem categoria, em locatário nenhum
  select count(*) into v_n from public.titulo_pagar where categoria_id is null and deleted_at is null;
  if v_n > 0 then
    raise exception 'FALHA: % título(s) sem categoria — o backfill da 0023 não alcançou tudo', v_n;
  end if;
  raise notice 'caso 6 OK — o backfill não deixou título órfão';

  -- ---------- caso 7: o realizado segue o título, e cancelar muda a conta
  --
  -- É o critério de aceite que prova que nada foi armazenado: sem job de
  -- recálculo, sem coluna de acumulado, a consulta seguinte já responde outro
  -- número.
  insert into public.titulo_pagar
    (tenant_id, empresa_id, filial_id, categoria_id, descricao, classificacao,
     valor_original, data_emissao, data_vencimento, status)
  values (v_t, v_emp, v_fil, v_tel, 'Telefonia móvel', 'DESPESA_VARIAVEL',
          4000, current_date, current_date + 30, 'APROVADO')
  returning id into v_titulo;

  v_valor := app.despesa_realizada(v_t, current_date - 1, current_date + 1, v_tel, null, null, null);
  if v_valor <> 4000 then
    raise exception 'FALHA: realizado de telefonia deu % em vez de 4000', v_valor;
  end if;

  update public.titulo_pagar set status = 'CANCELADO' where id = v_titulo;
  v_valor := app.despesa_realizada(v_t, current_date - 1, current_date + 1, v_tel, null, null, null);
  if v_valor <> 0 then
    raise exception 'FALHA: título cancelado continuou contando (%), logo há acumulado guardado', v_valor;
  end if;
  raise notice 'caso 7 OK — cancelar muda a execução na consulta seguinte, sem job';

  -- ---------- caso 8: NULLS NOT DISTINCT, ou o mesmo orçamento conta duas vezes
  insert into public.orcamento (tenant_id, ano, mes, centro_custo_id, valor_orcado)
    values (v_t, 2026, 8, v_cc, 50000) returning id into v_orc_a;

  v_erro := null;
  begin
    -- Mesma dimensão, `categoria_id` nulo nas duas. No padrão do Postgres os
    -- nulos seriam distintos e esta linha entraria — e a execução passaria a
    -- somar o mesmo orçamento duas vezes, com os dois números parecendo certos.
    insert into public.orcamento (tenant_id, ano, mes, centro_custo_id, valor_orcado)
      values (v_t, 2026, 8, v_cc, 30000);
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: duas linhas de orçamento geral na mesma dimensão — a execução contaria em dobro';
  end if;
  raise notice 'caso 8 OK — NULLS NOT DISTINCT impede o orçamento duplicado';

  -- ---------- caso 9: D-25 — o aprovado-não-pago já está comprometido
  --
  -- É a metade da decisão que um teste ingênuo não pega: com só o pago contando,
  -- este replanejamento passaria, e a verba que já tem destino sairia da linha.
  insert into public.orcamento (tenant_id, ano, mes, categoria_id, centro_custo_id, valor_orcado)
    values (v_t, 2026, 8, v_soft, v_cc, 20000) returning id into v_orc_b;

  insert into public.titulo_pagar
    (tenant_id, empresa_id, filial_id, categoria_id, descricao, classificacao,
     valor_original, data_emissao, data_vencimento, status)
  values (v_t, v_emp, v_fil, v_soft, 'Renovação de licenças', 'DESPESA_FIXA',
          18000, make_date(2026, 8, 10), make_date(2026, 9, 10), 'APROVADO')
  returning id into v_titulo;
  insert into public.titulo_pagar_rateio (tenant_id, titulo_id, centro_custo_id, percentual)
    values (v_t, v_titulo, v_cc, 100);

  v_valor := app.orcamento_comprometido(v_orc_b);
  if v_valor <> 18000 then
    raise exception 'FALHA: comprometido deu % em vez de 18000 — aprovado-não-pago não contou (D-25)', v_valor;
  end if;
  raise notice 'caso 9 OK — aprovado e não pago já compromete a verba';

  -- ---------- caso 10: RN-F23 recusa acima do não comprometido
  v_erro := null;
  begin
    insert into public.replanejamento_orcamento
      (tenant_id, orcamento_origem_id, orcamento_destino_id, valor_transferido, motivo)
    values (v_t, v_orc_b, v_orc_a, 5000, 'sobra aparente de licenças');
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: replanejou verba já comprometida';
  end if;
  raise notice 'caso 10 OK — replanejamento não passa do saldo não comprometido';

  -- ---------- caso 11: dentro do saldo, move dos dois lados na mesma transação
  insert into public.replanejamento_orcamento
    (tenant_id, orcamento_origem_id, orcamento_destino_id, valor_transferido, motivo)
  values (v_t, v_orc_b, v_orc_a, 2000, 'realocação para o administrativo');

  select valor_orcado into v_valor from public.orcamento where id = v_orc_b;
  if v_valor <> 18000 then
    raise exception 'FALHA: a origem ficou com % em vez de 18000', v_valor;
  end if;
  select valor_orcado into v_valor from public.orcamento where id = v_orc_a;
  if v_valor <> 52000 then
    raise exception 'FALHA: o destino ficou com % em vez de 52000 — replanejamento criou ou destruiu valor', v_valor;
  end if;
  raise notice 'caso 11 OK — RN-F23 move, nunca cria nem destrói';

  -- ---------- caso 12: replanejamento não se apaga
  v_erro := null;
  begin
    delete from public.replanejamento_orcamento where tenant_id = v_t;
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: apagou um replanejamento — os dois orçamentos ficariam alterados sem registro do porquê';
  end if;
  raise notice 'caso 12 OK — replanejamento é imutável';

  -- ---------- caso 13: o limiar acompanha o dado, não um estado gravado
  select limiar into v_erro from app.execucao_orcamentaria(2026, 8) where orcamento_id = v_orc_b;
  if v_erro <> 'ESTOURADO' then
    raise exception 'FALHA: 18000 sobre 18000 deu limiar % em vez de ESTOURADO', v_erro;
  end if;

  update public.titulo_pagar set status = 'CANCELADO' where id = v_titulo;
  select limiar into v_erro from app.execucao_orcamentaria(2026, 8) where orcamento_id = v_orc_b;
  if v_erro <> 'NORMAL' then
    raise exception 'FALHA: cancelado o título, o limiar continuou % — o alerta ficou guardado', v_erro;
  end if;
  raise notice 'caso 13 OK — RN-F24: o alerta some quando o dado deixa de sustentá-lo';

  -- ---------- caso 14: rateio, para a soma dos centros não exceder a despesa
  insert into public.titulo_pagar
    (tenant_id, empresa_id, filial_id, categoria_id, descricao, classificacao,
     valor_original, data_emissao, data_vencimento, status)
  values (v_t, v_emp, v_fil, v_tel, 'Link dedicado rateado', 'DESPESA_FIXA',
          10000, make_date(2026, 8, 5), make_date(2026, 9, 5), 'PAGO')
  returning id into v_titulo;
  /*
   * 60/40, e não 60 sozinho: RN-F09 exige que o rateio some exatamente 100%.
   * Foi o gatilho da 0019 que recusou a primeira versão deste caso — o rateio
   * parcial deixaria 40% da despesa sem centro nenhum, e a soma dos centros
   * deixaria de bater com a despesa total por um motivo invisível.
   */
  insert into public.titulo_pagar_rateio (tenant_id, titulo_id, centro_custo_id, percentual)
    values (v_t, v_titulo, v_cc, 60), (v_t, v_titulo, v_cc2, 40);

  v_valor := app.despesa_realizada(v_t, make_date(2026,8,1), make_date(2026,8,31), v_tel, v_cc, null, null);
  if v_valor <> 6000 then
    raise exception 'FALHA: com 60%% no centro, o realizado deu % em vez de 6000', v_valor;
  end if;
  raise notice 'caso 14 OK — o centro recebe a parte rateada, não o título inteiro';
end $$;

-- ------------- caso 15: nada de acumulado guardado
--
-- A execução orçamentária é função. Se algum dia alguém acrescentar uma coluna
-- `gasto_acumulado` "para performance", ela passa a ter caminho de escrita — e
-- caminho de escrita é caminho de divergência. É o mesmo teste de ausência que
-- os Módulos 9, 10 e 13 têm.
do $$
declare v_col text;
begin
  select string_agg(table_name || '.' || column_name, ', ') into v_col
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('orcamento', 'categoria_despesa')
     and column_name in ('gasto', 'gasto_acumulado', 'realizado', 'saldo', 'percentual_execucao');

  if v_col is not null then
    raise exception 'FALHA: execução virou coluna em %, e com ela um caminho de escrita', v_col;
  end if;
  raise notice 'caso 15 OK — a execução continua derivada';
end $$;

rollback;

\echo '== 16_rnf_despesas: TODOS OS CASOS APROVADOS =='
