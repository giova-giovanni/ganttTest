# Gantt Planner

Piattaforma di prova per un **Gantt sistematico**: progetti ad albero, diagramma di Gantt,
carico di lavoro per persona, ferie e assenze, note, stampa e importazione/esportazione CSV/JSON.

Versione **neutra**: nessun marchio e nessun dato reale. I soli dati presenti sono quelli di
esempio, inventati, in [`src/demo.ts`](src/demo.ts). L'interfaccia è in italiano e in tedesco.

**Online su GitHub Pages, con i dati salvati su GitHub**: nessun server da installare. Il workflow
[`pages.yml`](.github/workflows/pages.yml) compila e pubblica il sito; i dati stanno in un file JSON di
un repository (privato) e ogni salvataggio è un commit. Attivazione e uso: [docs/github.md](docs/github.md).

---

## Avvio

Serve [Node.js](https://nodejs.org) LTS, versione 22 o successiva (per i test la 22.15 o
successiva).

```bash
npm install
npm run dev
```

Si apre il browser su `http://localhost:5180` con ricarica automatica. Le rotte `/api/*` del
server sono attive anche in sviluppo, quindi l'app si comporta come quella compilata.

Come programma vero e proprio (build + server locale, senza dipendenze esterne):

```bash
npm run build
npm start
```

Su Windows basta un doppio clic su **`avvia.bat`** (installa, compila e avvia).
**`avvia-rete.bat`** rende il programma raggiungibile anche dagli altri PC della rete locale.

### Senza server: GitHub Pages

Aperta come sito statico (GitHub Pages, `npm run preview` o qualsiasi hosting di file) l'app
funziona lo stesso: i dati restano **nel browser** (localStorage) e al primo avvio compaiono i dati
di esempio. Con **Salva su GitHub…** i dati passano in un file di un repository GitHub, condiviso da
chi ha accesso al repository: [docs/github.md](docs/github.md).

Attenzione: GitHub Pages deve pubblicare la build (`dist/`), non i sorgenti. Con *Deploy from a
branch* la pagina resta ferma su «Apertura dell'archivio…» (`src/main.tsx` → 404): serve
*Settings → Pages → Source: GitHub Actions*.

### Prova con più utenti, su dati finti

`node tools/avvia-prova.mjs --account` avvia il server sulla porta 5199 con una cartella dati
finta (in `.test-tmp/`) e due account di prova: *Mario Rossi* / `prova-mario` (admin) e
*Anna Bianchi* / `prova-anna` (modifica). Basta aprire l'indirizzo in due browser diversi (o in una
finestra anonima) ed entrare con i due account.

## Dove finiscono i dati

