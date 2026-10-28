# Features

Visible areas appear in the left navigation in the account's chosen order. On mobile, the bottom bar offers the first four visible areas and a **More** menu for the remaining areas and Settings. The shared top bar provides account controls and shows connection status only when offline or changes await synchronization. Appearance is configured only in personal Settings. All approved users work on the **same project**.

## Installable app & offline use

Bauplan can be installed from a supported browser and used offline after signing in and opening the workspace on that device. Workspace edits are saved locally and synchronized when online; document uploads are queued. Conflicting server edits require a manual choice, and sign-out explicitly warns before discarding pending work. See [offline use](offline.md) for setup and limitations.

## Sign-in

The responsive sign-in page uses the installed app's icon, a desktop interior photograph, and a compact mobile form. Password-manager autofill and optional OIDC sign-in remain available. The decorative photograph is hosted locally, so opening the page does not contact an external image service. Photo: [Spacejoy on Unsplash](https://unsplash.com/photos/RqO6kwm4tZY), used under the [Unsplash License](https://unsplash.com/license).

## Backups

Admins can export and restore a complete database-and-documents backup from Settings. A backup can also be imported during initial setup. Restoring replaces existing data and invalidates sessions; see [backups and restore](backups.md).

## Overview (dashboard)

- Metrics: total budget, expected costs, remaining budget, already paid.
- Paid and open expense totals, upcoming events and tasks.
- Quick actions: upload a document (also via camera), create a task or cost item.
- On the very first visit without a project: create a project (name, address, initial bank budget, time period).
- Edit the shared project's name, address, initial bank budget, and dates from the sidebar project card or the account menu (also on mobile). The Budget page opens the same editor. The overall budget is calculated from this initial amount plus additional funding.

## Budget

- **Additional funding:** separately record received money from family or grants, with source, amount, date, and optional notes. The total budget includes these receipts without changing the initial bank budget or the bank loan. Multiple receipts per source, editing, and deletion are supported. Source cards show received funds, assigned expenses, and the remaining amount. Select the corresponding payment source when recording an expense; expenses are deducted once, not again when recording income. See [budget logic](budget.md).
- **Trades** (e.g. roofing, electrical) with their own budget and color.
- **Cost items** per trade with planned amounts.
- Per item and trade: planned, committed, expected, paid, variance. Details in [budget.md](budget.md).

- **Payment sources** (e.g. Bank, Private, managed in Settings): each source decides whether its expenses are deducted from the total budget; the expenses page filters and totals by source.

## Quotes

- **View document** opens the integrated document viewer in both card and table views, including all-page PDF rendering and full-screen viewing, without opening a new tab. The viewer still offers an explicit action to open the original file.
- Status: **Requested** → **Received** → **Accepted** / **Rejected**.
- "Record request": company/contact, work, request date — without an amount. Shows "requested N days ago" and a count of open requests.
- "Quote received" opens the request to add amount and quote date (never prefilled).
- Card view grouped by cost item or trade; highlights the **cheapest** quote and shows the difference for others. Requests are excluded from comparison.
- Table view with **sortable columns**.
- Filters: free text, status, trade, contact; "Reset".
- Linkable to a contact, trade, cost item, and document.

## Expenses

All invoices and receipts, including contractor invoices, partial invoices, hardware store purchases, and fees, are recorded here. There is no separate invoice workflow.

