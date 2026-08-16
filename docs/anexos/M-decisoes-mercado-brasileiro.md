# Anexo M — Decisões assumidas: regras do mercado brasileiro

O Anexo L levantou treze decisões pendentes. Este anexo **as resolve**, com a
fundamentação legal e de prática de mercado, para que o desenvolvimento avance
sem esperar. Cada decisão traz o que foi decidido, por quê, e o que precisaria
mudar se a premissa estiver errada.

Onde uma decisão depende de um fato da operação que só o cliente conhece,
adotei o **padrão de mercado** e deixei o campo configurável — de modo que
mudar não exija migração.

---

## M.1 Estrutura societária e fiscal do cliente

### D-02 · Modelo organizacional — **RESOLVIDA**

**Decisão:** dois eixos separados, porque no Brasil eles de fato são separados.

```
grupo_economico          ← controle comum (CLT art. 2º §2º)
      │ 1:N
   cliente               ← pessoa jurídica, CNPJ de 14 dígitos
      │ 1:N
 local_operacao          ← onde a máquina está (andar, prédio, unidade)
```

**Fundamentação.** No Brasil, "filial" tem significado fiscal preciso: é
estabelecimento com **CNPJ próprio**, compartilhando a raiz de 8 dígitos da
matriz e diferindo na ordem (matriz `0001`, filiais `0002` em diante). Nota
fiscal, boleto e obrigação acessória são emitidos contra o CNPJ do
estabelecimento, não contra o grupo.

Consequências que decidem o modelo:

1. **Filial do cliente é um `cliente`,** não uma sublinha dele. Ela tem CNPJ,
   inscrição estadual e endereço fiscal próprios, e recebe nota fiscal em nome
   dela. Modelar filial como atributo de cliente quebraria a emissão.
2. **Grupo econômico é agrupamento de CNPJs,** que podem ter raízes diferentes
   (holding com várias empresas). Não é derivável da raiz sozinha — precisa ser
   declarado. Relevante porque a responsabilidade é **solidária** (Lei 8.212/91,
   art. 30, IX), o que justifica a visão consolidada de crédito.
3. **Local de operação não tem CNPJ.** É o andar, o galpão, a loja. Um mesmo
   CNPJ pode ter dez locais, e é neles que o equipamento fica. É a unidade certa
   para "Gestor de Filial" no sentido operacional.

**Campo derivado que vale ter:** `cliente.cnpj_raiz` (8 primeiros dígitos),
gerado. Permite sugerir o vínculo de grupo automaticamente ao cadastrar um CNPJ
cuja raiz já existe — sem impor, porque raiz igual não prova grupo e raiz
diferente não o exclui.

**Se a premissa estiver errada:** se o cliente tratar "filial" como unidade sem
CNPJ próprio (comum em franquias com CNPJ único), basta não criar os clientes
filhos e usar `local_operacao`. O modelo comporta os dois.

### D-01 · Isolamento do cliente locatário — **RESOLVIDA**

**Decisão:** eixo adicional na RLS. Um banco, uma API, `SET LOCAL
app.cliente_id` por transação, exatamente como já se faz com o tenant.

**Fundamentação.** A LGPD (Lei 13.709/18, art. 46) exige medidas técnicas aptas
a proteger dados pessoais de acesso não autorizado. Contatos de cliente, nomes
de responsáveis por filial e histórico de chamados são dados pessoais. Filtro
na camada de aplicação é medida que **depende de nenhum desenvolvedor esquecer
uma cláusula** — o que não é medida técnica, é esperança. RLS nega por omissão.

Rejeitadas:
- **Um tenant por cliente locatário** — multiplicaria migração, backup e
  monitoramento por N clientes, e quebraria o relatório consolidado do locador.
- **Só filtro na aplicação** — a falha é silenciosa e o dano é vazamento entre
  concorrentes, que no setor de outsourcing frequentemente são clientes do mesmo
  fornecedor.

**Regra estrutural:** o token do usuário de cliente carrega `cliente_id`; a
transação faz `set_config('app.cliente_id', …, true)`; toda tabela visível ao
cliente ganha política adicional. Guarda de CI reprova política de cliente que
não filtre pelos dois eixos.

---

## M.2 Nota fiscal de compra

### D-03 · Origem do XML — **RESOLVIDA**

**Decisão:** upload manual do XML da NF-e (layout 4.00), com validação da chave
de acesso. Consulta automática à SEFAZ fica para fase 2.

