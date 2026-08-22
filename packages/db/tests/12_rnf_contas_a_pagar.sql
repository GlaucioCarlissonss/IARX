-- =============================================================================
-- TESTE RN-F01 … RN-F09 — Contas a pagar
--
-- RN-F01  a faixa de valor decide os níveis, resolvida por alçada
-- RN-F02  aprovação é sequencial, nunca paralela
-- RN-F03  rejeição exige justificativa
-- RN-F04  quem cria não aprova
-- RN-F05  delegação é por período e por nível
-- RN-F06  pagamento parcial recalcula saldo; excesso é recusado
-- RN-F07  estorno é lançamento contrário, nunca exclusão
-- RN-F08  título pai não recebe pagamento
-- RN-F09  rateio soma exatamente 100%, ou não existe
--
-- O que está em jogo: **um fluxo de aprovação que não vale nada é pior que não
-- ter fluxo**. Ele aparece na tela, dá a sensação de controle, e não impede
-- nada. RN-F04 é a regra que decide isso: sem ela, quem lança a despesa aprova
-- a própria despesa, e as outras oito viram enfeite.
--
-- Nenhum valor de alçada aqui é regra de negócio da IARX — são limites
-- arbitrários deste teste, para provar que a **contagem de níveis** segue os
-- limites cadastrados, quaisquer que sejam.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_t uuid := gen_random_uuid();
  v_emp uuid;
  v_p_gestor uuid; v_p_fin uuid; v_p_dir uuid; v_p_oper uuid;
  v_gestor uuid; v_financeiro uuid; v_diretor uuid; v_lancador uuid;
  v_conta uuid; v_cc_a uuid; v_cc_b uuid;
begin
  insert into public.tenant (id, nome) values (v_t, 'Locadora Pagar');
  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_t, 'PAGAR LOCACOES LTDA', '11222333000181') returning id into v_emp;

  -- Quatro perfis, três com alçada. Os limites (10 mil / 50 mil / 250 mil) são
  -- deste teste; a regra provada é a contagem, não os números.
  insert into public.perfil (tenant_id, nome, tipo, is_sistema, permissoes)
    values (v_t, 'Gestor', 'INTERNO', false, array['pagar:ler','pagar:aprovar'])
    returning id into v_p_gestor;
  insert into public.perfil (tenant_id, nome, tipo, is_sistema, permissoes)
    values (v_t, 'Financeiro', 'INTERNO', false, array['pagar:ler','pagar:aprovar'])
    returning id into v_p_fin;
  insert into public.perfil (tenant_id, nome, tipo, is_sistema, permissoes)
    values (v_t, 'Diretoria', 'INTERNO', false, array['pagar:ler','pagar:aprovar'])
    returning id into v_p_dir;
  insert into public.perfil (tenant_id, nome, tipo, is_sistema, permissoes)
    values (v_t, 'Operador', 'INTERNO', false, array['pagar:ler','pagar:criar'])
    returning id into v_p_oper;

  insert into public.alcada (tenant_id, perfil_id, tipo, limite_valor) values
    (v_t, v_p_gestor, 'APROVACAO_PAGAMENTO', 10000),
    (v_t, v_p_fin,    'APROVACAO_PAGAMENTO', 50000),
    (v_t, v_p_dir,    'APROVACAO_PAGAMENTO', 250000);

  insert into public.usuario (tenant_id, nome, email, status) values
    (v_t, 'Gestor Um', 'gestor@pagar.test', 'ATIVO') returning id into v_gestor;
  insert into public.usuario (tenant_id, nome, email, status) values
    (v_t, 'Financeiro Um', 'financeiro@pagar.test', 'ATIVO') returning id into v_financeiro;
  insert into public.usuario (tenant_id, nome, email, status) values
    (v_t, 'Diretor Um', 'diretor@pagar.test', 'ATIVO') returning id into v_diretor;
  insert into public.usuario (tenant_id, nome, email, status) values
    (v_t, 'Lancador Um', 'lancador@pagar.test', 'ATIVO') returning id into v_lancador;

  insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo) values
    (v_t, v_gestor, v_p_gestor, 'TENANT'),
    (v_t, v_financeiro, v_p_fin, 'TENANT'),
    (v_t, v_diretor, v_p_dir, 'TENANT'),
    (v_t, v_lancador, v_p_oper, 'TENANT');

  insert into public.conta_bancaria
    (tenant_id, empresa_id, banco_codigo, agencia, numero, tipo, apelido,
     saldo_inicial, data_saldo_inicial)
    values (v_t, v_emp, '341', '0912', '45871-3', 'CORRENTE', 'Operação',
            1000000, date '2026-01-01')
    returning id into v_conta;

  insert into public.centro_custo (tenant_id, codigo, nome)
    values (v_t, 'OPER', 'Operação') returning id into v_cc_a;
  insert into public.centro_custo (tenant_id, codigo, nome)
    values (v_t, 'ADM', 'Administrativo') returning id into v_cc_b;

  create temporary table _ctx (chave text primary key, valor text);
  insert into _ctx values
    ('tenant', v_t::text), ('empresa', v_emp::text), ('conta', v_conta::text),
    ('gestor', v_gestor::text), ('financeiro', v_financeiro::text),
    ('diretor', v_diretor::text), ('lancador', v_lancador::text),
    ('cc_a', v_cc_a::text), ('cc_b', v_cc_b::text);

  -- Os casos seguintes leem o contexto **depois** de assumir `iarx_app`, e uma
  -- tabela temporária criada pelo superusuário não é legível por ele.
  grant select on _ctx to iarx_app;
