# Anexo P — Eixo de cliente, política comercial e consumo

Registro de implementação dos itens **0, 2, 3 e 6** do cronograma do
[Anexo L](L-lacunas-funcionais.md), sob as decisões do
[Anexo M](M-decisoes-mercado-brasileiro.md).

---

## P.1 O que foi entregue nesta onda

| # | Módulo | Banco | Aplicação | API |
| :---: | --- | :---: | :---: | :---: |
| 0 | Eixo de cliente (bloqueante) | ✅ 0011 | — | — |
| 2 | Tabela de franquias | ✅ 0012 | ✅ | — |
| 3 | Preço de locação e simulador | ✅ 0012 | ✅ | — |
| 6 | Consumo de impressões | ✅ 0013 | — | — |

O item 0 era bloqueante: sem ele, os módulos 4 e 5 não começam, porque a
plataforma só sabia isolar por **locadora**, não por **locatário**.

---

## P.2 Item 0 — o eixo que faltava

### O modelo, e por que ele tem dois eixos

```
grupo_economico          ← controle comum (CLT art. 2º §2º)
      │ 1:N
   cliente               ← pessoa jurídica, CNPJ de 14 dígitos
      │ 1:N
 local_operacao          ← onde a máquina está (andar, prédio, unidade)
```

**"Filial do cliente" é um `cliente`**, não uma sublinha dele: tem CNPJ,
inscrição estadual e endereço fiscal próprios, e recebe nota fiscal em nome
dela. Modelar filial como atributo quebraria a emissão. Já o local de operação
não tem CNPJ — é o andar, o galpão, a loja — e é nele que o equipamento fica.

**Grupo econômico é declarado, não derivado da raiz do CNPJ.** Uma holding
reúne empresas de raízes diferentes; e raiz igual não prova grupo (franqueado e
franqueador podem não compartilhar nada além do nome). O que justifica a
entidade é a responsabilidade **solidária** por contribuições previdenciárias
(Lei 8.212/91, art. 30, IX): a análise de crédito do grupo não é a soma das
análises individuais.

`cliente.cnpj_raiz` é coluna gerada e serve para **sugerir** o vínculo. Sugerir,
não impor.

### A política é restritiva, e isso decide tudo

O PostgreSQL combina políticas permissivas com **OU**. Uma política de cliente
esquecida como permissiva **abriria** acesso em vez de fechar — e o vazamento
seria entre locatários do mesmo fornecedor, que no outsourcing de impressão
frequentemente são concorrentes diretos.

```sql
create policy %I_cliente on public.%I as restrictive for all to iarx_app
  using (app.cliente_visivel(<caminho até o dono da linha>))
```

Há teste específico (tenant errado + cliente certo devolve zero linhas) e guarda
de CI que reprova política de cliente sem `AS RESTRICTIVE`.

`app.cliente_visivel(null)` devolve `true` quando não há contexto de cliente. É
esse curto-circuito que permite acrescentar a política a toda tabela sem quebrar
a operação interna da locadora — e há teste para ele também, porque se falhar, a
locadora perde acesso ao próprio negócio.

### `equipamento.cliente_id`, e por que desnormalizar

Uma política que percorresse `contrato_item` a cada linha do parque tornaria a
listagem do portal impraticável. A coluna é mantida por gatilho a partir da
alocação vigente — **desnormalização de que alguém precisa lembrar é dívida;
aqui o gatilho é quem lembra**.

### Duas correções ao que o Anexo L previa

| Previsto | Entregue | Por quê |
| --- | --- | --- |
| `CHECK (senha_hash IS NOT NULL OR subject_oidc IS NOT NULL)` | Descartado | Reprova toda linha existente e falharia na primeira base real. E usuário aguardando convite é estado legítimo — é o estado em que ele passa mais tempo no cadastro em lote. Quem decide se alguém entra é o fluxo de autenticação |
| Perfis-base por backfill | Backfill **e** gatilho na criação do tenant | Tenant criado depois da migração nasceria sem perfil de cliente nenhum, e o primeiro administrador descobriria que não há o que atribuir |

---

## P.3 Itens 2 e 3 — a tabela é a fonte, o contrato é a fotografia

São duas verdades diferentes, e ambas necessárias:

| Onde | O que é | Muda quando |
| --- | --- | --- |
| `tabela_*_item` | O que a política diz hoje | Nova versão da tabela |
| `contrato_item.valor_*` | O que este cliente acordou | Aditivo contratual |

