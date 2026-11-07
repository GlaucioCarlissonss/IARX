# Protótipos — Anexo Y

Esboços estáticos para aprovação **antes** de codificar. Não fazem parte do
aplicativo, não entram no build e não têm dependência nenhuma: são HTML de um
arquivo, abertos direto no navegador.

| Arquivo | Mostra |
| --- | --- |
| `a-painel.html` | Painel do dia com a navegação em 6 áreas |
| `b-lista.html` | Lista de trabalho com seleção em lote e visões salvas |
| `c-mobile.html` | Celular (390 px) com navegação inferior rotulada |

Os `.png` ao lado são a captura de cada um, em 2×.

A paleta é a de `packages/tokens` copiada à mão, de propósito: o protótipo
precisa parecer o produto para que o que se julgue seja a **estrutura**, e
precisa ser independente para não quebrar quando o aplicativo mudar.

Para regerar as capturas das telas **reais** (não dos protótipos):

```sh
npm run build
node apps/web/scripts/capturar-telas.mjs /tmp/telas
```
