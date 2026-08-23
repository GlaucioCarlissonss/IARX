-- =============================================================================
-- TESTE RN-F15 … RN-F22 — Lançamentos futuros e fluxo de caixa projetado
--
-- RN-F15  a conversão ocorre uma vez, nunca duas
-- RN-F16  contrato fora de vigência não converte — e não desaparece
-- RN-F17  editar ou cancelar só em PROGRAMADO
-- RN-F18  a recorrência gera o próximo, nunca o lote
-- RN-F19  a projeção nunca inclui CANCELADO nem BAIXADO
-- RN-F20  a inadimplência do cenário só se aplica a recebíveis
-- RN-F21  saldo negativo projetado vira alerta
-- RN-F22  concentração de saídas num único dia vira alerta
--
-- O que está em jogo: **este é o módulo em que um defeito paga duas vezes**. Um
-- título duplicado não é um número errado num relatório — é um segundo boleto
-- para o mesmo compromisso, tão legítimo quanto o primeiro, e a descoberta vem
-- do fornecedor cobrando de novo ou do cliente reclamando da segunda cobrança.
--
-- Por isso o caso 5 é o centro do arquivo: ele não confere que a conversão
-- funciona, confere que a **segunda** conversão não acontece.
--
-- Nenhum valor aqui é regra de negócio da IARX. Periodicidade, dia de
-- vencimento, percentual de inadimplência e limiar de concentração são massa
-- deste arquivo; o que se prova é que o cálculo segue o cadastro.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_t uuid := gen_random_uuid();
  v_emp uuid; v_fil uuid; v_fil_b uuid;
  v_forn uuid; v_cli uuid;
  v_ctr uuid; v_ctr_susp uuid;
  v_conta uuid; v_cc_a uuid; v_cc_b uuid;
  v_p_oper uuid; v_oper uuid;
  v_cen_padrao uuid; v_cen_pess uuid;
  v_rec_pagar uuid; v_rec_receber uuid;
begin
  insert into public.tenant (id, nome) values (v_t, 'Locadora Caixa');
  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_t, 'CAIXA LOCACOES LTDA', '11222333000181') returning id into v_emp;
  insert into public.filial (tenant_id, empresa_id, codigo, nome)
    values (v_t, v_emp, 'SP-01', 'Base SP') returning id into v_fil;
  insert into public.filial (tenant_id, empresa_id, codigo, nome)
    values (v_t, v_emp, 'RJ-01', 'Base RJ') returning id into v_fil_b;

  insert into public.fornecedor (tenant_id, documento, razao_social)
    values (v_t, '33666999000183', 'LOCADORA DE IMOVEIS SA') returning id into v_forn;
  insert into public.cliente (tenant_id, documento, razao_social)
    values (v_t, '11444777000161', 'CLIENTE ALFA LTDA') returning id into v_cli;

  /* Contrato vigente e contrato suspenso — RN-F16 precisa dos dois. */
  insert into public.contrato
    (tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim)
    values (v_t, 'SP-2026-001', v_emp, v_fil, v_cli, 'ATIVO', '2026-01-01', '2026-12-31')
    returning id into v_ctr;
  insert into public.contrato
    (tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim)
    values (v_t, 'SP-2026-002', v_emp, v_fil, v_cli, 'SUSPENSO', '2026-01-01', '2026-12-31')
    returning id into v_ctr_susp;

  insert into public.conta_bancaria
    (tenant_id, empresa_id, banco_codigo, agencia, numero, tipo, apelido,
     saldo_inicial, data_saldo_inicial)
    values (v_t, v_emp, '341', '0912', '45871-3', 'CORRENTE', 'Movimento',
            10000, date '2026-01-01')
    returning id into v_conta;

  insert into public.centro_custo (tenant_id, codigo, nome)
    values (v_t, 'ADM', 'Administrativo') returning id into v_cc_a;
  insert into public.centro_custo (tenant_id, codigo, nome)
    values (v_t, 'OPER', 'Operação') returning id into v_cc_b;

  /*
   * Sem alçada cadastrada de propósito para o lado a pagar: `niveis_aprovacao_pagar`
   * devolve 0 e o título convertido nasce APROVADO. O caso 6 confere que a
   * rodada de aprovação **abre** quando há alçada, então lá a alçada entra.
   */
  insert into public.perfil (tenant_id, nome)
    values (v_t, 'Operador Financeiro') returning id into v_p_oper;
  insert into public.usuario (tenant_id, nome, email, status)
    values (v_t, 'Operador Caixa', 'opera@caixa.test', 'ATIVO') returning id into v_oper;
  insert into public.usuario_perfil (tenant_id, usuario_id, perfil_id, escopo_tipo)
    values (v_t, v_oper, v_p_oper, 'TENANT');

  /*
   * Dois cenários: o padrão sem inadimplência e um pessimista com 30%.
   *
   * O padrão é quem responde quando a projeção é chamada sem cenário, e é de
   * onde os alertas saem — não existe "realista" no esquema, e casar pelo nome
   * seria adivinhar como o operador vai chamar a linha.
   */
  insert into public.parametro_cenario_caixa
    (tenant_id, nome, percentual_inadimplencia, limiar_concentracao, padrao)
    values (v_t, 'Base', 0, 40, true) returning id into v_cen_padrao;
  insert into public.parametro_cenario_caixa
    (tenant_id, nome, percentual_inadimplencia, limiar_concentracao, padrao)
    values (v_t, 'Estresse', 30, 40, false) returning id into v_cen_pess;

  /* Recorrência mensal de aluguel — o molde do lado a pagar. */
  insert into public.recorrencia
    (tenant_id, lado, descricao, valor_base, periodicidade, dia_vencimento,
     proxima_geracao, empresa_id, fornecedor_id, classificacao, filial_id,
     centro_custo_id, created_by)
    values (v_t, 'PAGAR', 'Aluguel do galpão', 4000, 'MENSAL', 10,
            date '2026-07-10', v_emp, v_forn, 'DESPESA_FIXA', v_fil,
            v_cc_a, v_oper)
    returning id into v_rec_pagar;

  /* Recorrência trimestral do lado a receber, ligada ao contrato vigente. */
  insert into public.recorrencia
    (tenant_id, lado, descricao, valor_base, periodicidade, dia_vencimento,
     proxima_geracao, cliente_id, contrato_id, filial_id, created_by)
    values (v_t, 'RECEBER', 'Suporte trimestral', 900, 'TRIMESTRAL', 5,
            date '2026-07-05', v_cli, v_ctr, v_fil, v_oper)
    returning id into v_rec_receber;

  create temporary table _ctx (chave text primary key, valor text);
  insert into _ctx values
    ('tenant', v_t::text), ('empresa', v_emp::text),
    ('filial', v_fil::text), ('filial_b', v_fil_b::text),
    ('fornecedor', v_forn::text), ('cliente', v_cli::text),
    ('contrato', v_ctr::text), ('contrato_susp', v_ctr_susp::text),
    ('conta', v_conta::text), ('cc_a', v_cc_a::text), ('cc_b', v_cc_b::text),
    ('perfil_oper', v_p_oper::text), ('operador', v_oper::text),
    ('cenario_padrao', v_cen_padrao::text), ('cenario_pess', v_cen_pess::text),
    ('rec_pagar', v_rec_pagar::text), ('rec_receber', v_rec_receber::text);

  -- Tabela temporária criada pelo superusuário não é legível por `iarx_app`:
  -- a lição do arquivo 12, e os casos leem o contexto já com o papel assumido.
  grant select on _ctx to iarx_app;
