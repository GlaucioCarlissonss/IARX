# Anexo K — Formulários e escrita no front-end

Até esta etapa a aplicação era somente leitura: todo botão de ação abria um
aviso dizendo que o formulário viria depois. Este anexo descreve os onze
formulários construídos, a infraestrutura que os sustenta e as decisões que
valem para os próximos.

---

## K.1 Os formulários

| Tela | Formulário | Regra que ele carrega |
| --- | --- | --- |
| Chamados | Abrir chamado | Prazo derivado do SLA da categoria × prioridade; recusa ativo com chamado já aberto |
| Chamados | Atribuir técnico | Especialidade compatível; ordena por região e menor fila |
| Chamados | Concluir chamado | Baixa de peças na mesma operação; saldo validado antes de qualquer escrita |
| Contratos | Novo contrato | Nasce em rascunho; recusa cliente bloqueado; dia de vencimento ≤ 28 |
| Contratos | Alocar equipamento | **RN-001** — sem sobreposição de vigência |
| Contratos | Transição de estado | Máquina de estados do Anexo B.1; encerrar exige devolução |
| Clientes | Novo cliente | CNPJ pelos dois dígitos verificadores; unicidade pelo número puro |
| Clientes | Situação de crédito | Motivo obrigatório nas duas direções |
| Parque | Cadastrar equipamento | Patrimônio e série únicos; categoria e SLA vêm do modelo |
| Parque | Bloquear / desbloquear | **RN-014** — motivo obrigatório; bloqueio ≠ status |
| Parque | Registrar leitura | **RN-020** — contador não retrocede |
| Estoque | Movimentar | Saldo não fica negativo; ajuste respeita o reservado |
| Estoque | Política de reposição | Ponto de pedido ≥ mínimo |
| Faturamento | Tratar medição | Estimativa exige justificativa e fica marcada |
| Contratos e Clientes | Anexar documentos | Qualquer tipo; limite por arquivo e por ficha; remoção com motivo |

---

## K.2 Camada de escrita

### K.2.1 Comandos separados das consultas

`dados/comandos.ts` concentra toda a escrita. Leitura pode ser refeita à
vontade; escrita muda o mundo e precisa de **um** lugar onde as regras vivem —
caso contrário cada formulário reimplementa a sua versão da regra, e as versões
divergem em três meses.

Cada comando devolve `{ ok: true, valor }` ou `{ ok: false, erro }`. Recusa não
é exceção: uma sobreposição de vigência é resposta prevista do sistema, e
modelá-la como erro de campo é o que permite ao formulário apontar o input
errado em vez de mostrar um alerta genérico.

```ts
export interface FalhaComando {
  codigo: string      // estável, igual ao catálogo da API (Anexo D.1)
  mensagem: string
  campo?: string      // qual input destacar
  acoes?: string[]    // bloqueio sem alternativa trava o operador
}
```

Na API real (`apps/api`) estas mesmas regras vivem no banco — RN-001 é uma
exclusion constraint, não um `if`. Aqui elas são replicadas em memória porque
não há banco; a assinatura é a mesma que o cliente HTTP terá, então a troca não
muda os formulários.

### K.2.2 Recarga após escrita

Depois de uma escrita, toda tela aberta precisa refletir o novo estado. Sem
isso a interface passa a mentir logo após a ação — exatamente quando o usuário
está olhando para ela.

`api.assinarMudancas()` notifica; `useConsulta` reexecuta a busca. Duas
sutilezas que só apareceram em teste:

**A recarga é silenciosa.** Voltar ao estado de carregamento depois de salvar
trocaria a lista por skeleton, piscando a página inteira por causa de uma linha
que mudou, e fazendo o usuário perder o lugar. O hook separa "nova tentativa
do usuário" (mostra skeleton) de "recarga por escrita" (mantém o conteúdo).

**Cada leitura devolve uma coleção nova.** Devolvendo a referência interna,
`useMemo([dado])` nas telas vê a mesma identidade e não recalcula — a lista
continuaria exibindo o estado anterior mesmo tendo sido recarregada. Este
defeito passou pela revisão e só apareceu no teste que conta registros depois
de criar um chamado.

### K.2.3 Indicadores derivados

`pendenciasMedicao` estava fixada em `4` no gerador — contradizendo a regra de
que nenhum KPI é digitado. Com escrita, isso vira defeito visível: resolver uma
pendência não baixaria o contador. Passou a ser derivada dos ativos locados sem
leitura na competência corrente, e o gerador agora **planta** quatro casos reais
removendo a leitura do mês (e desfazendo o acumulado, para a próxima leitura não
ser recusada por RN-020).

---

