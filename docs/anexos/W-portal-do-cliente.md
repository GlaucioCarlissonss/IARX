# Anexo W — Portal do cliente: a tabela que existia sem leitor, e sete rotas que não filtram nada

Módulo 5 do [Anexo L](L-lacunas-funcionais.md), sob as decisões D-09 e D-10 —
ambas já resolvidas no [Anexo M](M-decisoes-mercado-brasileiro.md) §M.5 antes
desta rodada começar.

Depende de [Anexo Q](Q-usuarios-e-permissoes.md) (perfil, escopo e a lista
branca de permissões de cliente) e de [Anexo P](P-nucleo-comercial-e-consumo.md)
(contrato, item e consumo por competência, que são todo o dado que o portal lê).

---

## W.1 O problema, em duas frases

**O recorte por unidade estava especificado, tabelado, indexado, auditado — e
sem um único leitor.** `usuario_local_cliente` existe desde a `0011`, e nenhuma
política de RLS e nenhuma rota a consultava. Um usuário de cliente com escopo de
unidade via o parque, os contratos e o consumo do **grupo econômico inteiro**;
RN-L26 e RN-L34 não estavam implementadas em lugar nenhum, e o critério de
aceite correspondente falharia se alguém o tivesse executado.

**E o Portal não tinha rota nenhuma.** O Módulo 5 estava escrito desde o
levantamento e nunca foi construído, embora nada o bloqueasse: D-09 e D-10 já
estavam decididas, e a dependência bloqueante (Módulo 4) fechou nesta mesma
sessão.

É a terceira vez nesta sessão que o defeito tem a mesma forma — peça construída,
nunca ligada. As outras duas foram o escopo de cliente que a restrição `CHECK`
recusava (`0022`) e o `app.motivo`, lido pelo gatilho de auditoria desde a `0003`
e preenchido por nenhuma rota. Vale anotar o padrão: **o que não tem consumidor
não tem como acusar que está errado.**

---

## W.2 A decisão: o escopo decide se recorta, o vínculo diz o quê

Era a única decisão real da rodada, e o Anexo L a nomeava: como a política por
`local_operacao` compõe com a de `cliente_id` **sem quebrar o Administrador do
cliente**, que não tem vínculo e precisa ver o grupo.

| Escopo do perfil | O que enxerga |
| --- | --- |
| `CLIENTE` | O próprio CNPJ e os demais do grupo econômico — a política da `0011`, intacta |
| `LOCAL_CLIENTE` | Só os locais vinculados em `usuario_local_cliente`. Sem vínculo, **nada** |

Três razões, e a segunda é a que decide:

1. **É onde o [Anexo C](C-matriz-de-permissoes.md) §C.1 diz que o recorte mora.**
   A fórmula é `possui(permissão) AND registro ∈ escopo AND satisfaz(alçada)`, e
   o escopo é `usuario_perfil.escopo_tipo`. Fazer o recorte depender da
   *existência* de vínculos criaria um quarto termo que a fórmula não tem.
2. **Resolve a contradição aparente do Anexo L.** RN-L26 diz "sem vínculo, não vê
   nada — negado por omissão"; e o Administrador do cliente não tem vínculo e
   precisa ver tudo. As duas só são verdade ao mesmo tempo se o **gatilho** do
   recorte for o escopo: com `LOCAL_CLIENTE` e nenhum vínculo, nada; com
   `CLIENTE`, o grupo. RN-L26 vale para quem ela descreve, e não para todo mundo.
3. **Dá consumidor à correção da `0022`.** `LOCAL_CLIENTE` só passou a ser
   inserível naquela migração; sem esta rodada, aquela correção também ficaria
   sem leitor.

A leitura oposta — "quem tem vínculo é recortado, quem não tem vê tudo" — é a que
parece natural e é a perigosa: um vínculo apagado por engano promoveria o gestor
de unidade a administrador do grupo, em silêncio.

---

## W.3 A política, e os dois curto-circuitos

`0024_escopo_de_unidade.sql`, no molde da `0011`:

```sql
app.locais_visiveis()   -- os local_operacao.id que o usuário atual alcança
app.local_visivel(uuid) -- o predicado das políticas
app.tem_escopo_de_unidade() -- existe perfil com escopo LOCAL_CLIENTE?
```

`app.local_visivel` devolve `true` em dois casos antes de consultar coisa alguma:
quando `app.cliente_atual()` é nulo — quem chama opera a locadora — e quando o
usuário não tem nenhum perfil com escopo `LOCAL_CLIENTE`. São os curto-circuitos
que tornam a política **acrescentável sem risco**: para 99% dos usuários ela é
uma constante, e só desce ao conjunto de vínculos para a minoria que tem escopo
de unidade. É a mesma propriedade que permitiu à `0011` acrescentar a política de
cliente a nove tabelas sem quebrar nada.

