-- =============================================================================
-- 0034 — Alçada de custo de ordem de serviço (`os:custo_aprovar`)
--
-- Terceira alçada que já existia na estrutura e não era consultada. `alcada`
-- nasceu na 0002 com `tipo = 'CUSTO_OS'` entre os valores aceitos, e nada
-- nunca o leu — como `DESCONTO` não era lido do lado do contrato até a 0033.
--
-- ## Onde a alçada morde, e por quê
--
-- Na **validação**. O Anexo B.3 diz que `CONCLUÍDA → VALIDADA` "lança custo no
-- resultado": é a transição em que o custo da ordem deixa de ser apontamento
-- de campo e vira número de margem por ativo e por cliente (RN-025). Antes
-- dela não há o que aprovar; depois dela, aprovar seria tarde.
--
-- O Anexo C descreve `os:custo_aprovar` como "aprovar OS acima do limite
-- (alçada)" e **não lhe dá rota** no Anexo D. Essa ausência é informação: a
-- permissão não é um passo a mais no fluxo, é uma condição sobre um passo que
-- já existe. Fica registrada como leitura, não como especificação.
--
-- ## A alçada só morde onde foi configurada
--
-- É a convenção que a 0019 já estabeleceu para aprovação de pagamento: sem
-- nenhuma linha de `alcada` do tipo, nada é exigido. O contrário — teto zero
-- por omissão — travaria a validação de toda ordem com custo em um locatário
-- que nunca configurou alçada, e a primeira reação de quem tem o sistema
-- parado é desligar a regra, não configurá-la.
--
-- ## Duas camadas, duas perguntas
--
-- O banco responde "até quanto esta pessoa valida"; a API responde "esta
-- pessoa pode validar ordem cara". São perguntas diferentes e as duas
-- precisam de resposta: só a primeira deixaria qualquer um validar até o teto
-- do seu perfil sem a permissão; só a segunda não teria teto nenhum.
-- =============================================================================

create or replace function app.limite_custo_os(p_usuario_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(max(a.limite_valor), 0)
    from public.usuario_perfil up
    join public.alcada a
      on a.perfil_id = up.perfil_id
     and a.tipo = 'CUSTO_OS'
     and a.tenant_id = app.tenant_atual()
   where up.usuario_id = p_usuario_id;
$$;

comment on function app.limite_custo_os(uuid) is
  'Teto de custo de OS que o usuário pode validar. Zero só significa "nenhum" quando há alçada CUSTO_OS configurada no locatário.';

create or replace function app.alcada_custo_os_configurada()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.alcada a
     where a.tipo = 'CUSTO_OS'
       and a.limite_valor is not null
       and a.tenant_id = app.tenant_atual()
  );
$$;

create or replace function app.validar_custo_os()
returns trigger
language plpgsql
as $$
declare
  v_quem   uuid;
  v_limite numeric;
  v_custo  numeric;
begin
  if new.status <> 'VALIDADA' or old.status = 'VALIDADA' then
    return new;
  end if;

  /*
   * As parcelas, e não `custo_total`.
   *
   * `custo_total` é coluna gerada, e o PostgreSQL só a calcula **depois** dos
   * gatilhos BEFORE — aqui ela vem nula, sempre. Lê-la faria esta guarda
   * passar em todos os casos e parecer instalada, que é a pior forma de uma
   * regra falhar: silenciosamente e com teste verde, se o teste medir a
   * ausência de erro em vez da recusa.
   *
   * A soma repete a expressão da coluna gerada da 0026. É duplicação, e é a
   * menos ruim das opções: a alternativa seria mover a guarda para AFTER, onde
   * ela não poderia mais recusar a escrita.
   */
  v_custo := coalesce(new.custo_mao_obra, 0) + coalesce(new.custo_material, 0)
           + coalesce(new.custo_terceiros, 0) + coalesce(new.custo_deslocamento, 0);

  if v_custo = 0 then
    return new;
  end if;

  if not app.alcada_custo_os_configurada() then
    return new;
  end if;

  v_quem := coalesce(new.validado_por, app.usuario_atual());
  if v_quem is null then
    return new;
  end if;

  v_limite := app.limite_custo_os(v_quem);
  if v_custo > v_limite then
    raise exception 'custo de % excede a alçada de % para validação de OS',
                    v_custo, v_limite
      using errcode = '23514',
            constraint = 'os_custo_acima_da_alcada',
            hint = 'A validação lança o custo no resultado (Anexo B.3). Peça a validação a quem tem alçada maior.';
  end if;

  return new;
end;
$$;

/*
 * Este gatilho precisa rodar **depois** de `os_transicao` (0026), e o nome é o
 * que garante isso: gatilhos BEFORE do mesmo evento disparam em ordem
 * alfabética de nome, e `os_valida_custo` vem depois de `os_transicao`.
 *
 * A ordem importa porque as duas recusas mandam o operador a lugares
 * diferentes. `os_transicao` responde se a transição existe — mapa do B.3 e
 * segregação de RN-027. A alçada responde se **esta pessoa** a faz. Recusar
 * por alçada uma transição que nem seria permitida mandaria alguém procurar
 * quem tem alçada maior quando o problema é o estado da ordem.
 *
 * Renomear qualquer um dos dois inverte a ordem em silêncio.
 */
drop trigger if exists os_valida_custo on public.ordem_servico;
create trigger os_valida_custo
  before update of status on public.ordem_servico
  for each row execute function app.validar_custo_os();
