-- 016_add_resulting_stock.sql
--
-- Adds the one piece of information the new Logs screen actually
-- needs that nothing before it ever stored: what the stock count was
-- physically set to at the moment a sale was logged, as opposed to
-- sales_entries.units (the inferred amount sold, derived from the
-- *difference* between two counts). The two aren't interchangeable —
-- units alone can't tell you "what was counted," only "how much moved
-- since the last count."
--
-- Nullable, and deliberately left NULL for every entry that already
-- exists before this migration runs — there's no reliable way to
-- reconstruct what was actually counted for historical entries, since
-- other things (PO receiving, manual stock corrections) can change
-- stock without ever creating a sales_entries row, which would make
-- any backward reconstruction from the current stock silently wrong.
-- Going forward, every new entry populates this directly at the
-- moment it's created, when the real count is still known for certain.

ALTER TABLE sales_entries ADD COLUMN resulting_stock INTEGER NULL;

COMMENT ON COLUMN sales_entries.resulting_stock IS 'The actual stock count entered when this entry was logged — what was counted, not the inferred units sold. NULL for entries logged before this column existed, since that value cannot be reliably reconstructed after the fact.';