As políticas são `as restrictive`, e isso é o ponto: restritivas compõem com
**E**. Uma política permissiva a mais *abriria* acesso — um gestor do cliente A
vinculado por erro de cadastro a um local do cliente B passaria a enxergar B. O
teste `17` prova que não: a política de cliente e a de unidade valem as duas.

Quatro tabelas recortadas: `local_operacao` (por `id`), `contrato_item` e
`consumo_competencia` (por `local_operacao_id`), e `equipamento` por
`exists` sobre `contrato_item`. A `0011` recusou o caminho do `exists` para a
política de cliente por custo; aqui ele é aceitável **porque o predicado só chega
lá para quem tem escopo de unidade**.

O equipamento não é recortado por `local_atual_id`, e a razão é a mesma pela qual
o portal também não o lê: `local_atual_tipo` é texto sem `CHECK`. Uma coluna cujo
domínio ninguém garante não decide o que o cliente enxerga.

---

## W.4 O repositório não tem um `where cliente_id` sequer

Nem um `where local_operacao_id in (...)`. Os dois recortes são da RLS.

Repeti-los no SQL daria a impressão de que o isolamento depende de a consulta
estar certa — e a **consulta nova** que esquecesse um filtro passaria batida, que
é exatamente o modo como esse defeito entra. O que se escreve no repositório são
filtros de conveniência do usuário (`?local_id=`), nunca de segurança.

A diferença é verificável, e é o que os testes fazem: **trocam o usuário do token
e contam linhas, sem tocar nas consultas.** Se o recorte fosse do SQL, trocar o
token não mudaria nada.

Consequência visível em `/portal/resumo`: uma consulta só, com dez subconsultas,
nenhuma delas filtrando por cliente — e ela responde certo tanto para o
administrador do cliente quanto para o gestor de uma unidade. Uma consulta só, e
não dez: os números aparecem juntos no painel e precisam ser do mesmo instante,
senão o cliente vê um consolidado que nenhum estado do banco jamais teve.

---

## W.5 As sete rotas, e as permissões que já existiam

```
GET /api/v1/portal/resumo                     contrato:ler
GET /api/v1/portal/contratos                  contrato:ler    ?local_id=&status=
GET /api/v1/portal/contratos/{id}             contrato:ler
GET /api/v1/portal/equipamentos               equipamento:ler ?local_id=&modelo_id=
GET /api/v1/portal/consumo                    medicao:ler     ?competencia=&local_id=&equipamento_id=
GET /api/v1/portal/custos                     fatura:ler      ?competencia_de=&competencia_ate=
GET /api/v1/portal/custos/{competencia}/memoria  fatura:ler
```

**Nenhuma permissão nova.** As quatro já estão na lista branca que a `0011`
autoriza a perfil de cliente, e o gatilho de lá recusa qualquer outra — de modo
que "perfil de cliente não recebe permissão de escrita" (RN-L25) não depende de
quem cadastra o perfil lembrar disso.

Duas divergências deliberadas da especificação:

- **A memória é endereçada pela competência, não por id de fatura.** O Anexo L
  escreveu `/portal/faturas/{id}/memoria`. O id não serve por duas razões: a
  competência aberta não tem cobrança nenhuma e é justamente a que o cliente mais
  quer conferir; e o que explica o valor é a **medição**, não o título. A
  separação entre os dois foi feita nesta sessão exatamente para isso.
- **`filial_id` virou `local_id`.** O Anexo L fala de `filial_cliente` em vários
  pontos; a entidade é `local_operacao` desde a `0005`, e o nome errado no
  contrato de API seria o mais caro de corrigir depois.

---

## W.6 O que as rotas deliberadamente não devolvem

Margem, custo de manutenção e valor de aquisição não aparecem em resposta
nenhuma. A forma de garantir isso **não** é o serviço lembrar de removê-los:

- `EquipamentoDoCliente` é **tipo próprio**, e não um `omit` de `Equipamento`.
  Com o `omit`, um campo novo no tipo de origem vazaria aqui por omissão — e o
  vazamento seria consequência de um trabalho não relacionado, meses depois.
- A asserção do teste é sobre o **corpo serializado**, não sobre o esquema. É
  assim que se pega o campo entrado por um `select *` esquecido ou por um spread
  numa função de mapeamento, que é onde esse defeito nasce na prática.

E o portal exige contexto de cliente: token sem `cliente_id` recebe
`FORA_DE_ESCOPO`. Para o usuário da locadora `app.cliente_atual()` é nulo, as
políticas de cliente deixam de recortar e as mesmas consultas responderiam a base
inteira do locatário. A recusa é explícita porque o silêncio aqui seria o oposto
do que o prefixo `/portal` promete.

