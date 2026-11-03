-- =============================================================================
-- 0033 — Reajuste contratual (RN-008) e a alçada de desconto no contrato (RN-009)
--
-- ## Primeiro, uma alçada que existia e não alcançava o contrato
--
-- `app.limite_desconto_percentual` entrou na 0020 e vale para o título a
-- receber: conceder desconto acima do teto do perfil é recusado no banco.
-- RN-009 diz "Módulos: CTR, FAT" — e no CTR nada conferia.
--
-- O efeito é maior do lado do contrato, não menor: desconto em título é uma
-- cobrança; desconto em `contrato_item` entra em **todas** as competências até
-- o fim da vigência. O caminho mais curto para furar a alçada de desconto era
-- concedê-lo onde ninguém olhava e deixar o faturamento repeti-lo sozinho.
--
-- ## Depois, o reajuste
--
-- `RN-008`: na competência de aniversário o sistema calcula o reajuste pelo
-- índice, periodicidade e mês-base, e gera **proposta**; aplicar exige alçada.
-- "Reajustes não aplicados permanecem visíveis como receita renunciada até
-- decisão explícita" — que é o KPI-34, e é a razão de `RENUNCIADO` ser um
-- estado com motivo em vez de uma linha apagada.
--
-- O contrato já tem `indice_reajuste`, `periodicidade_reajuste_meses` e
-- `mes_base_reajuste` desde a 0005. O que faltava era onde registrar a
-- proposta, e o efeito de aplicá-la.
--
-- ### A regra de arredondamento mora aqui
--
-- "Duas casas decimais, meio para cima, aplicada ao valor unitário **antes** da
-- multiplicação por quantidade." A ordem não é detalhe: num contrato de 40
-- máquinas a diferença entre arredondar antes e depois é centavos por item que
-- viram reais por mês e divergência entre o que o sistema cobra e o que o
-- cliente recalcula. Fica no banco porque é a aplicação do reajuste que a usa,
-- e porque a proposta precisa mostrar exatamente o valor que será cobrado.
--
-- ### O que o reajuste não toca
--
-- Competência fechada. A memória de cálculo da 0030 grava o valor cobrado no
-- fechamento, e `titulo_receber_item` é imutável depois de aprovado — então
-- mudar `valor_unitario` hoje não reescreve nenhuma cobrança passada. É o que
-- torna seguro aplicar o reajuste direto no item.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RN-009 no contrato
-- -----------------------------------------------------------------------------
create or replace function app.validar_desconto_contrato()
returns trigger
language plpgsql
as $$
declare
  v_quem   uuid;
  v_limite numeric;
begin
  if coalesce(new.desconto_percentual, 0) = 0 then
    return new;
  end if;

  -- Só confere quando o desconto nasce ou muda. Reconferir em toda escrita
  -- faria uma mudança de vigência ser recusada por causa de um desconto que
  -- outra pessoa concedeu dentro da alçada dela, meses antes.
  if tg_op = 'UPDATE'
     and coalesce(new.desconto_percentual, 0) = coalesce(old.desconto_percentual, 0) then
    return new;
  end if;

  v_quem := app.usuario_atual();
  if v_quem is null then
    -- Sem usuário no contexto não há alçada a consultar: importação e carga
    -- inicial entram por aqui. A trilha de auditoria registra o autor nulo.
    return new;
  end if;

  v_limite := app.limite_desconto_percentual(v_quem);
  if new.desconto_percentual > v_limite then
    raise exception 'desconto de % por cento excede a alçada de % por cento',
                    new.desconto_percentual, v_limite
      using errcode = '23514',
            constraint = 'contrato_desconto_acima_da_alcada',
            hint = 'RN-009. Desconto em item de contrato se repete em toda competência até o fim da vigência.';
  end if;

  return new;
end;
$$;

drop trigger if exists ci_valida_desconto on public.contrato_item;
create trigger ci_valida_desconto
  before insert or update of desconto_percentual on public.contrato_item
  for each row execute function app.validar_desconto_contrato();

