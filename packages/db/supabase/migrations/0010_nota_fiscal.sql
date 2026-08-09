-- =============================================================================
-- 0010 — Entrada de nota fiscal de compra e origem do ativo
--
-- Referências: docs/anexos/L-lacunas-funcionais.md (Módulo 1)
--              docs/anexos/M-decisoes-mercado-brasileiro.md (M.2)
-- Invariantes: RN-L01 (nota integrada é imutável), RN-L02 (séries antes da
--              conferência), RN-L04 (patrimônio e série únicos no tenant),
--              RN-L10 (chave de acesso íntegra e coerente com o cabeçalho)
--
-- Inversão que este módulo introduz: **o ativo nasce da nota**. Hoje
-- `equipamento.valor_aquisicao` é digitado e `equipamento.nota_fiscal` é texto
-- livre — duas unidades da mesma compra podem ficar com valores diferentes sem
-- que nada detecte. Depois desta migração o valor de aquisição, a data de
-- início da depreciação e o prazo de garantia têm origem única e rastreável.
--
-- Correção ao Anexo L: a tabela `fornecedor` estava listada como "existe". Não
-- existia — fornecedor era apenas um texto solto na massa de peças. Ela é
-- criada aqui, porque a nota não pode referenciar um fornecedor por nome.
-- =============================================================================

do $$ begin
  create type app.nf_status as enum (
    'PENDENTE_CONFERENCIA',
    'CONFERIDA',
    'INTEGRADA',
    'CANCELADA'
  );
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- fornecedor
-- -----------------------------------------------------------------------------
create table if not exists public.fornecedor (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,
  tipo_pessoa   char(2) not null default 'PJ',
  documento     text not null,                 -- CNPJ/CPF apenas dígitos
  razao_social  text not null,
  nome_fantasia text,
  inscricao_estadual text,
  uf            char(2),
  contato       jsonb not null default '{}'::jsonb,
  ativo         boolean not null default true,
  version       integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  constraint fornecedor_tipo_pessoa_valido check (tipo_pessoa in ('PF','PJ')),
  -- Só dígitos: a chave de acesso da NF-e carrega o CNPJ sem máscara, e a
  -- conferência entre os dois (RN-L10) exige o mesmo formato dos dois lados.
  constraint fornecedor_documento_digitos check (
    (tipo_pessoa = 'PJ' and documento ~ '^[0-9]{14}$')
    or (tipo_pessoa = 'PF' and documento ~ '^[0-9]{11}$')
  )
);
create unique index if not exists fornecedor_documento_uk
  on public.fornecedor (tenant_id, documento) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Dígito verificador da chave de acesso da NF-e
--
-- 44 dígitos: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1)
--             cNF(8) cDV(1)
-- O DV é módulo 11 com pesos 2..9 cíclicos, da direita para a esquerda sobre os
-- 43 primeiros dígitos. Validá-lo recusa chave digitada errada *antes* de a nota
-- entrar — que é o único momento em que o erro ainda é barato.
-- -----------------------------------------------------------------------------
create or replace function app.dv_chave_nfe(p_chave43 text)
returns integer
language plpgsql
immutable
as $$
declare
  v_soma integer := 0;
  v_peso integer := 2;
  v_i    integer;
  v_resto integer;
begin
  if p_chave43 is null or p_chave43 !~ '^[0-9]{43}$' then
    return null;
  end if;

  for v_i in reverse 43..1 loop
    v_soma := v_soma + substr(p_chave43, v_i, 1)::integer * v_peso;
    v_peso := case when v_peso = 9 then 2 else v_peso + 1 end;
  end loop;

  v_resto := v_soma % 11;
  return case when v_resto < 2 then 0 else 11 - v_resto end;
end;
$$;

create or replace function app.chave_nfe_valida(p_chave text)
returns boolean
language sql
immutable
as $$
  select p_chave ~ '^[0-9]{44}$'
     and app.dv_chave_nfe(substr(p_chave, 1, 43)) = substr(p_chave, 44, 1)::integer;
$$;

comment on function app.chave_nfe_valida(text) is
  'Verifica os 44 dígitos e o DV módulo 11 da chave de acesso da NF-e (M.2, D-03).';

