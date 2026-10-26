# Calendar subscription (iCal)

## Usage
1. As an admin: **Settings → Calendar subscription (iCal) → Generate link**.
2. Copy the link and add it in your calendar app as a **subscription / calendar from URL** (Google Calendar, Outlook, Apple Calendar).
3. "Generate new link" invalidates the old link; "Deactivate" disables the subscription.

The link is served by the local Bauplan instance and can be used by any calendar client that supports iCal subscriptions.

## Contents
- All calendar events: all-day (no time) or timed, including multi-day events. Without an end time, a timed event lasts one hour.
- Open tasks with a due date appear as all-day entries.
- Calendar name = project name; recommended refresh interval: 1 hour.
- Times are "floating" (local time without a time zone).

## Security
- Endpoint: `GET /api/public/calendar/<token>.ics` – intentionally public, because calendar apps cannot sign in.
- Access requires a random 48-character token (192 bits), compared in constant time; a wrong token returns 404.
- Read-only. Anyone with the link can see event and task titles.
- Token storage: local `app_settings` (`ics_token`).

Code: `src/lib/ics.ts` (+ tests `ics.test.ts`), `src/server/calendar-feed.ts`, `src/routes/api/public/calendar.$token.ts`.
