# Anexo Q — Usuários, perfis e permissões: da coluna ao botão

Módulo 4 e item 4.5 do [Anexo L](L-lacunas-funcionais.md), sob as decisões D-07
e D-15 do [Anexo M](M-decisoes-mercado-brasileiro.md) — com **D-07 revertida**,
e este anexo registra por quê.

Pré-requisito declarado do bloco financeiro: nenhum módulo dos itens 8 a 14
começa antes daqui, porque todos eles têm ação que precisa de aprovação, e
aprovação sem perfil verificável é assinatura sem assinante.

---

## Q.1 O que existia, e por que não bastava

Antes desta rodada o sistema tinha **autorização sem autenticação**. As duas
palavras se parecem e o que faltava era a segunda:

| Peça | Estado anterior |
| --- | --- |
| `usuario`, `perfil`, `usuario_perfil` | Tabelas desde a migração 0002 |
| RLS por locatário e por cliente | Migrações 0006 e 0011 |
| Guarda de rota negando por padrão | `apps/api`, desde o Anexo J |
| Catálogo de permissões | `packages/contracts`, 113 nomes |
| **Verificação de senha** | **não existia** |
| **Sessão revogável** | **não existia** |
| **Tela de usuário, perfil ou login** | **não existia** |

O `claims` que a API usava vinha de um cabeçalho de desenvolvimento. Havia
portanto um sistema que sabia perfeitamente **o que** cada perfil pode fazer e
não tinha como saber **quem** estava pedindo.

---

## Q.2 D-07 revertida: implementação própria, não Supabase Auth

O Anexo M havia decidido Supabase Auth. A decisão foi revertida a pedido do
operador, e a reversão tem consequência técnica que vale registrar em vez de
tratar como preferência.

**O que se ganha:** o usuário passa a viver numa tabela só. Com Supabase Auth,
a identidade fica em `auth.users` (schema que a aplicação não possui) e o
perfil em `public.usuario`, unidos por um `uuid` — e toda consulta que precisa
de e-mail e permissão junto atravessa a fronteira de dois donos. A política de
senha por locatário (D-15) também deixa de ser possível: `auth.users` tem uma
política global por projeto, não por tenant.

**O que se perde, e precisa entrar no roadmap:** confirmação de e-mail,
provedores sociais, MFA pronto e rotação de chave de assinatura passam a ser
trabalho nosso. O MFA em particular já era débito conhecido — a coluna
`usuario.mfa_habilitado` existe desde a migração 0002 e nunca teve fluxo.

### O perfil de custo escolhido

Argon2id, perfil interativo da RFC 9106: **19 MiB de memória, 2 iterações,
paralelismo 1**. Não é número escolhido por gosto — é o segundo perfil
recomendado da própria RFC, o indicado para verificação sincrônica dentro de
uma requisição HTTP. O formato gravado é PHC
(`$argon2id$v=19$m=19456,t=2,p=1$<sal>$<hash>`), que carrega os parâmetros
dentro do próprio hash: subir o custo no futuro não invalida os hashes
antigos, porque cada um sabe com que custo foi gerado.

O `CHECK` que exige o prefixo `$argon2id$` entrou como `not valid`
(RN-L37). Validar na hora exigiria reprovar linhas que já existem — e as que
existem são as contas semeadas sem senha, que precisam continuar existindo até
o primeiro acesso.

---

## Q.3 O problema que a RLS criou no login

Este é o ponto onde a arquitetura existente e a autenticação nova entram em
conflito direto, e a solução não é obvia.

A API roda como `iarx_app`, **sujeito a RLS**, e toda política depende de
`app.tenant_id` — definido por `SET LOCAL` no início da transação, a partir dos
claims. No login **não há claims**: descobrir de que locatário é o e-mail é
justamente o que a consulta precisa fazer.

O resultado, medido antes da correção: o login devolvia **403 "fora de
escopo"**. Não era bug de código, era a RLS funcionando como projetada.

Três saídas foram consideradas:

| Saída | Por que não / por que sim |
| --- | --- |
| Conectar o login como superusuário | Uma conexão sem RLS na aplicação, disponível para qualquer erro futuro reaproveitar. Descartada. |
| Política permissiva para `anon` na tabela `usuario` | Abriria a tabela inteira, com todos os hashes, para consulta sem contexto. Descartada. |
| **Superfície fechada de funções `security definer`** | Dez funções nomeadas, cada uma com um propósito, `revoke from public` e `grant to iarx_app`. Escolhida. |

