# Anexo U — Lançamentos futuros e fluxo de caixa: a intenção antes do título

Módulos 12 e 13 do [Anexo L](L-lacunas-funcionais.md), sob a decisão D-23.
Fecha o bloco financeiro.

Depende de [Anexo R](R-base-do-financeiro.md) (conta bancária, centro de custo),
[Anexo S](S-contas-a-pagar.md) (alçada, título a pagar) e
[Anexo T](T-contas-a-receber.md) (título a receber, e o raciocínio de D-20).

---

## U.1 O problema, em duas frases

**Não havia onde registrar "em setembro sai o aluguel" sem criar o título.** E
criar o título antes da hora põe em aprovação um compromisso que ainda não
existe — a aprovação teria de ser refeita a cada ajuste de planejamento, e um
compromisso previsto se ajusta muito.

**E não havia como responder "quanto entra em sessenta dias".** O saldo real das
contas existia desde a 0017; os títulos em aberto, desde a 0019 e a 0020. Faltava
somá-los — e faltava a camada que distingue "o que vai acontecer" de "o que já
está lançado".

---

## U.2 Os dois módulos numa rodada, com **uma** projeção

O Anexo L especifica a projeção **duas vezes**: `GET
/lancamentos-futuros/projecao` no Módulo 12 e `GET /fluxo-caixa/projecao` no 13,
com o próprio texto admitindo "calculado aqui e lá".

É a mesma duplicação que D-20 removeu do título, um nível acima — na camada de
leitura. Duas contas dariam duas respostas para a mesma pergunta, e a divergência
apareceria como um planejamento que não fecha com o painel: nenhum dos dois
números parece errado sozinho.

**Decidido com o operador: os dois módulos na mesma rodada, com uma função só.**

```sql
app.fluxo_caixa_projetado(p_de, p_ate, p_cenario_id, p_conta_id,
                          p_filial_id, p_centro_custo_id)
  → dia, entradas, saidas, saldo_dia, saldo_acumulado
```

As **duas rotas continuam existindo**, e não é incoerência: elas exigem
permissões diferentes. `/fluxo-caixa/projecao` pede
`financeiro:painel_executivo`, porque quem vê o gráfico consolidado vê margem,
concentração de vencimento e previsão de despesa. `/lancamentos-futuros/projecao`
pede `pagar:ler`, porque quem planeja precisa ver o efeito do que programou sem
receber o retrato completo da operação. O que não se duplica é a **conta**.

No front, a mesma decisão: `projetarCaixa(base, janela)` em `comandos.ts`, com as
duas telas chamando-a. A tela de lançamentos futuros diz isso em texto — "o mesmo
cálculo do painel de fluxo de caixa" —, porque a garantia é invisível olhando o
número.

---

## U.3 `recorrencia` é **uma** tabela, não duas

O Anexo especifica `recorrencia_pagar` e `recorrencia_receber`. Aqui é uma
`recorrencia` com discriminador `lado`.

É o raciocínio de D-20 aplicado literalmente: duas tabelas paralelas para o mesmo
conceito dão duas respostas para "o que está programado". A diferença entre elas
— fornecedor contra cliente — se resolve com colunas nuláveis amarradas ao
discriminador, que é exatamente o que `lancamento_futuro` já faz:

```sql
constraint recorrencia_pagar_coerente check (
  lado <> 'PAGAR' or (empresa_id is not null and cliente_id is null
                      and classificacao is not null)),
constraint recorrencia_receber_coerente check (
  lado <> 'RECEBER' or (cliente_id is not null and empresa_id is null
                        and classificacao is null))
```

Sem esses dois, uma recorrência de pagamento com `cliente_id` preenchido seria
aceita — e na conversão o sistema teria de escolher entre dois destinos
possíveis, com a escolha dependendo da ordem do código.

**A recorrência é o molde; o lançamento futuro é a instância.** Os dois existem:
sem o molde não há como dizer "todo dia 10"; sem a instância não há o que editar,
cancelar ou projetar.

