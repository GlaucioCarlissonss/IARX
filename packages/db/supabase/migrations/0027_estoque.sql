-- =============================================================================
-- 0027 — Módulo EST: peças e estoque
--
-- Anexo A.7 define as tabelas, o B.5 a máquina de reserva de peça, e RN-016/017
-- as duas regras que organizam tudo. Mesmo caso da 0026: estava especificado e
-- não construído.
--
-- ## A regra que decide o desenho
--
-- **RN-017: o saldo é derivado do movimento, e o movimento é imutável.**
--
-- É tentador guardar só o saldo e atualizá-lo: é uma coluna e um `update`.
-- O problema aparece no primeiro inventário divergente, quando alguém pergunta
-- "por que o saldo é 3 se compramos 10 e usamos 5" e não existe resposta — o
-- `update` apagou o caminho. Com o movimento append-only, a pergunta sempre tem
-- resposta, e a divergência vira uma linha de ajuste com motivo em vez de um
-- número que mudou sozinho.
--
-- O saldo continua existindo, como **projeção**: é o que a consulta de fila lê,
-- e recalcular a soma de todos os movimentos a cada leitura de tela seria pagar
-- o histórico inteiro para responder "tem peça?".
--
-- ## Reserva não é baixa
--
-- `quantidade_reservada` e `quantidade_fisica` são separadas porque uma OS
-- agendada compromete a peça sem consumi-la: ela ainda está na prateleira, e
-- ainda assim não está disponível para outra OS. Juntar as duas faria a mesma
-- peça ser prometida duas vezes — que é o defeito mais caro deste módulo,
-- porque só aparece no dia da visita, com o técnico no cliente.
-- =============================================================================

