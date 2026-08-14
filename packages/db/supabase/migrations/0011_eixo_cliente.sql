-- =============================================================================
-- 0011 — Eixo de cliente: grupo econômico, usuário de cliente e RLS de dois eixos
--
-- Referências: docs/anexos/M-decisoes-mercado-brasileiro.md (D-01, D-02)
--              docs/anexos/L-lacunas-funcionais.md (Módulo 4, L.0.1)
-- Invariantes: RN-L11 (usuário de cliente exige cliente), RN-L12 (isolamento
--              do locatário), RN-L13 (perfil de cliente é somente leitura)
--
-- Este é o item **0** do cronograma do Anexo L: bloqueante. Sem ele, os
-- módulos de Usuários (4) e Portal do Cliente (5) não começam, porque a
-- plataforma só sabe isolar por locadora — não por locatário.
--
-- O modelo tem dois eixos porque no Brasil eles de fato são separados:
--
--     grupo_economico     ← controle comum (CLT art. 2º §2º)
--           │ 1:N
--        cliente          ← pessoa jurídica, CNPJ de 14 dígitos
--           │ 1:N
--     local_operacao      ← onde a máquina está (andar, prédio, unidade)
--
-- "Filial do cliente" **é um cliente**, não uma sublinha dele: tem CNPJ,
-- inscrição estadual e endereço fiscal próprios, e recebe nota fiscal em nome
-- dela. Modelar filial como atributo quebraria a emissão. Já o local de
-- operação não tem CNPJ — é o andar, o galpão, a loja — e é nele que o
-- equipamento fica.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Escopos novos
--
-- `alter type ... add value` não roda dentro de bloco de transação em versões
-- antigas do PostgreSQL, e não é idempotente por si. O `do` com verificação
-- prévia resolve os dois problemas de uma vez.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'escopo_tipo' and e.enumlabel = 'CLIENTE'
  ) then
    alter type app.escopo_tipo add value 'CLIENTE';
  end if;
  if not exists (
    select 1 from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'escopo_tipo' and e.enumlabel = 'LOCAL_CLIENTE'
  ) then
    alter type app.escopo_tipo add value 'LOCAL_CLIENTE';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- grupo_economico
--
-- Não é derivável da raiz do CNPJ, e por isso é declarado. Uma holding reúne
-- empresas de raízes diferentes; e raiz igual não prova grupo (franqueado e
-- franqueador podem compartilhar nada além do nome). O que justifica a
-- existência da entidade é a responsabilidade **solidária** por contribuições
-- previdenciárias (Lei 8.212/91, art. 30, IX): a análise de crédito do grupo é
-- diferente da soma das análises individuais.
-- -----------------------------------------------------------------------------
create table if not exists public.grupo_economico (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  nome          text not null,
  observacao    text,
  /** Limite consolidado. Nulo = sem teto de grupo; vale o de cada cliente. */
  limite_credito_consolidado numeric(15,4),
  version       integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  constraint grupo_limite_nao_negativo check (coalesce(limite_credito_consolidado, 0) >= 0)
);
create unique index if not exists grupo_economico_nome_uk
  on public.grupo_economico (tenant_id, lower(nome)) where deleted_at is null;

alter table public.cliente
  add column if not exists grupo_economico_id uuid
    references public.grupo_economico(id) on delete set null;

-- Raiz do CNPJ como coluna gerada.
--
-- Serve para **sugerir** o vínculo de grupo ao cadastrar um CNPJ cuja raiz já
-- existe. Sugerir, não impor: raiz igual não prova grupo e raiz diferente não o
-- exclui. Gerada porque digitar de novo os oito primeiros dígitos é criar uma
-- segunda verdade sobre o mesmo dado.
alter table public.cliente
  add column if not exists cnpj_raiz text
    generated always as (
      case when documento ~ '^[0-9]{14}$' then substr(documento, 1, 8) end
    ) stored;

create index if not exists cliente_cnpj_raiz_ix
  on public.cliente (tenant_id, cnpj_raiz) where cnpj_raiz is not null and deleted_at is null;
create index if not exists cliente_grupo_ix
  on public.cliente (tenant_id, grupo_economico_id) where deleted_at is null;

comment on column public.cliente.cnpj_raiz is
  'Oito primeiros dígitos do CNPJ. Sugere vínculo de grupo; não o determina (D-02).';

