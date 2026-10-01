param(
  [switch]$Rebuild
)

$root = (Join-Path $PSScriptRoot '..' | Resolve-Path).Path
$bdir = Join-Path $root 'backups'
if (-not (Test-Path $bdir)) { Write-Error "Cartella backups non trovata: $bdir"; exit 1 }
$latest = Get-ChildItem -Directory $bdir | Sort-Object Name -Descending | Select-Object -First 1
if (-not $latest) { Write-Error "Nessun backup trovato in $bdir"; exit 1 }
Write-Host "[restore-latest] Userò il backup: $($latest.FullName)" -ForegroundColor Yellow
& (Join-Path $PSScriptRoot 'restore.ps1') -BackupDir $latest.FullName -Rebuild:$Rebuild