A migração 0016 é essa superfície: `auth_usuario_por_email`,
`auth_usuario_por_id`, `auth_permissoes`, `auth_escopos`, `auth_abrir_sessao`,
`auth_sessao_viva`, `auth_tocar_sessao`, `auth_criar_token_recuperacao`,
`auth_consumir_token_recuperacao`, `auth_definir_senha`, mais a redefinição de
`registrar_tentativa_login`.

A propriedade que importa: a lista é **enumerável**. Qualquer auditoria futura
pergunta "o que roda sem contexto de locatário?" e a resposta é um `grep` por
`security definer` na 0016 — não uma conexão privilegiada cujo alcance depende
de quem a usou.

---

## Q.4 Quatro defeitos que só apareceram com teste de integração

Nenhum destes quatro é erro de digitação. Todos passavam pela compilação, e
três deles deixariam a aplicação **aparentemente funcionando**.

### Q.4.1 O bloqueio por tentativas que nunca engatava

A primeira versão registrava a tentativa falha e lançava a exceção na **mesma
transação**. O `throw` disparava o rollback, e o rollback desfazia o registro
junto. O contador de falhas nunca passava de zero.

Consequência: a proteção contra força bruta existia no código, tinha teste de
unidade passando, e **não funcionava** — cada tentativa era a primeira.

A correção é uma transação própria para o registro, e é por isso que o método
`anotar()` existe:

```ts
private async anotar(...) {
  await this.banco.semContexto((db) => this.repo.registrarTentativa(db, { ... }))
}
```

O nome `semContexto` também não é cosmético: registrar a tentativa acontece
antes de haver locatário conhecido.

### Q.4.2 A troca de senha que devolvia 404

`porId` buscava o e-mail com um subselect em `usuario` — bloqueado pela RLS,
pela mesma razão do Q.3. O usuário autenticado trocava a senha e recebia
"não encontrado" sobre a própria conta. Corrigido com
`app.auth_usuario_por_id`.

### Q.4.3 `@ExigePermissao('__proprio__')`

Havia uma rota — a troca da própria senha — que não exige permissão de
catálogo: exige ser o dono. A primeira versão passou a string `'__proprio__'`
para o decorador de permissão, o que fazia o verificador de CI aceitar a rota
e a guarda comparar contra um nome que nunca estaria em nenhum perfil.

Uma sentinela mágica num campo tipado é o tipo de coisa que funciona até
alguém criar uma permissão com aquele nome. Substituída por um decorador real,
`@EscopoProprio()`, com chave própria, tratamento próprio na guarda e a
expressão do verificador de rotas ampliada para reconhecê-lo.

### Q.4.4 Dois vocabulários de permissão

`apps/web/src/lib/permissoes.ts` declarava uma união **local** de 33 nomes,
enquanto `packages/contracts` tinha 113. O Anexo I afirmava que eram o mesmo
catálogo; era falso.

Consequência direta: uma árvore de configuração construída sobre o catálogo
compartilhado gravaria `pagar:aprovar` num perfil e o botão continuaria
escondido, **sem erro em lugar nenhum** — a divergência exata que o catálogo
existe para evitar.

Ao comparar as duas listas apareceu o oposto também: `comercial:ler` e
`comercial:gerenciar` existiam **só no front**. A tela de Política Comercial
foi construída no Anexo P e nunca teve permissão no catálogo do servidor.
Unificar ingenuamente teria apagado a tela do menu e do roteador — a regressão
exata que este trabalho existe para evitar. As duas foram acrescentadas ao
catálogo antes da unificação, e o teste `recursosSemModulo()` reprova quem
esquecer de mapear um recurso novo.

O catálogo final tem **116 permissões**.

---

## Q.5 A árvore módulo → tela → ação

O pedido é explícito: árvore expansível com caixas de seleção, três níveis. A
lógica vive em `packages/contracts/src/arvore-permissoes.ts` — sem dependência
nenhuma, nem Zod — e o componente React só desenha.

A separação não é purismo. A pergunta "marcar o módulo concede o quê,
exatamente, e o que preserva fora do nó" é a parte difícil, e ela é testável
sem navegador.

### A herança do pedido, resolvida na estrutura

O pedido pede herança ("sem acesso ao módulo, sem acesso a nada dentro dele") e
exceção ("acesso ao Financeiro mas não a Fluxo de Caixa") ao mesmo tempo. As
duas convivem porque **o nó pai não é um dado, é uma função das folhas**:

- a permissão gravada é sempre a folha, `recurso:ação`;
- o estado do módulo e da tela é derivado — `marcado`, `parcial`, `vazio`;
- marcar um pai concede as folhas dele; desmarcar uma folha torna o pai
  `parcial`.

