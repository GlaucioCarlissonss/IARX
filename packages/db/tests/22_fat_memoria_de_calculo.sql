-- =============================================================================
-- TESTE FAT — memória de cálculo da cobrança contratual
--
-- A propriedade central, e a única que importa de verdade: **a memória soma o
-- total cobrado**. Uma memória que não fecha com o título é pior que memória
-- nenhuma — ela dá ao cliente um documento que contradiz a própria cobrança, e
-- a conversa deixa de ser sobre o valor e passa a ser sobre qual dos dois
-- números do fornecedor está errado.
--
-- É também por isso que `app.valor_contratual_competencia` passou a ser a soma
-- de `app.itens_contratuais_competencia` em vez de repetir a precificação:
-- duas implementações divergiriam, e a que diverge é sempre a que ninguém está
-- olhando.
-- =============================================================================
\set ON_ERROR_STOP on

select gen_random_uuid() as t1, gen_random_uuid() as emp, gen_random_uuid() as fil,
       gen_random_uuid() as cli, gen_random_uuid() as cat, gen_random_uuid() as fab,
       gen_random_uuid() as mod, gen_random_uuid() as eq1, gen_random_uuid() as eq2,
       gen_random_uuid() as ct, gen_random_uuid() as ci1, gen_random_uuid() as ci2,
       gen_random_uuid() as loc, gen_random_uuid() as tp, gen_random_uuid() as u1
\gset

-- ---------------------------------------------------------------- massa
insert into public.tenant (id, nome) values (:'t1', 'Locadora FAT');
insert into public.empresa (id, tenant_id, razao_social) values (:'emp', :'t1', 'FAT LTDA');
insert into public.filial (id, tenant_id, empresa_id, codigo, nome)
  values (:'fil', :'t1', :'emp', 'FAT-01', 'Base FAT');
insert into public.usuario (id, tenant_id, nome, email)
  values (:'u1', :'t1', 'Faturista', 'fat@fat.local');
insert into public.cliente (id, tenant_id, documento, razao_social)
  values (:'cli', :'t1', '66000000000166', 'Cliente FAT');
insert into public.local_operacao (id, tenant_id, cliente_id, nome)
  values (:'loc', :'t1', :'cli', 'Matriz FAT');
-- `tipo_medidor_padrao` não é detalhe de cadastro: categoria sem medidor não
-- aceita franquia nem excedente, e o banco recusa a tabela de franquia que
-- tentar cobrar página de algo que não conta página.
insert into public.categoria_equipamento (id, tenant_id, codigo, nome, tipo_medidor_padrao)
  values (:'cat', :'t1', 'MFP', 'Multifuncional', 'CONTADOR');
insert into public.fabricante (id, tenant_id, nome) values (:'fab', :'t1', 'Fabricante FAT');
insert into public.modelo (id, tenant_id, fabricante_id, categoria_id, codigo, nome)
  values (:'mod', :'t1', :'fab', :'cat', 'F-1', 'Modelo FAT');
insert into public.equipamento (id, tenant_id, patrimonio, modelo_id, categoria_id, filial_id) values
  (:'eq1', :'t1', 'FAT-0001', :'mod', :'cat', :'fil'),
  (:'eq2', :'t1', 'FAT-0002', :'mod', :'cat', :'fil');

insert into public.contrato (id, tenant_id, numero, empresa_id, filial_id, cliente_id,
                             status, data_inicio, data_fim)
  values (:'ct', :'t1', 'FAT-2029-001', :'emp', :'fil', :'cli', 'ATIVO', '2029-01-01', '2029-12-31');

insert into public.contrato_item
  (id, tenant_id, contrato_id, equipamento_id, local_operacao_id, modalidade_cobranca,
   valor_unitario, vigencia_inicio, status) values
  (:'ci1', :'t1', :'ct', :'eq1', :'loc', 'FIXO_MENSAL', 300.0000, '2029-01-01', 'ATIVO'),
  (:'ci2', :'t1', :'ct', :'eq2', :'loc', 'FIXO_MENSAL', 200.0000, '2029-01-01', 'ATIVO');

-- O preço da página excedente mora no **item de contrato**, não na tabela de
-- franquia: é o que o gatilho `cc_calcula_excedente` lê. A primeira versão
-- deste teste semeou uma tabela de franquia e o excedente saiu zero — o que
-- estava certo, e era o teste que olhava para o lugar errado.
update public.contrato_item set valor_excedente_unitario = 0.100000 where id = :'ci1';

-- Tabela de preço vigente: sem ela o item entra como `preco_ausente` e o
-- fechamento marca exceção em vez de cobrar.
-- Rascunho, itens, e só então ativação — nesta ordem, e não por estilo: item
-- de tabela ativa é imutável. É a regra que impede reprecificar um mês já
-- faturado editando a tabela que o originou.
insert into public.tabela_preco (id, tenant_id, nome, vigencia_inicio, status, abrangencia)
  values (:'tp', :'t1', 'Padrão FAT', '2029-01-01', 'RASCUNHO', 'GERAL');
