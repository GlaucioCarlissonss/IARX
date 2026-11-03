-- =============================================================================
-- 0036 — Ordem de compra e inventário (Anexo A.7, D.6)
--
-- As duas pontas que faltavam no eixo de estoque. A reposição entra por ordem
-- de compra; a correção da contagem sai por inventário. Entre as duas, o que
-- já existia: movimento, saldo, reserva e baixa em OS.
--
-- ## Os status são derivados das operações, não transcritos de um anexo
--
-- `A.7` descreve as duas entidades e escreve "status" sem enumerar valores, e
-- o Anexo B não traz máquina de estados para nenhuma das duas — ao contrário
-- do contrato, da OS, do equipamento e da reserva de peça.
--
-- O que existe é o Anexo D.6, que nomeia as operações: para a ordem de compra
-- `criar`, `aprovar` e `receber` ("total ou parcial; recalcula custo médio");
-- para o inventário `executar` (contagem) e `aprovar` ("gera movimentos de
-- ajuste"). Os enums abaixo são o conjunto mínimo que essas operações exigem,
-- mais o cancelamento, que toda entidade de processo precisa ter.
--
-- **Isto é derivação, não especificação.** O vocabulário é escolha minha a
-- partir das operações nomeadas, e está registrado como pendência de
-- confirmação. Se o negócio usa outros nomes ou outras etapas — cotação,
-- conferência fiscal, contagem cega com segunda contagem —, o lugar de
-- corrigir é aqui, antes de haver dado.
--
-- ## O que não é derivação
--
-- O recebimento recalculando o custo médio é o Anexo D escrito; a geração de
-- movimentos de ajuste na aprovação do inventário também. E o saldo do sistema
-- congelado no momento da contagem — não da aprovação — é consequência direta
-- de RN-017: a divergência é a diferença entre o que o sistema dizia **quando
-- se contou** e o que estava na prateleira. Recalculá-la na aprovação faria
-- toda movimentação ocorrida no meio virar divergência de contagem.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rastreabilidade do movimento até a origem (A.7)
--
-- `movimento_estoque` já apontava para a OS. A.7 também prevê `inventario_id` e
-- `ordem_compra_id`, e sem eles a entrada de compra e o ajuste de inventário
-- entram no extrato sem dizer de onde vieram — que é metade do que RN-017 pede
-- quando diz "rastreável".
-- -----------------------------------------------------------------------------
alter table public.movimento_estoque
  add column if not exists ordem_compra_id uuid,
  add column if not exists inventario_id   uuid;

-- =============================================================================
-- Ordem de compra
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ordem_compra_status') then
    create type app.ordem_compra_status as enum (
      'RASCUNHO',
      'APROVADA',
      'PARCIALMENTE_RECEBIDA',
      'RECEBIDA',
      'CANCELADA'
    );
  end if;
end $$;

create table if not exists public.ordem_compra (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete restrict,
  numero         text not null,
  fornecedor_id  uuid not null references public.fornecedor(id) on delete restrict,
  /* O depósito de destino é da ordem, não do item: uma compra chega num lugar.
     Itens para depósitos diferentes são ordens diferentes, e é assim que o
     recebimento consegue ser conferido por quem está na doca. */
  deposito_id    uuid not null references public.deposito(id) on delete restrict,

  status         app.ordem_compra_status not null default 'RASCUNHO',
  previsao_entrega date,
  observacao     text,

  aprovado_por   uuid,
  aprovado_em    timestamptz,
  cancelado_em   timestamptz,
  motivo_cancelamento text,

  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,

  constraint oc_aprovacao_completa check ((aprovado_em is null) = (aprovado_por is null)),
  constraint oc_cancelamento_com_motivo check (
    status <> 'CANCELADA' or length(btrim(coalesce(motivo_cancelamento, ''))) >= 10
  )
);

create unique index if not exists oc_numero_uk
  on public.ordem_compra (tenant_id, numero);

create index if not exists oc_pendente_ix
  on public.ordem_compra (tenant_id, status, previsao_entrega);

create table if not exists public.ordem_compra_item (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete restrict,
  ordem_compra_id  uuid not null references public.ordem_compra(id) on delete cascade,
  peca_id          uuid not null references public.peca(id) on delete restrict,

  quantidade_pedida   numeric(14,3) not null,
  quantidade_recebida numeric(14,3) not null default 0,
  preco_unitario      numeric(15,4) not null,

  /* Derivado-não-armazenado, como em toda parte: total que diverge das
     parcelas é o número que ninguém defende numa conferência de nota. */
  valor_total numeric(15,4) generated always as (quantidade_pedida * preco_unitario) stored,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,

  constraint oci_quantidade_positiva check (quantidade_pedida > 0),
  constraint oci_preco_nao_negativo check (preco_unitario >= 0),
  /* Receber mais do que se pediu não é recebimento: é divergência de nota, e o
     lugar dela é a entrada fiscal, não o silêncio de um número que cresce. */
  constraint oci_recebido_ate_pedido check (
    quantidade_recebida >= 0 and quantidade_recebida <= quantidade_pedida
  )
);

create unique index if not exists oci_peca_uk
  on public.ordem_compra_item (ordem_compra_id, peca_id);

comment on table public.ordem_compra is
  'Anexo A.7 e D.6. Os status são derivados das operações do D.6 — o Anexo B não traz máquina para esta entidade.';

-- -----------------------------------------------------------------------------
-- Numeração e máquina
-- -----------------------------------------------------------------------------
create or replace function app.proximo_numero_oc(p_tenant uuid)
returns text
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select to_char(now(), 'YYYY') || '-' ||
         lpad((coalesce(max(substring(o.numero from '\d+$')::integer), 0) + 1)::text, 5, '0')
    from public.ordem_compra o
   where o.tenant_id = p_tenant
     and o.numero like to_char(now(), 'YYYY') || '-%';
$$;

create or replace function app.limite_ordem_compra(p_usuario_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(max(a.limite_valor), 0)
    from public.usuario_perfil up
    join public.alcada a
      on a.perfil_id = up.perfil_id
     and a.tipo = 'ORDEM_COMPRA'
     and a.tenant_id = app.tenant_atual()
   where up.usuario_id = p_usuario_id;
$$;

create or replace function app.alcada_oc_configurada()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.alcada a
     where a.tipo = 'ORDEM_COMPRA'
       and a.limite_valor is not null
       and a.tenant_id = app.tenant_atual()
  );
$$;

create or replace function app.valor_ordem_compra(p_oc uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(i.valor_total), 0)
    from public.ordem_compra_item i
   where i.ordem_compra_id = p_oc;
$$;

create or replace function app.validar_ordem_compra()
returns trigger
language plpgsql
as $$
declare
  v_n      integer;
  v_valor  numeric;
  v_quem   uuid;
  v_limite numeric;
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
    (new.status = 'CANCELADA' and old.status in ('RASCUNHO','APROVADA','PARCIALMENTE_RECEBIDA'))
    or (old.status, new.status) in (
         ('RASCUNHO','APROVADA'),
         ('APROVADA','PARCIALMENTE_RECEBIDA'),
         ('APROVADA','RECEBIDA'),
         ('PARCIALMENTE_RECEBIDA','RECEBIDA')
       )
  ) then
    raise exception 'transição de ordem de compra inválida: % → %', old.status, new.status
      using errcode = '23514', constraint = 'oc_transicao_valida';
  end if;

  if new.status = 'APROVADA' then
    select count(*) into v_n from public.ordem_compra_item i where i.ordem_compra_id = new.id;
    if v_n = 0 then
      raise exception 'ordem de compra sem item não é aprovada'
        using errcode = '23514',
              constraint = 'oc_sem_item',
              hint = 'Aprovar uma ordem vazia compromete alçada sobre valor nenhum.';
    end if;

    new.aprovado_em  := coalesce(new.aprovado_em, now());
    new.aprovado_por := coalesce(new.aprovado_por, app.usuario_atual());

    /*
     * Quinta alçada que já existia na estrutura e não era lida: `alcada`
     * aceita `ORDEM_COMPRA` desde a 0002. Mesma convenção das outras — só
     * morde onde foi configurada.
     */
    if app.alcada_oc_configurada() then
      v_quem := new.aprovado_por;
      if v_quem is not null then
        v_valor  := app.valor_ordem_compra(new.id);
        v_limite := app.limite_ordem_compra(v_quem);
        if v_valor > v_limite then
          raise exception 'ordem de % excede a alçada de %', v_valor, v_limite
            using errcode = '23514',
                  constraint = 'oc_acima_da_alcada',
                  hint = 'Peça a aprovação a quem tem alçada maior.';
        end if;
      end if;
    end if;
  end if;

  if new.status = 'CANCELADA' then
    new.cancelado_em := coalesce(new.cancelado_em, now());
  end if;

  return new;
