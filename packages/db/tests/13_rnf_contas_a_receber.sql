-- =============================================================================
-- TESTE RN-F10 … RN-F14 — Contas a receber
--
-- RN-F10  título contratual nasce pendente de aprovação
-- RN-F11  vigência do contrato é checada na geração, não depois
-- RN-F12  desconto acima da alçada é barrado, mesmo em título já aprovado
-- RN-F13  recebimento parcial recalcula saldo; excesso é recusado
-- RN-F14  BAIXADO não é RECEBIDO
--
-- O que está em jogo: **a cobrança sai errada uma vez e o cliente lembra dez
-- vezes**. Um título a pagar errado é um problema interno; um título a receber
-- errado chega ao cliente, e o custo dele é a relação comercial. Por isso RN-F10
-- põe um humano entre o cálculo e a cobrança, e RN-F11 desconfia do contrato no
-- momento exato da geração — não do que ele era quando a leitura foi feita.
--
-- Nenhum valor aqui é regra de negócio da IARX. Os limites de alçada, o preço da
-- mensalidade e o percentual de desconto são massa deste arquivo; o que se prova
-- é que o cálculo segue o que está cadastrado, quaisquer que sejam os números.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_t uuid := gen_random_uuid();
  v_emp uuid; v_fil uuid; v_fab uuid; v_cat uuid; v_mod uuid;
  v_cli uuid; v_cli_b uuid;
  v_ctr uuid; v_ctr_susp uuid; v_ctr_sem_preco uuid;
  v_eq uuid; v_eq_susp uuid; v_eq_sp uuid;
  v_item uuid; v_item_susp uuid; v_item_sp uuid;
  v_tp uuid;
  v_p_fat1 uuid; v_p_fat2 uuid; v_p_desc uuid; v_p_oper uuid;
  v_gestor uuid; v_diretor uuid; v_negociador uuid; v_gerador uuid;
  v_conta uuid; v_cc_a uuid; v_cc_b uuid;