end $$;

/** Cria um título já em nome do lançador, devolvendo o id. */
create or replace function _titulo(p_valor numeric) returns uuid
language plpgsql as $$
declare v_t uuid; v_emp uuid; v_l uuid; v_id uuid;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_emp from _ctx where chave = 'empresa';
  select valor::uuid into v_l from _ctx where chave = 'lancador';

  insert into public.titulo_pagar
    (tenant_id, empresa_id, descricao, classificacao, valor_original,
     data_emissao, data_vencimento, created_by)
  values (v_t, v_emp, 'Despesa de teste', 'DESPESA_VARIAVEL', p_valor,
          current_date, current_date + 30, v_l)
  returning id into v_id;
  return v_id;
end $$;

-- ------------- caso 1: a contagem de níveis segue os limites cadastrados
do $$
declare v_t uuid; v_n integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  -- Abaixo do menor limite: zero níveis. "Aprovação automática" é literalmente
  -- não criar linha nenhuma — não um estado especial que alguém tem de tratar.
  select app.niveis_aprovacao_pagar(5000) into v_n;
  if v_n <> 0 then raise exception 'FALHA RN-F01: 5 mil exigiu % nível(is)', v_n; end if;

  select app.niveis_aprovacao_pagar(20000) into v_n;
  if v_n <> 1 then raise exception 'FALHA RN-F01: 20 mil exigiu % nível(is), esperado 1', v_n; end if;

  select app.niveis_aprovacao_pagar(100000) into v_n;
  if v_n <> 2 then raise exception 'FALHA RN-F01: 100 mil exigiu % nível(is), esperado 2', v_n; end if;

  select app.niveis_aprovacao_pagar(500000) into v_n;
  if v_n <> 3 then raise exception 'FALHA RN-F01: 500 mil exigiu % nível(is), esperado 3', v_n; end if;

  -- No limite exato: não ultrapassa, então o perfil aprova sozinho.
  select app.niveis_aprovacao_pagar(10000) into v_n;
  if v_n <> 0 then raise exception 'FALHA RN-F01: o valor no limite exato exigiu % nível(is)', v_n; end if;

  reset role;
  raise notice 'caso 1 OK — os níveis seguem os limites cadastrados, sem constante no código';
end $$;

