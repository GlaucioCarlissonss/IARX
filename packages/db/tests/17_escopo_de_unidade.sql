-- =============================================================================
-- TESTE — Escopo de unidade no eixo de cliente
--
-- RN-L26  gestor de unidade vê só as unidades vinculadas
-- RN-L34  e não alcança o consolidado do grupo, nem por URL montada à mão
--
-- O que está em jogo: **a tabela existia e não tinha leitor**.
--
-- `usuario_local_cliente` foi criada na 0011 — indexada, auditada, isolada por
-- locatário — e nenhuma política de RLS a consultava. Um gestor vinculado a uma
-- unidade enxergava as duas do grupo: foi medido antes de a 0024 existir, e
-- eram duas. É o defeito que não tem sintoma até alguém olhar, porque cada peça
-- isolada funciona e ninguém montou o conjunto.
--
-- O caso mais importante deste arquivo **não** é o do gestor: é o do usuário
-- interno. Uma política restritiva a mais que recortasse a operação da locadora
-- seria muito pior do que o defeito que ela corrige.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_t uuid := gen_random_uuid();
  v_emp uuid; v_fil uuid;
  v_grupo uuid; v_cli_a uuid; v_cli_b uuid;
  v_l10 uuid; v_l20 uuid; v_lb uuid;
  v_perfil_gestor uuid; v_perfil_admin uuid;
  v_gestor uuid; v_admin uuid; v_interno uuid;
  v_cat uuid; v_fab uuid; v_mod uuid;
  v_eq_10 uuid; v_eq_20 uuid;
  v_ctr uuid;
begin
  insert into public.tenant (id, nome) values (v_t, 'Locadora Unidade');
  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_t, 'UNIDADE LTDA', '11222333000181') returning id into v_emp;
  insert into public.filial (tenant_id, empresa_id, codigo, nome)
    values (v_t, v_emp, 'SP-01', 'Base SP') returning id into v_fil;

  -- Dois clientes, um deles em grupo econômico. O do grupo tem duas unidades.
  insert into public.grupo_economico (tenant_id, nome) values (v_t, 'Grupo Alfa')
    returning id into v_grupo;
  insert into public.cliente (tenant_id, documento, razao_social, grupo_economico_id)
    values (v_t, '11444777000161', 'CLIENTE A LTDA', v_grupo) returning id into v_cli_a;
  insert into public.cliente (tenant_id, documento, razao_social)
    values (v_t, '22555888000172', 'CLIENTE B LTDA') returning id into v_cli_b;

  insert into public.local_operacao (tenant_id, cliente_id, codigo, nome)
    values (v_t, v_cli_a, 'AND-10', 'Andar 10') returning id into v_l10;
  insert into public.local_operacao (tenant_id, cliente_id, codigo, nome)
    values (v_t, v_cli_a, 'AND-20', 'Andar 20') returning id into v_l20;
  insert into public.local_operacao (tenant_id, cliente_id, codigo, nome)
    values (v_t, v_cli_b, 'MATRIZ', 'Matriz do B') returning id into v_lb;

  -- Parque: um ativo em cada unidade do cliente A, alocados por contrato.
  insert into public.categoria_equipamento (tenant_id, codigo, nome)
    values (v_t, 'MULTI', 'Multifuncional') returning id into v_cat;
  insert into public.fabricante (tenant_id, nome) values (v_t, 'Kyocera') returning id into v_fab;
  insert into public.modelo (tenant_id, fabricante_id, categoria_id, codigo, nome)
    values (v_t, v_fab, v_cat, 'M-2040', 'Ecosys M2040') returning id into v_mod;

  insert into public.equipamento (tenant_id, patrimonio, modelo_id, categoria_id, filial_id, cliente_id)
    values (v_t, 'PAT-10', v_mod, v_cat, v_fil, v_cli_a) returning id into v_eq_10;
  insert into public.equipamento (tenant_id, patrimonio, modelo_id, categoria_id, filial_id, cliente_id)
    values (v_t, 'PAT-20', v_mod, v_cat, v_fil, v_cli_a) returning id into v_eq_20;

  insert into public.contrato (tenant_id, numero, empresa_id, filial_id, cliente_id, status,
                               data_inicio, data_fim)
    values (v_t, 'CT-001', v_emp, v_fil, v_cli_a, 'ATIVO', current_date - 30, current_date + 300)
    returning id into v_ctr;
  /*
   * `status = 'ATIVO'` não é decoração: o gatilho da 0011 que mantém
   * `equipamento.cliente_id` coerente só considera alocação **ocupante**
   * (RESERVADO, EM_ENTREGA, ATIVO, SUSPENSO, EM_DEVOLUCAO). Sem isso o item
   * entra como planejado, o ativo fica sem cliente, e a política de cliente —
   * corretamente — o esconde de todo mundo. A primeira versão deste teste
   * esqueceu o campo e acusou a 0024 por um defeito da própria massa.
   */
  insert into public.contrato_item
    (tenant_id, contrato_id, equipamento_id, categoria_id, local_operacao_id,
     modalidade_cobranca, valor_unitario, vigencia_inicio, status)
  values
    (v_t, v_ctr, v_eq_10, v_cat, v_l10, 'FIXO_MENSAL', 300, now() - interval '30 days', 'ATIVO'),
    (v_t, v_ctr, v_eq_20, v_cat, v_l20, 'FIXO_MENSAL', 300, now() - interval '30 days', 'ATIVO');

  select id into v_perfil_gestor from public.perfil
   where tenant_id = v_t and tipo = 'CLIENTE' and nome like 'Gestor%' limit 1;
  select id into v_perfil_admin from public.perfil
   where tenant_id = v_t and tipo = 'CLIENTE' and nome like 'Administrador%' limit 1;
  if v_perfil_gestor is null or v_perfil_admin is null then
    raise exception 'FALHA: a 0011 não provisionou os perfis de cliente deste locatário';
  end if;

  -- Gestor de unidade: escopo LOCAL_CLIENTE, vinculado ao Andar 10.
  insert into public.usuario (tenant_id, nome, email, status, tipo, cliente_id)
    values (v_t, 'Gestor do 10', 'gestor@a.test', 'ATIVO', 'CLIENTE', v_cli_a)
    returning id into v_gestor;
  insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo, escopo_id)
    values (v_t, v_gestor, v_perfil_gestor, 'LOCAL_CLIENTE', v_l10);
  insert into public.usuario_local_cliente (tenant_id, usuario_id, local_operacao_id)
    values (v_t, v_gestor, v_l10);

  -- Administrador do cliente: escopo CLIENTE, **sem vínculo nenhum**.
  insert into public.usuario (tenant_id, nome, email, status, tipo, cliente_id)
    values (v_t, 'Admin do A', 'admin@a.test', 'ATIVO', 'CLIENTE', v_cli_a)
    returning id into v_admin;
  insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo)
    values (v_t, v_admin, v_perfil_admin, 'CLIENTE');

  insert into public.usuario (tenant_id, nome, email, status)
    values (v_t, 'Operador da Locadora', 'oper@locadora.test', 'ATIVO')
    returning id into v_interno;

  perform set_config('app.p_t', v_t::text, true);
  perform set_config('app.p_gestor', v_gestor::text, true);
  perform set_config('app.p_admin', v_admin::text, true);
  perform set_config('app.p_interno', v_interno::text, true);
  perform set_config('app.p_cli_a', v_cli_a::text, true);
  perform set_config('app.p_l10', v_l10::text, true);
  perform set_config('app.p_l20', v_l20::text, true);
  perform set_config('app.p_lb', v_lb::text, true);