**Trocar a tabela não altera contrato vigente.** É o que separa um reajuste
comercial de um incidente que reprecifica quatrocentos clientes de uma vez — e
há teste que cria uma tabela geral três vezes mais cara e verifica que nenhum
contrato foi tocado.

### RN-L16 é constraint, não gatilho

Duas tabelas ativas não podem cobrir a mesma categoria ou modelo em períodos
que se cruzam: o motor de faturamento não teria como escolher, e escolheria em
silêncio pela ordem do índice.

```sql
exclude using gist (tenant_id with =, alvo_id with =, vigencia with &&)
  where (ativa)
```

A diferença entre isso e um gatilho não é estilística. O gatilho consulta antes
de escrever e tem uma janela entre a leitura e a gravação; duas requisições
simultâneas passariam as duas. `EXCLUDE` é atômico com o INSERT — mesmo
mecanismo de RN-001.

O preço foi desnormalizar alvo e vigência no item, mantidos por gatilho. E isso
trouxe um conflito a resolver: o gatilho de propagação batia no de
imutabilidade, e a tabela nunca sairia de rascunho. A janela aberta é explícita
e enumera **o que constitui a política** em vez de subtrair colunas de
sincronismo — assim uma coluna nova entra bloqueada por omissão, não liberada
por esquecimento.

### As invariantes que evitam prejuízo silencioso

| Regra | O que impede |
| --- | --- |
| Tabela ativa imutável, **inclusive pelos itens** | Reprecificar pela linha — bloquear só o cabeçalho deixaria a porta aberta |
| Categoria sem medidor recusa franquia, nomeando-a | Franquia em notebook produz excedente que nunca é apurado, e sugere ao vendedor uma franquia a negociar onde não há medição |
| Resolução sem política devolve **zero linhas** | Franquia zero cobraria todo o volume como excedente, em silêncio |
| Reajuste com periodicidade < 12 meses é recusado | Lei 10.192/01, art. 2º §1º: cláusula nula de pleno direito. Aceitá-la produz contrato inexigível |
| Desconto com vigência própria | Carência de três meses expira sozinha — é a origem mais comum de receita perdida em locação |
| Descontos não acumulam: item vence contrato | Somar os dois produz mensalidade negativa, e o erro só aparece na fatura |

### O simulador, e a razão de ele duplicar código

`apps/web/src/dados/comercial.ts` espelha `app.resolver_franquia`,
`app.resolver_preco` e `app.desconto_vigente`. A duplicação é deliberada e tem
um motivo único: **o simulador não pode prometer um número que o faturamento
depois não confirma**. Cotar por uma regra e faturar por outra faria a
divergência aparecer no primeiro fechamento — na frente do cliente, sobre um
valor que ele já assinou. Os dois lados têm teste sobre os mesmos casos.

O resultado separa **recorrente de evento**:

```
Mensal líquido    → entra no MRR
Instalação        → evento; primeira fatura
Total do contrato = mensal × prazo + instalação × 1
```

Somar instalação ao MRR infla o indicador de receita recorrente com um valor
que acontece uma vez, e o erro só aparece quando alguém compara o MRR com o
extrato do mês seguinte. Multiplicá-la pelo prazo faz uma proposta de três anos
parecer trinta e cinco instalações mais cara. Há teste para os dois.

Faltando política, a linha **não é cotada em silêncio**: a tela diz que o valor
está incompleto. Assumir franquia zero cobraria todo o volume; assumir excedente
zero cobraria nada. As duas mentiras são piores que a recusa.

---

## P.4 Item 6 — consumo é derivado, nunca digitado

`paginas_mono` e `paginas_color` são **colunas geradas**. Não existe caminho
para informar "o consumo do mês foi X": ele é sempre a diferença entre duas
leituras.

É o que impede a conversa que acontece em toda locadora: *"o sistema diz 12.400,
o cliente reclamou, então ajustei para 9.000."* Para mudar o consumo é preciso
mudar uma leitura — e leitura tem trilha, origem e monotonicidade imposta por
gatilho desde a migração 0004.

O excedente e o valor seguem a mesma lógica. **Um excedente digitado é um
excedente negociável na planilha**, e a fatura deixa de ser consequência da
medição.

### A série fecha

Fevereiro precisa começar onde janeiro terminou, e a recusa cita a leitura
anterior. Sem isso, páginas somem entre dois meses e cada competência parece
consistente sozinha — só a soma do ano não bate com o contador do equipamento,
e aí ninguém sabe qual mês está errado.