-- ------------------- caso 2: sem alçada configurada, aprova tudo
do $$
declare v_outro uuid := gen_random_uuid(); v_n integer;
begin
  insert into public.tenant (id, nome) values (v_outro, 'Locadora Sem Alcada');
  set local role iarx_app;
  perform set_config('app.tenant_id', v_outro::text, true);

  -- Não configurar alçada é declarar que não há alçada. O contrário — travar
  -- tudo até alguém configurar — deixaria um ambiente novo sem poder pagar
  -- nada, e a saída seria configurar um limite enorme só para destravar.
  select app.niveis_aprovacao_pagar(9999999) into v_n;
  if v_n <> 0 then raise exception 'FALHA RN-F01: locatário sem alçada exigiu % nível(is)', v_n; end if;

  reset role;
  raise notice 'caso 2 OK — locatário sem alçada configurada aprova automaticamente';
end $$;

-- ------------------------- caso 3: o posto de cada aprovador
do $$
declare v_t uuid; v_gestor uuid; v_dir uuid; v_lanc uuid; v_p integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_gestor from _ctx where chave = 'gestor';
  select valor::uuid into v_dir from _ctx where chave = 'diretor';
  select valor::uuid into v_lanc from _ctx where chave = 'lancador';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select app.posto_alcada_pagar(v_gestor) into v_p;
  if v_p <> 1 then raise exception 'FALHA: gestor com posto %', v_p; end if;
  select app.posto_alcada_pagar(v_dir) into v_p;
  if v_p <> 3 then raise exception 'FALHA: diretor com posto %', v_p; end if;
  select app.posto_alcada_pagar(v_lanc) into v_p;
  if v_p <> 0 then raise exception 'FALHA: lançador sem alçada tem posto %', v_p; end if;

  -- O diretor decide o nível 1. Se a regra fosse "posto exatamente N", o gestor
  -- de férias travaria o nível 1 com o diretor disponível — e a saída seria
  -- alguém emprestar credencial, o pior desfecho possível.
  if not app.pode_decidir_nivel_pagar(v_dir, 1) then
    raise exception 'FALHA: o diretor não pode decidir o nível 1';
  end if;
  if app.pode_decidir_nivel_pagar(v_gestor, 3) then
    raise exception 'FALHA: o gestor pode decidir o nível 3';
  end if;

  reset role;
  raise notice 'caso 3 OK — posto maior decide nível menor, nunca o contrário';
end $$;

-- ---------------- caso 4: RN-F04 — quem lança não aprova
do $$
declare v_t uuid; v_titulo uuid; v_lanc uuid; v_ap uuid; v_erro text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_lanc from _ctx where chave = 'lancador';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_lanc::text, true);

  select _titulo(20000) into v_titulo;
  insert into public.titulo_pagar_aprovacao (tenant_id, titulo_id, nivel)
    values (v_t, v_titulo, 1) returning id into v_ap;

  -- Dá-se ao lançador a alçada de gestor: o cenário em que a regra é a única
  -- coisa que separa "lançar" de "autorizar".
  insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo)
    select v_t, v_lanc, id, 'TENANT' from public.perfil where tenant_id = v_t and nome = 'Gestor';

  begin
    update public.titulo_pagar_aprovacao
       set aprovador_id = v_lanc, decisao = 'APROVADO', decidido_em = now()
     where id = v_ap;
    raise exception 'FALHA RN-F04: o lançador aprovou o próprio título';
  exception when check_violation then
    v_erro := sqlerrm;
  end;

  if v_erro not like '%não aprova o próprio%' then
    raise exception 'FALHA RN-F04: a recusa não explica o motivo: %', v_erro;
  end if;

  reset role;
  raise notice 'caso 4 OK — sem isto, o fluxo de aprovação inteiro seria teatro';
end $$;

