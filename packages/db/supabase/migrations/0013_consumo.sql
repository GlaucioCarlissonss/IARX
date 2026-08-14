-- =============================================================================
-- 0013 — Consolidação de consumo de impressões
--
-- Referências: docs/anexos/L-lacunas-funcionais.md (Módulo 6)
--              docs/anexos/M-decisoes-mercado-brasileiro.md (M.3)
-- Invariantes: RN-L28 (consumo é derivado), RN-L29 (a série fecha),
--              RN-L30 (importação linha a linha), RN-L31 (alerta não repete),
--              RN-L32 (competência fechada é imutável)
--
-- Continuando a renumeração da migração 0012:
--   RN-L28…L34  consumo   (esta)
--
-- A espinha dorsal já existia: `medidor`, `leitura_medidor` particionada, RN-020
-- imposta por gatilho. O que falta é o que transforma leitura em
-- **acompanhamento** — consolidação por competência, comparação com a franquia
-- como objeto de primeira classe, alerta e importação em massa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- consumo_competencia
--
-- RN-L28: `paginas_*` são colunas **geradas**. Não existe caminho para informar
-- "o consumo do mês foi X" — ele é sempre a diferença entre duas leituras. É o
-- que impede a conversa "o sistema diz 12.400 mas o cliente reclamou, então
-- ajustei para 9.000": para mudar o consumo é preciso mudar uma leitura, e
-- leitura tem trilha, origem e monotonicidade.
-- -----------------------------------------------------------------------------
create table if not exists public.consumo_competencia (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenant(id) on delete restrict,
  competencia           char(7) not null,
  equipamento_id        uuid not null references public.equipamento(id) on delete restrict,
  contrato_item_id      uuid references public.contrato_item(id) on delete set null,
  cliente_id            uuid references public.cliente(id) on delete set null,
  local_operacao_id     uuid references public.local_operacao(id) on delete set null,

  leitura_inicial_mono  numeric(14,2) not null,
  leitura_final_mono    numeric(14,2) not null,
  paginas_mono          numeric(14,2) generated always as (leitura_final_mono - leitura_inicial_mono) stored,
  leitura_inicial_color numeric(14,2) not null default 0,
  leitura_final_color   numeric(14,2) not null default 0,
  paginas_color         numeric(14,2) generated always as (leitura_final_color - leitura_inicial_color) stored,

  franquia_mono         integer not null default 0,
  franquia_color        integer not null default 0,
  excedente_mono        numeric(14,2) not null default 0,
  excedente_color       numeric(14,2) not null default 0,
  valor_excedente       numeric(15,4) not null default 0,

  origem_final          text not null default 'MANUAL',
  justificativa         text,
  fechado_em            timestamptz,
  fechado_por           uuid references public.usuario(id) on delete set null,

  version    integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,

  constraint cc_competencia_formato check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- RN-020 vive no gatilho de `leitura_medidor`; aqui a consequência dela é
  -- que a final nunca é menor que a inicial. Consumo negativo é sempre defeito.
  constraint cc_leitura_monotonica check (
    leitura_final_mono >= leitura_inicial_mono and leitura_final_color >= leitura_inicial_color
  ),
  constraint cc_origem_valida check (
    origem_final in ('MANUAL','CAMPO','IMPORTACAO','TELEMETRIA','API','ESTIMATIVA')
  ),
  -- RN-L33: estimativa é exceção **marcada**. Sem justificativa, ela se
  -- confundiria com medição real na conferência do fechamento.
  constraint cc_estimativa_justificada check (
    origem_final <> 'ESTIMATIVA' or nullif(btrim(justificativa), '') is not null
  ),
  constraint cc_excedentes_nao_negativos check (
    excedente_mono >= 0 and excedente_color >= 0 and valor_excedente >= 0
  )
);

create unique index if not exists cc_equip_competencia_uk
  on public.consumo_competencia (tenant_id, equipamento_id, competencia);
create index if not exists cc_competencia_ix
  on public.consumo_competencia (tenant_id, competencia);
create index if not exists cc_cliente_ix
  on public.consumo_competencia (tenant_id, cliente_id, competencia);
-- Consulta do painel: quem estourou a franquia neste mês.
create index if not exists cc_excedente_ix
  on public.consumo_competencia (tenant_id, competencia)
  where excedente_mono > 0 or excedente_color > 0;

