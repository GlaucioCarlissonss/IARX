-- =============================================================================
-- TESTE RN-L42 … RN-L47 — Centro de custo e conta bancária
--
-- RN-L42  profundidade máxima 3, e ciclo impossível
-- RN-L43  inativar centro com filho ativo é recusado
-- RN-L44  saldo é derivado, nunca gravado
-- RN-L45  transferência é dupla entrada, ou nenhuma
-- RN-L46  movimentação não se edita nem se apaga
-- RN-L47  conta bloqueada não aceita movimentação manual
--
-- O que está em jogo: estas duas tabelas são a base dos cinco módulos
-- financeiros seguintes. Um saldo que divirja das movimentações, ou uma
-- transferência com uma perna só, não aparece como erro — aparece como dinheiro
-- que não fecha, meses depois, sem nenhuma pista de onde começou.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_t uuid := gen_random_uuid();
  v_emp uuid;
  v_raiz uuid; v_n2 uuid; v_n3 uuid;
  v_conta_a uuid; v_conta_b uuid;
begin
  insert into public.tenant (id, nome) values (v_t, 'Locadora Financeira');
  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_t, 'Locadora Financeira LTDA', '11222333000181') returning id into v_emp;

  -- Árvore de três níveis, o máximo permitido.
  insert into public.centro_custo (tenant_id, codigo, nome)
    values (v_t, 'ADM', 'Administrativo') returning id into v_raiz;
  insert into public.centro_custo (tenant_id, codigo, nome, centro_pai_id)
    values (v_t, 'ADM-TI', 'Tecnologia', v_raiz) returning id into v_n2;
  insert into public.centro_custo (tenant_id, codigo, nome, centro_pai_id)
    values (v_t, 'ADM-TI-INFRA', 'Infraestrutura', v_n2) returning id into v_n3;

  insert into public.conta_bancaria
    (tenant_id, empresa_id, banco_codigo, agencia, numero, tipo, apelido,
     saldo_inicial, data_saldo_inicial)
    values (v_t, v_emp, '341', '1234', '567890', 'CORRENTE', 'Operação',
            1000.0000, date '2026-01-01')
    returning id into v_conta_a;
  insert into public.conta_bancaria
    (tenant_id, empresa_id, banco_codigo, agencia, numero, tipo, apelido,
     saldo_inicial, data_saldo_inicial)
    values (v_t, v_emp, '001', '4321', '098765', 'CORRENTE', 'Folha',
            0.0000, date '2026-01-01')
    returning id into v_conta_b;

  create temporary table _ctx (chave text primary key, valor text);
  insert into _ctx values
    ('tenant', v_t::text), ('empresa', v_emp::text),
    ('raiz', v_raiz::text), ('n2', v_n2::text), ('n3', v_n3::text),
    ('conta_a', v_conta_a::text), ('conta_b', v_conta_b::text);
end $$;

-- ------------------------------------- caso 1: quarto nível de centro é recusado
do $$
declare v_t uuid; v_n3 uuid; v_erro text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_n3 from _ctx where chave = 'n3';

  begin
    insert into public.centro_custo (tenant_id, codigo, nome, centro_pai_id)
      values (v_t, 'ADM-TI-INFRA-REDE', 'Rede', v_n3);
    raise exception 'FALHA RN-L42: quarto nível foi aceito';
  exception when check_violation then
    v_erro := sqlerrm;
  end;

  -- A mensagem tem de citar o nível. "Operação inválida" obrigaria quem
  -- configura a adivinhar qual das regras da árvore ele violou.
  if v_erro not like '%nível%' or v_erro not like '%3%' then
    raise exception 'FALHA RN-L42: a recusa não diz qual é o limite: %', v_erro;
  end if;

  raise notice 'caso 1 OK — o quarto nível é recusado, citando a profundidade';
end $$;

-- ------------------------------------------------- caso 2: ciclo é impossível
do $$
declare v_raiz uuid; v_n3 uuid; v_erro text;
begin
  select valor::uuid into v_raiz from _ctx where chave = 'raiz';
  select valor::uuid into v_n3 from _ctx where chave = 'n3';

  -- Apontar a raiz para o próprio neto. Sem a parada da travessia, o gatilho
  -- rodaria para sempre e o sintoma seria uma conexão presa em produção — não
  -- uma exceção.
  begin
    update public.centro_custo set centro_pai_id = v_n3 where id = v_raiz;
    raise exception 'FALHA RN-L42: ciclo foi aceito';
  exception when check_violation then
    v_erro := sqlerrm;
  end;

  if v_erro not like '%si mesmo%' then
    raise exception 'FALHA RN-L42: a recusa do ciclo não explica o motivo: %', v_erro;
  end if;

  raise notice 'caso 2 OK — centro não descende de si mesmo, e a travessia termina';
