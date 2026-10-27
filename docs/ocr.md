# Documents and local text recognition

## Processing

OCR runs in-process on the Bauplan server with `tesseract.js`; no OCR service, hosted OCR provider, external process, or AI service receives a document. The source file remains in `UPLOADS_DIR`. Recognized text is transient and is not saved. `src/lib/ocr-parse.ts` continues to extract business fields using fixed rules, which users review before saving.

- Supported inputs: PDF, PNG, JPEG, TIFF, and BMP; maximum **25 MiB** and **10 PDF pages**.
- For PDFs, PDF.js first extracts text page by page. A page with fewer than 20 non-whitespace text characters is rasterized locally with PDF.js and `@napi-rs/canvas`, then OCRed with Tesseract.js. This supports text-only, scanned, and mixed PDFs.
- Images and rendered PDF pages use German, English, or both. The server allows two simultaneous OCR jobs and a maximum processing time of 180 seconds.
- PDF page text is returned to the existing extraction flow. Table structure and searchable PDF output are not generated.
- Invalid, encrypted, oversized, too-large-page-count, timed-out, or incomplete documents produce explicit errors. Uploads remain available for manual processing.
- Debugging: in dev mode (`npm run dev`) each recognition is logged to the browser console as a collapsed `[OCR] <file>` group with the extracted fields, errors, warnings and the raw recognized text. Production builds neither log nor send the raw text to the browser.

## Language models

An administrator downloads German and/or English language models from **Settings → Text recognition (OCR)**. Downloads are an explicit action; neither setup nor document processing downloads model data automatically. The app retrieves only the pinned `@tesseract.js-data/deu@1.0.0` or `@tesseract.js-data/eng@1.0.0` `4.0.0_best_int` model from jsDelivr, validates the gzip data and size, and atomically stores it under `DATA_DIR/ocr-models/`.

Keep the `/data` volume persistent and include it in backups; it contains both SQLite data and installed models. Once downloaded, the models are read locally and OCR works without outbound network access. If a model is missing, the app reports that condition instead of falling back to the network. To recover disk space, remove an installed model after disabling OCR or choosing a different active language.

An active language can be selected only when all of its required models are installed. The built-in processing test uses an application-owned synthetic image and does not send a user's document.

## Settings and migration

Only admins can inspect and change OCR settings or download/remove models. The shared settings contain only the enable switch and selected language. There are no provider choices, service URLs, API keys, network destination controls, or OCR-related encryption secrets.

Older saved service settings are read only to preserve the enable switch and language; the provider, URL, and encrypted credential are ignored. Saving migrates them to the local settings format and removes the old credential. Reset deletes saved OCR settings and disables recognition. Legacy `OCR_URL`, `OCR_SETTINGS_KEY`, and companion-service environment variables are ignored.

## Deployment

The app needs no OCR companion container. Docker Compose runs only the app and persists `/data` and `/uploads`. Admin-initiated model downloads require the app server to reach jsDelivr; deployments without outbound network can transfer the two model files into `DATA_DIR/ocr-models/` from a trusted source.

The normal build-time network requirements are unchanged. OCR runtime processing is local and offline once language models are present. See [operations](operations.md) and [Docker/Unraid setup](docker-unraid.md).
