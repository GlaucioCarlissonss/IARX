#!/usr/bin/env bash
# Recria o banco de teste, aplica todas as migrações e executa a suíte de
# invariantes. Falha no primeiro erro.
#
# Uso:
#   ./scripts/test.sh                    # banco local iarx_test
#   SKIP_POSTGIS=1 ./scripts/test.sh     # ambiente sem PostGIS
#   PGDATABASE=outro ./scripts/test.sh
set -Eeuo pipefail

cd "$(dirname "$0")/.."
DB="${PGDATABASE:-iarx_test}"

echo "== recriando banco $DB"
psql -q --no-psqlrc -d postgres -c "drop database if exists $DB" -c "create database $DB"

echo "== aplicando migrações"
PGDATABASE="$DB" ./scripts/migrate.sh

echo "== executando suíte de invariantes"
falhas=0
for t in tests/*.sql; do
  echo
  echo "-- $t"
  if PGDATABASE="$DB" psql -v ON_ERROR_STOP=1 -q --no-psqlrc -f "$t"; then
    :
  else
    echo "!! FALHOU: $t"
    falhas=$((falhas + 1))
  fi
done

echo
if (( falhas > 0 )); then
  echo "== $falhas arquivo(s) de teste falhou(aram)"
  exit 1
fi
echo "== suíte completa aprovada"
