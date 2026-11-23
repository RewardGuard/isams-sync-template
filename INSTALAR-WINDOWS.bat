@echo off
rem Doble clic para instalar en Windows.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar\instalar.ps1"
echo.
pause