end $$;

set local role iarx_app;

-- ---------- caso 1: o gestor vê a unidade dele, e só ela
do $$
declare v_n integer; v_codigo text;
begin
  perform set_config('app.tenant_id',  current_setting('app.p_t'), true);
  perform set_config('app.usuario_id', current_setting('app.p_gestor'), true);
  perform set_config('app.cliente_id', current_setting('app.p_cli_a'), true);

  select count(*) into v_n from public.local_operacao;
  if v_n <> 1 then
    raise exception 'FALHA: o gestor de uma unidade enxerga % locais — RN-L26 não recorta', v_n;
  end if;
  select codigo into v_codigo from public.local_operacao;
  if v_codigo <> 'AND-10' then
    raise exception 'FALHA: o gestor enxerga % em vez da própria unidade', v_codigo;
  end if;
  raise notice 'caso 1 OK — gestor de unidade vê apenas a unidade vinculada';
end $$;

-- ---------- caso 2: e o consolidado do grupo não chega por id montado à mão
--
-- RN-L34. O `where id = ...` é exatamente a URL montada à mão que o critério de
-- aceite descreve: a política tem de responder vazio, não recusar com erro —
-- recusar diferenciaria "existe e não é seu" de "não existe".
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.local_operacao where id = current_setting('app.p_l20')::uuid;
  if v_n <> 0 then
    raise exception 'FALHA: a unidade irmã chegou por id direto — RN-L34';
  end if;

  select count(*) into v_n from public.contrato_item;
  if v_n <> 1 then
    raise exception 'FALHA: o gestor enxerga % itens de contrato, e só um está na unidade dele', v_n;
  end if;

  select count(*) into v_n from public.equipamento;
  if v_n <> 1 then
    raise exception 'FALHA: o gestor enxerga % equipamentos — o parque do grupo vazou', v_n;
  end if;
  raise notice 'caso 2 OK — nem por id direto, e o recorte alcança parque e itens';
