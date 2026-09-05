-- =============================================================================
-- 0023 — Controle de despesas: categoria, orçamento e execução
--
-- Referências: docs/anexos/L-lacunas-funcionais.md §Módulo 14,
--              docs/anexos/V-controle-de-despesas.md
--
-- Camada analítica sobre o Módulo 10. **Não introduz uma segunda forma de
-- lançar despesa**: lê `titulo_pagar` e compara contra um orçamento. A única
-- tabela verdadeiramente nova é o orçamento; categorização é uma coluna que
-- deveria existir desde a 0019, e execução é função.
--
-- Decisões do operador incorporadas aqui:
--   · os títulos já lançados vão para uma categoria **"Não categorizado"**. O
--     painel fecha com o total de contas a pagar desde o primeiro dia, e a fila
--     de trabalho fica visível em vez de escondida atrás de um total que não
--     bate. É regra de negócio, não escolha de quem escreve o código;
--   · D-25 — "comprometido" é o gasto **e** o aprovado-não-pago. Um orçamento
--     que ignora compromisso já aprovado permitiria replanejar verba que já tem
--     destino, e o replanejamento pareceria válido até o vencimento chegar.
--
-- O que **não** entra, e está registrado no Anexo V: a alçada de aprovação de
-- replanejamento. Não existe `alcada.tipo` de orçamento, nem faixas, nem
-- definição de passo único ou fila — inventar os três seria fabricar autoridade.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- categoria_despesa
--
-- Dois níveis, não três. O centro de custo tem três porque é a dimensão
-- organizacional do locador; a categoria é a natureza do gasto, e o Anexo L a
-- especifica com subcategoria e ponto final. Um terceiro nível aqui produziria
-- "Software → Licenças → Anuais → Microsoft", que é catálogo de fornecedor, não
-- categoria de despesa.
--
-- `classificacao_sugerida` repete os três valores de `titulo_pagar.classificacao`
-- e não a substitui: é o que a tela pré-preenche quando alguém escolhe a
-- categoria. Quem lança pode discordar — uma licença comprada como investimento
-- de projeto existe —, e é por isso que a coluna do título continua sendo dele.
-- -----------------------------------------------------------------------------
create table if not exists public.categoria_despesa (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  nome          text not null,
  categoria_pai_id uuid references public.categoria_despesa(id) on delete restrict,
  classificacao_sugerida text,
  ativo         boolean not null default true,
  /*
   * Marca a categoria residual do locatário.
   *
   * Coluna, e não comparação por nome: o nome é editável, e um `where nome =
   * 'Não categorizado'` deixaria de encontrá-la no dia em que alguém a
   * renomeasse para "A classificar" — o gatilho de preenchimento pararia de
   * achar destino e todo título novo nasceria sem categoria, sem erro nenhum.
   */
  residual      boolean not null default false,
  version       integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  constraint categoria_despesa_nome_nao_vazio check (length(btrim(nome)) > 0),
  constraint categoria_despesa_classificacao_valida check (
    classificacao_sugerida is null or classificacao_sugerida in
      ('DESPESA_FIXA', 'DESPESA_VARIAVEL', 'INVESTIMENTO')
  ),
  constraint categoria_despesa_pai_nao_e_ela_mesma
    check (categoria_pai_id is null or categoria_pai_id <> id)
);

create unique index if not exists categoria_despesa_nome_uk
  on public.categoria_despesa (tenant_id, upper(btrim(nome))) where deleted_at is null;

create index if not exists categoria_despesa_pai_ix
  on public.categoria_despesa (tenant_id, categoria_pai_id) where deleted_at is null;

-- Uma residual por locatário, e ela é o destino do gatilho de preenchimento.
create unique index if not exists categoria_despesa_residual_uk
  on public.categoria_despesa (tenant_id) where residual and deleted_at is null;

comment on table public.categoria_despesa is
  'Natureza do gasto, hierárquica até 2 níveis. Dimensão distinta do centro de custo, que é organizacional.';
comment on column public.categoria_despesa.residual is
  'A categoria "Não categorizado" do locatário: destino do gatilho quando o título chega sem categoria.';

