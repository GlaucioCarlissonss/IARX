-- =============================================================================
-- 0008 — Geoespacial (módulo MAP)
--
-- Referências: docs/05-funcionalidades-essenciais.md (§5.3) · A-modelo-de-dados.md
--
-- Separada das demais para que o CI possa validar todo o núcleo em um
-- PostgreSQL sem PostGIS (SKIP_POSTGIS=1). No Supabase, PostGIS está
-- disponível como extensão.
-- =============================================================================

create extension if not exists postgis;

-- -----------------------------------------------------------------------------
-- Colunas geográficas
--
-- Usamos `geography(Point, 4326)` em vez de `geometry`: cálculos de distância
-- saem em metros sobre o esferoide, sem necessidade de reprojeção — o que
-- importa para "ativos num raio de X km" e para custo de deslocamento técnico.
-- -----------------------------------------------------------------------------
alter table public.filial
  add column if not exists geo geography(Point, 4326);

alter table public.local_operacao
  add column if not exists geo geography(Point, 4326),
  add column if not exists geo_precisao text;

alter table public.equipamento
  add column if not exists geo_atual geography(Point, 4326),
  -- Distingue posição declarada (movimentação/cadastro) de rastreada
  -- (telemetria), habilitando o alerta de divergência do F-MAP-10.
  add column if not exists geo_origem text,
  add column if not exists geo_atualizado_em timestamptz;

alter table public.equipamento drop constraint if exists equipamento_geo_origem_valida;
alter table public.equipamento add constraint equipamento_geo_origem_valida
  check (geo_origem is null or geo_origem in ('DECLARADA', 'RASTREADA'));

-- -----------------------------------------------------------------------------
-- Índices espaciais
--
-- GiST sobre geography atende as consultas por viewport do mapa
-- (ST_Intersects com o bbox) e por proximidade (ST_DWithin).
-- -----------------------------------------------------------------------------
create index if not exists filial_geo_ix on public.filial using gist (geo);
create index if not exists local_operacao_geo_ix on public.local_operacao using gist (geo);
create index if not exists equipamento_geo_ix on public.equipamento using gist (geo_atual);

-- Índice composto para o caso real do mapa: recorte espacial + filtro de estado.
create index if not exists equipamento_geo_status_ix
  on public.equipamento using gist (geo_atual)
  where deleted_at is null and status <> 'BAIXADO';

-- -----------------------------------------------------------------------------
-- Consulta de ativos por viewport, já agregando quando o zoom é baixo
--
-- Devolve pontos individuais em zoom alto e clusters em zoom baixo. A agregação
-- acontece no banco: o navegador nunca recebe a frota inteira (F-MAP-14).
-- -----------------------------------------------------------------------------
create or replace function app.mapa_ativos(
  p_oeste  double precision,
  p_sul    double precision,
  p_leste  double precision,
  p_norte  double precision,
  p_zoom   integer,
  p_status text[] default null
)
returns table (
  tipo        text,        -- 'PONTO' ou 'CLUSTER'
  equipamento_id uuid,
  patrimonio  text,
  status      text,
  quantidade  integer,
  lng         double precision,
  lat         double precision
)
language sql
stable
as $$
  with recorte as (
    select e.id, e.patrimonio, e.status::text as status, e.geo_atual
    from public.equipamento e
    where e.deleted_at is null
      and e.geo_atual is not null
      and e.status <> 'BAIXADO'
      and (p_status is null or e.status::text = any(p_status))
      and st_intersects(
            e.geo_atual,
            st_makeenvelope(p_oeste, p_sul, p_leste, p_norte, 4326)::geography
          )
  )
  -- Zoom alto: pontos individuais.
  select 'PONTO'::text, r.id, r.patrimonio, r.status, 1,
         st_x(r.geo_atual::geometry), st_y(r.geo_atual::geometry)
  from recorte r
  where p_zoom >= 12

  union all

  -- Zoom baixo: agrega em uma grade cuja resolução acompanha o zoom.
  select 'CLUSTER'::text, null::uuid, null::text, null::text,
         count(*)::integer,
         avg(st_x(r.geo_atual::geometry)), avg(st_y(r.geo_atual::geometry))
  from recorte r
  where p_zoom < 12
  group by
    round(st_x(r.geo_atual::geometry) / (20.0 / power(2, greatest(p_zoom, 1)))),
    round(st_y(r.geo_atual::geometry) / (20.0 / power(2, greatest(p_zoom, 1))));
$$;

comment on function app.mapa_ativos is
  'Consulta do mapa por viewport. Retorna pontos em zoom >= 12 e clusters agregados no banco em zoom menor, para que o cliente nunca receba a frota inteira (F-MAP-14).';

grant execute on function app.mapa_ativos to iarx_app, authenticated;