**Fundamentação.** O `distribuiçãoDFe` da SEFAZ exige certificado digital A1 ou
A3 do destinatário, com renovação anual e custódia de chave privada. É
infraestrutura de segurança que não se resolve numa sprint. O XML, por outro
lado, é obrigatoriamente enviado ao destinatário pelo emitente (Ajuste SINIEF
07/05), então já chega por e-mail em toda compra.

**Validação da chave de acesso.** 44 dígitos, com estrutura definida:

```
cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
```

O dígito verificador é módulo 11 com pesos 2–9 cíclicos da direita para a
esquerda. Validá-lo pega chave digitada errada antes de a nota entrar. Além
disso, os campos embutidos precisam **conferir com o cabeçalho**: CNPJ do
emitente, série e número. Divergência significa XML de outra nota.

### Impostos e custo de aquisição — **RESOLVIDA**

**Decisão:** o custo de aquisição do ativo imobilizado é

```
valor_aquisicao = valor_produtos
                + valor_frete
                + valor_seguro
                + valor_st                    (ICMS-ST é sempre custo)
                + valor_ipi_nao_recuperavel
                + valor_icms_nao_recuperavel
                − valor_desconto
```

**Fundamentação.** CPC 27 (Ativo Imobilizado), item 16: o custo compreende o
preço de aquisição, **acrescido de tributos não recuperáveis**, e os custos
diretamente atribuíveis para colocar o ativo em condição de uso — o que inclui
frete e seguro. Lei 6.404/76, art. 183, I, na mesma direção.

O que é recuperável depende do regime do locador:

| Tributo | Regra prática |
| --- | --- |
| ICMS | Recuperável em parcelas (CIAP, 48 meses) para contribuinte do imposto no regime normal. **Locação de bem móvel não é fato gerador de ICMS** (Súmula 573 do STF), então a locadora pura normalmente **não** se credita — o ICMS vira custo |
| IPI | Recuperável só para industrial ou equiparado. Locadora normalmente não é |
| ICMS-ST | Nunca recuperável na aquisição para imobilizado |
| PIS/COFINS | No regime não cumulativo há crédito sobre depreciação, não sobre a aquisição |

**Implicação de produto:** os campos `icms_recuperavel` e `ipi_recuperavel` são
**parâmetros do tenant**, com padrão `false` (perfil de locadora pura). Marcar
como recuperável muda o custo de aquisição e, portanto, a depreciação e a
margem por ativo. Por isso a decisão fica registrada por nota, não só por
parâmetro global: mudança de regime não pode reprecificar o passado.

### Retenção do documento fiscal — **RESOLVIDA**

**Decisão:** anexos classificados como documento fiscal têm retenção mínima de
**5 anos** e não podem ser removidos nesse período.

**Fundamentação.** Art. 173 do CTN: o prazo decadencial para o Fisco constituir
crédito tributário é de 5 anos. O XML da NF-e é o documento original — o PDF é
apenas representação (DANFE). Perder o XML é perder o documento.

**Efeito no módulo de anexos (Anexo K.5b):** a remoção com motivo continua
existindo, mas passa a ser **recusada** para categoria fiscal dentro do prazo,
com a data em que se torna possível.

### D-04 · ERP financeiro — **ASSUMIDA**

**Decisão:** a plataforma é a origem do registro de compra. Se houver ERP, a
integração é por evento de saída (`outbox_evento`, migração 0007), não por
consumo — evita que o cadastro de ativos dependa de um sistema externo estar
disponível.

---

## M.3 Franquia e contagem de páginas

### Página A3 conta como 2 × A4 — **RESOLVIDA**

**Decisão:** sim, com fator configurável por tabela de franquia. Padrão `2`.

**Fundamentação.** É a prática consolidada no outsourcing de impressão
brasileiro, e decorre do próprio equipamento: multifuncionais A3 contam uma
página A3 como dois "cliques" no contador quando configurados para tal, e as
tabelas comerciais do setor precificam A3 como duas páginas A4. Deixar
configurável porque alguns contratos negociam A3 com preço próprio.

### Duplex — **RESOLVIDA**

**Decisão:** frente e verso contam **2 páginas**. Nenhuma conversão é aplicada.

