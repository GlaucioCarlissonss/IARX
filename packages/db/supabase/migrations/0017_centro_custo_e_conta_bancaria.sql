-- =============================================================================
-- 0017 — Centro de custo e conta bancária: a base do bloco financeiro
--
-- Referências: docs/anexos/L-lacunas-funcionais.md (Módulos 8 e 9)
-- Invariantes: RN-L42 (profundidade e ciclo do centro de custo),
--              RN-L43 (inativar centro com filho ativo é recusado),
--              RN-L44 (saldo de conta é derivado, nunca gravado),
--              RN-L45 (transferência é dupla entrada, ou nenhuma),
--              RN-L46 (movimentação não se edita nem se apaga),
--              RN-L47 (conta bloqueada não aceita movimentação manual)
--
-- Continuando a renumeração:
--   RN-L42…L43  centro de custo
--   RN-L44…L47  conta bancária e movimentação
--
-- Estes dois módulos vêm primeiro no bloco financeiro por uma razão de ordem,
-- não de tamanho: todo título a pagar ou a receber referencia um centro de
-- custo, e toda baixa referencia uma conta. Construir contas a pagar antes
-- obrigaria a inventar um lugar temporário para as duas coisas, e um lugar
-- temporário num banco relacional é uma FK que depois não se remove.
--
-- Decisões do operador incorporadas aqui:
--   D-16  rateio por PERCENTUAL (a tabela de rateio vive com o título, no
--         Módulo 10; o que fica aqui é o centro em si)
--   D-17  OFX primeiro na importação de extrato — `origem_extrato` guarda a
--         linha original para auditoria, independente do formato
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Centro de custo
--
-- `empresa_id` nulo significa centro global do locatário, e é o caso comum:
-- "Administrativo" raramente pertence a uma PJ só. Nulo aqui é ausência
-- deliberada de vínculo, não dado faltando.
-- -----------------------------------------------------------------------------
create table if not exists public.centro_custo (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  empresa_id    uuid references public.empresa(id) on delete restrict,
  codigo        text not null,
  nome          text not null,
  descricao     text,
  centro_pai_id uuid references public.centro_custo(id) on delete restrict,
  ativo         boolean not null default true,
  version       integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  constraint centro_custo_codigo_nao_vazio check (length(btrim(codigo)) > 0),
  constraint centro_custo_nome_nao_vazio check (length(btrim(nome)) > 0),
  -- Pai igual a si mesmo é o ciclo de tamanho 1, e é o único que um CHECK
  -- alcança. Os demais são trabalho do gatilho da RN-L42.
  constraint centro_custo_pai_nao_e_ele_mesmo check (centro_pai_id is null or centro_pai_id <> id)
);

create unique index if not exists centro_custo_codigo_uk
  on public.centro_custo (tenant_id, upper(btrim(codigo))) where deleted_at is null;

-- Monta a árvore sem varrer a tabela a cada nível.
create index if not exists centro_custo_pai_ix
  on public.centro_custo (tenant_id, centro_pai_id) where deleted_at is null;

comment on table public.centro_custo is
  'Dimensão de análise do locador, hierárquica até 3 níveis. Filial é uma dimensão só, e duas equipes na mesma filial não se distinguem por ela.';
comment on column public.centro_custo.empresa_id is
  'Nulo = centro global do locatário. Ausência deliberada de vínculo, não dado faltando.';

-- -----------------------------------------------------------------------------
-- RN-L42 · profundidade máxima 3, e ciclo impossível
--
-- Em gatilho porque `CHECK` não alcança recursão: a profundidade de um nó
-- depende de outras linhas da mesma tabela.
--
-- O ciclo não precisa de checagem própria — sai de graça da mesma travessia.
-- Subindo a cadeia de pais a partir do pai declarado, se o próprio id aparecer
-- no caminho, a cadeia se fecha. Sem essa parada, um ciclo faria o laço rodar
-- para sempre, e o primeiro sintoma seria uma conexão presa em produção.
--
-- O limite de segurança (`i > 64`) existe para o caso de a tabela já conter um
-- ciclo gravado antes deste gatilho existir. Nesse caso a travessia nunca
-- encontraria `new.id`, porque `new.id` não faz parte do ciclo antigo.
-- -----------------------------------------------------------------------------
create or replace function app.validar_centro_custo()
returns trigger
language plpgsql
as $$
declare
  v_pai uuid := new.centro_pai_id;
  v_nivel integer := 1;
  i integer := 0;
