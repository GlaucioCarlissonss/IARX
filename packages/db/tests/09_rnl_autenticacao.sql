-- =============================================================================
-- TESTE RN-L37 … RN-L40 — Autenticação própria
--
-- RN-L37  a senha é sempre Argon2id
-- RN-L38  sessão revogada não ressuscita
-- RN-L39  o último administrador ativo não se desativa
-- RN-L40  política de senha é do locatário, não constante de código
--
-- O que está em jogo: a decisão D-07 foi revertida para implementação própria,
-- e implementação própria de autenticação é onde erro custa caro. Cada caso
-- abaixo cobre um erro que passaria despercebido por qualquer código de
-- aplicação — hash de outro algoritmo gravado por script, sessão reativada por
-- engano, tenant que fica sem administrador.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_t uuid := gen_random_uuid();
  v_admin uuid; v_outro uuid; v_perfil_admin uuid; v_perfil_leitura uuid;
begin
  insert into public.tenant (id, nome) values (v_t, 'Locadora Auth');

  insert into public.perfil (tenant_id, nome, tipo, is_sistema, permissoes)
    values (v_t, 'Administrador', 'INTERNO', true, array['usuario:gerenciar', 'perfil:gerenciar'])
    returning id into v_perfil_admin;
  insert into public.perfil (tenant_id, nome, tipo, is_sistema, permissoes)
    values (v_t, 'Consulta', 'INTERNO', true, array['contrato:ler'])
    returning id into v_perfil_leitura;

  insert into public.usuario (tenant_id, nome, email, status)
    values (v_t, 'Admin Um', 'admin1@exemplo.test', 'ATIVO') returning id into v_admin;
  insert into public.usuario (tenant_id, nome, email, status)
    values (v_t, 'Consulta', 'consulta@exemplo.test', 'ATIVO') returning id into v_outro;

  insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo)
    values (v_t, v_admin, v_perfil_admin, 'TENANT');
  insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo)
    values (v_t, v_outro, v_perfil_leitura, 'TENANT');

  create temporary table _ctx (chave text primary key, valor text);
  insert into _ctx values
    ('tenant', v_t::text), ('admin', v_admin::text), ('outro', v_outro::text),
    ('perfil_admin', v_perfil_admin::text);
end $$;

-- ---------------------------- caso 1: senha fora do formato Argon2id é recusada
do $$
declare v_u uuid; v_erro text;
begin
  select valor::uuid into v_u from _ctx where chave = 'outro';

  -- É o erro que realmente acontece: um script de carga grava SHA-256, ou pior,
  -- o texto em claro. Os dois passam por qualquer `update usuario set
  -- senha_hash = $1` na aplicação; nenhum passa por aqui.
  begin
    update public.usuario set senha_hash = 'senha123' where id = v_u;
    raise exception 'FALHA RN-L37: senha em claro foi aceita';
  exception when check_violation then
    get stacked diagnostics v_erro = message_text;
  end;

  begin
    update public.usuario
       set senha_hash = '$2b$12$abcdefghijklmnopqrstuv'   -- bcrypt
     where id = v_u;
    raise exception 'FALHA RN-L37: hash bcrypt foi aceito';
  exception when check_violation then
    null;
  end;

  raise notice 'caso 1 OK — só Argon2id entra na coluna de senha';
end $$;

-- ---------------------------- caso 2: Argon2id bem formado entra
do $$
declare v_u uuid;
begin
  select valor::uuid into v_u from _ctx where chave = 'outro';

  update public.usuario
     set senha_hash = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$aGFzaHZhbHVlaGVyZQ',
         senha_alterada_em = now()
   where id = v_u;

  if (select senha_hash from public.usuario where id = v_u) is null then
    raise exception 'FALHA: hash válido não foi gravado';
  end if;

  raise notice 'caso 2 OK — formato PHC do Argon2id é aceito';
end $$;

