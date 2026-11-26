# Gantt Planner su un server intranet — guida tecnica

Per chi installa e gestisce il server (IT). Per gli utenti non cambia nulla: aprono un indirizzo
nel browser, per esempio `https://gantt.azienda.local`.

## 1. Cosa serve

| | |
|---|---|
| Sistema | Windows Server 2019/2022 (va bene anche un PC sempre acceso) |
| Node.js | versione **LTS** (oggi la 24), installata una volta da nodejs.org o dal software aziendale |
| Disco | la cartella del programma e una cartella dati **sul disco locale del server** |
| Rete | un nome DNS interno (es. `gantt.azienda.local`) e, per HTTPS, un certificato |
| Account | un account di servizio con i permessi minimi (consigliato `NETWORK SERVICE` o un utente di dominio dedicato) |

Gantt Planner non scarica nulla e non si aggiorna da solo. Scrive solo nella cartella dati.

## 2. Installazione (una volta)

1. Copia la cartella del programma sul server, per esempio `D:\Gantt Planner\`.
2. Prompt dei comandi nella cartella: `npm ci` e poi `npm run build`.
   Serve la rete verso il registro npm solo in questo passaggio; in alternativa si copia la
   cartella già compilata da un PC di prova.
3. Crea `gantt-config.json` accanto a `server.mjs`:

```json
{
  "dati": "D:/Gantt-dati",
  "porta": 5180,
  "modo": "locale",
  "proxy": true,
  "nomi": ["gantt.azienda.local"],
  "utenti": "D:/Gantt-dati-riservati/gantt-utenti.json"
}
```

| Chiave | Significato |
|---|---|
| `dati` | cartella dell'archivio, **sul disco locale** del server (non una cartella di rete) |
| `modo` | `locale` = ascolta solo su questo PC (con il proxy HTTPS davanti, consigliato); `rete` = raggiungibile direttamente in HTTP sulla porta |
| `proxy` | `true` se davanti c'è IIS/nginx/Caddy: solo allora si credono le intestazioni `X-Forwarded-*` |
| `nomi` | nomi con cui gli utenti raggiungono il server; senza proxy le richieste con altri nomi vengono rifiutate (protezione contro il «DNS rebinding»). Con il proxy servono a riconoscere le pagine di Gantt Planner quando il proxy riscrive l'intestazione `Host` (IIS) |
| `utenti` | dove sta `gantt-utenti.json` (predefinito: accanto al programma) |

4. Crea gli account in `gantt-utenti.json` (vedi `gantt-utenti.esempio.json`). Per ogni password:
   `node tools\password.mjs "la-password"` e incolla l'hash nel campo `password`.
   Un file con password ancora in chiaro si converte con `node tools\password.mjs --converti <file>`.
5. Permessi (PowerShell da amministratore):

```powershell
icacls "D:\Gantt-dati" /grant "NT AUTHORITY\NETWORK SERVICE:(OI)(CI)M"
icacls "D:\Gantt-dati-riservati" /inheritance:r /grant "Administrators:(OI)(CI)F" "NT AUTHORITY\NETWORK SERVICE:(OI)(CI)R"
```

   Il programma (`D:\Gantt Planner`) basta in sola lettura per l'account di servizio.

## 3. Avvio come servizio

**Utilità di pianificazione (integrata in Windows, consigliata)** — PowerShell da amministratore:

```powershell
.\tools\installa-servizio.ps1
```

Crea l'attività «GanttPlanner»: parte all'avvio del server senza utenti collegati, riparte da sola ogni
minuto se si ferma, gira come `NETWORK SERVICE` e scrive i messaggi in `<dati>\gantt-server.log`.
Con un account di dominio: `-Utente "AZIENDA\svc-gantt" -Password (Read-Host -AsSecureString)`.
Per toglierla: `.\tools\installa-servizio.ps1 -Rimuovi`.

**NSSM (alternativa, programma esterno)**:
`nssm install GanttPlanner "C:\Program Files\nodejs\node.exe" "server.mjs --senza-browser --log"`, poi in
NSSM la cartella di lavoro `D:\Gantt Planner`, l'account di servizio e il riavvio automatico.

Controllo: sul server apri `http://localhost:5180/api/info` (risponde `"ok": true`).

## 4. HTTPS con un proxy inverso

