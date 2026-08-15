# Anexo O — Mapa geográfico: um mapa de verdade, dentro da aplicação

Módulo 7 do [Anexo L](L-lacunas-funcionais.md), sob a decisão D-12 do
[Anexo M](M-decisoes-mercado-brasileiro.md) — com uma correção de rota que este
anexo documenta e justifica.

---

## O.1 O requisito, e o que ele descarta

O pedido foi específico: **o quadro do mapa tem de ser um mapa real, e não um
link que abre o Google Maps**.

O descarte importa tanto quanto o requisito. Um botão "ver no Google Maps"
resolve o problema errado:

- a aba que abre não conhece os filtros aplicados;
- não sabe quais clientes estão com crédito bloqueado;
- não volta — a pessoa que precisava decidir de onde despachar um técnico
  perdeu o contexto no caminho;
- e leva o endereço do cliente para um serviço de terceiro a cada clique, o que
  é tratamento de dado pessoal sem base declarada (LGPD art. 7º).

O mapa entregue é interativo dentro da aplicação: projeção Web Mercator,
coordenadas reais, arrasto e zoom contínuos, agrupamento por proximidade,
balão de detalhe, mapa de calor, busca, filtros e exportação.

---

## O.2 A decisão que muda D-12: vetor embutido, não tiles

O Anexo M decidiu **MapLibre + tiles do OpenStreetMap**. Essa decisão não
sobrevive a uma restrição que já existia e que eu não havia cruzado com ela: o
build desta aplicação é **um arquivo HTML único**, aberto por duplo clique e
publicado sob uma política de conteúdo que bloqueia qualquer host externo.

Tiles raster viriam de `tile.openstreetmap.org`. Consequência concreta:

| Ambiente | Com tiles | Com vetor embutido |
| --- | --- | --- |
| Artefato publicado (CSP restrita) | retângulo cinza | mapa funcional |
| Arquivo aberto por `file://` | retângulo cinza | mapa funcional |
| Suíte de testes | nada a afirmar | 12 casos afirmando |
| Servidor próprio com rede | mapa completo | mapa funcional |

Um mapa que só funciona em um dos quatro ambientes não é um mapa: é uma
dependência que falha em silêncio, e falha exatamente onde a demonstração
acontece.

**Decisão revista:** fronteiras vetoriais embutidas, projeção Web Mercator.

**O que se preserva:** a porta de saída. A projeção é a mesma do Leaflet, do
MapLibre e de qualquer tile raster. Acrescentar uma camada de tiles por baixo
destes polígonos é uma mudança local em `Mapa.tsx`; as coordenadas dos clientes
já estão no formato que ela espera, e nenhum marcador precisa ser recalculado.

> **Atualização — a porta de saída foi usada.** A camada de tiles existe desde
> a onda seguinte, com satélite como padrão (ver §O.9). O que muda em relação
> ao texto acima não é a análise, é o papel do vetor: ele deixou de ser *o
> mapa* e passou a ser **o piso**. A tabela dos quatro ambientes continua
> valendo linha por linha — nos dois primeiros os tiles seguem não chegando, e
> é ali que o piso trabalha. A frase que envelheceu é a de que a imagem de
> satélite não faz falta: ela não muda nenhuma decisão de locação, mas muda o
> reconhecimento do lugar, e isso tem valor operacional real ao conferir se o
> ponto caiu no galpão certo.

### Custo do dado embutido

Contorno oficial dos estados (IBGE, via dados públicos), simplificado por
Douglas-Peucker a ~7 km de tolerância e 4 casas decimais:

```
3.4 MB  →  34 KB     85.585 pontos → 1.761 pontos     27 UFs preservadas
```

Ilhas oceânicas foram descartadas: no zoom em que a operação trabalha elas não
aparecem, e cada uma custava pontos. O bundle foi de 476 KB para 536 KB.

---

## O.3 Coordenadas reais onde antes havia pixels

`Regiao` tinha `x` e `y` — um par de números medidos para uma imagem de mapa
que nunca foi construída, e que só faria sentido junto com ela.

```
- { id: 'reg-sp-cap', nome: 'São Paulo — Capital', uf: 'SP', x: 300, y: 250 }
+ { id: 'reg-sp-cap', …, cidade: 'São Paulo', uf: 'SP', lat: -23.5505, lon: -46.6333 }
```

Latitude e longitude sobrevivem a qualquer projeção. Foi o que permitiu trocar
o desenho do mapa sem tocar em nenhum marcador — e é o que permitirá trocá-lo
de novo por tiles.