begin
  while v_pai is not null loop
    i := i + 1;
    if i > 64 then
      raise exception 'Cadeia de centros de custo sem fim: há um ciclo já gravado acima de %.', new.codigo
        using errcode = 'check_violation', column = 'centro_pai_id', table = 'centro_custo';
    end if;

    if v_pai = new.id then
      raise exception 'Centro de custo % não pode descender de si mesmo.', new.codigo
        using errcode = 'check_violation',
              column = 'centro_pai_id',
              table = 'centro_custo',
              hint = 'Escolha um centro pai que não esteja abaixo deste na árvore.';
    end if;

    v_nivel := v_nivel + 1;
    if v_nivel > 3 then
      raise exception 'Centro de custo % ficaria no nível %: o máximo é 3.', new.codigo, v_nivel
        using errcode = 'check_violation',
              column = 'centro_pai_id',
              table = 'centro_custo',
              hint = 'Acima de três níveis a árvore deixa de ser legível numa tela.';
    end if;

    select centro_pai_id into v_pai from public.centro_custo where id = v_pai;
  end loop;

  return new;
end;
$$;

comment on function app.validar_centro_custo() is
  'RN-L42. Profundidade máxima 3 e ciclo impossível, na mesma travessia — o ciclo é a condição de parada, não uma segunda checagem.';

drop trigger if exists centro_custo_valida on public.centro_custo;
create trigger centro_custo_valida
  before insert or update of centro_pai_id on public.centro_custo
  for each row execute function app.validar_centro_custo();

-- -----------------------------------------------------------------------------
-- RN-L43 · inativar centro com filho ativo é recusado
--
-- Inativar em cascata seria uma ação destrutiva silenciosa: o operador clica em
-- um nó e desliga uma subárvore que não estava vendo. A recusa obriga a
-- inativar a folha primeiro, o que torna a extensão do estrago visível antes
-- de ele acontecer.
-- -----------------------------------------------------------------------------
create or replace function app.validar_inativacao_centro_custo()
returns trigger
language plpgsql
as $$
declare
  v_filhos integer;
begin
  if new.ativo or old.ativo = new.ativo then
    return new;
  end if;

  select count(*) into v_filhos
  from public.centro_custo
  where centro_pai_id = new.id and ativo and deleted_at is null;

  if v_filhos > 0 then
    raise exception 'Centro de custo % tem % subcentro(s) ativo(s).', new.codigo, v_filhos
      using errcode = 'check_violation',
            column = 'ativo',
            table = 'centro_custo',
            hint = 'Inative os subcentros primeiro — inativar em cascata desligaria o que não está à vista.';
  end if;

  return new;
end;
$$;

drop trigger if exists centro_custo_valida_inativacao on public.centro_custo;
create trigger centro_custo_valida_inativacao
  before update of ativo on public.centro_custo
  for each row execute function app.validar_inativacao_centro_custo();

-- -----------------------------------------------------------------------------
-- Conta bancária
--
-- Toda conta pertence a uma PJ: `empresa_id` é NOT NULL, ao contrário do centro
-- de custo. Uma conta sem titular é uma conta que ninguém audita.
-- -----------------------------------------------------------------------------
create table if not exists public.conta_bancaria (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete restrict,
  empresa_id     uuid not null references public.empresa(id) on delete restrict,
  banco_codigo   text not null,
  agencia        text not null,
  numero         text not null,
  tipo           text not null,
  apelido        text not null,
  saldo_inicial  numeric(15,4) not null default 0,
  data_saldo_inicial date not null,
  limite_credito numeric(15,4),
  status         text not null default 'ATIVA',
  version        integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  constraint conta_bancaria_tipo_valido check (tipo in ('CORRENTE', 'POUPANCA', 'PAGAMENTO')),
  constraint conta_bancaria_status_valido check (status in ('ATIVA', 'INATIVA', 'BLOQUEADA')),
  -- Código FEBRABAN: três dígitos, com zeros à esquerda preservados ('001' é o
  -- Banco do Brasil, e 1 não é a mesma coisa). Guardado como texto por isso.
  constraint conta_bancaria_banco_codigo_valido check (banco_codigo ~ '^[0-9]{3}$'),
  constraint conta_bancaria_apelido_nao_vazio check (length(btrim(apelido)) > 0),
  constraint conta_bancaria_limite_nao_negativo check (coalesce(limite_credito, 0) >= 0)
);

