# Database Migrations

## Approach

This project uses **schema.sql** as the single source of truth. It is idempotent: running it multiple times is safe. It uses `IF NOT EXISTS` and `DO $$ ... END $$` blocks to add tables/columns only when they are missing.

## Commands

```bash
# Check if your database has all expected tables and columns
npm run check-schema

# Apply schema (creates missing tables/columns)
npm run migrate
```

## Applying migrations

1. Ensure `DATABASE_URL` is set in `backend/.env`
2. Run `npm run check-schema` to see current state
3. Run `npm run migrate` to apply any missing schema changes

The migrate script runs `schema.sql` in a single transaction. No version tracking table is used—each `DO $$` block checks `information_schema` before altering.
