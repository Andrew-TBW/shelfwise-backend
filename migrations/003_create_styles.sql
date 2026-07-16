-- 003_create_styles.sql
--
-- Matches the `styles` array in ShelfWise.jsx: { id, name, category,
-- vendorId, leadTimeDays, targetDays, variants: [...] }.
--
-- lead_time_days and target_days live here (not per-variant) because the
-- reorder formula is applied uniformly per style, consistent with the
-- Technical Requirements decision to carry forward a single reorder
-- formula rather than per-item tuning.
--
-- vendor_id uses ON DELETE RESTRICT rather than CASCADE: a vendor with
-- styles still attached to it shouldn't be silently deletable, since that
-- would orphan real inventory data. The application layer should require
-- reassigning or removing those styles first.

CREATE TABLE styles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  vendor_id       UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT '',
  lead_time_days  INTEGER NOT NULL DEFAULT 7 CHECK (lead_time_days >= 0),
  target_days     INTEGER NOT NULL DEFAULT 14 CHECK (target_days >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_styles_store_id ON styles (store_id);
CREATE INDEX idx_styles_vendor_id ON styles (vendor_id);

COMMENT ON TABLE styles IS 'A sellable "style" (e.g. Ceramic Mug) that expands into variants by size/color.';