**Fundamentação.** O contador do equipamento conta **faces impressas**, não
folhas. Uma impressão duplex de uma folha incrementa o contador em 2. Aplicar
qualquer fator sobre isso duplicaria a contagem. A regra existe para ser
documentada, não implementada — e é justamente por não estar documentada que
esse erro aparece.

### D-05 · Franquia acumulativa — **RESOLVIDA**

**Decisão:** modelada, desligada por padrão (`permite_acumulo = false`).

**Fundamentação.** O padrão do mercado brasileiro é franquia mensal que
**expira**: páginas não usadas não passam para o mês seguinte. Franquia
acumulativa ("banco de páginas") aparece em contratos de grande volume como
concessão comercial. Como muda o motor de faturamento — a apuração deixa de ser
por competência isolada —, fica disponível mas inativa até haver contrato que
a exija.

### Franquia sobre digitalização — **RESOLVIDA**

**Decisão:** não é cobrada. Contadores de scan são registrados para gestão, sem
efeito financeiro.

**Fundamentação.** Cobrar digitalização é minoria no mercado brasileiro e
costuma ser rejeitado em negociação. Registrar o contador sem faturá-lo permite
mudar de ideia sem perder histórico.

### Dia de corte da leitura — **RESOLVIDA**

**Decisão:** corte no **último dia do mês**, com janela de coleta até o 5º dia
útil do mês seguinte. A leitura coletada dentro da janela é atribuída à
competência anterior.

**Fundamentação.** A competência contábil é o mês civil, e a nota fiscal de
serviço é emitida no mês seguinte ao da prestação. Coletar exatamente no dia 31
é operacionalmente impossível com parque distribuído; sem a janela, ou se
inventa leitura, ou o fechamento atrasa. O 5º dia útil é o prazo usual antes do
vencimento do ISS na maioria dos municípios.

O campo `dia_corte` fica configurável por contrato para o caso de faturamento
em ciclo próprio (comum em contratos com órgão público, que fecham no dia 20).

---

## M.4 Preço, reajuste e comercial

### Índice de reajuste — **RESOLVIDA**

**Decisão:** IPCA como padrão, IGP-M disponível, reajuste **anual** contado da
data-base do contrato, aplicado por nova versão da tabela de preços.

**Fundamentação.** A Lei 10.192/2001, art. 2º §1º, proíbe reajuste com
periodicidade inferior a um ano em contrato com cláusula de correção monetária.
O IGP-M perdeu espaço em contratos de serviço após a volatilidade de 2020–2021;
o IPCA virou o índice de referência para locação corporativa. Deixar os dois
porque contratos antigos usam IGP-M e não se muda índice sem aditivo.

### D-06 · Preço por filial do cliente — **RESOLVIDA**

**Decisão:** sim, e é natural no modelo de D-02 — a "filial" é um `cliente`, e a
tabela de preço já tem abrangência por cliente. Nenhuma estrutura adicional.

### Comissão de vendas — **ADIADA**

**Decisão:** fora de escopo. Comissão sobre contrato de locação envolve regra de
provisão e estorno em caso de distrato que merece módulo próprio.

---

## M.5 Acesso e autenticação

### D-07 · Autenticação — **REVERTIDA para implementação própria**

**Decisão atual:** autenticação própria, senha com **Argon2id**.

**Decisão anterior (mantida como registro):** Supabase Auth, por ser coerente
com o Anexo H e entregar recuperação, MFA, rotação de refresh token e bloqueio
por tentativa sem implementação própria — argumento que continua tecnicamente
correto e que a reversão aceita como custo.

**O que a reversão custa, declarado:**

| Item | Com Supabase Auth | Com implementação própria |
| --- | --- | --- |
| Hash de senha | Pronto | Argon2id, parâmetros a fixar e revisar |
| Recuperação por e-mail | Pronto | `token_recuperacao` (já existe na 0011) + provedor de envio (D-19) |
| MFA | Pronto, desligado | A construir; `usuario.mfa_habilitado` continua coluna sem fluxo |
| Rotação de refresh token | Pronto | A construir |
| Revogação de sessão | Pronto | Tabela de sessão própria (migração 0015) |
| Bloqueio por tentativa | Pronto | `tentativas_falhas`/`bloqueado_ate` já existem na 0011; falta a regra |
| Auditoria de acesso | Parcial | `log_acesso` já existe na 0011, mais completo |

