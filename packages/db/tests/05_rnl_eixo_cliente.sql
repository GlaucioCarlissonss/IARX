-- =============================================================================
-- TESTE RN-L11 … RN-L13 — Eixo de cliente
--
-- RN-L11  usuário de cliente exige cliente, e usuário interno o proíbe
-- RN-L12  o locatário vê o próprio CNPJ e o do grupo, e nada além
-- RN-L13  perfil de cliente não aceita permissão de escrita
--
-- O que está em jogo aqui é diferente do resto da suíte. Vazamento entre
-- tenants expõe uma locadora a outra; vazamento no eixo de cliente expõe um
-- locatário a **outro locatário do mesmo fornecedor** — que no outsourcing de
-- impressão frequentemente é concorrente direto.
--
-- Por isso o teste roda como `iarx_app`, sujeito a RLS. Rodar como superusuário
-- faria as políticas serem ignoradas e todos os casos passariam sem provar nada.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------- massa
do $$
declare
  v_t uuid := gen_random_uuid();
  v_emp uuid; v_fil uuid; v_fab uuid; v_cat uuid; v_mod uuid;
  v_grupo uuid; v_ca uuid; v_cb uuid; v_cc uuid;
  v_la uuid; v_lb uuid;
  v_ctr_a uuid; v_ctr_c uuid;
  v_eq_a uuid; v_eq_c uuid; v_eq_patio uuid;
  v_usr_a uuid; v_usr_interno uuid;
begin
  insert into public.tenant (id, nome) values (v_t, 'Locadora Eixo');
  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_t, 'Locadora Eixo LTDA', '11222333000181') returning id into v_emp;
  insert into public.filial (tenant_id, empresa_id, codigo, nome)
    values (v_t, v_emp, 'SP-01', 'Base SP') returning id into v_fil;
  insert into public.fabricante (tenant_id, nome) values (v_t, 'Kyocera') returning id into v_fab;
  insert into public.categoria_equipamento (tenant_id, codigo, nome, tipo_medidor_padrao)
    values (v_t, 'MFP', 'Multifuncional', 'CONTADOR') returning id into v_cat;
  insert into public.modelo (tenant_id, fabricante_id, categoria_id, codigo, nome)
    values (v_t, v_fab, v_cat, 'TA3554', 'TASKalfa 3554ci') returning id into v_mod;

  -- Grupo com dois CNPJs de raízes diferentes: é o caso que a raiz sozinha não
  -- resolve, e que justifica o grupo ser declarado em vez de derivado.
  insert into public.grupo_economico (tenant_id, nome) values (v_t, 'Grupo Alfa')
    returning id into v_grupo;

  insert into public.cliente (tenant_id, documento, razao_social, grupo_economico_id)
    values (v_t, '11444777000161', 'ALFA MATRIZ LTDA', v_grupo) returning id into v_ca;
  insert into public.cliente (tenant_id, documento, razao_social, grupo_economico_id)
    values (v_t, '11444777000242', 'ALFA FILIAL LTDA', v_grupo) returning id into v_cb;
  -- Concorrente: mesmo tenant, grupo nenhum. É de quem o locatário não pode ver nada.
  insert into public.cliente (tenant_id, documento, razao_social)
    values (v_t, '99888777000166', 'BETA CONCORRENTE LTDA') returning id into v_cc;

  insert into public.local_operacao (tenant_id, cliente_id, nome)
    values (v_t, v_ca, 'Sede Alfa') returning id into v_la;
  insert into public.local_operacao (tenant_id, cliente_id, nome)
    values (v_t, v_cc, 'Sede Beta') returning id into v_lb;

  insert into public.contrato (tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim)
    values (v_t, 'SP-A-001', v_emp, v_fil, v_ca, 'ATIVO', '2026-01-01', '2026-12-31')
    returning id into v_ctr_a;
  insert into public.contrato (tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim)
    values (v_t, 'SP-C-001', v_emp, v_fil, v_cc, 'ATIVO', '2026-01-01', '2026-12-31')
    returning id into v_ctr_c;

  insert into public.equipamento (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_t, 'EQ-A1', 'SN-A1', v_mod, v_cat, v_fil) returning id into v_eq_a;
  insert into public.equipamento (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_t, 'EQ-C1', 'SN-C1', v_mod, v_cat, v_fil) returning id into v_eq_c;
  insert into public.equipamento (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_t, 'EQ-PATIO', 'SN-P1', v_mod, v_cat, v_fil) returning id into v_eq_patio;

  insert into public.contrato_item
    (tenant_id, contrato_id, equipamento_id, modalidade_cobranca, valor_unitario, vigencia_inicio, vigencia_fim, status)
  values
    (v_t, v_ctr_a, v_eq_a, 'FIXO_MENSAL', 500, now() - interval '30 days', now() + interval '300 days', 'ATIVO'),
    (v_t, v_ctr_c, v_eq_c, 'FIXO_MENSAL', 500, now() - interval '30 days', now() + interval '300 days', 'ATIVO');

  insert into public.usuario (tenant_id, nome, email, tipo, cliente_id)
    values (v_t, 'Admin Alfa', 'admin@alfa.local', 'CLIENTE', v_ca) returning id into v_usr_a;
  insert into public.usuario (tenant_id, nome, email)
    values (v_t, 'Operador Locadora', 'op@locadora.local') returning id into v_usr_interno;

  create temporary table _ctx (chave text primary key, valor text);
  insert into _ctx values
    ('tenant', v_t::text), ('grupo', v_grupo::text),
    ('cliente_a', v_ca::text), ('cliente_b', v_cb::text), ('cliente_c', v_cc::text),
    ('eq_a', v_eq_a::text), ('eq_c', v_eq_c::text), ('eq_patio', v_eq_patio::text),
    ('usuario_a', v_usr_a::text), ('usuario_interno', v_usr_interno::text);
