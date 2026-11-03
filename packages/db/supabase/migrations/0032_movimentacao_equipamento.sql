-- =============================================================================
-- 0032 — Movimentação de equipamento (Anexo A.5)
--
-- A 0031 pôs a máquina de estados no banco. Ela diz quais transições existem;
-- não diz **quando cada uma aconteceu, por ordem de quem e com qual romaneio**.
-- Esse é o papel desta tabela, e é o que transforma `equipamento.status` de
-- campo digitado em efeito de um fato registrado.
--
-- A diferença aparece na primeira auditoria. Com status solto, a pergunta "por
-- que esta máquina está EM_MANUTENCAO desde setembro?" não tem resposta no
-- sistema — só o valor atual, sem quem o pôs lá nem por quê. Com o razão, a
-- resposta é uma linha: tipo, data, responsável, documento, observação.
--
-- ## Append-only, particionada por mês
--
-- Mesma forma de `leitura_medidor` e `movimento_estoque`: histórico de ativo
-- não se edita. Movimentação errada é corrigida por movimentação nova — e a
-- errada continua visível, porque alguém agiu com base nela.
--
-- ## Transferência é movimentação com aceite, não tabela própria
--
-- O Anexo A.5 dá a `movimentacao` as colunas `aceite_em` e `aceite_por`, e o
-- Anexo D expõe `POST /transferencias/{id}/aceitar`. O `{id}` é o da
-- movimentação: a transferência entre filiais é uma movimentação `TRANSFERENCIA`
-- que nasce pendente e vira efetiva no aceite do destino.
--
-- Uma tabela `transferencia` separada criaria dois lugares para responder "onde
-- está o ativo", e a timeline do equipamento teria de costurar os dois. Com uma
-- tabela só, a timeline é um `order by data_movimento`.
--
-- ## O que ficou de fora, e por quê
--
-- O Anexo A.5 também prevê `checklist_resposta_id`. As tabelas de checklist
-- ainda não existem, e uma coluna `uuid` apontando para tabela inexistente é
-- referência que ninguém valida — pior que a ausência, porque parece existir.
-- Ela entra junto com `checklist_modelo`/`checklist_resposta`, numa migração
-- que possa declarar a chave estrangeira de verdade.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'movimentacao_tipo') then
    create type app.movimentacao_tipo as enum (
      'ENTREGA',
      'RETORNO',
      'TRANSFERENCIA',
      'ENVIO_MANUTENCAO',
      'RETORNO_MANUTENCAO',
      'ENVIO_TERCEIRO',
      'BAIXA'
    );
  end if;
end $$;

create table if not exists public.movimentacao (
  id             uuid not null default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete restrict,
  equipamento_id uuid not null references public.equipamento(id) on delete restrict,

  tipo           app.movimentacao_tipo not null,

  /* Origem e destino são polimórficos porque o ativo circula entre coisas de
     naturezas diferentes: filial, local de operação do cliente, oficina de
     terceiro. Um par de FKs por destino possível daria sete colunas quase
     sempre nulas; o par (tipo, id) é conferido pelo gatilho abaixo. */
  origem_tipo    text,
  origem_id      uuid,
  destino_tipo   text,
  destino_id     uuid,

  contrato_item_id uuid references public.contrato_item(id) on delete restrict,
  ordem_servico_id uuid references public.ordem_servico(id) on delete restrict,
  leitura_id       uuid,

  data_movimento timestamptz not null default now(),
  responsavel_id uuid,
  documento_ref  text,
  observacao     text,

  /* O estado em que o ativo fica por causa desta movimentação. É o elo entre o
     razão e a máquina da 0031: o serviço aplica a transição e grava aqui qual
     foi, para que a timeline responda "o que mudou" sem recomputar nada. */
  status_resultante app.equipamento_status not null,

  /* Só a TRANSFERENCIA usa; nas demais ficam nulos. */
  aceite_em      timestamptz,
  aceite_por     uuid,

  created_at     timestamptz not null default now(),
  created_by     uuid,

  primary key (id, data_movimento),

  constraint movimentacao_local_coerente check (
    (origem_tipo is null) = (origem_id is null)
    and (destino_tipo is null) = (destino_id is null)
  ),
  constraint movimentacao_local_conhecido check (
    coalesce(origem_tipo, 'FILIAL') in ('FILIAL','LOCAL_OPERACAO','TERCEIRO')
    and coalesce(destino_tipo, 'FILIAL') in ('FILIAL','LOCAL_OPERACAO','TERCEIRO')
  ),
  /* Transferência sem destino é um ativo que saiu e não chegou. */
  constraint movimentacao_transferencia_com_destino check (
    tipo <> 'TRANSFERENCIA' or destino_id is not null
  ),
  /* O aceite é um fato com data e autor, ou não aconteceu. */
  constraint movimentacao_aceite_completo check (
    (aceite_em is null) = (aceite_por is null)
  ),
  /* Só transferência tem aceite: nas demais o fato se consuma na entrega. */
  constraint movimentacao_aceite_so_transferencia check (
    tipo = 'TRANSFERENCIA' or aceite_em is null
  )
) partition by range (data_movimento);

select app.garantir_particoes('movimentacao', 3);