-- -----------------------------------------------------------------------------
-- nota_fiscal_compra
--
-- Composição de valores conforme layout 4.00 da NF-e (grupo total/ICMSTot):
--   vNF = vProd + vST + vFrete + vSeg + vOutro + vIPI − vDesc
--
-- Custo de aquisição do imobilizado (CPC 27 item 16 · Lei 6.404/76 art. 183, I):
-- o total da nota menos os tributos *recuperáveis*. ICMS é imposto por dentro —
-- já está em vProd —, então recuperá-lo subtrai; IPI vem por fora e só é custo
-- quando não recuperável. Locação de bem móvel não é fato gerador de ICMS
-- (Súmula 573 do STF): o padrão de locadora pura é `false` nos dois.
--
-- O regime fica gravado **na nota**, não só em parâmetro do tenant: mudança de
-- regime não pode reprecificar aquisição já feita.
-- -----------------------------------------------------------------------------
create table if not exists public.nota_fiscal_compra (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete restrict,
  fornecedor_id     uuid not null references public.fornecedor(id) on delete restrict,
  filial_destino_id uuid not null references public.filial(id) on delete restrict,

  numero            text not null,
  serie             text not null,
  chave_acesso      char(44),
  modelo_documento  text not null default '55',
  data_emissao      date not null,
  data_entrada      date not null,

  valor_produtos        numeric(15,4) not null,
  valor_frete           numeric(15,4) not null default 0,
  valor_seguro          numeric(15,4) not null default 0,
  valor_outras_despesas numeric(15,4) not null default 0,
  valor_desconto        numeric(15,4) not null default 0,
  valor_ipi             numeric(15,4) not null default 0,
  valor_icms            numeric(15,4) not null default 0,
  valor_icms_st         numeric(15,4) not null default 0,
  valor_total           numeric(15,4) not null,

  icms_recuperavel  boolean not null default false,
  ipi_recuperavel   boolean not null default false,

  -- Coluna gerada: nenhuma escrita pode divergir da fórmula, e o relatório de
  -- imobilizado lê o mesmo número que a integração usou para ratear.
  custo_aquisicao   numeric(15,4)
    generated always as (
      valor_total
      - case when icms_recuperavel then valor_icms else 0 end
      - case when ipi_recuperavel  then valor_ipi  else 0 end
    ) stored,

  status            app.nf_status not null default 'PENDENTE_CONFERENCIA',
  observacao        text,
  origem_dados      text not null default 'MANUAL',   -- MANUAL | XML
  xml_anexo_id      uuid,
  conferida_em      timestamptz,
  conferida_por     uuid references public.usuario(id) on delete set null,
  integrada_em      timestamptz,
  integrada_por     uuid references public.usuario(id) on delete set null,
  cancelada_em      timestamptz,
  cancelada_por     uuid references public.usuario(id) on delete set null,
  motivo_cancelamento text,

  version           integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,

  constraint nfc_entrada_apos_emissao check (data_entrada >= data_emissao),
  constraint nfc_valores_nao_negativos check (
    valor_produtos >= 0 and valor_frete >= 0 and valor_seguro >= 0
    and valor_outras_despesas >= 0 and valor_desconto >= 0
    and valor_ipi >= 0 and valor_icms >= 0 and valor_icms_st >= 0 and valor_total >= 0
  ),
  -- vNF do layout 4.00. ICMS não entra: é imposto por dentro de vProd.
  constraint nfc_total_fecha check (
    valor_total = valor_produtos + valor_icms_st + valor_frete + valor_seguro
                  + valor_outras_despesas + valor_ipi - valor_desconto
  ),
  -- O ICMS destacado não pode exceder o valor dos produtos que o contêm.
  constraint nfc_icms_dentro_dos_produtos check (valor_icms <= valor_produtos),
  constraint nfc_desconto_ate_produtos check (valor_desconto <= valor_produtos),
  constraint nfc_chave_formato check (chave_acesso is null or app.chave_nfe_valida(chave_acesso)),
  constraint nfc_modelo_valido check (modelo_documento in ('55','65','01','1B','04')),
  constraint nfc_origem_valida check (origem_dados in ('MANUAL','XML')),
  -- XML é fonte, não anexo (RN-L08): declarar origem XML sem a chave é
  -- exatamente o caso que a regra existe para impedir.
  constraint nfc_xml_exige_chave check (origem_dados <> 'XML' or chave_acesso is not null),
  constraint nfc_integrada_exige_conferencia check (
    status <> 'INTEGRADA' or (conferida_em is not null and integrada_em is not null)
  ),
  constraint nfc_conferida_exige_marca check (
    status not in ('CONFERIDA','INTEGRADA') or conferida_em is not null
  ),
  constraint nfc_cancelamento_com_motivo check (
    status <> 'CANCELADA' or (cancelada_em is not null and nullif(btrim(motivo_cancelamento), '') is not null)
  )
);

