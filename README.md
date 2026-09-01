# ArthurIQ Database Schema — Phase 1

This is the database schema for the ArthurIQ backend, covering Phase 1 of
the Backend Build Plan ("Design the database schema").

## What's here

- `migrations/000_extensions.sql` through `007_create_purchase_order_lines.sql`
  — run these in order (the numbers matter) against a PostgreSQL 13+
  database. Each file creates one table, its indexes, and a comment
  explaining the design decisions behind it.
- `examples/example_seed_data.sql` — **not a migration**, and not meant for
  production. This loads sample data (two stores, matching the styles/
  vendors already seeded in ArthurIQ.jsx) purely so you can poke around
  a populated database and see the shape of things. Safe to run against a
  throwaway test database; do not run this against real customer data.

## How to run the migrations

Against a fresh PostgreSQL database (adjust `arthuriq` to your actual
database name):

```bash
for f in migrations/*.sql; do
  psql -d arthuriq -f "$f"
done
```

Or one at a time, in order, if you want to review each step:
```bash
psql -d arthuriq -f migrations/000_extensions.sql
psql -d arthuriq -f migrations/001_create_stores.sql
psql -d arthuriq -f migrations/002_create_vendors.sql
psql -d arthuriq -f migrations/003_create_styles.sql
psql -d arthuriq -f migrations/004_create_variants.sql
psql -d arthuriq -f migrations/005_create_sales_entries.sql
psql -d arthuriq -f migrations/006_create_purchase_orders.sql
psql -d arthuriq -f migrations/007_create_purchase_order_lines.sql
```

## Key design decisions (see inline comments for full detail)

- **Every table has a `store_id`.** This is the tenant boundary — since
  ArthurIQ serves many different retail-store customers, every query the
  backend ever runs must filter by `store_id`. This is what makes a
  cross-store data leak a structural impossibility rather than a bug
  waiting to happen.
- **UUIDs, not auto-incrementing integers, for primary keys.** Doesn't
  leak row counts or ordering across stores.
- **SKUs are unique per store, not globally** (`UNIQUE (store_id, sku)`)
  — two different stores can use the same SKU convention independently.
- **Checks are enforced at the database level**, not just in application
  code: stock can't go negative, PO statuses are restricted to the five
  values the frontend actually knows how to render, sales periods can't
  have an end date before their start date, and a PO line can't receive
  more than was ordered.
- **`sales_entries.source`** (manual vs. voice) is included now, ahead of
  actually needing it, so the documented Voice-Based Sales Counting phase
  won't require a schema change later.

## What was tested before delivering this

Every migration was run against a real, disposable PostgreSQL 16
instance — not just checked for correct syntax. That included:
- Running all seven migrations in order against a clean database.
- Loading sample data shaped exactly like ArthurIQ.jsx's real seed data
  (vendors, styles, variants, weekly sales periods, a submitted PO).
- Reconstructing the app's actual calculations directly in SQL — the
  sell-through rate formula and the "incoming stock per variant" PO
  calculation — and confirming the numbers match what the frontend would
  compute for the same data.
- Deliberately trying to insert invalid data (negative stock, an invalid
  PO status, a backwards date range, over-receiving a PO line, a
  duplicate SKU within one store) and confirming each one was rejected.
- Creating a second store and confirming its data stays fully separate
  from the first store's, using the same store_id-filtered query pattern
  the backend API will need to use everywhere.

## What's next (Phase 2)

This schema is the foundation Phase 2 ("Build the core API") will sit on
top of — the actual endpoints (get styles, log a sale, create a PO,
receive a shipment) and the reorder-math logic moving server-side.
