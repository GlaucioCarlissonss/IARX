# Anexo S — Contas a pagar com aprovação por alçada

Módulo 10 do [Anexo L](L-lacunas-funcionais.md), sob a decisão D-18. Primeiro
módulo do financeiro que **movimenta dinheiro**, e o primeiro em que uma regra
de autorização existe para impedir uma pessoa de agir sozinha.

Depende de [Anexo R](R-base-do-financeiro.md) (centro de custo e conta
bancária) e do subsistema de notificação da migração 0018.

---

## S.1 A regra que dá sentido a todas as outras

Nove invariantes sustentam o módulo (RN-F01 a RN-F09), e uma delas é a que faz
o resto significar algo:

> **RN-F04 — quem lança um título não pode aprová-lo.**

Sem ela, "aprovado" quer dizer apenas que alguém clicou no próprio pedido. Um
fluxo de aprovação sem segregação de funções é pior que nenhum: dá a sensação de
controle sem o controle, e a sensação é o que faz ninguém procurar o controle
que falta.

Ela está no banco, como gatilho — não na API, não na tela:

```sql
if new.aprovador_id = (select t.created_by from public.titulo_pagar t
                        where t.id = new.titulo_id) then
  raise exception 'Quem lançou o título não pode aprová-lo.'
```

Estar no banco é o que torna a regra verdadeira para **todo** caminho de
escrita: a API, um script de migração de dados, uma correção manual em produção.
As mesmas nove regras existem replicadas na camada de comandos do front-end, e
isso não é redundância — lá elas permitem a tela recusar antes de pedir, com a
mensagem certa; aqui elas valem para quem não passa pela tela. Se a regra mudar
num lado só, as duas suítes falham juntas.

### O corolário na interface

A fila do aprovador **não oferece o título de quem o lançou**. O gatilho o
recusaria de qualquer forma, mas oferecê-lo seria convidar ao erro — e ensinar a
desconfiar da lista, que é o começo do fim de qualquer fila de trabalho. A
exclusão está na cláusula da consulta, não num `filter` da tela:

```sql
and t.created_by is distinct from $u
```

---

## S.2 As nove invariantes

| # | Regra | Onde vive | Por que ali |
| :-: | --- | --- | --- |
| RN-F01 | Níveis de aprovação = faixas de alçada abaixo do valor, no máximo 3 | função `app.niveis_aprovacao_pagar` | depende de outras linhas (`alcada`), o que `CHECK` não alcança |
| RN-F02 | Nível N só decide depois de N−1 aprovar, na mesma rodada | gatilho | idem — depende das outras aprovações do título |
| RN-F03 | Posto do aprovador ≥ nível, ou delegação vigente | gatilho + `app.pode_decidir_nivel_pagar` | idem |
| RN-F04 | Quem lançou não aprova | gatilho | idem |
| RN-F05 | Rateio soma 100%, ou não existe | gatilho de statement | soma de linhas irmãs |
| RN-F06 | Pagamento não excede o saldo em aberto | gatilho | o saldo é derivado dos pagamentos anteriores |
| RN-F07 | Só título aprovado é pago | gatilho | transição de estado |
| RN-F08 | O pai de um parcelamento não se paga | gatilho | depende da existência de filhas |
| RN-F09 | Título com pagamento não estornado não se cancela | gatilho | idem |

Duas colunas geradas e nenhum campo redundante:

```sql
valor_devido numeric(15,4) generated always as (coalesce(valor_ajustado, valor_original)) stored,
```

e o saldo é `app.saldo_titulo_pagar(id)`, função, não coluna. É a mesma escolha
do saldo bancário do [Anexo R](R-base-do-financeiro.md): **se não existe caminho
de escrita, não existe caminho de divergência.** Há teste que verifica a
ausência das colunas em `information_schema`, e o equivalente no front:

```ts
assert.ok(!('valorDevido' in titulo))
assert.ok(!('saldo' in titulo))
```

---

## S.3 D-18 fechada: alçada configurável, e por quê

O Anexo L marcava D-18 pendente — faixas de aprovação configuráveis pelo
administrador do locatário, ou fixas no sistema.

**Configuráveis**, e o argumento não é flexibilidade: é que fixá-las seria
inventar regra de negócio. Dez mil reais é um valor de diretoria numa operação
e de rotina em outra, e a plataforma é multi-locatário. A tabela `alcada` já
existia por locatário desde a migração 0002 — a resposta configurável é a que
**evita** codificar valores que ninguém especificou.