begin
  insert into public.tenant (id, nome) values (v_t, 'Locadora Receber');
  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_t, 'RECEBER LOCACOES LTDA', '11222333000181') returning id into v_emp;
  insert into public.filial (tenant_id, empresa_id, codigo, nome)
    values (v_t, v_emp, 'SP-01', 'Base SP') returning id into v_fil;
  insert into public.fabricante (tenant_id, nome) values (v_t, 'Kyocera') returning id into v_fab;
  insert into public.categoria_equipamento (tenant_id, codigo, nome, tipo_medidor_padrao)
    values (v_t, 'MFP', 'Multifuncional', 'CONTADOR') returning id into v_cat;
  insert into public.modelo (tenant_id, fabricante_id, categoria_id, codigo, nome)
    values (v_t, v_fab, v_cat, 'TA3554', 'TASKalfa 3554ci') returning id into v_mod;

  insert into public.cliente (tenant_id, documento, razao_social)
    values (v_t, '11444777000161', 'CLIENTE ALFA LTDA') returning id into v_cli;
  insert into public.cliente (tenant_id, documento, razao_social)
    values (v_t, '22555888000172', 'CLIENTE BETA LTDA') returning id into v_cli_b;

  /*
   * Tabela de preço GERAL por categoria: é o que `app.resolver_preco` vai achar.
   *
   * Nasce em RASCUNHO e só depois é ativada, porque os itens de uma tabela
   * vigente são imutáveis (RN-L22) — ativar antes de inserir os itens é o
   * caminho que o próprio esquema fecha, e por bom motivo: uma tabela vigente
   * que aceitasse item novo reprecificaria contratos já assinados.
   */
  insert into public.tabela_preco
    (tenant_id, nome, vigencia_inicio, status, abrangencia)
    values (v_t, 'Preço 2026', '2026-01-01', 'RASCUNHO', 'GERAL') returning id into v_tp;
  insert into public.tabela_preco_item (tenant_id, tabela_preco_id, categoria_id, valor_mensal)
    values (v_t, v_tp, v_cat, 300);
  update public.tabela_preco set status = 'ATIVA', ativada_em = now() where id = v_tp;

  /* ---- contrato vigente, com consumo e excedente ---- */
  insert into public.contrato
    (tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim)
    values (v_t, 'SP-2026-001', v_emp, v_fil, v_cli, 'ATIVO', '2026-01-01', '2026-12-31')
    returning id into v_ctr;
  insert into public.equipamento
    (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_t, 'EQ-1', 'SN-1', v_mod, v_cat, v_fil) returning id into v_eq;
  insert into public.contrato_item
    (tenant_id, contrato_id, equipamento_id, modalidade_cobranca, valor_unitario,
     franquia_quantidade, franquia_escopo, valor_excedente_unitario,
     vigencia_inicio, vigencia_fim, status)
  values (v_t, v_ctr, v_eq, 'FRANQUIA_EXCEDENTE', 300, 3000, 'ITEM', 0.1000,
          '2026-01-01T00:00-03', '2027-01-01T00:00-03', 'ATIVO')
  returning id into v_item;

  /* ---- contrato que será suspenso antes do fechamento (RN-F11) ---- */
  insert into public.contrato
    (tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim)
    values (v_t, 'SP-2026-002', v_emp, v_fil, v_cli_b, 'ATIVO', '2026-01-01', '2026-12-31')
    returning id into v_ctr_susp;
  insert into public.equipamento
    (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_t, 'EQ-2', 'SN-2', v_mod, v_cat, v_fil) returning id into v_eq_susp;
  insert into public.contrato_item
    (tenant_id, contrato_id, equipamento_id, modalidade_cobranca, valor_unitario,
     franquia_quantidade, franquia_escopo, valor_excedente_unitario,
     vigencia_inicio, vigencia_fim, status)
  values (v_t, v_ctr_susp, v_eq_susp, 'FRANQUIA_EXCEDENTE', 300, 3000, 'ITEM', 0.1000,
          '2026-01-01T00:00-03', '2027-01-01T00:00-03', 'ATIVO')
  returning id into v_item_susp;

  /* ---- contrato cujo item não tem política de preço (categoria própria) ---- */
  insert into public.contrato
    (tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim)
    values (v_t, 'SP-2026-003', v_emp, v_fil, v_cli, 'ATIVO', '2026-01-01', '2026-12-31')
    returning id into v_ctr_sem_preco;
  insert into public.categoria_equipamento (tenant_id, codigo, nome, tipo_medidor_padrao)
    values (v_t, 'PLOT', 'Plotter', 'CONTADOR');
  insert into public.equipamento
    (tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id)
    values (v_t, 'EQ-3', 'SN-3', v_mod,
            (select id from public.categoria_equipamento where tenant_id = v_t and codigo = 'PLOT'),
            v_fil)
    returning id into v_eq_sp;
  insert into public.contrato_item
    (tenant_id, contrato_id, equipamento_id, modalidade_cobranca, valor_unitario,
     franquia_quantidade, franquia_escopo, valor_excedente_unitario,
     vigencia_inicio, vigencia_fim, status)
  values (v_t, v_ctr_sem_preco, v_eq_sp, 'FRANQUIA_EXCEDENTE', 0, 1000, 'ITEM', 0.2000,
          '2026-01-01T00:00-03', '2027-01-01T00:00-03', 'ATIVO')
  returning id into v_item_sp;

  /* ---- consumo de 2026-03 nos três contratos ---- */
  insert into public.consumo_competencia
    (tenant_id, competencia, equipamento_id, contrato_item_id, cliente_id,
     leitura_inicial_mono, leitura_final_mono, franquia_mono)
  values
    (v_t, '2026-03', v_eq,      v_item,      v_cli,   100000, 104000, 3000),
    (v_t, '2026-03', v_eq_susp, v_item_susp, v_cli_b, 200000, 202000, 3000),
    (v_t, '2026-03', v_eq_sp,   v_item_sp,   v_cli,   300000, 301500, 1000);

  /* ---- perfis, alçada e usuários ----
   *
   * Dois níveis de EMISSAO_FATURA (limite 1.000 e 10.000) e uma alçada de
   * DESCONTO percentual de 10%. Os números são deste arquivo.
   */
  insert into public.perfil (tenant_id, nome, tipo, is_sistema, permissoes)
    values (v_t, 'Gestor Faturamento', 'INTERNO', false, array['receber:ler','receber:aprovar'])
    returning id into v_p_fat1;
  insert into public.perfil (tenant_id, nome, tipo, is_sistema, permissoes)
    values (v_t, 'Diretoria Faturamento', 'INTERNO', false, array['receber:ler','receber:aprovar'])
    returning id into v_p_fat2;
  insert into public.perfil (tenant_id, nome, tipo, is_sistema, permissoes)
    values (v_t, 'Negociador', 'INTERNO', false, array['receber:ler','receber:negociar'])
    returning id into v_p_desc;
  insert into public.perfil (tenant_id, nome, tipo, is_sistema, permissoes)
    values (v_t, 'Operador Faturamento', 'INTERNO', false, array['receber:ler','competencia:fechar'])
    returning id into v_p_oper;

  insert into public.alcada (tenant_id, perfil_id, tipo, limite_valor) values
    (v_t, v_p_fat1, 'EMISSAO_FATURA', 1000),
    (v_t, v_p_fat2, 'EMISSAO_FATURA', 10000);
  insert into public.alcada (tenant_id, perfil_id, tipo, limite_percentual) values
    (v_t, v_p_desc, 'DESCONTO', 10);

  insert into public.usuario (tenant_id, nome, email, status) values
    (v_t, 'Gestor Fat', 'gestor@receber.test', 'ATIVO') returning id into v_gestor;
  insert into public.usuario (tenant_id, nome, email, status) values
    (v_t, 'Diretor Fat', 'diretor@receber.test', 'ATIVO') returning id into v_diretor;
  insert into public.usuario (tenant_id, nome, email, status) values
    (v_t, 'Negociador Um', 'negocia@receber.test', 'ATIVO') returning id into v_negociador;
  insert into public.usuario (tenant_id, nome, email, status) values
    (v_t, 'Operador Um', 'opera@receber.test', 'ATIVO') returning id into v_gerador;

  insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo) values
    (v_t, v_gestor,      v_p_fat1, 'TENANT'),
    (v_t, v_diretor,     v_p_fat2, 'TENANT'),
    (v_t, v_negociador,  v_p_desc, 'TENANT'),
    (v_t, v_gerador,     v_p_oper, 'TENANT');

  insert into public.conta_bancaria
    (tenant_id, empresa_id, banco_codigo, agencia, numero, tipo, apelido,
     saldo_inicial, data_saldo_inicial)
    values (v_t, v_emp, '341', '0912', '45871-3', 'CORRENTE', 'Recebimentos',
            0, date '2026-01-01')
    returning id into v_conta;

  insert into public.centro_custo (tenant_id, codigo, nome)
    values (v_t, 'COM', 'Comercial') returning id into v_cc_a;
  insert into public.centro_custo (tenant_id, codigo, nome)
    values (v_t, 'OPER', 'Operação') returning id into v_cc_b;

  create temporary table _ctx (chave text primary key, valor text);
  insert into _ctx values
    ('tenant', v_t::text), ('empresa', v_emp::text), ('filial', v_fil::text),
    ('cliente', v_cli::text), ('cliente_b', v_cli_b::text),
    ('contrato', v_ctr::text), ('contrato_susp', v_ctr_susp::text),
    ('contrato_sem_preco', v_ctr_sem_preco::text),
    ('gestor', v_gestor::text), ('diretor', v_diretor::text),
    ('negociador', v_negociador::text), ('gerador', v_gerador::text),
    ('conta', v_conta::text), ('cc_a', v_cc_a::text), ('cc_b', v_cc_b::text);

  -- Os casos leem o contexto **depois** de assumir `iarx_app`, e uma tabela
  -- temporária criada pelo superusuário não é legível por ele. Foi a lição do
  -- arquivo 12.
  grant select on _ctx to iarx_app;
