-- 014_add_movement_tier.sql
--
-- A style-level (not per-variant) sales-velocity classification the
-- owner sets themselves — "fast" or "slow" moving. Deliberately not a
-- calculated field: what counts as fast or slow varies enough by store
-- (and by the owner's own judgment) that no single threshold could be
-- trusted across different stores, so this stays a manual delegation
-- rather than something the app infers from sales data.
--
-- Same design as margin_tier (013): style-level rather than per-variant,
-- nullable with no default so an existing style stays unclassified
-- until its owner deliberately sets it, and a separate column rather
-- than reusing margin_tier's own values since these are two genuinely
-- independent classifications an owner might set differently.

ALTER TABLE styles ADD COLUMN movement_tier TEXT NULL
  CHECK (movement_tier IN ('fast', 'slow'));

COMMENT ON COLUMN styles.movement_tier IS 'Owner-set sales-velocity classification for this style — fast or slow moving. NULL means not yet classified. Intended to support future fast-mover/slow-mover reports.';
