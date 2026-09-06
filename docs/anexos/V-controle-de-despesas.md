# Anexo V — Controle de despesas: a coluna que faltava, e o que não se guarda

Módulo 14 do [Anexo L](L-lacunas-funcionais.md), sob as decisões D-25 e D-26.
É o topo analítico do bloco financeiro, junto do Módulo 13.

Depende de [Anexo R](R-base-do-financeiro.md) (centro de custo) e
[Anexo S](S-contas-a-pagar.md) (título a pagar, que é a fonte de todo dado
deste módulo).

---

## V.1 O problema, em duas frases

**A fórmula central do módulo não tinha sobre o que rodar.**
`Σ(titulo_pagar.valor_devido) WHERE categoria_id = X` pressupõe uma coluna que
foi especificada no Módulo 10 e que a migração 0019 **não criou** — e o Anexo S
sequer registrava a omissão. O Módulo 14 não estava travado por decisão
pendente; estava travado por uma coluna ausente que ninguém tinha anotado.

**E não havia onde registrar quanto se pretende gastar.** Contas a pagar sabe o
que foi lançado; ninguém sabia contra o quê comparar.

---

## V.2 A decisão que não era nossa

O Anexo L marcava uma pergunta como **regra de negócio de verdade — "não deve
ser escolhida por quem escreve o código"**: o que fazer com os títulos já
lançados, que não têm categoria.

O operador escolheu: **todos apontam para uma categoria "Não categorizado"**.

A escolha tem consequência imediata e é o motivo dela. O painel fecha com o
total de contas a pagar **desde o primeiro dia**, e a fila de trabalho da
classificação fica visível — uma linha grande que alguém precisa distribuir — em
vez de escondida atrás de um total que não bate. As alternativas que ele recusou
deixavam esse dinheiro fora dos números até o backfill terminar, e um painel que
não fecha não dá erro: dá um percentual ligeiramente errado que ninguém confere.

**A promessa tem duas metades, e a segunda é a que sobrevive.** O backfill
resolve o passado. Para o futuro há um gatilho `before insert` que aponta para a
residual quando o título chega sem categoria — sem ele, o total voltaria a
divergir no primeiro título lançado por uma rota que não conhece categoria.

A alternativa ao gatilho seria `categoria_id not null`, e ela foi recusada:
obrigaria toda chamada a escolher uma categoria, transformando o lançamento de
uma despesa numa decisão de classificação contábil no momento errado. `POST
/contas-a-pagar` aceita `categoria_id` e não o exige.

**A residual é marcada por coluna, não pelo nome.** Um `where nome = 'Não
categorizado'` deixaria de encontrá-la no dia em que alguém a renomeasse para "A
classificar", e o gatilho pararia de achar destino sem erro nenhum.

---

## V.3 Nada derivado é gravado

A regra do bloco financeiro inteiro, aplicada aqui pela quarta vez — depois do
saldo de conta (Módulo 9), do saldo de título (Módulo 10) e da projeção de caixa
(Módulo 13).

| Pergunta | Onde a resposta mora |
| --- | --- |
| Quanto já foi gasto numa categoria? | `app.despesa_realizada(...)`, função |
| Quanto já tem destino certo? | `app.orcamento_comprometido(id)`, função |
| Em que degrau do semáforo cada linha está? | `app.execucao_orcamentaria(...)`, calculado na consulta |

Guardar "quanto já foi gasto" divergiria do que os títulos somam no instante em
que um for cancelado ou tiver o valor ajustado. E o limiar de RN-F24 é o caso
mais claro: **um título cancelado depois de disparar o alerta de 90% precisa
fazer o alerta desaparecer**, não persistir um estado que o dado atual já não
sustenta.

Há teste da **ausência** das colunas em `information_schema`, e o equivalente no
front (`assert.ok(!('gastoAcumulado' in orcamento))`).

---

## V.4 D-25 — o que conta como comprometido

**Resolvida como o próprio Anexo L recomendava: o gasto e o aprovado-não-pago.**

Um orçamento que ignora compromisso já aprovado permitiria replanejar verba que
já tem destino certo, e o replanejamento pareceria válido até o vencimento do
título original chegar.

`PENDENTE` e `EM_APROVACAO` ficam de fora, e não por descuido: ainda podem ser
rejeitados, e travar orçamento em cima de pedido não aprovado congelaria verba
por causa de um lançamento que ninguém aceitou.

É a metade que um teste ingênuo não pega — com só o pago contando, um
replanejamento sobre verba já comprometida passa, e o caso 9 de
`16_rnf_despesas.sql` existe exatamente para isso.

---

## V.5 D-26 — o análogo a "custo por paciente"

**Resolvida com os dois lado a lado**: custo por cliente ativo e custo por
equipamento locado.

O pedido original falava em "custo de TI por paciente", que não se aplica a uma
locadora de equipamentos. O Anexo L listou os dois análogos e não escolheu; o
critério de aceite nomeia "custo de TI por cliente". Mostrar um só obrigaria a
decidir sem base — e a única diferença entre eles é o denominador, o que torna
mostrar os dois mais barato do que escolher.