Não existe registro "tem acesso ao módulo Financeiro". Ele seria uma segunda
verdade sobre o mesmo fato, e as duas divergiriam — foi o defeito do Q.4.4.

### O terceiro estado não é enfeite

`aria-checked="mixed"` e `input.indeterminate` são o que impede a árvore de
mentir. Sem eles, um módulo com três de dez permissões concedidas seria
anunciado como "não marcado", e quem configura concluiria que o perfil não tem
acesso ali — quando tem. `indeterminate` não existe como atributo HTML, só como
propriedade de JavaScript; é por isso que há um `ref` em vez de um atributo.

### Acessibilidade

Padrão APG de `tree`: **um só ponto de tabulação**, setas navegando por dentro,
`aria-level`, `aria-expanded`, `role="group"` nos filhos. Com um `tabindex` por
caixa, ir da primeira permissão à última custaria 116 tabulações.

O foco se move dentro de `requestAnimationFrame`, porque o nó de destino só
existe no DOM depois de o pai expandir. Isso tem consequência para quem escreve
teste: ler `document.activeElement` de forma síncrona depois da tecla mede o
quadro anterior. Os testes usam `toBeFocused`, que repete até o prazo.

---

## Q.6 O defeito de integração que fechou o módulo

O critério de aceite do módulo foi escrito assim: **trocar a permissão de um
perfil muda o que a interface mostra**, verificado numa tela real.

Ao escrever esse teste apareceu o defeito que nenhum dos outros pegaria. A
sessão lia os perfis de uma lista fixa em `lib/permissoes.ts`; a tela de perfis
gravava em `BASE.perfis`. Salvar um perfil **não mudava nada** — nenhum erro,
nenhum aviso, nenhuma diferença na tela. Duas cópias do fato "o que este perfil
pode fazer", exatamente um nível acima do Q.4.4.

A sessão passou a ler da base e a assinar `assinarMudancas`, a mesma
notificação que as telas já usavam desde o Anexo K.

E o teste ganhou uma precaução que vale registrar: a pré-condição é medida
**com o perfil que vai ser alterado**, e não com o administrador. Medida com
quem tem tudo, ela nunca falharia, e o teste passaria sem que nada tivesse
acontecido.

---

## Q.7 A tela de entrada

Três comportamentos existem por razão de segurança, e os três espelham
`auth.service.ts` em vez de reinventar:

1. **Recusa uniforme.** E-mail inexistente, senha errada e conta inativa
   devolvem a mesma frase e o mesmo código. Mensagens distintas transformam o
   login num verificador de quem trabalha no locatário: basta uma lista de
   palpites e ler a diferença entre as respostas. O serviço da API também queima
   tempo equivalente quando o hash é nulo — sem isso, o relógio responde o que a
   mensagem esconde.
2. **Recuperação neutra.** "Se houver uma conta com este e-mail", sempre igual.
   A resposta é exibida na tela de login, não na de recuperação: ao lado do
   campo de e-mail ela pareceria confirmação de que aquele e-mail existe.
3. **Senha do primeiro acesso definida pelo dono.** O convite nunca carrega
   senha. Senha definida por terceiro é senha compartilhada: quem a criou
   continua sabendo, e o dono não tem como provar que não foi ele.

### Por que a tela não é porta obrigatória

A aplicação continua abrindo autenticada, e a tela é alcançada por "Sair".

Um portão na entrada faria cada um dos 134 testes de ponta a ponta atravessar
um passo de autenticação que não é o que eles testam, e faria o artefato de
demonstração pedir senha antes de mostrar qualquer coisa a quem o abriu para
ver o produto. A credencial da demonstração está impressa na tela, rotulada
como tal: é andaime visível, não credencial fabricada.

Quando a aplicação passar a falar HTTP com a API — a mudança de go-live já
registrada no Anexo I — o portão passa a ser obrigatório e esta escolha se
inverte sozinha.

---

## Q.8 Item 4.5 — a revisão de código

O checklist do pedido, com o estado real de cada linha:

| Item | Estado |
| --- | --- |
| Mapear todos os endpoints existentes | ✅ 25 rotas, no [Anexo D](D-catalogo-de-apis.md) |
| Middleware de autorização | ✅ guarda global negando por padrão (Anexo J) |
| Validação de permissão em cada endpoint | ✅ **verificada por CI** — ver abaixo |
| Componentes de renderização condicional no front | ✅ `pode()`, `<Protegida>`, gating por item de navegação |
| Filtro de filial em todas as consultas | ✅ RLS, migrações 0006 e 0011 |
| Testar perfis com permissões diferentes | ✅ testes de ponta a ponta trocando perfil |
| Documentar a matriz de permissões por endpoint | ✅ Anexo C e Anexo D |