## K.3 Infraestrutura de formulário

### K.3.1 `useFormulario`

Três coisas que, feitas à mão em cada tela, sempre saem diferentes:

**Quando mostrar erro.** Validar a cada tecla acusa "campo obrigatório" antes de
o usuário terminar de digitar a primeira letra. O erro de um campo só aparece
depois que ele foi tocado — ou depois da primeira tentativa de envio.

**Erro do servidor vira erro de campo.** A recusa traz `campo`, e ele é mesclado
aos erros locais. Sem isso, "CNPJ duplicado" apareceria como alerta solto no
topo enquanto o input continuaria verde. E o erro do servidor é limpo assim que
o campo muda: ele se referia ao valor enviado, que já não é verdade.

**Envio duplo.** `enviando` bloqueia o segundo clique. Sem trava, um duplo
clique em "Abrir chamado" abre dois chamados, e o segundo é invisível até
alguém reclamar.

### K.3.2 Resumo de erros — e um defeito que ele causou

O resumo no topo é padrão em formulário longo: sem ele, quem envia e vê a página
"não fazer nada" precisa rolar caçando qual campo ficou vermelho. Com ele, o
foco vai para uma lista contável e cada item leva ao campo, por âncora
`#campo-<nome>` — o que exigiu tornar o id do campo determinístico em vez de
gerado por `useId`.

O defeito: com o resumo aparecendo no **blur**, o primeiro clique em "Cadastrar"
era perdido. A sequência é mecânica — `mousedown` tira o foco do campo, o resumo
aparece, o diálogo cresce, o contêiner recentraliza, o botão sai de debaixo do
ponteiro, e o `mouseup` cai no vazio. Nenhum `click` é disparado. O usuário
clica duas vezes e supõe que "o sistema é lento".

A correção é também a decisão de produto certa: o resumo é um recurso de
**pós-envio**. Erro no campo aparece no blur; o resumo, só depois de tentar
enviar. Um "5 erros" enquanto a pessoa preenche o segundo campo é ruído.

### K.3.3 Diálogo

Implementado à mão em vez de `<dialog>` nativo: `showModal()` ainda diverge
entre navegadores no foco inicial e no backdrop com formulários longos.

As quatro obrigações, todas testadas: `aria-modal` com nome acessível; foco
entra no **primeiro campo** (não no primeiro botão — em formulário o usuário
quer digitar, e mandar o foco para "Cancelar" convida ao erro) e volta à origem
ao fechar; Tab circula dentro; Esc fecha. Só o corpo rola, para o botão de
confirmar não sair da tela em formulário longo.

### K.3.4 Combobox

Um `<select>` com 420 equipamentos é inutilizável. O componente filtra por
texto e segue o padrão APG.

A decisão que mais importa: **opções indisponíveis aparecem desabilitadas com o
motivo**, em vez de serem omitidas. Quem procura o patrimônio 10422 e não o
encontra conclui que digitou errado; vendo "10422 — no contrato SP-2026-0148 até
31/12", resolve sozinho.

Segunda decisão, vinda de um teste que falhou: a lista abre por **intenção**
(clique, digitação, seta), não ao receber foco. Abrindo no foco, a lista cobre o
formulário assim que o diálogo entra, e o primeiro Esc do usuário sempre fecha a
lista em vez do diálogo.

---

## K.4 O que os formulários recusam, e como

O padrão é o mesmo do Anexo J: recusa acionável, nunca só "não pode".

| Situação | Resposta |
| --- | --- |
| Ativo já alocado no período | Nome do contrato, data de liberação e equivalentes livres |
| Cliente com crédito bloqueado | Regularizar, ou solicitar liberação com alçada |
| Leitura menor que a anterior | Cita o valor anterior — quase sempre são dois dígitos trocados |
| Saldo insuficiente | Disponível, quanto está reservado, e as saídas possíveis |
| Encerrar contrato com ativo em campo | Quantos itens, e o que fazer antes |
| Técnico sem a especialidade | Quais famílias ele atende |

Três formulários mostram a **consequência antes de confirmar**: o prazo de SLA
na abertura de chamado, o custo total na conclusão, e o saldo resultante na
movimentação de estoque. É o que faz alguém notar 10 toners no lugar de 1 antes
de gravar.

---

## K.5 Verificação

Onze testes novos, em duas classes.

**Acessibilidade estrutural do modal** — foco entra, Tab não escapa em 30
tabulações, Esc fecha, foco volta à origem, axe limpo nos diálogos de cada
domínio. Nada disso quebra visualmente; só quem navega por teclado descobre.

