param(
  [string]$OutDir,
  [switch]$IncludeEnv
)

$ErrorActionPreference = 'Stop'

if (-not $OutDir -or $OutDir.Trim().Length -eq 0) {
  $root = Join-Path $PSScriptRoot '..'
  $OutDir = Join-Path $root 'backups'
}

Write-Host "[backup] Avvio backup MySQL (appdb + keycloakdb) dal container 'app_mysql'..." -ForegroundColor Cyan

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dest = Join-Path $OutDir $stamp
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$tmpInContainer = "/tmp/infracusman_dump_${stamp}.sql"

# Esegui mysqldump dentro il container per evitare problemi di quoting/redirect su Windows
& docker exec app_mysql sh -lc "mysqldump -uroot -prootpass --databases appdb keycloakdb > ${tmpInContainer}" | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "mysqldump fallito"; exit 1 }

$localDump = Join-Path $dest 'db.sql'
& docker cp "app_mysql:${tmpInContainer}" "$localDump"
if ($LASTEXITCODE -ne 0) { Write-Error "docker cp del dump fallito"; exit 1 }

# Pulisci il file temporaneo nel container (best-effort)
& docker exec app_mysql sh -lc "rm -f ${tmpInContainer}" | Out-Null

# Copia opzionale dell'env
if ($IncludeEnv) {
  $root = Join-Path $PSScriptRoot '..'
  $envPath = Join-Path $root '.env'
  if (Test-Path $envPath) {
    Copy-Item $envPath (Join-Path $dest '.env') -Force
  }
}

# Copia anche la definizione del realm come riferimento (non include utenti)
$realmPath = Join-Path (Join-Path (Join-Path $PSScriptRoot '..') 'keycloak') 'realm-cusman.json'
if (Test-Path $realmPath) {
  Copy-Item $realmPath (Join-Path $dest 'realm-cusman.json') -Force
}

Write-Host "[backup] Completato: $localDump" -ForegroundColor Green
Write-Host "[backup] Copia la cartella '$dest' sul nuovo PC per il ripristino."
