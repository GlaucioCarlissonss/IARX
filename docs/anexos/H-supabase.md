# Anexo H — Adoção do Supabase como plataforma de dados

> **Status:** decisão aceita · **Substitui:** escolhas de banco, identidade e storage das seções 7.3, 7.5 e 11.6
> **Natureza:** ADR (Architecture Decision Record) com guia de implementação

---

## H.1 Decisão

O PostgreSQL da plataforma será provisionado e operado via **Supabase**, que passa a fornecer também
**autenticação** (Supabase Auth/GoTrue), **storage de anexos** e, opcionalmente, **Realtime** para a
central de alertas.

**Por que é uma boa escolha para esta plataforma, e não apenas uma conveniência:**

| Requisito já definido na proposta | Como o Supabase atende |
| --- | --- |
| PostgreSQL com RLS como base do isolamento multiempresa (`RN-028`) | RLS é o idioma central do produto, não um recurso periférico — políticas, `auth.uid()` e `auth.jwt()` são de primeira classe |
| `EXCLUDE USING gist` para impedir dupla alocação (`RN-001`) | É PostgreSQL real, sem restrição de DDL: constraints, triggers, partições e extensões funcionam |
| PostGIS para o mapa operacional | Extensão disponível e habilitável por migração |
| Auditoria append-only com particionamento | `pg_cron` para manutenção de partições; sem limitação de esquema |
| Time pequeno na Fase 0 (13.5) | Elimina o trabalho de operar Keycloak, S3, pooler e backups separadamente |
| Storage com URL assinada | Nativo, com políticas de acesso ligadas ao mesmo RLS |

**Ganho concreto de cronograma:** a Fase 0 encurta em aproximadamente 1 a 1,5 semana, sobretudo por
não haver provisionamento e operação de servidor de identidade próprio.

---

## H.2 O risco que esta decisão introduz — e como é contido

Este é o ponto mais importante do anexo.

O Supabase oferece um caminho muito conveniente que **é incorreto para este domínio**: expor o banco
diretamente ao navegador via PostgREST, usando RLS como única camada de autorização. Funciona bem
para aplicações CRUD. Não funciona aqui, porque as regras que sustentam o negócio **não são
expressáveis como política de linha**:

| Regra | Por que RLS não resolve |
| --- | --- |
| `RN-001` dupla alocação | A constraint impede o estado inválido, mas a *escolha* de qual ativo alocar, a substituição e o pro-rata resultante são orquestração transacional |
| Motor de faturamento (Anexo E) | 12 etapas de precedência, franquia por *pool*, mínimo mensal, memória de cálculo — lógica de aplicação, não predicado de linha |
| Máquinas de estado (Anexo B) | Transição válida depende de pré-condições em múltiplas entidades e publica eventos |
| Alçadas por valor (Anexo C.5) | Autorização depende do *valor da operação*, não da identidade do requisitante |
| `RN-015` conclusão de OS | Exige verificação de completude entre OS, apontamentos e reservas de peça |
| `RN-027` segregação de funções | Depende de quem executou uma ação anterior |

**Contenção — três regras não negociáveis:**

1. **Toda escrita passa pela API de domínio.** O cliente (web e PWA) nunca escreve via PostgREST.
   As rotas de escrita do PostgREST ficam desabilitadas por ausência de política de `INSERT`,
   `UPDATE` e `DELETE` para os papéis `anon` e `authenticated` nas tabelas de negócio.
2. **`service_role` nunca sai do servidor e nunca é o papel de operação normal.** A chave
   `service_role` **ignora RLS por completo** — usá-la no runtime da API destruiria `RN-028` de forma
   silenciosa. A API conecta com um papel dedicado (`iarx_app`) **sujeito a RLS**. O `service_role`
   fica restrito a migrações e rotinas administrativas explícitas.
