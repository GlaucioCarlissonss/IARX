-- =============================================================================
-- 0035 — Reserva de peça na OS (Anexo B.5) e a alçada de ajuste de inventário
--
-- Quarta máquina de estados que existia no anexo e não no banco. `os_peca`
-- nasceu na 0027 com os seis status do B.5 — SOLICITADA, RESERVADA, CONSUMIDA,
-- DEVOLVIDA, EM_FALTA, CANCELADA — e nenhum gatilho os governa.
--
-- É a que fecha o circuito entre três módulos. A peça sai do estoque, entra no
-- custo da OS, e o custo da OS entra na margem do ativo e do cliente (RN-025).
-- Sem a máquina, cada um desses três passos depende de alguém lembrar de
-- escrever o número no lugar certo — e o B.5 descreve exatamente os efeitos no
-- saldo que ninguém estava aplicando:
--
--   SOLICITADA → RESERVADA  reservada += qtd (disponível cai, físico fica)
--   RESERVADA  → CONSUMIDA  físico -= qtd, reservada -= qtd, e um
--                           `movimento_estoque` SAIDA_OS com o custo médio do
--                           instante (RN-017)
--   RESERVADA  → DEVOLVIDA  reservada -= qtd, físico inalterado
--   *          → CANCELADA  libera a reserva, se houver
--
-- ## Por que o efeito mora aqui e não no serviço
--
-- Porque o saldo é compartilhado. Duas OS reservando a mesma peça no mesmo
-- instante, com a conta na aplicação, leem o mesmo disponível e reservam as
-- duas. Dentro do gatilho, a atualização de `saldo_estoque` serializa na linha
-- — e o `check` de RN-017 recusa a segunda.
--
-- ## A alçada de ajuste de inventário
--
-- Quarta alçada que já existia na estrutura e não era lida: `alcada` aceita
-- `AJUSTE_INVENTARIO` desde a 0002. Ajuste é o único movimento que cria ou
-- destrói quantidade sem contrapartida — toda diferença entre o sistema e a
-- prateleira passa por ele, e é por isso que ele é o movimento que alguém
-- audita. Mesma convenção das anteriores: a alçada só morde onde foi
-- configurada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Máquina do B.5
-- -----------------------------------------------------------------------------
create or replace function app.os_peca_transicao_valida(
  p_de   app.os_peca_status,
  p_para app.os_peca_status
)
returns boolean
language sql
immutable
as $$
  select
    -- Cancelar alcança qualquer estado vivo: cancelar a OS libera o que ela
    -- tinha reservado, esteja a peça pedida, reservada ou em falta.
    (p_para = 'CANCELADA' and p_de in ('SOLICITADA','RESERVADA','EM_FALTA'))
    or (p_de, p_para) in (
      ('SOLICITADA','RESERVADA'),
      ('SOLICITADA','EM_FALTA'),
      ('EM_FALTA','RESERVADA'),     -- chegou saldo
      ('RESERVADA','CONSUMIDA'),
      ('RESERVADA','DEVOLVIDA')
    );
$$;

comment on function app.os_peca_transicao_valida(app.os_peca_status, app.os_peca_status) is
  'Anexo B.5. CONSUMIDA e DEVOLVIDA são terminais: peça baixada não volta por edição, volta por entrada.';

