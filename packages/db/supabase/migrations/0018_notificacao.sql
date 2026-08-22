-- =============================================================================
-- 0018 — Notificação: a fila que faltava atrás do outbox
--
-- Referências: docs/anexos/L-lacunas-funcionais.md (D-19), Anexo Q §Q.10
-- Invariantes: RN-L48 (envio não se repete),
--              RN-L49 (notificação sem destino não entra na fila),
--              RN-L50 (reserva é exclusiva e expira),
--              RN-L51 (desistir é definitivo, e diz por quê)
--
-- Continuando a renumeração:
--   RN-L48…L51  notificação
--
-- `outbox_evento` existe desde a migração 0007 e nunca teve consumidor. O
-- resultado prático é que recuperação de senha, convite de usuário e — a partir
-- do Módulo 10 — aprovação de pagamento gravavam a intenção de avisar alguém e
-- ninguém era avisado. Não é um defeito silencioso: é um recurso que a interface
-- promete e o sistema não cumpre.
--
-- Duas coisas separadas de propósito:
--
--   `outbox_evento`     o **fato** aconteceu (título aprovado, senha pedida)
--   `notificacao`       alguém precisa **saber** do fato, por um canal
--
-- Um evento pode gerar zero, uma ou várias notificações — o aprovador de nível
-- 2, o solicitante e o financeiro são três destinos do mesmo fato. Reaproveitar
-- o outbox como fila de envio obrigaria a duplicar o evento por destinatário, e
-- o registro do fato deixaria de ser um.
-- =============================================================================

create table if not exists public.notificacao (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete restrict,
  /** O fato que a originou. Nulo em notificação avulsa (teste, aviso manual). */
  evento_id      uuid references public.outbox_evento(id) on delete set null,
  canal          text not null,
  /**
   * Destinatário como usuário **e** como endereço.
   *
   * O usuário serve à caixa interna e à auditoria; o endereço é gravado no
   * momento do enfileiramento e não relido depois. A razão é concreta: se a
   * pessoa trocar de e-mail entre o enfileiramento e o envio, o aviso tem de ir
   * para onde foi endereçado — reler produziria uma notificação sobre um fato
   * antigo chegando num endereço que talvez seja de outra pessoa.
   */
  usuario_id     uuid references public.usuario(id) on delete set null,
  destino        text,
  assunto        text not null,
  corpo_texto    text not null,
  corpo_html     text,
  status         text not null default 'PENDENTE',
  tentativas     integer not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  /** Trava da reserva: quem pegou, e até quando a reserva vale. */
  reservado_em   timestamptz,
  reservado_por  text,
  enviada_em     timestamptz,
  lida_em        timestamptz,
  ultimo_erro    text,
  created_at     timestamptz not null default now(),
  constraint notificacao_canal_valido check (canal in ('EMAIL', 'IN_APP')),
  constraint notificacao_status_valido check (
    status in ('PENDENTE', 'ENVIANDO', 'ENVIADA', 'FALHOU', 'DESCARTADA')
  ),
  constraint notificacao_tentativas_nao_negativas check (tentativas >= 0),
  constraint notificacao_assunto_nao_vazio check (length(btrim(assunto)) > 0),
  constraint notificacao_corpo_nao_vazio check (length(btrim(corpo_texto)) > 0),
  -- RN-L49: e-mail exige endereço; caixa interna exige usuário. Uma notificação
  -- sem destino é trabalho que a fila carrega para sempre sem poder concluir.
  constraint notificacao_email_tem_destino check (
    canal <> 'EMAIL' or (destino is not null and destino like '%@%')
  ),
  constraint notificacao_in_app_tem_usuario check (canal <> 'IN_APP' or usuario_id is not null),
  constraint notificacao_enviada_tem_data check ((status = 'ENVIADA') = (enviada_em is not null)),
  -- RN-L51: desistir exige dizer por quê. "FALHOU" sem erro é um beco sem saída
  -- para quem precisa decidir se reenvia.
  constraint notificacao_falha_tem_erro check (
    status <> 'FALHOU' or length(btrim(coalesce(ultimo_erro, ''))) > 0
  )
);

/*
 * Índice da fila: parcial, e é o que mantém a varredura constante.
 *
 * O worker procura só o que está pendente e cuja hora chegou. Sem o `where`, a
 * varredura cresceria com o histórico de enviadas — que é justamente o que mais
 * cresce.
 */
create index if not exists notificacao_fila_ix
  on public.notificacao (proxima_tentativa_em)
  where status in ('PENDENTE', 'ENVIANDO');