-- -----------------------------------------------------------------------------
-- RN-008 — reajuste
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'reajuste_status') then
    create type app.reajuste_status as enum ('PROPOSTO', 'APROVADO', 'APLICADO', 'RENUNCIADO');
  end if;
end $$;

create table if not exists public.reajuste (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  contrato_id   uuid not null references public.contrato(id) on delete restrict,

  /* Competência de aniversário: é ela que define quando o novo valor passa a
     valer, e é por ela que o indicador de receita renunciada agrupa. */
  competencia   date not null,

  indice             text not null,
  percentual_indice  numeric(7,4) not null,
  /* O aplicado pode ser menor que o do índice — reajuste negociado. Guardar os
     dois é o que permite medir quanto se deixou de cobrar por negociação, que
     é diferente de quanto se deixou por esquecimento. */
  percentual_aplicado numeric(7,4) not null,

  valor_anterior numeric(15,4) not null default 0,
  valor_novo     numeric(15,4) not null default 0,

  status         app.reajuste_status not null default 'PROPOSTO',
  proposto_em    timestamptz not null default now(),
  aprovado_por   uuid,
  aprovado_em    timestamptz,
  aplicado_em    timestamptz,
  motivo_renuncia text,

  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,

  constraint reajuste_competencia_e_mes check (competencia = date_trunc('month', competencia)::date),
  constraint reajuste_percentuais_coerentes check (
    percentual_indice > -100 and percentual_aplicado > -100
  ),
  constraint reajuste_renuncia_com_motivo check (
    status <> 'RENUNCIADO' or length(btrim(coalesce(motivo_renuncia, ''))) >= 10
  ),
  constraint reajuste_aprovacao_completa check (
    (aprovado_em is null) = (aprovado_por is null)
  )
);

/*
 * Um reajuste vivo por contrato e competência.
 *
 * Parcial, excluindo o renunciado: renunciar e propor de novo na mesma
 * competência é o caminho normal quando a negociação muda — o renunciado fica
 * como registro do que se deixou de cobrar, que é justamente o KPI-34.
 */
create unique index if not exists reajuste_competencia_uk
  on public.reajuste (tenant_id, contrato_id, competencia)
  where status <> 'RENUNCIADO';

create index if not exists reajuste_pendente_ix
  on public.reajuste (tenant_id, status, competencia desc);

comment on table public.reajuste is
  'RN-008. Proposta, aprovação e aplicação do reajuste por índice. RENUNCIADO é registro de receita renunciada (KPI-34), não exclusão.';

-- -----------------------------------------------------------------------------
-- Valor contratual corrente — a base do reajuste
--
-- Soma dos itens vigentes, com o desconto já aplicado. Não é o valor faturado
-- da competência (que depende de franquia e excedente medidos): é o valor fixo
-- contratado, que é sobre o que o índice incide.
-- -----------------------------------------------------------------------------
create or replace function app.valor_base_reajuste(p_contrato_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(
           round(ci.valor_unitario * (1 - coalesce(ci.desconto_percentual, 0) / 100), 2)
           * ci.quantidade
         ), 0)
    from public.contrato_item ci
   where ci.contrato_id = p_contrato_id
     and ci.status in ('RESERVADO','EM_ENTREGA','ATIVO','SUSPENSO')
     and ci.deleted_at is null;
$$;

/**
 * Valor que passará a valer, com a regra de arredondamento de RN-008.
 *
 * Arredonda o unitário **antes** de multiplicar pela quantidade. Num contrato
 * de dezenas de máquinas, inverter a ordem produz uma diferença de centavos por
 * item que o cliente encontra ao recalcular — e discussão de centavo custa mais
 * caro que o centavo.
 */
create or replace function app.valor_reajustado(p_contrato_id uuid, p_percentual numeric)
returns numeric
language sql
stable
as $$
  select coalesce(sum(
           round(
             round(ci.valor_unitario * (1 + p_percentual / 100), 2)
             * (1 - coalesce(ci.desconto_percentual, 0) / 100),
             2
           ) * ci.quantidade
         ), 0)
    from public.contrato_item ci
   where ci.contrato_id = p_contrato_id
     and ci.status in ('RESERVADO','EM_ENTREGA','ATIVO','SUSPENSO')
     and ci.deleted_at is null;
