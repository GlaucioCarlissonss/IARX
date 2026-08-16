-- =============================================================================
-- 0016 — Superfície de autenticação: as únicas funções que rodam sem contexto
--
-- Referências: docs/anexos/M-decisoes-mercado-brasileiro.md (D-07)
-- Invariantes: RN-L41 (a autenticação tem superfície fechada e enumerável)
--
-- O problema que esta migração resolve, e que só apareceu ao construir a API:
--
-- Toda tabela de negócio tem política restritiva `tenant_id =
-- app.tenant_atual()`. No login, `app.tenant_id` ainda não está definido —
-- `app.tenant_atual()` devolve nulo, a comparação vira nulo, e a política nega
-- **todas** as linhas. O login não conseguiria nem encontrar o usuário.
--
-- Não é um defeito da RLS: é a RLS funcionando. O tenant é justamente o que a
-- consulta de login descobre, então ela é, por natureza, a única consulta do
-- sistema que precisa acontecer antes de existir contexto.
--
-- Três saídas possíveis, e por que esta:
--
--  1. **Papel com `bypassrls` para a API.** Descartada: transformaria toda
--     consulta da aplicação em consulta sem RLS, e o isolamento passaria a
--     depender de nenhum desenvolvedor esquecer um `where`. É exatamente o que
--     o Anexo H recusou ao escolher `iarx_app` sujeito a RLS.
--  2. **Política permissiva extra em `usuario` para leitura sem contexto.**
--     Descartada: abriria a tabela inteira de usuários para qualquer consulta
--     sem contexto, e "sem contexto" é o estado de qualquer bug de middleware.
--  3. **`security definer` com superfície fechada** — esta. As funções abaixo
--     são as únicas que atravessam a RLS, cada uma faz uma coisa só, nenhuma
--     aceita filtro genérico, e nenhuma devolve dado de negócio. A lista é
--     enumerável e cabe numa revisão: `select proname from pg_proc where
--     prosecdef and pronamespace = 'app'::regnamespace`.
--
-- RN-L41 é essa regra: a autenticação atravessa a RLS por funções nomeadas, e
-- por nenhum outro caminho. Acrescentar uma função aqui é um ato deliberado e
-- visível no diff; abrir um papel ou uma política não seria.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Busca do usuário para autenticar
--
-- Devolve o mínimo para decidir se a senha confere e o que fazer em seguida.
-- Nada de negócio: nem contrato, nem cliente, nem permissão — permissão vem em
-- função separada, chamada só depois de a senha conferir.
--
-- Sem filtro genérico de propósito: o parâmetro é o e-mail e nada mais. Uma
-- assinatura que aceitasse cláusula do chamador seria um `select *` na tabela
-- de usuários com outro nome.
-- -----------------------------------------------------------------------------
create or replace function app.auth_usuario_por_email(p_email text)
returns table (
  id                uuid,
  tenant_id         uuid,
  nome              text,
  email             text,
  tipo              text,
  cliente_id        uuid,
  status            text,
  senha_hash        text,
  senha_alterada_em timestamptz,
  deve_trocar_senha boolean,
  bloqueado_ate     timestamptz,
  politica_senha    jsonb
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.id, u.tenant_id, u.nome, u.email, u.tipo, u.cliente_id, u.status::text,
         u.senha_hash, u.senha_alterada_em, u.deve_trocar_senha, u.bloqueado_ate,
         t.politica_senha
    from public.usuario u
    join public.tenant t on t.id = u.tenant_id
   where lower(u.email) = lower(btrim(p_email))
     and u.deleted_at is null;
$$;

comment on function app.auth_usuario_por_email(text) is
  'RN-L41. Única leitura de usuário sem contexto de tenant — o tenant é o que o login descobre.';

/**
 * O mesmo por id.
 *
 * Usada nos fluxos já autenticados — trocar a própria senha, redefinir por
 * token — em que o id já foi provado e o e-mail não é o que se tem em mãos.
 *
 * Existe como função própria porque a alternativa que tentei primeiro não
 * funciona: buscar o e-mail com um `select` comum e passá-lo à função acima
 * cai na RLS, que sem contexto não devolve linha. O sintoma era um 404 na
 * troca de senha de um usuário que existe.
 */
create or replace function app.auth_usuario_por_id(p_id uuid)
returns table (
  id                uuid,
  tenant_id         uuid,
  nome              text,
  email             text,
  tipo              text,
  cliente_id        uuid,
  status            text,
  senha_hash        text,
  senha_alterada_em timestamptz,
  deve_trocar_senha boolean,
  bloqueado_ate     timestamptz,
  politica_senha    jsonb
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.id, u.tenant_id, u.nome, u.email, u.tipo, u.cliente_id, u.status::text,
         u.senha_hash, u.senha_alterada_em, u.deve_trocar_senha, u.bloqueado_ate,
         t.politica_senha
    from public.usuario u
    join public.tenant t on t.id = u.tenant_id
   where u.id = p_id
     and u.deleted_at is null;
$$;

-- -----------------------------------------------------------------------------
-- Permissões e escopos efetivos
--
-- Chamadas depois de a senha conferir, para montar o token. Recebem o id do
-- usuário, nunca um filtro: quem já provou ser aquele usuário pode saber as
-- próprias permissões, e mais nada.
-- -----------------------------------------------------------------------------
create or replace function app.auth_permissoes(p_usuario uuid)
returns setof text
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select distinct unnest(p.permissoes)
    from public.usuario_perfil up
    join public.perfil p on p.id = up.perfil_id
   where up.usuario_id = p_usuario
     and p.deleted_at is null
   order by 1;
$$;

create or replace function app.auth_escopos(p_usuario uuid)
returns table (tipo text, id uuid)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select distinct up.escopo_tipo::text, up.escopo_id
    from public.usuario_perfil up
   where up.usuario_id = p_usuario;
$$;

-- -----------------------------------------------------------------------------
-- Sessão
--
-- Abrir, conferir e revogar acontecem fora do contexto: a abertura porque
-- ainda não há token, e a conferência porque ela é quem **decide** se o token
-- vale — checá-la já dentro do contexto seria confiar no token para validar o
-- token.
-- -----------------------------------------------------------------------------
create or replace function app.auth_abrir_sessao(
  p_tenant     uuid,
  p_usuario    uuid,
  p_expira_em  timestamptz,
  p_ip         inet default null,
  p_user_agent text default null
) returns uuid
language sql
security definer
set search_path = public, app, pg_temp
as $$
  insert into public.sessao (tenant_id, usuario_id, expira_em, ip, user_agent)
  values (p_tenant, p_usuario, p_expira_em, p_ip, p_user_agent)
  returning id;
$$;

/**
 * Sessão viva.
 *
 * Devolve nulo para inexistente, revogada **e** expirada, sem distinguir. Quem
 * chama não precisa saber a diferença, e devolvê-la diria a um token roubado
 * por que ele parou de funcionar — informação que só serve a quem o roubou.
 */
create or replace function app.auth_sessao_viva(p_sessao uuid)
returns uuid
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select s.usuario_id
    from public.sessao s
   where s.id = p_sessao
     and s.revogada_em is null
     and s.expira_em > now();
$$;

create or replace function app.auth_tocar_sessao(p_sessao uuid)
returns void
language sql
security definer
set search_path = public, app, pg_temp
as $$
  update public.sessao set ultima_atividade_em = now() where id = p_sessao;
$$;

-- -----------------------------------------------------------------------------
-- Recuperação de senha
--
-- O token em claro nunca chega ao banco: só o SHA-256 dele. Quem lê a tabela
-- não consegue redefinir a senha de ninguém — a mesma razão de a senha ser
-- hash.
--
-- Gerar um token invalida o anterior (RN-L28): sem isso, cada "esqueci minha
-- senha" clicado por engano deixaria mais um link válido circulando por e-mail.
-- -----------------------------------------------------------------------------
create or replace function app.auth_criar_token_recuperacao(
  p_tenant  uuid,
  p_usuario uuid,
  p_hash    text,
  p_expira  timestamptz,
  p_ip      inet default null
) returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  update public.token_recuperacao
     set usado_em = now()
   where usuario_id = p_usuario and usado_em is null;

  insert into public.token_recuperacao (tenant_id, usuario_id, token_hash, expira_em, ip_solicitante)
  values (p_tenant, p_usuario, p_hash, p_expira, p_ip);

  insert into public.log_acesso
    (tenant_id, usuario_id, evento, ip, sucesso)
  values (p_tenant, p_usuario, 'RECUPERACAO_SOLICITADA', p_ip, true);
end;
$$;

/**
 * Consome o token e devolve de quem ele é.
 *
 * `update … returning` numa operação só: consultar e depois marcar como usado
 * abriria a janela em que dois pedidos simultâneos com o mesmo token passam os
 * dois. Aqui o segundo não encontra linha, porque o primeiro já a marcou.
 */
create or replace function app.auth_consumir_token_recuperacao(p_hash text)
returns table (usuario_id uuid, tenant_id uuid)
language sql
security definer
set search_path = public, app, pg_temp
as $$
  update public.token_recuperacao
     set usado_em = now()
   where token_hash = p_hash
     and usado_em is null
     and expira_em > now()
  returning token_recuperacao.usuario_id, token_recuperacao.tenant_id;
$$;

-- -----------------------------------------------------------------------------
-- Definição de senha e revogação em massa
--
-- Trocar a senha revoga as sessões abertas, na mesma transação. É o
-- comportamento que o usuário espera de "troquei minha senha porque desconfio
-- que alguém a tem" — e deixar as sessões vivas tornaria a troca decorativa
-- justamente no caso em que ela mais importa.
-- -----------------------------------------------------------------------------
create or replace function app.auth_definir_senha(
  p_usuario     uuid,
  p_hash        text,
  p_deve_trocar boolean default false,
  p_motivo      text default 'troca de senha'
) returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant uuid;
begin
  update public.usuario
     set senha_hash = p_hash,
         senha_alterada_em = now(),
         deve_trocar_senha = p_deve_trocar,
         tentativas_falhas = 0,
         bloqueado_ate = null
   where id = p_usuario
  returning tenant_id into v_tenant;

  if v_tenant is null then
    raise exception 'Usuário % não encontrado.', p_usuario using errcode = 'no_data_found';
  end if;

  update public.sessao
     set revogada_em = now(), revogacao_motivo = p_motivo
   where usuario_id = p_usuario and revogada_em is null;

  insert into public.log_acesso (tenant_id, usuario_id, evento, sucesso)
  values (v_tenant, p_usuario, 'TROCA_SENHA', true);
end;
$$;

comment on function app.auth_definir_senha(uuid, text, boolean, text) is
  'Define a senha e revoga as sessões abertas na mesma transação. Trocar a senha sem encerrar sessões seria decorativo justamente no caso em que a troca mais importa.';

-- -----------------------------------------------------------------------------
-- Registro de tentativa — agora dentro da superfície
--
-- A 0015 criou `app.registrar_tentativa_login` sem `security definer`, e o
-- defeito só apareceu ao ligar a API: a função escreve em `log_acesso` e
-- `usuario`, que têm RLS, e é chamada **durante** o login — quando ainda não
-- existe contexto de tenant. O resultado era um login correto respondendo 403
-- por "fora de escopo".
--
-- É o mesmo motivo das demais funções deste arquivo, e a correção é a mesma.
-- Redefinida aqui em vez de editada na 0015 porque migração aplicada não se
-- reescreve: quem já rodou a 0015 recebe a correção pela 0016, e quem roda as
-- duas em sequência chega ao mesmo lugar.
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
security definer
set search_path = public, app, pg_temp
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

-- -----------------------------------------------------------------------------
-- Permissão de execução
--
-- `security definer` sem `revoke from public` é uma função que qualquer papel
-- do banco executa. Aqui isso significaria: qualquer conexão consegue ler o
-- hash de senha de qualquer usuário de qualquer locatário.
-- -----------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p
     where p.pronamespace = 'app'::regnamespace
       and (p.proname like 'auth\_%' or p.proname = 'registrar_tentativa_login')
  loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to iarx_app', f.assinatura);
  end loop;
end $$;