end;
$$;

drop trigger if exists oc_transicao on public.ordem_compra;
create trigger oc_transicao
  before update of status on public.ordem_compra
  for each row execute function app.validar_ordem_compra();

/*
 * Item só muda enquanto a ordem é rascunho.
 *
 * Depois de aprovada, mexer na quantidade ou no preço é mudar o que foi
 * aprovado — a alçada teria validado um valor e a ordem chegaria com outro.
 * A exceção é `quantidade_recebida`, que é o recebimento escrevendo.
 */
create or replace function app.validar_item_oc()
returns trigger
language plpgsql
as $$
declare v_status app.ordem_compra_status;
begin
  select o.status into v_status from public.ordem_compra o
   where o.id = coalesce(new.ordem_compra_id, old.ordem_compra_id);

  if tg_op = 'UPDATE'
     and new.quantidade_pedida = old.quantidade_pedida
     and new.preco_unitario    = old.preco_unitario
     and new.peca_id           = old.peca_id then
    return new;  -- só o recebimento mudou
  end if;

  if v_status is distinct from 'RASCUNHO' then
    raise exception 'ordem de compra aprovada não tem itens alterados'
      using errcode = '23514',
            constraint = 'oc_item_apos_aprovacao',
            hint = 'A alçada aprovou um valor; mudar o item depois faria a ordem chegar com outro.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists oci_valida_edicao on public.ordem_compra_item;