end $$;

/** Cria um título avulso, já em nome do gerador, devolvendo o id. */
create or replace function _titulo_receber(p_valor numeric, p_status text default 'APROVADO')
returns uuid
language plpgsql as $$
declare v_t uuid; v_cli uuid; v_g uuid; v_id uuid;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_cli from _ctx where chave = 'cliente';
  select valor::uuid into v_g   from _ctx where chave = 'gerador';

  insert into public.titulo_receber
    (tenant_id, cliente_id, origem, descricao, valor_original,
     data_emissao, data_vencimento, status, created_by)
  values (v_t, v_cli, 'AVULSO', 'Serviço avulso de teste', p_valor,
          current_date, current_date + 30, p_status, v_g)
  returning id into v_id;
  return v_id;
end $$;

-- ------------- caso 1: os níveis de emissão seguem os limites cadastrados
do $$
declare v_t uuid; v_n integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select app.niveis_aprovacao_receber(500) into v_n;
  if v_n <> 0 then raise exception 'FALHA: 500 exigiu % nível(is), esperado 0', v_n; end if;
  select app.niveis_aprovacao_receber(5000) into v_n;
  if v_n <> 1 then raise exception 'FALHA: 5 mil exigiu % nível(is), esperado 1', v_n; end if;
  select app.niveis_aprovacao_receber(50000) into v_n;
  if v_n <> 2 then raise exception 'FALHA: 50 mil exigiu % nível(is), esperado 2', v_n; end if;
  -- No limite exato não ultrapassa: o perfil emite sozinho.
  select app.niveis_aprovacao_receber(1000) into v_n;
  if v_n <> 0 then raise exception 'FALHA: valor no limite exato exigiu % nível(is)', v_n; end if;

  reset role;
  raise notice 'caso 1 OK — a alçada de emissão é EMISSAO_FATURA, sem constante no código';
end $$;

-- ------------- caso 2: o posto e a delegação valem para os dois lados
do $$
declare v_t uuid; v_gestor uuid; v_dir uuid; v_ger uuid; v_p integer;
begin
  select valor::uuid into v_t      from _ctx where chave = 'tenant';
  select valor::uuid into v_gestor from _ctx where chave = 'gestor';
  select valor::uuid into v_dir    from _ctx where chave = 'diretor';
  select valor::uuid into v_ger    from _ctx where chave = 'gerador';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select app.posto_alcada_receber(v_gestor) into v_p;
  if v_p <> 1 then raise exception 'FALHA: gestor com posto %', v_p; end if;
  select app.posto_alcada_receber(v_dir) into v_p;
  if v_p <> 2 then raise exception 'FALHA: diretor com posto %', v_p; end if;
  select app.posto_alcada_receber(v_ger) into v_p;
  if v_p <> 0 then raise exception 'FALHA: quem só fecha competência tem posto %', v_p; end if;

  -- Posto maior decide nível menor, aqui como em contas a pagar: senão as
  -- férias do gestor travam a emissão com o diretor disponível ao lado.
  if not app.pode_decidir_nivel_receber(v_dir, 1) then
    raise exception 'FALHA: o diretor não pode decidir o nível 1';
  end if;
  if app.pode_decidir_nivel_receber(v_gestor, 2) then
    raise exception 'FALHA: o gestor pode decidir o nível 2';
  end if;

  reset role;
  raise notice 'caso 2 OK — posto ≥ nível, com a alçada de emissão';
end $$;

-- ------------- caso 3: RN-F10, o título contratual nasce pendente de aprovação
do $$
declare v_t uuid; v_ger uuid; v_ctr uuid; r record; v_status text; v_niveis integer;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_ger from _ctx where chave = 'gerador';
  select valor::uuid into v_ctr from _ctx where chave = 'contrato';

  -- O contrato 002 é suspenso **antes** do fechamento: é o cenário da RN-F11,
  -- e ele tem de conviver com o fechamento dos outros dois na mesma chamada.
  update public.contrato set status = 'SUSPENSO'
   where id = (select valor::uuid from _ctx where chave = 'contrato_susp');

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_ger::text, true);

  select * into r from app.fechar_competencia('2026-03');

  if r.titulos_criados <> 3 then
    raise exception 'FALHA: o fechamento criou % título(s), esperado 3', r.titulos_criados;
  end if;
  if r.consumos_selados <> 3 then
    raise exception 'FALHA: selou % linha(s) de consumo, esperado 3', r.consumos_selados;
  end if;

  -- Contrato vigente, item com preço: mensalidade 300 + excedente
  -- (4000 páginas − 3000 de franquia = 1000 × R$ 0,10 = R$ 100) = R$ 400.
  select status, valor_original into v_status, v_niveis
    from public.titulo_receber where contrato_id = v_ctr and competencia = '2026-03';
  if v_status <> 'PENDENTE_APROVACAO' then
    raise exception 'FALHA RN-F10: o título contratual nasceu em %', v_status;
  end if;
  if v_niveis <> 400 then
    raise exception 'FALHA: o valor gerado foi %, esperado 400 (300 mensal + 100 excedente)', v_niveis;
  end if;

  /*
   * Piso de um nível, e é o coração da RN-F10.
   *
   * R$ 400 não ultrapassa a menor faixa de alçada (1.000), então a contagem
   * crua daria zero — e o título nasceria APROVADO, emitido direto do cálculo
   * automático. A alçada decide **quantos** conferem, não **se** alguém
   * confere. Este assert é o que impede a regressão: foi ele que pegou a
   * primeira versão da migração, que usava a contagem crua.
   */
  select count(*) into v_niveis from public.titulo_receber_aprovacao a
    join public.titulo_receber t on t.id = a.titulo_id
   where t.contrato_id = v_ctr and t.competencia = '2026-03';
  if v_niveis <> 1 then
    raise exception 'FALHA RN-F10: abriu % nível(is) — o piso do contratual é 1', v_niveis;
  end if;

  reset role;
  raise notice 'caso 3 OK — o contratual nasce pendente, com piso de um nível, e o valor vem do motor de preço';