Ambos são nulos sem denominador. Dividir por zero cliente não é custo zero: é
pergunta sem resposta, e um zero na tela responderia errado.

---

## V.6 RN-F23 — replanejamento move, nunca cria nem destrói

As duas atualizações acontecem **na mesma transação**, dentro do gatilho
`replanejamento_aplica`. Uma rota que fizesse metade disso criaria verba do
nada, e o erro só apareceria no fechamento.

O limite é o saldo **não comprometido** da origem (V.4).

E o registro é imutável: ele já moveu valor nos dois orçamentos, e apagar a
linha deixaria os dois alterados sem registro do porquê. O caminho de volta é
outro replanejamento, na direção contrária, com o próprio motivo.

---

## V.7 Duas permissões, e por que não uma

`despesa:ler` e `despesa:orcamento_gerenciar` são dedicadas, como o Anexo L
exige. Não reaproveitam `centro_custo:*`: orçar é responsabilidade distinta de
manter a estrutura de custo, e sobrecarregar uma permissão com as duas faria
conceder orçamento a quem só devia cadastrar centro — sem que nada na tela
dissesse isso.

A separação entre ler e gerenciar é a mesma do centro de custo: quem lança um
título precisa **ler** as categorias para escolher uma, e não precisa poder
criar categoria nenhuma.

As duas estão em [Anexo C](C-matriz-de-permissoes.md) §C.4.2, na árvore de
configuração e nos perfis-semente — os três acoplamentos que a suíte cobra um a
um.

---

## V.8 O que **não** foi construído, e por quê

| Pendência | Por quê |
| --- | --- |
| **Alçada de aprovação do replanejamento** | Não existe `alcada.tipo` de orçamento, nem faixas, nem definição de passo único ou fila como em `titulo_pagar_aprovacao`. Inventar os três seria fabricar autoridade que ninguém escreveu. `replanejamento_orcamento.aprovado_por` é **nulável**, e o nulo diz exatamente isto: nenhum replanejamento passou por aprovação, porque não há alçada definida |
| **`GET /despesas/relatorios/{tipo}?formato=pdf\|xlsx`** | Não há geração de PDF nem de XLSX no servidor em lugar nenhum do projeto. A tela exporta CSV pelo mesmo `lib/baixar.ts` que o Mapa usa. O critério de aceite "relatório exportado em PDF e em Excel contêm os mesmos números da tela" fica **explicitamente não atendido** |
| **Grade de preenchimento em lote** | O fluxo de usuário do Anexo L pede uma grade ano/mês × categoria × centro com preenchimento em lote. A API tem tudo o que ela precisa — inclusive `POST /orcamentos/copiar-de` —, e a tela desta rodada mostra a execução, não o cadastro em lote |

---

## V.9 Verificação

| Portão | Resultado |
| --- | --- |
| `npm run db:test` | 192 invariantes (eram 177) — 15 casos novos |
| `npm run api:test` | 266 testes (eram 254) — 12 casos novos |
| `npm run web:test` | 211 unitários (eram 201) — 10 casos novos |
| `npm run a11y:dom` | 212 testes (eram 207) — 5 casos novos |
| `npm run a11y:tokens` | 202/202 |
| `verificar-rotas.mjs` | 119/119 rotas com autorização declarada (eram 110) |

A verificação que importa mais que as contagens: **o total do painel de despesas
bate com o de contas a pagar para a mesma competência**, na API
(`despesas.test.ts`) e no front (`despesas.test.ts` do web). Se um dia não
bater, o backfill ou o gatilho falhou — e é a única forma de descobrir isso
antes de alguém tomar decisão sobre o número errado.

---

## V.10 Defeitos encontrados ao construir

**`POST /contas-a-pagar` ignorava a categoria.** O esquema não tinha o campo,
então todo título lançado pela rota caía na residual mesmo quando quem lançou
escolheu a categoria — e o gatilho fazia isso em silêncio, porque é exatamente o
que ele existe para fazer.

**Dinheiro atravessava a fronteira com vinte e tantas casas decimais** quando
havia rateio, porque `percentual / 100` é dízima. Não casa com o formato do
contrato, que declara até quatro casas. Arredondado onde a multiplicação
acontece — uma vez, e não em cada consumidor.

**A camada de consultas derivadas do front não tinha cobertura nenhuma**, e não
por descuido: `api.ts` usava uma propriedade de parâmetro no construtor, sintaxe
que o modo de remoção de tipos do Node recusa. Nenhum teste conseguia importar o
arquivo, e com ele toda a camada ficava inalcançável. Três linhas de
reescrita.

**Um teste de fluxo de caixa falhava por causa do calendário.** Ele pagava 900
mil e assumia que isso bastava para o acumulado virar negativo — dependia do
saldo semeado, dos títulos que os outros arquivos criaram antes dele e da
distância entre hoje e as datas fixas de `semear.sql`. O valor passou a ser
derivado da própria projeção.