$$;

-- -----------------------------------------------------------------------------
-- Máquina do reajuste
-- -----------------------------------------------------------------------------
create or replace function app.validar_reajuste()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'PROPOSTO' then
      raise exception 'reajuste nasce como proposta'
        using errcode = '23514',
              constraint = 'reajuste_nasce_proposto',
              hint = 'RN-008: a aplicação exige aprovação, e aprovação exige proposta.';
    end if;

    if not exists (select 1 from public.contrato c
                    where c.id = new.contrato_id and c.tenant_id = new.tenant_id) then
      raise exception 'contrato % não pertence ao locatário', new.contrato_id
        using errcode = '23514', constraint = 'reajuste_contrato_inexistente';
    end if;

    -- Os dois valores são derivados, nunca digitados: é a proposta mostrando
    -- exatamente o que será cobrado se for aprovada.
    new.valor_anterior := app.valor_base_reajuste(new.contrato_id);
    new.valor_novo     := app.valor_reajustado(new.contrato_id, new.percentual_aplicado);
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not (old.status, new.status) in (
       ('PROPOSTO','APROVADO'),
       ('PROPOSTO','RENUNCIADO'),
       ('APROVADO','APLICADO'),
       ('APROVADO','RENUNCIADO')
     ) then
    raise exception 'transição de reajuste inválida: % → %', old.status, new.status
      using errcode = '23514', constraint = 'reajuste_transicao_valida';
  end if;

  if new.status = 'APROVADO' then
    new.aprovado_em  := coalesce(new.aprovado_em, now());
    new.aprovado_por := coalesce(new.aprovado_por, app.usuario_atual());
  end if;

  /*
   * Aplicar é a única transição com efeito fora da própria linha: ela reescreve
   * o valor unitário dos itens vigentes.
   *
   * Competência já fechada não é afetada — a memória de cálculo da 0030 gravou
   * o valor cobrado, e `titulo_receber_item` é imutável depois de aprovado. É
   * isso que torna seguro aplicar o reajuste direto no item em vez de manter
   * uma tabela de valores por período.
   */
  if new.status = 'APLICADO' then
    update public.contrato_item ci
       set valor_unitario = round(ci.valor_unitario * (1 + new.percentual_aplicado / 100), 2),
           updated_at = now(),
           updated_by = app.usuario_atual()
     where ci.contrato_id = new.contrato_id
       and ci.status in ('RESERVADO','EM_ENTREGA','ATIVO','SUSPENSO')
       and ci.deleted_at is null;

    new.aplicado_em := coalesce(new.aplicado_em, now());
    -- Reconfere o valor na aplicação: a composição do contrato pode ter mudado
    -- entre a proposta e a aprovação, e o que vale é o que foi cobrado.
    new.valor_novo := app.valor_base_reajuste(new.contrato_id);
  end if;

  return new;
end;
$$;

drop trigger if exists reajuste_transicao on public.reajuste;
create trigger reajuste_transicao
  before insert or update on public.reajuste
  for each row execute function app.validar_reajuste();

create or replace function app.reajuste_sem_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'reajuste não é apagado: renuncie com motivo'
    using errcode = '23514',
          constraint = 'reajuste_imutavel',
          hint = 'RN-008 e KPI-34: reajuste não aplicado é receita renunciada, e some do indicador se a linha sumir.';
end;
$$;

drop trigger if exists reajuste_sem_delete on public.reajuste;
create trigger reajuste_sem_delete
  before delete on public.reajuste
  for each row execute function app.reajuste_sem_delete();

do $$
begin
  perform app.habilitar_rls_tenant('reajuste', false);
  perform app.habilitar_auditoria('reajuste');
  execute 'drop trigger if exists reajuste_touch on public.reajuste';
  execute 'create trigger reajuste_touch before update on public.reajuste
             for each row execute function app.touch_updated_at()';
end $$;
