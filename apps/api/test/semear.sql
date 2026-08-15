-- =============================================================================
-- Massa determinística para os testes de integração da API.
--
-- Identificadores fixos, e não gerados: o teste em Node precisa referenciá-los
-- sem antes consultar o banco, e um id estável torna a falha legível ("o
-- patrimônio 10422 devia conflitar") em vez de um uuid anônimo.
--
-- Executada como superusuário, portanto sem RLS. É o único ponto do fluxo de
-- teste em que isso acontece: tudo que a API faz depois passa por `iarx_app`,
-- sujeito às políticas.
-- =============================================================================
\set ON_ERROR_STOP on

-- Dois tenants. O segundo existe só para provar isolamento — se um único teste
-- de vazamento não tiver um "outro lado", ele não prova nada.
insert into public.tenant (id, nome) values
  ('11111111-1111-4111-8111-111111111111', 'Locadora Alfa'),
  ('22222222-2222-4222-8222-222222222222', 'Locadora Beta');

insert into public.empresa (id, tenant_id, razao_social, cnpj) values
  ('11111111-1111-4111-8111-1111111111e1', '11111111-1111-4111-8111-111111111111', 'ALFA LOCACOES LTDA', '11222333000181'),
  ('22222222-2222-4222-8222-2222222222e1', '22222222-2222-4222-8222-222222222222', 'BETA LOCACOES LTDA', '44555666000172');

insert into public.filial (id, tenant_id, empresa_id, codigo, nome, regiao) values
  ('11111111-1111-4111-8111-1111111111f1', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-1111111111e1', 'SP-01', 'Base São Paulo', 'Sudeste'),
  ('22222222-2222-4222-8222-2222222222f1', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-2222222222e1', 'RJ-01', 'Base Rio', 'Sudeste');

insert into public.categoria_equipamento (id, tenant_id, codigo, nome, tipo_medidor_padrao) values
  ('11111111-1111-4111-8111-1111111111c1', '11111111-1111-4111-8111-111111111111', 'MULTI-A4', 'Multifuncional A4 mono', 'CONTADOR'),
  ('22222222-2222-4222-8222-2222222222c1', '22222222-2222-4222-8222-222222222222', 'MULTI-A4', 'Multifuncional A4 mono', 'CONTADOR');

insert into public.fabricante (id, tenant_id, nome) values
  ('11111111-1111-4111-8111-1111111111b1', '11111111-1111-4111-8111-111111111111', 'Kyocera'),
  ('22222222-2222-4222-8222-2222222222b1', '22222222-2222-4222-8222-222222222222', 'Kyocera');

insert into public.modelo (id, tenant_id, fabricante_id, categoria_id, codigo, nome, preco_tabela_mensal) values
  ('11111111-1111-4111-8111-1111111111d1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-1111111111b1', '11111111-1111-4111-8111-1111111111c1',
   'ECOSYS-M3145', 'ECOSYS M3145idn', 289.0000),
  ('22222222-2222-4222-8222-2222222222d1', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-2222222222b1', '22222222-2222-4222-8222-2222222222c1',
   'ECOSYS-M3145', 'ECOSYS M3145idn', 289.0000);

-- created_at explícito e escalonado: a paginação por keyset ordena por
-- (created_at, id), e com todos no mesmo instante o teste de cursor não
-- distinguiria ordem estável de coincidência.
insert into public.equipamento
  (id, tenant_id, patrimonio, numero_serie, modelo_id, categoria_id, filial_id, status, created_at) values
  ('11111111-1111-4111-8111-11111111a001', '11111111-1111-4111-8111-111111111111', '10422', 'KYO-A-0001',
   '11111111-1111-4111-8111-1111111111d1', '11111111-1111-4111-8111-1111111111c1', '11111111-1111-4111-8111-1111111111f1',
   'LOCADO', '2026-01-05T10:00:00-03:00'),
  ('11111111-1111-4111-8111-11111111a002', '11111111-1111-4111-8111-111111111111', '10423', 'KYO-A-0002',
   '11111111-1111-4111-8111-1111111111d1', '11111111-1111-4111-8111-1111111111c1', '11111111-1111-4111-8111-1111111111f1',
   'DISPONIVEL', '2026-01-06T10:00:00-03:00'),
  ('11111111-1111-4111-8111-11111111a003', '11111111-1111-4111-8111-111111111111', '10424', 'KYO-A-0003',
   '11111111-1111-4111-8111-1111111111d1', '11111111-1111-4111-8111-1111111111c1', '11111111-1111-4111-8111-1111111111f1',
   'DISPONIVEL', '2026-01-07T10:00:00-03:00'),
  -- Do tenant B: nunca deve aparecer para o tenant A, em nenhuma rota.
  ('22222222-2222-4222-8222-22222222a001', '22222222-2222-4222-8222-222222222222', '90001', 'KYO-B-0001',
   '22222222-2222-4222-8222-2222222222d1', '22222222-2222-4222-8222-2222222222c1', '22222222-2222-4222-8222-2222222222f1',
   'DISPONIVEL', '2026-01-08T10:00:00-03:00');

insert into public.cliente (id, tenant_id, documento, razao_social, nome_fantasia, situacao_credito) values
  ('11111111-1111-4111-8111-11111111c101', '11111111-1111-4111-8111-111111111111', '19226193000163',
   'CONSTRUTORA ALFA LTDA', 'Construtora Alfa', 'LIBERADO'),
  ('11111111-1111-4111-8111-11111111c102', '11111111-1111-4111-8111-111111111111', '32677654000159',
   'DISTRIBUIDORA GAMA LTDA', 'Distribuidora Gama', 'BLOQUEADO'),
  ('22222222-2222-4222-8222-22222222c101', '22222222-2222-4222-8222-222222222222', '55118472000110',
   'BETA CLIENTE LTDA', 'Beta Cliente', 'LIBERADO');

-- Locais de operação. O segundo nasce **sem coordenada** de propósito: é o
-- caso que o mapa existe para resolver — o cliente cadastrado que não aparece,
-- e portanto não entra em roteiro de técnico.
insert into public.local_operacao (id, tenant_id, cliente_id, nome, created_at) values
  ('11111111-1111-4111-8111-11111111b101', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-11111111c101', 'Matriz Alfa', '2026-01-02T09:00:00-03:00'),
  ('11111111-1111-4111-8111-11111111b102', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-11111111c102', 'Centro de Distribuição Gama', '2026-01-03T09:00:00-03:00'),
  ('22222222-2222-4222-8222-22222222b101', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-22222222c101', 'Sede Beta', '2026-01-04T09:00:00-03:00');

insert into public.contrato
  (id, tenant_id, numero, empresa_id, filial_id, cliente_id, status, data_inicio, data_fim, created_at) values
  ('11111111-1111-4111-8111-1111111170a1', '11111111-1111-4111-8111-111111111111', 'SP-2026-0148',
   '11111111-1111-4111-8111-1111111111e1', '11111111-1111-4111-8111-1111111111f1', '11111111-1111-4111-8111-11111111c101',
   'ATIVO', '2026-01-01', '2026-12-31', '2026-01-02T09:00:00-03:00'),
  ('11111111-1111-4111-8111-1111111170a2', '11111111-1111-4111-8111-111111111111', 'SP-2026-0201',
   '11111111-1111-4111-8111-1111111111e1', '11111111-1111-4111-8111-1111111111f1', '11111111-1111-4111-8111-11111111c101',
   'ATIVO', '2026-01-01', '2027-12-31', '2026-01-03T09:00:00-03:00'),
  -- Contrato de cliente bloqueado, para o caminho CREDITO_BLOQUEADO.
  ('11111111-1111-4111-8111-1111111170a3', '11111111-1111-4111-8111-111111111111', 'SP-2026-0300',
   '11111111-1111-4111-8111-1111111111e1', '11111111-1111-4111-8111-1111111111f1', '11111111-1111-4111-8111-11111111c102',
   'ATIVO', '2026-01-01', '2027-12-31', '2026-01-04T09:00:00-03:00'),
  -- Encerrado: não aceita alocação.
  ('11111111-1111-4111-8111-1111111170a4', '11111111-1111-4111-8111-111111111111', 'SP-2025-0090',
   '11111111-1111-4111-8111-1111111111e1', '11111111-1111-4111-8111-1111111111f1', '11111111-1111-4111-8111-11111111c101',
   'ENCERRADO', '2025-01-01', '2025-12-31', '2025-01-01T09:00:00-03:00'),
  ('22222222-2222-4222-8222-2222222270a1', '22222222-2222-4222-8222-222222222222', 'RJ-2026-0001',
   '22222222-2222-4222-8222-2222222222e1', '22222222-2222-4222-8222-2222222222f1', '22222222-2222-4222-8222-22222222c101',
   'ATIVO', '2026-01-01', '2026-12-31', '2026-01-05T09:00:00-03:00');

-- O patrimônio 10422 está ocupado até 31/12/2026 no contrato SP-2026-0148.
-- É este item que a exclusion constraint vai usar para recusar a alocação
-- concorrente no teste de RN-001.
insert into public.contrato_item
  (tenant_id, contrato_id, equipamento_id, modalidade_cobranca, valor_unitario,
   franquia_quantidade, franquia_escopo, valor_excedente_unitario,
   vigencia_inicio, vigencia_fim, status) values
  ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-1111111170a1',
   '11111111-1111-4111-8111-11111111a001', 'FRANQUIA_EXCEDENTE', 289.0000,
   3000, 'ITEM', 0.0800,
   '2026-01-01T00:00:00-03:00', '2026-12-31T23:59:59-03:00', 'ATIVO');

-- -----------------------------------------------------------------------------
-- Entrada fiscal de compra (Módulo 1)
--
-- Um fornecedor por tenant. O CNPJ do fornecedor de Alfa é o mesmo que entra na
-- chave de acesso montada pelo teste — a coerência entre os dois é justamente
-- o que RN-L10 verifica, e um CNPJ divergente aqui faria todo lançamento com
-- chave ser recusado sem que isso significasse defeito.
-- -----------------------------------------------------------------------------
-- Os usuários existem porque `conferida_por`, `integrada_por` e `cancelada_por`
-- são chaves estrangeiras: sem eles, a conferência falharia por FK e o teste
-- acusaria um defeito que não existe.
insert into public.usuario (id, tenant_id, nome, email) values
  ('11111111-1111-4111-8111-111111110001', '11111111-1111-4111-8111-111111111111',
   'Operador Alfa', 'operador@alfa.local'),
  ('11111111-1111-4111-8111-111111110002', '11111111-1111-4111-8111-111111111111',
   'Comprador Alfa', 'compras@alfa.local'),
  ('22222222-2222-4222-8222-222222220001', '22222222-2222-4222-8222-222222222222',
   'Operador Beta', 'operador@beta.local');

insert into public.fornecedor (id, tenant_id, documento, razao_social, nome_fantasia, uf) values
  ('11111111-1111-4111-8111-11111111f001', '11111111-1111-4111-8111-111111111111',
   '11444777000161', 'PRINTECH DISTRIBUICAO LTDA', 'Printech', 'SP'),
  ('22222222-2222-4222-8222-22222222f001', '22222222-2222-4222-8222-222222222222',
   '99888777000166', 'BETA SUPRIMENTOS LTDA', 'Beta Sup', 'RJ');

-- Nota conferida e pronta para integrar: dois itens, frete e IPI que não
-- dividem igualmente pelas unidades. É o caso em que o rateio ingênuo perde
-- centavo, e é o que o teste de RN-L05 precisa ter para provar alguma coisa.
--
--   vProd 30.000,00 + frete 1.000,00 + IPI 500,00 − desconto 100,00 = 31.400,00
--   ICMS 5.400,00 destacado, não recuperável → custo = total
insert into public.nota_fiscal_compra
  (id, tenant_id, fornecedor_id, filial_destino_id, numero, serie, modelo_documento,
   data_emissao, data_entrada, valor_produtos, valor_frete, valor_desconto, valor_ipi,
   valor_icms, valor_total, status, conferida_em, origem_dados, created_by, created_at) values
  ('11111111-1111-4111-8111-11111111e001', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-11111111f001', '11111111-1111-4111-8111-1111111111f1',
   '12345', '1', '55', '2026-05-10', '2026-05-12',
   30000, 1000, 100, 500, 5400, 31400,
   'PENDENTE_CONFERENCIA', null, 'MANUAL',
   -- Lançada por OUTRO usuário: a segregação de funções (RN-027) recusaria a
   -- conferência se fosse o mesmo, e o teste do caminho feliz não passaria.
   '11111111-1111-4111-8111-111111110002', '2026-05-12T09:00:00-03:00');

insert into public.nota_fiscal_item
  (id, tenant_id, nota_fiscal_id, numero_item, modelo_id, descricao_nf, ncm, cfop,
   quantidade, valor_unitario, valor_total_item, garantia_meses) values
  ('11111111-1111-4111-8111-11111111e101', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-11111111e001', 1, '11111111-1111-4111-8111-1111111111d1',
   'MULTIFUNC LASER MONO A4 45PPM ECOSYS M3145IDN', '84433221', '5551',
   3, 6000, 18000, 24),
  ('11111111-1111-4111-8111-11111111e102', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-11111111e001', 2, '11111111-1111-4111-8111-1111111111d1',
   'MULTIFUNC LASER MONO A4 45PPM ECOSYS M3145IDN (LOTE 2)', '84433221', '5551',
   2, 6000, 12000, 12);

-- Só o item 1 identificado: a nota está incompleta de propósito, para o teste
-- provar que RN-L02 recusa a conferência e nomeia o item que falta.
insert into public.nota_fiscal_item_serie
  (id, tenant_id, nota_fiscal_item_id, numero_serie, patrimonio) values
  ('11111111-1111-4111-8111-11111111e201', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-11111111e101', 'W7A1000001', 'PAT-90001'),
  ('11111111-1111-4111-8111-11111111e202', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-11111111e101', 'W7A1000002', 'PAT-90002'),
  ('11111111-1111-4111-8111-11111111e203', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-11111111e101', 'W7A1000003', 'PAT-90003');

-- Nota do tenant B, para o teste de isolamento ter um outro lado.
insert into public.nota_fiscal_compra
  (id, tenant_id, fornecedor_id, filial_destino_id, numero, serie, modelo_documento,
   data_emissao, data_entrada, valor_produtos, valor_total, status, origem_dados) values
  ('22222222-2222-4222-8222-22222222e001', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-22222222f001', '22222222-2222-4222-8222-2222222222f1',
   '77777', '1', '55', '2026-05-10', '2026-05-12', 1000, 1000, 'PENDENTE_CONFERENCIA', 'MANUAL');