3. **Leitura direta do cliente é permitida apenas onde for deliberada.** Consultas de leitura de
   baixo risco (catálogo, notificações do próprio usuário, Realtime de alertas) podem usar
   PostgREST/Realtime com RLS. Qualquer leitura financeira ou de rentabilidade passa pela API, porque
   depende de escopo organizacional e de mascaramento de dado sensível.

```
        ┌──────────────┐   ┌──────────────┐
        │  Web (Next)  │   │  PWA campo   │
        └──────┬───────┘   └──────┬───────┘
               │  escrita: sempre │
               ▼                  ▼
        ┌────────────────────────────────────┐      leitura de baixo risco
        │   API de domínio (NestJS)          │◄─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
        │   invariantes · máquinas de estado │                         │
        │   alçadas · motor de faturamento   │                         │
        └───────────────┬────────────────────┘                         │
      papel iarx_app    │  (sujeito a RLS)                             │
                        ▼                                    PostgREST / Realtime
        ┌────────────────────────────────────────────────────────────────────┐
        │  Supabase — PostgreSQL + RLS + Auth + Storage                      │
        │  service_role: apenas migrações e rotinas administrativas          │
        └────────────────────────────────────────────────────────────────────┘
```

---

## H.3 Mapeamento de componentes

| Necessidade | Proposta original (seção 7) | Com Supabase | Observação |
| --- | --- | --- | --- |
| Banco relacional | PostgreSQL 16 + PostGIS autogerenciado | **Supabase Postgres** + PostGIS | Sem mudança de modelo de dados (Anexo A vale integralmente) |
| Pooling | PgBouncer | **Supavisor** (modo transação) | Ver H.5 — impacta `SET LOCAL` e prepared statements |
| Identidade | Keycloak (OIDC) | **Supabase Auth** | MFA/TOTP nativo; SSO corporativo depende do plano |
| Autorização | RBAC + ABAC na aplicação | **Idêntico** + RLS no banco | Supabase não substitui o modelo do Anexo C |
| Storage de anexos | S3 + URL assinada | **Supabase Storage** | Antivírus não é nativo — ver H.7 |
| Fila/jobs | Redis + BullMQ | **Decisão em H.6** | Recomendação: manter BullMQ na Fase 0–1 |
| Agendador | BullMQ repeatable jobs | **`pg_cron`** ou BullMQ | `pg_cron` cobre bem manutenção de partições |
| Tempo real | — | **Realtime** (opcional) | Ganho gratuito para a central de alertas |
| Backup/PITR | Configuração própria | **Recurso do plano** | Ver H.8 — RPO ≤ 5 min exige plano com PITR |
| Réplica de leitura | Réplica gerenciada | **Recurso do plano** | Confirmar disponibilidade no tier contratado |

---

## H.4 Identidade, claims e autorização

Supabase Auth emite o JWT, mas **os claims de negócio precisam ser injetados** — sem isso, as
políticas de RLS não têm como saber o tenant nem o escopo do usuário.

### H.4.1 Custom Access Token Hook

Uma função no Postgres é registrada como *hook* de emissão de token e enriquece o JWT:

```sql
create or replace function auth.iarx_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims    jsonb := coalesce(event->'claims', '{}'::jsonb);
  v_usuario record;
  v_perfis  text[];
  v_escopos jsonb;
begin
  select u.id, u.tenant_id into v_usuario
  from public.usuario u
  where u.subject_oidc = (event->>'user_id')::uuid
    and u.status = 'ATIVO'
    and u.deleted_at is null;

  if v_usuario.id is null then
    -- usuário sem vínculo ativo: token sem tenant não passa por nenhuma política
    return jsonb_set(event, '{claims}', claims);
  end if;

  select coalesce(array_agg(distinct p.nome), '{}')
    into v_perfis
  from public.usuario_perfil up
  join public.perfil p on p.id = up.perfil_id
  where up.usuario_id = v_usuario.id;

  select coalesce(jsonb_agg(jsonb_build_object('tipo', up.escopo_tipo, 'id', up.escopo_id)), '[]'::jsonb)
    into v_escopos
  from public.usuario_perfil up
  where up.usuario_id = v_usuario.id;

  claims := claims
    || jsonb_build_object('tenant_id', v_usuario.tenant_id)
    || jsonb_build_object('usuario_id', v_usuario.id)
    || jsonb_build_object('perfis', to_jsonb(v_perfis))
    || jsonb_build_object('escopos', v_escopos);

  return jsonb_set(event, '{claims}', claims);
end;
$$;
```

