# 3. Público-Alvo

## 3.1 Perfil de empresa atendida

| Dimensão | Faixa-alvo primária | Observação |
| --- | --- | --- |
| Segmento | Locação de equipamentos (construção, industrial, movimentação de carga, energia/geradores, equipamentos de escritório e impressão, agrícola, eventos) | O modelo de medição parametrizável cobre horímetro, contador de ciclos/cópias, quilometragem e diárias |
| Tamanho de frota | 50 a 20.000 ativos | Abaixo de 50 a planilha ainda "funciona"; acima de 20.000 exige revisão de particionamento |
| Estrutura | 1 a 30 filiais/bases | Hierarquia `Empresa → Filial → Local de operação` |
| Modelo de receita | Predominantemente recorrente (mensal), com componente variável por consumo | O motor de faturamento cobre fixo, variável, franquia+excedente, diária e híbrido |
| Maturidade digital | Possui ERP financeiro/fiscal, mas não possui gestão de ativos locados | A IARX integra, não substitui o ERP |

## 3.2 Personas operacionais

Cada persona é descrita por objetivo, contexto de uso, tarefa crítica e critério de sucesso da
interface. As decisões de UX da seção 9 derivam diretamente destas fichas.

---

### P1 — Operador Administrativo / Backoffice de Locação
- **Objetivo:** cadastrar e manter contratos, clientes e alocações sem retrabalho.
- **Contexto:** desktop, 6–8 h/dia no sistema, alto volume, muitas interrupções.
- **Tarefas críticas:** abrir contrato; alocar/substituir equipamento; registrar devolução;
  anexar documento assinado; responder "onde está o equipamento X?".
- **Critério de sucesso:** contrato completo em ≤ 3 min; busca global resolve qualquer consulta
  em ≤ 2 interações; atalhos de teclado nas listas e formulários.

### P2 — Técnico de Manutenção (campo e oficina)
- **Objetivo:** executar a OS e registrar o que fez, com o mínimo de digitação.
- **Contexto:** **mobile**, luvas, luz solar, conectividade instável, oficina ruidosa.
- **Tarefas críticas:** ler QR Code do equipamento; ver histórico e OS abertas; apontar tempo;
  baixar peças; anexar fotos; coletar assinatura do cliente; fechar OS **offline**.
- **Critério de sucesso:** fluxo completo de OS em ≤ 6 toques; funcionamento offline com
  sincronização automática; alvos de toque ≥ 44 px; nenhuma digitação livre obrigatória.

### P3 — Supervisor de Manutenção
- **Objetivo:** manter SLA e reduzir tempo parado.
- **Contexto:** desktop + tablet; visão de fila e agenda.
- **Tarefas críticas:** triar chamados; distribuir OS por técnico/região; acompanhar SLA em risco;
  aprovar custo de manutenção acima de limite; validar OS concluída.
- **Critério de sucesso:** um painel único com fila priorizada por risco de SLA; realocação de OS
  por arrastar-e-soltar na agenda.

### P4 — Coordenador de Logística / Pátio
- **Objetivo:** garantir que o equipamento certo saia e volte no prazo, com registro fiel.
- **Contexto:** desktop no pátio + mobile na conferência.
- **Tarefas críticas:** conferir romaneio de saída; registrar entrega com checklist e foto;
  registrar retorno com inspeção; transferir ativo entre filiais.
- **Critério de sucesso:** conferência por leitura de QR Code em sequência, sem formulário longo;
  divergência de checklist gera pendência automática.

### P5 — Analista Financeiro / Faturamento
- **Objetivo:** fechar o mês corretamente e cobrar no prazo.
- **Contexto:** desktop, picos no fechamento (D-3 a D+2).
- **Tarefas críticas:** revisar pré-faturas; tratar pendências de medição; aplicar desconto/reajuste
  com justificativa; emitir em lote; acompanhar recebimento e inadimplência.
- **Critério de sucesso:** painel de fechamento por exceção; toda fatura com memória de cálculo
  navegável até a leitura de origem; emissão em lote com pré-validação.

### P6 — Gestor Operacional / Gerente de Filial
- **Objetivo:** ocupar a frota e cumprir prazos.
- **Contexto:** desktop e mobile, uso curto e frequente.
- **Tarefas críticas:** ver ociosidade e ativos parados; acompanhar entregas do dia;
  ver contratos a vencer; escalar exceções.
- **Critério de sucesso:** dashboard operacional que responde "o que exige minha ação hoje"
  na primeira dobra da tela.

### P7 — Diretor Operacional / Financeiro
- **Objetivo:** decidir sobre investimento, precificação e carteira.
- **Contexto:** mobile e desktop, sessões curtas, semanal/mensal.
- **Tarefas críticas:** ver receita, margem, ocupação e inadimplência; comparar filiais;
  identificar clientes e ativos deficitários; exportar para o conselho.
- **Critério de sucesso:** painel executivo com ≤ 8 indicadores, tendência e *drill-down* de
  no máximo dois níveis até o registro-fonte.

### P8 — Administrador da Plataforma (TI/Processos)
- **Objetivo:** manter parametrização, perfis e integrações.
- **Contexto:** desktop, uso pontual e de alto impacto.
- **Tarefas críticas:** gerenciar usuários e perfis; parametrizar SLAs, planos preventivos e regras
  de cobrança; configurar integrações e webhooks; auditar ações sensíveis.
- **Critério de sucesso:** área administrativa segregada, com pré-visualização de efeito das
  parametrizações e auditoria completa.

---

## 3.3 Matriz persona × módulo (intensidade de uso)

Legenda: ● uso intenso · ◐ uso regular · ○ uso pontual · — sem acesso padrão

| Módulo | P1 Admin | P2 Técnico | P3 Superv. | P4 Logíst. | P5 Financ. | P6 Gestor | P7 Diretor | P8 TI |
| --- | :--: | :--: | :--: | :--: | :--: | :--: | :--: | :--: |
| Contratos | ● | — | ○ | ◐ | ◐ | ◐ | ○ | ○ |
| Equipamentos | ● | ◐ | ◐ | ● | ○ | ◐ | ○ | ○ |
| Mapa Operacional | ◐ | ○ | ◐ | ● | — | ● | ◐ | — |
| Faturamento & Consumo | ◐ | ○ | — | ○ | ● | ◐ | ◐ | ○ |
| Manutenção | ○ | ● | ● | ◐ | ○ | ◐ | ○ | ○ |
| Peças & Estoque | — | ◐ | ● | ◐ | ○ | ○ | — | ○ |
| Financeiro | — | — | ○ | — | ● | ◐ | ● | ○ |
| Administração | — | — | — | — | — | ○ | ○ | ● |

## 3.4 Implicações de design derivadas do público

1. **Duas experiências, um sistema.** Backoffice denso e orientado a teclado (P1, P5) e campo
   enxuto e orientado a toque (P2, P4). Não é o mesmo layout com breakpoints — são jornadas
   distintas sobre o mesmo domínio.
2. **Offline é requisito, não recurso.** A operação de campo ocorre em obra, subsolo e zona rural.
3. **Leitura de código é o principal método de entrada.** QR Code/etiqueta substitui digitação de
   patrimônio em todos os fluxos de campo.
4. **Gestores consomem exceção; diretores consomem tendência.** Os dois dashboards são
   estruturalmente diferentes (seção 9.6).
5. **Ação sensível exige justificativa, não bloqueio.** Descontos, cancelamentos e ajustes de
   estoque são permitidos a quem tem alçada, sempre com motivo registrado e auditado.
