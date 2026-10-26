# Documents & text recognition (OCR)

## Goal and flow

Photograph or upload receipts, invoices, and quotes, recognize their text with a **self-hosted** service, and prefill forms for review. Tesseract is the lightweight default; optional Docling Serve adds local layout/table models. Cloud OCR, remote AI APIs, and LLM-based field extraction are not used.

1. Upload a supported image/PDF or take a camera photo. The original is stored in `UPLOADS_DIR`.
2. The member-only `analyzeDocument` server function loads the project's document and effective server-side OCR settings.
3. Preflight checks actual bytes (maximum **25 MiB**), MIME signatures, and PDF readability/page count (**1–10 pages**, no encrypted PDFs). Larger PDFs are rejected, never silently truncated.
4. A server-only adapter sends bytes to the configured service and validates/normalizes its response.
5. `src/lib/ocr-parse.ts` extracts business fields with fixed rules; `src/lib/scan-map.ts` maps recognized values to forms. Recognition languages do not change the currently German-focused parsing rules.
6. The user reviews and saves. OCR failure never deletes the upload; manual completion remains available.

The normalized internal result contains `provider`, `text`, `pages`, `tables`, and `warnings`. Unavailable pages/tables are `null`, not invented. Docling cells retain row/column positions, spans, and source-page references. The existing consumer result remains an `Extraction`; OCR text, pages, tables, and raw provider responses are **not persisted**. There is no table editor, automatic line-item import, searchable PDF output, provider fallback, or durable job queue.

## Settings → Text recognition (admins only)

One shared configuration applies to all approved project members:

- Enable/disable recognition, choose **Tesseract** or **Docling Serve**, and enter the service **base URL** (including an optional reverse-proxy path).
- Choose German, English, or both (default). Supported inputs: PDF, PNG, JPEG, TIFF, BMP. Other uploads may still be stored but are not OCR inputs.
- Set an optional API key using explicit keep/replace/delete actions. Keys are never returned to the browser. A changed URL/provider requires key replacement or deletion to prevent accidental credential forwarding.
- **Test document processing** processes an application-owned synthetic PNG and checks its recognized marker. This tests actual conversion rather than just HTTP availability and never saves the draft or sends a private upload.
- **Reset to environment configuration** deletes saved settings and the stored key.

Resolution order: saved settings (including explicit disable) → legacy `OCR_URL` Tesseract default → unconfigured. Reading settings does not migrate them. Invalid saved settings fail explicitly and can be reset; they never silently switch providers.

Only admins can read/save/reset/test configuration, enforced server-side. Members can analyze documents using saved configuration but cannot override the target. Pending and anonymous users cannot analyze documents.

### Credentials and backups

Set a stable `OCR_SETTINGS_KEY` on the **app** before storing an API key:

```sh
openssl rand -hex 32
```

Use the resulting 64 hexadecimal characters as the environment value (Compose reads it from the shell or an uncommitted `.env`). Store it securely and back it up **separately** from SQLite. Do not commit it. API keys are encrypted in private `app_settings.ocr_config` with AES-256-GCM, random nonces, and purpose/version-bound authenticated data. They are not part of the Workspace or generic project CRUD.

No encryption key is needed for unauthenticated services. A missing/wrong encryption key produces an explicit error for encrypted credentials; recover by restoring the original key or replacing/deleting the stored API key. Do not simply rotate the environment key without re-entering credentials.

### Destination policy — trusted admins required

**All HTTP(S) network destinations are intentionally allowed**, including loopback, Docker, LAN, link-local, and public addresses. There is no IP approval, network allowlist, DNS pinning, or SSRF protection. A trusted admin can cause the server to contact arbitrary reachable HTTP(S) services. Do not offer OCR administration to untrusted users.

URLs cannot contain embedded credentials, query parameters, or fragments. Adapters derive fixed endpoint paths; redirects are rejected and keys are scoped to the selected service. These checks do **not** provide network isolation or protection against DNS rebinding. HTTP is allowed but exposes documents/API keys in transit; use HTTPS on public or untrusted networks. The UI warns about this.

## Tesseract companion (`ocr/`)

- Debian slim, Python 3, Tesseract with German/English, poppler.
- `POST /ocr`: raw PDF/image body with its MIME type; returns `{"text":"..."}`.
- Optional `X-OCR-Language`: `de`, `en`, `de+en`. Without the header, `OCR_LANG` applies (default `deu+eng`).
- Optional `OCR_API_KEY` on the service requires matching `X-Api-Key` on capabilities and conversion requests. No key preserves legacy unauthenticated behavior.
- `GET /capabilities`: protocol version 1 and supported language choices; `/` and `/health` remain simple public health checks.
- PDFs: check the complete page count first, then try embedded text; otherwise rasterize at 300 dpi and OCR every permitted page. Subprocess failure is an error, not empty success. A shared 170-second service budget covers all commands/pages.
- Images: Tesseract `--psm 4`. No internet needed at runtime; no host port is needed on a shared Docker network.

Older companion containers returning only text and generic health JSON remain usable at their own `OCR_LANG` default. The app warns that the requested combined language cannot be verified; explicit single-language overrides are rejected until the companion is upgraded. Tesseract does not claim normalized pages/tables.

