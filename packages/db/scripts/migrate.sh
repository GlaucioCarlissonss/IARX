#!/usr/bin/env bash
# Aplica as migrações em ordem, abortando no primeiro erro.
#
# Uso:
#   ./scripts/migrate.sh                      # usa $DATABASE_URL
#   PGDATABASE=iarx_test ./scripts/migrate.sh # banco local
#   SKIP_POSTGIS=1 ./scripts/migrate.sh       # ambiente sem PostGIS
#
# Em produção as migrações são aplicadas pelo Supabase CLI (`supabase db push`),
# que consome exatamente os mesmos arquivos de supabase/migrations.
set -Eeuo pipefail

cd "$(dirname "$0")/.."
DIR=supabase/migrations

psql_run() {
  # ON_ERROR_STOP garante código de saída != 0; sem pipe, para não mascarar.
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql -v ON_ERROR_STOP=1 -q --no-psqlrc "$DATABASE_URL" -f "$1"
  else
    psql -v ON_ERROR_STOP=1 -q --no-psqlrc -f "$1"
  fi
}

aplicadas=0
for f in "$DIR"/*.sql; do
  nome=$(basename "$f")
  if [[ "${SKIP_POSTGIS:-0}" == "1" && "$nome" == *postgis* ]]; then
    echo "-- ignorada (SKIP_POSTGIS=1): $nome"
    continue
  fi
  echo "-- aplicando: $nome"
  psql_run "$f"
  aplicadas=$((aplicadas + 1))
done

echo "-- $aplicadas migração(ões) aplicada(s) com sucesso"
