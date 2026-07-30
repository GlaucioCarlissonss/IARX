-- =============================================================================
-- 0005 — Clientes, contratos e alocação de equipamentos
--
-- Referências: docs/anexos/A-modelo-de-dados.md (A.4) · B-maquinas-de-estado.md (B.1)
-- Invariante central: RN-001 — um equipamento não pode estar em dois contratos
-- com vigências sobrepostas. Imposta por EXCLUDE constraint, não por código de
-- aplicação: nenhum caminho de escrita, integração ou correção manual via SQL
-- consegue produzir o estado inválido.
-- =============================================================================

do $$ begin
  create type app.contrato_status as enum (
    'RASCUNHO',
    'EM_APROVACAO',
    'AGUARDANDO_ASSINATURA',
    'ATIVO',
    'SUSPENSO',
    'EM_RENOVACAO',
    'VENCIDO_EM_CAMPO',
    'ENCERRADO',
    'CANCELADO',
    'DISTRATADO'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.contrato_item_status as enum (
    'PLANEJADO', 'RESERVADO', 'EM_ENTREGA', 'ATIVO', 'SUSPENSO',
    'EM_DEVOLUCAO', 'ENCERRADO', 'SUBSTITUIDO', 'CANCELADO'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.modalidade_cobranca as enum (
    'FIXO_MENSAL', 'POR_MEDICAO', 'FRANQUIA_EXCEDENTE',
    'DIARIA', 'HORA_EFETIVA', 'ESCALONADO_VOLUME', 'MISTO'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.situacao_credito as enum ('LIBERADO', 'OBSERVACAO', 'BLOQUEADO');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- cliente / local de operação
-- -----------------------------------------------------------------------------
create table if not exists public.cliente (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  tipo_pessoa   char(2) not null default 'PJ',
  documento     text not null,
  razao_social  text not null,
  nome_fantasia text,
  inscricao_estadual text,
  inscricao_municipal text,
  limite_credito numeric(15,4),
  situacao_credito app.situacao_credito not null default 'LIBERADO',
  filial_responsavel_id uuid references public.filial(id) on delete set null,
  campos_personalizados jsonb not null default '{}'::jsonb,
  version       integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  constraint cliente_tipo_pessoa_valido check (tipo_pessoa in ('PF','PJ')),
  constraint cliente_limite_nao_negativo check (coalesce(limite_credito,0) >= 0)
);
create unique index if not exists cliente_documento_uk
  on public.cliente (tenant_id, documento) where deleted_at is null;

create table if not exists public.local_operacao (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete restrict,
  cliente_id uuid not null references public.cliente(id) on delete restrict,
  codigo     text,
  nome       text not null,
  endereco   jsonb not null default '{}'::jsonb,
  responsavel text,
  janela_acesso text,
  restricoes text,
  ativo      boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text
);
create index if not exists local_operacao_cliente_ix
  on public.local_operacao (tenant_id, cliente_id) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- contrato
-- -----------------------------------------------------------------------------
create table if not exists public.contrato (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  numero        text not null,
  empresa_id    uuid not null references public.empresa(id) on delete restrict,
  filial_id     uuid not null references public.filial(id) on delete restrict,
  cliente_id    uuid not null references public.cliente(id) on delete restrict,
  tipo          text not null default 'LOCACAO_PRAZO_DETERMINADO',
  status        app.contrato_status not null default 'RASCUNHO',
  data_inicio   date,
  data_fim      date,
  prazo_minimo_meses integer,
  renovacao_automatica boolean not null default false,
  indice_reajuste text,
  periodicidade_reajuste_meses integer,
  mes_base_reajuste integer,
  valor_mensal_estimado numeric(15,4),
  responsavel_comercial_id uuid references public.usuario(id) on delete set null,
  contrato_pai_id uuid references public.contrato(id) on delete restrict,
  observacoes_operacionais text,
  campos_personalizados jsonb not null default '{}'::jsonb,
  version       integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,

  constraint contrato_vigencia_coerente check (data_fim is null or data_inicio is null or data_fim >= data_inicio),
  constraint contrato_mes_base_valido check (mes_base_reajuste is null or mes_base_reajuste between 1 and 12),
  -- A partir de ATIVO, vigência é obrigatória.
  constraint contrato_ativo_tem_vigencia check (
    status in ('RASCUNHO','EM_APROVACAO','AGUARDANDO_ASSINATURA','CANCELADO')
    or (data_inicio is not null and data_fim is not null)
  ),
  constraint contrato_nao_e_pai_de_si check (contrato_pai_id is distinct from id)
);
create unique index if not exists contrato_numero_uk
  on public.contrato (tenant_id, numero) where deleted_at is null;
-- Atende ao painel de renovação e à régua de alertas (RN-010)
create index if not exists contrato_vencimento_ix
  on public.contrato (tenant_id, status, data_fim) where deleted_at is null;
create index if not exists contrato_cliente_ix
  on public.contrato (tenant_id, cliente_id) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- contrato_item — onde vive a invariante RN-001
--
-- vigencia é um tstzrange [inicio, fim) materializado: permite que o
-- PostgreSQL imponha a ausência de sobreposição diretamente, com índice GiST.
-- Fim aberto (infinity) representa contrato por prazo indeterminado.
-- -----------------------------------------------------------------------------
create table if not exists public.contrato_item (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete restrict,
  contrato_id    uuid not null references public.contrato(id) on delete restrict,
  equipamento_id uuid references public.equipamento(id) on delete restrict,
  categoria_id   uuid references public.categoria_equipamento(id) on delete restrict,
  local_operacao_id uuid references public.local_operacao(id) on delete restrict,

  modalidade_cobranca app.modalidade_cobranca not null,
  valor_unitario  numeric(15,4) not null default 0,
  quantidade      numeric(12,2) not null default 1,
  franquia_quantidade numeric(14,2),
  franquia_escopo text,
  valor_excedente_unitario numeric(15,4),
  valor_minimo_mensal numeric(15,4),
  desconto_percentual numeric(5,2),
  desconto_motivo text,

  vigencia_inicio timestamptz not null,
  vigencia_fim    timestamptz,
  -- Coluna gerada: a fonte da verdade continua sendo inicio/fim.
  vigencia        tstzrange generated always as (
    tstzrange(vigencia_inicio, coalesce(vigencia_fim, 'infinity'::timestamptz), '[)')
  ) stored,

  status          app.contrato_item_status not null default 'PLANEJADO',
  substituido_por_id uuid references public.contrato_item(id) on delete set null,
  observacao      text,
  version         integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,

  constraint ci_vigencia_coerente check (vigencia_fim is null or vigencia_fim > vigencia_inicio),
  constraint ci_valores_nao_negativos check (
    valor_unitario >= 0 and quantidade > 0
    and coalesce(franquia_quantidade, 0) >= 0
    and coalesce(valor_excedente_unitario, 0) >= 0
    and coalesce(valor_minimo_mensal, 0) >= 0
  ),
  constraint ci_desconto_faixa check (
    desconto_percentual is null or (desconto_percentual >= 0 and desconto_percentual <= 100)
  ),
  -- RN-009: desconto exige justificativa
  constraint ci_desconto_com_motivo check (
    coalesce(desconto_percentual, 0) = 0 or desconto_motivo is not null
  ),
  -- Item aloca um ativo específico OU uma categoria (a definir na entrega)
  constraint ci_alvo_definido check (equipamento_id is not null or categoria_id is not null),
  -- Franquia/excedente exigem parâmetros próprios
  constraint ci_franquia_completa check (
    modalidade_cobranca <> 'FRANQUIA_EXCEDENTE'
    or (franquia_quantidade is not null and valor_excedente_unitario is not null
        and franquia_escopo in ('ITEM','CONTRATO'))
  )
);

-- =============================================================================
-- RN-001 — INVARIANTE: sem sobreposição de vigência para o mesmo equipamento
--
-- Estados considerados "ocupantes": RESERVADO, EM_ENTREGA, ATIVO, SUSPENSO,
-- EM_DEVOLUCAO. Um contrato SUSPENSO mantém o ativo alocado (RN-012), portanto
-- continua ocupando. PLANEJADO, ENCERRADO, SUBSTITUIDO e CANCELADO não ocupam.
--
-- Requer btree_gist (migração 0001) para combinar uuid (=) com tstzrange (&&).
-- =============================================================================
alter table public.contrato_item drop constraint if exists ci_sem_sobreposicao;
alter table public.contrato_item add constraint ci_sem_sobreposicao
  exclude using gist (
    tenant_id      with =,
    equipamento_id with =,
    vigencia       with &&
  ) where (
    equipamento_id is not null
    and status in ('RESERVADO','EM_ENTREGA','ATIVO','SUSPENSO','EM_DEVOLUCAO')
    and deleted_at is null
  );

comment on constraint ci_sem_sobreposicao on public.contrato_item is
  'RN-001: impede que o mesmo equipamento seja alocado a dois contratos com vigências sobrepostas. Substituição de ativo deve encerrar a alocação anterior na MESMA transação.';

create index if not exists ci_contrato_ix on public.contrato_item (tenant_id, contrato_id) where deleted_at is null;
create index if not exists ci_equipamento_ix on public.contrato_item (tenant_id, equipamento_id, status) where deleted_at is null;

-- Coerência de tenant entre item, contrato e equipamento.
create or replace function app.validar_coerencia_item()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.contrato c where c.id = new.contrato_id and c.tenant_id = new.tenant_id) then
    raise exception 'contrato % não pertence ao tenant %', new.contrato_id, new.tenant_id using errcode = '23514';
  end if;

  if new.equipamento_id is not null
     and not exists (select 1 from public.equipamento e where e.id = new.equipamento_id and e.tenant_id = new.tenant_id) then
    raise exception 'equipamento % não pertence ao tenant %', new.equipamento_id, new.tenant_id using errcode = '23514';
  end if;

  -- RN-003/RN-014: ativo bloqueado ou indisponível não pode ser alocado.
  if new.equipamento_id is not null
     and new.status in ('RESERVADO','EM_ENTREGA','ATIVO')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if exists (
      select 1 from public.equipamento e
      where e.id = new.equipamento_id
        and (e.bloqueado
             or e.status in ('EM_MANUTENCAO','EXTRAVIADO','BAIXADO',
                             'EM_TRANSITO_ENTREGA','EM_TRANSITO_RETORNO'))
    ) then
      raise exception 'equipamento % indisponível para alocação', new.equipamento_id
        using errcode = '23514',
              hint = 'Ver RN-003 e RN-014: verifique bloqueio por preventiva vencida ou estado operacional.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists ci_valida_coerencia on public.contrato_item;
create trigger ci_valida_coerencia
  before insert or update on public.contrato_item
  for each row execute function app.validar_coerencia_item();

do $$
declare t text;
begin
  foreach t in array array['cliente','local_operacao','contrato','contrato_item'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
    perform app.habilitar_auditoria(t);
  end loop;
end $$;