-- -----------------------------------------------------------------------------
-- Importação em massa
--
-- RN-L30: tudo-ou-nada **por linha**, não por arquivo. Rejeitar novecentas
-- leituras boas por causa de três ruins é pior que aceitar as novecentas — o
-- operador reprocessaria o arquivo inteiro para corrigir três células.
-- -----------------------------------------------------------------------------
create table if not exists public.importacao_leitura (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete restrict,
  nome_arquivo     text not null,
  competencia      char(7) not null,
  linhas_total     integer not null default 0,
  linhas_aceitas   integer not null default 0,
  linhas_rejeitadas integer not null default 0,
  status           text not null default 'PROCESSANDO',
  iniciada_em      timestamptz not null default now(),
  concluida_em     timestamptz,
  iniciada_por     uuid references public.usuario(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint il_status_valido check (status in ('PROCESSANDO','CONCLUIDA','CONCLUIDA_COM_ERROS','FALHOU')),
  constraint il_competencia_formato check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint il_contagem_coerente check (linhas_aceitas + linhas_rejeitadas <= linhas_total)
);
create index if not exists il_tenant_ix
  on public.importacao_leitura (tenant_id, iniciada_em desc);

create table if not exists public.importacao_leitura_linha (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete restrict,
  importacao_id    uuid not null references public.importacao_leitura(id) on delete cascade,
  numero_linha     integer not null,
  /* O conteúdo original fica guardado: sem ele, "linha 412 rejeitada" não diz
     ao operador o que estava escrito ali. */
  conteudo_original jsonb not null,
  equipamento_id   uuid references public.equipamento(id) on delete set null,
  valor            numeric(14,2),
  resultado        text not null,
  mensagem_erro    text,
  created_at timestamptz not null default now(),
  constraint ill_resultado_valido check (resultado in ('ACEITA','REJEITADA')),
  constraint ill_rejeitada_tem_motivo check (
    resultado <> 'REJEITADA' or nullif(btrim(mensagem_erro), '') is not null
  )
);
create unique index if not exists ill_linha_uk
  on public.importacao_leitura_linha (importacao_id, numero_linha);

-- -----------------------------------------------------------------------------
-- alerta_consumo
--
-- RN-L31: um alerta por limiar e competência. Reprocessar o fechamento não
-- pode reenviar o mesmo aviso — e o índice único é o que garante isso, não a
-- memória de quem executa o job.
-- -----------------------------------------------------------------------------
create table if not exists public.alerta_consumo (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete restrict,
  equipamento_id   uuid not null references public.equipamento(id) on delete cascade,
  contrato_item_id uuid references public.contrato_item(id) on delete set null,
  cliente_id       uuid references public.cliente(id) on delete set null,
  competencia      char(7) not null,
  limiar           integer not null,
  paginas          numeric(14,2) not null,
  franquia         integer not null,
  disparado_em     timestamptz not null default now(),
  notificado_em    timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint ac_limiar_valido check (limiar in (80, 100, 120)),
  constraint ac_competencia_formato check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
create unique index if not exists ac_unico_por_limiar_uk
  on public.alerta_consumo (equipamento_id, competencia, limiar);
create index if not exists ac_pendente_ix
  on public.alerta_consumo (tenant_id, competencia) where notificado_em is null;

-- =============================================================================
-- INVARIANTES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RN-L32 — competência fechada é imutável
--
-- Depois de fechada, a consolidação virou base de fatura. Corrigi-la em silêncio
-- faria a fatura emitida e o consumo registrado divergirem sem que nada
-- acusasse. Correção é por estorno, com ajuste na competência seguinte.
-- -----------------------------------------------------------------------------
create or replace function app.bloquear_competencia_fechada()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.fechado_em is not null then
      raise exception 'a competência % do equipamento % está fechada e não pode ser removida',
        old.competencia, old.equipamento_id
        using errcode = '23514', hint = 'Corrija por estorno, com ajuste na competência seguinte (RN-L32).';
    end if;
    return old;
  end if;

  if old.fechado_em is null then
    return new;
  end if;

  -- Reabrir é ação legítima e auditada; o que não pode é alterar os números
  -- com a competência ainda fechada.
  if new.fechado_em is null then
    return new;
  end if;

  if new.leitura_inicial_mono  is distinct from old.leitura_inicial_mono
  or new.leitura_final_mono    is distinct from old.leitura_final_mono
  or new.leitura_inicial_color is distinct from old.leitura_inicial_color
  or new.leitura_final_color   is distinct from old.leitura_final_color
  or new.franquia_mono         is distinct from old.franquia_mono
  or new.franquia_color        is distinct from old.franquia_color
  or new.valor_excedente       is distinct from old.valor_excedente then
    raise exception 'a competência % está fechada e serviu de base para faturamento', old.competencia
      using errcode = '23514', hint = 'Reabra a competência ou registre ajuste na seguinte (RN-L32).';
  end if;

  return new;
end;
$$;

drop trigger if exists cc_competencia_imutavel on public.consumo_competencia;
create trigger cc_competencia_imutavel
  before update or delete on public.consumo_competencia
  for each row execute function app.bloquear_competencia_fechada();

-- -----------------------------------------------------------------------------
-- RN-L29 — a série fecha: a leitura inicial é a final da anterior
--
-- Sem isto, páginas somem entre dois meses e ninguém percebe: cada competência
-- parece consistente sozinha, e só a soma do ano não bate com o contador do
-- equipamento.
-- -----------------------------------------------------------------------------
create or replace function app.validar_serie_de_consumo()
returns trigger
language plpgsql
as $$
declare
  v_final_anterior numeric(14,2);
  v_competencia_anterior char(7);
begin
  select competencia, leitura_final_mono
    into v_competencia_anterior, v_final_anterior
    from public.consumo_competencia
   where equipamento_id = new.equipamento_id
     and competencia < new.competencia
   order by competencia desc
   limit 1;

  if v_final_anterior is not null and new.leitura_inicial_mono <> v_final_anterior then
    raise exception
      'a leitura inicial de % (%) não fecha com a final de % (%)',
      new.competencia, new.leitura_inicial_mono, v_competencia_anterior, v_final_anterior
      using errcode = '23514',
            hint = 'A série precisa ser contínua: nenhuma página pode sumir entre dois meses (RN-L29).';
  end if;

  return new;
end;
$$;

drop trigger if exists cc_serie_continua on public.consumo_competencia;
create trigger cc_serie_continua
  before insert or update of leitura_inicial_mono, competencia on public.consumo_competencia
  for each row execute function app.validar_serie_de_consumo();

-- -----------------------------------------------------------------------------
-- Cálculo do excedente
--
-- Derivado, nunca informado — pela mesma razão de `paginas_*`. Um excedente
-- digitado é um excedente negociável na planilha, e a fatura deixa de ser
-- consequência da medição.
-- -----------------------------------------------------------------------------
create or replace function app.calcular_excedente()
returns trigger
language plpgsql
as $$
declare
  v_preco_mono numeric(15,6) := 0;
  v_preco_color numeric(15,6) := 0;
begin
  new.excedente_mono  := greatest(0, (new.leitura_final_mono - new.leitura_inicial_mono) - new.franquia_mono);
  new.excedente_color := greatest(0, (new.leitura_final_color - new.leitura_inicial_color) - new.franquia_color);

  -- O preço do excedente vem do item de contrato, não da tabela vigente: é o
  -- que o cliente acordou. Trocar a tabela não pode reprecificar o mês passado.
  select ci.valor_excedente_unitario, coalesce(ci.valor_excedente_unitario, 0)
    into v_preco_mono, v_preco_color
    from public.contrato_item ci where ci.id = new.contrato_item_id;

  new.valor_excedente := round(
    new.excedente_mono * coalesce(v_preco_mono, 0) + new.excedente_color * coalesce(v_preco_color, 0), 4);

  return new;
end;
$$;

drop trigger if exists cc_calcula_excedente on public.consumo_competencia;
create trigger cc_calcula_excedente
  before insert or update on public.consumo_competencia
  for each row execute function app.calcular_excedente();

-- -----------------------------------------------------------------------------
-- Disparo de alerta
--
-- 80% avisa a tempo de negociar; 100% e 120% avisam que já virou excedente. O
-- índice único faz o reprocessamento não duplicar (RN-L31) — a proteção é do
-- banco, e não da lembrança de quem roda o job.
-- -----------------------------------------------------------------------------
create or replace function app.disparar_alerta_consumo()
returns trigger
language plpgsql
as $$
declare
  v_paginas numeric(14,2);
  v_pct numeric;
  v_limiar integer;
begin
  if new.franquia_mono <= 0 then
    return new;
  end if;

  v_paginas := new.leitura_final_mono - new.leitura_inicial_mono;
  v_pct := (v_paginas / new.franquia_mono) * 100;

  foreach v_limiar in array array[80, 100, 120] loop
    if v_pct >= v_limiar then
      insert into public.alerta_consumo
        (tenant_id, equipamento_id, contrato_item_id, cliente_id, competencia, limiar, paginas, franquia)
      values
        (new.tenant_id, new.equipamento_id, new.contrato_item_id, new.cliente_id,
         new.competencia, v_limiar, v_paginas, new.franquia_mono)
      on conflict (equipamento_id, competencia, limiar) do nothing;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists cc_dispara_alerta on public.consumo_competencia;
create trigger cc_dispara_alerta
  after insert or update on public.consumo_competencia
  for each row execute function app.disparar_alerta_consumo();

-- =============================================================================
-- Gatilhos padrão, auditoria e RLS
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'consumo_competencia','importacao_leitura','importacao_leitura_linha','alerta_consumo'
  ] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    perform app.habilitar_auditoria(t);
    perform app.habilitar_rls_tenant(t, false);
  end loop;

  -- Só as tabelas com `updated_at` recebem o gatilho de toque.
  foreach t in array array['consumo_competencia','importacao_leitura'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;

-- O locatário enxerga o próprio consumo — é o dado central do portal (Módulo 5).
select app.habilitar_rls_cliente('consumo_competencia', 'cliente_id');
select app.habilitar_rls_cliente('alerta_consumo', 'cliente_id');

comment on table public.consumo_competencia is
  'Consolidação de consumo por equipamento e competência. `paginas_*` são geradas: não existe caminho para digitar o consumo do mês (RN-L28).';
comment on column public.consumo_competencia.origem_final is
  'ESTIMATIVA é exceção marcada e sai identificada na fatura (RN-L33).';