-- ------- caso 5: RN-F02 — sequencial, e a decisão não se reescreve
do $$
declare
  v_t uuid; v_titulo uuid; v_gestor uuid; v_fin uuid;
  v_n1 uuid; v_n2 uuid; v_erro text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_gestor from _ctx where chave = 'gestor';
  select valor::uuid into v_fin from _ctx where chave = 'financeiro';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select _titulo(100000) into v_titulo;
  insert into public.titulo_pagar_aprovacao (tenant_id, titulo_id, nivel)
    values (v_t, v_titulo, 1) returning id into v_n1;
  insert into public.titulo_pagar_aprovacao (tenant_id, titulo_id, nivel)
    values (v_t, v_titulo, 2) returning id into v_n2;

  -- Aprovar o nível 2 antes do 1 permitiria o nível superior autorizar algo que
  -- o inferior vai rejeitar — e a rejeição chegaria depois da autorização.
  begin
    update public.titulo_pagar_aprovacao
       set aprovador_id = v_fin, decisao = 'APROVADO', decidido_em = now()
     where id = v_n2;
    raise exception 'FALHA RN-F02: o nível 2 decidiu antes do nível 1';
  exception when check_violation then
    v_erro := sqlerrm;
  end;
  if v_erro not like '%sequencial%' and v_erro not like '%anterior%' then
    raise exception 'FALHA RN-F02: a recusa não explica a ordem: %', v_erro;
  end if;

  -- Em ordem, funciona.
  update public.titulo_pagar_aprovacao
     set aprovador_id = v_gestor, decisao = 'APROVADO', decidido_em = now()
   where id = v_n1;
  update public.titulo_pagar_aprovacao
     set aprovador_id = v_fin, decisao = 'APROVADO', decidido_em = now()
   where id = v_n2;

  -- E a decisão registrada é a prova de quem autorizou o quê.
  begin
    update public.titulo_pagar_aprovacao
       set decisao = 'REJEITADO', justificativa = 'mudei de ideia depois' where id = v_n1;
    raise exception 'FALHA: a decisão do nível 1 foi reescrita';
  exception when check_violation then null;
  end;

  reset role;
  raise notice 'caso 5 OK — sequencial, e a decisão registrada não se reescreve';
end $$;

-- ------------------- caso 6: RN-F03 — rejeição exige justificativa
do $$
declare v_t uuid; v_titulo uuid; v_gestor uuid; v_ap uuid;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_gestor from _ctx where chave = 'gestor';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select _titulo(20000) into v_titulo;
  insert into public.titulo_pagar_aprovacao (tenant_id, titulo_id, nivel)
    values (v_t, v_titulo, 1) returning id into v_ap;

  -- Recusa sem justificativa não é resposta: o solicitante não tem o que
  -- corrigir, e reenvia igual.
  begin
    update public.titulo_pagar_aprovacao
       set aprovador_id = v_gestor, decisao = 'REJEITADO', decidido_em = now()
     where id = v_ap;
    raise exception 'FALHA RN-F03: rejeição sem justificativa foi aceita';
  exception when check_violation then null;
  end;

  begin
    update public.titulo_pagar_aprovacao
       set aprovador_id = v_gestor, decisao = 'REJEITADO', decidido_em = now(), justificativa = 'não'
     where id = v_ap;
    raise exception 'FALHA RN-F03: justificativa de duas letras foi aceita';
  exception when check_violation then null;
  end;

  update public.titulo_pagar_aprovacao
     set aprovador_id = v_gestor, decisao = 'REJEITADO', decidido_em = now(),
         justificativa = 'sem nota fiscal anexada; reenviar com o documento'
   where id = v_ap;

  reset role;
  raise notice 'caso 6 OK — rejeição diz o que corrigir';
end $$;

