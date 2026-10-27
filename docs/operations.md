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
