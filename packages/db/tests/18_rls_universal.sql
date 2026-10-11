-- =============================================================================
-- TESTE RN-028 — Nenhuma tabela alcançável fica fora da RLS
--
-- O 02 prova que a RLS **funciona**: dois tenants na mesma conexão não se
-- enxergam. Este prova que ela **alcança tudo** — que nenhuma tabela nasceu, ou
-- voltará a nascer, fora do regime.
--
-- Existia uma verificação para isso no CI, e ela era textual: procurava a
-- chamada `app.habilitar_rls_tenant('<tabela>')` no texto das migrações. Media
-- a forma da escrita, não o efeito. Dezenove tabelas habilitam RLS dentro de um
-- `foreach t in array array[...]`, passando o nome por variável; o texto
-- `habilitar_rls_tenant('consumo_competencia'` nunca aparece, e a verificação
-- reprovava dezenove tabelas protegidas. Um portão que acusa quem está certo é
-- desligado antes de pegar quem está errado.
--
-- Aqui a pergunta é feita ao catálogo, que não tem como discordar do banco:
-- quem a RLS alcança é quem `pg_class.relrowsecurity` diz que ela alcança,
-- tenha a tabela sido criada por `create table`, por laço ou por SQL dinâmico.
--
-- O recorte — "tabela alcançável" — é derivado, não mantido à mão. Partição de
-- tabela particionada não aparece na lista porque nenhum papel de aplicação
-- recebeu privilégio sobre ela: a consulta entra pelo pai, e a política do pai
-- vale. Não é dispensa escrita em lista de exceções, que envelheceria calada —
-- é consequência do privilégio. No dia em que alguém conceder acesso direto a
-- uma partição, ela entra no recorte sozinha e este teste reprova.
-- =============================================================================
\set ON_ERROR_STOP on

do $$
declare
  r             record;
  v_descobertas text := '';
  v_total       integer := 0;
  v_cobertas    integer := 0;
begin
  for r in
    select c.oid,
           c.relname,
           c.relrowsecurity      as habilitada,
           c.relforcerowsecurity as forcada,
           (select count(*) from pg_policy p where p.polrelid = c.oid) as politicas
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       -- Alcançável: algum papel de aplicação consegue ler. `service_role`
       -- fica de fora de propósito — ele contorna a RLS por desenho, e é por
       -- isso que a API nunca roda com ele (ver guardas-supabase no CI).
       and (has_table_privilege('iarx_app',      c.oid, 'select')
         or has_table_privilege('authenticated', c.oid, 'select')
         or has_table_privilege('anon',          c.oid, 'select'))
       -- Dado de referência do PostGIS: catálogo de sistemas de coordenadas,
       -- igual em qualquer instalação do mundo. Não tem coluna de tenant
       -- porque não tem dono — e sem ela não há o que uma política recortasse.
       and c.relname <> 'spatial_ref_sys'
     order by c.relname
  loop
    v_total := v_total + 1;

    if r.habilitada and r.forcada and r.politicas > 0 then
      v_cobertas := v_cobertas + 1;
    else
      v_descobertas := v_descobertas || format(
        E'\n  public.%s — enable=%s force=%s políticas=%s',
        r.relname, r.habilitada, r.forcada, r.politicas
      );
    end if;
  end loop;

  -- Piso de massa: se a consulta parar de enxergar as tabelas — esquema
  -- renomeado, privilégios revogados em bloco — ela passaria vazia e aprovaria
  -- um banco inteiro sem olhar para ele.
  if v_total < 55 then
    raise exception 'FALHA: só % tabela(s) alcançável(is) no recorte — a consulta deixou de enxergar o esquema?', v_total;
  end if;

  if v_descobertas <> '' then
    raise exception E'FALHA RN-028: tabela alcançável sem RLS completa:%\n\nTrês coisas são exigidas, e cada uma por um motivo:\n  enable   — sem ela a política não é consultada;\n  force    — sem ela o dono da tabela escapa da política;\n  políticas — com RLS e nenhuma política a tabela nega tudo, o que não vaza\n              dado mas quebra a aplicação em silêncio.', v_descobertas;
  end if;

  raise notice 'OK — % tabela(s) alcançável(is), todas com RLS habilitada, forçada e com política', v_cobertas;
end $$;

-- ---------------------------------------------------------------- partições
-- Partição exposta sem RLS nenhuma já cai no caso acima: ela entra no recorte e
-- reprova por `enable=f`. O que escapa de lá é o caso enganoso — partição com
-- privilégio direto **e** com RLS própria, que passa no primeiro exame parecendo
-- em ordem. A política dela não é a do pai: quem consulta pela partição recebe
-- o recorte que a partição define, e quem consulta pelo pai recebe outro. Duas
-- respostas para a mesma pergunta é pior que nenhuma, porque as duas parecem
-- certas. Por isso aqui a exigência não é "tenha política", é "não seja
-- alcançável de fora do pai".
do $$
declare r record; v_expostas text := ''; v_n integer := 0;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_inherits i on i.inhrelid = c.oid
      join pg_class pai  on pai.oid = i.inhparent
     where c.relnamespace = 'public'::regnamespace
       and pai.relkind = 'p'
     order by c.relname
  loop
    v_n := v_n + 1;
    if has_table_privilege('iarx_app',      r.relname, 'select')
    or has_table_privilege('authenticated', r.relname, 'select')
    or has_table_privilege('anon',          r.relname, 'select') then
      v_expostas := v_expostas || ' ' || r.relname;
    end if;
  end loop;

  if v_n = 0 then
    raise exception 'FALHA: nenhuma partição encontrada — audit_log, leitura_medidor e log_acesso são particionadas';
  end if;

  if v_expostas <> '' then
    raise exception 'FALHA RN-028: partição com privilégio direto e sem política própria:%. A consulta pelo pai respeita a política do pai; a consulta pela partição, não.', v_expostas;
  end if;

  raise notice 'OK — % partição(ões), nenhuma alcançável fora do pai', v_n;
end $$;

\echo '== 18_rls_universal: TODOS OS CASOS APROVADOS =='