end $$;

-- ------------- caso 4: RN-F11, contrato sem vigência nasce em disputa
do $$
declare v_t uuid; v_susp uuid; v_sp uuid; r record;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_susp from _ctx where chave = 'contrato_susp';
  select valor::uuid into v_sp   from _ctx where chave = 'contrato_sem_preco';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  select status, excecao_geracao into r
    from public.titulo_receber where contrato_id = v_susp and competencia = '2026-03';
  if r.status <> 'EM_DISPUTA' then
    raise exception 'FALHA RN-F11: contrato suspenso gerou título em %', r.status;
  end if;
  -- A exceção diz **o quê**, não só que houve: "em disputa" sem motivo obriga
  -- quem confere a reconstruir a razão a partir do histórico do contrato.
  if r.excecao_geracao is null or r.excecao_geracao not like '%SUSPENSO%' then
    raise exception 'FALHA RN-F11: a exceção não nomeia o estado do contrato (%)', r.excecao_geracao;
  end if;

  -- Título em disputa não abre rodada: não se aprova a emissão de uma cobrança
  -- que já se sabe estar errada.
  if exists (select 1 from public.titulo_receber_aprovacao a
              join public.titulo_receber t on t.id = a.titulo_id
             where t.contrato_id = v_susp and t.competencia = '2026-03') then
    raise exception 'FALHA: título em disputa abriu rodada de aprovação';
  end if;

  -- Item sem política de preço: cobra só o excedente e marca a exceção, em vez
  -- de cobrar a mensalidade como zero em silêncio.
  select status, excecao_geracao, valor_original into r
    from public.titulo_receber where contrato_id = v_sp and competencia = '2026-03';
  if r.status <> 'EM_DISPUTA' then
    raise exception 'FALHA: item sem preço gerou título em % em vez de EM_DISPUTA', r.status;
  end if;
  if r.excecao_geracao not like '%sem política de preço%' then
    raise exception 'FALHA: a exceção de preço ausente não foi registrada (%)', r.excecao_geracao;
  end if;
  -- 1500 páginas − 1000 de franquia = 500 × R$ 0,20 = R$ 100, sem mensalidade.
  if r.valor_original <> 100 then
    raise exception 'FALHA: valor % — esperado 100 (só excedente, sem mensalidade)', r.valor_original;
  end if;

  reset role;
  raise notice 'caso 4 OK — contrato sem vigência e item sem preço nascem em disputa, com o motivo escrito';
end $$;

-- ------------- caso 5: fechar duas vezes não duplica a cobrança
do $$
declare v_t uuid; v_ger uuid; r record; v_n integer;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_ger from _ctx where chave = 'gerador';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_ger::text, true);

  -- Reprocessar um mês é rotina — alguém corrige uma leitura e refecha. Sem a
  -- chave única, o cliente receberia a mesma cobrança duas vezes, e o segundo
  -- título pareceria tão legítimo quanto o primeiro.
  select * into r from app.fechar_competencia('2026-03');
  if r.titulos_criados <> 0 then
    raise exception 'FALHA: o refechamento criou % título(s)', r.titulos_criados;
  end if;
  if r.ja_existiam <> 3 then
    raise exception 'FALHA: o refechamento relatou % já existente(s), esperado 3', r.ja_existiam;
  end if;
  -- `row_count` do UPDATE, e não contagem por `fechado_por`: nada foi selado de
  -- novo, então o número é zero — não "os 3 que eu selei antes".
  if r.consumos_selados <> 0 then
    raise exception 'FALHA: o refechamento relatou % consumo(s) selado(s), esperado 0', r.consumos_selados;
  end if;

  select count(*) into v_n from public.titulo_receber where competencia = '2026-03';
  if v_n <> 3 then
    raise exception 'FALHA: a competência tem % títulos depois de dois fechamentos', v_n;
  end if;

  reset role;
  raise notice 'caso 5 OK — o fechamento é idempotente pela chave, não pela memória de quem chama';
end $$;

-- ------------- caso 6: a numeração é por locatário, e não se reescreve
do $$
declare v_t uuid; v_id1 uuid; v_id2 uuid; v_n1 bigint; v_n2 bigint; v_erro text := null;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  v_id1 := _titulo_receber(200);
  v_id2 := _titulo_receber(200);
  select numero_titulo into v_n1 from public.titulo_receber where id = v_id1;
  select numero_titulo into v_n2 from public.titulo_receber where id = v_id2;

  if v_n2 <> v_n1 + 1 then
    raise exception 'FALHA: a numeração pulou de % para %', v_n1, v_n2;
  end if;

  begin
    update public.titulo_receber set numero_titulo = 9999 where id = v_id1;
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: o número do título foi reescrito';
  end if;

  reset role;
  raise notice 'caso 6 OK — numeração sequencial por locatário, imutável depois de emitida';
end $$;

-- ------------- caso 7: RN-F12, desconto acima da alçada é barrado
do $$
declare v_t uuid; v_neg uuid; v_dir uuid; v_id uuid; v_erro text := null; v_liq numeric;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_neg from _ctx where chave = 'negociador';
  select valor::uuid into v_dir from _ctx where chave = 'diretor';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_neg::text, true);

  -- Título **já aprovado**: é a parte que não é óbvia da RN-F12. Sem ela, o
  -- caminho mais curto para cobrar menos do que a alçada permite seria emitir
  -- cheio, aprovar, e descontar depois.
  v_id := _titulo_receber(1000, 'APROVADO');

  -- 10% é o teto do negociador: passa.
  update public.titulo_receber
     set desconto = 100, desconto_motivo = 'desconto comercial negociado'
   where id = v_id;
  select valor_liquido into v_liq from public.titulo_receber where id = v_id;
  if v_liq <> 900 then
    raise exception 'FALHA: o líquido ficou em % em vez de 900', v_liq;
  end if;

  -- 15% ultrapassa: barra, mesmo com o título aprovado.
  begin
    update public.titulo_receber
       set desconto = 150, desconto_motivo = 'desconto maior negociado'
     where id = v_id;
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA RN-F12: desconto de 15%% passou com alçada de 10%%';
  end if;
  if v_erro not like '%acima da alçada%' then
    raise exception 'FALHA RN-F12: a recusa não explica a alçada (%)', v_erro;
  end if;

  -- Quem não tem alçada de desconto nenhuma não concede nada. Zero significa
  -- "não concede", não "concede qualquer um".
  perform set_config('app.usuario_id', v_dir::text, true);
  v_erro := null;
  begin
    update public.titulo_receber
       set desconto = 10, desconto_motivo = 'desconto pequeno'
     where id = v_id;
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA RN-F12: quem não tem alçada de desconto concedeu desconto';
  end if;

  reset role;
  raise notice 'caso 7 OK — desconto barrado pela alçada percentual, inclusive em título aprovado';
