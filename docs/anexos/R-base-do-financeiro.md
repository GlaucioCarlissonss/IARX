# Anexo R — Base do financeiro: centro de custo e conta bancária

Módulos 8 e 9 do [Anexo L](L-lacunas-funcionais.md), sob as decisões D-16 e
D-17. Primeiro bloco do financeiro, e pré-requisito dos cinco seguintes.

---

## R.1 Por que estes dois primeiro

Não é por serem pequenos. É porque **todo título a pagar ou a receber referencia
um centro de custo, e toda baixa referencia uma conta**. Construir contas a
pagar antes obrigaria a inventar um lugar provisório para as duas coisas — e um
lugar provisório num banco relacional é uma chave estrangeira que depois não se
remove sem migração de dados.

O que estes dois módulos habilitam:

| Módulo | Depende daqui para |
| --- | --- |
| 10 · Contas a pagar | centro de custo do título, rateio, conta de origem do pagamento |
| 11 · Contas a receber | centro de custo, conta de destino do recebimento |
| 12 · Lançamentos futuros | herda as duas dimensões do título que vai gerar |
| 13 · Fluxo de caixa | parte do **saldo real** das contas, não de uma projeção solta |
| 14 · Controle de despesas | agrupa por centro de custo; sem ele, "por área" é só filial |

---

## R.2 As duas decisões que faltavam, e o raciocínio

O Anexo L marcava D-16 e D-17 como pendentes de resposta do operador. Elas
foram fechadas por recomendação, e as duas são reversíveis com custo diferente
— o que é a razão de a escolha ter sido essa.

### D-16 · rateio por percentual

Três formas eram possíveis: percentual, valor fixo, ou as duas.

**Percentual**, e o argumento é o exemplo do próprio pedido — "60% operação,
40% administrativo". Percentual tem duas propriedades que valor fixo não tem:

1. **Valida-se sozinho.** A soma tem de fechar 100%, e isso é uma restrição que
   o banco checa. Com valor fixo, a verificação é "a soma das partes é igual ao
   total do título" — o que parece equivalente e não é: ela depende do total,
   que pode mudar.
2. **Sobrevive à alteração do valor.** Um título reajustado, com desconto
   aplicado ou com nota de correção muda de valor. Com percentual, o rateio
   continua correto. Com valor fixo, ele passa a não cobrir a diferença, e a
   diferença fica sem centro de custo — despesa lançada em lugar nenhum.

Valor fixo entra depois como **segunda forma de digitar**, não como segunda
forma de armazenar: o valor informado é convertido em percentual no momento do
lançamento e gravado como tal. Um formato de armazenamento, duas formas de
entrada.

A tabela de rateio vive junto do título, no Módulo 10 — não aqui. O que este
módulo entrega é o centro em si.

### D-17 · OFX primeiro

OFX cobre a maioria dos bancos brasileiros sem acordo prévio com o banco. CNAB
240/400 é formato de **retorno de cobrança registrada** — boletos emitidos pela
própria operação —, que é um caso diferente de "conciliar o que já saiu da
conta", e só faz sentido quando a operação emitir boleto por convênio.

A importação não está implementada nesta rodada. O que está é a coluna que ela
vai usar: `movimentacao_bancaria.origem_extrato` guarda a linha original do
arquivo, qualquer que seja o formato. Ela existe por uma razão de auditoria — a
conciliação automática vai propor pares, e quem confere precisa poder ver o
texto bruto que gerou a proposta, não só o resultado dela.

---

## R.3 Saldo é derivado, e é a decisão mais importante do módulo

**Não existe coluna de saldo.** Nem em `conta_bancaria`, nem no contrato de API,
nem no modelo do front-end.

```sql
create or replace function app.saldo_conta(p_conta_id uuid, p_ate date default null)
returns numeric language sql stable as $$
  select c.saldo_inicial + coalesce(sum(
    case when m.tipo in ('ENTRADA','TRANSFERENCIA_ENTRADA') then m.valor else -m.valor end
  ), 0)
  ...
$$;
```