A consequência de projeto é que o **posto é a posição da faixa, não o valor**:

```sql
dense_rank() over (order by a.limite_valor)
```

Trocar 50 mil por 80 mil no cadastro não muda quem decide o quê. Se o posto
fosse o valor, cada ajuste de faixa reescreveria a hierarquia de aprovação em
silêncio.

### Nenhuma faixa cadastrada = nenhuma aprovação

É o comportamento correto de uma operação que ainda não configurou alçada, e
não um buraco. O buraco seria o inverso: aprovar sozinho um valor acima de uma
faixa que **existe**.

---

## S.4 Posto ≥ nível, e não posto igual ao nível

RN-F03 aceita que um posto superior decida um nível inferior. A alternativa —
"posto exatamente N decide nível N" — parece mais rigorosa e é pior:

as férias do gerente travariam o nível 1 com o diretor sentado ao lado. E o
contorno de um bloqueio sem saída legítima é sempre o mesmo: alguém empresta
credencial. A partir daí a trilha de auditoria mente sobre quem aprovou, que é
exatamente o que o módulo existe para registrar.

### A delegação existe pela mesma razão

`delegacao_alcada` dá um caminho legítimo e rastreável para a ausência
planejada. Três propriedades a tornam segura:

1. **O delegante é sempre `app.usuario_atual()`**, nunca um id do corpo da
   requisição. Aceitá-lo no corpo permitiria delegar a autoridade de outra
   pessoa — o caminho mais curto para contornar a segregação de funções. Por
   isso `pagar:delegar_aprovacao` também é permissão separada de
   `pagar:aprovar`: quem aprova não precisa poder transferir a própria
   autoridade.
2. **Sem sobreposição do mesmo nível**, como restrição de exclusão:
   ```sql
   exclude using gist (tenant_id with =, delegante_id with =, nivel with =,
                       daterange(inicio, fim, '[]') with &&)
   ```
   Duas delegações vigentes do mesmo nível tornariam ambíguo quem responde pela
   decisão — que é justamente o que a delegação existe para manter claro.
3. **A decisão registra de quem veio a autoridade** (`delegado_de`). Sem isso a
   trilha diria que alguém sem alçada aprovou, e a auditoria não teria como
   explicar.

A delegação **não** dispensa a RN-F04: o delegado que também lançou o título
continua barrado. Há teste dos dois lados.

---

## S.5 O parcelamento é um compromisso, não N compromissos

A aprovação é do **pai**, e o valor dele é o que a alçada avalia.

Aprovar parcela por parcela deixaria um parcelamento de trezentos mil passar
como doze títulos de vinte e cinco mil, cada um abaixo do nível que a soma
exige. É a forma mais simples de contornar toda a hierarquia de aprovação, e ela
não pareceria um contorno — pareceria uso normal do sistema.

Daí três consequências, e as três têm teste:

- **as filhas herdam o status do pai** e não têm rodada própria;
- **o pai não se paga** (RN-F08): pagá-lo somaria o total às parcelas e dobraria
  a despesa;
- **o pai não entra nos indicadores de caixa da tela.** Somá-lo às parcelas
  dobraria a exposição, e é esse número que alguém usa para decidir se paga hoje
  ou amanhã.

O pai carrega `parcela_total` sem `parcela_numero` — ele sabe que são doze e não
é nenhuma delas. A restrição correspondente exige número quando há total, e não
o contrário:

```sql
constraint titulo_pagar_numero_exige_total check (parcela_numero is null or parcela_total is not null),
constraint titulo_pagar_filha_numerada     check (titulo_pai_id is null or parcela_numero is not null),
```

A primeira versão exigia os dois juntos, e recusava o pai legítimo. Foi um teste
que a encontrou.

### A última parcela absorve o arredondamento

Distribuir o centavo por igual faria a soma das parcelas divergir do total do
pai — e é a soma que o fornecedor cobra. Há teste que fecha os dois ao centavo,
para 7 e para 12 parcelas, e um que verifica a mesma propriedade em toda a massa
de demonstração.

---

## S.6 Rejeição não é estado terminal

