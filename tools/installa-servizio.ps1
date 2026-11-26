<#
.SYNOPSIS
  Installa (o rimuove) Gantt Planner come attività pianificata che parte all'avvio del server Windows,
  senza nessun utente collegato, e riparte da sola se si ferma.
  Installiert (oder entfernt) Gantt Planner als geplante Aufgabe beim Systemstart.

.DESCRIPTION
  Non scarica nulla e non modifica il programma: registra solo l'attività «GanttPlanner».
  Il server legge le impostazioni da gantt-config.json nella cartella del programma
  (modo, porta, cartella dati, proxy, nomi, file utenti) e scrive solo nella cartella dati,
  compreso il registro di avvio dati\gantt-server.log.

  Da eseguire in PowerShell come amministratore, sul PC server:
    .\tools\installa-servizio.ps1
    .\tools\installa-servizio.ps1 -Utente "AZIENDA\svc-gantt" -Password (Read-Host -AsSecureString)
    .\tools\installa-servizio.ps1 -Rimuovi

.PARAMETER Cartella
  Cartella del programma (quella con server.mjs). Predefinita: la cartella sopra a tools.
.PARAMETER Utente
  Account con cui gira il server. Predefinito: NT AUTHORITY\NETWORK SERVICE (privilegi minimi);
  deve poter scrivere nella cartella dati e leggere gantt-utenti.json.
.PARAMETER Password
  Solo per un account di dominio o locale normale (non serve per NETWORK SERVICE).
.PARAMETER Node
  Percorso di node.exe. Predefinito: quello trovato nel PATH.
.PARAMETER Rimuovi
  Ferma e rimuove l'attività.
#>
[CmdletBinding()]
param(
  [string]$Cartella = (Split-Path -Parent $PSScriptRoot),
  [string]$Utente = 'NT AUTHORITY\NETWORK SERVICE',
  [SecureString]$Password,
  [string]$Node = '',
  [switch]$Rimuovi
)

$ErrorActionPreference = 'Stop'
$nome = 'GanttPlanner'

if ($Rimuovi) {
  if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $nome -Confirm:$false
    Write-Host "Attività «$nome» rimossa."
  } else {
    Write-Host "Nessuna attività «$nome» da rimuovere."
  }
  return
}

$server = Join-Path $Cartella 'server.mjs'
if (-not (Test-Path $server)) { throw "server.mjs non trovato in $Cartella" }
if (-not (Test-Path (Join-Path $Cartella 'dist\index.html'))) { throw "Interfaccia non compilata: esegui prima npm run build" }
if (-not $Node) { $Node = (Get-Command node -ErrorAction Stop).Source }

$azione = New-ScheduledTaskAction -Execute $Node -Argument '"server.mjs" --senza-browser --log' -WorkingDirectory $Cartella
$avvio = New-ScheduledTaskTrigger -AtStartup
$regole = New-ScheduledTaskSettingsSet `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew

if ($Utente -match '^NT AUTHORITY\\(NETWORK SERVICE|LOCAL SERVICE|SYSTEM)$') {
  $chi = New-ScheduledTaskPrincipal -UserId $Utente -LogonType ServiceAccount -RunLevel Limited
  Register-ScheduledTask -TaskName $nome -Action $azione -Trigger $avvio -Settings $regole -Principal $chi `
    -Description 'Gantt Planner - gestione progetti (server intranet)' -Force | Out-Null
} else {
  if (-not $Password) { throw "Per l'account $Utente serve -Password" }
  $chiaro = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password))
  Register-ScheduledTask -TaskName $nome -Action $azione -Trigger $avvio -Settings $regole `
    -User $Utente -Password $chiaro -RunLevel Limited `
    -Description 'Gantt Planner - gestione progetti (server intranet)' -Force | Out-Null
}

Start-ScheduledTask -TaskName $nome
Write-Host "Attività «$nome» installata e avviata con l'account $Utente."
Write-Host "Controllo: apri http://localhost:<porta>/api/info sul server; messaggi in <cartella dati>\gantt-server.log"
