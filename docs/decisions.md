# Decisions

Short ADRs: context → decision → consequences.

### 1. Euros, German as default language
Private use in Germany. Amounts are always in euros; German is the default interface language (see #16 for English).

### 2. Local storage with SQLite
Project data, uploaded files, accounts, settings, and local OCR models stay on the user's own machine or server. SQLite is the only application database; Docker Compose runs only the app. No hosted database, auth, OCR, or storage service is required.

### 3. Self-hosted recognition with rule-based field extraction
Recognition runs in-process with Tesseract.js. PDF.js extracts existing text and renders scanned pages locally; `@napi-rs/canvas` supplies the render target. Admins explicitly download pinned German/English models into persistent local storage; normal processing is offline. No OCR services, subprocesses, cloud OCR, external AI APIs, or LLM-based business-field extraction are used. Business fields come from fixed, tested rules.

### 18. Private shared OCR settings and local models
Only admins can inspect/change shared OCR settings, test recognition, or manage language models. Legacy provider URLs and encrypted API keys are ignored and removed on save. Model downloads use a fixed, version-pinned source and are explicit; OCR processing itself is local. Tests use a synthetic raster, never private documents. OCR text is transient, not an additional business record.

### 4. Recognition only fills fields; it never overwrites them
Recognized values are set only when present; users always review before saving.

### 5. No double counting in the budget
A quote and an invoice for the same work describe the same money. Expected costs use the most informative value rather than the sum. Only accepted quotes count.

### 6. Expenses always count; reimbursements are not credited back
Expenses count as money spent; "reimbursed" does not change the budget (shown separately).

### 7. One shared project, roles instead of ownership
Household members work together. All members see all data; roles are admin/member/pending, kept in a separate table (protection against privilege escalation).

### 8. Initial setup instead of open registration
With no account, the app always starts setup and creates the admin; admins create further accounts. OIDC sign-ins are matched to existing accounts by subject, then by email (the configured provider is trusted for email addresses); only unknown people get a new account that awaits approval.

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
