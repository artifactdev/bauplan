## Architecture rules
- All data access goes through server functions in `src/lib/data.functions.ts` backed by the SQLite repository in `src/server/repo.ts`.
- Table/column list lives once in `src/lib/schema.ts`; SQLite creates or updates tables from it at startup.
- Budget math lives in `src/lib/calc.ts` (with tests); expected cost never adds offers and invoices for the same item.
- App pages live under the `_ws` pathless layout (ssr: false); it sends to `/setup` while no account exists, else to `/auth` when signed out.
- Auth uses local users/sessions (PBKDF2, httpOnly cookie); optional OIDC routes are under `/api/oidc/*`. Roles are admin/member/pending (pending = no data); all members share one project.
- OCR runs in-process with `tesseract.js` in `src/server/ocr/`; language models are downloaded explicitly by an admin to `DATA_DIR/ocr-models` (no OCR container, no cloud/remote AI). Business-field extraction remains rule-based in `src/lib/ocr-parse.ts`. Never add OCR settings to the shared Workspace.
- The public iCal feed (`/api/public/calendar/$token`) is gated only by a random secret token stored in local `app_settings`; why: calendar apps cannot sign in.
- All UI text comes from i18next JSON files `src/locales/<lang>/<namespace>.json` (auto-loaded by `src/i18n/index.ts`); never hard-code display strings; why: the app is multilingual and languages are added by dropping in JSON files.
- Documentation in `docs/` and README is written in English; why: user requirement.

## Keeping the website and docs current
- Every feature or UI change must keep the public website in sync in the same change: update the matching text in `site/index.html` (and add, reword or remove a feature section when a page, capability or limit changes), then capture fresh screenshots with `npm run demo` + `npm run site:screenshots`; why: the site is the project's public face and silently rots otherwise.
- When a screenshot no longer matches the UI, re-capture it instead of editing the image; adjust `scripts/screenshots.mjs` (routes, clicks, `SHOTS` names) or `scripts/demo-seed.mjs` (fictional data) so the picture still tells the right story.
- New or renamed pages need their screenshot referenced in `site/index.html` (feature section or gallery) and listed in `site/README.md`; delete captures and references of features that no longer exist.
- Update `docs/features.md` and the affected `docs/*.md` pages together with behaviour changes, and keep `site/README.md` accurate for the demo and screenshot workflow; why: README and `docs/` are linked from the site and the repository.
- The website itself stays German-only, vanilla HTML/CSS/JS in `site/`, with no external fonts, CDNs, analytics or build step, and only relative asset paths; why: it is a GitHub project page under `/bauplan/` and must not leak visitor data.
