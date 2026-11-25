param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskPort = if ($env:KTX_PORT) { [int]$env:KTX_PORT } else { 47831 }
$taskUrl = "http://127.0.0.1:$taskPort"
$taskData = if ($env:KTX_DATA_DIR) { $env:KTX_DATA_DIR } else { Join-Path $PSScriptRoot '.local' }
$taskServer = Join-Path $PSScriptRoot 'server.mjs'
New-Item -ItemType Directory -Path $taskData -Force | Out-Null
$taskReady = $false
try { $taskHealth = Invoke-RestMethod -Uri "$taskUrl/api/health" -TimeoutSec 2; $taskReady = $taskHealth.app -eq 'ktx-special-local' } catch {}
if (-not $taskReady) {
  $taskNode = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
  if (-not $taskNode) {
    $taskBundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $taskBundled) { $taskNode = $taskBundled }
  }
  if (-not $taskNode) { throw 'Node.js 22 이상이 필요합니다. Node.js를 설치한 뒤 다시 실행해 주세요.' }
  $taskChild = Start-Process -FilePath $taskNode -ArgumentList ('"' + $taskServer + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskData 'app.log') -RedirectStandardError (Join-Path $taskData 'error.log')
  Set-Content -LiteralPath (Join-Path $taskData 'app.pid') -Value $taskChild.Id
  for ($taskAttempt = 0; $taskAttempt -lt 25; $taskAttempt++) {
    Start-Sleep -Milliseconds 200
    try { $taskHealth = Invoke-RestMethod -Uri "$taskUrl/api/health" -TimeoutSec 1; if ($taskHealth.app -eq 'ktx-special-local') { $taskReady = $true; break } } catch {}
    if ($taskChild.HasExited) { break }
  }
}
if (-not $taskReady) { throw "실행하지 못했습니다. $taskData\error.log 파일을 확인해 주세요." }
if (-not $NoBrowser) { Start-Process $taskUrl }