`Cliente` e `LocalOperacao` ganharam `lat`/`lon`. Na massa de demonstração eles
são dispersos ao redor da praça com correção por `cos(lat)`: um grau de
longitude mede 111 km em Manaus e 96 km em Porto Alegre, e sem a correção os
clientes do Sul apareceriam visivelmente mais espalhados no eixo leste-oeste —
um artefato de projeção que nada no negócio explica.

Sem a dispersão, todos os clientes da mesma praça cairiam no mesmo pixel: o
agrupamento nunca se abriria por mais que se aproximasse, e a tela mentiria
dizendo "1 local" onde há seis.

**Cliente novo cadastrado pela interface** recebe a coordenada da praça da
filial responsável — aparece no mapa desde o cadastro, na cidade certa, no
ponto aproximado. Geocodificar o endereço de verdade continua sendo o que a
decisão D-13 previu (ViaCEP → Nominatim → manual, com cache).

---

## O.4 O que o mapa faz

| Recurso | Por que existe |
| --- | --- |
| Arrasto e zoom contínuos, ancorados no cursor | Aproximar de um agrupamento sem ancoragem o empurra para fora da moldura, e o usuário recentraliza a cada passo |
| Agrupamento por proximidade **em pixels** | É a diferença entre um agrupamento que se abre ao aproximar e um grudado para sempre: o critério tem de ser o que o olho vê |
| Marcador dimensionado pelo número de ativos | A concentração é a informação — cinco clientes com uma impressora não são o mesmo que um com cinquenta |
| Tom do grupo = tom do pior membro | Um cliente bloqueado escondido dentro de um agrupamento verde é o que não pode acontecer |
| Barra de escala | Mapa sem escala não permite julgar distância, e distância decide roteiro de técnico |
| Mapa de calor | Responde "onde está concentrado" sem exigir a leitura de trinta e quatro números |
| Filial mais próxima por haversine | A filial de cadastro e a mais próxima divergem com frequência, e a divergência custa hora de deslocamento em cada chamado |
| Exportação CSV | Separador `;` e BOM: é o que o Excel em pt-BR abre sem passar pelo assistente de importação |

---

## O.5 Acessibilidade tratada como requisito

Mapa é a superfície onde acessibilidade costuma ser abandonada — "é visual,
não tem jeito". Tem.

| Obrigação | Como é cumprida |
| --- | --- |
| Operável por teclado | `role="application"` com instruções no nome; setas deslocam, `+`/`−` aproximam, `Home` reenquadra o Brasil |
| Marcadores alcançáveis | Cada um é um `<button>` real, com nome que diz o local e quantos ativos agrupa — um `<circle>` no SVG não é nada disso |
| Nada só em cor | O marcador traz o número; o recorte "crédito em observação ou bloqueado" lista os mesmos clientes por escrito |
| Nada só na forma visual | A aba **Análises** repete tudo em tabela, e um teste soma a coluna e compara com o KPI |
| Alvo de toque | Área reservada dos controles é **medida**, e marcador que cairia sob um controle opaco não é desenhado |

---

## O.6 Três defeitos que os testes encontraram

### 1. O mapa abria em branco

A vista inicial era `0.5, 0.5` — o centro do quadrado unitário da projeção, que
é o cruzamento de Greenwich com o Equador, no golfo da Guiné. O Brasil ficava
inteiro fora da moldura, à esquerda. O envelope agora é calculado dos próprios
polígonos, e não digitado: um valor fixo sairia de sincronia na primeira troca
de fronteiras, e o mapa abriria no lugar errado sem que nada acusasse.

### 2. A contagem do marcador reprovava contraste

O CSS usava `--cor-atencao-fg` e `--cor-primary-fg`. **Esses tokens não
existem.** A declaração era inválida, a cor caía silenciosamente para a
herdada, e o número saía em texto escuro sobre o âmbar — reprovado em WCAG
1.4.3, no tema escuro.

A correção foi usar `--cor-text-on-accent` **e estender o gate de contraste**:
os tokens `*-mark` eram verificados só como marca contra fundo (3:1), porque
até então nunca haviam sido fundo de texto. O marcador do mapa carrega a
contagem dentro do disco, e ali o limite sobe para 4,5:1. O gate foi de 188
para 198 verificações, e todas passam.

### 3. Alvos de toque sobrepostos

Dois marcadores dimensionados pelo peso encostavam um no outro em 320 px, e um
terceiro caía debaixo do controle de zoom. Alvo obscurecido reprova WCAG 2.5.8
— e, antes disso, é simplesmente inalcançável.

Duas correções:

- **Segunda passada de fusão.** O centro do grupo é a média dos membros, e a
  média pode cair mais perto de outro grupo do que a semente estava. Grupos
  cujos centros ficam a menos que o raio de agrupamento são fundidos, em
  repetição até estabilizar.