end $$;

-- ------------- caso 8: desconto que zera a cobrança é cancelamento disfarçado
do $$
declare v_t uuid; v_neg uuid; v_id uuid; v_erro text := null;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_neg from _ctx where chave = 'negociador';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_neg::text, true);
  v_id := _titulo_receber(500, 'APROVADO');

  begin
    update public.titulo_receber
       set desconto = 500, desconto_motivo = 'perdão integral'
     where id = v_id;
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: desconto de 100%% passou — cancelamento tem caminho e permissão próprios';
  end if;

  -- E desconto sem motivo não passa: é o único registro de por que se cobrou menos.
  v_erro := null;
  begin
    update public.titulo_receber set desconto = 50 where id = v_id;
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: desconto sem motivo foi aceito';
  end if;

  reset role;
  raise notice 'caso 8 OK — desconto não zera a cobrança nem entra sem motivo';
end $$;

-- ------------- caso 9: RN-F13, parcial recalcula e o excesso é recusado
do $$
declare
  v_t uuid; v_conta uuid; v_ger uuid; v_id uuid; v_status text;
  v_saldo numeric; v_erro text := null; r record;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_conta from _ctx where chave = 'conta';
  select valor::uuid into v_ger   from _ctx where chave = 'gerador';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_ger::text, true);

  v_id := _titulo_receber(1000, 'APROVADO');

  select * into r from app.receber_titulo(v_id, 400, current_date, v_conta, 'PIX');
  select status into v_status from public.titulo_receber where id = v_id;
  if v_status <> 'RECEBIDO_PARCIAL' then
    raise exception 'FALHA RN-F13: parcial deixou o título em %', v_status;
  end if;
  select app.saldo_titulo_receber(v_id) into v_saldo;
  if v_saldo <> 600 then raise exception 'FALHA RN-F13: saldo % após parcial, esperado 600', v_saldo; end if;

  -- A entrada bancária nasceu junto: um recebimento sem movimentação é um
  -- título quitado que não entrou em conta nenhuma.
  if not exists (select 1 from public.movimentacao_bancaria
                  where id = r.movimentacao_id and tipo = 'ENTRADA'
                    and titulo_receber_id = v_id and valor = 400) then
    raise exception 'FALHA: a entrada bancária do recebimento não foi criada';
  end if;

  -- Excesso recusado: a mais não vira crédito do cliente, que apareceria depois
  -- como saldo a favor sem origem.
  begin
    perform app.receber_titulo(v_id, 700, current_date, v_conta, 'PIX');
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA RN-F13: recebimento acima do saldo foi aceito'; end if;

  perform app.receber_titulo(v_id, 600, current_date, v_conta, 'TRANSFERENCIA');
  select status into v_status from public.titulo_receber where id = v_id;
  if v_status <> 'RECEBIDO' then
    raise exception 'FALHA RN-F13: quitado deixou o título em %', v_status;
  end if;

  reset role;
  raise notice 'caso 9 OK — parcial recalcula, excesso recusado, e a entrada nasce com a baixa';
end $$;

-- ------------- caso 10: o estorno devolve, e só uma vez
do $$
declare
  v_t uuid; v_conta uuid; v_ger uuid; v_id uuid; v_rec uuid;
  v_status text; v_erro text := null; v_saldo_conta numeric; r record;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_conta from _ctx where chave = 'conta';
  select valor::uuid into v_ger   from _ctx where chave = 'gerador';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_ger::text, true);

  v_id := _titulo_receber(300, 'APROVADO');
  select * into r from app.receber_titulo(v_id, 300, current_date, v_conta, 'BOLETO');
  v_rec := r.recebimento_id;
  select app.saldo_conta(v_conta) into v_saldo_conta;

  perform app.estornar_recebimento(v_rec, 'cheque devolvido pelo banco');

  select status into v_status from public.titulo_receber where id = v_id;
  if v_status <> 'APROVADO' then
    raise exception 'FALHA: o título estornado ficou em % em vez de reabrir', v_status;
  end if;
  if app.saldo_conta(v_conta) <> v_saldo_conta - 300 then
    raise exception 'FALHA: o estorno não tirou o valor da conta';
  end if;

  begin
    perform app.estornar_recebimento(v_rec, 'tentando de novo');
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA: o recebimento foi estornado duas vezes'; end if;

  -- E não se apaga: estorno é lançamento contrário, nunca exclusão.
  v_erro := null;
  begin
    delete from public.titulo_receber_recebimento where id = v_rec;
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA: o recebimento foi apagado'; end if;

  reset role;
  raise notice 'caso 10 OK — estorno devolve à conta, reabre o título, e não se repete nem apaga';
end $$;

