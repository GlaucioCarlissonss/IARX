# Anexo J — Implementação da API

Este anexo descreve o que existe em `apps/api` e `packages/contracts`, e por
quê. O Anexo D descreve o contrato; aqui está como ele é sustentado.

---

## J.1 O que foi construído

| Pacote | Papel |
| --- | --- |
| `packages/contracts` | Esquemas Zod compartilhados entre API e clientes. Sem dependência de Nest, para não vazar servidor para dentro do bundle do navegador. |
| `apps/api` | API de domínio em NestJS sobre PostgreSQL com RLS. |

Rotas implementadas nesta fase:

```
GET   /vivo                                  público
GET   /pronto                                público
GET   /api/v1/equipamentos                   equipamento:ler
GET   /api/v1/equipamentos/{id}              equipamento:ler
POST  /api/v1/equipamentos/{id}/bloquear     equipamento:bloquear
POST  /api/v1/equipamentos/{id}/desbloquear  equipamento:desbloquear
GET   /api/v1/contratos                      contrato:ler
GET   /api/v1/contratos/{id}                 contrato:ler
GET   /api/v1/contratos/{id}/itens           contrato:ler
POST  /api/v1/contratos/{id}/itens           contrato:item_alocar   (idempotente)
```

É um recorte deliberado: o caminho de alocação exercita **todas** as camadas
transversais de uma vez — contexto de tenant, permissão, validação por contrato
compartilhado, idempotência, tradução de SQLSTATE e concorrência otimista. As
rotas restantes do Anexo D acrescentam domínio, não estrutura.

---

## J.2 Contexto de requisição e transação

### J.2.1 Por que AsyncLocalStorage, e não provider REQUEST-scoped

Um provider com escopo `REQUEST` no Nest contamina a cadeia de injeção inteira:
qualquer serviço que o receba também passa a ser instanciado por requisição, e
a árvore de dependências é reconstruída a cada chamada. O custo aparece
exatamente sob carga.

`AsyncLocalStorage` mantém todos os providers singleton e faz o contexto viajar
com a continuação assíncrona. O contexto carrega quatro coisas, e só elas:
identificador de correlação, claims, conexão da transação corrente e a chave de
idempotência.

### J.2.2 A regra que não pode ser violada

```ts
select set_config('app.tenant_id', $1, true)   //  ✔  local à transação
SET app.tenant_id = '...'                      //  ✘  vaza entre requisições
```

O terceiro argumento de `set_config` é `is_local`. Com ele, o valor morre no
COMMIT ou no ROLLBACK. Sem ele, o valor sobrevive na conexão — e o Supavisor em
modo transação devolve a conexão ao pool entre requisições, então a requisição
seguinte, de **outro usuário**, herdaria o tenant anterior. O vazamento é
silencioso: nada falha, apenas o cliente errado vê os dados.

`set_config` também é a razão pela qual não usamos `SET LOCAL`: `SET` não aceita
parâmetro vinculado, o que obrigaria a interpolar o valor no SQL. Isso vale
inclusive para os timeouts — um detalhe que só apareceu porque o teste de
integração roda contra PostgreSQL de verdade e recusou `set local
statement_timeout = $1` com erro de sintaxe.

Um job de CI grep-a o código em busca de `set_config` de `app.*` com
`is_local=false` e de `SET` de sessão, e reprova o pull request.

### J.2.3 Timeouts por transação

`statement_timeout` e `idle_in_transaction_session_timeout` são definidos em
cada transação. Sem eles, uma consulta patológica ou um `await` esquecido no
meio de uma transação segura uma conexão do pool indefinidamente — e, pior,
segura o horizonte do autovacuum, o que degrada o banco inteiro.

### J.2.4 Três tipos de transação

| Método | Uso | Por que existe separado |
| --- | --- | --- |
| `emTransacao` | Operação de negócio | O caso normal. |
| `leituraAuxiliar` | Enriquecer mensagem de erro | Depois de um erro, a transação está abortada e recusa qualquer comando até o ROLLBACK. Perguntar "qual contrato conflita?" exige outra conexão. |
| `escritaAuxiliar` | Registro de idempotência | Se a marca de "já processei" vivesse na transação do negócio, um rollback a apagaria — e o reenvio executaria de novo, que é exatamente o que a idempotência impede. |

---

## J.3 Autenticação e autorização