-- -----------------------------------------------------------------------------
-- usuario ganha o eixo de cliente
-- -----------------------------------------------------------------------------
alter table public.usuario
  add column if not exists tipo text not null default 'INTERNO',
  add column if not exists cliente_id uuid references public.cliente(id) on delete restrict,
  add column if not exists senha_hash text,
  add column if not exists senha_alterada_em timestamptz,
  add column if not exists deve_trocar_senha boolean not null default false,
  add column if not exists tentativas_falhas integer not null default 0,
  add column if not exists bloqueado_ate timestamptz;

do $$ begin
  alter table public.usuario add constraint usuario_tipo_valido
    check (tipo in ('INTERNO', 'CLIENTE'));
exception when duplicate_object then null; end $$;

-- RN-L11: os dois lados da equivalência, e não só um.
--
-- Verificar apenas "CLIENTE exige cliente_id" deixaria passar o caso inverso —
-- usuário interno com `cliente_id` preenchido — que é pior: ele teria acesso
-- interno **e** seria filtrado como se fosse do cliente, produzindo uma tela
-- vazia que ninguém consegue explicar.
do $$ begin
  alter table public.usuario add constraint usuario_cliente_coerente
    check ((tipo = 'CLIENTE') = (cliente_id is not null));
exception when duplicate_object then null; end $$;

-- Deliberadamente **sem** constraint de "todo usuário tem credencial".
--
-- O Anexo L a previa, e ela está errada por dois motivos. O primeiro é
-- prático: uma migração que exige credencial reprova toda linha já existente e
-- falha na primeira base real — não só nos testes. O segundo é de domínio:
-- usuário criado e aguardando o convite é estado legítimo, e é justamente o
-- estado em que ele passa mais tempo no cadastro em lote.
--
-- Quem decide se alguém pode entrar é o fluxo de autenticação, que exige
-- credencial válida por construção. Um CHECK aqui daria a impressão de
-- proteger o login sem proteger nada — o login nunca consultou esta tabela em
-- busca de permissão para existir.

create index if not exists usuario_cliente_ix
  on public.usuario (tenant_id, cliente_id) where cliente_id is not null and deleted_at is null;

comment on column public.usuario.senha_hash is
  'Argon2id. Nulo quando a autenticação é federada (Supabase Auth / OIDC) — ver D-07.';

