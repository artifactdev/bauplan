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

Local email/password authentication works without an external service. To enable OIDC, enter the issuer, client ID, and secret under **Settings → Sign in with OIDC**. Register `https://<your-address>/api/oidc/callback` as the callback URL with the provider. Behind a reverse proxy, also enter the public app address. First-time OIDC users need admin approval unless their verified email matches an existing account.

OIDC requires outbound access to the provider when enabled. For a fully local setup, leave it disabled. Docker requires network access when pulling base images and downloading build dependencies; the running app does not require cloud services. Downloading OCR language models requires outbound HTTPS access to jsDelivr; no document content is sent.
