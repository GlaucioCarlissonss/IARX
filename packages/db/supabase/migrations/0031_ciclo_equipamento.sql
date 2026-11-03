-- =============================================================================
-- 0031 — Ciclo de vida do equipamento (Anexo B.2)
--
-- Terceira máquina de estados que existia no papel e não no banco. A da ordem
-- de serviço entrou na 0026, a do contrato na 0029, e esta ficou por último
-- por ser a mais entrelaçada: o estado do ativo depende de contrato e de ordem
-- de serviço, e é consultado por ambos.
--
-- Com o enum de dez valores e nenhum gatilho, `update equipamento set status =
-- 'DISPONIVEL'` tira uma máquina locada da posse do cliente e a devolve à base
-- alocável sem que nada tenha sido devolvido. O próximo contrato a alocá-la
-- acha que tem equipamento, e quem vai entregar descobre no cliente.
--
-- ## O que mora aqui, e o que não
--
-- Aqui: **quais transições existem** e as pré-condições que dependem de dado já
-- gravado — ativo alocado não é baixado, volta de manutenção não libera o que
-- ainda está em contrato.
--
-- Na aplicação: alçada para bloqueio manual e aceite de transferência entre
-- filiais, que dependem de quem está agindo.
--
-- RN-007 em particular — "sem alocação, OS, reserva ou saldo pendente" para
-- baixar — fica aqui porque é a checagem que protege contra o descarte
-- contábil de um ativo que ainda está em campo.
--
-- ## Correção de rota: `BLOQUEADO` era um estado que ninguém lia
--
-- `app.equipamento_status` nasceu na 0004 com `BLOQUEADO`, e a guarda de
-- alocação da 0005 (`app.validar_coerencia_item`) confere a flag booleana
-- `equipamento.bloqueado` e uma lista de status que **não inclui** `BLOQUEADO`.
-- As duas colunas representam fatos diferentes e legítimos — a flag é o
-- bloqueio-atributo (preventiva vencida, RN-014, que convive com `LOCADO`) e o
-- status é o estado operacional — mas o status `BLOQUEADO` significa, sem
-- ambiguidade, "não aloque". Ele estava fora da lista.
--
-- Hoje isso não produziu dado ruim porque nada escrevia esse status (não havia
-- rota). A partir desta migração passa a haver, então a lista é corrigida
-- antes de a transição existir, e não depois.
-- =============================================================================

create or replace function app.equipamento_transicao_valida(
  p_de   app.equipamento_status,
  p_para app.equipamento_status
)
returns boolean
language sql
immutable
as $$
  select
    -- Bloqueio e extravio vêm de qualquer estado: são fatos, não etapas.
    -- `BLOQUEADO` é preventiva vencida ou decisão de alçada; `EXTRAVIADO` é o
    -- registro de que a máquina não está onde deveria. Restringir a origem
    -- obrigaria a passar por um estado intermediário que não aconteceu.
    p_para in ('BLOQUEADO', 'EXTRAVIADO')
    or (p_de, p_para) in (
      ('DISPONIVEL','RESERVADO'),
      ('RESERVADO','EM_TRANSITO_ENTREGA'),
      ('RESERVADO','DISPONIVEL'),            -- reserva liberada
      ('EM_TRANSITO_ENTREGA','LOCADO'),
      ('EM_TRANSITO_ENTREGA','DISPONIVEL'),  -- transferência entre filiais
      ('LOCADO','EM_TRANSITO_RETORNO'),
      ('EM_TRANSITO_RETORNO','EM_INSPECAO'),
      ('EM_INSPECAO','DISPONIVEL'),
      ('EM_INSPECAO','EM_MANUTENCAO'),
      ('DISPONIVEL','EM_TRANSITO_ENTREGA'),  -- transferência de filial
      ('DISPONIVEL','EM_MANUTENCAO'),
      ('LOCADO','EM_MANUTENCAO'),
      -- Volta da manutenção: para onde estava, e o gatilho confere qual é.
      ('EM_MANUTENCAO','DISPONIVEL'),
      ('EM_MANUTENCAO','LOCADO'),
      ('BLOQUEADO','DISPONIVEL'),
      ('BLOQUEADO','EM_MANUTENCAO'),
      -- Baixa: só do que não está em campo.
      ('DISPONIVEL','BAIXADO'),
      ('EM_INSPECAO','BAIXADO'),
      ('EXTRAVIADO','BAIXADO'),
      ('BLOQUEADO','BAIXADO')
    );
$$;

comment on function app.equipamento_transicao_valida(app.equipamento_status, app.equipamento_status) is
  'Anexo B.2. BLOQUEADO e EXTRAVIADO são alcançáveis de qualquer estado: são fatos, não etapas.';

