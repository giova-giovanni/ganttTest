# ADR-001 · Gantt Planner multi-utente su server intranet

**Stato:** accettato il 26/11/2026 — opzione A in versione «collaborativa» (vedi Decisione)
**Data:** 26/11/2026
**Decide:** responsabile del progetto Gantt Planner

## Decisione (26/11/2026)

- **Opzione A, lavoro in contemporanea «stile Google Fogli»**: ogni modifica arriva a tutti in
  tempo reale; nessun blocco dell'archivio e nessun rifiuto. Se due persone cambiano lo stesso
  campo nello stesso momento vince l'ultima, e chi è stato sovrascritto riceve un avviso con
  «Rimetti il mio valore». Le revisioni per record restano: servono alla sincronizzazione, al
  registro e a riconoscere queste sovrascritture.
- **Note**: una nota la scrive una persona alla volta («Mario sta scrivendo…»), gli altri la
  vedono cambiare dal vivo; tutte le altre note e attività restano libere.
- **Formato dati**: migrazione additiva confermata (`meta` nella busta, `registro/`, `gantt-server.json`).
- **Accesso**: account personali in `gantt-utenti.json` (nome, livello, password in hash scrypt);
  senza elenco utenti resta il funzionamento attuale (nome libero + password di livello).

## Contesto

Oggi un solo utente alla volta può scrivere (`gantt-blocco.json`); gli altri restano in sola lettura,
il browser salva **l'intero archivio** a ogni modifica e i livelli di accesso sono controllati solo
nel browser. L'obiettivo è un uso «come Excel condiviso»: più persone che modificano insieme lo
stesso archivio da un server intranet.

Vincoli: Node.js LTS senza dipendenze nuove, poche decine di utenti, archivio piccolo (oggi 8 KB,
prevedibilmente sotto i 10 MB), import/export JSON e CSV invariati, backup settimanale, copie
orarie, `gantt-utenti.json` e i tre livelli lettura/modifica/admin da conservare.

## Opzioni

### A · Un file JSON, stato in memoria, modifiche per record ★ consigliata

```
browser ──(1) operazioni: «record X, revisione 7, campo ore: 16 → 20»──▶ server
browser ◀─(2) conferma (rev 8) oppure conflitto con la versione attuale──  │  dati in memoria
browser ◀─(3) eventi in tempo reale (SSE): modifiche altrui, presenze────  │  coda: una scrittura alla volta
                                                                           ▼
                        dati/gantt-dati.json  (+ .bak, versioni/ ogni ora, backups/ ogni settimana)
                        dati/registro/AAAA-MM.jsonl  (chi, quando, cosa)
```

| | |
|---|---|
| Complessità | media |
| Dipendenze | nessuna |
| Formato | `data` identico; nella busta si aggiunge `meta` (revisione per record) |
| Reversibile | sì: la versione attuale legge ancora il file (ignora `meta`) |
| Limite | un solo processo server per cartella dati (va bene per l'intranet) |

**Pro:** nessun pacchetto nuovo; file leggibile e uguale per backup, versioni e import; salvataggi
piccoli e immediati; conflitti per record; il server diventa l'unico scrittore.
**Contro:** l'intero archivio sta in memoria (ok fino a decine di MB); il file su disco viene
riscritto a ogni gruppo di modifiche (coalescenza: pochi ms per file di questa taglia).

### B · SQLite in modalità WAL (`node:sqlite`)

| | |
|---|---|
| Complessità | alta |
| Dipendenze | nessuna con `node:sqlite` (Node 24.15: «release candidate», non ancora stabile); altrimenti `better-sqlite3`, modulo nativo da scaricare |
| Formato | database binario; JSON solo tramite export |
| Reversibile | no (serve un export per tornare indietro) |
| Limite | il database deve stare sul disco locale del server: WAL **non funziona su cartelle di rete** |

**Pro:** transazioni vere per record, interrogazioni comode sul registro, crescita senza limiti pratici.
**Contro:** più codice e migrazione a senso unico; backup e copie orarie da rifare con l'API di
backup di SQLite; file non leggibile a mano; API di Node non ancora dichiarata stabile.

### C · Blocco per singolo progetto (pessimistico)

**Pro:** semplice, nessun conflitto. **Contro:** chi arriva secondo aspetta; non è il controllo
ottimistico richiesto. Scartata salvo diversa indicazione.

## Scelte di dettaglio proposte (valide per A)

- **Conflitti:** revisione per record; il salvataggio su revisione vecchia viene rifiutato
  **solo se un altro ha cambiato gli stessi campi** (le date di Mario e il responsabile di Anna
  sulla stessa attività passano entrambi). Il browser mostra cosa è cambiato, chi e quando, e chiede
  di ricaricare il record.
- **Identità e sessioni:** all'accesso ognuno scrive il proprio nome (precompilato), i livelli si
  sbloccano con le password di `gantt-utenti.json`; il server rilascia un cookie di sessione
  (HttpOnly, SameSite=Strict) che scade dopo 2 h di inattività o 10 h in tutto; ogni operazione
  è controllata **sul server** in base al livello.
- **Presenza:** canale SSE `/api/eventi` (con ripiego a interrogazione periodica se un proxy lo
  blocca): chi è dentro e su quale progetto, chi sta modificando.
- **Registro:** una riga JSON per operazione in `dati/registro/AAAA-MM.jsonl` (utente, ora,
  record, campi prima → dopo); consultabile da una finestra dell'interfaccia.
- **Backup:** settimanale fatto dal server (non più dal browser), copie orarie in `versioni/`,
  `.bak`, e copia `gantt-dati.pre-v2.json` prima della prima scrittura nel formato nuovo.
- **Un solo server per cartella:** `dati/gantt-server.json` impedisce che un secondo server avviato
  sulla stessa cartella condivisa scriva in parallelo (si apre in sola lettura e indica l'indirizzo giusto).
- **Rami aperti/chiusi:** diventano una preferenza personale del browser (oggi sono nei dati
  condivisi: chi è in sola lettura non può aprire un ramo, e chi chiude un ramo lo chiude a tutti).
- **Annulla/ripristina:** annulla solo le proprie modifiche; quelle arrivate dagli altri vengono
  riportate anche nella cronologia, così un «annulla» non cancella il lavoro altrui.

## Conseguenze

- Più facile: lavorare in tanti, sapere chi ha cambiato cosa, controllare i livelli sul server.
- Più difficile: avviare il programma su ogni PC con la cartella dati in rete non è più il modo di condividere
  (un solo server; gli altri usano il browser).
- Da rivedere: se l'archivio superasse ~50 MB o servissero più server, passare a B.