create or replace function app.aplicar_os_peca()
returns trigger
language plpgsql
as $$
declare
  v_qtd    numeric(14,3);
  v_medio  numeric(15,4);
  v_os     uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'SOLICITADA' then
      raise exception 'peça de OS nasce solicitada'
        using errcode = '23514',
              constraint = 'os_peca_nasce_solicitada',
              hint = 'Anexo B.5: a reserva se atende, não se declara pronta.';
    end if;
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not app.os_peca_transicao_valida(old.status, new.status) then
    raise exception 'transição de peça de OS inválida: % → %', old.status, new.status
      using errcode = '23514',
            constraint = 'os_peca_transicao_valida',
            hint = 'Ver Anexo B.5.';
  end if;

  v_qtd := coalesce(new.quantidade_reservada, 0);
  v_os  := new.ordem_servico_id;

  if new.deposito_id is null then
    raise exception 'reserva de peça exige depósito'
      using errcode = '23514',
            constraint = 'os_peca_sem_deposito',
            hint = 'O saldo é por depósito: sem ele não há de onde reservar nem onde baixar.';
  end if;

  /* ------------------------------------------------------------ reservar */
  if new.status = 'RESERVADA' then
    update public.saldo_estoque s
       set quantidade_reservada = s.quantidade_reservada + v_qtd,
           atualizado_em = now()
     where s.peca_id = new.peca_id and s.deposito_id = new.deposito_id;

    if not found then
      raise exception 'não há saldo desta peça no depósito'
        using errcode = '23514',
              constraint = 'os_peca_sem_saldo',
              hint = 'Registre a entrada no depósito antes de reservar.';
    end if;
  end if;

  /* ------------------------------------------------- liberar sem consumir */
  if new.status in ('DEVOLVIDA','CANCELADA') and old.status = 'RESERVADA' then
    update public.saldo_estoque s
       set quantidade_reservada = greatest(s.quantidade_reservada - v_qtd, 0),
           atualizado_em = now()
     where s.peca_id = new.peca_id and s.deposito_id = new.deposito_id;
  end if;

  /* ------------------------------------------------------------- consumir */
  if new.status = 'CONSUMIDA' then
    /*
     * O custo é o médio **do instante da baixa** (RN-017), lido antes do
     * movimento. Usar o médio de depois misturaria no custo desta OS as
     * entradas que chegaram no mesmo dia — e o custo de uma manutenção deixaria
     * de ser reproduzível a partir do que havia na prateleira quando ela
     * aconteceu.
     */
    select case when s.quantidade_fisica > 0
                then round(s.valor_total / s.quantidade_fisica, 4)
                else 0 end
      into v_medio
      from public.saldo_estoque s
     where s.peca_id = new.peca_id and s.deposito_id = new.deposito_id;

    if v_medio is null then
      raise exception 'não há saldo desta peça no depósito'
        using errcode = '23514', constraint = 'os_peca_sem_saldo';
    end if;

    new.quantidade_consumida := v_qtd;
    new.custo_unitario_baixa := v_medio;

    -- Libera a reserva antes da saída: o `check` de RN-017 compara reservado
    -- com físico, e baixar o físico com a reserva ainda de pé reprovaria uma
    -- baixa que é exatamente o que a reserva existia para permitir.
    update public.saldo_estoque s
       set quantidade_reservada = greatest(s.quantidade_reservada - v_qtd, 0),
           atualizado_em = now()
     where s.peca_id = new.peca_id and s.deposito_id = new.deposito_id;

    insert into public.movimento_estoque
      (tenant_id, peca_id, deposito_id, tipo, quantidade, custo_unitario,
       ordem_servico_id, registrado_por, motivo, created_by)
    values (new.tenant_id, new.peca_id, new.deposito_id, 'SAIDA_OS',
            -v_qtd, v_medio, v_os, app.usuario_atual(),
            'baixa de peça em ordem de serviço', app.usuario_atual());

    /*
     * E o custo entra na OS. Este é o elo que faltava: sem ele a peça sai do
     * estoque e some — o custo de material da ordem fica zero, a margem do
     * ativo fica melhor do que é, e a diferença só aparece no inventário.
     */
    update public.ordem_servico o
       set custo_material = o.custo_material + round(v_medio * v_qtd, 4),
           updated_at = now()
     where o.id = v_os;
  end if;

  return new;
end;
$$;

drop trigger if exists os_peca_maquina on public.os_peca;
create trigger os_peca_maquina
  before insert or update on public.os_peca
  for each row execute function app.aplicar_os_peca();