---

## U.4 Duas chaves estrangeiras reais, e o precedente que não existe

O Anexo especifica `titulo_gerado_id` **sem** chave estrangeira, apontando para
`titulo_pagar` ou `titulo_receber` conforme `titulo_gerado_tipo`, com integridade
por gatilho — justificando que "outras bases poliformas do sistema já usam" esse
mecanismo.

**A verificação derrubou a justificativa.** A única referência polimórfica do
esquema é `audit_log` (migração 0003), e ela não tem FK **nem gatilho** — por uma
razão oposta: é log, e precisa sobreviver à exclusão da linha referenciada.
Nenhuma outra tabela do esquema faz o que o Anexo descreve.

**Decidido com o operador: duas FK reais + CHECK.**

```sql
titulo_pagar_id   uuid references public.titulo_pagar(id)   on delete restrict,
titulo_receber_id uuid references public.titulo_receber(id) on delete restrict,

constraint lf_convertido_tem_um_titulo check (
  status <> 'CONVERTIDO' or (titulo_pagar_id is null) <> (titulo_receber_id is null)),
constraint lf_nao_convertido_sem_titulo check (
  status = 'CONVERTIDO' or (titulo_pagar_id is null and titulo_receber_id is null)),
constraint lf_titulo_do_lado_certo check (
  (lado = 'PAGAR' and titulo_receber_id is null)
  or (lado = 'RECEBER' and titulo_pagar_id is null))
```

Duas diferenças que importam:

- **Um gatilho confere no momento da escrita e não impede o apagamento depois.**
  Uma FK impede. O lançamento convertido que aponta para um título excluído é um
  registro histórico mentindo sobre o que gerou.
- **"Exatamente uma preenchida" passa a ser restrição declarada** em vez de
  convenção que alguém precisa lembrar ao escrever a próxima rota.

O segundo CHECK é o menos obvio e o mais importante: sem ele, um `PROGRAMADO`
poderia apontar para um título, e a conversão **pareceria feita sem ter sido** —
o estado mais difícil de diagnosticar dos três, porque nada na linha grita.

---

## U.5 As quatro invariantes do Módulo 12

| # | Regra | Onde vive | Por que ali |
| :-: | --- | --- | --- |
| RN-F15 | a conversão ocorre **uma** vez | `app.converter_lancamento_futuro`, com `for update` antes de decidir | duas execuções concorrentes do job criariam dois títulos para o mesmo compromisso, e o segundo pareceria tão legítimo quanto o primeiro |
| RN-F16 | contrato fora de vigência não converte, **e não desaparece** | mesma função, escrevendo `excecao_conversao` | um lançamento que falhou em silêncio não é revisto |
| RN-F17 | editar ou cancelar só em `PROGRAMADO` | gatilho `lf_protege` | convertido é registro histórico; o que se edita é o título gerado |
| RN-F18 | a recorrência gera **o próximo**, ao converter o atual | `app.gerar_proximo_lancamento`, com índice único `(recorrencia_id, data_prevista)` | gerar o lote criaria anos de lançamentos que a projeção mostra como compromissos firmes |

### RN-F15 tem duas portas, e a segunda não é a concorrência

A defesa óbvia é o `select ... for update` sobre o lançamento **antes** de
decidir, com a mudança de status e a criação do título na mesma transação. O
worker usa `for update skip locked` na seleção do lote, como o de notificação
(0018): o segundo processo não espera, simplesmente não vê a linha.

A porta que a primeira versão deixou aberta era **sequencial**, não concorrente.
O gatilho de RN-F17 bloqueava as colunas de conteúdo — descrição, valor, data —
mas não `status`, `titulo_pagar_id` nem `convertido_em`. Então isto passava pelo
gatilho e pelos dois CHECK do par:

```sql
update lancamento_futuro
   set status = 'PROGRAMADO', titulo_pagar_id = null, convertido_em = null
 where id = ...;
```

