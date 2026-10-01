param(
  [string]$BackupDir,
  [switch]$Rebuild
)

if (-not $BackupDir) { Write-Error "Specifica -BackupDir (cartella contenente db.sql)"; exit 1 }
if (-not (Test-Path $BackupDir)) { Write-Error "BackupDir non trovato: $BackupDir"; exit 1 }
$dump = Join-Path $BackupDir 'db.sql'
if (-not (Test-Path $dump)) { Write-Error "File dump non trovato: $dump"; exit 1 }

Write-Host "[restore] Avvio MySQL e Redis..." -ForegroundColor Cyan
if ($Rebuild) { & docker compose build mysql redis | Out-Null }
& docker compose up -d mysql redis | Out-Null

function Wait-Healthy($name, $timeoutSec=180) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    $state = (& docker inspect -f '{{.State.Health.Status}}' $name 2>$null)
    if ($LASTEXITCODE -eq 0 -and $state -eq 'healthy') { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

if (-not (Wait-Healthy 'app_mysql' 240)) { Write-Error "MySQL non healthy entro il timeout"; exit 1 }

Write-Host "[restore] Importo dump nel DB..." -ForegroundColor Yellow
# Prepara i database (drop/create) e importa dump
& docker exec app_mysql sh -lc "mysql -uroot -prootpass -e \"DROP DATABASE IF EXISTS appdb; CREATE DATABASE appdb; DROP DATABASE IF EXISTS keycloakdb; CREATE DATABASE keycloakdb;\"" | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "Preparazione DB fallita"; exit 1 }

Get-Content $dump | & docker exec -i app_mysql sh -lc "mysql -uroot -prootpass" | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "Import SQL fallito"; exit 1 }

Write-Host "[restore] Avvio Keycloak, backend e frontend..." -ForegroundColor Cyan
& docker compose up -d idp backend frontend | Out-Null
& docker compose ps
Write-Host "[restore] Ripristino completato."