end $$;

/**
 * Cria um lançamento futuro do lado a pagar, devolvendo o id.
 *
 * `p_contrato` nulo por padrão: a maioria dos casos não fala de vigência, e
 * amarrar todos a um contrato faria RN-F16 interferir onde ela não é o assunto.
 */
create or replace function _lf_pagar(
  p_valor numeric, p_data date, p_contrato uuid default null,
  p_recorrencia uuid default null, p_filial uuid default null)
returns uuid
language plpgsql as $$
declare v_t uuid; v_emp uuid; v_forn uuid; v_op uuid; v_cc uuid; v_id uuid;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_emp  from _ctx where chave = 'empresa';
  select valor::uuid into v_forn from _ctx where chave = 'fornecedor';
  select valor::uuid into v_op   from _ctx where chave = 'operador';
  select valor::uuid into v_cc   from _ctx where chave = 'cc_a';

  insert into public.lancamento_futuro
    (tenant_id, tipo, lado, descricao, valor_previsto, data_prevista,
     empresa_id, fornecedor_id, classificacao, centro_custo_id, contrato_id,
     filial_id, recorrencia_id, created_by, updated_by)
  values (v_t, 'DESPESA_RECORRENTE', 'PAGAR', 'Compromisso previsto', p_valor,
          p_data, v_emp, v_forn, 'DESPESA_FIXA', v_cc, p_contrato,
          coalesce(p_filial, (select valor::uuid from _ctx where chave = 'filial')),
          p_recorrencia, v_op, v_op)
  returning id into v_id;
  return v_id;
end $$;

/** Idem, do lado a receber. */
create or replace function _lf_receber(
  p_valor numeric, p_data date, p_contrato uuid default null)
returns uuid
language plpgsql as $$
declare v_t uuid; v_cli uuid; v_op uuid; v_id uuid;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_cli from _ctx where chave = 'cliente';
  select valor::uuid into v_op  from _ctx where chave = 'operador';

  insert into public.lancamento_futuro
    (tenant_id, tipo, lado, descricao, valor_previsto, data_prevista,
     cliente_id, contrato_id, filial_id, created_by, updated_by)
  values (v_t, 'RECEITA_RECORRENTE', 'RECEBER', 'Receita prevista', p_valor,
          p_data, v_cli, p_contrato,
          (select valor::uuid from _ctx where chave = 'filial'), v_op, v_op)
  returning id into v_id;
  return v_id;
end $$;

-- ------------- caso 1: o discriminador amarra as colunas dos dois lados
do $$
declare v_t uuid; v_emp uuid; v_cli uuid; v_forn uuid; v_erro text;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_emp  from _ctx where chave = 'empresa';
  select valor::uuid into v_cli  from _ctx where chave = 'cliente';
  select valor::uuid into v_forn from _ctx where chave = 'fornecedor';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  -- Recorrência PAGAR com cliente: aceita, a conversão teria dois destinos.
  begin
    insert into public.recorrencia
      (tenant_id, lado, descricao, valor_base, periodicidade, dia_vencimento,
       proxima_geracao, empresa_id, classificacao, cliente_id)
      values (v_t, 'PAGAR', 'Confusa', 100, 'MENSAL', 1, current_date, v_emp,
              'DESPESA_FIXA', v_cli);
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: recorrência a pagar aceitou cliente';
  end if;

  -- Recorrência RECEBER sem cliente: não há para quem cobrar.
  v_erro := null;
  begin
    insert into public.recorrencia
      (tenant_id, lado, descricao, valor_base, periodicidade, dia_vencimento,
       proxima_geracao)
      values (v_t, 'RECEBER', 'Sem cliente', 100, 'MENSAL', 1, current_date);
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: recorrência a receber aceitou ficar sem cliente';
  end if;

  -- Dia 29 não existe em todo mês, e o que fazer em fevereiro ninguém especificou.
  v_erro := null;
  begin
    insert into public.recorrencia
      (tenant_id, lado, descricao, valor_base, periodicidade, dia_vencimento,
       proxima_geracao, empresa_id, classificacao)
      values (v_t, 'PAGAR', 'Dia 29', 100, 'MENSAL', 29, current_date, v_emp, 'DESPESA_FIXA');
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: dia de vencimento 29 foi aceito';
  end if;

  reset role;
  raise notice 'caso 1 OK — o discriminador não aceita coluna do outro lado';
end $$;

-- ------------- caso 2: `lado` é consequência de `tipo`, não segunda escolha
do $$
declare v_t uuid; v_cli uuid; v_erro text;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_cli from _ctx where chave = 'cliente';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  -- Provisão marcada como RECEBER geraria cobrança onde deveria haver despesa.
  begin
    insert into public.lancamento_futuro
      (tenant_id, tipo, lado, descricao, valor_previsto, data_prevista, cliente_id)
      values (v_t, 'PROVISAO', 'RECEBER', 'Provisão invertida', 100, current_date, v_cli);
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: provisão foi aceita como RECEBER';
  end if;

  reset role;
  raise notice 'caso 2 OK — tipo e lado não discordam';
end $$;