-- ---------------------------- caso 3: política de senha recusa valor perigoso
do $$
declare v_t uuid;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  -- Oito caracteres cai em ataque de dicionário com hardware comum. Permitir
  -- configurar isso dá ao operador a impressão de ter escolhido segurança.
  begin
    update public.tenant
       set politica_senha = jsonb_set(politica_senha, '{tamanho_minimo}', '8')
     where id = v_t;
    raise exception 'FALHA RN-L40: tamanho mínimo 8 foi aceito';
  exception when check_violation then null;
  end;

  -- Duas tentativas bloqueiam por erro de digitação — vira negação de serviço
  -- do usuário contra si mesmo.
  begin
    update public.tenant
       set politica_senha = jsonb_set(politica_senha, '{tentativas_ate_bloquear}', '2')
     where id = v_t;
    raise exception 'FALHA RN-L40: limite de 2 tentativas foi aceito';
  exception when check_violation then null;
  end;

  -- Expiração de 7 dias faz o usuário reciclar variações da mesma senha.
  begin
    update public.tenant
       set politica_senha = jsonb_set(politica_senha, '{expira_em_dias}', '7')
     where id = v_t;
    raise exception 'FALHA RN-L40: expiração de 7 dias foi aceita';
  exception when check_violation then null;
  end;

  raise notice 'caso 3 OK — a política tem piso, e o piso é justificado';
end $$;

-- ---------------------------- caso 4: política válida é aceita e é do tenant
do $$
declare v_t uuid; v_dias integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  update public.tenant
     set politica_senha = jsonb_build_object(
       'tamanho_minimo', 14,
       'expira_em_dias', 90,
       'tentativas_ate_bloquear', 3,
       'bloqueio_minutos', 30,
       'exige_troca_no_primeiro_acesso', true
     )
   where id = v_t;

  select (politica_senha ->> 'expira_em_dias')::integer into v_dias
    from public.tenant where id = v_t;

  if v_dias <> 90 then
    raise exception 'FALHA RN-L40: a política do locatário não foi gravada';
  end if;

  -- O default do outro tenant não muda: a política é dele, não global.
  if exists (
    select 1 from public.tenant
     where id <> v_t and (politica_senha ->> 'expira_em_dias') is not null
  ) then
    raise exception 'FALHA RN-L40: a política vazou para outro locatário';
  end if;

  raise notice 'caso 4 OK — política por locatário, sem vazar para os demais';
end $$;

-- ---------------------------- caso 5: bloqueio por tentativa, pela função
do $$
declare v_t uuid; v_u uuid; v_bloq timestamptz; v_falhas integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_u from _ctx where chave = 'outro';

  -- A política deste tenant, do caso 4, bloqueia em 3 tentativas.
  perform app.registrar_tentativa_login(v_t, v_u, 'consulta@exemplo.test', false, 'senha incorreta');
  perform app.registrar_tentativa_login(v_t, v_u, 'consulta@exemplo.test', false, 'senha incorreta');

  select bloqueado_ate, tentativas_falhas into v_bloq, v_falhas
    from public.usuario where id = v_u;
  if v_bloq is not null then
    raise exception 'FALHA: bloqueou na segunda tentativa, com limite 3';
  end if;

  perform app.registrar_tentativa_login(v_t, v_u, 'consulta@exemplo.test', false, 'senha incorreta');

  select bloqueado_ate, tentativas_falhas into v_bloq, v_falhas
    from public.usuario where id = v_u;
  if v_bloq is null then
    raise exception 'FALHA: não bloqueou na terceira tentativa (falhas=%)', v_falhas;
  end if;

  -- O bloqueio também vira evento próprio: "quem tentou entrar às 3h" precisa
  -- ser respondível sem inferir de contadores.
  if not exists (
    select 1 from public.log_acesso
     where usuario_id = v_u and evento = 'BLOQUEIO'
  ) then
    raise exception 'FALHA: bloqueio não gerou evento em log_acesso';
  end if;

  raise notice 'caso 5 OK — bloqueio no limite do tenant, com evento próprio';
end $$;

-- ---------------------------- caso 6: sucesso zera contador e desbloqueia
do $$
declare v_t uuid; v_u uuid; v_bloq timestamptz; v_falhas integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_u from _ctx where chave = 'outro';

  perform app.registrar_tentativa_login(v_t, v_u, 'consulta@exemplo.test', true);

  select bloqueado_ate, tentativas_falhas into v_bloq, v_falhas
    from public.usuario where id = v_u;

  if v_bloq is not null or v_falhas <> 0 then
    raise exception 'FALHA: login bem-sucedido não limpou bloqueio (bloq=%, falhas=%)', v_bloq, v_falhas;
  end if;

  raise notice 'caso 6 OK — entrar com sucesso limpa o bloqueio';
end $$;

