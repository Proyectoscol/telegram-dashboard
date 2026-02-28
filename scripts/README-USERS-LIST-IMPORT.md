# Members list import (users without from_id)

Contacts who have never written or reacted in the chat do not appear in Telegram's export, so they are not in the `users` table when you only ingest `result.json`. You can bulk-import them from a members list (e.g. from the group UI) so they appear in Contacts and can be tracked for CRM and upsell.

## Schema

- **`users.from_id`** is now nullable. List-only members are stored with `from_id = NULL`.
- **`users.username`** stores the Telegram @handle (without the @). Used to avoid duplicate rows when re-importing the list and for future matching if the export ever includes username.
- Unique index on `username` (where not null) so the same @handle is not inserted twice.

## Format of the list file

Lines like:

```
{{number}}. {{display name}} @{{username}}
```

Examples:

- `724. German @howisyourlifee1`
- `718. Axel C @AxelCorso`

Blank lines and non-matching lines are ignored.

## Generate SQL

From the project root (or from `dashboard/`):

```bash
node dashboard/scripts/generate-users-list-sql.js path/to/userslist.md > dashboard/scripts/users-list-import.sql
```

Or with default path `userslist.md` next to the repo:

```bash
node dashboard/scripts/generate-users-list-sql.js userslist.md > dashboard/scripts/users-list-import.sql
```

This produces `INSERT ... ON CONFLICT (username) WHERE (username IS NOT NULL) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()` so you can run it repeatedly; existing usernames get their display name updated.

## Run the SQL in Postgres

1. Ensure migrations have run (dashboard has been started at least once so `username` exists and `from_id` is nullable).
2. Run the generated file:

```bash
psql "$DATABASE_URL" -f dashboard/scripts/users-list-import.sql
```

Or in any SQL client: paste and run the contents of `users-list-import.sql`.

## Matching when you ingest later

When you upload a new `result.json`:

- Users who already have a **from_id** (from a previous ingest) get their **display_name** updated.
- If there is **no** user with that from_id but there **is** a row with `from_id IS NULL` and the same **display_name**, that row is updated: its **from_id** is set to the one from the export. From then on that contact is tracked by from_id (stable), and their messages/reactions will appear in stats.

So list-only members are first identified by **display_name** (and optionally **username** later). Once they interact and appear in an export, they are merged by display_name and get a **from_id** assigned.

## Viewing list-only contacts

- They appear in **Contacts** with User ID shown as "—".
- **View profile** links to `/users/by-id/{{id}}` so you can still open their profile, set Premium, assign, add notes, and log up to 10 follow-up calls.
