# Anexo T — Contas a receber: a fatura que passa a existir

Módulo 11 do [Anexo L](L-lacunas-funcionais.md), sob as decisões D-20 e D-22.
Fecha a decisão mais importante do bloco financeiro.

Depende de [Anexo R](R-base-do-financeiro.md) (centro de custo, conta bancária)
e reusa a alçada e a delegação do [Anexo S](S-contas-a-pagar.md).

---

## T.1 O problema, em uma frase

**O sistema sabia quanto cobrar e não tinha onde registrar que cobrou.**

O motor de preço da migração 0012 resolve mensalidade, franquia e desconto com
precedência Contrato → Cliente → Geral. `consumo_competencia` da 0013 consolida
a medição e calcula o excedente. E nada gravava o título: a "fatura" existia
apenas como simulação na interface, recalculada a cada carregamento.

---

## T.2 D-20 · uma tabela só, e por quê

A pergunta era se `fatura` e `contas_a_receber` deviam ser tabelas separadas.

**Uma tabela**, `titulo_receber`, com discriminador `origem`:

| `origem` | O que é | Como nasce |
| --- | --- | --- |
| `CONTRATUAL` | o que se chamaria de fatura | fechamento de competência, valor do motor de preço |
| `AVULSO` | serviço, projeto, reposição fora de contrato | lançamento manual |

A saída barata seria criar `contas_a_receber` para o lançamento manual e deixar
a fatura como está. Ela daria **duas respostas** para "quanto o cliente deve", e
elas divergiriam — a divergência apareceria como um relatório de receita que não
fecha com a régua de cobrança, meses depois, sem pista de onde começou.

A decisão tem três consequências que aparecem no código:

1. **Não existe recurso `/faturas`.** O filtro `?origem=` separa os dois na
   leitura. Uma rota paralela devolveria as mesmas linhas por outro caminho.
2. **Não existe POST que crie um contratual.** Ele nasce do fechamento. Um
   caminho manual permitiria uma cobrança contratual com valor digitado,
   indistinguível da calculada. Há teste de que passar `origem: 'CONTRATUAL'` no
   corpo é **ignorado**, não obedecido.
3. **Nenhum valor novo em `alcada.tipo`.** Se fatura e contas a receber são a
   mesma coisa, a alçada que autoriza emitir uma autoriza emitir a outra.
   `EMISSAO_FATURA` já existia desde a 0002 e nunca teve consumidor. Um
   `EMISSAO_TITULO_RECEBER` separado — que o Anexo L cogitava — reintroduziria na
   tabela de alçada exatamente a duplicação que D-20 removeu do título.

---

## T.3 `app.fechar_competencia` não existia

O Anexo L afirmava que existia. **Não existia.** O que havia era a coluna
`consumo_competencia.fechado_em`, `fechado_por`, e o gatilho
`app.bloquear_competencia_fechada` que impede alterar linha fechada — a trava,
sem a chave. Nenhum caminho do sistema chegava a preencher a coluna.

D-22 já recomendava gerar ao fechar, em vez de criar um segundo agendador. A
função faz as duas coisas numa chamada:

```sql
app.fechar_competencia('2026-06')
  → titulos_criados, em_disputa, consumos_selados, ja_existiam
```

Três decisões dentro dela:

**Sela por último.** Se a geração falhar, o mês continua aberto e o operador
corrige e refecha. Selando primeiro, um erro na geração deixaria a competência
trancada e sem título — o pior dos dois estados.

**Idempotente pela chave, não pela conferência.** `on conflict do nothing` sobre
o índice único `(tenant_id, contrato_id, competencia)`. Reprocessar um mês é
rotina — alguém corrige uma leitura e refecha —, e uma conferência prévia tem
janela de corrida que a chave não tem.

**`get diagnostics row_count`, não `count(*)`.** A primeira versão contava as
linhas com `fechado_por = usuário atual`, o que incluía as que essa mesma pessoa
selara num fechamento anterior: o número relatado crescia a cada refechamento,
dizendo "selei 40" quando selou zero.

---

## T.4 As cinco invariantes