-- ---------------------------- caso 7: tentativa de e-mail inexistente vira log
do $$
declare v_t uuid; v_n integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  -- Sem usuário, ainda registra: é o sinal de varredura de e-mails.
  perform app.registrar_tentativa_login(v_t, null, 'naoexiste@exemplo.test', false, 'usuário inexistente');

  select count(*) into v_n from public.log_acesso
   where tenant_id = v_t and identificador = 'naoexiste@exemplo.test';

  if v_n = 0 then
    raise exception 'FALHA: tentativa com e-mail inexistente não foi registrada';
  end if;

  raise notice 'caso 7 OK — varredura de e-mail deixa rastro';
end $$;

-- ---------------------------- caso 8: sessão revogada não ressuscita
do $$
declare v_t uuid; v_u uuid; v_s uuid;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_u from _ctx where chave = 'admin';

  insert into public.sessao (tenant_id, usuario_id, expira_em)
    values (v_t, v_u, now() + interval '8 hours') returning id into v_s;

  -- Revogação sem motivo não passa: revogação que ninguém explica depois é
  -- revogação que ninguém consegue auditar.
  begin
    update public.sessao set revogada_em = now() where id = v_s;
    raise exception 'FALHA: revogação sem motivo foi aceita';
  exception when check_violation then null;
  end;

  update public.sessao
     set revogada_em = now(), revogacao_motivo = 'logout'
   where id = v_s;

  begin
    update public.sessao set revogada_em = null, revogacao_motivo = null where id = v_s;
    raise exception 'FALHA RN-L38: sessão revogada foi reativada';
  exception when check_violation then null;
  end;

  raise notice 'caso 8 OK — revogar é definitivo, e exige motivo';
end $$;

-- ---------------------------- caso 9: o último admin não se desativa
do $$
declare v_t uuid; v_admin uuid; v_outro uuid; v_pa uuid; v_erro text;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_admin from _ctx where chave = 'admin';
  select valor::uuid into v_outro from _ctx where chave = 'outro';
  select valor::uuid into v_pa    from _ctx where chave = 'perfil_admin';

  -- Só há um admin. Desativá-lo deixaria o locatário sem ninguém capaz de
  -- conceder acesso a ninguém — bloqueio que só o suporte desfaz mexendo em
  -- produção.
  begin
    update public.usuario set status = 'INATIVO' where id = v_admin;
    raise exception 'FALHA RN-L39: o último administrador foi desativado';
  exception when check_violation then
    get stacked diagnostics v_erro = message_text;
  end;

  if v_erro not like '%último administrador%' then
    raise exception 'FALHA RN-L39: a recusa não explica o motivo (%)', v_erro;
  end if;

  -- A mesma proteção pela outra porta: revogar o perfil em vez de desativar o
  -- usuário produz exatamente o mesmo tenant órfão.
  begin
    delete from public.usuario_perfil where usuario_id = v_admin and perfil_id = v_pa;
    raise exception 'FALHA RN-L39: o perfil do último administrador foi revogado';
  exception when check_violation then null;
  end;

  -- Com um segundo admin, a desativação do primeiro passa.
  insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo)
    values (v_t, v_outro, v_pa, 'TENANT');

  update public.usuario set status = 'INATIVO' where id = v_admin;

  if (select status from public.usuario where id = v_admin) <> 'INATIVO' then
    raise exception 'FALHA: com dois admins, a desativação deveria passar';
  end if;

  raise notice 'caso 9 OK — o locatário nunca fica sem administrador';
end $$;

-- ---------------------------- caso 10: sessão é isolada por locatário
do $$
declare v_t uuid; v_outro_t uuid := gen_random_uuid(); v_u uuid; v_n integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_u from _ctx where chave = 'outro';

  insert into public.sessao (tenant_id, usuario_id, expira_em)
    values (v_t, v_u, now() + interval '8 hours');

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  select count(*) into v_n from public.sessao;
  if v_n = 0 then
    raise exception 'FALHA: o locatário não enxerga a própria sessão';
  end if;

  perform set_config('app.tenant_id', v_outro_t::text, true);
  select count(*) into v_n from public.sessao;
  if v_n <> 0 then
    raise exception 'FALHA RN-028: % sessão(ões) de outro locatário visíveis', v_n;
  end if;

  reset role;
  raise notice 'caso 10 OK — sessão isolada por locatário, como todo o resto';
end $$;

rollback;

\echo '== 09_rnl_autenticacao: TODOS OS CASOS APROVADOS =='