-- ------------- caso 3: os três estados do par de chaves estrangeiras
do $$
declare v_t uuid; v_lf uuid; v_tp uuid; v_erro text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  v_lf := _lf_pagar(1000, current_date);

  -- (a) PROGRAMADO apontando para título: o estado mais difícil de diagnosticar,
  -- porque a conversão pareceria feita sem ter sido.
  insert into public.titulo_pagar
    (tenant_id, empresa_id, fornecedor_id, descricao, classificacao,
     valor_original, data_emissao, data_vencimento, status)
  values (v_t, (select valor::uuid from _ctx where chave = 'empresa'),
          (select valor::uuid from _ctx where chave = 'fornecedor'),
          'Título solto', 'DESPESA_FIXA', 1000, current_date, current_date + 10, 'PENDENTE')
  returning id into v_tp;

  begin
    update public.lancamento_futuro set titulo_pagar_id = v_tp where id = v_lf;
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: um PROGRAMADO ficou apontando para título';
  end if;

  -- (b) CONVERTIDO sem nenhum título.
  v_erro := null;
  begin
    update public.lancamento_futuro
       set status = 'CONVERTIDO', convertido_em = now() where id = v_lf;
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: um CONVERTIDO ficou sem título';
  end if;

  -- (c) lado PAGAR apontando para título a receber.
  v_erro := null;
  begin
    update public.lancamento_futuro
       set titulo_receber_id = gen_random_uuid() where id = v_lf;
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: um lançamento a pagar apontou para título a receber';
  end if;

  reset role;
  raise notice 'caso 3 OK — o par de FK cobre os três estados errados';
end $$;

-- ------------- caso 4: a conversão cria o título e liga os dois lados
do $$
declare
  v_t uuid; v_lf uuid; r record; v_tit record; v_st text; v_fil uuid;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_fil from _ctx where chave = 'filial';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  v_lf := _lf_pagar(4000, current_date + 5);
  select * into r from app.converter_lancamento_futuro(v_lf);

  if r.titulo_id is null then
    raise exception 'FALHA: a conversão não devolveu título (exceção: %)', r.excecao;
  end if;
  if r.excecao is not null then
    raise exception 'FALHA: conversão limpa devolveu exceção %', r.excecao;
  end if;

  select status, titulo_pagar_id, titulo_receber_id, convertido_em, filial_id
    into v_tit from public.lancamento_futuro where id = v_lf;
  if v_tit.status <> 'CONVERTIDO' then
    raise exception 'FALHA: o lançamento ficou em %', v_tit.status;
  end if;
  if v_tit.titulo_pagar_id is distinct from r.titulo_id then
    raise exception 'FALHA: o lançamento não aponta para o título gerado';
  end if;
  if v_tit.titulo_receber_id is not null then
    raise exception 'FALHA: o lado errado ficou preenchido';
  end if;
  if v_tit.convertido_em is null then
    raise exception 'FALHA: convertido sem data de conversão';
  end if;

  -- A filial acompanha: é o recorte em que a projeção filtra.
  select status, filial_id, data_vencimento, recorrencia_id
    into v_tit from public.titulo_pagar where id = r.titulo_id;
  if v_tit.filial_id is distinct from v_fil then
    raise exception 'FALHA: o título nasceu na filial %', v_tit.filial_id;
  end if;
  if v_tit.data_vencimento <> current_date + 5 then
    raise exception 'FALHA: o vencimento do título é %, não a data prevista', v_tit.data_vencimento;
  end if;

  -- Sem alçada de pagamento cadastrada, `niveis_aprovacao_pagar` dá 0.
  if v_tit.status <> 'APROVADO' then
    raise exception 'FALHA: sem alçada o título convertido ficou em %', v_tit.status;
  end if;

  -- O rateio de 100% no centro de custo do lançamento acompanha.
  if not exists (select 1 from public.titulo_pagar_rateio
                  where titulo_id = r.titulo_id and percentual = 100) then
    raise exception 'FALHA: a conversão não levou o centro de custo';
  end if;

  reset role;
  raise notice 'caso 4 OK — a conversão liga lançamento e título nos dois sentidos';
end $$;

-- ------------- caso 5: RN-F15, a segunda conversão não acontece
--
-- O caso central do arquivo. Não prova que converter funciona (caso 4 já prova);
-- prova que **converter de novo não cria um segundo título**. Duas execuções do
-- worker — dois processos, ou um processo com ticks sobrepostos — lendo o mesmo
-- PROGRAMADO criariam dois compromissos idênticos, e o segundo pareceria tão
-- legítimo quanto o primeiro.
do $$
declare v_t uuid; v_lf uuid; r record; v_erro text; v_n integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  v_lf := _lf_pagar(7777, current_date + 3);
  select * into r from app.converter_lancamento_futuro(v_lf);
  if r.titulo_id is null then raise exception 'FALHA: a primeira conversão não gerou título'; end if;

  begin
    perform app.converter_lancamento_futuro(v_lf);
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: a segunda conversão foi aceita';
  end if;

  select count(*) into v_n from public.titulo_pagar
   where tenant_id = v_t and valor_original = 7777;
  if v_n <> 1 then
    raise exception 'FALHA: % títulos para o mesmo compromisso', v_n;
  end if;

  /*
   * E a porta dos fundos: destravar o lançamento para o estado anterior o poria
   * de volta na fila, e a segunda conversão passaria — sequencial, não
   * concorrente, então o `for update` não a veria.
   */
  v_erro := null;
  begin
    update public.lancamento_futuro
       set status = 'PROGRAMADO', titulo_pagar_id = null, convertido_em = null
     where id = v_lf;
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: um convertido voltou a PROGRAMADO e pode converter de novo';
  end if;

  reset role;
  raise notice 'caso 5 OK — RN-F15: um compromisso, um título, sem volta ao estado anterior';
end $$;

