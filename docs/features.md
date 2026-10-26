# Features

Visible areas appear in the left navigation in the account's chosen order. On mobile, the bottom bar offers the first four visible areas and a **More** menu for the remaining areas and Settings. The shared top bar provides appearance and account controls. All approved users work on the **same project**.

## Installable app & offline use
Bauplan can be installed from a supported browser and used offline after signing in and opening the workspace on that device. Workspace edits are saved locally and synchronized when online; document uploads are queued. Conflicting server edits require a manual choice, and sign-out explicitly warns before discarding pending work. See [offline use](offline.md) for setup and limitations.

## Overview (dashboard)
- Metrics: total budget, expected costs, remaining budget, already paid.
- Open/overdue invoices, upcoming events and tasks.
- Quick actions: upload a document (also via camera), create a task or cost item.
- On the very first visit without a project: create a project (name, address, budget, time period).
- Edit the shared project's name, address, total budget, and dates from the sidebar project card or the account menu (also on mobile). The Budget page opens the same editor.

## Budget
- **Trades** (e.g. roofing, electrical) with their own budget and color.
- **Cost items** per trade with planned amounts.
- Per item and trade: planned, committed, expected, paid, variance. Details in [budget.md](budget.md).

- **Payment sources** (e.g. Bank, Private, managed in Settings): each source decides whether its expenses/invoices are deducted from the total budget; the expenses page filters and totals by source.

## Quotes & invoices
**Quotes**
- Status: **Requested** → **Received** → **Accepted** / **Rejected**.
- "Record request": company/contact, work, request date — without an amount. Shows "requested N days ago" and a count of open requests.
- "Quote received" opens the request to add amount and quote date (never prefilled).
- Card view grouped by cost item or trade; highlights the **cheapest** quote and shows the difference for others. Requests are excluded from comparison.
- Table view with **sortable columns**.
- Filters: free text, status, trade, contact; "Reset".
- Linkable to a contact, trade, cost item, and document.

**Invoices**
- Table with sortable columns (default: due date).
- Derived status: **Paid**, **Overdue**, or **Open**; clicking the status toggles paid/unpaid.
- Totals above the table (total, open, overdue, paid), reflecting the filters.

## Expenses
General expenses such as hardware store receipts or fees.
- Status: **open**, **paid**, **submitted**, **reimbursed**.
- Categories: hardware store, materials, tools, disposal, fees, transport, meals, other.
- Link to receipt (document), trade, and cost item; search, status filter, totals by status.
- Expenses always count against the budget.

## Documents
- Upload images and PDFs (up to 25 MB), also directly from the camera.
- Categories, tags, description; assign to trade, task, or cost item.
- Responsive document rows keep filenames readable, put related records on separate lines, and place actions in a dedicated lower toolbar on smaller screens. Desktop keeps actions beside the document details; touch targets remain at least 44 × 44 CSS pixels.
- After upload: text recognition (self-hosting only) and an "Assign as" dialog (expense, invoice, quote, or just store). See [ocr.md](ocr.md).

## Tasks
- Title, trade, phase, priority, status, due date, notes.
- Open tasks with due dates appear in the calendar and the calendar subscription.

## Calendar
- Event types: **Event**, **Deadline**, **Work**.
- Start date required; **start time, end date, end time optional**. Without an end date, an entry lasts one day.
- Multi-day entries appear on each day (following days marked "↳").
- Optional date/time fields start as an "Add date/time" button and can be cleared with "×".
- Validation: end not before start.
- Month and list views; iCal subscription: [calendar-feed.md](calendar-feed.md).

## Collections
Ideas and inspiration (flooring, tiles, lighting …): collection, title, link, image, notes, tags, room, trade, price, favorite; filterable.

## Contacts
- Person, company, trade, phone, email, website, address, notes; search and trade filter.
- Each card lists linked quotes with status; selectable in quote and invoice forms.

## Forms (throughout the app)
- **Scan receipt** above each create form: photo or file → fields are prefilled, the document is saved and linked.
- **"+ New"** next to trade, cost item, and contact to create and select an entry directly.

## Settings
- **Navigation:** approved users can reorder or hide page links under Personal preferences, then save to their account. The sidebar follows this order; mobile shows the first four visible pages and puts the rest under More. Settings always stays available, even if all page links are hidden. Restore default layout resets the draft; Save applies it. Hidden links do not restrict page access. Preferences synchronize on reload, sign-in, and window focus.
- Accessible tabs separate personal preferences (appearance, account, language), project configuration (storage and payment sources), and admin-only administration (users, calendar feed, OIDC, OCR). Arrow keys switch tabs, the tab bar wraps on small screens, and switching tabs preserves unsaved form entries until leaving the page.
- Account and sign-out; storage mode display.
- **Language:** German or English, chosen during setup or in Settings; saved per browser.
- **Appearance:** Current, Blue, Green, or Violet palette, independently combined with Light, Dark, or System mode (default: Current + System). Settings has palette previews and mode controls; the desktop/mobile header has a quick mode menu. Changes save automatically per approved user account and synchronize on sign-in, reload, and window focus. System follows each device's own OS preference. The browser remembers the last appearance for the sign-in/setup screens; the signed-in account always takes precedence. Failed saves restore the previous choice and display an error.
- **Visual design and accessibility:** coordinated neutral light/charcoal dark surfaces, restrained accents, distinct control boundaries, and separate readable status colors. Settings groups personal, project, and administrative options. Theme controls retain keyboard focus while saves are serialized and rapid choices are coalesced; a failed save restores the latest confirmed preference. Visible focus outlines, reduced-motion support, forced-colors selection outlines, and labeled/patterned budget chart series support non-pointer and non-color-dependent use.
- Admins only: user management, calendar subscription, OIDC sign-in, and shared OCR settings.
- **OCR:** local Tesseract.js recognition for German/English, admin-managed offline language models, embedded PDF text extraction, and local rendering/OCR for scanned pages. See [local OCR](ocr.md).
