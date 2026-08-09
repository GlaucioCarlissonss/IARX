# Anexo N — Nota fiscal de compra: o ativo nasce da nota

Registro de implementação do Módulo 1 do [Anexo L](L-lacunas-funcionais.md), sob
as decisões do [Anexo M](M-decisoes-mercado-brasileiro.md). Documenta o que foi
construído, por que cada invariante vive onde vive, e o que os testes provam.

---

## N.1 O problema que este módulo elimina

Antes dele, o cadastro de equipamento tinha dois campos com origem em nada:

```
equipamento.valor_aquisicao   numeric   -- digitado
equipamento.nota_fiscal       text      -- texto livre
```

Duas unidades compradas na mesma nota podiam entrar com valores diferentes sem
que nada detectasse. E é sobre `valor_aquisicao` que se calculam a depreciação,
o custo por hora locada e a margem por ativo — os três indicadores que a
proposta usa para justificar a plataforma. Um número digitado sustentando três
indicadores é uma opinião com aparência de fato.

O módulo inverte o fluxo: **o ativo nasce da nota**. Valor de aquisição, data de
início da depreciação e prazo de garantia passam a ter origem única, verificável
e imutável depois de gerada.

O que isso resolve, em ordem de importância:

| Antes | Depois |
| --- | --- |
| Valor de aquisição digitado, sem origem | Rateado do custo da nota, com a soma fechando exatamente |
| Sem data confiável de início da depreciação | Data de entrada da nota |
| Garantia não existia como dado | Herdada do item na integração e congelada ali |
| Patrimônio e série conferidos por convenção | Únicos por construção, contra o parque e contra outras notas |
| Nota fiscal como texto livre | Documento com chave verificada e retenção legal |

---

## N.2 Composição do custo — e por que ela não é óbvia

O total da nota **não** é o custo do ativo. A diferença é tributária, e errá-la
distorce depreciação e margem por todo o ciclo de vida do bem.

O total segue o grupo `ICMSTot` do layout 4.00 da NF-e:

```
vNF = vProd + vST + vFrete + vSeg + vOutro + vIPI − vDesc
```

O custo de aquisição do imobilizado é esse total **menos os tributos
recuperáveis** (CPC 27, item 16; Lei 6.404/76, art. 183, I):

```
custo_aquisicao = valor_total
                − (icms_recuperavel ? valor_icms : 0)
                − (ipi_recuperavel  ? valor_ipi  : 0)
```

Dois detalhes que a fórmula esconde e que decidem o sinal do resultado:

- **ICMS é imposto por dentro.** Já está dentro de `vProd`. Recuperá-lo
  *subtrai* do custo; não recuperá-lo não acrescenta nada.
- **IPI vem por fora.** Está somado em `vNF`. Só é custo quando não recuperável.

**O padrão é não recuperar nenhum dos dois.** Locação de bem móvel não é fato
gerador de ICMS (Súmula 573 do STF), então a locadora pura não se credita —
o imposto vira custo. IPI só é recuperável para industrial ou equiparado.

E o regime fica gravado **na nota**, não apenas em parâmetro do tenant. É a
única forma de mudança de regime não reprecificar aquisição já feita.

`custo_aquisicao` é **coluna gerada** no banco. Nenhuma escrita pode divergir da
fórmula, e o relatório de imobilizado lê exatamente o número que a integração
usou para ratear.

---

## N.3 O rateio, e o centavo que ele não perde

O acessório da nota — frete, seguro, ST, IPI e outras despesas, menos desconto e
tributos creditados — é distribuído proporcionalmente ao valor de cada item:

```
acessório_item = (custo_aquisicao − valor_produtos) × valor_total_item ÷ valor_produtos
custo_item     = valor_total_item + acessório_item
custo_unidade  = custo_item ÷ quantidade
```

Dois pontos deliberados:

1. **O acessório pode ser negativo.** Quando o ICMS creditado supera o frete, o
   custo do ativo fica *abaixo* do valor de face do item. É o resultado correto,
   não erro de sinal — e há teste específico para ele.

2. **O resíduo de arredondamento vai inteiro para a primeira unidade.** Sete
   unidades num item de R$ 1.000,01 não dividem em centavos iguais. Distribuir o
   resto faria a conciliação depender da ordem de leitura; concentrá-lo torna o
   desvio de um centavo localizável, e faz `Σ valor_aquisicao dos ativos =
   custo_aquisicao da nota` valer **exatamente**, não aproximadamente.

