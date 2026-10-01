#!/usr/bin/env sh
set -euo pipefail

OUT_DIR="$(dirname "$0")/../backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$OUT_DIR/$STAMP"

echo "[backup] Avvio backup MySQL (appdb + keycloakdb) dal container 'app_mysql'..."
mkdir -p "$DEST"

TMP_IN_CONTAINER="/tmp/infracusman_dump_${STAMP}.sql"
docker exec app_mysql sh -lc "mysqldump -uroot -prootpass --databases appdb keycloakdb > ${TMP_IN_CONTAINER}"
docker cp "app_mysql:${TMP_IN_CONTAINER}" "$DEST/db.sql"
docker exec app_mysql sh -lc "rm -f ${TMP_IN_CONTAINER}" || true

# Copia come riferimento la definizione realm
REALM_JSON="$(dirname "$0")/../keycloak/realm-cusman.json"
if [ -f "$REALM_JSON" ]; then
  cp "$REALM_JSON" "$DEST/realm-cusman.json"
fi

echo "[backup] Completato: $DEST/db.sql"
echo "[backup] Copia la cartella '$DEST' sul nuovo PC per il ripristino."