- **Áreas reservadas medidas, não estimadas.** O componente mede o que os
  próprios controles ocupam e não desenha marcador ali. Medido porque a barra
  de controles quebra em duas linhas em telas estreitas — qualquer constante
  estaria certa numa largura e errada em todas as outras. A área é inflada pelo
  raio do marcador: testar só o centro deixava passar o marcador cujo corpo
  invadia o controle, que foi exatamente o caso restante.

---

## O.7 O que os testes provam

12 casos novos em `apps/web/a11y.spec.mjs`, além de axe nos dois temas, reflow
em 320 px e indicador de foco, que a rota herda da suíte:

- os 27 contornos de UF são polígonos fechados com dezenas de vértices — não
  um retângulo decorativo nem um ícone de "abrir mapa";
- **nenhum `iframe`, nenhum link para provedor de mapa, nenhuma imagem
  remota** — é a asserção que impede a regressão para "abre no Google Maps";
- todo marcador é `<button>`, com nome que descreve o que agrupa;
- o agrupamento se abre ao aproximar: o maior grupo encolhe;
- teclado desloca, aproxima e reenquadra, com a escala como evidência;
- cliente com crédito bloqueado aparece em tom crítico e também por escrito;
- filtrar reduz marcadores e lista **juntos** — se divergissem, uma das duas
  estaria mentindo e não haveria como saber qual;
- o mapa de calor troca marcadores por densidade;
- a soma da coluna de ativos da aba Análises **reproduz o KPI**;
- o painel do dia traz o mapa embutido, com atalho para a tela cheia;
- a exportação entrega o CSV.

---

## O.8 O que fica para a próxima onda

| Item | Situação |
| --- | --- |
| ~~Camada de tiles raster sob os polígonos~~ | **Feito** — ver §O.9 |
| ~~Geocodificação real do endereço (D-13)~~ | **Feito** — Nominatim, ver §O.9.4 |
| Cache das consultas de geocodificação | Hoje cada busca vai ao serviço; um cache por termo normalizado corta a maior parte das repetições |
| Territórios comerciais e otimização de rota | Módulo próprio — o dado geográfico que eles exigem já existe |
| Municípios, além dos estados | Custaria ~1 MB embutido; e agora compensa menos: com tiles, o nome da cidade vem na imagem |

---

## O.9 A camada de tiles

### O.9.1 O que mudou, e o que não

O mapa passou a ter duas camadas. A de baixo é raster, do provedor escolhido;
a de cima continua sendo tudo o que já existia — marcadores, agrupamento,
calor, escala, teclado. Nenhuma linha do posicionamento mudou, porque a
projeção dos tiles sempre foi a mesma dos polígonos: Web Mercator normalizada
no quadrado unitário. Era exatamente a porta que §O.2 tinha deixado aberta.

O vetor não saiu. Mudou de papel: com imagem, os contornos de UF viram divisa
de estado em traço fino — que o satélite não desenha e a operação consulta o
tempo todo; sem imagem, voltam a ser o mapa inteiro.

**Provedores:** satélite (Esri World Imagery, padrão), ruas (CARTO, com
variante clara e escura conforme o tema), OpenStreetMap clássico, servidor
próprio configurável, e o vetor embutido. A escolha fica no navegador.

**Por que não Leaflet.** Ele traria a camada pronta e custaria as garantias já
testadas: os marcadores padrão dele não são `<button>`, não têm nome
acessível, não respeitam a separação de alvo de toque de WCAG 2.5.8 e não
conhecem as áreas reservadas dos controles. O que Leaflet economiza é o código
que menos custa escrever — a aritmética de tile cabe em cem linhas puras.

### O.9.2 Queda para o vetor, declarada

Uma sondagem ao montar carrega um tile de zoom baixo com prazo de 4 s. O prazo
existe porque o caso pior não é o erro rápido — é o proxy que aceita a conexão
e nunca responde, que foi o comportamento observado ao sondar os cinco
provedores deste ambiente de desenvolvimento.

Sem caminho até o servidor, o mapa volta ao vetor e **diz que voltou**, num
`role="status"`. É o caminho que o artefato publicado percorre sempre, e é bom
que seja explícito em vez de misterioso. Em nenhum momento existe retângulo
cinza: enquanto sonda, o vetor já está desenhado.

### O.9.3 Duas correções que a medição impôs

**O véu não resolvia contraste.** A primeira tentativa foi uma camada
semiopaca sobre a imagem, para prender a luminância do fundo a uma faixa
conhecida. Medido, o pior par ficava em **1,05:1** — e nenhuma opacidade
conserta, porque escurecer o véu ajuda o marcador claro e prejudica o escuro,
e a foto pode ter qualquer luminância. Um único fundo translúcido não limita
os dois lados ao mesmo tempo.