A função vive nos dois lados — `app.ratear_custo_nota` no banco,
`previaIntegracao` no front. Não é duplicação por descuido: o banco precisa dela
para o relatório de imobilizado ler o mesmo número que a integração gravou, e a
interface precisa dela para mostrar a prévia *antes* de escrever. As duas têm
teste próprio contra o mesmo caso.

---

## N.4 A chave de acesso, e o que o dígito verificador não pega

A chave da NF-e tem 44 dígitos com estrutura definida:

```
cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
```

O DV é módulo 11 com pesos 2–9 cíclicos, da direita para a esquerda sobre os 43
primeiros. Validá-lo pega chave digitada errada no momento em que o erro ainda é
barato — e não na conciliação fiscal, meses depois.

Mas o DV só prova que a chave é **íntegra**, não que é **desta nota**. Uma chave
perfeitamente válida pode ser de outro documento. Por isso a plataforma confere
os campos embutidos contra o cabeçalho: CNPJ do emitente, modelo, série, número e
competência. Divergência significa XML trocado, e a mensagem diz qual campo
divergiu e o que cada um vale.

Essa conferência é gatilho no banco (`app.validar_chave_nfe_coerente`), não
validação de formulário: nenhum caminho de escrita — correção manual via SQL
incluída — consegue gravar uma nota com chave de outro emitente.

---

## N.5 O XML é fonte, não anexo

Quando o XML da NF-e é enviado, cabeçalho, totais e itens são **extraídos dele** e
os campos ficam somente leitura. Digitação manual só existe na ausência do
arquivo.

A razão é específica: digitar o que já está no documento é a origem mais comum
de divergência fiscal, e é uma divergência que só aparece na auditoria, quando
ninguém lembra qual dos dois números estava certo.

O leitor (`apps/web/src/dados/nfe.ts`) recusa, com motivo:

| Situação | Por que recusar |
| --- | --- |
| Arquivo malformado | `DOMParser` não lança — devolve `<parsererror>`. Sem checar, um PDF renomeado passaria adiante e falharia depois, sem explicação |
| Sem `infNFe` | XML de evento (cancelamento, carta de correção) não é entrada de compra |
| Chave com DV inválido | Arquivo montado à mão ou corrompido |
| CNPJ, série ou número divergentes da chave | Dois documentos misturados |
| Quantidade fracionária | Equipamento é unidade contável e vira patrimônio individual; fração significa serviço ou insumo — outro fluxo |
| Emitente não cadastrado | Criar o fornecedor a partir do XML seria conveniente e errado: o cadastro tem dados fiscais que a nota não traz completos, e um fornecedor pela metade reaparece em toda compra seguinte |

A travessia é por `localName`, não por nome qualificado. O XML da NF-e declara o
namespace `portalfiscal.inf.br/nfe` e alguns emissores o prefixam;
`getElementsByTagName('ide')` funciona no primeiro caso e **falha em silêncio** no
segundo — devolvendo uma nota com todos os campos vazios, que é pior que um erro.

**O único passo que continua humano com XML é vincular cada item a um modelo do
catálogo.** A descrição fiscal ("MULTIFUNC LASER MONO A4 40PPM") não coincide com
o nome comercial, e um casamento automático errado é pior que a digitação —
porque ninguém o revisa. A interface sugere apenas quando um único modelo do
catálogo tem o nome contido na descrição; empate ou ausência devolvem vazio.

---

## N.6 Os três portões, e o que cada um impede

```
PENDENTE_CONFERENCIA ──► CONFERIDA ──► INTEGRADA
         │                    │
         └──► CANCELADA ◄─────┘
```

`INTEGRADA` é terminal. Os ativos já existem carregando valor de aquisição e
garantia derivados da nota; alterar a nota depois deixaria o ativo com um custo
que ela não explica mais. Correção é por nota de ajuste referenciando a original.

| Regra | O que impede | Onde é imposta |
| --- | --- | --- |
| `RN-L01` Nota integrada é imutável | Editar cabeçalho, item ou série depois de o patrimônio existir | Gatilhos `nfc_transicao` e `*_nota_imutavel` |
| `RN-L02` Séries antes da conferência | A nota virar patrimônio antes de alguém abrir as caixas | Gatilho, consultando a contagem por item |
| `RN-L03` Integração atômica | Lote parcialmente integrado, que deixa o operador sem saber o que entrou | Transação única; no front, tudo validado antes da primeira escrita |
| `RN-L04` Patrimônio e série únicos | Duas etiquetas iguais no parque | Índices únicos + gatilho contra `equipamento` |
| `RN-L05` Rateio fecha | Patrimônio que não reconcilia com a nota | `app.ratear_custo_nota` + verificação antes de integrar |
| `RN-L06` Garantia herdada | Garantia que muda quando a nota muda | Congelada na integração; a nota já é imutável |
| `RN-L07` Ativo nasce disponível | Ativo nascer alocado — alocar é decisão comercial, não consequência da compra | Comando de integração |
| `RN-L09` Cancelamento | Cancelar nota que gerou patrimônio, ou reabrir cancelada | Gatilho de transição |
| `RN-L10` Chave coerente | XML de outra nota entrar como se fosse desta | Gatilho `nfc_chave_coerente` |