A alternativa óbvia — uma coluna `saldo_atual` mantida por gatilho — funciona
até a primeira correção manual em produção. E a correção manual em produção
acontece: alguém roda um `update` para consertar uma linha, o gatilho não cobre
aquele caminho ou é desabilitado para a operação em lote, e a partir daí o saldo
e o extrato contam histórias diferentes. O sintoma não é um erro: é um relatório
que não fecha, descoberto meses depois, sem pista de onde começou.

É a mesma escolha de `custo_aquisicao` na nota fiscal ([Anexo N](N-nota-fiscal-de-compra.md)):
**se não existe caminho de escrita, não existe caminho de divergência.**

O teste que prova isso não verifica o valor da função — verifica a **ausência da
coluna**:

```sql
select count(*) from information_schema.columns
 where table_name = 'conta_bancaria' and column_name in ('saldo','saldo_atual');
-- tem de ser 0
```

E há o equivalente no front: `assert.ok(!('saldo' in conta))`.

### O parâmetro de data não é conveniência

`app.saldo_conta(id, '2026-02-10')` existe porque a conciliação precisa dele:
comparar com o extrato do dia 10 exige o saldo **do dia 10**, não o de hoje. Sem
ele, conferir um extrato de mês fechado seria impossível pela aplicação.

### Movimentação anterior ao saldo inicial não conta

O saldo inicial de uma data já inclui, por definição, tudo o que veio antes
dela. Somar essas movimentações de novo contaria a mesma entrada duas vezes. A
função filtra por `m.data_movimento >= c.data_saldo_inicial`, e há teste que
insere um lançamento antigo e confirma que o saldo não muda.

---

## R.4 O sinal é o tipo, nunca o número

`valor numeric(15,4) not null check (valor > 0)`.

Permitir valor negativo criaria **duas formas de gravar a mesma saída** — tipo
`SAIDA` com valor positivo, ou tipo `ENTRADA` com valor negativo — e toda soma
no sistema passaria a precisar saber qual das duas está lendo. A primeira
consulta escrita sem esse cuidado dá o dobro do valor certo, ou zero.

Na interface o sinal aparece impresso (`+ R$ 500,00`, `− R$ 200,00`), e a cor é
reforço, não a informação: cor sozinha não é acessível (WCAG 1.4.1).

---

## R.5 Movimentação não se edita nem se apaga

RN-L46. Estorno é lançamento contrário, com motivo obrigatório, apontando o
estornado. A original permanece no extrato.

**O tipo do estorno é invertido pelo servidor, não escolhido pelo chamador.**
Deixar o cliente escolher permitiria estornar uma saída com outra saída — o que
dobraria a despesa em vez de anulá-la, e o extrato continuaria fechando consigo
mesmo. É o tipo de erro que nenhuma soma detecta.

**Estornar um estorno é recusado.** Reabriria o valor original pela terceira
vez. Quem errou o estorno lança um movimento novo, com descrição própria — e a
recusa diz exatamente isso, em vez de só negar.

### As duas exceções à imutabilidade, e por que existem

O gatilho libera exatamente duas coisas depois do lançamento:

1. **Conciliação.** Conciliar não muda o fato financeiro; muda o que sabemos
   sobre ele. E **desconciliar existe** porque conciliar errado acontece — dois
   lançamentos de mesmo valor no mesmo dia é o caso comum. Sem a operação
   inversa, a saída seria estornar um lançamento correto para corrigir um
   metadado, sujando o extrato para consertar uma anotação.

2. **Fechamento do par da transferência, uma vez só.** Cada perna precisa do id
   da outra, e nenhuma existe antes de ser inserida — não há como gravar o par
   no `INSERT`. O que a regra impede é **reapontar**: de nulo para um valor,
   sim; de um valor para outro ou de volta para nulo, nunca.

O item 2 é um defeito que o próprio teste encontrou. A primeira versão do
gatilho incluía `transferencia_par_id` na tupla imutável, e a função de
transferência falhava ao fechar o par — com um comentário meu afirmando que o
gatilho permitia. Não permitia. Sem a segunda metade da regra (a proibição de
reapontar), um `update` posterior poderia costurar a perna de uma transferência
na perna de outra, e a dupla entrada deixaria de fechar **sem que nenhuma linha
parecesse errada**. As duas metades têm teste.

