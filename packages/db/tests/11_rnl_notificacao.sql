-- =============================================================================
-- TESTE RN-L48 … RN-L51 — Notificação
--
-- RN-L48  envio não se repete
-- RN-L49  notificação sem destino não entra na fila
-- RN-L50  reserva é exclusiva e expira
-- RN-L51  desistir é definitivo, e diz por quê
--
-- O que está em jogo: uma fila de avisos erra de dois jeitos, e os dois são
-- caros. Enviar duas vezes faz o aprovador ver dois pedidos de pagamento onde
-- há um. Não enviar nunca — porque a linha ficou presa em ENVIANDO com o worker
-- morto — faz o pagamento parar sem que ninguém saiba por quê, e sem nenhum
-- erro registrado em lugar nenhum.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_t uuid := gen_random_uuid();
  v_u uuid;
begin
  insert into public.tenant (id, nome) values (v_t, 'Locadora Avisos');
  insert into public.usuario (tenant_id, nome, email, status)
    values (v_t, 'Aprovador', 'aprovador@exemplo.test', 'ATIVO') returning id into v_u;

  create temporary table _ctx (chave text primary key, valor text);
  insert into _ctx values ('tenant', v_t::text), ('usuario', v_u::text);
end $$;

-- --------------- caso 1: e-mail sem endereço e caixa interna sem usuário
do $$
declare v_t uuid;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  -- Uma notificação sem destino é trabalho que a fila carrega para sempre sem
  -- poder concluir: nem envia, nem falha por um motivo verdadeiro.
  begin
    insert into public.notificacao (tenant_id, canal, assunto, corpo_texto)
      values (v_t, 'EMAIL', 'Sem destino', 'corpo');
    raise exception 'FALHA RN-L49: e-mail sem endereço entrou na fila';
  exception when check_violation then null;
  end;

  begin
    insert into public.notificacao (tenant_id, canal, destino, assunto, corpo_texto)
      values (v_t, 'EMAIL', 'nao-e-endereco', 'Destino inválido', 'corpo');
    raise exception 'FALHA RN-L49: endereço sem arroba entrou na fila';
  exception when check_violation then null;
  end;

  begin
    insert into public.notificacao (tenant_id, canal, assunto, corpo_texto)
      values (v_t, 'IN_APP', 'Sem usuário', 'corpo');
    raise exception 'FALHA RN-L49: caixa interna sem usuário entrou na fila';
  exception when check_violation then null;
  end;

  raise notice 'caso 1 OK — notificação sem destino não entra na fila';
end $$;

-- ------------------- caso 2: enfileirar resolve o e-mail do usuário
do $$
declare v_t uuid; v_u uuid; v_id uuid; v_destino text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_u from _ctx where chave = 'usuario';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select app.enfileirar_notificacao('EMAIL', v_u, null, 'Aprovação pendente', 'Há um título esperando você.')
    into v_id;

  select destino into v_destino from public.notificacao where id = v_id;
  -- O endereço é resolvido no instante do fato, não no envio: se a pessoa
  -- trocar de e-mail no meio, o aviso vai para onde foi endereçado.
  if v_destino <> 'aprovador@exemplo.test' then
    raise exception 'FALHA: destino resolvido como % em vez do e-mail do usuário', v_destino;
  end if;

  reset role;
  raise notice 'caso 2 OK — o endereço é gravado no enfileiramento, não relido no envio';
end $$;

