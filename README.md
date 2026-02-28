# Telegram Community Dashboard

Management dashboard for Main Chat: ingest Telegram export JSON, view analytics (messages/reactions over time), manage contacts, and track upsell follow-up calls.

## Setup

1. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to your PostgreSQL connection string.
2. Install and run:

```bash
npm install
npm run dev
```

The app runs on **port 3001** and will create the database schema automatically on first API request.

## Build (optional)

For production build, ensure `DATABASE_URL` is set (e.g. in CI) or the build may fail when collecting route data:

```bash
npm run build
npm start
```

## Features

- **Import**: Upload `result.json` (Telegram chat export). New messages and reactions are inserted; existing ones are skipped (idempotent).
- **Dashboard**: KPIs (total messages, reactions, contacts, active users) and time-series charts (messages/reactions over time) with grouping by day/week/month.
- **Contacts**: Table of all users with Premium flag, assigned operator, last activity, and call count. Filter by “Not in Premium” for upsell list.
- **User profile**: Per-user stats, messages/reactions over time, recent messages, “who they react to,” and CRM: In Premium toggle, assigned to, notes, and call log (Call 1–10) with notes, objections, and plans discussed.

All UI copy is in English.

## Production (Docker)

Build and run with Docker. Pass your Postgres URL at runtime:

```bash
docker build -t telegram-dashboard .
docker run -p 3001:3001 -e DATABASE_URL="postgres://user:pass@host:5432/dbname?sslmode=disable" telegram-dashboard
```

The app listens on **port 3001** and creates the database schema on first request. Then open **Import** and upload your first `result.json`.
