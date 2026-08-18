-- 015_add_immediate_report_batches.sql
--
-- Backs the Immediate Report with real, persisted state instead of
-- frontend-only memory, so it survives page refreshes, works the same
-- across devices, and can be automatically emailed by a scheduled
-- script without depending on a browser tab being open at all.
--
-- One store has at most one "current" batch at a time (store_id is
-- UNIQUE) — either still accumulating, or already emailed but still
-- being displayed until the next submission replaces it. A variant
-- appears at most once per batch (UNIQUE on batch_id+variant_id) —
-- counting the same item twice within one session updates its
-- existing row rather than duplicating it, matching how a single
-- submission already worked before this change.

CREATE TABLE immediate_report_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL until the scheduled script (or a manual "Send report now")
  -- actually emails this batch. Once set, the batch is left in place
  -- for continued display — it's the NEXT submission after this that
  -- triggers a reset, not the passage of time on its own.
  emailed_at TIMESTAMPTZ NULL
);

CREATE TABLE immediate_report_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES immediate_report_batches(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  sold INTEGER NOT NULL,
  days INTEGER NOT NULL,
  UNIQUE (batch_id, variant_id)
);

CREATE INDEX idx_immediate_report_batches_activity ON immediate_report_batches (last_activity_at) WHERE emailed_at IS NULL;
