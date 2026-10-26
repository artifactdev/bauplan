# Bauplan – Renovation Planner

Private app for managing a home renovation: budget, quotes and requests, invoices, expenses, documents with text recognition, tasks, calendar (including an iCal subscription), collections, and contacts. Available in German and English.

## Documentation

The full documentation is in the [`docs/`](docs/README.md) folder:

- [Features](docs/features.md)
- [Budget logic](docs/budget.md)
- [Documents & text recognition (OCR)](docs/ocr.md)
- [Installable app & offline use](docs/offline.md)
- [Backups and restore](docs/backups.md)
- [Users & sign-in](docs/auth.md)
- [Calendar subscription (iCal)](docs/calendar-feed.md)
- [Architecture](docs/architecture.md)
- [Operations & self-hosting](docs/operations.md)
- [Docker & Unraid setup](docs/docker-unraid.md)
- [Decisions](docs/decisions.md)

Quick start for your own server: [SELFHOSTING.md](SELFHOSTING.md).

## Development

```sh
bun install
bun run dev
bunx vitest run
```

## Run locally with Docker

```sh
docker compose up -d --build
```

Open <http://localhost:3000>. The SQLite database and OCR language models persist in `./daten`; uploaded documents persist separately in `./dokumente`. OCR runs locally in the app; optional OIDC sign-in requires an identity provider only when configured.

## Built with

TanStack Start · React · TypeScript · Tailwind CSS · i18next · SQLite · Tesseract.js (local OCR)
