-- =============================================================================
-- TESTE — Escopo de cliente em `usuario_perfil`
--
-- O que está em jogo: **o eixo de cliente inteiro depende de uma linha que não
-- podia ser inserida**.
--
-- A migração 0011 construiu tudo o que o recorte por cliente precisa — o enum
-- com `CLIENTE` e `LOCAL_CLIENTE`, `app.clientes_visiveis()`,
-- `app.habilitar_rls_cliente()`, políticas restritivas em nove tabelas, três
-- perfis de cliente provisionados por gatilho — e deixou intacta a restrição
-- `usuario_perfil_escopo_coerente`, escrita na 0002, quando os dois valores não
-- existiam. Nenhum dos ramos do CHECK os menciona, e um CHECK que não casa com
-- ramo nenhum é falso: os dois escopos eram recusados com id e sem id.
--
-- É o defeito que não tem sintoma até alguém tentar usar a funcionalidade: cada
-- peça isolada funciona, e a montagem é impossível.
--
-- A 0022 estende a restrição. Este arquivo prova as duas metades: que os
-- escopos de cliente agora entram, e que a coerência que existia continua de pé.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_t uuid := gen_random_uuid();
  v_emp uuid; v_fil uuid; v_grupo uuid; v_cli uuid; v_local uuid;
  v_perfil uuid; v_usuario uuid;
  v_erro text;
begin
  insert into public.tenant (id, nome) values (v_t, 'Locadora Escopo');
  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_t, 'ESCOPO LTDA', '11222333000181') returning id into v_emp;
  insert into public.filial (tenant_id, empresa_id, codigo, nome)
    values (v_t, v_emp, 'SP-01', 'Base SP') returning id into v_fil;
  insert into public.cliente (tenant_id, documento, razao_social)
    values (v_t, '11444777000161', 'CLIENTE ALFA LTDA') returning id into v_cli;
  insert into public.local_operacao (tenant_id, cliente_id, codigo, nome)
    values (v_t, v_cli, 'MATRIZ', 'Matriz do cliente') returning id into v_local;

  insert into public.usuario (tenant_id, nome, email, status, tipo, cliente_id)
    values (v_t, 'Gestor da Unidade', 'gestor@cliente.test', 'ATIVO', 'CLIENTE', v_cli)
    returning id into v_usuario;

  /*
   * O perfil de cliente vem do provisionamento da 0011, não é inventado aqui.
   * Se ele não existir, o gatilho `tenant_provisiona_perfis` não rodou — e o
   * teste precisa falhar por isso, não por um perfil de mentira.
   */
  select id into v_perfil from public.perfil
   where tenant_id = v_t and tipo = 'CLIENTE' and nome like 'Gestor%'
   limit 1;
  if v_perfil is null then
    raise exception 'FALHA: a 0011 não provisionou os perfis de cliente deste locatário';
  end if;

  -- ---------- caso 1: CLIENTE entra, e sem id
  --
  -- Sem id de propósito: o cliente do usuário vem do token (`app.cliente_id`), e
  -- é dali que `app.clientes_visiveis()` resolve o grupo. Repetir o id aqui
  -- criaria duas fontes para a mesma verdade.
  insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo)
    values (v_t, v_usuario, v_perfil, 'CLIENTE');
  raise notice 'caso 1 OK — escopo CLIENTE aceito sem id';

  -- ---------- caso 2: CLIENTE com id é recusado
  v_erro := null;
  begin
    insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo, escopo_id)
      values (v_t, v_usuario, v_perfil, 'CLIENTE', v_cli);
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: escopo CLIENTE aceitou id — seriam duas fontes para o mesmo recorte';
  end if;
  raise notice 'caso 2 OK — CLIENTE não leva id: o recorte vem do token';

  -- ---------- caso 3: LOCAL_CLIENTE entra, e exige id
  --
  -- Este é o oposto: ele existe para recortar **abaixo** do cliente, e o token
  -- não carrega qual local. É o escopo que RN-L26 e RN-L34 vão consumir.
  insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo, escopo_id)
    values (v_t, v_usuario, v_perfil, 'LOCAL_CLIENTE', v_local);
  raise notice 'caso 3 OK — escopo LOCAL_CLIENTE aceito com id';

  v_erro := null;
  begin
    insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo)
      values (v_t, v_usuario, v_perfil, 'LOCAL_CLIENTE');
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: LOCAL_CLIENTE sem id foi aceito — não recortaria nada';
  end if;
  raise notice 'caso 4 OK — LOCAL_CLIENTE sem id é recusado';

  -- ---------- caso 5: a coerência que já existia continua valendo
  --
  -- A correção estende a restrição; não pode afrouxá-la. Os quatro casos da 0002
  -- são repetidos aqui porque uma migração que "conserta" relaxando é o defeito
  -- mais fácil de introduzir e o mais difícil de notar.
  v_erro := null;
  begin
    insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo, escopo_id)
      values (v_t, v_usuario, v_perfil, 'TENANT', v_fil);
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA: TENANT aceitou id'; end if;

  v_erro := null;
  begin
    insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo)
      values (v_t, v_usuario, v_perfil, 'FILIAL');
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA: FILIAL sem id foi aceita'; end if;

  raise notice 'caso 5 OK — a coerência anterior não foi afrouxada';
end $$;

-- ------------- caso 6: o enum e a restrição concordam
--
-- O defeito que a 0022 corrige era exatamente uma discordância entre os dois: o
-- tipo aceitava dois valores que a restrição recusava em qualquer combinação.
-- Este caso é o que impede a discordância de voltar — um valor novo no enum sem
-- ramo correspondente no CHECK falha aqui.
do $$
declare v_faltando text;
begin
  select string_agg(e.enumlabel, ', ') into v_faltando
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'escopo_tipo'
     and position(e.enumlabel in (
       select pg_get_constraintdef(oid) from pg_constraint
        where conname = 'usuario_perfil_escopo_coerente'
     )) = 0;

  if v_faltando is not null then
    raise exception 'FALHA: escopo(s) no enum sem ramo na restrição: %', v_faltando;
  end if;
  raise notice 'caso 6 OK — todo valor do enum tem ramo na restrição';
end $$;

rollback;

\echo '== 15_escopo_de_cliente: TODOS OS CASOS APROVADOS =='
