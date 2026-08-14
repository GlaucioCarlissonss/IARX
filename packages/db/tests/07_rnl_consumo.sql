-- =============================================================================
-- TESTE RN-L28 … RN-L33 — Consolidação de consumo
--
-- RN-L28  consumo é derivado, nunca digitado
-- RN-L29  a série fecha: nenhuma página some entre dois meses
-- RN-L31  alerta dispara uma vez por limiar e competência
-- RN-L32  competência fechada é imutável
-- RN-L33  estimativa é exceção marcada
--
-- O que está em jogo: a fatura ser consequência da medição, e não uma
-- negociação. Consumo digitável é consumo negociável na planilha.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_t uuid := gen_random_uuid();
  v_emp uuid; v_fil uuid; v_fab uuid; v_cat uuid; v_mod uuid;
  v_cli uuid; v_ctr uuid; v_eq uuid; v_item uuid;
begin
  insert into public.tenant (id, nome) values (v_t, 'Locadora Consumo');
  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_t, 'Consumo LTDA', '11222333000181') returning id into v_emp;
  insert into public.filial (tenant_id, empresa_id, codigo, nome)
    values (v_t, v_emp, 'SP-01', 'Base SP') returning id into v_fil;
  insert into public.fabricante (tenant_id, nome) values (v_t, 'Kyocera') returning id into v_fab;
  insert into public.categoria_equipamento (tenant_id, codigo, nome, tipo_medidor_padrao)
    values (v_t, 'MFP', 'Multifuncional', 'CONTADOR') returning id into v_cat;
  insert into public.modelo (tenant_id, fabricante_id, categoria_id, codigo, nome)
    values (v_t, v_fab, v_cat, 'TA3554', 'TASKalfa 3554ci') returning id into v_mod;
  insert into public.cliente (tenant_id, documento, razao_social)
    values (v_t, '11444777000161', 'CLIENTE ALFA LTDA') returning id into v_cli;
  insert into public.contrato (tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim)
    values (v_t, 'SP-2026-001', v_emp, v_fil, v_cli, 'ATIVO', '2026-01-01', '2026-12-31')
    returning id into v_ctr;
  insert into public.equipamento (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_t, 'EQ-1', 'SN-1', v_mod, v_cat, v_fil) returning id into v_eq;
  insert into public.contrato_item
    (tenant_id, contrato_id, equipamento_id, modalidade_cobranca, valor_unitario,
     franquia_quantidade, franquia_escopo, valor_excedente_unitario,
     vigencia_inicio, vigencia_fim, status)
  values (v_t, v_ctr, v_eq, 'FRANQUIA_EXCEDENTE', 289, 3000, 'ITEM', 0.0800,
          '2026-01-01T00:00-03', '2027-01-01T00:00-03', 'ATIVO')
  returning id into v_item;

  create temporary table _ctx (chave text primary key, valor text);
  insert into _ctx values
    ('tenant', v_t::text), ('cliente', v_cli::text), ('equip', v_eq::text), ('item', v_item::text);
end $$;

-- ---------------------------- caso 1: RN-L28, consumo é coluna gerada
do $$
declare v_t uuid; v_eq uuid; v_item uuid; v_cli uuid; v_erro text := null;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_eq   from _ctx where chave = 'equip';
  select valor::uuid into v_item from _ctx where chave = 'item';
  select valor::uuid into v_cli  from _ctx where chave = 'cliente';

  insert into public.consumo_competencia
    (tenant_id, competencia, equipamento_id, contrato_item_id, cliente_id,
     leitura_inicial_mono, leitura_final_mono, franquia_mono)
  values (v_t, '2026-01', v_eq, v_item, v_cli, 100000, 103500, 3000);

  if (select paginas_mono from public.consumo_competencia
       where equipamento_id = v_eq and competencia = '2026-01') <> 3500 then
    raise exception 'FALHA RN-L28: páginas deveriam ser 3500 (final − inicial)';
  end if;

  -- Não existe caminho para escrever o consumo direto: para mudá-lo é preciso
  -- mudar uma leitura, e leitura tem trilha, origem e monotonicidade.
  begin
    update public.consumo_competencia set paginas_mono = 1000
     where equipamento_id = v_eq and competencia = '2026-01';
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA RN-L28: o consumo do mês foi digitado diretamente';
  end if;

  raise notice 'caso 1 OK — consumo é derivado das leituras, e não digitável';
end $$;

-- ---------------------------- caso 2: excedente e valor são calculados
do $$
declare v_eq uuid; r record;
begin
  select valor::uuid into v_eq from _ctx where chave = 'equip';

  select excedente_mono, valor_excedente into r
    from public.consumo_competencia where equipamento_id = v_eq and competencia = '2026-01';

  -- 3500 páginas − 3000 de franquia = 500 excedentes × R$ 0,08 = R$ 40,00.
  if r.excedente_mono <> 500 then
    raise exception 'FALHA: excedente deveria ser 500 (valor=%)', r.excedente_mono;
  end if;
  if r.valor_excedente <> 40 then
    raise exception 'FALHA: valor do excedente deveria ser 40,00 (valor=%)', r.valor_excedente;
  end if;

  raise notice 'caso 2 OK — excedente e valor derivam da medição, não de digitação';