-- -----------------------------------------------------------------------------
-- Profundidade 2 e ciclo impossível — o mesmo desenho da RN-L42 (0017)
--
-- Em gatilho porque `CHECK` não alcança recursão: a profundidade de um nó
-- depende de outras linhas da mesma tabela. O ciclo não precisa de checagem
-- própria — é a condição de parada da mesma travessia.
-- -----------------------------------------------------------------------------
create or replace function app.validar_categoria_despesa()
returns trigger
language plpgsql
as $$
declare
  v_pai uuid := new.categoria_pai_id;
  v_nivel integer := 1;
  i integer := 0;
begin
  while v_pai is not null loop
    i := i + 1;
    if i > 64 then
      raise exception 'Cadeia de categorias sem fim: há um ciclo já gravado acima de %.', new.nome
        using errcode = 'check_violation', column = 'categoria_pai_id', table = 'categoria_despesa';
    end if;

    if v_pai = new.id then
      raise exception 'Categoria % não pode descender de si mesma.', new.nome
        using errcode = 'check_violation',
              column = 'categoria_pai_id',
              table = 'categoria_despesa',
              hint = 'Escolha uma categoria pai que não esteja abaixo desta.';
    end if;

    v_nivel := v_nivel + 1;
    if v_nivel > 2 then
      raise exception 'Categoria % ficaria no nível %: o máximo é 2.', new.nome, v_nivel
        using errcode = 'check_violation',
              column = 'categoria_pai_id',
              table = 'categoria_despesa',
              hint = 'Categoria e subcategoria bastam; abaixo disso vira catálogo de fornecedor.';
    end if;

    select categoria_pai_id into v_pai from public.categoria_despesa where id = v_pai;
  end loop;

  return new;
end;
$$;

drop trigger if exists categoria_despesa_valida on public.categoria_despesa;
create trigger categoria_despesa_valida
  before insert or update of categoria_pai_id on public.categoria_despesa
  for each row execute function app.validar_categoria_despesa();

-- -----------------------------------------------------------------------------
-- A categoria residual, provisionada por locatário
--
-- Mesmo molde de `app.provisionar_perfis_cliente` (0011): idempotente por
-- `not exists`, chamada pelo gatilho de criação de locatário e uma vez para os
-- que já existem.
-- -----------------------------------------------------------------------------
create or replace function app.provisionar_categoria_residual(p_tenant uuid)
returns void
language sql
as $$
  insert into public.categoria_despesa (tenant_id, nome, residual)
  select p_tenant, 'Não categorizado', true
   where not exists (
     select 1 from public.categoria_despesa c
      where c.tenant_id = p_tenant and c.residual and c.deleted_at is null
   );
$$;

/*
 * `ao_criar_tenant` ganha uma linha em vez de um segundo gatilho.
 *
 * Dois gatilhos `after insert` na mesma tabela disparam em ordem alfabética de
 * nome, o que é uma dependência que ninguém declara e ninguém lê. Uma função,
 * uma ordem explícita.
 */
create or replace function app.ao_criar_tenant()
returns trigger
language plpgsql
as $$
begin
  perform app.provisionar_perfis_cliente(new.id);
  perform app.provisionar_categoria_residual(new.id);
  return new;
end;
$$;

select app.provisionar_categoria_residual(id) from public.tenant;

-- -----------------------------------------------------------------------------
-- titulo_pagar.categoria_id — a coluna especificada no Módulo 10 e nunca criada
--
-- Sem ela, `Σ(titulo_pagar.valor_devido) WHERE categoria_id = X` — a fórmula
-- central do Módulo 14 — não tem sobre o que rodar. O Anexo S sequer registrava
-- a omissão.
-- -----------------------------------------------------------------------------
alter table public.titulo_pagar
  add column if not exists categoria_id uuid references public.categoria_despesa(id) on delete restrict;

create index if not exists titulo_pagar_categoria_ix
  on public.titulo_pagar (tenant_id, categoria_id, data_emissao) where deleted_at is null;

-- Backfill: a decisão do operador. Todo título já lançado aponta para a
-- residual do próprio locatário — o painel fecha com contas a pagar desde o
-- primeiro dia, e a fila de trabalho fica visível.
update public.titulo_pagar t
   set categoria_id = c.id
  from public.categoria_despesa c
 where c.tenant_id = t.tenant_id
   and c.residual
   and c.deleted_at is null
   and t.categoria_id is null;