/** Caixa interna do usuário: o não lido primeiro, que é o que ele abre. */
create index if not exists notificacao_caixa_ix
  on public.notificacao (tenant_id, usuario_id, created_at desc)
  where canal = 'IN_APP' and lida_em is null;

comment on table public.notificacao is
  'Fila de avisos. Separada de outbox_evento: o evento é o fato, a notificação é alguém precisar saber dele — e um fato tem vários destinatários.';
comment on column public.notificacao.destino is
  'Endereço no momento do enfileiramento, nunca relido. Reler mandaria um aviso sobre um fato antigo para um endereço que talvez seja de outra pessoa.';

-- -----------------------------------------------------------------------------
-- Enfileirar, de dentro da transação de negócio
--
-- Chamada junto da escrita que a originou, na mesma transação: se o título não
-- for aprovado, o aviso de aprovação não existe. É a metade do padrão outbox
-- que importa — a intenção de avisar e o fato compartilham o commit.
-- -----------------------------------------------------------------------------
create or replace function app.enfileirar_notificacao(
  p_canal       text,
  p_usuario_id  uuid,
  p_destino     text,
  p_assunto     text,
  p_corpo_texto text,
  p_corpo_html  text default null,
  p_evento_id   uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_destino text := p_destino;
begin
  /*
   * O endereço é resolvido aqui quando não vem informado, e não no worker.
   *
   * No worker, a resolução aconteceria com o e-mail de hoje — que pode não ser
   * o de quando o fato ocorreu. Aqui, ela acontece no instante do fato.
   */
  if p_canal = 'EMAIL' and v_destino is null and p_usuario_id is not null then
    select email into v_destino from public.usuario where id = p_usuario_id;
  end if;

  insert into public.notificacao
    (tenant_id, evento_id, canal, usuario_id, destino, assunto, corpo_texto, corpo_html)
  values
    (app.exigir_tenant(), p_evento_id, p_canal, p_usuario_id, v_destino,
     p_assunto, p_corpo_texto, p_corpo_html)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.enfileirar_notificacao(text, uuid, text, text, text, text, uuid) is
  'Enfileira na mesma transação do fato: se a escrita for desfeita, o aviso não existe.';

-- -----------------------------------------------------------------------------
-- RN-L48 · envio não se repete
--
-- Uma notificação ENVIADA é terminal. O gatilho recusa qualquer volta a
-- PENDENTE, porque a alternativa é a pessoa receber o mesmo aviso duas vezes —
-- e num aviso de aprovação de pagamento, duas cópias parecem dois pagamentos.
--
-- Reenviar de propósito é criar uma notificação nova, que fica registrada como
-- reenvio em vez de apagar o rastro do primeiro envio.
-- -----------------------------------------------------------------------------
create or replace function app.validar_transicao_notificacao()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'ENVIADA' and new.status <> 'ENVIADA' then
    raise exception 'Notificação já enviada não volta para %.', new.status
      using errcode = 'check_violation',
            column = 'status',
            table = 'notificacao',
            hint = 'Para avisar de novo, enfileire uma notificação nova — o reenvio fica registrado.';
  end if;

  if old.status = 'DESCARTADA' and new.status <> 'DESCARTADA' then
    raise exception 'Notificação descartada não é reaproveitada.'
      using errcode = 'check_violation', column = 'status', table = 'notificacao';
  end if;

  return new;
end;
$$;

drop trigger if exists notificacao_valida_transicao on public.notificacao;
create trigger notificacao_valida_transicao
  before update of status on public.notificacao
  for each row execute function app.validar_transicao_notificacao();

-- -----------------------------------------------------------------------------
-- Superfície do worker: três funções `security definer`, e só elas
--
-- O worker atravessa locatários — é um processo só servindo todos —, e por isso
-- não pode operar sob a RLS de um tenant. É o mesmo problema do login (RN-L41)
-- e a mesma solução: funções nomeadas, enumeráveis, revogadas de `public`.
--
-- A alternativa seria uma conexão sem RLS na aplicação, disponível para
-- qualquer erro futuro reaproveitar.
-- -----------------------------------------------------------------------------

/**
 * RN-L50 · reserva exclusiva, e que expira.
 *
 * `for update skip locked` é o que permite mais de um worker sem coordenação
 * externa: cada um leva um lote diferente, e nenhum espera pelo outro.
 *
 * A expiração existe porque um worker pode morrer entre reservar e enviar. Sem
 * ela, essas linhas ficariam em ENVIANDO para sempre — a fila pararia de andar
 * sem nenhum erro registrado. `p_expiracao` devolve à fila o que foi reservado
 * e não concluído.
 */
create or replace function app.notificacao_reservar_lote(
  p_limite    integer default 20,
  p_worker    text default 'worker',
  p_expiracao interval default interval '5 minutes'
)
returns table (
  id uuid, tenant_id uuid, canal text, usuario_id uuid, destino text,
  assunto text, corpo_texto text, corpo_html text, tentativas integer
)
security definer
set search_path = public, pg_temp
language plpgsql
as $$
begin
  return query
  with alvo as (
    select n.id
      from public.notificacao n
     where n.proxima_tentativa_em <= now()
       and (
         n.status = 'PENDENTE'
         -- Reserva abandonada por um worker que morreu no meio.
         or (n.status = 'ENVIANDO' and n.reservado_em < now() - p_expiracao)
       )
     order by n.proxima_tentativa_em
     limit greatest(p_limite, 0)
     for update skip locked
  )
  update public.notificacao n
     set status = 'ENVIANDO',
         reservado_em = now(),
         reservado_por = p_worker,
         tentativas = n.tentativas + 1
    from alvo
   where n.id = alvo.id
  returning n.id, n.tenant_id, n.canal, n.usuario_id, n.destino,
            n.assunto, n.corpo_texto, n.corpo_html, n.tentativas;
end;
$$;

comment on function app.notificacao_reservar_lote(integer, text, interval) is
  'RN-L50. `skip locked` permite vários workers sem coordenação; a expiração devolve à fila o que um worker morto deixou reservado.';

create or replace function app.notificacao_concluir(p_id uuid)
returns void
security definer
set search_path = public, pg_temp
language sql
as $$
  update public.notificacao
     set status = 'ENVIADA', enviada_em = now(), ultimo_erro = null,
         reservado_em = null, reservado_por = null
   where id = p_id and status = 'ENVIANDO';
$$;

/**
 * RN-L51 · desistir é definitivo, e diz por quê.
 *
 * O recuo é exponencial a partir de um minuto, e depois de `p_max_tentativas` a
 * notificação vai para FALHOU em vez de ficar girando. Uma fila que tenta para
 * sempre é uma fila que esconde o problema: o endereço errado nunca vira
 * endereço certo por insistência, e as tentativas competem com as notificações
 * novas pelo mesmo worker.
 */
create or replace function app.notificacao_falhar(
  p_id uuid,
  p_erro text,
  p_max_tentativas integer default 5
)
returns void
security definer
set search_path = public, pg_temp
language plpgsql
as $$
declare
  v_tentativas integer;
begin
  select tentativas into v_tentativas from public.notificacao where id = p_id;
  if v_tentativas is null then
    return;
  end if;

  update public.notificacao
     set status = case when v_tentativas >= p_max_tentativas then 'FALHOU' else 'PENDENTE' end,
         -- 1, 2, 4, 8, 16 minutos. Limitado a 6 para o expoente não estourar
         -- se `p_max_tentativas` for elevado depois.
         proxima_tentativa_em = now() + (interval '1 minute' * power(2, least(v_tentativas, 6))),
         ultimo_erro = coalesce(nullif(btrim(p_erro), ''), 'falha sem mensagem'),
         reservado_em = null,
         reservado_por = null
   where id = p_id;
end;
$$;

/** Marcar como lida é do dono da caixa, e passa pela RLS normal. */
create or replace function app.notificacao_marcar_lida(p_id uuid)
returns void
language sql
as $$
  update public.notificacao
     set lida_em = coalesce(lida_em, now())
   where id = p_id and canal = 'IN_APP' and usuario_id = app.usuario_atual();
$$;

-- -----------------------------------------------------------------------------
-- Isolamento
--
-- A tabela é do locatário como qualquer outra; o que atravessa é a superfície
-- fechada acima. Sem leitura de cliente: aviso de aprovação de pagamento é
-- assunto interno do locador.
-- -----------------------------------------------------------------------------
select app.habilitar_rls_tenant('notificacao');

grant execute on function
  app.enfileirar_notificacao(text, uuid, text, text, text, text, uuid),
  app.notificacao_marcar_lida(uuid)
  to iarx_app;

do $$
declare
  f text;
begin
  foreach f in array array[
    'app.notificacao_reservar_lote(integer, text, interval)',
    'app.notificacao_concluir(uuid)',
    'app.notificacao_falhar(uuid, text, integer)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to iarx_app', f);
  end loop;
end $$;