-- ------------- caso 6: a conversão não dispensa a alçada
do $$
declare
  v_t uuid; v_p uuid; v_lf uuid; r record; v_st text; v_niveis integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  select valor::uuid into v_p from _ctx where chave = 'perfil_oper';

  -- A alçada entra agora, e só para este caso: com ela, `niveis_aprovacao_pagar`
  -- deixa de ser 0 e a rodada precisa abrir.
  insert into public.alcada (tenant_id, perfil_id, tipo, limite_valor)
    values (v_t, v_p, 'APROVACAO_PAGAMENTO', 1000);

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  select app.niveis_aprovacao_pagar(9000) into v_niveis;
  if v_niveis < 1 then
    raise exception 'FALHA: a massa não produziu nível de aprovação (%)', v_niveis;
  end if;

  v_lf := _lf_pagar(9000, current_date + 7);
  select * into r from app.converter_lancamento_futuro(v_lf);

  select status into v_st from public.titulo_pagar where id = r.titulo_id;
  if v_st <> 'EM_APROVACAO' then
    raise exception 'FALHA: título convertido acima da alçada nasceu em %', v_st;
  end if;
  if (select count(*) from public.titulo_pagar_aprovacao where titulo_id = r.titulo_id)
     <> v_niveis then
    raise exception 'FALHA: a rodada de aprovação não abriu com % níveis', v_niveis;
  end if;

  reset role;
  delete from public.alcada where tenant_id = v_t and tipo = 'APROVACAO_PAGAMENTO';
  raise notice 'caso 6 OK — geração automática não é motivo para dispensar aprovação';
end $$;

-- ------------- caso 7: RN-F16, contrato inativo não converte e não desaparece
do $$
declare v_t uuid; v_susp uuid; v_lf uuid; r record; v_row record;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_susp from _ctx where chave = 'contrato_susp';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  v_lf := _lf_pagar(5000, current_date, v_susp);
  select * into r from app.converter_lancamento_futuro(v_lf);

  if r.titulo_id is not null then
    raise exception 'FALHA: contrato suspenso gerou título';
  end if;
  if r.excecao is null then
    raise exception 'FALHA: a recusa não veio com motivo';
  end if;
  if r.excecao not like '%SUSPENSO%' then
    raise exception 'FALHA: o motivo não diz o estado do contrato: %', r.excecao;
  end if;

  -- Não descarta: fica na fila de exceção, com o motivo escrito e a tentativa
  -- contada. Um lançamento que falhou em silêncio não é revisto.
  select status, excecao_conversao, tentativas_conversao into v_row
    from public.lancamento_futuro where id = v_lf;
  if v_row.status <> 'PROGRAMADO' then
    raise exception 'FALHA: o lançamento recusado ficou em %', v_row.status;
  end if;
  if v_row.excecao_conversao is null then
    raise exception 'FALHA: o motivo não ficou gravado na linha';
  end if;
  if v_row.tentativas_conversao <> 1 then
    raise exception 'FALHA: a tentativa não foi contada (%)', v_row.tentativas_conversao;
  end if;

  -- E o contrato voltando a vigorar, converte — a vigência é checada **agora**.
  update public.contrato set status = 'ATIVO' where id = v_susp;
  select * into r from app.converter_lancamento_futuro(v_lf);
  if r.titulo_id is null then
    raise exception 'FALHA: contrato reativado ainda não converte: %', r.excecao;
  end if;
  select excecao_conversao into v_row from public.lancamento_futuro where id = v_lf;
  if v_row.excecao_conversao is not null then
    raise exception 'FALHA: a exceção antiga sobreviveu à conversão bem-sucedida';
  end if;

  update public.contrato set status = 'SUSPENSO' where id = v_susp;
  reset role;
  raise notice 'caso 7 OK — RN-F16: recusa com motivo, e a recusa não é definitiva';
end $$;

-- ------------- caso 8: RN-F17, convertido não se edita nem se cancela
do $$
declare v_t uuid; v_lf uuid; r record; v_erro text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  v_lf := _lf_pagar(1500, current_date + 9);

  -- Programado se edita à vontade: é o ponto de existir separado do título.
  update public.lancamento_futuro
     set valor_previsto = 1600, data_prevista = current_date + 12 where id = v_lf;

  select * into r from app.converter_lancamento_futuro(v_lf);
  if r.titulo_id is null then raise exception 'FALHA: não converteu'; end if;

  begin
    update public.lancamento_futuro set valor_previsto = 99 where id = v_lf;
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: um convertido aceitou mudança de valor';
  end if;

  v_erro := null;
  begin
    update public.lancamento_futuro set status = 'CANCELADO' where id = v_lf;
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: um convertido foi cancelado';
  end if;

  -- Cancelado também não ressuscita: alguém decidiu que o compromisso não
  -- existe, e voltar a PROGRAMADO o poria a gerar título sem nova decisão.
  v_erro := null;
  declare v_outro uuid;
  begin
    v_outro := _lf_pagar(1200, current_date + 20);
    update public.lancamento_futuro set status = 'CANCELADO' where id = v_outro;
    begin
      update public.lancamento_futuro set status = 'PROGRAMADO' where id = v_outro;
      exception when others then v_erro := sqlerrm;
    end;
    if v_erro is null then
      raise exception 'FALHA: um cancelado voltou a PROGRAMADO';
    end if;
  end;

  reset role;
  raise notice 'caso 8 OK — RN-F17: convertido e cancelado são estados finais';
end $$;

-- ------------- caso 9: RN-F18, a recorrência gera o próximo, não o lote
do $$
declare
  v_t uuid; v_rec uuid; v_id uuid; v_n integer; v_prox date;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_rec from _ctx where chave = 'rec_pagar';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  select app.gerar_proximo_lancamento(v_rec) into v_id;
  if v_id is null then raise exception 'FALHA: a recorrência não gerou nada'; end if;

  select count(*) into v_n from public.lancamento_futuro where recorrencia_id = v_rec;
  if v_n <> 1 then
    raise exception 'FALHA: uma chamada gerou % lançamentos', v_n;
  end if;

  -- Mensal: 10/07 → 10/08. Somar meses é o que faz "todo dia 10" continuar no 10.
  select proxima_geracao into v_prox from public.recorrencia where id = v_rec;
  if v_prox <> date '2026-08-10' then
    raise exception 'FALHA: a próxima geração ficou em %', v_prox;
  end if;

  -- O lançamento gerado herda o molde inteiro, incluindo a filial.
  if not exists (select 1 from public.lancamento_futuro
                  where id = v_id and valor_previsto = 4000
                    and data_prevista = date '2026-07-10'
                    and lado = 'PAGAR' and tipo = 'DESPESA_RECORRENTE'
                    and filial_id = (select valor::uuid from _ctx where chave = 'filial')
                    and status = 'PROGRAMADO') then
    raise exception 'FALHA: o lançamento gerado não espelha o molde';
  end if;

  -- Segunda chamada gera o de agosto, não um segundo de julho.
  perform app.gerar_proximo_lancamento(v_rec);
  select count(*) into v_n from public.lancamento_futuro where recorrencia_id = v_rec;
  if v_n <> 2 then
    raise exception 'FALHA: duas chamadas produziram % lançamentos', v_n;
  end if;
  if (select count(*) from public.lancamento_futuro
       where recorrencia_id = v_rec and data_prevista = date '2026-07-10') <> 1 then
    raise exception 'FALHA: a data de julho ficou duplicada';
  end if;

  -- Inativa não gera: é o desligamento do molde.
  update public.recorrencia set ativo = false where id = v_rec;
  select app.gerar_proximo_lancamento(v_rec) into v_id;
  if v_id is not null then
    raise exception 'FALHA: recorrência inativa gerou lançamento';
  end if;
  update public.recorrencia set ativo = true where id = v_rec;

  reset role;
  raise notice 'caso 9 OK — RN-F18: um por chamada, e a data avança pela periodicidade';
