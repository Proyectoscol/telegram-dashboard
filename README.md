# Telegram Dashboard

Next.js 14 app for Telegram chat analytics: KPIs, messages/reactions over time, active and inactive users, contacts, import, and settings. Uses Postgres (Supabase Pooler–compatible), Supabase Auth, and optional Redis cache.

## Setup

1. Copy `.env.example` to `.env` and set:
   - `POSTGRES_*` or `DATABASE_URL` for the database
   - `SUPABASE_*` and `NEXT_PUBLIC_SUPABASE_*` for auth
   - Optionally `REDIS_URL` for shared cache

2. Install and run:
   ```bash
   npm install
   npm run dev
   ```

3. Open [http://localhost:3001](http://localhost:3001).

## Deploy (Docker / EasyPanel)

- Build: `docker build -t telegram-dashboard .`
- Run with env vars for `POSTGRES_*`, `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`, `PORT`, and optionally `REDIS_URL`.

## Connect to a new GitHub repo

```bash
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git branch -M main
git push -u origin main
```

## Architecture

- **Single-query overview:** Dashboard overview uses one CTE query instead of multiple sequential DB calls to avoid connection pool exhaustion.
- **Pool:** Fixed 5 connections, 15s connect timeout; no env overrides.
- **Bootstrap endpoints:** `/api/bootstrap/dashboard` and `/api/bootstrap/settings` return all data for the page in one request.