**O que a reversão ganha:** independência de fornecedor no ponto que mais
amarra uma plataforma — o cadastro de identidade. Sair do Supabase deixa de
exigir migração de usuários e redefinição de senha em massa. E a emissão do
token passa a ser nossa, o que remove o hook de access token customizado
(H.4) do caminho crítico: as claims de `tenant_id`, `cliente_id` e permissões
são montadas pelo mesmo código que já as consome nos testes.

**O que não muda:** `usuario.subject_oidc` permanece e continua único global.
Autenticação própria e OIDC não são exclusivas — D-08 (SSO corporativo) segue
possível sem migração, e um cliente grande pode entrar por OIDC enquanto os
demais usam senha.

**Restrições que a decisão impõe, não negociáveis:**

1. Argon2id, nunca bcrypt/PBKDF2/SHA — e nunca hash caseiro.
2. Parâmetros mínimos: 19 MiB de memória, 2 iterações, paralelismo 1
   (perfil recomendado pela RFC 9106 para uso interativo). Registrados no
   banco junto do hash, para que um aumento futuro de custo não invalide os
   hashes existentes.
3. A senha nunca aparece em log, erro, trilha de auditoria ou resposta de API
   — nem em `problem+json` de validação.
4. Resposta de recuperação é idêntica para e-mail existente e inexistente
   (RN-L28, já documentada no Anexo L).

### D-08 · SSO corporativo — **ADIADA, com preparo**

**Decisão:** não agora. O modelo já suporta: `usuario.subject_oidc` é único
global e a autenticação é por provedor externo. Habilitar SAML depois não exige
migração.

### D-09 · Portal em subdomínio ou rota — **RESOLVIDA**

**Decisão:** mesma origem, prefixo `/portal`.

**Fundamentação.** O isolamento real é a RLS, não a origem. Subdomínio separado
traria cookie e CSP próprios ao custo de segunda configuração de DNS,
certificado e deploy — proteção marginal sobre um controle que já existe no
dado. O prefixo torna trivial auditar que nenhuma rota de cliente alcança dado
do locador.

### D-10 · Cliente abre chamado pelo portal — **RESOLVIDA**

**Decisão:** sim. É o principal redutor de custo de atendimento do portal.

O chamado aberto pelo cliente entra em **triagem obrigatória** — nunca é
atribuído direto a técnico — e o cliente informa sintoma e local, nunca
prioridade. Prioridade é decisão do SLA contratado, não do solicitante; deixar
o cliente escolher faz todo chamado virar crítico e o indicador perde sentido.

---

## M.6 Geolocalização

### D-12 · Provedor de mapa — **RESOLVIDA**

**Decisão:** **MapLibre GL JS** com tiles do OpenStreetMap.

**Fundamentação.** Sem chave, sem cobrança por carregamento, licença BSD, e o
dado geográfico permanece no nosso PostGIS — que já está pronto (migração 0008).
Google Maps tem melhor qualidade de endereço no Brasil, mas cobra por
carregamento de mapa e vincula a plataforma a um contrato com reajuste em
dólar. Para uma tela de operação interna, a diferença de qualidade não paga o
custo recorrente nem o vínculo.

**Condição de revisão:** se o mapa passar a ser usado para roteirização de
técnico com trânsito em tempo real, a decisão muda — OSM não tem trânsito.

### D-13 · Geocodificação — **RESOLVIDA**

**Decisão:** cadeia em três passos, com cache obrigatório.

1. **ViaCEP** para completar o endereço a partir do CEP. Gratuito, sem chave,
   mantido pela comunidade, cobertura nacional. Devolve logradouro, bairro,
   município e UF — **não devolve coordenada**.
2. **Nominatim** para a coordenada, a partir do endereço completo. Gratuito,
   limite de 1 requisição por segundo, uso em massa proibido pela política —
   daí o cache ser obrigatório, não otimização.
3. **Ajuste manual** no mapa quando os dois falham, marcado como
   `precisao = 'MANUAL'` e nunca sobrescrito.

**Regra de honestidade:** ponto obtido por centroide de CEP é marcado como
`CENTROIDE_CEP` e exibido visualmente distinto. Um CEP de logradouro em capital
cobre um quarteirão; um CEP de município do interior cobre a cidade inteira.
Técnico despachado para o centroide chega no lugar errado, e o sistema precisa
dizer que não sabe.

### D-11 · Telemetria de contador — **ADIADA, com preparo**

**Decisão:** coleta manual e por CSV agora. `leitura_medidor.origem` já aceita
`TELEMETRIA` e `API`.