### H.4.2 Obsolescência de claim — o problema que isto cria

Claims ficam congelados na validade do access token. Se um usuário é desligado ou perde uma
permissão, o token já emitido continua válido até expirar. Mitigações adotadas:

| Medida | Definição |
| --- | --- |
| TTL curto do access token | 15 min, conforme já definido em 7.5 |
| Verificação de sessão na API | Operações sensíveis (emitir fatura, desbloquear ativo, aprovar pagamento) revalidam perfil e escopo **no banco**, não no claim |
| Revogação imediata | Desativação de usuário chama a API de admin do Supabase para invalidar as sessões e revogar refresh tokens |
| `tenant_id` como exceção | Não muda durante a vida do usuário — pode ser confiado a partir do claim |

**Regra prática:** o claim serve para *filtrar* (RLS) e para o caminho de leitura; **alçada e
permissão sensível são sempre verificadas contra o banco**.

---

## H.5 RLS e contexto de tenant

### H.5.1 Duas origens de contexto

A plataforma tem dois tipos de conexão, e a política precisa aceitar ambas:

| Origem | Como o tenant chega | Uso |
| --- | --- | --- |
| Cliente via PostgREST/Realtime | Claim `tenant_id` no JWT → `auth.jwt()` | Leituras de baixo risco |
| API de domínio (papel `iarx_app`) | `SET LOCAL app.tenant_id` por transação | Todo o resto |

```sql
-- Resolve o tenant efetivo, independentemente da origem da conexão
create or replace function app.tenant_atual()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.tenant_id', true), '')::uuid,
    nullif(auth.jwt() ->> 'tenant_id', '')::uuid
  );
$$;

-- Política padrão aplicada a toda tabela de negócio
create policy tenant_isolation on public.contrato
  for all
  to authenticated, iarx_app
  using (tenant_id = app.tenant_atual())
  with check (tenant_id = app.tenant_atual());
```

**Ordem deliberada do `coalesce`:** o `SET LOCAL` tem precedência sobre o JWT para permitir que a API
opere em nome de um tenant em jobs assíncronos (fechamento, réguas), quando não há JWT de usuário.

### H.5.2 Compatibilidade com o pooler em modo transação

O Supavisor em modo transação reaproveita conexões entre transações. Consequências práticas:

| Cuidado | Razão |
| --- | --- |
| Usar **`SET LOCAL`**, nunca `SET` de sessão | `SET` vazaria o tenant para a próxima transação de outro usuário na mesma conexão — falha de isolamento crítica |
| Todo comando de domínio roda **dentro de transação explícita** | `SET LOCAL` só tem efeito dentro de transação; fora dela, seria silenciosamente ignorado |
| Desabilitar prepared statements no cliente | Prisma exige `pgbouncer=true` na URL em modo transação |
| Não depender de `LISTEN/NOTIFY` na conexão da API | Não sobrevive ao pooler; usar Realtime ou fila |
| Conexão direta (porta 5432) apenas para migrações | Migração precisa de sessão estável |

**Teste de regressão obrigatório:** a suíte de isolamento (`RN-028`) deve executar duas transações
consecutivas de tenants diferentes **na mesma conexão** e provar que a segunda não vê dados da
primeira. Sem esse teste, o vazamento por `SET` de sessão passaria despercebido.

---

## H.6 Migrações, filas e propriedade do schema

