-- =============================================================================
-- 0030 — Memória de cálculo da cobrança contratual
--
-- ## O que faltava
--
-- `consumo_competencia` guarda o consumo por equipamento — franquia, excedente,
-- valor do excedente. `titulo_receber` guarda o total. **Não havia elo entre os
-- dois.** A descrição do título é uma linha só: "Locação e consumo — contrato
-- X, competência Y".
--
-- O efeito prático aparece no dia em que o cliente contesta: ninguém consegue
-- mostrar de onde saiu o número. Nem o operador, que teria de refazer o cálculo
-- a mão sobre um mês já fechado, nem o portal do cliente, que mostra o consumo
-- e o valor sem conseguir ligar um ao outro.
--
-- Esta migração cria `titulo_receber_item`: uma linha por item de contrato, com
-- mensalidade, excedente, desconto e a referência ao consumo que a originou.
--
-- ## E o que **não** se fez aqui
--
-- O Anexo A.8 descreve uma tabela `fatura` com `serie`, `numero`, `nf_chave`,
-- `boleto_linha_digitavel`. Ela não foi criada, e a decisão merece justificativa
-- porque contraria o anexo.
--
-- `titulo_receber` **já é** a cobrança contratual por competência: tem cliente,
-- contrato, competência, valores, emissão, vencimento, aprovação e recebimento.
-- Criar `fatura` ao lado seria manter duas tabelas para o mesmo fato, com duas
-- fontes de verdade para "quanto o cliente deve" — e a pergunta "qual das duas
-- vale" não teria resposta boa.
--
-- O que `fatura` traria de genuinamente novo é a **emissão fiscal**: número de
-- série, chave de NF-e, linha digitável. Isso não é modelagem, é integração com
-- a SEFAZ e com um emissor de boleto, e depende de decisões que ninguém tomou —
-- qual provedor, qual regime tributário, qual série por filial. Modelar os
-- campos agora seria criar colunas cujo preenchimento ninguém sabe descrever.
-- Fica registrado como pendência de **decisão**, não de construção.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- O motor por item
--
-- A função existente, `app.valor_contratual_competencia`, agrega por contrato.
-- Esta devolve a mesma conta **antes** da soma, e a de cima passa a ser a soma
-- desta. Não é refatoração por elegância: duas implementações da mesma
-- precificação divergiriam, e a que diverge é sempre a que ninguém está olhando
-- — a memória de cálculo mostraria itens que não somam o total cobrado.
-- -----------------------------------------------------------------------------
create or replace function app.itens_contratuais_competencia(
  p_contrato_id uuid,
  p_competencia char(7)
)
returns table (
  contrato_item_id uuid,
  equipamento_id   uuid,
  valor_mensal     numeric,
  valor_excedente  numeric,
  desconto         numeric,
  paginas_mono     integer,
  paginas_color    integer,
  franquia_mono    integer,
  franquia_color   integer,
  excedente_mono   integer,
  excedente_color  integer,
  preco_ausente    boolean
)
language sql
stable
as $$
  with referencia as (
    -- Último dia da competência: é a data em que a vigência de preço, franquia
    -- e desconto tem de ser avaliada. Usar a data de hoje reprecificaria um mês
    -- fechado com a tabela de agora.
    select (to_date(p_competencia || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date as dia
  ),
  itens_do_mes as (
    select distinct ci.id as contrato_item_id, ci.equipamento_id,
           c.cliente_id, c.id as contrato_id
      from public.consumo_competencia cc
      join public.contrato_item ci on ci.id = cc.contrato_item_id
      join public.contrato c on c.id = ci.contrato_id
     where cc.competencia = p_competencia
       and ci.contrato_id = p_contrato_id
       and ci.deleted_at is null
  )
  select
    i.contrato_item_id,
    i.equipamento_id,
    pr.valor_mensal,
    coalesce(cc.valor_excedente, 0),
    coalesce(de.valor, 0) + coalesce(pr.valor_mensal, 0) * coalesce(de.percentual, 0) / 100,
    coalesce(cc.paginas_mono, 0),
    coalesce(cc.paginas_color, 0),
    coalesce(cc.franquia_mono, 0),
    coalesce(cc.franquia_color, 0),
    coalesce(cc.excedente_mono, 0),
    coalesce(cc.excedente_color, 0),
    pr.valor_mensal is null
  from itens_do_mes i
  cross join referencia r
  left join lateral app.resolver_preco(
              i.equipamento_id, i.cliente_id, i.contrato_id, r.dia) pr on true
  left join lateral app.desconto_vigente(i.contrato_item_id, r.dia) de on true
  left join lateral (
    select cc.valor_excedente, cc.paginas_mono, cc.paginas_color,
           cc.franquia_mono, cc.franquia_color, cc.excedente_mono, cc.excedente_color
      from public.consumo_competencia cc
     where cc.contrato_item_id = i.contrato_item_id
       and cc.competencia = p_competencia
     limit 1
  ) cc on true;
$$;

comment on function app.itens_contratuais_competencia(uuid, char) is
  'A conta de cada item de contrato numa competência, antes da soma. `valor_contratual_competencia` é a soma desta.';

-- A função agregada passa a somar a de item, em vez de repetir a precificação.
create or replace function app.valor_contratual_competencia(
  p_contrato_id uuid,
  p_competencia char(7)
)
returns table (
  valor_mensal    numeric,
  valor_excedente numeric,
  desconto        numeric,
  itens           integer,
  preco_ausente   integer
)
language sql
stable
as $$
  select
    coalesce(sum(i.valor_mensal), 0),
    coalesce(sum(i.valor_excedente), 0),
    coalesce(sum(i.desconto), 0),
    count(*)::integer,
    count(*) filter (where i.preco_ausente)::integer
  from app.itens_contratuais_competencia(p_contrato_id, p_competencia) i;
$$;

comment on function app.valor_contratual_competencia(uuid, char) is
  'Mensalidade, excedente e desconto de um contrato numa competência. É a soma de `itens_contratuais_competencia` — uma única implementação da precificação.';

-- -----------------------------------------------------------------------------
-- titulo_receber_item — a memória de cálculo
-- -----------------------------------------------------------------------------
create table if not exists public.titulo_receber_item (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete restrict,
  titulo_id        uuid not null references public.titulo_receber(id) on delete cascade,
  contrato_item_id uuid references public.contrato_item(id) on delete restrict,
  equipamento_id   uuid references public.equipamento(id) on delete restrict,
  descricao        text not null,

  valor_mensal     numeric(15,4) not null default 0,
  valor_excedente  numeric(15,4) not null default 0,
  desconto         numeric(15,4) not null default 0,
  /* Derivado: mensalidade mais excedente menos desconto, sem caminho de
     escrita. Item cujo líquido não bate com as parcelas é precisamente o
     número que a memória de cálculo existe para impedir. */
  valor_liquido    numeric(15,4) generated always as
                     (valor_mensal + valor_excedente - desconto) stored,

  /* O consumo que originou a linha. Guardado aqui, e não só referenciado, para
     a memória continuar legível depois de uma reabertura de competência que
     recalcule `consumo_competencia` — o cliente contestou **este** número. */
  paginas_mono     integer not null default 0,
  paginas_color    integer not null default 0,
  franquia_mono    integer not null default 0,
  franquia_color   integer not null default 0,
  excedente_mono   integer not null default 0,
  excedente_color  integer not null default 0,

  created_at       timestamptz not null default now(),
  created_by       uuid,

  constraint tri_valores_nao_negativos check (
    valor_mensal >= 0 and valor_excedente >= 0 and desconto >= 0
  ),
  constraint tri_desconto_dentro_do_item check (desconto <= valor_mensal + valor_excedente),
  constraint tri_contadores_nao_negativos check (
    paginas_mono >= 0 and paginas_color >= 0
    and franquia_mono >= 0 and franquia_color >= 0
    and excedente_mono >= 0 and excedente_color >= 0
  )
);

-- Um item de contrato aparece uma vez por título: duas linhas para o mesmo
-- item fariam a memória somar mais que o total cobrado.
create unique index if not exists titulo_receber_item_uk
  on public.titulo_receber_item (titulo_id, contrato_item_id)
  where contrato_item_id is not null;

create index if not exists titulo_receber_item_titulo_ix
  on public.titulo_receber_item (tenant_id, titulo_id);

-- -----------------------------------------------------------------------------
-- Imutável depois de emitido — RN-023
--
-- O anexo escreve a regra para `fatura`; ela vale igual aqui, e pelo mesmo
-- motivo: memória de cálculo que muda depois da cobrança enviada deixa de ser
-- memória. O cliente contesta o número que recebeu, não o que o sistema passou
-- a mostrar.
-- -----------------------------------------------------------------------------
create or replace function app.titulo_item_imutavel()
returns trigger
language plpgsql
as $$
declare v_status text;
begin
  select t.status into v_status
    from public.titulo_receber t
   where t.id = coalesce(new.titulo_id, old.titulo_id);

  /*
   * Enquanto o título espera aprovação ou está em disputa, a memória ainda
   * pode ser refeita: é justamente o período em que alguém está conferindo.
   * Depois de aprovado, não.
   */
  if v_status in ('PENDENTE_APROVACAO', 'EM_DISPUTA') then
    return coalesce(new, old);
  end if;

  raise exception 'memória de cálculo de título % não muda depois de aprovado', v_status
    using errcode = '23514',
          constraint = 'titulo_item_imutavel',
          hint = 'RN-023. Corrija por nota de ajuste, não reescrevendo a memória.';
end;
$$;

drop trigger if exists titulo_item_imutavel on public.titulo_receber_item;
create trigger titulo_item_imutavel
  before update or delete on public.titulo_receber_item
  for each row execute function app.titulo_item_imutavel();

-- -----------------------------------------------------------------------------
-- Gatilhos padrão e RLS
--
-- Leitura de cliente habilitada: a memória de cálculo é **para** o cliente. É o
-- que o portal mostra quando alguém pergunta de onde saiu a conta — e sem ela o
-- portal exibe consumo e valor sem conseguir ligar um ao outro.
-- -----------------------------------------------------------------------------
select app.habilitar_rls_tenant('titulo_receber_item');

-- -----------------------------------------------------------------------------
-- O fechamento passa a gravar a memória
--
-- `app.fechar_competencia` já calcula o total; o que faltava era registrar de
-- onde ele veio. A gravação acontece na **mesma transação** da criação do
-- título, e não num passo seguinte: memória que pode falhar depois do título
-- criado deixaria cobranças sem explicação, que é exatamente o estado que esta
-- migração existe para eliminar.
-- -----------------------------------------------------------------------------
create or replace function app.gravar_memoria_titulo(
  p_titulo_id   uuid,
  p_contrato_id uuid,
  p_competencia char(7),
  p_usuario     uuid
)
returns integer
language plpgsql
as $$
declare v_n integer;
begin
  insert into public.titulo_receber_item (
    tenant_id, titulo_id, contrato_item_id, equipamento_id, descricao,
    valor_mensal, valor_excedente, desconto,
    paginas_mono, paginas_color, franquia_mono, franquia_color,
    excedente_mono, excedente_color, created_by
  )
  select
    app.tenant_atual(), p_titulo_id, i.contrato_item_id, i.equipamento_id,
    /*
     * Descrição por extenso, montada aqui e não na aplicação.
     *
     * É o texto que o cliente lê ao contestar, e ele precisa dizer **qual
     * máquina** — patrimônio, não uuid. Montar na aplicação faria o portal e o
     * relatório escreverem textos diferentes para a mesma linha.
     */
    coalesce(
      'Locação ' || e.patrimonio || coalesce(' — ' || m.nome, ''),
      'Item de contrato'
    ),
    coalesce(i.valor_mensal, 0),
    i.valor_excedente,
    /*
     * O desconto do item é limitado ao próprio item.
     *
     * `app.desconto_vigente` pode devolver um valor fixo maior que a
     * mensalidade quando o desconto foi negociado no contrato inteiro e o item
     * é pequeno. Sem o teto, o `check` recusaria a linha e o fechamento
     * inteiro falharia por causa de um desconto bem formado.
     */
    least(i.desconto, coalesce(i.valor_mensal, 0) + i.valor_excedente),
    i.paginas_mono, i.paginas_color, i.franquia_mono, i.franquia_color,
    i.excedente_mono, i.excedente_color, p_usuario
  from app.itens_contratuais_competencia(p_contrato_id, p_competencia) i
  left join public.equipamento e on e.id = i.equipamento_id
  left join public.modelo m on m.id = e.modelo_id
  on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function app.gravar_memoria_titulo(uuid, uuid, char, uuid) is
  'Grava a composição do título contratual. Chamada por app.fechar_competencia, na mesma transação.';

-- A chamada, acrescentada ao fechamento logo após a criação do título.
do $$
declare v_fonte text;
begin
  select pg_get_functiondef(p.oid) into v_fonte
    from pg_proc p
   where p.pronamespace = 'app'::regnamespace and p.proname = 'fechar_competencia';

  if v_fonte is null then
    raise exception 'app.fechar_competencia não existe — a 0020 não foi aplicada?';
  end if;

  if position('gravar_memoria_titulo' in v_fonte) > 0 then
    return;  -- já ligada
  end if;

  /*
   * Substituição textual sobre a definição existente, e não reescrita da
   * função inteira.
   *
   * Copiar as duzentas linhas da 0020 para cá criaria duas cópias de uma
   * função que já tem regra densa — RN-F10, RN-F11, idempotência por chave — e
   * a próxima correção precisaria ser feita nas duas, com a certeza de que
   * alguém faria só numa. A âncora é a linha que incrementa o contador de
   * criados, que é exatamente o ponto em que o título acabou de existir.
   */
  v_fonte := replace(
    v_fonte,
    'v_criados := v_criados + 1;',
    'v_criados := v_criados + 1;' || chr(10) ||
    '    perform app.gravar_memoria_titulo(v_id, r.contrato_id, p_competencia, v_usuario);'
  );

  execute v_fonte;
end $$;
