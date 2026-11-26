@echo off
REM ---------------------------------------------------------------------------
REM  Avvia Gantt Planner in modo che anche gli altri PC della rete possano
REM  collegarsi con il browser, senza installare nulla sui loro computer.
REM
REM  L'indirizzo da usare sugli altri PC viene stampato qui sotto
REM  (righe "Gli altri PC possono collegarsi a:").
REM  Lasciare aperta questa finestra: chiuderla spegne il programma.
REM ---------------------------------------------------------------------------
title Gantt Planner - rete
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

node server.mjs --modo rete
goto :eof

:error
echo.
echo Errore durante la preparazione. Controlla i messaggi qui sopra.
pause