create index if not exists movimentacao_equipamento_ix
  on public.movimentacao (tenant_id, equipamento_id, data_movimento desc);

create index if not exists movimentacao_pendente_ix
  on public.movimentacao (tenant_id, destino_id, data_movimento desc)
  where tipo = 'TRANSFERENCIA' and aceite_em is null;

comment on table public.movimentacao is
  'Anexo A.5. Razão append-only do ativo: cada linha é um fato, e equipamento.status é o efeito do último.';

-- -----------------------------------------------------------------------------
-- Coerência do alvo polimórfico
--
-- Mesmo problema de `anexo` na 0028: sem FK, o par (tipo, id) pode apontar para
-- nada, ou — pior — para a linha certa no locatário errado. O gatilho confere a
-- existência **dentro do tenant**, que é a parte que a FK sozinha não garantiria.
-- -----------------------------------------------------------------------------
create or replace function app.validar_movimentacao_local()
returns trigger
language plpgsql
as $$
declare v_ok boolean;
begin
  if new.destino_tipo = 'FILIAL' then
    select exists (select 1 from public.filial f
                    where f.id = new.destino_id and f.tenant_id = new.tenant_id)
      into v_ok;
    if not v_ok then
      raise exception 'filial de destino % não pertence ao locatário', new.destino_id
        using errcode = '23514', constraint = 'movimentacao_destino_inexistente';
    end if;
  elsif new.destino_tipo = 'LOCAL_OPERACAO' then
    select exists (select 1 from public.local_operacao l
                    where l.id = new.destino_id and l.tenant_id = new.tenant_id)
      into v_ok;
    if not v_ok then
      raise exception 'local de operação de destino % não pertence ao locatário', new.destino_id
        using errcode = '23514', constraint = 'movimentacao_destino_inexistente';
    end if;
  end if;

  if not exists (select 1 from public.equipamento e
                  where e.id = new.equipamento_id and e.tenant_id = new.tenant_id) then
    raise exception 'equipamento % não pertence ao locatário', new.equipamento_id
      using errcode = '23514', constraint = 'movimentacao_equipamento_inexistente';
  end if;

  /*
   * O item de contrato tem de ser **deste** ativo.
   *
   * Sem esta conferência, movimentar uma máquina encerra a cobrança de outra:
   * a entrega e o recebimento mexem no `contrato_item` apontado, e um id
   * trocado — por engano de integração ou por quem quer parar uma cobrança sem
   * deixar rastro — atingiria o contrato de um cliente que não teve nada
   * movimentado.
   *
   * Fica no gatilho e não só no serviço porque é coerência entre linhas
   * gravadas, do mesmo tipo que a do destino acima, e porque a única cópia que
   * nunca é esquecida é a que está no caminho de escrita.
   */
  if new.contrato_item_id is not null
     and not exists (
       select 1 from public.contrato_item ci
        where ci.id = new.contrato_item_id
          and ci.tenant_id = new.tenant_id
          and ci.equipamento_id = new.equipamento_id
     ) then
    raise exception 'item de contrato % não é do equipamento %',
          new.contrato_item_id, new.equipamento_id
      using errcode = '23514',
            constraint = 'movimentacao_item_de_outro_ativo',
            hint = 'A movimentação só mexe na cobrança do ativo que se moveu.';
  end if;

  return new;
end;
$$;

drop trigger if exists movimentacao_valida_local on public.movimentacao;
create trigger movimentacao_valida_local
  before insert on public.movimentacao
  for each row execute function app.validar_movimentacao_local();

-- -----------------------------------------------------------------------------
-- Imutabilidade — com a exceção estreita do aceite
--
-- O razão não se edita. A única escrita posterior admitida é o aceite da
-- transferência: ele é a segunda metade de um fato que nasce incompleto por
-- natureza, não a correção de um fato errado. Qualquer outra coluna que mude
-- recusa, e a recusa diz o que fazer no lugar.
-- -----------------------------------------------------------------------------
create or replace function app.movimentacao_imutavel()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'movimentação de equipamento não é apagada'
      using errcode = '23514',
            constraint = 'movimentacao_imutavel',
            hint = 'A correção é uma movimentação nova, não a remoção do histórico.';
  end if;

  if new.aceite_em is not null and old.aceite_em is null
     and to_jsonb(new) - 'aceite_em' - 'aceite_por' = to_jsonb(old) - 'aceite_em' - 'aceite_por' then
    return new;
  end if;

  raise exception 'movimentação de equipamento é imutável'
    using errcode = '23514',
          constraint = 'movimentacao_imutavel',
          hint = 'Registre uma movimentação de correção. O único UPDATE admitido é o aceite da transferência.';
end;
$$;

drop trigger if exists movimentacao_sem_edicao on public.movimentacao;
create trigger movimentacao_sem_edicao
  before update or delete on public.movimentacao
  for each row execute function app.movimentacao_imutavel();

-- -----------------------------------------------------------------------------
-- Gatilhos padrão, auditoria e RLS
--
-- Sem `touch_updated_at` e sem auditoria por diferença: a tabela já é o registro
-- imutável: auditar a trilha de um razão é guardar o mesmo fato duas vezes.
-- -----------------------------------------------------------------------------
select app.habilitar_rls_tenant('movimentacao', false);
