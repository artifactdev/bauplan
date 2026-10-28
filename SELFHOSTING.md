# Self-hosting with Docker

For plain `docker run` commands and Unraid template setup, see the [Docker and Unraid guide](docs/docker-unraid.md).

Start the app:
```bash
docker compose up -d --build
```

Open <http://localhost:3000>. Docker Compose starts a single `app` container on port 3000; the database and OCR language models persist in `./daten`, uploaded documents in `./dokumente`.

Text recognition runs inside the app with `tesseract.js`; no separate OCR container is needed. An admin downloads the German and/or English language models under **Settings → Text recognition (OCR)**. For PDFs, embedded text is used first; scanned PDFs are recognized page by page. Amount, date, due date, merchant, document type, and category are extracted with fixed rules and shown for review before saving. See [OCR](docs/ocr.md) for details and limits.

## Data and backups

- `DATA_DIR=/data` — directory for `renovierung.db` (set by the image)
- `UPLOADS_DIR=/uploads` — separate directory for uploaded documents (set by the image)
- Back up both `./daten` and `./dokumente`.

For an existing installation with documents under `./daten/uploads`, stop the app and copy those files into `./dokumente/` before starting the updated Compose configuration.

On first launch, the setup page creates the admin account. The admin can add users under **Settings → Users**. All users share the same project.

## Optional OIDC (e.g. Pocket ID)

Local email/password authentication works without an external service. To enable OIDC, enter the issuer, client ID, and secret under **Settings → Sign in with OIDC**. Register `https://<your-address>/api/oidc/callback` as the callback URL with the provider. Behind a reverse proxy, also enter the public app address. OIDC sign-ins are linked to an existing account with the same email address; only first-time users without a matching account need admin approval. Users can change their own local password under **Settings → Personal → Account**.

OIDC requires outbound access to the provider when enabled. For a fully local setup, leave it disabled. Docker requires network access when pulling base images and downloading build dependencies; the running app does not require cloud services. Downloading OCR language models requires outbound HTTPS access to jsDelivr; no document content is sent.

## Optional Paperless-ngx

Set `PAPERLESS_SETTINGS_KEY` to a 64-character hexadecimal secret on the Bauplan server to encrypt personal Paperless tokens (generate it with `openssl rand -hex 32`). Keep it outside source control. Compose passes this variable from the deployment environment. An administrator configures the instance under Settings; each member connects their own API token. The server must be able to reach the configured Paperless base URL, with a separate browser URL if needed.

Members can import selected archive documents and manually archive selected Bauplan scans/uploads. Local copies remain available; there is no automatic content or deletion synchronization. Imported files are shared with the Bauplan project. Portable backups exclude personal Paperless tokens, so reconnect after restore. See [Paperless integration](docs/paperless.md) for permissions, status filters and interrupted-transfer recovery.
