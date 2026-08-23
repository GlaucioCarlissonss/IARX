#!/usr/bin/env bash
# Sobe o banco de teste da API, aplica as migrações, semeia a massa e roda os
# testes de integração.
#
# Uso:
#   ./scripts/testar.sh                  # banco iarx_api_test local
#   SKIP_POSTGIS=1 ./scripts/testar.sh   # ambiente sem PostGIS
set -Eeuo pipefail

cd "$(dirname "$0")/.."
RAIZ="$(cd ../.. && pwd)"
DB="${PGDATABASE_API:-iarx_api_test}"
SENHA_APP="${IARX_APP_SENHA:-iarx_app_teste}"

echo "== recriando banco $DB"
psql -q --no-psqlrc -d postgres -c "drop database if exists $DB" -c "create database $DB"

echo "== aplicando migrações"
(cd "$RAIZ/packages/db" && PGDATABASE="$DB" ./scripts/migrate.sh >/dev/null)

# A API roda como iarx_app, papel SUJEITO a RLS. As migrações criam esse papel
# sem login (é o correto para o schema — credencial é configuração de ambiente,
# não de esquema); aqui damos a ele login local para o teste conseguir conectar.
#
# Este é o ponto que torna o teste honesto: conectar como superusuário faria a
# RLS ser ignorada e todo o teste de isolamento passaria sem provar nada.
echo "== habilitando login local para iarx_app"
psql -q --no-psqlrc -d "$DB" \
  -c "alter role iarx_app login password '$SENHA_APP'" \
  -c "grant connect on database $DB to iarx_app"

echo "== semeando massa de teste"
psql -q --no-psqlrc -v ON_ERROR_STOP=1 -d "$DB" -f test/semear.sql

echo "== compilando contratos e API"
(cd "$RAIZ" && npx tsc -p packages/contracts/tsconfig.json)
(cd "$RAIZ" && npx tsc -p apps/api/tsconfig.test.json)

echo "== executando testes de integração"
export DATABASE_URL="postgresql://iarx_app:${SENHA_APP}@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/${DB}"
export IARX_JWT_SEGREDO="${IARX_JWT_SEGREDO:-segredo-de-teste-nao-use-em-producao}"
export NODE_ENV=test
# O laço de fundo do worker fica desligado, e os testes chamam `drenar()`
# diretamente. Com ele ativo, cada asserção sobre a fila viraria uma corrida
# contra um temporizador de 15s: hoje a suíte roda em 8s e a corrida nunca
# acontece, e é exatamente esse tipo de margem que vence sozinha quando a suíte
# cresce — falhando de forma intermitente, no CI, longe de quem a criou.
export NOTIFICACAO_WORKER=desligado

# Concorrência 1 de propósito.
#
# Os arquivos compartilham **um** banco de teste. Em paralelo, o worker de
# notificação de um arquivo drena a fila que o outro acabou de enfileirar, e a
# asserção falha de forma intermitente — a pior classe de teste instável,
# porque parece defeito do código.
node --test --test-concurrency=1 "dist-test/test/*.test.js"
