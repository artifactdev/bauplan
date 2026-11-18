# Website

Static landing page for Bauplan, published with GitHub Pages at
<https://artifactdev.github.io/bauplan/>.

```
site/
  index.html      content (German only)
  styles.css      design tokens, layout, lightbox
  script.js       lightbox behaviour
  screenshots/    captured from the demo instance and committed to the repo
```

There is no build step and no external dependency: GitHub Pages uploads the
`site/` folder as-is (see [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)).
All asset paths are relative so the page also works from the `/bauplan/`
sub-path of the project site.

## Screenshots

The images are **committed** to the repository. The Pages workflow only deploys
them; a separate workflow regenerates them.

### Locally

```sh
npm run demo              # seeds .demo/ with fictional data and starts the app
npm run site:screenshots  # captures all images into site/screenshots/
```

`npm run demo` is safe to run repeatedly: the demo user
(`demo@bauplan.example` / `bauplan-demo-2026`) and the project
"Sanierung Doppelhaushälfte" are reused, missing demo content is added. The data
lives in `.demo/` (git-ignored) and is based on `createDemoProjectData()` from
`src/server/demo-project.ts`.
The seed adds fictional diary reports and locally generated photo/video examples
without calling the weather API, so screenshots remain deterministic.
Reports span multiple dates and months. Two explicitly fictional completed-task
fixtures are refreshed to today's completion date on each seed run to demonstrate
the new-report preselection; other existing task histories are not backdated.
The diary archive adds 90 explicitly fictional reports across the preceding 30 months,
without modifying existing reports. Re-seeding does not duplicate the dated archive fixtures.
The seed script runs directly as native Node ESM; it does not depend on a
package-internal TypeScript runner path.

The capture script (`scripts/screenshots.mjs`) uses Playwright/Chromium,
desktop at 1440×900 and mobile at 390×844, both at 2× and German UI. Useful
environment variables:

| Variable        | Default                 | Purpose                               |
| --------------- | ----------------------- | ------------------------------------- |
| `BASE_URL`      | `http://localhost:3000` | Running instance to capture           |
| `DEMO_EMAIL`    | `demo@bauplan.example`  | Sign-in for the demo instance         |
| `DEMO_PASSWORD` | `bauplan-demo-2026`     | Password for the demo instance        |
| `SHOTS`         | _(all)_                 | Comma-separated names to capture only |

```sh
SHOTS=budget,expenses npm run site:screenshots
```

The `diary` screenshot shows full-width month-grouped report cards without a decorative
left timeline, the right-hand year/month rail, overflow action menus and filters;
`diary-details` opens the fictional report from its summary in a detail dialog with weather
and local photo/video attachments. `mobile-diary` shows the responsive timeline;
`mobile-diary-details` shows the near-full-screen report dialog on a phone. Refresh these
when changing the diary page, demo reports, or media presentation.
The `diary-editor` screenshot shows report creation in the responsive modal, with
a compact date field above the full-width title and day-based task, offer and payment suggestions. The explicitly fictional financial
fixtures and their report roll forward to today when re-seeding, as do the daily task fixtures.
The `diary-wizard` screenshot shows the optional media step in the responsive editor
modal after saving a new report. The capture script creates a temporary fictional report and removes it
after the capture, using the same delete-confirmation dialog as normal diary entries.
The `diary-navigation` screenshot jumps directly to the oldest report month and opens
the date picker, demonstrating navigation across the multi-year archive.
`diary-subtasks` shows subtask choices grouped by their parent task, with independent selection and completion-day preselection.
Its explicitly fictional open parent has subtasks completed today, yesterday, without a
known legacy date, and still open; the daily fixtures roll forward when re-seeding.
`diary-photos` opens the second of two locally generated illustrations in the report's
image gallery. All nine diary
screenshots are referenced on the website.

The construction examples include mixed Work/task prerequisites, explicit Work
completion, a planned drying period, benign parallel trades and an intentionally
early task. Additional fictional renovation phases span several weeks and are
added without modifying existing records. `calendar-timeline` captures the desktop Bauablauf view with the
preparation links selected; `mobile-calendar-timeline` captures its touch layout.
Both are referenced in the website gallery. Refresh `calendar`, `calendar-week`,
`mobile-calendar`, `tasks` and `tasks-subtasks` when changing planning data or the
calendar toolbar.

The `expenses` capture selects the fictional contractor invoice and shows
payment and bank-submission statuses, filtering, and ZIP actions. Refresh it
whenever that workflow changes.

### In CI

[`.github/workflows/screenshots.yml`](../.github/workflows/screenshots.yml) runs
manually (`workflow_dispatch`) and monthly: it installs the dependencies and
Chromium, seeds a fresh demo database, starts the app on port 3100, captures all
screenshots, and commits the changed images to the default branch. A monthly run
keeps the relative dates in the demo data (due dates, calendar entries) close to
"today". Because such a commit does not trigger other workflows, the job then
starts the Pages deployment explicitly.

## Content

The page is German-only on purpose; the app itself stays bilingual. Texts are
plain HTML, so there is no i18n layer to maintain for the website. The footer
notes that all screenshots show fictional sample data.

When the app changes, check whether the screenshots still match the UI — and
update the feature texts in `index.html` if behaviour changed.
