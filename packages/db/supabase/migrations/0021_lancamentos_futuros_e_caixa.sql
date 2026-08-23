-- =============================================================================
-- 0021 — Lançamentos futuros e fluxo de caixa projetado
--
-- Referências: docs/anexos/L-lacunas-funcionais.md (Módulos 12 e 13), D-23
-- Invariantes: RN-F15 (conversão ocorre uma vez, nunca duas)
--              RN-F16 (contrato fora de vigência não converte)
--              RN-F17 (editar ou cancelar só em PROGRAMADO)
--              RN-F18 (recorrência gera o próximo, nunca o lote)
--              RN-F19 (projeção nunca inclui CANCELADO nem BAIXADO)
--              RN-F20 (inadimplência do cenário só sobre recebíveis)
--              RN-F21 (alerta de saldo negativo no cenário realista)
--              RN-F22 (concentração de pagamentos num único dia)
--
-- Dois módulos numa migração porque a projeção é **uma função só**.
--
-- O Anexo L especifica `GET /lancamentos-futuros/projecao` no Módulo 12 e
-- `GET /fluxo-caixa/projecao` no 13, com o próprio texto admitindo "calculado
-- aqui e lá". É a mesma duplicação que D-20 removeu do título, um nível acima:
-- duas projeções dariam duas respostas para "quanto entra em sessenta dias", e a
-- divergência apareceria como um planejamento que não fecha com o painel.
--
-- Nenhum valor de negócio aqui. Periodicidade, dia de vencimento, percentual de
-- inadimplência e limiar de concentração são cadastro do locatário.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Recorrência — **uma** tabela, não duas
--
-- O Anexo especifica `recorrencia_pagar` e `recorrencia_receber`. Aqui é uma
-- `recorrencia` com discriminador `lado`, aplicando literalmente o raciocínio de
-- D-20: duas tabelas paralelas para o mesmo conceito dão duas respostas para "o
-- que está programado", e o que difere entre elas — fornecedor contra cliente —
-- se resolve com colunas nuláveis amarradas ao discriminador, que é exatamente o
-- que `lancamento_futuro` já faz.
--
-- A recorrência é o **molde**; o lançamento futuro é a **instância**. Os dois
-- existem: sem o molde não há como dizer "todo dia 5"; sem a instância não há o
-- que editar, cancelar ou projetar.
-- -----------------------------------------------------------------------------
create table if not exists public.recorrencia (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete restrict,
  lado            text not null,
  descricao       text not null,
  valor_base      numeric(15,4) not null,
  periodicidade   text not null,
  /*
   * Dia do vencimento, de 1 a 28.
   *
   * O teto é 28 porque 29, 30 e 31 não existem em todo mês, e "o que fazer em
   * fevereiro" é regra que ninguém especificou — inventá-la aqui seria decidir
   * no escuro se a cobrança antecipa, atrasa ou cai no último dia.
   */
  dia_vencimento  integer not null,
  proxima_geracao date not null,
  ativo           boolean not null default true,

  /** Presente quando lado = PAGAR. */
  empresa_id      uuid references public.empresa(id) on delete restrict,
  fornecedor_id   uuid references public.fornecedor(id) on delete restrict,
  classificacao   text,
  /** Presente quando lado = RECEBER. */
  cliente_id      uuid references public.cliente(id) on delete restrict,

  centro_custo_id uuid references public.centro_custo(id) on delete restrict,
  contrato_id     uuid references public.contrato(id) on delete restrict,
  /*
   * Filial, para o lançamento gerado nascer no mesmo recorte em que o título
   * vive. `titulo_pagar` e `titulo_receber` têm a coluna desde a 0019/0020, e a
   * projeção filtra por ela: sem a coluna aqui, uma projeção de uma filial
   * mostraria os títulos daquela filial e os compromissos previstos de **todas**.
   */
  filial_id       uuid references public.filial(id) on delete restrict,

  version    integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.usuario(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,

  constraint recorrencia_lado_valido check (lado in ('PAGAR', 'RECEBER')),
  constraint recorrencia_periodicidade_valida check (
    periodicidade in ('MENSAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL')
  ),
  constraint recorrencia_dia_faixa check (dia_vencimento between 1 and 28),
  constraint recorrencia_valor_positivo check (valor_base > 0),
  constraint recorrencia_descricao_nao_vazia check (length(btrim(descricao)) > 0),
  /*
   * O discriminador amarra as colunas dos dois lados.
   *
   * Sem estas duas, uma recorrência de pagamento com `cliente_id` preenchido
   * seria aceita — e na conversão o sistema teria de escolher entre dois
   * destinos possíveis, com a escolha dependendo da ordem do código.
   */
  constraint recorrencia_pagar_coerente check (
    lado <> 'PAGAR' or (empresa_id is not null and cliente_id is null and classificacao is not null)
  ),
  constraint recorrencia_receber_coerente check (
    lado <> 'RECEBER' or (cliente_id is not null and empresa_id is null and classificacao is null)
  ),
  constraint recorrencia_classificacao_valida check (
    classificacao is null
    or classificacao in ('DESPESA_FIXA', 'DESPESA_VARIAVEL', 'INVESTIMENTO')
  )
);

create index if not exists recorrencia_geracao_ix
  on public.recorrencia (tenant_id, proxima_geracao)
  where ativo and deleted_at is null;

comment on table public.recorrencia is
  'Molde do compromisso periódico. Uma tabela com discriminador `lado`, não duas — o mesmo raciocínio de D-20.';
comment on column public.recorrencia.dia_vencimento is
  'De 1 a 28: 29/30/31 não existem em todo mês, e o que fazer em fevereiro é regra não especificada.';

-- -----------------------------------------------------------------------------
-- Lançamento futuro — a camada de intenção
--
-- Existe separado de `titulo_pagar`/`titulo_receber` porque um compromisso
-- previsto pode ser editado ou cancelado livremente, e um título já criado
-- carrega rodada de aprovação e rateio. Criar o título antes da hora põe em
-- aprovação um compromisso que ainda não existe — e a aprovação teria de ser
-- refeita a cada ajuste de planejamento.
--
-- **Duas chaves estrangeiras reais, não um id polimórfico.**
--
-- O Anexo especifica `titulo_gerado_id` sem FK, com integridade por gatilho,
-- justificando que "outras bases poliformas do sistema já usam" esse mecanismo.
-- O precedente não existe: a única referência polimórfica do esquema é
-- `audit_log` (0003), que não tem FK **nem** gatilho, e por uma razão oposta —
-- é log, e precisa sobreviver à exclusão da linha referenciada.
--
-- Um gatilho confere a existência no momento da escrita e não impede que a linha
-- seja apagada depois; uma FK impede. E "exatamente uma preenchida" passa a ser
-- restrição declarada em vez de convenção que alguém precisa lembrar.
-- -----------------------------------------------------------------------------
create table if not exists public.lancamento_futuro (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete restrict,
  tipo            text not null,
  /** Derivado de `tipo`, para a conversão não precisar reinterpretá-lo. */
  lado            text not null,
  descricao       text not null,
  valor_previsto  numeric(15,4) not null,
  data_prevista   date not null,

  empresa_id      uuid references public.empresa(id) on delete restrict,
  fornecedor_id   uuid references public.fornecedor(id) on delete restrict,
  classificacao   text,
  cliente_id      uuid references public.cliente(id) on delete restrict,
  centro_custo_id uuid references public.centro_custo(id) on delete restrict,
  contrato_id     uuid references public.contrato(id) on delete restrict,
  filial_id       uuid references public.filial(id) on delete restrict,
  recorrencia_id  uuid references public.recorrencia(id) on delete set null,

  status          text not null default 'PROGRAMADO',

  titulo_pagar_id   uuid references public.titulo_pagar(id) on delete restrict,
  titulo_receber_id uuid references public.titulo_receber(id) on delete restrict,
  convertido_em   timestamptz,
  /** RN-F16: por que a conversão não ocorreu. Fila de exceção. */
  excecao_conversao text,
  /** Quantas vezes a conversão foi tentada e recusada. */
  tentativas_conversao integer not null default 0,

  version    integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.usuario(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,

  constraint lf_tipo_valido check (tipo in (
    'DESPESA_RECORRENTE', 'RECEITA_RECORRENTE',
    'DESPESA_PARCELADA', 'RECEITA_PARCELADA', 'PROVISAO'
  )),
  constraint lf_lado_valido check (lado in ('PAGAR', 'RECEBER')),
  /*
   * `lado` é consequência de `tipo`, não uma segunda escolha.
   *
   * Guardá-lo evita reinterpretar o tipo em cada consulta; este CHECK é o que
   * impede os dois de discordarem — uma provisão marcada como RECEBER geraria
   * cobrança onde deveria haver despesa.
   */
  constraint lf_lado_coerente check (
    lado = case when tipo in ('RECEITA_RECORRENTE', 'RECEITA_PARCELADA') then 'RECEBER' else 'PAGAR' end
  ),
  constraint lf_status_valido check (status in ('PROGRAMADO', 'CONVERTIDO', 'CANCELADO')),
  constraint lf_valor_positivo check (valor_previsto > 0),
  constraint lf_descricao_nao_vazia check (length(btrim(descricao)) > 0),
  constraint lf_pagar_coerente check (
    lado <> 'PAGAR' or (empresa_id is not null and cliente_id is null and classificacao is not null)
  ),
  constraint lf_receber_coerente check (
    lado <> 'RECEBER' or (cliente_id is not null and empresa_id is null and classificacao is null)
  ),
  constraint lf_classificacao_valida check (
    classificacao is null
    or classificacao in ('DESPESA_FIXA', 'DESPESA_VARIAVEL', 'INVESTIMENTO')
  ),

  /*
   * O par de títulos, nas duas direções.
   *
   * A primeira: convertido tem **exatamente um** título, do lado certo.
   * A segunda: não convertido não tem título nenhum — sem ela, um PROGRAMADO
   * poderia apontar para um título e a conversão pareceria feita sem ter sido,
   * que é o estado mais difícil de diagnosticar dos três.
   */
  constraint lf_convertido_tem_um_titulo check (
    status <> 'CONVERTIDO'
    or (titulo_pagar_id is null) <> (titulo_receber_id is null)
  ),
  constraint lf_nao_convertido_sem_titulo check (
    status = 'CONVERTIDO' or (titulo_pagar_id is null and titulo_receber_id is null)
  ),
  constraint lf_titulo_do_lado_certo check (
    (lado = 'PAGAR' and titulo_receber_id is null)
    or (lado = 'RECEBER' and titulo_pagar_id is null)
  ),
  constraint lf_convertido_tem_data check ((status = 'CONVERTIDO') = (convertido_em is not null))
);

/** A fila do job: elegíveis por data, ainda programados. */
create index if not exists lf_elegivel_ix
  on public.lancamento_futuro (tenant_id, data_prevista)
  where status = 'PROGRAMADO' and deleted_at is null;
/** A fila de exceção: tentou converter e não pôde. */
create index if not exists lf_excecao_ix
  on public.lancamento_futuro (tenant_id, data_prevista)
  where status = 'PROGRAMADO' and excecao_conversao is not null and deleted_at is null;
create index if not exists lf_recorrencia_ix
  on public.lancamento_futuro (tenant_id, recorrencia_id)
  where recorrencia_id is not null and deleted_at is null;

comment on constraint lf_nao_convertido_sem_titulo on public.lancamento_futuro is
  'Um PROGRAMADO apontando para título faria a conversão parecer feita sem ter sido — o estado mais difícil de diagnosticar.';

-- -----------------------------------------------------------------------------
-- Fecha o débito da migração 0020
--
-- `titulo_receber.recorrencia_id` existe sem chave estrangeira desde a 0020, com
-- o comentário "a restrição entra na migração do Módulo 12". É esta. E
-- `titulo_pagar` não tinha a coluna — ela entra aqui, já com a FK.
-- -----------------------------------------------------------------------------
alter table public.titulo_pagar
  add column if not exists recorrencia_id uuid references public.recorrencia(id) on delete set null;

alter table public.titulo_receber
  drop constraint if exists titulo_receber_recorrencia_id_fkey;
alter table public.titulo_receber
  add constraint titulo_receber_recorrencia_id_fkey
  foreign key (recorrencia_id) references public.recorrencia(id) on delete set null;

create index if not exists titulo_pagar_recorrencia_ix
  on public.titulo_pagar (tenant_id, recorrencia_id)
  where recorrencia_id is not null;
create index if not exists titulo_receber_recorrencia_ix
  on public.titulo_receber (tenant_id, recorrencia_id)
  where recorrencia_id is not null;

comment on column public.titulo_receber.recorrencia_id is
  'Molde que originou este título, quando veio de conversão de lançamento futuro. FK acrescentada na 0021.';

-- -----------------------------------------------------------------------------
-- RN-F17 · editar ou cancelar só em PROGRAMADO
--
-- Convertido é registro histórico: "isso foi previsto e virou aquilo". O que se
-- edita depois é o título gerado, que tem rodada de aprovação e rateio próprios.
-- Sem esta regra, editar o lançamento futuro daria a impressão de mudar a
-- despesa — e a despesa real, no título, continuaria a anterior.
-- -----------------------------------------------------------------------------
create or replace function app.proteger_lancamento_futuro()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'PROGRAMADO' then
    return new;
  end if;

  /*
   * A conversão em si passa: é ela que muda PROGRAMADO → CONVERTIDO. O que se
   * bloqueia é a alteração **depois**, e a lista de colunas é explícita para que
   * `updated_at` e a marca de exclusão lógica continuem funcionando.
   */
  if new.descricao      is distinct from old.descricao
     or new.valor_previsto is distinct from old.valor_previsto
     or new.data_prevista  is distinct from old.data_prevista
     or new.tipo           is distinct from old.tipo
     or new.centro_custo_id is distinct from old.centro_custo_id
     or new.contrato_id     is distinct from old.contrato_id
     or new.fornecedor_id   is distinct from old.fornecedor_id
     or new.cliente_id      is distinct from old.cliente_id then
    raise exception 'Lançamento futuro em % não se edita.', old.status
      using errcode = 'check_violation',
            table = 'lancamento_futuro',
            hint = 'Convertido é registro histórico: edite o título gerado, que é onde a despesa vive.';
  end if;

  if new.status = 'CANCELADO' and old.status = 'CONVERTIDO' then
    raise exception 'Lançamento já convertido não se cancela.'
      using errcode = 'check_violation',
            column = 'status',
            table = 'lancamento_futuro',
            hint = 'Cancele o título gerado — cancelar a previsão deixaria o título órfão da intenção.';
  end if;

  /*
   * O estado não volta atrás — e é aqui que RN-F15 seria burlada pela porta
   * dos fundos.
   *
   * Sem esta guarda, `set status = 'PROGRAMADO', titulo_pagar_id = null,
   * convertido_em = null` passa pelo bloco de colunas acima e pelos dois CHECK
   * do par: o lançamento volta à fila e o worker cria um **segundo** título
   * para o mesmo compromisso. O `for update` da conversão não protege contra
   * isso, porque as duas conversões não são concorrentes — são sequenciais, com
   * um destravamento no meio.
   *
   * Um CANCELADO ressuscitado tem o mesmo efeito: alguém decidiu que o
   * compromisso não existe, e ele voltaria a gerar título sem nova decisão.
   */
  if new.status is distinct from old.status then
    raise exception 'Lançamento em % não muda de estado.', old.status
      using errcode = 'check_violation',
            column = 'status',
            table = 'lancamento_futuro',
            hint = 'PROGRAMADO é o único estado de saída: convertido e cancelado são finais.';
  end if;

  if new.titulo_pagar_id   is distinct from old.titulo_pagar_id
     or new.titulo_receber_id is distinct from old.titulo_receber_id
     or new.convertido_em    is distinct from old.convertido_em then
    raise exception 'O vínculo com o título gerado não se altera.'
      using errcode = 'check_violation',
            table = 'lancamento_futuro',
            hint = 'Desapontar o título deixaria a conversão registrada sem o que ela gerou.';
  end if;

  return new;
end;
$$;

drop trigger if exists lf_protege on public.lancamento_futuro;
create trigger lf_protege
  before update on public.lancamento_futuro
  for each row execute function app.proteger_lancamento_futuro();

-- -----------------------------------------------------------------------------
-- RN-F18 · a recorrência avança pela periodicidade
--
-- Uma função pura, para o avanço ser o mesmo em toda chamada. Somar meses em vez
-- de dias é o que faz "todo dia 5" continuar caindo no dia 5.
-- -----------------------------------------------------------------------------
create or replace function app.avancar_periodicidade(p_data date, p_periodicidade text)
returns date
language sql
immutable
as $$
  select (p_data + case p_periodicidade
                     when 'MENSAL'     then interval '1 month'
                     when 'TRIMESTRAL' then interval '3 months'
                     when 'SEMESTRAL'  then interval '6 months'
                     when 'ANUAL'      then interval '1 year'
                   end)::date;
$$;

comment on function app.avancar_periodicidade(date, text) is
  'RN-F18. Soma meses, não dias: é o que faz "todo dia 5" continuar caindo no dia 5.';

/**
 * Gera **o próximo** lançamento futuro de uma recorrência. Nunca o lote.
 *
 * Gerar todos de uma vez criaria anos de lançamentos no primeiro clique — e cada
 * um deles apareceria na projeção de caixa como compromisso firme, quando o
 * contrato pode nem existir mais em dezembro do ano que vem.
 *
 * Idempotente pela chave única: chamar duas vezes para a mesma data não duplica.
 */
create or replace function app.gerar_proximo_lancamento(p_recorrencia_id uuid)
returns uuid
language plpgsql
as $$
declare
  r record;
  v_id uuid;
begin
  select * into r from public.recorrencia
   where id = p_recorrencia_id and deleted_at is null
     for update;

  if r is null then
    raise exception 'Recorrência não encontrada.' using errcode = 'no_data_found';
  end if;
  if not r.ativo then
    return null;
  end if;

  insert into public.lancamento_futuro (
    tenant_id, tipo, lado, descricao, valor_previsto, data_prevista,
    empresa_id, fornecedor_id, classificacao, cliente_id,
    centro_custo_id, contrato_id, filial_id, recorrencia_id, created_by, updated_by
  )
  values (
    r.tenant_id,
    case when r.lado = 'PAGAR' then 'DESPESA_RECORRENTE' else 'RECEITA_RECORRENTE' end,
    r.lado, r.descricao, r.valor_base, r.proxima_geracao,
    r.empresa_id, r.fornecedor_id, r.classificacao, r.cliente_id,
    r.centro_custo_id, r.contrato_id, r.filial_id, r.id, app.usuario_atual(), app.usuario_atual()
  )
  on conflict do nothing
  returning id into v_id;

  update public.recorrencia
     set proxima_geracao = app.avancar_periodicidade(proxima_geracao, periodicidade),
         updated_at = now(), updated_by = app.usuario_atual()
   where id = p_recorrencia_id;

  return v_id;
end;
$$;

/** Uma recorrência tem um lançamento por data prevista. É o que torna a geração idempotente. */
create unique index if not exists lf_recorrencia_data_uk
  on public.lancamento_futuro (recorrencia_id, data_prevista)
  where recorrencia_id is not null and deleted_at is null;

comment on function app.gerar_proximo_lancamento(uuid) is
  'RN-F18. Gera o próximo, avança a data, e não duplica: a chave (recorrência, data prevista) é quem garante.';

-- -----------------------------------------------------------------------------
-- RN-F15 e RN-F16 · a conversão
--
-- RN-F15 é a regra de concorrência do módulo, e a mais fácil de errar. Duas
-- execuções do job — dois processos, ou um processo com dois ticks sobrepostos —
-- lendo o mesmo lançamento elegível criariam **dois títulos** para o mesmo
-- compromisso, e o segundo pareceria tão legítimo quanto o primeiro.
--
-- A defesa é `select ... for update` sobre o lançamento **antes** de decidir, com
-- a mudança de status e a criação do título na mesma transação. O worker usa
-- `for update skip locked` na seleção do lote, como o de notificação (0018): o
-- segundo processo não espera, simplesmente não vê a linha.
--
-- RN-F16 não descarta o lançamento: ele fica PROGRAMADO com o motivo escrito em
-- `excecao_conversao`, e entra numa fila de exceção. Um lançamento que falhou em
-- silêncio não é revisto — o mesmo raciocínio de `excecao_geracao` na 0020.
--
-- **A emissão é `least(hoje, data_prevista)`, não `hoje`.** Os dois títulos
-- exigem `data_vencimento >= data_emissao`, e a fila de elegíveis é justamente
-- `data_prevista <= hoje`: com `hoje` fixo na emissão, todo lançamento atrasado
-- violaria o CHECK, e o worker morreria exatamente no caso que ele existe para
-- resolver — o dia em que ficou parado e acordou com pendência acumulada.
-- Antecipar o vencimento para hoje seria a alternativa errada: mudaria em
-- silêncio a data que alguém planejou.
-- -----------------------------------------------------------------------------
create or replace function app.converter_lancamento_futuro(p_id uuid)
returns table (titulo_id uuid, lado text, excecao text)
language plpgsql
as $$
declare
  lf record;
  v_contrato record;
  v_titulo uuid;
  v_niveis integer;
  v_excecao text;
begin
  -- O bloqueio é a regra. Sem ele, duas execuções concorrentes leem o mesmo
  -- PROGRAMADO e ambas criam título.
  select * into lf from public.lancamento_futuro
   where id = p_id and deleted_at is null
     for update;

  if lf is null then
    raise exception 'Lançamento futuro não encontrado.' using errcode = 'no_data_found';
  end if;

  if lf.status <> 'PROGRAMADO' then
    raise exception 'Lançamento em % não se converte.', lf.status
      using errcode = 'check_violation',
            column = 'status',
            table = 'lancamento_futuro',
            hint = 'A conversão ocorre uma vez só — o título já existe.';
  end if;

  -- RN-F16: a vigência é checada **agora**, não quando o lançamento foi criado.
  if lf.contrato_id is not null then
    select status::text as status, numero into v_contrato
      from public.contrato where id = lf.contrato_id;

    if v_contrato.status is distinct from 'ATIVO' then
      v_excecao := format('Contrato %s está em %s: a conversão não gera título de contrato inativo.',
                          v_contrato.numero, v_contrato.status);
      update public.lancamento_futuro
         set excecao_conversao = v_excecao,
             tentativas_conversao = tentativas_conversao + 1,
             updated_at = now()
       where id = p_id;
      return query select null::uuid, lf.lado, v_excecao;
      return;
    end if;
  end if;

  if lf.lado = 'PAGAR' then
    insert into public.titulo_pagar (
      tenant_id, empresa_id, filial_id, fornecedor_id, descricao, classificacao,
      valor_original, data_emissao, data_vencimento, status,
      recorrencia_id, created_by, updated_by
    )
    values (
      lf.tenant_id, lf.empresa_id, lf.filial_id, lf.fornecedor_id,
      lf.descricao, lf.classificacao,
      lf.valor_previsto, least(current_date, lf.data_prevista), lf.data_prevista, 'PENDENTE',
      lf.recorrencia_id, lf.created_by, lf.created_by
    )
    returning id into v_titulo;

    -- A rodada de aprovação abre como se o título tivesse sido lançado à mão: a
    -- conversão automática não é motivo para dispensar a alçada.
    v_niveis := app.niveis_aprovacao_pagar(lf.valor_previsto);
    if v_niveis > 0 then
      insert into public.titulo_pagar_aprovacao (tenant_id, titulo_id, nivel, rodada)
      select lf.tenant_id, v_titulo, n, 1 from generate_series(1, v_niveis) n;
      update public.titulo_pagar set status = 'EM_APROVACAO' where id = v_titulo;
    else
      update public.titulo_pagar set status = 'APROVADO' where id = v_titulo;
    end if;

    if lf.centro_custo_id is not null then
      insert into public.titulo_pagar_rateio (tenant_id, titulo_id, centro_custo_id, percentual)
      values (lf.tenant_id, v_titulo, lf.centro_custo_id, 100);
    end if;

    update public.lancamento_futuro
       set status = 'CONVERTIDO', titulo_pagar_id = v_titulo,
           convertido_em = now(), excecao_conversao = null,
           updated_at = now(), updated_by = app.usuario_atual()
     where id = p_id;
  else
    /*
     * O título nasce AVULSO, e o contrato sobrevive.
     *
     * CONTRATUAL exige competência (0020), e um lançamento futuro não tem uma:
     * ele não veio de medição. A restrição `titulo_receber_origem_coerente`
     * aceita AVULSO **com** contrato desde que sem competência, então o vínculo
     * com o contrato não se perde na conversão.
     */
    insert into public.titulo_receber (
      tenant_id, cliente_id, contrato_id, filial_id, origem, descricao,
      valor_original, data_emissao, data_vencimento, status,
      recorrencia_id, created_by, updated_by
    )
    values (
      lf.tenant_id, lf.cliente_id, lf.contrato_id, lf.filial_id, 'AVULSO', lf.descricao,
      lf.valor_previsto, least(current_date, lf.data_prevista), lf.data_prevista, 'PENDENTE_APROVACAO',
      lf.recorrencia_id, lf.created_by, lf.created_by
    )
    returning id into v_titulo;

    v_niveis := app.niveis_aprovacao_receber(lf.valor_previsto);
    if v_niveis > 0 then
      insert into public.titulo_receber_aprovacao (tenant_id, titulo_id, nivel, rodada)
      select lf.tenant_id, v_titulo, n, 1 from generate_series(1, v_niveis) n;
    else
      update public.titulo_receber set status = 'APROVADO' where id = v_titulo;
    end if;

    if lf.centro_custo_id is not null then
      insert into public.titulo_receber_rateio (tenant_id, titulo_id, centro_custo_id, percentual)
      values (lf.tenant_id, v_titulo, lf.centro_custo_id, 100);
    end if;

    update public.lancamento_futuro
       set status = 'CONVERTIDO', titulo_receber_id = v_titulo,
           convertido_em = now(), excecao_conversao = null,
           updated_at = now(), updated_by = app.usuario_atual()
     where id = p_id;
  end if;

  -- RN-F18: o próximo nasce ao converter o atual, nunca antes.
  if lf.recorrencia_id is not null then
    perform app.gerar_proximo_lancamento(lf.recorrencia_id);
  end if;

  return query select v_titulo, lf.lado, null::text;
end;
$$;

comment on function app.converter_lancamento_futuro(uuid) is
  'RN-F15/F16/F18. `for update` antes de decidir: duas execuções concorrentes criariam dois títulos para o mesmo compromisso.';

/**
 * Reserva um lote de lançamentos elegíveis, para o worker.
 *
 * `security definer` e sem filtro de locatário: o worker serve todos, e a
 * alternativa seria uma conexão sem RLS na aplicação — disponível para qualquer
 * erro futuro reaproveitar. Esta superfície é enumerável: uma função, revogada
 * de `public`, concedida a `iarx_app`.
 *
 * `skip locked` para que dois processos não disputem a mesma linha: o segundo
 * não espera, simplesmente não a vê.
 */
create or replace function app.lancamentos_elegiveis(p_limite integer default 50)
returns setof public.lancamento_futuro
language sql
security definer
set search_path = public, app, pg_temp
as $$
  select * from public.lancamento_futuro
   where status = 'PROGRAMADO'
     and deleted_at is null
     and data_prevista <= current_date
     /*
      * Recuo por tentativa: um lançamento cujo contrato está suspenso seria
      * retentado a cada tick para sempre, competindo com os novos pelo mesmo
      * worker. Vinte tentativas dão margem para o contrato ser reativado; depois
      * disso o lançamento fica na fila de exceção esperando alguém.
      */
     and tentativas_conversao < 20
   order by data_prevista, created_at
   limit greatest(p_limite, 0)
     for update skip locked;
$$;

revoke all on function app.lancamentos_elegiveis(integer) from public;

/** Recorrências que já deveriam ter gerado o próximo lançamento. */
create or replace function app.recorrencias_a_gerar(p_antecedencia_dias integer default 30)
returns setof public.recorrencia
language sql
security definer
set search_path = public, app, pg_temp
as $$
  select * from public.recorrencia
   where ativo
     and deleted_at is null
     and proxima_geracao <= current_date + make_interval(days => greatest(p_antecedencia_dias, 0))
   order by proxima_geracao
     for update skip locked;
$$;

revoke all on function app.recorrencias_a_gerar(integer) from public;

comment on function app.lancamentos_elegiveis(integer) is
  'Superfície fechada do worker de conversão. Atravessa locatários — a alternativa seria uma conexão sem RLS na aplicação.';

-- =============================================================================
-- Módulo 13 · fluxo de caixa projetado
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Cenário
--
-- A única tabela do Módulo 13. O percentual de inadimplência se aplica **só a
-- recebíveis** (RN-F20): a operação não fica mais otimista sobre a própria
-- dívida por causa de um cenário de estresse.
-- -----------------------------------------------------------------------------
create table if not exists public.parametro_cenario_caixa (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  nome          text not null,
  percentual_inadimplencia numeric(5,2) not null default 0,
  /** Limiar de concentração de saídas num único dia — RN-F22. */
  limiar_concentracao      numeric(5,2) not null default 40,
  padrao        boolean not null default false,
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.usuario(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint cenario_nome_nao_vazio check (length(btrim(nome)) > 0),
  constraint cenario_inadimplencia_faixa check (percentual_inadimplencia between 0 and 100),
  constraint cenario_concentracao_faixa check (limiar_concentracao > 0 and limiar_concentracao <= 100)
);

create unique index if not exists cenario_nome_uk
  on public.parametro_cenario_caixa (tenant_id, nome);

/*
 * Um único padrão por locatário.
 *
 * Dois padrões fariam "qual cenário o painel abre" depender da ordem da
 * consulta — e o painel abriria diferente para duas pessoas no mesmo dia, sem
 * que nada parecesse errado.
 */
create unique index if not exists cenario_padrao_uk
  on public.parametro_cenario_caixa (tenant_id)
  where padrao;

comment on index public.cenario_padrao_uk is
  'Um padrão por locatário: dois fariam o painel abrir diferente para duas pessoas, pela ordem da consulta.';

-- -----------------------------------------------------------------------------
-- A projeção — uma função, dois consumidores
--
-- Nenhuma posição diária é gravada. Gravá-la seria dado derivado armazenado, o
-- defeito que `valor_devido`, `app.saldo_conta` e `app.receita_realizada` já
-- existem para evitar em outros lugares do sistema — e aqui seria pior, porque a
-- posição de amanhã muda a cada baixa registrada hoje.
--
-- Quatro fontes: o saldo real das contas (0017), os títulos a pagar em aberto, os
-- a receber em aberto (líquidos do cenário), e os lançamentos futuros ainda
-- programados — a intenção que ainda não é título.
--
-- RN-F19 mora nas cláusulas de status: CANCELADO e BAIXADO nunca entram. BAIXADO
-- é o mais importante dos dois, porque é o que parece receita e não é.
-- -----------------------------------------------------------------------------
create or replace function app.fluxo_caixa_projetado(
  p_de              date,
  p_ate             date,
  p_cenario_id      uuid default null,
  p_conta_id        uuid default null,
  p_filial_id       uuid default null,
  p_centro_custo_id uuid default null
)
returns table (
  dia             date,
  entradas        numeric,
  saidas          numeric,
  saldo_dia       numeric,
  saldo_acumulado numeric
)
language sql
stable
as $$
  with cenario as (
    select coalesce(
             (select c.percentual_inadimplencia from public.parametro_cenario_caixa c
               where c.id = p_cenario_id),
             (select c.percentual_inadimplencia from public.parametro_cenario_caixa c
               where c.padrao and c.tenant_id = app.tenant_atual()),
             0
           ) as inadimplencia
  ),
  -- Saldo de partida: o real das contas, na véspera da janela.
  inicial as (
    select coalesce(sum(app.saldo_conta(cb.id, p_de - 1)), 0) as saldo
      from public.conta_bancaria cb
     where cb.deleted_at is null
       and cb.status <> 'INATIVA'
       and (p_conta_id is null or cb.id = p_conta_id)
  ),
  dias as (
    select d::date as dia from generate_series(p_de, p_ate, interval '1 day') d
  ),
  -- RN-F19: em aberto, e nunca CANCELADO nem BAIXADO.
  pagar as (
    select t.data_vencimento as dia, sum(app.saldo_titulo_pagar(t.id)) as valor
      from public.titulo_pagar t
     where t.deleted_at is null
       and t.status in ('PENDENTE', 'EM_APROVACAO', 'APROVADO', 'AGENDADO', 'PAGO_PARCIAL')
       and t.data_vencimento between p_de and p_ate
       and not exists (select 1 from public.titulo_pagar f where f.titulo_pai_id = t.id)
       and (p_filial_id is null or t.filial_id = p_filial_id)
       and (p_centro_custo_id is null or exists (
             select 1 from public.titulo_pagar_rateio r
              where r.titulo_id = t.id and r.centro_custo_id = p_centro_custo_id))
     group by t.data_vencimento
  ),
  receber as (
    select t.data_vencimento as dia, sum(app.saldo_titulo_receber(t.id)) as valor
      from public.titulo_receber t
     where t.deleted_at is null
       and t.status in ('PENDENTE_APROVACAO', 'PENDENTE', 'APROVADO', 'RECEBIDO_PARCIAL')
       and t.data_vencimento between p_de and p_ate
       and not exists (select 1 from public.titulo_receber f where f.titulo_pai_id = t.id)
       and (p_filial_id is null or t.filial_id = p_filial_id)
       and (p_centro_custo_id is null or exists (
             select 1 from public.titulo_receber_rateio r
              where r.titulo_id = t.id and r.centro_custo_id = p_centro_custo_id))
     group by t.data_vencimento
  ),
  -- A intenção que ainda não é título. Entra na projeção porque é o que
  -- distingue "o que vai acontecer" de "o que já está lançado".
  previsto as (
    select lf.data_prevista as dia, lf.lado,
           sum(lf.valor_previsto) as valor
      from public.lancamento_futuro lf
     where lf.deleted_at is null
       and lf.status = 'PROGRAMADO'
       and lf.data_prevista between p_de and p_ate
       and (p_filial_id is null or lf.filial_id = p_filial_id)
       and (p_centro_custo_id is null or lf.centro_custo_id = p_centro_custo_id)
     group by lf.data_prevista, lf.lado
  ),
  movimento as (
    select d.dia,
           /*
            * RN-F20: a inadimplência do cenário reduz **só** a entrada.
            * Aplicá-la à saída faria o cenário pessimista deixar a operação mais
            * otimista sobre a própria dívida, que é o inverso de um teste de
            * estresse.
            */
           round(
             (coalesce(r.valor, 0) + coalesce(pv_receber.valor, 0))
             * (1 - (select inadimplencia from cenario) / 100), 4
           ) as entradas,
           round(coalesce(p.valor, 0) + coalesce(pv_pagar.valor, 0), 4) as saidas
      from dias d
      left join pagar   p on p.dia = d.dia
      left join receber r on r.dia = d.dia
      left join previsto pv_pagar   on pv_pagar.dia = d.dia   and pv_pagar.lado = 'PAGAR'
      left join previsto pv_receber on pv_receber.dia = d.dia and pv_receber.lado = 'RECEBER'
  )
  select m.dia,
         m.entradas,
         m.saidas,
         round(m.entradas - m.saidas, 4) as saldo_dia,
         round(
           (select saldo from inicial)
           + sum(m.entradas - m.saidas) over (order by m.dia rows between unbounded preceding and current row),
           4
         ) as saldo_acumulado
    from movimento m
   order by m.dia;
$$;

comment on function app.fluxo_caixa_projetado(date, date, uuid, uuid, uuid, uuid) is
  'A projeção, uma vez só — consumida pelo Módulo 12 e pelo 13. Nenhuma posição diária gravada: ela muda a cada baixa.';

-- -----------------------------------------------------------------------------
-- Alertas — RN-F21 e RN-F22
--
-- Função, não tabela. Um alerta gravado fica desatualizado no instante seguinte a
-- uma baixa: o saldo negativo de terça deixa de existir quando o recebimento de
-- segunda entra, e nada avisaria a linha gravada.
--
-- **O cenário do alerta é o `padrao` do locatário, e não um cenário escolhido na
-- chamada.** RN-F21 fala em "cenário realista", mas o esquema não tem esse
-- conceito: tem cenários nomeados pelo locatário, um deles marcado como padrão.
-- Casar pelo nome exigiria adivinhar que "Realista" é o nome que o operador vai
-- usar — regra de negócio inventada. O padrão é a referência que o próprio
-- locatário declarou, e é o mesmo de onde `limiar_concentracao` já sai; usar
-- cenários diferentes para os dois alertas faria a mesma janela disparar por um
-- critério e não pelo outro.
--
-- Não é parâmetro de propósito: um alerta que muda de cenário conforme quem
-- abriu a tela soaria para uma pessoa e não para outra no mesmo dia.
-- -----------------------------------------------------------------------------
create or replace function app.alertas_caixa(p_de date, p_ate date)
returns table (tipo text, dia date, valor numeric, detalhe text)
language sql
stable
as $$
  with projecao as (
    -- `null` de cenário cai no `padrao` do locatário — a referência declarada.
    select * from app.fluxo_caixa_projetado(p_de, p_ate, null, null, null, null)
  ),
  total_saidas as (select coalesce(sum(saidas), 0) as t from projecao),
  limiar as (
    select coalesce(
             (select c.limiar_concentracao from public.parametro_cenario_caixa c
               where c.padrao and c.tenant_id = app.tenant_atual()),
             40
           ) as pct
  )
  select 'SALDO_NEGATIVO', p.dia, p.saldo_acumulado,
         format('Saldo acumulado projetado de %s em %s, no cenário padrão.',
                to_char(p.saldo_acumulado, 'FM999999990.00'), p.dia)
    from projecao p
   where p.saldo_acumulado < 0

  union all

  select 'CONCENTRACAO_SAIDA', p.dia, p.saidas,
         format('%s%% das saídas da janela concentradas em %s.',
                to_char(round(100 * p.saidas / nullif((select t from total_saidas), 0), 1), 'FM990.0'),
                p.dia)
    from projecao p
   where (select t from total_saidas) > 0
     and 100 * p.saidas / (select t from total_saidas) > (select pct from limiar)

   order by 2;
$$;

comment on function app.alertas_caixa(date, date) is
  'RN-F21/F22. Função e não tabela: um alerta gravado fica desatualizado na baixa seguinte. Sempre no cenário padrão do locatário, nunca num escolhido na chamada.';

-- =============================================================================
-- Isolamento e auditoria
--
-- Nenhuma política de cliente em nenhuma das três tabelas: planejamento de caixa
-- da locadora não é assunto do locatário do equipamento. Uma leitura de cliente
-- aqui exporia margem, concentração de vencimento e previsão de despesa.
-- =============================================================================
select app.habilitar_rls_tenant('recorrencia');
select app.habilitar_rls_tenant('lancamento_futuro');
select app.habilitar_rls_tenant('parametro_cenario_caixa');

select app.habilitar_auditoria('recorrencia');
select app.habilitar_auditoria('lancamento_futuro');

grant execute on function
  app.avancar_periodicidade(date, text),
  app.gerar_proximo_lancamento(uuid),
  app.converter_lancamento_futuro(uuid),
  app.lancamentos_elegiveis(integer),
  app.recorrencias_a_gerar(integer),
  app.fluxo_caixa_projetado(date, date, uuid, uuid, uuid, uuid),
  app.alertas_caixa(date, date)
  to iarx_app;
