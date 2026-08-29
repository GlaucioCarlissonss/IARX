-- =============================================================================
-- 0022 — Escopo de cliente: a restrição que recusa o que o enum aceita
--
-- Referências: docs/anexos/C-matriz-de-permissoes.md §C.1 (a fórmula de
--              autorização), docs/anexos/L-lacunas-funcionais.md §Módulo 5
--
-- A migração 0011 acrescentou `CLIENTE` e `LOCAL_CLIENTE` a `app.escopo_tipo`
-- para o eixo de cliente (D-01), e **não atualizou a restrição que valida a
-- combinação de tipo e id** — `usuario_perfil_escopo_coerente`, escrita na 0002,
-- quando os dois valores ainda não existiam.
--
-- O resultado é uma restrição que recusa os dois valores em qualquer
-- combinação: com id e sem id. Nenhum dos dois ramos os menciona, e um CHECK que
-- não casa com nenhum ramo é falso.
--
-- Consequência: **o eixo de cliente inteiro é inalcançável.** Toda a estrutura
-- que a 0011 criou — `app.clientes_visiveis`, `app.habilitar_rls_cliente`, as
-- políticas restritivas em nove tabelas, os três perfis de cliente
-- provisionados por gatilho — depende de alguém ter um `usuario_perfil` com
-- escopo de cliente, e essa linha nunca pôde ser inserida.
--
-- Nada aqui é regra de negócio nova. É a restrição alcançando os valores que o
-- tipo já tem.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A coerência entre tipo de escopo e id
--
-- Três grupos, e o que separa é se o escopo aponta para uma linha:
--
--  · `TENANT` e `PROPRIO` não levam id — o primeiro é o locatário inteiro, o
--    segundo é "os registros do próprio usuário", e nenhum dos dois delimita
--    por uma linha específica;
--  · `EMPRESA`, `FILIAL`, `REGIAO` e `LOCAL_CLIENTE` exigem id — cada um aponta
--    para a linha que delimita;
--  · `CLIENTE` **não** leva id, e é o caso que merece explicação.
--
-- Por que `CLIENTE` não tem id: o cliente do usuário já vem do token, em
-- `app.cliente_id`, e é dali que `app.clientes_visiveis()` resolve o grupo
-- econômico. Repetir o id aqui criaria duas fontes para a mesma verdade — e a
-- pergunta "qual vale quando divergem" não tem resposta boa. O escopo declara
-- **a forma** do recorte; o token diz **de quem**.
--
-- `LOCAL_CLIENTE`, ao contrário, precisa do id: ele existe justamente para
-- recortar abaixo do cliente, e o token não carrega qual local. É esse escopo
-- que RN-L26 e RN-L34 vão consumir — o gestor de unidade que não deve alcançar
-- o consolidado do grupo.
-- -----------------------------------------------------------------------------
alter table public.usuario_perfil drop constraint if exists usuario_perfil_escopo_coerente;
alter table public.usuario_perfil add constraint usuario_perfil_escopo_coerente check (
  (escopo_tipo in ('TENANT', 'PROPRIO', 'CLIENTE') and escopo_id is null)
  or (escopo_tipo in ('EMPRESA', 'FILIAL', 'REGIAO', 'LOCAL_CLIENTE') and escopo_id is not null)
);

comment on constraint usuario_perfil_escopo_coerente on public.usuario_perfil is
  'Escopo sem id: TENANT, PROPRIO e CLIENTE — este último porque o cliente vem do token, não da linha.';
