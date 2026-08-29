# Anexo C — Matriz de Permissões

## C.1 Modelo

```
Autorização = possui(permissão)  AND  registro ∈ escopo(usuário)  AND  satisfaz(alçada/política)
```

- **Permissão:** `recurso:ação` — granular, atômica, negada por padrão (`RN-026`).
- **Escopo:** `TENANT` · `EMPRESA` · `FILIAL` · `REGIAO` · `PROPRIO` (apenas registros do usuário).
- **Alçada:** limite por valor/percentual avaliado pelo motor de regras, independente da permissão.
- **Segregação de funções:** restrições estruturais que nenhuma permissão sobrepõe (`RN-027`).

Um usuário pode ter múltiplos perfis, cada um com escopo próprio (ex.: `Supervisor de Manutenção`
na filial SP e `Consulta` no tenant).

---

## C.2 Catálogo de permissões

### Contratos e clientes
| Permissão | Descrição |
| --- | --- |
| `cliente:ler` / `cliente:criar` / `cliente:editar` / `cliente:inativar` | Cadastro de clientes |
| `cliente:credito_definir` | Definir limite de crédito e situação |
| `local_operacao:gerenciar` | Criar/editar locais de operação |
| `contrato:ler` / `contrato:criar` / `contrato:editar` | Ciclo de cadastro |
| `contrato:aprovar` | Aprovar contrato em `EM_APROVAÇÃO` |
| `contrato:ativar` | Ativar contrato assinado |
| `contrato:suspender` / `contrato:retomar` | Suspensão temporária |
| `contrato:renovar` | Renovação e nova vigência |
| `contrato:encerrar` / `contrato:cancelar` / `contrato:distratar` | Terminais |
| `contrato:item_alocar` / `contrato:item_substituir` / `contrato:item_encerrar` | Gestão de itens |
| `contrato:desconto_conceder` | Conceder desconto (limitado por alçada) |
| `contrato:reajuste_aprovar` | Aprovar/aplicar reajuste |
| `contrato:anexo_gerenciar` | Anexos e documentos |

### Equipamentos
| Permissão | Descrição |
| --- | --- |
| `equipamento:ler` / `equipamento:criar` / `equipamento:editar` | Cadastro |
| `equipamento:importar` | Carga em massa |
| `equipamento:patrimonial_editar` | Valor de aquisição, vida útil, depreciação |
| `equipamento:movimentar` | Entrega, retorno, envio a terceiro |
| `equipamento:transferir` / `equipamento:transferencia_aceitar` | Entre filiais |
| `equipamento:bloquear` / `equipamento:desbloquear` | Bloqueio operacional |
| `equipamento:baixar` | Baixa de ativo |
| `equipamento:leitura_registrar` / `equipamento:leitura_estornar` | Medição |
| `equipamento:etiqueta_gerar` | QR Code / etiquetas |
| `catalogo:gerenciar` | Fabricantes, modelos, categorias |

### Manutenção
| Permissão | Descrição |
| --- | --- |
| `os:ler` / `os:criar` | Chamados e OS |
| `os:triar` / `os:atribuir` / `os:agendar` | Despacho |
| `os:executar` | Apontar tempo, peças e evidências |
| `os:concluir` | Encerrar execução |
| `os:validar` | Validação supervisória |
| `os:cancelar` / `os:reabrir` | Exceções |
| `os:custo_aprovar` | Aprovar OS acima do limite (alçada) |
| `os:sla_pausar` | Registrar pausa de SLA |
| `plano_preventivo:gerenciar` | Planos e gatilhos |
| `tecnico:gerenciar` | Cadastro e capacidade de técnicos |