-- ------------- caso 11: RN-F14, BAIXADO não é RECEBIDO
do $$
declare
  v_t uuid; v_conta uuid; v_ger uuid; v_id uuid; v_pago uuid;
  v_status text; v_erro text := null; v_receita numeric;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_conta from _ctx where chave = 'conta';
  select valor::uuid into v_ger   from _ctx where chave = 'gerador';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_ger::text, true);

  v_id := _titulo_receber(800, 'APROVADO');

  -- Sem motivo não baixa: é o único registro de por que este valor não entrou.
  begin
    perform app.baixar_sem_recebimento(v_id, 'perda');
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA RN-F14: baixa sem motivo suficiente foi aceita'; end if;

  perform app.baixar_sem_recebimento(v_id, 'perda reconhecida: cliente em recuperação judicial');
  select status into v_status from public.titulo_receber where id = v_id;
  if v_status <> 'BAIXADO' then raise exception 'FALHA: o título ficou em %', v_status; end if;

  -- Título quitado não se baixa: apagaria o registro de que o dinheiro entrou.
  v_pago := _titulo_receber(100, 'APROVADO');
  perform app.receber_titulo(v_pago, 100, current_date, v_conta, 'PIX');
  v_erro := null;
  begin
    perform app.baixar_sem_recebimento(v_pago, 'querendo baixar o que já entrou');
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA RN-F14: um título recebido foi baixado'; end if;

  reset role;
  raise notice 'caso 11 OK — baixa exige motivo e saldo em aberto';
end $$;

-- ------------- caso 12: a receita realizada não conta o que foi baixado
do $$
declare
  v_t uuid; v_conta uuid; v_ger uuid; v_cli uuid;
  v_recebido uuid; v_baixado uuid; v_receita numeric;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_conta from _ctx where chave = 'conta';
  select valor::uuid into v_ger   from _ctx where chave = 'gerador';
  select valor::uuid into v_cli   from _ctx where chave = 'cliente';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_ger::text, true);

  -- Dois títulos na mesma competência: um recebido, um baixado. Se a agregação
  -- somasse "encerrados", os dois entrariam — e a receita apareceria inflada
  -- justamente onde ninguém confere, porque a soma continuaria fechando.
  insert into public.titulo_receber
    (tenant_id, cliente_id, origem, descricao, valor_original,
     data_emissao, data_vencimento, status, created_by, competencia, contrato_id)
  values (v_t, v_cli, 'AVULSO', 'Recebido de 2026-04', 500,
          current_date, current_date + 30, 'APROVADO', v_ger, null, null)
  returning id into v_recebido;
  update public.titulo_receber set competencia = '2026-04' where id = v_recebido;

  insert into public.titulo_receber
    (tenant_id, cliente_id, origem, descricao, valor_original,
     data_emissao, data_vencimento, status, created_by)
  values (v_t, v_cli, 'AVULSO', 'Baixado de 2026-04', 700,
          current_date, current_date + 30, 'APROVADO', v_ger)
  returning id into v_baixado;
  update public.titulo_receber set competencia = '2026-04' where id = v_baixado;

  perform app.receber_titulo(v_recebido, 500, current_date, v_conta, 'PIX');
  perform app.baixar_sem_recebimento(v_baixado, 'valor irrisório: não compensa cobrar');

  select app.receita_realizada('2026-04') into v_receita;
  if v_receita <> 500 then
    raise exception 'FALHA RN-F14: receita realizada % — esperado 500 (o baixado não entra)', v_receita;
  end if;

  reset role;
  raise notice 'caso 12 OK — a receita soma recebimentos, não títulos encerrados';
end $$;

-- ------------- caso 13: sequencial, e quem gera não aprova
do $$
declare
  v_t uuid; v_ger uuid; v_gestor uuid; v_dir uuid; v_id uuid;
  v_erro text := null; v_a1 uuid; v_a2 uuid;
begin
  select valor::uuid into v_t      from _ctx where chave = 'tenant';
  select valor::uuid into v_ger    from _ctx where chave = 'gerador';
  select valor::uuid into v_gestor from _ctx where chave = 'gestor';
  select valor::uuid into v_dir    from _ctx where chave = 'diretor';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_ger::text, true);

  -- 50 mil ultrapassa as duas faixas: dois níveis.
  v_id := _titulo_receber(50000, 'PENDENTE_APROVACAO');
  insert into public.titulo_receber_aprovacao (tenant_id, titulo_id, nivel, rodada)
    values (v_t, v_id, 1, 1) returning id into v_a1;
  insert into public.titulo_receber_aprovacao (tenant_id, titulo_id, nivel, rodada)
    values (v_t, v_id, 2, 1) returning id into v_a2;

  -- Nível 2 antes do 1: o superior autorizaria algo que o inferior vai rejeitar.
  begin
    update public.titulo_receber_aprovacao
       set decisao = 'APROVADO', aprovador_id = v_dir, decidido_em = now()
     where id = v_a2;
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA: o nível 2 decidiu antes do nível 1'; end if;

  -- Quem gerou não aprova, e no fechamento automático o gerador é quem disparou
  -- o fechamento — então quem fecha a competência não aprova o que ela gerou.
  v_erro := null;
  begin
    update public.titulo_receber_aprovacao
       set decisao = 'APROVADO', aprovador_id = v_ger, decidido_em = now()
     where id = v_a1;
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA: quem gerou o título aprovou a própria cobrança'; end if;

  -- Sem alçada de emissão também não decide: o gerador tem posto 0.
  update public.titulo_receber_aprovacao
     set decisao = 'APROVADO', aprovador_id = v_gestor, decidido_em = now()
   where id = v_a1;
  update public.titulo_receber_aprovacao
     set decisao = 'APROVADO', aprovador_id = v_dir, decidido_em = now()
   where id = v_a2;

  -- Decisão registrada não se reescreve: é a prova de quem autorizou o quê.
  v_erro := null;
  begin
    update public.titulo_receber_aprovacao
       set decisao = 'REJEITADO', justificativa = 'mudei de ideia depois de aprovar'
     where id = v_a1;
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA: a decisão registrada foi reescrita'; end if;

  reset role;
  raise notice 'caso 13 OK — sequencial, segregação de funções, e decisão imutável';
end $$;