Um título rejeitado volta a **PENDENTE**, não a `REJEITADO`. A razão é que ele
tem um destino natural: o solicitante corrige e reenvia. Um estado terminal
obrigaria a lançar um título novo, e o novo não carregaria a justificativa que
explica o que corrigir.

O reenvio abre uma **rodada nova** e preserva a antiga. Sobrescrever a decisão
apagaria justamente a explicação da correção — e é ela que a próxima conferência
vai querer ler.

A rejeição exige justificativa de dez caracteres. Sem ela, o solicitante não tem
o que corrigir, e reenvia igual: a recusa sem motivo não é resposta, é atraso.

---

## S.7 A baixa e o extrato nascem juntos

```sql
select app.baixar_titulo_pagar($1, $2, $3, $4, $5);
```

Uma chamada faz o pagamento **e** a movimentação bancária. Separar os dois
criaria o pior estado possível: título quitado sem dinheiro saindo do extrato,
ou o contrário. Não há caminho na interface, na API ou no banco que faça um sem
o outro — pelo mesmo raciocínio da transferência entre contas do
[Anexo R](R-base-do-financeiro.md): dois `INSERT` numa camada de aplicação são
dois `INSERT` que alguém pode separar.

O estorno devolve o valor à conta e reabre o saldo do título, uma vez só.
Estorno não se estorna: quem errou o estorno registra um pagamento novo.

### Pagamento acima do saldo é recusado, e não vira crédito

RN-F06. Aceitar o excesso como crédito com o fornecedor criaria dinheiro que
ninguém sabe explicar na conciliação. A recusa diz o saldo exato disponível, em
vez de só negar.

---

## S.8 A prévia de alçada

O contrato carrega uma coisa que nenhum outro carrega: **os níveis de aprovação
calculados antes de confirmar**.

```
GET /api/v1/contas-pagar/previa-alcada?valor=30000
→ { valor: "30000.0000", niveis: 2, limites: ["10000.0000","50000.0000","250000.0000"] }
```

Existe como consulta própria porque a tela precisa dela **antes** de salvar.
Descobrir depois de confirmar que o título vai à diretoria é a surpresa que este
endpoint remove — e o operador que descobre isso depois de prometer o pagamento
para hoje aprende a não confiar na tela.

`limites` vem junto para a interface poder **explicar de onde vem o número**, em
vez de só afirmá-lo. Um "2 níveis" sem justificativa é indistinguível de um erro.

Detalhe de roteamento: `previa-alcada` é declarada **antes** de `:id`, senão
`GET /previa-alcada` cai no `ParseUUIDPipe` e responde 400 para uma rota que
existe.

---

## S.9 Notificação: o fato e quem precisa saber

Cada aviso entra na fila de notificação **na mesma transação do fato**. Se a
criação do título for desfeita, o aviso não existe — e não há aviso de um
compromisso que não foi assumido.

A separação entre a caixa de saída de eventos e a fila de notificação é
deliberada: **o evento é o fato; a notificação é alguém precisando saber**. Um
fato tem muitos destinatários — o aviso de aprovação de nível 1 vai para todos
os aprovadores daquele nível —, e misturar os dois faria a fila de entrega
carregar a semântica do domínio.

O worker atravessa locatários, e por isso opera por uma superfície fechada de
`security definer` (migração 0018), não por uma conexão sem RLS. Uma conexão
privilegiada na aplicação ficaria disponível para qualquer erro futuro
reaproveitar; a superfície fechada é enumerável — três funções, revogadas de
`public`, concedidas a `iarx_app`.

O adaptador padrão é **registro em log**, não SMTP, por assimetria de erro: um
ambiente que deveria enviar e apenas registra é descoberto na primeira
conferência; o inverso manda e-mail de teste para pessoas reais, e isso não se
desfaz.

---

## S.10 As treze rotas e as permissões

Todas com permissão declarada; `verificar-rotas.mjs` reprova o esquecimento no
pull request, e não em produção.