| Modalità | Dove | Nel repository? |
|---|---|---|
| Con il server (`npm start`) | cartella `dati/` accanto al programma: `gantt-dati.json` (riscritto entro un secondo da ogni modifica), `registro/` (ogni modifica: chi, quando, cosa), copia `gantt-dati.bak.json`, `versioni/` (una copia all'ora, ultime 30), `backups/` (backup settimanale fatto dal server, ultimi 20) | **No**, esclusa da `.gitignore` |
| In sviluppo (`npm run dev`) | `.test-tmp/dati-sviluppo/`, mai la cartella `dati/` (si cambia con `GANTT_DATI`) | No |
| Senza server | `localStorage` del browser | No |
| Su GitHub (*Salva su GitHub…*) | file `gantt-dati.json` nel repository scelto (consigliato privato), un commit per salvataggio; copia di lavoro nel `localStorage`; il token resta solo nel browser | Sì, **nel repository dei dati** |
| Esportazioni (`GANTT_*.json`, `GANTT_*.csv`) | cartella dei download | No, escluse da `.gitignore` |

I dati di esempio si spostano da soli sulla **settimana corrente**: il Gantt di prova mostra
sempre attività concluse, in corso e future. Si ricaricano dal pulsante *Carica dati di esempio*
quando l'archivio è vuoto (*Svuota tutto*).

## Test

```bash
npm test                          # tutti i test senza browser: Vitest + node:test
npx playwright install chromium   # solo la prima volta
npm run test:e2e                  # build + test nel browser (Playwright)
```

Per usare un browser già installato invece di scaricare Chromium: variabile d'ambiente
`PW_CHANNEL=msedge` (oppure `chrome`) prima di `npm run test:e2e`.

| Suite | Cosa verifica |
|---|---|
| `tests/unit/tree.test.ts` | calcolo dei rami: inizio minimo, fine massima, somma ore, stato aggregato, avanzamento, sforamento, riparazione di dati corrotti |
| `tests/unit/load.test.ts` | distribuzione delle ore sui giorni lavorativi, assenze, conflitti, attività annullate e progetti esclusi |
| `tests/unit/dates.test.ts` | giorni lavorativi, settimane ISO, date scritte a mano |
| `tests/unit/import-export.test.ts` | CSV in stile Excel IT/DE, esportazione → reimportazione, backup JSON, colonne in tedesco |
| `tests/unit/data.test.ts` | coerenza dei dati di esempio e normalizzazione di dati sporchi |
| `tests/e2e/browser.spec.ts` | modalità solo-browser: nuovo progetto, barre del Gantt, trascinamento e ridimensionamento, annulla/ripristina, persistenza, carico di lavoro, backup JSON, lingua e tema |
| `tests/e2e/server.spec.ts` | modalità server: due utenti modificano insieme, le modifiche arrivano subito all'altro, chi è connesso, dati riletti dal file |
| `tests/unit/github.test.ts` | archivio su GitHub: lettura/scrittura con sha ed ETag, errori (token, permessi, limiti, rete), unione a tre vie delle modifiche, messaggi dei commit, testo UTF-8 |
| `tests/e2e/github.spec.ts` | archivio su GitHub (API simulate): collegamento, due persone sullo stesso file con conflitto risolto, «annulla» solo delle proprie modifiche, senza rete, repository pubblico, token sbagliato |
| `tests/server-archive.test.mjs` | archivio del server: mai un archivio vuoto al posto di uno rovinato, scrittura sicura, registro e ripresa dopo uno spegnimento brusco, migrazione, cascate, sola lettura se la cartella è già in uso |
| `tests/server-api.test.mjs`, `tests/server-users.test.mjs` | rotte `/api/*`, sessioni con scadenza, account e hash delle password, blocco dopo troppi tentativi, livelli controllati dal server |
| `tests/server-security.test.mjs`, `tests/server-static.test.mjs` | intestazioni di sicurezza, nome del server (DNS rebinding), origine delle scritture, proxy, nessuna uscita dalla cartella dell'interfaccia |
| `tests/shared-ops.test.mjs`, `tests/store-collab.test.mjs`, `tests/store-merge.test.mjs` | operazioni per record uguali nel browser e nel server; due utenti insieme: sovrascritture, record eliminati, annulla; unione di dati importati |
| `tests/csv.test.mjs`, `tests/import.test.mjs`, `tests/export.test.mjs`, `tests/backup.test.mjs`, `tests/rules.test.mjs` | separatori e virgolette dei CSV, importazione di file della cartella dati e di gerarchie, perimetro dell'export, backup sul server, regole di calcolo |
| `tests/personalizzazione.test.mjs` | colori del sito (leggibilità delle combinazioni pronte), colori dei progetti, profili e indirizzi delle foto, preferenze di ingrandimento |

I test end-to-end avviano da soli un server statico e il server vero su una cartella dati
temporanea; i test node:test usano cartelle temporanee: nessun test tocca `dati/`.

---

## Guida rapida

### Le cinque schermate

| | |
|---|---|
| **Home** | Riepilogo, calendario delle scadenze e la stessa tabella + Gantt della schermata Progetto con tutti i progetti non archiviati. **⚙ Personalizza** sceglie i riquadri |
| **Progetto** | Tabella delle attività e Gantt di un solo progetto. Le colonne si allargano trascinando il bordo dell'intestazione (doppio clic = adatta al contenuto) |
| **Carico di lavoro** | Chi è pieno e quando; un clic su un nome apre il suo Gantt personale. Filtro e raggruppamento per ruolo |
| **Responsabili** | Persone, ruolo, ore/giorno; da qui si aprono ferie e assenze |
| **Note** | Archivio di tutte le note con filtri per progetto, autore, etichetta e data; stampa ed esportazione CSV |

### Come si lavora

1. **+ Nuovo progetto** dalla barra a sinistra.
2. Nella tabella scrivi le attività: `Invio` per modificare, `Ctrl+Invio` nuova riga,
   `Ctrl+Maiusc+Invio` sotto-attività, `Alt+←/→` per cambiare livello.
3. Metti **date e ore solo sulle attività finali**: rami e progetto si calcolano da soli.
4. Nel Gantt trascina la barra per spostarla, i bordi per cambiare inizio e fine.
5. Assegna un **responsabile** e guarda *Carico di lavoro*.
6. Progetto finito → **Archivia**: sparisce dalla home e non pesa più sul carico.

### Le regole di calcolo

- Un'attività con figli non si modifica: inizio = data minima, fine = data massima, ore = somma.
- Le ore si spalmano sui **giorni lavorativi** (lun–ven) dell'attività, saltando le assenze del responsabile.
- **100 %** = giornata piena (ore/giorno del responsabile, di norma 8 h).
- Attività **annullate** e progetti **archiviati** restano fuori da date, ore e carico.

### Profili dei responsabili

In **Responsabili** il pulsante **Profilo** (o un clic sul tondo) apre foto, ruolo, e-mail,
telefono, presentazione, ore al giorno, colore e attività assegnate.

- La foto è un **indirizzo web** (`https://…` o `http://…`) che porta direttamente a un'immagine:
  tasto destro sull'immagine → *Copia indirizzo immagine*. Se non si carica restano le **iniziali**.
- La foto non viene copiata nel programma: il sito che la ospita riceve una richiesta da ogni PC
  che la mostra.
- E-mail, telefono e foto li vede chiunque usi lo stesso archivio ed entrano nel CSV Responsabili.
  Con *Salva su GitHub…* finiscono nel file dati: usare un repository **privato**.

### Colori, ingrandimento e pagina iniziale

| Cosa | Dove | Per chi vale |
|---|---|---|
| **Colori del sito** (combinazioni pronte o a mano, chiaro e scuro, colori degli stati) | ⚙ *Impostazioni* → **Colori** | solo per te, in quel browser |
| **Colore di un progetto** | il quadratino accanto al progetto nella barra a sinistra, o **Colore** nella pagina Progetto | per tutti |
| **Ingrandire** testo e dettagli di ogni pagina, righe e giorni del Gantt, menù | **Zoom** nella barra in alto | solo per te, in quel browser |
| **Riquadri della Home** e loro grandezza | **⚙ Personalizza** (pannello a destra, con anteprima immediata) | solo per te, in quel browser |

### Importa / Esporta (⇅)

- **Esporta**: backup JSON completo, attività (CSV), carico di lavoro (CSV, ore o %), responsabili, assenze.
  I CSV sono pronti per Excel italiano/tedesco (separatore `;`, virgola decimale).
- **Importa**: trascina un file `.csv` o `.json`; prima compare l'anteprima (colonne riconosciute,
  avvisi), poi si sceglie *Aggiungi ai dati esistenti* o *Sostituisci tutti i dati*.
  Colonne in italiano, tedesco o inglese; date `15/03/2026`, `15.03.2026`, `2026-03-15` o numero seriale di Excel.
  *Scarica modello CSV* fornisce un file di partenza.

