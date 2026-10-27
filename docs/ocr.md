# Documents and local text recognition

## Processing

OCR runs in-process on the Bauplan server with `tesseract.js`; no OCR service, hosted OCR provider, external process, or AI service receives a document. The source file remains in `UPLOADS_DIR`. Recognized text is transient and is not saved. `src/lib/ocr-parse.ts` continues to extract business fields using fixed rules, which users review before saving.

- Supported inputs: PDF, PNG, JPEG, TIFF, and BMP; maximum **25 MiB** and **10 PDF pages**.
- For PDFs, PDF.js first extracts text page by page. A page with fewer than 20 non-whitespace text characters is rasterized locally with PDF.js and `@napi-rs/canvas`, then OCRed with Tesseract.js. This supports text-only, scanned, and mixed PDFs.
- Images and rendered PDF pages use German, English, or both. The server allows two simultaneous OCR jobs and a maximum processing time of 180 seconds.
- PDF page text is returned to the existing extraction flow. Table structure and searchable PDF output are not generated.
- Invalid, encrypted, oversized, too-large-page-count, timed-out, or incomplete documents produce explicit errors. Uploads remain available for manual processing.
- Debugging: in dev mode (`npm run dev`) each recognition is logged to the browser console as a collapsed `[OCR] <file>` group with the extracted fields, errors, warnings and the raw recognized text. Production builds neither log nor send the raw text to the browser.

## Field extraction

`extractFromText` in `src/lib/ocr-parse.ts` fills document type, vendor, contact, amount, document date, due date, trade and expense category. Machine-readable data always wins over recognized text:

| Field | Order of sources |
| --- | --- |
| Amount | e-invoice XML (amount due, else grand total) → TSE receipt QR (sum of gross per VAT rate) → GiroCode amount → scored OCR candidates |
| Vendor | matched contact → e-invoice seller → GiroCode recipient → retail chain list → letterhead rules |
| Document date | e-invoice issue date → TSE QR end time (German local date) → printed TSE start/stop time → labelled date (`Rechnungsdatum`, `Datum`) |
| Due date | e-invoice due date → explicit `zahlbar bis` date → relative terms (`innerhalb 14 Tagen`, `30 Tage netto`, `sofort`) from the document date |

Machine-readable sources (parsers in `src/lib/ocr-structured.ts`):

- **QR codes**: decoded on the server with [`zxing-wasm`](https://github.com/Sec-ant/zxing-wasm) (MIT). The WASM binary is read from `node_modules`, never fetched. Images are decoded directly; scanned PDF pages are decoded from the rendered page. Text PDF pages are rendered only when they contain images. Decode errors are ignored.
  - **TSE QR** on German receipts (KassenSichV/DSFinV-K: `V0;…;Kassenbeleg-V1;Beleg^…`): the gross total and the transaction time.
  - **GiroCode** (EPC QR) on invoices: recipient, IBAN, amount.
- **E-invoices**: XML attachments of ZUGFeRD/Factur-X PDFs (CII, including ZUGFeRD 1.0) and embedded XRechnung UBL. Uploading a plain `.xml` XRechnung file is not supported because uploads must be PDFs or images.

**Total scoring.** Every amount gets the label in front of it on the same line, or from a short label-only line above it. Labels with several columns, such as `Netto MwSt Brutto`, map onto the amounts in the rows below. Typical OCR digit confusions inside amounts are repaired first (`O→0`, `S→5`, `B→8`, `l→1`). Candidates are weighted: `Rechnungsbetrag`/`zu zahlen`-style labels first, then `Brutto`, `Summe`/`Total`, and payment lines (`Kartenzahlung`, `Mastercard`, `Betrag`). Excluded: subtotals, discounts, net, VAT, `gegeben`/`Rückgeld`, `inkl. MwSt`, and unit-price columns.

A candidate gains points when another source confirms it:

- the same value is printed again;
- net + VAT equals it;
- the VAT amount matches 19 % or 7 % of it;
- given − change equals it.

Rows of a multi-rate VAT table are summed. A misread total such as `TOTAL 29,19` therefore loses against `Betrag 55,19`, `MASTERCARD 55,19` and `NETTO 46,38 + MWST 8,81`.

**Second OCR pass.** When the first Tesseract pass (automatic layout, PSM 3) finds amounts but no confirmed total, the image is read again as one uniform block (PSM 6). For PDFs, this applies only to the last scanned page. Both texts are scored together, and agreement between them counts as confirmation. Tesseract normally splits a receipt's label column and amount column into separate blocks, and PSM 6 keeps each label next to its amount.

**Vendor and contact.**

- A known contact is matched by VAT ID, tax number or IBAN (from the contact's notes), by website or e-mail domain (public mail providers are ignored), by phone number, or by company or name. Ties produce no match. Lines from the recipient address block (`Familie`, `Herrn`, `Frau`, `An`, …) are never used to match a contact or name the vendor.
- For offers and invoices, a matched contact is preselected in the form.
- Without a contact match, the vendor is taken in this order:
  1. a known retail chain;
  2. a letterhead line with a legal form;
  3. the first plausible letterhead line;
  4. the sender line above the address window (`Firma · Straße · PLZ Ort`).
  
  A single-word letterhead name is combined with a nearby trade word, so `Krause` + `Dachdeckerei` becomes `Dachdeckerei Krause`. Letter-spaced headings are joined.

**Test corpus.** `src/lib/ocr-fixtures/` contains anonymised real OCR output, with its original recognition errors, plus synthetic layouts. `ocr-fixtures.test.ts` checks type, vendor, amount and dates for every entry. Add a fixture whenever a real document is filled wrongly.

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
