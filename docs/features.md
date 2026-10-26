# Features

All areas are in the left navigation (mobile: bottom bar). All approved users work on the **same project**.

## Overview (dashboard)
- Metrics: total budget, expected costs, remaining budget, already paid.
- Open/overdue invoices, upcoming events and tasks.
- Quick actions: upload a document (also via camera), create a task or cost item.
- On the very first visit without a project: create a project (name, address, budget, time period).

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
- Account and sign-out; storage mode display.
- **Language:** German or English, chosen during setup or in Settings; saved per browser.
- **Appearance:** Current, Blue, Green, or Violet palette, independently combined with Light, Dark, or System mode (default: Current + System). Settings has palette previews and mode controls; the desktop/mobile header has a quick mode menu. Changes save automatically per approved user account and synchronize on sign-in, reload, and window focus. System follows each device's own OS preference. The browser remembers the last appearance for the sign-in/setup screens; the signed-in account always takes precedence. Failed saves restore the previous choice and display an error.
- Admins only: user management, calendar subscription, OIDC sign-in, and shared OCR settings.
- **OCR:** select self-hosted Tesseract or Docling Serve, service URL, optional encrypted API key, recognition language, and a synthetic processing test. See [OCR configuration and destination policy](ocr.md).
