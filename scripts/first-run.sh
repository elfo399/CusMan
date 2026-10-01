#!/usr/bin/env sh
set -e

REBUILD="${REBUILD:-false}"
NOCACHE="${NOCACHE:-false}"

echo "[first-run] Bootstrapping stack (MySQL/Redis)..."

if [ "$REBUILD" = "true" ]; then
  if [ "$NOCACHE" = "true" ]; then
    docker compose build --no-cache
  else
    docker compose build
  fi
fi

docker compose up -d mysql redis

# wait for MySQL healthy
deadline=$(( $(date +%s) + 180 ))
while :; do
  state=$(docker inspect -f '{{.State.Health.Status}}' app_mysql 2>/dev/null || true)
  if [ "$state" = "healthy" ]; then break; fi
  if [ $(date +%s) -gt $deadline ]; then
    echo "MySQL not healthy in time" >&2; exit 1
  fi
  sleep 2
done

echo "[first-run] MySQL ready. Applying bootstrap schema..."

docker exec app_mysql sh -lc "mysql -uroot -prootpass -e \"
CREATE DATABASE IF NOT EXISTS appdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS keycloakdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON keycloakdb.* TO 'appuser'@'%';
FLUSH PRIVILEGES;
CREATE TABLE IF NOT EXISTS appdb.jobs (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  error TEXT NULL,
  params JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 ALTER TABLE appdb.jobs ADD COLUMN IF NOT EXISTS results_csv LONGTEXT NULL AFTER params;
\""

# seed clienti if missing
exists=$(docker exec app_mysql sh -lc "mysql -uroot -prootpass -N -s -e \"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='appdb' AND table_name='clienti';\"")
if [ "$exists" = "0" ]; then
  echo "[first-run] Creating 'clienti' and seeding..."
  docker exec app_mysql sh -lc "mysql -uroot -prootpass < /docker-entrypoint-initdb.d/01-sqlClienti.sql"
else
  echo "[first-run] 'clienti' already exists, skipping seed."
fi

# partner table + demo record (idempotent)
echo "[first-run] Creating/updating 'clienti_partner' and inserting demo if empty..."
docker exec app_mysql sh -lc "mysql -uroot -prootpass appdb < /docker-entrypoint-initdb.d/03-clienti-partner.sql"

docker compose up -d idp backend frontend

echo "[first-run] Done. Services:"
docker compose ps