O lançamento voltava à fila e convertia de novo. O `for update` não vê isso: as
duas conversões não são simultâneas, são sequenciais com um destravamento no
meio. A guarda que fechou:

```sql
if new.status is distinct from old.status then
  raise exception 'Lançamento em % não muda de estado.', old.status ...
```

Com a guarda removida, a mutação produz **dois títulos para um compromisso**. É o
que o caso 5 do arquivo de invariantes afirma, e foi verificado derrubando a
função e repetindo o caminho.

Um `CANCELADO` ressuscitado tem o mesmo efeito por outro motivo: alguém decidiu
que o compromisso não existe, e ele voltaria a gerar título sem nova decisão.

### RN-F16 não descarta: enfileira

O lançamento fica `PROGRAMADO` com o motivo escrito em `excecao_conversao`, e a
tentativa é contada. É o mesmo tratamento de `excecao_geracao` na 0020, e pela
mesma razão.

Três consequências:

- **A recusa é HTTP 200.** `titulo_id` nulo com `excecao` preenchida não é erro:
  devolver 4xx faria a tela tratar como falha o comportamento correto — e faria o
  worker contar como erro todo dia em que um contrato está suspenso. Um alarme que
  soa sempre deixa de ser lido.
- **A fila é um filtro, não um estado.** `com_excecao` é
  `status = 'PROGRAMADO' and excecao_conversao is not null`. Um lançamento sai
  dela no instante em que o contrato volta a vigorar, sem que ninguém o toque; um
  campo gravado estaria errado a partir daí. Mesmo defeito de classe de
  `EM_ATRASO` como status (Anexo T).
- **Há recuo por tentativa.** `app.lancamentos_elegiveis` filtra
  `tentativas_conversao < 20`: sem isso, um lançamento de contrato suspenso seria
  retentado a cada tick para sempre, competindo com os novos pelo mesmo worker.

---

## U.6 As quatro invariantes do Módulo 13

| # | Regra | Onde vive |
| :-: | --- | --- |
| RN-F19 | a projeção nunca inclui `CANCELADO` nem `BAIXADO` | cláusulas de status em `app.fluxo_caixa_projetado` |
| RN-F20 | a inadimplência do cenário se aplica **só** a entradas | expressão de `entradas`, e só ela |
| RN-F21 | saldo negativo projetado vira alerta | `app.alertas_caixa` |
| RN-F22 | concentração de saída num único dia vira alerta | idem, com limiar do cadastro |

**`BAIXADO` é o mais importante dos dois de RN-F19.** Ele *parece* receita: o
título está encerrado, e um painel que soma "encerrados" fecha com ele. Mas nada
entrou na conta, e somá-lo numa projeção de caixa promete dinheiro que não vem —
o mesmo erro que RN-F14 existe para evitar no relatório de receita, aqui na
previsão.

**RN-F20 é a que passa desapercebida.** Aplicar a inadimplência aos dois lados
faria o cenário pessimista deixar a operação **mais otimista sobre a própria
dívida** — o inverso de um teste de estresse. E o erro passa porque o saldo do dia
continua parecendo razoável: ninguém confere de onde o número veio. A tela diz a
garantia em texto, no contexto da métrica de saídas: "o cenário não desconta a
própria dívida".

### Nenhuma posição diária é gravada

Não existe tabela de posição diária, e a ausência é a decisão. Gravá-la seria dado
derivado armazenado — o defeito que `valor_devido`, `app.saldo_conta` e
`app.receita_realizada` já existem para evitar em outros lugares. Aqui seria pior:
a posição de amanhã muda a cada baixa registrada hoje.

Há teste de banco que afirma a ausência via `information_schema`, e teste
unitário que afirma a ausência das coleções em `BaseDados`. A projeção só está
certa porque é recalculada.

Os **alertas** seguem a mesma regra, e por isso são função e não tabela: o saldo
negativo de terça deixa de existir quando o recebimento de segunda entra, e nada
avisaria a linha gravada. O teste que prova que são derivados compara a janela de
30 dias com a de 180 — um alerta gravado seria o mesmo nas duas.