### J.3.1 Duas configurações, uma aceitável em produção

- `IARX_JWKS_URL` — verificação por chave pública. A API **não** guarda material
  capaz de emitir token. É a configuração de produção.
- `IARX_JWT_SEGREDO` — HS256 com segredo compartilhado, para ambiente local e
  CI. Quem verifica também consegue assinar; em produção isso transforma
  qualquer leitura de variável de ambiente em escalonamento total.

O bootstrap **recusa subir** com HS256 quando `NODE_ENV=production`. A proteção
é estrutural, não uma linha em runbook.

### J.3.2 Negado por padrão, com dois cadeados

`RN-026` diz que a permissão é negada por padrão. Isso vale em dois níveis:

1. **Runtime** — `PermissaoGuard` é global e recusa qualquer rota autenticada
   que não declare `@ExigePermissao`. Uma rota nova sem decorador devolve 403 na
   primeira chamada, em vez de ficar aberta a qualquer usuário autenticado.
2. **Pull request** — `apps/api/scripts/verificar-rotas.mjs` reprova o CI se
   algum `@Get/@Post/...` não tiver `@ExigePermissao` ou `@Publico` adjacente.
   Abrir uma rota passa a ser um ato explícito e revisável.

A falha mais comum em autorização não é a regra errada; é a regra ausente.

### J.3.3 O que a guarda não decide

Escopo organizacional (`FILIAL`, `REGIAO`, `PROPRIO`) **não** é avaliado em
memória. Ele é predicado de linha e é imposto pelas políticas de RLS, junto com
o tenant. Reimplementá-lo na aplicação criaria uma segunda verdade — e as duas
divergiriam.

### J.3.4 Permissão desconhecida é descartada

Se o emissor for mais novo que a API e mandar uma permissão que ela não conhece,
a claim é filtrada em vez de derrubar o token. O efeito de descartar é negar,
que já é o padrão seguro; derrubar tiraria o sistema do ar por uma
incompatibilidade de versão.

---

## J.4 Erros — `problem+json`

### J.4.1 O que pode sair, e o que não pode

`ErroDominio` é resposta **prevista**: o cliente pediu algo que as regras não
permitem, e o corpo é publicável. Qualquer outra exceção vira `ERRO_INTERNO`
genérico, porque a mensagem pode conter fragmento de SQL, caminho de arquivo,
nome de coluna interna — ou dado de outro tenant que apareceu num `detail` do
PostgreSQL.

O `request_id` costura a resposta pobre ao log rico: o cliente cita o
identificador, o suporte encontra o stack.

### J.4.2 `code` é o contrato; `status` não basta

O cliente decide comportamento por `code`, não por status. Dois `409` muito
diferentes — conflito de vigência e chave de idempotência divergente — pedem
telas diferentes. `title` e `detail` podem ser reescritos sem quebrar
integração; `code` não.

A tabela `STATUS_PADRAO` centraliza status por código, para o mesmo `code` não
sair como 409 numa rota e 422 em outra.

### J.4.3 Tradução de SQLSTATE

As invariantes vivem no banco. O preço é que a violação chega como SQLSTATE, e
alguém precisa transformá-la em algo que um operador entenda. `banco/sqlstate.ts`
é esse alguém — e é a **única** ponte, por isso é curta e exaustiva.

| SQLSTATE / constraint | `code` | Status |
| --- | --- | --- |
| `ci_sem_sobreposicao` (23P01) | `EQUIPAMENTO_JA_ALOCADO` | 409 |
| `ci_vigencia_coerente` | `VIGENCIA_INVALIDA` | 422 |
| `ci_franquia_completa` | `REGRA_DE_NEGOCIO` | 422 |
| `ci_desconto_com_motivo` | `REGRA_DE_NEGOCIO` | 422 |
| `ri_chave_uq` (23505) | `IDEMPOTENCIA_EM_ANDAMENTO` | 409 |
| 23505 genérico | `RECURSO_DUPLICADO` | 409 |
| 23514 / 23503 / 23502 | `REGRA_DE_NEGOCIO` / `PAYLOAD_INVALIDO` | 422 / 400 |
| 42501 (inclui `app.exigir_tenant`) | `FORA_DE_ESCOPO` | 403 |
| 40001 / 40P01 | `INDISPONIVEL` | 503 |
| não mapeado | `ERRO_INTERNO` | 500 |

