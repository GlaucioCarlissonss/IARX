-- =============================================================================
-- 0038 — Visões salvas de lista (Anexo Y §Y.3.5)
--
-- ## O achado
--
-- Quem cuida de preventiva vencida remonta o mesmo filtro toda manhã. Quem
-- cobra refaz o recorte de vencidos. Não há onde guardar um recorte, e o
-- filtro nem sobrevive à navegação — voltar da tela do equipamento devolve a
-- lista inteira.
--
-- ## O que é uma visão
--
-- Um **nome** dado a uma consulta de lista: os filtros, a ordenação e as
-- colunas. Nunca os registros. Abrir a visão de amanhã mostra o que estiver
-- valendo amanhã — é essa a diferença entre uma visão e um relatório tirado.
--
-- ## Pessoal e compartilhada
--
-- Duas, e não uma. A decisão registrada no Anexo Y era "compartilhadas no
-- locatário", e sozinha ela deixaria de fora justamente quem tem o problema: o
-- técnico e o cobrador resolveriam o próprio dia pedindo a alguém com
-- permissão. Então:
--
--  · **pessoal** — qualquer um que abre a tela salva a sua. Sem permissão
--    nova: a linha é dela, e a política de leitura já a esconde dos demais;
--  · **compartilhada** — aparece para todo o locatário, e exige
--    `visao:compartilhar`. Publicar um recorte para a operação inteira é ato
--    com alcance, e alcance é o que uma permissão mede.
--
-- ## Por que `visao:compartilhar` não é `mapa:filtro_compartilhar`
--
-- O catálogo já reserva `mapa:filtro_compartilhar` desde o Anexo C, sem rota.
-- São coisas diferentes: o filtro do mapa é recorte geográfico e camadas —
-- um estado de viewport —, não a consulta de uma lista. A permissão antiga
-- fica onde está, como o registro de um requisito ainda não cumprido; quando o
-- mapa ganhar visões, elas moram nesta mesma tabela com `tela = 'mapa'`, e é
-- **aí** que `mapa:filtro_compartilhar` se aposenta. Unificar agora seria
-- apagar o requisito em vez de cumpri-lo.
--
-- ## O que o banco garante, e o que ele não garante
--
-- Garante: que a tela exista no vocabulário, que a consulta seja um objeto,
-- que dois recortes compartilhados não tenham o mesmo nome na mesma tela, e
-- que ninguém publique sem a permissão. Não garante que a consulta faça
-- sentido para a tela — isso é contrato de API, e um `jsonb` validado por
-- esquema no banco envelheceria a cada filtro novo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permissão efetiva do usuário da transação
--
-- A API já barra por `@ExigePermissao`, e esta função não a substitui: ela é a
-- segunda tranca. O gatilho abaixo recusa a publicação sem permissão mesmo que
-- a chamada chegue por outro caminho — e "outro caminho" inclui um `UPDATE`
-- escrito à mão numa correção de produção, que é exatamente quando a regra
-- costuma ser esquecida.
-- -----------------------------------------------------------------------------
create or replace function app.usuario_tem_permissao(p_permissao text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from public.usuario_perfil up
      join public.perfil p on p.id = up.perfil_id
     where up.usuario_id = app.usuario_atual()
       and p.deleted_at is null
       and p_permissao = any (p.permissoes)
  );
$$;

comment on function app.usuario_tem_permissao(text) is
  'Permissão efetiva do usuário da transação, pela união dos perfis. Segunda tranca: a primeira é @ExigePermissao na API.';

-- -----------------------------------------------------------------------------
-- As telas que têm visão
--
-- Enum e não texto livre. Com texto, renomear uma tela deixa visões órfãs que
-- ninguém encontra para apagar — e elas continuam ocupando nome no índice
-- único, impedindo que a visão nova use o mesmo rótulo.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tela_com_visao') then
    create type app.tela_com_visao as enum (
      'parque',
      'chamados',
      'contratos',
      'clientes',
      'estoque',
      'notas_fiscais',
      'contas_receber',
      'contas_pagar'
    );
  end if;
end $$;

create table if not exists public.visao_salva (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete restrict,

  tela          app.tela_com_visao not null,
  nome          text not null,

  /* Os parâmetros da consulta, como vão para a URL.
     `jsonb` e não `text`: uma string opaca não se consulta, e a primeira
     pergunta que alguém faz sobre esta tabela é "quais visões filtram por
     filial?" — que em texto exige `like` sobre a query inteira. */
  consulta      jsonb not null default '{}'::jsonb,

  compartilhada boolean not null default false,

  /* Quem criou. **Nunca nulo, nem nas compartilhadas**: é o nome que aparece
     ao lado da visão da equipe, e sem ele ninguém sabe a quem perguntar por
     que o recorte é aquele. */
  dono_id       uuid not null references public.usuario(id) on delete restrict,

  ordem         integer not null default 0,

  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,

  constraint visao_salva_nome_tamanho check (
    length(btrim(nome)) between 1 and 60
  ),
  constraint visao_salva_consulta_e_objeto check (
    jsonb_typeof(consulta) = 'object'
  )
);