create trigger oci_valida_edicao
  before insert or update or delete on public.ordem_compra_item
  for each row execute function app.validar_item_oc();

-- -----------------------------------------------------------------------------
-- Recebimento: a quantidade recebida e a entrada no estoque são o mesmo fato
--
-- Separá-los — a API escreve `quantidade_recebida` e depois registra o
-- movimento — cria o estado em que a ordem diz que chegou e o estoque diz que
-- não. É o tipo de divergência que só aparece no inventário seguinte, meses
-- depois, sem como atribuí-la a nenhum recebimento.
--
-- O movimento entra pelo **preço da ordem**, que é o que o Anexo D quer dizer
-- com "recalcula custo médio": o custo médio é projeção do movimento, e o
-- movimento carrega o preço pelo qual aquela quantidade entrou.
-- -----------------------------------------------------------------------------
create or replace function app.receber_item_oc()
returns trigger
language plpgsql
as $$
declare
  v_delta   numeric(14,3);
  v_oc      record;
  v_pendente integer;
begin
  v_delta := new.quantidade_recebida - old.quantidade_recebida;
  if v_delta <= 0 then
    return new;
  end if;

  select o.id, o.status, o.deposito_id, o.tenant_id into v_oc
    from public.ordem_compra o where o.id = new.ordem_compra_id;

  if v_oc.status not in ('APROVADA', 'PARCIALMENTE_RECEBIDA') then
    raise exception 'só ordem aprovada recebe mercadoria'
      using errcode = '23514',
            constraint = 'oc_recebimento_sem_aprovacao',
            hint = 'Receber antes de aprovar faria a mercadoria entrar sem que ninguém tivesse autorizado a compra.';
  end if;

  insert into public.movimento_estoque
    (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario,
     ordem_compra_id, registrado_por, motivo, created_by)
  values (v_oc.tenant_id, new.peca_id, v_oc.deposito_id, 'ENTRADA_COMPRA',
          v_delta, new.preco_unitario, v_oc.id, app.usuario_atual(),
          'recebimento de ordem de compra', app.usuario_atual());

  /*
   * E o status da ordem acompanha, derivado dos itens. Deixá-lo para quem
   * chama faria "recebida" e "tudo chegou" serem duas afirmações diferentes
   * que ninguém confere uma contra a outra.
   */
  select count(*) into v_pendente
    from public.ordem_compra_item i
   where i.ordem_compra_id = v_oc.id
     and i.quantidade_recebida < i.quantidade_pedida
     and i.id <> new.id;

  update public.ordem_compra
     set status = case
           when v_pendente = 0 and new.quantidade_recebida >= new.quantidade_pedida
             then 'RECEBIDA'::app.ordem_compra_status
           else 'PARCIALMENTE_RECEBIDA'::app.ordem_compra_status
         end,
         updated_at = now()
   where id = v_oc.id;

  return new;
end;
$$;

/*
 * `oci_recebe` ordena depois de `oci_valida_edicao` pelo nome — a validação
 * decide se a escrita é permitida, e só então o efeito acontece.
 */
