-- =============================================================================
-- 0026 — Módulo MNT: manutenção (técnico, ordem de serviço, apontamento, pausa)
--
-- O Anexo X listava Ordens de Serviço como "pendência de **especificação**,
-- antes de ser de construção". Ao ir construir, a especificação estava toda
-- escrita: o Anexo A.6 define as quatro tabelas campo a campo, o Anexo B.3 a
-- máquina de estados com atores e pré-condições, o Anexo C as doze permissões
-- (`os:criar`, `os:triar`, …) e o Anexo D o catálogo de rotas.
--
-- A pendência era de construção desde sempre. Fica a correção registrada, e a
-- lição que ela traz: **"falta especificar" é uma afirmação que envelhece**, e
-- envelhece em silêncio porque ninguém reabre o anexo para conferir.
--
-- Esta migração segue o Anexo A.6 e o B.3. Onde um campo foi omitido, é porque
-- ele depende de um módulo que ainda não existe — `sla_id`, `sintoma_id`,
-- `causa_raiz_id` e `solucao_id` apontariam para catálogos do módulo de SLA, e
-- criar a coluna sem a tabela seria criar uma referência que nada garante.
-- `os_peca` fica para a migração do estoque, pela mesma razão: ela referencia
-- `peca` e `movimento_estoque`.
-- =============================================================================

