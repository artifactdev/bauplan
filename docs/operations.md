# Operations & self-hosting

## Docker + SQLite
```bash
docker compose up -d --build
```
| Container | Purpose |
| --- | --- |
| `app` | App on port 3000, database in `./daten`, documents in `./dokumente` |
| `ocr` | Tesseract text recognition, reachable internally only |
| `docling` | Optional CPU Docling Serve 1.38.1 (`--profile docling`), no published port |

### Environment variables
| Variable | Meaning |
| --- | --- |
| `DATA_DIR=/data` | Directory for the SQLite database (`renovierung.db`) |
| `UPLOADS_DIR=/uploads` | Directory for uploaded files; the Docker image defaults to `/uploads` |
| `OCR_URL` | Legacy Tesseract default (Compose: `http://ocr:8000`); saved admin OCR settings override it |
| `OCR_SETTINGS_KEY` | App-only 64-character hexadecimal AES key, required to store OCR API keys; generate with `openssl rand -hex 32` |
| `OCR_API_KEY` | Optional authentication key on the Tesseract companion, not the app |
| `DOCLING_SERVE_API_KEY` | Optional authentication key on Docling Serve; enter the matching value in app OCR settings |

### Backup
The Compose setup stores the database in `./daten` and uploaded files separately in `./dokumente`. Back up both paths. For older installations, copy `daten/uploads/` into `dokumente/` before switching to the separate mount.

Preserve `OCR_SETTINGS_KEY` securely and separately from database backups; encrypted OCR credentials cannot be recovered without it. Back up customized Docling model assets or retain the pinned image used to initialize the model volume. See [OCR deployment](ocr.md).

### Reverse proxy
Put HTTPS in front of the app (cookies are `secure` under `https`). For OIDC, enter the public address in Settings.
Allow a 25 MiB upload plus multipart overhead and OCR request durations above 180 seconds in the proxy. Service URLs may include reverse-proxy base paths but must not redirect.
The application does not need external services at runtime. Optional OIDC uses the identity provider configured by an administrator; disable it to keep sign-in fully local. Docker needs network access while downloading base images and build dependencies.

## Development
```bash
bun install
bun run dev
bunx vitest run      # tests
```
For development, `UPLOADS_DIR` is optional; without it, uploaded files are stored in `DATA_DIR/uploads`.
Tests include budget/calendar/auth rules, OCR adapters/configuration/access/settings UI, parsing/mapping, and routing. Companion tests: `python3 -m unittest discover -s ocr -p 'test_*.py'`. Provider contract tests do not replace live-container checks.
