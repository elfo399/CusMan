# InfraCusMan

Gestione contatti/clienti e partner con autenticazione Keycloak, analisi, import/export e uno scraper da Google Places. Monorepo con frontend Angular, backend Express, Keycloak, MySQL e Redis orchestrati via Docker.

—

## Caratteristiche principali

- Autenticazione e profili utente tramite Keycloak (realm “cusman”).
- Anagrafica Clienti: filtri, ordinamenti, modifica, export CSV, import batch.
- Partner: CRUD minimale + statistiche rapide e export CSV.
- Comunicazioni: vista “Clienti da chiamare” con filtri e paginazione.
- Grafici/Analytics: ripartizione per stato e assegnazione.
- Scraper Google Places:
  - Creazione Job (query, coordinate, raggio, limite, nome facoltativo).
  - Esecuzione in background con progress/stato e dedup dei risultati.
  - Anteprima paginata, esportazione (CSV/JSON/JSONL), import diretto in “Clienti”.
  - Selettore coordinate su mappa (Google Maps), URL mappa nell’anteprima.
- Documentazione API con Swagger UI su `/api-docs`.

## Stack tecnico

- Frontend: Angular 20, PrimeNG, Chart.js.
- Backend: Node.js (Express 5 ESM), MySQL (mysql2/promise), Redis, Zod, Swagger.
- IAM: Keycloak 25 con tema login personalizzato e realm importabile.
- Infrastruttura: Docker Compose, Nginx per il serving del FE e proxy `/api` verso il BE.

## Avvio rapido (Docker)

Prerequisiti: Docker Desktop (o Docker + Compose) installato e attivo.

- Windows (PowerShell):
  - `./scripts/first-run.ps1`
  - Opzioni: `-Rebuild` (ricompila le immagini), `-NoCache` (build senza cache)

- Unix/macOS (sh):
  - `./scripts/first-run.sh`
  - Opzioni via env: `REBUILD=true NOCACHE=true ./scripts/first-run.sh`

Cosa fanno gli script di first-run:
- Avviano `mysql` e `redis` e attendono l’health di MySQL.
- Creano i database `appdb` e `keycloakdb` (se mancanti) e la tabella `jobs` (con colonna `results_csv`).
- Se la tabella `clienti` non esiste, applicano schema + seed da `sql/init/01-sqlClienti.sql`.
- Avviano `idp` (Keycloak), `backend` e `frontend`.

URL di default:
- Frontend: http://localhost:8080
- Backend: http://localhost:3000
- Keycloak: http://localhost:8081

## Migrazione su un altro PC (backup/ripristino)

Per mantenere dati applicativi e impostazioni/utenti di Keycloak, usa gli script di backup/ripristino inclusi. La guida completa è in `MIGRATION.md`.

- Backup (PC origine):
  - Windows: `./scripts/backup.ps1` (opzionale `-IncludeEnv`)
  - Unix/macOS: `./scripts/backup.sh`
  - Output: `backups/<timestamp>/db.sql` (dump di `appdb` e `keycloakdb`).

- Ripristino (PC destinazione):
  - Windows: `./scripts/restore.ps1 -BackupDir .\backups\<timestamp>` o `./scripts/restore-latest.ps1`
  - Unix/macOS: `./scripts/restore.sh ./backups/<timestamp>` o `./scripts/restore-latest.sh`

## Variabili d’ambiente

File `.env` (root) per il backend (compose setta automaticamente i parametri DB/Redis):
- `GOOGLE_PLACES_KEY`: chiave Google Places usata dallo scraper (fallback globale; per-utente si salva in Keycloak Attributes).
- `HUNTER_KEY`: opzionale, per arricchimento email (endpoint `/v1/enrich-contacts`).

Frontend: la chiave Google Maps usata per il widget mappa è definita in `fe/src/environments/` (limita la chiave per referer in produzione).

## API e documentazione

- Swagger UI: `http://localhost:3000/api-docs`
- JSON: `http://localhost:3000/api-docs.json`

Endpoint principali (estratto):
- Clienti: CRUD, filtri distinti, export CSV, import batch (`/api/clienti*`).
- Partner: CRUD + stats + export CSV (`/api/partner*`).
- Scraper:
  - Crea job: `POST /api/v1/search`
  - Stato: `GET /api/v1/jobs/:id`
  - Anteprima: `GET /api/v1/jobs/:id/places?limit=&offset=`
  - Import: `POST /api/v1/jobs/:id/import`
  - Export: `GET /api/v1/export/:id?format=csv|json|jsonl`

## Comandi utili (script)

- Primo avvio: `scripts/first-run.ps1` / `scripts/first-run.sh`
- Redeploy rapido (rebuild + up): `scripts/redeploy.ps1` / `scripts/redeploy.sh`
- Watch & auto-redeploy (Docker): `scripts/watch-and-redeploy.ps1`
- Backup DB: `scripts/backup.ps1` / `scripts/backup.sh`
- Restore DB: `scripts/restore.ps1` / `scripts/restore.sh`

## Sviluppo locale (senza Docker)

Opzionale, per chi preferisce avviare i servizi localmente:
- MySQL e Redis locali (crea i DB con `sql/init` oppure avvia `scripts/first-run.*`).
- Backend: `cd be && npm install && npm run dev` (porta 3000).
- Frontend: `cd fe && npm install && npm start` (porta 4200, API su http://localhost:3000/api).

## Sicurezza e note operative

- La porta MySQL (`3307:3306`) è esposta solo per debug: rimuoverla in produzione.
- Proteggi le credenziali admin di Keycloak; valuta realm e utenti separati per ambienti.
- Limita e ruota le API key (Google Places/Maps, Hunter) e definisci quote/alert.
- I backup possono contenere dati sensibili (incluso Keycloak). Evita di versionarli pubblicamente.

## Struttura repository

```
.
├─ fe/                 # Frontend Angular + Nginx (Docker)
├─ be/                 # Backend Express (ESM) + Swagger
├─ keycloak/           # Tema login + realm JSON
├─ sql/init/           # Schema iniziale e seed
├─ scripts/            # Script di avvio, backup/restore, redeploy
├─ docker-compose.yml  # Orchestrazione servizi
└─ README.md
```

## Licenza

Vedi `LICENSE` nella root del repository.
