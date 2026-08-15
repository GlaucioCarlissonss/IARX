-- =============================================================================
-- TESTE RN-L35 … RN-L36 — Proveniência da coordenada geográfica
--
-- RN-L35  coordenada tem origem declarada
-- RN-L36  latitude e longitude não se trocam
--
-- O que está em jogo: o mapa decide de onde o técnico sai. Uma coordenada sem
-- origem é uma coordenada que ninguém sabe se pode corrigir, e uma coordenada
-- com os eixos trocados some do mapa sem erro nenhum — o cliente simplesmente
-- deixa de existir para quem planeja rota.
--
-- Depende de PostGIS (ver o sufixo no nome do arquivo).
-- =============================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_t uuid := gen_random_uuid();
  v_cli uuid; v_loc uuid;
begin
  insert into public.tenant (id, nome) values (v_t, 'Locadora Geo');
  insert into public.cliente (tenant_id, documento, razao_social)
    values (v_t, '11444777000161', 'CLIENTE GEO LTDA') returning id into v_cli;
  insert into public.local_operacao (tenant_id, cliente_id, nome)
    values (v_t, v_cli, 'Matriz') returning id into v_loc;

  create temporary table _ctx (chave text primary key, valor text);
  insert into _ctx values ('tenant', v_t::text), ('cliente', v_cli::text), ('local', v_loc::text);
end $$;

-- ---------------------------- caso 1: coordenada sem proveniência é recusada
do $$
declare v_loc uuid; v_erro text;
begin
  select valor::uuid into v_loc from _ctx where chave = 'local';

  begin
    update public.local_operacao
       set geo = st_setsrid(st_point(-46.6565, -23.5613), 4326)::geography
     where id = v_loc;
    raise exception 'FALHA RN-L35: coordenada sem geo_precisao foi aceita';
  exception when check_violation then
    get stacked diagnostics v_erro = message_text;
  end;

  if v_erro not like '%proveniência%' then
    raise exception 'FALHA RN-L35: a recusa não explica o que falta (%)', v_erro;
  end if;

  raise notice 'caso 1 OK — coordenada sem origem não entra';
end $$;

-- ---------------------------- caso 2: com proveniência, entra e é carimbada
do $$
declare v_loc uuid; v_linha public.local_operacao;
begin
  select valor::uuid into v_loc from _ctx where chave = 'local';

  update public.local_operacao
     set geo = st_setsrid(st_point(-46.6565, -23.5613), 4326)::geography,
         geo_precisao = 'GEOCODIFICADO',
         geo_fonte = 'Nominatim · Avenida Paulista'
   where id = v_loc
  returning * into v_linha;

  if v_linha.geo is null then
    raise exception 'FALHA: a coordenada não foi gravada';
  end if;

  -- Carimbo automático: sem ele não há como julgar se uma coordenada de
  -- rastreio ainda vale ou é de seis meses atrás.
  if v_linha.geo_atualizado_em is null then
    raise exception 'FALHA RN-L35: geo_atualizado_em não foi carimbado';
  end if;

  if round(st_y(v_linha.geo::geometry)::numeric, 4) <> -23.5613 then
    raise exception 'FALHA: latitude gravada difere da informada (%)', st_y(v_linha.geo::geometry);
  end if;

  raise notice 'caso 2 OK — coordenada com origem entra e é carimbada';
end $$;

-- ---------------------------- caso 3: eixos trocados são recusados
do $$
declare v_loc uuid; v_erro text;
begin
  select valor::uuid into v_loc from _ctx where chave = 'local';

  begin
    -- Avenida Paulista com os eixos invertidos: cai no oceano Índico. É o erro
    -- que não lança nada em nenhuma outra camada — o ponto some do mapa e a
    -- única pista é alguém reparar que um cliente desapareceu.
    update public.local_operacao
       set geo = st_setsrid(st_point(-23.5613, -46.6565), 4326)::geography,
           geo_precisao = 'GEOCODIFICADO',
           geo_fonte = 'importação'
     where id = v_loc;
    raise exception 'FALHA RN-L36: coordenada fora do território foi aceita';
  exception when check_violation then
    get stacked diagnostics v_erro = message_text;
  end;

  if v_erro not like '%território brasileiro%' then
    raise exception 'FALHA RN-L36: a recusa não diz o que houve (%)', v_erro;
  end if;

  raise notice 'caso 3 OK — eixo trocado é barrado antes de virar dado';
end $$;

-- ---------------------------- caso 4: precisão fora do domínio é recusada
do $$
declare v_loc uuid;
begin
  select valor::uuid into v_loc from _ctx where chave = 'local';

  begin
    update public.local_operacao
       set geo = st_setsrid(st_point(-46.6, -23.5), 4326)::geography,
           geo_precisao = 'MAIS OU MENOS',
           geo_fonte = 'palpite'
     where id = v_loc;
    raise exception 'FALHA: geo_precisao aceitou valor fora do domínio';
  exception when check_violation then
    null;
  end;

  raise notice 'caso 4 OK — a precisão é um domínio, não texto livre';
end $$;

-- ---------------------------- caso 5: a função monta o ponto na ordem certa
do $$
declare v_loc uuid; v_linha public.local_operacao;
begin
  select valor::uuid into v_loc from _ctx where chave = 'local';

  -- A função recebe lat e lon **nessa ordem**, que é como todo geocodificador
  -- devolve, e monta o ponto na ordem do PostGIS. É justamente a inversão que
  -- ela existe para não deixar a cargo de cada chamador.
  v_linha := app.definir_geo_local(v_loc, -25.4284, -49.2733, 'GEOCODIFICADO', 'Nominatim · Curitiba');

  if round(st_y(v_linha.geo::geometry)::numeric, 4) <> -25.4284 then
    raise exception 'FALHA: a função trocou os eixos (lat gravada: %)', st_y(v_linha.geo::geometry);
  end if;
  if round(st_x(v_linha.geo::geometry)::numeric, 4) <> -49.2733 then
    raise exception 'FALHA: a função trocou os eixos (lon gravada: %)', st_x(v_linha.geo::geometry);
  end if;

  raise notice 'caso 5 OK — lat/lon na entrada, lon/lat no ponto, sem o chamador saber';
end $$;

-- ---------------------------- caso 6: origem em branco é recusada
do $$
declare v_loc uuid;
begin
  select valor::uuid into v_loc from _ctx where chave = 'local';

  begin
    perform app.definir_geo_local(v_loc, -23.5, -46.6, 'DECLARADA', '   ');
    raise exception 'FALHA RN-L35: origem em branco foi aceita';
  exception when check_violation then
    null;
  end;

  raise notice 'caso 6 OK — origem em branco não conta como origem';
end $$;

-- ---------------------------- caso 7: a mudança de local entra na auditoria
do $$
declare v_loc uuid; v_t uuid; v_n integer;
begin
  select valor::uuid into v_loc from _ctx where chave = 'local';
  select valor::uuid into v_t   from _ctx where chave = 'tenant';

  -- Mudar onde um cliente fica muda para onde o técnico é despachado. Quem
  -- mudou precisa ficar registrado — `local_operacao` não estava na lista da
  -- migração 0003 e passou a estar.
  select count(*) into v_n
    from public.audit_log
   where entidade_tipo = 'local_operacao' and tenant_id = v_t;

  if v_n = 0 then
    raise exception 'FALHA: nenhuma alteração de local_operacao foi auditada';
  end if;

  raise notice 'caso 7 OK — % registro(s) de auditoria para local_operacao', v_n;
end $$;

rollback;

\echo '== 08_rnl_geolocalizacao: TODOS OS CASOS APROVADOS =='
