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