-- Chave de acesso é única no país inteiro, não só no tenant: repetição entre
-- tenants seria erro de digitação em um dos dois, nunca dado legítimo. Mas o
-- índice precisa do tenant à frente para ser útil sob RLS — daí os dois.
create unique index if not exists nfc_chave_uk
  on public.nota_fiscal_compra (chave_acesso)
  where chave_acesso is not null and deleted_at is null;
create unique index if not exists nfc_numero_uk
  on public.nota_fiscal_compra (tenant_id, fornecedor_id, modelo_documento, serie, numero)
  where deleted_at is null;
create index if not exists nfc_periodo_ix
  on public.nota_fiscal_compra (tenant_id, data_entrada desc) where deleted_at is null;
create index if not exists nfc_pendente_ix
  on public.nota_fiscal_compra (tenant_id, status)
  where status <> 'INTEGRADA' and deleted_at is null;

-- -----------------------------------------------------------------------------
-- nota_fiscal_item
-- -----------------------------------------------------------------------------
create table if not exists public.nota_fiscal_item (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete restrict,
  nota_fiscal_id   uuid not null references public.nota_fiscal_compra(id) on delete cascade,
  numero_item      integer not null,
  modelo_id        uuid not null references public.modelo(id) on delete restrict,
  descricao_nf     text not null,          -- como veio na nota, sem normalizar
  codigo_fornecedor text,
  ncm              text,
  cfop             text,
  unidade          text not null default 'UN',
  quantidade       integer not null,
  valor_unitario   numeric(15,4) not null,
  valor_total_item numeric(15,4) not null,
  garantia_meses   integer,
  garantia_ate     date,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint nfi_quantidade_positiva check (quantidade > 0),
  constraint nfi_valor_nao_negativo check (valor_unitario >= 0 and valor_total_item >= 0),
  constraint nfi_ncm_formato check (ncm is null or ncm ~ '^[0-9]{8}$'),
  constraint nfi_cfop_formato check (cfop is null or cfop ~ '^[0-9]{4}$'),
  constraint nfi_garantia_meses_positiva check (garantia_meses is null or garantia_meses > 0),
  -- O total do item fecha com quantidade × unitário. A NF-e permite arredondar
  -- o unitário em mais casas do que guardamos; por isso a tolerância de um
  -- centavo, e não igualdade exata.
  constraint nfi_total_fecha check (
    abs(valor_total_item - (quantidade * valor_unitario)) <= 0.01
  ),
  constraint nfi_numero_item_positivo check (numero_item > 0)
);
create unique index if not exists nfi_numero_uk
  on public.nota_fiscal_item (nota_fiscal_id, numero_item);
create index if not exists nfi_nota_ix on public.nota_fiscal_item (tenant_id, nota_fiscal_id);
create index if not exists nfi_modelo_ix on public.nota_fiscal_item (tenant_id, modelo_id);