---

## R.6 Transferência é uma chamada, não duas

```sql
select saida_id, entrada_id from app.transferir_entre_contas($1, $2, $3, $4, $5);
```

A função existe para que não haja como fazer diferente. Dois `INSERT` numa
camada de aplicação são dois `INSERT` que alguém pode separar — por um `try` mal
colocado, por um retry parcial, por uma refatoração que extrai um dos dois para
outro método. Uma função é uma chamada, e uma chamada é atômica.

O resultado é uma perna órfã: dinheiro que saiu de uma conta e não entrou em
nenhuma. Não há erro, não há linha inválida; há uma conta com menos dinheiro do
que deveria e nenhuma explicação.

---

## R.7 Três níveis, e o ciclo sai de graça

RN-L42, em gatilho porque `CHECK` não alcança recursão: a profundidade de um nó
depende de outras linhas da mesma tabela.

O detalhe que vale registrar: **o ciclo não precisa de checagem própria**. Ele é
a condição de parada da mesma travessia que conta o nível — subindo a cadeia de
pais, se o próprio id aparecer no caminho, a cadeia se fecha. Sem essa parada, um
ciclo faria o laço rodar para sempre, e o primeiro sintoma seria uma conexão
presa em produção, não uma exceção.

Há também um limite de segurança (`i > 64`), para o caso de a tabela já conter um
ciclo gravado antes de o gatilho existir. Nesse caso a travessia nunca
encontraria `new.id`, porque `new.id` não faz parte do ciclo antigo.

### O nível vem de CTE recursiva, não de coluna

Mesmo raciocínio do saldo: guardado na tabela, `nivel` poderia discordar da
cadeia de pais. E calcular no cliente não serve — a árvore pode chegar paginada,
e um nó sem os ancestrais na mesma página não tem como saber em que nível está.

### Inativar em cascata é recusado

RN-L43. Cascata seria uma ação destrutiva silenciosa: o operador clica num nó e
desliga uma subárvore que não está vendo. A recusa obriga a inativar da folha
para a raiz, o que torna a extensão do estrago visível **antes** de ele
acontecer. A mensagem cita os códigos dos filhos ativos, não só a quantidade.

### `EditarCentroCusto` não aceita `centro_pai_id`

Mover um nó move a subárvore debaixo dele, e com isso pode empurrar netos para
um quarto nível que não existe. Enquanto não houver uma ação própria de "mover"
— que mostre o efeito antes de aplicá-lo —, a alternativa seria a recusa do
gatilho chegando como surpresa depois do clique em salvar.

---

## R.8 Permissões: quatro para conta bancária, não uma

| Permissão | O que autoriza | Por que separada |
| --- | --- | --- |
| `centro_custo:ler` | ver a árvore | quem **lança um título** precisa ler para escolher um centro, e não precisa poder estruturar a contabilidade |
| `centro_custo:gerenciar` | criar, editar, inativar | — |
| `conta_bancaria:ler` | saldo e extrato | é o que a baixa de um título precisa para oferecer o seletor de conta |
| `conta_bancaria:gerenciar` | cadastrar, apelido, limite, status | bloquear uma conta é ação de gestão, não de operação |
| `conta_bancaria:movimentar` | lançar e estornar | o dia a dia |
| `conta_bancaria:transferir` | mover entre contas | **a única ação que move saldo sem um título por trás justificando o valor** — a de menos rastro documental, e a que mais interessa segregar de quem lança despesa |

`centro_custo:ler`/`gerenciar` substituem `financeiro:centro_custo_gerenciar`,
que existia no catálogo como ação do recurso `financeiro`. A promoção a recurso
próprio tem duas razões:

- o segundo nível da árvore de permissões é a **tela**, e centro de custo é uma
  tela com cadastro próprio. Como ação de "Painéis financeiros", a árvore
  afirmaria que ela vive dentro de um painel;
- não havia como conceder **leitura sem gestão**.

Catálogo: 116 → 121 permissões. Há teste de que `centro_custo:ler` sozinha
recebe 403 ao tentar criar, e de que `conta_bancaria:movimentar` sozinha recebe
403 na transferência.

---