### O cenário do alerta é o `padrao`, não um escolhido na chamada

RN-F21 fala em "cenário realista". O esquema não tem esse conceito: tem cenários
nomeados pelo locatário, um deles marcado como padrão. Casar pelo nome exigiria
adivinhar que o operador vai chamar a linha de "Realista" — **regra de negócio
inventada**, e o tipo que quebra em silêncio quando ele escolhe outro nome.

O padrão é a referência que o próprio locatário declarou, e é de onde
`limiar_concentracao` já sai; usar cenários diferentes para os dois alertas faria
a mesma janela disparar por um critério e não pelo outro.

E não é parâmetro de propósito: um alerta que muda de cenário conforme quem abriu
a tela soaria para uma pessoa e não para outra no mesmo dia. Na interface, trocar
o cenário muda o gráfico e **não** muda os alertas — há teste de ponta a ponta que
afirma isso.

Um índice único parcial garante um só padrão por locatário:

```sql
create unique index cenario_padrao_uk
  on public.parametro_cenario_caixa (tenant_id) where padrao;
```

Dois padrões fariam "qual cenário o painel abre" depender da ordem da consulta —
e o painel abriria diferente para duas pessoas no mesmo dia, sem que nada
parecesse errado.

---

## U.7 D-23, resolvida como **sim**

A pergunta era se a conversão automática deve notificar.

**Sim.** Geração automática de título sem aviso é o tipo de silêncio que só
aparece no fechamento do mês: o compromisso entrou em aprovação e ninguém soube.

O aviso vai para quem pode decidir o **nível pendente**, na rota do lado certo —
usando o parâmetro `rota` que o Módulo 11 já acrescentou ao
`NotificacaoService`. Um aviso de cobrança que abre a tela de contas a pagar leva
o aprovador a um lugar onde o título não existe.

Duas ausências deliberadas:

- **Título que nasce já aprovado não gera aviso.** Não há decisão pendente, e
  avisar sobre o que não precisa de ação treina a pessoa a ignorar a caixa.
- **Quem converteu não é excluído da lista.** No worker, quem "gerou" foi o
  relógio; no caminho manual, é o gatilho de segregação que barra a mesma pessoa
  aprovando o que criou. Excluí-lo faria o operador que converte à mão nunca ver a
  pendência — e ele pode ser a única pessoa com alçada.

---

## U.8 O worker de conversão

`ConversaoWorker`, no molde de `notificacao.worker.ts`: `OnModuleInit` com
`setInterval(...).unref()`, reentrância por flag, e `CONVERSAO_WORKER=desligado`
para a suíte de testes — que aqui é mais necessário que no de notificação, porque
este **cria títulos**. Um tick de fundo no meio da suíte converteria o lançamento
que o teste acabou de semear, e a asserção falharia apontando o código.

Faz duas coisas por volta, e a ordem importa: primeiro **gera** o que as
recorrências devem produzir, depois **converte** o que já venceu. Invertida, um
lançamento gerado hoje com data de hoje só converteria na volta seguinte.

### Como atravessa locatários sem uma conexão sem RLS

A reserva do lote passa pela superfície fechada de `security definer`
(`app.lancamentos_elegiveis`, `app.recorrencias_a_gerar` — revogadas de `public`,
concedidas a `iarx_app`). A execução acontece numa transação **por locatário**,
com o papel `iarx_app` e a RLS valendo.

Isso exigiu um método novo em `BancoService`:

```ts
async porLocatario<T>(tenantId: string, fn: (db: Executor) => Promise<T>): Promise<T>
```

Ele não é um buraco no isolamento, e a razão é o inverso da que parece: o papel
continua sujeito a RLS, a transação vê **um** locatário, e o `tenant_id` vem de
uma linha que o próprio banco entregou pela superfície fechada — nunca de query,
cabeçalho ou corpo. Em vez de um caminho que vê tudo, são N transações que veem um
locatário cada. `app.usuario_id` fica vazio de propósito: não há usuário, e
inventar um faria a auditoria atribuir a alguém uma decisão que o sistema tomou.
`app.origem` diz `JOB`.

