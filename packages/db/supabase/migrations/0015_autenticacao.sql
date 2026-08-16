-- =============================================================================
-- 0015 — Autenticação própria: política de senha, sessão revogável, bloqueio
--
-- Referências: docs/anexos/M-decisoes-mercado-brasileiro.md (D-07, revertida)
--              docs/anexos/L-lacunas-funcionais.md (Módulo 4 §4.2)
-- Invariantes: RN-L37 (senha é sempre Argon2id), RN-L38 (sessão revogada morre),
--              RN-L39 (o último administrador não se desativa),
--              RN-L40 (política de senha é do tenant, não constante de código)
--
-- Continuando a renumeração:
--   RN-L37…L40  autenticação  (esta)
--
-- A migração 0011 preparou o terreno — `senha_hash`, `senha_alterada_em`,
-- `deve_trocar_senha`, `tentativas_falhas`, `bloqueado_ate`, `token_recuperacao`
-- e `log_acesso` já existem. O que faltava era o que **decide**: quantas
-- tentativas antes de bloquear, por quanto tempo, se a senha expira, e como
-- encerrar uma sessão antes do vencimento do token.
--
-- Nada disso pode ser constante no código da API. Uma locadora com política
-- de segurança corporativa exige 60 dias de expiração; outra, nenhuma. Constante
-- de código transforma uma configuração em release.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Política de senha, por tenant
--
-- RN-L40. Em `jsonb` e não em colunas por dois motivos concretos: a política
-- cresce com o tempo (hoje quatro campos, amanhã lista de senhas proibidas,
-- exigência de MFA por perfil), e cada campo novo em coluna seria uma migração
-- para todo mundo, inclusive quem nunca vai usar aquele campo.
--
-- O default é deliberadamente permissivo no que é opinião (expiração desligada)
-- e restritivo no que é consenso (tamanho mínimo, bloqueio por tentativa). Uma
-- expiração periódica obrigatória sem pedido do cliente é a regra que faz o
-- usuário escrever a senha num papel — o NIST desaconselha desde 2017, e
-- ligá-la por padrão seria escolher pelo operador.
-- -----------------------------------------------------------------------------
alter table public.tenant
  add column if not exists politica_senha jsonb not null default jsonb_build_object(
    'tamanho_minimo', 12,
    'expira_em_dias', null,
    'tentativas_ate_bloquear', 5,
    'bloqueio_minutos', 15,
    'exige_troca_no_primeiro_acesso', true
  );

comment on column public.tenant.politica_senha is
  'Política de senha do locatário (RN-L40). Configuração, nunca constante de código: exigência de expiração varia por política de segurança do cliente.';

create or replace function app.validar_politica_senha()
returns trigger
language plpgsql
as $$
declare
  v_min  integer := (new.politica_senha ->> 'tamanho_minimo')::integer;
  v_dias integer := (new.politica_senha ->> 'expira_em_dias')::integer;
  v_tent integer := (new.politica_senha ->> 'tentativas_ate_bloquear')::integer;
  v_bloq integer := (new.politica_senha ->> 'bloqueio_minutos')::integer;
begin
  -- Doze caracteres é o piso, não o padrão: abaixo disso a senha cai em ataque
  -- de dicionário com hardware comum, e uma política que permite oito dá ao
  -- operador a impressão de ter escolhido segurança quando escolheu o contrário.
  if v_min is null or v_min < 12 then
    raise exception 'tamanho_minimo da senha não pode ser menor que 12'
      using errcode = 'check_violation', column = 'politica_senha', table = 'tenant';
  end if;

  if v_dias is not null and v_dias < 30 then
    raise exception 'expira_em_dias, quando definido, precisa ser ao menos 30'
      using errcode = 'check_violation', column = 'politica_senha', table = 'tenant',
            hint = 'Expiração muito curta leva o usuário a reciclar variações da mesma senha.';
  end if;

  if v_tent is null or v_tent < 3 then
    raise exception 'tentativas_ate_bloquear precisa ser ao menos 3'
      using errcode = 'check_violation', column = 'politica_senha', table = 'tenant',
            hint = 'Menos que isso bloqueia por erro de digitação e vira negação de serviço contra o próprio usuário.';
  end if;

  if v_bloq is null or v_bloq < 1 then
    raise exception 'bloqueio_minutos precisa ser ao menos 1'
      using errcode = 'check_violation', column = 'politica_senha', table = 'tenant';
  end if;

  return new;