create or replace function app.validar_equipamento_transicao()
returns trigger
language plpgsql
as $$
declare v_n integer;
begin
  if new.status = old.status then
    return new;
  end if;

  if not app.equipamento_transicao_valida(old.status, new.status) then
    raise exception 'transição de equipamento inválida: % → %', old.status, new.status
      using errcode = '23514',
            constraint = 'equipamento_transicao_valida',
            hint = 'Ver Anexo B.2.';
  end if;

  /*
   * RN-007 — baixa exige que o ativo não esteja em lugar nenhum.
   *
   * Baixa é o encerramento patrimonial: o ativo sai do balanço e da base
   * alocável. Fazê-la com item de contrato vigente é descartar contabilmente
   * uma máquina que está na mesa de alguém — e o cliente continua pagando por
   * um equipamento que o sistema diz não existir.
   */
  if new.status = 'BAIXADO' then
    select count(*) into v_n
      from public.contrato_item ci
     where ci.equipamento_id = new.id
       and ci.status in ('RESERVADO','EM_ENTREGA','ATIVO','SUSPENSO','EM_DEVOLUCAO')
       and ci.deleted_at is null;
    if v_n > 0 then
      raise exception 'equipamento com % alocação(ões) vigente(s) não é baixado', v_n
        using errcode = '23514',
              constraint = 'equipamento_alocado_nao_baixa',
              hint = 'Encerre os itens de contrato antes da baixa.';
    end if;

    select count(*) into v_n
      from public.ordem_servico o
     where o.equipamento_id = new.id
       and o.status not in ('VALIDADA','CANCELADA')
       and o.deleted_at is null;
    if v_n > 0 then
      raise exception 'equipamento com % ordem(ns) de serviço aberta(s) não é baixado', v_n
        using errcode = '23514',
              constraint = 'equipamento_com_os_nao_baixa',
              hint = 'Conclua ou cancele as ordens antes da baixa.';
    end if;
  end if;

  /*
   * Volta da manutenção vai para onde o ativo estava — e quem sabe isso é o
   * contrato, não quem digita.
   *
   * O erro que esta checagem impede é o mais caro do módulo: a máquina volta
   * do conserto, alguém marca DISPONÍVEL por hábito, e ela entra na base
   * alocável enquanto o item de contrato do cliente segue vigente. O próximo
   * contrato a reservá-la encontra um ativo "livre" que está na mesa de outro
   * cliente, e a descoberta acontece na entrega.
   */
  if old.status = 'EM_MANUTENCAO' then
    select count(*) into v_n
      from public.contrato_item ci
     where ci.equipamento_id = new.id
       and ci.status in ('ATIVO','EM_ENTREGA','SUSPENSO')
       and ci.deleted_at is null;

    if new.status = 'DISPONIVEL' and v_n > 0 then
      raise exception 'equipamento ainda alocado em % item(ns) de contrato', v_n
        using errcode = '23514',
              constraint = 'equipamento_retorno_alocado',
              hint = 'O retorno de manutenção de ativo em contrato vigente é LOCADO.';
    end if;

    if new.status = 'LOCADO' and v_n = 0 then
      raise exception 'equipamento sem item de contrato vigente não retorna como locado'
        using errcode = '23514',
              constraint = 'equipamento_retorno_sem_contrato',
              hint = 'O retorno de manutenção de ativo sem contrato é DISPONIVEL.';
    end if;
  end if;

  /*
   * Reservar exige ativo livre de fato.
   *
   * A transição `DISPONIVEL → RESERVADO` já garante o estado de origem; o que
   * esta checagem acrescenta é a alocação concorrente. RN-001 impede dois itens
   * de contrato sobrepostos no mesmo equipamento por `EXCLUDE USING gist`, e
   * esta mensagem existe para que a recusa chegue nomeada, em vez de como
   * conflito de índice.
   */
  if new.status = 'RESERVADO' then
    select count(*) into v_n
      from public.contrato_item ci
     where ci.equipamento_id = new.id
       and ci.status in ('ATIVO','EM_ENTREGA','SUSPENSO')
       and ci.deleted_at is null;
    if v_n > 0 then
      raise exception 'equipamento já alocado em % item(ns) vigente(s)', v_n
        using errcode = '23514',
              constraint = 'equipamento_ja_alocado',
              hint = 'Encerre a alocação atual antes de reservar para outro contrato.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists equipamento_transicao on public.equipamento;
create trigger equipamento_transicao
  before update of status on public.equipamento
  for each row execute function app.validar_equipamento_transicao();

-- -----------------------------------------------------------------------------
-- Correção: `BLOQUEADO` entra na lista de status que impedem alocação.
--
-- Corpo idêntico ao da 0005, com `'BLOQUEADO'` acrescentado à lista. Está
-- reescrito por inteiro porque `create or replace function` não aceita emenda —
-- e porque uma função de guarda que o leitor não consegue ler inteira num lugar
-- só é uma guarda que ninguém revisa.
-- -----------------------------------------------------------------------------

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
             or e.status in ('EM_MANUTENCAO','EXTRAVIADO','BAIXADO','BLOQUEADO',
                             'EM_TRANSITO_ENTREGA','EM_TRANSITO_RETORNO'))
    ) then
      raise exception 'equipamento % indisponível para alocação', new.equipamento_id
        using errcode = '23514',
              constraint = 'equipamento_indisponivel_alocacao',
              hint = 'Ver RN-003 e RN-014: verifique bloqueio por preventiva vencida ou estado operacional.';
    end if;
  end if;

  return new;
end;
$$;