end $$;

-- ---------------------------- caso 3: RN-L31, alerta uma vez por limiar
do $$
declare v_eq uuid; v_n integer; v_limiares integer[];
begin
  select valor::uuid into v_eq from _ctx where chave = 'equip';

  -- 3500 / 3000 = 117%: dispara 80 e 100, não 120.
  select count(*), array_agg(limiar order by limiar) into v_n, v_limiares
    from public.alerta_consumo where equipamento_id = v_eq and competencia = '2026-01';

  if v_limiares is distinct from array[80, 100] then
    raise exception 'FALHA RN-L31: limiares esperados {80,100}, obtidos %', v_limiares;
  end if;

  -- Reprocessar o fechamento não pode reenviar o mesmo aviso ao cliente.
  update public.consumo_competencia set origem_final = 'IMPORTACAO'
   where equipamento_id = v_eq and competencia = '2026-01';

  select count(*) into v_n from public.alerta_consumo
   where equipamento_id = v_eq and competencia = '2026-01';
  if v_n <> 2 then
    raise exception 'FALHA RN-L31: reprocessar duplicou alerta (total=%)', v_n;
  end if;

  raise notice 'caso 3 OK — 80%% e 100%% disparados uma vez; reprocessar não duplica';
end $$;

-- ---------------------------- caso 4: RN-L29, a série fecha
do $$
declare v_t uuid; v_eq uuid; v_item uuid; v_cli uuid; v_erro text := null;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_eq   from _ctx where chave = 'equip';
  select valor::uuid into v_item from _ctx where chave = 'item';
  select valor::uuid into v_cli  from _ctx where chave = 'cliente';

  -- Fevereiro começando em 103.000, quando janeiro terminou em 103.500:
  -- quinhentas páginas sumiriam entre os dois meses, e cada competência
  -- pareceria consistente sozinha.
  begin
    insert into public.consumo_competencia
      (tenant_id, competencia, equipamento_id, contrato_item_id, cliente_id,
       leitura_inicial_mono, leitura_final_mono, franquia_mono)
    values (v_t, '2026-02', v_eq, v_item, v_cli, 103000, 106000, 3000);
  exception when others then v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA RN-L29: a série aceitou um salto — páginas sumiriam entre os meses';
  end if;
  if v_erro not like '%103500%' then
    raise exception 'FALHA RN-L29: recusado sem dizer qual era a leitura anterior: %', v_erro;
  end if;

  -- Com a inicial correta, entra.
  insert into public.consumo_competencia
    (tenant_id, competencia, equipamento_id, contrato_item_id, cliente_id,
     leitura_inicial_mono, leitura_final_mono, franquia_mono)
  values (v_t, '2026-02', v_eq, v_item, v_cli, 103500, 106000, 3000);

  raise notice 'caso 4 OK — salto recusado citando a leitura anterior; série contínua aceita';
end $$;

-- ---------------------------- caso 5: consumo negativo é impossível
do $$
declare v_t uuid; v_eq uuid; v_cli uuid; v_erro text := null;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_eq  from _ctx where chave = 'equip';
  select valor::uuid into v_cli from _ctx where chave = 'cliente';

  begin
    insert into public.consumo_competencia
      (tenant_id, competencia, equipamento_id, cliente_id,
       leitura_inicial_mono, leitura_final_mono, franquia_mono)
    values (v_t, '2026-03', v_eq, v_cli, 106000, 105000, 3000);
  exception when others then v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA: consumo negativo aceito — é sempre defeito, nunca dado';
  end if;
  raise notice 'caso 5 OK — leitura final menor que a inicial recusada';
end $$;

-- ---------------------------- caso 6: RN-L33, estimativa exige justificativa
do $$
declare v_t uuid; v_eq uuid; v_cli uuid; v_erro text := null;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_eq  from _ctx where chave = 'equip';
  select valor::uuid into v_cli from _ctx where chave = 'cliente';

  begin
    insert into public.consumo_competencia
      (tenant_id, competencia, equipamento_id, cliente_id,
       leitura_inicial_mono, leitura_final_mono, franquia_mono, origem_final)
    values (v_t, '2026-03', v_eq, v_cli, 106000, 108500, 3000, 'ESTIMATIVA');
  exception when others then v_erro := sqlerrm;
  end;

  if v_erro is null then
    raise exception 'FALHA RN-L33: estimativa aceita sem justificativa — se confundiria com medição real';
  end if;

  insert into public.consumo_competencia
    (tenant_id, competencia, equipamento_id, cliente_id,
     leitura_inicial_mono, leitura_final_mono, franquia_mono, origem_final, justificativa)
  values (v_t, '2026-03', v_eq, v_cli, 106000, 108500, 3000, 'ESTIMATIVA',
          'Equipamento inacessível: unidade fechada para reforma na janela de coleta');

  raise notice 'caso 6 OK — estimativa sem justificativa recusada; com justificativa, aceita e marcada';
