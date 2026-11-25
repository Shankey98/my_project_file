$ErrorActionPreference = 'Stop'
$taskData = if ($env:KTX_DATA_DIR) { $env:KTX_DATA_DIR } else { Join-Path $PSScriptRoot '.local' }
$taskPort = if ($env:KTX_PORT) { [int]$env:KTX_PORT } else { 47831 }
$taskUrl = "http://127.0.0.1:$taskPort"
$taskNormalized = [System.IO.Path]::GetFullPath($taskData).TrimEnd('\').ToLowerInvariant()
$taskSha = [System.Security.Cryptography.SHA256]::Create()
try { $taskStorageId = [System.BitConverter]::ToString($taskSha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($taskNormalized))).Replace('-', '').ToLowerInvariant() } finally { $taskSha.Dispose() }
try { $taskHealth = Invoke-RestMethod -Uri "$taskUrl/api/health" -TimeoutSec 3 } catch { Write-Output '실행 중인 특실로 앱이 없습니다.'; exit }
if ($taskHealth.app -ne 'ktx-special-local' -or $taskHealth.storageId -ne $taskStorageId) { throw '다른 실행 폴더의 앱이므로 종료하지 않았습니다.' }
Invoke-RestMethod -Uri "$taskUrl/api/local-session" -Method Post -ContentType 'application/json' -Body '{}' -SessionVariable taskSession -TimeoutSec 3 | Out-Null
$taskBody = @{ storageId = $taskStorageId } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$taskUrl/api/shutdown" -Method Post -ContentType 'application/json' -Body $taskBody -WebSession $taskSession -TimeoutSec 3 | Out-Null
Write-Output '특실로 PC 앱을 종료했습니다.'
