# Migrazione su un altro PC (Docker)

Questa guida spiega come migrare l'istanza di InfraCusMan su un altro PC con Docker mantenendo dati MySQL e impostazioni/utenti di Keycloak.

## 1) PC ORIGINE – Esegui il backup

- Assicurati che lo stack sia in esecuzione (`docker compose ps`).
- Esegui lo script di backup (crea `backups/<timestamp>/db.sql`):
  - Windows (PowerShell): `./scripts/backup.ps1`
  - Unix/macOS (sh): `./scripts/backup.sh`
- Facoltativo (Windows): includi anche il file `.env` con `./scripts/backup.ps1 -IncludeEnv`.
- Copia la cartella `backups/<timestamp>/` (e `.env` se incluso) sul PC destinazione.

## 2) PC DESTINAZIONE – Ripristina

- Clona il repository e portati nella cartella del progetto.
- Copia il file `.env` nella root del progetto e verifica i parametri necessari (`GOOGLE_PLACES_KEY`, `HUNTER_KEY` se usato).
- Copia la cartella `backups/<timestamp>/` all'interno del repo.
- Esegui lo script di ripristino indicando la cartella di backup:
  - Windows (PowerShell): `./scripts/restore.ps1 -BackupDir .\backups\<timestamp>`
  - Unix/macOS (sh): `./scripts/restore.sh ./backups/<timestamp>`

Lo script avvia MySQL e Redis, ricrea i database `appdb` e `keycloakdb`, importa `db.sql` (che include dati applicativi e utenti/impostazioni Keycloak), quindi avvia `idp` (Keycloak), `backend` e `frontend`.

## Note e raccomandazioni

- Questo metodo conserva utenti, ruoli e attributi salvati in Keycloak perché ripristina l'intero database `keycloakdb`.
- In ambienti di produzione evita di esporre la porta della MySQL sull'host e proteggi le credenziali di amministrazione di Keycloak.
- In alternativa al ripristino da backup, per un'istanza “pulita” puoi usare gli script `./scripts/first-run.ps1` / `./scripts/first-run.sh` che eseguono bootstrap di schema e seed di esempio.