/*
 * Título que chega sem categoria cai na residual.
 *
 * É o que mantém a promessa da decisão do operador **depois** do backfill: sem
 * este gatilho, o total do painel voltaria a divergir do de contas a pagar no
 * primeiro título lançado por uma rota que não conhece categoria — e a
 * divergência apareceria como um número, não como um erro.
 *
 * A alternativa seria `not null`, que obrigaria toda chamada a escolher uma
 * categoria. Isso é regra de negócio que ninguém escreveu, e transformaria o
 * lançamento de despesa numa decisão de classificação contábil no momento
 * errado.
 */
create or replace function app.preencher_categoria_despesa()
returns trigger
language plpgsql
as $$
begin
  if new.categoria_id is null then
    select c.id into new.categoria_id
      from public.categoria_despesa c
     where c.tenant_id = new.tenant_id and c.residual and c.deleted_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists titulo_pagar_categoria on public.titulo_pagar;
create trigger titulo_pagar_categoria
  before insert on public.titulo_pagar
  for each row execute function app.preencher_categoria_despesa();

comment on column public.titulo_pagar.categoria_id is
  'Natureza do gasto. Nulo no insert cai na categoria residual do locatário, por gatilho — o total do painel fecha com o de contas a pagar sempre.';

-- -----------------------------------------------------------------------------
-- orcamento
--
-- `mes` nulo é orçamento anual sem quebra mensal; `categoria_id` nulo é o
-- orçamento geral do centro. Nulo aqui é ausência deliberada de recorte, não
-- dado faltando — e por isso a unicidade precisa tratá-los como iguais.
-- -----------------------------------------------------------------------------
create table if not exists public.orcamento (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete restrict,
  ano             integer not null,
  mes             integer,
  categoria_id    uuid references public.categoria_despesa(id) on delete restrict,
  centro_custo_id uuid references public.centro_custo(id) on delete restrict,
  filial_id       uuid references public.filial(id) on delete restrict,
  valor_orcado    numeric(15,4) not null,
  version         integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint orcamento_valor_nao_negativo check (valor_orcado >= 0),
  constraint orcamento_mes_valido check (mes is null or (mes between 1 and 12)),
  constraint orcamento_ano_plausivel check (ano between 2000 and 2100)
);

/*
 * `NULLS NOT DISTINCT` é obrigatório, e a razão é contraintuitiva.
 *
 * No padrão do PostgreSQL um índice único trata NULLs como **distintos**: duas
 * linhas "geral" do mesmo centro no mesmo mês — as duas com `categoria_id` nulo
 * — não colidiriam. Nasceriam duplicadas, e a execução orçamentária passaria a
 * contar o mesmo orçamento duas vezes, com os dois números parecendo certos.
 */
create unique index if not exists orcamento_dimensao_uk
  on public.orcamento (tenant_id, ano, mes, categoria_id, centro_custo_id, filial_id)
  nulls not distinct;

create index if not exists orcamento_periodo_ix on public.orcamento (tenant_id, ano, mes);

comment on table public.orcamento is
  'Valor orçado por período e dimensão. A execução não é armazenada: é função sobre titulo_pagar.';
comment on column public.orcamento.mes is
  'Nulo = orçamento anual, sem quebra mensal. Ausência deliberada de recorte.';

