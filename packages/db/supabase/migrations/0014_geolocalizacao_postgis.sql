-- =============================================================================
-- 0014 — Proveniência da coordenada geográfica
--
-- Referências: docs/anexos/O-mapa-geografico.md
-- Invariantes: RN-L35 (coordenada tem origem), RN-L36 (eixo não se troca)
--
-- Continuando a renumeração:
--   RN-L35…L36  geolocalização  (esta)
--
-- A migração 0008 criou `local_operacao.geo` e, ao lado dela, um
-- `geo_precisao text` sem restrição e sem nenhum uso — um campo que aceitava
-- qualquer coisa e por isso não afirmava nada. Com a busca de endereço no mapa,
-- passa a existir um segundo caminho de escrita de coordenada, e a diferença
-- entre os caminhos vira informação operacional: uma coordenada digitada no
-- cadastro, uma vinda de geocodificação e uma vinda de rastreio de equipamento
-- merecem confianças diferentes na hora de despachar um técnico.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Proveniência
-- -----------------------------------------------------------------------------
alter table public.local_operacao
  add column if not exists geo_fonte text,
  add column if not exists geo_atualizado_em timestamptz;

comment on column public.local_operacao.geo_precisao is
  'Como a coordenada foi obtida. Decide se ela pode ser sobrescrita por um palpite.';
comment on column public.local_operacao.geo_fonte is
  'Origem legível: serviço de geocodificação e termo consultado, equipamento rastreador, ou quem digitou.';

/*
 * A restrição de domínio é `not valid` de propósito.
 *
 * Uma base existente pode ter `geo_precisao` preenchida com texto livre — o
 * campo estava aberto desde a 0008. Validar retroativamente reprovaria linhas
 * legítimas e derrubaria o deploy inteiro por causa de dado histórico, que é
 * um jeito caro de descobrir que a regra nova vale só daqui para a frente.
 * Escritas novas já são barradas; a validação retroativa acontece quando
 * alguém tiver normalizado o histórico:
 *
 *   alter table public.local_operacao validate constraint local_operacao_geo_precisao_valida;
 */
alter table public.local_operacao drop constraint if exists local_operacao_geo_precisao_valida;
alter table public.local_operacao add constraint local_operacao_geo_precisao_valida
  check (geo_precisao is null or geo_precisao in ('DECLARADA', 'GEOCODIFICADO', 'RASTREADA', 'APROXIMADA'))
  not valid;

-- -----------------------------------------------------------------------------
-- RN-L35 · coordenada tem origem
-- RN-L36 · o eixo não se troca
--
-- Em gatilho, e não em CHECK, pelo mesmo motivo acima: gatilho vale para a
-- escrita nova e não julga o passado.
--
-- RN-L36 merece explicação. Latitude e longitude trocadas é o erro clássico da
-- integração geográfica, e é o pior tipo de erro: não lança nada. As
-- coordenadas brasileiras trocadas caem no oceano Índico, o ponto some do mapa,
-- e a única pista é alguém reparar que um cliente desapareceu. O envelope
-- abaixo é o do território nacional com folga; uma locadora que passe a operar
-- fora do país relaxa a regra **aqui**, num lugar só.
-- -----------------------------------------------------------------------------
create or replace function app.validar_geo_local()
returns trigger
language plpgsql
as $$
declare
  v_lat double precision;
  v_lon double precision;
begin
  if new.geo is null then
    return new;
  end if;

  if new.geo_precisao is null then
    raise exception 'Coordenada sem proveniência: informe geo_precisao.'
      using errcode = 'check_violation',
            column = 'geo_precisao',
            table = 'local_operacao',
            hint = 'DECLARADA, GEOCODIFICADO, RASTREADA ou APROXIMADA.';
  end if;

  v_lon := st_x(new.geo::geometry);
  v_lat := st_y(new.geo::geometry);

  if v_lat < -34.5 or v_lat > 6.0 or v_lon < -74.5 or v_lon > -33.5 then
    raise exception
      'Coordenada (% , %) cai fora do território brasileiro.', v_lat, v_lon
      using errcode = 'check_violation',
            column = 'geo',
            table = 'local_operacao',
            hint = 'Confira se latitude e longitude não foram trocadas na origem.';
  end if;

  -- Carimbo do momento da última definição. Sem ele não há como julgar se uma
  -- coordenada de rastreio ainda vale ou é de seis meses atrás.
  if tg_op = 'INSERT' or new.geo is distinct from old.geo then
    new.geo_atualizado_em := now();
  end if;

  return new;
end;
$$;

drop trigger if exists local_operacao_geo_valida on public.local_operacao;
create trigger local_operacao_geo_valida
  before insert or update on public.local_operacao
  for each row execute function app.validar_geo_local();

-- -----------------------------------------------------------------------------
-- Escrita da coordenada em um lugar só
--
-- A função existe para que o caminho da aplicação e o de uma importação em
-- massa passem pelas mesmas checagens. Recebe latitude e longitude separadas
-- porque é assim que qualquer geocodificador devolve, e monta o ponto aqui —
-- `st_point` recebe **longitude primeiro**, e essa inversão é justamente o erro
-- que a RN-L36 existe para pegar. Deixá-la a cargo de cada chamador seria
-- espalhar a chance de errar.
-- -----------------------------------------------------------------------------
create or replace function app.definir_geo_local(
  p_local_id  uuid,
  p_lat       double precision,
  p_lon       double precision,
  p_precisao  text,
  p_fonte     text
) returns public.local_operacao
language plpgsql
as $$
declare
  v_linha public.local_operacao;
begin
  if coalesce(btrim(p_fonte), '') = '' then
    raise exception 'Informe a origem da coordenada.'
      using errcode = 'check_violation', column = 'geo_fonte', table = 'local_operacao';
  end if;

  update public.local_operacao
     set geo           = st_setsrid(st_point(p_lon, p_lat), 4326)::geography,
         geo_precisao  = p_precisao,
         geo_fonte     = btrim(p_fonte),
         updated_at    = now()
   where id = p_local_id
     and deleted_at is null
  returning * into v_linha;

  if not found then
    raise exception 'Local de operação % não encontrado.', p_local_id
      using errcode = 'no_data_found';
  end if;

  return v_linha;
end;
$$;

comment on function app.definir_geo_local(uuid, double precision, double precision, text, text) is
  'Grava a coordenada de um local com proveniência obrigatória. Monta o ponto na ordem lon/lat, para o chamador não precisar acertar isso.';

-- -----------------------------------------------------------------------------
-- Auditoria
--
-- `local_operacao` não estava na lista da 0003. Passa a estar: mudar onde um
-- cliente fica muda para onde o técnico é despachado, e quem mudou precisa
-- ficar registrado.
-- -----------------------------------------------------------------------------
select app.habilitar_auditoria('local_operacao');
