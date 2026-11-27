# Gantt Planner su GitHub Pages, con i dati salvati su GitHub

Nessun server da installare: il programma è il sito su GitHub Pages, i dati sono un file JSON in un
repository GitHub. Ognuno apre l'indirizzo nel browser, si collega una volta con il proprio token e
lavora; le modifiche di più persone si uniscono da sole.

## 1. Perché il sito «non girava»

GitHub Pages era impostato su **Deploy from a branch**: pubblicava i file del repository così come
sono. Ma `index.html` carica `src/main.tsx`, cioè TypeScript/React **da compilare**; in più con un
percorso assoluto (`/src/main.tsx`) che su `https://<utente>.github.io/ganttTest/` punta fuori dal
sito. Risultato: `404` su `main.tsx` e la pagina ferma per sempre su «Apertura dell'archivio…».

Il programma va prima compilato (`npm run build` → cartella `dist/`) e va pubblicata la cartella
`dist/`. Lo fa da solo il workflow [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)
a ogni push sul ramo principale.

## 2. Attivare la pubblicazione (una volta)

1. Unire questo lavoro nel **ramo principale** del repository (il workflow pubblica solo da lì).
2. Su GitHub: **Settings → Pages → Build and deployment → Source: «GitHub Actions»**.
3. **Actions → Pubblica su GitHub Pages → Run workflow** (oppure un push qualsiasi sul ramo principale).
4. Dopo circa un minuto il sito è su `https://<utente>.github.io/<repository>/`.

## 3. Il repository dei dati

> **Attenzione:** con un account GitHub gratuito il repository del sito è pubblico, e un file
> messo lì lo può leggere chiunque su Internet: progetti, persone, ferie, malattie, note.
> Per i dati usare **un repository privato a parte**. Il programma avvisa e chiede conferma se il
> repository scelto è pubblico.

1. Su GitHub: **New repository** → nome per esempio `ganttTest-dati` → **Private** → *Create*.
   Può restare vuoto: il file lo crea il programma al primo salvataggio.
2. Per lavorare in più persone: **Settings → Collaborators** del repository dati, e si invitano i
   colleghi (servono i loro account GitHub).

## 4. Il token (ognuno il suo)

Il programma parla con GitHub a nome di chi lo usa: ognuno crea il proprio token.

1. GitHub → foto in alto a destra → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**
   (scorciatoia: <https://github.com/settings/personal-access-tokens/new>).
2. **Repository access → Only select repositories** → solo il repository dei dati.
3. **Permissions → Repository permissions → Contents: Read and write** (il resto non serve).
4. Scadenza a piacere (alla scadenza il programma lo dice: se ne crea uno nuovo e lo si reinserisce).

Il token si incolla nel programma e **resta solo in quel browser** (`localStorage`): non va mai nel
repository né in un file. Su un PC condiviso, a fine lavoro: ⚙ → GitHub… → *Scollega questo browser*.

Colleghi che sono solo *collaboratori* del repository dati di un account personale: GitHub può non
permettere loro un token fine-grained su quel repository. In quel caso le strade sono due:
mettere il repository dei dati in una **organizzazione GitHub** (gratuita) di cui tutti fanno parte,
oppure usare un token **classic** con il solo scope `repo` (vale però per tutti i loro repository).

## 5. Collegare il programma

Nella barra in alto: **Salva su GitHub…** (oppure ⚙ Impostazioni → GitHub…).

| Campo | Cosa scrivere |
|---|---|
| Repository dei dati | `proprietario/nome`, per esempio `giova-giovanni/ganttTest-dati` (va bene anche l'indirizzo completo) |
| File dei dati | `gantt-dati.json` (si può mettere in una cartella: `dati/gantt-dati.json`) |
| Ramo | vuoto = ramo principale |
| Token di accesso | il token del punto 4 |

*Collega* verifica tutto prima di cambiare qualcosa: token valido, accesso al repository, file
leggibile. Se nel browser c'erano già progetti e il file su GitHub è ancora vuoto, il programma
propone di trasferirli.

## 6. Come funziona il salvataggio

| | |
|---|---|
| Ogni modifica | resta subito in questo browser; dopo 2–3 secondi di calma parte verso GitHub come **commit** (più modifiche ravvicinate = un commit solo, al massimo uno ogni 10 s) |
| Barra in alto | `GitHub · proprietario/nome · @utente`, poi *Modifiche da salvare* / *Salvataggio…* / *Salvato alle…* |
| ↻ Aggiorna | salva subito e controlla le modifiche degli altri (lo fa comunque da solo ogni 30 s e quando si torna sulla scheda) |
| Due persone insieme | si scrive sempre «sopra» la versione letta: se un altro ha salvato nel frattempo, GitHub rifiuta, il programma legge la sua versione, **unisce record per record e campo per campo** e salva di nuovo. Campi diversi: restano entrambi. Stesso campo: vince l'ultimo salvataggio |
| Annulla (`Ctrl+Z`) | toglie solo le **proprie** modifiche, mai quelle arrivate dagli altri |
| Senza rete | si continua a lavorare; le modifiche restano nel browser e partono da sole. Chiudendo la pagina con modifiche non partite il browser chiede conferma; in ogni caso partono alla prossima apertura |
| Cronologia | il pulsante **Cronologia ↗** apre su GitHub tutte le versioni del file: chi, quando, cosa (un campo per riga: il confronto mostra esattamente cosa è cambiato) |
| File rovinato | se il file su GitHub non è leggibile il programma **non lo sovrascrive** e lo dice |

Il file ha la stessa forma dell'archivio del server Node (`{ "kind": "gantt-data", "data": … }`):
si può anche importare con ⇅ Importa / Esporta.

### Tornare a una versione precedente

GitHub → repository dei dati → `gantt-dati.json` → **History** → si apre la versione voluta →
*Download raw file*. Poi nel programma: ⇅ Importa → *Sostituisci tutti i dati*. Il ripristino è a sua
volta un commit: anche lui si può annullare.

## 7. Limiti

- Non è in tempo reale come il server Node: le modifiche degli altri arrivano entro ~30 s (subito con ↻).
- Non si vede chi è collegato in quel momento (la cronologia dice chi ha salvato e quando).
- Il testo di una stessa nota modificato da due persone insieme: resta quello salvato per ultimo.
- GitHub limita le scritture molto fitte: per un gruppo di lavoro normale non è un problema.

## Kurzfassung (DE)

1. Pages veröffentlichte die Quelltexte statt des kompilierten Programms: daher blieb die Seite bei
   „Archiv wird geöffnet…“ stehen. Jetzt baut der Workflow `pages.yml` das Programm und veröffentlicht
   `dist/` (einmalig: Settings → Pages → Source: „GitHub Actions“).
2. Die Daten liegen als JSON-Datei in einem **privaten** GitHub-Repository; jede Speicherung ist ein Commit.
3. Jede Person verbindet sich einmal mit einem eigenen Fine-grained-Token („Contents: Read and write“),
   das nur in ihrem Browser bleibt.
4. Gleichzeitige Änderungen werden pro Datensatz und Feld zusammengeführt; bei demselben Feld gewinnt
   die letzte Speicherung. Ohne Netz bleibt alles im Browser und wird später gesendet.
