# Checklist di rilascio · Gantt Planner 3.0 (più utenti insieme)

**Data:** ______ · **Chi installa:** ______ · **Server:** ______

## Prima

- [ ] `npm test` tutto verde (90 test) e `npm run build` senza errori sulla versione da installare
- [ ] Copia completa della cartella dati attuale fuori dal server (anche `gantt-utenti.json` e `gantt-config.json`)
- [ ] **Prova della migrazione su una copia dei dati veri** (PC di prova, mai sul server in uso):
      `node tools\verifica-archivio.mjs <copia>\gantt-dati.json` → avvia Gantt Planner sulla copia → apri e chiudi →
      `node tools\verifica-archivio.mjs <copia>\gantt-dati.json` di nuovo: progetti, attività, responsabili,
      assenze, note e ore totali devono essere **identici**; deve esistere `gantt-dati.pre-v2.json`
- [ ] Account creati in `gantt-utenti.json` con password in hash (`node tools\password.mjs`), almeno due admin
- [ ] Certificato HTTPS e nome DNS (`gantt.azienda.local`) pronti; proxy IIS o Caddy configurato (vedi `installazione-server.md`)
- [ ] Utenti avvisati: giorno del passaggio, indirizzo nuovo, chi chiamare
- [ ] Piano di ritorno letto (sotto)

## Passaggio

- [ ] Tutti chiudono Gantt Planner (la versione precedente non va più avviata sulla cartella condivisa)
- [ ] Cartella dati sul **disco locale** del server; permessi impostati (`icacls`, vedi guida)
- [ ] `gantt-config.json` con `"modo": "locale"`, `"proxy": true`, `"nomi"`, `"utenti"`
- [ ] `.\tools\installa-servizio.ps1` → attività «GanttPlanner» in esecuzione
- [ ] Sul server: `http://localhost:5180/api/info` risponde `"ok": true`; nessun `GANTT_ERROR` in `gantt-server.log`

## Prove subito dopo (15 minuti)

- [ ] Da un PC: `https://gantt.azienda.local` → accesso con un account admin
- [ ] Da un secondo PC, con un altro account: si vede «Connessi» con l'altro utente
- [ ] Modifica di una cella da un PC → compare sull'altro entro un secondo (se ci mette 2–3 s: controllare il buffer del proxy)
- [ ] Stessa cella da entrambi → avviso «Rimetti il mio valore»
- [ ] «Registro modifiche» mostra le prove; nella cartella dati c'è `registro\AAAA-MM.jsonl`
- [ ] Un account «lettura» non riesce a modificare
- [ ] Riavvio del servizio (`Restart-ScheduledTask` o riavvio del server) → dati uguali, utenti rientrano
- [ ] Dopo un'ora: nuova copia in `versioni\`; dopo un minuto dal primo avvio: backup in `backups\`

## Quando tornare indietro

- conteggi diversi tra prima e dopo la migrazione;
- avviso «il server non riesce a scrivere il file dei dati» che non sparisce;
- accessi impossibili per più utenti, o errori 500 ripetuti in `gantt-server.log`;
- modifiche che non arrivano agli altri nemmeno dopo 5 secondi.

## Piano di ritorno

1. Fermare il servizio (`Stop-ScheduledTask GanttPlanner`): alla chiusura `gantt-dati.json` viene riscritto con tutte le modifiche.
2. Rimettere la versione precedente del programma (copia fatta prima, o commit `f70539c` del repository).
3. La versione precedente **legge ancora** `gantt-dati.json` (ignora le revisioni aggiunte): le modifiche fatte
   nel frattempo restano. Se servisse il file esattamente com'era: `gantt-dati.pre-v2.json`.
4. Avvisare gli utenti di tornare al modo precedente.

## Dopo

- [ ] Una settimana con un piccolo gruppo prima di aprire a tutti
- [ ] Includere la cartella dati nel backup aziendale
- [ ] Annotare le decisioni ancora aperte (vedi riepilogo del lavoro)