Depender do nome da constraint é acoplamento com o schema, assumido de olhos
abertos. A alternativa — checar a regra antes de escrever — é pior: cria janela
de corrida e duplica a regra em dois lugares que divergem. Cada linha da tabela
é coberta por teste; renomear a constraint quebra o teste, não a produção.

### J.4.4 Recusa com saída

`RN-001` é o exemplo do padrão. A resposta não diz apenas "não pode":

```jsonc
{
  "code": "EQUIPAMENTO_JA_ALOCADO",
  "detail": "O patrimônio 10422 está alocado ao contrato SP-2026-0148 (ativo) até 2026-12-31.",
  "errors": [{ "field": "equipamento_id", "code": "CONFLITO_VIGENCIA",
               "meta": { "contrato_conflitante": "SP-2026-0148", "vigencia_fim": "…" } }],
  "acoes_sugeridas": [
    { "code": "ALOCAR_EQUIVALENTE", "descricao": "Alocar outro ativo da mesma categoria e filial (10423, 10424)",
      "meta": { "candidatos": [ … ] } },
    { "code": "RESERVAR_FUTURO", "descricao": "Reservar este ativo a partir de 2027-01-01" },
    { "code": "ALOCAR_POR_CATEGORIA", "descricao": "Registrar o item por categoria e definir o ativo na entrega" }
  ]
}
```

Um 409 com "conflito de vigência" faz o operador abrir chamado. Este faz o
operador resolver em dez segundos.

**Defeito encontrado ao escrever isto:** `data.toISOString().slice(0, 10)`
devolve a data em UTC. Uma vigência terminando em `2026-12-31T23:59:59-03:00`
virava `2027-01-01` na mensagem — o operador leria que o ativo só libera em
janeiro. O erro só aparece depois das 21h no horário de Brasília. Corrigido em
`comum/datas.ts`, que formata no fuso da operação.

---

## J.5 Idempotência (RN-029)

O cenário: a alocação é criada, a resposta se perde, o cliente vê timeout e
reenvia. Sem controle, nasce um segundo item de contrato — e, no fechamento,
uma segunda cobrança.

O mecanismo é o índice único `(tenant_id, chave)` da tabela
`requisicao_idempotente` (migração 0009). Duas requisições simultâneas com a
mesma chave disputam o INSERT e exatamente uma vence. Não é preciso lock
explícito nem coordenação entre instâncias: o banco já é o ponto de
serialização.

| Situação | Resposta |
| --- | --- |
| Mesma chave, mesmo corpo, concluída | Resposta guardada, com `Idempotency-Replayed: true` |
| Mesma chave, corpo diferente | 409 `IDEMPOTENCIA_DIVERGENTE` |
| Mesma chave, ainda processando | 409 `IDEMPOTENCIA_EM_ANDAMENTO` + `Retry-After` |
| Falha | Chave é **liberada** |

Duas decisões que merecem justificativa:

**Falha libera a chave.** Guardar o erro envenenaria a chave: o cliente
corrigiria o payload, reenviaria com a mesma chave e receberia
`IDEMPOTENCIA_DIVERGENTE` em vez do resultado. Como nada foi commitado no
caminho de erro, reexecutar é seguro.

**O corpo é canonicalizado antes do hash.** Dois clientes que serializam o mesmo
objeto em ordens diferentes enviam bytes diferentes; sem ordenar as chaves, o
reenvio legítimo seria acusado de divergência.

---

## J.6 Paginação por cursor

`OFFSET 40000` faz o PostgreSQL varrer e descartar 40 mil linhas, e a página
escorrega quando alguém insere durante a navegação. A API usa keyset sobre
`(created_at, id)` — o `id` desempata para a ordem ser total, sem o que duas
linhas do mesmo instante podem repetir ou sumir entre páginas.

O cursor é base64 opaco de propósito: se o cliente puder construí-lo, ele vira
parte do contrato público e o formato não pode mais mudar. Cursor corrompido é
tratado como ausente, nunca como erro — ele pode vir de um link antigo colado
por um usuário.

A consulta busca `limit + 1` para saber se há próxima página sem um `count()`
adicional.

---

## J.7 Concorrência otimista