### Peças e estoque
| Permissão | Descrição |
| --- | --- |
| `peca:ler` / `peca:criar` / `peca:editar` | Cadastro |
| `estoque:movimentar` | Entradas, saídas e transferências |
| `estoque:reservar` | Reserva para OS |
| `estoque:ajustar` | Ajuste de saldo (alçada + inventário) |
| `estoque:politica_definir` | Mínimo, ponto de pedido, lote |
| `inventario:executar` / `inventario:aprovar` | Contagem e aprovação |
| `fornecedor:gerenciar` | Cadastro de fornecedores |
| `ordem_compra:criar` / `ordem_compra:aprovar` / `ordem_compra:receber` | Reposição |

### Faturamento
| Permissão | Descrição |
| --- | --- |
| `medicao:ler` / `medicao:consolidar` / `medicao:estimar` | Consumo do período |
| `fatura:ler` | Consulta |
| `prefatura:gerar` / `prefatura:editar` / `prefatura:aprovar` | Fechamento |
| `fatura:emitir` | Emissão (alçada por valor) |
| `fatura:cancelar` | Cancelamento |
| `fatura:nota_correcao` | Nota de crédito/débito |
| `fatura:desconto_aplicar` | Desconto na fatura (alçada) |
| `competencia:fechar` / `competencia:reabrir` | Controle de competência |
| `faturamento:exportar` | Exportações |

### Financeiro
| Permissão | Descrição |
| --- | --- |
| `receber:ler` / `receber:baixar` / `receber:negociar` | Contas a receber |
| `pagar:ler` / `pagar:criar` / `pagar:aprovar` / `pagar:baixar` | Contas a pagar |
| `conciliacao:executar` | Conciliação bancária |
| `financeiro:lancamento_manual` | Ajuste manual (com justificativa) |
| `financeiro:centro_custo_gerenciar` | Estrutura de custo e rateio |
| `financeiro:painel_executivo` | Painel de resultado |
| `financeiro:rentabilidade_ler` | Rentabilidade por cliente/ativo |
| `financeiro:exportar` | Exportações contábeis |

### Mapa, relatórios e administração
| Permissão | Descrição |
| --- | --- |
| `mapa:ler` / `mapa:filtro_compartilhar` | Visualização geográfica |
| `relatorio:ler` / `relatorio:criar` / `relatorio:agendar` | Relatórios |
| `usuario:gerenciar` / `perfil:gerenciar` / `alcada:definir` | IAM |
| `parametro:gerenciar` | Parametrizações do tenant |
| `integracao:gerenciar` / `apikey:gerenciar` / `webhook:gerenciar` | Integrações |
| `auditoria:consultar` | Trilha de auditoria |
| `dados_sensiveis:ver_completo` | Exibir documentos/contatos sem máscara (auditado) |

---

## C.3 Perfis-base

Perfis de referência entregues no provisionamento; cada tenant pode derivar os seus.

| Perfil | Escopo típico | Finalidade |
| --- | --- | --- |
| `Administrador da Plataforma` | `TENANT` | Configuração, IAM, integrações, auditoria |
| `Diretor` | `TENANT` | Visão executiva e alçadas máximas |
| `Gestor de Filial` | `FILIAL` | Operação e resultado da filial |
| `Operador Administrativo` | `FILIAL` | Contratos, clientes, movimentações |
| `Coordenador de Logística` | `FILIAL` | Movimentações, romaneios, transferências |
| `Supervisor de Manutenção` | `FILIAL`/`REGIAO` | Triagem, agenda, validação, estoque |
| `Técnico de Manutenção` | `PROPRIO` | Execução de OS e leituras |
| `Analista Financeiro` | `EMPRESA` | Faturamento, recebíveis, pagáveis |
| `Consulta` | `FILIAL`/`TENANT` | Somente leitura |
| `Integração (conta de serviço)` | `TENANT` | Escopos mínimos declarados por integração |

---

## C.4 Matriz perfil × permissão

Legenda: **✔** concedida · **◐** concedida com alçada/condição · **○** somente leitura · **—** negada

