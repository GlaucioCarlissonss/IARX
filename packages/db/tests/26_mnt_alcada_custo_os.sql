-- =============================================================================
-- TESTE MNT — alçada de custo na validação da OS
--
-- `alcada` nasceu na 0002 com `CUSTO_OS` entre os tipos aceitos e nada nunca o
-- leu. É a terceira alçada nessa situação — `DESCONTO` estava assim do lado do
-- contrato até a 0033.
--
-- A validação é onde ela morde porque é onde o custo entra no resultado
-- (Anexo B.3: "lança custo no resultado"). Antes não há o que aprovar; depois
-- seria tarde.
--
-- Três coisas que estes casos protegem, e a terceira é a que ninguém lembra de
-- testar:
--
--  · sem alçada configurada, nada é exigido — teto zero por omissão travaria a
--    validação de toda ordem com custo num locatário que nunca configurou nada,
--    e sistema parado faz as pessoas desligarem a regra, não configurá-la;
--  · configurada, o teto vale;
--  · a ordem dos gatilhos. `os_transicao` responde se a transição existe;
--    a alçada, se esta pessoa a faz. Invertidos, quem tenta validar uma ordem
--    no estado errado ouve "peça a quem tem alçada" e vai procurar a pessoa
--    errada. A ordem depende só do nome alfabético, então ela some em silêncio
--    numa renomeação — e é por isso que há um caso para ela.
-- =============================================================================
\set ON_ERROR_STOP on

select gen_random_uuid() as t1, gen_random_uuid() as emp, gen_random_uuid() as fil,
       gen_random_uuid() as cat, gen_random_uuid() as fab, gen_random_uuid() as mod,
       gen_random_uuid() as eq, gen_random_uuid() as tec,
       gen_random_uuid() as perf_baixo, gen_random_uuid() as perf_alto,
       gen_random_uuid() as u_exec, gen_random_uuid() as u_baixo, gen_random_uuid() as u_alto
\gset

insert into public.tenant (id, nome) values (:'t1', 'Locadora CST');
insert into public.empresa (id, tenant_id, razao_social) values (:'emp', :'t1', 'CST LTDA');
insert into public.filial (id, tenant_id, empresa_id, codigo, nome)
  values (:'fil', :'t1', :'emp', 'CST-01', 'Base CST');
insert into public.categoria_equipamento (id, tenant_id, codigo, nome)
  values (:'cat', :'t1', 'MFP', 'Multifuncional');
insert into public.fabricante (id, tenant_id, nome) values (:'fab', :'t1', 'Fabricante CST');
insert into public.modelo (id, tenant_id, fabricante_id, categoria_id, codigo, nome)
  values (:'mod', :'t1', :'fab', :'cat', 'C-1', 'Modelo CST');
insert into public.equipamento (id, tenant_id, patrimonio, modelo_id, categoria_id, filial_id)
  values (:'eq', :'t1', 'CST-0001', :'mod', :'cat', :'fil');

insert into public.usuario (id, tenant_id, email, nome) values
  (:'u_exec',  :'t1', 'tecnico.cst@exemplo.local',    'Tecnico CST'),
  (:'u_baixo', :'t1', 'supervisor.cst@exemplo.local', 'Supervisor CST'),
  (:'u_alto',  :'t1', 'gerente.cst@exemplo.local',    'Gerente CST');

insert into public.tecnico (id, tenant_id, usuario_id, nome, matricula, filial_id)
  values (:'tec', :'t1', :'u_exec', 'Tecnico CST', 'CST-T1', :'fil');

insert into public.perfil (id, tenant_id, nome, permissoes) values
  (:'perf_baixo', :'t1', 'Supervisor CST', array['os:validar']),
  (:'perf_alto',  :'t1', 'Gerente CST',    array['os:validar', 'os:custo_aprovar']);

insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo) values
  (:'t1', :'u_baixo', :'perf_baixo', 'TENANT'),
  (:'t1', :'u_alto',  :'perf_alto',  'TENANT');

set role iarx_app;

-- ---------------------------------------------------------------- caso 1: sem alçada configurada, nada é exigido
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'u_baixo';
  set local app.teste_eq   = :'eq';
  set local app.teste_tec  = :'tec';

  do $$
  declare v_status app.os_status;
  begin
    insert into public.ordem_servico
      (tenant_id, numero, equipamento_id, filial_id, tipo, descricao,
       tecnico_responsavel_id, custo_terceiros)
    values (app.tenant_atual(), 'OS-CST-0001', current_setting('app.teste_eq')::uuid,
            (select id from public.filial where codigo = 'CST-01'),
            'CORRETIVA', 'troca de unidade de imagem',
            current_setting('app.teste_tec')::uuid, 4500.0000);

    update public.ordem_servico set status = 'TRIAGEM'     where numero = 'OS-CST-0001';
    update public.ordem_servico set status = 'AGENDADA'    where numero = 'OS-CST-0001';
    update public.ordem_servico set status = 'EM_EXECUCAO' where numero = 'OS-CST-0001';
    update public.ordem_servico set status = 'CONCLUIDA'   where numero = 'OS-CST-0001';
    update public.ordem_servico
       set status = 'VALIDADA', validado_por = current_setting('app.usuario_id')::uuid,
           validacao_em = now()
     where numero = 'OS-CST-0001';

    select status into v_status from public.ordem_servico where numero = 'OS-CST-0001';
    if v_status <> 'VALIDADA' then
      raise exception 'FALHA: validação travou sem alçada configurada (status %)', v_status;
    end if;
    /*
     * Teto zero por omissão travaria toda ordem com custo num locatário que
     * nunca configurou alçada — e a primeira reação de quem tem o sistema
     * parado é desligar a regra, não configurá-la. É a convenção que a 0019 já
     * usa para aprovação de pagamento.
     */
    raise notice 'caso 1 OK — alçada não configurada não exige nada';
  end $$;
