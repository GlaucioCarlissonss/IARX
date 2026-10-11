-- =============================================================================
-- 0025 — Autenticação por provedor de identidade (Google)
--
-- A 0002 já previa isto: `usuario.subject_oidc` existe desde o começo, com
-- índice único global e uma nota explícita de que não há FK para `auth.users`
-- "mantém o núcleo de dados portável para outro provedor OIDC". O terreno
-- estava preparado; o que faltava era o provedor.
--
-- Duas correções no que estava preparado, e as duas vieram de olhar o provedor
-- de verdade em vez de supor.
--
-- **O tipo estava errado.** `subject_oidc` era `uuid`, porque assumia o
-- Supabase Auth, cujo id de usuário é UUID. O `sub` do Google é uma string
-- numérica de até 21 dígitos — `110169484474386276334` não é UUID e nunca vai
-- ser. A coluna nunca foi escrita por código nenhum, então a conversão é só
-- mudança de tipo: não há linha a migrar.
--
-- **Faltava o emissor.** `sub` é único *dentro* de um provedor, não entre
-- provedores. Guardar só o subject faz o índice único afirmar algo que o dado
-- não sustenta, e no dia em que entrar um segundo provedor — que é justamente
-- a portabilidade que a 0002 quis preservar — a chave certa já não pode ser
-- criada sem reescrever o que existe. O par `(emissor, subject)` é a
-- identidade de verdade, e custa uma coluna hoje.
--
-- O que esta migração **não** faz: criar usuário. O Google prova quem a pessoa
-- é; nunca o que ela pode fazer. Conta sem convite não entra, e é por isso que
-- o vínculo se estabelece contra um `usuario` que já existe, já tem tenant e já
-- tem perfil (RN-L25 e o eixo de cliente continuam valendo inteiros).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- usuario.subject_oidc : uuid -> text, e o emissor ao lado
-- -----------------------------------------------------------------------------

-- O índice depende da coluna; cai e volta depois da conversão.
drop index if exists public.usuario_subject_uk;

alter table public.usuario
  alter column subject_oidc type text using subject_oidc::text;

alter table public.usuario
  add column if not exists emissor_oidc text;

comment on column public.usuario.subject_oidc is
  'Identificador do usuário no provedor de identidade (claim `sub`). Para o '
  'Google é uma string numérica, não UUID. Vinculado no primeiro login contra '
  'o e-mail convidado, e imutável a partir daí.';

comment on column public.usuario.emissor_oidc is
  'Claim `iss` do provedor — `https://accounts.google.com` para o Google. '
  'Guardado porque `sub` só é único dentro de um provedor: a identidade é o '
  'par, e sem o emissor um segundo provedor não entra sem reescrever a chave.';

-- Os dois andam juntos: subject sem emissor é identidade pela metade, e
-- emissor sem subject não identifica ninguém.
alter table public.usuario
  drop constraint if exists usuario_oidc_completo;
alter table public.usuario
  add constraint usuario_oidc_completo check (
    (subject_oidc is null and emissor_oidc is null)
    or (subject_oidc is not null and emissor_oidc is not null)
  );

-- Mesma garantia de antes, agora sobre a chave correta: um login do provedor
-- não pode apontar para dois usuários — nem dentro de um tenant, nem entre
-- tenants. É o que impede que um convite para o mesmo e-mail em dois
-- locatários vire uma identidade ambígua na hora de decidir o recorte.
create unique index if not exists usuario_oidc_uk
  on public.usuario (emissor_oidc, subject_oidc)
  where subject_oidc is not null and deleted_at is null;

-- -----------------------------------------------------------------------------
-- Senha: o que deixa de ser caminho de entrada
-- -----------------------------------------------------------------------------
--
-- `senha_hash`, `politica_senha` e `token_recuperacao` continuam existindo e
-- **não** são removidos aqui, de propósito.
--
-- Remover coluna com dado é irreversível, e a decisão de qual instalação entra
-- só por Google é de configuração, não de esquema: a API fecha o login por
-- senha quando houver provedor configurado (ver `auth.service.ts`). Esquema que
-- decide política deixa a política impossível de mudar sem migração.
--
-- O que muda de fato é a recuperação: com o Google como provedor, "esqueci
-- minha senha" não é mais pergunta para este sistema. Quem recupera a conta é
-- o Google, no fluxo dele, com os fatores dele. Manter uma recuperação própria
-- ao lado seria manter uma porta alternativa com fatores mais fracos — que é
-- exatamente o que se quis eliminar ao adotar o provedor.
comment on column public.usuario.senha_hash is
  'Senha local. Caminho legado: onde há provedor de identidade configurado, a '
  'API recusa login por senha e a recuperação é a do provedor. Mantida para '
  'instalações sem provedor e para não perder dado de forma irreversível.';