| Permissão (agrupada) | Admin | Diretor | Gestor Filial | Oper. Admin | Logística | Superv. Mnt | Técnico | Financeiro | Consulta |
| --- | :--: | :--: | :--: | :--: | :--: | :--: | :--: | :--: | :--: |
| `cliente:ler` | ✔ | ✔ | ✔ | ✔ | ○ | ○ | — | ✔ | ○ |
| `cliente:criar/editar` | ✔ | — | ✔ | ✔ | — | — | — | ◐ | — |
| `cliente:credito_definir` | ✔ | ✔ | ◐ | — | — | — | — | ✔ | — |
| `contrato:ler` | ✔ | ✔ | ✔ | ✔ | ○ | ○ | ○¹ | ✔ | ○ |
| `contrato:criar/editar` | ✔ | — | ✔ | ✔ | — | — | — | — | — |
| `contrato:aprovar` | ✔ | ✔ | ◐ | — | — | — | — | — | — |
| `contrato:ativar` | ✔ | — | ✔ | ✔ | — | — | — | — | — |
| `contrato:suspender/retomar` | ✔ | ✔ | ✔ | ◐ | — | — | — | — | — |
| `contrato:renovar` | ✔ | ✔ | ✔ | ✔ | — | — | — | — | — |
| `contrato:cancelar/distratar` | ✔ | ✔ | ◐ | — | — | — | — | — | — |
| `contrato:item_alocar/substituir` | ✔ | — | ✔ | ✔ | ✔ | — | — | — | — |
| `contrato:desconto_conceder` | ✔ | ✔ | ◐ | ◐ | — | — | — | ◐ | — |
| `contrato:reajuste_aprovar` | ✔ | ✔ | ◐ | — | — | — | — | ◐ | — |
| `equipamento:ler` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ○ | ○ |
| `equipamento:criar/editar` | ✔ | — | ✔ | ✔ | ◐ | ◐ | — | — | — |
| `equipamento:patrimonial_editar` | ✔ | ✔ | ◐ | — | — | — | — | ✔ | — |
| `equipamento:movimentar` | ✔ | — | ✔ | ✔ | ✔ | ✔ | ◐² | — | — |
| `equipamento:transferir/aceitar` | ✔ | — | ✔ | ◐ | ✔ | — | — | — | — |
| `equipamento:bloquear` | ✔ | ✔ | ✔ | — | — | ✔ | ◐³ | — | — |
| `equipamento:desbloquear` | ✔ | ✔ | ◐ | — | — | ◐ | — | — | — |
| `equipamento:baixar` | ✔ | ✔ | — | — | — | — | — | — | — |
| `equipamento:leitura_registrar` | ✔ | — | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| `equipamento:leitura_estornar` | ✔ | — | ◐ | ◐ | — | ◐ | — | ◐ | — |
| `catalogo:gerenciar` | ✔ | — | ◐ | ◐ | — | ✔ | — | — | — |
| `os:ler` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ○ | ○ |
| `os:criar` | ✔ | — | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| `os:triar/atribuir/agendar` | ✔ | — | ◐ | — | — | ✔ | — | — | — |
| `os:executar` | ✔ | — | — | — | — | ✔ | ✔ | — | — |
| `os:concluir` | ✔ | — | — | — | — | ✔ | ✔ | — | — |
| `os:validar` | ✔ | — | ◐ | — | — | ✔⁴ | — | — | — |
| `os:cancelar/reabrir` | ✔ | — | ◐ | — | — | ✔ | — | — | — |
| `os:custo_aprovar` | ✔ | ✔ | ◐ | — | — | ◐ | — | — | — |
| `plano_preventivo:gerenciar` | ✔ | — | ◐ | — | — | ✔ | — | — | — |
| `peca:ler` | ✔ | ○ | ✔ | ○ | ✔ | ✔ | ✔ | ○ | ○ |
| `peca:criar/editar` | ✔ | — | ◐ | — | — | ✔ | — | — | — |
| `estoque:movimentar` | ✔ | — | ◐ | — | ✔ | ✔ | ◐⁵ | — | — |
| `estoque:ajustar` | ✔ | ✔ | ◐ | — | — | ◐ | — | — | — |
| `inventario:executar` | ✔ | — | ✔ | — | ✔ | ✔ | ✔ | — | — |
| `inventario:aprovar` | ✔ | ✔ | ✔ | — | — | ◐⁶ | — | — | — |
| `ordem_compra:criar` | ✔ | — | ✔ | — | — | ✔ | — | ✔ | — |
| `ordem_compra:aprovar` | ✔ | ✔ | ◐ | — | — | — | — | ◐ | — |
| `medicao:consolidar` | ✔ | — | ✔ | ✔ | — | — | — | ✔ | — |
| `medicao:estimar` | ✔ | ✔ | ◐ | — | — | — | — | ◐ | — |
| `prefatura:gerar/editar/aprovar` | ✔ | ○ | ◐ | ◐ | — | — | — | ✔ | ○ |
| `fatura:emitir` | ✔ | ✔ | — | — | — | — | — | ◐ | — |
| `fatura:cancelar` | ✔ | ✔ | — | — | — | — | — | ◐ | — |
| `fatura:desconto_aplicar` | ✔ | ✔ | ◐ | — | — | — | — | ◐ | — |
| `competencia:fechar` | ✔ | ✔ | — | — | — | — | — | ✔ | — |
| `competencia:reabrir` | ✔ | ✔ | — | — | — | — | — | ◐ | — |
| `receber:baixar/negociar` | ✔ | ✔ | — | — | — | — | — | ✔ | — |
| `pagar:criar/baixar` | ✔ | — | — | — | — | — | — | ✔ | — |
| `pagar:aprovar` | ✔ | ✔ | ◐ | — | — | — | — | ◐⁷ | — |
| `conciliacao:executar` | ✔ | — | — | — | — | — | — | ✔ | — |
| `financeiro:lancamento_manual` | ✔ | ✔ | — | — | — | — | — | ◐ | — |
| `financeiro:painel_executivo` | ✔ | ✔ | ◐⁸ | — | — | — | — | ✔ | ○ |
| `financeiro:rentabilidade_ler` | ✔ | ✔ | ◐⁸ | — | — | — | — | ✔ | — |
| `financeiro:exportar` | ✔ | ✔ | — | — | — | — | — | ✔ | — |
| `mapa:ler` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ○¹ | — | ○ |
| `relatorio:ler` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ○ | ✔ | ○ |
| `usuario:gerenciar` / `perfil:gerenciar` | ✔ | ○ | — | — | — | — | — | — | — |
| `alcada:definir` | ✔ | ✔ | — | — | — | — | — | — | — |
| `parametro:gerenciar` | ✔ | — | — | — | — | — | — | — | — |
| `integracao:gerenciar` / `apikey:gerenciar` | ✔ | — | — | — | — | — | — | — | — |
| `auditoria:consultar` | ✔ | ✔ | ◐⁸ | — | — | — | — | ◐ | — |
| `dados_sensiveis:ver_completo` | ✔ | ✔ | ◐ | ◐ | — | — | — | ✔ | — |