end $$;

-- ------------- caso 10: as quatro periodicidades avançam o que dizem avançar
do $$
declare v_t uuid;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';
  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  if app.avancar_periodicidade(date '2026-01-31', 'MENSAL') <> date '2026-02-28' then
    raise exception 'FALHA: mensal a partir de 31/01 deu %',
      app.avancar_periodicidade(date '2026-01-31', 'MENSAL');
  end if;
  if app.avancar_periodicidade(date '2026-01-10', 'TRIMESTRAL') <> date '2026-04-10' then
    raise exception 'FALHA: trimestral';
  end if;
  if app.avancar_periodicidade(date '2026-01-10', 'SEMESTRAL') <> date '2026-07-10' then
    raise exception 'FALHA: semestral';
  end if;
  if app.avancar_periodicidade(date '2026-01-10', 'ANUAL') <> date '2027-01-10' then
    raise exception 'FALHA: anual';
  end if;

  reset role;
  raise notice 'caso 10 OK — o avanço soma meses, não dias';
end $$;

-- ------------- caso 11: converter um recorrente gera o próximo da série
do $$
declare v_t uuid; v_rec uuid; v_lf uuid; r record; v_n_antes integer; v_n_depois integer;
begin
  select valor::uuid into v_t   from _ctx where chave = 'tenant';
  select valor::uuid into v_rec from _ctx where chave = 'rec_receber';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  select count(*) into v_n_antes from public.lancamento_futuro where recorrencia_id = v_rec;
  select app.gerar_proximo_lancamento(v_rec) into v_lf;

  select * into r from app.converter_lancamento_futuro(v_lf);
  if r.titulo_id is null then
    raise exception 'FALHA: o recorrente não converteu: %', r.excecao;
  end if;

  select count(*) into v_n_depois from public.lancamento_futuro where recorrencia_id = v_rec;
  if v_n_depois <> v_n_antes + 2 then
    raise exception 'FALHA: converter gerou % lançamentos além do convertido',
      v_n_depois - v_n_antes - 1;
  end if;

  -- Trimestral: 05/07 gerado, próxima em 05/10, e a série anda ao converter.
  if not exists (select 1 from public.recorrencia
                  where id = v_rec and proxima_geracao = date '2027-01-05') then
    raise exception 'FALHA: a série trimestral não andou duas vezes (%)',
      (select proxima_geracao from public.recorrencia where id = v_rec);
  end if;

  -- O título a receber nasce AVULSO e **mantém** o contrato: CONTRATUAL exigiria
  -- competência, que um lançamento futuro não tem — ele não veio de medição.
  if not exists (select 1 from public.titulo_receber
                  where id = r.titulo_id and origem = 'AVULSO'
                    and contrato_id = (select valor::uuid from _ctx where chave = 'contrato')
                    and competencia is null) then
    raise exception 'FALHA: o título a receber perdeu o contrato ou ganhou competência';
  end if;

  reset role;
  raise notice 'caso 11 OK — a série anda ao converter, e o contrato sobrevive';
end $$;

-- ------------- caso 12: lançamento atrasado converte
--
-- A fila de elegíveis é `data_prevista <= hoje`, e os dois títulos exigem
-- `data_vencimento >= data_emissao`. Emitir com `hoje` fixo quebraria todo
-- lançamento atrasado — isto é, exatamente o caso que o worker existe para
-- resolver: o dia em que ficou parado e acordou com pendência acumulada.
do $$
declare v_t uuid; v_lf uuid; r record; v_em date; v_venc date;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  v_lf := _lf_pagar(3300, current_date - 20);
  select * into r from app.converter_lancamento_futuro(v_lf);
  if r.titulo_id is null then
    raise exception 'FALHA: lançamento atrasado não converteu: %', r.excecao;
  end if;

  select data_emissao, data_vencimento into v_em, v_venc
    from public.titulo_pagar where id = r.titulo_id;
  -- O vencimento é o planejado; antecipá-lo para hoje mudaria em silêncio a data
  -- que alguém combinou com o fornecedor.
  if v_venc <> current_date - 20 then
    raise exception 'FALHA: o vencimento foi movido para %', v_venc;
  end if;
  if v_em > v_venc then
    raise exception 'FALHA: emissão % depois do vencimento %', v_em, v_venc;
  end if;

  reset role;
  raise notice 'caso 12 OK — o worker atrasado converte a pendência acumulada';
end $$;

-- ------------- caso 13: a fila do worker respeita data, estado e recuo
do $$
declare v_t uuid; v_lf uuid; v_futuro uuid; v_n integer;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  v_lf    := _lf_pagar(111, current_date);
  v_futuro := _lf_pagar(222, current_date + 60);

  if not exists (select 1 from app.lancamentos_elegiveis(200) where id = v_lf) then
    raise exception 'FALHA: o lançamento de hoje não está elegível';
  end if;
  if exists (select 1 from app.lancamentos_elegiveis(200) where id = v_futuro) then
    raise exception 'FALHA: um lançamento de 60 dias à frente está elegível';
  end if;

  -- Recuo por tentativa: sem ele, um lançamento de contrato suspenso seria
  -- retentado a cada tick para sempre, competindo com os novos.
  update public.lancamento_futuro set tentativas_conversao = 20 where id = v_lf;
  if exists (select 1 from app.lancamentos_elegiveis(200) where id = v_lf) then
    raise exception 'FALHA: um lançamento com 20 tentativas continua na fila';
  end if;
  update public.lancamento_futuro set tentativas_conversao = 0 where id = v_lf;

  -- Cancelado sai da fila.
  update public.lancamento_futuro set status = 'CANCELADO' where id = v_lf;
  if exists (select 1 from app.lancamentos_elegiveis(200) where id = v_lf) then
    raise exception 'FALHA: um cancelado continua elegível';
  end if;

  reset role;
  raise notice 'caso 13 OK — a fila é por data, estado e recuo de tentativa';
