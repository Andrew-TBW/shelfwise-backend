-- 012_add_item_numbers.sql
--
-- A stable, per-store "item number" for each variant, used ONLY by the
-- count-sheet screen for voice recognition (spoken as "Item ___") — it
-- deliberately never appears on the Shelf tab, Weekly Report, or
-- anywhere else, so this column isn't part of the normal styles/variants
-- response at all; it's read and written only by the item-number logic
-- and the future count-sheet endpoint.
--
-- NULL means "not currently occupying a slot in the active sequence" —
-- true for anything deactivated (individually, or via its style). A
-- reactivated variant gets a fresh number via the same insert logic
-- used for a brand-new variant; it does not get its old number back.
--
-- Numbers are grouped by style and gaps are closed on deactivation, so
-- this is unique per store but NOT a simple incrementing sequence —
-- it's maintained entirely in application logic (see itemNumbers.js).

ALTER TABLE variants ADD COLUMN item_number INTEGER NULL DEFAULT NULL;

-- Deliberately a DEFERRABLE constraint, not a plain index. Reassigning
-- numbers means shifting several rows in one transaction (e.g. moving
-- both 104->103 and 105->104 to close a gap) — Postgres doesn't
-- guarantee the order it writes rows within a single UPDATE, so a
-- same-transaction shift can transiently collide with itself even when
-- the final result is perfectly valid. DEFERRABLE INITIALLY DEFERRED
-- checks uniqueness once at COMMIT instead of after every row write,
-- which is exactly what a "shift a sequence" operation needs.
--
-- A plain UNIQUE constraint already treats NULL as distinct from every
-- other NULL (standard SQL behavior), so no partial/WHERE clause is
-- needed to allow many inactive variants to all share item_number NULL.
ALTER TABLE variants ADD CONSTRAINT variants_item_number_unique
  UNIQUE (store_id, item_number) DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN variants.item_number IS 'Stable per-store counting label for the count-sheet screen only (spoken as "Item ___"). NULL = not currently in the active sequence. Never exposed via the normal styles/variants API.';
