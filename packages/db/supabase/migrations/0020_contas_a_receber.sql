-- =============================================================================
-- 0020 — Contas a receber: a fatura que passa a existir
--
-- Referências: docs/anexos/L-lacunas-funcionais.md (Módulo 11), decisões D-20 e D-22
-- Invariantes: RN-F10 (título contratual nasce pendente de aprovação)
--              RN-F11 (vigência do contrato é checada na geração, não depois)
--              RN-F12 (desconto acima da alçada é barrado, mesmo em título aprovado)
--              RN-F13 (recebimento parcial recalcula saldo; excesso é recusado)
--              RN-F14 (BAIXADO não é RECEBIDO — um encerra, o outro entra em caixa)
--
-- D-20, e é a decisão mais importante deste bloco: **uma tabela só**.
--
-- Até aqui o sistema sabia quanto cobrar e não tinha onde registrar que cobrou.
-- O motor de preço da 0012 calcula, `consumo_competencia` da 0013 consolida, e
-- nada gravava o título — a "fatura" existia apenas como simulação na interface.
-- A saída barata seria criar `contas_a_receber` para o lançamento manual e
-- deixar a fatura como está, o que daria **duas respostas** para "quanto o
-- cliente deve". Elas divergiriam, e a divergência apareceria como um relatório
-- de receita que não fecha com a régua de cobrança.
--
-- Então: `titulo_receber` com discriminador `origem`. `CONTRATUAL` é o que se
-- chamaria de fatura (gerado de contrato + consumo); `AVULSO` é o lançamento
-- manual. Mesma tabela, mesmo saldo, mesma baixa.
--
-- Nenhum valor de negócio aparece neste arquivo. Preço vem de
-- `app.resolver_preco`, desconto de `app.desconto_vigente`, excedente de
-- `consumo_competencia`, e as faixas de alçada são cadastro do locatário.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Numeração por locatário
--
-- Uma cobrança precisa de identificador que o cliente possa citar ao telefone.
-- Uma sequência global daria números salteados por locatário — o cliente A
-- receberia 1, 4, 9 —, e "por que faltam números?" é uma pergunta que ninguém
-- quer responder sobre cobrança.
--
-- O contador é uma linha por locatário, incrementada com `on conflict do
-- update`, que trava a linha pela transação. Isso **serializa** a emissão dentro
-- de um locatário, e é o preço de uma numeração sem lacuna: duas emissões
-- simultâneas ou esperam, ou uma delas fica com um buraco no lugar do número.
--
-- Este número **não** é NF-e nem NFS-e. Emissão de documento fiscal de serviço
-- depende de município, certificado e regime, e nada disso foi inventado aqui.
-- -----------------------------------------------------------------------------
create table if not exists public.titulo_receber_contador (
  tenant_id uuid primary key references public.tenant(id) on delete cascade,
  ultimo    bigint not null default 0
);

/*
 * O locatário vem por parâmetro, não da sessão.
 *
 * A primeira versão lia `app.exigir_tenant()`. Sob RLS os dois nunca discordam —
 * a política do locatário recusaria uma linha de outro tenant —, mas qualquer
 * caminho que escreva sem RLS (migração de dados, correção manual como
 * superusuário) tiraria o número do contador **errado** e colidiria com a chave
 * única do locatário certo. O número pertence ao locatário da linha por
 * definição; ler de outro lugar é abrir espaço para eles divergirem.
 */
create or replace function app.proximo_numero_titulo_receber(p_tenant_id uuid)
returns bigint
language plpgsql
as $$
declare
  v_numero bigint;
begin
  insert into public.titulo_receber_contador (tenant_id, ultimo)
  values (p_tenant_id, 1)
  on conflict (tenant_id) do update set ultimo = public.titulo_receber_contador.ultimo + 1
  returning ultimo into v_numero;

  return v_numero;
end;
$$;

comment on function app.proximo_numero_titulo_receber(uuid) is
  'Numeração sem lacuna por locatário. Serializa a emissão dentro do locatário — é o preço de não haver buraco na sequência de uma cobrança.';