end $$;

-- ------------- caso 14: a superfície do worker é fechada, não uma conexão sem RLS
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from information_schema.routine_privileges
   where routine_schema = 'app'
     and routine_name in ('lancamentos_elegiveis', 'recorrencias_a_gerar')
     and grantee = 'PUBLIC';
  if v_n <> 0 then
    raise exception 'FALHA: a superfície do worker está aberta a PUBLIC';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'lancamentos_elegiveis' and p.prosecdef) then
    raise exception 'FALHA: lancamentos_elegiveis não é security definer';
  end if;

  raise notice 'caso 14 OK — o worker atravessa locatários por uma função enumerável';
end $$;

-- ------------- caso 15: RN-F19, a projeção não soma CANCELADO nem BAIXADO
do $$
declare
  v_t uuid; v_emp uuid; v_cli uuid; v_forn uuid;
  v_ok uuid; v_canc uuid; v_baixado uuid;
  v_dia date := current_date + 40;
  v_ent numeric; v_sai numeric;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_emp  from _ctx where chave = 'empresa';
  select valor::uuid into v_cli  from _ctx where chave = 'cliente';
  select valor::uuid into v_forn from _ctx where chave = 'fornecedor';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  insert into public.titulo_receber
    (tenant_id, cliente_id, origem, descricao, valor_original,
     data_emissao, data_vencimento, status)
  values (v_t, v_cli, 'AVULSO', 'Cobrança viva', 1000, current_date, v_dia, 'APROVADO')
  returning id into v_ok;
  insert into public.titulo_receber
    (tenant_id, cliente_id, origem, descricao, valor_original,
     data_emissao, data_vencimento, status)
  values (v_t, v_cli, 'AVULSO', 'Cobrança cancelada', 5000, current_date, v_dia, 'CANCELADO')
  returning id into v_canc;
  /*
   * BAIXADO é o mais importante dos dois. Ele *parece* receita: o título está
   * encerrado, e um painel que soma "encerrados" fecha com ele. Mas nada entrou
   * na conta, e somá-lo numa projeção de caixa promete dinheiro que não vem.
   */
  insert into public.titulo_receber
    (tenant_id, cliente_id, origem, descricao, valor_original,
     data_emissao, data_vencimento, status)
  values (v_t, v_cli, 'AVULSO', 'Perda reconhecida', 8000, current_date, v_dia, 'BAIXADO')
  returning id into v_baixado;

  select entradas into v_ent
    from app.fluxo_caixa_projetado(v_dia, v_dia, null, null, null, null);
  if v_ent <> 1000 then
    raise exception 'FALHA: a projeção somou % em entradas, esperado 1000', v_ent;
  end if;

  -- E do lado da saída, o mesmo.
  insert into public.titulo_pagar
    (tenant_id, empresa_id, fornecedor_id, descricao, classificacao,
     valor_original, data_emissao, data_vencimento, status)
  values (v_t, v_emp, v_forn, 'Despesa viva', 'DESPESA_FIXA', 700, current_date, v_dia, 'APROVADO');
  insert into public.titulo_pagar
    (tenant_id, empresa_id, fornecedor_id, descricao, classificacao,
     valor_original, data_emissao, data_vencimento, status)
  values (v_t, v_emp, v_forn, 'Despesa cancelada', 'DESPESA_FIXA', 9000, current_date, v_dia, 'CANCELADO');

  select saidas into v_sai
    from app.fluxo_caixa_projetado(v_dia, v_dia, null, null, null, null);
  if v_sai <> 700 then
    raise exception 'FALHA: a projeção somou % em saídas, esperado 700', v_sai;
  end if;

  reset role;
  raise notice 'caso 15 OK — RN-F19: BAIXADO parece receita e não entra na projeção';
end $$;

-- ------------- caso 16: RN-F20, a inadimplência do cenário só reduz entradas
do $$
declare
  v_t uuid; v_pess uuid; v_dia date := current_date + 41;
  v_emp uuid; v_cli uuid; v_forn uuid;
  v_base record; v_est record; v_soma numeric;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_pess from _ctx where chave = 'cenario_pess';
  select valor::uuid into v_emp  from _ctx where chave = 'empresa';
  select valor::uuid into v_cli  from _ctx where chave = 'cliente';
  select valor::uuid into v_forn from _ctx where chave = 'fornecedor';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  insert into public.titulo_receber
    (tenant_id, cliente_id, origem, descricao, valor_original,
     data_emissao, data_vencimento, status)
  values (v_t, v_cli, 'AVULSO', 'Recebível do cenário', 1000, current_date, v_dia, 'APROVADO');
  insert into public.titulo_pagar
    (tenant_id, empresa_id, fornecedor_id, descricao, classificacao,
     valor_original, data_emissao, data_vencimento, status)
  values (v_t, v_emp, v_forn, 'Dívida do cenário', 'DESPESA_FIXA', 1000, current_date, v_dia, 'APROVADO');

  select * into v_base from app.fluxo_caixa_projetado(v_dia, v_dia, null, null, null, null);
  select * into v_est  from app.fluxo_caixa_projetado(v_dia, v_dia, v_pess, null, null, null);

  if v_base.entradas <> 1000 or v_base.saidas <> 1000 then
    raise exception 'FALHA: o cenário padrão não é neutro (% / %)', v_base.entradas, v_base.saidas;
  end if;
  if v_est.entradas <> 700 then
    raise exception 'FALHA: 30%% de inadimplência deu entrada de %', v_est.entradas;
  end if;
  /*
   * A saída **não** muda. Aplicar a inadimplência aos dois lados faria o cenário
   * pessimista deixar a operação mais otimista sobre a própria dívida — o
   * inverso de um teste de estresse, e um erro que passa porque o saldo do dia
   * continua parecendo razoável.
   */
  if v_est.saidas <> 1000 then
    raise exception 'FALHA: o cenário reduziu a saída para %', v_est.saidas;
  end if;

  -- E nenhum valor de título foi tocado: cenário é leitura.
  select sum(valor_original) into v_soma from public.titulo_pagar
   where tenant_id = v_t and data_vencimento = v_dia;
  if v_soma <> 1000 then
    raise exception 'FALHA: o cenário alterou valor de título a pagar (%)', v_soma;
  end if;

  reset role;
  raise notice 'caso 16 OK — RN-F20: o estresse não desconta a própria dívida';