| # | Regra | Por que existe |
| :-: | --- | --- |
| RN-F10 | contratual nasce `PENDENTE_APROVACAO` | ninguém emite cobrança direto do cálculo automático |
| RN-F11 | vigência checada **na geração** | um contrato suspenso entre a leitura e o fechamento geraria cobrança com o valor de um contrato morto |
| RN-F12 | desconto acima da alçada é barrado, mesmo em título aprovado | senão o caminho para cobrar menos é emitir cheio, aprovar, e descontar |
| RN-F13 | recebimento parcial recalcula; excesso recusado | a mais não vira crédito do cliente, vira dinheiro sem explicação na conciliação |
| RN-F14 | `BAIXADO` ≠ `RECEBIDO` | somá-los infla a receita realizada |

### RN-F10 e o piso de um nível

Este é o ponto mais fácil de errar, e a primeira versão da migração o errou.

A contagem de níveis vem da alçada: quantas faixas o valor ultrapassa. Aplicada
crua ao contratual, uma cobrança abaixo da menor faixa nascia com **zero**
linhas de aprovação — isto é, `APROVADO`, emitida direto do cálculo. RN-F10
deixava de existir na prática, e ninguém veria: o título pareceria normal.

> **A alçada decide *quantos* conferem, não *se* alguém confere.**

O contratual tem piso de um nível, sempre, qualquer que seja o valor — ele saiu
de um cálculo que ninguém leu. O avulso segue a alçada à risca, inclusive com
zero: ele já foi digitado por uma pessoa que escolheu o valor, e não há cálculo
automático a conferir.

O piso vive nos dois caminhos que abrem rodada: `app.fechar_competencia` e o
reenvio. Sem ele no reenvio, o atalho para burlar a regra seria "rejeite e
reenvie".

### RN-F11 e a exceção escrita

Contrato fora de vigência, ou item sem política de preço vigente, e o título
nasce `EM_DISPUTA` com o **motivo em `excecao_geracao`** — não apenas com o
estado. "Em disputa" sem motivo obriga quem confere a reconstruir a razão a
partir do histórico do contrato.

Título em disputa **não abre rodada de aprovação**: não se aprova a emissão de
uma cobrança que já se sabe estar errada. Ela existe, aparece na tela, e não vai
ao cliente.

Item sem preço cobra só o excedente e marca a exceção, em vez de cobrar a
mensalidade como zero em silêncio — a mesma regra que o Anexo P já aplicava ao
simulador.

### RN-F12 e o desconto percentual

A alçada de desconto é `alcada.limite_percentual` com `tipo = 'DESCONTO'`, que
existe desde a 0002. Percentual é o certo aqui: um limite em reais faria 5% num
contrato grande ultrapassar o teto e 50% num pequeno passar batido — o inverso
do que a alçada quer controlar.

O operador informa o **valor absoluto** ("R$ 300 de abatimento") e o sistema
converte para percentual. Pedir o percentual na entrada faria o operador fazer
essa conta de cabeça.

"Mesmo em título já aprovado" é a metade que não é óbvia: a aprovação validou um
valor, e o desconto muda esse valor.

### RN-F14 · BAIXADO não é RECEBIDO

Recebido é dinheiro que entrou. Baixado é título encerrado **sem** entrada:
perda reconhecida, acordo que zerou o saldo por outro instrumento, valor que não
compensa cobrar.

Confundir os dois infla a receita realizada — e infla **exatamente onde ninguém
confere**, porque a soma continua fechando com a soma dos títulos "encerrados".
É a classe de erro que não tem sintoma.

A regra deixa de ser intenção e passa a ser código numa função:

```sql
create or replace function app.receita_realizada(p_competencia char(7))
returns numeric as $$
  select coalesce(sum(r.valor_recebido), 0)
    from public.titulo_receber_recebimento r
    join public.titulo_receber t on t.id = r.titulo_id
   where r.estornado_em is null and t.competencia = p_competencia;
$$;
```

Ela soma **recebimentos**, não títulos. Nenhum relatório construído sobre ela
pode contar um BAIXADO como dinheiro que entrou, porque um BAIXADO não tem
recebimento. A interface tem duas métricas separadas, e a da baixa diz "não
conta como receita".

---

## T.5 Nada derivado é gravado

