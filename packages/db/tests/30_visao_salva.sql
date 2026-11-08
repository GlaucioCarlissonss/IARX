-- =============================================================================
-- TESTE VIS — visões salvas de lista (0038)
--
-- O que estes casos protegem:
--
--  · **a visão pessoal é invisível para os outros, inclusive para quem
--    administra**. É a propriedade que separa "a interface não mostra" de "o
--    dado não vem": uma tela que só esconde deixa a rota aberta;
--  · **publicar exige `visao:compartilhar`**, e a recusa acontece na escrita.
--    Se a conferência vivesse só na política de leitura, o `UPDATE` passaria,
--    a linha ficaria publicada, e o erro apareceria — como ausência — para
--    quem tentasse ler, nunca para quem o cometeu;
--  · **alterar a visão da equipe de outra pessoa pede a mesma permissão** que
--    publicar. Sem isso, quem só cria visão pessoal poderia reapontar o
--    recorte que a operação inteira usa de manhã;
--  · **o nome é único onde ele é compartilhado**, e livre onde é pessoal. Dois
--    chips iguais na faixa são indistinguíveis; já impedir que duas pessoas
--    chamem a sua de "Minha ronda" tomaria do segundo um nome que ele nem sabe
--    que existe.
-- =============================================================================
\set ON_ERROR_STOP on

select gen_random_uuid() as t1, gen_random_uuid() as emp, gen_random_uuid() as fil,
       gen_random_uuid() as sup, gen_random_uuid() as tec, gen_random_uuid() as adm,
       gen_random_uuid() as p_sup, gen_random_uuid() as p_tec, gen_random_uuid() as p_adm
\gset

insert into public.tenant (id, nome) values (:'t1', 'Locadora VIS');
insert into public.empresa (id, tenant_id, razao_social) values (:'emp', :'t1', 'VIS LTDA');
insert into public.filial (id, tenant_id, empresa_id, codigo, nome)
  values (:'fil', :'t1', :'emp', 'VIS-01', 'Base VIS');

insert into public.usuario (id, tenant_id, email, nome) values
  (:'sup', :'t1', 'supervisor.vis@exemplo.local', 'Supervisora VIS'),
  (:'tec', :'t1', 'tecnico.vis@exemplo.local',    'Técnico VIS'),
  (:'adm', :'t1', 'admin.vis@exemplo.local',      'Administradora VIS');

/*
 * Três perfis, e o do administrador **não** tem `visao:compartilhar`.
 *
 * De propósito: o caso que interessa é o da permissão, não o do cargo. Dar a
 * permissão ao administrador por tabela faria o teste passar por ele ser
 * administrador, e a regra deixaria de ser verificada.
 */
insert into public.perfil (id, tenant_id, nome, permissoes) values
  (:'p_sup', :'t1', 'Supervisão VIS',    array['equipamento:ler','visao:compartilhar']),
  (:'p_tec', :'t1', 'Técnico VIS',       array['equipamento:ler']),
  (:'p_adm', :'t1', 'Administração VIS', array['equipamento:ler','usuario:gerenciar']);

insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo) values
  (:'t1', :'sup', :'p_sup', 'TENANT'),
  (:'t1', :'tec', :'p_tec', 'TENANT'),
  (:'t1', :'adm', :'p_adm', 'TENANT');

set role iarx_app;

-- ---------------------------------------------------------------- caso 1: o técnico salva a sua, sem permissão nenhuma
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'tec';

  do $$
  declare v_n integer;
  begin
    insert into public.visao_salva (tenant_id, tela, nome, consulta, dono_id)
    values (app.tenant_atual(), 'parque', 'Minha ronda',
            '{"estado":"EM_MANUTENCAO"}'::jsonb, app.usuario_atual());

    select count(*) into v_n from public.visao_salva where nome = 'Minha ronda';
    if v_n <> 1 then
      raise exception 'FALHA: o técnico não conseguiu salvar a própria visão';
    end if;
    raise notice 'caso 1 OK — visão pessoal não exige permissão nenhuma';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 2: ninguém mais a enxerga, nem quem administra
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'adm';

  do $$
  declare v_n integer;
  begin
    select count(*) into v_n from public.visao_salva where nome = 'Minha ronda';
    if v_n <> 0 then
      raise exception 'FALHA: a visão pessoal do técnico apareceu para quem administra (% linha[s])', v_n;
    end if;
    raise notice 'caso 2 OK — visão pessoal é invisível para os outros, pela política e não pela tela';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 3: publicar sem a permissão é recusado
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'tec';

  do $$
  declare v_constraint text;
  begin
    begin
      insert into public.visao_salva (tenant_id, tela, nome, consulta, dono_id, compartilhada)
      values (app.tenant_atual(), 'parque', 'Preventiva vencida',
              '{"preventiva":"VENCIDA"}'::jsonb, app.usuario_atual(), true);
      raise exception 'FALHA: o técnico publicou uma visão sem visao:compartilhar';
    exception when sqlstate '23514' then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'visao_compartilhar_sem_permissao' then
        raise exception 'FALHA: recusou por "%", esperado visao_compartilhar_sem_permissao', v_constraint;
      end if;
    end;
    raise notice 'caso 3 OK — publicar exige visao:compartilhar, e a recusa é na escrita';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 4: promover a pessoal a compartilhada também é publicar
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'tec';

  do $$
  declare v_constraint text;
  begin
    begin
      update public.visao_salva set compartilhada = true where nome = 'Minha ronda';
      raise exception 'FALHA: promoveu a visão pessoal a compartilhada sem a permissão';
    exception when sqlstate '23514' then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'visao_compartilhar_sem_permissao' then
        raise exception 'FALHA: recusou por "%", esperado visao_compartilhar_sem_permissao', v_constraint;
      end if;
    end;
    raise notice 'caso 4 OK — promover é publicar, e passa pela mesma tranca';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 5: quem tem a permissão publica, e todos passam a ver
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'sup';

  do $$
  begin
    insert into public.visao_salva (tenant_id, tela, nome, consulta, dono_id, compartilhada)
    values (app.tenant_atual(), 'parque', 'Preventiva vencida',
            '{"preventiva":"VENCIDA"}'::jsonb, app.usuario_atual(), true);
    raise notice 'caso 5a OK — com a permissão, publica';
  end $$;
