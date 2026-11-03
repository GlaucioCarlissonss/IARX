-- =============================================================================
-- TESTE EQP — razão de movimentação do ativo (Anexo A.5)
--
-- A 0031 pôs a máquina de estados no banco; a 0032 pôs o razão que diz quando
-- cada transição aconteceu, por ordem de quem e com qual romaneio. Sem ele,
-- `equipamento.status` é um campo digitado sem história: a pergunta "por que
-- esta máquina está em manutenção desde setembro?" não tem resposta no sistema.
--
-- Quatro invariantes sustentam esse razão:
--
--  · histórico de ativo não se edita nem se apaga — movimentação errada é
--    corrigida por movimentação nova, e a errada continua visível porque
--    alguém agiu com base nela;
--  · o aceite da transferência é a única escrita posterior admitida, porque é
--    a segunda metade de um fato que nasce incompleto, não a correção de um
--    fato errado;
--  · transferência sem destino é um ativo que saiu e não chegou;
--  · o destino tem de existir **dentro do locatário** — é a parte que uma
--    chave estrangeira sozinha não garantiria num alvo polimórfico.
-- =============================================================================
\set ON_ERROR_STOP on

select gen_random_uuid() as t1, gen_random_uuid() as t2,
       gen_random_uuid() as emp, gen_random_uuid() as fil, gen_random_uuid() as fil2,
       gen_random_uuid() as cli, gen_random_uuid() as loc, gen_random_uuid() as cat,
       gen_random_uuid() as fab, gen_random_uuid() as mod, gen_random_uuid() as eq,
       gen_random_uuid() as emp2, gen_random_uuid() as fil_outro
\gset

insert into public.tenant (id, nome) values (:'t1', 'Locadora MOV'), (:'t2', 'Locadora Vizinha');
insert into public.empresa (id, tenant_id, razao_social)
  values (:'emp', :'t1', 'MOV LTDA'), (:'emp2', :'t2', 'VIZINHA LTDA');
insert into public.filial (id, tenant_id, empresa_id, codigo, nome)
values (:'fil',       :'t1', :'emp',  'MOV-01', 'Base MOV'),
       (:'fil2',      :'t1', :'emp',  'MOV-02', 'Base MOV Norte'),
       (:'fil_outro', :'t2', :'emp2', 'VIZ-01', 'Base Vizinha');
insert into public.cliente (id, tenant_id, documento, razao_social)
  values (:'cli', :'t1', '55000000000317', 'Cliente MOV');
insert into public.local_operacao (id, tenant_id, cliente_id, nome, endereco)
  values (:'loc', :'t1', :'cli', 'Andar 3', '{"logradouro":"Rua MOV","numero":"100"}'::jsonb);
insert into public.categoria_equipamento (id, tenant_id, codigo, nome)
  values (:'cat', :'t1', 'MFP', 'Multifuncional');
insert into public.fabricante (id, tenant_id, nome) values (:'fab', :'t1', 'Fabricante MOV');
insert into public.modelo (id, tenant_id, fabricante_id, categoria_id, codigo, nome)
  values (:'mod', :'t1', :'fab', :'cat', 'M-1', 'Modelo MOV');
insert into public.equipamento (id, tenant_id, patrimonio, modelo_id, categoria_id, filial_id)
  values (:'eq', :'t1', 'MOV-0001', :'mod', :'cat', :'fil');

set role iarx_app;

