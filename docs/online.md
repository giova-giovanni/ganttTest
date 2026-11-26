# Gantt Planner online: più persone insieme sullo stesso archivio

## 1. Problema e obiettivo

Finora Gantt Planner lasciava scrivere una persona alla volta: gli altri restavano in sola lettura e dovevano
chiedere il permesso. Ogni salvataggio riscriveva tutto l'archivio, i livelli di accesso li controllava
solo il browser. L'audit ha trovato anche un errore grave: un file dati
rovinato poteva essere sostituito da un archivio vuoto (corretto). Obiettivo: Gantt Planner su un server
intranet, usato da più dipendenti nello stesso momento, come un foglio condiviso.

## 2. Soluzione scelta e perché

Il server tiene l'archivio in memoria ed è l'unico a scriverlo. Ogni modifica fatta nel browser parte
come piccola operazione su un singolo record (un'attività, una nota, una persona) con la sua revisione:
il server la annota subito in un registro e la manda in tempo reale a tutti gli altri. Abbiamo scartato
SQLite: a questa scala non porta vantaggi, in Node non è ancora stabile e non funziona su cartelle di
rete. La soluzione scelta non richiede programmi in più, lascia `gantt-dati.json` leggibile e
compatibile con import, export e backup, e si può tornare indietro.

## 3. Cosa cambia per gli utenti

- Si apre l'indirizzo di Gantt Planner nel browser e si entra con nome e password personali; niente da installare.
- Le modifiche dei colleghi compaiono subito, senza ricaricare la pagina.
- Si vede chi è collegato, su quale progetto e quale riga sta modificando.
- Se due persone cambiano la stessa cella vince l'ultima; chi è stato sostituito riceve un avviso
  con «Rimetti il mio valore».
- Una nota la scrive una persona alla volta; gli altri la vedono cambiare dal vivo.
- «Annulla» annulla solo le proprie modifiche; il «Registro modifiche» dice chi ha cambiato cosa e quando.

## 4. Cosa serve sul server

Un server Windows sempre acceso con Node.js LTS; Gantt Planner avviato come servizio
(`tools/installa-servizio.ps1`); HTTPS tramite IIS o Caddy con la sola porta 443 aperta; gli account in
`gantt-utenti.json` con password salvate in forma non leggibile (`tools/password.mjs`).
Istruzioni complete: `docs/installazione-server.md`.

## 5. Rischi residui e prossimi passi

- Una cartella dati, un solo server: non adatto a più sedi con server separati.
- Il testo di una stessa nota non si scrive in due contemporaneamente.
- Da fare ancora: prova con molti utenti e con l'antivirus aziendale.
- Prossimi passi: installazione di prova, una settimana con un piccolo gruppo, poi tutti; in seguito
  l'accesso con l'account Windows.

**File modificati**: `server/archive.mjs`, `server/sessions.mjs`, `server/events.mjs`,
`server/security.mjs`, `server/users.mjs`, `server/api.mjs`, `server/store.mjs`, `shared/ops.mjs`,
`src/store.ts`, `src/components/`, `src/i18n.ts`, `README.md`; test in `tests/`.

## Kurzfassung (DE)

1. Gantt Planner läuft auf einem Firmenserver; alle arbeiten gleichzeitig im Browser, ohne Installation.
2. Jede Änderung wird als kleine Operation pro Datensatz protokolliert und sofort an alle verteilt.
3. Bei derselben Zelle gewinnt die letzte Änderung; der ersetzte Wert lässt sich mit einem Klick zurückholen.
4. Anmeldung mit persönlichem Konto, die Zugriffsstufen prüft der Server, Zugriff über HTTPS.
5. Nächste Schritte: Testinstallation, eine Pilotwoche mit einer kleinen Gruppe, dann alle.