- **Create expense** opens one form, with or without a receipt. Optionally select an existing document or expand **Add document** to upload, photograph, or scan a receipt; recognized values prefill the editable fields. The same document options are available when editing an expense. No separate manual/upload workflow or assignment step is needed on this page.
- Status: **open**, **paid**, **submitted**, **reimbursed**.
- Optional invoice due date, planned/actual payment date, payment source, contact, and related quote. Choosing a quote prefills its company, contact, trade, and cost item, but never replaces the expense amount or dates. These assignments remain editable. Multiple expenses can reference the same quote for installments.
- Recognized invoices prefill the matched contact and due date and start as **open** when creating an expense; uploading a replacement document while editing preserves the current payment status. Review the extracted values before saving. Receipts retain the paid-by-default workflow.
- **Overdue** is derived from an open expense whose due date is before today. Both desktop and mobile show the due date and overdue status.
- Categories: contractor, hardware store, materials, tools, disposal, fees, transport, meals, other.
- Search and filter by status (including overdue), trade, contact, quote, and payment source; sort by newest date, earliest due date, highest amount, or description. Status cards show workspace totals; the table/card footer shows the filtered sum.
- Only expenses linked to a valid cost item and a budget-deducting payment source (or no source) affect the project budget. Open expenses count toward incurred costs, but not paid totals. An accepted quote and its expenses are never added together for the same cost item.
- Existing invoices are migrated automatically to expenses at startup, preserving their amount, dates, payment state/source, and document/contact/cost-item links. The same conversion is applied when importing older backups.

## Documents

- **Optional Paperless-ngx integration:** personal archive search and reviewed imports, opt-in automatic Paperless → Bauplan imports by tag with source-ID/content duplicate prevention, manual multi-document archiving of Bauplan scans/uploads, source links, known-presence filters and manual status checks. Local files remain independent; later changes and deletions do not synchronize. See [Paperless integration](paperless.md).
- Upload images and PDFs (up to 100 MB), also directly from the camera.
- **Document preview:** PDFs use a locally hosted PDF.js reader instead of the browser's embedded PDF plugin, including on iOS. Scroll through every page, zoom, fit to width, or expand the preview to fill the app viewport. This does not depend on the browser Fullscreen API. Nearby pages are rendered on demand, off-screen canvases are released, and rendering resolution is bounded to limit mobile memory usage. The original file remains available to open/download. Images can also be viewed full-screen. PDFs never leave the self-hosted app for viewing.
- **Scan document**: wherever documents or receipts are uploaded, scan paper with the camera or import photos. Bauplan detects the page edges, corrects perspective, and lets you adjust the four corners, rotate, and apply filters (color, grayscale, contrast, black & white). Scan up to 20 pages, reorder, retake, or remove them; the result is saved as one PDF through the normal upload. Processing runs entirely in the browser (OpenCV.js in a Web Worker); images are never sent to external services. The camera needs HTTPS (or localhost); image import works everywhere. Text recognition reads at most the first 10 pages.
- **Live scan assistance:** analysis reuses a low-resolution canvas and transfers disposable frames to the worker, with only one detection in flight. Supported browsers schedule analysis against fresh video frames; others use a paced fallback. Only analysis resolution/cadence adapts on slower devices, not the saved scan's resolution. Candidate ranking uses edge support and geometry, and the outline is smoothed and expires when observations become stale.
- **Automatic capture:** optional and off when opening the scanner. Enable the switch to photograph a fully visible, sufficiently large document after several consistent detections held for at least 1.2 seconds with adequate estimated detail. Movement, blur, weak edges, clipped pages, backgrounding, and old observations reset eligibility. The photo opens the existing crop/review step; nothing is automatically saved. The choice lasts for the current scanner session, including adding another page. Manual capture and image import remain available if detection fails. This is a browser-based heuristic, not Apple's native document scanner; feature support and actual camera performance must be checked on the target device.
- Categories, tags, description; assign to trade, task, or cost item.
- Responsive document rows keep filenames readable, put related records on separate lines, and place actions in a dedicated lower toolbar on smaller screens. Desktop keeps actions beside the document details; touch targets remain at least 44 × 44 CSS pixels.
- The mobile document actions menu closes when selecting an action, clicking outside, or pressing Escape; cancelling the delete confirmation also leaves the menu closed.
- After upload: text recognition (self-hosting only) and an "Assign as" dialog (expense, quote, or just store). Recognized invoices are filed as expenses. See [ocr.md](ocr.md).

## Tasks