### Por que reservar e converter em transações diferentes não duplica título

O `skip locked` da reserva reduz o desperdício de dois processos disputarem a
mesma linha, mas a **garantia não é dele**: é do `for update` dentro de
`app.converter_lancamento_futuro`, que relê o estado antes de decidir. Se dois
workers reservarem o mesmo lançamento, o segundo recebe "Lançamento em CONVERTIDO
não se converte" — e é por isso que essa exceção específica é contada como
**recusa**, não como falha: ela é o mecanismo funcionando.

### O savepoint que faltava

A primeira versão registrava a execução em `job_execucao` e depois convertia num
laço. Em PostgreSQL um erro aborta a transação **inteira**: o primeiro lançamento
com problema levava consigo os convertidos anteriores e o próprio registro do job
— apagando exatamente o rastro que responde por que não converteu.

Agora há um savepoint por lançamento, e o `rollback to` desfaz só o que falhou.
Mesmo tratamento no laço de geração: uma série com cadastro inconsistente não
impede as outras de gerar.

O registro é **por locatário**, e não um por volta: `job_execucao` é isolada por
RLS, e uma linha sem locatário não seria legível por ninguém.

---

## U.9 Os defeitos que a revisão e os testes acharam

| # | Defeito | Como aparecia |
| :-: | --- | --- |
| 1 | um convertido voltava a `PROGRAMADO` e convertia de novo | segundo título para o mesmo compromisso — segundo boleto, indistinguível do primeiro. Ver U.5 |
| 2 | **todo lançamento atrasado era impossível de converter** | a emissão era `current_date` e os dois títulos exigem `data_vencimento >= data_emissao`, enquanto a fila é `data_prevista <= hoje`. O worker morria exatamente no caso que existe para resolver: o dia em que ficou parado |
| 3 | a projeção por filial vazava o previsto | ela filtra títulos por `filial_id`, e `lancamento_futuro` não tinha a coluna: o recorte de uma filial somava os títulos dela e os compromissos de **todas**. Plausível porque o número fica maior, não menor |
| 4 | o worker perdia o rastro do job na primeira falha | ver U.8 |
| 5 | cenário inexistente caía no padrão em silêncio | a tela mostraria o cenário padrão sob o rótulo do cenário pedido, e a decisão sairia do gráfico errado. Agora é 404 |
| 6 | documentação do alerta em desacordo com o código | dizia "cenário realista, sem inadimplência", mas `p_cenario_id => null` cai no padrão. Um padrão de estresse faria o alerta soar sempre — o oposto do que o comentário prometia |

O defeito 2 foi achado **pelo teste**, não pela revisão: o caso da série
trimestral tinha `proxima_geracao` no passado, e a conversão estourou o CHECK. A
correção é `least(hoje, data_prevista)`. Antecipar o vencimento para hoje seria a
alternativa errada — mudaria em silêncio a data que alguém combinou com o
fornecedor.

Três defeitos foram dos **próprios testes**, e a correção foi assertar a garantia
real em vez de relaxá-la:

- `app.gerar_proximo_lancamento` não incrementa `version` da recorrência (a série
  andar não é edição do molde), e o teste supunha que sim — batendo em 409 e
  acusando a trava otimista;
- um avulso de R$ 3.300 passa da alçada de emissão e nasce pendente, então o 422
  media a aprovação e não a baixa;
- o caso de concentração presumia dominância que a janela compartilhada da suíte
  não tem. Agora ele **constrói** a dominância (três vezes o total já projetado) e
  compara o conjunto de dias alertados com o conjunto acima do limiar — a regra, e
  não um valor.

---

## U.10 Rotas e permissões

Dezessete rotas, **nenhuma permissão nova**. O catálogo fica em 126.

