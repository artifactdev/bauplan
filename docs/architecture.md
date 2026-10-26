# Architecture

## Stack
- **TanStack Start** (React 19, Vite 8, SSR + server functions), TypeScript, Tailwind CSS v4, shadcn/ui, and `vite-plugin-pwa`.
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

The service worker precaches the generic app shell and versioned static assets only; it excludes `/api/*` and does not cache authenticated workspace responses or private files. `src/lib/offline-store.ts` stores account-keyed workspace snapshots, queued row changes, and upload blobs in IndexedDB. The offline identity marker is browser-profile local and is set only after a successful online session check. The `_ws` route can use that marker and cached snapshot while disconnected.

Queued row changes include the complete row seen before editing. The server applies each operation in a SQLite `BEGIN IMMEDIATE` transaction only if the current row still matches that base snapshot. `app_sync_operations` makes retries idempotent. A mismatch is retained as a conflict rather than overwritten; the user can discard it or explicitly rebase the local version. Uploads use a stable document ID so retries after a lost response do not create duplicate document rows. Sign-out clears the account's snapshot, changes, and queued files; pending work requires an explicit discard confirmation.

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

Portable backups are created and validated in `src/server/backup.ts` through admin/setup server functions in `src/lib/data.functions.ts`. A versioned ZIP contains SQLite table data and uploads; it intentionally omits active `app_sessions`. Restore validates archive paths, schema rows, file sizes, and SHA-256 hashes before replacing database rows in a transaction and swapping the upload directory. Setup restore is guarded by a transaction-level empty-user check to avoid racing initial admin creation.

Private appearance preferences live in `app_user_appearance`, keyed by authenticated user ID, with its DDL defined in `src/lib/schema.ts`. This table is deliberately outside the shared Workspace registry. Approved-user server functions in `data.functions.ts` read/write validated palette and mode values through the repository; account deletion removes the associated preferences. Existing accounts without a row use Current + System.

Private navigation preferences live in `app_user_navigation`, also outside Workspace, with DDL in `src/lib/schema.ts`. Approved-user server functions use only the authenticated account ID; the repository validates the complete ordered page list and hidden subset before storing JSON. Account deletion removes these preferences. User-scoped React Query data refreshes on sign-in, reload, and window focus. Settings edits remain local drafts until explicitly saved; failures retain the draft and leave the confirmed navigation unchanged. Desktop and mobile derive visible links from the same ordered list, with the first four on the mobile bar and the rest under More. Settings cannot be hidden. This is presentation customization, not access control.

The root appearance provider applies semantic CSS tokens using `data-theme` and `.dark` on the document element, including dialogs and notifications. A small pre-paint script applies the validated `bauplan.appearance` browser cache to prevent a light-mode flash. This cache intentionally survives sign-out for login/setup; an approved account's preferences load before workspace content and override it. User-scoped React Query state refreshes on window focus and visibility changes, with in-flight saves protected against stale refreshes. Other devices do not receive live pushes: last successful write wins. System mode tracks the local OS without writing the resolved light/dark value back to the account.

Appearance controls stay enabled during persistence to preserve native radio keyboard focus. The provider serializes writes and coalesces intermediate choices, previews the newest selection immediately, and rolls back to the latest confirmed value on failure. Chart tokens are independent of theme accents to prevent duplicate series colors; the budget chart also uses patterns and labeled legends. Semantic status foreground/background tokens are opaque pairs rather than opacity-derived badge fills. Decorative borders and interactive boundaries have separate contrast roles. `theme-accessibility.test.ts` checks text (4.5:1), interactive/focus cues and chart/background contrast (3:1), and distinct chart tokens across all eight palette/mode combinations. These checks are regression guards, not a full WCAG certification.

OCR settings are private `app_settings` data, never included in the Workspace. Admin-only server functions in `data.functions.ts` manage the local engine and language models. `tesseract.js` recognizes images and locally rasterized scanned PDF pages; PDF.js extracts existing page text first. Language models are explicitly downloaded to `DATA_DIR/ocr-models` and reused offline. Legacy service URLs and credentials are ignored and removed when settings are saved. OCR text remains transient; the existing rule-based extractor handles business fields. See [local OCR](ocr.md).

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