/*
 * Dois índices únicos, e não um.
 *
 * Compartilhada: o nome é do locatário, porque dois chips "Preventiva vencida"
 * lado a lado são indistinguíveis para quem clica.
 *
 * Pessoal: o nome é de quem a criou. Impedir que duas pessoas chamem a sua
 * visão de "Minha ronda" seria tomar do segundo um nome que ele nem sabe que
 * já existe — a visão da outra pessoa é invisível para ele.
 *
 * `lower(nome)` nos dois: "Vencidos" e "vencidos" são o mesmo chip aos olhos.
 */
create unique index if not exists visao_salva_equipe_uk
  on public.visao_salva (tenant_id, tela, lower(btrim(nome)))
  where compartilhada;

create unique index if not exists visao_salva_pessoal_uk
  on public.visao_salva (tenant_id, tela, dono_id, lower(btrim(nome)))
  where not compartilhada;

create index if not exists visao_salva_tela_ix
  on public.visao_salva (tenant_id, tela, ordem, created_at);

comment on table public.visao_salva is
  'Anexo Y §Y.3.5. Recorte nomeado de uma lista: filtros, ordenação e colunas — nunca os registros.';
comment on column public.visao_salva.consulta is
  'Parâmetros da consulta como vão para a URL. O banco garante que é objeto; a forma é contrato de API.';

-- -----------------------------------------------------------------------------
-- Publicar exige permissão — e a conferência é na escrita, não na leitura
--
-- A política de leitura já mostraria a visão compartilhada a todo mundo. Se a
-- conferência vivesse só lá, o `UPDATE` que marca `compartilhada` passaria, a
-- linha ficaria publicada e a recusa só apareceria — como ausência — para quem
-- tentasse ler. Recusar na escrita é o que faz o erro aparecer para quem o
-- cometeu, no momento em que o cometeu.
-- -----------------------------------------------------------------------------
create or replace function app.validar_visao_compartilhada()
returns trigger
language plpgsql
as $$
begin
  -- Só confere quando a visão nasce publicada ou passa a ser.
  if new.compartilhada and (tg_op = 'INSERT' or not old.compartilhada) then
    if not app.usuario_tem_permissao('visao:compartilhar') then
      raise exception 'publicar uma visão para o locatário exige visao:compartilhar'
        using errcode = '23514',
              constraint = 'visao_compartilhar_sem_permissao',
              hint = 'Salve como visão pessoal, ou peça a permissão ao administrador.';
    end if;
  end if;

  /*
   * Editar a visão da equipe de outra pessoa pede a mesma permissão.
   *
   * Sem isto, quem só pode criar visão pessoal poderia renomear ou reapontar o
   * recorte que a operação inteira usa de manhã — mudança com o alcance de uma
   * publicação, feita sem a permissão que a publicação exige.
   */
  if tg_op = 'UPDATE' and old.compartilhada then
    if old.dono_id <> app.usuario_atual()
       and not app.usuario_tem_permissao('visao:compartilhar') then
      raise exception 'alterar visão compartilhada de outra pessoa exige visao:compartilhar'
        using errcode = '23514',
              constraint = 'visao_alheia_sem_permissao',
              hint = 'Use "Duplicar como minha" para ajustar o recorte sem mexer no da equipe.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists visao_salva_valida_compartilhamento on public.visao_salva;
create trigger visao_salva_valida_compartilhamento
  before insert or update on public.visao_salva
  for each row execute function app.validar_visao_compartilhada();

-- -----------------------------------------------------------------------------
-- RLS
--
-- O padrão da 0006 dá "tudo do meu tenant". Aqui ele é estreitado: a visão
-- pessoal de alguém não aparece para ninguém, **nem para o administrador**.
-- Isso é propriedade da política, não da interface — uma tela que só esconde
-- deixa o dado acessível a quem chamar a rota direto.
-- -----------------------------------------------------------------------------
do $$
begin
  perform app.habilitar_rls_tenant('visao_salva', false);
  perform app.habilitar_auditoria('visao_salva');

  execute 'drop trigger if exists visao_salva_touch on public.visao_salva';
  execute 'create trigger visao_salva_touch before update on public.visao_salva
             for each row execute function app.touch_updated_at()';

  -- Substitui a política ampla por uma que também separa por dono.
  execute 'drop policy if exists visao_salva_app on public.visao_salva';
  execute $pol$
    create policy visao_salva_app on public.visao_salva for all to iarx_app
      using (
        tenant_id = app.tenant_atual()
        and (compartilhada or dono_id = app.usuario_atual())
      )
      with check (
        tenant_id = app.tenant_atual()
        and (compartilhada or dono_id = app.usuario_atual())
      )
  $pol$;
end $$;
