# Decisions

Short ADRs: context → decision → consequences.

### 1. Euros, German as default language
Private use in Germany. Amounts are always in euros; German is the default interface language (see #16 for English).

### 2. Local storage with SQLite
Project data, uploaded files, accounts, and settings stay on the user's own machine or server. SQLite is the only application database; Docker Compose runs the app and OCR locally. No hosted database, auth, or storage is required.

### 3. Self-hosted recognition with rule-based field extraction
Originally an AI service was replaced with Tesseract + poppler so receipts stay on user-controlled infrastructure. OCR now has interchangeable self-hosted Tesseract and Docling Serve adapters. Optional local Docling layout/table models are explicitly permitted; cloud OCR, external AI APIs, and LLM-based business-field extraction remain excluded. Business fields still come from fixed, tested rules, independently of the recognition provider. Local vision LLMs (Ollama) remain out of scope.

### 18. Private shared OCR settings and unrestricted admin destinations
One active OCR configuration serves all project members; only admins can inspect/change/test it. Saved settings override the legacy `OCR_URL`, including explicit disable. API keys are encrypted with a separate environment key and never sent to React. At the user's explicit request all HTTP(S) destinations are allowed, including internal and public addresses; there is no network allowlist, DNS pinning, or SSRF isolation. Configuration therefore requires trusted admins. Redirects are rejected; HTTP exposes document bytes and credentials in transit. Processing tests use a synthetic raster rather than private documents. OCR text/tables are transient, not additional business records.

### 4. Recognition only fills fields; it never overwrites them
Recognized values are set only when present; users always review before saving.

### 5. No double counting in the budget
A quote and an invoice for the same work describe the same money. Expected costs use the most informative value rather than the sum. Only accepted quotes count.

### 6. Expenses always count; reimbursements are not credited back
Expenses count as money spent; "reimbursed" does not change the budget (shown separately).

### 7. One shared project, roles instead of ownership
Household members work together. All members see all data; roles are admin/member/pending, kept in a separate table (protection against privilege escalation).

### 8. Initial setup instead of open registration
With no account, the app always starts setup and creates the admin; admins create further accounts. New OIDC accounts await approval unless a verified email matches an existing account.

### 9. Optional OIDC implemented in-house
For Pocket ID and compatible providers, without extra dependencies: Authorization Code + PKCE with discovery. Password authentication remains local and OIDC is disabled unless explicitly configured.

### 10. Requests as an offer status
Instead of a separate table, "Requested" is a status of offers, with a request date. A request becomes an offer without copying data; requests affect neither the budget nor price comparisons.

### 11. Contacts in a separate table; company name retained
Quotes/invoices optionally reference a contact. The "Company" free-text field remains (legacy data, one-off companies) and is filled automatically when a contact is selected.

### 12. Card view only for quotes
Cards help compare several quotes for the same work. Invoices are not compared; they use a table with filters, sorting, and totals.

### 13. Optional date/time fields shown as buttons
Safari shows today's date in empty date fields, which looks prefilled. Optional fields therefore appear only after clicking and can be cleared. Dates like the offer date are never prefilled.

### 14. Calendar subscription via a secret link
Calendar apps cannot sign in. The endpoint is public and read-only, protected by a random, renewable token stored only server-side.

### 15. Load the entire project as one data object
Data volumes are small; a single load keeps all pages consistent and simple. Very large projects would need pagination.

### 17. Payment sources instead of extra budgets
Some costs (e.g. tools) are not financed by the bank loan. Rather than separate budgets with amounts, expenses and invoices reference a payment source (`budget_pot_id`) with a `deducts_from_budget` flag; items from non-deducting sources are excluded from all total-budget figures but stay visible in the expenses overview.

### 16. Internationalization with i18next, German as default
The interface supports German and English via JSON language files (`src/locales/<lang>/<namespace>.json`). The language is chosen during setup and in Settings and stored per browser. Amounts remain in euros; number/date formats follow the language. Documentation is written in English.
