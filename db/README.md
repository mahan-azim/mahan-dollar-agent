# Mahan Market Agent: PostgreSQL schema

This directory contains database *structure only*. It does not create users, subscriptions, transactions or fabricated plans, and it does not connect the live website.

## Files

- `migrations/001_initial_schema.sql`: completes the existing `profiles` table and defines `plans`, `subscriptions`, `payments` and `payment_events`.
- `verify.sql`: read-only checks of tables, constraints, profile columns and row counts.

## Production procedure (not performed yet)

1. Take an independent, encrypted PostgreSQL backup and **test a restore** in a separate database. Railway volume persistence is not a backup.
2. Inspect the existing `public.profiles` schema and pre-existing data. The migration assumes `profiles(id uuid primary key, email text not null, username text nullable)`. If existing rows contain case-insensitive duplicate email addresses or usernames, resolve them before creating the unique indexes.
3. Connect securely to the *correct* PostgreSQL database as a migration administrator (Railway private network if executing from a Railway service). Keep credentials only in server-side variables, not this public GitHub repository.
4. Apply the file once with a SQL client that stops on errors. Example for a trusted machine using an existing `DATABASE_URL` environment variable: `psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/migrations/001_initial_schema.sql`.
5. Execute `db/verify.sql` (read-only) and inspect the results. No application authentication or payment processing is enabled by applying the migration.

## Security and operational notes

- `profiles.id` is a record identifier, **not** proof of identity. Social login and account provisioning must verify the identity provider server-side and prevent duplicate profiles.
- Do not grant subscription access based on client-provided payment status. A future backend must authenticate and independently verify provider callbacks, enforce idempotency, and update payment/subscription within a transaction.
- Monetary values are stored in provider-defined minor currency units; for IRR confirm the payment gateway unit (rial vs toman) before recording charges.
- Database credentials, payment keys, sensitive personal data, and SQL dumps must never be committed to GitHub.
- This branch deliberately does not change `server.mjs`, `public/`, deployment settings, or the existing n8n market feed.
- The migration is transactional and designed to be repeatable on the specified initial schema. Existing different schemas must be reviewed first.
