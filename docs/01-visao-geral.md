# 1. Visão Geral da Plataforma

## 1.1 Definição

A IARX é uma plataforma SaaS corporativa, multiempresa e responsiva, para **gestão integrada
do ciclo de vida da locação de equipamentos** — da aquisição do ativo à sua baixa, passando por
contratação, entrega, medição, faturamento, manutenção, consumo de peças e apuração de resultado.

A plataforma substitui o arranjo típico do setor — ERP genérico + planilhas de controle de frota +
WhatsApp para chamados técnicos + caderno de medição — por um **núcleo transacional único**, no qual
todo evento operacional já nasce estruturado, datado, atribuído a um responsável e vinculado a um ativo.

## 1.2 Princípio arquitetural central: o ativo como eixo

Sistemas de locação falham quando modelam o contrato como entidade central e o equipamento como
mero item de lista. A IARX inverte essa relação:

```
                        ┌───────────────────────────┐
                        │       EQUIPAMENTO         │
                        │  (ativo identificado por  │
                        │   patrimônio + série)     │
                        └─────────────┬─────────────┘
                                      │  linha de tempo única e imutável
       ┌──────────────┬───────────────┼───────────────┬──────────────┐
       ▼              ▼               ▼               ▼              ▼
  Movimentações   Leituras de     Ordens de      Alocações        Lançamentos
  (entrega,       medidor         Serviço        contratuais      financeiros
   retorno,       (horímetro,     (preventiva,   (item de         (receita
   transf.)       contador)        corretiva)     contrato)        alocada, custo)
```

Consequências diretas dessa decisão:

1. **Rentabilidade por ativo é subproduto, não relatório.** Receita alocada, custo de manutenção,
   peças consumidas, logística e depreciação já estão vinculados ao mesmo `equipamento_id`.
2. **Disponibilidade é calculada, não declarada.** O estado atual do equipamento é a projeção
   determinística de sua última movimentação válida.
3. **Conflitos são impossíveis por construção.** Não existe caminho de gravação que aloque um
   equipamento em dois contratos com vigências sobrepostas (ver `RN-001`).

## 1.3 Pilares da solução

| Pilar | Tradução em produto |
| --- | --- |
| **Simplicidade operacional** | Tarefas do dia a dia resolvidas em uma tela e no máximo 3 interações; nada essencial atrás de mais de 2 níveis de menu |
| **Verdade única** | Um estado por equipamento, uma vigência por alocação, um número por fatura — sem controles paralelos |
| **Automação por padrão** | O sistema propõe (fatura, OS preventiva, reposição de peça, reajuste) e o humano confirma; nunca o contrário |
| **Gestão por exceção** | Dashboards mostram desvio, não volume: o que está atrasado, parado, vencendo, abaixo do mínimo |
| **Rastreabilidade total** | Todo dado crítico responde "quem, quando, de qual valor para qual, por quê" |
| **Escalabilidade planejada** | Monólito modular com fronteiras explícitas, pronto para extração de serviços quando (e se) a carga exigir |

## 1.4 Escopo funcional (visão macro)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                       CAMADA DE EXPERIÊNCIA                                  │
│  Web responsiva (admin/gestão)   ·   PWA de campo (técnico/logística)        │
├──────────────────────────────────────────────────────────────────────────────┤
│                       MÓDULOS DE NEGÓCIO                                     │
│  ┌───────────┐ ┌────────────┐ ┌──────────┐ ┌─────────────┐ ┌──────────────┐ │
│  │ Contratos │ │Equipamentos│ │  Mapa    │ │ Faturamento │ │  Manutenção  │ │
│  │   & CRM   │ │  & Frota   │ │Operacional│ │  & Consumo  │ │   & SLA      │ │
│  └───────────┘ └────────────┘ └──────────┘ └─────────────┘ └──────────────┘ │
│  ┌────────────────────┐ ┌──────────────┐                                     │
│  │ Peças & Estoque    │ │  Financeiro  │                                     │
│  └────────────────────┘ └──────────────┘                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│                       SERVIÇOS TRANSVERSAIS                                  │
│  Identidade & RBAC · Auditoria · Notificações & Alertas · Anexos & Documentos │
│  Motor de Regras · Agendador · Relatórios & Exportação · Integrações          │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 1.5 O que a plataforma deliberadamente não é

Delimitar o escopo é parte da proposta. A IARX **não** pretende ser:

- **Um ERP contábil.** Não executa escrituração fiscal, SPED ou apuração de tributos. Entrega
  eventos financeiros estruturados e exportações para o ERP/contabilidade (seção 12).
- **Um emissor fiscal próprio.** A emissão de NF-e/NFS-e ocorre por integração com provedor
  homologado; a plataforma é a fonte da *base de cálculo*, não a autoridade fiscal.
- **Um sistema de telemetria.** Não constrói hardware. Consome telemetria de terceiros por
  API/MQTT e a converte em leituras de medidor e eventos de posição (seção 12).
- **Um CRM comercial completo.** Trata cliente, contato, local de operação e histórico contratual;
  funil de vendas, propostas comerciais complexas e cadência de prospecção ficam fora.

## 1.6 Modelo de operação (SaaS)

- **Multiempresa (multi-tenant) desde a fundação:** isolamento lógico por `tenant_id` com
  *Row-Level Security* no banco; um tenant pode conter múltiplas empresas/filiais.
- **Hierarquia organizacional:** `Tenant → Empresa → Filial/Base → Local de Operação (obra/site)`.
  Permissões e indicadores podem ser escopados em qualquer nível dessa árvore.
- **Configuração por tenant, não por código:** modalidades de cobrança, planos de manutenção,
  SLAs, campos personalizados, numeração de documentos e políticas de alerta são parametrizáveis.

## 1.7 Resultado esperado

| Dor atual | Como a plataforma elimina |
| --- | --- |
| Equipamento devolvido continua faturando (ou para de faturar sem devolução) | Faturamento derivado da vigência real da alocação, com pro-rata automático |
| Medição perdida ou lançada em atraso | Leitura capturada em campo pelo PWA com foto e geolocalização; ausência gera pendência bloqueante de fechamento |
| Não se sabe qual ativo dá prejuízo | Margem por equipamento consolidada continuamente (`KPI-14`) |
| Manutenção preventiva esquecida | Plano por horas/ciclos/calendário com geração automática de OS e bloqueio operacional (`RN-014`) |
| Peça trocada sem baixa no estoque | Baixa de peça obrigatória no apontamento da OS, com custo médio móvel |
| Fechamento mensal de 5 dias | Pré-fatura gerada automaticamente; equipe apenas trata exceções |
| Contrato vencido em campo | Régua de alertas em D-90/60/30/15/7 e painel de renovação (`RN-010`) |