**Notas de condição:**
1. Técnico vê apenas contratos/mapa dos ativos das OS atribuídas a ele.
2. Técnico movimenta apenas entrada/saída de manutenção dos ativos das próprias OS.
3. Técnico pode sinalizar bloqueio por condição insegura; a efetivação requer supervisor.
4. Supervisor não pode validar OS que ele mesmo executou (`RN-027`).
5. Técnico movimenta apenas o depósito do próprio veículo e baixas nas próprias OS.
6. Supervisor não aprova inventário que ele mesmo contou (`RN-027`).
7. Analista financeiro não aprova pagamento de fornecedor que ele mesmo cadastrou (`RN-027`).
8. Restrito ao escopo da filial/região do usuário.

---

## C.4.1 Como a matriz vira código

A matriz acima usa quatro estados; `perfil.permissoes` é um array de folhas
`recurso:ação`. A tradução de um para o outro precisa de duas convenções, e elas
são estas:

| Símbolo | Vira | Por quê |
| :-: | --- | --- |
| **✔** | permissão concedida | direto |
| **◐** | **permissão concedida** | O ◐ marca "com alçada ou condição", e a fórmula de C.1 é `permissão AND escopo AND alçada`: o ◐ **é o terceiro termo**, avaliado em tempo de execução contra `alcada` e contra a RLS. Negar a permissão deixaria a alçada sem nada sobre que agir — o perfil nem entraria na fila para ser barrado pelo limite |
| **○** | as permissões **de leitura** da linha, e só elas | é o que a legenda diz, sem as ações de escrita da mesma linha |
| **—** | ausente | direto |