end $$;

-- --------------------------------- caso 3: pai igual a si mesmo, o ciclo de um
do $$
declare v_raiz uuid;
begin
  select valor::uuid into v_raiz from _ctx where chave = 'raiz';

  begin
    update public.centro_custo set centro_pai_id = v_raiz where id = v_raiz;
    raise exception 'FALHA: centro apontando para si mesmo foi aceito';
  exception when check_violation then
    null;
  end;

  raise notice 'caso 3 OK — o ciclo de tamanho 1 é barrado pelo CHECK, antes do gatilho';
end $$;

-- ------------------------ caso 4: inativar centro com filho ativo é recusado
do $$
declare v_raiz uuid; v_n2 uuid; v_n3 uuid; v_erro text;
begin
  select valor::uuid into v_raiz from _ctx where chave = 'raiz';
  select valor::uuid into v_n2 from _ctx where chave = 'n2';
  select valor::uuid into v_n3 from _ctx where chave = 'n3';

  begin
    update public.centro_custo set ativo = false where id = v_raiz;
    raise exception 'FALHA RN-L43: inativação em cascata silenciosa foi aceita';
  exception when check_violation then
    v_erro := sqlerrm;
  end;

  if v_erro not like '%subcentro%' then
    raise exception 'FALHA RN-L43: a recusa não diz o que impede: %', v_erro;
  end if;

  -- Da folha para a raiz funciona, e é o caminho que torna o estrago visível
  -- antes de acontecer.
  update public.centro_custo set ativo = false where id = v_n3;
  update public.centro_custo set ativo = false where id = v_n2;
  update public.centro_custo set ativo = false where id = v_raiz;

  -- Reativa para não contaminar os casos seguintes.
  update public.centro_custo set ativo = true where tenant_id = (select valor::uuid from _ctx where chave = 'tenant');

  raise notice 'caso 4 OK — inativa da folha para a raiz, nunca em cascata';
end $$;

-- ----------------------------------- caso 5: não existe coluna de saldo atual
do $$
declare v_n integer;
begin
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'conta_bancaria'
    and column_name in ('saldo', 'saldo_atual');

  -- O teste é sobre a ausência. Uma coluna de saldo mantida por gatilho
  -- divergiria na primeira correção manual em produção — e a correção manual
  -- em produção acontece.
  if v_n <> 0 then
    raise exception 'FALHA RN-L44: existe(m) % coluna(s) de saldo gravável', v_n;
  end if;

  raise notice 'caso 5 OK — saldo não tem onde ser gravado, logo não tem como divergir';
end $$;

-- ------------------------------ caso 6: o saldo derivado bate com a aritmética
do $$
declare v_t uuid; v_conta uuid; v_saldo numeric;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_conta from _ctx where chave = 'conta_a';

  insert into public.movimentacao_bancaria
    (tenant_id, conta_id, tipo, valor, data_movimento, descricao)
  values
    (v_t, v_conta, 'ENTRADA', 500.0000, date '2026-02-10', 'Recebimento'),
    (v_t, v_conta, 'SAIDA', 200.0000, date '2026-02-11', 'Pagamento'),
    (v_t, v_conta, 'TAXA', 15.5000, date '2026-02-11', 'Tarifa de manutenção');

  -- 1000 + 500 − 200 − 15,50
  select app.saldo_conta(v_conta) into v_saldo;
  if v_saldo <> 1284.5000 then
    raise exception 'FALHA RN-L44: saldo % em vez de 1284.5000', v_saldo;
  end if;

  -- Saldo em data passada: é o que a conciliação precisa. Comparar com o
  -- extrato do dia 10 exige o saldo do dia 10, não o de hoje.
  select app.saldo_conta(v_conta, date '2026-02-10') into v_saldo;
  if v_saldo <> 1500.0000 then
    raise exception 'FALHA RN-L44: saldo em 10/02 deu % em vez de 1500.0000', v_saldo;
  end if;

  raise notice 'caso 6 OK — saldo derivado bate, e aceita data de corte';
end $$;

-- ------------------- caso 7: movimentação anterior ao saldo inicial não conta
do $$
declare v_t uuid; v_conta uuid; v_saldo numeric;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_conta from _ctx where chave = 'conta_a';

  -- O saldo inicial de 01/01 já inclui tudo o que veio antes, por definição de
  -- "saldo naquela data". Somar de novo contaria a mesma entrada duas vezes.
  insert into public.movimentacao_bancaria
    (tenant_id, conta_id, tipo, valor, data_movimento, descricao)
  values (v_t, v_conta, 'ENTRADA', 9999.0000, date '2025-12-20', 'Anterior ao saldo inicial');

  select app.saldo_conta(v_conta) into v_saldo;
  if v_saldo <> 1284.5000 then
    raise exception 'FALHA RN-L44: movimentação anterior ao saldo inicial entrou na soma (%)', v_saldo;
  end if;

  raise notice 'caso 7 OK — o saldo inicial não é somado duas vezes';