## Optional Docling Serve

Adapter target: **Docling Serve 1.38.1**, CPU image `quay.io/docling-project/docling-serve-cpu:v1.38.1` (Docling 2.142.1). The app uses multipart `POST /v1/convert/file`, `X-Api-Key` when configured, and the standard local pipeline with EasyOCR plus table structure. EasyOCR's bundled Latin models support German/English; the stock image's Tesseract installation only bundles English data, so it is not used by this adapter. It requests text and Docling JSON without embedded images. Partial conversions are rejected. Merely installing the Docling Python library does not provide an HTTP endpoint.

Start the optional Compose profile:

```sh
docker compose --profile docling up -d --build
```

In app settings select Docling Serve, base URL `http://docling:5001`, and run the processing test. Saving this configuration overrides `OCR_URL`; switching does not require rebuilding the app. The lightweight Tesseract service remains available as a manually selected alternative.

The pinned upstream image bundles model assets under `/opt/app-root/src/.cache/docling/models`; Compose uses a named volume, which Docker initially populates from those assets. **Do not mount an empty host directory over bundled models.** The Compose service sets `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, remote services/UI off, 10 pages, a 170-second conversion budget, and 175-second synchronous wait. It publishes no port.

For Unraid, use `unraid/bauplan-docling.xml`, place it on the app's private Docker network, and prepopulate its model bind mount from the pinned image before startup. For example (adjust the destination):

```sh
docker create --name bauplan-docling-model-copy quay.io/docling-project/docling-serve-cpu:v1.38.1
mkdir -p /mnt/user/appdata/bauplan-docling/models
docker cp bauplan-docling-model-copy:/opt/app-root/src/.cache/docling/models/. /mnt/user/appdata/bauplan-docling/models/
docker rm bauplan-docling-model-copy
chown -R 1001:0 /mnt/user/appdata/bauplan-docling/models
```

Set the app's base URL to `http://bauplan-docling:5001`. Optional service authentication uses `DOCLING_SERVE_API_KEY`; the same value goes in the app's encrypted OCR settings. Keep the separate app `OCR_SETTINGS_KEY`.

Docling uses more CPU/RAM/disk than Tesseract; its CPU image is several GB. Start with a multi-core host and several GB of available RAM, then measure representative documents before imposing container limits. No GPU is required. Image/model provisioning requires downloads, but document conversion should work offline with preloaded models; disable network egress at the deployment layer for enforcement. Offline flags are not a network firewall.

## Errors and operational limits

- Two in-flight recognition/test operations per app instance; additional calls get an explicit busy error rather than an unbounded queue.
- Maximum 180 seconds for preflight/transport/response reading, 8 MiB provider response limit, and runtime validation.
- Distinct localized errors for missing configuration, authentication, invalid PDFs/formats, limits, timeout, invalid provider responses, redirects, empty text, and incomplete conversion.
- Logs include sanitized OCR error codes only, not document text, credentials, or provider error bodies.
- Set reverse-proxy upload/body limits high enough for a 25 MiB multipart upload and timeouts longer than the 180-second OCR deadline.
- Poor lighting, crumpled receipts, and ambiguous totals still require human review.

## Recognition rules

| Field | Rule |
| --- | --- |
| Amount | Prioritized total keywords; exclude VAT, net amounts, and change |
| Date / due date | German date formats and payment-deadline keywords |
| Type | Quote, invoice, receipt, contract, plan, datasheet keywords |
| Category / merchant | Merchant/keyword lists, meaningful lines, legal forms |
| Trade | Match against existing project trades |

No new invoice-number or currency field is inferred by the provider change.

## Verification

```sh
npm test -- src/server/ocr/ocr.test.ts src/lib/ocr-access.test.ts src/components/app/OcrSettingsPanel.test.tsx src/lib/ocr-parse.test.ts src/lib/scan-map.test.ts
python3 -m unittest discover -s ocr -p 'test_*.py'
```

Opt-in live integration tests (synthetic documents only) against already running services:

```sh
OCR_TEST_TESSERACT_URL=http://127.0.0.1:8000 \
OCR_TEST_DOCLING_URL=http://127.0.0.1:5001 \
OCR_TEST_API_KEY=your-test-service-key \
OCR_SETTINGS_KEY=your-64-character-hexadecimal-encryption-key \
npm test -- src/server/ocr/live.test.ts
```

Omit `OCR_TEST_API_KEY` for unauthenticated test services. Unset provider URLs skip their live tests. Tests cover each language, raster OCR, text/scanned PDFs, Docling table normalization, and authentication; they never run against an implicit default target.

Run real-service checks with the default Tesseract container and the pinned Docling image, including the synthetic test, PDF/image conversion, both languages, authentication failures, and offline conversion after provisioning. Fixture/unit tests validate contracts but do not replace these deployment checks.

Upstream API references: [Docling Serve 1.38.1](https://github.com/docling-project/docling-serve/tree/v1.38.1), [conversion options](https://github.com/docling-project/docling/blob/v2.142.1/docling/datamodel/service/options.py), [response schemas](https://github.com/docling-project/docling/blob/v2.142.1/docling/datamodel/service/responses.py).