### H.6.1 Um único dono do schema

Misturar `prisma migrate` com migrações do Supabase CLI produz divergência de estado. Decisão:

| Camada | Ferramenta | Papel |
| --- | --- | --- |
| Schema, RLS, constraints, triggers, partições, extensões, funções | **Supabase CLI (SQL versionado)** | Fonte única da verdade |
| Tipos e cliente de acesso a dados | **Prisma em modo somente leitura de schema** (`prisma db pull` + `generate`) | Nunca `prisma migrate` |

Racional: a proposta depende de recursos que o Prisma não modela bem — `EXCLUDE USING gist`, políticas
RLS, triggers de auditoria, particionamento, funções de claims. Escrever SQL explícito não é
retrocesso aqui; é a única forma de expressar as invariantes que sustentam `RN-001`, `RN-017`,
`RN-018` e `RN-022`.

### H.6.2 Filas e jobs

| Opção | Quando escolher | Avaliação |
| --- | --- | --- |
| **Redis + BullMQ** (mantido da seção 7) | Fase 0–1 | **Recomendado.** Fechamento de faturamento, exportações e importações são jobs longos com retentativa, prioridade e observabilidade — território natural do BullMQ |
| `pgmq` (fila no Postgres) | Se o objetivo for eliminar o Redis | Reduz um componente, mas concentra carga no banco que também atende o transacional |
| `pg_cron` | **Adotado** para agendamento | Manutenção de partições, réguas diárias, marcação de faturas vencidas |
| Edge Functions | Webhooks de entrada e callbacks leves | Evitar para lógica de domínio: o domínio vive na API, não em funções isoladas |

Decisão: **BullMQ para trabalho pesado + `pg_cron` para agendamento no banco.** Reavaliar `pgmq` na
Fase 3, com dado real de carga.

---

## H.7 Storage de anexos

| Aspecto | Definição |
| --- | --- |
| Buckets | `anexos-contrato`, `anexos-os`, `anexos-equipamento`, `exportacoes` — todos privados |
| Autorização | Política de storage por `tenant_id` no *path* (`{tenant_id}/{entidade}/{id}/{arquivo}`) |
| Upload | URL assinada emitida pela API após validar permissão e tipo — o cliente nunca recebe chave de escrita ampla |
| Download | URL assinada de 60 min, com registro de acesso em auditoria para documento sensível |
| Verificação de tipo | Validação do *magic number* no servidor, não da extensão |
| **Antivírus — lacuna** | Não é nativo. Implementar Edge Function disparada por evento de upload que envia o objeto a um scanner (ClamAV em serviço próprio ou API de terceiro) e marca `antivirus_status` no registro `anexo`. **Anexo com status pendente não é servido por download.** |
| Retenção | Política de ciclo de vida por bucket + rotina de expurgo conforme 11.4 |

---

## H.8 Limites, riscos e o que confirmar antes do go-live

| Item | Risco | Ação |
| --- | --- | --- |
| **Vazamento por `service_role`** | Crítico — ignora RLS | Chave apenas em segredo de CI/migração; varredura no CI proibindo a variável no bundle do frontend; papel `iarx_app` no runtime |
| **`SET` de sessão em vez de `SET LOCAL`** | Crítico — vaza tenant entre requisições | Teste de isolamento em conexão compartilhada (H.5.2) |
| **Escrita direta via PostgREST** | Alto — contorna invariantes | Ausência de políticas de escrita para `anon`/`authenticated`; revisão obrigatória em PR que crie política de escrita |
| **PITR** | RPO ≤ 5 min (11.8) depende de recurso pago | Confirmar tier contratado; se indisponível, RPO real é o do backup diário — **precisa ser aceito formalmente ou o plano precisa mudar** |
| **Réplica de leitura** | Dashboards e mapa competem com o transacional | Confirmar disponibilidade; até então, usar projeções materializadas (Anexo A.12) e cache |
| **Limite de conexões** | Saturação com muitos workers | Dimensionar via Supavisor; workers com pool pequeno e dedicado |
| **Disponibilidade de extensões** | `postgis`, `pg_cron`, `btree_gist`, `pgcrypto`, `pg_partman` | **Verificar no projeto real antes da Fase 1**; `btree_gist` é indispensável para `RN-001` |
| **Acoplamento ao fornecedor** | Migração futura custosa | Ver H.9 |
| **Região** | Latência e requisito de residência de dado | Provisionar em região brasileira; confirmar exigência contratual dos clientes |
| **Cold start de Edge Functions** | Latência em webhook | Não usar para caminho crítico de faturamento |