O que resolve é a técnica que a paleta já usava no anel de foco: **dois anéis
de luminância oposta**. Fundo claro contrasta com o anel escuro, fundo escuro
com o claro, e o cinza intermediário contrasta com os dois — 3:1 contra preto
exige luminância acima de 0,10, e 3:1 contra branco exige abaixo de 0,30, de
modo que as faixas se sobrepõem em vez de deixar vão. O portão de contraste
foi de 198 para 202 verificações, e as duas novas medem os anéis contra branco
e preto puros, e não contra tokens — porque o fundo aqui é uma fotografia.

**Alvo obscurecido.** O seletor de camada, posicionado por conta própria,
cobria parte do botão de enquadrar num mapa de 300 px de altura — o do cartão
da tela inicial. Os controles passaram a uma coluna única, onde a sobreposição
deixa de ser possível em qualquer altura.

### O.9.4 Busca de endereço

Nominatim, restrito a `countrycodes=br`, disparado por **ação explícita** e
não a cada tecla. A busca por cliente, cidade e UF continua local e
instantânea; trocá-la por chamada de rede transformaria a operação mais
frequente da tela na mais frágil.

O parser é puro e separado da chamada, porque é onde mora o risco: o serviço
devolve coordenada **como texto** e `boundingbox` na ordem `[sul, norte,
oeste, leste]`, que não é a de nenhuma outra API de mapa. Nada disso lança —
tudo isso enquadraria o mapa em lugar nenhum.

O resultado escolhido pode virar a coordenada de um cliente, e aí deixa de ser
navegação e vira cadastro. A migração 0014 impõe as duas regras que isso exige:

| | Regra | Por quê |
| --- | --- | --- |
| RN-L35 | Coordenada tem origem declarada | Sem proveniência ninguém sabe se um ponto pode ser corrigido por um palpite — e uma coordenada de rastreio sobrescrita por geocodificação aproximada é perda que não se desfaz |
| RN-L36 | Latitude e longitude não se trocam | O erro clássico da área e o pior tipo: não lança nada, o ponto cai no oceano Índico, e a única pista é alguém reparar que um cliente sumiu do mapa |

Ambas em gatilho, e a restrição de domínio como `not valid`: uma base
existente pode ter `geo_precisao` com texto livre desde a 0008, e reprovar o
histórico derrubaria o deploy por dado que a regra nova nem pretende julgar.

**Sobre depender de serviço público.** A política de uso do Nominatim pede no
máximo uma requisição por segundo e desaconselha uso pesado; o OpenStreetMap
diz o equivalente sobre os tiles. O limite está respeitado no código, mas a
resposta certa quando a plataforma crescer é hospedar o próprio Nominatim ou
contratar um geocodificador — e a mesma troca vale para os tiles, que já têm
campo de URL e credencial na interface. **Credencial usada em navegador é
pública por natureza**: provedores a restringem por domínio, não por segredo,
e a interface diz isso com todas as letras.

### O.9.5 Como isto foi verificado sem rede

Este é o ponto que mais importa registrar. Os servidores de tile e o Nominatim
**não respondem** neste ambiente nem na integração contínua — sondei os cinco,
os cinco falharam. Testar contra a internet real seria trocar um teste por uma
aposta: passaria ou falharia por motivos alheios ao código, e ainda gastaria a
cota de um serviço mantido por doação.

A saída é interceptar no navegador. `page.route` responde à requisição do tile
com um PNG local e à do Nominatim com uma resposta real recortada. Com isso é
determinístico em CI:

- os tiles pintam, posicionados, com os marcadores por cima;
- a URL do Esri leva os eixos na ordem dele — asserção ancorada na coordenada
  constante do tile de sondagem, porque conferir só o formato `\d+/\d+`
  casaria igual com os eixos trocados (verifiquei que a asserção pega a troca);
- a atribuição de licença aparece;
- sem tiles, o mapa cai no vetor e avisa;
- a camada escolhida sobrevive à recarga e o seletor funciona só pelo teclado;
- a busca local não emite requisição nenhuma;
- o serviço de endereço fora do ar não derruba a tela;
- axe limpo sobre a imagem e com resultados de endereço na tela.

Somam-se 29 testes unitários da aritmética pura — nível de tile, cobertura da
moldura, volta ao antimeridiano, recorte polar, montagem de URL, parser do
Nominatim — em `node --test`, que executa TypeScript direto.

O que **não** é verificável aqui, e não deve ser afirmado por nenhum teste: se
os servidores públicos estão no ar. Isso depende de terceiro e se confirma
abrindo a aplicação fora do sandbox.