end $$;

-- --------------------------------------------- caso 1: RN-L11, os dois lados
do $$
declare v_t uuid; v_ca uuid; v_erro1 text := null; v_erro2 text := null;
begin
  select valor::uuid into v_t  from _ctx where chave = 'tenant';
  select valor::uuid into v_ca from _ctx where chave = 'cliente_a';

  begin
    insert into public.usuario (tenant_id, nome, email, tipo)
      values (v_t, 'Sem cliente', 'x1@t.local', 'CLIENTE');
  exception when others then v_erro1 := sqlerrm;
  end;
  if v_erro1 is null then
    raise exception 'FALHA RN-L11: usuário tipo CLIENTE aceito sem cliente_id';
  end if;

  -- O caso inverso é o mais perigoso: usuário interno com cliente_id teria
  -- acesso de dentro E seria filtrado como se fosse de fora, produzindo uma
  -- tela vazia que ninguém consegue explicar.
  begin
    insert into public.usuario (tenant_id, nome, email, tipo, cliente_id)
      values (v_t, 'Interno com cliente', 'x2@t.local', 'INTERNO', v_ca);
  exception when others then v_erro2 := sqlerrm;
  end;
  if v_erro2 is null then
    raise exception 'FALHA RN-L11: usuário INTERNO aceito com cliente_id preenchido';
  end if;

  raise notice 'caso 1 OK — os dois lados da equivalência tipo/cliente_id são impostos';
end $$;

-- ------------------------------------------------- caso 2: raiz do CNPJ gerada
do $$
declare v_raiz text; v_ca uuid;
begin
  select valor::uuid into v_ca from _ctx where chave = 'cliente_a';
  select cnpj_raiz into v_raiz from public.cliente where id = v_ca;

  if v_raiz <> '11444777' then
    raise exception 'FALHA: cnpj_raiz deveria ser 11444777 (valor=%)', v_raiz;
  end if;

  -- Duas raízes iguais no mesmo grupo, e uma terceira diferente fora dele:
  -- é a demonstração de que raiz e grupo são eixos independentes.
  if (select count(*) from public.cliente where cnpj_raiz = '11444777') <> 2 then
    raise exception 'FALHA: as duas empresas do grupo deveriam compartilhar a raiz';
  end if;

  raise notice 'caso 2 OK — raiz do CNPJ é derivada, e não confundida com grupo';