-- -----------------------------------------------------------------------------
-- nota_fiscal_item_serie — uma linha por unidade física
-- -----------------------------------------------------------------------------
create table if not exists public.nota_fiscal_item_serie (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenant(id) on delete restrict,
  nota_fiscal_item_id uuid not null references public.nota_fiscal_item(id) on delete cascade,
  numero_serie        text not null,
  patrimonio          text not null,
  equipamento_id      uuid references public.equipamento(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint nfis_serie_nao_vazia check (nullif(btrim(numero_serie), '') is not null),
  constraint nfis_patrimonio_nao_vazio check (nullif(btrim(patrimonio), '') is not null)
);

-- RN-L04, primeira metade: unicidade *entre* notas do tenant.
create unique index if not exists nfis_serie_uk
  on public.nota_fiscal_item_serie (tenant_id, upper(numero_serie));
create unique index if not exists nfis_patrimonio_uk
  on public.nota_fiscal_item_serie (tenant_id, upper(patrimonio));
-- 1:1 com o ativo: a mesma unidade da nota não gera dois equipamentos.
create unique index if not exists nfis_equipamento_uk
  on public.nota_fiscal_item_serie (equipamento_id) where equipamento_id is not null;
create index if not exists nfis_item_ix
  on public.nota_fiscal_item_serie (tenant_id, nota_fiscal_item_id);

-- -----------------------------------------------------------------------------
-- equipamento ganha procedência
-- -----------------------------------------------------------------------------
alter table public.equipamento
  add column if not exists nota_fiscal_item_serie_id uuid
    references public.nota_fiscal_item_serie(id) on delete restrict,
  add column if not exists garantia_ate date;

create unique index if not exists equipamento_nfis_uk
  on public.equipamento (nota_fiscal_item_serie_id)
  where nota_fiscal_item_serie_id is not null;

comment on column public.equipamento.nota_fiscal is
  'DESCONTINUADO — mantido para o parque cadastrado antes da migração 0010. Ativos novos têm procedência em nota_fiscal_item_serie_id.';
comment on column public.equipamento.nota_fiscal_item_serie_id is
  'Unidade física da nota de compra que originou este ativo (RN-L03).';
comment on column public.equipamento.garantia_ate is
  'Herdada do item da nota na integração e congelada ali (RN-L06).';

-- =============================================================================
-- INVARIANTES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RN-L10 — a chave de acesso tem de concordar com o cabeçalho
--
-- O DV já foi verificado pelo CHECK. Falta o que o DV não pega: uma chave
-- válida, mas *de outra nota*. Emitente, modelo, série, número e competência
-- estão embutidos nos 44 dígitos; divergir de qualquer um significa XML trocado.
-- -----------------------------------------------------------------------------
create or replace function app.validar_chave_nfe_coerente()
returns trigger
language plpgsql
as $$
declare
  v_doc_fornecedor text;
  v_cnpj_chave  text;
  v_aamm_chave  text;
  v_mod_chave   text;
  v_serie_chave integer;
  v_numero_chave integer;
begin
  if new.chave_acesso is null then
    return new;
  end if;

  v_aamm_chave   := substr(new.chave_acesso, 3, 4);
  v_cnpj_chave   := substr(new.chave_acesso, 7, 14);
  v_mod_chave    := substr(new.chave_acesso, 21, 2);
  v_serie_chave  := substr(new.chave_acesso, 23, 3)::integer;
  v_numero_chave := substr(new.chave_acesso, 26, 9)::integer;

  select f.documento into v_doc_fornecedor
  from public.fornecedor f where f.id = new.fornecedor_id;

  if v_doc_fornecedor is not null and v_doc_fornecedor <> v_cnpj_chave then
    raise exception
      'chave de acesso pertence ao emitente %, e a nota foi lançada para o fornecedor %',
      v_cnpj_chave, v_doc_fornecedor
      using errcode = '23514',
            hint = 'A chave carrega o CNPJ do emitente nas posições 7 a 20. Confira se o XML é do fornecedor selecionado (RN-L10).';
  end if;

  if v_mod_chave <> lpad(new.modelo_documento, 2, '0') then
    raise exception 'chave de acesso é do modelo %, e a nota declara modelo %',
      v_mod_chave, new.modelo_documento
      using errcode = '23514', hint = 'Posições 21 e 22 da chave (RN-L10).';
  end if;

  if new.serie ~ '^[0-9]+$' and v_serie_chave <> new.serie::integer then
    raise exception 'chave de acesso é da série %, e a nota declara série %',
      v_serie_chave, new.serie
      using errcode = '23514', hint = 'Posições 23 a 25 da chave (RN-L10).';
  end if;

  if new.numero ~ '^[0-9]+$' and v_numero_chave <> new.numero::integer then
    raise exception 'chave de acesso é da nota número %, e o cabeçalho declara %',
      v_numero_chave, new.numero
      using errcode = '23514', hint = 'Posições 26 a 34 da chave (RN-L10).';
  end if;

  if v_aamm_chave <> to_char(new.data_emissao, 'YYMM') then
    raise exception 'chave de acesso é da competência %, e a emissão declarada é %',
      v_aamm_chave, to_char(new.data_emissao, 'YYYY-MM')
      using errcode = '23514', hint = 'Posições 3 a 6 da chave (RN-L10).';
  end if;

  return new;
end;
$$;

drop trigger if exists nfc_chave_coerente on public.nota_fiscal_compra;
create trigger nfc_chave_coerente
  before insert or update of chave_acesso, fornecedor_id, numero, serie, modelo_documento, data_emissao
  on public.nota_fiscal_compra
  for each row execute function app.validar_chave_nfe_coerente();

-- -----------------------------------------------------------------------------
-- RN-L04, segunda metade — série e patrimônio únicos também contra o parque
--
-- Os índices únicos cobrem duplicidade entre notas. Falta o caso mais provável:
-- a série já existe como equipamento cadastrado antes deste módulo. Sem esta
-- verificação, o conflito só apareceria na integração — depois de o conferente
-- ter digitado o lote inteiro.
-- -----------------------------------------------------------------------------
create or replace function app.validar_serie_patrimonio_livres()
returns trigger
language plpgsql
as $$
declare
  v_patrimonio_de text;
  v_serie_de      text;
begin
  select e.patrimonio into v_patrimonio_de
  from public.equipamento e
  where e.tenant_id = new.tenant_id
    and upper(e.patrimonio) = upper(btrim(new.patrimonio))
    and e.deleted_at is null
    and (e.nota_fiscal_item_serie_id is null or e.nota_fiscal_item_serie_id <> new.id)
  limit 1;

  if v_patrimonio_de is not null then
    raise exception 'patrimônio % já pertence a um equipamento cadastrado', new.patrimonio
      using errcode = '23505',
            column = 'patrimonio',
            hint = 'Escolha outro patrimônio ou verifique se este ativo já foi lançado (RN-L04).';
  end if;

  select e.patrimonio into v_serie_de
  from public.equipamento e
  where e.tenant_id = new.tenant_id
    and e.numero_serie is not null
    and upper(e.numero_serie) = upper(btrim(new.numero_serie))
    and e.deleted_at is null
    and (e.nota_fiscal_item_serie_id is null or e.nota_fiscal_item_serie_id <> new.id)
  limit 1;

  if v_serie_de is not null then
    raise exception 'número de série % já pertence ao equipamento de patrimônio %',
      new.numero_serie, v_serie_de
      using errcode = '23505',
            column = 'numero_serie',
            hint = 'Série repetida costuma ser leitura de código de barras do ativo errado (RN-L04).';
  end if;

  return new;
end;
$$;

drop trigger if exists nfis_serie_patrimonio_livres on public.nota_fiscal_item_serie;
create trigger nfis_serie_patrimonio_livres
  before insert or update of numero_serie, patrimonio on public.nota_fiscal_item_serie
  for each row execute function app.validar_serie_patrimonio_livres();

-- -----------------------------------------------------------------------------
-- RN-L01 / RN-L02 / RN-L09 — máquina de estados da nota
--
--   PENDENTE_CONFERENCIA → CONFERIDA → INTEGRADA
--            ↓                 ↓
--        CANCELADA         CANCELADA
--
-- INTEGRADA é terminal: os ativos já existem carregando valor de aquisição e
-- garantia derivados da nota. Corrigir a nota depois disso deixaria o ativo com
-- um custo que a nota não explica mais — correção é por nota de ajuste.
-- -----------------------------------------------------------------------------
create or replace function app.validar_transicao_nota_fiscal()
returns trigger
language plpgsql
as $$
declare
  v_faltando record;
begin
  -- RN-L01: nota integrada não aceita alteração alguma.
  if tg_op = 'UPDATE' and old.status = 'INTEGRADA' then
    raise exception 'nota fiscal % já foi integrada ao patrimônio e não aceita alteração', old.numero
      using errcode = '23514',
            hint = 'Registre uma nota de ajuste referenciando a original (RN-L01).';
  end if;

  if tg_op = 'UPDATE' and old.status = 'CANCELADA' and new.status <> 'CANCELADA' then
    raise exception 'nota fiscal % está cancelada e não pode ser reaberta', old.numero
      using errcode = '23514', hint = 'Lance a entrada novamente (RN-L09).';
  end if;

  if tg_op = 'UPDATE' and new.status <> old.status then
    if not (
      (old.status = 'PENDENTE_CONFERENCIA' and new.status in ('CONFERIDA','CANCELADA'))
      or (old.status = 'CONFERIDA' and new.status in ('INTEGRADA','CANCELADA','PENDENTE_CONFERENCIA'))
    ) then
      raise exception 'transição de nota fiscal inválida: % → %', old.status, new.status
        using errcode = '23514', hint = 'Ver máquina de estados da migração 0010 (RN-L09).';
    end if;
  end if;

  -- RN-L02: conferência exige todas as unidades identificadas.
  if new.status = 'CONFERIDA' and (tg_op = 'INSERT' or old.status is distinct from 'CONFERIDA') then
    select i.numero_item, i.descricao_nf, i.quantidade,
           (select count(*) from public.nota_fiscal_item_serie s
             where s.nota_fiscal_item_id = i.id) as informadas
      into v_faltando
      from public.nota_fiscal_item i
     where i.nota_fiscal_id = new.id
       and (select count(*) from public.nota_fiscal_item_serie s
             where s.nota_fiscal_item_id = i.id) <> i.quantidade
     order by i.numero_item
     limit 1;

    if v_faltando.numero_item is not null then
      raise exception
        'item % (%) tem % de % unidades identificadas',
        v_faltando.numero_item, v_faltando.descricao_nf,
        v_faltando.informadas, v_faltando.quantidade
        using errcode = '23514',
              hint = 'Informe série e patrimônio de cada unidade antes de conferir (RN-L02).';
    end if;

    if not exists (select 1 from public.nota_fiscal_item where nota_fiscal_id = new.id) then
      raise exception 'nota fiscal % não tem itens', new.numero
        using errcode = '23514', hint = 'Uma nota sem item não descreve compra alguma (RN-L02).';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists nfc_transicao on public.nota_fiscal_compra;
create trigger nfc_transicao
  before insert or update on public.nota_fiscal_compra
  for each row execute function app.validar_transicao_nota_fiscal();

-- RN-L01 estendida aos filhos: bloquear só o cabeçalho deixaria a porta aberta
-- para editar item ou série de uma nota já integrada.
create or replace function app.bloquear_filho_de_nota_integrada()
returns trigger
language plpgsql
as $$
declare
  v_nota_id uuid;
  v_status  app.nf_status;
  v_numero  text;
begin
  -- Um IF, não um CASE: as duas tabelas têm colunas diferentes, e um CASE é
  -- compilado inteiro — o ramo não tomado ainda seria resolvido contra NEW.
  if tg_table_name = 'nota_fiscal_item' then
    v_nota_id := coalesce(new.nota_fiscal_id, old.nota_fiscal_id);
  else
    select i.nota_fiscal_id into v_nota_id
    from public.nota_fiscal_item i
    where i.id = coalesce(new.nota_fiscal_item_id, old.nota_fiscal_item_id);
  end if;

  select n.status, n.numero into v_status, v_numero
  from public.nota_fiscal_compra n where n.id = v_nota_id;

  -- DELETE em cascata a partir da nota não passa por aqui: a nota integrada já
  -- recusa o próprio DELETE (abaixo). Este gatilho pega a edição direta.
  if v_status = 'INTEGRADA' then
    raise exception 'nota fiscal % já foi integrada; seus itens e séries são imutáveis', v_numero
      using errcode = '23514', hint = 'Registre uma nota de ajuste (RN-L01).';
  end if;

  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['nota_fiscal_item','nota_fiscal_item_serie'] loop
    execute format('drop trigger if exists %I_nota_imutavel on public.%I', t, t);
    execute format(
      'create trigger %I_nota_imutavel before insert or update or delete on public.%I
         for each row execute function app.bloquear_filho_de_nota_integrada()', t, t);
  end loop;
end $$;

-- A exceção deliberada: a integração precisa gravar `equipamento_id` na série
-- *depois* de a nota virar INTEGRADA seria impossível — por isso a ordem
-- correta é gravar o vínculo antes da transição. O gatilho acima é o que torna
-- essa ordem obrigatória em vez de convencionada.

create or replace function app.bloquear_delete_nota_integrada()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'INTEGRADA' then
    raise exception 'nota fiscal % gerou ativos no patrimônio e não pode ser removida', old.numero
      using errcode = '23514',
            hint = 'Baixa patrimonial dos ativos é outro fluxo (RN-L09).';
  end if;
  return old;
end;
$$;

drop trigger if exists nfc_delete_bloqueado on public.nota_fiscal_compra;
create trigger nfc_delete_bloqueado
  before delete on public.nota_fiscal_compra
  for each row execute function app.bloquear_delete_nota_integrada();

-- -----------------------------------------------------------------------------
-- RN-L03 — o ativo não pode existir sem a unidade da nota que o originou
--
-- A FK com ON DELETE RESTRICT já protege o vínculo. Falta o inverso: um ativo
-- criado a partir da nota não pode trocar de procedência depois.
-- -----------------------------------------------------------------------------
create or replace function app.bloquear_troca_de_procedencia()
returns trigger
language plpgsql
as $$
begin
  if old.nota_fiscal_item_serie_id is not null
     and new.nota_fiscal_item_serie_id is distinct from old.nota_fiscal_item_serie_id then
    raise exception 'equipamento % já tem procedência fiscal e não pode ser revinculado', old.patrimonio
      using errcode = '23514',
            hint = 'A origem do ativo é a nota que o comprou; corrigir exige estorno da integração (RN-L03).';
  end if;
  return new;
end;
$$;

drop trigger if exists equipamento_procedencia_imutavel on public.equipamento;
create trigger equipamento_procedencia_imutavel
  before update of nota_fiscal_item_serie_id on public.equipamento
  for each row execute function app.bloquear_troca_de_procedencia();

-- =============================================================================
-- Rateio: função de referência
--
-- O custo de aquisição de cada unidade é
--
--   custo_item    = valor_total_item + acessorio × valor_total_item / valor_produtos
--   custo_unidade = custo_item / quantidade
--
-- onde `acessorio = custo_aquisicao − valor_produtos` (frete, seguro, ST, IPI e
-- outras despesas, menos desconto e tributos recuperáveis). Pode ser negativo
-- quando o ICMS é recuperável e supera o frete — é o caso correto, não um erro.
--
-- O resíduo de arredondamento vai para a **primeira** unidade, de modo que a
-- soma feche exatamente com `custo_aquisicao`. Distribuir o resíduo faria a
-- conciliação depender da ordem de leitura; concentrá-lo torna o desvio de um
-- centavo localizável.
--
-- A função vive no banco porque o relatório de imobilizado precisa do mesmo
-- número que a integração gravou, sem reimplementar a regra em SQL ad hoc.
-- =============================================================================
create or replace function app.ratear_custo_nota(p_nota_id uuid)
returns table (
  nota_fiscal_item_serie_id uuid,
  nota_fiscal_item_id       uuid,
  numero_item               integer,
  patrimonio                text,
  numero_serie              text,
  modelo_id                 uuid,
  valor_aquisicao           numeric(15,4),
  garantia_ate              date
)
language sql
stable
as $$
  with nota as (
    select n.id, n.valor_produtos, n.custo_aquisicao, n.data_entrada
    from public.nota_fiscal_compra n where n.id = p_nota_id
  ),
  item as (
    select i.*,
           case when nota.valor_produtos = 0 then 0
                else round(
                  (nota.custo_aquisicao - nota.valor_produtos)
                  * i.valor_total_item / nota.valor_produtos, 4)
           end as acessorio_item,
           nota.data_entrada
    from public.nota_fiscal_item i cross join nota
    where i.nota_fiscal_id = p_nota_id
  ),
  unidade as (
    select s.id as serie_id, s.nota_fiscal_item_id, s.patrimonio, s.numero_serie,
           i.numero_item, i.modelo_id, i.quantidade, i.valor_total_item,
           i.acessorio_item, i.garantia_ate, i.garantia_meses, i.data_entrada,
           row_number() over (
             partition by s.nota_fiscal_item_id order by upper(s.patrimonio), s.id
           ) as ordem
    from public.nota_fiscal_item_serie s
    join item i on i.id = s.nota_fiscal_item_id
  )
  select u.serie_id,
         u.nota_fiscal_item_id,
         u.numero_item,
         u.patrimonio,
         u.numero_serie,
         u.modelo_id,
         round((u.valor_total_item + u.acessorio_item) / u.quantidade, 2)
           + case when u.ordem = 1
                  then (u.valor_total_item + u.acessorio_item)
                       - round((u.valor_total_item + u.acessorio_item) / u.quantidade, 2) * u.quantidade
                  else 0 end,
         coalesce(u.garantia_ate,
                  case when u.garantia_meses is not null
                       then (u.data_entrada + make_interval(months => u.garantia_meses))::date
                  end)
  from unidade u
  order by u.numero_item, u.ordem;
$$;

comment on function app.ratear_custo_nota(uuid) is
  'Custo de aquisição e garantia por unidade da nota (RN-L05, RN-L06). Σ valor_aquisicao = nota_fiscal_compra.custo_aquisicao.';

-- =============================================================================
-- Correção em app.auditar(): nem toda tabela auditável tem exclusão lógica
--
-- `nota_fiscal_item` e `nota_fiscal_item_serie` não têm `deleted_at` — a vida
-- delas termina junto com a nota, por CASCADE, e um item de nota "excluído
-- logicamente" seria um item que a nota não descreve mais. O gatilho genérico
-- lia `new.deleted_at` diretamente e estourava `record "new" has no field`.
--
-- Corrigido aqui, e não na 0003, porque migração já aplicada não se reescreve:
-- o ambiente que rodou a 0003 antes desta precisa da diferença como passo.
-- =============================================================================
create or replace function app.auditar()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_acao   text;
  v_ant    jsonb;
  v_novo   jsonb;
  v_chaves text[];
  k        text;
  v_tenant uuid;
  v_id     uuid;
  v_old_del text;
  v_new_del text;
begin
  if tg_op = 'INSERT' then
    v_acao := 'INSERIR';
    v_novo := to_jsonb(new);
    v_ant  := null;
  elsif tg_op = 'UPDATE' then
    -- Via jsonb: a coluna pode não existir, e o gatilho é genérico.
    v_old_del := to_jsonb(old) ->> 'deleted_at';
    v_new_del := to_jsonb(new) ->> 'deleted_at';

    if v_new_del is not null and v_old_del is null then
      v_acao := 'EXCLUIR_LOGICO';        -- RN-019
    elsif v_new_del is null and v_old_del is not null then
      v_acao := 'RESTAURAR';
    else
      v_acao := 'ATUALIZAR';
    end if;

    v_ant  := '{}'::jsonb;
    v_novo := '{}'::jsonb;
    select array_agg(key) into v_chaves
    from jsonb_each(to_jsonb(new))
    where to_jsonb(new) -> key is distinct from to_jsonb(old) -> key;

    if v_chaves is null then
      return new;  -- update sem mudança efetiva: não gera ruído no log
    end if;

    foreach k in array v_chaves loop
      if k not in ('updated_at', 'updated_by', 'version') then
        v_ant  := v_ant  || jsonb_build_object(k, to_jsonb(old) -> k);
        v_novo := v_novo || jsonb_build_object(k, to_jsonb(new) -> k);
      end if;
    end loop;

    if v_novo = '{}'::jsonb then
      return new;  -- só metadados de linha mudaram
    end if;
  else -- DELETE
    v_acao := 'EXCLUIR_LOGICO';
    v_ant  := to_jsonb(old);
    v_novo := null;
  end if;

  if tg_op = 'DELETE' then
    v_tenant := (to_jsonb(old) ->> 'tenant_id')::uuid;
    v_id     := (to_jsonb(old) ->> 'id')::uuid;
  else
    v_tenant := (to_jsonb(new) ->> 'tenant_id')::uuid;
    v_id     := (to_jsonb(new) ->> 'id')::uuid;
  end if;

  -- A tabela tenant não possui coluna tenant_id: ela própria é o tenant.
  if v_tenant is null then
    v_tenant := v_id;
  end if;

  insert into public.audit_log (
    tenant_id, entidade_tipo, entidade_id, acao,
    valor_anterior, valor_novo,
    usuario_id, motivo, request_id, origem
  ) values (
    v_tenant, tg_table_name, v_id, v_acao,
    v_ant, v_novo,
    app.usuario_atual(),
    nullif(current_setting('app.motivo', true), ''),
    app.request_id_atual(),
    app.origem_atual()
  );

  return coalesce(new, old);
end;
$$;

-- =============================================================================
-- Gatilhos padrão, auditoria e RLS
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['fornecedor','nota_fiscal_compra','nota_fiscal_item','nota_fiscal_item_serie'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
    perform app.habilitar_auditoria(t);
    -- Nenhuma destas tabelas é legível direto pelo cliente: custo de aquisição
    -- é dado de margem. Passa pela API, sob escopo organizacional (Anexo C).
    perform app.habilitar_rls_tenant(t, false);
  end loop;
end $$;

comment on table public.nota_fiscal_compra is
  'Entrada fiscal da compra. Origem única do valor de aquisição, da data de início da depreciação e da garantia dos ativos (Módulo 1 do Anexo L).';
comment on column public.nota_fiscal_compra.custo_aquisicao is
  'Total da nota menos tributos recuperáveis (CPC 27 item 16; Lei 6.404/76 art. 183, I). Coluna gerada — ver M.2.';
comment on column public.nota_fiscal_compra.icms_recuperavel is
  'Padrão false: locação de bem móvel não é fato gerador de ICMS (Súmula 573 do STF), logo a locadora pura não se credita. Gravado por nota para que mudança de regime não reprecifique o passado.';
