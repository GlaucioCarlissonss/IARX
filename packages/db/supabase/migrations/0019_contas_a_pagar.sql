-- =============================================================================
-- 0019 — Contas a pagar: alçada, aprovação sequencial e baixa
--
-- Referências: docs/anexos/L-lacunas-funcionais.md (Módulo 10), decisão D-18
-- Invariantes: RN-F01 (a faixa de valor decide os níveis, resolvida por alçada)
--              RN-F02 (aprovação é sequencial, nunca paralela)
--              RN-F03 (rejeição exige justificativa)
--              RN-F04 (segregação: quem cria não aprova)
--              RN-F05 (delegação é por período e por nível)
--              RN-F06 (pagamento parcial recalcula saldo; excesso é recusado)
--              RN-F07 (estorno é lançamento contrário, nunca exclusão)
--              RN-F08 (título pai não recebe pagamento)
--              RN-F09 (rateio soma exatamente 100%, ou não existe)
--
-- Este é o módulo que finalmente dá o que aprovar à tabela `alcada`, que existe
-- desde a migração 0002 com `tipo = 'APROVACAO_PAGAMENTO'` e nunca teve
-- consumidor. D-18 resolvida como **configurável**: a tabela já é por
-- locatário, e não teria sido desenhada assim se a intenção fosse valor fixo
-- global. Nenhuma faixa em reais aparece neste arquivo — as faixas são dado que
-- o administrador cadastra.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Título a pagar
--
-- `valor_devido` é coluna gerada, e é ela que todo cálculo usa.
--
-- A alternativa seria `valor_ajustado not null default valor_original`, que o
-- PostgreSQL não aceita — um default não referencia outra coluna. As saídas
-- restantes eram um gatilho que copia o valor (e então duas colunas com o mesmo
-- número, que podem divergir) ou deixar cada consulta fazer o `coalesce` (e
-- então a primeira que esquecer cobra o valor errado). Gerada, o ajuste é nulo
-- quando não houve ajuste, e o devido é sempre um só.
-- -----------------------------------------------------------------------------
create table if not exists public.titulo_pagar (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete restrict,
  empresa_id        uuid not null references public.empresa(id) on delete restrict,
  filial_id         uuid references public.filial(id) on delete restrict,
  fornecedor_id     uuid references public.fornecedor(id) on delete restrict,
  descricao         text not null,
  classificacao     text not null,
  /** Referência livre ao contrato do fornecedor — ver lacuna no Anexo L. */
  contrato_fornecedor_ref text,
  valor_original    numeric(15,4) not null,
  /** Nulo = sem ajuste. Multa, juro ou desconto negociado entram aqui. */
  valor_ajustado    numeric(15,4),
  valor_devido      numeric(15,4)
                    generated always as (coalesce(valor_ajustado, valor_original)) stored,
  data_emissao      date not null,
  data_vencimento   date not null,
  status            text not null default 'PENDENTE',
  titulo_pai_id     uuid references public.titulo_pagar(id) on delete restrict,
  parcela_numero    integer,
  parcela_total     integer,
  version           integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.usuario(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  constraint titulo_pagar_classificacao_valida check (
    classificacao in ('DESPESA_FIXA', 'DESPESA_VARIAVEL', 'INVESTIMENTO')
  ),
  constraint titulo_pagar_status_valido check (
    status in ('PENDENTE', 'EM_APROVACAO', 'APROVADO', 'AGENDADO',
               'PAGO_PARCIAL', 'PAGO', 'CANCELADO', 'EM_DISPUTA', 'REJEITADO')
  ),
  constraint titulo_pagar_descricao_nao_vazia check (length(btrim(descricao)) > 0),
  constraint titulo_pagar_valor_positivo check (valor_original > 0),
  constraint titulo_pagar_ajuste_positivo check (valor_ajustado is null or valor_ajustado > 0),
  -- Vencimento anterior à emissão é quase sempre erro de digitação, e o custo
  -- de descobrir depois é um título que aparece atrasado desde o nascimento.
  constraint titulo_pagar_vencimento_apos_emissao check (data_vencimento >= data_emissao),
  /*
   * Número exige total, mas **não** o contrário.
   *
   * O pai de um parcelamento tem `parcela_total = 3` e nenhum
   * `parcela_numero`: ele não é uma parcela, é o agrupador. Exigir os dois
   * juntos — como a primeira versão desta migração fazia — torna impossível
   * marcar quantas parcelas o parcelamento tem sem inventar um número para o
   * pai. O caminho inverso não existe: uma parcela "2" sem saber de quantas não
   * diz nada a ninguém.
   */
  constraint titulo_pagar_numero_exige_total check (
    parcela_numero is null or parcela_total is not null
  ),
  constraint titulo_pagar_parcela_coerente check (
    parcela_numero is null or (parcela_numero >= 1 and parcela_numero <= parcela_total)
  ),
  -- Parcela filha tem de dizer qual é: uma filha sem número é indistinguível
  -- das irmãs em qualquer relatório.
  constraint titulo_pagar_filha_numerada check (
    titulo_pai_id is null or parcela_numero is not null
  ),
  constraint titulo_pagar_pai_nao_e_ele_mesmo check (titulo_pai_id is null or titulo_pai_id <> id)
);

create index if not exists titulo_pagar_fila_ix
  on public.titulo_pagar (tenant_id, status, data_vencimento)
  where deleted_at is null;
create index if not exists titulo_pagar_fornecedor_ix
  on public.titulo_pagar (tenant_id, fornecedor_id, data_vencimento desc)
  where deleted_at is null;
create index if not exists titulo_pagar_parcelas_ix
  on public.titulo_pagar (tenant_id, titulo_pai_id)
  where titulo_pai_id is not null and deleted_at is null;

comment on column public.titulo_pagar.valor_devido is
  'Coluna gerada: o ajuste quando existe, o original quando não. Todo cálculo usa esta — duas colunas com o mesmo número divergem.';
comment on column public.titulo_pagar.classificacao is
  'Despesa fixa, variável ou investimento. Decide o tratamento no Módulo 14 e nos indicadores de TI.';

-- -----------------------------------------------------------------------------
-- Rateio entre centros de custo (D-16: percentual)
-- -----------------------------------------------------------------------------
create table if not exists public.titulo_pagar_rateio (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete restrict,
  titulo_id       uuid not null references public.titulo_pagar(id) on delete cascade,
  centro_custo_id uuid not null references public.centro_custo(id) on delete restrict,
  percentual      numeric(7,4) not null,
  created_at timestamptz not null default now(),
  constraint rateio_percentual_faixa check (percentual > 0 and percentual <= 100)
);

create unique index if not exists rateio_titulo_centro_uk
  on public.titulo_pagar_rateio (titulo_id, centro_custo_id);
create index if not exists rateio_centro_ix
  on public.titulo_pagar_rateio (tenant_id, centro_custo_id);

-- -----------------------------------------------------------------------------
-- RN-F09 · o rateio soma exatamente 100%, ou não existe
--
-- Em gatilho de statement, e não de linha: a soma é uma propriedade do conjunto,
-- e um gatilho por linha reprovaria a primeira linha de um rateio de duas — que
-- é o caminho normal de inserir um.
--
-- A tolerância de meio centésimo existe porque 100/3 não fecha em decimal. Sem
-- ela, um rateio legítimo em três partes iguais seria recusado, e o operador
-- passaria a distribuir 33,34 / 33,33 / 33,33 à mão — o que funciona e é
-- exatamente o tipo de trabalho que o sistema devia absorver.
-- -----------------------------------------------------------------------------
create or replace function app.validar_soma_rateio_pagar()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select t.titulo_id, sum(t.percentual) as total
      from public.titulo_pagar_rateio t
     where t.titulo_id in (select titulo_id from novos)
     group by t.titulo_id
  loop
    if abs(r.total - 100) > 0.005 then
      raise exception 'O rateio do título % soma %%%, e tem de somar 100%%.', r.titulo_id, r.total
        using errcode = 'check_violation',
              column = 'percentual',
              table = 'titulo_pagar_rateio',
              hint = 'Ajuste os percentuais, ou remova o rateio — sem rateio, o título é 100% de um centro só.';
    end if;
  end loop;
  return null;
end;
$$;

comment on function app.validar_soma_rateio_pagar() is
  'RN-F09. Gatilho de statement: a soma é propriedade do conjunto, e um gatilho por linha reprovaria a primeira linha de um rateio de duas.';

drop trigger if exists rateio_pagar_soma_insert on public.titulo_pagar_rateio;
create trigger rateio_pagar_soma_insert
  after insert on public.titulo_pagar_rateio
  referencing new table as novos
  for each statement execute function app.validar_soma_rateio_pagar();

drop trigger if exists rateio_pagar_soma_update on public.titulo_pagar_rateio;
create trigger rateio_pagar_soma_update
  after update on public.titulo_pagar_rateio
  referencing new table as novos
  for each statement execute function app.validar_soma_rateio_pagar();

/*
 * A linha de rateio não muda de título.
 *
 * Sem esta regra, um `update` que movesse a linha do título A para o B deixaria
 * a soma de A sem conferência — o gatilho de statement só enxerga os títulos
 * das linhas novas. E não há uso legítimo: mover um rateio é removê-lo de um
 * título e criá-lo no outro, o que passa pelas duas conferências.
 */
create or replace function app.impedir_troca_titulo_rateio()
returns trigger
language plpgsql
as $$
begin
  if new.titulo_id <> old.titulo_id then
    raise exception 'A linha de rateio não muda de título.'
      using errcode = 'check_violation',
            column = 'titulo_id',
            table = 'titulo_pagar_rateio',
            hint = 'Remova a linha de um título e crie no outro — as duas somas são conferidas.';
  end if;
  return new;
end;
$$;

drop trigger if exists rateio_pagar_titulo_fixo on public.titulo_pagar_rateio;
create trigger rateio_pagar_titulo_fixo
  before update of titulo_id on public.titulo_pagar_rateio
  for each row execute function app.impedir_troca_titulo_rateio();

/*
 * Na remoção, o conjunto que sobra também tem de fechar — a menos que tenha
 * sobrado nada, que é o caso legítimo de "remover o rateio inteiro".
 */
create or replace function app.validar_remocao_rateio_pagar()
returns trigger
language plpgsql
as $$
declare
  r record;
  v_restante numeric;
begin
  for r in select distinct titulo_id from antigos loop
    select coalesce(sum(percentual), 0) into v_restante
      from public.titulo_pagar_rateio where titulo_id = r.titulo_id;

    if v_restante > 0 and abs(v_restante - 100) > 0.005 then
      raise exception 'Remover esta linha deixaria o rateio do título % somando %%%.', r.titulo_id, v_restante
        using errcode = 'check_violation',
              table = 'titulo_pagar_rateio',
              hint = 'Remova o rateio inteiro, ou redistribua o percentual entre os centros que ficam.';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists rateio_pagar_soma_delete on public.titulo_pagar_rateio;
create trigger rateio_pagar_soma_delete
  after delete on public.titulo_pagar_rateio
  referencing old table as antigos
  for each statement execute function app.validar_remocao_rateio_pagar();

-- -----------------------------------------------------------------------------
-- Aprovação
-- -----------------------------------------------------------------------------
create table if not exists public.titulo_pagar_aprovacao (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  titulo_id     uuid not null references public.titulo_pagar(id) on delete cascade,
  nivel         integer not null,
  /** Nulo até ser decidido — é o que define a fila. */
  aprovador_id  uuid references public.usuario(id) on delete set null,
  decisao       text,
  decidido_em   timestamptz,
  justificativa text,
  /** Preenchido quando quem decidiu agiu por delegação (RN-F05). */
  delegado_de   uuid references public.usuario(id) on delete set null,
  /** Rodada: reenviar depois de rejeição cria a rodada seguinte (RN-F03). */
  rodada        integer not null default 1,
  created_at    timestamptz not null default now(),
  constraint aprovacao_nivel_faixa check (nivel between 1 and 3),
  constraint aprovacao_decisao_valida check (decisao is null or decisao in ('APROVADO', 'REJEITADO')),
  constraint aprovacao_decidida_tem_data check ((decisao is null) = (decidido_em is null)),
  constraint aprovacao_decidida_tem_aprovador check ((decisao is null) = (aprovador_id is null)),
  -- RN-F03: recusa sem justificativa não é resposta — o solicitante não tem o
  -- que corrigir.
  constraint aprovacao_rejeicao_justificada check (
    decisao <> 'REJEITADO' or length(btrim(coalesce(justificativa, ''))) >= 10
  )
);

create unique index if not exists aprovacao_titulo_nivel_rodada_uk
  on public.titulo_pagar_aprovacao (titulo_id, rodada, nivel);
/** A fila de cada aprovador: o que ainda não foi decidido. */
create index if not exists aprovacao_pendente_ix
  on public.titulo_pagar_aprovacao (tenant_id, nivel)
  where decisao is null;

-- -----------------------------------------------------------------------------
-- Pagamento
-- -----------------------------------------------------------------------------
create table if not exists public.titulo_pagar_pagamento (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete restrict,
  titulo_id        uuid not null references public.titulo_pagar(id) on delete restrict,
  valor_pago       numeric(15,4) not null,
  data_pagamento   date not null,
  conta_id         uuid not null references public.conta_bancaria(id) on delete restrict,
  forma            text not null,
  movimentacao_id  uuid references public.movimentacao_bancaria(id) on delete restrict,
  estornado_em     timestamptz,
  estorno_motivo   text,
  created_at timestamptz not null default now(),
  created_by uuid references public.usuario(id) on delete set null,
  constraint pagamento_valor_positivo check (valor_pago > 0),
  constraint pagamento_forma_valida check (forma in ('TRANSFERENCIA', 'BOLETO', 'PIX', 'CHEQUE')),
  -- RN-F07: estorno exige motivo. Sem ele, ninguém sabe depois se o pagamento
  -- foi duplicado, cancelado pelo fornecedor ou lançado na conta errada.
  constraint pagamento_estorno_tem_motivo check (
    (estornado_em is null) = (estorno_motivo is null)
  )
);

create index if not exists pagamento_titulo_ix
  on public.titulo_pagar_pagamento (titulo_id, data_pagamento);

-- -----------------------------------------------------------------------------
-- Delegação de aprovação
-- -----------------------------------------------------------------------------
create table if not exists public.delegacao_aprovacao (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete restrict,
  delegante_id uuid not null references public.usuario(id) on delete restrict,
  delegado_id  uuid not null references public.usuario(id) on delete restrict,
  nivel        integer not null,
  inicio       date not null,
  fim          date not null,
  motivo       text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.usuario(id) on delete set null,
  constraint delegacao_nivel_faixa check (nivel between 1 and 3),
  constraint delegacao_periodo_valido check (fim >= inicio),
  constraint delegacao_motivo_nao_vazio check (length(btrim(motivo)) >= 3),
  -- Delegar para si mesmo é ruído: não muda nada e sugere que mudou.
  constraint delegacao_nao_para_si check (delegante_id <> delegado_id)
);

/*
 * RN-F05 · uma delegação por delegante, nível e período — sem sobreposição.
 *
 * `EXCLUDE USING gist` em vez de checagem na aplicação: duas delegações
 * sobrepostas do mesmo nível fariam a pergunta "quem aprova hoje?" ter duas
 * respostas, e a resolução dependeria da ordem da consulta. É o mesmo
 * raciocínio da RN-001 na alocação de equipamento.
 */
create extension if not exists btree_gist;

alter table public.delegacao_aprovacao drop constraint if exists delegacao_sem_sobreposicao;
alter table public.delegacao_aprovacao add constraint delegacao_sem_sobreposicao
  exclude using gist (
    tenant_id with =,
    delegante_id with =,
    nivel with =,
    daterange(inicio, fim, '[]') with &&
  );

comment on constraint delegacao_sem_sobreposicao on public.delegacao_aprovacao is
  'RN-F05. Duas delegações sobrepostas fariam "quem aprova hoje?" ter duas respostas, resolvidas pela ordem da consulta.';

-- -----------------------------------------------------------------------------
-- RN-F01 · a faixa de valor decide quantos níveis
--
-- A leitura de `alcada.limite_valor` é "o máximo que este perfil aprova
-- sozinho". Daí segue, sem inventar nada:
--
--   níveis exigidos = quantos limites configurados o valor **ultrapassa**
--
-- Com limites de 5 mil, 20 mil e 100 mil: 3 mil não ultrapassa nenhum e vai
-- direto (zero linhas de aprovação, que é literalmente "aprovação automática");
-- 10 mil ultrapassa um e exige um nível; 200 mil ultrapassa três e exige três.
--
-- Nenhum valor em reais aparece aqui. Os limites são dado do locatário, e um
-- locatário sem alçada configurada aprova tudo automaticamente — o que é
-- coerente: não configurar alçada é declarar que não há alçada.
-- -----------------------------------------------------------------------------
create or replace function app.niveis_aprovacao_pagar(p_valor numeric)
returns integer
language sql
stable
as $$
  select least(count(*), 3)::integer
    from (
      select distinct a.limite_valor
        from public.alcada a
       where a.tipo = 'APROVACAO_PAGAMENTO'
         and a.limite_valor is not null
         and a.tenant_id = app.tenant_atual()
    ) limites
   where limites.limite_valor < p_valor;
$$;

comment on function app.niveis_aprovacao_pagar(numeric) is
  'RN-F01. Níveis = quantos limites de alçada o valor ultrapassa, no máximo 3. Sem alçada configurada, zero níveis — não configurar alçada é declarar que não há alçada.';

/**
 * Quem pode decidir um nível.
 *
 * O aprovador do nível N tem de ter alçada de posto N ou superior — a posição
 * do seu `limite_valor` na ordem crescente dos limites do locatário. Um diretor
 * (posto 3) pode aprovar o nível 1; um gestor (posto 1) não pode aprovar o
 * nível 3.
 *
 * A direção importa: se a regra fosse "posto exatamente N", uma empresa com o
 * gestor de férias travaria o nível 1 mesmo com o diretor disponível — e a
 * saída seria alguém emprestar credencial, que é o pior desfecho possível.
 */
create or replace function app.posto_alcada_pagar(p_usuario_id uuid)
returns integer
language sql
stable
as $$
  with limites as (
    select distinct a.limite_valor,
           dense_rank() over (order by a.limite_valor) as posto
      from public.alcada a
     where a.tipo = 'APROVACAO_PAGAMENTO'
       and a.limite_valor is not null
       and a.tenant_id = app.tenant_atual()
  )
  select coalesce(max(l.posto), 0)::integer
    from public.usuario_perfil up
    join public.alcada a
      on a.perfil_id = up.perfil_id
     and a.tipo = 'APROVACAO_PAGAMENTO'
    join limites l on l.limite_valor = a.limite_valor
   where up.usuario_id = p_usuario_id;
$$;

/**
 * RN-F05 · quem responde por um nível hoje.
 *
 * Devolve verdadeiro se o usuário pode decidir o nível — por posto próprio, ou
 * porque alguém com o posto delegou para ele **e a data de hoje está dentro do
 * período**. Fora do período, a aprovação volta ao titular sem que ninguém
 * precise lembrar de revogar: a data faz o trabalho.
 */
create or replace function app.pode_decidir_nivel_pagar(p_usuario_id uuid, p_nivel integer)
returns boolean
language sql
stable
as $$
  select app.posto_alcada_pagar(p_usuario_id) >= p_nivel
      or exists (
        select 1
          from public.delegacao_aprovacao d
         where d.delegado_id = p_usuario_id
           and d.nivel >= p_nivel
           and current_date between d.inicio and d.fim
           and app.posto_alcada_pagar(d.delegante_id) >= p_nivel
      );
$$;

comment on function app.pode_decidir_nivel_pagar(uuid, integer) is
  'RN-F05. Posto próprio ou delegação vigente. Fora do período a aprovação volta ao titular: a data faz o trabalho, ninguém precisa lembrar de revogar.';

-- -----------------------------------------------------------------------------
-- RN-F02 e RN-F04 · sequencial, e quem cria não aprova
--
-- As duas moram no mesmo gatilho porque as duas são condições da mesma
-- escrita: registrar uma decisão.
--
-- RN-F04 é a que mais importa. Sem ela, o operador que lança a despesa aprova a
-- própria despesa, e o fluxo de aprovação inteiro é teatro — existe na tela,
-- não no efeito. É a mesma classe de restrição do RN-027 na nota fiscal, e este
-- módulo é quem finalmente a impõe em código.
-- -----------------------------------------------------------------------------
create or replace function app.validar_decisao_aprovacao_pagar()
returns trigger
language plpgsql
as $$
declare
  v_criador uuid;
  v_pendente_anterior integer;
begin
  if new.decisao is null then
    return new;
  end if;
  -- Decisão já registrada não se reescreve: o histórico de aprovação é a prova
  -- de quem autorizou o quê.
  if old.decisao is not null then
    raise exception 'A decisão do nível % já foi registrada e não se altera.', old.nivel
      using errcode = 'check_violation',
            column = 'decisao',
            table = 'titulo_pagar_aprovacao',
            hint = 'Reenvie o título para uma nova rodada de aprovação.';
  end if;

  select created_by into v_criador from public.titulo_pagar where id = new.titulo_id;

  if v_criador is not null and new.aprovador_id = v_criador then
    raise exception 'Quem lançou o título não aprova o próprio título.'
      using errcode = 'check_violation',
            column = 'aprovador_id',
            table = 'titulo_pagar_aprovacao',
            hint = 'A aprovação tem de vir de outra pessoa — é o que faz o fluxo valer.';
  end if;

  -- Delegação não contorna a segregação: quem delegou pode ser o criador.
  if v_criador is not null and new.delegado_de = v_criador then
    raise exception 'A delegação não pode devolver a aprovação a quem lançou o título.'
      using errcode = 'check_violation', column = 'delegado_de', table = 'titulo_pagar_aprovacao';
  end if;

  if not app.pode_decidir_nivel_pagar(new.aprovador_id, new.nivel) then
    raise exception 'O usuário não tem alçada para decidir o nível %.', new.nivel
      using errcode = 'check_violation',
            column = 'aprovador_id',
            table = 'titulo_pagar_aprovacao',
            hint = 'Configure a alçada do perfil, ou registre uma delegação vigente.';
  end if;

  -- RN-F02: sequencial. O nível 2 não existe para o aprovador antes de o
  -- nível 1 decidir — aprovar em paralelo permitiria o nível 3 autorizar algo
  -- que o nível 1 vai rejeitar.
  select count(*) into v_pendente_anterior
    from public.titulo_pagar_aprovacao a
   where a.titulo_id = new.titulo_id
     and a.rodada = new.rodada
     and a.nivel < new.nivel
     and a.decisao is distinct from 'APROVADO';

  if v_pendente_anterior > 0 then
    raise exception 'O nível % ainda espera a decisão de % nível(is) anterior(es).',
      new.nivel, v_pendente_anterior
      using errcode = 'check_violation',
            column = 'nivel',
            table = 'titulo_pagar_aprovacao',
            hint = 'A aprovação é sequencial: o nível anterior decide primeiro.';
  end if;

  return new;
end;
$$;

drop trigger if exists aprovacao_pagar_valida on public.titulo_pagar_aprovacao;
create trigger aprovacao_pagar_valida
  before update on public.titulo_pagar_aprovacao
  for each row execute function app.validar_decisao_aprovacao_pagar();

-- -----------------------------------------------------------------------------
-- RN-F06 · saldo em aberto, e o excesso recusado
--
-- O saldo é derivado dos pagamentos não estornados, pelo mesmo raciocínio do
-- saldo de conta bancária: não existe coluna de "valor já pago", então não
-- existe valor já pago divergente.
-- -----------------------------------------------------------------------------
create or replace function app.saldo_titulo_pagar(p_titulo_id uuid)
returns numeric
language sql
stable
as $$
  select t.valor_devido - coalesce((
    select sum(p.valor_pago)
      from public.titulo_pagar_pagamento p
     where p.titulo_id = t.id and p.estornado_em is null
  ), 0)
  from public.titulo_pagar t
  where t.id = p_titulo_id;
$$;

comment on function app.saldo_titulo_pagar(uuid) is
  'RN-F06. Derivado dos pagamentos não estornados. Sem coluna de "já pago", não há valor pago divergente.';

/**
 * Recusa o excesso e o pagamento no estado errado, e recalcula o status.
 *
 * O excesso não vira crédito solto de propósito: um crédito que ninguém pediu
 * aparece depois como saldo a favor sem origem, e a conciliação passa a ter uma
 * linha que não corresponde a nada.
 */
create or replace function app.validar_pagamento_pagar()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_pai uuid;
  v_saldo numeric;
begin
  select status, titulo_pai_id into v_status, v_pai
    from public.titulo_pagar where id = new.titulo_id;

  -- RN-F08: o pai existe para o relatório e para o cancelamento em lote. Pagar
  -- nele deixaria o total do parcelamento contado duas vezes.
  if exists (select 1 from public.titulo_pagar f where f.titulo_pai_id = new.titulo_id) then
    raise exception 'Título parcelado não recebe pagamento: pague as parcelas.'
      using errcode = 'check_violation', column = 'titulo_id', table = 'titulo_pagar_pagamento';
  end if;

  if v_status not in ('APROVADO', 'AGENDADO', 'PAGO_PARCIAL') then
    raise exception 'Título em % não recebe pagamento.', v_status
      using errcode = 'check_violation',
            column = 'titulo_id',
            table = 'titulo_pagar_pagamento',
            hint = 'Só título aprovado, agendado ou parcialmente pago aceita baixa.';
  end if;

  v_saldo := app.saldo_titulo_pagar(new.titulo_id);
  if new.valor_pago > v_saldo + 0.005 then
    raise exception 'O pagamento de % excede o saldo em aberto de %.', new.valor_pago, v_saldo
      using errcode = 'check_violation',
            column = 'valor_pago',
            table = 'titulo_pagar_pagamento',
            hint = 'Pagamento excedente não vira crédito: ajuste o valor devido do título, se for o caso.';
  end if;

  return new;
end;
$$;

drop trigger if exists pagamento_pagar_valida on public.titulo_pagar_pagamento;
create trigger pagamento_pagar_valida
  before insert on public.titulo_pagar_pagamento
  for each row execute function app.validar_pagamento_pagar();

/**
 * Status recalculado do saldo, nunca digitado.
 *
 * Roda depois de inserir e depois de estornar, porque as duas coisas mudam o
 * saldo. Um estorno que não devolvesse o título a PAGO_PARCIAL deixaria um
 * título "pago" com dinheiro em aberto — e ele desapareceria de toda fila de
 * pagamento.
 */
create or replace function app.recalcular_status_titulo_pagar()
returns trigger
language plpgsql
as $$
declare
  v_id uuid := coalesce(new.titulo_id, old.titulo_id);
  v_saldo numeric;
  v_pagou boolean;
begin
  v_saldo := app.saldo_titulo_pagar(v_id);
  select exists (
    select 1 from public.titulo_pagar_pagamento p
     where p.titulo_id = v_id and p.estornado_em is null
  ) into v_pagou;

  update public.titulo_pagar
     set status = case
                    when v_saldo <= 0.005 then 'PAGO'
                    when v_pagou then 'PAGO_PARCIAL'
                    else 'APROVADO'
                  end,
         updated_at = now()
   where id = v_id
     and status in ('APROVADO', 'AGENDADO', 'PAGO_PARCIAL', 'PAGO');

  return null;
end;
$$;

drop trigger if exists pagamento_pagar_recalcula on public.titulo_pagar_pagamento;
create trigger pagamento_pagar_recalcula
  after insert or update of estornado_em on public.titulo_pagar_pagamento
  for each row execute function app.recalcular_status_titulo_pagar();

-- -----------------------------------------------------------------------------
-- RN-F07 · o pagamento não se apaga
-- -----------------------------------------------------------------------------
create or replace function app.impedir_exclusao_pagamento_pagar()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Pagamento não se apaga. Estorne, com motivo.'
    using errcode = 'check_violation',
          table = 'titulo_pagar_pagamento',
          hint = 'Preencha estornado_em e estorno_motivo — o original fica no histórico.';
end;
$$;

drop trigger if exists pagamento_pagar_sem_exclusao on public.titulo_pagar_pagamento;
create trigger pagamento_pagar_sem_exclusao
  before delete on public.titulo_pagar_pagamento
  for each row execute function app.impedir_exclusao_pagamento_pagar();

-- -----------------------------------------------------------------------------
-- A movimentação bancária ganha o vínculo com o título
--
-- A migração 0017 deixou estas colunas de fora de propósito: as tabelas não
-- existiam, e uma coluna de id sem referência é um id que nada garante. Agora
-- existe a de pagar; a de receber entra com o Módulo 11.
-- -----------------------------------------------------------------------------
alter table public.movimentacao_bancaria
  add column if not exists titulo_pagar_id uuid references public.titulo_pagar(id) on delete restrict;

create index if not exists movimentacao_titulo_pagar_ix
  on public.movimentacao_bancaria (tenant_id, titulo_pagar_id)
  where titulo_pagar_id is not null;

-- -----------------------------------------------------------------------------
-- Baixa: pagamento e movimentação bancária na mesma chamada
--
-- Mesma razão da transferência entre contas (RN-L45): duas escritas numa camada
-- de aplicação são duas escritas que alguém pode separar. Um pagamento sem
-- movimentação é um título quitado que não saiu de conta nenhuma — e o extrato
-- e o contas a pagar passam a discordar sem que nenhuma linha pareça errada.
-- -----------------------------------------------------------------------------
create or replace function app.baixar_titulo_pagar(
  p_titulo_id uuid,
  p_valor     numeric,
  p_data      date,
  p_conta_id  uuid,
  p_forma     text
)
returns table (pagamento_id uuid, movimentacao_id uuid)
language plpgsql
as $$
declare
  v_tenant uuid := app.exigir_tenant();
  v_pag uuid;
  v_mov uuid;
  v_descricao text;
begin
  select 'Pagamento: ' || descricao into v_descricao
    from public.titulo_pagar where id = p_titulo_id;
  if v_descricao is null then
    raise exception 'Título a pagar não encontrado.'
      using errcode = 'no_data_found', column = 'titulo_id';
  end if;

  /*
   * O pagamento entra primeiro: é ele que carrega as checagens de RN-F06 e
   * RN-F08. Criar a movimentação antes deixaria dinheiro saindo da conta numa
   * transação que vai ser desfeita — inofensivo pelo rollback, mas o gatilho de
   * conta bloqueada dispararia antes da recusa que realmente importa, e a
   * mensagem de erro apontaria para o lugar errado.
   */
  insert into public.titulo_pagar_pagamento
    (tenant_id, titulo_id, valor_pago, data_pagamento, conta_id, forma, created_by)
  values (v_tenant, p_titulo_id, p_valor, p_data, p_conta_id, p_forma, app.usuario_atual())
  returning id into v_pag;

  insert into public.movimentacao_bancaria
    (tenant_id, conta_id, tipo, valor, data_movimento, descricao, titulo_pagar_id, created_by)
  values (v_tenant, p_conta_id, 'SAIDA', p_valor, p_data, v_descricao, p_titulo_id, app.usuario_atual())
  returning id into v_mov;

  update public.titulo_pagar_pagamento set movimentacao_id = v_mov where id = v_pag;

  return query select v_pag, v_mov;
end;
$$;

comment on function app.baixar_titulo_pagar(uuid, numeric, date, uuid, text) is
  'Pagamento e movimentação na mesma chamada. Separadas, um pagamento sem movimentação é um título quitado que não saiu de conta nenhuma.';

/**
 * Estorno da baixa: contrário na conta, marca no pagamento, uma chamada.
 */
create or replace function app.estornar_baixa_titulo_pagar(p_pagamento_id uuid, p_motivo text)
returns uuid
language plpgsql
as $$
declare
  v_tenant uuid := app.exigir_tenant();
  v_pag record;
  v_estorno uuid;
begin
  select * into v_pag from public.titulo_pagar_pagamento where id = p_pagamento_id;
  if v_pag is null then
    raise exception 'Pagamento não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_pag.estornado_em is not null then
    raise exception 'Este pagamento já foi estornado.'
      using errcode = 'check_violation',
            hint = 'Estornar duas vezes devolveria o valor duas vezes ao saldo do título.';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo do estorno.'
      using errcode = 'check_violation', column = 'estorno_motivo';
  end if;

  insert into public.movimentacao_bancaria
    (tenant_id, conta_id, tipo, valor, data_movimento, descricao,
     titulo_pagar_id, estorna_id, motivo, created_by)
  values (v_tenant, v_pag.conta_id, 'ENTRADA', v_pag.valor_pago, current_date,
          'Estorno de pagamento', v_pag.titulo_id, v_pag.movimentacao_id,
          btrim(p_motivo), app.usuario_atual())
  returning id into v_estorno;

  update public.titulo_pagar_pagamento
     set estornado_em = now(), estorno_motivo = btrim(p_motivo)
   where id = p_pagamento_id;

  return v_estorno;
end;
$$;

-- -----------------------------------------------------------------------------
-- Isolamento e auditoria
--
-- Nenhuma leitura de cliente: despesa da locadora não é assunto do locatário do
-- equipamento. Um `p_leitura_cliente = true` aqui exporia fornecedor, valor e
-- justificativa de aprovação ao portal.
-- -----------------------------------------------------------------------------
select app.habilitar_rls_tenant('titulo_pagar');
select app.habilitar_rls_tenant('titulo_pagar_rateio');
select app.habilitar_rls_tenant('titulo_pagar_aprovacao');
select app.habilitar_rls_tenant('titulo_pagar_pagamento');
select app.habilitar_rls_tenant('delegacao_aprovacao');

select app.habilitar_auditoria('titulo_pagar');
select app.habilitar_auditoria('titulo_pagar_aprovacao');
select app.habilitar_auditoria('delegacao_aprovacao');

grant execute on function
  app.niveis_aprovacao_pagar(numeric),
  app.posto_alcada_pagar(uuid),
  app.pode_decidir_nivel_pagar(uuid, integer),
  app.saldo_titulo_pagar(uuid),
  app.baixar_titulo_pagar(uuid, numeric, date, uuid, text),
  app.estornar_baixa_titulo_pagar(uuid, text)
  to iarx_app;