**Regra de domínio na fronteira de escrita** — CNPJ com dígito trocado, RN-001
com um patrimônio comprovadamente locado (lido da própria tela de parque, não
fixado no teste), RN-020 com leitura retroativa, saldo insuficiente, trava de
envio duplo, e a criação de chamado verificada pela contagem da região viva e
pela busca do número gerado.

### Defeitos que estes testes encontraram

1. **Clique perdido no primeiro envio** (K.3.2) — mecânica de blur + relayout.
2. **Esc fechando a lista em vez do diálogo** (K.3.4).
3. **Recarga sem efeito** — `api` devolvia a mesma referência de array e o
   `useMemo` das telas não recalculava.
4. **Rolagem lateral em 320 px** — a nova coluna de ações trouxe rótulos
   `.so-leitor` para a direita de tabelas largas. `position: absolute` sem
   ancestral posicionado escapa do recorte de `overflow`, e o `scrollWidth` do
   documento cresce mesmo com a tabela corretamente contida. Resolvido com
   `position: relative` no contêiner de rolagem.

O quarto é o mais instrutivo: a tabela estava certa, o contêiner estava certo, e
mesmo assim a página rolava — porque um descendente posicionado não é recortado
por um ancestral que não seja seu bloco contêiner.

---

## K.5b Anexos de documentos

Contratos e clientes recebem arquivos por um diálogo próprio, alcançável pelo
botão **Anexos** na linha da tabela — com a contagem no distintivo, para saber
se há documento sem precisar abrir. Os formulários de cadastro também aceitam
arquivos, gravados logo após a criação da entidade.

### Qualquer tipo, e por que isso é seguro

Não há `accept` no input nem lista de extensões permitidas. Filtrar por extensão
é falsa proteção — renomear contorna — e o custo real é o operador que não
consegue anexar o `.p7s` da assinatura digital, o `.dwg` da planta do andar ou o
arquivo sem extensão que o cliente mandou.

A proteção está em outro lugar, e é ela que torna a permissividade defensável:

- o conteúdo **nunca é executado nem renderizado** pela aplicação;
- o download é **sempre forçado** com o atributo `download`, nunca navegação
  para o arquivo. Um `.html` anexado baixa; não abre no contexto da sessão.

Há um teste dedicado a isso: anexa um `.html` com `<script>`, baixa, e verifica
que nenhuma aba nova foi aberta.

### O que é validado

| Regra | Motivo |
| --- | --- |
| 10 MB por arquivo | Acima disso o caminho certo deixa de ser o formulário e passa a ser upload direto por URL assinada |
| 50 MB por ficha | Evita a ficha que vira repositório de arquivos |
| Arquivo de 0 byte | Quase sempre é exportação que falhou; aceito, vira anexo que ninguém abre |
| Nome duplicado na ficha | Duas versões com o mesmo nome tornam impossível saber qual vale |
| Lote todo ou nada | Aceitar parcialmente deixa o operador sem saber o que subiu |

A duplicidade é acusada **antes do envio**, na própria lista de selecionados —
o arquivo aparece marcado com "já anexado nesta ficha", com borda espessa além
da cor.

### Acessibilidade do upload

Arrastar-e-soltar **nunca é o único caminho**. O `<input type="file">` é um
controle real, focável e acionável por teclado, estilizado mas não escondido; a
área de soltar é acréscimo para mouse e fica `aria-hidden`, porque para quem usa
leitor de tela ela só acrescentaria ruído — o input já está anunciado logo
acima, com rótulo, dica e limite.

A seleção muda uma lista abaixo do foco, então uma região viva anuncia a
contagem e o total.

### Documentos de demonstração

A massa gerada traz anexos com **apenas metadados**, sem conteúdo. O botão de
baixar fica desabilitado com o motivo à mostra, em vez de entregar um arquivo
vazio — um arquivo vazio é pior que a ausência declarada dele.

---

## K.6 O que falta

| Item | Observação |
| --- | --- |
| Substituição de ativo em contrato | Encerrar o item anterior e abrir o novo na mesma transação |
| Renovação com reajuste | Depende do motor de reajuste do Anexo E |
| Upload por URL assinada | Hoje o arquivo trafega pelo formulário; acima de 10 MB o caminho é o cliente enviar direto ao armazenamento |
| Assinatura eletrônica | Envio do contrato para assinatura e retorno do documento assinado |
| Versionamento de anexo | Substituir mantendo o histórico, em vez de remover e reenviar |
| Antivírus no recebimento | Varredura antes de disponibilizar para download |
| Formulários consumindo `apps/api` | A troca é no corpo dos métodos de `api`; os formulários não mudam |
| Rascunho automático | Formulário longo perdido por fechar sem querer |
