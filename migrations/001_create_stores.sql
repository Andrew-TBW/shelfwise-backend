-- 001_create_stores.sql
--
-- `stores` is the tenant boundary for the entire schema. Every other table
-- in this database carries a store_id column that references this table,
-- and every query the backend ever runs must filter by store_id.
--
-- This is the most important structural decision in the schema: it's what
-- makes "Store A accidentally sees Store B's data" a structural
-- impossibility (assuming the API layer always filters correctly) rather
-- than something that depends on remembering to join through several
-- tables correctly every time.
--
-- No `owner` or user concept lives here yet — staff accounts/auth are a
-- later phase (see Backend Build Plan, Phase 3). For now, a store is just
-- an identity that everything else hangs off of.

CREATE TABLE stores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE stores IS 'One row per retail-store customer. The tenant boundary for all other tables.';
