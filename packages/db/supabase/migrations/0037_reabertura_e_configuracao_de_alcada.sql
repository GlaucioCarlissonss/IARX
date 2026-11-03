-- =============================================================================
-- 0037 — Reabertura de competência por alçada e configuração de alçadas
--
-- ## A lacuna que as cinco migrações anteriores criaram
--
-- Entre a 0033 e a 0036 cinco alçadas que dormiam na estrutura passaram a
-- valer — desconto em contrato, custo de OS, ajuste de inventário, ordem de
-- compra e, aqui, reabertura de competência. `alcada` existe desde a 0002 com
-- todos esses tipos no `check`, e **não há rota que grave uma linha nela**.
--
-- Um sistema cujas regras só podem ser configuradas por `INSERT` manual no
-- banco é um sistema cujas regras ninguém configura. A rota de `alcada:definir`
-- entra junto, e esta migração garante do lado do banco o que ela precisa: que
-- o tipo seja conhecido e que o limite faça sentido para o tipo.
--
-- ## Reabertura de competência
--
-- O Anexo B §B.6 traz, na tabela de estados terminais: "Competência | FECHADA |
-- Sim, apenas por alçada (REABERTA)". A 0013 já previa a reabertura no
-- comentário do gatilho — "reabrir é ação legítima e auditada" — e nunca houve
-- como fazê-la.
--
-- Duas condições a governam, e a segunda é a que importa:
--
--  · alçada sobre o **valor da competência**. Reabrir um mês de R$ 500 mil não
--    é a mesma decisão que reabrir um de R$ 2 mil, e o mesmo tipo de `alcada`
--    já mede valor nos outros quatro usos;
--
--  · nenhuma cobrança aprovada. É o que o comentário da 0013 diz com outras
--    palavras: depois de aprovado, o título é o que o cliente recebeu. Reabrir
--    o consumo por trás dele faria a cobrança e a medição divergirem sem que
--    nada acusasse — e a correção prevista para esse caso é estorno com ajuste
--    na competência seguinte, não reabertura.
-- =============================================================================