end $$;

-- ------------- caso 17: a projeção parte do saldo real e acumula
do $$
declare
  v_t uuid; v_conta uuid; v_de date := current_date + 50; r record; v_saldo numeric;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_conta from _ctx where chave = 'conta';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  select app.saldo_conta(v_conta, v_de - 1) into v_saldo;

  -- Um lançamento futuro programado entra na projeção: é o que distingue "o que
  -- vai acontecer" de "o que já está lançado".
  perform _lf_pagar(400, v_de);
  perform _lf_receber(1000, v_de + 1);

  select * into r from app.fluxo_caixa_projetado(v_de, v_de, null, null, null, null);
  if r.saidas <> 400 then
    raise exception 'FALHA: o lançamento programado não entrou na saída (%)', r.saidas;
  end if;
  if r.saldo_acumulado <> v_saldo - 400 then
    raise exception 'FALHA: o acumulado partiu de % e não do saldo real %',
      r.saldo_acumulado + 400, v_saldo;
  end if;

  -- No dia seguinte o acumulado carrega o anterior.
  select saldo_acumulado into v_saldo
    from app.fluxo_caixa_projetado(v_de, v_de + 1, null, null, null, null)
   order by dia desc limit 1;
  if v_saldo <> (select app.saldo_conta(v_conta, v_de - 1)) - 400 + 1000 then
    raise exception 'FALHA: o acumulado do segundo dia é %', v_saldo;
  end if;

  reset role;
  raise notice 'caso 17 OK — a projeção parte do saldo real e acumula dia a dia';
end $$;

-- ------------- caso 18: o filtro de filial vale para título **e** para previsto
--
-- Sem `filial_id` no lançamento futuro, uma projeção de uma filial mostraria os
-- títulos daquela filial e os compromissos previstos de todas — e a soma
-- pareceria plausível, porque o número é maior, não menor.
do $$
declare
  v_t uuid; v_fil uuid; v_fil_b uuid; v_dia date := current_date + 55; r record;
begin
  select valor::uuid into v_t     from _ctx where chave = 'tenant';
  select valor::uuid into v_fil   from _ctx where chave = 'filial';
  select valor::uuid into v_fil_b from _ctx where chave = 'filial_b';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  perform _lf_pagar(600, v_dia, null, null, v_fil);
  perform _lf_pagar(900, v_dia, null, null, v_fil_b);

  select * into r from app.fluxo_caixa_projetado(v_dia, v_dia, null, null, v_fil, null);
  if r.saidas <> 600 then
    raise exception 'FALHA: a filial SP projetou % em saídas, esperado 600', r.saidas;
  end if;

  select * into r from app.fluxo_caixa_projetado(v_dia, v_dia, null, null, v_fil_b, null);
  if r.saidas <> 900 then
    raise exception 'FALHA: a filial RJ projetou % em saídas, esperado 900', r.saidas;
  end if;

  select * into r from app.fluxo_caixa_projetado(v_dia, v_dia, null, null, null, null);
  if r.saidas <> 1500 then
    raise exception 'FALHA: sem filtro a projeção deu %, esperado 1500', r.saidas;
  end if;

  reset role;
  raise notice 'caso 18 OK — o recorte de filial alcança o previsto, não só o lançado';
end $$;

-- ------------- caso 19: RN-F21 e RN-F22, os alertas
do $$
declare
  v_t uuid; v_emp uuid; v_forn uuid;
  v_de date := current_date + 300; v_dia date := current_date + 301;
  v_n integer; r record;
begin
  select valor::uuid into v_t    from _ctx where chave = 'tenant';
  select valor::uuid into v_emp  from _ctx where chave = 'empresa';
  select valor::uuid into v_forn from _ctx where chave = 'fornecedor';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);
  perform set_config('app.usuario_id',
                     (select valor from _ctx where chave = 'operador'), true);

  -- Uma janela limpa, e uma saída maior que o saldo da conta.
  select count(*) into v_n from app.alertas_caixa(v_de, v_de + 5);
  if v_n <> 0 then
    raise exception 'FALHA: janela sem movimento já tem % alerta(s)', v_n;
  end if;

  insert into public.titulo_pagar
    (tenant_id, empresa_id, fornecedor_id, descricao, classificacao,
     valor_original, data_emissao, data_vencimento, status)
  values (v_t, v_emp, v_forn, 'Saída que estoura o caixa', 'DESPESA_FIXA',
          900000, current_date, v_dia, 'APROVADO');

  if not exists (select 1 from app.alertas_caixa(v_de, v_de + 5)
                  where tipo = 'SALDO_NEGATIVO' and dia = v_dia) then
    raise exception 'FALHA: saldo negativo projetado não gerou alerta';
  end if;
  -- E segue negativo nos dias seguintes: o acumulado não se recupera sozinho.
  if (select count(*) from app.alertas_caixa(v_de, v_de + 5)
       where tipo = 'SALDO_NEGATIVO') <> 5 then
    raise exception 'FALHA: o alerta de saldo negativo não persiste no acumulado';
  end if;

  -- Concentração: uma saída sozinha é 100% da janela, acima do limiar de 40%.
  select * into r from app.alertas_caixa(v_de, v_de + 5)
   where tipo = 'CONCENTRACAO_SAIDA';
  if r is null then
    raise exception 'FALHA: 100%% das saídas num dia não gerou alerta de concentração';
  end if;
  if r.dia <> v_dia then
    raise exception 'FALHA: a concentração foi apontada em %', r.dia;
  end if;

  -- O limiar é cadastro, não constante: acima de 100% nada concentra.
  update public.parametro_cenario_caixa set limiar_concentracao = 100
   where tenant_id = v_t and padrao;
  if exists (select 1 from app.alertas_caixa(v_de, v_de + 5)
              where tipo = 'CONCENTRACAO_SAIDA') then
    raise exception 'FALHA: o limiar cadastrado não é respeitado';
  end if;
  update public.parametro_cenario_caixa set limiar_concentracao = 40
   where tenant_id = v_t and padrao;

  reset role;
  raise notice 'caso 19 OK — RN-F21/F22: os alertas saem da projeção e do cadastro';
end $$;

