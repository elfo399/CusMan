param(
  [switch]$Frontend,
  [switch]$Backend,
  [switch]$NoCache,
  [int]$DebounceMs = 800
)

Write-Host "[watch] Avvio watcher per auto-redeploy Docker (Ctrl+C per uscire)" -ForegroundColor Cyan

$watchFe = $true
$watchBe = $true
if ($Frontend -and -not $Backend) { $watchBe = $false }
if ($Backend -and -not $Frontend) { $watchFe = $false }

function New-Watcher($path) {
  $fsw = New-Object System.IO.FileSystemWatcher
  $fsw.Path = $path
  $fsw.IncludeSubdirectories = $true
  $fsw.EnableRaisingEvents = $true
  $fsw.Filter = '*.*'
  return $fsw
}

$pending = [Collections.Concurrent.ConcurrentDictionary[string, datetime]]::new()
$building = [Collections.Concurrent.ConcurrentDictionary[string, bool]]::new()

function Mark-Pending([string]$svc) {
  $pending[$svc] = [datetime]::UtcNow
}

function Should-Run([string]$svc, [int]$debounceMs) {
  if (-not $pending.ContainsKey($svc)) { return $false }
  $ts = $pending[$svc]
  $age = ([datetime]::UtcNow - $ts).TotalMilliseconds
  return $age -ge $debounceMs -and -not ($building.GetValueOrDefault($svc))
}

function Redeploy([string]$svc, [switch]$NoCache) {
  try {
    $building[$svc] = $true
    Write-Host "[watch] Cambio rilevato -> rebuild '$svc'..." -ForegroundColor Yellow
    $buildArgs = @('compose','build')
    if ($NoCache) { $buildArgs += '--no-cache' }
    $buildArgs += $svc
    & docker @buildArgs
    if ($LASTEXITCODE -ne 0) { throw "docker compose build $svc failed" }
    & docker compose up -d --force-recreate $svc
    if ($LASTEXITCODE -ne 0) { throw "docker compose up $svc failed" }
    Write-Host "[watch] Redeploy '$svc' completato." -ForegroundColor Green
  } catch {
    Write-Warning "[watch] Errore redeploy $svc: $_"
  } finally {
    $null = $pending.TryRemove($svc, [ref]([datetime]::UtcNow))
    $building[$svc] = $false
  }
}

$subs = @()
try {
  if ($watchFe) {
    $feRoot = Join-Path $PSScriptRoot '..' | Join-Path 'fe' | Resolve-Path
    $wfe = New-Watcher $feRoot
    foreach ($evt in 'Changed','Created','Deleted','Renamed') {
      $subs += Register-ObjectEvent -InputObject $wfe -EventName $evt -Action { Mark-Pending 'frontend' }
    }
    Write-Host "[watch] Watching FE: $feRoot" -ForegroundColor DarkGray
  }
  if ($watchBe) {
    $beRoot = Join-Path $PSScriptRoot '..' | Join-Path 'be' | Resolve-Path
    $wbe = New-Watcher $beRoot
    foreach ($evt in 'Changed','Created','Deleted','Renamed') {
      $subs += Register-ObjectEvent -InputObject $wbe -EventName $evt -Action { Mark-Pending 'backend' }
    }
    Write-Host "[watch] Watching BE: $beRoot" -ForegroundColor DarkGray
  }

  while ($true) {
    Start-Sleep -Milliseconds 250
    if ($watchFe -and (Should-Run 'frontend' $DebounceMs)) { Redeploy 'frontend' -NoCache:$NoCache }
    if ($watchBe -and (Should-Run 'backend' $DebounceMs)) { Redeploy 'backend' -NoCache:$NoCache }
  }
} finally {
  foreach ($s in $subs) { Unregister-Event -SourceIdentifier $s.Name -ErrorAction SilentlyContinue }
}

