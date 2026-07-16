-- 007_create_purchase_order_lines.sql
--
-- Matches each entry in a PO's `lines` array: { id, styleId, variantId,
-- qtyOrdered, qtyReceived }.
--
-- style_id is stored alongside variant_id even though a variant always
-- belongs to exactly one style (technically derivable via variant_id ->
-- variants.style_id). This mirrors the frontend's own PODetailModal,
-- which looks up both together via findStyleVariant() to render "Style
-- Name — Variant Label" without an extra round trip. Keeping it
-- denormalized here avoids that join on every PO read.
--
-- ON DELETE RESTRICT on style_id/variant_id: if a variant is deleted
-- while it's referenced on a real (non-draft) PO, that PO's history
-- would otherwise point at nothing. The application layer should block
-- deleting a variant that appears on any non-closed PO, rather than the
-- database silently cascading the deletion away.

CREATE TABLE purchase_order_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  purchase_order_id   UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  style_id            UUID NOT NULL REFERENCES styles(id) ON DELETE RESTRICT,
  variant_id          UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  qty_ordered         INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received        INTEGER NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  CHECK (qty_received <= qty_ordered)
);

CREATE INDEX idx_po_lines_store_id ON purchase_order_lines (store_id);
CREATE INDEX idx_po_lines_po_id ON purchase_order_lines (purchase_order_id);
-- The "incoming stock per variant" calculation (submitted/partially
-- received POs, summed by variant) is one of the most frequent queries
-- once the reorder math moves server-side — index for it directly.
CREATE INDEX idx_po_lines_variant_id ON purchase_order_lines (variant_id);

COMMENT ON TABLE purchase_order_lines IS 'One line item (a variant + quantity) within a purchase order.';