`valor_liquido` é coluna **gerada** (`valor_original - desconto`). Saldo é
`app.saldo_titulo_receber(id)`, função. E **não existe status `EM_ATRASO`**.

O último é o mais interessante, porque a simulação da interface o tinha: o modelo
`Fatura` guarda `status: 'EM_ATRASO'` e `diasAtraso` como campos. No dia seguinte
ao vencimento os dois estão errados, e só um job noturno os corrigiria. É o mesmo
defeito de classe que guardar saldo — e aqui ele estava um passo mais escondido,
porque um status parece um fato e não um cálculo.

Atraso é `data_vencimento < current_date` com o título em aberto. A resposta está
certa em qualquer instante porque não é guardada.

Há teste da **ausência** das colunas em `information_schema`, e o equivalente no
front (`assert.ok(!('saldo' in titulo))`, `!('diasAtraso' in titulo)`).

---

## T.6 Numeração por locatário

Uma cobrança precisa de identificador que o cliente possa citar ao telefone.
Uma sequência global daria números salteados por locatário — o cliente A
receberia 1, 4, 9 —, e "por que faltam números?" é uma pergunta que ninguém quer
responder sobre cobrança.

O contador é uma linha por locatário com `on conflict do update`, que trava a
linha pela transação. Isso **serializa** a emissão dentro de um locatário, e é o
preço de uma numeração sem lacuna. O número não se reescreve: um número citado
num e-mail deixa de identificar a linha se ela puder renumerar.

**Este número não é NF-e nem NFS-e.** Emissão de documento fiscal de serviço
depende de município, certificado e regime tributário, e nada disso foi
inventado.

O locatário vem por parâmetro, não da sessão — a primeira versão lia
`app.exigir_tenant()`. Sob RLS os dois nunca discordam, mas qualquer escrita sem
RLS (migração de dados, correção manual como superusuário) tiraria o número do
contador errado e colidiria com a chave única do locatário certo.

---

## T.7 A RLS é o oposto da do Módulo 10

Em `titulo_pagar`, a **ausência** de política de cliente é uma invariante
testada: a despesa da locadora não é assunto do locatário do equipamento.

Aqui é o contrário. A cobrança **é** do cliente, e é esta tabela que desbloqueia
o Portal do Cliente (Módulo 5). Mas não toda ela: um título em
`PENDENTE_APROVACAO` é pré-cobrança, o valor ainda pode mudar, e mostrá-lo é dar
ao cliente um número que a empresa ainda não assumiu.

O gate vai na expressão da própria política:

```sql
select app.habilitar_rls_cliente(
  'titulo_receber',
  $$case when status = 'PENDENTE_APROVACAO' then null::uuid else cliente_id end$$
);
```

Funciona porque `app.cliente_visivel(null)` devolve **verdadeiro** sem contexto
de cliente (usuário da locadora) e falso com ele — o curto-circuito que a
migração 0011 documenta. Um efeito colateral bem-vindo: uma sessão com contexto
de cliente também não consegue **criar** pré-cobrança, porque o `with check`
falha.

`titulo_receber_rateio` e `_recebimento` não recebem política de cliente: centro
de custo e conta bancária de destino são dado interno. Há teste de que essas duas
políticas não existem.

---

## T.8 As quatorze rotas

Todas com permissão declarada; `verificar-rotas.mjs` reprova o esquecimento no
pull request, não em produção.

| Rota | Permissão |
| --- | --- |
| `GET /contas-receber` | `receber:ler` |
| `POST /contas-receber/previa-alcada` | `receber:ler` |
| `GET /contas-receber/:id` | `receber:ler` |
| `POST /contas-receber` | `receber:criar` |
| `PATCH /contas-receber/:id` | `receber:criar` |
| `POST /contas-receber/:id/reenviar` | `receber:criar` |
| `POST /contas-receber/:id/desconto` | `receber:negociar` |
| `POST /contas-receber/:id/aprovacoes/:nivel/decidir` | `receber:aprovar` |
| `POST /contas-receber/:id/recebimentos` | `receber:baixar` |
| `POST /contas-receber/:id/recebimentos/:rid/estornar` | `receber:baixar` |
| `POST /contas-receber/:id/baixar-sem-recebimento` | `receber:negociar` |
| `POST /contas-receber/:id/cancelar` | `receber:cancelar` |
| `GET /competencias/:comp/previa-fechamento` | `competencia:fechar` |
| `POST /competencias/:comp/fechar` | `competencia:fechar` |