| Rota | Permissão |
| --- | --- |
| `GET /contas-pagar` | `pagar:ler` |
| `GET /contas-pagar/previa-alcada` | `pagar:ler` |
| `GET /contas-pagar/:id` | `pagar:ler` |
| `POST /contas-pagar` | `pagar:criar` |
| `PATCH /contas-pagar/:id` | `pagar:criar` |
| `POST /contas-pagar/:id/ajustar-valor` | `pagar:criar` |
| `POST /contas-pagar/:id/reenviar` | `pagar:criar` |
| `POST /contas-pagar/:id/aprovacoes/:nivel/decidir` | `pagar:aprovar` |
| `POST /contas-pagar/:id/pagamentos` | `pagar:baixar` |
| `POST /contas-pagar/:id/pagamentos/:pid/estornar` | `pagar:baixar` |
| `POST /contas-pagar/:id/cancelar` | `pagar:cancelar` |
| `GET /delegacoes-aprovacao` | `pagar:delegar_aprovacao` |
| `POST /delegacoes-aprovacao` | `pagar:delegar_aprovacao` |

Duas permissões novas no catálogo (121 → 123), cada uma por uma razão concreta:

- **`pagar:cancelar`** separada de `pagar:criar`: cancelar um título já aprovado
  desfaz o trabalho de quem aprovou. Quem lança não deveria poder apagar a
  decisão de outro.
- **`pagar:delegar_aprovacao`** separada de `pagar:aprovar`: quem aprova não
  precisa poder transferir a própria autoridade, e transferir é o caminho mais
  curto para contornar a segregação de funções.

---

## S.11 A recusa chega acionável, não como 500

Cada gatilho tem uma tradução para `problem+json` com `acoes_sugeridas`
estáveis: `OUTRO_APROVADOR`, `CONFIGURAR_ALCADA`, `AGUARDAR_NIVEL_ANTERIOR`,
`AJUSTAR_VALOR`, `PAGAR_PARCELA`, `ESTORNAR`, `CONFIRMAR_CASCATA`,
`ESTORNAR_PRIMEIRO`.

Um 500 aqui significaria que a regra que sustenta o módulo inteiro está vazando
como defeito. Há teste de integração para cada código: são as asserções que
provam que a regra do banco chega ao operador como instrução, e não como falha.

---

## S.12 Interface

A tela tem um centro, e não é a lista: é **a fila de quem decide**.

Um fluxo de aprovação que obriga cada aprovador a procurar na lista geral o que
está no seu nível transfere a regra para quem lê a tela, e ela se perde no
primeiro dia cheio. A fila é uma consulta (`?minha_aprovacao=true`), e a regra
de que o nível 2 não decide antes do nível 1 é propriedade dela, não do olho de
quem lê.

Nota sobre o que a fila **não** garante: um aprovador de posto 2 aparece com
títulos no nível 1 pendente, porque posto ≥ nível é a regra (§S.4). A garantia
de sequência está na decisão, não na fila — e é ela que tem o 422.

Outras decisões da tela:

- **A prévia de alçada muda enquanto se digita o valor**, com `role="status"`
  para que quem usa leitor de tela seja avisado sem o foco sair do campo.
- **O rateio começa com o que falta para 100%.** O caso comum é uma linha só, e
  pedir para digitar "100" é trabalho que a tela pode poupar. A soma aparece ao
  lado, em vermelho quando não fecha.
- **O total de um parcelamento não aparece na lista de obrigações** (§S.5); ele
  reaparece no detalhe da parcela, onde "esta é a 3ª de 12, do contrato tal" de
  fato ajuda.
- **O atraso é dito por texto** ("14 dia(s) em atraso"), não só pela cor da
  data: WCAG 1.4.1, e é também o dado que quem lê a lista está procurando.
- **O diálogo de decisão diz o que acontece depois.** Sem isso, quem aprova o
  nível 1 não sabe se liberou o pagamento ou apenas passou adiante.
- **Sem `pagar:aprovar`, a lista continua visível** e só a ação sai. Esconder a
  tela inteira faria quem confere pagamentos perder o acesso de leitura que ele
  legitimamente tem.

---

## S.13 Os defeitos que os testes encontraram

Sete, e cinco eram defeitos de produto ou de massa, não de teste.

### 1. As parcelas nasciam impagáveis (produto)

Nasciam `PENDENTE` sem rodada de aprovação aberta — esperando para sempre uma
decisão que ninguém podia dar, porque a rodada era do pai. O sintoma seria um
parcelamento inteiro travado sem mensagem de erro em lugar nenhum. Passaram a
herdar o status do pai, com a justificativa do §S.5.

### 2. `parcela_numero` e `parcela_total` exigidos juntos (modelagem)

A restrição recusava o pai legítimo, que tem total sem número. Corrigida para
"número exige total", mais "filha exige número".