end $$;

-- ------------------------------------------ caso 8: transferência é dupla entrada
do $$
declare
  v_t uuid; v_a uuid; v_b uuid;
  v_saida uuid; v_entrada uuid;
  v_par_saida uuid; v_par_entrada uuid;
  v_saldo_a numeric; v_saldo_b numeric;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_a from _ctx where chave = 'conta_a';
  select valor::uuid into v_b from _ctx where chave = 'conta_b';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select saida_id, entrada_id into v_saida, v_entrada
  from app.transferir_entre_contas(v_a, v_b, 300.0000, date '2026-02-12', 'Provisão de folha');

  select transferencia_par_id into v_par_saida from public.movimentacao_bancaria where id = v_saida;
  select transferencia_par_id into v_par_entrada from public.movimentacao_bancaria where id = v_entrada;

  -- Cada perna aponta para a outra. Uma perna órfã é uma transferência que
  -- saiu de uma conta e não entrou em nenhuma.
  if v_par_saida <> v_entrada or v_par_entrada <> v_saida then
    raise exception 'FALHA RN-L45: as pernas não se referenciam (% / %)', v_par_saida, v_par_entrada;
  end if;

  select app.saldo_conta(v_a) into v_saldo_a;
  select app.saldo_conta(v_b) into v_saldo_b;
  if v_saldo_a <> 984.5000 or v_saldo_b <> 300.0000 then
    raise exception 'FALHA RN-L45: saldos após transferência: % e %', v_saldo_a, v_saldo_b;
  end if;

  -- O par fecha uma vez e não se reaponta. Sem esta metade da regra, um update
  -- posterior costuraria a perna de uma transferência na perna de outra, e a
  -- dupla entrada deixaria de fechar sem que nenhuma linha parecesse errada.
  begin
    update public.movimentacao_bancaria set transferencia_par_id = v_saida where id = v_saida;
    raise exception 'FALHA RN-L46: o par da transferência foi reapontado';
  exception when check_violation then
    null;
  end;

  reset role;
  raise notice 'caso 8 OK — dupla entrada, pernas se referenciando, e par que não se reaponta';
end $$;

-- --------------------- caso 9: transferência para a mesma conta é recusada
do $$
declare v_t uuid; v_a uuid;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_a from _ctx where chave = 'conta_a';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  begin
    perform app.transferir_entre_contas(v_a, v_a, 10.0000, date '2026-02-12', 'Círculo');
    raise exception 'FALHA RN-L45: transferência para a própria conta foi aceita';
  exception when check_violation then
    null;
  end;

  reset role;
  raise notice 'caso 9 OK — transferência exige duas contas distintas';
end $$;

-- ----------------------------- caso 10: movimentação não se edita nem se apaga
do $$
declare v_t uuid; v_conta uuid; v_mov uuid; v_erro text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_conta from _ctx where chave = 'conta_a';

  select id into v_mov from public.movimentacao_bancaria
  where conta_id = v_conta and tipo = 'SAIDA' limit 1;

  begin
    update public.movimentacao_bancaria set valor = 1.0000 where id = v_mov;
    raise exception 'FALHA RN-L46: valor de movimentação foi alterado';
  exception when check_violation then
    v_erro := sqlerrm;
  end;
  if v_erro not like '%estorno%' then
    raise exception 'FALHA RN-L46: a recusa não aponta a saída: %', v_erro;
  end if;

  begin
    delete from public.movimentacao_bancaria where id = v_mov;
    raise exception 'FALHA RN-L46: movimentação foi apagada';
  exception when check_violation then
    null;
  end;

  -- Conciliar é a exceção deliberada: não muda o fato financeiro, muda o que
  -- sabemos sobre ele.
  update public.movimentacao_bancaria
     set conciliado = true, conciliado_em = now()
   where id = v_mov;

  raise notice 'caso 10 OK — só a conciliação muda depois do lançamento';
end $$;

