-- 018_remove_low_margin_tier.sql
--
-- Retires "low" as a margin classification, leaving only "high" and
-- "mid" as valid values going forward.
--
-- Postgres won't let a CHECK constraint be altered in place, so the
-- original one (auto-named styles_margin_tier_check when it was
-- created inline in 013_add_margin_tier.sql) is dropped and replaced
-- with a tighter version.
--
-- Deliberately NOT touching any existing data — if a style is still
-- classified "low" at the moment this runs, adding the new, tighter
-- constraint will fail outright rather than silently reclassifying or
-- orphaning that row. That failure is the point: it forces whoever's
-- running this to go reclassify those styles first, rather than the
-- migration guessing what they should become instead.
--
-- Wrapped in an explicit transaction: psql doesn't run a script as one
-- atomic unit by default, so without BEGIN/COMMIT here, a failure on
-- the ADD CONSTRAINT step would leave the DROP CONSTRAINT step already
-- committed — the column would end up with no validation at all
-- rather than safely stopping with the original constraint intact.

BEGIN;

ALTER TABLE styles DROP CONSTRAINT styles_margin_tier_check;

ALTER TABLE styles ADD CONSTRAINT styles_margin_tier_check
  CHECK (margin_tier IN ('high', 'mid'));

COMMENT ON COLUMN styles.margin_tier IS 'Owner-set margin classification for this style — high or mid. NULL means not yet classified. "low" was retired as an option; no style should hold that value from this point on.';

COMMIT;