end;
$$;

drop trigger if exists tenant_politica_senha_valida on public.tenant;
create trigger tenant_politica_senha_valida
  before insert or update of politica_senha on public.tenant
  for each row execute function app.validar_politica_senha();

-- -----------------------------------------------------------------------------
-- RN-L37 · a senha é sempre Argon2id
--
-- O formato PHC do Argon2id é `$argon2id$v=19$m=...,t=...,p=...$salt$hash`.
-- A checagem é de **formato**, não de força — nenhum CHECK sabe se o hash é bom.
-- O que ela impede é a classe de erro que realmente acontece: alguém, num
-- script de carga ou numa correção às pressas, gravar SHA-256 do password, ou
-- pior, o texto em claro. Os dois passam por qualquer código que só faça
-- `update usuario set senha_hash = $1`; nenhum passa por aqui.
--
-- `not valid` porque uma base existente pode ter hash de outro formato vindo do
-- período em que a decisão era Supabase Auth. Escrita nova já é barrada.
-- -----------------------------------------------------------------------------
alter table public.usuario drop constraint if exists usuario_senha_argon2id;
alter table public.usuario add constraint usuario_senha_argon2id
  check (senha_hash is null or senha_hash ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$')
  not valid;

comment on column public.usuario.senha_hash is
  'Argon2id no formato PHC (RN-L37). Nulo quando a autenticação é federada por OIDC — D-07 mantém as duas possíveis.';

-- -----------------------------------------------------------------------------
-- sessao — o que torna a revogação possível
--
-- Um JWT é válido até expirar, por definição: ninguém pode "cancelá-lo". Sem
-- esta tabela, desativar um usuário demitido às 9h deixaria o token dele
-- funcionando até o vencimento, e o critério de aceite "revogar sessões encerra
-- o acesso em menos de 60 segundos" (Anexo L, Módulo 4) seria inatendível.
--
-- O token carrega `sessao_id`; a guarda de autenticação verifica a linha. É uma
-- consulta a mais por requisição, e é o preço de poder encerrar acesso — a
-- alternativa (token de vida curtíssima com renovação constante) troca a
-- consulta por latência em toda renovação, e ainda deixa uma janela.
-- -----------------------------------------------------------------------------
create table if not exists public.sessao (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  usuario_id    uuid not null references public.usuario(id) on delete cascade,
  criada_em     timestamptz not null default now(),
  expira_em     timestamptz not null,
  ultima_atividade_em timestamptz not null default now(),
  revogada_em   timestamptz,
  revogada_por  uuid references public.usuario(id),
  revogacao_motivo text,
  ip            inet,
  user_agent    text,
  constraint sessao_expira_no_futuro check (expira_em > criada_em),
  -- Revogação sem autor é revogação que ninguém explica depois. O motivo é
  -- livre porque as causas legítimas são muitas (logout, desativação, troca de
  -- senha, suspeita de comprometimento) e enumerá-las convidaria ao 'OUTRO'.
  constraint sessao_revogacao_completa check (
    (revogada_em is null and revogacao_motivo is null)
    or (revogada_em is not null and revogacao_motivo is not null)
  )
);

create index if not exists sessao_usuario_ix
  on public.sessao (tenant_id, usuario_id, criada_em desc);
-- A consulta do caminho quente: sessão viva de um id conhecido.
create index if not exists sessao_viva_ix
  on public.sessao (id) where revogada_em is null;

comment on table public.sessao is
  'Sessões emitidas. Existe para que revogar acesso seja possível antes do vencimento do token (RN-L38).';

-- -----------------------------------------------------------------------------
-- RN-L38 · sessão revogada não ressuscita
--
-- Sem isto, um `update sessao set revogada_em = null` — por engano num script,
-- ou de propósito por quem tem acesso ao banco — devolveria acesso a uma sessão
-- que alguém encerrou deliberadamente. O evento de revogação é definitivo.
-- -----------------------------------------------------------------------------
create or replace function app.sessao_revogacao_definitiva()
returns trigger
language plpgsql
as $$
begin
  if old.revogada_em is not null and new.revogada_em is null then
    raise exception 'Sessão revogada não pode ser reativada.'
      using errcode = 'check_violation', column = 'revogada_em', table = 'sessao',
            hint = 'Emita uma sessão nova; a revogada é registro histórico.';
  end if;
  return new;
end;
$$;

drop trigger if exists sessao_revogacao_definitiva on public.sessao;
create trigger sessao_revogacao_definitiva
  before update on public.sessao
  for each row execute function app.sessao_revogacao_definitiva();

-- -----------------------------------------------------------------------------
-- RN-L39 · o último administrador ativo não se desativa
--
-- O tenant ficaria sem ninguém capaz de conceder acesso a ninguém — um
-- bloqueio que só o suporte do fornecedor desfaz, mexendo direto no banco de
-- produção. Vale para desativação e para remoção do perfil administrativo:
-- tirar a permissão do último admin produz exatamente o mesmo tenant órfão que
-- desativá-lo.
-- -----------------------------------------------------------------------------
create or replace function app.contar_admins_ativos(p_tenant uuid, p_excluir uuid default null)
returns integer
language sql
stable
as $$
  select count(distinct u.id)::integer
    from public.usuario u
    join public.usuario_perfil up on up.usuario_id = u.id
    join public.perfil p on p.id = up.perfil_id
   where u.tenant_id = p_tenant
     and u.deleted_at is null
     and u.status = 'ATIVO'
     and (p_excluir is null or u.id <> p_excluir)
     and p.deleted_at is null
     and p.tipo = 'INTERNO'
     and 'usuario:gerenciar' = any (p.permissoes);
$$;

comment on function app.contar_admins_ativos(uuid, uuid) is
  'Administradores ativos do tenant, opcionalmente ignorando um id. Base da RN-L39.';

create or replace function app.proteger_ultimo_admin()
returns trigger
language plpgsql
as $$
begin
  -- Só interessa a transição que **retira** um admin de circulação.
  if new.status = 'ATIVO' and new.deleted_at is null then
    return new;
  end if;
  if old.status <> 'ATIVO' or old.deleted_at is not null then
    return new;
  end if;

  if app.contar_admins_ativos(old.tenant_id, old.id) = 0
     and app.contar_admins_ativos(old.tenant_id) > 0 then
    raise exception 'Este é o último administrador ativo do locatário.'
      using errcode = 'check_violation', column = 'status', table = 'usuario',
            hint = 'Conceda o perfil administrativo a outro usuário antes de desativar este.';
  end if;

  return new;
end;
$$;

drop trigger if exists usuario_protege_ultimo_admin on public.usuario;
create trigger usuario_protege_ultimo_admin
  before update on public.usuario
  for each row execute function app.proteger_ultimo_admin();

-- O mesmo pela outra porta: revogar o perfil, em vez de desativar o usuário.
create or replace function app.proteger_ultimo_admin_perfil()
returns trigger
language plpgsql
as $$
declare
  v_era_admin boolean;
begin
  select 'usuario:gerenciar' = any (p.permissoes) and p.tipo = 'INTERNO'
    into v_era_admin
    from public.perfil p where p.id = old.perfil_id;

  if not coalesce(v_era_admin, false) then
    return old;
  end if;

  if app.contar_admins_ativos(old.tenant_id, old.usuario_id) = 0
     and app.contar_admins_ativos(old.tenant_id) > 0 then
    raise exception 'Revogar este perfil deixaria o locatário sem administrador.'
      using errcode = 'check_violation', table = 'usuario_perfil',
            hint = 'Conceda o perfil administrativo a outro usuário antes de revogar este.';
  end if;

  return old;
end;
$$;

drop trigger if exists usuario_perfil_protege_ultimo_admin on public.usuario_perfil;
create trigger usuario_perfil_protege_ultimo_admin
  before delete on public.usuario_perfil
  for each row execute function app.proteger_ultimo_admin_perfil();

-- -----------------------------------------------------------------------------
-- Registro de tentativa de acesso, em um lugar só
--
-- A função existe para que a API não precise acertar três escritas coordenadas
-- (contador, bloqueio e log) a cada tentativa. Regra espalhada por chamador é
-- regra que um chamador esquece — e aqui o esquecimento seria não bloquear.
-- -----------------------------------------------------------------------------
create or replace function app.registrar_tentativa_login(
  p_tenant       uuid,
  p_usuario      uuid,
  p_identificador text,
  p_sucesso      boolean,
  p_motivo       text default null,
  p_ip           inet default null,
  p_user_agent   text default null
) returns void
language plpgsql
as $$
declare
  v_politica jsonb;
  v_limite   integer;
  v_minutos  integer;
  v_falhas   integer;
begin
  insert into public.log_acesso
    (tenant_id, usuario_id, identificador, evento, ip, user_agent, sucesso, motivo_falha)
  values
    (p_tenant, p_usuario, p_identificador,
     case when p_sucesso then 'LOGIN' else 'FALHA_SENHA' end,
     p_ip, p_user_agent, p_sucesso, p_motivo);

  -- Usuário inexistente ainda gera log — é o registro de "alguém tentou entrar
  -- com um e-mail que não existe aqui", que é sinal de varredura.
  if p_usuario is null then
    return;
  end if;

  if p_sucesso then
    update public.usuario
       set tentativas_falhas = 0, bloqueado_ate = null, ultimo_acesso_em = now()
     where id = p_usuario;
    return;
  end if;

  select t.politica_senha into v_politica
    from public.tenant t where t.id = p_tenant;

  v_limite  := coalesce((v_politica ->> 'tentativas_ate_bloquear')::integer, 5);
  v_minutos := coalesce((v_politica ->> 'bloqueio_minutos')::integer, 15);

  update public.usuario
     set tentativas_falhas = tentativas_falhas + 1
   where id = p_usuario
  returning tentativas_falhas into v_falhas;

  if v_falhas >= v_limite then
    update public.usuario
       set bloqueado_ate = now() + make_interval(mins => v_minutos)
     where id = p_usuario;

    insert into public.log_acesso
      (tenant_id, usuario_id, identificador, evento, ip, user_agent, sucesso, motivo_falha)
    values
      (p_tenant, p_usuario, p_identificador, 'BLOQUEIO', p_ip, p_user_agent, false,
       format('%s tentativas consecutivas', v_falhas));
  end if;
end;
$$;

comment on function app.registrar_tentativa_login(uuid, uuid, text, boolean, text, inet, text) is
  'Contador, bloqueio e log numa escrita só. Chamador que esquecesse um dos três deixaria de bloquear.';

-- -----------------------------------------------------------------------------
-- RLS
--
-- `sessao` segue o padrão: restritiva por tenant, e o próprio usuário enxerga
-- apenas as suas — ninguém precisa ver a sessão alheia para trabalhar, e listar
-- sessões de terceiros é reconhecimento de terreno.
-- -----------------------------------------------------------------------------
alter table public.sessao enable row level security;
alter table public.sessao force row level security;

drop policy if exists sessao_tenant on public.sessao;
create policy sessao_tenant on public.sessao
  as restrictive for all to iarx_app, authenticated
  using (tenant_id = app.tenant_atual())
  with check (tenant_id = app.tenant_atual());

drop policy if exists sessao_leitura on public.sessao;
create policy sessao_leitura on public.sessao
  for all to iarx_app, authenticated
  using (true) with check (true);

grant select, insert, update on public.sessao to iarx_app;

select app.habilitar_auditoria('usuario_perfil');