**404, nunca 403**, para registro de outro cliente. Distinguir "não é seu" de
"não existe" confirma a existência do registro alheio, e é oráculo suficiente
para enumerar a base de outro cliente um id por vez. Com a RLS o `select` já não
devolve a linha; o tratamento acima só precisa não reintroduzir a diferença.

---

## W.7 RN-L33 — parcial é derivado, nunca gravado

Competência aberta vem marcada como parcial, com a data da última leitura.
`parcial` sai de `fechado_em is null` e não existe como coluna — mesma regra do
bloco financeiro inteiro: **sem caminho de escrita, não há caminho de
divergência.**

O número parcial não é errado. Errado seria apresentá-lo como fechado, e o
cliente planejar caixa sobre uma medição que ainda vai crescer.

Pelo mesmo raciocínio, a **locação** de `/custos` é a decomposição do total que a
cobrança já fixou (`total − excedente medido`), e não uma segunda soma. Duas
somas paralelas dariam dois números defensáveis para a mesma competência, e o
cliente confrontaria o portal com o boleto — que é precisamente o que RN-L32
proíbe.

---

## W.8 O que **não** foi construído, e por quê

| Item | Por quê |
| --- | --- |
| **A tela de vínculo de unidade** | Não há onde conceder ou retirar um `usuario_local_cliente` pela interface: o convite nasce com escopo de grupo, e o vínculo é ato separado que só existe no banco. É a tela que falta para o recorte ser administrável por quem o usa |
| **`POST /portal/exportacoes`** (RN-L35) | Exportação assíncrona exige geração de PDF/XLSX no servidor, que não existe em lugar nenhum do projeto — a mesma ausência registrada no [Anexo V](V-controle-de-despesas.md) §V.8 |
| **Preferências de notificação** (RN-L36) | Não há tabela de preferência por usuário nem limiar cadastrável, e a especificação não diz a granularidade (por canal? por tipo? por limiar?). É estrutura nova sobre decisão ausente |
| **Visões materializadas** `mv_consumo_mensal_filial` e `mv_contrato_resumo_cliente` | Otimização sem medição é aposta. As consultas diretas respondem, os índices da `0013` as cobrem, e uma visão materializada acrescenta o problema de quando atualizar — inclusive a janela em que o cliente lê número velho logo depois do fechamento |
| **Chamado pelo portal** (D-10) | `os:criar` está na lista branca e os perfis de cliente a têm; o que não existe é o módulo de Ordens de Serviço, que nunca foi especificado no formato do Anexo L |
| **Grupo econômico no front** | A massa de demonstração não modela grupo econômico, então `clientes_no_escopo` é sempre 1 ali. Na API o número vem da política de cliente e pode ser maior — a diferença é da massa, não do produto |

---

## W.9 O segundo shell

O Anexo L pede **um app, dois shells**: mesma base de código, mesmo design
system, mesma API; o perfil determina o menu, as rotas e o recorte. O segundo
shell não existia, e a consequência era medível.

**Antes dele, entrar como usuário de cliente abria a aplicação da operação.** O
Administrador do cliente alcançava sete das vinte telas da locadora — entre elas
a carteira de clientes com rentabilidade, o faturamento do locador e o painel de
exceções da operação —, porque o perfil dele tem `cliente:ler`, `contrato:ler` e
`fatura:ler`, e a verificação de rota olhava só permissão.

A separação que faltava cabe em uma frase: **permissão responde "pode ler
contrato?"; audiência responde "contrato de quem?"**. É a segunda pergunta que o
prefixo `/portal` separa, e ela não se deduz da primeira.

Três consequências de desenho:

- **A audiência vem da identidade, não do perfil.** Trocar de perfil demonstra o
  efeito das permissões sobre o menu e as ações; não muda de aplicação. É o
  espelho do servidor, onde o que distingue `/portal` é o `cliente_id` do token.
- **A guarda vale nos dois sentidos.** Rota da operação recusa quem tem escopo de
  cliente, e rota do portal recusa quem não tem — o par de `exigirCliente()`.
- **A busca global foi recortada junto.** Era o caminho mais fácil de todos:
  digitar um CNPJ na paleta devolvia o cliente dono dele. Buscar não é ação
  separada de ler, e nenhuma permissão o impediria.

Na barra, o seletor de filial some para quem é do cliente — filial é dimensão do
locador — e no lugar dele fica o escopo que de fato se aplica, **escrito**. Pelo
mesmo motivo de `unidades_no_escopo` existir na API: quem enxerga uma unidade
precisa saber que enxerga uma.

A matriz perfil × tela passou a ter duas metades, porque são duas audiências que
nunca se encontram:

```
Operação: AP 20/20 · D 18/20 · AF 17/20 · GF 14/20 · C 14/20 · OA 12/20 · SM 8/20 · CL 7/20 · TM 6/20
Portal:   Administrador do cliente 4/4 · Gestor de unidade 3/4 · Visualizador 3/4
```

O Visualizador não tem `contrato:ler` nem `fatura:ler`: o rail dele encurta
sozinho, sem nenhuma regra escrita na navegação — é a lista branca da `0011`
chegando até a tela.

Consumo e custos ficaram na **mesma** tela, embora o Anexo L os separe: a
pergunta do cliente é uma — quanto vou pagar, e por quê — e separar obrigaria a
ir e vir entre duas telas para responder metade de cada vez.

---

## W.10 Verificação

O que se mediu, e não o que se declarou.

**Primeiro provar o defeito.** Antes da `0024`, um usuário com escopo
`LOCAL_CLIENTE` vinculado a uma unidade **lia a unidade irmã**. Sem essa medida a
correção seria declarada, não demonstrada — e o caso 4 do teste `17` existe pelo
motivo simétrico: o usuário **interno** continua vendo 3 locais, 2 itens e 2
consumos, exatamente como antes. Uma política restritiva a mais que recortasse
quem opera a locadora seria o pior resultado possível desta rodada.

```
packages/db/tests/17_escopo_de_unidade.sql   6 casos
apps/api/test/portal.test.ts                 11 casos
apps/web/test/portal.test.ts                 10 casos
apps/web/a11y.spec.mjs                       13 casos de portal
```

Portões, com as contagens medidas na rodada:

```
npm run tipos                               três pacotes
npm run db:test                             198 asserções
npm run api:test                            277/277
node apps/api/scripts/verificar-rotas.mjs   126/126 declaram autorização
npm run web:test                            221 (eram 211)
npm run build && npm run a11y:dom           225 (eram 212)
npm run a11y:tokens                         202/202
```

---

## W.11 Defeitos encontrados ao construir

1. **`usuario_local_cliente` sem leitor** — o defeito que abriu a rodada, medido
   antes de corrigido.
2. **A `0013` cita regras pelo número errado.** Seus comentários invocam
   RN-L28/L29/L30/L31/L32/L33 para regras de consumo; no Anexo L esses números
   pertencem aos Módulos 4 e 5, e as regras citadas são, na verdade,
   RN-L37/L38/L41/L42/L44/L43. O texto das regras está certo — só a referência
   aponta para o lugar errado, e quem for conferir RN-L33 no anexo encontra
   "competência aberta é parcial", que é regra deste Portal. **Não corrigido
   aqui:** migração aplicada não se edita, e o conserto pertence a uma passagem
   própria de revisão de citações.
3. **`/portal/resumo` devolvia 500 sem competência aberta.** A primeira versão
   punha a competência aberta direto no `from`; sem competência aberta ela não
   devolve linha, a consulta inteira devolvia zero linhas e o resumo virava erro.
   Cliente sem consumo em aberto é o caso **normal** no começo do mês.
   Corrigido com `left join lateral (...) on true`.
4. **O teste de RN-L33 fabricava uma série descontínua.** Ele inseria a
   competência aberta com leitura inicial constante, e o gatilho `cc_serie_continua`
   (RN-L38) recusava — corretamente. A exceção não é engolida pelo `on conflict`,
   e o teste morria antes da primeira asserção, acusando o portal por um defeito
   da própria massa. A leitura inicial passou a ser derivada da final da
   competência anterior do equipamento.
5. **A primeira versão do mesmo teste dependia da massa semeada.** A suíte
   compartilha um banco e roda em ordem alfabética: `contas-receber.test.ts`
   fecha a competência semeada antes de `portal.test.ts` rodar. O teste falhava
   dizendo "não há competência aberta" quando o que houve foi "outro arquivo a
   fechou" — defeitos diferentes, e um teste que os confunde acusa o código
   errado. Agora ele constrói a própria competência, numa que nenhum outro
   arquivo alcança.
6. **A sessão sobrevivia à navegação do teste.** `goto` para um endereço que
   difere só no fragmento **não** recarrega o documento: entrar duas vezes no
   mesmo teste encontrava o formulário montado sobre a sessão anterior, e a tela
   abria como operador. Defeito do teste, não da aplicação — mas que acusaria a
   aplicação.
7. **Uma corrida com o redirecionamento pós-entrada.** Entrar leva a `/`, e a
   raiz manda quem tem escopo para `/portal`: em dois passos. Trocar o fragmento
   antes de isso assentar era sobrescrito logo depois, e o teste acusava a tela
   de não existir quando o que houve foi uma corrida.
