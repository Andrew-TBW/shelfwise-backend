-- 011_add_deactivation.sql
--
-- Replaces true deletion with deactivation for styles and variants.
-- deactivated_at is NULL for anything active; a real timestamp records
-- when something was turned off, so "when was this deactivated" is
-- always available for free without needing a separate audit trail.
--
-- A style being deactivated is NOT cascaded down to its variant rows —
-- deliberately. A variant is treated as effectively inactive if EITHER
-- its own deactivated_at is set, OR its parent style's is. This means
-- deactivating a style is always just one row's timestamp, and
-- reactivating it automatically brings back every variant that wasn't
-- ALSO separately deactivated on its own — no cascading writes needed
-- in either direction, just this rule applied consistently at query time.

ALTER TABLE styles ADD COLUMN deactivated_at TIMESTAMPTZ NULL DEFAULT NULL;
ALTER TABLE variants ADD COLUMN deactivated_at TIMESTAMPTZ NULL DEFAULT NULL;

CREATE INDEX idx_styles_deactivated_at ON styles (deactivated_at);
CREATE INDEX idx_variants_deactivated_at ON variants (deactivated_at);

COMMENT ON COLUMN styles.deactivated_at IS 'NULL = active. A timestamp records when it was deactivated (soft-delete, reversible).';
COMMENT ON COLUMN variants.deactivated_at IS 'NULL = active. Also effectively inactive if the parent style is deactivated, even if this is NULL.';