Uma ordem importa e é imposta, não convencionada: o vínculo
`nota_fiscal_item_serie.equipamento_id` é gravado **antes** da transição a
`INTEGRADA`. Depois dela, o gatilho recusaria a escrita.

---

## N.7 Segregação de funções (RN-027)

Quem lança a nota não a confere. A conferência existe para ser uma segunda
pessoa olhando a mercadoria; se fosse a mesma, seria só um segundo clique.

A regra aparece em dois níveis, e ambos são necessários:

| Nível | O que faz |
| --- | --- |
| Permissão | `nota_fiscal:criar`, `:conferir` e `:integrar` são permissões distintas, em perfis distintos |
| Regra de negócio | Mesmo com as três permissões, a conferência é recusada quando `criada_por = conferida_por` |

A permissão sozinha não basta: um administrador tem tudo, e sem a segunda regra
a segregação valeria para todo mundo menos para quem mais precisa dela.

A distribuição adotada:

| Perfil | Papel na compra |
| --- | --- |
| Operador administrativo | Lança e cancela — é quem recebe o XML do fornecedor |
| Supervisor de suporte técnico | Confere — é quem abre as caixas e lê as etiquetas |
| Analista financeiro | Integra — é o lançamento contábil do imobilizado |
| Diretoria | Só leitura |

---

## N.8 Retenção fiscal dos documentos

Anexos classificados como **XML da NF-e** ou **DANFE** têm retenção mínima de 5
anos e a remoção é recusada dentro do prazo, com a data em que passa a ser
possível.

O fundamento é o art. 173 do CTN: o prazo decadencial para o Fisco constituir
crédito tributário é de cinco anos. O XML é o documento **original**; o DANFE é
representação dele. Perder o XML é perder o documento, e a multa é do locador,
não de quem clicou.

O boleto de compra fica **fora** da regra deliberadamente: é comprovante de
pagamento, não documento fiscal do imobilizado, e prendê-lo por cinco anos
estenderia a regra sem base legal.

---

## N.9 A honestidade sobre o parque antigo

A massa de demonstração reconstrói notas a partir dos ativos que já existem —
agrupando por modelo, filial e mês de aquisição, com o valor dos produtos igual à
soma do `valor_aquisicao` que os ativos já carregavam. Nenhum valor novo é
inventado: um valor inventado faria o custo da nota divergir do patrimônio que
ela originou, e a primeira conciliação apontaria a plataforma como errada.

Os ativos isolados — uma unidade solta de anos atrás — **não** ganham nota
reconstruída. Eles não tiveram nota lançada nesta plataforma, e fingir que
tiveram seria exatamente a mentira que o módulo existe para eliminar.

Por isso a tela declara a lacuna em vez de escondê-la:

> **Sem nota vinculada** — valor de aquisição sem origem verificável.

O indicador de procedência diz quanto do resultado é auditável. É informação
operacional, não vergonha: enquanto a proporção não for 100%, parte da
depreciação e da margem repousa sobre número digitado.

---

## N.10 O que os testes provam

### Banco — `packages/db/tests/04_rnl_nota_fiscal.sql`, 15 casos

| Caso | Prova |
| --- | --- |
| 1 | DV módulo 11 aceita a chave íntegra e recusa a adulterada em um dígito |
| 2 | Total incoerente com o somatório é recusado |
| 3 | Chave de outro emitente é recusada **apontando o CNPJ** — o DV sozinho não pega XML trocado |
| 4 | Nota com chave coerente e dois itens é aceita |
| 5 | Conferência recusada **nomeando o item incompleto** e quantas unidades faltam |
| 6 | Série e patrimônio já usados no parque recusados, sem depender de caixa |
| 7 | Série repetida entre itens da mesma nota recusada |
| 8 | Nota completa passa a `CONFERIDA` |
| 9 | Rateio de 5 unidades soma **exatamente** o custo; garantia herdada por item |
| 10 | Tributo recuperável sai do custo, e o rateio com acessório **negativo** ainda fecha |
| 11 | Integração cria 5 ativos `DISPONIVEL` com `Σ valor_aquisicao = custo da nota` |
| 12 | Após integrada: cabeçalho, item, série nova e remoção **todos** recusados |
| 13 | Revínculo de procedência do ativo recusado |
| 14 | Pulo de etapa, cancelamento sem motivo e reabertura recusados |
| 15 | Nota isolada por tenant sob RLS |