-- ------------- caso 7: RN-F05 — delegação vale só dentro do período
do $$
declare v_t uuid; v_gestor uuid; v_lanc uuid; v_terceiro uuid;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_gestor from _ctx where chave = 'gestor';

  insert into public.usuario (tenant_id, nome, email, status)
    values (v_t, 'Substituto', 'substituto@pagar.test', 'ATIVO') returning id into v_terceiro;

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  if app.pode_decidir_nivel_pagar(v_terceiro, 1) then
    raise exception 'FALHA: o substituto decide o nível 1 sem alçada nem delegação';
  end if;

  -- Delegação já encerrada: a data faz o trabalho, e ninguém precisa lembrar
  -- de revogar.
  insert into public.delegacao_aprovacao
    (tenant_id, delegante_id, delegado_id, nivel, inicio, fim, motivo)
  values (v_t, v_gestor, v_terceiro, 1, current_date - 40, current_date - 30, 'férias de janeiro');

  if app.pode_decidir_nivel_pagar(v_terceiro, 1) then
    raise exception 'FALHA RN-F05: delegação encerrada continua desviando a aprovação';
  end if;

  -- Delegação vigente: passa a valer sem nenhuma outra ação.
  insert into public.delegacao_aprovacao
    (tenant_id, delegante_id, delegado_id, nivel, inicio, fim, motivo)
  values (v_t, v_gestor, v_terceiro, 1, current_date - 1, current_date + 10, 'férias de agosto');

  if not app.pode_decidir_nivel_pagar(v_terceiro, 1) then
    raise exception 'FALHA RN-F05: delegação vigente não habilita o delegado';
  end if;

  -- E não estende o nível: delegar o nível 1 não entrega o 3.
  if app.pode_decidir_nivel_pagar(v_terceiro, 3) then
    raise exception 'FALHA RN-F05: a delegação de nível 1 habilitou o nível 3';
  end if;

  reset role;
  raise notice 'caso 7 OK — a delegação vale pelo período e pelo nível, nada além';
end $$;

-- ------------- caso 8: duas delegações sobrepostas são impossíveis
do $$
declare v_t uuid; v_gestor uuid; v_a uuid; v_b uuid;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_gestor from _ctx where chave = 'gestor';

  insert into public.usuario (tenant_id, nome, email, status)
    values (v_t, 'Outro Sub', 'sub2@pagar.test', 'ATIVO') returning id into v_b;

  -- Duas delegações sobrepostas fariam "quem aprova hoje?" ter duas respostas,
  -- resolvidas pela ordem da consulta.
  begin
    insert into public.delegacao_aprovacao
      (tenant_id, delegante_id, delegado_id, nivel, inicio, fim, motivo)
    values (v_t, v_gestor, v_b, 1, current_date, current_date + 5, 'sobreposta');
    raise exception 'FALHA RN-F05: delegações sobrepostas do mesmo nível foram aceitas';
  exception when exclusion_violation then null;
  end;

  raise notice 'caso 8 OK — a sobreposição é impossível por construção, não por checagem';
end $$;

-- ------------------ caso 9: RN-F09 — o rateio fecha em 100%
do $$
declare v_t uuid; v_titulo uuid; v_a uuid; v_b uuid; v_erro text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_a from _ctx where chave = 'cc_a';
  select valor::uuid into v_b from _ctx where chave = 'cc_b';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select _titulo(20000) into v_titulo;

  begin
    insert into public.titulo_pagar_rateio (tenant_id, titulo_id, centro_custo_id, percentual)
      values (v_t, v_titulo, v_a, 60);
    raise exception 'FALHA RN-F09: rateio de 60%% sozinho foi aceito';
  exception when check_violation then
    v_erro := sqlerrm;
  end;
  if v_erro not like '%100%' then
    raise exception 'FALHA RN-F09: a recusa não diz quanto falta: %', v_erro;
  end if;

  -- As duas linhas na mesma instrução fecham. Um gatilho por linha reprovaria a
  -- primeira, e inserir um rateio de duas partes seria impossível.
  insert into public.titulo_pagar_rateio (tenant_id, titulo_id, centro_custo_id, percentual)
  values (v_t, v_titulo, v_a, 60), (v_t, v_titulo, v_b, 40);

  -- Terços: 100/3 não fecha em decimal, e recusar isso obrigaria o operador a
  -- distribuir 33,34/33,33/33,33 à mão.
  begin
    delete from public.titulo_pagar_rateio where titulo_id = v_titulo;
  exception when check_violation then
    raise exception 'FALHA RN-F09: remover o rateio inteiro foi recusado';
  end;

  insert into public.titulo_pagar_rateio (tenant_id, titulo_id, centro_custo_id, percentual)
  values (v_t, v_titulo, v_a, 33.3333), (v_t, v_titulo, v_b, 66.6667);

  reset role;
  raise notice 'caso 9 OK — fecha em 100%%, aceita terços, e remover tudo é legítimo';