### Stampa (⎙ oppure `Ctrl+P`)

Copertina con riepilogo, Gantt generale, una pagina per progetto, tabella attività, carico,
responsabili e assenze. A4 o A3, orizzontale o verticale; nel browser scegli «Salva come PDF».

### Più persone sullo stesso archivio

Con il server tutti lavorano **insieme**, come in un foglio condiviso:

| Situazione | Cosa succede |
|---|---|
| Apertura | Si entra con il proprio nome (e la password, se ci sono gli account) |
| Un collega modifica | La modifica compare subito, senza ricaricare la pagina |
| Chi c'è | In alto **Connessi** con le iniziali; nella barra a sinistra chi lavora su ogni progetto; la riga in modifica ha un bordo colorato |
| Campi diversi della stessa attività | Restano entrambe le modifiche |
| Stessa cella | Vince l'ultima; chi è stato sostituito vede un avviso con **Rimetti il mio valore** |
| Una nota | La scrive una persona alla volta; gli altri la vedono cambiare dal vivo |
| Rete assente per poco | Si continua a lavorare: le modifiche restano in attesa e partono da sole |
| Annulla (`Ctrl+Z`) | Annulla solo le **proprie** modifiche, mai quelle dei colleghi |
| Rami aperti/chiusi | Scelta personale: per gli altri non cambia nulla |

**Registro modifiche** mostra chi ha cambiato cosa e quando, con il valore prima e dopo. Il server
è l'unico a scrivere il file: annota ogni modifica nel registro prima di confermarla (nulla si
perde se si spegne di colpo) e riscrive `gantt-dati.json` entro un secondo. Una cartella dati la
usa **un solo** server: un secondo avviato sulla stessa cartella parte in sola lettura e indica
l'indirizzo giusto.

Installazione su un server aziendale (servizio Windows, HTTPS con proxy, firewall, backup):
[docs/installazione-server.md](docs/installazione-server.md). Riepilogo in due minuti:
[docs/online.md](docs/online.md); scelte tecniche: [docs/ADR-001-multiutente.md](docs/ADR-001-multiutente.md);
prima del rilascio: [docs/checklist-rilascio.md](docs/checklist-rilascio.md).

### Scorciatoie

`F2`/`Invio` modifica · frecce naviga · `Tab` campo successivo · `Ctrl+Invio` nuova riga ·
`Ctrl+Maiusc+Invio` sotto-attività · `Alt+←/→` livello · `Canc` svuota la cella ·
`Ctrl+Z`/`Ctrl+Y` annulla/ripristina · `Ctrl+P` stampa

