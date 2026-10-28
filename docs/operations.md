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
| `PAPERLESS_SETTINGS_KEY` | Optional 64-character hexadecimal secret (`openssl rand -hex 32`) for encrypting personal Paperless API tokens; required before connecting accounts, never included in portable backups |

### Paperless-ngx

The optional connector contacts only the self-hosted instance configured by an administrator. Each member uses a personal API token. Imports and manual exports retain local file copies and never synchronize later edits or deletions. Members can explicitly enable automatic imports by tag; the server processes up to 25 matches every five minutes per rule without requiring an open browser. Personal settings show results and errors; rules are excluded from portable backups. The document overview shows known-link filters and per-file processing status. See [Paperless integration](paperless.md) for setup, sharing boundaries and unknown-outcome recovery.

### Push notifications

The Web Push contact address is automatically taken from the oldest existing admin account's email address (creation date, then user ID as a tie-breaker). No environment configuration is needed; `PUSH_SUBJECT` is no longer used. Changes to the selected admin account are picked up automatically without rotating VAPID keys. Without an admin account with a valid email address, registration and delivery are unavailable. VAPID keys are generated once and stored privately in SQLite.

Run the app continuously over HTTPS; the Node/Nitro server checks reminders every 30 seconds. No external cron is required. Each approved user enables push explicitly under **Settings → Personal → Push notifications** on each device and can send a test. Development does not register a service worker: use a production build for device tests. On iOS/iPadOS 16.4+, open the installed Home Screen app.

The server stores subscriptions privately, bound to the subscribing login session. Signing out, expiry, user removal, or losing membership stops delivery; enable again after signing in. An offline sign-out cannot revoke the server session until connectivity returns; generic notifications may still arrive meanwhile. Push subscriptions and queued deliveries are not exported in portable backups and are cleared on restore; users must opt in again. VAPID keys remain sensitive application settings and are included in backups. Do not edit them or reuse subscriptions across instances.

Web Push requires outbound HTTPS to the browser provider (Apple, Google, Mozilla, or Microsoft); subscriptions are accepted only for these providers. Delivery is encrypted. Notification text is generic and excludes task titles, amounts, names and document contents; tapping opens the relevant record after normal authentication. Web Push is optional: without it, data, local OCR and the rest of the app stay self-hosted.

Assignments notify the new assignee (not self-assignments) after the server commits, including successful offline sync. Open tasks notify their assignee; requested/received quotes and open unpaid expenses notify all opted-in members. Date-only deadlines remind three days before and on the date at 09:00 Europe/Berlin; timed calendar events remind one hour before their start, also interpreted in Europe/Berlin. Untimed calendar entries have no one-hour reminder. Completed tasks, accepted/rejected offers, paid/submitted/reimbursed expenses, removed records and superseded dates are skipped at send time. No daily overdue reminders.

Reminder identities and per-device deliveries persist across restarts. If the server restarts during a reminder day, it catches up until local midnight (calendar events only until their start; assignments for 24 hours). It does not replay older expired reminders. Transient errors retry with bounded exponential backoff (at most eight attempts); 404/410 removes an expired subscription. Delivery failures are logged without endpoint secrets. Database leases prevent concurrent workers from claiming the same delivery; the unavoidable crash window after provider acceptance can still produce a duplicate, so delivery is not an exactly-once guarantee. OS settings, Focus modes, network connectivity and provider delivery can delay or suppress notifications.

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

Migration v3 introduces the additional-funding ledger, created from the shared schema. Existing project amounts are preserved and displayed as the initial bank budget; additional funding starts empty. The version gate prevents older migration-aware builds from opening a database containing funding they cannot account for. ZIP backups include incoming funds; backups and offline snapshots created before this table existed are accepted with an empty ledger.

Synchronize offline work before updating. Writes from obsolete invoice forms or queued invoice operations are explicitly rejected with a reload/reconciliation message rather than creating hidden records. Unsynchronized changes remain local; transfer them to the migrated expense (or create a new expense) before discarding them. Expense operations with an older row shape may require the existing conflict-resolution flow after new nullable columns are added.

### Reverse proxy
Put HTTPS in front of the app (cookies are `secure` under `https`). For OIDC, enter the public address in Settings.
Allow a 100 MiB upload plus multipart overhead (for example `client_max_body_size 110m;` in nginx) and OCR processing durations up to 180 seconds in the proxy.
 OCR language models are downloaded only after an explicit admin action; once downloaded, OCR processing is offline. Optional OIDC uses the identity provider configured by an administrator; disable it to keep sign-in fully local. Docker needs network access while downloading base images and build dependencies.

## Development
```bash
bun install
bun run dev
bunx vitest run      # tests
```
For development, `UPLOADS_DIR` is optional; without it, uploaded files are stored in `DATA_DIR/uploads`.
Tests cover budget/calendar/auth rules, local OCR, OCR model/settings authorization, parsing/mapping, and routing.