O ○ precisa de uma definição que não dependa de leitura humana, porque as
linhas da matriz agrupam ações e nem toda linha tem uma leitura. São **leituras**
as ações `ler`, `painel_executivo` e `rentabilidade_ler` — e a regra decorre
delas nos três formatos de linha:

| Formato da linha | Exemplo | ○ concede |
| --- | --- | --- |
| tem leitura e escrita | `peca:ler` (a linha é só a leitura) | a leitura |
| só leituras | `financeiro:painel_executivo` | a própria permissão — não há forma menor |
| nenhuma leitura | `prefatura:gerar/editar/aprovar`, `usuario:gerenciar / perfil:gerenciar` | **nada dessa linha**; a leitura da área vem da linha dela em C.4.2 (`fatura:ler`), e onde não existe linha nenhuma — `usuario:ler` não está no catálogo — não há o que conceder |

E uma convenção que a matriz aplica sem dizer: o **Administrador da Plataforma é
✔ em todas as linhas**, inclusive nas de C.4.2 que não o citam. É o perfil de
configuração do locatário; enumerá-lo em cada linha só acrescentaria ruído.

Consequência prática: **o array não guarda a condição.** Uma linha ◐⁸
("restrito ao escopo da filial") vira permissão concedida, e o recorte acontece
na RLS por `usuario_perfil.escopo_tipo`. Uma linha ◐⁷ ("não aprova pagamento de
fornecedor que ele mesmo cadastrou") vira permissão concedida, e a segregação
acontece no gatilho da migração 0019. Quem ler o array sozinho vê menos restrição
do que existe — as três camadas é que compõem a autorização, e o array é uma.

---

## C.4.2 As permissões que a matriz não cobre

A matriz de C.4 foi escrita antes dos Módulos 8 a 13, e nunca alcançou alguns
blocos que já existiam. Das **125** permissões do catálogo, **82** têm linha lá.
As outras **43** estão nesta seção.

A contagem é medida, não estimada — a versão anterior desta seção dizia "trinta e
quatro" e listava trinta e três, deixando dez permissões (o bloco inteiro de nota
fiscal, as duas de política comercial, `fornecedor:gerenciar`, `fatura:ler` e
`medicao:ler`) sem atribuição em lugar nenhum. Quem fosse montar um perfil a
partir do Anexo C não teria onde procurá-las.

**Cada linha está marcada com a sua origem**, e a distinção importa:
*especificada* significa que o Anexo C ou o anexo de origem diz literalmente a
quem pertence; *inferida* significa que foi derivada do grupo vizinho ou do
critério funcional declarado, e é revisável sem quebrar contrato.

A coluna **Perfis** usa os nomes de C.3, sem abreviação e sem prosa: ela é lida
por um teste que compara esta tabela com os perfis-semente do código
(`apps/web/test/matriz-permissoes.test.ts`). O raciocínio fica na coluna Origem.
Como em C.4, o Administrador da Plataforma é implícito em todas as linhas.

