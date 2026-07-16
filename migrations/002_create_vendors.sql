-- 002_create_vendors.sql
--
-- Matches the `vendors` array in ShelfWise.jsx today: { id, name }.
-- A vendor belongs to exactly one store — two different stores that both
-- buy from "Northgate Ceramics" would each have their own separate vendor
-- row, since there's no cross-store data sharing anywhere in this schema.

CREATE TABLE vendors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every table that carries store_id gets an index on it: this is the
-- column every single query filters by, so it needs to be fast.
CREATE INDEX idx_vendors_store_id ON vendors (store_id);

COMMENT ON TABLE vendors IS 'Suppliers a store buys styles from. Scoped per-store.';