-- -----------------------------------------------------------------------------
-- replanejamento_orcamento
--
-- `aprovado_por` é **nulável**, e o nulo significa algo: não há
-- `alcada.tipo` de orçamento definido — nem faixas, nem se a aprovação é passo
-- único ou fila —, então nenhum replanejamento passou por aprovação. Registrado
-- como pendência no Anexo V. Inventar a alçada aqui seria fabricar autoridade
-- que ninguém escreveu.
-- -----------------------------------------------------------------------------
create table if not exists public.replanejamento_orcamento (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenant(id) on delete restrict,
  orcamento_origem_id  uuid not null references public.orcamento(id) on delete restrict,
  orcamento_destino_id uuid not null references public.orcamento(id) on delete restrict,
  valor_transferido    numeric(15,4) not null,
  motivo               text not null,
  criado_por           uuid references public.usuario(id) on delete set null,
  aprovado_por         uuid references public.usuario(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint replanejamento_valor_positivo check (valor_transferido > 0),
  constraint replanejamento_motivo_nao_vazio check (length(btrim(motivo)) >= 3),
  constraint replanejamento_origem_diferente_destino
    check (orcamento_origem_id <> orcamento_destino_id)
);

create index if not exists replanejamento_origem_ix
  on public.replanejamento_orcamento (tenant_id, orcamento_origem_id, created_at desc);

-- =============================================================================
-- Execução orçamentária — derivada, nunca armazenada
--
-- É a mesma regra do saldo de conta (Módulo 9), do saldo de título (Módulo 10) e
-- da projeção de caixa (Módulo 13): número que pode ser derivado não deve ter
-- caminho de escrita próprio. Guardar "quanto já foi gasto" divergiria do que os
-- títulos somam no instante em que um for cancelado ou tiver o valor ajustado —
-- e a divergência não dá erro, só um percentual errado.
-- =============================================================================

/**
 * O que um título vale para uma dimensão de orçamento.
 *
 * `valor_devido` é a coluna gerada `coalesce(valor_ajustado, valor_original)`.
 * Somar `valor_ajustado` daria zero para todo título que nunca sofreu ajuste —
 * isto é, para a maioria.
 *
 * Quando a dimensão inclui centro de custo, o valor é rateado: um título de dez
 * mil com 60% no centro A vale seis mil para o orçamento do A. Sem o rateio, o
 * mesmo título contaria inteiro em cada centro e a soma dos centros excederia a
 * despesa real.
 */
create or replace function app.despesa_realizada(
  p_tenant     uuid,
  p_de         date,
  p_ate        date,
  p_categoria  uuid default null,
  p_centro     uuid default null,
  p_filial     uuid default null,
  p_status     text[] default null
)
returns numeric
language sql
stable
as $$
  /*
   * `round(..., 4)` na soma, e não no fim de cada consumidor.
   *
   * A divisão do percentual produz uma dízima — 33,3333…% de mil reais tem
   * precisão de vinte e tantas casas em `numeric` —, e o valor atravessaria a
   * fronteira HTTP como "9500.000000000000000000000000", que **não casa com o
   * formato de dinheiro do contrato** (até quatro casas). Arredondar aqui é
   * arredondar uma vez, no lugar onde a multiplicação acontece.
   */
  select round(coalesce(sum(
           t.valor_devido
           * case when p_centro is null then 1
                  else coalesce((select r.percentual / 100
                                   from public.titulo_pagar_rateio r
                                  where r.titulo_id = t.id and r.centro_custo_id = p_centro), 0)
             end
         ), 0), 4)
    from public.titulo_pagar t
   where t.tenant_id = p_tenant
     and t.deleted_at is null
     and t.data_emissao between p_de and p_ate
     and t.status = any (coalesce(p_status, array['PENDENTE','EM_APROVACAO','APROVADO','AGENDADO','PAGO_PARCIAL','PAGO','EM_DISPUTA']))
     and (p_categoria is null or t.categoria_id = p_categoria)
     and (p_filial is null or t.filial_id = p_filial)
     and (p_centro is null or exists (
           select 1 from public.titulo_pagar_rateio r
            where r.titulo_id = t.id and r.centro_custo_id = p_centro));
$$;

comment on function app.despesa_realizada(uuid, date, date, uuid, uuid, uuid, text[]) is
  'Σ valor_devido no período e na dimensão, rateado pelo centro quando houver. CANCELADO e REJEITADO ficam de fora por omissão da lista padrão.';

/**
 * D-25 — o que conta como comprometido.
 *
 * O gasto **e** o aprovado-não-pago. Um orçamento que ignora compromisso já
 * aprovado permitiria replanejar verba que já tem destino certo, e o
 * replanejamento pareceria válido até o vencimento do título original chegar.
 *
 * `PENDENTE` e `EM_APROVACAO` ficam de fora de propósito: ainda podem ser
 * rejeitados, e travar orçamento em cima de pedido não aprovado congelaria verba
 * por causa de um lançamento que ninguém aceitou.
 */
create or replace function app.orcamento_comprometido(p_orcamento_id uuid)
returns numeric
language plpgsql
stable
as $$
declare
  o public.orcamento%rowtype;
  v_de date;
  v_ate date;
begin
  select * into o from public.orcamento where id = p_orcamento_id;
  if not found then
    return 0;
  end if;

  if o.mes is null then
    v_de := make_date(o.ano, 1, 1);
    v_ate := make_date(o.ano, 12, 31);
  else
    v_de := make_date(o.ano, o.mes, 1);
    v_ate := (v_de + interval '1 month - 1 day')::date;
  end if;

  return app.despesa_realizada(
    o.tenant_id, v_de, v_ate, o.categoria_id, o.centro_custo_id, o.filial_id,
    array['APROVADO', 'AGENDADO', 'PAGO_PARCIAL', 'PAGO']
  );
end;
$$;

comment on function app.orcamento_comprometido(uuid) is
  'D-25: gasto e aprovado-não-pago. PENDENTE e EM_APROVACAO ficam de fora — ainda podem ser rejeitados.';

/**
 * Execução orçamentária de um período.
 *
 * Devolve uma linha por orçamento, com o realizado, o percentual e o limiar de
 * RN-F24 (75/90/100). O limiar é calculado aqui e não guardado: um título
 * cancelado depois de disparar o alerta de 90% precisa fazer o alerta
 * desaparecer, não persistir um estado que o dado atual já não sustenta.
 */
create or replace function app.execucao_orcamentaria(
  p_ano    integer,
  p_mes    integer default null,
  p_centro uuid default null,
  p_filial uuid default null
)
returns table (
  orcamento_id    uuid,
  ano             integer,
  mes             integer,
  categoria_id    uuid,
  categoria_nome  text,
  centro_custo_id uuid,
  filial_id       uuid,
  valor_orcado    numeric,
  realizado       numeric,
  comprometido    numeric,
  percentual      numeric,
  limiar          text
)
language sql
stable
as $$
  /*
   * O `lateral` existe para o realizado ser calculado **uma vez** por linha.
   *
   * A primeira versão repetia a chamada em cinco lugares — no valor, no
   * percentual e nos três degraus do limiar. Além do custo, era a porta para o
   * defeito silencioso: bastaria alguém editar quatro das cinco cópias e o
   * semáforo passaria a discordar do número ao lado dele.
   */
  select o.id, o.ano, o.mes, o.categoria_id, c.nome, o.centro_custo_id, o.filial_id,
         o.valor_orcado,
         p.realizado,
         app.orcamento_comprometido(o.id),
         case when o.valor_orcado = 0 then null
              else round(p.realizado / o.valor_orcado * 100, 2) end,
         case
           when o.valor_orcado = 0 then 'SEM_ORCAMENTO'
           when p.realizado / o.valor_orcado >= 1    then 'ESTOURADO'
           when p.realizado / o.valor_orcado >= 0.9  then 'CRITICO'
           when p.realizado / o.valor_orcado >= 0.75 then 'ATENCAO'
           else 'NORMAL'
         end
    from public.orcamento o
    left join public.categoria_despesa c on c.id = o.categoria_id
   cross join lateral (
     select app.despesa_realizada(
              o.tenant_id,
              case when o.mes is null then make_date(o.ano, 1, 1) else make_date(o.ano, o.mes, 1) end,
              case when o.mes is null then make_date(o.ano, 12, 31)
                   else (make_date(o.ano, o.mes, 1) + interval '1 month - 1 day')::date end,
              o.categoria_id, o.centro_custo_id, o.filial_id, null
            ) as realizado
   ) p
   where o.ano = p_ano
     and (p_mes is null or o.mes is null or o.mes = p_mes)
     and (p_centro is null or o.centro_custo_id = p_centro)
     and (p_filial is null or o.filial_id = p_filial)
   order by c.nome nulls first, o.mes nulls first;
$$;

comment on function app.execucao_orcamentaria(integer, integer, uuid, uuid) is
  'RN-F24. Percentual e limiar calculados na consulta: um título cancelado depois do alerta de 90% precisa fazer o alerta sumir, não persistir.';

-- -----------------------------------------------------------------------------
-- RN-F23 — replanejamento move valor, nunca cria nem destrói
--
-- As duas atualizações na mesma transação, e o limite sobre o saldo **não
-- comprometido** da origem. Em gatilho porque uma rota que esquecesse metade
-- disso criaria verba do nada, e o erro só apareceria no fechamento.
-- -----------------------------------------------------------------------------
create or replace function app.aplicar_replanejamento()
returns trigger
language plpgsql
as $$
declare
  v_origem public.orcamento%rowtype;
  v_destino public.orcamento%rowtype;
  v_disponivel numeric;
begin
  select * into v_origem from public.orcamento where id = new.orcamento_origem_id for update;
  if not found then
    raise exception 'Orçamento de origem inexistente.'
      using errcode = 'foreign_key_violation', column = 'orcamento_origem_id';
  end if;
  select * into v_destino from public.orcamento where id = new.orcamento_destino_id for update;
  if not found then
    raise exception 'Orçamento de destino inexistente.'
      using errcode = 'foreign_key_violation', column = 'orcamento_destino_id';
  end if;

  v_disponivel := v_origem.valor_orcado - app.orcamento_comprometido(v_origem.id);

  if new.valor_transferido > v_disponivel then
    raise exception 'Replanejamento de % excede o saldo não comprometido da origem, que é de %.',
      new.valor_transferido, v_disponivel
      using errcode = 'check_violation',
            column = 'valor_transferido',
            table = 'replanejamento_orcamento',
            hint = 'Comprometido é o gasto mais o aprovado e ainda não pago (D-25): essa verba já tem destino.';
  end if;

  update public.orcamento
     set valor_orcado = valor_orcado - new.valor_transferido, version = version + 1
   where id = v_origem.id;
  update public.orcamento
     set valor_orcado = valor_orcado + new.valor_transferido, version = version + 1
   where id = v_destino.id;

  return new;
end;
$$;

drop trigger if exists replanejamento_aplica on public.replanejamento_orcamento;
create trigger replanejamento_aplica
  before insert on public.replanejamento_orcamento
  for each row execute function app.aplicar_replanejamento();

/*
 * Replanejamento não se altera nem se apaga.
 *
 * Ele **já moveu** valor nos dois orçamentos. Apagar a linha não desfaz o
 * movimento — deixaria os dois orçamentos alterados e nenhum registro dizendo
 * por quê. O caminho de volta é outro replanejamento, na direção contrária, com
 * o próprio motivo.
 */
create or replace function app.replanejamento_imutavel()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Replanejamento não se altera nem se apaga: ele já moveu valor.'
    using errcode = 'check_violation', table = 'replanejamento_orcamento',
          hint = 'Para desfazer, registre um replanejamento na direção contrária, com o motivo.';
end;
$$;

drop trigger if exists replanejamento_sem_alteracao on public.replanejamento_orcamento;
create trigger replanejamento_sem_alteracao
  before update or delete on public.replanejamento_orcamento
  for each row execute function app.replanejamento_imutavel();

-- -----------------------------------------------------------------------------
-- Isolamento e auditoria
--
-- Nenhuma das três tabelas tem leitura de cliente: orçamento e categoria de
-- despesa são estrutura interna do locador, e o portal nunca as vê. Mesma razão
-- de centro de custo e conta bancária.
-- -----------------------------------------------------------------------------
select app.habilitar_rls_tenant('categoria_despesa');
select app.habilitar_rls_tenant('orcamento');
select app.habilitar_rls_tenant('replanejamento_orcamento');

select app.habilitar_auditoria('categoria_despesa');
select app.habilitar_auditoria('orcamento');
-- Replanejamento não entra na auditoria de alteração: ele **é** o registro
-- imutável, e o gatilho acima o impede de mudar. Auditar alteração de linha que
-- não pode ser alterada seria guardar uma tabela vazia — o mesmo argumento de
-- `movimentacao_bancaria` na 0017.

grant execute on function app.despesa_realizada(uuid, date, date, uuid, uuid, uuid, text[]) to iarx_app;
grant execute on function app.orcamento_comprometido(uuid) to iarx_app;
grant execute on function app.execucao_orcamentaria(integer, integer, uuid, uuid) to iarx_app;
grant execute on function app.provisionar_categoria_residual(uuid) to iarx_app;