commit;

reset role;

-- Agora o locatário configura: supervisor valida até R$ 1.000, gerente até
-- R$ 50.000. Os valores são dado do locatário, não do código.
insert into public.alcada (tenant_id, perfil_id, tipo, limite_valor) values
  (:'t1', :'perf_baixo', 'CUSTO_OS', 1000.0000),
  (:'t1', :'perf_alto',  'CUSTO_OS', 50000.0000);

set role iarx_app;

-- ---------------------------------------------------------------- caso 2: acima do teto, recusado
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'u_baixo';
  set local app.teste_eq   = :'eq';
  set local app.teste_tec  = :'tec';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    insert into public.ordem_servico
      (tenant_id, numero, equipamento_id, filial_id, tipo, descricao,
       tecnico_responsavel_id, custo_terceiros)
    values (app.tenant_atual(), 'OS-CST-0002', current_setting('app.teste_eq')::uuid,
            (select id from public.filial where codigo = 'CST-01'),
            'CORRETIVA', 'recuperacao de placa logica',
            current_setting('app.teste_tec')::uuid, 4500.0000);

    update public.ordem_servico set status = 'TRIAGEM'     where numero = 'OS-CST-0002';
    update public.ordem_servico set status = 'AGENDADA'    where numero = 'OS-CST-0002';
    update public.ordem_servico set status = 'EM_EXECUCAO' where numero = 'OS-CST-0002';
    update public.ordem_servico set status = 'CONCLUIDA'   where numero = 'OS-CST-0002';

    begin
      update public.ordem_servico
         set status = 'VALIDADA', validado_por = current_setting('app.usuario_id')::uuid,
           validacao_em = now()
       where numero = 'OS-CST-0002';
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;

    if v_erro is null then
      raise exception 'FALHA: supervisor validou OS de 4500 com teto de 1000';
    end if;
    if v_constraint <> 'os_custo_acima_da_alcada' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;
    raise notice 'caso 2 OK — custo acima do teto não é validado';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 3: dentro do teto, passa
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'u_alto';

  do $$
  declare v_status app.os_status;
  begin
    update public.ordem_servico
       set status = 'VALIDADA', validado_por = current_setting('app.usuario_id')::uuid,
           validacao_em = now()
     where numero = 'OS-CST-0002';

    select status into v_status from public.ordem_servico where numero = 'OS-CST-0002';
    if v_status <> 'VALIDADA' then
      raise exception 'FALHA: gerente com teto de 50000 não validou (status %)', v_status;
    end if;
    raise notice 'caso 3 OK — dentro do teto, a validação passa';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 4: a ordem dos gatilhos
begin;
  set local app.tenant_id  = :'t1';
  set local app.usuario_id = :'u_baixo';
  set local app.teste_eq   = :'eq';
  set local app.teste_tec  = :'tec';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    insert into public.ordem_servico
      (tenant_id, numero, equipamento_id, filial_id, tipo, descricao,
       tecnico_responsavel_id, custo_terceiros)
    values (app.tenant_atual(), 'OS-CST-0003', current_setting('app.teste_eq')::uuid,
            (select id from public.filial where codigo = 'CST-01'),
            'CORRETIVA', 'revisao geral',
            current_setting('app.teste_tec')::uuid, 9000.0000);

    -- Ordem ABERTA, custo de 9000, supervisor com teto de 1000: as duas regras
    -- recusariam. Quem responde tem de ser a do mapa de estados.
    begin
      update public.ordem_servico
         set status = 'VALIDADA', validado_por = current_setting('app.usuario_id')::uuid,
           validacao_em = now()
       where numero = 'OS-CST-0003';
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;

    if v_erro is null then
      raise exception 'FALHA: ABERTA → VALIDADA foi aceita';
    end if;
    if v_constraint <> 'os_transicao_valida' then
      /*
       * Gatilhos BEFORE do mesmo evento disparam em ordem alfabética de nome —
       * `os_transicao` antes de `os_valida_custo`. Renomear qualquer um dos
       * dois inverte a ordem em silêncio, e quem tentasse validar uma ordem no
       * estado errado ouviria "peça a quem tem alçada maior" e iria procurar a
       * pessoa errada.
       */
      raise exception 'FALHA: respondeu "%" em vez do mapa de estados — a ordem dos gatilhos inverteu', v_constraint;
    end if;
    raise notice 'caso 4 OK — o mapa de estados responde antes da alçada';
  end $$;
commit;

reset role;

-- ---------------------------------------------------------------- limpeza
delete from public.ordem_servico where tenant_id = :'t1';
delete from public.tecnico       where tenant_id = :'t1';
delete from public.equipamento   where tenant_id = :'t1';
delete from public.modelo        where tenant_id = :'t1';
delete from public.fabricante    where tenant_id = :'t1';
delete from public.categoria_equipamento where tenant_id = :'t1';
delete from public.audit_log     where tenant_id = :'t1';
delete from public.usuario_perfil where tenant_id = :'t1';
delete from public.alcada        where tenant_id = :'t1';
delete from public.usuario       where tenant_id = :'t1';
delete from public.filial        where tenant_id = :'t1';
delete from public.empresa       where tenant_id = :'t1';
delete from public.perfil        where tenant_id = :'t1';
delete from public.categoria_despesa where tenant_id = :'t1';
delete from public.tenant        where id = :'t1';

\echo '== 26_mnt_alcada_custo_os: TODOS OS CASOS APROVADOS =='