/*
 * RN-015 — conclusão exige destino definido para toda peça reservada.
 *
 * O anexo lista isso entre as condições de conclusão, e nada conferia. Uma OS
 * concluída com peça ainda RESERVADA deixa saldo comprometido por uma ordem
 * que acabou: a peça não está na prateleira para a próxima OS e não está em
 * lugar nenhum no custo desta.
 */
create or replace function app.validar_pecas_na_conclusao()
returns trigger
language plpgsql
as $$
declare v_n integer;
begin
  if new.status <> 'CONCLUIDA' or old.status = 'CONCLUIDA' then
    return new;
  end if;

  select count(*) into v_n
    from public.os_peca p
   where p.ordem_servico_id = new.id
     and p.status in ('SOLICITADA','RESERVADA','EM_FALTA');

  if v_n > 0 then
    raise exception 'há % peça(s) sem destino definido', v_n
      using errcode = '23514',
            constraint = 'os_peca_sem_destino',
            hint = 'RN-015: toda peça reservada precisa ser consumida, devolvida ou cancelada antes da conclusão.';
  end if;

  return new;
end;
$$;

/*
 * O nome põe este gatilho **depois** de `os_transicao` (0026), porque gatilhos
 * BEFORE do mesmo evento disparam em ordem alfabética e `os_valida_pecas` vem
 * depois de `os_transicao`. É a ordem que importa: primeiro se a transição
 * existe no mapa do B.3, depois se os pré-requisitos dela estão cumpridos.
 *
 * Com `os_valida_custo` (0034) não há ordem a acertar — aquele guarda a
 * validação e este a conclusão, e as duas transições nunca são a mesma.
 */
drop trigger if exists os_valida_pecas on public.ordem_servico;
create trigger os_valida_pecas
  before update of status on public.ordem_servico
  for each row execute function app.validar_pecas_na_conclusao();

-- -----------------------------------------------------------------------------
-- Alçada de ajuste de inventário
-- -----------------------------------------------------------------------------
create or replace function app.limite_ajuste_estoque(p_usuario_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(max(a.limite_valor), 0)
    from public.usuario_perfil up
    join public.alcada a
      on a.perfil_id = up.perfil_id
     and a.tipo = 'AJUSTE_INVENTARIO'
     and a.tenant_id = app.tenant_atual()
   where up.usuario_id = p_usuario_id;
$$;

create or replace function app.alcada_ajuste_configurada()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.alcada a
     where a.tipo = 'AJUSTE_INVENTARIO'
       and a.limite_valor is not null
       and a.tenant_id = app.tenant_atual()
  );
$$;

create or replace function app.validar_alcada_ajuste()
returns trigger
language plpgsql
as $$
declare
  v_quem   uuid;
  v_limite numeric;
  v_valor  numeric;
begin
  if new.tipo <> 'AJUSTE_INVENTARIO' then
    return new;
  end if;

  if not app.alcada_ajuste_configurada() then
    return new;
  end if;

  v_quem := coalesce(new.registrado_por, app.usuario_atual());
  if v_quem is null then
    return new;
  end if;

  /*
   * O que a alçada mede é o **valor** do ajuste, em módulo. Sobra e falta
   * custam a mesma atenção: uma esconde furto e a outra esconde compra não
   * lançada, e as duas aparecem como diferença de inventário.
   */
  v_valor := abs(coalesce(new.quantidade, 0) * coalesce(new.custo_unitario, 0));
  v_limite := app.limite_ajuste_estoque(v_quem);

  if v_valor > v_limite then
    raise exception 'ajuste de % excede a alçada de %', v_valor, v_limite
      using errcode = '23514',
            constraint = 'estoque_ajuste_acima_da_alcada',
            hint = 'Ajuste é o único movimento que cria ou destrói quantidade sem contrapartida.';
  end if;

  return new;
end;
$$;

drop trigger if exists movimento_valida_alcada on public.movimento_estoque;
create trigger movimento_valida_alcada
  before insert on public.movimento_estoque
  for each row execute function app.validar_alcada_ajuste();