insert into public.tabela_preco_item (tenant_id, tabela_preco_id, modelo_id, valor_mensal)
  values (:'t1', :'tp', :'mod', 300.0000);
-- `ativada_em` é obrigatório quando ATIVA: tabela ativa sem marca de ativação
-- não diz desde quando vale.
update public.tabela_preco set status = 'ATIVA', ativada_em = now() where id = :'tp';

-- Consumo: o primeiro equipamento estourou a franquia, o segundo não.
insert into public.consumo_competencia
  (tenant_id, competencia, equipamento_id, contrato_item_id, cliente_id, local_operacao_id,
   leitura_inicial_mono, leitura_final_mono, franquia_mono) values
  (:'t1', '2029-01', :'eq1', :'ci1', :'cli', :'loc', 0, 1500, 1000),
  (:'t1', '2029-01', :'eq2', :'ci2', :'cli', :'loc', 0,  800, 1000);

set role iarx_app;

-- ---------------------------------------------------------------- caso 1: itens somam o agregado
begin;
  set local app.tenant_id = :'t1';
  set local app.teste_ct = :'ct';

  do $$
  declare
    v_soma_mensal numeric; v_soma_exc numeric; v_soma_desc numeric;
    v_ag_mensal numeric;   v_ag_exc numeric;   v_ag_desc numeric;
  begin
    select sum(valor_mensal), sum(valor_excedente), sum(desconto)
      into v_soma_mensal, v_soma_exc, v_soma_desc
      from app.itens_contratuais_competencia(current_setting('app.teste_ct')::uuid, '2029-01');

    select valor_mensal, valor_excedente, desconto
      into v_ag_mensal, v_ag_exc, v_ag_desc
      from app.valor_contratual_competencia(current_setting('app.teste_ct')::uuid, '2029-01');

    if v_soma_mensal is distinct from v_ag_mensal
       or v_soma_exc is distinct from v_ag_exc
       or v_soma_desc is distinct from v_ag_desc then
      raise exception 'FALHA: itens (% / % / %) não somam o agregado (% / % / %)',
        v_soma_mensal, v_soma_exc, v_soma_desc, v_ag_mensal, v_ag_exc, v_ag_desc;
    end if;

    -- Uma única implementação da precificação: a agregada é a soma da de item.
    raise notice 'caso 1 OK — itens somam exatamente o agregado';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 2: fechamento grava a memória
begin;
  set local app.tenant_id = :'t1';
  set local app.usuario_id = :'u1';

  do $$
  declare v_titulo uuid; v_itens integer; v_total numeric; v_soma numeric;
  begin
    perform app.fechar_competencia('2029-01');

    select id, valor_original - desconto into v_titulo, v_total
      from public.titulo_receber
     where competencia = '2029-01' and origem = 'CONTRATUAL'
     limit 1;

    if v_titulo is null then
      raise exception 'FALHA: fechamento não gerou título contratual';
    end if;

    select count(*), coalesce(sum(valor_liquido), 0)
      into v_itens, v_soma
      from public.titulo_receber_item where titulo_id = v_titulo;

    if v_itens <> 2 then
      raise exception 'FALHA: esperados 2 itens na memória, vieram %', v_itens;
    end if;

    /*
     * A propriedade central. Memória que não fecha com o título dá ao cliente
     * um documento que contradiz a própria cobrança, e a conversa deixa de ser
     * sobre o valor para virar sobre qual dos dois números do fornecedor está
     * errado.
     */
    if round(v_soma, 4) <> round(v_total, 4) then
      raise exception 'FALHA: memória soma % e o título cobra %', v_soma, v_total;
    end if;

    raise notice 'caso 2 OK — a memória soma exatamente o valor cobrado (%)', v_total;
  end $$;
commit;