Três permissões novas (123 → 126), cada uma por uma razão concreta:

- **`receber:criar`** — lançar avulso é operação; `receber:ler` é conferência.
- **`receber:aprovar`** — quem gera a pré-cobrança não a aprova. No fechamento
  automático quem "gera" é quem disparou o fechamento, então esta separação é o
  que impede a mesma pessoa de fechar a competência e liberar as cobranças que
  ela produziu.
- **`receber:cancelar`** — cancelar um título aprovado desfaz o trabalho de quem
  aprovou.

E uma escolha que vale explicar: **baixar sem recebimento é `receber:negociar`,
não `receber:baixar`**. Quem registra a entrada de dinheiro não decide que um
valor **não** vai entrar. São as duas metades opostas da mesma linha, e juntá-las
daria a quem confere o extrato o poder de encerrar cobranças.

`POST /desconto` exige `If-Match`: mudar o que se cobra pede ter lido a versão
atual, senão dois descontos concorrentes se sobrescrevem e o último a gravar
decide o valor da cobrança.

---

## T.9 Interface

A tela é uma só, e é D-20 visível. O filtro de origem separa contratual de
avulso; não há tela de faturas.

- **Duas métricas, não uma.** "Recebido na competência" e "Baixado sem receber"
  ficam lado a lado, e a segunda diz "não conta como receita". O diálogo de baixa
  abre com **"Isto não é receber"** e aponta para o caminho certo se o dinheiro
  entrou.
- **O fechamento mostra o que vai fazer.** Quantas cobranças, o total, quantas já
  existem, e a lista das que nascerão em disputa com o motivo de cada uma. O
  botão carrega o número: "Fechar e gerar 12 cobrança(s)". A prévia é leitura e
  pode ser chamada quantas vezes se quiser.
- **A exceção aparece na lista**, não só no detalhe: uma cobrança em disputa que
  parece normal é cobrada por engano.
- **O diálogo de decisão mostra a composição do valor** — competência, bruto
  medido, desconto, itens com excedente. Aprovar um número sem a memória de
  cálculo é assinar em branco.
- **O desconto mostra o percentual enquanto se digita o valor**, porque é o
  percentual que a alçada compara, e o teto do perfil aparece antes da tentativa.
- **O atraso é dito por texto** ("14 dia(s) em atraso"), não só pela cor da data.
- **Sem `receber:aprovar` a lista continua visível** e só a ação sai. Esconder a
  tela faria quem confere a cobrança perder a leitura que ele legitimamente tem.

---

## T.10 Os defeitos que os testes encontraram

Nove, e sete eram defeitos de produto, de modelagem ou de massa.

### 1. Contratual de valor baixo nascia aprovado (produto)

A contagem crua de níveis dava zero abaixo da menor faixa, e o título saía direto
do cálculo automático. RN-F10 não existiria na prática (§T.4).

### 2. O desconto era conferido contra a alçada de quem concedeu antes (produto)

O gatilho fazia `coalesce(new.desconto_por, app.usuario_atual())`. Depois do
primeiro desconto a coluna já estava preenchida, então toda alteração seguinte
era conferida contra a alçada de **outra pessoa** — alguém sem alçada nenhuma
podia mexer no desconto e passar, com a autoridade emprestada do anterior, e o
rastro continuaria apontando para quem não fez. Quem age é sempre
`app.usuario_atual()`, o mesmo princípio do delegante.

### 3. A numeração vinha do contador da sessão, não da linha (modelagem)

§T.6.

### 4. `v_selados` crescia a cada refechamento (produto)

§T.3.

### 5. `NotificacaoService` fixava `#/contas-pagar` (alcance)

Todo aviso de aprovação apontava para contas a pagar. Com este módulo virou
defeito concreto: o aprovador de uma cobrança iria para a tela onde o título não
existe. A rota passou a ser parâmetro.

### 6. A competência corrente já vinha com cobrança gerada (massa)