**Fundamentação.** Coleta automática exige agente (DCA) na rede do cliente
falando SNMP com as impressoras, o que demanda acordo de instalação, abertura
de porta e responsabilidade sobre software rodando na infraestrutura do
cliente. É produto próprio, não funcionalidade.

---

## M.7 Quadro consolidado

| # | Decisão | Resolução | Fundamento principal |
| --- | --- | --- | --- |
| D-01 | Isolamento do cliente | RLS com eixo `cliente_id` | LGPD art. 46 |
| D-02 | Modelo organizacional | grupo → cliente (CNPJ 14) → local | CNPJ por estabelecimento; Lei 8.212 art. 30 IX |
| D-03 | Origem do XML | Upload manual, chave validada | Certificado A1/A3 é fase 2 |
| D-04 | ERP | Plataforma é a origem | Não criar dependência externa no cadastro |
| D-05 | Franquia acumulativa | Modelada, desligada | Padrão de mercado é expirar |
| D-06 | Preço por filial | Sim, sem estrutura nova | Decorre de D-02 |
| D-07 | Autenticação | **Implementação própria, Argon2id** *(revertida)* | Independência de fornecedor no cadastro de identidade |
| D-08 | SSO | Adiado, preparado | `subject_oidc` já existe |
| D-09 | Portal | Mesma origem, `/portal` | Isolamento é RLS, não origem |
| D-10 | Chamado pelo cliente | Sim, com triagem obrigatória | Prioridade é do SLA, não do solicitante |
| D-11 | Telemetria | Adiada, preparada | Exige agente na rede do cliente |
| D-12 | Mapa | **Vetor embutido + tiles opcionais** *(revista)* | Build de arquivo único precisa funcionar sem rede |
| D-13 | Geocodificação | Nominatim, por ação explícita | Política de uso: 1 req/s, sem busca a cada tecla |
| D-20 | Contas a receber | **Tabela única com origem** | Duas tabelas = duas verdades sobre a dívida do cliente |
| D-21 | Índice de reajuste | **Cadastro manual mensal** | Motor roda dentro do banco; API externa vira dependência de rede |
| — | A3 | 2 × A4, configurável | Contador do equipamento e tabela comercial |
| — | Duplex | 2 páginas, sem conversão | Contador conta faces, não folhas |
| — | Scan | Registrado, não cobrado | Minoria no mercado |
| — | Corte de leitura | Último dia, janela até 5º dia útil | Competência civil; ISS |
| — | Impostos na aquisição | Não recuperáveis entram no custo | CPC 27 item 16; Lei 6.404 art. 183 |
| — | Retenção fiscal | 5 anos, remoção bloqueada | CTN art. 173 |
| — | Reajuste | IPCA padrão, anual | Lei 10.192/01 art. 2º §1º |
| — | Comissão | Fora de escopo | Merece módulo próprio |

---

## M.8 O que estas decisões custam se estiverem erradas

Registro honesto do risco de cada uma, para revisão futura.

| Decisão | Custo de reverter |
| --- | --- |
| D-01 RLS por cliente | **Alto.** Muda políticas de todas as tabelas visíveis ao cliente |
| D-02 Filial = cliente | **Alto.** Muda a chave de faturamento |
| Impostos no custo | **Médio.** Recalcular custo e depreciação do parque já cadastrado |
| A3 = 2 | **Baixo.** Fator configurável, aplicado no cálculo |
| D-12 MapLibre | **Baixo.** Camada de apresentação; o dado está no PostGIS |
| D-03 Upload manual | **Baixo.** Acrescentar a consulta SEFAZ não invalida o que existe |
| Retenção 5 anos | **Nenhum.** Guardar a mais nunca é problema |
| D-07 Auth própria | **Alto se para trás, baixo se para frente.** Migrar para Supabase Auth depois exige redefinição de senha em massa — o hash é nosso e não se exporta. Ir de Supabase para próprio seria o mesmo problema espelhado. É a decisão mais cara de reverter deste conjunto, e por isso a que mais merecia ser tomada com os dois custos à vista |
| D-20 Título único | **Médio.** Separar depois exige migrar as linhas CONTRATUAL para uma tabela `fatura` e reapontar o portal |
| D-21 Índice manual | **Nenhum.** Acrescentar consulta a API depois não invalida os índices já cadastrados |
