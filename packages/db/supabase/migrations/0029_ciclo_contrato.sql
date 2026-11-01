-- =============================================================================
-- 0029 — Ciclo de vida do contrato (Anexo B.2)
--
-- A máquina de estados do contrato existia no papel e não no banco. A da ordem
-- de serviço foi imposta por gatilho na 0026; esta ficou de fora, e a
-- diferença não é de rigor — é de garantia. Com o enum `contrato_status` e
-- nenhum gatilho, `update contrato set status = 'ATIVO'` leva um rascunho
-- direto para ativo, sem aprovação e sem assinatura, por qualquer caminho de
-- escrita.
--
-- Quem encontrou a lacuna foi o portão de cobertura de rotas: dezoito
-- permissões de ciclo no Anexo C sem rota nenhuma. O levantamento que eu havia
-- feito à mão não as incluía — listar o que falta de memória é listar o que se
-- lembra.
--
-- ## O que fica aqui e o que fica na aplicação
--
-- Aqui: **quais transições existem**, e as pré-condições que dependem de dado
-- já gravado — contrato sem item não vai para aprovação, contrato com item em
-- campo não encerra. São as que precisam valer para importação e correção
-- manual, não só para quem passa pela API.
--
-- Na aplicação: alçada de desconto e situação de crédito. As duas dependem de
-- contexto que o banco não tem na transação de escrita — quem está aprovando,
-- e com que poder.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Colunas que o ciclo exige e não existiam
--
-- Suspensão e distrato sem motivo são as duas decisões que alguém vai auditar:
-- a primeira interrompe faturamento, a segunda calcula multa. Sem motivo
-- gravado, nenhuma das duas se explica seis meses depois.
-- -----------------------------------------------------------------------------
alter table public.contrato
  add column if not exists motivo_status text,
  add column if not exists suspenso_em timestamptz,
  add column if not exists encerrado_em timestamptz,
  add column if not exists distratado_em timestamptz;

comment on column public.contrato.motivo_status is
  'Por que o contrato está no estado atual. Obrigatório nas transições que '
  'interrompem faturamento ou encerram o contrato — ver o gatilho contrato_transicao.';

-- -----------------------------------------------------------------------------
-- As transições, como dado
--
-- Mesma forma da 0026: acrescentar uma transição é acrescentar um par, e ler o
-- que é permitido é ler uma lista em vez de desembaraçar condições aninhadas.
-- -----------------------------------------------------------------------------
create or replace function app.contrato_transicao_valida(
  p_de   app.contrato_status,
  p_para app.contrato_status
)
returns boolean
language sql
immutable
as $$
  select (p_de, p_para) in (
    ('RASCUNHO','EM_APROVACAO'),
    ('EM_APROVACAO','AGUARDANDO_ASSINATURA'),
    ('EM_APROVACAO','RASCUNHO'),              -- reprovação devolve para ajuste
    ('AGUARDANDO_ASSINATURA','ATIVO'),
    ('ATIVO','SUSPENSO'),
    ('SUSPENSO','ATIVO'),
    ('ATIVO','EM_RENOVACAO'),
    ('EM_RENOVACAO','ATIVO'),
    ('ATIVO','VENCIDO_EM_CAMPO'),
    ('VENCIDO_EM_CAMPO','ATIVO'),             -- itens recolhidos, volta a vigorar
    ('ATIVO','DISTRATADO'),
    -- `* → ENCERRADO`: de qualquer estado em que o contrato já vigorou.
    ('ATIVO','ENCERRADO'),
    ('SUSPENSO','ENCERRADO'),
    ('EM_RENOVACAO','ENCERRADO'),
    ('VENCIDO_EM_CAMPO','ENCERRADO'),
    ('DISTRATADO','ENCERRADO'),
    -- `pré-ATIVO → CANCELADO`: antes de qualquer item ter sido entregue.
    ('RASCUNHO','CANCELADO'),
    ('EM_APROVACAO','CANCELADO'),
    ('AGUARDANDO_ASSINATURA','CANCELADO')
  );
$$;

comment on function app.contrato_transicao_valida(app.contrato_status, app.contrato_status) is
  'Anexo B.2. Renovação que muda vigência cria nova versão (contrato_pai_id), não volta o status.';