| Permissão | Perfis | Origem |
| --- | --- | --- |
| `pagar:ler` | Diretor, Gestor de Filial, Analista Financeiro, Consulta | **inferida** — não se opera o que não se lê, e C.4 dá `pagar:aprovar` ◐ ao Gestor de Filial: sem esta linha ele aprovaria um título que a tela não lhe mostra. A Consulta entra porque ler é a sua definição inteira em C.3, e ela já vê o painel executivo que resume estes mesmos títulos |
| `receber:ler` | Diretor, Analista Financeiro, Consulta | **inferida** — mesma razão; sem o Gestor de Filial, que não tem ação nenhuma de `receber` em C.4 |
| `receber:criar` · `receber:cancelar` | Analista Financeiro | **inferida** — mesmo grupo de `receber:baixar/negociar` |
| `receber:aprovar` | Diretor, Analista Financeiro | **inferida** — simétrica a `pagar:aprovar`. A segregação (quem gera não aprova) é gatilho da 0020, não ausência de permissão |
| `pagar:cancelar` | Diretor, Analista Financeiro | **inferida** — mesmo grupo de `pagar:criar/baixar` |
| `pagar:delegar_aprovacao` | Diretor | **especificada** por [Anexo S](S-contas-a-pagar.md) §S.4: quem aprova não precisa poder transferir a própria autoridade — logo a delegação fica acima de quem aprova |
| `centro_custo:ler` | Diretor, Gestor de Filial, Operador Administrativo, Analista Financeiro | **especificada** por [Anexo R](R-base-do-financeiro.md) §R.8: "quem lança um título precisa ler para escolher um centro" |
| `centro_custo:gerenciar` | Analista Financeiro | **inferida** — R §R.8 trata a árvore como cadastro financeiro |
| `conta_bancaria:ler` | Diretor, Analista Financeiro | **especificada** — R §R.8: "é o que a baixa de um título precisa" |
| `conta_bancaria:gerenciar` | Analista Financeiro | **especificada** — R §R.8: "bloquear uma conta é ação de gestão, não de operação" |
| `conta_bancaria:movimentar` | Analista Financeiro | **especificada** — R §R.8: "o dia a dia" |
| `conta_bancaria:transferir` | Diretor, Analista Financeiro | **especificada** — R §R.8: "a única ação que move saldo sem um título por trás… a que mais interessa segregar de quem lança despesa" |
| `nota_fiscal:ler` | Diretor, Operador Administrativo, Supervisor de Manutenção, Analista Financeiro | **especificada** por [Anexo N](N-nota-fiscal-de-compra.md) §N.7: a tabela de distribuição dá papel aos quatro, e à diretoria dá "só leitura" |
| `nota_fiscal:criar` · `nota_fiscal:cancelar` | Operador Administrativo | **especificada** — N §N.7: "lança e cancela — é quem recebe o XML do fornecedor" |
| `nota_fiscal:editar` | Operador Administrativo | **especificada** — N §N.7: quem lança é quem corrige antes da conferência |
| `nota_fiscal:conferir` | Supervisor de Manutenção | **especificada** — N §N.7: "confere — é quem abre as caixas e lê as etiquetas". O anexo o chama pelo nome antigo, *Supervisor de suporte técnico* |
| `nota_fiscal:integrar` | Analista Financeiro | **especificada** — N §N.7: "integra — é o lançamento contábil do imobilizado". As três ações em três perfis são a segregação de RN-027, não zelo |
| `fornecedor:ler` | Diretor, Operador Administrativo, Supervisor de Manutenção, Analista Financeiro | **inferida** — acompanha `nota_fiscal:ler` e `ordem_compra:criar` |
| `fornecedor:gerenciar` | Operador Administrativo, Analista Financeiro | **inferida** — a nota ⁷ de C.4 ("não aprova pagamento de fornecedor que ele mesmo cadastrou") só tem sentido se o Analista Financeiro cadastra fornecedor; a regra pressupõe a permissão |
| `cliente:inativar` | Gestor de Filial | **inferida** — vizinha de `cliente:criar/editar`, com o mesmo peso de `contrato:cancelar` |
| `local_operacao:gerenciar` | Gestor de Filial, Operador Administrativo | **inferida** — o local é cadastro de cliente, e os dois têm `cliente:criar/editar` |
| `contrato:encerrar` | Diretor, Gestor de Filial | **inferida** — vizinha de `contrato:cancelar/distratar` |
| `contrato:item_encerrar` | Gestor de Filial, Operador Administrativo, Coordenador de Logística | **inferida** — vizinha de `contrato:item_alocar/substituir` |
| `contrato:anexo_gerenciar` | Gestor de Filial, Operador Administrativo | **inferida** — acompanha `contrato:criar/editar` |
| `equipamento:importar` · `equipamento:etiqueta_gerar` | Gestor de Filial, Operador Administrativo | **inferida** — vizinhas de `equipamento:criar/editar` |
| `os:sla_pausar` | Supervisor de Manutenção, Técnico de Manutenção | **especificada** por `RN-011`: a pausa é registrada por quem executa, com motivo tipificado |
| `tecnico:gerenciar` | Supervisor de Manutenção | **inferida** — C.3 dá ao supervisor "triagem, agenda, validação, estoque"; a capacidade da equipe é a mesma agenda |
| `estoque:reservar` | Supervisor de Manutenção, Técnico de Manutenção | **especificada** por §B.5: a reserva nasce da OS |
| `estoque:politica_definir` | Gestor de Filial, Supervisor de Manutenção | **inferida** — vizinha de `estoque:ajustar` |
| `ordem_compra:receber` | Coordenador de Logística, Supervisor de Manutenção | **inferida** — recebimento é ato físico, como `inventario:executar` |
| `medicao:ler` | Diretor, Gestor de Filial, Operador Administrativo, Analista Financeiro | **inferida** — não se consolida nem se estima o que não se lê; são os perfis das duas linhas de `medicao` em C.4 |
| `fatura:ler` | Diretor, Gestor de Filial, Operador Administrativo, Analista Financeiro, Consulta | **inferida** — é a leitura que o ○ do Diretor e da Consulta na linha `prefatura:gerar/editar/aprovar` designa: aquela linha não tem leitura própria, e sem esta o ○ não concederia nada |
| `fatura:nota_correcao` | Diretor, Analista Financeiro | **inferida** — vizinha de `fatura:cancelar` |
| `faturamento:exportar` | Diretor, Analista Financeiro | **inferida** — vizinha de `financeiro:exportar` |
| `comercial:ler` | Diretor, Gestor de Filial, Operador Administrativo, Analista Financeiro, Consulta | **inferida** — [Anexo P](P-nucleo-comercial-e-consumo.md) trata tabela de franquia e de preço como política comercial: quem lê um contrato precisa ler a política que o precifica |
| `comercial:gerenciar` | Analista Financeiro | **inferida** — a tabela de preço é cadastro financeiro, como a árvore de centro de custo |
| `mapa:filtro_compartilhar` | Diretor, Gestor de Filial, Operador Administrativo, Coordenador de Logística, Supervisor de Manutenção, Técnico de Manutenção | **inferida** — compartilhar recorte não expõe dado além do que o recorte já mostra, logo acompanha `mapa:ler`. Fora a Consulta, que é somente leitura, e o Analista Financeiro, que não tem o mapa |
| `relatorio:criar` · `relatorio:agendar` | Diretor, Gestor de Filial, Analista Financeiro | **inferida** — vizinhas de `relatorio:ler`, sem os perfis que só consultam |
| `webhook:gerenciar` | Administrador da Plataforma | **inferida** — acompanha `integracao:gerenciar` e `apikey:gerenciar`, que C.4 dá só ao Administrador |

