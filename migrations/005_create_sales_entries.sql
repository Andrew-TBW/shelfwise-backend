-- 005_create_sales_entries.sql
--
-- Matches each entry in a variant's `sales` array: { id, startDate,
-- endDate, units }. Storing both dates (rather than a single date) is
-- deliberate — it's what let the sell-through rate calculation move from
-- "guess a span from a single date to today" to "use the actual period
-- length," per the Log Sale date-range change made earlier in the
-- frontend build.
--
-- `source` future-proofs for the documented Voice-Based Sales Counting
-- phase: entries need a way to distinguish voice-counted from manually
-- logged data so a pattern of voice-matching errors can be audited later,
-- without needing a schema change when that phase actually starts.

CREATE TABLE sales_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variant_id  UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  units       INTEGER NOT NULL CHECK (units >= 0),
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'voice')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX idx_sales_entries_store_id ON sales_entries (store_id);
CREATE INDEX idx_sales_entries_variant_id ON sales_entries (variant_id);
-- Sell-through rate calculations filter by end_date (the "last 30 days"
-- window), so that's worth its own index once sales history grows large.
CREATE INDEX idx_sales_entries_variant_end_date ON sales_entries (variant_id, end_date);

COMMENT ON TABLE sales_entries IS 'A logged sales period for one variant. Drives the sell-through rate calculation.';