-- --------------------------- caso 3: a reserva é exclusiva
do $$
declare v_t uuid; v_u uuid; v_n integer; v_status text; v_tentativas integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_u from _ctx where chave = 'usuario';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform app.enfileirar_notificacao('EMAIL', v_u, null, 'Segunda', 'corpo');
  perform app.enfileirar_notificacao('EMAIL', v_u, null, 'Terceira', 'corpo');

  select count(*) into v_n from app.notificacao_reservar_lote(10, 'worker-A');
  if v_n < 3 then
    raise exception 'FALHA RN-L50: o lote trouxe % em vez das 3 pendentes', v_n;
  end if;

  -- Reservadas ficam em ENVIANDO e com a tentativa contada. Um segundo worker
  -- não pega nada, porque não há mais nada pendente.
  select count(*) into v_n from public.notificacao where status = 'ENVIANDO';
  if v_n < 3 then
    raise exception 'FALHA RN-L50: % em ENVIANDO após a reserva', v_n;
  end if;

  select count(*) into v_n from app.notificacao_reservar_lote(10, 'worker-B');
  if v_n <> 0 then
    raise exception 'FALHA RN-L50: worker-B levou % notificação(ões) já reservadas', v_n;
  end if;

  select tentativas into v_tentativas from public.notificacao limit 1;
  if v_tentativas <> 1 then
    raise exception 'FALHA: a tentativa não foi contada na reserva (%)', v_tentativas;
  end if;

  reset role;
  raise notice 'caso 3 OK — a reserva é exclusiva, e conta a tentativa';
end $$;

-- ----------------- caso 4: reserva abandonada volta para a fila
do $$
declare v_t uuid; v_id uuid; v_n integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select id into v_id from public.notificacao limit 1;

  -- Um worker que morre entre reservar e enviar deixaria a linha em ENVIANDO
  -- para sempre: a fila pararia de andar sem nenhum erro registrado.
  update public.notificacao set reservado_em = now() - interval '30 minutes' where id = v_id;

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  select count(*) into v_n from app.notificacao_reservar_lote(10, 'worker-C');
  if v_n <> 1 then
    raise exception 'FALHA RN-L50: a reserva abandonada não voltou à fila (% recuperada(s))', v_n;
  end if;

  reset role;
  raise notice 'caso 4 OK — reserva de worker morto expira e volta para a fila';
end $$;

-- ------------------------ caso 5: concluir é terminal
do $$
declare v_t uuid; v_id uuid; v_status text; v_enviada timestamptz;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select id into v_id from public.notificacao where status = 'ENVIANDO' limit 1;

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform app.notificacao_concluir(v_id);
  reset role;

  select status, enviada_em into v_status, v_enviada from public.notificacao where id = v_id;
  if v_status <> 'ENVIADA' or v_enviada is null then
    raise exception 'FALHA: concluir deixou status % e enviada_em %', v_status, v_enviada;
  end if;

  -- Duas cópias de um aviso de aprovação de pagamento parecem dois pagamentos.
  begin
    update public.notificacao set status = 'PENDENTE' where id = v_id;
    raise exception 'FALHA RN-L48: notificação enviada voltou para PENDENTE';
  exception when check_violation then null;
  end;

  raise notice 'caso 5 OK — enviada é terminal, e não volta para a fila';
end $$;

-- -------------- caso 6: falhar recua, e desiste com o motivo à vista
do $$
declare
  v_t uuid; v_u uuid; v_id uuid;
  v_status text; v_proxima timestamptz; v_erro text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_u from _ctx where chave = 'usuario';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  select app.enfileirar_notificacao('EMAIL', v_u, null, 'Vai falhar', 'corpo') into v_id;
  perform app.notificacao_reservar_lote(10, 'worker-D');

  perform app.notificacao_falhar(v_id, 'conexão recusada pelo servidor SMTP');
  reset role;

  select status, proxima_tentativa_em, ultimo_erro
    into v_status, v_proxima, v_erro
  from public.notificacao where id = v_id;

  if v_status <> 'PENDENTE' then
    raise exception 'FALHA: primeira falha deveria voltar a PENDENTE, deu %', v_status;
  end if;
  -- O recuo é o que evita a fila competir consigo mesma: sem ele, o endereço
  -- errado seria tentado em laço contra as notificações novas.
  if v_proxima <= now() then
    raise exception 'FALHA: não houve recuo — próxima tentativa em %', v_proxima;
  end if;
  if v_erro is null then
    raise exception 'FALHA RN-L51: falha sem motivo registrado';
  end if;

  raise notice 'caso 6 OK — a falha recua, e o motivo fica registrado';