create unique index if not exists conta_bancaria_identificacao_uk
  on public.conta_bancaria (tenant_id, empresa_id, banco_codigo, agencia, numero)
  where deleted_at is null;

comment on column public.conta_bancaria.apelido is
  'Como a operação chama a conta: "Operação", "Folha", "Investimento". É o que aparece no seletor de baixa — agência e número não distinguem nada para quem escolhe.';
comment on column public.conta_bancaria.limite_credito is
  'Cheque especial. O que acontece ao ultrapassá-lo é decisão do Módulo 13, que tem a visão projetada; aqui é só o teto declarado.';

-- -----------------------------------------------------------------------------
-- Movimentação bancária
--
-- As FKs para título a pagar e a receber ficam para a migração dos Módulos 10 e
-- 11 — as tabelas ainda não existem, e criar a coluna sem a referência
-- deixaria um id solto que nada garante. As colunas entram junto com as
-- tabelas que elas apontam.
-- -----------------------------------------------------------------------------
create table if not exists public.movimentacao_bancaria (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete restrict,
  conta_id        uuid not null references public.conta_bancaria(id) on delete restrict,
  tipo            text not null,
  valor           numeric(15,4) not null,
  data_movimento  date not null,
  descricao       text not null,
  /** A outra ponta da transferência. Nulo em tudo que não é transferência. */
  transferencia_par_id uuid references public.movimentacao_bancaria(id) on delete restrict,
  conciliado      boolean not null default false,
  conciliado_em   timestamptz,
  /** Linha original do extrato importado, para auditoria da conciliação. */
  origem_extrato  text,
  /** Estorno: aponta a movimentação que ele contraria. Nunca a apaga. */
  estorna_id      uuid references public.movimentacao_bancaria(id) on delete restrict,
  motivo          text,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint movimentacao_tipo_valido check (
    tipo in ('ENTRADA', 'SAIDA', 'TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SAIDA', 'TAXA')
  ),
  -- Valor sempre positivo: o sinal é o tipo, não o número. Permitir negativo
  -- criaria duas formas de gravar a mesma saída, e toda soma passaria a
  -- precisar saber qual das duas está lendo.
  constraint movimentacao_valor_positivo check (valor > 0),
  constraint movimentacao_descricao_nao_vazia check (length(btrim(descricao)) > 0),
  constraint movimentacao_conciliado_tem_data check (
    (conciliado and conciliado_em is not null) or (not conciliado and conciliado_em is null)
  ),
  constraint movimentacao_estorno_tem_motivo check (
    estorna_id is null or length(btrim(coalesce(motivo, ''))) > 0
  ),
  constraint movimentacao_transferencia_tem_par check (
    (tipo in ('TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SAIDA')) = (transferencia_par_id is not null)
      or transferencia_par_id is null
  )
);

create index if not exists movimentacao_extrato_ix
  on public.movimentacao_bancaria (tenant_id, conta_id, data_movimento desc);

-- Fila de conciliação: parcial, porque o que interessa é o que falta conciliar.
create index if not exists movimentacao_pendente_conciliacao_ix
  on public.movimentacao_bancaria (tenant_id, conta_id) where not conciliado;

comment on column public.movimentacao_bancaria.valor is
  'Sempre positivo. O sinal é o tipo — permitir negativo criaria duas formas de gravar a mesma saída.';

-- -----------------------------------------------------------------------------
-- RN-L44 · saldo é derivado, nunca gravado
--
-- Não há coluna de saldo, e é a única garantia real de que saldo e
-- movimentações não divergem. Uma coluna mantida por gatilho divergiria na
-- primeira correção manual em produção — e a correção manual em produção
-- acontece.
--
-- Mesma escolha de `custo_aquisicao` na nota fiscal (Anexo N): se não existe
-- caminho de escrita, não existe caminho de divergência.
--
-- `p_ate` permite saldo em data passada, que é o que a conciliação precisa:
-- comparar com o extrato do dia 31 exige o saldo do dia 31, não o de hoje.
-- -----------------------------------------------------------------------------
create or replace function app.saldo_conta(p_conta_id uuid, p_ate date default null)
returns numeric
language sql
stable
as $$
  select c.saldo_inicial + coalesce(sum(
    case
      when m.tipo in ('ENTRADA', 'TRANSFERENCIA_ENTRADA') then m.valor
      else -m.valor
    end
  ), 0)
  from public.conta_bancaria c
  left join public.movimentacao_bancaria m
    on m.conta_id = c.id
   -- Movimentação anterior ao saldo inicial não conta: o saldo inicial já a
   -- inclui, por definição de "saldo naquela data".
   and m.data_movimento >= c.data_saldo_inicial
   and (p_ate is null or m.data_movimento <= p_ate)
  where c.id = p_conta_id and c.deleted_at is null
  group by c.saldo_inicial;