> **Correção a C.7.** A seção de contas de serviço cita
> `fatura:nota_fiscal_atualizar` e `equipamento:posicao_atualizar`. **As duas não
> existem no catálogo.** Enquanto uma integração precisar delas, elas têm de ser
> criadas em `catalogo-permissoes.ts` — uma conta de serviço com escopo declarado
> que aponta para permissão inexistente é um escopo que nunca foi validado.

---

## C.5 Alçadas por valor (padrão sugerido)

| Tipo de alçada | Operador | Gestor de Filial | Analista Financeiro | Supervisor Mnt | Diretor |
| --- | --- | --- | --- | --- | --- |
| Desconto em contrato/fatura | até 5% | até 15% | até 10% | — | sem limite |
| Emissão de fatura | — | — | até R$ 50 mil | — | sem limite |
| Cancelamento de fatura | — | — | até R$ 10 mil | — | sem limite |
| Reabertura de competência | — | — | ◐ com registro | — | ✔ |
| Custo de OS | — | até R$ 10 mil | — | até R$ 5 mil | sem limite |
| Ajuste de inventário | — | até R$ 5 mil | — | até R$ 2 mil | sem limite |
| Liberação de bloqueio de preventiva | — | ◐ prazo ≤ 15 dias | — | ◐ prazo ≤ 7 dias | ✔ |
| Liberação de cliente bloqueado | — | ◐ ≤ 30 dias atraso | ◐ ≤ 30 dias atraso | — | ✔ |
| Aprovação de contas a pagar | — | até R$ 20 mil | até R$ 20 mil | — | sem limite |