`If-Match` é **exigido** nas rotas de alteração, não opcional. Sem ele, dois
operadores que abriram a mesma tela gravam por cima um do outro e o último a
clicar vence em silêncio. O ETag é a coluna `version`; o UPDATE traz
`where version = $2`, e zero linhas afetadas viram 409 `CONFLITO_DE_VERSAO` com
a versão atual no `meta`.

---

## J.8 O que os testes provam

`apps/api/scripts/testar.sh` recria o banco, aplica as migrações, semeia massa
determinística e roda 32 asserções contra **PostgreSQL real**. Não há mock de
banco, pela mesma razão que justifica pôr as invariantes no schema: um mock
provaria apenas que o mock foi programado para concordar com o teste.

Um detalhe do script é o que torna o teste honesto: ele dá `login` ao papel
`iarx_app` e conecta com ele. Conectar como superusuário faria a RLS ser
ignorada, e todo o teste de isolamento passaria sem provar nada.

| Grupo | O que é demonstrado |
| --- | --- |
| Autenticação | 401 sem token; `TOKEN_INVALIDO` sem revelar a causa; 403 sem a permissão; permissão desconhecida é descartada |
| RN-028 | Tenant A vê 3 ativos, tenant B vê 1; registro alheio devolve **404, não 403**; `tenant_id` por query não tem efeito |
| RN-001 | Recusa sobreposição com contrato, data e equivalentes; aceita período adjacente; **duas requisições concorrentes → exatamente um 201 e um 409** |
| Estado e crédito | Contrato encerrado recusa item; cliente bloqueado recusa com saída |
| Validação | Vigência invertida, franquia incompleta e dinheiro como número são recusados com o campo apontado |
| RN-029 | Chave obrigatória; replay devolve o mesmo id; ordem das chaves do JSON é irrelevante; corpo diferente é recusado; falha libera a chave |
| Concorrência | `If-Match` obrigatório; versão velha → 409; bloqueio **não altera** o status do ativo |
| Paginação | Percorre todas as páginas sem repetir nem perder; cursor corrompido não é erro |

O teste de corrida é o mais importante: ele é a prova de que a garantia é do
banco. Se a verificação fosse `SELECT` seguido de `INSERT`, as duas requisições
passariam pela checagem antes de qualquer uma gravar.

`test/guardas.test.ts` testa a `PermissaoGuard` diretamente, porque o
comportamento mais importante dela — negar rota **sem** permissão declarada —
não pode ser exercitado pela API: nenhuma rota real está nessa condição, e é
justamente a condição que nunca deve chegar à produção.

---

## J.9 Defeitos que os testes encontraram

Registrados porque cada um é uma classe, não um acidente:

1. **`SET LOCAL statement_timeout = $1`** — `SET` não aceita parâmetro
   vinculado. Eu havia documentado isso para o tenant e cometido o erro nos
   timeouts, três linhas abaixo do próprio comentário.
2. **CTE que modifica dados não é visível ao `SELECT` da mesma consulta.**
   `with novo as (insert … returning id) select … where id = (select id from novo)`
   devolvia vazio: todas as partes da consulta enxergam o mesmo snapshot,
   anterior à escrita. Resolvido com duas instruções sequenciais na mesma
   transação.
3. **Data em UTC numa mensagem para humano** (J.4.4).
4. **Asserção minha, não código** — o teste exigia que a resposta não contivesse
   `/exp/`, e o título legítimo diz "inválido ou expirado". A verificação certa é
   sobre a *causa* (assinatura, claim, timestamp), não sobre a palavra.

---

## J.10 O que falta

| Item | Observação |
| --- | --- |
| Demais rotas do Anexo D | Manutenção, estoque, faturamento e financeiro. Acrescentam domínio, não estrutura. |
| OpenAPI 3.1 gerado dos esquemas Zod | O contrato já é dado; falta emitir o documento e publicar em `/api/v1/openapi.json`. |
| Rate limiting por chave/tenant | `LIMITE_EXCEDIDO` já existe no catálogo; falta o mecanismo. |
| `apps/web` consumindo `@iarx/contracts` | Hoje o front tem tipos locais. A migração deve usar o módulo `catalogo-permissoes` (sem Zod) para não levar validação de esquema ao bundle. |
| Job de limpeza de `requisicao_idempotente` | `app.limpar_idempotencia_expirada()` existe; falta agendar. |
| Outbox → publicação de eventos | Tabela existe (migração 0007); falta o worker. |
