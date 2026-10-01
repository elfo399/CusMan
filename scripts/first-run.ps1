param(
  [switch]$Rebuild,
  [switch]$NoCache
)

Write-Host "[first-run] Avvio inizializzazione stack (MySQL/Redis)..."

if ($Rebuild) {
  $args = @('compose','build')
  if ($NoCache) { $args += '--no-cache' }
  & docker @args
}

# 1) Avvia DB e Redis
& docker compose up -d mysql redis | Out-Null

# 2) Attendi MySQL healthy
function Wait-Healthy($name, $timeoutSec=120) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    $state = (& docker inspect -f '{{.State.Health.Status}}' $name 2>$null)
    if ($LASTEXITCODE -eq 0 -and $state -eq 'healthy') { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

if (-not (Wait-Healthy 'app_mysql' 180)) {
  Write-Error "MySQL non è healthy entro il timeout"
  exit 1
}

Write-Host "[first-run] MySQL pronto. Eseguo bootstrap schema..."

# 3) Bootstrap schema applicativo (idempotente)
$sqlBootstrap = @"
CREATE DATABASE IF NOT EXISTS appdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS keycloakdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON keycloakdb.* TO 'appuser'@'%';
FLUSH PRIVILEGES;

-- Tabella jobs usata dallo scraper
CREATE TABLE IF NOT EXISTS appdb.jobs (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  error TEXT NULL,
  params JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Snapshot CSV dei risultati (se non esiste)
ALTER TABLE appdb.jobs ADD COLUMN IF NOT EXISTS results_csv LONGTEXT NULL AFTER params;
"@

& docker exec app_mysql sh -lc @"
  mysql -uroot -prootpass -e "${sqlBootstrap}"
"@

# 4) Se la tabella clienti non esiste, applica lo schema+seed iniziale
$exists = (& docker exec app_mysql sh -lc 'mysql -uroot -prootpass -N -s -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=''appdb'' AND table_name=''clienti'';"' )
if ($exists -eq '0') {
  Write-Host "[first-run] Creo 'clienti' e seed iniziale..."
  & docker exec app_mysql sh -lc "mysql -uroot -prootpass < /docker-entrypoint-initdb.d/01-sqlClienti.sql"
} else {
  Write-Host "[first-run] Tabella 'clienti' già presente, salto seed."
}

# 4b) Partner: crea tabella minimale + record demo (idempotente)
Write-Host "[first-run] Creo/aggiorno tabella 'clienti_partner' e inserisco record demo se vuota..."
& docker exec app_mysql sh -lc "mysql -uroot -prootpass appdb < /docker-entrypoint-initdb.d/03-clienti-partner.sql"

# 5) Avvia gli altri servizi
& docker compose up -d idp backend frontend | Out-Null

Write-Host "[first-run] Inizializzazione completata. Servizi attivi:"
& docker compose ps