commit;

begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'tec';

  do $$
  declare v_n integer;
  begin
    select count(*) into v_n
      from public.visao_salva
     where nome = 'Preventiva vencida' and compartilhada;
    if v_n <> 1 then
      raise exception 'FALHA: o técnico não enxerga a visão da equipe (% linha[s])', v_n;
    end if;
    raise notice 'caso 5b OK — a visão da equipe aparece para quem abre a tela, sem permissão nenhuma';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 6: alterar a da equipe alheia pede a mesma permissão
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'tec';

  do $$
  declare v_constraint text;
  begin
    begin
      update public.visao_salva
         set consulta = '{"estado":"DISPONIVEL"}'::jsonb
       where nome = 'Preventiva vencida';
      raise exception 'FALHA: o técnico reapontou o recorte que a operação inteira usa';
    exception when sqlstate '23514' then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'visao_alheia_sem_permissao' then
        raise exception 'FALHA: recusou por "%", esperado visao_alheia_sem_permissao', v_constraint;
      end if;
    end;
    raise notice 'caso 6 OK — mexer na visão da equipe de outra pessoa tem o alcance de publicar';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 7: o nome da equipe é único na tela
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'sup';

  do $$
  declare v_sqlstate text;
  begin
    begin
      -- Caixa diferente, mesmo chip aos olhos de quem clica.
      insert into public.visao_salva (tenant_id, tela, nome, consulta, dono_id, compartilhada)
      values (app.tenant_atual(), 'parque', '  preventiva VENCIDA ',
              '{}'::jsonb, app.usuario_atual(), true);
      raise exception 'FALHA: aceitou duas visões da equipe com o mesmo nome na mesma tela';
    exception when unique_violation then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      raise notice 'caso 7 OK — nome único entre as compartilhadas da tela (%)', v_sqlstate;
    end;
  end $$;
commit;

-- ---------------------------------------------------------------- caso 8: o mesmo nome em telas diferentes convive
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'sup';

  do $$
  declare v_n integer;
  begin
    insert into public.visao_salva (tenant_id, tela, nome, consulta, dono_id, compartilhada)
    values (app.tenant_atual(), 'chamados', 'Preventiva vencida',
            '{"tipo":"PREVENTIVA"}'::jsonb, app.usuario_atual(), true);

    select count(*) into v_n from public.visao_salva where nome = 'Preventiva vencida';
    if v_n <> 2 then
      raise exception 'FALHA: o nome deveria conviver entre telas (% linha[s])', v_n;
    end if;
    raise notice 'caso 8 OK — a unicidade é por tela, não por locatário';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 9: duas pessoas podem ter uma "Minha ronda" cada
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'sup';

  do $$
  declare v_n integer;
  begin
    insert into public.visao_salva (tenant_id, tela, nome, consulta, dono_id)
    values (app.tenant_atual(), 'parque', 'Minha ronda',
            '{"filial":"VIS-01"}'::jsonb, app.usuario_atual());

    -- Ela só enxerga a sua: a do técnico continua invisível.
    select count(*) into v_n from public.visao_salva where nome = 'Minha ronda';
    if v_n <> 1 then
      raise exception 'FALHA: esperava enxergar só a própria "Minha ronda" (% linha[s])', v_n;
    end if;
    raise notice 'caso 9 OK — nome pessoal é de quem o deu, e cada um vê o seu';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 10: a consulta precisa ser um objeto
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'tec';

  do $$
  declare v_constraint text;
  begin
    begin
      insert into public.visao_salva (tenant_id, tela, nome, consulta, dono_id)
      values (app.tenant_atual(), 'parque', 'Lista solta',
              '["estado"]'::jsonb, app.usuario_atual());
      raise exception 'FALHA: aceitou um array como consulta';
    exception when sqlstate '23514' then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'visao_salva_consulta_e_objeto' then
        raise exception 'FALHA: recusou por "%", esperado visao_salva_consulta_e_objeto', v_constraint;
      end if;
    end;
    raise notice 'caso 10 OK — a consulta é um objeto de parâmetros, não uma lista';
  end $$;
commit;

reset role;
\echo '== 30_visao_salva: TODOS OS CASOS APROVADOS =='