-- ---------------------------------------------------------------- caso 3: a memória diz qual máquina
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_desc text; v_exc numeric;
  begin
    select tri.descricao into v_desc
      from public.titulo_receber_item tri
      join public.titulo_receber t on t.id = tri.titulo_id
     where t.competencia = '2029-01' and tri.equipamento_id is not null
     limit 1;

    -- Patrimônio, não uuid: é o texto que o cliente lê ao contestar.
    if v_desc not like '%FAT-000%' then
      raise exception 'FALHA: descrição sem patrimônio: %', v_desc;
    end if;

    -- E o excedente aparece separado da mensalidade, que é a pergunta que o
    -- cliente faz primeiro: "paguei a mais por quê".
    select tri.valor_excedente into v_exc
      from public.titulo_receber_item tri
      join public.titulo_receber t on t.id = tri.titulo_id
     where t.competencia = '2029-01' and tri.valor_excedente > 0
     limit 1;

    if coalesce(v_exc, 0) <= 0 then
      raise exception 'FALHA: o excedente não foi registrado na memória';
    end if;

    raise notice 'caso 3 OK — a memória nomeia a máquina e separa o excedente';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 4: líquido é derivado
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_erro text := null;
  begin
    begin
      update public.titulo_receber_item set valor_liquido = 1
       where id = (select id from public.titulo_receber_item limit 1);
    exception when others then v_erro := sqlerrm;
    end;

    if v_erro is null then
      raise exception 'FALHA: valor_liquido aceitou escrita direta';
    end if;
    -- Item cujo líquido não bate com as parcelas é precisamente o número que a
    -- memória de cálculo existe para impedir.
    raise notice 'caso 4 OK — valor_liquido é derivado e não aceita escrita';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 5: RN-023
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_id uuid; v_titulo uuid; v_erro text := null;
  begin
    select tri.id, tri.titulo_id into v_id, v_titulo
      from public.titulo_receber_item tri limit 1;

    -- Enquanto espera aprovação, a memória ainda pode ser refeita: é
    -- justamente o período em que alguém está conferindo.
    update public.titulo_receber_item set paginas_mono = paginas_mono where id = v_id;

    update public.titulo_receber set status = 'APROVADO' where id = v_titulo;

    begin
      update public.titulo_receber_item set paginas_mono = 999 where id = v_id;
    exception when others then v_erro := sqlerrm;
    end;

    if v_erro is null then
      raise exception 'FALHA RN-023: memória alterada depois de aprovado';
    end if;

    -- Memória que muda depois da cobrança enviada deixa de ser memória: o
    -- cliente contesta o número que recebeu, não o que o sistema passou a
    -- mostrar.
    raise notice 'caso 5 OK — memória imutável depois de aprovado';
  end $$;
commit;

-- ---------------------------------------------------------------- caso 6: isolamento
begin;
  set local app.tenant_id = :'t1';

  do $$
  declare v_n integer;
  begin
    select count(*) into v_n from public.titulo_receber_item;
    if v_n = 0 then
      raise exception 'FALHA: o próprio locatário não enxerga a memória';
    end if;
    raise notice 'caso 6 OK — % linha(s) de memória visíveis no locatário', v_n;
  end $$;
commit;

reset role;

-- ---------------------------------------------------------------- limpeza
-- O gatilho de imutabilidade recusa o `delete`, e está certo: é a regra que o
-- caso 5 acabou de provar. A limpeza o desliga como superusuário pelo tempo de
-- remover a massa. O que **não** se faz é abrir uma exceção no gatilho para
-- "limpeza" — condição dessas em produção é a porta pela qual a imutabilidade
-- deixa de valer, e quem a usar não vai se chamar de teste.
alter table public.titulo_receber_item disable trigger titulo_item_imutavel;
delete from public.titulo_receber_item where tenant_id = :'t1';
alter table public.titulo_receber_item enable trigger titulo_item_imutavel;
delete from public.titulo_receber_aprovacao where tenant_id = :'t1';
delete from public.titulo_receber     where tenant_id = :'t1';
-- Terceira guarda que a limpeza precisa contornar, e pelo mesmo motivo das
-- outras duas: competência selada não se apaga. Vale registrar o padrão —
-- quando a remoção da massa exige desligar três gatilhos, é sinal de que as
-- invariantes estão onde deveriam estar.
alter table public.consumo_competencia disable trigger cc_competencia_imutavel;
delete from public.consumo_competencia where tenant_id = :'t1';
alter table public.consumo_competencia enable trigger cc_competencia_imutavel;
-- Quarta: item de tabela ativa é imutável. Desativar antes de remover é o
-- caminho que o próprio modelo oferece — e é mais honesto que desligar mais um
-- gatilho, porque descreve o que de fato aconteceria em produção.
update public.tabela_preco set status = 'INATIVA', vigencia_fim = '2029-12-31' where tenant_id = :'t1';
delete from public.tabela_preco_item  where tenant_id = :'t1';
delete from public.tabela_preco       where tenant_id = :'t1';
delete from public.contrato_item      where tenant_id = :'t1';
delete from public.contrato           where tenant_id = :'t1';
delete from public.equipamento        where tenant_id = :'t1';
delete from public.modelo             where tenant_id = :'t1';
delete from public.fabricante         where tenant_id = :'t1';
delete from public.categoria_equipamento where tenant_id = :'t1';
delete from public.local_operacao     where tenant_id = :'t1';
delete from public.audit_log          where tenant_id = :'t1';
delete from public.cliente            where tenant_id = :'t1';
delete from public.usuario            where tenant_id = :'t1';
delete from public.filial             where tenant_id = :'t1';
delete from public.empresa            where tenant_id = :'t1';
delete from public.perfil             where tenant_id = :'t1';
delete from public.categoria_despesa  where tenant_id = :'t1';
delete from public.tenant             where id = :'t1';

\echo '== 22_fat_memoria_de_calculo: TODOS OS CASOS APROVADOS =='