### Competência fechada é imutável

Depois de fechada, a consolidação virou base de fatura. Alterá-la faria a fatura
emitida e o consumo registrado divergirem sem que nada acusasse. Reabrir é ação
legítima e auditada; o que não se pode é mexer nos números com ela fechada.

### Alerta e importação

- **Alerta uma vez por limiar e competência**, garantido por índice único.
  Reprocessar o fechamento não reenvia o mesmo aviso ao cliente — a proteção é
  do banco, não da lembrança de quem roda o job. Limiares em 80%, 100% e 120%:
  o primeiro avisa a tempo de negociar; os outros avisam que já virou excedente.
- **Importação é tudo-ou-nada por linha, não por arquivo.** Rejeitar novecentas
  leituras boas por causa de três ruins faria o operador reprocessar o arquivo
  inteiro para corrigir três células. As linhas rejeitadas guardam o conteúdo
  original: sem ele, "linha 412 rejeitada" não diz o que estava escrito ali.

O preço do excedente vem do **item de contrato**, não da tabela vigente: é o que
o cliente acordou, e trocar a tabela não pode reprecificar o mês passado.

---

## P.5 Renumeração das regras

O Anexo L numerou as regras por módulo, e as faixas colidiram — havia dois
`RN-L10` com significados diferentes. Uma regra com dois significados é pior que
uma regra com nome feio, então foram renumeradas em faixa única:

| Faixa | Domínio | Migração |
| --- | --- | --- |
| RN-L01…L10 | Nota fiscal de compra | 0010 |
| RN-L11…L13 | Eixo de cliente | 0011 |
| RN-L14…L20 | Tabela de franquia | 0012 |
| RN-L21…L27 | Tabela de preço | 0012 |
| RN-L28…L34 | Consumo | 0013 |

---

## P.6 O que os testes provam

**Banco — 34 casos novos, total de 69 assertivas**

| Arquivo | Casos | Destaques |
| --- | :---: | --- |
| `tests/05` eixo de cliente | 10 | O concorrente do mesmo fornecedor é invisível; o pátio da locadora também; sem contexto de cliente o eixo não restringe nada; tenant errado + cliente certo devolve zero (política restritiva, não aditiva) |
| `tests/06` franquia e preço | 15 | Modelo vence categoria; ausência de política é ausência, não zero; sobreposição recusada por `exclusion_violation`; sucessão adjacente aceita; contrato vence cliente vence geral; carência expira sozinha; **trocar a tabela não tocou no contrato vigente** |
| `tests/07` consumo | 9 | Consumo não é digitável; salto na série recusado citando a leitura anterior; alerta não duplica ao reprocessar; competência fechada recusa alteração e remoção; estimativa exige justificativa |

**Aplicação — 11 testes novos, total de 97**

Instalação fora do MRR; volume acima da franquia virando excedente com a conta
visível; condição do cliente vencendo a geral — com o nome do cliente lido da
própria aba de preços, não fixado no teste; total do contrato contando a
instalação uma vez só; tabela vigente explicando por que não se edita.

**CI — dois guardas novos**

- Política de locatário sem `AS RESTRICTIVE` reprova o merge.
- `set_config('app.cliente_id', …, false)` reprova pelo mesmo motivo que já
  valia para o tenant: sob pooler em modo transação, um `SET` de sessão vazaria
  o locatário para a requisição seguinte.

---

## P.7 O que falta, e por quê

| # | Módulo | Situação | O que falta |
| :---: | --- | --- | --- |
| 4 | Usuários e permissões | Banco pronto (0011) | Telas de gestão de usuário, vínculo de perfil e escopo, convite e recuperação de senha |
| 5 | Portal do cliente | Depende de 4 | Navegação própria em `/portal`, composição de leitura sobre consumo, contratos e chamados |
| 2, 3, 6 | Franquia, preço, consumo | Banco e (2, 3) aplicação | Controladores REST, no padrão dos de nota fiscal |
| 6 | Consumo | Banco pronto | Tela de acompanhamento, importação de CSV e painel de alertas |

Nenhum desses é bloqueado por decisão pendente — todos os treze pontos do Anexo
M estão resolvidos. O que resta é execução, e a ordem recomendada continua
valendo: **4 → 5**, com os controladores REST em paralelo.

O eixo de cliente ser o item 0 e estar pronto é o que torna essa continuação
direta: o modelo de dados, o isolamento e os perfis-base do locatário já
existem, e já têm teste provando que um cliente não enxerga o concorrente.