end $$;

-- --------- caso 7: depois do limite, desiste em vez de girar para sempre
do $$
declare v_t uuid; v_id uuid; v_status text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select id into v_id from public.notificacao where assunto = 'Vai falhar';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  -- Um endereço errado não vira endereço certo por insistência.
  update public.notificacao set tentativas = 5 where id = v_id;
  perform app.notificacao_falhar(v_id, 'endereço inexistente');
  reset role;

  select status into v_status from public.notificacao where id = v_id;
  if v_status <> 'FALHOU' then
    raise exception 'FALHA RN-L51: após o limite o status ficou % em vez de FALHOU', v_status;
  end if;

  -- E FALHOU sem erro é beco sem saída para quem decide se reenvia.
  begin
    update public.notificacao set ultimo_erro = null where id = v_id;
    raise exception 'FALHA RN-L51: FALHOU aceitou ficar sem motivo';
  exception when check_violation then null;
  end;

  raise notice 'caso 7 OK — desiste com motivo, em vez de girar para sempre';
end $$;

-- ---------------- caso 8: enviada exige data, e data exige enviada
do $$
declare v_t uuid; v_u uuid; v_id uuid;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_u from _ctx where chave = 'usuario';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  select app.enfileirar_notificacao('IN_APP', v_u, null, 'Caixa interna', 'corpo') into v_id;
  reset role;

  -- Sem esta restrição, "enviada" e "quando" poderiam discordar — e o relatório
  -- de entrega passaria a depender de qual das duas colunas foi consultada.
  begin
    update public.notificacao set status = 'ENVIADA' where id = v_id;
    raise exception 'FALHA: ENVIADA sem data foi aceito';
  exception when check_violation then null;
  end;

  raise notice 'caso 8 OK — status de envio e data de envio não discordam';
end $$;

-- ------------------------- caso 9: isolamento por locatário
do $$
declare v_t uuid; v_outro uuid := gen_random_uuid(); v_n integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  insert into public.tenant (id, nome) values (v_outro, 'Outra Locadora Avisos');

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  select count(*) into v_n from public.notificacao;
  if v_n = 0 then
    raise exception 'FALHA: o locatário não enxerga as próprias notificações';
  end if;

  perform set_config('app.tenant_id', v_outro::text, true);
  select count(*) into v_n from public.notificacao;
  if v_n <> 0 then
    raise exception 'FALHA RN-028: % notificação(ões) de outro locatário visíveis', v_n;
  end if;

  reset role;
  raise notice 'caso 9 OK — a fila é isolada por locatário como todo o resto';
end $$;

-- ------- caso 10: a superfície do worker não está aberta a quem não é a API
do $$
declare v_n integer;
begin
  -- O worker atravessa locatários, e por isso as funções dele são `security
  -- definer`. Se `public` puder executá-las, o eixo de isolamento inteiro
  -- passa a depender de ninguém ter descoberto os nomes.
  select count(*) into v_n
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and p.proname in ('notificacao_reservar_lote', 'notificacao_concluir', 'notificacao_falhar')
    and p.prosecdef
    and has_function_privilege('public', p.oid, 'execute');

  if v_n <> 0 then
    raise exception 'FALHA: % função(ões) da superfície do worker executáveis por public', v_n;
  end if;

  -- E as três têm de existir e ser `security definer`.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and p.proname in ('notificacao_reservar_lote', 'notificacao_concluir', 'notificacao_falhar')
    and p.prosecdef;
  if v_n <> 3 then
    raise exception 'FALHA: % de 3 funções do worker são security definer', v_n;
  end if;

  raise notice 'caso 10 OK — superfície do worker fechada e enumerável';
end $$;

rollback;

\echo '== 11_rnl_notificacao: TODOS OS CASOS APROVADOS =='