end $$;

-- ------------------------------- caso 3: RN-L12, o locatário vê o próprio grupo
do $$
declare
  v_t uuid; v_ca uuid; v_cb uuid; v_cc uuid; v_n integer;
begin
  select valor::uuid into v_t  from _ctx where chave = 'tenant';
  select valor::uuid into v_ca from _ctx where chave = 'cliente_a';
  select valor::uuid into v_cb from _ctx where chave = 'cliente_b';
  select valor::uuid into v_cc from _ctx where chave = 'cliente_c';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.cliente_id', v_ca::text, true);

  select count(*) into v_n from public.cliente;
  if v_n <> 2 then
    raise exception 'FALHA RN-L12: o locatário deveria ver 2 clientes do grupo, viu %', v_n;
  end if;

  if exists (select 1 from public.cliente where id = v_cc) then
    raise exception 'FALHA RN-L12: o concorrente BETA está visível para ALFA';
  end if;
  if not exists (select 1 from public.cliente where id = v_cb) then
    raise exception 'FALHA RN-L12: a outra empresa do grupo não está visível';
  end if;

  reset role;
  raise notice 'caso 3 OK — vê o próprio CNPJ e o do grupo; o concorrente não existe';
end $$;

-- ------------------------- caso 4: o eixo alcança contrato, local e parque
do $$
declare
  v_t uuid; v_ca uuid; v_eq_c uuid; v_n integer;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_ca   from _ctx where chave = 'cliente_a';
  select valor::uuid into v_eq_c from _ctx where chave = 'eq_c';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.cliente_id', v_ca::text, true);

  select count(*) into v_n from public.contrato;
  if v_n <> 1 then
    raise exception 'FALHA RN-L12: deveria ver só o próprio contrato, viu %', v_n;
  end if;

  select count(*) into v_n from public.local_operacao;
  if v_n <> 1 then
    raise exception 'FALHA RN-L12: deveria ver só o próprio local, viu %', v_n;
  end if;

  -- O ativo do concorrente é o teste que mais importa: é ele que carrega
  -- contador de páginas, ou seja, volume de negócio.
  if exists (select 1 from public.equipamento where id = v_eq_c) then
    raise exception 'FALHA RN-L12: o ativo locado ao concorrente está visível';
  end if;

  reset role;
  raise notice 'caso 4 OK — contrato, local e parque do concorrente invisíveis';
end $$;

-- ----------------- caso 5: ativo no pátio não pertence a locatário nenhum
do $$
declare v_t uuid; v_ca uuid; v_eq_patio uuid; v_eq_a uuid;
begin
  select valor::uuid into v_t        from _ctx where chave = 'tenant';
  select valor::uuid into v_ca       from _ctx where chave = 'cliente_a';
  select valor::uuid into v_eq_patio from _ctx where chave = 'eq_patio';
  select valor::uuid into v_eq_a     from _ctx where chave = 'eq_a';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.cliente_id', v_ca::text, true);

  -- Ativo disponível no pátio é da locadora, e o portal do cliente não tem
  -- por que enxergar o estoque do fornecedor.
  if exists (select 1 from public.equipamento where id = v_eq_patio) then
    raise exception 'FALHA RN-L12: ativo no pátio visível para o locatário';
  end if;
  if not exists (select 1 from public.equipamento where id = v_eq_a) then
    raise exception 'FALHA RN-L12: o próprio ativo locado não está visível';
  end if;

  reset role;
  raise notice 'caso 5 OK — pátio invisível, ativo próprio visível';
end $$;

-- ------------------- caso 6: sem contexto de cliente, a locadora vê tudo
do $$
declare v_t uuid; v_n integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.cliente_id', '', true);

  -- O curto-circuito de `cliente_visivel` quando não há contexto é o que
  -- permite acrescentar a política a toda tabela sem quebrar a operação
  -- interna. Se ele falhar, a locadora perde acesso ao próprio negócio.
  select count(*) into v_n from public.cliente;
  if v_n <> 3 then
    raise exception 'FALHA RN-L12: usuário interno deveria ver os 3 clientes, viu %', v_n;
  end if;

  select count(*) into v_n from public.equipamento;
  if v_n <> 3 then
    raise exception 'FALHA RN-L12: usuário interno deveria ver os 3 ativos, viu %', v_n;
  end if;

  reset role;
  raise notice 'caso 6 OK — sem contexto de cliente, o eixo não restringe nada';