-- -----------------------------------------------------------------------------
-- Título a receber
--
-- `valor_liquido` é coluna gerada. Guardá-lo em paralelo ao original e ao
-- desconto criaria três números onde há dois fatos, e o terceiro divergiria na
-- primeira escrita que esquecesse de recalculá-lo.
--
-- **Não existe status `EM_ATRASO`**, e a ausência é deliberada. Atraso é
-- `vencimento < hoje` com o título em aberto — uma leitura da data, não um
-- fato a gravar. A simulação da interface guardava `EM_ATRASO` e `diasAtraso`
-- como campos: no dia seguinte ao vencimento eles estavam errados, e só um job
-- noturno os corrigiria. É o mesmo defeito de classe que guardar saldo.
-- -----------------------------------------------------------------------------
create table if not exists public.titulo_receber (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete restrict,
  numero_titulo     bigint not null,
  cliente_id        uuid not null references public.cliente(id) on delete restrict,
  filial_id         uuid references public.filial(id) on delete restrict,
  /** Presente quando origem = CONTRATUAL: é o contrato que originou a cobrança. */
  contrato_id       uuid references public.contrato(id) on delete restrict,
  /** 'AAAA-MM'. Presente quando origem = CONTRATUAL. */
  competencia       char(7),
  origem            text not null,
  descricao         text not null,
  valor_original    numeric(15,4) not null,
  desconto          numeric(15,4) not null default 0,
  valor_liquido     numeric(15,4) generated always as (valor_original - desconto) stored,
  /** Quem concedeu o desconto e por quê — RN-F12 exige rastro. */
  desconto_motivo   text,
  desconto_por      uuid references public.usuario(id) on delete set null,
  data_emissao      date not null,
  data_vencimento   date not null,
  status            text not null default 'PENDENTE_APROVACAO',
  /** RN-F14: baixa sem recebimento exige motivo, e ele fica aqui. */
  baixa_motivo      text,
  baixado_em        timestamptz,
  baixado_por       uuid references public.usuario(id) on delete set null,
  /** Marca da RN-F11 e do preço ausente: por que este título nasceu em disputa. */
  excecao_geracao   text,
  titulo_pai_id     uuid references public.titulo_receber(id) on delete restrict,
  parcela_numero    integer,
  parcela_total     integer,
  /*
   * Recorrência do Módulo 12. A coluna existe sem chave estrangeira porque
   * `recorrencia_receber` ainda não existe — e uma FK para tabela inexistente
   * não compila. A restrição entra na migração do Módulo 12, que é quem cria a
   * tabela; até lá a coluna fica nula em todas as linhas.
   */
  recorrencia_id    uuid,
  version           integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.usuario(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,

  constraint titulo_receber_origem_valida check (origem in ('CONTRATUAL', 'AVULSO')),
  constraint titulo_receber_status_valido check (
    status in ('PENDENTE_APROVACAO', 'PENDENTE', 'APROVADO',
               'RECEBIDO_PARCIAL', 'RECEBIDO', 'CANCELADO', 'EM_DISPUTA', 'BAIXADO')
  ),
  constraint titulo_receber_descricao_nao_vazia check (length(btrim(descricao)) > 0),
  constraint titulo_receber_valor_positivo check (valor_original > 0),
  constraint titulo_receber_desconto_nao_negativo check (desconto >= 0),
  -- Desconto que zera ou inverte a cobrança não é desconto: é cancelamento
  -- disfarçado, e cancelamento tem caminho próprio, com permissão própria.
  constraint titulo_receber_desconto_menor_que_valor check (desconto < valor_original),
  constraint titulo_receber_desconto_justificado check (
    desconto = 0 or length(btrim(coalesce(desconto_motivo, ''))) >= 5
  ),
  constraint titulo_receber_vencimento_apos_emissao check (data_vencimento >= data_emissao),
  /*
   * O discriminador é uma equivalência, não uma implicação.
   *
   * `CONTRATUAL` sem contrato é um título que ninguém sabe de onde veio;
   * `AVULSO` com contrato e competência é um contratual que escapou da geração
   * automática e não tem a unicidade que a torna idempotente. As duas
   * combinações erradas existiriam se a checagem fosse só num sentido.
   */
  constraint titulo_receber_origem_coerente check (
    (origem = 'CONTRATUAL') = (contrato_id is not null and competencia is not null)
  ),
  constraint titulo_receber_competencia_formato check (
    competencia is null or competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'
  ),
  -- RN-F14: baixado sem motivo é um título que desapareceu sem explicação.
  constraint titulo_receber_baixa_justificada check (
    (baixado_em is null) = (baixa_motivo is null)
  ),
  constraint titulo_receber_baixa_coerente check (
    baixado_em is null or status = 'BAIXADO'
  ),
  -- Mesma assimetria do titulo_pagar: número exige total, o pai tem total sem
  -- número porque não é uma das parcelas, é o agrupador delas.
  constraint titulo_receber_numero_exige_total check (
    parcela_numero is null or parcela_total is not null
  ),
  constraint titulo_receber_parcela_coerente check (
    parcela_numero is null or (parcela_numero >= 1 and parcela_numero <= parcela_total)
  ),
  constraint titulo_receber_filha_numerada check (
    titulo_pai_id is null or parcela_numero is not null
  ),
  constraint titulo_receber_pai_nao_e_ele_mesmo check (
    titulo_pai_id is null or titulo_pai_id <> id
  )
);

create unique index if not exists titulo_receber_numero_uk
  on public.titulo_receber (tenant_id, numero_titulo);

/*
 * A chave que torna o fechamento idempotente.
 *
 * Um contrato tem **um** título por competência. Fechar a mesma competência
 * duas vezes — o que acontece quando alguém reprocessa um mês — não pode
 * duplicar a cobrança. Sem este índice, a idempotência dependeria de a função
 * de geração lembrar de conferir, e "lembrar de conferir" é o que falha.
 *
 * Parcial em `deleted_at is null` de propósito: um título excluído logicamente
 * não deve impedir a regeração da competência.
 */
create unique index if not exists titulo_receber_contrato_competencia_uk
  on public.titulo_receber (tenant_id, contrato_id, competencia)
  where origem = 'CONTRATUAL' and deleted_at is null and titulo_pai_id is null;

create index if not exists titulo_receber_fila_ix
  on public.titulo_receber (tenant_id, status, data_vencimento)
  where deleted_at is null;
create index if not exists titulo_receber_cliente_ix
  on public.titulo_receber (tenant_id, cliente_id, data_vencimento desc)
  where deleted_at is null;
create index if not exists titulo_receber_competencia_ix
  on public.titulo_receber (tenant_id, competencia)
  where competencia is not null and deleted_at is null;
create index if not exists titulo_receber_parcelas_ix
  on public.titulo_receber (tenant_id, titulo_pai_id)
  where titulo_pai_id is not null and deleted_at is null;

comment on table public.titulo_receber is
  'D-20: fatura e contas a receber são a mesma linha. `origem` distingue o gerado do contrato do lançado à mão.';
comment on column public.titulo_receber.valor_liquido is
  'Coluna gerada. Não existe caminho para informar um líquido que discorde do original menos o desconto.';
comment on column public.titulo_receber.excecao_geracao is
  'RN-F11: por que este título nasceu em disputa — contrato fora de vigência, ou item sem política de preço.';
comment on column public.titulo_receber.numero_titulo is
  'Identificador interno sequencial por locatário. NÃO é número de NF-e/NFS-e: emissão fiscal de serviço não está implementada.';

-- -----------------------------------------------------------------------------
-- Numeração automática
-- -----------------------------------------------------------------------------
create or replace function app.numerar_titulo_receber()
returns trigger
language plpgsql
as $$
begin
  if new.numero_titulo is null or new.numero_titulo = 0 then
    new.numero_titulo := app.proximo_numero_titulo_receber(new.tenant_id);
  end if;
  return new;
end;
$$;

drop trigger if exists titulo_receber_numera on public.titulo_receber;
create trigger titulo_receber_numera
  before insert on public.titulo_receber
  for each row execute function app.numerar_titulo_receber();

/*
 * O número não se reescreve.
 *
 * Um número de cobrança citado num e-mail, num boleto ou numa conversa com o
 * cliente deixa de identificar a linha se ela puder renumerar. E o histórico
 * fica sem como apontar de volta.
 */
create or replace function app.impedir_renumeracao_titulo_receber()
returns trigger
language plpgsql
as $$
begin
  if new.numero_titulo is distinct from old.numero_titulo then
    raise exception 'O número do título % não se altera.', old.numero_titulo
      using errcode = 'check_violation',
            column = 'numero_titulo',
            table = 'titulo_receber',
            hint = 'Cancele o título e emita outro — o número citado ao cliente tem de continuar apontando para a mesma cobrança.';
  end if;
  return new;
end;
$$;

drop trigger if exists titulo_receber_numero_fixo on public.titulo_receber;
create trigger titulo_receber_numero_fixo
  before update of numero_titulo on public.titulo_receber
  for each row execute function app.impedir_renumeracao_titulo_receber();

-- -----------------------------------------------------------------------------
-- Rateio entre centros de custo (D-16: percentual)
--
-- No título a receber o rateio responde "de qual área veio esta receita", que é
-- o outro lado da pergunta que o Módulo 14 faz sobre despesa. A forma é a mesma
-- da 0019 de propósito: duas formas de ratear obrigariam todo relatório a saber
-- qual delas está lendo.
-- -----------------------------------------------------------------------------
create table if not exists public.titulo_receber_rateio (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete restrict,
  titulo_id       uuid not null references public.titulo_receber(id) on delete cascade,
  centro_custo_id uuid not null references public.centro_custo(id) on delete restrict,
  percentual      numeric(7,4) not null,
  created_at timestamptz not null default now(),
  constraint rateio_receber_percentual_faixa check (percentual > 0 and percentual <= 100)
);

create unique index if not exists rateio_receber_titulo_centro_uk
  on public.titulo_receber_rateio (titulo_id, centro_custo_id);
create index if not exists rateio_receber_centro_ix
  on public.titulo_receber_rateio (tenant_id, centro_custo_id);

/*
 * Soma exatamente 100%, ou não existe. Gatilho de statement pela mesma razão da
 * 0019: a soma é propriedade do conjunto, e um gatilho por linha reprovaria a
 * primeira linha de um rateio de duas.
 *
 * A tolerância de meio centésimo existe porque 100/3 não fecha em decimal.
 */
create or replace function app.validar_soma_rateio_receber()
returns trigger
language plpgsql
as $$
declare
  r record;
  v_soma numeric;
begin
  for r in select distinct titulo_id from novos loop
    select coalesce(sum(percentual), 0) into v_soma
      from public.titulo_receber_rateio where titulo_id = r.titulo_id;

    if abs(v_soma - 100) > 0.005 then
      raise exception 'O rateio do título % soma %%%, e tem de fechar em 100%%.', r.titulo_id, v_soma
        using errcode = 'check_violation',
              table = 'titulo_receber_rateio',
              hint = 'Ajuste os percentuais, ou remova o rateio inteiro — receita sem centro de custo é legítima, receita com centro pela metade não.';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists rateio_receber_soma_insert on public.titulo_receber_rateio;
create trigger rateio_receber_soma_insert
  after insert on public.titulo_receber_rateio
  referencing new table as novos
  for each statement execute function app.validar_soma_rateio_receber();

drop trigger if exists rateio_receber_soma_update on public.titulo_receber_rateio;
create trigger rateio_receber_soma_update
  after update on public.titulo_receber_rateio
  referencing new table as novos
  for each statement execute function app.validar_soma_rateio_receber();

create or replace function app.validar_remocao_rateio_receber()
returns trigger
language plpgsql
as $$
declare
  r record;
  v_restante numeric;
begin
  for r in select distinct titulo_id from antigos loop
    select coalesce(sum(percentual), 0) into v_restante
      from public.titulo_receber_rateio where titulo_id = r.titulo_id;

    if v_restante > 0 and abs(v_restante - 100) > 0.005 then
      raise exception 'Remover esta linha deixaria o rateio do título % somando %%%.', r.titulo_id, v_restante
        using errcode = 'check_violation',
              table = 'titulo_receber_rateio',
              hint = 'Remova o rateio inteiro, ou redistribua o percentual entre os centros que ficam.';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists rateio_receber_soma_delete on public.titulo_receber_rateio;
create trigger rateio_receber_soma_delete
  after delete on public.titulo_receber_rateio
  referencing old table as antigos
  for each statement execute function app.validar_remocao_rateio_receber();

create or replace function app.impedir_troca_titulo_rateio_receber()
returns trigger
language plpgsql
as $$
begin
  if new.titulo_id <> old.titulo_id then
    raise exception 'A linha de rateio não muda de título.'
      using errcode = 'check_violation',
            column = 'titulo_id',
            table = 'titulo_receber_rateio',
            hint = 'Remova a linha de um título e crie no outro — as duas somas são conferidas.';
  end if;
  return new;
end;
$$;

drop trigger if exists rateio_receber_titulo_fixo on public.titulo_receber_rateio;
create trigger rateio_receber_titulo_fixo
  before update of titulo_id on public.titulo_receber_rateio
  for each row execute function app.impedir_troca_titulo_rateio_receber();

-- -----------------------------------------------------------------------------
-- Aprovação da emissão
--
-- Reusa `alcada.tipo = 'EMISSAO_FATURA'`, que existe desde a 0002 e nunca teve
-- consumidor. **Nenhum valor novo foi acrescentado ao CHECK de `alcada.tipo`**,
-- e isso é consequência direta de D-20: se fatura e contas a receber são a
-- mesma coisa, a alçada que autoriza emitir uma autoriza emitir a outra. Um
-- `EMISSAO_TITULO_RECEBER` separado — que o Anexo L cogitava — reintroduziria
-- na tabela de alçada exactamente a duplicação que D-20 removeu do título.
-- -----------------------------------------------------------------------------
create table if not exists public.titulo_receber_aprovacao (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  titulo_id     uuid not null references public.titulo_receber(id) on delete cascade,
  nivel         integer not null,
  aprovador_id  uuid references public.usuario(id) on delete set null,
  decisao       text,
  decidido_em   timestamptz,
  justificativa text,
  delegado_de   uuid references public.usuario(id) on delete set null,
  rodada        integer not null default 1,
  created_at    timestamptz not null default now(),
  constraint aprovacao_receber_nivel_faixa check (nivel between 1 and 3),
  constraint aprovacao_receber_decisao_valida check (
    decisao is null or decisao in ('APROVADO', 'REJEITADO')
  ),
  constraint aprovacao_receber_decidida_tem_data check ((decisao is null) = (decidido_em is null)),
  constraint aprovacao_receber_decidida_tem_aprovador check ((decisao is null) = (aprovador_id is null)),
  constraint aprovacao_receber_rejeicao_justificada check (
    decisao <> 'REJEITADO' or length(btrim(coalesce(justificativa, ''))) >= 10
  )
);

create unique index if not exists aprovacao_receber_titulo_nivel_rodada_uk
  on public.titulo_receber_aprovacao (titulo_id, rodada, nivel);
create index if not exists aprovacao_receber_pendente_ix
  on public.titulo_receber_aprovacao (tenant_id, nivel)
  where decisao is null;

-- -----------------------------------------------------------------------------
-- Recebimento
-- -----------------------------------------------------------------------------
create table if not exists public.titulo_receber_recebimento (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete restrict,
  titulo_id        uuid not null references public.titulo_receber(id) on delete restrict,
  valor_recebido   numeric(15,4) not null,
  data_recebimento date not null,
  conta_id         uuid not null references public.conta_bancaria(id) on delete restrict,
  forma            text not null,
  movimentacao_id  uuid references public.movimentacao_bancaria(id) on delete restrict,
  estornado_em     timestamptz,
  estorno_motivo   text,
  created_at timestamptz not null default now(),
  created_by uuid references public.usuario(id) on delete set null,
  constraint recebimento_valor_positivo check (valor_recebido > 0),
  constraint recebimento_forma_valida check (forma in ('TRANSFERENCIA', 'BOLETO', 'PIX', 'CHEQUE')),
  constraint recebimento_estorno_tem_motivo check (
    (estornado_em is null) = (estorno_motivo is null)
  )
);

create index if not exists recebimento_titulo_ix
  on public.titulo_receber_recebimento (titulo_id, data_recebimento);

-- -----------------------------------------------------------------------------
-- RN-F10 · o título contratual nasce pendente de aprovação
--
-- Ninguém emite cobrança direto do cálculo automático. O motor de preço acerta
-- na esmagadora maioria dos casos, e é exactamente por isso que a exceção passa
-- despercebida: um contrato com item substituído no meio do mês, uma leitura
-- estimada, uma franquia que mudou de tabela. Um humano entre o cálculo e a
-- cobrança é o que transforma um erro de sistema em uma pergunta, em vez de uma
-- fatura errada na caixa de entrada do cliente.
--
-- A alçada decide **quantos** conferem, não **se** alguém confere. Um contratual
-- de valor baixo ainda saiu de um cálculo que ninguém leu, então o piso é um
-- nível — sempre. Sem o piso, um locatário sem alçada configurada (ou com a
-- menor faixa acima do ticket médio) veria toda a sua cobrança recorrente ser
-- emitida sozinha, e RN-F10 não existiria na prática.
--
-- AVULSO é o caso oposto e segue a alçada à risca, inclusive com zero níveis:
-- ele já foi digitado por uma pessoa que escolheu o valor. Não há cálculo
-- automático a conferir, e exigir aprovação de um valor que ninguém configurou
-- como relevante é cerimônia.
-- -----------------------------------------------------------------------------
create or replace function app.niveis_aprovacao_receber(p_valor numeric)
returns integer
language sql
stable
as $$
  select least(count(*), 3)::integer
    from (
      select distinct a.limite_valor
        from public.alcada a
       where a.tipo = 'EMISSAO_FATURA'
         and a.limite_valor is not null
         and a.tenant_id = app.tenant_atual()
    ) limites
   where limites.limite_valor < p_valor;
$$;

comment on function app.niveis_aprovacao_receber(numeric) is
  'Níveis de aprovação da emissão = quantos limites de EMISSAO_FATURA o valor ultrapassa, no máximo 3. Sem alçada configurada, zero.';

create or replace function app.posto_alcada_receber(p_usuario_id uuid)
returns integer
language sql
stable
as $$
  with limites as (
    select distinct a.limite_valor,
           dense_rank() over (order by a.limite_valor) as posto
      from public.alcada a
     where a.tipo = 'EMISSAO_FATURA'
       and a.limite_valor is not null
       and a.tenant_id = app.tenant_atual()
  )
  select coalesce(max(l.posto), 0)::integer
    from public.usuario_perfil up
    join public.alcada a
      on a.perfil_id = up.perfil_id
     and a.tipo = 'EMISSAO_FATURA'
    join limites l on l.limite_valor = a.limite_valor
   where up.usuario_id = p_usuario_id;
$$;

/**
 * Quem responde por um nível hoje. Posto próprio ou delegação vigente.
 *
 * A tabela `delegacao_aprovacao` da 0019 é reusada sem coluna de tipo, e é uma
 * decisão consciente: quem cobre as férias de alguém cobre as decisões dele,
 * não metade delas. Separar a delegação de pagar da de receber obrigaria a
 * registrar duas, e a segunda esquecida é uma fila travada sem sintoma.
 */
create or replace function app.pode_decidir_nivel_receber(p_usuario_id uuid, p_nivel integer)
returns boolean
language sql
stable
as $$
  select app.posto_alcada_receber(p_usuario_id) >= p_nivel
      or exists (
        select 1
          from public.delegacao_aprovacao d
         where d.delegado_id = p_usuario_id
           and d.nivel >= p_nivel
           and current_date between d.inicio and d.fim
           and app.posto_alcada_receber(d.delegante_id) >= p_nivel
      );
$$;

comment on function app.pode_decidir_nivel_receber(uuid, integer) is
  'Posto próprio ou delegação vigente. A delegação da 0019 vale para os dois lados: quem cobre férias cobre as decisões, não metade delas.';

-- -----------------------------------------------------------------------------
-- Sequencial, e quem gera não aprova
--
-- Mesmas duas condições da 0019, e pela mesma razão: sem a segregação, quem
-- roda o fechamento aprova a própria cobrança, e o "aprovado" só quer dizer que
-- alguém clicou.
--
-- Com uma diferença que importa: no fechamento automático `created_by` é quem
-- disparou o fechamento. Então quem fecha a competência **não pode aprovar** os
-- títulos que ela gerou — que é exactamente o efeito desejado, e é por isso que
-- a geração grava o usuário em vez de deixar nulo.
-- -----------------------------------------------------------------------------
create or replace function app.validar_decisao_aprovacao_receber()
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
  if old.decisao is not null then
    raise exception 'A decisão do nível % já foi registrada e não se altera.', old.nivel
      using errcode = 'check_violation',
            column = 'decisao',
            table = 'titulo_receber_aprovacao',
            hint = 'Reenvie o título para uma nova rodada de aprovação.';
  end if;

  select created_by into v_criador from public.titulo_receber where id = new.titulo_id;

  if v_criador is not null and new.aprovador_id = v_criador then
    raise exception 'Quem gerou o título não aprova a própria cobrança.'
      using errcode = 'check_violation',
            column = 'aprovador_id',
            table = 'titulo_receber_aprovacao',
            hint = 'A aprovação tem de vir de outra pessoa — é o que faz o fluxo valer.';
  end if;

  if v_criador is not null and new.delegado_de = v_criador then
    raise exception 'A delegação não pode devolver a aprovação a quem gerou o título.'
      using errcode = 'check_violation', column = 'delegado_de', table = 'titulo_receber_aprovacao';
  end if;

  if not app.pode_decidir_nivel_receber(new.aprovador_id, new.nivel) then
    raise exception 'O usuário não tem alçada para decidir o nível %.', new.nivel
      using errcode = 'check_violation',
            column = 'aprovador_id',
            table = 'titulo_receber_aprovacao',
            hint = 'Configure a alçada EMISSAO_FATURA do perfil, ou registre uma delegação vigente.';
  end if;

  select count(*) into v_pendente_anterior
    from public.titulo_receber_aprovacao a
   where a.titulo_id = new.titulo_id
     and a.rodada = new.rodada
     and a.nivel < new.nivel
     and a.decisao is distinct from 'APROVADO';

  if v_pendente_anterior > 0 then
    raise exception 'O nível % ainda espera a decisão de % nível(is) anterior(es).',
      new.nivel, v_pendente_anterior
      using errcode = 'check_violation',
            column = 'nivel',
            table = 'titulo_receber_aprovacao',
            hint = 'A aprovação é sequencial: o nível anterior decide primeiro.';
  end if;

  return new;
end;
$$;

drop trigger if exists aprovacao_receber_valida on public.titulo_receber_aprovacao;
create trigger aprovacao_receber_valida
  before update on public.titulo_receber_aprovacao
  for each row execute function app.validar_decisao_aprovacao_receber();

-- -----------------------------------------------------------------------------
-- RN-F12 · desconto acima da alçada é barrado, mesmo em título já aprovado
--
-- A alçada de desconto é **percentual**, não valor: `alcada.limite_percentual`
-- com `tipo = 'DESCONTO'` existe desde a 0002. E percentual é o certo aqui — um
-- limite em reais faria 5% de desconto num contrato grande ultrapassar o teto e
-- 50% num contrato pequeno passar batido, o que é o inverso do que a alçada
-- quer controlar.
--
-- "Mesmo em título já aprovado" é a parte que não é óbvia. A aprovação da
-- emissão validou um valor; conceder desconto depois muda esse valor. Sem esta
-- regra, o caminho mais curto para cobrar menos do que a alçada permite seria
-- emitir cheio, aprovar, e descontar em seguida.
-- -----------------------------------------------------------------------------
create or replace function app.limite_desconto_percentual(p_usuario_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(max(a.limite_percentual), 0)
    from public.usuario_perfil up
    join public.alcada a
      on a.perfil_id = up.perfil_id
     and a.tipo = 'DESCONTO'
     and a.tenant_id = app.tenant_atual()
   where up.usuario_id = p_usuario_id;
$$;

comment on function app.limite_desconto_percentual(uuid) is
  'RN-F12. Teto de desconto do usuário, em percentual. Zero significa "não concede desconto", não "concede qualquer um".';

create or replace function app.validar_desconto_receber()
returns trigger
language plpgsql
as $$
declare
  v_percentual numeric;
  v_limite numeric;
  v_quem uuid;
begin
  if new.desconto = old.desconto then
    return new;
  end if;

  -- Título encerrado não muda de valor: alterar o líquido de um título recebido
  -- reescreveria receita já apurada, e a de um cancelado ressuscitaria a cobrança.
  if old.status in ('RECEBIDO', 'CANCELADO', 'BAIXADO') then
    raise exception 'Título em % não recebe desconto.', old.status
      using errcode = 'check_violation',
            column = 'desconto',
            table = 'titulo_receber',
            hint = 'Estorne o recebimento antes de renegociar o valor.';
  end if;

  -- O desconto não desce abaixo do que já entrou em caixa: o saldo ficaria
  -- negativo, e um saldo negativo a receber é um crédito que ninguém concedeu.
  if new.valor_original - new.desconto < coalesce((
        select sum(r.valor_recebido)
          from public.titulo_receber_recebimento r
         where r.titulo_id = new.id and r.estornado_em is null
      ), 0) then
    raise exception 'O desconto deixaria o título abaixo do que já foi recebido.'
      using errcode = 'check_violation',
            column = 'desconto',
            table = 'titulo_receber',
            hint = 'Estorne o recebimento antes de reduzir o valor.';
  end if;

  /*
   * Quem concede é sempre `app.usuario_atual()`, nunca o que vem na linha.
   *
   * A primeira versão fazia `coalesce(new.desconto_por, app.usuario_atual())`, e
   * o efeito era este: depois do primeiro desconto a coluna já estava
   * preenchida, então toda alteração seguinte era conferida contra a alçada de
   * **quem concedeu antes**. Alguém sem alçada nenhuma podia mexer no desconto e
   * passar, emprestada a autoridade de outro — e o rastro continuaria apontando
   * para a pessoa errada. É o mesmo princípio do delegante em `delegacao_aprovacao`:
   * identidade de quem age não se aceita como parâmetro.
   */
  v_quem := app.usuario_atual();
  if v_quem is null then
    raise exception 'Desconto exige usuário identificado.'
      using errcode = 'check_violation', column = 'desconto_por', table = 'titulo_receber';
  end if;

  v_percentual := round(100 * new.desconto / new.valor_original, 4);
  v_limite := app.limite_desconto_percentual(v_quem);

  if v_percentual > v_limite then
    raise exception 'Desconto de %%% acima da alçada de %%% deste perfil.', v_percentual, v_limite
      using errcode = 'check_violation',
            column = 'desconto',
            table = 'titulo_receber',
            hint = 'Peça a concessão a quem tem alçada de desconto maior — a aprovação da emissão não cobre o desconto.';
  end if;

  new.desconto_por := v_quem;
  return new;
end;
$$;

drop trigger if exists titulo_receber_desconto_valida on public.titulo_receber;
create trigger titulo_receber_desconto_valida
  before update of desconto on public.titulo_receber
  for each row execute function app.validar_desconto_receber();

-- -----------------------------------------------------------------------------
-- RN-F13 · saldo derivado, e o excesso recusado
-- -----------------------------------------------------------------------------
create or replace function app.saldo_titulo_receber(p_titulo_id uuid)
returns numeric
language sql
stable
as $$
  select t.valor_liquido - coalesce((
    select sum(r.valor_recebido)
      from public.titulo_receber_recebimento r
     where r.titulo_id = t.id and r.estornado_em is null
  ), 0)
  from public.titulo_receber t
  where t.id = p_titulo_id;
$$;

comment on function app.saldo_titulo_receber(uuid) is
  'RN-F13. Derivado dos recebimentos não estornados. Sem coluna de "já recebido", não há valor recebido divergente.';

create or replace function app.validar_recebimento()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_saldo numeric;
begin
  select status into v_status from public.titulo_receber where id = new.titulo_id;

  -- O pai de um parcelamento é relatório. Receber nele contaria o total do
  -- parcelamento e as parcelas, dobrando a receita.
  if exists (select 1 from public.titulo_receber f where f.titulo_pai_id = new.titulo_id) then
    raise exception 'Título parcelado não recebe baixa: receba as parcelas.'
      using errcode = 'check_violation',
            column = 'titulo_id',
            table = 'titulo_receber_recebimento';
  end if;

  if v_status not in ('APROVADO', 'RECEBIDO_PARCIAL') then
    raise exception 'Título em % não recebe baixa.', v_status
      using errcode = 'check_violation',
            column = 'titulo_id',
            table = 'titulo_receber_recebimento',
            hint = 'Só título aprovado ou parcialmente recebido aceita baixa — a aprovação da cobrança vem antes do dinheiro.';
  end if;

  v_saldo := app.saldo_titulo_receber(new.titulo_id);
  if new.valor_recebido > v_saldo + 0.005 then
    raise exception 'O recebimento de % excede o saldo em aberto de %.', new.valor_recebido, v_saldo
      using errcode = 'check_violation',
            column = 'valor_recebido',
            table = 'titulo_receber_recebimento',
            hint = 'Recebimento a mais não vira crédito do cliente: registre a diferença como título próprio, ou devolva.';
  end if;

  return new;
end;
$$;

drop trigger if exists recebimento_valida on public.titulo_receber_recebimento;
create trigger recebimento_valida
  before insert on public.titulo_receber_recebimento
  for each row execute function app.validar_recebimento();

/**
 * Status recalculado do saldo, nunca digitado.
 *
 * A cláusula `status in (...)` no fim protege o que não deve ser reescrito:
 * um título BAIXADO ou CANCELADO não volta a APROVADO porque alguém estornou um
 * recebimento antigo.
 */
create or replace function app.recalcular_status_titulo_receber()
returns trigger
language plpgsql
as $$
declare
  v_id uuid := coalesce(new.titulo_id, old.titulo_id);
  v_saldo numeric;
  v_recebeu boolean;
begin
  v_saldo := app.saldo_titulo_receber(v_id);
  select exists (
    select 1 from public.titulo_receber_recebimento r
     where r.titulo_id = v_id and r.estornado_em is null
  ) into v_recebeu;

  update public.titulo_receber
     set status = case
                    when v_saldo <= 0.005 then 'RECEBIDO'
                    when v_recebeu then 'RECEBIDO_PARCIAL'
                    else 'APROVADO'
                  end,
         updated_at = now()
   where id = v_id
     and status in ('APROVADO', 'RECEBIDO_PARCIAL', 'RECEBIDO');

  return null;
end;
$$;

drop trigger if exists recebimento_recalcula on public.titulo_receber_recebimento;
create trigger recebimento_recalcula
  after insert or update of estornado_em on public.titulo_receber_recebimento
  for each row execute function app.recalcular_status_titulo_receber();

create or replace function app.impedir_exclusao_recebimento()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Recebimento não se apaga. Estorne, com motivo.'
    using errcode = 'check_violation',
          table = 'titulo_receber_recebimento',
          hint = 'Preencha estornado_em e estorno_motivo — o original fica no histórico.';
end;
$$;

drop trigger if exists recebimento_sem_exclusao on public.titulo_receber_recebimento;
create trigger recebimento_sem_exclusao
  before delete on public.titulo_receber_recebimento
  for each row execute function app.impedir_exclusao_recebimento();

-- -----------------------------------------------------------------------------
-- RN-F14 · BAIXADO não é RECEBIDO
--
-- Recebido é dinheiro que entrou. Baixado é título encerrado **sem** entrada:
-- perda reconhecida, acordo que zerou o saldo por outro instrumento, valor
-- irrisório que não compensa cobrar.
--
-- Confundir os dois infla a receita realizada — e infla justamente onde ninguém
-- confere, porque a soma continua fechando com a soma dos títulos "encerrados".
-- A regra técnica é curta: BAIXADO exige motivo, exige saldo em aberto, e
-- **não** pode ter recebimento vivo. Toda função de agregação de receita neste
-- arquivo filtra por RECEBIDO/RECEBIDO_PARCIAL, nunca por "encerrado".
-- -----------------------------------------------------------------------------
create or replace function app.baixar_sem_recebimento(p_titulo_id uuid, p_motivo text)
returns void
language plpgsql
as $$
declare
  v_status text;
  v_saldo numeric;
begin
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Baixa sem recebimento exige motivo de ao menos 10 caracteres.'
      using errcode = 'check_violation',
            column = 'baixa_motivo',
            table = 'titulo_receber',
            hint = 'É o único registro de por que este valor não entrou — sem ele, some da receita sem explicação.';
  end if;

  select status into v_status from public.titulo_receber where id = p_titulo_id;
  if v_status is null then
    raise exception 'Título a receber não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_status not in ('APROVADO', 'RECEBIDO_PARCIAL', 'EM_DISPUTA') then
    raise exception 'Título em % não se baixa sem recebimento.', v_status
      using errcode = 'check_violation', column = 'status', table = 'titulo_receber';
  end if;

  v_saldo := app.saldo_titulo_receber(p_titulo_id);
  if v_saldo <= 0.005 then
    raise exception 'Não há saldo em aberto para baixar.'
      using errcode = 'check_violation',
            table = 'titulo_receber',
            hint = 'O título já está quitado — baixá-lo apagaria o registro de que o dinheiro entrou.';
  end if;

  update public.titulo_receber
     set status = 'BAIXADO',
         baixado_em = now(),
         baixado_por = app.usuario_atual(),
         baixa_motivo = btrim(p_motivo),
         updated_at = now(),
         updated_by = app.usuario_atual()
   where id = p_titulo_id;
end;
$$;

comment on function app.baixar_sem_recebimento(uuid, text) is
  'RN-F14. Encerra o título sem entrada de caixa. Exige motivo e saldo em aberto — nunca conta como receita realizada.';

/**
 * Receita realizada de uma competência.
 *
 * Existe para que a soma seja escrita **uma vez** e não em cada consulta que
 * precisar dela. É aqui que RN-F14 deixa de ser intenção e passa a ser código:
 * a função soma recebimentos, não títulos encerrados, então nenhum relatório
 * construído sobre ela pode contar um BAIXADO como dinheiro que entrou.
 */
create or replace function app.receita_realizada(p_competencia char(7))
returns numeric
language sql
stable
as $$
  select coalesce(sum(r.valor_recebido), 0)
    from public.titulo_receber_recebimento r
    join public.titulo_receber t on t.id = r.titulo_id
   where r.estornado_em is null
     and t.deleted_at is null
     and t.competencia = p_competencia;
$$;

comment on function app.receita_realizada(char) is
  'RN-F14. Soma recebimentos, não títulos encerrados: um BAIXADO nunca entra aqui.';

-- -----------------------------------------------------------------------------
-- A movimentação bancária ganha o vínculo com o título a receber
--
-- A 0019 abriu `titulo_pagar_id` e deixou este de fora com a nota "a de receber
-- entra com o Módulo 11". É esta linha.
-- -----------------------------------------------------------------------------
alter table public.movimentacao_bancaria
  add column if not exists titulo_receber_id uuid references public.titulo_receber(id) on delete restrict;

create index if not exists movimentacao_titulo_receber_ix
  on public.movimentacao_bancaria (tenant_id, titulo_receber_id)
  where titulo_receber_id is not null;

-- -----------------------------------------------------------------------------
-- Baixa: recebimento e movimentação bancária na mesma chamada
--
-- Espelho de `app.baixar_titulo_pagar`, com o sinal invertido, e pela mesma
-- razão: um recebimento sem movimentação é um título quitado que não entrou em
-- conta nenhuma, e a conciliação passa a ter uma linha a menos sem que nada
-- pareça errado.
-- -----------------------------------------------------------------------------
create or replace function app.receber_titulo(
  p_titulo_id uuid,
  p_valor     numeric,
  p_data      date,
  p_conta_id  uuid,
  p_forma     text
)
returns table (recebimento_id uuid, movimentacao_id uuid)
language plpgsql
as $$
declare
  v_tenant uuid := app.exigir_tenant();
  v_rec uuid;
  v_mov uuid;
  v_descricao text;
begin
  select 'Recebimento: ' || descricao into v_descricao
    from public.titulo_receber where id = p_titulo_id;
  if v_descricao is null then
    raise exception 'Título a receber não encontrado.'
      using errcode = 'no_data_found', column = 'titulo_id';
  end if;

  -- O recebimento primeiro: é ele que carrega as checagens de RN-F13. Criar a
  -- movimentação antes faria o gatilho de conta inativa disparar na frente da
  -- recusa que realmente importa, e a mensagem apontaria para o lugar errado.
  insert into public.titulo_receber_recebimento
    (tenant_id, titulo_id, valor_recebido, data_recebimento, conta_id, forma, created_by)
  values (v_tenant, p_titulo_id, p_valor, p_data, p_conta_id, p_forma, app.usuario_atual())
  returning id into v_rec;

  insert into public.movimentacao_bancaria
    (tenant_id, conta_id, tipo, valor, data_movimento, descricao, titulo_receber_id, created_by)
  values (v_tenant, p_conta_id, 'ENTRADA', p_valor, p_data, v_descricao, p_titulo_id, app.usuario_atual())
  returning id into v_mov;

  update public.titulo_receber_recebimento set movimentacao_id = v_mov where id = v_rec;

  return query select v_rec, v_mov;
end;
$$;

comment on function app.receber_titulo(uuid, numeric, date, uuid, text) is
  'Recebimento e movimentação na mesma chamada. Separadas, um recebimento sem movimentação é um título quitado que não entrou em conta nenhuma.';

create or replace function app.estornar_recebimento(p_recebimento_id uuid, p_motivo text)
returns uuid
language plpgsql
as $$
declare
  v_tenant uuid := app.exigir_tenant();
  v_rec record;
  v_estorno uuid;
begin
  select * into v_rec from public.titulo_receber_recebimento where id = p_recebimento_id;
  if v_rec is null then
    raise exception 'Recebimento não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_rec.estornado_em is not null then
    raise exception 'Este recebimento já foi estornado.'
      using errcode = 'check_violation',
            hint = 'Estornar duas vezes tiraria o valor duas vezes do saldo do título.';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo do estorno.'
      using errcode = 'check_violation', column = 'estorno_motivo';
  end if;

  -- Saída na conta: o dinheiro que tinha entrado volta. Cheque devolvido e
  -- estorno de Pix são os dois casos que tornam isto rotina, não exceção.
  insert into public.movimentacao_bancaria
    (tenant_id, conta_id, tipo, valor, data_movimento, descricao,
     titulo_receber_id, estorna_id, motivo, created_by)
  values (v_tenant, v_rec.conta_id, 'SAIDA', v_rec.valor_recebido, current_date,
          'Estorno de recebimento', v_rec.titulo_id, v_rec.movimentacao_id,
          btrim(p_motivo), app.usuario_atual())
  returning id into v_estorno;

  update public.titulo_receber_recebimento
     set estornado_em = now(), estorno_motivo = btrim(p_motivo)
   where id = p_recebimento_id;

  return v_estorno;
end;
$$;

-- =============================================================================
-- Fechamento de competência
--
-- O Anexo L afirmava que `app.fechar_competencia` já existia. Não existia: o
-- que havia era a coluna `consumo_competencia.fechado_em` e o gatilho que
-- bloqueia a alteração de linha fechada — a trava, sem a chave. Nenhum caminho
-- do sistema chegava a preencher `fechado_em`.
--
-- Uma chamada faz as duas coisas — selar o consumo e gerar os títulos —, pela
-- mesma razão de `app.transferir_entre_contas` e `app.baixar_titulo_pagar`:
-- selar sem gerar deixa um mês fechado que nunca foi cobrado, e gerar sem selar
-- deixa a base do valor cobrado podendo mudar depois da cobrança.
-- =============================================================================

/**
 * Valor contratual de um contrato numa competência.
 *
 * Reusa o motor que já existe: `app.resolver_preco` (RN-L21, precedência
 * Contrato → Cliente → Geral) para a mensalidade, `app.desconto_vigente`
 * (RN-L23, sem acúmulo) para o desconto, e `consumo_competencia.valor_excedente`
 * para o que passou da franquia — que a 0013 já calculou e selou.
 *
 * `preco_ausente` é devolvido junto, e não engolido: um item sem política de
 * preço não deve ser cobrado como zero. Anexo P já tinha essa regra para o
 * simulador; aqui ela vira condição de exceção do título.
 */
create or replace function app.valor_contratual_competencia(
  p_contrato_id uuid,
  p_competencia char(7)
)
returns table (
  valor_mensal    numeric,
  valor_excedente numeric,
  desconto        numeric,
  itens           integer,
  preco_ausente   integer
)
language sql
stable
as $$
  with referencia as (
    -- Último dia da competência: é a data em que a vigência de preço, franquia e
    -- desconto tem de ser avaliada. Usar a data de hoje reprecificaria um mês
    -- fechado com a tabela de agora.
    select (to_date(p_competencia || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date as dia
  ),
  itens_do_mes as (
    select distinct ci.id as contrato_item_id, ci.equipamento_id, c.cliente_id, c.id as contrato_id
      from public.consumo_competencia cc
      join public.contrato_item ci on ci.id = cc.contrato_item_id
      join public.contrato c on c.id = ci.contrato_id
     where cc.competencia = p_competencia
       and ci.contrato_id = p_contrato_id
       and ci.deleted_at is null
  ),
  precificado as (
    -- `left join lateral`, e não subconsulta por coluna: `app.desconto_vigente`
    -- devolve percentual e valor na mesma linha, e chamá-la duas vezes por item
    -- executaria a resolução de precedência (RN-L23) em dobro para ler dois
    -- campos do mesmo registro.
    select i.contrato_item_id, pr.valor_mensal as mensal,
           de.percentual as desc_pct, de.valor as desc_val
      from itens_do_mes i
     cross join referencia r
      left join lateral app.resolver_preco(
                  i.equipamento_id, i.cliente_id, i.contrato_id, r.dia) pr on true
      left join lateral app.desconto_vigente(i.contrato_item_id, r.dia) de on true
  )
  select
    coalesce(sum(p.mensal), 0),
    coalesce((
      select sum(cc.valor_excedente)
        from public.consumo_competencia cc
        join public.contrato_item ci on ci.id = cc.contrato_item_id
       where cc.competencia = p_competencia and ci.contrato_id = p_contrato_id
    ), 0),
    coalesce(sum(
      coalesce(p.desc_val, 0) + coalesce(p.mensal, 0) * coalesce(p.desc_pct, 0) / 100
    ), 0),
    count(*)::integer,
    count(*) filter (where p.mensal is null)::integer
  from precificado p;
$$;

comment on function app.valor_contratual_competencia(uuid, char) is
  'Mensalidade, excedente e desconto de um contrato numa competência, pelo motor da 0012. Devolve `preco_ausente` em vez de cobrar zero por item sem política.';

/**
 * Sela a competência e gera os títulos contratuais.
 *
 * RN-F10 · o título nasce PENDENTE_APROVACAO. Ninguém emite cobrança direto do
 * cálculo automático.
 *
 * RN-F11 · a vigência é checada **aqui**, na geração, e não depois. Um contrato
 * suspenso ou encerrado entre a última leitura e o fechamento geraria, sem esta
 * checagem, uma cobrança com o valor de um contrato morto — e ela iria para o
 * cliente antes de alguém notar. Com ela, o título nasce EM_DISPUTA e com o
 * motivo escrito em `excecao_geracao`: existe, aparece na tela, e não é cobrado.
 *
 * Idempotente pela chave única `(tenant_id, contrato_id, competencia)`: fechar o
 * mesmo mês duas vezes não duplica título. `on conflict do nothing` em vez de
 * conferência prévia — a conferência prévia tem janela de corrida, a chave não.
 */
create or replace function app.fechar_competencia(p_competencia char(7))
returns table (
  titulos_criados   integer,
  em_disputa        integer,
  consumos_selados  integer,
  ja_existiam       integer
)
language plpgsql
as $$
declare
  v_tenant uuid := app.exigir_tenant();
  v_usuario uuid := app.usuario_atual();
  v_criados integer := 0;
  v_disputa integer := 0;
  v_selados integer := 0;
  v_existiam integer := 0;
  v_ultimo_dia date;
  r record;
  v_valor numeric;
  v_desconto numeric;
  v_status text;
  v_excecao text;
  v_id uuid;
begin
  if p_competencia !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Competência inválida: use AAAA-MM.'
      using errcode = 'invalid_parameter_value', column = 'competencia';
  end if;

  v_ultimo_dia := (to_date(p_competencia || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date;

  for r in
    select c.id as contrato_id, c.cliente_id, c.filial_id, c.numero, c.status,
           c.data_inicio, c.data_fim
      from public.contrato c
     where c.tenant_id = v_tenant
       and c.deleted_at is null
       and exists (
         select 1
           from public.consumo_competencia cc
           join public.contrato_item ci on ci.id = cc.contrato_item_id
          where cc.competencia = p_competencia
            and ci.contrato_id = c.id
       )
     order by c.numero
  loop
    select vc.valor_mensal + vc.valor_excedente, vc.desconto,
           case when vc.preco_ausente > 0 then
             format('%s item(ns) sem política de preço vigente em %s.', vc.preco_ausente, p_competencia)
           end
      into v_valor, v_desconto, v_excecao
      from app.valor_contratual_competencia(r.contrato_id, p_competencia) vc;

    -- Nada a cobrar: contrato com consumo zero e sem mensalidade resolvida. Um
    -- título de valor zero seria recusado pelo CHECK, e criar um "por
    -- completude" daria ao cliente uma cobrança de nada.
    if coalesce(v_valor, 0) <= 0 then
      continue;
    end if;

    -- RN-F11.
    if r.status in ('SUSPENSO', 'ENCERRADO', 'CANCELADO', 'DISTRATADO') then
      v_excecao := format('Contrato %s estava em %s no fechamento de %s.',
                          r.numero, r.status, p_competencia);
    elsif r.data_fim is not null and r.data_fim < v_ultimo_dia then
      v_excecao := format('Contrato %s venceu em %s, antes do fim de %s.',
                          r.numero, r.data_fim, p_competencia);
    end if;

    v_status := case when v_excecao is not null then 'EM_DISPUTA' else 'PENDENTE_APROVACAO' end;
    if v_excecao is not null then
      v_disputa := v_disputa + 1;
    end if;

    -- Zerado a cada volta de propósito. O PL/pgSQL já anula o alvo de `INTO`
    -- quando a consulta não devolve linha — então sem esta linha o código está
    -- correto, e depende de quem o lê saber dessa regra para confiar no
    -- contador de `ja_existiam`. Uma linha é mais barata que essa dependência.
    v_id := null;

    insert into public.titulo_receber (
      tenant_id, cliente_id, filial_id, contrato_id, competencia, origem,
      descricao, valor_original, desconto, desconto_motivo,
      data_emissao, data_vencimento, status, excecao_geracao, created_by
    )
    values (
      v_tenant, r.cliente_id, r.filial_id, r.contrato_id, p_competencia, 'CONTRATUAL',
      format('Locação e consumo — contrato %s, competência %s', r.numero, p_competencia),
      round(v_valor, 4),
      round(coalesce(v_desconto, 0), 4),
      case when coalesce(v_desconto, 0) > 0
           then format('Desconto comercial vigente em %s', p_competencia) end,
      v_ultimo_dia,
      -- Vencimento no mês seguinte, no mesmo dia do fechamento. Não há
      -- parâmetro de prazo de pagamento no cadastro de cliente — quando
      -- houver, é dele que esta data sai. Ver lacuna no Anexo T.
      (v_ultimo_dia + interval '30 days')::date,
      v_status, v_excecao, v_usuario
    )
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      v_existiam := v_existiam + 1;
      if v_excecao is not null then
        v_disputa := v_disputa - 1;
      end if;
      continue;
    end if;

    v_criados := v_criados + 1;

    /*
     * Abre a rodada de aprovação, com **piso de um nível**.
     *
     * `greatest(1, ...)` e não o número cru da alçada: um contratual de valor
     * baixo continua sendo uma cobrança que saiu de um cálculo automático que
     * ninguém leu. Sem o piso, este bloco criaria zero linhas de aprovação e o
     * título nasceria pronto para cobrança — que é exatamente o que RN-F10
     * existe para impedir, e foi o defeito que o teste de invariante pegou.
     *
     * Título em disputa não abre rodada nenhuma: não se aprova a emissão de uma
     * cobrança que já se sabe estar errada. Ela precisa ser corrigida primeiro.
     */
    if v_status = 'PENDENTE_APROVACAO' then
      insert into public.titulo_receber_aprovacao (tenant_id, titulo_id, nivel, rodada)
      select v_tenant, v_id, n, 1
        from generate_series(
               1,
               greatest(1, app.niveis_aprovacao_receber(round(v_valor - coalesce(v_desconto, 0), 4)))
             ) n;
    end if;
  end loop;

  -- Selar por último: se a geração falhar, o mês continua aberto e o operador
  -- pode corrigir e refechar. Selando primeiro, um erro na geração deixaria a
  -- competência trancada sem título — o pior dos dois estados.
  update public.consumo_competencia cc
     set fechado_em = now(), fechado_por = v_usuario
   where cc.tenant_id = v_tenant
     and cc.competencia = p_competencia
     and cc.fechado_em is null;

  /*
   * `row_count`, e não uma contagem por `fechado_por = v_usuario`.
   *
   * A contagem incluiria as linhas que esta mesma pessoa selou num fechamento
   * anterior da mesma competência, e o número devolvido cresceria a cada
   * refechamento — dizendo "selei 40" quando selou zero. O que se quer relatar
   * é o efeito **desta** chamada.
   */
  get diagnostics v_selados = row_count;

  return query select v_criados, v_disputa, v_selados, v_existiam;
end;
$$;

comment on function app.fechar_competencia(char) is
  'D-22. Sela o consumo e gera os títulos contratuais numa chamada. Idempotente pela chave (tenant, contrato, competência). RN-F10 e RN-F11 aplicadas aqui.';

-- =============================================================================
-- Isolamento
--
-- Aqui está a diferença que mais importa em relação ao Módulo 10.
--
-- `titulo_pagar` **não** tem política de cliente, e a ausência é testada: a
-- despesa da locadora não é assunto do locatário. `titulo_receber` é o oposto —
-- é a cobrança **do** cliente, e é o que o Portal do Cliente (Módulo 5) precisa
-- ler.
--
-- Mas não toda ela. Um título em PENDENTE_APROVACAO é pré-cobrança: o valor
-- ainda pode mudar, e mostrá-lo ao cliente é dar-lhe um número que a empresa
-- ainda não assumiu. O gate vai na própria expressão da política, aproveitando
-- que `app.cliente_visivel(null)` devolve **verdadeiro** sem contexto de cliente
-- (usuário da locadora) e falso com ele — o curto-circuito que a 0011 documenta.
--
-- `_rateio` e `_recebimento` não recebem política de cliente: centro de custo e
-- conta bancária de destino são dado interno da locadora.
-- =============================================================================
select app.habilitar_rls_tenant('titulo_receber');
select app.habilitar_rls_tenant('titulo_receber_rateio');
select app.habilitar_rls_tenant('titulo_receber_aprovacao');
select app.habilitar_rls_tenant('titulo_receber_recebimento');
select app.habilitar_rls_tenant('titulo_receber_contador');

select app.habilitar_rls_cliente(
  'titulo_receber',
  $$case when status = 'PENDENTE_APROVACAO' then null::uuid else cliente_id end$$
);

select app.habilitar_auditoria('titulo_receber');
select app.habilitar_auditoria('titulo_receber_aprovacao');

grant execute on function
  app.proximo_numero_titulo_receber(uuid),
  app.niveis_aprovacao_receber(numeric),
  app.posto_alcada_receber(uuid),
  app.pode_decidir_nivel_receber(uuid, integer),
  app.limite_desconto_percentual(uuid),
  app.saldo_titulo_receber(uuid),
  app.receita_realizada(char),
  app.baixar_sem_recebimento(uuid, text),
  app.receber_titulo(uuid, numeric, date, uuid, text),
  app.estornar_recebimento(uuid, text),
  app.valor_contratual_competencia(uuid, char),
  app.fechar_competencia(char)
  to iarx_app;