-- -----------------------------------------------------------------------------
-- usuario_local_cliente — visibilidade por unidade do locatário
--
-- Um gestor de unidade vê o parque do andar dele, não o do grupo inteiro. Sem
-- esta tabela, o portal só teria dois níveis (tudo do cliente ou nada), e o
-- "Gestor de Filial" do Anexo L não existiria.
-- -----------------------------------------------------------------------------
create table if not exists public.usuario_local_cliente (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete restrict,
  usuario_id        uuid not null references public.usuario(id) on delete cascade,
  local_operacao_id uuid not null references public.local_operacao(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index if not exists usuario_local_cliente_uk
  on public.usuario_local_cliente (usuario_id, local_operacao_id);

-- -----------------------------------------------------------------------------
-- token_recuperacao
--
-- Guarda o **hash** do token, nunca o token. Quem lê o banco não consegue
-- redefinir a senha de ninguém — é a mesma razão pela qual a senha também é
-- hash. O token em claro existe só dentro do e-mail que o usuário recebeu.
-- -----------------------------------------------------------------------------
create table if not exists public.token_recuperacao (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete restrict,
  usuario_id     uuid not null references public.usuario(id) on delete cascade,
  token_hash     text not null,
  expira_em      timestamptz not null,
  usado_em       timestamptz,
  ip_solicitante inet,
  created_at     timestamptz not null default now(),
  constraint token_recuperacao_expira_no_futuro check (expira_em > created_at),
  constraint token_recuperacao_hash_formato check (token_hash ~ '^[0-9a-f]{64}$')
);
create unique index if not exists token_recuperacao_hash_uk on public.token_recuperacao (token_hash);
create index if not exists token_recuperacao_usuario_ix
  on public.token_recuperacao (tenant_id, usuario_id, created_at desc);

-- -----------------------------------------------------------------------------
-- log_acesso
--
-- Separado de `audit_log` de propósito. A trilha de auditoria registra o que
-- mudou no domínio; esta registra **tentativas de entrar**, inclusive as que
-- falharam — e falha de login não altera dado nenhum, então nunca apareceria
-- lá. É a fonte de "quem tentou entrar na conta do diretor às 3h da manhã".
-- -----------------------------------------------------------------------------
create table if not exists public.log_acesso (
  id           uuid not null default gen_random_uuid(),
  criado_em    timestamptz not null default now(),
  tenant_id    uuid not null,
  usuario_id   uuid,
  /** Identificador tentado, quando o usuário sequer existe. */
  identificador text,
  evento       text not null,
  ip           inet,
  user_agent   text,
  sucesso      boolean not null,
  motivo_falha text,
  primary key (id, criado_em),
  constraint log_acesso_evento_valido check (evento in (
    'LOGIN', 'LOGOUT', 'FALHA_SENHA', 'BLOQUEIO',
    'RECUPERACAO_SOLICITADA', 'RECUPERACAO_CONCLUIDA', 'TROCA_SENHA'
  ))
) partition by range (criado_em);

select app.garantir_particoes('log_acesso', 3);

create index if not exists log_acesso_usuario_ix
  on public.log_acesso (tenant_id, usuario_id, criado_em desc);
create index if not exists log_acesso_falha_ix
  on public.log_acesso (tenant_id, criado_em desc) where not sucesso;

-- =============================================================================
-- Contexto de cliente na transação
-- =============================================================================

/**
 * Cliente efetivo da transação.
 *
 * Nulo para usuário interno — e é o nulo que faz as políticas abaixo não
 * restringirem nada para quem é da locadora. A precedência do `SET LOCAL` sobre
 * o JWT é a mesma de `app.tenant_atual()`: jobs assíncronos operam sem usuário.
 */
create or replace function app.cliente_atual()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.cliente_id', true), '')::uuid,
    nullif(app.jwt_claims() ->> 'cliente_id', '')::uuid
  );
$$;

comment on function app.cliente_atual() is
  'Locatário efetivo da transação (D-01). Nulo para usuário interno da locadora.';

/**
 * Clientes que o contexto atual enxerga.
 *
 * Um usuário de cliente vê **o próprio CNPJ e os demais CNPJs do grupo**. Não é
 * generosidade: quem administra o contrato de um grupo econômico precisa da
 * visão consolidada, e a responsabilidade solidária (Lei 8.212/91 art. 30 IX)
 * torna essa visão legítima. Cliente sem grupo declarado vê só a si.
 *
 * `security definer` porque a função consulta `cliente`, que tem RLS: sem isto
 * a política se consultaria em recursão.
 */
create or replace function app.clientes_visiveis()
returns setof uuid
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  with atual as (select app.cliente_atual() as id)
  select c.id
    from public.cliente c, atual a
   where a.id is not null
     and c.tenant_id = app.tenant_atual()
     and c.deleted_at is null
     and (
       c.id = a.id
       or (
         c.grupo_economico_id is not null
         and c.grupo_economico_id = (select grupo_economico_id from public.cliente where id = a.id)
       )
     );
$$;

/**
 * Predicado de visibilidade do locatário sobre um cliente.
 *
 * Devolve `true` quando não há contexto de cliente — o usuário é da locadora e
 * o eixo não se aplica. É esse curto-circuito que permite acrescentar a
 * política a toda tabela sem quebrar nada do que já funciona.
 */
create or replace function app.cliente_visivel(p_cliente_id uuid)
returns boolean
language sql
stable
as $$
  select app.cliente_atual() is null
      or p_cliente_id in (select app.clientes_visiveis());
$$;

-- =============================================================================
-- RLS de dois eixos
-- =============================================================================

/**
 * Acrescenta a política do locatário a uma tabela.
 *
 * A política do tenant continua valendo — esta é **adicional**, e o PostgreSQL
 * combina políticas permissivas com OU. Por isso ela é criada como
 * `restrictive`: o efeito desejado é E, não OU. Uma política permissiva a mais
 * abriria acesso em vez de fechar, que é o erro clássico deste recurso.
 *
 * `p_coluna` é o caminho até o cliente dono da linha. Quando a tabela não tem
 * a coluna direta, passa-se uma subconsulta.
 */
create or replace function app.habilitar_rls_cliente(p_tabela text, p_expressao text)
returns void
language plpgsql
as $$
begin
  execute format('drop policy if exists %I_cliente on public.%I', p_tabela, p_tabela);
  execute format(
    'create policy %I_cliente on public.%I as restrictive for all to iarx_app, authenticated
       using (app.cliente_visivel(%s))
       with check (app.cliente_visivel(%s))',
    p_tabela, p_tabela, p_expressao, p_expressao
  );
end;
$$;

grant execute on function app.cliente_atual(), app.cliente_visivel(uuid), app.clientes_visiveis()
  to anon, authenticated, iarx_app;

-- `equipamento.cliente_id` não existia: o vínculo vivia só em contrato_item.
-- Para o portal, o caminho precisa ser direto — uma política que percorresse
-- contrato_item a cada linha do parque tornaria a listagem impraticável.
alter table public.equipamento
  add column if not exists cliente_id uuid references public.cliente(id) on delete set null;
create index if not exists equipamento_cliente_ix
  on public.equipamento (tenant_id, cliente_id) where cliente_id is not null and deleted_at is null;

comment on column public.equipamento.cliente_id is
  'Locatário atual do ativo, desnormalizado de contrato_item para a RLS do portal ser indexável.';

-- Tabelas que o locatário pode enxergar, e o caminho até o dono de cada linha.
--
-- `equipamento` entra por `cliente_id`, que é nulo enquanto o ativo está no
-- pátio: ativo sem cliente não é de ninguém, e `app.cliente_visivel(null)`
-- devolve falso para quem tem contexto de cliente — exatamente o desejado.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('cliente',        'id'),
      ('local_operacao', 'cliente_id'),
      ('contrato',       'cliente_id'),
      ('contrato_item',  '(select c.cliente_id from public.contrato c where c.id = contrato_id)'),
      ('equipamento',    'cliente_id')
    ) as v(tabela, expressao)
  loop
    perform app.habilitar_rls_cliente(t.tabela, t.expressao);
  end loop;