### 3. Ninguém tinha o perfil financeiro na massa (demonstração)

O gerador distribuía dois perfis internos com `i % 2`, e o terceiro — o que
carrega a faixa de alçada intermediária — não chegava a ninguém. Consequência:
**o nível 2 de aprovação não existia em usuário nenhum**, e a tela nunca
conseguiria demonstrar uma aprovação de dois níveis. Nada acusava a falta; o
gerador silenciosamente caía no administrador. Um teste que pede "alguém com
posto 2" a encontrou.

### 4. Cinco títulos era volume insuficiente (demonstração)

Derivados só das notas fiscais, eram cinco: não exercitavam paginação, filtro
por situação nem uma fila com mais de um item, e a classificação
`DESPESA_FIXA` nunca aparecia. Acrescentadas as despesas recorrentes de quatro
competências — estrutura de uma locadora de TI, com o centro de custo
correspondente —, chegando a 38.

### 5. Estorno por `prompt()` do navegador (interface)

O motivo do estorno entra no histórico e é lido por quem confere o extrato
depois. Um `prompt` não tem rótulo associado, não é estilizável, não valida
tamanho mínimo, e em alguns navegadores nem aparece — a confirmação sumiria sem
erro nenhum. Virou diálogo.

### 6. Dois testes instáveis por construção (suíte)

Os arquivos de teste da API compartilham **um** banco. O laço de fundo do worker
de notificação drenava a fila que outro arquivo acabara de enfileirar, e a
asserção falhava de forma intermitente — a pior classe de teste instável, porque
parece defeito do código. Duas correções na origem: o worker fica desligado na
suíte (os testes chamam `drenar()` diretamente) e `drenarTudo` esvazia a fila em
vez de reservar um lote de vinte. O lote parcial fazia a asserção dizer "não foi
enviado" quando o que houve foi "ainda está na fila" — defeitos diferentes, e o
teste que os confunde acusa o código errado.

### 7. Três asserções minhas com premissa errada (teste)

Uma afirmava que o nível 2 não deveria ver um título no nível 1 — falso, posto
≥ nível é a regra (§S.4). Duas usavam o mesmo usuário como lançador e aprovador,
e a RN-F04 disparava antes da regra que o teste queria exercitar: passavam ou
falhavam pelo motivo errado.

---

## S.14 Verificação

| Portão | Resultado |
| --- | --- |
| `npm run tipos` | limpo nos três pacotes |
| `npm run db:test` | 127 invariantes (eram 110) — 17 casos novos |
| `npm run api:test` | 142 testes (eram 111) — 31 casos novos, todos do Módulo 10 |
| `npm run web:test` | 123 unitários (eram 95) — 28 casos novos |
| `npm run a11y:dom` | 165 testes (eram 150) — 15 casos novos |
| `npm run a11y:tokens` | 202/202 |
| `verificar-rotas.mjs` | 55/55 rotas com autorização declarada (eram 42) |

---

## S.15 O que fica em aberto

| # | Pendência | Consequência |
| --- | --- | --- |
| — | Status `AGENDADO` não tem ação própria | o enum o prevê; agendar pagamento futuro é matéria do Módulo 12 (lançamentos futuros), que tem a visão de calendário |
| — | Status `EM_DISPUTA` é atribuído mas não transicionado pela API | a massa de demonstração o exibe; abrir e encerrar disputa precisa de definição do operador sobre o que ela suspende (vencimento? juro?) |
| — | Rateio por valor fixo | D-16 decidiu percentual como formato de armazenamento; valor fixo entra depois como segunda forma de **digitar**, convertida no lançamento |
| — | Aprovação por e-mail (responder para aprovar) | o aviso leva o valor e o solicitante, e exige entrar no sistema para decidir. Decidir por e-mail precisaria de um token de uso único por decisão, e da resposta a "o que acontece se o e-mail for encaminhado" |
| — | Anexo do documento no título | `anexo` já é polimórfico e aceitaria `TITULO_PAGAR`; falta a entidade no enum e o campo na tela |
| — | Retenção de tributos (IRRF, INSS, ISS) na baixa | o valor pago é líquido informado; calcular retenção exige a matriz de serviços tomados, que ninguém especificou. **Não foi inventada.** |

Nenhuma destas bloqueia o Módulo 11 (contas a receber), que é o próximo.
