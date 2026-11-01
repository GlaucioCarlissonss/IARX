-- =============================================================================
-- 0028 — Anexos
--
-- Anexo A.4 define a tabela. Mesma história das duas anteriores: especificada e
-- não construída.
--
-- ## O que esta tabela guarda, e o que não guarda
--
-- Guarda **metadado**: nome, tipo, tamanho, hash, onde o arquivo está. Não
-- guarda o arquivo. `storage_key` aponta para o objeto no armazenamento — o
-- Supabase Storage, conforme o Anexo H —, e o banco fica com a parte que
-- precisa de transação, de RLS e de histórico.
--
-- Guardar o binário aqui seria mais simples num primeiro dia e caro em todos os
-- outros: um `bytea` de contrato assinado entra em todo backup, em todo dump de
-- depuração e em toda réplica, e a restauração de um banco de cem gigabytes
-- passa a ser uma operação de horas por causa de PDFs que ninguém consultou em
-- dois anos.
--
-- ## `hash_sha256` não é zelo
--
-- É o que permite responder "este é o mesmo arquivo que foi assinado?". Sem
-- ele, um anexo substituído no armazenamento é indistinguível do original, e a
-- evidência de um contrato ou de uma OS deixa de ser evidência.
-- =============================================================================

do $$ begin
  create type app.anexo_entidade as enum (
    'CONTRATO',
    'EQUIPAMENTO',
    'CLIENTE',
    'ORDEM_SERVICO',
    'NOTA_FISCAL',
    'TITULO_PAGAR',
    'TITULO_RECEBER',
    'LEITURA'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.antivirus_status as enum ('PENDENTE','LIMPO','INFECTADO','FALHOU');
exception when duplicate_object then null; end $$;

create table if not exists public.anexo (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete restrict,
  /*
   * Referência polimórfica, de propósito.
   *
   * A alternativa — uma FK por tipo de entidade, oito colunas com sete nulas —
   * dá integridade referencial e custa uma migração a cada entidade nova que
   * passe a aceitar anexo. Aqui o par (tipo, id) é verificado por gatilho, que
   * é a única forma de ter as duas coisas sem reescrever a tabela a cada
   * módulo.
   */
  entidade_tipo   app.anexo_entidade not null,
  entidade_id     uuid not null,
  tipo_documento  text,
  nome_arquivo    text not null,
  /* Onde o objeto está no armazenamento. O banco guarda o endereço, não o
     conteúdo: binário aqui entra em todo backup e em toda réplica. */
  storage_key     text not null,
  mime_type       text,
  tamanho_bytes   bigint not null,
  /* Responde "este é o mesmo arquivo que foi assinado?". Sem ele, um anexo
     trocado no armazenamento é indistinguível do original. */
  hash_sha256     text,
  versao          integer not null default 1,
  validade_ate    date,
  antivirus_status app.antivirus_status not null default 'PENDENTE',
  enviado_por     uuid references public.usuario(id) on delete restrict,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  deleted_at      timestamptz,
  deleted_by      uuid,
  delete_reason   text,
  constraint anexo_tamanho_positivo check (tamanho_bytes > 0),
  constraint anexo_hash_formato check (hash_sha256 is null or hash_sha256 ~ '^[0-9a-f]{64}$'),
  constraint anexo_nome_legivel check (length(btrim(nome_arquivo)) >= 1)
);

create index if not exists anexo_entidade_ix
  on public.anexo (tenant_id, entidade_tipo, entidade_id)
  where deleted_at is null;

-- O mesmo objeto não é anexado duas vezes à mesma entidade: dois registros
-- apontando para a mesma chave fazem a remoção de um deixar o outro apontando
-- para um objeto que vai ser apagado.
create unique index if not exists anexo_storage_uk
  on public.anexo (tenant_id, storage_key)
  where deleted_at is null;

-- -----------------------------------------------------------------------------
-- A referência polimórfica, verificada
--
-- Sem isto, `entidade_id` é um uuid qualquer: um anexo pode apontar para nada,
-- ou para o contrato de outro locatário. O segundo caso é o que importa — a
-- RLS protege a leitura da linha do anexo, não o que ela referencia.
-- -----------------------------------------------------------------------------
create or replace function app.validar_anexo_entidade()
returns trigger
language plpgsql
as $$
declare
  v_tabela text;
  v_existe boolean;
begin
  v_tabela := case new.entidade_tipo
    when 'CONTRATO'       then 'contrato'
    when 'EQUIPAMENTO'    then 'equipamento'
    when 'CLIENTE'        then 'cliente'
    when 'ORDEM_SERVICO'  then 'ordem_servico'
    when 'NOTA_FISCAL'    then 'nota_fiscal_compra'
    when 'TITULO_PAGAR'   then 'titulo_pagar'
    when 'TITULO_RECEBER' then 'titulo_receber'
    when 'LEITURA'        then 'leitura_medidor'
  end;

  execute format(
    'select exists (select 1 from public.%I where id = $1 and tenant_id = $2)', v_tabela
  ) into v_existe using new.entidade_id, new.tenant_id;

  if not v_existe then
    raise exception 'anexo aponta para % inexistente neste locatário', lower(new.entidade_tipo::text)
      using errcode = '23503',
            constraint = 'anexo_entidade_existe',
            hint = 'Confira o identificador da entidade.';
  end if;

  return new;
end;
$$;

drop trigger if exists anexo_entidade_valida on public.anexo;
create trigger anexo_entidade_valida
  before insert or update of entidade_tipo, entidade_id on public.anexo
  for each row execute function app.validar_anexo_entidade();

-- -----------------------------------------------------------------------------
-- Gatilhos padrão, auditoria e RLS
-- -----------------------------------------------------------------------------
do $$
begin
  perform app.habilitar_auditoria('anexo');
  perform app.habilitar_rls_tenant('anexo', false);
  drop trigger if exists anexo_touch on public.anexo;
  create trigger anexo_touch before update on public.anexo
    for each row execute function app.touch_updated_at();
end $$;
