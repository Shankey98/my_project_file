$ErrorActionPreference = 'Stop'
$taskSource = [IO.Path]::GetFullPath('C:\Users\SEUNGJUN\Documents\Codex\2026-11-22\d').TrimEnd('\')
$taskParent = (Resolve-Path -LiteralPath 'C:\Users\SEUNGJUN\Documents\project file').Path.TrimEnd('\')
$taskDestination = [IO.Path]::GetFullPath((Join-Path $taskParent 'KTX-Special'))
if ($taskDestination -ne "$taskParent\KTX-Special") { throw 'Destination must be KTX-Special inside the requested parent.' }
$taskInventory = @()
$taskLinks = @()
foreach ($taskBase in @($taskSource, $taskDestination)) {
foreach ($taskName in @('outputs', 'work')) {
  if (-not (Test-Path -LiteralPath (Join-Path $taskBase $taskName))) { continue }
  $taskPath = (Resolve-Path -LiteralPath (Join-Path $taskBase $taskName)).Path
  if ($taskPath -ne "$taskBase\$taskName") { throw 'Unexpected source path.' }
  foreach ($taskEntry in Get-ChildItem -LiteralPath $taskPath -Recurse -Force) {
    if ($taskEntry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      if ($taskEntry.LinkType -ne 'Junction') { throw "Unexpected link type: $($taskEntry.FullName)" }
      $taskTarget = [string](@($taskEntry.Target)[0])
      if (-not $taskTarget.StartsWith("$taskSource\", [StringComparison]::OrdinalIgnoreCase)) { throw 'Link target outside source project.' }
      $taskLinks += @{ path = $taskEntry.FullName.Substring($taskBase.Length + 1); target = $taskTarget.Substring($taskSource.Length + 1) }
    } elseif (-not $taskEntry.PSIsContainer) {
      $taskInventory += @{ path = $taskEntry.FullName.Substring($taskBase.Length + 1); length = $taskEntry.Length; sha256 = (Get-FileHash -LiteralPath $taskEntry.FullName -Algorithm SHA256).Hash }
    }
  }
}
}
New-Item -ItemType Directory -Path $taskDestination -Force | Out-Null
function Move-ProjectContents([string]$From, [string]$To) {
  if (-not $From.StartsWith("$taskSource\") -or -not $To.StartsWith("$taskDestination\")) { throw 'Recursive move boundary check failed.' }
  New-Item -ItemType Directory -Path $To -Force | Out-Null
  foreach ($taskChild in Get-ChildItem -LiteralPath $From -Force) {
    $taskChildTo = Join-Path $To $taskChild.Name
    if ($taskChild.PSIsContainer -and -not ($taskChild.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      Move-ProjectContents $taskChild.FullName $taskChildTo
    } else {
      if (Test-Path -LiteralPath $taskChildTo) { throw "Unexpected duplicate: $taskChildTo" }
      Move-Item -LiteralPath $taskChild.FullName -Destination $taskChildTo
    }
  }
  # A user-opened terminal can hold an empty directory; never terminate it.
  if (@(Get-ChildItem -LiteralPath $From -Force).Count -eq 0) {
    try { [IO.Directory]::Delete($From, $false) } catch { Write-Warning "An open process holds this empty former directory: $From" }
  }
}
foreach ($taskName in @('outputs', 'work')) {
  $taskFrom = (Resolve-Path -LiteralPath (Join-Path $taskSource $taskName)).Path
  $taskTo = [IO.Path]::GetFullPath((Join-Path $taskDestination $taskName))
  if ($taskFrom -ne "$taskSource\$taskName" -or $taskTo -ne "$taskDestination\$taskName") { throw 'Move boundary check failed.' }
  Move-ProjectContents $taskFrom $taskTo
}
foreach ($taskLink in $taskLinks) {
  $taskLinkPath = [IO.Path]::GetFullPath((Join-Path $taskDestination $taskLink.path))
  $taskLinkTarget = [IO.Path]::GetFullPath((Join-Path $taskDestination $taskLink.target))
  if (-not $taskLinkPath.StartsWith("$taskDestination\") -or -not $taskLinkTarget.StartsWith("$taskDestination\")) { throw 'Link boundary check failed.' }
  if ((Get-Item -LiteralPath $taskLinkPath -Force).LinkType -ne 'Junction') { throw 'Expected a junction.' }
  # Nonrecursive unlink removes only the junction, never its target directory.
  Remove-Item -LiteralPath $taskLinkPath -Force
  New-Item -ItemType Junction -Path $taskLinkPath -Target $taskLinkTarget | Out-Null
}
foreach ($taskFile in $taskInventory) {
  $taskNewFile = Join-Path $taskDestination $taskFile.path
  if ((Get-FileHash -LiteralPath $taskNewFile -Algorithm SHA256).Hash -ne $taskFile.sha256) { throw "Content mismatch: $($taskFile.path)" }
}
$taskReport = @{ source = $taskSource; destination = $taskDestination; checkedAt = [DateTimeOffset]::Now.ToString('o'); filesVerified = $taskInventory.Count; junctionsRebuilt = $taskLinks.Count; files = $taskInventory }
$taskReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskDestination 'migration-manifest.json') -Encoding utf8
$taskModules = Join-Path $taskDestination 'work\selenium-probe\node_modules\.modules.yaml'
$taskMetadata = Get-Content -LiteralPath $taskModules -Raw | ConvertFrom-Json
$taskMetadata.storeDir = Join-Path $taskDestination 'work\pnpm-store\v11'
$taskMetadata.virtualStoreDir = Join-Path $taskDestination 'work\selenium-probe\node_modules\.pnpm'
$taskMetadata | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $taskModules -Encoding utf8
$taskRuntime = Join-Path $taskDestination 'outputs\ktx-selenium-probe\.runtime'
if (Test-Path -LiteralPath $taskRuntime) {
  $taskHistory = Join-Path $taskDestination 'work\session-history'
  New-Item -ItemType Directory -Path $taskHistory -Force | Out-Null
  $taskRuntimeResolved = (Resolve-Path -LiteralPath $taskRuntime).Path
  $taskHistoryTarget = [IO.Path]::GetFullPath((Join-Path $taskHistory 'selenium-runtime-before-move'))
  if ($taskRuntimeResolved -ne "$taskDestination\outputs\ktx-selenium-probe\.runtime" -or -not $taskHistoryTarget.StartsWith("$taskDestination\work\")) { throw 'Runtime move boundary check failed.' }
  Move-Item -LiteralPath $taskRuntimeResolved -Destination $taskHistoryTarget
}
Set-Content -LiteralPath (Join-Path $taskSource 'PROJECT-MOVED.txt') -Value "KTX project moved to: $taskDestination`r`nOpen KTX-Special.code-workspace or Start.cmd in that folder." -Encoding utf8
Move-Item -LiteralPath $PSCommandPath -Destination (Join-Path $taskDestination 'work\migrate-project.ps1')
Write-Output "Moved and SHA256-verified $($taskInventory.Count) files; rebuilt $($taskLinks.Count) dependency junctions."
Write-Output $taskDestination