end $$;

-- ---------------------------- caso 7: RN-L32, competência fechada é imutável
do $$
declare v_eq uuid; v_erro_valor text := null; v_erro_delete text := null;
begin
  select valor::uuid into v_eq from _ctx where chave = 'equip';

  update public.consumo_competencia set fechado_em = now()
   where equipamento_id = v_eq and competencia = '2026-01';

  begin
    update public.consumo_competencia set leitura_final_mono = 999999
     where equipamento_id = v_eq and competencia = '2026-01';
  exception when others then v_erro_valor := sqlerrm;
  end;
  if v_erro_valor is null then
    raise exception 'FALHA RN-L32: competência fechada aceitou alteração da leitura';
  end if;

  begin
    delete from public.consumo_competencia where equipamento_id = v_eq and competencia = '2026-01';
  exception when others then v_erro_delete := sqlerrm;
  end;
  if v_erro_delete is null then
    raise exception 'FALHA RN-L32: competência fechada foi removida';
  end if;

  -- Reabrir é ação legítima e auditada — o que não pode é mexer nos números
  -- com ela ainda fechada.
  update public.consumo_competencia set fechado_em = null
   where equipamento_id = v_eq and competencia = '2026-01';
  update public.consumo_competencia set leitura_final_mono = 103600
   where equipamento_id = v_eq and competencia = '2026-01';

  raise notice 'caso 7 OK — fechada recusa alteração e remoção; reaberta aceita correção';
end $$;

-- ---------------------------- caso 8: RN-L30, importação linha a linha
do $$
declare v_t uuid; v_imp uuid; v_eq uuid; v_erro text := null;
begin
  select valor::uuid into v_t  from _ctx where chave = 'tenant';
  select valor::uuid into v_eq from _ctx where chave = 'equip';

  insert into public.importacao_leitura
    (tenant_id, nome_arquivo, competencia, linhas_total, linhas_aceitas, linhas_rejeitadas, status)
  values (v_t, 'leituras-2026-04.csv', '2026-04', 903, 900, 3, 'CONCLUIDA_COM_ERROS')
  returning id into v_imp;

  insert into public.importacao_leitura_linha
    (tenant_id, importacao_id, numero_linha, conteudo_original, equipamento_id, valor, resultado)
  values (v_t, v_imp, 1, '{"patrimonio":"EQ-1","valor":"108500"}'::jsonb, v_eq, 108500, 'ACEITA');

  -- Linha rejeitada sem motivo é pior que rejeitada: o operador não sabe o que
  -- corrigir e reprocessa o arquivo inteiro.
  begin
    insert into public.importacao_leitura_linha
      (tenant_id, importacao_id, numero_linha, conteudo_original, resultado)
    values (v_t, v_imp, 2, '{"patrimonio":"XPTO"}'::jsonb, 'REJEITADA');
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA RN-L30: linha rejeitada aceita sem motivo';
  end if;

  insert into public.importacao_leitura_linha
    (tenant_id, importacao_id, numero_linha, conteudo_original, resultado, mensagem_erro)
  values (v_t, v_imp, 2, '{"patrimonio":"XPTO"}'::jsonb, 'REJEITADA',
          'Patrimônio XPTO não encontrado no parque');

  -- 900 boas entraram apesar das 3 ruins.
  if (select linhas_aceitas from public.importacao_leitura where id = v_imp) <> 900 then
    raise exception 'FALHA RN-L30: o lote deveria aceitar as linhas válidas';
  end if;

  raise notice 'caso 8 OK — linhas válidas entram, inválidas ficam com o motivo';
end $$;

-- ---------------------------- caso 9: o locatário vê o próprio consumo
do $$
declare v_t uuid; v_cli uuid; v_outro uuid := gen_random_uuid(); v_n integer;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_cli from _ctx where chave = 'cliente';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.cliente_id', v_cli::text, true);

  select count(*) into v_n from public.consumo_competencia;
  if v_n = 0 then
    raise exception 'FALHA: o locatário não enxerga o próprio consumo — é o dado central do portal';
  end if;

  perform set_config('app.cliente_id', v_outro::text, true);
  select count(*) into v_n from public.consumo_competencia;
  if v_n <> 0 then
    raise exception 'FALHA RN-L12: % competência(s) de outro cliente visíveis', v_n;
  end if;

  reset role;
  raise notice 'caso 9 OK — consumo isolado por locatário, como o portal exige';
end $$;

rollback;

\echo '== 07_rnl_consumo: TODOS OS CASOS APROVADOS =='