-- ---------------------------------------------------------------- caso 1: o razão registra e a timeline ordena
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_eq  = :'eq';
  set local app.teste_fil = :'fil';
  set local app.teste_loc = :'loc';

  do $$
  declare v_n integer; v_primeiro app.movimentacao_tipo;
  begin
    insert into public.movimentacao
      (tenant_id, equipamento_id, tipo, origem_tipo, origem_id, destino_tipo, destino_id,
       data_movimento, documento_ref, status_resultante)
    values (app.tenant_atual(), current_setting('app.teste_eq')::uuid, 'ENTREGA',
            'FILIAL', current_setting('app.teste_fil')::uuid,
            'LOCAL_OPERACAO', current_setting('app.teste_loc')::uuid,
            now() - interval '2 days', 'ROM-0001', 'LOCADO'),
           (app.tenant_atual(), current_setting('app.teste_eq')::uuid, 'ENVIO_MANUTENCAO',
            'LOCAL_OPERACAO', current_setting('app.teste_loc')::uuid,
            'FILIAL', current_setting('app.teste_fil')::uuid,
            now() - interval '1 day', 'ROM-0002', 'EM_MANUTENCAO');

    select count(*) into v_n from public.movimentacao
     where equipamento_id = current_setting('app.teste_eq')::uuid;
    if v_n <> 2 then
      raise exception 'FALHA: esperadas 2 movimentações, vieram %', v_n;
    end if;

    -- A timeline do ativo é um order by, não uma costura entre tabelas.
    select tipo into v_primeiro from public.movimentacao
     where equipamento_id = current_setting('app.teste_eq')::uuid
     order by data_movimento desc limit 1;
    if v_primeiro <> 'ENVIO_MANUTENCAO' then
      raise exception 'FALHA: topo da timeline veio % (esperado ENVIO_MANUTENCAO)', v_primeiro;
    end if;
    raise notice 'caso 1 OK — razão registra o fato e a timeline ordena por data';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 2: o razão não se edita nem se apaga
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    begin
      update public.movimentacao set observacao = 'corrigindo o romaneio'
       where documento_ref = 'ROM-0001';
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: movimentação foi editada';
    end if;
    if v_constraint <> 'movimentacao_imutavel' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;

    v_erro := null;
    begin
      delete from public.movimentacao where documento_ref = 'ROM-0001';
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: movimentação foi apagada';
    end if;
    if v_constraint <> 'movimentacao_imutavel' then
      raise exception 'FALHA: DELETE recusado por "%": %', v_constraint, v_erro;
    end if;
    raise notice 'caso 2 OK — razão append-only: nem UPDATE nem DELETE';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 3: transferência sem destino
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_eq  = :'eq';
  set local app.teste_fil = :'fil';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    begin
      insert into public.movimentacao
        (tenant_id, equipamento_id, tipo, origem_tipo, origem_id, status_resultante)
      values (app.tenant_atual(), current_setting('app.teste_eq')::uuid, 'TRANSFERENCIA',
              'FILIAL', current_setting('app.teste_fil')::uuid, 'EM_TRANSITO_ENTREGA');
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: transferência sem destino foi aceita';
    end if;
    if v_constraint <> 'movimentacao_transferencia_com_destino' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;
    -- Transferência sem destino é um ativo que saiu e não chegou: ele some do
    -- parque de origem e não aparece em nenhum outro.
    raise notice 'caso 3 OK — transferência exige destino';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 4: destino de outro locatário
begin;
  set local app.tenant_id   = :'t1';
  set local app.teste_eq    = :'eq';
  set local app.teste_fil   = :'fil';
  set local app.teste_outro = :'fil_outro';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    begin
      insert into public.movimentacao
        (tenant_id, equipamento_id, tipo, origem_tipo, origem_id,
         destino_tipo, destino_id, status_resultante)
      values (app.tenant_atual(), current_setting('app.teste_eq')::uuid, 'TRANSFERENCIA',
              'FILIAL', current_setting('app.teste_fil')::uuid,
              'FILIAL', current_setting('app.teste_outro')::uuid, 'EM_TRANSITO_ENTREGA');
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: ativo foi transferido para filial de outro locatário';
    end if;
    if v_constraint <> 'movimentacao_destino_inexistente' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;
    /*
     * O alvo é polimórfico, então não há chave estrangeira que o cubra. O que a
     * FK não garantiria de todo modo é a parte que importa aqui: o destino
     * existe, mas no locatário errado — e a RLS do destino não protege a
     * origem de apontar para ele.
     */
    raise notice 'caso 4 OK — destino conferido dentro do locatário';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 5: aceite é o único UPDATE admitido
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_eq  = :'eq';
  set local app.teste_fil = :'fil';
  set local app.teste_f2  = :'fil2';

  do $$
  declare v_erro text := null; v_constraint text := null; v_aceite timestamptz;
  begin
    insert into public.movimentacao
      (tenant_id, equipamento_id, tipo, origem_tipo, origem_id,
       destino_tipo, destino_id, documento_ref, status_resultante)
    values (app.tenant_atual(), current_setting('app.teste_eq')::uuid, 'TRANSFERENCIA',
            'FILIAL', current_setting('app.teste_fil')::uuid,
            'FILIAL', current_setting('app.teste_f2')::uuid,
            'ROM-0003', 'EM_TRANSITO_ENTREGA');

    update public.movimentacao
       set aceite_em = now(), aceite_por = gen_random_uuid()
     where documento_ref = 'ROM-0003';

    select aceite_em into v_aceite from public.movimentacao where documento_ref = 'ROM-0003';
    if v_aceite is null then
      raise exception 'FALHA: o aceite não foi gravado';
    end if;

    -- Mas só o aceite: carona em outra coluna recusa junto.
    begin
      update public.movimentacao
         set aceite_em = now(), aceite_por = gen_random_uuid(), documento_ref = 'ROM-9999'
       where documento_ref = 'ROM-0003';
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: o aceite serviu de carona para reescrever o romaneio';
    end if;
    if v_constraint <> 'movimentacao_imutavel' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;
    raise notice 'caso 5 OK — aceite grava, e só o aceite';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 6: aceite fora de transferência
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_eq  = :'eq';
  set local app.teste_fil = :'fil';

  do $$
  declare v_erro text := null; v_constraint text := null;
  begin
    begin
      insert into public.movimentacao
        (tenant_id, equipamento_id, tipo, destino_tipo, destino_id,
         status_resultante, aceite_em, aceite_por)
      values (app.tenant_atual(), current_setting('app.teste_eq')::uuid, 'RETORNO',
              'FILIAL', current_setting('app.teste_fil')::uuid,
              'EM_INSPECAO', now(), gen_random_uuid());
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;
    if v_erro is null then
      raise exception 'FALHA: movimentação não-transferência aceitou carimbo de aceite';
    end if;
    if v_constraint <> 'movimentacao_aceite_so_transferencia' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;
    -- Nas demais movimentações o fato se consuma na entrega. Um aceite ali
    -- seria um segundo carimbo que ninguém dá, e que a consulta de pendências
    -- passaria a ter de filtrar.
    raise notice 'caso 6 OK — aceite só existe em transferência';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 7: item de contrato de outro ativo
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_eq  = :'eq';
  set local app.teste_fil = :'fil';
  set local app.teste_emp = :'emp';
  set local app.teste_cli = :'cli';

  do $$
  declare
    v_erro text := null; v_constraint text := null;
    v_outro uuid := gen_random_uuid();
    v_ct    uuid := gen_random_uuid();
    v_item  uuid;
  begin
    -- Um segundo ativo, com item de contrato próprio.
    insert into public.equipamento (id, tenant_id, patrimonio, modelo_id, categoria_id, filial_id)
    select v_outro, app.tenant_atual(), 'MOV-0002', e.modelo_id, e.categoria_id, e.filial_id
      from public.equipamento e where e.patrimonio = 'MOV-0001';

    insert into public.contrato (id, tenant_id, numero, empresa_id, filial_id, cliente_id,
                                 status, data_inicio, data_fim)
    values (v_ct, app.tenant_atual(), 'MOV-2026-001',
            current_setting('app.teste_emp')::uuid, current_setting('app.teste_fil')::uuid,
            current_setting('app.teste_cli')::uuid, 'RASCUNHO', '2026-01-01', '2026-12-31');

    insert into public.contrato_item
      (tenant_id, contrato_id, equipamento_id, modalidade_cobranca,
       valor_unitario, vigencia_inicio, vigencia_fim, status)
    values (app.tenant_atual(), v_ct, v_outro, 'FIXO_MENSAL', 500.0000,
            '2026-01-01', '2026-12-31', 'ATIVO')
    returning id into v_item;

    begin
      insert into public.movimentacao
        (tenant_id, equipamento_id, tipo, contrato_item_id, status_resultante)
      values (app.tenant_atual(), current_setting('app.teste_eq')::uuid,
              'RETORNO', v_item, 'EM_INSPECAO');
    exception when others then
      v_erro := sqlerrm;
      get stacked diagnostics v_constraint = constraint_name;
    end;

    if v_erro is null then
      raise exception 'FALHA: movimentação apontou item de contrato de outro ativo';
    end if;
    if v_constraint <> 'movimentacao_item_de_outro_ativo' then
      raise exception 'FALHA: recusado por "%": %', v_constraint, v_erro;
    end if;
    /*
     * Movimentar uma máquina mexe na cobrança dela. Com o id trocado — engano
     * de integração, ou alguém querendo parar uma cobrança sem deixar rastro —
     * a entrega ou o recebimento atingiria o contrato de um cliente que não
     * teve nada movimentado.
     */
    raise notice 'caso 7 OK — o item de contrato tem de ser do ativo movimentado';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 8: isolamento entre locatários