$$;

comment on function app.saldo_conta(uuid, date) is
  'RN-L44. Saldo derivado das movimentações. Não existe coluna de saldo, logo não existe saldo divergente.';

-- -----------------------------------------------------------------------------
-- RN-L46 · movimentação não se edita nem se apaga
--
-- Estorno é lançamento contrário com motivo, apontando o estornado. A mesma
-- filosofia de `app.auditar()`: histórico não é reescrito.
--
-- Duas exceções, e as duas são deliberadas:
--
--  · **Conciliação.** Conciliar não muda o fato financeiro, muda o que sabemos
--    sobre ele.
--  · **Fechamento do par da transferência, uma vez só.** Cada perna precisa do
--    id da outra, e nenhuma existe antes de ser inserida — não há como gravar
--    o par no INSERT. O que a regra impede é **reapontar**: de nulo para um
--    valor, sim; de um valor para outro ou de volta para nulo, nunca. Sem essa
--    metade, um `update` posterior poderia costurar a perna de uma
--    transferência na perna de outra, e a dupla entrada deixaria de fechar sem
--    que nenhuma linha parecesse errada.
-- -----------------------------------------------------------------------------
create or replace function app.impedir_reescrita_movimentacao()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Movimentação bancária não se apaga. Lance o estorno.'
      using errcode = 'check_violation',
            table = 'movimentacao_bancaria',
            hint = 'Crie uma movimentação de tipo contrário com estorna_id e motivo.';
  end if;

  if row(new.conta_id, new.tipo, new.valor, new.data_movimento, new.descricao,
         new.estorna_id)
     is distinct from
     row(old.conta_id, old.tipo, old.valor, old.data_movimento, old.descricao,
         old.estorna_id) then
    raise exception 'Movimentação bancária não se edita. Lance o estorno.'
      using errcode = 'check_violation',
            table = 'movimentacao_bancaria',
            hint = 'Só a conciliação e o fechamento do par de transferência mudam depois do lançamento.';
  end if;

  if old.transferencia_par_id is not null
     and new.transferencia_par_id is distinct from old.transferencia_par_id then
    raise exception 'O par de uma transferência não se reaponta.'
      using errcode = 'check_violation',
            column = 'transferencia_par_id',
            table = 'movimentacao_bancaria',
            hint = 'Estorne as duas pernas e lance a transferência de novo.';
  end if;

  return new;
end;
$$;

comment on function app.impedir_reescrita_movimentacao() is
  'RN-L46. Depois do lançamento só mudam a conciliação e o fechamento do par de transferência — este uma vez só, de nulo para um valor, nunca reapontado.';

drop trigger if exists movimentacao_sem_reescrita on public.movimentacao_bancaria;
create trigger movimentacao_sem_reescrita
  before update or delete on public.movimentacao_bancaria
  for each row execute function app.impedir_reescrita_movimentacao();

-- -----------------------------------------------------------------------------
-- RN-L47 · conta bloqueada não aceita movimentação manual
--
-- "Manual" é o que não tem `origem_extrato` nem `estorna_id`: importação de
-- extrato e estorno continuam passando. A razão é operacional — bloquear uma
-- conta no meio de uma baixa em curso não deve travar a baixa, e não deve
-- impedir desfazer o que já entrou errado.
--
-- Conta inativa e conta apagada recusam qualquer lançamento, sem exceção.
-- -----------------------------------------------------------------------------
create or replace function app.validar_movimentacao_conta()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_apagada boolean;
begin
  select status, deleted_at is not null into v_status, v_apagada
  from public.conta_bancaria where id = new.conta_id;

  if v_apagada then
    raise exception 'Conta bancária excluída não recebe movimentação.'
      using errcode = 'check_violation', column = 'conta_id', table = 'movimentacao_bancaria';
  end if;

  if v_status = 'INATIVA' then
    raise exception 'Conta bancária inativa não recebe movimentação.'
      using errcode = 'check_violation',
            column = 'conta_id',
            table = 'movimentacao_bancaria',
            hint = 'Reative a conta ou escolha outra.';
  end if;

  if v_status = 'BLOQUEADA'
     and new.origem_extrato is null
     and new.estorna_id is null then
    raise exception 'Conta bancária bloqueada não aceita lançamento manual.'
      using errcode = 'check_violation',
            column = 'conta_id',
            table = 'movimentacao_bancaria',
            hint = 'Importação de extrato e estorno continuam permitidos; lançamento manual, não.';
  end if;

  return new;