end $$;

-- ------------------- caso 7: a política do locatário é restritiva, não aditiva
do $$
declare v_t uuid; v_ca uuid; v_outro uuid := gen_random_uuid(); v_n integer;
begin
  select valor::uuid into v_t  from _ctx where chave = 'tenant';
  select valor::uuid into v_ca from _ctx where chave = 'cliente_a';

  set local role iarx_app;
  -- Tenant errado + cliente certo. Se a política de cliente fosse permissiva,
  -- o PostgreSQL combinaria as duas com OU e este contexto veria dados — o
  -- eixo novo teria **aberto** acesso em vez de fechar.
  perform set_config('app.tenant_id', v_outro::text, true);
  perform set_config('app.cliente_id', v_ca::text, true);

  select count(*) into v_n from public.cliente;
  if v_n <> 0 then
    raise exception 'FALHA RN-L12: % cliente(s) visíveis com tenant divergente — política aditiva', v_n;
  end if;

  reset role;
  raise notice 'caso 7 OK — os dois eixos se somam com E, não com OU';
end $$;

-- ---------------------------- caso 8: RN-L13, perfil de cliente é só leitura
do $$
declare v_t uuid; v_erro text := null;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  begin
    insert into public.perfil (tenant_id, nome, tipo, permissoes)
      values (v_t, 'Cliente indevido', 'CLIENTE', array['equipamento:ler','contrato:criar']);
  exception when others then v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA RN-L13: perfil de cliente aceitou permissão de escrita';
  end if;
  if v_erro not like '%contrato:criar%' then
    raise exception 'FALHA RN-L13: recusado sem nomear a permissão proibida: %', v_erro;
  end if;

  -- Abrir chamado é a exceção deliberada (D-10) — e continua exigindo triagem.
  insert into public.perfil (tenant_id, nome, tipo, permissoes)
    values (v_t, 'Cliente correto', 'CLIENTE', array['equipamento:ler','os:criar']);

  raise notice 'caso 8 OK — escrita recusada nomeando a permissão; abrir chamado permitido';
end $$;

-- ------------------ caso 9: os perfis-base do locatário foram provisionados
do $$
declare v_t uuid; v_n integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  select count(*) into v_n from public.perfil
   where tenant_id = v_t and tipo = 'CLIENTE' and is_sistema;
  if v_n <> 3 then
    raise exception 'FALHA: esperados 3 perfis-base de cliente, encontrados %', v_n;
  end if;

  raise notice 'caso 9 OK — administrador, gestor de unidade e visualizador provisionados';
end $$;

-- ---------------- caso 10: equipamento.cliente_id acompanha a alocação
do $$
declare
  v_t uuid; v_ca uuid; v_eq_a uuid; v_atual uuid;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_ca    from _ctx where chave = 'cliente_a';
  select valor::uuid into v_eq_a  from _ctx where chave = 'eq_a';

  select cliente_id into v_atual from public.equipamento where id = v_eq_a;
  if v_atual is distinct from v_ca then
    raise exception 'FALHA: o gatilho não desnormalizou o locatário (valor=%)', v_atual;
  end if;

  -- Encerrar a alocação devolve o ativo ao pátio. Desnormalização que alguém
  -- precisa lembrar de atualizar é dívida; aqui o gatilho é quem lembra.
  update public.contrato_item set status = 'ENCERRADO' where equipamento_id = v_eq_a;

  select cliente_id into v_atual from public.equipamento where id = v_eq_a;
  if v_atual is not null then
    raise exception 'FALHA: ativo encerrado continua apontando para o locatário (valor=%)', v_atual;
  end if;

  raise notice 'caso 10 OK — o vínculo do parque segue a alocação sem intervenção';
end $$;

rollback;

\echo '== 05_rnl_eixo_cliente: TODOS OS CASOS APROVADOS =='