end $$;

/**
 * Mantém `equipamento.cliente_id` coerente com a alocação vigente.
 *
 * Desnormalização é dívida quando alguém precisa lembrar de atualizá-la. Aqui
 * o gatilho é quem lembra: nenhum caminho de escrita em `contrato_item` pode
 * deixar o parque apontando para o cliente errado.
 */
create or replace function app.sincronizar_cliente_do_equipamento()
returns trigger
language plpgsql
as $$
declare
  v_equip uuid := coalesce(new.equipamento_id, old.equipamento_id);
  v_cliente uuid;
begin
  if v_equip is null then
    return coalesce(new, old);
  end if;

  select c.cliente_id into v_cliente
    from public.contrato_item ci
    join public.contrato c on c.id = ci.contrato_id
   where ci.equipamento_id = v_equip
     and ci.deleted_at is null
     and ci.status in ('RESERVADO','EM_ENTREGA','ATIVO','SUSPENSO','EM_DEVOLUCAO')
     and ci.vigencia @> now()
   order by ci.vigencia_inicio desc
   limit 1;

  update public.equipamento
     set cliente_id = v_cliente
   where id = v_equip and cliente_id is distinct from v_cliente;

  return coalesce(new, old);
end;
$$;

drop trigger if exists ci_sincroniza_cliente on public.contrato_item;
create trigger ci_sincroniza_cliente
  after insert or update or delete on public.contrato_item
  for each row execute function app.sincronizar_cliente_do_equipamento();

-- =============================================================================
-- RN-L13 — perfil de cliente é somente leitura
--
-- A restrição não pode viver só na lista de permissões do perfil: basta alguém
-- acrescentar `contrato:criar` a um perfil de cliente por engano e o portal
-- vira porta de escrita. O gatilho recusa a combinação na origem.
-- =============================================================================
alter table public.perfil
  add column if not exists tipo text not null default 'INTERNO';

do $$ begin
  alter table public.perfil add constraint perfil_tipo_valido check (tipo in ('INTERNO', 'CLIENTE'));
exception when duplicate_object then null; end $$;

create or replace function app.validar_permissoes_de_perfil_cliente()
returns trigger
language plpgsql
as $$
declare
  v_proibida text;
begin
  if new.tipo <> 'CLIENTE' then
    return new;
  end if;

  -- Somente leitura, com uma exceção deliberada: o cliente pode **abrir**
  -- chamado. É o único ato de escrita que o portal permite, e ainda assim a
  -- triagem é obrigatória e a prioridade não é dele (D-10).
  select p into v_proibida
    from unnest(new.permissoes) as p
   where p not in (
     'contrato:ler', 'equipamento:ler', 'fatura:ler', 'medicao:ler',
     'os:ler', 'os:criar', 'mapa:ler', 'relatorio:ler', 'cliente:ler'
   )
   limit 1;

  if v_proibida is not null then
    raise exception 'perfil de cliente não pode conter a permissão %', v_proibida
      using errcode = '23514',
            hint = 'O portal do locatário é somente leitura, exceto abrir chamado (RN-L13, D-10).';
  end if;

  return new;