---

## H.9 Portabilidade — estratégia de saída

A dependência é contida por construção, e isso é uma decisão de projeto, não uma esperança:

| Camada | Grau de acoplamento | Custo de saída |
| --- | --- | --- |
| Tabelas de domínio, constraints, triggers, RLS | **Nenhum** — PostgreSQL padrão | `pg_dump`/`pg_restore` para qualquer Postgres gerenciado |
| Funções `app.*` e políticas | Baixo — dependem de `auth.jwt()` | Substituir por leitura de `current_setting` em uma migração |
| Autenticação | **Médio** — GoTrue tem schema próprio | Isolar em `platform-iam` atrás de uma interface; a migração para outro OIDC troca o adaptador, e `usuario.subject_oidc` é remapeado |
| Storage | Baixo — API S3-compatível | Reapontar cliente e migrar objetos |
| Realtime | Baixo — uso opcional e não crítico | Substituir por *polling* ou WebSocket próprio |

**Regra de contenção:** nenhuma tabela de domínio referencia `auth.users` por chave estrangeira. O
vínculo é `usuario.subject_oidc`, uma coluna comum. Isso mantém o núcleo de dados portável.

---

## H.10 Alterações nos documentos existentes

| Documento | Alteração |
| --- | --- |
| 7.3.1 Stack backend | Banco, pooling, identidade e storage passam a Supabase |
| 7.5 Autenticação | Supabase Auth no lugar de Keycloak; custom claims e obsolescência de claim |
| 7.6 Permissões | Acrescenta RLS como camada imposta pelo Supabase; modelo do Anexo C inalterado |
| 11.6 Multiempresa | `app.tenant_atual()` e cuidados de pooling |
| 11.8 Backup | PITR condicionado ao plano contratado |
| 13.1 Recomendações | Linha do banco e da identidade atualizadas |
| Anexo A | Inalterado — o modelo de dados não muda |
| Anexo D | Inalterado — a API pública continua sendo a da aplicação, não o PostgREST |

---

## H.11 Checklist de aceite da adoção

- [ ] Papel `iarx_app` criado, sujeito a RLS, usado pelo runtime da API
- [ ] `service_role` ausente de qualquer artefato de frontend (verificado no CI)
- [ ] Nenhuma política de `INSERT`/`UPDATE`/`DELETE` para `anon`/`authenticated` em tabela de negócio
- [ ] `app.tenant_atual()` implementada e usada por todas as políticas
- [ ] Teste de isolamento entre tenants em **conexão compartilhada** aprovado
- [ ] Custom access token hook emitindo `tenant_id`, `usuario_id`, `perfis`, `escopos`
- [ ] Revogação de sessão na desativação de usuário funcionando
- [ ] Extensões `btree_gist`, `postgis`, `pgcrypto`, `pg_cron` habilitadas
- [ ] `EXCLUDE USING gist` de `RN-001` ativa e testada
- [ ] Antivírus de anexo implementado; download bloqueado enquanto pendente
- [ ] Tier com PITR confirmado, ou RPO real aceito formalmente por escrito
- [ ] Região de dados definida e compatível com exigência dos clientes
- [ ] Migrações versionadas via Supabase CLI; Prisma sem `migrate`
