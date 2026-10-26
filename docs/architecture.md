# Architecture

## Stack
- **TanStack Start** (React 19, Vite 8, SSR + server functions), TypeScript, Tailwind CSS v4, shadcn/ui.
- Runs locally as a Node server, directly or in Docker.
- App data, accounts, and settings are stored in **SQLite** (`node:sqlite`) under `DATA_DIR`; uploaded files are stored on the local filesystem under `UPLOADS_DIR`.
- Optional OIDC sign-in can contact an identity provider only when explicitly configured.

## Layers
```text
Pages (src/routes/_ws/*)              UI, forms (EntityDialog), filters
   │  useWorkspace / useMutations   (React Query, key ["ws"])
   ▼
Server functions (src/lib/*.functions.ts)
   data.functions.ts   getWorkspace, createRow, updateRow, deleteRow, uploadDocument
   auth.functions.ts   Setup, sign-in, users, OIDC, calendar subscription
   ocr.functions.ts    analyzeDocument
   │
   ▼
SQLite repository (src/server/repo.ts)
```
The entire project is loaded as a single "Workspace" object (all tables). For a private renovation project the amount of data is small, which keeps the interface simple.

## Data model (`src/lib/schema.ts`)
The single source of truth for tables and columns. The SQLite schema is generated from it; missing columns are added at startup using `ALTER TABLE`.

| Table | Purpose |
| --- | --- |
| projects | Project (name, address, total budget, time period) |
| trades | Trades with budget and color |
| cost_items | Cost items with planned amount |
| offers | Quotes, including requests (status requested/received/accepted/rejected, contact, request date) |
| invoices | Contractor invoices (contact, due date, paid) |
| expenses | General expenses/receipts with status |
| documents | Files with category, tags, links |
| tasks | Tasks |
| events | Calendar events (start/end, optional times) |
| ideas | Collections |
| contacts | Contractor/company contacts |

Authentication and app settings use the local `app_users`, `app_sessions`, and `app_settings` tables.

OCR configuration is private `app_settings` data, never included in the Workspace. Admin-only server functions in `data.functions.ts` access it through repository methods. Optional API keys use AES-256-GCM and a separate `OCR_SETTINGS_KEY`. Server-only adapters under `src/server/ocr/` normalize self-hosted Tesseract and Docling Serve responses before the existing rule-based extractor runs. Saved configuration overrides `OCR_URL`; explicit disable is preserved. Local Docling models are permitted, but cloud/remote AI services are not. See [OCR](ocr.md) for destination-policy trade-offs and limits.

`cleanRow()` only lets known columns through and normalizes numbers/booleans.

## Routing
- `/setup` – initial setup, `/auth` – sign-in.
- `_ws` – layout without its own path (client-side); checks sign-in/setup and renders navigation. Pages: `/`, `/budget`, `/angebote`, `/ausgaben`, `/dokumente`, `/aufgaben`, `/kalender`, `/sammlungen`, `/kontakte`, `/einstellungen`.
- Server routes: `/api/files/*` (SQLite files), `/api/oidc/*` (self-hosted OIDC), `/api/public/calendar/*` (iCal).

## Key modules
| File | Purpose |
| --- | --- |
| `src/lib/calc.ts` | Budget calculations |
| `src/lib/events.ts` | Multi-day events, validation, labels |
| `src/lib/ics.ts` | iCal generation |
| `src/lib/ocr-parse.ts` / `scan-map.ts` | Rule-based recognition / form mapping |
| `src/lib/ocr.ts` / `src/server/ocr/` | OCR contracts, private settings, encryption, preflight, provider adapters |
| `src/components/app/EntityDialog.tsx` | Generic form (fields, scan, "+ New", optional date fields) |
| `src/components/app/InvoicesTable.tsx` | Invoice table with filters, totals, sorting |
| `src/server/auth-core.ts` | Core auth logic (hashing, OIDC decision) |
| `src/i18n/index.ts` | Translation setup and language switching |

## Internationalization (i18n)
- Uses i18next + react-i18next, initialized in `src/i18n/index.ts`.
- Translations are JSON files at `src/locales/<lang>/<namespace>.json` and are loaded automatically.
- Supported languages: German (default) and English.
- The language is selected during first-run setup and in Settings, and stored per browser in localStorage (key `bauplan.lang`); if nothing is stored, the browser language is used.
- Amounts remain in euros; number and date formats follow the selected language (`src/lib/format.ts`).
- To add a language, add a folder with the same JSON files and an entry in `LANGUAGES`.