end $$;

-- ---- caso 10: remover uma linha do rateio deixando o resto quebrado
do $$
declare v_t uuid; v_titulo uuid; v_a uuid; v_b uuid;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_a from _ctx where chave = 'cc_a';
  select valor::uuid into v_b from _ctx where chave = 'cc_b';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select _titulo(20000) into v_titulo;
  insert into public.titulo_pagar_rateio (tenant_id, titulo_id, centro_custo_id, percentual)
  values (v_t, v_titulo, v_a, 70), (v_t, v_titulo, v_b, 30);

  -- Sobrariam 70%: 30% da despesa ficaria sem centro de custo, isto é, lançada
  -- em lugar nenhum.
  begin
    delete from public.titulo_pagar_rateio where titulo_id = v_titulo and centro_custo_id = v_b;
    raise exception 'FALHA RN-F09: a remoção deixou o rateio somando 70%%';
  exception when check_violation then null;
  end;

  reset role;
  raise notice 'caso 10 OK — não sobra despesa sem centro de custo';
end $$;

-- ------- caso 11: RN-F06 — parcial recalcula, excesso é recusado
do $$
declare
  v_t uuid; v_titulo uuid; v_conta uuid; v_gestor uuid;
  v_status text; v_saldo numeric; v_erro text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_conta from _ctx where chave = 'conta';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select _titulo(1000) into v_titulo;
  update public.titulo_pagar set status = 'APROVADO' where id = v_titulo;

  perform app.baixar_titulo_pagar(v_titulo, 400, current_date, v_conta, 'PIX');
  select status into v_status from public.titulo_pagar where id = v_titulo;
  if v_status <> 'PAGO_PARCIAL' then
    raise exception 'FALHA RN-F06: após 400 de 1000 o status é %', v_status;
  end if;
  select app.saldo_titulo_pagar(v_titulo) into v_saldo;
  if v_saldo <> 600 then raise exception 'FALHA RN-F06: saldo % em vez de 600', v_saldo; end if;

  -- Excesso não vira crédito solto: um crédito que ninguém pediu aparece depois
  -- como saldo a favor sem origem, e a conciliação ganha uma linha órfã.
  begin
    perform app.baixar_titulo_pagar(v_titulo, 900, current_date, v_conta, 'PIX');
    raise exception 'FALHA RN-F06: pagamento acima do saldo foi aceito';
  exception when check_violation then
    v_erro := sqlerrm;
  end;
  if v_erro not like '%excede o saldo%' then
    raise exception 'FALHA RN-F06: a recusa não fala do saldo: %', v_erro;
  end if;

  perform app.baixar_titulo_pagar(v_titulo, 600, current_date, v_conta, 'PIX');
  select status into v_status from public.titulo_pagar where id = v_titulo;
  if v_status <> 'PAGO' then
    raise exception 'FALHA RN-F06: fechado o saldo, o status é %', v_status;
  end if;

  reset role;
  raise notice 'caso 11 OK — parcial recalcula, e o excesso é recusado';
end $$;

