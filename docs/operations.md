# Operations and self-hosting

## Docker + SQLite
```bash
docker compose up -d --build
```
| Container | Purpose |
| --- | --- |
| `app` | Bauplan on port 3000; database and local OCR language models in `./daten`, documents in `./dokumente` |

### Environment variables
| Variable | Meaning |
| --- | --- |
| `DATA_DIR=/data` | Directory for SQLite (`renovierung.db`) and downloaded OCR language models (`ocr-models/`) |
| `UPLOADS_DIR=/uploads` | Directory for uploaded files; the Docker image defaults to `/uploads` |

The app has no OCR-related environment variables. Legacy `OCR_URL`, API-key, or service settings do not enable remote OCR.

### Backup
The Compose setup stores the database and OCR models in `./daten` and uploaded files separately in `./dokumente`. Back up all three paths. For older installations, copy `daten/uploads/` into `dokumente/` before switching to the separate mount.

Admins can also create a portable application backup in Settings and import it during setup or from Settings. It contains the database and uploaded documents, but not OCR language models; the archive includes sensitive user credentials and application settings. The in-app ZIP limit is 128 MB. See [backups and restore](backups.md) for expanded-size limits and restore behavior.

### Updates and database migrations

Updates migrate the persistent SQLite database automatically **before the production server starts listening**. No separate migration command is required. Deploy the new image/build and restart the app; do not run old and new app versions against the same database simultaneously.

- New workspace tables/columns are derived from `src/lib/schema.ts` on every startup, including for existing installations that predate migration versioning. Existing rows and files are preserved; new columns start as `NULL`.
- Private-schema changes and data backfills use consecutively numbered migrations in `src/server/migrations.ts`, recorded by SQLite `PRAGMA user_version`. Append a migration for a rename, type conversion, backfill, or other non-additive change; do not edit an already released migration. Keep the shared schema as the only workspace column registry.
- All startup schema changes, pending migrations, and the version update run in one transaction. SQLite waits up to five seconds for another writer. Failure is logged, changes are rolled back, and startup fails instead of serving requests against a partially migrated database. Fix the cause and restart.
- A database version newer than the running build supports is rejected. Rolling back application code is not a database downgrade mechanism.
- Take a backup **before deploying an update**. For a rollback, restore a matching pre-update database and app version. Migrations do not create an automatic backup and cannot undo a successfully committed update.

Migration v2 consolidates existing invoices into expenses, using `invoice-<old-id>` IDs and preserving all financial fields and existing document/contact/cost-item links. It then empties the legacy invoice table so totals are not counted twice. An ID collision fails and rolls back the migration rather than overwriting either record. The empty legacy table/schema is retained for reading older backups and cached workspaces; old ZIP imports undergo the same conversion. New expenses can optionally link to a quote; no historical quote link is guessed.

Synchronize offline work before updating. Writes from obsolete invoice forms or queued invoice operations are explicitly rejected with a reload/reconciliation message rather than creating hidden records. Unsynchronized changes remain local; transfer them to the migrated expense (or create a new expense) before discarding them. Expense operations with an older row shape may require the existing conflict-resolution flow after new nullable columns are added.

### Reverse proxy
Put HTTPS in front of the app (cookies are `secure` under `https`). For OIDC, enter the public address in Settings.
Allow a 100 MiB upload plus multipart overhead (for example `client_max_body_size 110m;` in nginx) and OCR processing durations up to 180 seconds in the proxy.
The application does not need external services at runtime. OCR language models are downloaded only after an explicit admin action; once downloaded, OCR processing is offline. Optional OIDC uses the identity provider configured by an administrator; disable it to keep sign-in fully local. Docker needs network access while downloading base images and build dependencies.

## Development
```bash
bun install
bun run dev
bunx vitest run      # tests
```
For development, `UPLOADS_DIR` is optional; without it, uploaded files are stored in `DATA_DIR/uploads`.
Tests cover budget/calendar/auth rules, local OCR, OCR model/settings authorization, parsing/mapping, and routing.