-- ------------- caso 20: um único cenário padrão por locatário
do $$
declare v_t uuid; v_erro text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  -- Dois padrões fariam o painel abrir diferente para duas pessoas no mesmo dia,
  -- pela ordem da consulta, sem que nada parecesse errado.
  begin
    update public.parametro_cenario_caixa set padrao = true
     where tenant_id = v_t and nome = 'Estresse';
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: o locatário ficou com dois cenários padrão';
  end if;

  v_erro := null;
  begin
    insert into public.parametro_cenario_caixa (tenant_id, nome) values (v_t, 'Base');
    exception when others then v_erro := sqlerrm;
  end;
  if v_erro is null then
    raise exception 'FALHA: dois cenários com o mesmo nome foram aceitos';
  end if;

  reset role;
  raise notice 'caso 20 OK — um padrão, e nomes únicos por locatário';
end $$;

-- ------------- caso 21: nenhuma posição diária gravada
--
-- Gravar a posição de cada dia seria dado derivado armazenado — a mesma classe de
-- defeito que `valor_devido`, `app.saldo_conta` e `app.receita_realizada` existem
-- para evitar. Aqui seria pior: a posição de amanhã muda a cada baixa de hoje.
do $$
declare v_n integer; v_col text;
begin
  select count(*) into v_n from information_schema.tables
   where table_schema = 'public'
     and (table_name like '%posicao%' or table_name like '%projecao%'
          or table_name like '%fluxo_caixa%' or table_name like '%saldo_dia%');
  if v_n <> 0 then
    raise exception 'FALHA: existe tabela de posição/projeção gravada';
  end if;

  select string_agg(table_name || '.' || column_name, ', ') into v_col
    from information_schema.columns
   where table_schema = 'public'
     and column_name in ('saldo_projetado', 'saldo_acumulado', 'entradas_previstas');
  if v_col is not null then
    raise exception 'FALHA: posição projetada gravada em %', v_col;
  end if;

  -- A projeção é função, e as três tabelas do módulo são as três declaradas.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'app' and p.proname = 'fluxo_caixa_projetado') then
    raise exception 'FALHA: app.fluxo_caixa_projetado não existe';
  end if;

  raise notice 'caso 21 OK — a projeção não é gravada em lugar nenhum';
end $$;

-- ------------- caso 22: isolamento por locatário, e nenhuma política de cliente
--
-- Planejamento de caixa da locadora não é assunto do locatário do equipamento:
-- uma leitura de cliente aqui exporia margem, concentração de vencimento e
-- previsão de despesa.
do $$
declare
  v_t uuid; v_outro uuid := gen_random_uuid(); v_emp uuid; v_n integer; t text;
begin
  select valor::uuid into v_t from _ctx where chave = 'tenant';

  insert into public.tenant (id, nome) values (v_outro, 'Locadora Vizinha');
  insert into public.empresa (tenant_id, razao_social, cnpj)
    values (v_outro, 'VIZINHA LTDA', '99888777000166') returning id into v_emp;
  insert into public.recorrencia
    (tenant_id, lado, descricao, valor_base, periodicidade, dia_vencimento,
     proxima_geracao, empresa_id, classificacao)
    values (v_outro, 'PAGAR', 'Aluguel da vizinha', 1, 'MENSAL', 1, current_date,
            v_emp, 'DESPESA_FIXA');
  insert into public.parametro_cenario_caixa (tenant_id, nome, padrao)
    values (v_outro, 'Base da vizinha', true);

  set local role iarx_app;
  perform set_config('app.tenant_id', v_t::text, true);

  if exists (select 1 from public.recorrencia where tenant_id = v_outro) then
    raise exception 'FALHA: a recorrência do vizinho é visível';
  end if;
  if exists (select 1 from public.parametro_cenario_caixa where tenant_id = v_outro) then
    raise exception 'FALHA: o cenário do vizinho é visível';
  end if;
  if exists (select 1 from public.lancamento_futuro where tenant_id = v_outro) then
    raise exception 'FALHA: o lançamento futuro do vizinho é visível';
  end if;

  reset role;

  -- Nenhuma das três tem política de cliente. `habilitar_rls_tenant` cria uma
  -- política só; uma segunda aqui seria a porta que este caso fecha.
  for t in select unnest(array['recorrencia', 'lancamento_futuro', 'parametro_cenario_caixa'])
  loop
    select count(*) into v_n from pg_policies
     where schemaname = 'public' and tablename = t and policyname like '%cliente%';
    if v_n <> 0 then
      raise exception 'FALHA: % tem política de cliente', t;
    end if;
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t
                      and c.relrowsecurity and c.relforcerowsecurity) then
      raise exception 'FALHA: % não tem RLS forçada', t;
    end if;
  end loop;

  raise notice 'caso 22 OK — isolado por locatário, e fechado para o cliente';
end $$;

-- ------------- caso 23: o débito da 0020 fechado — as duas FK de recorrência
do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_constraint
   where conname in ('titulo_pagar_recorrencia_id_fkey', 'titulo_receber_recorrencia_id_fkey')
     and contype = 'f'
     and confrelid = 'public.recorrencia'::regclass;
  if v_n <> 2 then
    raise exception 'FALHA: % de 2 chaves estrangeiras de recorrência nos títulos', v_n;
  end if;

  -- E o par do lançamento futuro é FK de verdade, não convenção por gatilho.
  if (select count(*) from pg_constraint
       where conrelid = 'public.lancamento_futuro'::regclass and contype = 'f'
         and confrelid in ('public.titulo_pagar'::regclass,
                           'public.titulo_receber'::regclass)) <> 2 then
    raise exception 'FALHA: o par de títulos não tem as duas FK reais';
  end if;

  raise notice 'caso 23 OK — o id polimórfico virou duas FK, e a 0020 fechou o débito';
end $$;

-- ------------- caso 24: auditoria nas duas tabelas que mudam de estado
do $$
declare t text;
begin
  for t in select unnest(array['recorrencia', 'lancamento_futuro'])
  loop
    if not exists (select 1 from pg_trigger
                    where tgrelid = ('public.' || t)::regclass
                      and tgname = t || '_audit' and not tgisinternal) then
      raise exception 'FALHA: % sem gatilho de auditoria', t;
    end if;
  end loop;
  raise notice 'caso 24 OK — quem muda de estado deixa rastro';
end $$;

rollback;

\echo '== 14_rnf_lancamentos_e_caixa: TODOS OS CASOS APROVADOS =='