-- ------------- caso 14: rejeição exige justificativa
do $$
declare v_t uuid; v_ger uuid; v_gestor uuid; v_id uuid; v_a uuid; v_erro text := null;
begin
  select valor::uuid into v_t      from _ctx where chave = 'tenant';
  select valor::uuid into v_ger    from _ctx where chave = 'gerador';
  select valor::uuid into v_gestor from _ctx where chave = 'gestor';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_ger::text, true);

  v_id := _titulo_receber(5000, 'PENDENTE_APROVACAO');
  insert into public.titulo_receber_aprovacao (tenant_id, titulo_id, nivel, rodada)
    values (v_t, v_id, 1, 1) returning id into v_a;

  begin
    update public.titulo_receber_aprovacao
       set decisao = 'REJEITADO', aprovador_id = v_gestor, decidido_em = now(),
           justificativa = 'não'
     where id = v_a;
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: rejeição sem justificativa foi aceita — o solicitante reenviaria igual';
  end if;

  reset role;
  raise notice 'caso 14 OK — recusa sem justificativa não é resposta';
end $$;

-- ------------- caso 15: rateio fecha em 100%, ou não existe
do $$
declare v_t uuid; v_ger uuid; v_id uuid; v_cc_a uuid; v_cc_b uuid; v_erro text := null;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_ger  from _ctx where chave = 'gerador';
  select valor::uuid into v_cc_a from _ctx where chave = 'cc_a';
  select valor::uuid into v_cc_b from _ctx where chave = 'cc_b';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_ger::text, true);

  v_id := _titulo_receber(1000, 'APROVADO');

  begin
    insert into public.titulo_receber_rateio (tenant_id, titulo_id, centro_custo_id, percentual)
      values (v_t, v_id, v_cc_a, 60);
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA: rateio de 60%% foi aceito sozinho'; end if;

  -- As duas linhas na mesma instrução: é o caminho normal, e é por isso que o
  -- gatilho é de statement e não de linha.
  insert into public.titulo_receber_rateio (tenant_id, titulo_id, centro_custo_id, percentual)
    values (v_t, v_id, v_cc_a, 60), (v_t, v_id, v_cc_b, 40);

  -- Remover uma linha deixaria 60%: recusado. Remover as duas é legítimo —
  -- receita sem centro de custo é um estado válido.
  v_erro := null;
  begin
    delete from public.titulo_receber_rateio where titulo_id = v_id and centro_custo_id = v_cc_b;
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA: a remoção deixou o rateio em 60%%'; end if;

  delete from public.titulo_receber_rateio where titulo_id = v_id;

  reset role;
  raise notice 'caso 15 OK — o rateio fecha em 100%% ou não existe';
end $$;

-- ------------- caso 16: nem valor líquido nem saldo são colunas graváveis
do $$
declare v_n integer; v_t uuid; v_ger uuid; v_id uuid; v_erro text := null;
begin
  -- `valor_liquido` existe, mas é gerada: não há caminho para informar um
  -- líquido que discorde do original menos o desconto.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'titulo_receber'
     and column_name = 'valor_liquido' and is_generated = 'ALWAYS';
  if v_n <> 1 then raise exception 'FALHA: valor_liquido não é coluna gerada'; end if;

  -- E saldo não existe de forma alguma. A ausência é a garantia: se algum dia
  -- alguém acrescentar a coluna, este teste falha antes de a divergência
  -- aparecer como receita que não fecha.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'titulo_receber'
     and column_name in ('saldo', 'saldo_atual', 'valor_recebido', 'dias_atraso');
  if v_n <> 0 then
    raise exception 'FALHA: apareceu(ram) % coluna(s) de saldo/atraso gravado em titulo_receber', v_n;
  end if;

  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_ger from _ctx where chave = 'gerador';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_ger::text, true);
  v_id := _titulo_receber(100, 'APROVADO');
  begin
    update public.titulo_receber set valor_liquido = 1 where id = v_id;
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA: o valor líquido foi digitado'; end if;

  reset role;
  raise notice 'caso 16 OK — líquido derivado, saldo e atraso sem coluna nenhuma';
end $$;

-- ------------- caso 17: as quatro tabelas isoladas por locatário
do $$
declare v_t uuid; v_outro uuid := gen_random_uuid(); v_n integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  insert into public.tenant (id, nome) values (v_outro, 'Locadora Vizinha');

  set local role iarx_app;
  perform set_config('app.tenant_id', v_outro::text, true);

  select count(*) into v_n from public.titulo_receber;
  if v_n <> 0 then raise exception 'FALHA: o vizinho viu % título(s) a receber', v_n; end if;
  select count(*) into v_n from public.titulo_receber_aprovacao;
  if v_n <> 0 then raise exception 'FALHA: o vizinho viu % aprovação(ões)', v_n; end if;
  select count(*) into v_n from public.titulo_receber_recebimento;
  if v_n <> 0 then raise exception 'FALHA: o vizinho viu % recebimento(s)', v_n; end if;
  select count(*) into v_n from public.titulo_receber_rateio;
  if v_n <> 0 then raise exception 'FALHA: o vizinho viu % linha(s) de rateio', v_n; end if;

  -- A numeração de um locatário não vaza para o outro: o contador é por linha.
  select count(*) into v_n from public.titulo_receber_contador;
  if v_n <> 0 then raise exception 'FALHA: o vizinho viu o contador de outro locatário'; end if;

  reset role;
  raise notice 'caso 17 OK — as cinco tabelas isoladas por locatário';
end $$;