Gantt Planner resta su `localhost:5180` (`"modo": "locale"`, `"proxy": true`) e il proxy pubblica
`https://gantt.azienda.local` con il certificato aziendale.

**IIS** (con i moduli *URL Rewrite* e *Application Request Routing*; in ARR attiva «Enable proxy»):

```xml
<!-- web.config del sito https://gantt.azienda.local -->
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="Gantt Planner" stopProcessing="true">
          <match url="(.*)" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
            <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
          </serverVariables>
          <action type="Rewrite" url="http://localhost:5180/{R:1}" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

`HTTP_X_FORWARDED_PROTO` e `HTTP_X_FORWARDED_HOST` vanno aggiunte alle «variabili server consentite»
di URL Rewrite (ARR aggiunge da solo `X-Forwarded-For`). Per il tempo
reale imposta in ARR `responseBufferLimit="0"`: se il proxy trattiene gli eventi, Gantt Planner se ne accorge
entro un minuto e passa da solo all'aggiornamento ogni 2–3 secondi.

**Caddy** (un solo eseguibile, certificato interno automatico):

```
gantt.azienda.local {
  tls internal
  reverse_proxy localhost:5180 {
    flush_interval -1
  }
}
```

## 5. Firewall

Con il proxy si apre solo la porta 443:

```powershell
New-NetFirewallRule -DisplayName "Gantt Planner HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -Profile Domain
```

La porta 5180 non va aperta: con `"modo": "locale"` Gantt Planner non è raggiungibile dalla rete.
Senza proxy (solo HTTP, sconsigliato): `"modo": "rete"` e una regola sulla porta 5180 limitata alla rete
interna (`-RemoteAddress LocalSubnet`).

## 6. Antivirus

Il programma non ha un eseguibile proprio: gira con Node.js (`node.exe`, firmato dal suo editore)
e gli utenti usano il browser. Non scarica nulla, non si aggiorna da solo e scrive solo nella
cartella dati. Per l'uso su un singolo PC ci sono `avvia.bat` e `avvia-rete.bat`; se un antivirus
blocca gli script `.bat`, basta `npm run build` una volta e poi `node server.mjs`.

## 7. Backup e ripristino

Tutto nella cartella dati (da includere nel backup aziendale):

| File | Cosa contiene |
|---|---|
| `gantt-dati.json` | l'archivio (riscritto entro un secondo da ogni modifica) |
| `registro\AAAA-MM.jsonl` | ogni modifica: chi, quando, cosa (serve anche a non perdere nulla se il server si spegne di colpo) |
| `versioni\` | una copia all'ora, ultime 30 |
| `backups\` | una copia alla settimana, ultime 20 (stesso formato dell'export JSON) |
| `gantt-dati.bak.json` | la versione precedente |
| `gantt-dati.pre-v2.json` | il file com'era prima del passaggio al formato multi-utente (una volta sola) |

Ripristino: in Gantt Planner, *Importa* → trascina un file di `backups\`, `versioni\` o `gantt-dati.bak.json`
→ *Sostituisci tutti i dati* (serve il livello amministratore).

## 8. Aggiornare Gantt Planner

1. Ferma il servizio: `Stop-ScheduledTask GanttPlanner`.
2. Sostituisci i file del programma (mai la cartella dati), poi `npm ci` e `npm run build`.
3. Riavvia: `Start-ScheduledTask GanttPlanner`. Gli utenti rientrano con il proprio nome e la propria password.

## 9. Se qualcosa non va

| Sintomo | Causa probabile |
|---|---|
| Il servizio non parte, nel log `GANTT_ERROR=archivio … illeggibile` | `gantt-dati.json` rovinato e nessuna `.bak` valida: ripristina da `versioni\` o `backups\`. Gantt Planner non riparte mai da un archivio vuoto |
| «Nome del server non riconosciuto» (421) | il nome usato non è in `"nomi"` (oppure manca `"proxy": true` dietro il proxy) |
| Tutti vedono «sola lettura» con un avviso sul server | un secondo Gantt Planner sta usando la stessa cartella dati: usare solo l'indirizzo indicato nell'avviso |
| Avviso «il server non riesce a scrivere il file dei dati» | permessi o disco pieno; le modifiche sono comunque nel registro e vengono riapplicate |
| Aggiornamenti lenti (2–3 s) invece che istantanei | il proxy trattiene gli eventi: vedi `responseBufferLimit` / `flush_interval` sopra |