-- ------------------------------------------- caso 11: estorno exige motivo
do $$
declare v_t uuid; v_conta uuid; v_mov uuid;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_conta from _ctx where chave = 'conta_a';
  select id into v_mov from public.movimentacao_bancaria
  where conta_id = v_conta and tipo = 'SAIDA' limit 1;

  begin
    insert into public.movimentacao_bancaria
      (tenant_id, conta_id, tipo, valor, data_movimento, descricao, estorna_id)
    values (v_t, v_conta, 'ENTRADA', 200.0000, date '2026-02-13', 'Estorno', v_mov);
    raise exception 'FALHA: estorno sem motivo foi aceito';
  exception when check_violation then
    null;
  end;

  insert into public.movimentacao_bancaria
    (tenant_id, conta_id, tipo, valor, data_movimento, descricao, estorna_id, motivo)
  values (v_t, v_conta, 'ENTRADA', 200.0000, date '2026-02-13', 'Estorno', v_mov,
          'pagamento em duplicidade identificado na conciliação');

  raise notice 'caso 11 OK — estorno é lançamento contrário, e exige motivo';
end $$;

-- ------------------------- caso 12: conta bloqueada e conta inativa
do $$
declare v_t uuid; v_conta uuid; v_erro text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_conta from _ctx where chave = 'conta_b';

  update public.conta_bancaria set status = 'BLOQUEADA' where id = v_conta;

  begin
    insert into public.movimentacao_bancaria
      (tenant_id, conta_id, tipo, valor, data_movimento, descricao)
    values (v_t, v_conta, 'SAIDA', 10.0000, date '2026-02-14', 'Manual em conta bloqueada');
    raise exception 'FALHA RN-L47: lançamento manual em conta bloqueada foi aceito';
  exception when check_violation then
    v_erro := sqlerrm;
  end;
  if v_erro not like '%bloqueada%' then
    raise exception 'FALHA RN-L47: a recusa não diz o motivo: %', v_erro;
  end if;

  -- Importação de extrato continua passando: bloquear uma conta no meio de uma
  -- baixa em curso não deve travar a baixa.
  insert into public.movimentacao_bancaria
    (tenant_id, conta_id, tipo, valor, data_movimento, descricao, origem_extrato)
  values (v_t, v_conta, 'SAIDA', 10.0000, date '2026-02-14', 'Vinda do extrato',
          '20260214;-10,00;TARIFA');

  -- Inativa recusa tudo, sem exceção.
  update public.conta_bancaria set status = 'INATIVA' where id = v_conta;
  begin
    insert into public.movimentacao_bancaria
      (tenant_id, conta_id, tipo, valor, data_movimento, descricao, origem_extrato)
    values (v_t, v_conta, 'SAIDA', 1.0000, date '2026-02-15', 'Extrato em conta inativa', 'x');
    raise exception 'FALHA RN-L47: conta inativa aceitou movimentação';
  exception when check_violation then
    null;
  end;

  raise notice 'caso 12 OK — bloqueada recusa manual e aceita extrato; inativa recusa tudo';
end $$;

-- ------------------------------------- caso 13: isolamento por locatário
do $$
declare v_t uuid; v_outro uuid := gen_random_uuid(); v_n integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  insert into public.tenant (id, nome) values (v_outro, 'Outra Locadora');

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  select count(*) into v_n from public.centro_custo;
  if v_n = 0 then
    raise exception 'FALHA: o locatário não enxerga os próprios centros de custo';
  end if;

  perform set_config('app.tenant_id', v_outro::text, true);
  select count(*) into v_n from public.centro_custo;
  if v_n <> 0 then
    raise exception 'FALHA RN-028: % centro(s) de custo de outro locatário visíveis', v_n;
  end if;
  select count(*) into v_n from public.conta_bancaria;
  if v_n <> 0 then
    raise exception 'FALHA RN-028: % conta(s) de outro locatário visíveis', v_n;
  end if;
  select count(*) into v_n from public.movimentacao_bancaria;
  if v_n <> 0 then
    raise exception 'FALHA RN-028: % movimentação(ões) de outro locatário visíveis', v_n;
  end if;

  reset role;
  raise notice 'caso 13 OK — as três tabelas isoladas por locatário';
end $$;

-- --------------------- caso 14: conta bancária nunca chega ao portal do cliente
do $$
declare v_n integer;
begin
  -- Conta bancária e centro de custo são estrutura interna do locador. Uma
  -- política de leitura para `authenticated` os exporia ao portal — que é
  -- exatamente o caminho por onde um locatário veria a conta do outro cliente.
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public'
    and tablename in ('conta_bancaria', 'movimentacao_bancaria', 'centro_custo')
    and 'authenticated' = any(roles);

  if v_n <> 0 then
    raise exception 'FALHA: % política(s) expõem estrutura financeira interna a authenticated', v_n;
  end if;

  raise notice 'caso 14 OK — nenhuma política de cliente sobre estrutura financeira interna';
end $$;

rollback;

\echo '== 10_rnl_centro_custo_conta_bancaria: TODOS OS CASOS APROVADOS =='