O item que merece detalhe é o terceiro, porque "validamos em todos" é
afirmação que envelhece no primeiro endpoint novo. O que existe não é a
afirmação, é um **verificador**: `scripts/verificar-rotas.mjs` percorre os
controladores e reprova o build se algum método público não declarar
`@ExigePermissao`, `@Publico` ou `@EscopoProprio`. Hoje: 25 rotas, 25
declaradas.

A diferença prática é que o esquecimento passa a ser impossível de mesclar, em
vez de ser algo que alguém precisa notar na revisão.

### Sobre a estratégia de tabelas que o pedido sugeria

O pedido propõe uma tabela `permissions(perfil_id, módulo, tela, ação,
permitido)` e uma `user_profiles`. A implementação usa o que já existia:
`perfil.permissoes text[]` validado por gatilho contra o catálogo, e
`usuario_perfil` como associativa.

A razão é a hierarquia do Q.5. Uma tabela com colunas `módulo` e `tela` grava a
árvore como dado, e a árvore é derivável do nome da permissão — `pagar:aprovar`
já diz recurso e ação, e o mapa recurso → módulo é uma constante compartilhada
entre API e front. Gravar as três colunas criaria a possibilidade de uma linha
dizer que `pagar:aprovar` pertence ao módulo de estoque.

O `permitido boolean` tem o mesmo problema por outro caminho: a ausência de
linha e a linha com `false` passam a significar a mesma coisa, e nada impede as
duas de coexistirem para o mesmo par.

---

## Q.9 Regras de negócio novas

| # | Regra | Onde vive |
| --- | --- | --- |
| RN-L37 | Senha gravada é sempre Argon2id em formato PHC | `CHECK not valid`, migração 0015 |
| RN-L38 | Sessão é revogável, e revogação é definitiva | `app.sessao_revogacao_definitiva`, 0015 |
| RN-L39 | O locatário nunca fica sem administrador ativo | dois gatilhos, 0015 |
| RN-L40 | Política de senha é por locatário | `tenant.politica_senha jsonb`, 0015 |
| RN-L41 | Consulta anterior ao contexto só pela superfície fechada | dez funções `security definer`, 0016 |

RN-L39 merece nota. Ela vale para **desativar** e para **revogar o perfil
administrativo**, porque as duas portas levam ao mesmo lugar: um locatário sem
ninguém capaz de conceder acesso a ninguém, e sem caminho de volta pela própria
aplicação. A regra existe nos dois lados — gatilho no banco e checagem no
comando — e não é redundância: a checagem permite a interface **explicar antes
de tentar**, o gatilho torna a falha impossível para quem não passa pela
interface.

---

## Q.10 O que este módulo deixa em aberto

| # | Pendência | Consequência de adiar |
| --- | --- | --- |
| D-08 | SSO corporativo para clientes grandes | Cliente com política própria de identidade não entra sem exceção manual |
| — | MFA tem coluna e não tem fluxo, desde a migração 0002 | A coluna sugere um recurso que não existe |
| — | Expiração periódica de senha não implementada | `politica_senha` já tem onde guardar o prazo; falta o gatilho de expiração e a tela |
| — | Log de acesso registra tentativa, não ação | O pedido menciona "ações realizadas"; hoje isso é o `audit_log`, que registra por entidade e não por sessão |
| — | Notificação por e-mail não existe como subsistema | Recuperação de senha, convite e aprovação de título dependem dela; hoje só há `outbox_evento` sem worker |
| — | Foto de usuário | Campo não modelado; exige decisão de armazenamento |

As três últimas não são deste módulo, mas ele as torna visíveis: convite sem
e-mail é convite que ninguém recebe.

---

## Q.11 Verificação

| Portão | Resultado |
| --- | --- |
| `npm run tipos` | limpo nos três pacotes |
| `npm run a11y:dom` | 134 testes |
| `npm run web:test` | 74 unitários |
| `npm run a11y:tokens` | 202/202 |
| `npm run db:test` | invariantes das migrações 0015 e 0016 inclusas |
| `npm run api:test` | login, bloqueio, troca e recuperação de senha, sessão |
| `verificar-rotas.mjs` | 25/25 rotas com permissão declarada |

O critério que fechou o módulo, repetido porque é o que importa: **trocar a
permissão de um perfil muda o que a interface mostra** — verificado na
navegação real, não só no teste unitário da árvore.
