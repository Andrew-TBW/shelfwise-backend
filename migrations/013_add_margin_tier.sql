-- 013_add_margin_tier.sql
--
-- A style-level (not per-variant) margin classification — high, mid, or
-- low. Deliberately per-style rather than per-variant: a store's own
-- pricing is normally consistent across all of a style's colors/sizes,
-- so there's no real value in tracking this at the finer-grained
-- variant level, and it keeps the Add/Edit Style screen the natural
-- place to set it, matching where lead_time_days and target_days
-- already live for the same reason.
--
-- Nullable, no default — an existing style stays unclassified until its
-- owner deliberately sets this; nothing assumes a value that might not
-- match how they actually think about their own margins.

ALTER TABLE styles ADD COLUMN margin_tier TEXT NULL
  CHECK (margin_tier IN ('high', 'mid', 'low'));

COMMENT ON COLUMN styles.margin_tier IS 'Owner-set margin classification for this style — high, mid, or low. NULL means not yet classified.';
