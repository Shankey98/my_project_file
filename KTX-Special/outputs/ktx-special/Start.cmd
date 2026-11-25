@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0StartApp.ps1"
if errorlevel 1 pause
