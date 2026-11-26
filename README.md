# Gantt Planner

Piattaforma di prova per un **Gantt sistematico**: progetti ad albero, diagramma di Gantt,
carico di lavoro per persona, ferie e assenze, note, stampa e importazione/esportazione CSV/JSON.

Versione **neutra**: nessun marchio e nessun dato reale. I soli dati presenti sono quelli di
esempio, inventati, in [`src/demo.ts`](src/demo.ts). L'interfaccia è in italiano e in tedesco.

---

## Avvio

Serve [Node.js](https://nodejs.org) LTS, versione 22 o successiva (il programma da solo gira
anche con la 20; i test unitari richiedono la 22).

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

### Senza server

Aperta come sito statico (`npm run preview` o qualsiasi hosting di file) l'app funziona lo
stesso: i dati restano **nel browser** (localStorage) e al primo avvio compaiono i dati di esempio.

## Dove finiscono i dati

| Modalità | Dove | Nel repository? |
|---|---|---|
| Con il server (`npm start`, `npm run dev`) | cartella `dati/` accanto al programma: `gantt-dati.json`, copia `gantt-dati.bak.json`, `versioni/` (una copia all'ora, ultime 30), `backups/` (backup settimanale, ultimi 20) | **No**, esclusa da `.gitignore` |
| Senza server | `localStorage` del browser | No |
| Esportazioni (`GANTT_*.json`, `GANTT_*.csv`) | cartella dei download | No, escluse da `.gitignore` |

I dati di esempio si spostano da soli sulla **settimana corrente**: il Gantt di prova mostra
sempre attività concluse, in corso e future. Si ricaricano dal pulsante *Carica dati di esempio*
quando l'archivio è vuoto (*Svuota tutto*).

## Test

```bash
npm test                          # test unitari (Vitest)
npx playwright install chromium   # solo la prima volta
npm run test:e2e                  # build + test nel browser (Playwright)
```

| Suite | Cosa verifica |
|---|---|
| `tests/unit/tree.test.ts` | calcolo dei rami: inizio minimo, fine massima, somma ore, stato aggregato, avanzamento, sforamento, riparazione di dati corrotti |
| `tests/unit/load.test.ts` | distribuzione delle ore sui giorni lavorativi, assenze, conflitti, attività annullate e progetti esclusi |
| `tests/unit/dates.test.ts` | giorni lavorativi, settimane ISO, date scritte a mano |
| `tests/unit/import-export.test.ts` | CSV in stile Excel IT/DE, esportazione → reimportazione, backup JSON, colonne in tedesco |
| `tests/unit/data.test.ts` | coerenza dei dati di esempio e normalizzazione di dati sporchi |
| `tests/e2e/browser.spec.ts` | modalità solo-browser: nuovo progetto, barre del Gantt, trascinamento e ridimensionamento, annulla/ripristina, persistenza, carico di lavoro, backup JSON, lingua e tema |
| `tests/e2e/server.spec.ts` | modalità server: salvataggio su file, blocco di scrittura, secondo utente in sola lettura con aggiornamento automatico, passaggio della modifica |

I test end-to-end avviano da soli un server statico e il server vero su una cartella dati
temporanea: non toccano mai `dati/`.

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

Con il server i dati stanno in un file: chi apre per primo lavora in **Modifica**, gli altri
vedono «Archivio già in uso» e possono aprire in **sola lettura** (si aggiornano da soli
quando l'altro salva) oppure **chiedere di modificare**. *Lascia la modifica* libera il posto;
un blocco senza segnali di vita per oltre un minuto si può riprendere con *Prendi il controllo*.
Ogni salvataggio scrive prima un file temporaneo e poi lo rinomina, quindi una caduta a metà
non rovina l'archivio.

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

Il file si crea copiando [`gantt-config.esempio.json`](gantt-config.esempio.json).

**Livelli di accesso** — senza file tutti sono amministratori. Copiando
[`gantt-utenti.esempio.json`](gantt-utenti.esempio.json) in `gantt-utenti.json` si attivano tre
livelli (*lettura*, *modifica*, *admin*) con password e un elenco di PC che ottengono il livello
da soli. È una protezione contro gli errori, non una cassaforte. `gantt-config.json` e
`gantt-utenti.json` sono esclusi da git.

## Struttura del codice

```
src/
  types.ts           modello dati e stati
  store.ts           stato globale, annulla/ripristina, salvataggio, migrazione
  i18n.ts            testi IT/DE
  demo.ts            dati di esempio (inventati)
  utils/dates.ts     date, giorni lavorativi, settimane ISO
  utils/tree.ts      calcolo dei rami (date, ore, avanzamento) e riparazione dei dati
  utils/load.ts      distribuzione delle ore e calcolo del carico
  utils/csv.ts       lettura/scrittura CSV in stile Excel IT/DE
  utils/io.ts        esportazione e importazione con anteprima
  utils/backup.ts    backup settimanale automatico
  components/        Board (tabella + Gantt), TreeGrid, Gantt, dialoghi, stampa
  pages/             Home, Progetto, Carico, Responsabili, Note
server.mjs           server HTTP senza dipendenze (interfaccia + archivio)
server/config.mjs    cartella dati, porta, modalità
server/store.mjs     archivio su file e blocco di scrittura
server/users.mjs     livelli di accesso
server/api.mjs       rotte /api/*
tests/unit/          test Vitest
tests/e2e/           test Playwright
```