end;
$$;

drop trigger if exists movimentacao_valida_conta on public.movimentacao_bancaria;
create trigger movimentacao_valida_conta
  before insert on public.movimentacao_bancaria
  for each row execute function app.validar_movimentacao_conta();

-- -----------------------------------------------------------------------------
-- RN-L45 · transferência é dupla entrada, ou nenhuma
--
-- A função existe para que não haja como fazer diferente. Duas chamadas de
-- INSERT numa camada de aplicação são duas chamadas que alguém pode separar —
-- por um `try` mal colocado, por um retry parcial, por uma refatoração. Uma
-- função é uma chamada, e uma chamada é atômica.
--
-- O par é fechado depois dos dois inserts porque cada linha precisa do id da
-- outra, e nenhum dos dois existe antes de ser inserido. `deferrable` na FK
-- resolveria isso também, mas exigiria que todo chamador soubesse disso.
-- -----------------------------------------------------------------------------
create or replace function app.transferir_entre_contas(
  p_origem_id  uuid,
  p_destino_id uuid,
  p_valor      numeric,
  p_data       date,
  p_descricao  text
)
returns table (saida_id uuid, entrada_id uuid)
language plpgsql
as $$
declare
  v_tenant uuid := app.exigir_tenant();
  v_saida uuid;
  v_entrada uuid;
begin
  if p_origem_id = p_destino_id then
    raise exception 'Transferência precisa de duas contas distintas.'
      using errcode = 'check_violation', column = 'conta_destino_id';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'Valor da transferência tem de ser positivo.'
      using errcode = 'check_violation', column = 'valor';
  end if;

  insert into public.movimentacao_bancaria
    (tenant_id, conta_id, tipo, valor, data_movimento, descricao, created_by)
  values (v_tenant, p_origem_id, 'TRANSFERENCIA_SAIDA', p_valor, p_data, p_descricao, app.usuario_atual())
  returning id into v_saida;

  insert into public.movimentacao_bancaria
    (tenant_id, conta_id, tipo, valor, data_movimento, descricao, created_by)
  values (v_tenant, p_destino_id, 'TRANSFERENCIA_ENTRADA', p_valor, p_data, p_descricao, app.usuario_atual())
  returning id into v_entrada;

  -- O gatilho de RN-L46 permite: `transferencia_par_id` sai de nulo para o par
  -- na mesma transação do insert, e é o único momento em que ele muda.
  update public.movimentacao_bancaria set transferencia_par_id = v_entrada where id = v_saida;
  update public.movimentacao_bancaria set transferencia_par_id = v_saida where id = v_entrada;

  return query select v_saida, v_entrada;
end;
$$;

comment on function app.transferir_entre_contas(uuid, uuid, numeric, date, text) is
  'RN-L45. Dupla entrada numa chamada só. Duas chamadas separadas são duas chamadas que alguém pode separar.';

-- -----------------------------------------------------------------------------
-- Isolamento e auditoria
--
-- Nenhuma das três tabelas tem leitura de cliente: centro de custo e conta
-- bancária são estrutura interna do locador, e o portal nunca as vê. É a razão
-- de `p_leitura_cliente` ficar no padrão `false`.
-- -----------------------------------------------------------------------------
select app.habilitar_rls_tenant('centro_custo');
select app.habilitar_rls_tenant('conta_bancaria');
select app.habilitar_rls_tenant('movimentacao_bancaria');

select app.habilitar_auditoria('centro_custo');
select app.habilitar_auditoria('conta_bancaria');
-- Movimentação não entra na auditoria de alteração: ela **é** o registro
-- imutável. Auditar quem alterou uma linha que não pode ser alterada seria
-- guardar uma tabela vazia.

grant execute on function app.saldo_conta(uuid, date) to iarx_app;
grant execute on function app.transferir_entre_contas(uuid, uuid, numeric, date, text) to iarx_app;
revoke all on function app.transferir_entre_contas(uuid, uuid, numeric, date, text) from public;