| Rota | Permissão | Nota |
| --- | --- | --- |
| `GET /lancamentos-futuros` | `financeiro:lancamento_manual` | |
| `GET /lancamentos-futuros/projecao` | `pagar:ler` | mesma função do painel |
| `GET /lancamentos-futuros/excecoes` | `financeiro:lancamento_manual` | |
| `GET /lancamentos-futuros/:id` | `financeiro:lancamento_manual` | |
| `GET /lancamentos-futuros/:id/previa-conversao` | `financeiro:lancamento_manual` | leitura pura |
| `POST /lancamentos-futuros` | `financeiro:lancamento_manual` | idempotente |
| `PATCH /lancamentos-futuros/:id` | `financeiro:lancamento_manual` | `If-Match` |
| `POST /lancamentos-futuros/:id/cancelar` | `financeiro:lancamento_manual` | |
| `POST /lancamentos-futuros/:id/converter` | `pagar:criar` **+ o lado** | ver abaixo |
| `GET /recorrencias` | `financeiro:lancamento_manual` | |
| `POST /recorrencias` | `financeiro:lancamento_manual` | idempotente |
| `PATCH /recorrencias/:id` | `financeiro:lancamento_manual` | `If-Match` |
| `POST /recorrencias/:id/gerar-proximo` | `financeiro:lancamento_manual` | **não** idempotente por cabeçalho |
| `GET /fluxo-caixa/projecao` | `financeiro:painel_executivo` | |
| `GET /fluxo-caixa/alertas` | `financeiro:painel_executivo` | |
| `GET /cenarios-caixa` | `financeiro:painel_executivo` | |
| `POST /cenarios-caixa` | `financeiro:painel_executivo` | idempotente |

**Planejar não exige permissão de criar título.** O planejamento não move dinheiro
nem abre aprovação; travá-lo atrás de `pagar:criar` faria o financeiro precisar de
autoridade de lançamento para anotar que em setembro sai o aluguel.

**Converter exige a permissão do lado, e o decorador não consegue expressá-la.**
A rota é uma e serve os dois lados; `@ExigePermissao` é estático. Só com
`pagar:criar`, alguém converteria um lançamento de receita e **emitiria uma
cobrança** — a autoridade que a separação entre as duas permissões existe para
manter apartada. A checagem está no serviço, onde o lado é conhecido (ele vem da
linha, e a linha só existe depois da leitura), e tem teste de integração.

**`gerar-proximo` não é `@Idempotente`.** Duas chamadas geram dois períodos, um
cada — é a chave `(recorrencia_id, data_prevista)` que impede a mesma data de
nascer duas vezes. Marcá-la faria o reenvio devolver o primeiro resultado,
escondendo o segundo período que de fato nasceu.

`/projecao` e `/excecoes` são declaradas **antes** de `:id`, e a rota de projeção
vive no mesmo controlador em vez de num próprio — precisamente para que a
precedência esteja à vista, três linhas acima, em vez de depender da ordem de uma
lista em outro arquivo.

---

## U.11 A interface

Duas telas, e um componente de gráfico novo.

**`ProjecaoCaixa`** não reusa `BarrasMensais` nem `Sparkline`, e a razão é
específica: as duas são chaveadas por competência (AAAA-MM) e desenham só valores
positivos — o eixo começa em zero e cresce. A pergunta desta figura é "em que dia
o saldo fica negativo", e um gráfico que não desenha abaixo de zero a responde
mostrando o negativo como se fosse pequeno e positivo. Reaproveitar era mais
barato; seria mais barato e errado.

Ela mantém o contrato de acessibilidade das outras: conclusão no título acessível,
alternativa em tabela, e segundo canal além da cor — aqui a **hachura** na região
negativa mais a linha do zero em traço cheio. A tabela alternativa lista só os dias
com movimento mais o último: 180 linhas em que a maioria é "0, 0, mesmo saldo" não
é alternativa acessível, é a mesma figura ilegível de outro modo.

Três decisões da tela de lançamentos futuros:

1. **A fila de exceção é filtro, não aba.** Ver U.5.
2. **O diálogo de conversão mostra o que vai ser criado, e o impedimento quando
   há.** Mesmo princípio da prévia de fechamento do Anexo T, com razão mais
   forte: a conversão abre rodada de aprovação, e a recusa por vigência só
   apareceria depois.
3. **A prévia não converte.** Se ela "simulasse" convertendo, abrir o diálogo e
   desistir subiria o contador de tentativas e gravaria uma exceção que nunca
   houve. Há teste de ponta a ponta que abre, volta, e confere que a linha não
   mudou.

E uma da tela de caixa: **a janela começa hoje, sempre**, com opções fixas de
30/60/90/180 dias. Aceitar duas datas livres permitiria projetar o passado, onde
"previsto" não quer dizer nada — o passado tem extrato.

`TituloPagar` ganhou `filialId` no modelo do front, pelo mesmo motivo que
`titulo_pagar` já tinha a coluna no banco: sem ela, o recorte por filial somaria
as entradas de uma filial e as saídas de todas.

---

## U.12 Verificação

| Portão | Resultado |
| --- | --- |
| `npm run tipos` | limpo nos três pacotes |
| `npm run db:test` | 171 invariantes (eram 147) — 24 casos novos |
| `npm run api:test` | 229 testes (eram 181) — 48 casos novos |
| `npm run web:test` | 196 unitários (eram 156) — 40 casos novos |
| `npm run a11y:dom` | 205 testes (eram 182) — 23 casos novos |
| `npm run a11y:tokens` | 202/202 |
| `verificar-rotas.mjs` | 86/86 rotas com autorização declarada (eram 69) |

Duas asserções foram verificadas por **mutação**, e não só por execução: a guarda
de estado de RN-F15 (com ela removida, a mutação produz dois títulos) e as duas
regras da projeção no front (descontar a saída pelo cenário, e ignorar a filial no
previsto — as duas quebram exatamente um teste).

---

## U.13 O que fica em aberto

| # | Pendência | Consequência |
| :-: | --- | --- |
| — | job de conversão sem agendador externo | roda no `setInterval` do processo, como o de notificação. Em várias instâncias, o `for update` da conversão impede duplicidade; um agendador dedicado (pg_cron ou fila) é decisão de infraestrutura |
| — | inadimplência histórica por locatário | RN-F22 menciona "acima da média histórica"; a média exige série de recebimento que só existirá depois de meses de uso. O alerta usa o percentual do cenário, **não** uma média inventada |
| — | `dia_vencimento` limitado a 28 | o que fazer com 29, 30 e 31 em fevereiro é regra que ninguém especificou — **não foi inventada**. A recusa da API diz isso, em vez de "limite do sistema" |
| — | provisão sem contrapartida contábil | `PROVISAO` é lançamento de planejamento, não partida dobrada. Integração contábil não está no escopo |
| — | recorrência não reajusta por índice | herda a pendência de D-21: o lançamento do índice do mês não tem tela. Mudar `valor_base` vale para o próximo período, e não altera lançamento já gerado — o que já foi programado com o valor anterior continua valendo até alguém editá-lo |
| — | duas conversões concorrentes podem adiantar um período da série | `app.gerar_proximo_lancamento` trava a recorrência e lê `proxima_geracao` depois do bloqueio, então nenhum período é **pulado**; o efeito de uma corrida é um período gerado mais cedo do que precisava |
| — | a projeção não considera limite de crédito da conta | `conta_bancaria.limite_credito` existe desde a 0017 e não entra no saldo projetado. Se deve entrar é decisão do operador: para alguns, cheque especial é caixa; para outros, não é |

Com isto o bloco financeiro (Módulos 8 a 13) está completo. Os próximos são o
**Módulo 14 (controle de despesas)** e o **Módulo 5 (Portal do Cliente)** — este
último desbloqueado pela política de cliente que a 0020 criou em
`titulo_receber`.