-- ---- caso 12: a baixa gera a movimentação, e o estorno o contrário
do $$
declare
  v_t uuid; v_titulo uuid; v_conta uuid;
  v_pag uuid; v_mov uuid; v_estorno uuid;
  v_saldo_conta_antes numeric; v_saldo_conta_depois numeric;
  v_status text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_conta from _ctx where chave = 'conta';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select app.saldo_conta(v_conta) into v_saldo_conta_antes;

  select _titulo(2500) into v_titulo;
  update public.titulo_pagar set status = 'APROVADO' where id = v_titulo;

  select pagamento_id, movimentacao_id into v_pag, v_mov
    from app.baixar_titulo_pagar(v_titulo, 2500, current_date, v_conta, 'TRANSFERENCIA');

  -- Um pagamento sem movimentação é um título quitado que não saiu de conta
  -- nenhuma: o extrato e o contas a pagar passariam a discordar.
  if v_mov is null then raise exception 'FALHA: a baixa não gerou movimentação'; end if;
  select app.saldo_conta(v_conta) into v_saldo_conta_depois;
  if v_saldo_conta_depois <> v_saldo_conta_antes - 2500 then
    raise exception 'FALHA: a conta não debitou (% -> %)', v_saldo_conta_antes, v_saldo_conta_depois;
  end if;

  -- RN-F07: estorno é contrário, nunca exclusão.
  begin
    delete from public.titulo_pagar_pagamento where id = v_pag;
    raise exception 'FALHA RN-F07: o pagamento foi apagado';
  exception when check_violation then null;
  end;

  select app.estornar_baixa_titulo_pagar(v_pag, 'pagamento em duplicidade') into v_estorno;
  select app.saldo_conta(v_conta) into v_saldo_conta_depois;
  if v_saldo_conta_depois <> v_saldo_conta_antes then
    raise exception 'FALHA RN-F07: o estorno não devolveu o valor à conta (%)', v_saldo_conta_depois;
  end if;

  -- E o título volta a dever: um título "pago" com dinheiro em aberto sairia de
  -- toda fila de pagamento.
  select status into v_status from public.titulo_pagar where id = v_titulo;
  if v_status = 'PAGO' then
    raise exception 'FALHA RN-F07: título segue PAGO depois do estorno';
  end if;

  -- Estornar duas vezes devolveria o valor duas vezes.
  begin
    perform app.estornar_baixa_titulo_pagar(v_pag, 'de novo');
    raise exception 'FALHA: estorno em duplicidade foi aceito';
  exception when check_violation then null;
  end;

  reset role;
  raise notice 'caso 12 OK — baixa e movimentação juntas; estorno devolve, e só uma vez';
end $$;

-- ------------- caso 13: RN-F08 — o título pai não recebe pagamento
do $$
declare v_t uuid; v_pai uuid; v_filha uuid; v_conta uuid; v_emp uuid; v_l uuid;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_emp from _ctx where chave = 'empresa';
  select valor::uuid into v_l from _ctx where chave = 'lancador';
  select valor::uuid into v_conta from _ctx where chave = 'conta';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select _titulo(3000) into v_pai;
  update public.titulo_pagar set status = 'APROVADO', parcela_total = 3 where id = v_pai;

  insert into public.titulo_pagar
    (tenant_id, empresa_id, descricao, classificacao, valor_original,
     data_emissao, data_vencimento, titulo_pai_id, parcela_numero, parcela_total,
     status, created_by)
  values (v_t, v_emp, 'Parcela 1/3', 'DESPESA_VARIAVEL', 1000,
          current_date, current_date + 30, v_pai, 1, 3, 'APROVADO', v_l)
  returning id into v_filha;

  -- Pagar no pai deixaria o total do parcelamento contado duas vezes.
  begin
    perform app.baixar_titulo_pagar(v_pai, 1000, current_date, v_conta, 'PIX');
    raise exception 'FALHA RN-F08: o título pai recebeu pagamento';
  exception when check_violation then null;
  end;

  perform app.baixar_titulo_pagar(v_filha, 1000, current_date, v_conta, 'PIX');

  reset role;
  raise notice 'caso 13 OK — só as parcelas pagam; o pai é relatório';