O gerador derivava um título para **toda** fatura, inclusive a do mês aberto.
Consequência: o diálogo de fechar competência dizia sempre "nada a gerar" — a
tela existia e não podia ser exercitada. Uma competência aberta tem medição e
nenhuma cobrança; é isso que a torna aberta.

### 7. "Em disputa porque o contrato estava em ATIVO" (massa)

Reserva silenciosa (`?? contratos[0]`) num `find` de contrato suspenso que a
massa não tem. O resultado era um registro que se contradizia. Uma reserva
silenciosa produz dado que parece válido e afirma o contrário de si mesmo.

### 8. Transbordo em 320px, em dois lugares (interface)

A barra de ações do cabeçalho com dois rótulos longos, e a linha de quatro
filtros — onde um `<select>` reivindica a largura da sua opção mais longa como
mínimo intrínseco, e "Contratual (gerada do contrato)" estoura o corpo da página
sem que nenhuma regra de largura pareça errada. As correções ficaram dentro da
consulta de mídia: empilhar abaixo de 560px é a única leitura possível, e mudar o
layout em monitor é outra decisão.

### 9. Duas asserções minhas com premissa errada (teste)

Uma esperava uma tabela numa fila que fica vazia — o estado vazio é a própria
prova. A outra lia o nível de aprovação do corpo da mensagem quando ele está no
assunto.

---

## T.11 A lacuna aceita, e como foi mitigada

**No banco e na API, D-20 está aplicada**: existe `titulo_receber` e não existe
tabela de fatura.

**No front, as duas coleções coexistem.** A tela de Faturamento continua lendo a
`Fatura` simulada — foi decisão de escopo do operador, para não refatorar nove
arquivos e os indicadores nesta rodada. É, declaradamente, duas fontes de verdade
sobre "quanto o cliente deve" na camada de demonstração: exatamente o que D-20
existe para evitar.

A mitigação é obrigatória e está no código: os títulos `CONTRATUAL` da
demonstração são **derivados das faturas**, num gerador só. Os dois números não
podem divergir enquanto a lacuna existir. E há teste que compara fatura por
fatura:

```ts
for (const f of b.faturas.filter((x) => x.competencia !== aberta)) {
  const titulo = /* ... */
  assert.equal(Math.round(valorLiquidoDe(titulo) * 100), Math.round(f.valorLiquido * 100))
}
```

Se alguém passar a sortear os títulos à parte, ele falha **antes** de as duas
telas mostrarem receitas diferentes para o mesmo mês.

---

## T.12 Verificação

| Portão | Resultado |
| --- | --- |
| `npm run tipos` | limpo nos três pacotes |
| `npm run db:test` | 147 invariantes (eram 127) — 20 casos novos |
| `npm run api:test` | 181 testes (eram 142) — 39 casos novos |
| `npm run web:test` | 156 unitários (eram 123) — 33 casos novos |
| `npm run a11y:dom` | 182 testes (eram 165) — 17 casos novos |
| `npm run a11y:tokens` | 202/202 |
| `verificar-rotas.mjs` | 69/69 rotas com autorização declarada (eram 55) |

---

## T.13 O que fica em aberto

| # | Pendência | Consequência |
| --- | --- | --- |
| — | Tela de Faturamento não migrada | duas fontes de verdade na demonstração; mitigado por gerador único e teste de paridade, não eliminado |
| — | Emissão de NFS-e | `numero_titulo` é identificador interno. Emissão depende de município, certificado e regime — **não foi inventada** |
| — | Boleto e remessa CNAB | cobrança registrada é outro assunto; `forma` já registra o meio do recebimento |
| — | Régua de cobrança | a fila de notificação receberia os avisos de atraso; a política de quando cobrar, e quantas vezes, é decisão do operador |
| — | Prazo de pagamento do cliente | o vencimento gerado é 30 dias após o fim da competência. Não há campo de prazo no cadastro de cliente; quando houver, é dele que a data sai |
| — | Reajuste por índice (D-21) | decidido cadastro manual; o lançamento do índice do mês não tem tela |
| — | `titulo_receber.recorrencia_id` sem FK | a tabela `recorrencia_receber` é do Módulo 12, que é quem cria a restrição |

Nenhuma destas bloqueia o Módulo 12 (lançamentos futuros), que é o próximo.
