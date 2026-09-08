-- =============================================================================
-- 0024 — Escopo de unidade: a tabela que existia sem leitor
--
-- Referências: docs/anexos/L-lacunas-funcionais.md §Módulo 5 (RN-L26, RN-L34),
--              docs/anexos/C-matriz-de-permissoes.md §C.1,
--              docs/anexos/W-portal-do-cliente.md
--
-- `usuario_local_cliente` existe desde a 0011 — criada, indexada, auditada,
-- isolada por locatário — e **nenhuma política de RLS ou rota a consultava**.
-- RN-L26 e RN-L34 ("gestor de unidade não alcança o consolidado do grupo") não
-- estavam implementadas em lugar nenhum.
--
-- O efeito, medido antes de escrever esta migração: um usuário de cliente com
-- escopo `LOCAL_CLIENTE` vinculado a **uma** unidade enxergava **duas** — a dele
-- e a irmã. A política de cliente fazia o seu trabalho (as unidades de outro
-- cliente ficavam invisíveis); o recorte abaixo do cliente é que não existia.
--
-- É a terceira peça desta sessão que estava construída e sem consumidor, depois
-- do escopo que a restrição recusava (0022) e do `app.motivo` que a trilha lia e
-- ninguém preenchia.
--
-- -----------------------------------------------------------------------------
-- A decisão: **o escopo decide se o recorte se aplica; o vínculo diz quais.**
--
--  · perfil com escopo `CLIENTE` → o próprio CNPJ e o grupo econômico, como
--    hoje. Não muda nada;
--  · perfil com escopo `LOCAL_CLIENTE` → só os locais vinculados em
--    `usuario_local_cliente`. Sem vínculo, nada — que é o "negado por omissão"
--    de RN-L26.
--
-- Três razões. **Primeira**, é onde o Anexo C §C.1 diz que o recorte mora: a
-- fórmula é `permissão AND escopo AND alçada`, e o escopo é
-- `usuario_perfil.escopo_tipo`. Fazer o recorte depender da *existência* de
-- vínculos criaria um quarto termo que a fórmula não tem — e o Administrador do
-- cliente, que não tem vínculo nenhum, deixaria de ver o grupo.
--
-- **Segunda**, resolve a contradição que o Anexo L aponta. "Sem vínculo, não vê
-- nada" e "o Administrador do cliente não tem vínculo e vê tudo" só são
-- verdadeiras ao mesmo tempo se o gatilho do recorte for o escopo.
--
-- **Terceira**, dá consumidor ao que a 0022 destravou: `LOCAL_CLIENTE` só passou
-- a ser inserível naquela migração.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Quem tem escopo de unidade
--
-- `security definer` pela mesma razão de `app.clientes_visiveis`: a consulta
-- atravessa `usuario_perfil`, e o usuário de cliente não precisa — nem deve —
-- ter leitura direta dela para que a própria visão seja recortada.
--
-- Um usuário pode ter mais de um perfil (Anexo C §C.1). Basta **um** com escopo
-- de unidade para o recorte valer: o contrário permitiria contornar o recorte
-- ganhando um segundo perfil mais amplo, e a soma de dois recortes não é o mais
-- permissivo dos dois quando um deles existe para restringir.
-- -----------------------------------------------------------------------------
create or replace function app.tem_escopo_de_unidade()
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from public.usuario_perfil up
     where up.usuario_id = app.usuario_atual()
       and up.tenant_id = app.tenant_atual()
       and up.escopo_tipo = 'LOCAL_CLIENTE'
  );
$$;

comment on function app.tem_escopo_de_unidade() is
  'Basta um perfil com escopo LOCAL_CLIENTE: um segundo perfil mais amplo não deve dissolver um recorte que existe para restringir.';

/**
 * Os locais que o usuário atual alcança.
 *
 * Conjunto vazio **não** significa "todos". Quem tem escopo de unidade e nenhum
 * vínculo não vê local nenhum, e é isso que RN-L26 pede: negado por omissão. O
 * curto-circuito de quem não tem esse escopo está em `app.local_visivel`, não
 * aqui — esta função responde só "quais", nunca "se".
 */
create or replace function app.locais_visiveis()
returns setof uuid
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select ulc.local_operacao_id
    from public.usuario_local_cliente ulc
   where ulc.usuario_id = app.usuario_atual()
     and ulc.tenant_id = app.tenant_atual();
$$;

