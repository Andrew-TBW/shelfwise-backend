-- 004_create_variants.sql
--
-- Matches each entry in a style's `variants` array: { id, sku, size,
-- color, stock }. This is the core structural change from the original
-- flat-SKU prototype — stock, sales, and reorder status all live at this
-- level, while style-level views are just a roll-up over these rows.
--
-- SKU uniqueness is scoped to the store (UNIQUE (store_id, sku)), not
-- global — two different stores may reuse the same SKU convention
-- independently, and there's no reason to block that.
--
-- store_id is duplicated here even though it's technically derivable via
-- style_id -> styles.store_id. That's deliberate: it lets every query
-- filter directly on variants.store_id without an extra join, which
-- keeps the tenant-isolation check simple and hard to get wrong in the
-- API layer (see the security review discussion in the Backend Build
-- Plan). A CHECK-via-trigger could enforce the two store_ids always
-- match; left as an implementation note for Phase 2.

CREATE TABLE variants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  style_id    UUID NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  sku         TEXT NOT NULL,
  size        TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '',
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, sku)
);

CREATE INDEX idx_variants_store_id ON variants (store_id);
CREATE INDEX idx_variants_style_id ON variants (style_id);

COMMENT ON TABLE variants IS 'A single size/color SKU within a style. Stock and reorder status live here.';