create or replace function app.validar_contrato_transicao()
returns trigger
language plpgsql
as $$
declare v_itens integer;
begin
  if new.status = old.status then
    return new;
  end if;

  if not app.contrato_transicao_valida(old.status, new.status) then
    raise exception 'transição de contrato inválida: % → %', old.status, new.status
      using errcode = '23514',
            constraint = 'contrato_transicao_valida',
            hint = 'Ver Anexo B.2.';
  end if;

  /*
   * Submeter exige item.
   *
   * Contrato sem item em aprovação é um pedido para o gestor aprovar nada: ele
   * aprova, o contrato ativa, e a primeira competência fecha em zero sem que
   * ninguém saiba por quê.
   */
  if new.status = 'EM_APROVACAO' then
    select count(*) into v_itens
      from public.contrato_item ci
     where ci.contrato_id = new.id and ci.status <> 'CANCELADO';
    if v_itens = 0 then
      raise exception 'contrato sem item não vai para aprovação'
        using errcode = '23514',
              constraint = 'contrato_sem_item',
              hint = 'Acrescente ao menos um item antes de submeter.';
    end if;
  end if;

  /*
   * Encerrar exige que nada esteja em campo.
   *
   * Encerrar com item instalado libera o ativo no sistema e deixa a máquina no
   * cliente: ela some do parque alocável, ninguém a cobra, e ninguém a busca.
   * É o modo de falha mais caro deste módulo porque o equipamento continua
   * existindo — só deixa de ser responsabilidade de alguém.
   */
  if new.status = 'ENCERRADO' then
    select count(*) into v_itens
      from public.contrato_item ci
     where ci.contrato_id = new.id
       and ci.status in ('RESERVADO','EM_ENTREGA','ATIVO','SUSPENSO','EM_DEVOLUCAO');
    if v_itens > 0 then
      raise exception 'contrato com % item(ns) em campo não encerra', v_itens
        using errcode = '23514',
              constraint = 'contrato_item_em_campo',
              hint = 'Registre a devolução dos itens antes de encerrar.';
    end if;
  end if;

  /*
   * Cancelar exige que nada tenha sido entregue.
   *
   * Cancelamento é "este contrato nunca existiu na prática". Com item
   * entregue, a saída é distrato ou encerramento — e a diferença importa
   * porque uma calcula multa e a outra não.
   */
  if new.status = 'CANCELADO' then
    select count(*) into v_itens
      from public.contrato_item ci
     where ci.contrato_id = new.id
       and ci.status in ('EM_ENTREGA','ATIVO','SUSPENSO','EM_DEVOLUCAO','ENCERRADO');
    if v_itens > 0 then
      raise exception 'contrato com item já entregue não cancela'
        using errcode = '23514',
              constraint = 'contrato_item_entregue',
              hint = 'Use distrato ou encerramento, que tratam a devolução e a multa.';
    end if;
  end if;

  /*
   * As três transições que exigem motivo.
   *
   * Suspensão interrompe faturamento, distrato calcula multa, encerramento
   * libera ativo. Nenhuma das três se explica seis meses depois sem o motivo
   * gravado — e as três são exatamente as que alguém vai auditar.
   */
  if new.status in ('SUSPENSO','DISTRATADO','ENCERRADO')
     and length(btrim(coalesce(new.motivo_status, ''))) < 10 then
    raise exception 'transição para % exige motivo', new.status
      using errcode = '23514',
            constraint = 'contrato_motivo_obrigatorio',
            hint = 'Descreva o motivo em motivo_status.';
  end if;

  /*
   * Ativar reserva os itens planejados.
   *
   * O Anexo B.2 declara o efeito — "Itens → RESERVADO" — e ele não estava
   * implementado. A consequência passava despercebida porque nada quebrava:
   * o contrato ficava ativo com itens em `PLANEJADO`, e as checagens que
   * perguntam "tem item em campo?" respondiam não. Encerrar um contrato ativo
   * com equipamento alocado passava.
   *
   * O efeito mora no gatilho e não no serviço pela razão de sempre: ele é
   * consequência do estado, não decisão de quem chamou, e precisa valer para
   * importação e correção manual.
   */
  if new.status = 'ATIVO' and old.status = 'AGUARDANDO_ASSINATURA' then
    update public.contrato_item
       set status = 'RESERVADO', updated_at = now()
     where contrato_id = new.id and status = 'PLANEJADO';
  end if;

  -- Carimbos de data, preenchidos aqui para não dependerem de quem escreve.
  if new.status = 'SUSPENSO'   then new.suspenso_em   := coalesce(new.suspenso_em, now()); end if;
  if new.status = 'ENCERRADO'  then new.encerrado_em  := coalesce(new.encerrado_em, now()); end if;
  if new.status = 'DISTRATADO' then new.distratado_em := coalesce(new.distratado_em, now()); end if;

  return new;
end;
$$;

drop trigger if exists contrato_transicao on public.contrato;
create trigger contrato_transicao
  before update of status on public.contrato
  for each row execute function app.validar_contrato_transicao();