do $$ begin
  create type app.peca_criticidade as enum ('BAIXA','MEDIA','ALTA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.deposito_tipo as enum ('ALMOXARIFADO','OFICINA','VEICULO_TECNICO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.movimento_tipo as enum (
    'ENTRADA_COMPRA',
    'ENTRADA_DEVOLUCAO',
    'SAIDA_OS',
    'SAIDA_PERDA',
    'TRANSFERENCIA_SAIDA',
    'TRANSFERENCIA_ENTRADA',
    'AJUSTE_INVENTARIO',
    'DEVOLUCAO_FORNECEDOR'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.os_peca_status as enum
    ('SOLICITADA','RESERVADA','CONSUMIDA','DEVOLVIDA','EM_FALTA','CANCELADA');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- peca
-- -----------------------------------------------------------------------------
create table if not exists public.peca (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenant(id) on delete restrict,
  codigo_interno            text not null,
  codigo_fabricante         text,
  descricao                 text not null,
  unidade                   text not null default 'UN',
  fornecedor_preferencial_id uuid references public.fornecedor(id) on delete set null,
  /* Custo médio móvel, recalculado a cada entrada. Quatro casas como o resto
     do financeiro: peça de centavos comprada aos milhares acumula diferença
     relevante com duas. */
  custo_medio               numeric(15,4) not null default 0,
  ultimo_custo              numeric(15,4),
  criticidade               app.peca_criticidade not null default 'MEDIA',
  localizacao_fisica        text,
  ativo                     boolean not null default true,
  version                   integer not null default 1,
  created_at                timestamptz not null default now(),
  created_by                uuid,
  updated_at                timestamptz not null default now(),
  updated_by                uuid,
  deleted_at                timestamptz,
  deleted_by                uuid,
  delete_reason             text,
  constraint peca_custos_nao_negativos check (
    custo_medio >= 0 and (ultimo_custo is null or ultimo_custo >= 0)
  )
);

create unique index if not exists peca_codigo_uk
  on public.peca (tenant_id, codigo_interno)
  where deleted_at is null;

-- -----------------------------------------------------------------------------
-- peca_aplicacao — que peça serve em que modelo
--
-- PK composta e nenhuma coluna além das duas: é uma relação, não uma entidade.
-- É o que permite a OS sugerir peça pelo modelo do equipamento, em vez de o
-- técnico procurar no catálogo inteiro.
-- -----------------------------------------------------------------------------
create table if not exists public.peca_aplicacao (
  tenant_id  uuid not null references public.tenant(id) on delete restrict,
  peca_id    uuid not null references public.peca(id) on delete cascade,
  modelo_id  uuid not null references public.modelo(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (peca_id, modelo_id)
);

create index if not exists peca_aplicacao_modelo_ix on public.peca_aplicacao (tenant_id, modelo_id);

-- -----------------------------------------------------------------------------
-- deposito
--
-- `VEICULO_TECNICO` é depósito de verdade e não metáfora: a peça na van do
-- técnico saiu do almoxarifado e ainda não foi consumida. Tratá-la como
-- consumida faria o estoque parecer menor do que é e dispararia reposição
-- desnecessária; ignorá-la faria o almoxarifado prometer peça que não está lá.
-- -----------------------------------------------------------------------------
create table if not exists public.deposito (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete restrict,
  filial_id      uuid references public.filial(id) on delete restrict,
  codigo         text not null,
  nome           text not null,
  tipo           app.deposito_tipo not null default 'ALMOXARIFADO',
  responsavel_id uuid references public.usuario(id) on delete set null,
  ativo          boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  deleted_at     timestamptz,
  deleted_by     uuid,
  delete_reason  text
);

create unique index if not exists deposito_codigo_uk
  on public.deposito (tenant_id, codigo)
  where deleted_at is null;

-- -----------------------------------------------------------------------------
-- saldo_estoque — projeção, e RN-017
--
-- `quantidade_disponivel` é gerada: físico menos reservado, sem caminho de
-- escrita. Disponível que diverge das duas parcelas é o número que promete peça
-- inexistente.
-- -----------------------------------------------------------------------------
create table if not exists public.saldo_estoque (
  tenant_id             uuid not null references public.tenant(id) on delete restrict,
  peca_id               uuid not null references public.peca(id) on delete restrict,
  deposito_id           uuid not null references public.deposito(id) on delete restrict,
  quantidade_fisica     numeric(14,3) not null default 0,
  quantidade_reservada  numeric(14,3) not null default 0,
  quantidade_disponivel numeric(14,3) generated always as
                          (quantidade_fisica - quantidade_reservada) stored,
  valor_total           numeric(15,4) not null default 0,
  atualizado_em         timestamptz not null default now(),
  primary key (tenant_id, peca_id, deposito_id),
  /* RN-017. Saldo negativo não é "estoque devendo": é um movimento que não
     deveria ter sido aceito, e descobrir isso no inventário custa o trabalho
     de reconstruir meses de histórico. */
  constraint saldo_nao_negativo check (quantidade_fisica >= 0 and quantidade_reservada >= 0),
  /* Reservar mais do que existe fisicamente é prometer o que não se tem. */
  constraint saldo_reserva_coerente check (quantidade_reservada <= quantidade_fisica)
);

-- -----------------------------------------------------------------------------
-- movimento_estoque — append-only
--
-- Sem `updated_at`, sem `deleted_at`: a linha não muda e não some. Correção de
-- movimento é outro movimento, de ajuste, com motivo — que é o que mantém a
-- pergunta "por que o saldo é este" sempre respondível.
--
-- `quantidade` é sinalizada: entrada positiva, saída negativa. Guardar o sinal
-- no tipo e a quantidade sempre positiva obrigaria toda soma a consultar o tipo
-- — e a primeira soma que esquecer vira um saldo errado silencioso.
-- -----------------------------------------------------------------------------
create table if not exists public.movimento_estoque (
  id                     uuid not null default gen_random_uuid(),
  tenant_id              uuid not null references public.tenant(id) on delete restrict,
  peca_id                uuid not null references public.peca(id) on delete restrict,
  deposito_id            uuid not null references public.deposito(id) on delete restrict,
  tipo                   app.movimento_tipo not null,
  quantidade             numeric(14,3) not null,
  custo_unitario         numeric(15,4) not null default 0,
  custo_total            numeric(15,4) generated always as (abs(quantidade) * custo_unitario) stored,
  ordem_servico_id       uuid references public.ordem_servico(id) on delete restrict,
  deposito_contraparte_id uuid references public.deposito(id) on delete restrict,
  /* Saldo físico depois deste movimento. Redundante com a soma, e de
     propósito: é o que permite auditar o histórico sem recalcular tudo, e o
     que denuncia um movimento gravado fora de ordem. */
  saldo_apos             numeric(14,3),
  data_movimento         timestamptz not null default now(),
  registrado_por         uuid references public.usuario(id) on delete restrict,
  motivo                 text,
  created_at             timestamptz not null default now(),
  created_by             uuid,
  primary key (id, data_movimento),
  constraint movimento_quantidade_nao_zero check (quantidade <> 0),
  constraint movimento_custo_nao_negativo check (custo_unitario >= 0),
  /* Ajuste de inventário e perda sem motivo são exatamente os dois movimentos
     que alguém vai auditar. Sem motivo, a linha não se explica. */
  constraint movimento_ajuste_com_motivo check (
    tipo not in ('AJUSTE_INVENTARIO','SAIDA_PERDA') or length(btrim(coalesce(motivo,''))) >= 10
  ),
  /* Transferência precisa saber para onde. */
  constraint movimento_transferencia_com_contraparte check (
    tipo not in ('TRANSFERENCIA_SAIDA','TRANSFERENCIA_ENTRADA') or deposito_contraparte_id is not null
  )
) partition by range (data_movimento);

create index if not exists movimento_estoque_peca_ix
  on public.movimento_estoque (tenant_id, peca_id, data_movimento desc);

-- -----------------------------------------------------------------------------
-- politica_reposicao — RN-016
-- -----------------------------------------------------------------------------
create table if not exists public.politica_reposicao (
  tenant_id      uuid not null references public.tenant(id) on delete restrict,
  peca_id        uuid not null references public.peca(id) on delete cascade,
  deposito_id    uuid not null references public.deposito(id) on delete cascade,
  estoque_minimo numeric(14,3) not null default 0,
  estoque_maximo numeric(14,3),
  ponto_pedido   numeric(14,3) not null default 0,
  lote_economico numeric(14,3),
  lead_time_dias integer not null default 0,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  primary key (tenant_id, peca_id, deposito_id),
  constraint politica_quantidades_coerentes check (
    estoque_minimo >= 0 and ponto_pedido >= 0 and lead_time_dias >= 0
    and (estoque_maximo is null or estoque_maximo >= estoque_minimo)
  )
);

-- -----------------------------------------------------------------------------
-- os_peca — a reserva, e a máquina do Anexo B.5
-- -----------------------------------------------------------------------------
create table if not exists public.os_peca (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenant(id) on delete restrict,
  ordem_servico_id      uuid not null references public.ordem_servico(id) on delete cascade,
  peca_id               uuid not null references public.peca(id) on delete restrict,
  deposito_id           uuid references public.deposito(id) on delete restrict,
  quantidade_reservada  numeric(14,3) not null default 0,
  quantidade_consumida  numeric(14,3) not null default 0,
  custo_unitario_baixa  numeric(15,4),
  status                app.os_peca_status not null default 'SOLICITADA',
  created_at            timestamptz not null default now(),
  created_by            uuid,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  constraint os_peca_quantidades_nao_negativas check (
    quantidade_reservada >= 0 and quantidade_consumida >= 0
  ),
  /* Não se consome mais do que se reservou: o excedente é outra reserva, para
     que o saldo saiba que foi comprometido antes de sair. */
  constraint os_peca_consumo_dentro_da_reserva check (quantidade_consumida <= quantidade_reservada)
);

create index if not exists os_peca_os_ix on public.os_peca (tenant_id, ordem_servico_id);
create index if not exists os_peca_peca_ix on public.os_peca (tenant_id, peca_id, status);

-- -----------------------------------------------------------------------------
-- Partições do movimento
--
-- Mesma mecânica de `audit_log` e `leitura_medidor`. Vale lembrar por que isso
-- importa aqui: a 0025 mostrou que linha sem partição levanta check_violation
-- sem nome, e o operador lê "regra não identificada". A API já traduz esse caso
-- desde a medição; manter a janela à frente é o que evita precisar da tradução.
-- -----------------------------------------------------------------------------
select app.garantir_particoes('movimento_estoque', 3);

-- -----------------------------------------------------------------------------
-- RN-017: o saldo é projeção do movimento
--
-- O gatilho é a única coisa que escreve em `saldo_estoque`. Não é zelo de
-- arquitetura — é o que garante que importação, correção manual e API cheguem
-- ao mesmo saldo. Saldo atualizado por quem insere o movimento é saldo que
-- diverge no primeiro caminho de escrita que alguém esquecer.
--
-- `saldo_apos` é gravado no próprio movimento pelo mesmo gatilho: é o que
-- permite auditar o histórico sem recalcular tudo, e o que denuncia um
-- movimento gravado fora de ordem.
-- -----------------------------------------------------------------------------
create or replace function app.aplicar_movimento_estoque()
returns trigger
language plpgsql
as $$
declare
  v_fisico numeric(14,3);
  v_valor  numeric(15,4);
  v_medio  numeric(15,4);
begin
  /*
   * Atualiza primeiro, insere só se não havia linha — e não `on conflict`.
   *
   * `insert ... on conflict do update` parece a forma natural e não serve
   * aqui: o PostgreSQL confere as restrições `check` na **linha candidata**
   * antes de detectar o conflito, e a candidata de uma saída traz quantidade
   * negativa. O `saldo_nao_negativo` reprovava toda saída, mesmo com saldo
   * sobrando — `on conflict` trata colisão de unicidade, não de check.
   */
  update public.saldo_estoque s
     set quantidade_fisica = s.quantidade_fisica + new.quantidade,
         /* Valor acompanha a quantidade: entrada traz o custo da nota, saída
            leva embora o custo médio do instante. É o que mantém
            `valor_total / quantidade` próximo do custo médio sem recalcular a
            série inteira a cada movimento. */
         valor_total = greatest(
           0,
           s.valor_total + case
             when new.quantidade > 0 then new.quantidade * new.custo_unitario
             else new.quantidade * (case when s.quantidade_fisica > 0
                                         then s.valor_total / s.quantidade_fisica
                                         else new.custo_unitario end)
           end
         ),
         atualizado_em = now()
   where s.tenant_id = new.tenant_id
     and s.peca_id = new.peca_id
     and s.deposito_id = new.deposito_id
  returning s.quantidade_fisica, s.valor_total into v_fisico, v_valor;

  if not found then
    /*
     * Primeira movimentação desta peça neste depósito. Se for saída, o
     * `check` recusa — e está certo: é uma baixa de estoque que nunca
     * existiu, que é como um erro de digitação de depósito se manifesta.
     */
    insert into public.saldo_estoque
      (tenant_id, peca_id, deposito_id, quantidade_fisica, valor_total, atualizado_em)
    values (new.tenant_id, new.peca_id, new.deposito_id, new.quantidade,
            greatest(0, new.quantidade * new.custo_unitario), now())
    returning quantidade_fisica, valor_total into v_fisico, v_valor;
  end if;

  new.saldo_apos := v_fisico;

  /*
   * Custo médio móvel, só na entrada.
   *
   * Saída não muda custo médio — se mudasse, consumir peça barata baratearia o
   * estoque restante, e o custo da OS seguinte sairia errado para menos.
   */
  if new.quantidade > 0 and v_fisico > 0 then
    v_medio := v_valor / v_fisico;
    update public.peca
       set custo_medio = v_medio,
           ultimo_custo = new.custo_unitario,
           updated_at = now()
     where id = new.peca_id;
  end if;

  return new;
end;
$$;

drop trigger if exists movimento_aplica_saldo on public.movimento_estoque;
create trigger movimento_aplica_saldo
  before insert on public.movimento_estoque
  for each row execute function app.aplicar_movimento_estoque();

-- -----------------------------------------------------------------------------
-- Append-only, de verdade
--
-- `movimento_estoque` não aceita UPDATE nem DELETE. Correção é outro movimento,
-- de ajuste, com motivo. Sem isto, a promessa de "o saldo sempre tem
-- explicação" depende de ninguém escrever o `update` que resolveria o problema
-- mais rápido — e alguém sempre escreve.
-- -----------------------------------------------------------------------------
create or replace function app.movimento_imutavel()
returns trigger
language plpgsql
as $$
begin
  raise exception 'movimento de estoque é imutável: registre um movimento de ajuste'
    using errcode = '23514',
          constraint = 'movimento_estoque_imutavel',
          hint = 'RN-017. A correção é AJUSTE_INVENTARIO com motivo, não a edição do histórico.';
end;
$$;

drop trigger if exists movimento_sem_update on public.movimento_estoque;
create trigger movimento_sem_update
  before update or delete on public.movimento_estoque
  for each row execute function app.movimento_imutavel();

-- -----------------------------------------------------------------------------
-- Gatilhos padrão, auditoria e RLS
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'peca','peca_aplicacao','deposito','saldo_estoque',
    'movimento_estoque','politica_reposicao','os_peca'
  ] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    perform app.habilitar_rls_tenant(t, false);
  end loop;

  -- Auditoria só onde há o que auditar por diferença. `movimento_estoque` já é
  -- o próprio registro imutável, e `saldo_estoque` é projeção dele: auditar os
  -- dois duplicaria a trilha e dobraria a escrita do caminho mais quente.
  foreach t in array array['peca','deposito','politica_reposicao','os_peca'] loop
    perform app.habilitar_auditoria(t);
  end loop;

  foreach t in array array['peca','deposito','politica_reposicao','os_peca'] loop
    execute format(
      'create trigger %I_touch before update on public.%I
         for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;