---

## Configurazione (facoltativa)

Tutto funziona senza configurazione. Per cambiare i valori predefiniti:

| Cosa | Riga di comando | Variabile d'ambiente | File `gantt-config.json` |
|---|---|---|---|
| Cartella dati | `--dati <cartella>` | `GANTT_DATI` | `"dati"` |
| Porta (predefinita 5180) | `--porta <n>` | `GANTT_PORTA` | `"porta"` |
| Modalità `locale` / `rete` | `--modo rete` | `GANTT_MODO` | `"modo"` |
| Dietro un proxy HTTPS (IIS, Caddy) | `--proxy` | `GANTT_PROXY` | `"proxy": true` |
| Altri nomi del server (es. `gantt.azienda.local`) | `--nomi a,b` | `GANTT_NOMI` | `"nomi"` |
| File degli utenti | `--utenti <file>` | `GANTT_UTENTI` | `"utenti"` |

Il file si crea copiando [`gantt-config.esempio.json`](gantt-config.esempio.json).

**Accesso** — senza `gantt-utenti.json` ognuno entra con il proprio nome ed è amministratore.
Copiando [`gantt-utenti.esempio.json`](gantt-utenti.esempio.json) in `gantt-utenti.json` si attivano
gli **account personali**: nome, livello (*lettura*, *modifica*, *admin*) e password salvata come
hash scrypt (`node tools/password.mjs "password"` stampa il testo da incollare; `--converti`
trasforma le password in chiaro di un file esistente, dopo averne fatto una copia). Con
`"ospiti": true` chi non ha un account entra in sola lettura. In alternativa restano le password
di livello delle versioni precedenti. I livelli li controlla il **server**; la sessione dura una
giornata di lavoro (`sessioneOre`, 10) e scade dopo 2 ore senza attività (`inattivitaMinuti`).
`gantt-config.json` e `gantt-utenti.json` sono esclusi da git.

## Struttura del codice

```
src/
  types.ts           modello dati e stati
  store.ts           stato globale, annulla/ripristina, coda dei salvataggi, modifiche altrui, migrazione
  i18n.ts            testi IT/DE
  theme.ts           colori del sito: predefiniti (come in styles.css), combinazioni pronte, contrasto
  demo.ts            dati di esempio (inventati)
  utils/dates.ts     date, giorni lavorativi, settimane ISO
  utils/tree.ts      calcolo dei rami (date, ore, avanzamento) e riparazione dei dati
  utils/load.ts      distribuzione delle ore e calcolo del carico
  utils/csv.ts       lettura/scrittura CSV in stile Excel IT/DE
  utils/io.ts        esportazione e importazione con anteprima
  utils/backup.ts    backup settimanale automatico
  utils/api.ts       dialogo con il server
  utils/github.ts    archivio su GitHub: lettura e scrittura del file con le API REST, token nel browser
  utils/merge.ts     unione a tre vie delle modifiche (archivio su GitHub) e messaggi dei commit
  utils/fields.ts    nomi e valori dei campi per avvisi e registro
  components/        Board (tabella + Gantt), TreeGrid, Gantt, dialoghi (anche GitHub), stampa, barra di stato, registro
  pages/             Home, Progetto, Carico, Responsabili, Note
shared/ops.mjs       operazioni sui dati: lo stesso codice nel browser e nel server
server.mjs           server HTTP senza dipendenze (interfaccia + archivio)
server/config.mjs    cartella dati, porta, modalità, proxy, nomi, file degli utenti
server/archive.mjs   archivio in memoria: operazioni per record, revisioni, registro, un solo server per cartella
server/store.mjs     file su disco: lettura, scrittura sicura, copie e backup
server/sessions.mjs  sessioni con scadenza (cookie HttpOnly)
server/users.mjs     account, livelli di accesso, hash delle password, blocco dei tentativi
server/events.mjs    aggiornamenti in tempo reale (SSE) e presenze
server/security.mjs  intestazioni di sicurezza e controllo del nome del server
server/static.mjs    file dell'interfaccia, senza uscire dalla cartella dist
server/api.mjs       rotte /api/*
tools/               prova con dati finti, password, servizio Windows, verifica dell'archivio
docs/                GitHub Pages e dati su GitHub, installazione sul server, scelte tecniche, checklist di rilascio
.github/workflows/   pages.yml: build e pubblicazione su GitHub Pages
tests/unit/          test Vitest
tests/*.test.mjs     test node:test (server, accesso, sicurezza, più utenti, import/export)
tests/e2e/           test Playwright (fake-github.ts: GitHub simulato in memoria)
```
