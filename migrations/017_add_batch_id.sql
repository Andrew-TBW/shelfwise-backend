-- 017_add_batch_id.sql
--
-- Lets the Logs screen combine every count submitted together (a
-- single Voice Count or Count Sheet session covering several
-- products) into one entry in the list, instead of showing one row
-- per product. Nothing before this tracked "submitted together" at
-- all — each sales_entries row was written independently, with its
-- own created_at set by the database — so a real, explicit identifier
-- is needed rather than trying to infer it from how close two
-- timestamps happen to be, which would be fragile in both directions
-- (a slow network spreading one real batch too far apart, or two
-- genuinely separate submissions landing close enough together to
-- look like one).
--
-- NULL for a single, standalone submission (the manual Log Sale
-- modal, or anything logged before this column existed) — those are
-- already "a batch of one" and don't need a shared identifier.

ALTER TABLE sales_entries ADD COLUMN batch_id UUID NULL;

CREATE INDEX idx_sales_entries_batch_id ON sales_entries (batch_id) WHERE batch_id IS NOT NULL;

COMMENT ON COLUMN sales_entries.batch_id IS 'Shared by every sales_entries row written from the same Voice Count or Count Sheet submission, so the Logs screen can group them into one entry. NULL for standalone submissions.';
