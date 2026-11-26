@echo off
title Gantt Planner
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non trovato. Installalo da https://nodejs.org e riprova.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Prima installazione delle dipendenze...
  call npm install || goto :error
)

if not exist dist\index.html (
  echo Compilazione dell'applicazione...
  call npm run build || goto :error
)

node server.mjs
goto :eof

:error
echo.
echo Errore durante la preparazione. Controlla i messaggi qui sopra.
pause