## R.9 O que o sistema de tipos pegou

Duas coisas que compilariam em qualquer linguagem sem tipos e teriam ido para
produção:

### `Dinheiro` é string, e isso não é estilo

O primitivo `Dinheiro` em `packages/contracts` é uma **string** com regex de
decimal — a fronteira carrega a representação exata, e a conversão para decimal
acontece num lado só, dentro do banco. Meu repositório convertia `numeric` para
`Number` no mapeamento.

Um `numeric(15,4)` com treze dígitos inteiros não cabe num `double` sem perder o
último centavo. O sintoma seria um relatório fechando com um centavo de
diferença, sem nenhuma pista de origem — exatamente o defeito que o primitivo
existe para impedir. Há asserção de integração de que o saldo chega como string.

### `versaoDe` estava em duplicidade iminente

A função que lê `If-Match` (concorrência otimista) vivia local no controlador de
equipamentos. O segundo controlador que precisa dela é o momento em que uma
função local vira duas cópias, e duas cópias de uma regra de protocolo divergem
na primeira correção que só uma delas recebe. Movida para `comum/versao.ts`.

---

## R.10 Interface

### Centros de custo

Árvore, não tabela: "quanto custa a operação" só faz sentido se "campo" e
"logística" estiverem visivelmente dentro dela. Uma tabela plana com coluna
"pai" obrigaria quem lê a montar a árvore de cabeça.

O botão "Subcentro" no terceiro nível fica **desabilitado com motivo**, não
ausente: a ausência esconderia que a ação existe; o desabilitado diz por que ela
não se aplica ali. E o seletor de centro pai só oferece nós que ainda cabem um
filho — oferecer um nó cheio deixaria o operador escolher e descobrir a recusa
depois de salvar.

**Um defeito de reflow que o teste de 320px encontrou:** a indentação de
terceiro nível transbordava o corpo da página. Remover o recuo em telas estreitas
resolveria o transbordo e **apagaria a hierarquia** para quem vê. A correção foi
tornar visível, abaixo de 560px, o rótulo de nível que já existia para leitor de
tela — um fato, uma fonte, dois modos de apresentação.

### Contas bancárias

Cartão por conta com saldo derivado, e extrato em tabela. O extrato **não tem
botão de editar nem de excluir**, e isso é a regra, não um recorte da tela: há
teste que verifica a ausência dos dois e a presença de "Estornar".

Conta bloqueada não oferece "Lançar" e explica por quê — importação de extrato e
estorno seguem permitidos, porque bloquear uma conta no meio de uma baixa em
curso não deve travar a baixa.

Saldo inicial e identificação bancária não se editam depois do cadastro:
alterá-los reescreveria o saldo de todo o histórico da conta. Para corrigir, a
saída é lançar um ajuste — que fica registrado no extrato.

---

## R.11 Verificação

| Portão | Resultado |
| --- | --- |
| `npm run tipos` | limpo nos três pacotes |
| `npm run db:test` | 100 invariantes (eram 86) — 14 casos novos |
| `npm run api:test` | 100 assertivas (eram 84) — 16 casos novos |
| `npm run web:test` | 95 unitários (eram 74) — 21 casos novos |
| `npm run a11y:dom` | 150 testes (eram 134) — 16 casos novos |
| `npm run a11y:tokens` | 202/202 |
| `verificar-rotas.mjs` | 40/40 rotas com autorização declarada (eram 25) |

---

## R.12 O que fica em aberto

| # | Pendência | Consequência |
| --- | --- | --- |
| D-17 | Importação de extrato OFX não implementada | conciliação é manual; a coluna `origem_extrato` já existe para recebê-la |
| — | Conciliação automática por correspondência | o Anexo L especifica valor + data ±2 dias + documento; nada disso está codificado |
| — | Limite de crédito não gera alerta | é campo declarado; o que fazer ao ultrapassá-lo é decisão do Módulo 13, que tem a visão projetada |
| — | Rateio entre centros | tabela vive com o título, no Módulo 10 |
| — | Relatório por centro de custo (DRE simplificado) | Módulo 14; depende de haver títulos para agrupar |

Nenhuma destas bloqueia o Módulo 10, que é o próximo.
