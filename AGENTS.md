## Architecture rules
- All data access goes through server functions in `src/lib/data.functions.ts` backed by the SQLite repository in `src/server/repo.ts`.
- Table/column list lives once in `src/lib/schema.ts`; SQLite creates or updates tables from it at startup.
- Budget math lives in `src/lib/calc.ts` (with tests); expected cost never adds offers and invoices for the same item.
- App pages live under the `_ws` pathless layout (ssr: false); it sends to `/setup` while no account exists, else to `/auth` when signed out.
- Auth uses local users/sessions (PBKDF2, httpOnly cookie); optional OIDC routes are under `/api/oidc/*`. Roles are admin/member/pending (pending = no data); all members share one project.
- OCR uses server-only adapters in `src/server/ocr/` for self-hosted Tesseract or Docling Serve (local models allowed, no cloud/remote AI); private admin settings override the legacy `OCR_URL` default. Business-field extraction remains rule-based in `src/lib/ocr-parse.ts`. Never expose API keys or add OCR settings to the shared Workspace; all HTTP(S) destinations are deliberately permitted, without SSRF isolation.
- The public iCal feed (`/api/public/calendar/$token`) is gated only by a random secret token stored in local `app_settings`; why: calendar apps cannot sign in.
- All UI text comes from i18next JSON files `src/locales/<lang>/<namespace>.json` (auto-loaded by `src/i18n/index.ts`); never hard-code display strings; why: the app is multilingual and languages are added by dropping in JSON files.
- Documentation in `docs/` and README is written in English; why: user requirement.
