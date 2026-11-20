#!/bin/sh
# Menjalankan seluruh tes aplikasi di PostgreSQL asli (cluster sementara), tanpa Docker.
# Butuh binary PostgreSQL (initdb/pg_ctl/psql). Dijalankan sebagai root -> memakai user "postgres".
set -e
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | tail -1)}
DIR=${PGDIR:-/tmp/jm-pg}; PORT=${PGPORT_TEST:-55432}
cd "$(dirname "$0")/.."
ROOT=$(pwd)
rm -rf "$DIR"; mkdir -p "$DIR"
if [ "$(id -u)" = "0" ]; then chown postgres "$DIR"; RUN="runuser -u postgres --"; else RUN=""; fi
$RUN "$PGBIN/initdb" -D "$DIR/data" -A trust -U postgres >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
trap '$RUN "$PGBIN/pg_ctl" -D "$DIR/data" -m fast stop >/dev/null' EXIT
echo "PostgreSQL: $($PGBIN/psql --version)"
TEST_PSQL_URL="postgresql://postgres@/postgres?host=$DIR&port=$PORT" node --disable-warning=ExperimentalWarning --test --test-reporter=spec tests/app.test.js tests/pg.test.js