-- -----------------------------------------------------------------------------
-- Superfície de autenticação para o provedor
--
-- Mesma natureza das funções da 0016: leitura de usuário **sem contexto de
-- tenant**, porque o tenant é justamente o que o login descobre. Daí
-- `security definer`, e daí a revogação de `public` no fim — sem ela, qualquer
-- conexão do banco leria o hash de senha de qualquer usuário de qualquer
-- locatário.
-- -----------------------------------------------------------------------------

-- A de e-mail passa a devolver também o vínculo com o provedor: o login por
-- Google precisa saber, na mesma consulta, se a conta já está vinculada a
-- outra identidade. `drop` antes de `create` porque mudar o tipo de retorno é
-- o único caso em que `create or replace` não basta.
drop function if exists app.auth_usuario_por_email(text);

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
  politica_senha    jsonb,
  subject_oidc      text,
  emissor_oidc      text
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.id, u.tenant_id, u.nome, u.email, u.tipo, u.cliente_id, u.status::text,
         u.senha_hash, u.senha_alterada_em, u.deve_trocar_senha, u.bloqueado_ate,
         t.politica_senha, u.subject_oidc, u.emissor_oidc
    from public.usuario u
    join public.tenant t on t.id = u.tenant_id
   where lower(u.email) = lower(btrim(p_email))
     and u.deleted_at is null;
$$;

comment on function app.auth_usuario_por_email(text) is
  'RN-L41. Única leitura de usuário sem contexto de tenant — o tenant é o que o login descobre.';

/**
 * O mesmo, pelo vínculo com o provedor.
 *
 * Existe separada da busca por e-mail, e a razão é a que torna o vínculo útil:
 * **o e-mail da conta Google pode mudar**, o `sub` não. Quem já entrou uma vez
 * é reconhecido pelo subject mesmo que a empresa tenha renomeado a caixa, e é
 * o que evita que uma troca de domínio no locatário transforme todo mundo em
 * desconhecido no mesmo dia.
 */
create or replace function app.auth_usuario_por_oidc(p_emissor text, p_subject text)
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
  politica_senha    jsonb,
  subject_oidc      text,
  emissor_oidc      text
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.id, u.tenant_id, u.nome, u.email, u.tipo, u.cliente_id, u.status::text,
         u.senha_hash, u.senha_alterada_em, u.deve_trocar_senha, u.bloqueado_ate,
         t.politica_senha, u.subject_oidc, u.emissor_oidc
    from public.usuario u
    join public.tenant t on t.id = u.tenant_id
   where u.emissor_oidc = p_emissor
     and u.subject_oidc = p_subject
     and u.deleted_at is null;
$$;

/**
 * Vincula a conta do provedor ao usuário convidado — uma única vez.
 *
 * O `where subject_oidc is null` é a regra inteira, e ela é de confiança no
 * primeiro uso: quem chega com o e-mail convidado e um token verificado fica
 * dono daquele cadastro. A partir daí o vínculo não se reescreve, e um segundo
 * Google com o mesmo e-mail não toma o lugar do primeiro.
 *
 * Devolve quantas linhas vinculou, para quem chama distinguir "vinculei" de
 * "alguém já estava vinculado" sem uma segunda consulta — a diferença entre as
 * duas é a diferença entre deixar entrar e recusar.
 */
create or replace function app.auth_vincular_oidc(
  p_usuario uuid,
  p_emissor text,
  p_subject text
)
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare v_n integer;
begin
  update public.usuario
     set subject_oidc = p_subject,
         emissor_oidc = p_emissor,
         updated_at   = now()
   where id = p_usuario
     and subject_oidc is null
     and deleted_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Mesma revogação da 0016, pelo mesmo motivo, agora sobre as funções novas.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p
     where p.pronamespace = 'app'::regnamespace
       and p.proname like 'auth\_%'
  loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to iarx_app', f.assinatura);
  end loop;
end $$;