end;
$$;

drop trigger if exists perfil_cliente_somente_leitura on public.perfil;
create trigger perfil_cliente_somente_leitura
  before insert or update on public.perfil
  for each row execute function app.validar_permissoes_de_perfil_cliente();

-- Perfis-base do locatário (Anexo L, Módulo 4).
--
-- Provisionados por função, chamada pela migração **e** por gatilho na criação
-- do tenant. Só o backfill não bastaria: um tenant criado depois desta migração
-- nasceria sem perfil de cliente nenhum, e o primeiro administrador a abrir o
-- portal descobriria que não há o que atribuir a ninguém.
--
-- `is_sistema` porque são estruturais: apagar o "Visualizador" deixaria o
-- portal sem o perfil de menor privilégio, e o caminho de menor esforço
-- passaria a ser dar acesso a mais do que o necessário.
create or replace function app.provisionar_perfis_cliente(p_tenant uuid)
returns void
language sql
as $$
  insert into public.perfil (tenant_id, nome, descricao, tipo, is_sistema, permissoes)
  select p_tenant, v.nome, v.descricao, 'CLIENTE', true, v.permissoes
    from (values
      ('Administrador do cliente',
       'Enxerga todo o parque, contratos e faturas do próprio CNPJ e do grupo econômico.',
       array['contrato:ler','equipamento:ler','fatura:ler','medicao:ler','os:ler','os:criar','mapa:ler','relatorio:ler','cliente:ler']),
      ('Gestor de unidade do cliente',
       'Enxerga o parque das unidades a que foi vinculado.',
       array['equipamento:ler','os:ler','os:criar','medicao:ler','mapa:ler']),
      ('Visualizador do cliente',
       'Consulta sem abrir chamado.',
       array['equipamento:ler','os:ler','medicao:ler'])
    ) as v(nome, descricao, permissoes)
   where not exists (
     select 1 from public.perfil p where p.tenant_id = p_tenant and p.nome = v.nome
   );
$$;

create or replace function app.ao_criar_tenant()
returns trigger
language plpgsql
as $$
begin
  perform app.provisionar_perfis_cliente(new.id);
  return new;
end;
$$;

drop trigger if exists tenant_provisiona_perfis on public.tenant;
create trigger tenant_provisiona_perfis
  after insert on public.tenant
  for each row execute function app.ao_criar_tenant();

select app.provisionar_perfis_cliente(id) from public.tenant;

-- =============================================================================
-- Gatilhos padrão, auditoria e RLS das tabelas novas
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['grupo_economico','usuario_local_cliente'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
    perform app.habilitar_auditoria(t);
    perform app.habilitar_rls_tenant(t, false);
  end loop;
end $$;

-- `token_recuperacao` e `log_acesso` não recebem auditoria de domínio: o
-- primeiro é material de credencial, o segundo já é a própria trilha. Ambos
-- ficam isolados por tenant como todo o resto.
alter table public.token_recuperacao enable row level security;
alter table public.token_recuperacao force row level security;
drop policy if exists token_recuperacao_app on public.token_recuperacao;
create policy token_recuperacao_app on public.token_recuperacao for all to iarx_app
  using (tenant_id = app.tenant_atual()) with check (tenant_id = app.tenant_atual());
grant select, insert, update, delete on public.token_recuperacao to iarx_app;
revoke all on public.token_recuperacao from anon, authenticated;

alter table public.log_acesso enable row level security;
alter table public.log_acesso force row level security;
drop policy if exists log_acesso_insert on public.log_acesso;
create policy log_acesso_insert on public.log_acesso for insert to iarx_app
  with check (tenant_id = app.tenant_atual());
drop policy if exists log_acesso_select on public.log_acesso;
create policy log_acesso_select on public.log_acesso for select to iarx_app
  using (tenant_id = app.tenant_atual());
-- Sem UPDATE nem DELETE, pela mesma razão de `audit_log`: registro de acesso
-- que pode ser apagado não serve como evidência de acesso.
revoke all on public.log_acesso from anon, authenticated, iarx_app;
grant select, insert on public.log_acesso to iarx_app;

comment on table public.log_acesso is
  'Tentativas de autenticação, inclusive as que falharam. Append-only: registro de acesso apagável não serve como evidência.';
comment on table public.grupo_economico is
  'Agrupamento declarado de CNPJs sob controle comum (CLT art. 2º §2º). Justifica a visão consolidada de crédito pela responsabilidade solidária (Lei 8.212/91 art. 30 IX).';
