@echo off
call "%~dp0RunNode.cmd" --test "%~dp0outputs\ktx-special\test\app.test.mjs" "%~dp0outputs\ktx-special\test\chrome-bridge.test.mjs" "%~dp0outputs\ktx-special\test\push.test.mjs"
if errorlevel 1 pause
