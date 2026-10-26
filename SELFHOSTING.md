# Self-hosting with Docker

For plain `docker run` commands and Unraid template setup, see the [Docker and Unraid guide](docs/docker-unraid.md).

Start the app and its local OCR service:
```bash
docker compose up -d --build
```

Open <http://localhost:3000>. Docker Compose starts two containers:
- `app` — Bauplan on port 3000; database persists in `./daten`, uploaded documents in `./dokumente`
- `ocr` — local text recognition with Tesseract (German and English), available only to the app container

Tesseract is the default. For PDFs, embedded text is used first; scanned PDFs are recognized page by page. OCR rejects documents above 25 MiB or 10 PDF pages. Amount, date, due date, merchant, document type, and category are extracted with fixed rules and shown for review before saving.

Admins can select a different service under **Settings → Text recognition (OCR)** without rebuilding the app. For optional local Docling layout/table recognition, start `docker compose --profile docling up -d --build`, select Docling Serve with URL `http://docling:5001`, and test processing. See [OCR configuration](docs/ocr.md) for model provisioning, Unraid, credentials, and limitations. All HTTP(S) targets are intentionally permitted: only trusted admins should configure destinations; there is no SSRF isolation.

## Data and backups

- `DATA_DIR=/data` — directory for `renovierung.db` (set by the image)
- `UPLOADS_DIR=/uploads` — separate directory for uploaded documents (set by the image)
- `OCR_URL` — legacy Tesseract default (`http://ocr:8000` in Compose); saved settings override it
- `OCR_SETTINGS_KEY` — separate 64-character hexadecimal encryption key if using an OCR API key; generate with `openssl rand -hex 32` and back it up securely outside the database
- Back up both `./daten` and `./dokumente`.

For an existing installation with documents under `./daten/uploads`, stop the app and copy those files into `./dokumente/` before starting the updated Compose configuration.

On first launch, the setup page creates the admin account. The admin can add users under **Settings → Users**. All users share the same project.

## Optional OIDC (e.g. Pocket ID)

Local email/password authentication works without an external service. To enable OIDC, enter the issuer, client ID, and secret under **Settings → Sign in with OIDC**. Register `https://<your-address>/api/oidc/callback` as the callback URL with the provider. Behind a reverse proxy, also enter the public app address. First-time OIDC users need admin approval unless their verified email matches an existing account.

OIDC requires outbound access to the provider when enabled. For a fully local setup, leave it disabled. Docker requires network access when pulling base images and downloading build dependencies; the running app and OCR service do not require cloud services.
