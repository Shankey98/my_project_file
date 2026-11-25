@echo off
setlocal
where node.exe >nul 2>nul
if errorlevel 1 goto bundled
node.exe %*
exit /b %errorlevel%
:bundled
set "KTX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%KTX_NODE%" (
  echo Node.js 22 or later is required.
  exit /b 1
)
"%KTX_NODE%" %*
exit /b %errorlevel%
