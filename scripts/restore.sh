#!/usr/bin/env sh
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Uso: $0 /percorso/backup_dir (contiene db.sql)" >&2
  exit 1
fi

BACKUP_DIR="$1"
DUMP="$BACKUP_DIR/db.sql"
if [ ! -f "$DUMP" ]; then
  echo "File dump non trovato: $DUMP" >&2
  exit 1
fi

echo "[restore] Avvio MySQL e Redis..."
docker compose up -d mysql redis

# Attendi healthy
echo "[restore] Attendo MySQL healthy..."
i=0
until [ "$i" -ge 120 ]; do
  state=$(docker inspect -f '{{.State.Health.Status}}' app_mysql 2>/dev/null || echo "")
  [ "$state" = "healthy" ] && break
  i=$((i+1))
  sleep 2
done
if [ "$state" != "healthy" ]; then
  echo "MySQL non healthy entro il timeout" >&2
  exit 1
fi

echo "[restore] Importo dump nel DB..."
docker exec app_mysql sh -lc "mysql -uroot -prootpass -e 'DROP DATABASE IF EXISTS appdb; CREATE DATABASE appdb; DROP DATABASE IF EXISTS keycloakdb; CREATE DATABASE keycloakdb;'"
docker exec -i app_mysql sh -lc "mysql -uroot -prootpass" < "$DUMP"

echo "[restore] Avvio Keycloak, backend e frontend..."
docker compose up -d idp backend frontend
docker compose ps
echo "[restore] Ripristino completato."