do $$ begin
  create type app.os_status as enum (
    'ABERTA',
    'TRIAGEM',
    'AGENDADA',
    'EM_EXECUCAO',
    'AGUARDANDO_PECA',
    'CONCLUIDA',
    'VALIDADA',
    'CANCELADA'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.os_tipo as enum ('CORRETIVA','PREVENTIVA','INSPECAO','MELHORIA','SINISTRO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.os_origem as enum ('INTERNA','CLIENTE','PREVENTIVA_AUTO','CHECKLIST','API','TELEMETRIA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.os_prioridade as enum ('BAIXA','MEDIA','ALTA','CRITICA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.os_responsabilidade as enum ('LOCADORA','CLIENTE','TERCEIRO','DESGASTE_NATURAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.os_apontamento_tipo as enum ('EXECUCAO','DESLOCAMENTO','ESPERA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.os_pausa_motivo as enum
    ('AGUARDANDO_PECA','ACESSO_NEGADO','APROVACAO_CLIENTE','APROVACAO_INTERNA');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- tecnico
--
-- Separado de `usuario` de propósito. Nem todo técnico tem login — terceirizado
-- que só recebe ordem pelo supervisor é técnico e não é usuário —, e nem todo
-- usuário é técnico. Amarrar os dois faria o cadastro de quem executa depender
-- de conceder acesso ao sistema, que é decisão de outra natureza.
--
-- `usuario_id` existe e é opcional: quando o técnico também entra no sistema, é
-- por ele que a OS sabe que quem apontou é quem executou.
-- -----------------------------------------------------------------------------
create table if not exists public.tecnico (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete restrict,
  usuario_id      uuid references public.usuario(id) on delete set null,
  nome            text not null,
  matricula       text,
  filial_id       uuid references public.filial(id) on delete restrict,
  /* Famílias que o técnico atende. Array porque a pergunta real é "ele pega
     esta máquina?", e uma tabela de ligação para três valores fixos
     transformaria toda consulta de fila num join a mais. */
  especialidades  text[] not null default '{}',
  /* Custo-hora em centavos de quatro casas, como o resto do financeiro. */
  custo_hora      numeric(15,4),
  ativo           boolean not null default true,
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  deleted_at      timestamptz,
  deleted_by      uuid,
  delete_reason   text,
  constraint tecnico_custo_hora_nao_negativo check (custo_hora is null or custo_hora >= 0)
);

create unique index if not exists tecnico_matricula_uk
  on public.tecnico (tenant_id, matricula)
  where matricula is not null and deleted_at is null;

-- Um usuário é técnico uma vez só: dois cadastros para a mesma pessoa fariam a
-- carga de trabalho aparecer dividida e a fila parecer mais folgada do que é.
create unique index if not exists tecnico_usuario_uk
  on public.tecnico (tenant_id, usuario_id)
  where usuario_id is not null and deleted_at is null;

-- -----------------------------------------------------------------------------
-- ordem_servico
--
-- Campos conforme o Anexo A.6. Os prazos são três colunas e não uma, porque
-- SLA de **resposta** e SLA de **solução** são compromissos distintos: uma
-- locadora pode cumprir o primeiro e furar o segundo, e o relatório que junta
-- os dois esconde exatamente o que precisa ser corrigido.
-- -----------------------------------------------------------------------------
create table if not exists public.ordem_servico (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenant(id) on delete restrict,
  numero                 text not null,
  equipamento_id         uuid not null references public.equipamento(id) on delete restrict,
  filial_id              uuid references public.filial(id) on delete restrict,
  tipo                   app.os_tipo not null,
  origem                 app.os_origem not null default 'INTERNA',
  status                 app.os_status not null default 'ABERTA',
  prioridade             app.os_prioridade not null default 'MEDIA',
  criticidade            text,

  contrato_id            uuid references public.contrato(id) on delete restrict,
  cliente_id             uuid references public.cliente(id) on delete restrict,
  local_operacao_id      uuid references public.local_operacao(id) on delete restrict,

  descricao              text not null,
  causa_raiz             text,
  solucao                text,
  tecnico_responsavel_id uuid references public.tecnico(id) on delete restrict,

  abertura_em            timestamptz not null default now(),
  prazo_resposta_em      timestamptz,
  resposta_em            timestamptz,
  prazo_solucao_em       timestamptz,
  inicio_execucao_em     timestamptz,
  conclusao_em           timestamptz,
  validacao_em           timestamptz,
  validado_por           uuid references public.usuario(id) on delete restrict,

  tempo_pausado_minutos  integer not null default 0,
  impacta_disponibilidade boolean not null default true,
  causa_responsabilidade app.os_responsabilidade,

  custo_mao_obra         numeric(15,4) not null default 0,
  custo_material         numeric(15,4) not null default 0,
  custo_terceiros        numeric(15,4) not null default 0,
  custo_deslocamento     numeric(15,4) not null default 0,
  /* Coluna gerada, e não somada pela aplicação.
     RN: derivado-não-armazenado. Se não há caminho de escrita, não há caminho
     de divergência — e custo total que diverge das parcelas é o número que
     ninguém consegue defender numa revisão de margem. */
  custo_total            numeric(15,4) generated always as
                           (custo_mao_obra + custo_material + custo_terceiros + custo_deslocamento) stored,

  os_origem_id           uuid references public.ordem_servico(id) on delete restrict,
  version                integer not null default 1,
  created_at             timestamptz not null default now(),
  created_by             uuid,
  updated_at             timestamptz not null default now(),
  updated_by             uuid,
  deleted_at             timestamptz,
  deleted_by             uuid,
  delete_reason          text,

  constraint os_custos_nao_negativos check (
    custo_mao_obra >= 0 and custo_material >= 0
    and custo_terceiros >= 0 and custo_deslocamento >= 0
  ),
  constraint os_pausa_nao_negativa check (tempo_pausado_minutos >= 0),
  /* Validada exige quem validou e quando — sem isso RN-027 não tem como ser
     conferida depois, e a segregação vira promessa sem evidência. */
  constraint os_validada_tem_validador check (
    status <> 'VALIDADA' or (validado_por is not null and validacao_em is not null)
  ),
  /* Reabertura aponta para a OS original. Uma OS não reabre a si mesma. */
  constraint os_origem_distinta check (os_origem_id is null or os_origem_id <> id)
);

create unique index if not exists ordem_servico_numero_uk
  on public.ordem_servico (tenant_id, numero)
  where deleted_at is null;

-- Fila por risco de SLA — o índice que o Anexo A.7 pede.
create index if not exists ordem_servico_fila_ix
  on public.ordem_servico (tenant_id, status, prazo_solucao_em);

-- Histórico técnico do equipamento.
create index if not exists ordem_servico_equipamento_ix
  on public.ordem_servico (tenant_id, equipamento_id, abertura_em desc);

-- -----------------------------------------------------------------------------
-- os_apontamento — tempo gasto, por técnico e por natureza
--
-- Deslocamento separado de execução porque são custos diferentes e porque a
-- pergunta "quanto tempo a equipe passa na estrada" é uma das poucas que muda
-- decisão de alocação de filial.
-- -----------------------------------------------------------------------------
create table if not exists public.os_apontamento (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete restrict,
  ordem_servico_id uuid not null references public.ordem_servico(id) on delete cascade,
  tecnico_id       uuid not null references public.tecnico(id) on delete restrict,
  tipo             app.os_apontamento_tipo not null,
  inicio           timestamptz not null,
  fim              timestamptz,
  /* Gerado do intervalo quando há fim; nulo enquanto o apontamento está aberto.
     Minuto digitado à mão diverge do intervalo e ninguém sabe qual vale. */
  minutos          integer generated always as (
                     case when fim is null then null
                          else greatest(0, (extract(epoch from (fim - inicio)) / 60)::integer)
                     end
                   ) stored,
  custo_hora       numeric(15,4),
  descricao        text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  constraint os_apontamento_intervalo check (fim is null or fim >= inicio)
);

create index if not exists os_apontamento_os_ix
  on public.os_apontamento (tenant_id, ordem_servico_id, inicio);

-- -----------------------------------------------------------------------------
-- os_pausa — RN-011: o relógio do SLA para, e o motivo fica
--
-- Pausa sem motivo é a porta pela qual todo SLA passa a ser cumprido: basta
-- pausar o relógio quando ele aperta. Por isso o motivo é enum fechado e a
-- justificativa é obrigatória.
-- -----------------------------------------------------------------------------
create table if not exists public.os_pausa (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete restrict,
  ordem_servico_id uuid not null references public.ordem_servico(id) on delete cascade,
  motivo           app.os_pausa_motivo not null,
  justificativa    text not null,
  inicio           timestamptz not null default now(),
  fim              timestamptz,
  registrado_por   uuid references public.usuario(id) on delete restrict,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  constraint os_pausa_intervalo check (fim is null or fim >= inicio),
  constraint os_pausa_justificativa_legivel check (length(btrim(justificativa)) >= 10)
);

-- Uma pausa aberta por vez. Duas pausas simultâneas descontariam o mesmo
-- minuto duas vezes, e o SLA passaria a render tempo.
create unique index if not exists os_pausa_aberta_uk
  on public.os_pausa (ordem_servico_id)
  where fim is null;

create index if not exists os_pausa_os_ix on public.os_pausa (tenant_id, ordem_servico_id, inicio);

-- -----------------------------------------------------------------------------
-- A máquina de estados, imposta no banco
--
-- Anexo B.3. Mora aqui, e não no serviço, pela razão de sempre nesta base: a
-- API é um dos caminhos de escrita, não o único. Correção manual, importação e
-- qualquer job futuro escrevem na mesma tabela, e uma transição ilegal feita
-- por fora é indistinguível de uma legal depois de gravada.
--
-- O mapa é dado, não cadeia de `if`: acrescentar uma transição é acrescentar um
-- par, e ler o que é permitido é ler uma lista em vez de desembaraçar
-- condições aninhadas.
-- -----------------------------------------------------------------------------
create or replace function app.os_transicao_valida(p_de app.os_status, p_para app.os_status)
returns boolean
language sql
immutable
as $$
  select (p_de, p_para) in (
    ('ABERTA','TRIAGEM'),
    ('ABERTA','AGENDADA'),          -- triagem é opcional em chamado já classificado
    ('TRIAGEM','AGENDADA'),
    ('AGENDADA','EM_EXECUCAO'),
    ('EM_EXECUCAO','AGUARDANDO_PECA'),
    ('AGUARDANDO_PECA','EM_EXECUCAO'),
    ('EM_EXECUCAO','CONCLUIDA'),
    ('CONCLUIDA','VALIDADA'),
    -- Cancelamento só antes da execução (Anexo B.3, "* → CANCELADA").
    ('ABERTA','CANCELADA'),
    ('TRIAGEM','CANCELADA'),
    ('AGENDADA','CANCELADA')
  );
$$;

comment on function app.os_transicao_valida(app.os_status, app.os_status) is
  'Anexo B.3. Reabertura não é transição: VALIDADA → ABERTA cria uma OS nova, vinculada pela os_origem_id.';

create or replace function app.validar_os_transicao()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not app.os_transicao_valida(old.status, new.status) then
    raise exception 'transição de ordem de serviço inválida: % → %', old.status, new.status
      using errcode = '23514',
            hint = 'Ver Anexo B.3. Reabertura cria uma OS nova vinculada à original, não volta o status.';
  end if;

  /*
   * RN-027 — segregação de funções: quem valida não é quem executou.
   *
   * A regra não é burocracia. Validação é o ponto em que o custo da OS entra no
   * resultado e o ativo volta a ficar disponível; deixar o executor validar o
   * próprio trabalho transforma a conferência em formalidade, e é exatamente
   * onde um reparo mal feito volta como reincidência no mês seguinte.
   *
   * A comparação é por `usuario_id` do técnico: técnico sem login não valida
   * nada, e por isso não há como coincidir.
   */
  if new.status = 'VALIDADA' then
    if exists (
      select 1
        from public.tecnico t
       where t.id = new.tecnico_responsavel_id
         and t.usuario_id is not null
         and t.usuario_id = new.validado_por
    ) then
      raise exception 'RN-027: quem executou a ordem de serviço não pode validá-la'
        using errcode = '23514',
              hint = 'A validação precisa ser feita por outra pessoa.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists os_transicao on public.ordem_servico;
create trigger os_transicao
  before update of status on public.ordem_servico
  for each row execute function app.validar_os_transicao();

-- -----------------------------------------------------------------------------
-- Numeração
--
-- Sequência por locatário e por ano, derivada do que já existe na tabela. Não
-- usa `sequence` do PostgreSQL de propósito: sequência é global ao banco e
-- deixaria o número do locatário A pular quando o B abre uma OS — e número de
-- OS com buracos é a primeira coisa que um auditor pergunta.
--
-- A unicidade continua sendo do índice; esta função só propõe o próximo.
-- -----------------------------------------------------------------------------
create or replace function app.proximo_numero_os(p_tenant uuid)
returns text
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select to_char(now(), 'YYYY') || '-' ||
         lpad((coalesce(max(substring(o.numero from '\d+$')::integer), 0) + 1)::text, 5, '0')
    from public.ordem_servico o
   where o.tenant_id = p_tenant
     and o.numero like to_char(now(), 'YYYY') || '-%';
$$;

-- -----------------------------------------------------------------------------
-- Gatilhos padrão, auditoria e RLS
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tecnico','ordem_servico','os_apontamento','os_pausa'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    perform app.habilitar_auditoria(t);
    perform app.habilitar_rls_tenant(t, false);
  end loop;

  foreach t in array array['tecnico','ordem_servico'] loop
    execute format(
      'create trigger %I_touch before update on public.%I
         for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;
