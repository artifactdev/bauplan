# Calendar integration (CalDAV and iCal)

## Two-way synchronization with Apple Calendar (CalDAV)

Bauplan includes a CalDAV endpoint; no additional calendar service is required.
Use **Settings → Calendar → Sync calendars (CalDAV)** to copy your server address and username.

1. In Apple Calendar on macOS, choose **Add Account → Other CalDAV Account → Manual**.
   On iPhone, open **Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add CalDAV Account**.
2. Use your existing **Bauplan email address and password**. There are no separate calendar credentials.
   SSO-only users must first set a local password using **Settings → Personal → Change password**.
3. Use `https://<your-bauplan-host>/api/caldav/` as the server URL. In advanced settings that separate
   server name and server path, enter the hostname and `/api/caldav/` respectively, and enable SSL.
   Automatic discovery is also available at `/.well-known/caldav`.
4. The project calendar contains editable appointments. Select it when creating a new appointment
   in Apple Calendar, rather than a local or iCloud calendar. A separate **Tasks and quote deadlines**
   calendar contains read-only projections; edit their source records in Bauplan.

Appointments created, edited or deleted by either client use the same local `events` table.
Updates appear on the next client synchronization or web app refresh (there is no push service).
There is no need to subscribe to the ICS feed as well; doing so displays duplicate entries.
The existing read-only ICS feed remains available and unchanged.

### Supported scope

- Single timed, all-day and multi-day appointments, titles and notes.
- UTC, floating times, IANA timezones and embedded `VTIMEZONE` definitions. Bauplan's date/time
  fields use `CALDAV_TIMEZONE` (default **Europe/Berlin**), independently of the server OS timezone.
  Configure this variable before use; changing it later reinterprets existing web-app wall times.
- Client-only fields such as location and alarms are retained in the stored iCalendar data,
  including when editing an appointment in the web app. They do not have separate web-app fields.
- Recurrence rules and exceptions are explicitly rejected without saving; recurring series are not
  supported by Bauplan's event model. Invitations/scheduling, calendar creation, calendar property
  editing and WebDAV sync tokens are not supported. Clients discover changes through collection
  ctags, ETags, `PROPFIND`, `calendar-query` and `calendar-multiget`.
- Conditional `PUT`/`DELETE` checks and the write run in one SQLite transaction. A stale `If-Match`
  returns **412**, so a client can refresh instead of overwriting newer changes.

### Deployment and access

- **Use HTTPS outside localhost.** HTTP Basic sends the existing login password on authenticated
  requests; it is not encrypted without TLS.
- Only current **admin/member** accounts with a valid local password may access CalDAV.
  Password changes, demotion to pending, and account deletion take effect on subsequent requests.
  Browser cookies and the public ICS token do not authorize CalDAV writes.
- Your reverse proxy must pass the `Authorization`, `Depth`, `If-Match` and `If-None-Match` headers,
  and allow `OPTIONS`, `PROPFIND`, `REPORT`, `GET`, `HEAD`, `PUT` and `DELETE` under `/api/caldav/`.
  Route `/.well-known/caldav` to Bauplan too. Avoid an upstream interactive SSO gate on these paths:
  calendar clients cannot complete browser login flows.
- Request bodies are limited to 512 KiB. XML DTD/entity declarations are rejected.
- Calendar UIDs and original iCalendar data are stored with events and included in normal backups.
  Backups created before CalDAV remain importable.
- Google Calendar and Outlook subscriptions remain read-only; they do not become CalDAV clients.

## Read-only subscription (iCal)
1. As an admin: **Settings → Calendar subscription (iCal) → Generate link**.
2. Copy the link and add it in your calendar app as a **subscription / calendar from URL** (Google Calendar, Outlook, Apple Calendar).
3. "Generate new link" invalidates the old link; "Deactivate" disables the subscription.

The link is served by the local Bauplan instance and can be used by any calendar client that supports iCal subscriptions.

## Contents
- All calendar events: all-day (no time) or timed, including multi-day events. Without an end time, a timed event lasts one hour.
- Open tasks with a due date appear as all-day entries.
- Received offers with a **Valid until** date appear as all-day decision deadlines. These entries are derived from offers (not separate editable appointments), so changing the date updates the deadline and accepting, rejecting, or deleting the offer removes it. They also appear in the app calendar and upcoming dashboard entries.
- To delegate a decision, use **Create quote decision task** on a received offer. Review the prefilled deadline, document, cost item, and trade, choose an assignee, and save the task. This is a separate, optional task; subsequent offer changes do not modify it.
- Calendar name = project name; recommended refresh interval: 1 hour.
- Times are "floating" (local time without a time zone).

## Security
- Endpoint: `GET /api/public/calendar/<token>.ics` – intentionally public, because calendar apps cannot sign in.
- Access requires a random 48-character token (192 bits), compared in constant time; a wrong token returns 404.
- Read-only. Anyone with the link can see event and task titles.
- Token storage: local `app_settings` (`ics_token`).

Code: `src/lib/ics.ts` (+ tests `ics.test.ts`), `src/server/calendar-feed.ts`, `src/routes/api/public/calendar.$token.ts`.