-- ------------- caso 18: o cliente vê a própria cobrança, e só depois de aprovada
do $$
declare
  v_t uuid; v_cli uuid; v_cli_b uuid; v_ger uuid;
  v_pendente uuid; v_aprovado uuid; v_n integer;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_cli   from _ctx where chave = 'cliente';
  select valor::uuid into v_cli_b from _ctx where chave = 'cliente_b';
  select valor::uuid into v_ger   from _ctx where chave = 'gerador';

  -- O caso 17 deixou `app.tenant_id` apontando para o locatário vizinho, e
  -- `set_config(..., true)` vale pela transação inteira. Reapontar aqui é
  -- higiene de teste, não detalhe: sem isto, o gatilho de numeração tiraria o
  -- número do contador do vizinho.
  perform set_config('app.tenant_id', v_t::text, true);

  insert into public.titulo_receber
    (tenant_id, cliente_id, origem, descricao, valor_original,
     data_emissao, data_vencimento, status, created_by)
  values (v_t, v_cli, 'AVULSO', 'Pré-cobrança em aprovação', 4000,
          current_date, current_date + 30, 'PENDENTE_APROVACAO', v_ger)
  returning id into v_pendente;
  insert into public.titulo_receber
    (tenant_id, cliente_id, origem, descricao, valor_original,
     data_emissao, data_vencimento, status, created_by)
  values (v_t, v_cli, 'AVULSO', 'Cobrança aprovada', 4000,
          current_date, current_date + 30, 'APROVADO', v_ger)
  returning id into v_aprovado;

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.cliente_id', v_cli::text, true);

  -- Aqui está o oposto exato de contas a pagar, onde a ausência de política de
  -- cliente é a invariante. A cobrança **é** do cliente: ele tem de vê-la.
  select count(*) into v_n from public.titulo_receber where id = v_aprovado;
  if v_n <> 1 then raise exception 'FALHA: o cliente não vê a própria cobrança aprovada'; end if;

  -- Mas não a pré-cobrança: o valor ainda pode mudar, e mostrá-la é dar ao
  -- cliente um número que a empresa ainda não assumiu.
  select count(*) into v_n from public.titulo_receber where id = v_pendente;
  if v_n <> 0 then
    raise exception 'FALHA: o cliente viu um título em PENDENTE_APROVACAO';
  end if;

  -- E nada do vizinho de carteira.
  select count(*) into v_n from public.titulo_receber where cliente_id = v_cli_b;
  if v_n <> 0 then raise exception 'FALHA: o cliente viu % título(s) de outro cliente', v_n; end if;

  -- Recebimento e rateio não têm política de cliente: conta bancária de destino
  -- e centro de custo são dado interno da locadora. Com contexto de cliente, a
  -- política do locatário ainda vale, então o que ele enxerga é o do tenant —
  -- e é por isso que a rota do portal não expõe estas tabelas.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and tablename in ('titulo_receber_recebimento', 'titulo_receber_rateio')
     and policyname like '%_cliente';
  if v_n <> 0 then
    raise exception 'FALHA: % política(s) de cliente sobre recebimento/rateio', v_n;
  end if;

  /*
   * Limpa o contexto de cliente, e a razão vale registrar.
   *
   * `set_config(..., true)` vale pela transação, então sem esta linha os casos
   * seguintes rodariam com contexto de cliente — e o caso 20, que insere um
   * título em PENDENTE_APROVACAO, seria recusado pela própria política que este
   * caso acabou de provar. A recusa estaria **certa**: uma sessão de cliente não
   * cria pré-cobrança. Mas o caso 20 quer testar outra coisa, e um teste que
   * falha pela razão errada não vale nada.
   */
  perform set_config('app.cliente_id', '', true);

  reset role;
  raise notice 'caso 18 OK — o cliente vê a cobrança aprovada, nunca a pré-cobrança nem a do vizinho';
end $$;

-- ------------- caso 19: o pai de um parcelamento não recebe baixa
do $$
declare
  v_t uuid; v_cli uuid; v_ger uuid; v_conta uuid;
  v_pai uuid; v_filha uuid; v_erro text := null;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_cli   from _ctx where chave = 'cliente';
  select valor::uuid into v_ger   from _ctx where chave = 'gerador';
  select valor::uuid into v_conta from _ctx where chave = 'conta';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_ger::text, true);

  insert into public.titulo_receber
    (tenant_id, cliente_id, origem, descricao, valor_original,
     data_emissao, data_vencimento, status, created_by, parcela_total)
  values (v_t, v_cli, 'AVULSO', 'Projeto parcelado', 900,
          current_date, current_date + 30, 'APROVADO', v_ger, 3)
  returning id into v_pai;

  insert into public.titulo_receber
    (tenant_id, cliente_id, origem, descricao, valor_original,
     data_emissao, data_vencimento, status, created_by,
     titulo_pai_id, parcela_numero, parcela_total)
  values (v_t, v_cli, 'AVULSO', 'Projeto parcelado 1/3', 300,
          current_date, current_date + 30, 'APROVADO', v_ger, v_pai, 1, 3)
  returning id into v_filha;

  -- Receber no pai contaria o total do parcelamento **e** as parcelas.
  begin
    perform app.receber_titulo(v_pai, 900, current_date, v_conta, 'PIX');
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA: o pai do parcelamento recebeu baixa'; end if;

  perform app.receber_titulo(v_filha, 300, current_date, v_conta, 'PIX');

  reset role;
  raise notice 'caso 19 OK — o pai é relatório; quem recebe são as parcelas';
end $$;

-- ------------- caso 20: título não aprovado não recebe dinheiro
do $$
declare v_t uuid; v_ger uuid; v_conta uuid; v_id uuid; v_erro text := null;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_ger   from _ctx where chave = 'gerador';
  select valor::uuid into v_conta from _ctx where chave = 'conta';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id', v_ger::text, true);

  v_id := _titulo_receber(2000, 'PENDENTE_APROVACAO');
  begin
    perform app.receber_titulo(v_id, 100, current_date, v_conta, 'PIX');
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: um título pendente de aprovação recebeu baixa';
  end if;

  -- Em disputa também não: cobrar o que se sabe estar errado é o defeito que a
  -- RN-F11 existe para evitar, e receber selaria o erro.
  v_erro := null;
  v_id := _titulo_receber(2000, 'EM_DISPUTA');
  begin
    perform app.receber_titulo(v_id, 100, current_date, v_conta, 'PIX');
  exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then raise exception 'FALHA: um título em disputa recebeu baixa'; end if;

  reset role;
  raise notice 'caso 20 OK — a aprovação da cobrança vem antes do dinheiro';
end $$;

rollback;

\echo '== 13_rnf_contas_a_receber: TODOS OS CASOS APROVADOS =='