create or replace function app.limite_reabertura_competencia(p_usuario_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(max(a.limite_valor), 0)
    from public.usuario_perfil up
    join public.alcada a
      on a.perfil_id = up.perfil_id
     and a.tipo = 'REABERTURA_COMPETENCIA'
     and a.tenant_id = app.tenant_atual()
   where up.usuario_id = p_usuario_id;
$$;

create or replace function app.valor_competencia(p_competencia char(7))
returns numeric
language sql
stable
as $$
  select coalesce(sum(t.valor_liquido), 0)
    from public.titulo_receber t
   where t.competencia = p_competencia
     and t.deleted_at is null
     and t.status <> 'CANCELADO';
$$;

/**
 * Reabre a competência: tira o selo dos consumos para que possam ser
 * corrigidos.
 *
 * Devolve quantos consumos foram reabertos. Zero significa "não havia nada
 * fechado nesta competência" — que é diferente de erro, e por isso não levanta:
 * reabrir o que já está aberto é operação sem efeito, não uma falha.
 */
create or replace function app.reabrir_competencia(p_competencia char(7))
returns integer
language plpgsql
as $$
declare
  v_quem      uuid := app.usuario_atual();
  v_limite    numeric;
  v_valor     numeric;
  v_aprovados integer;
  v_n         integer;
begin
  if p_competencia !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Competência inválida: use AAAA-MM.'
      using errcode = '22023', constraint = 'competencia_formato';
  end if;

  /*
   * Cobrança aprovada é o que o cliente recebeu. Reabrir o consumo por trás
   * dela faria a cobrança e a medição divergirem sem que nada acusasse — e a
   * correção prevista para esse caso (RN-L32) é estorno com ajuste na
   * competência seguinte.
   */
  select count(*) into v_aprovados
    from public.titulo_receber t
   where t.competencia = p_competencia
     and t.deleted_at is null
     and t.status in ('APROVADO', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'BAIXADO');

  if v_aprovados > 0 then
    raise exception 'há % cobrança(s) aprovada(s) nesta competência', v_aprovados
      using errcode = '23514',
            constraint = 'competencia_com_cobranca_aprovada',
            hint = 'A correção depois da aprovação é estorno com ajuste na competência seguinte, não reabertura.';
  end if;

  if app.alcada_configurada('REABERTURA_COMPETENCIA') and v_quem is not null then
    v_valor  := app.valor_competencia(p_competencia);
    v_limite := app.limite_reabertura_competencia(v_quem);
    if v_valor > v_limite then
      raise exception 'competência de % excede a alçada de reabertura de %', v_valor, v_limite
        using errcode = '23514',
              constraint = 'competencia_acima_da_alcada',
              hint = 'Reabrir um mês grande não é a mesma decisão que reabrir um pequeno.';
    end if;
  end if;

  update public.consumo_competencia
     set fechado_em = null, fechado_por = null,
         version = version + 1, updated_at = now(), updated_by = v_quem
   where competencia = p_competencia
     and fechado_em is not null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function app.reabrir_competencia(char) is
  'Anexo B §B.6. Reabre por alçada, e nunca depois de a cobrança ter sido aprovada.';

-- -----------------------------------------------------------------------------
-- Uma função para a pergunta "este tipo de alçada está configurado?"
--
-- Quatro cópias dela nasceram entre a 0034 e a 0036 — `alcada_custo_os_
-- configurada`, `alcada_ajuste_configurada`, `alcada_oc_configurada` — cada uma
-- idêntica à anterior com o tipo trocado. A quinta seria a confirmação de que
-- a próxima também seria copiada.
--
-- As antigas continuam existindo e passam a delegar: elas são chamadas de
-- dentro de gatilhos já criados, e trocar a chamada em cada um para apagar três
-- funções de uma linha seria mexer em código que funciona para ganhar menos do
-- que o risco.
-- -----------------------------------------------------------------------------
create or replace function app.alcada_configurada(p_tipo text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.alcada a
     where a.tipo = p_tipo
       and a.limite_valor is not null
       and a.tenant_id = app.tenant_atual()
  );
$$;

create or replace function app.alcada_custo_os_configurada()
returns boolean language sql stable as $$ select app.alcada_configurada('CUSTO_OS'); $$;

create or replace function app.alcada_ajuste_configurada()
returns boolean language sql stable as $$ select app.alcada_configurada('AJUSTE_INVENTARIO'); $$;

create or replace function app.alcada_oc_configurada()
returns boolean language sql stable as $$ select app.alcada_configurada('ORDEM_COMPRA'); $$;

-- -----------------------------------------------------------------------------
-- Coerência da própria alçada
--
-- `alcada_tem_limite` (0002) exige **algum** dos dois limites. O que faltava é
-- que o limite seja o certo para o tipo: um teto percentual em `CUSTO_OS` não
-- é lido por ninguém, e quem o cadastrar vai acreditar que configurou a regra.
-- Alçada que existe e não vale é pior que alçada ausente, porque ninguém
-- procura o que acha que já fez.
-- -----------------------------------------------------------------------------
create or replace function app.validar_alcada()
returns trigger
language plpgsql
as $$
begin
  if new.tipo = 'DESCONTO' then
    if new.limite_percentual is null then
      raise exception 'alçada de desconto é percentual'
        using errcode = '23514',
              constraint = 'alcada_desconto_percentual',
              hint = 'RN-009 mede desconto em percentual, não em reais.';
    end if;
  else
    if new.limite_valor is null then
      raise exception 'alçada de % é em valor', new.tipo
        using errcode = '23514',
              constraint = 'alcada_tipo_exige_valor',
              hint = 'Só a alçada de desconto é percentual; as demais medem reais.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists alcada_valida on public.alcada;
create trigger alcada_valida
  before insert or update on public.alcada
  for each row execute function app.validar_alcada();