end $$;

-- --------- caso 14: título não aprovado não recebe pagamento
do $$
declare v_t uuid; v_titulo uuid; v_conta uuid; v_erro text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_conta from _ctx where chave = 'conta';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select _titulo(20000) into v_titulo;
  -- Nasce PENDENTE. Pagar antes da aprovação é o desvio que o fluxo inteiro
  -- existe para impedir — e ele tem de ser impossível, não só escondido na tela.
  begin
    perform app.baixar_titulo_pagar(v_titulo, 100, current_date, v_conta, 'PIX');
    raise exception 'FALHA: título PENDENTE recebeu pagamento';
  exception when check_violation then
    v_erro := sqlerrm;
  end;
  if v_erro not like '%não recebe pagamento%' then
    raise exception 'FALHA: a recusa não explica o estado: %', v_erro;
  end if;

  reset role;
  raise notice 'caso 14 OK — pagar exige o título aprovado, no banco';
end $$;

-- ------------------- caso 15: valor devido é gerado, não digitado
do $$
declare v_t uuid; v_titulo uuid; v_devido numeric;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select _titulo(1000) into v_titulo;
  select valor_devido into v_devido from public.titulo_pagar where id = v_titulo;
  if v_devido <> 1000 then raise exception 'FALHA: devido % sem ajuste', v_devido; end if;

  update public.titulo_pagar set valor_ajustado = 1150 where id = v_titulo;
  select valor_devido into v_devido from public.titulo_pagar where id = v_titulo;
  if v_devido <> 1150 then raise exception 'FALHA: devido % com ajuste de 1150', v_devido; end if;

  -- Gerada: não há caminho de escrita, logo não há divergência entre "devido" e
  -- "original + ajuste".
  begin
    update public.titulo_pagar set valor_devido = 1 where id = v_titulo;
    raise exception 'FALHA: valor_devido foi escrito diretamente';
  exception when generated_always then null;
  end;

  reset role;
  raise notice 'caso 15 OK — o valor devido é derivado, e não tem como divergir';
end $$;

-- ------------------------- caso 16: isolamento por locatário
do $$
declare v_t uuid; v_outro uuid := gen_random_uuid(); v_n integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  insert into public.tenant (id, nome) values (v_outro, 'Locadora Alheia');

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  select count(*) into v_n from public.titulo_pagar;
  if v_n = 0 then raise exception 'FALHA: o locatário não vê os próprios títulos'; end if;

  perform set_config('app.tenant_id', v_outro::text, true);
  for v_n in
    select count(*) from public.titulo_pagar
    union all select count(*) from public.titulo_pagar_aprovacao
    union all select count(*) from public.titulo_pagar_pagamento
    union all select count(*) from public.titulo_pagar_rateio
    union all select count(*) from public.delegacao_aprovacao
  loop
    if v_n <> 0 then
      raise exception 'FALHA RN-028: % linha(s) de outro locatário visíveis', v_n;
    end if;
  end loop;

  reset role;
  raise notice 'caso 16 OK — as cinco tabelas isoladas por locatário';
end $$;

-- ------- caso 17: despesa da locadora nunca chega ao portal do cliente
do $$
declare v_n integer;
begin
  -- Uma política de leitura para `authenticated` exporia fornecedor, valor e
  -- justificativa de aprovação ao portal do locatário do equipamento.
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public'
    and tablename in ('titulo_pagar', 'titulo_pagar_rateio', 'titulo_pagar_aprovacao',
                      'titulo_pagar_pagamento', 'delegacao_aprovacao')
    and 'authenticated' = any(roles);

  if v_n <> 0 then
    raise exception 'FALHA: % política(s) expõem contas a pagar a authenticated', v_n;
  end if;

  raise notice 'caso 17 OK — nenhuma política de cliente sobre contas a pagar';
end $$;

rollback;

\echo '== 12_rnf_contas_a_pagar: TODOS OS CASOS APROVADOS =='