drop trigger if exists oci_recebe on public.ordem_compra_item;
create trigger oci_recebe
  before update of quantidade_recebida on public.ordem_compra_item
  for each row execute function app.receber_item_oc();

-- =============================================================================
-- Inventário
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'inventario_status') then
    create type app.inventario_status as enum ('ABERTO', 'CONTADO', 'APROVADO', 'CANCELADO');
  end if;
  if not exists (select 1 from pg_type where typname = 'inventario_tipo') then
    create type app.inventario_tipo as enum ('GERAL', 'CICLICO');
  end if;
end $$;

create table if not exists public.inventario (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete restrict,
  deposito_id  uuid not null references public.deposito(id) on delete restrict,
  tipo         app.inventario_tipo not null default 'CICLICO',
  status       app.inventario_status not null default 'ABERTO',

  iniciado_em    timestamptz not null default now(),
  finalizado_em  timestamptz,
  aprovado_por   uuid,
  aprovado_em    timestamptz,
  motivo_cancelamento text,

  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,

  constraint inv_aprovacao_completa check ((aprovado_em is null) = (aprovado_por is null)),
  constraint inv_cancelamento_com_motivo check (
    status <> 'CANCELADO' or length(btrim(coalesce(motivo_cancelamento, ''))) >= 10
  )
);

/*
 * Um inventário aberto por depósito.
 *
 * Dois ao mesmo tempo contam a mesma prateleira e geram dois ajustes para a
 * mesma diferença — o segundo "corrigindo" o saldo que o primeiro já corrigiu.
 */
create unique index if not exists inv_aberto_uk
  on public.inventario (tenant_id, deposito_id)
  where status in ('ABERTO', 'CONTADO');

create table if not exists public.inventario_contagem (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete restrict,
  inventario_id  uuid not null references public.inventario(id) on delete cascade,
  peca_id        uuid not null references public.peca(id) on delete restrict,

  /*
   * O saldo do sistema é congelado aqui, no momento da contagem.
   *
   * Recalculá-lo na aprovação faria toda movimentação ocorrida entre contar e
   * aprovar virar divergência de contagem — e o ajuste corrigiria o saldo para
   * um número que já não corresponde a nada.
   */
  saldo_sistema  numeric(14,3) not null,
  saldo_contado  numeric(14,3) not null,
  divergencia    numeric(14,3) generated always as (saldo_contado - saldo_sistema) stored,

  contado_por    uuid,
  contado_em     timestamptz not null default now(),
  justificativa  text,
  movimento_ajuste_id uuid,

  created_at     timestamptz not null default now(),
  created_by     uuid,

  constraint inv_contagem_nao_negativa check (saldo_contado >= 0 and saldo_sistema >= 0)
);

create unique index if not exists inv_contagem_peca_uk
  on public.inventario_contagem (inventario_id, peca_id);

comment on table public.inventario is
  'Anexo A.7 e D.6. Os status são derivados das operações do D.6 — o Anexo B não traz máquina para esta entidade.';