end $$;

-- ---------- caso 3: o Administrador do cliente continua vendo o grupo
--
-- Ele **não tem vínculo nenhum**, e é justamente por isso que este caso existe:
-- se o recorte dependesse da existência de vínculos em vez do escopo, este
-- usuário deixaria de ver tudo — e o portal nasceria quebrado para o perfil que
-- mais o usa.
do $$
declare v_n integer;
begin
  perform set_config('app.usuario_id', current_setting('app.p_admin'), true);

  select count(*) into v_n from public.local_operacao;
  if v_n <> 2 then
    raise exception 'FALHA: o administrador do cliente enxerga % locais em vez dos 2 do grupo', v_n;
  end if;
  select count(*) into v_n from public.equipamento;
  if v_n <> 2 then
    raise exception 'FALHA: o administrador do cliente enxerga % equipamentos em vez de 2', v_n;
  end if;
  raise notice 'caso 3 OK — sem escopo de unidade, o grupo inteiro continua visível';
end $$;

-- ---------- caso 4: o usuário interno da locadora não é afetado
--
-- **O caso mais importante do arquivo.** Uma política restritiva a mais que
-- recortasse a operação da locadora seria muito pior do que o defeito que a 0024
-- corrige — e é o tipo de dano que passa, porque quem testa o portal não olha a
-- tela do operador.
do $$
declare v_n integer;
begin
  perform set_config('app.usuario_id', current_setting('app.p_interno'), true);
  perform set_config('app.cliente_id', '', true);

  select count(*) into v_n from public.local_operacao;
  if v_n <> 3 then
    raise exception 'FALHA: o operador da locadora enxerga % locais em vez de 3', v_n;
  end if;
  select count(*) into v_n from public.equipamento;
  if v_n <> 2 then
    raise exception 'FALHA: o operador da locadora enxerga % equipamentos em vez de 2', v_n;
  end if;
  select count(*) into v_n from public.contrato_item;
  if v_n <> 2 then
    raise exception 'FALHA: o operador da locadora enxerga % itens em vez de 2', v_n;
  end if;
  raise notice 'caso 4 OK — o eixo de unidade não alcança quem opera a locadora';
end $$;

-- ---------- caso 5: escopo de unidade sem vínculo não vê nada
--
-- É o "negado por omissão" de RN-L26, e é o caso que separa esta implementação
-- de uma que trate conjunto vazio como "todos" — o erro que transformaria o
-- recorte em ruído.
do $$
declare v_n integer;
begin
  reset role;
  delete from public.usuario_local_cliente
   where usuario_id = current_setting('app.p_gestor')::uuid;
  set local role iarx_app;

  perform set_config('app.usuario_id', current_setting('app.p_gestor'), true);
  perform set_config('app.cliente_id', current_setting('app.p_cli_a'), true);

  select count(*) into v_n from public.local_operacao;
  if v_n <> 0 then
    raise exception 'FALHA: escopo de unidade sem vínculo enxergou % locais', v_n;
  end if;
  raise notice 'caso 5 OK — sem vínculo, nada: negado por omissão';
end $$;

-- ---------- caso 6: a composição é E, não OU
--
-- Vínculo cadastrado por erro para um local de **outro** cliente. As duas
-- políticas precisam valer juntas: a de cliente barra, e o vínculo indevido não
-- a dissolve. Como política permissiva, este vínculo abriria acesso ao cliente B
-- — é o erro clássico de RLS, e o motivo de as duas serem `restrictive`.
do $$
declare v_n integer;
begin
  reset role;
  insert into public.usuario_local_cliente (tenant_id, usuario_id, local_operacao_id)
    values (current_setting('app.p_t')::uuid, current_setting('app.p_gestor')::uuid,
            current_setting('app.p_lb')::uuid);
  set local role iarx_app;

  perform set_config('app.usuario_id', current_setting('app.p_gestor'), true);
  perform set_config('app.cliente_id', current_setting('app.p_cli_a'), true);

  select count(*) into v_n from public.local_operacao;
  if v_n <> 0 then
    raise exception 'FALHA: um vínculo indevido abriu % locais de outro cliente', v_n;
  end if;
  raise notice 'caso 6 OK — cliente E unidade: o vínculo indevido não dissolve a política de cliente';
end $$;

reset role;
rollback;

\echo '== 17_escopo_de_unidade: TODOS OS CASOS APROVADOS =='