- **Push notifications:** assigning a task to another approved user sends a generic notification to their opted-in devices after the server saves it, including offline sync. Open tasks remind the assignee; open quote/payment deadlines and timed calendar appointments remind all opted-in members. Tapping opens the matching area (Tasks, Quotes, Expenses or Calendar) and its record editor. Device activation and a test button are in personal Settings. See [push setup and reminder rules](operations.md#push-notifications).

- Title, trade, phase, priority, status, optional start and due dates, notes. The due date cannot be before the start.
- Mobile task rows reserve the main width for a wrapping, tappable title, with metadata beneath and dates/actions in a separate footer. Completion has a 44-pixel touch target; filters share the available width instead of forcing horizontal overflow.
- Tasks with both dates appear on every day from start through due date in the calendar and as multi-day entries in iCal and the read-only CalDAV calendar. A start-only or due-only task appears on that single day; undated tasks do not appear in the calendar. Completed tasks remain excluded from calendar subscriptions. Overdue status and push deadline reminders still depend on the due date, not the start.

## Calendar

- Clicking an entry opens its original record in a modal without leaving the calendar: tasks open the task editor, offer decision deadlines open the quote editor, and appointments open the appointment editor. This works in both month and list views; saving updates the original record rather than creating a separate calendar copy.
- Existing appointments can also be deleted from their editor after confirmation, including when opened from the month view. The editor closes only after deletion succeeds.
- Event types: **Event**, **Deadline**, **Work**.
- Start date required; **start time, end date, end time optional**. Without an end date, an entry lasts one day.
- Multi-day entries use continuous horizontal bars across date columns in month/week views.
  Bars wrap at week boundaries, keep a consistent row within each week, and mark clipped
  continuations with open, dashed ends. On narrow calendars, the month uses per-day colored dots
  and overflow counts instead of squeezed event labels; tapping a day opens all its entries.
  Day view shows the current day number within the range.
  Timed multi-day entries are shown above the day/week hourly grid rather than repeated as
  full-height daily blocks; their original dates/times and editors remain unchanged.
- Optional date/time fields start as an "Add date/time" button and can be cleared with "×".
- Validation: end not before start.
- Day, week, month, year and agenda views, with Today/previous/next navigation, localized dates,
  colored entry types, and a year overview that opens individual days. Agenda is the mobile default;
  desktop starts in month view. The picker order is Agenda, Day, Week, Month, Year.
  The month fits without horizontal scrolling. Day/week geometry follows the reference:
  96 px per hour, two clickable 48 px half-hour slots, a 72 px time gutter, and a separate
  header above the scrolling hourly grid. Day has an 800 px scroll viewport and week 736 px.
  Timed cards have a 4 px outer inset, single-line titles, and duration-dependent time labels
  (hidden at 25 minutes or less); short cards use reduced padding. Timelines initially open
  at midnight. A current-time line updates every minute, only on the current date.
  Week columns fit the available width rather than forcing a horizontally scrolling minimum.
  Below 640 px a warning recommends day view. From 768 px day view adds the reference's
  288 px sidebar, with a month navigator and currently running appointments.
  The toolbar keeps all five view icons in one row and labels the active view, with 32 px
  inactive controls and a 120 px active control (fitted down only on the smallest screens).
  Layouts respond
  to the calendar's actual available width, including beside the desktop sidebar. Year tiles
  use an auto-fitting grid. Compact month badges, stacked timed cards and wrapping agenda cards
  share source colors, focus states and full accessible labels.
  Crowded desktop month cells offer a button to open the full day. Day/week views separate all-day ranges
  from timed entries and place overlapping appointments in separate columns. Hour slots open the
  existing appointment editor with a prefilled date/time. These are presentation-only changes:
  no drag-and-drop, resizing, new storage, or alternate save path.
- Calendar navigation and view styling are inspired by
  [yassir-jeraidi/full-calendar](https://github.com/yassir-jeraidi/full-calendar) (MIT);
  Bauplan implements its own presentation adapter using existing components and data.
- Two-way CalDAV synchronization with Apple Calendar using the existing
  Bauplan email/password. Single appointments are editable; tasks and quote deadlines appear in a
  separate read-only calendar. Recurring series are not supported. Previously generated iCal
  subscription links remain valid, but the legacy link-management panel is no longer shown
  in Settings: [calendar integration](calendar-feed.md).

## Collections

Ideas and inspiration (flooring, tiles, lighting …): collection, title, link, image, notes, tags, room, trade, price, favorite; filterable.

## Contacts

- Person, company, trade, phone, email, website, address, notes; search and trade filter.
- Each card lists linked quotes with status; selectable in quote and expense forms.
- **Save to phone contacts** exports one contact as a UTF-8 vCard (`.vcf`), including person, company, phone, email, website, address, and notes. Open the file on Android or iPhone and confirm adding it in the device's contacts app; some browsers save it to Downloads first. No direct address-book access, automatic saving, or ongoing synchronization is involved. Export runs locally and also works with the cached workspace offline.

## Forms (throughout the app)

- Tasks and calendar entries (appointments, tasks, and quote deadlines) open a read-only detail dialog on normal clicks and task/appointment notification links. Details contain text rather than disabled inputs; **Edit** opens the existing editor. Explicit edit buttons and new-entry actions still open forms directly.
- **Scan receipt** above each create form: photo or file → fields are prefilled, the document is saved and linked. Cancelling the form afterwards (Cancel, Escape or clicking the background) asks whether to delete the uploaded document or keep it in Documents; the same applies to the assign step right after "Upload document" with recognition, and to closing while the upload is still running.
- **"+ New"** next to trade, cost item, and contact to create and select an entry directly.

## Settings

- **Password:** the Account card opens a password-change modal. Existing local accounts confirm their current password; OIDC-only accounts can set a local password. Cancelling clears the fields, successful changes close the modal, and errors keep the form open.
- **Navigation:** approved users can reorder or hide page links under Personal preferences, then save to their account. Drag the handles with a mouse or touch, use Space/arrow keys/Space on a focused handle (Escape cancels), or use the up/down buttons. Only handles initiate dragging so checkboxes and normal page scrolling remain usable. The sidebar follows this order; mobile shows the first four visible pages and puts the rest under More. Settings always stays available, even if all page links are hidden. Restore default layout resets the draft; Save applies it. Hidden links do not restrict page access. Preferences synchronize on reload, sign-in, and window focus.
- Accessible tabs separate personal preferences (appearance, account, language), calendar synchronization (CalDAV setup), project configuration (storage and payment sources), admin-only user management, and admin-only administration (backups, OIDC, OCR), in that order. Arrow keys switch tabs, the tab bar wraps on small screens, and switching tabs preserves unsaved form entries until leaving the page.
- Account and sign-out; storage mode display.
- **Language:** German or English, chosen during setup or in Settings; saved per browser.
- **Appearance:** Current, Blue, Green, or Violet palette, independently combined with Light, Dark, or System mode (default: Current + System). Personal Settings has palette previews and mode controls; there is no header mode switch. Changes save automatically per approved user account and synchronize on sign-in, reload, and window focus. System follows each device's own OS preference. The browser remembers the last appearance for the sign-in/setup screens; the signed-in account always takes precedence. Failed saves restore the previous choice and display an error.
- **Visual design and accessibility:** coordinated neutral light/charcoal dark surfaces, restrained accents, distinct control boundaries, and separate readable status colors. Settings groups personal, project, and administrative options. Theme controls retain keyboard focus while saves are serialized and rapid choices are coalesced; a failed save restores the latest confirmed preference. Visible focus outlines, reduced-motion support, forced-colors selection outlines, and labeled/patterned budget chart series support non-pointer and non-color-dependent use.
- Admins only: user management, OIDC sign-in, and shared OCR settings.
- **OCR:** local Tesseract.js recognition for German/English, admin-managed offline language models, embedded PDF text extraction, and local rendering/OCR for scanned pages. See [local OCR](ocr.md).
