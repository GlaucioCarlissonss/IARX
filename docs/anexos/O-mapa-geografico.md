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

**O que se perde:** imagem de satélite, nome de rua, ponto de interesse.
Nenhuma decisão de operação de locação depende disso — o que importa é onde
está o parque, em que cidade, e o quanto está concentrado.

**O que se preserva:** a porta de saída. A projeção é a mesma do Leaflet, do
MapLibre e de qualquer tile raster. Acrescentar uma camada de tiles por baixo
destes polígonos, quando a plataforma estiver hospedada em servidor próprio, é
uma mudança local em `Mapa.tsx`; as coordenadas dos clientes já estão no
formato que ela espera, e nenhum marcador precisa ser recalculado.

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
| Camada de tiles raster sob os polígonos | Porta aberta: mesma projeção, muda uma camada em `Mapa.tsx` quando houver hospedagem própria |
| Geocodificação real do endereço (D-13) | Cliente novo usa a coordenada da praça; ViaCEP → Nominatim → manual, com cache, é o passo seguinte |
| Territórios comerciais e otimização de rota | Módulo próprio — o dado geográfico que eles exigem já existe |
| Municípios, além dos estados | Custaria ~1 MB embutido; só se compensa quando a operação tiver praça em cidade sem capital próxima |
