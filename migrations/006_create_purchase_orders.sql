-- 006_create_purchase_orders.sql
--
-- Matches the `purchaseOrders` array in ShelfWise.jsx: { id, vendorId,
-- status, createdDate, notes, lines: [...] }.
--
-- status is constrained to the exact same five values the frontend's
-- PO_STATUS_META already uses, so the backend rejects anything the UI
-- doesn't know how to render, rather than silently accepting a typo'd
-- status string.

CREATE TABLE purchase_orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  vendor_id   UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'submitted', 'partially_received', 'received', 'closed')),
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchase_orders_store_id ON purchase_orders (store_id);
CREATE INDEX idx_purchase_orders_vendor_id ON purchase_orders (vendor_id);
-- The Orders tab and the "incoming stock" calculation both filter heavily
-- on status (e.g. "is this PO submitted or partially_received?").
CREATE INDEX idx_purchase_orders_store_status ON purchase_orders (store_id, status);

COMMENT ON TABLE purchase_orders IS 'A purchase order against one vendor, moving through draft -> submitted -> received -> closed.';