### Interface — `apps/web/a11y.spec.mjs`, 16 testes novos

Além de axe (claro e escuro), reflow em 320 px e indicador de foco, que a rota
nova herda da suíte existente:

- a chave é conferida pelo DV **antes** do envio, e a dica passa a mostrar o que
  ela carrega quando íntegra;
- o XML preenche o cabeçalho e **trava a digitação**, deixando só o vínculo com o
  catálogo em aberto;
- um PDF renomeado para `.xml` é recusado dizendo o que fazer;
- conferência indisponível com unidades por identificar, com o motivo no `title`;
- série já usada no parque recusada **apontando o ativo**;
- série repetida no mesmo item acusada antes do envio;
- a prévia de integração mostra a soma do rateio ao lado do custo, com o selo
  "fecha com a nota" — a garantia fica verificável por quem confirma, não só por
  quem programou;
- integrar cria os ativos `DISPONIVEL` e sela a nota: nem editar séries, nem
  cancelar;
- quem lança não confere — testado ponta a ponta, criando a nota pela interface;
- a segregação também está nos perfis: operação lança, suporte confere,
  financeiro integra;
- o XML da NF-e recusa remoção dentro dos 5 anos, informando a data;
- a procedência ausente do parque antigo é declarada, não escondida.

---

## N.11 O defeito que os testes encontraram

**Diálogo somente leitura que rola era inacessível pelo teclado.**

A prévia de integração é uma tabela sem nada clicável dentro. O corpo do diálogo
transbordava e não tinha conteúdo focável, então quem não usa mouse não
conseguia rolar até as últimas linhas — e as linhas invisíveis são exatamente os
ativos que seriam criados. Violação de WCAG 2.1.1, invisível até então porque
todos os diálogos anteriores eram formulários, e o Tab rolava com os campos.

A correção segue o padrão já usado em `Rolagem`: o corpo recebe `tabindex`,
`role` e rótulo **apenas** quando de fato transborda **e** não tem nada focável
dentro — do contrário, todo formulário ganharia uma parada de Tab inútil.
`ResizeObserver` mais `MutationObserver`, porque o conteúdo pode crescer sem o
contêiner mudar de tamanho (um resumo de erros que aparece).

O teste de regressão foi verificado contra o código anterior: falha sem a
correção, passa com ela.

---

## N.12 Correção ao Anexo L

O Anexo L listava `fornecedor` como dependência **existente**. Não existia —
fornecedor era um campo de texto solto na massa de peças. A tabela foi criada
nesta migração, com CNPJ em dígitos puros: a chave de acesso da NF-e carrega o
documento sem máscara, e a conferência entre os dois exige o mesmo formato dos
dois lados.

Além disso, a migração corrige `app.auditar()` — o gatilho genérico lia
`new.deleted_at` diretamente e estourava em tabelas sem exclusão lógica.
`nota_fiscal_item` e `nota_fiscal_item_serie` não a têm de propósito: a vida
delas termina junto com a nota, por CASCADE, e um item "excluído logicamente"
seria um item que a nota não descreve mais. A leitura passou a ser via `jsonb`.

A correção está na migração **0010**, não na 0003: migração já aplicada não se
reescreve — o ambiente que rodou a 0003 antes desta precisa da diferença como
passo próprio.

---

## N.13 O que fica para a próxima onda

| Item | Por que não agora |
| --- | --- |
| Consulta à SEFAZ por chave | Exige certificado A1/A3 com custódia de chave privada — infraestrutura de segurança, não sprint (D-03) |
| Nota de ajuste referenciando a original | O caminho de correção existe conceitualmente; o cadastro dele é módulo próprio |
| Nota de serviço e importação com nacionalização | Fluxos fiscais distintos, com outra composição de custo |
| Depreciação a partir da data de entrada | O dado agora existe e é confiável; o cálculo é do módulo financeiro |
| Baixa patrimonial dos ativos gerados | Pré-requisito para cancelar nota integrada (RN-L09) |