create or replace function app.validar_inventario()
returns trigger
language plpgsql
as $$
declare
  v_n     integer;
  v_mov   uuid;
  /* Nome com prefixo de propósito: declarar `c` colidiria com o alias `c` das
     consultas abaixo, e o PL/pgSQL resolve `c.coluna` para a variável, não
     para a tabela — com o erro aparecendo longe de onde a confusão está. */
  v_cont  record;
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
    (new.status = 'CANCELADO' and old.status in ('ABERTO','CONTADO'))
    or (old.status, new.status) in (('ABERTO','CONTADO'), ('CONTADO','APROVADO'))
  ) then
    raise exception 'transição de inventário inválida: % → %', old.status, new.status
      using errcode = '23514', constraint = 'inv_transicao_valida';
  end if;

  if new.status = 'CONTADO' then
    select count(*) into v_n from public.inventario_contagem c
     where c.inventario_id = new.id;
    if v_n = 0 then
      raise exception 'inventário sem nenhuma contagem não é fechado'
        using errcode = '23514',
              constraint = 'inv_sem_contagem',
              hint = 'Fechar um inventário vazio registraria que nada divergiu sem ninguém ter contado.';
    end if;

    /*
     * Divergência sem justificativa é o ajuste que ninguém consegue explicar
     * depois. Como o ajuste avulso já exige motivo (0027), exigir aqui mantém
     * a mesma régua para o caminho que gera ajuste em lote.
     */
    select count(*) into v_n
      from public.inventario_contagem c
     where c.inventario_id = new.id
       and c.divergencia <> 0
       and length(btrim(coalesce(c.justificativa, ''))) < 10;
    if v_n > 0 then
      raise exception '% contagem(ns) divergente(s) sem justificativa', v_n
        using errcode = '23514', constraint = 'inv_divergencia_sem_justificativa';
    end if;

    new.finalizado_em := coalesce(new.finalizado_em, now());
  end if;

  /*
   * Aprovar gera os movimentos de ajuste (Anexo D.6).
   *
   * Em lote e no gatilho, porque o conjunto é que é a decisão: aprovar metade
   * das divergências de um inventário deixaria o saldo numa combinação que
   * ninguém contou. Cada ajuste passa pela alçada da 0035 — e se um deles
   * exceder o teto, a aprovação inteira recua, que é o comportamento correto.
   */
  if new.status = 'APROVADO' then
    new.aprovado_em  := coalesce(new.aprovado_em, now());
    new.aprovado_por := coalesce(new.aprovado_por, app.usuario_atual());

    for v_cont in
      select id, peca_id, divergencia, justificativa
        from public.inventario_contagem
       where inventario_id = new.id and divergencia <> 0
    loop
      insert into public.movimento_estoque
        (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario,
         inventario_id, registrado_por, motivo, created_by)
      select new.tenant_id, v_cont.peca_id, new.deposito_id, 'AJUSTE_INVENTARIO',
             v_cont.divergencia,
             case when s.quantidade_fisica > 0
                  then round(s.valor_total / s.quantidade_fisica, 4)
                  else coalesce(p.custo_medio, 0) end,
             new.id, new.aprovado_por, v_cont.justificativa, new.aprovado_por
        from public.peca p
        left join public.saldo_estoque s
          on s.peca_id = v_cont.peca_id and s.deposito_id = new.deposito_id
       where p.id = v_cont.peca_id
      returning id into v_mov;

      update public.inventario_contagem set movimento_ajuste_id = v_mov where id = v_cont.id;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists inv_transicao on public.inventario;
create trigger inv_transicao
  before update of status on public.inventario
  for each row execute function app.validar_inventario();

/*
 * Contagem só entra enquanto o inventário está aberto, e não se edita depois.
 *
 * A contagem é a evidência: alterá-la depois de fechada muda a divergência que
 * alguém aprovou, e o ajuste gerado deixaria de corresponder ao que foi
 * decidido.
 */
create or replace function app.validar_contagem()
returns trigger
language plpgsql
as $$
declare v_status app.inventario_status;
begin
  select i.status into v_status from public.inventario i
   where i.id = coalesce(new.inventario_id, old.inventario_id);

  -- O carimbo do movimento de ajuste é escrita do próprio gatilho de aprovação.
  if tg_op = 'UPDATE'
     and new.saldo_contado = old.saldo_contado
     and new.saldo_sistema = old.saldo_sistema
     and new.peca_id       = old.peca_id then
    return new;
  end if;

  if v_status is distinct from 'ABERTO' then
    raise exception 'contagem só entra em inventário aberto'
      using errcode = '23514',
            constraint = 'inv_contagem_fora_de_abertura',
            hint = 'A contagem é a evidência: mudá-la depois muda a divergência que alguém aprovou.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists inv_contagem_valida on public.inventario_contagem;
create trigger inv_contagem_valida
  before insert or update or delete on public.inventario_contagem
  for each row execute function app.validar_contagem();

-- -----------------------------------------------------------------------------
-- Gatilhos padrão, auditoria e RLS
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ordem_compra','ordem_compra_item','inventario','inventario_contagem'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    perform app.habilitar_rls_tenant(t, false);
    perform app.habilitar_auditoria(t);
  end loop;

  /*
   * `inventario_contagem` fica de fora do `touch`, e não por esquecimento: ela
   * não tem `updated_at` porque não é para ser atualizada. A contagem é a
   * evidência do que estava na prateleira naquele momento — a única escrita
   * posterior é o carimbo do movimento de ajuste, feito pelo próprio gatilho de
   * aprovação. Um campo "atualizado em" sugeriria que editá-la é normal.
   */
  foreach t in array array['ordem_compra','ordem_compra_item','inventario'] loop
    execute format(
      'create trigger %I_touch before update on public.%I
         for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;
