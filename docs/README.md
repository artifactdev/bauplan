# Bauplan – Documentation

Bauplan is a private app for managing a home renovation: budget, quotes, invoices, expenses, documents, tasks, calendar, collections, and contacts — in German or English, with amounts in euros.

| Document | Contents |
| --- | --- |
| [Features](features.md) | All areas of the app and how they work together |
| [Budget logic](budget.md) | How planned, committed, expected, and paid costs are calculated |
| [Documents & text recognition (OCR)](ocr.md) | Uploads, camera, form pre-filling, recognition rules |
| [Paperless-ngx integration](paperless.md) | Personal archive access, reviewed imports, manual batch archiving and known-link filters |
| [Installable app & offline use](offline.md) | Home-screen installation, offline editing, sync and conflicts |
| [Backups and restore](backups.md) | Portable backups, included secrets, restore behavior and limits |
| [Users & sign-in](auth.md) | Initial setup, roles, OIDC (e.g. Pocket ID) |
| [Calendar integration (CalDAV/iCal)](calendar-feed.md) | Two-way Apple Calendar sync with existing credentials, or read-only subscriptions |
| [Architecture](architecture.md) | Structure, data model, local storage, i18n |
| [Operations & self-hosting](operations.md) | Docker, local SQLite, environment variables, tests |
| [Docker & Unraid setup](docker-unraid.md) | Plain Docker, Unraid templates, persistent path mappings, optional OCR |
| [Decisions](decisions.md) | Decisions made and their rationale (ADR style) |

Short guide for running your own server: see [`../SELFHOSTING.md`](../SELFHOSTING.md).