Valores são parametrizáveis por tenant. Toda operação dentro de alçada exige justificativa e gera
registro de auditoria (`RN-018`).

---

## C.6 Segregação de funções — restrições estruturais

| Restrição | Regra |
| --- | --- |
| Desconto | Quem concede acima da própria alçada não pode aprovar o próprio pedido |
| Inventário | Contador ≠ aprovador do ajuste |
| Ordem de serviço | Executor ≠ validador |
| Fornecedor e pagamento | Quem cadastra o fornecedor não aprova seu pagamento |
| Fatura | Quem gera a pré-fatura pode emitir; quem cancela exige alçada distinta em valores relevantes |
| Competência | Quem fecha pode reabrir apenas com alçada própria e motivo registrado |
| Permissões | Administrador não pode conceder a si próprio alçada financeira sem aprovação de diretoria |
| Auditoria | Nenhum perfil altera ou exclui registros de auditoria |

Exceções são parametrizáveis por tenant; a ativação de qualquer exceção é registrada em auditoria e
exibida no painel de conformidade.

---

## C.7 Contas de serviço e acesso externo

| Tipo | Escopo padrão | Controles |
| --- | --- | --- |
| Integração ERP | `financeiro:exportar`, `fatura:ler`, `receber:ler`, `pagar:ler` | Chave rotativa, IP allowlist opcional, *rate limit* |
| Integração fiscal | `fatura:ler`, `fatura:nota_fiscal_atualizar` | Somente callbacks assinados |
| Telemetria | `equipamento:leitura_registrar`, `equipamento:posicao_atualizar` | Volume alto: fila dedicada, sem acesso a dados comerciais |
| Portal do cliente | `contrato:ler`, `fatura:ler`, `os:criar`, `os:ler` — restrito ao próprio cliente | Escopo `PROPRIO` por `cliente_id` |
| Dispositivo de campo | `os:executar`, `os:concluir`, `equipamento:leitura_registrar`, `equipamento:movimentar` | Token revogável por dispositivo, expiração curta |
| Suporte técnico | Sessão temporária com motivo | Prazo curto, auditoria integral, notificação ao administrador do tenant |