/**
 * Predicado de visibilidade de unidade.
 *
 * Dois curto-circuitos, e são eles que permitem acrescentar a política a
 * qualquer tabela sem quebrar o que já funciona — a mesma construção que
 * `app.cliente_visivel` usa desde a 0011:
 *
 *  1. **sem contexto de cliente**: o usuário é da locadora, o eixo não se aplica;
 *  2. **sem escopo de unidade**: é o Administrador do cliente, que vê o grupo.
 *
 * Fora deles, o id precisa estar no conjunto. Nulo cai fora por consequência do
 * `in`, e é o desejado: linha sem local não está em unidade nenhuma, e quem
 * enxerga por unidade não a alcança.
 */
create or replace function app.local_visivel(p_local_id uuid)
returns boolean
language sql
stable
as $$
  select app.cliente_atual() is null
      or not app.tem_escopo_de_unidade()
      or p_local_id in (select app.locais_visiveis());
$$;

comment on function app.local_visivel(uuid) is
  'RN-L26/RN-L34. Nulo é invisível para quem tem escopo de unidade: linha sem local não está em unidade nenhuma.';

grant execute on function app.tem_escopo_de_unidade(), app.locais_visiveis(),
                         app.local_visivel(uuid) to iarx_app, authenticated;

-- -----------------------------------------------------------------------------
-- A política, e por que ela é `restrictive`
--
-- O PostgreSQL combina políticas permissivas com **OU**. A de locatário e a de
-- cliente já existem nessas tabelas; uma permissiva a mais *abriria* acesso em
-- vez de fechar, que é o erro clássico deste recurso. Como `restrictive`, o
-- efeito é E: locatário **e** cliente **e** unidade.
-- -----------------------------------------------------------------------------
create or replace function app.habilitar_rls_unidade(p_tabela text, p_expressao text)
returns void
language plpgsql
as $$
begin
  execute format('drop policy if exists %I_unidade on public.%I', p_tabela, p_tabela);
  execute format(
    'create policy %I_unidade on public.%I as restrictive for all to iarx_app, authenticated
       using (app.local_visivel(%s))
       with check (app.local_visivel(%s))',
    p_tabela, p_tabela, p_expressao, p_expressao
  );
end;
$$;

select app.habilitar_rls_unidade('local_operacao', 'id');
select app.habilitar_rls_unidade('contrato_item', 'local_operacao_id');
select app.habilitar_rls_unidade('consumo_competencia', 'local_operacao_id');

-- -----------------------------------------------------------------------------
-- `equipamento` — o caminho indireto, e por que aqui ele é aceitável
--
-- O ativo não tem coluna de local de cliente: `local_atual_id` é texto livre com
-- `local_atual_tipo` sem CHECK, e uma política de segurança não deve depender de
-- uma coluna cujo domínio ninguém garante. O vínculo confiável é
-- `contrato_item.local_operacao_id`.
--
-- A 0011 rejeitou explicitamente percorrer `contrato_item` na política de
-- cliente — "tornaria a listagem impraticável" —, e a objeção continua correta
-- para *aquela* política, que vale para todo usuário de cliente. Aqui ela não se
-- aplica: os dois curto-circuitos de `app.local_visivel` respondem antes de
-- chegar ao `exists` para o usuário interno e para o Administrador do cliente. O
-- custo é pago só por quem tem escopo de unidade, que é a minoria — e para essa
-- minoria a alternativa não é uma consulta mais rápida, é ver o parque do grupo
-- inteiro.
-- -----------------------------------------------------------------------------
create or replace function app.equipamento_em_unidade_visivel(p_equipamento_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.cliente_atual() is null
      or not app.tem_escopo_de_unidade()
      or exists (
        select 1
          from public.contrato_item ci
         where ci.equipamento_id = p_equipamento_id
           and ci.tenant_id = app.tenant_atual()
           and ci.local_operacao_id in (select app.locais_visiveis())
      );
$$;

comment on function app.equipamento_em_unidade_visivel(uuid) is
  'Recorte de unidade do parque, por contrato_item. O custo do exists é pago só por quem tem escopo de unidade.';

grant execute on function app.equipamento_em_unidade_visivel(uuid) to iarx_app, authenticated;

drop policy if exists equipamento_unidade on public.equipamento;
create policy equipamento_unidade on public.equipamento as restrictive for all to iarx_app, authenticated
  using (app.equipamento_em_unidade_visivel(id))
  with check (app.equipamento_em_unidade_visivel(id));
