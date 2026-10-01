param(
  [string]$service = "all",
  [switch]$NoCache
)

$buildArgs = @('compose','build')
if ($NoCache) { $buildArgs += '--no-cache' }
if ($service -ne 'all') { $buildArgs += $service }
& docker @buildArgs

$upArgs = @('compose','up','-d','--force-recreate')
if ($service -ne 'all') { $upArgs += $service }
& docker @upArgs

docker compose ps