begin;
  set local app.tenant_id = :'t2';

  do $$
  declare v_n integer;
  begin
    select count(*) into v_n from public.movimentacao;
    if v_n <> 0 then
      raise exception 'FALHA: locatário vizinho enxergou % movimentação(ões)', v_n;
    end if;
    raise notice 'caso 8 OK — o razão do vizinho é invisível';
  end $$;
commit;

reset role;

-- ---------------------------------------------------------------- limpeza
-- O gatilho de imutabilidade recusa DELETE por desenho, e é isso que o caso 2
-- prova. Desligá-lo para a limpeza é explicitamente diferente de abrir uma
-- exceção de "limpeza" dentro do gatilho: a regra continua inteira no banco.
alter table public.movimentacao disable trigger movimentacao_sem_edicao;
delete from public.movimentacao where tenant_id in (:'t1', :'t2');
alter table public.movimentacao enable trigger movimentacao_sem_edicao;

delete from public.contrato_item where tenant_id = :'t1';
delete from public.contrato      where tenant_id = :'t1';
delete from public.equipamento   where tenant_id = :'t1';
delete from public.modelo        where tenant_id = :'t1';
delete from public.fabricante    where tenant_id = :'t1';
delete from public.categoria_equipamento where tenant_id = :'t1';
delete from public.local_operacao where tenant_id = :'t1';
delete from public.audit_log     where tenant_id in (:'t1', :'t2');
delete from public.cliente       where tenant_id = :'t1';
delete from public.filial        where tenant_id in (:'t1', :'t2');
delete from public.empresa       where tenant_id in (:'t1', :'t2');
delete from public.perfil        where tenant_id in (:'t1', :'t2');
delete from public.categoria_despesa where tenant_id in (:'t1', :'t2');
delete from public.tenant        where id in (:'t1', :'t2');

\echo '== 24_eqp_movimentacao: TODOS OS CASOS APROVADOS =='
